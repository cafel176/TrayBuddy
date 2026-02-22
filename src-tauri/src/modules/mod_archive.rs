//! Mod 包抽象层
//!
//! 将 .tbuddy / .sbuddy 文件的读取操作抽象为 trait，
//! .tbuddy 为普通 ZIP 格式，.sbuddy 为外部工具处理的归档格式。
//!
//! .sbuddy 的处理逻辑由外部独立工具提供；
//! 编译时如检测到外部工具，会通过 `include_bytes!` 嵌入；
//! 运行时自动释放到临时目录使用。若未嵌入，则回退到外部文件查找。
//!
//! # 架构

//!
//! ```text
//! ModArchiveReader (trait)        ← 抽象接口
//!   ├── ZipArchiveReader          ← .tbuddy 实现（纯 ZIP）
//!   └── SbuddyArchiveReader       ← .sbuddy 实现（外部工具处理后的 ZIP）

//!
//! ModArchiveStore                 ← 管理内存中已加载的 archive
//!   └── HashMap<mod_id, Box<dyn ModArchiveReader>>
//! ```

use serde::de::DeserializeOwned;
use std::collections::{HashMap, VecDeque};

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

// ========================================================================= //
// .sbuddy 文件格式常量（仅用于识别文件头，不含密钥）
// ========================================================================= //

/// .sbuddy 文件魔数（8 字节）
pub const SBUDDY_MAGIC: &[u8; 8] = b"SBUDDY01";

// ========================================================================= //
// 抽象接口
// ========================================================================= //

/// Mod 包内的文件条目信息
#[derive(Debug, Clone)]
pub struct ArchiveEntry {
    /// 相对于 mod 根目录的路径（如 "asset/live2d.json"）
    pub path: String,
    /// 是否为目录
    pub is_dir: bool,
}

/// Mod 包读取器抽象接口
///
/// 所有 .tbuddy 文件的读取操作都通过此 trait 进行。
/// 未来更换归档格式时，只需实现新的 Reader 即可。

pub trait ModArchiveReader: Send + Sync {
    /// 读取指定路径的文件内容（路径相对于 mod 根目录）
    ///
    /// 例如：`read_file("manifest.json")` 或 `read_file("asset/live2d/model3.json")`
    fn read_file(&self, relative_path: &str) -> Result<Vec<u8>, String>;

    /// 读取指定路径的文件内容并解析为 UTF-8 字符串
    fn read_file_string(&self, relative_path: &str) -> Result<String, String> {
        let bytes = self.read_file(relative_path)?;
        String::from_utf8(bytes).map_err(|e| format!("UTF-8 decode error: {}", e))
    }

    /// 判断指定路径的文件是否存在
    fn file_exists(&self, relative_path: &str) -> bool;

    /// 列出指定目录下的直接子条目（不递归）
    ///
    /// `dir_path` 为相对于 mod 根目录的路径，如 `"text"` 或 `"audio"`
    fn list_dir(&self, dir_path: &str) -> Vec<ArchiveEntry>;

    /// 获取 mod 根目录名（ZIP 内的顶层文件夹名）
    fn root_folder_name(&self) -> &str;
}

/// `ModArchiveReader` 的扩展方法（非 trait-object 安全的泛型方法放在这里）
pub trait ModArchiveReaderExt: ModArchiveReader {
    /// 读取 JSON 文件并反序列化为指定类型
    fn read_json<T: DeserializeOwned>(&self, relative_path: &str) -> Result<T, String> {
        let content = self.read_file_string(relative_path)?;
        serde_json::from_str(&content)
            .map_err(|e| format!("JSON parse error in '{}': {}", relative_path, e))
    }

    /// 读取 JSON 文件并反序列化，文件不存在时返回 None（不报错）
    fn read_json_optional<T: DeserializeOwned>(&self, relative_path: &str) -> Option<T> {
        self.read_json(relative_path).ok()
    }

    /// 读取 JSON 数组文件，文件不存在时返回空 Vec
    fn read_json_list<T: DeserializeOwned>(&self, relative_path: &str) -> Vec<T> {
        self.read_json::<Vec<T>>(relative_path).unwrap_or_default()
    }
}

// 自动为所有实现了 ModArchiveReader 的类型实现 Ext trait
impl<R: ModArchiveReader + ?Sized> ModArchiveReaderExt for R {}

// ========================================================================= //
// ZIP 实现
// ========================================================================= //

