fn main() {
    // 检查 sbuddy-crypto 可执行文件是否存在于 src-tauri 目录
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

    tauri_build::build()
}
