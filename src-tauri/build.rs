fn main() {
    // 检查外部工具可执行文件是否存在
    // 找到则通过 include_bytes! 嵌入到最终二进制中

    let exe_name = if cfg!(windows) {
        "sbuddy-crypto.exe"
    } else {
        "sbuddy-crypto"
    };

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let manifest_dir = std::path::Path::new(&manifest_dir);

    // 搜索顺序：
    // 1) src-tauri/ 目录（历史约定）
    // 2) 项目根目录（d:/TrayBuddy/）
    // 3) tools-common/（如果你以后搬到这里）
    let candidates = [
        manifest_dir.join(exe_name),
        manifest_dir.join("..").join(exe_name),
        manifest_dir.join("..").join("tools-common").join(exe_name),
    ];

    for p in &candidates {
        println!("cargo:rerun-if-changed={}", p.display());
    }

    if let Some(crypto_path) = candidates.into_iter().find(|p| p.is_file()) {
        // 找到则启用“内置 sbuddy-crypto”功能
        println!("cargo:rustc-cfg=has_embedded_sbuddy_crypto");
        println!(
            "cargo:rustc-env=SBUDDY_CRYPTO_PATH={}",
            crypto_path.display()
        );
    } else {
        // 没找到也允许正常构建：只是 sbuddy 功能不可用
        // （运行时不会从外部磁盘/PATH 查找，避免“意外可用”或泄露痕迹）
    }



    tauri_build::build();


    // 为测试嵌入 Windows Application Manifest（声明 Common Controls v6 依赖）
    //
    // tauri_build 通过 `cargo:rustc-link-arg-bins` 仅为 bin 目标嵌入包含
    // Common Controls v6 声明的 manifest 资源。lib 单元测试 exe 没有该 manifest，
    // 导致 Windows 加载 comctl32.dll v5.82（不含 TaskDialogIndirect），
    // 进程启动时报 STATUS_ENTRYPOINT_NOT_FOUND (0xC0000139)。
    //
    // 策略：尝试通过 rustc-link-arg-tests 嵌入资源（针对 integration test），
    // 同时将 .manifest 文件写入 deps 目录（External Manifest，作为 lib 单元测试的后备方案）。
    //
    // 仅在 debug profile 下执行（release 构建不会运行测试，无需生成）。
    #[cfg(windows)]
    {
        let profile = std::env::var("PROFILE").unwrap_or_default();
        if profile == "debug" {
            embed_manifest_for_tests();
            deploy_external_manifest_for_lib_tests();
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

/// 将 .manifest 文件写入 deps 目录（External Manifest），
/// 作为 lib 单元测试的后备方案（`rustc-link-arg-tests` 对 `cargo test --lib` 可能不生效）。
#[cfg(windows)]
fn deploy_external_manifest_for_lib_tests() {
    use std::path::Path;

    let manifest_content = r#"<?xml version='1.0' encoding='UTF-8' standalone='yes'?><assembly xmlns='urn:schemas-microsoft-com:asm.v1' manifestVersion='1.0'><dependency><dependentAssembly><assemblyIdentity type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'/></dependentAssembly></dependency></assembly>"#;

    // 获取 target dir: OUT_DIR 通常为 target/debug/build/<pkg>/out
    // 上溯到 target/debug/deps
    let out_dir = std::env::var("OUT_DIR").unwrap_or_default();
    let out = Path::new(&out_dir);

    // target/debug/build/<hash>/out -> target/debug/build/<hash> -> target/debug/build -> target/debug
    if let Some(debug_dir) = out.parent().and_then(|p| p.parent()).and_then(|p| p.parent()) {
        let deps_dir = debug_dir.join("deps");
        if deps_dir.is_dir() {
            // 遍历找到 traybuddy_lib-*.exe
            if let Ok(entries) = std::fs::read_dir(&deps_dir) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if name.starts_with("traybuddy_lib-") && name.ends_with(".exe") && !name.contains(".exe.") {
                        let manifest_path = deps_dir.join(format!("{}.manifest", name));
                        if !manifest_path.exists() {
                            let _ = std::fs::write(&manifest_path, manifest_content);
                        }
                    }
                }
            }
        }
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
        r"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC",
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
