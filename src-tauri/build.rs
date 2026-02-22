fn main() {
    // 检查外部工具可执行文件是否存在于 src-tauri 目录
    // 存在则通过 include_bytes! 嵌入到最终二进制中

    let exe_name = if cfg!(windows) {
        "sbuddy-crypto.exe"
    } else {
        "sbuddy-crypto"
    };

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let crypto_path = std::path::Path::new(&manifest_dir).join(exe_name);

    if crypto_path.is_file() {
        println!("cargo:rustc-cfg=has_embedded_sbuddy_crypto");
        println!(
            "cargo:rustc-env=SBUDDY_CRYPTO_PATH={}",
            crypto_path.display()
        );
    }

    // 当 exe 文件变化时重新运行
    println!("cargo:rerun-if-changed={}", exe_name);

    tauri_build::build();

    // 为集成测试嵌入 Windows Application Manifest（声明 Common Controls v6 依赖）
    //
    // tauri_build 通过 `cargo:rustc-link-arg-bins` 仅为 bin 目标嵌入包含
    // Common Controls v6 声明的 manifest 资源。集成测试 exe 没有该 manifest，
    // 导致 Windows 加载 comctl32.dll v5.82（不含 TaskDialogIndirect），
    // 进程启动时报 STATUS_ENTRYPOINT_NOT_FOUND (0xC0000139)。
    //
    // 这里单独编译一份 manifest 资源，仅通过 `cargo:rustc-link-arg-tests` 链接给测试目标，
    // 避免与 tauri_build 为 bin 目标生成的资源冲突。
    //
    // 仅在 debug profile 下执行（release 构建不会运行测试，无需生成）。
    #[cfg(windows)]
    {
        let profile = std::env::var("PROFILE").unwrap_or_default();
        if profile == "debug" {
            embed_manifest_for_tests();
        }
    }
}

#[cfg(windows)]
fn embed_manifest_for_tests() {
    use std::path::Path;
    use std::process::Command;

    let out_dir = std::env::var("OUT_DIR").unwrap();
    let out = Path::new(&out_dir);

    // 1. 写 .rc 文件
    let rc_path = out.join("test_manifest.rc");
    let manifest_content = r#"#pragma code_page(65001)
1 24
{
" <assembly xmlns=""urn:schemas-microsoft-com:asm.v1"" manifestVersion=""1.0""> "
" <dependency> "
" <dependentAssembly> "
" <assemblyIdentity "
" type=""win32"" "
" name=""Microsoft.Windows.Common-Controls"" "
" version=""6.0.0.0"" "
" processorArchitecture=""*"" "
" publicKeyToken=""6595b64144ccf1df"" "
" language=""*"" "
" /> "
" </dependentAssembly> "
" </dependency> "
" </assembly> "
}
"#;
    std::fs::write(&rc_path, manifest_content).unwrap();

    // 2. 查找 rc.exe
    let rc_exe = find_windows_sdk_tool("rc.exe").expect("rc.exe not found in Windows SDK");

    // 3. 编译 .rc -> .res
    let res_path = out.join("test_manifest.res");
    let status = Command::new(&rc_exe)
        .args(["/nologo", "/fo"])
        .arg(&res_path)
        .arg(&rc_path)
        .status()
        .expect("failed to run rc.exe");
    assert!(status.success(), "rc.exe failed");

    // 4. 查找 cvtres.exe（MSVC 自带）
    let cvtres = find_msvc_tool("cvtres.exe").expect("cvtres.exe not found");

    // 5. 转换 .res -> .lib
    let lib_path = out.join("test_manifest.lib");
    let _status = Command::new(&cvtres)
        .args(["/nologo", "/machine:x64", "/out:"])
        .arg(&lib_path)
        .arg(&res_path)
        .status();

    let lib_exists = lib_path.exists();
    if !lib_exists {
        // 尝试另一种写法
        let out_arg = format!("/out:{}", lib_path.display());
        let status = Command::new(&cvtres)
            .args(["/nologo", "/machine:x64", &out_arg])
            .arg(&res_path)
            .status()
            .expect("failed to run cvtres.exe");
        assert!(status.success(), "cvtres.exe failed");
    }

    // 6. 仅为测试目标链接
    if lib_path.exists() {
        println!("cargo:rustc-link-arg-tests={}", lib_path.display());
    }
}

#[cfg(windows)]
fn find_windows_sdk_tool(name: &str) -> Option<std::path::PathBuf> {
    // 常见 Windows SDK 路径
    let sdk_root = std::path::Path::new(r"C:\Program Files (x86)\Windows Kits\10\bin");
    if !sdk_root.exists() {
        return None;
    }

    // 查找最新版本的 x64 工具
    let mut best: Option<(String, std::path::PathBuf)> = None;
    if let Ok(entries) = std::fs::read_dir(sdk_root) {
        for entry in entries.flatten() {
            let name_str = entry.file_name().to_string_lossy().into_owned();
            if !name_str.starts_with("10.") {
                continue;
            }
            let tool_path = entry.path().join("x64").join(name);
            if tool_path.exists() {
                if best.as_ref().map_or(true, |(v, _)| name_str > *v) {
                    best = Some((name_str, tool_path));
                }
            }
        }
    }
    best.map(|(_, p)| p)
}

#[cfg(windows)]
fn find_msvc_tool(name: &str) -> Option<std::path::PathBuf> {
    // 通过 MSVC 安装路径查找
    let vs_roots = [
        r"D:\VS2022\VC\Tools\MSVC",
        r"C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC",
        r"C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Tools\MSVC",
        r"C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Tools\MSVC",
        r"C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\VC\Tools\MSVC",
    ];

    for root in &vs_roots {
        let root = std::path::Path::new(root);
        if !root.exists() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(root) {
            let mut versions: Vec<_> = entries
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect();
            versions.sort();
            for ver in versions.iter().rev() {
                let tool_path = root.join(ver).join("bin").join("Hostx64").join("x64").join(name);
                if tool_path.exists() {
                    return Some(tool_path);
                }
            }
        }
    }
    None
}