/// 基于 zip crate 的 ModArchiveReader 实现
///
/// 将整个 ZIP 数据保持在内存中（`Vec<u8>`），
/// 每次读取操作重新打开 ZipArchive（zip crate 不支持并发读取同一 archive）。
pub struct ZipArchiveReader {
    /// ZIP 文件的原始字节（内存中）
    data: Vec<u8>,
    /// ZIP 内的根目录名（如 "ema"）
    root_folder: String,
}

impl ZipArchiveReader {
    /// 从 .tbuddy 文件路径加载
    pub fn from_file(path: &Path) -> Result<Self, String> {
        let data =
            std::fs::read(path).map_err(|e| format!("Failed to read '{}': {}", path.display(), e))?;
        Self::from_bytes(data)
    }

    /// 从内存字节加载
    pub fn from_bytes(data: Vec<u8>) -> Result<Self, String> {
        // 验证并提取根目录名
        let root_folder = {
            let cursor = std::io::Cursor::new(&data);
            let mut archive = zip::ZipArchive::new(cursor)
                .map_err(|e| format!("Invalid archive: {}", e))?;
            Self::detect_root_folder(&mut archive)?
        };

        Ok(Self { data, root_folder })
    }

    /// 获取原始 ZIP 数据的引用（用于自定义协议返回文件时内部使用）
    pub fn raw_data(&self) -> &[u8] {
        &self.data
    }

    /// 检测 ZIP 内的唯一根目录
    fn detect_root_folder(
        archive: &mut zip::ZipArchive<std::io::Cursor<&Vec<u8>>>,
    ) -> Result<String, String> {
        use std::path::Component;

        let mut root: Option<String> = None;

        for i in 0..archive.len() {
            let file = archive.by_index(i).map_err(|e| e.to_string())?;
            let Some(enclosed) = file.enclosed_name() else {
                continue;
            };

            let Some(Component::Normal(first)) = enclosed.components().next() else {
                continue;
            };
            // 只关心第一层目录名：必须保持一致，才能认为 archive 结构合法。
;

            let first = first.to_string_lossy().into_owned();
            match root.as_ref() {
                None => root = Some(first),
                Some(existing) if existing == &first => {}
                Some(existing) => {
                    return Err(format!(
                        "Invalid .tbuddy file (multiple root folders: '{}' and '{}')",
                        existing, first
                    ));
                }
            }
        }

        root.ok_or_else(|| "Invalid .tbuddy file (missing root folder)".into())
    }

    /// 创建一个新的 ZipArchive 实例（用于每次读取操作）
    fn open_archive(&self) -> Result<zip::ZipArchive<std::io::Cursor<&Vec<u8>>>, String> {
        let cursor = std::io::Cursor::new(&self.data);
        zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to open archive: {}", e))
    }

    /// 将相对路径转换为 ZIP 内的完整路径（加上根目录前缀）
    fn full_path(&self, relative_path: &str) -> String {
        if relative_path.is_empty() {
            format!("{}/", self.root_folder)
        } else {
            format!("{}/{}", self.root_folder, relative_path)
        }
    }
}

impl ModArchiveReader for ZipArchiveReader {
    fn read_file(&self, relative_path: &str) -> Result<Vec<u8>, String> {
        use std::io::Read;

        let full = self.full_path(relative_path);
        let mut archive = self.open_archive()?;

        // 尝试精确匹配
        if let Ok(mut file) = archive.by_name(&full) {
            let mut buf = Vec::with_capacity(file.size() as usize);
            file.read_to_end(&mut buf)
                .map_err(|e| format!("Read error '{}': {}", relative_path, e))?;
            return Ok(buf);
        }

        // 尝试带尾斜杠的路径（兼容某些 ZIP 工具）
        let alt = if full.ends_with('/') {
            full.trim_end_matches('/').to_string()
        } else {
            format!("{}/", full)
        };
        if let Ok(mut file) = archive.by_name(&alt) {
            let mut buf = Vec::with_capacity(file.size() as usize);
            file.read_to_end(&mut buf)
                .map_err(|e| format!("Read error '{}': {}", relative_path, e))?;
            return Ok(buf);
        }

        // 遍历查找（大小写不敏感兼容）
        let full_lower = full.to_lowercase().replace('\\', "/");
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let Some(enclosed) = file.enclosed_name() else {
                continue;
            };
            let entry_path = enclosed.to_string_lossy().replace('\\', "/").to_lowercase();
            if entry_path == full_lower || entry_path == format!("{}/", full_lower) {
                let mut buf = Vec::with_capacity(file.size() as usize);
                file.read_to_end(&mut buf)
                    .map_err(|e| format!("Read error '{}': {}", relative_path, e))?;
                return Ok(buf);
            }
        }

