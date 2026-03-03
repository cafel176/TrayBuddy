// mod_archive 运行时函数（依赖外部 sbuddy 工具 / 文件系统 I/O，无法单元测试）
// 通过 include!() 包含在 mod_archive.rs 中
//
// 包含：
// - extract_embedded_exe_to_temp - 释放嵌入 exe 到临时目录
// - sbuddy_command - 创建外部工具子进程
// - run_sbuddy_crypto - 执行外部工具
// - SbuddyArchiveReader - .sbuddy 文件的 reader 实现
// - ModArchiveStore::load_sbuddy - 加载 .sbuddy 到内存

/// 将内置的 `sbuddy-crypto` 临时解包到系统临时目录。
///
/// - **仅在需要运行时解包**
/// - **每次生成唯一文件名**，避免复用导致"留痕"
/// - 调用方负责在使用后立刻删除文件
fn extract_embedded_exe_to_temp() -> Result<(PathBuf, PathBuf), String> {
    use std::time::{SystemTime, UNIX_EPOCH};

    if EMBEDDED_SBUDDY_CRYPTO.is_empty() {
        return Err("sbuddy tool not embedded (sbuddy not supported)".to_string());
    }


    let dir = std::env::temp_dir().join("traybuddy").join("sbuddy_crypto");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create temp dir '{}': {}", dir.display(), e))?;

    let pid = std::process::id();
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);

    let file_name = if cfg!(windows) {
        format!("sbuddy-crypto-{}-{}.exe", pid, stamp)
    } else {
        format!("sbuddy-crypto-{}-{}", pid, stamp)
    };

    let exe_path = dir.join(file_name);

    std::fs::write(&exe_path, EMBEDDED_SBUDDY_CRYPTO)
        .map_err(|e| format!("Failed to write temp exe '{}': {}", exe_path.display(), e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&exe_path, std::fs::Permissions::from_mode(0o755));
    }

    Ok((exe_path, dir))
}

/// 创建子进程 Command，在 Windows 上隐藏控制台窗口
fn sbuddy_command(exe: &Path, arg: &str) -> std::process::Command {
    use std::process::{Command, Stdio};

    let mut cmd = Command::new(exe);
    cmd.arg(arg)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    cmd
}

/// 执行外部工具子进程，用完后立刻删除 exe
///
/// - exe 可能来自嵌入式释放的临时文件
/// - 每次运行后都会清理，避免长期驻留磁盘
///
/// `arg`: 子命令
/// `input`: 通过 stdin 传入的数据
fn run_sbuddy_crypto(arg: &str, input: &[u8]) -> Result<Vec<u8>, String> {
    use std::io::Write;

    // 仅在需要时解包，用完立刻删除，不从外部查找。
    let (exe_path, exe_dir) = extract_embedded_exe_to_temp()?;

    let result = (|| {
        let mut child = sbuddy_command(&exe_path, arg)
            .spawn()
            .map_err(|e| format!("Failed to start sbuddy tool: {}", e))?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(input)
                .map_err(|e| format!("Failed to write to sbuddy tool stdin: {}", e))?;
        }

        let output = child
            .wait_with_output()
            .map_err(|e| format!("Failed to wait for sbuddy tool: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("sbuddy tool {} failed: {}", arg, stderr.trim()));
        }

        Ok(output.stdout)
    })();

    // 用完后立刻删除 exe（Windows: 需等待子进程结束后才能删除）
    let _ = std::fs::remove_file(&exe_path);
    // 尝试清理目录（仅在为空时成功），避免长期留痕
    let _ = std::fs::remove_dir(&exe_dir);

    result
}

// ========================================================================= //
// .sbuddy Reader（外部工具处理后复用 ZipArchiveReader）
// ========================================================================= //

/// 基于外部工具处理的 ModArchiveReader 实现
///
/// .sbuddy 文件 = 受工具处理的 ZIP 数据
/// 通过外部工具处理后委托给 ZipArchiveReader 处理。
pub struct SbuddyArchiveReader {
    inner: ZipArchiveReader,
}

impl SbuddyArchiveReader {
    /// 从 .sbuddy 文件路径加载（处理 + 解析 ZIP）
    pub fn from_file(path: &Path) -> Result<Self, String> {
        let data = std::fs::read(path)
            .map_err(|e| format!("Failed to read '{}': {}", path.display(), e))?;
        Self::from_bytes(data)
    }

    /// 从内存字节加载（处理 + 解析 ZIP）
    ///
    /// 解密完成后立即释放加密数据，避免加密 + 解密两份数据同时驻留内存。
    pub fn from_bytes(encrypted_data: Vec<u8>) -> Result<Self, String> {
        let zip_data = decrypt_sbuddy(&encrypted_data)?;
        drop(encrypted_data); // 显式释放加密数据，减少峰值内存占用
        let inner = ZipArchiveReader::from_bytes(zip_data)?;
        Ok(Self { inner })
    }
}

impl ModArchiveReader for SbuddyArchiveReader {
    fn read_file(&self, relative_path: &str) -> Result<Vec<u8>, String> {
        self.inner.read_file(relative_path)
    }

    fn file_exists(&self, relative_path: &str) -> bool {
        self.inner.file_exists(relative_path)
    }

    fn list_dir(&self, dir_path: &str) -> Vec<ArchiveEntry> {
        self.inner.list_dir(dir_path)
    }

    fn root_folder_name(&self) -> &str {
        self.inner.root_folder_name()
    }
}

impl ModArchiveStore {
    /// 加载 .sbuddy 文件到内存并注册（通过外部工具处理后按 ZIP 处理）
    ///
    /// 返回 (mod_id, manifest) 用于后续索引
    pub fn load_sbuddy(
        &mut self,
        file_path: &Path,
    ) -> Result<(String, super::resource::ModManifest), String> {
        let reader = SbuddyArchiveReader::from_file(file_path)?;
        let manifest: super::resource::ModManifest = reader.read_json("manifest.json")?;
        let mod_id = manifest.id.to_string();

        let source = ArchiveSource {
            file_path: file_path.to_path_buf(),
            mod_id: mod_id.clone(),
        };

        self.insert_archive(mod_id.clone(), Box::new(reader));
        self.sources.insert(mod_id.clone(), source);

        Ok((mod_id, manifest))
    }
}