        Err(format!("File not found in archive: '{}'", relative_path))
    }

    fn file_exists(&self, relative_path: &str) -> bool {
        let full = self.full_path(relative_path);
        if let Ok(mut archive) = self.open_archive() {
            // 快速检查：尝试 by_name
            if archive.index_for_name(&full).is_some() {
                return true;
            }
            // 遍历检查（大小写不敏感）
            let full_lower = full.to_lowercase().replace('\\', "/");
            for i in 0..archive.len() {
                if let Ok(file) = archive.by_index(i) {
                    if let Some(enclosed) = file.enclosed_name() {
                        let entry_path = enclosed.to_string_lossy().replace('\\', "/").to_lowercase();
                        if entry_path == full_lower
                            || entry_path.trim_end_matches('/') == full_lower.trim_end_matches('/')
                        {
                            return true;
                        }
                    }
                }
            }
        }
        false
    }

    fn list_dir(&self, dir_path: &str) -> Vec<ArchiveEntry> {
        // list_dir 仅返回 dir_path 的直接子项（不递归），并做大小写去重。
        let prefix = if dir_path.is_empty() {

            format!("{}/", self.root_folder)
        } else {
            format!("{}/{}/", self.root_folder, dir_path.trim_end_matches('/'))
        };
        let prefix_lower = prefix.to_lowercase().replace('\\', "/");
        let prefix_depth = prefix.matches('/').count();

        let mut seen = std::collections::HashSet::new();
        let mut entries = Vec::new();

        let Ok(mut archive) = self.open_archive() else {
            return entries;
        };

        for i in 0..archive.len() {
            let Ok(file) = archive.by_index(i) else {
                continue;
            };
            let Some(enclosed) = file.enclosed_name() else {
                continue;
            };
            let entry_str = enclosed.to_string_lossy().replace('\\', "/");
            let entry_lower = entry_str.to_lowercase();

            if !entry_lower.starts_with(&prefix_lower) {
                continue;
            }

            // 提取直接子项名称（prefix 之后的第一层）
            let rest = &entry_str[prefix.len()..];
            if rest.is_empty() {
                continue;
            }

            let child_name = if let Some(pos) = rest.find('/') {
                &rest[..pos]
            } else {
                rest
            };

            if child_name.is_empty() || !seen.insert(child_name.to_lowercase()) {
                continue;
            }

            let is_dir = file.is_dir() || rest.contains('/');

            entries.push(ArchiveEntry {
                path: child_name.to_string(),
                is_dir,
            });
        }

        entries
    }

    fn root_folder_name(&self) -> &str {
        &self.root_folder
    }
}

// ========================================================================= //
// 外部工具调用

// ========================================================================= //

/// 编译时嵌入的外部工具可执行文件字节
/// 仅当 build.rs 检测到外部工具时才编译此常量

#[cfg(has_embedded_sbuddy_crypto)]
static EMBEDDED_SBUDDY_CRYPTO: &[u8] = include_bytes!(env!("SBUDDY_CRYPTO_PATH"));

/// 将嵌入的外部工具释放到临时目录

#[cfg(has_embedded_sbuddy_crypto)]
fn extract_embedded_exe() -> Option<PathBuf> {
    let exe_name = if cfg!(windows) {
        "sbuddy-crypto.exe"
    } else {
        "sbuddy-crypto"
    };

    let dir = std::env::temp_dir().join("traybuddy");
    if std::fs::create_dir_all(&dir).is_err() {
        return None;
    }

    let target = dir.join(exe_name);

    // 如果文件已存在且大小一致，直接复用
    if target.is_file() {
        if let Ok(meta) = std::fs::metadata(&target) {
            if meta.len() == EMBEDDED_SBUDDY_CRYPTO.len() as u64 {
                return Some(target);
            }
        }
    }

    if std::fs::write(&target, EMBEDDED_SBUDDY_CRYPTO).is_err() {
        return None;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755));
    }

    Some(target)
}

/// 查找外部工具可执行文件路径

///
/// 搜索顺序：
/// 1. 嵌入式释放（编译时嵌入）
/// 2. 当前可执行文件所在目录
/// 3. 当前工作目录
/// 4. PATH 环境变量
fn find_sbuddy_crypto() -> Option<PathBuf> {
    #[cfg(has_embedded_sbuddy_crypto)]
    {
        if let Some(path) = extract_embedded_exe() {
            return Some(path);
        }
    }

    let exe_name = if cfg!(windows) {
        "sbuddy-crypto.exe"
    } else {
        "sbuddy-crypto"
    };

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(dir) = current_exe.parent() {
            let candidate = dir.join(exe_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        let candidate = cwd.join(exe_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    if let Ok(output) = std::process::Command::new(exe_name)
        .arg("check")
        .output()
    {
        if output.status.success() {
            return Some(PathBuf::from(exe_name));
        }
    }

    None
}

/// 检查外部工具是否可用

pub fn is_sbuddy_supported() -> bool {
    let found = find_sbuddy_crypto();
    // 检查完毕后删除找到的 exe（不保留在磁盘上）
    if let Some(ref path) = found {
        let _ = std::fs::remove_file(path);
    }
    found.is_some()
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

    let exe_path = find_sbuddy_crypto()
        .ok_or_else(|| "sbuddy tool not found (sbuddy not supported)".to_string())?;


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

    // 用完后立刻删除 exe
    let _ = std::fs::remove_file(&exe_path);

    result
}

/// 使用外部工具处理 .sbuddy 文件内容
///
/// 通过 stdin 传入数据，从 stdout 读取处理后的 ZIP 数据

pub fn decrypt_sbuddy(data: &[u8]) -> Result<Vec<u8>, String> {
    // 快速验证魔数
    if data.len() < 8 || &data[..8] != SBUDDY_MAGIC {
        return Err("Invalid .sbuddy file (bad magic)".into());
    }

    run_sbuddy_crypto("decrypt", data)
}

/// 使用外部工具将 ZIP 数据处理为 .sbuddy 格式

pub fn encrypt_sbuddy(zip_data: &[u8]) -> Result<Vec<u8>, String> {
    run_sbuddy_crypto("encrypt", zip_data)
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

    pub fn from_bytes(encrypted_data: Vec<u8>) -> Result<Self, String> {
        let zip_data = decrypt_sbuddy(&encrypted_data)?;
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

// ========================================================================= //
// Archive 存储管理
// ========================================================================= //

/// 已加载的 archive 来源标识
#[derive(Debug, Clone)]
pub struct ArchiveSource {
    /// .tbuddy 文件路径
    pub file_path: PathBuf,
    /// Mod ID (manifest.id)
    pub mod_id: String,
}

/// Mod Archive 内存存储
///
/// 管理所有已加载到内存中的 .tbuddy archive 实例。
/// 线程安全，可从多处并发访问。
pub struct ModArchiveStore {
    /// mod_id -> archive reader
    archives: HashMap<String, Arc<Box<dyn ModArchiveReader>>>,
    /// mod_id -> 来源信息
    sources: HashMap<String, ArchiveSource>,
    /// LRU 顺序（最近使用的放在队尾）
    access_order: VecDeque<String>,
}


impl ModArchiveStore {
    /// 内存中最多保留的 archive 数量（避免长期驻留过多 ZIP 数据）
    const ARCHIVE_CACHE_MAX: usize = 4;

    /// 创建新的 archive 存储并初始化缓存结构。
    pub fn new() -> Self {

        Self {
            archives: HashMap::new(),
            sources: HashMap::new(),
            access_order: VecDeque::new(),
        }
    }


    /// 加载 .tbuddy 文件到内存并注册
    ///
    /// 返回 (mod_id, manifest) 用于后续索引
    pub fn load_tbuddy(
        &mut self,
        file_path: &Path,
    ) -> Result<(String, super::resource::ModManifest), String> {
        let reader = ZipArchiveReader::from_file(file_path)?;
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


    /// 获取指定 mod 的 archive reader
    pub fn get(&mut self, mod_id: &str) -> Option<Arc<Box<dyn ModArchiveReader>>> {
        if self.ensure_loaded(mod_id).is_err() {
            return None;
        }
        self.archives.get(mod_id).cloned()
    }


    /// 判断指定 mod 是否已加载
    pub fn contains(&mut self, mod_id: &str) -> bool {
        self.ensure_loaded(mod_id).is_ok()
    }


    /// 移除指定 mod 的 archive
    pub fn remove(&mut self, mod_id: &str) {
        self.archives.remove(mod_id);
        self.sources.remove(mod_id);
    }

    /// 清空所有已加载的 archive
    pub fn clear(&mut self) {
        self.archives.clear();
        self.sources.clear();
        self.access_order.clear();
    }


    /// 获取指定 mod 的来源信息（包含 .tbuddy 文件的实际磁盘路径）
    pub fn get_source(&self, mod_id: &str) -> Option<&ArchiveSource> {
        self.sources.get(mod_id)
    }

    /// 列出所有已加载的 mod ID
    pub fn loaded_ids(&self) -> Vec<String> {
        self.archives.keys().cloned().collect()
    }

    /// 从 archive 读取指定 mod 的指定文件（用于自定义协议）
    pub fn read_file(&mut self, mod_id: &str, relative_path: &str) -> Result<Vec<u8>, String> {
        self.ensure_loaded(mod_id)?;
        let reader = self
            .archives
            .get(mod_id)
            .ok_or_else(|| format!("Archive not loaded: '{}'", mod_id))?;
        reader.read_file(relative_path)
    }


    /// 检查指定 mod 的文件是否存在
    pub fn file_exists(&mut self, mod_id: &str, relative_path: &str) -> bool {
        if self.ensure_loaded(mod_id).is_err() {
            return false;
        }
        self.archives
            .get(mod_id)
            .map(|r| r.file_exists(relative_path))
            .unwrap_or(false)
    }

    /// 插入新 archive 并刷新 LRU 顺序。
    fn insert_archive(&mut self, mod_id: String, reader: Box<dyn ModArchiveReader>) {

        self.archives.insert(mod_id.clone(), Arc::new(reader));
        self.touch(&mod_id);
        self.enforce_limit();
    }

    /// 标记某个 mod 为“最近使用”，用于 LRU 淘汰策略
    fn touch(&mut self, mod_id: &str) {
        if let Some(pos) = self.access_order.iter().position(|id| id == mod_id) {
            self.access_order.remove(pos);
        }
        self.access_order.push_back(mod_id.to_string());
    }

    /// 按 LRU 策略移除最久未使用的 archive
    fn enforce_limit(&mut self) {
        while self.archives.len() > Self::ARCHIVE_CACHE_MAX {
            if let Some(oldest) = self.access_order.pop_front() {
                self.archives.remove(&oldest);
            } else {
                break;
            }
        }
    }

    /// 根据文件扩展名创建对应 reader（tbuddy / sbuddy）
    fn load_reader_from_path(path: &Path) -> Result<Box<dyn ModArchiveReader>, String> {

        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();
        match ext.as_str() {
            "tbuddy" => Ok(Box::new(ZipArchiveReader::from_file(path)?)),
            "sbuddy" => Ok(Box::new(SbuddyArchiveReader::from_file(path)?)),
            _ => Err(format!("Unsupported archive type: {}", path.display())),
        }
    }

    /// 确保指定 mod 已加载到内存。
    ///
    /// - 已加载则刷新 LRU 顺序
    /// - 未加载则从来源路径重新读取（便于按需恢复被淘汰的缓存）
    fn ensure_loaded(&mut self, mod_id: &str) -> Result<(), String> {
        if self.archives.contains_key(mod_id) {
            self.touch(mod_id);
            return Ok(());
        }

        let Some(source) = self.sources.get(mod_id) else {
            return Err(format!("Archive source not found: '{}'", mod_id));
        };

        let reader = Self::load_reader_from_path(&source.file_path)?;
        self.insert_archive(mod_id.to_string(), reader);
        Ok(())
    }

}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::FileOptions;

    fn build_zip(entries: Vec<(&str, &str)>) -> Vec<u8> {
        let cursor = std::io::Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(cursor);
        let options = FileOptions::<()>::default();


        for (path, content) in entries {
            if path.ends_with('/') {
                zip.add_directory(path, options).unwrap();
            } else {
                zip.start_file(path, options).unwrap();
                zip.write_all(content.as_bytes()).unwrap();
            }
        }

        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn zip_reader_detects_root_and_reads_file() {
        let data = build_zip(vec![
            ("root/", ""),
            ("root/dir/", ""),
            ("root/dir/file.txt", "hello"),
            ("root/file.txt", "world"),
        ]);

        let reader = ZipArchiveReader::from_bytes(data).unwrap();
        assert_eq!(reader.root_folder_name(), "root");
        assert!(reader.file_exists("dir/file.txt"));
        assert!(reader.file_exists("file.txt"));

        let content = reader.read_file("dir/file.txt").unwrap();
        assert_eq!(String::from_utf8_lossy(&content), "hello");

        let root_entries = reader.list_dir("");
        let names: Vec<String> = root_entries.iter().map(|e| e.path.clone()).collect();
        assert!(names.contains(&"dir".to_string()));
        assert!(names.contains(&"file.txt".to_string()));
    }

    #[test]
    fn zip_reader_rejects_multiple_roots() {
        let data = build_zip(vec![("a/file.txt", "a"), ("b/file.txt", "b")]);
        match ZipArchiveReader::from_bytes(data) {
            Ok(_) => panic!("Expected error for multiple root folders"),
            Err(err) => assert!(err.contains("multiple root folders")),
        }
    }
}



