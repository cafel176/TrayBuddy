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
///
/// 说明：本项目不再从磁盘/PATH 查找 `sbuddy-crypto`，仅使用"内置并按需解包"的方式。
/// 若构建时没有找到 `sbuddy-crypto`，则该功能会被禁用（仍可正常构建/运行）。
#[cfg(has_embedded_sbuddy_crypto)]
static EMBEDDED_SBUDDY_CRYPTO: &[u8] = include_bytes!(env!("SBUDDY_CRYPTO_PATH"));

#[cfg(not(has_embedded_sbuddy_crypto))]
static EMBEDDED_SBUDDY_CRYPTO: &[u8] = &[];

/// 检查 sbuddy 功能是否可用
///
/// 若构建期未嵌入 `sbuddy-crypto`，则该功能不可用。
pub fn is_sbuddy_supported() -> bool {
    !EMBEDDED_SBUDDY_CRYPTO.is_empty()
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

// 运行时函数（依赖外部 sbuddy 工具，不可单元测试）拆分到独立文件以便排除覆盖率统计
include!("mod_archive_runtime.rs");

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


    /// 将已加载/已注册的 old_id "别名"到 new_id。
    ///
    /// 场景：扫描阶段 `.sbuddy` 可能只能用文件名推断 id（old_id），
    /// 真正解密读取 manifest 后拿到真实 `manifest.id`（new_id）。
    /// 这里确保：
    /// - `get_source(new_id)` 可用（用于打开源文件）
    /// - `tbuddy-asset://{new_id}/...` 可读（协议读取时以 new_id 为 key）
    pub fn alias_mod_id(&mut self, old_id: &str, new_id: &str) {
        if old_id.is_empty() || new_id.is_empty() || old_id == new_id {
            return;
        }

        // 1) sources：保证 new_id 能拿到来源路径
        if !self.sources.contains_key(new_id) {
            if let Some(src) = self.sources.get(old_id).cloned() {
                self.sources.insert(
                    new_id.to_string(),
                    ArchiveSource {
                        file_path: src.file_path,
                        mod_id: new_id.to_string(),
                    },
                );
            }
        }

        // 2) archives：若 old_id 已加载，迁移到 new_id，避免缓存条目翻倍
        if self.archives.contains_key(old_id) && !self.archives.contains_key(new_id) {
            if let Some(reader) = self.archives.remove(old_id) {
                self.archives.insert(new_id.to_string(), reader);

                // 更新 LRU 队列：把 old_id 替换成 new_id
                let mut new_order = VecDeque::new();
                for id in self.access_order.drain(..) {
                    if id == old_id {
                        // 去重：若队列中已有 new_id，就跳过替换
                        if !new_order.iter().any(|x| x == new_id) {
                            new_order.push_back(new_id.to_string());
                        }
                    } else {
                        // 去重
                        if !new_order.iter().any(|x| x == &id) {
                            new_order.push_back(id);
                        }
                    }
                }
                self.access_order = new_order;
            }
        }
    }


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


    /// 移除指定 mod 的 archive（同时移除来源映射）。
    pub fn remove(&mut self, mod_id: &str) {
        self.archives.remove(mod_id);
        self.sources.remove(mod_id);
        if let Some(pos) = self.access_order.iter().position(|id| id == mod_id) {
            self.access_order.remove(pos);
        }
    }

    /// 仅从内存中卸载（淘汰）已加载的 archive 数据，但**保留来源映射**。
    ///
    /// 用途：切换 Mod / 低内存模式下，主动释放旧 Mod 的内存占用；
    /// 当该 mod 的资源再次被访问时，会通过 `ensure_loaded()` 重新从磁盘加载。
    pub fn evict_loaded(&mut self, mod_id: &str) {
        self.archives.remove(mod_id);
        if let Some(pos) = self.access_order.iter().position(|id| id == mod_id) {
            self.access_order.remove(pos);
        }
    }

    /// 清空所有已加载的 archive
    pub fn clear(&mut self) {
        self.archives.clear();
        self.sources.clear();
        self.access_order.clear();
    }


    /// 注册某个 archive 的来源信息（不加载到内存）。
    ///
    /// 用途：在扫描磁盘索引阶段先建立 `mod_id -> 文件路径` 映射，
    /// 之后由 `ensure_loaded()` 在真正需要读取资源时再按需加载。
    pub fn register_source(&mut self, mod_id: String, file_path: PathBuf) {
        self.sources.insert(
            mod_id.clone(),
            ArchiveSource {
                file_path,
                mod_id,
            },
        );
    }

    /// 获取指定 mod 的来源信息（包含 .tbuddy/.sbuddy 文件的实际磁盘路径）
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

    /// 标记某个 mod 为"最近使用"，用于 LRU 淘汰策略
    fn touch(&mut self, mod_id: &str) {
        if let Some(pos) = self.access_order.iter().position(|id| id == mod_id) {
            self.access_order.remove(pos);
        }
        self.access_order.push_back(mod_id.to_string());
    }

    /// 按 LRU 策略移除最久未使用的 archive
    ///
    /// 注意：仅移除内存中的 archive 数据，保留 sources 映射以支持 `ensure_loaded()` 按需恢复。
    /// 过期的 sources 条目由 `cleanup_stale_sources()` 清理。
    fn enforce_limit(&mut self) {
        while self.archives.len() > crate::modules::constants::MOD_ARCHIVE_CACHE_MAX {

            if let Some(oldest) = self.access_order.pop_front() {
                self.archives.remove(&oldest);
            } else {
                break;
            }
        }
    }

    /// 清理过期的 sources 条目（磁盘上已不存在的 archive 文件）。
    ///
    /// 用途：在 Mod 索引重建后调用，移除那些磁盘文件已删除/不再可达的 sources 映射，
    /// 避免 sources HashMap 随着用户反复导入/删除 Mod 而无限增长。
    pub fn cleanup_stale_sources(&mut self) {
        let stale_ids: Vec<String> = self
            .sources
            .iter()
            .filter(|(_, src)| !src.file_path.exists())
            .map(|(id, _)| id.clone())
            .collect();

        for id in &stale_ids {
            self.sources.remove(id);
            // 如果内存中也有对应 archive，一并清除
            self.archives.remove(id);
            if let Some(pos) = self.access_order.iter().position(|x| x == id) {
                self.access_order.remove(pos);
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

    // ========================================================================= //
    // ZipArchiveReader basics
    // ========================================================================= //

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

    #[test]
    fn zip_reader_read_file_string() {
        let data = build_zip(vec![("mod1/", ""), ("mod1/hello.txt", "world")]);
        let reader = ZipArchiveReader::from_bytes(data).unwrap();
        let s = reader.read_file_string("hello.txt").unwrap();
        assert_eq!(s, "world");
    }

    #[test]
    fn zip_reader_read_json_ext() {
        let data = build_zip(vec![
            ("mymod/", ""),
            ("mymod/data.json", r#"{"key":"value"}"#),
        ]);
        let reader = ZipArchiveReader::from_bytes(data).unwrap();
        let val: serde_json::Value = reader.read_json("data.json").unwrap();
        assert_eq!(val["key"], "value");
    }

    #[test]
    fn zip_reader_read_json_optional_missing() {
        let data = build_zip(vec![("mymod/", ""), ("mymod/a.txt", "x")]);
        let reader = ZipArchiveReader::from_bytes(data).unwrap();
        let result: Option<serde_json::Value> = reader.read_json_optional("missing.json");
        assert!(result.is_none());
    }

    #[test]
    fn zip_reader_read_json_list_missing_returns_empty() {
        let data = build_zip(vec![("mymod/", ""), ("mymod/a.txt", "x")]);
        let reader = ZipArchiveReader::from_bytes(data).unwrap();
        let result: Vec<String> = reader.read_json_list("missing.json");
        assert!(result.is_empty());
    }

    #[test]
    fn zip_reader_read_json_list_success() {
        let data = build_zip(vec![
            ("mymod/", ""),
            ("mymod/list.json", r#"["a","b","c"]"#),
        ]);
        let reader = ZipArchiveReader::from_bytes(data).unwrap();
        let result: Vec<String> = reader.read_json_list("list.json");
        assert_eq!(result, vec!["a", "b", "c"]);
    }

    #[test]
    fn zip_reader_file_not_found() {
        let data = build_zip(vec![("root/", ""), ("root/a.txt", "x")]);
        let reader = ZipArchiveReader::from_bytes(data).unwrap();
        let err = reader.read_file("nonexistent.txt").unwrap_err();
        assert!(err.contains("File not found"));
    }

    #[test]
    fn zip_reader_file_exists_false_for_missing() {
        let data = build_zip(vec![("root/", ""), ("root/a.txt", "x")]);
        let reader = ZipArchiveReader::from_bytes(data).unwrap();
        assert!(!reader.file_exists("missing.txt"));
    }

    #[test]
    fn zip_reader_invalid_data() {
        let result = ZipArchiveReader::from_bytes(vec![1, 2, 3]);
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(err.contains("Invalid archive"));
    }

    #[test]
    fn zip_reader_empty_zip_no_root() {
        // An empty zip (no entries)
        let cursor = std::io::Cursor::new(Vec::new());
        let zip = zip::ZipWriter::new(cursor);
        let data = zip.finish().unwrap().into_inner();
        let result = ZipArchiveReader::from_bytes(data);
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(err.contains("missing root folder"));
    }

    #[test]
    fn zip_reader_raw_data() {
        let data = build_zip(vec![("root/", ""), ("root/x.txt", "y")]);
        let reader = ZipArchiveReader::from_bytes(data.clone()).unwrap();
        assert_eq!(reader.raw_data(), &data);
    }

    #[test]
    fn zip_reader_list_dir_subdirectory() {
        let data = build_zip(vec![
            ("mod/", ""),
            ("mod/asset/", ""),
            ("mod/asset/a.png", "img"),
            ("mod/asset/b.wav", "snd"),
            ("mod/asset/sub/", ""),
            ("mod/asset/sub/c.txt", "c"),
        ]);
        let reader = ZipArchiveReader::from_bytes(data).unwrap();
        let entries = reader.list_dir("asset");
        let names: Vec<String> = entries.iter().map(|e| e.path.clone()).collect();
        assert!(names.contains(&"a.png".to_string()));
        assert!(names.contains(&"b.wav".to_string()));
        assert!(names.contains(&"sub".to_string()));
        // sub should be detected as dir
        let sub_entry = entries.iter().find(|e| e.path == "sub").unwrap();
        assert!(sub_entry.is_dir);
    }

    // ========================================================================= //
    // ModArchiveStore
    // ========================================================================= //

    #[test]
    fn store_new_is_empty() {
        let store = ModArchiveStore::new();
        assert!(store.loaded_ids().is_empty());
        assert!(store.get_source("any").is_none());
    }

    #[test]
    fn store_register_source_and_get_source() {
        let mut store = ModArchiveStore::new();
        let path = PathBuf::from("/tmp/test.tbuddy");
        store.register_source("test".into(), path.clone());
        let src = store.get_source("test").unwrap();
        assert_eq!(src.mod_id, "test");
        assert_eq!(src.file_path, path);
    }

    #[test]
    fn store_register_source_missing_returns_none() {
        let store = ModArchiveStore::new();
        assert!(store.get_source("nope").is_none());
    }

    #[test]
    fn store_remove_clears_all_mappings() {
        let mut store = ModArchiveStore::new();
        store.register_source("test".into(), PathBuf::from("/tmp/t.tbuddy"));
        store.remove("test");
        assert!(store.get_source("test").is_none());
    }

    #[test]
    fn store_evict_loaded_keeps_source() {
        let mut store = ModArchiveStore::new();
        store.register_source("mod1".into(), PathBuf::from("/tmp/m.tbuddy"));
        // evict removes archive but keeps source
        store.evict_loaded("mod1");
        assert!(store.get_source("mod1").is_some());
        assert!(store.loaded_ids().is_empty());
    }

    #[test]
    fn store_clear() {
        let mut store = ModArchiveStore::new();
        store.register_source("a".into(), PathBuf::from("/a"));
        store.register_source("b".into(), PathBuf::from("/b"));
        store.clear();
        assert!(store.get_source("a").is_none());
        assert!(store.get_source("b").is_none());
        assert!(store.loaded_ids().is_empty());
    }

    // ========================================================================= //
    // alias_mod_id
    // ========================================================================= //

    #[test]
    fn alias_mod_id_same_id_noop() {
        let mut store = ModArchiveStore::new();
        store.register_source("x".into(), PathBuf::from("/x"));
        store.alias_mod_id("x", "x");
        // Should still have source for "x"
        assert!(store.get_source("x").is_some());
    }

    #[test]
    fn alias_mod_id_empty_noop() {
        let mut store = ModArchiveStore::new();
        store.alias_mod_id("", "new");
        store.alias_mod_id("old", "");
    }

    #[test]
    fn alias_mod_id_copies_source() {
        let mut store = ModArchiveStore::new();
        store.register_source("old_id".into(), PathBuf::from("/old.tbuddy"));
        store.alias_mod_id("old_id", "new_id");
        let src = store.get_source("new_id").unwrap();
        assert_eq!(src.mod_id, "new_id");
        assert_eq!(src.file_path, PathBuf::from("/old.tbuddy"));
    }

    #[test]
    fn alias_mod_id_does_not_overwrite_existing_source() {
        let mut store = ModArchiveStore::new();
        store.register_source("old".into(), PathBuf::from("/old"));
        store.register_source("new".into(), PathBuf::from("/new"));
        store.alias_mod_id("old", "new");
        // "new" should still point to /new, not /old
        let src = store.get_source("new").unwrap();
        assert_eq!(src.file_path, PathBuf::from("/new"));
    }

    // ========================================================================= //
    // cleanup_stale_sources
    // ========================================================================= //

    #[test]
    fn cleanup_stale_sources_removes_nonexistent_paths() {
        let mut store = ModArchiveStore::new();
        store.register_source("stale".into(), PathBuf::from("/nonexistent/path/to/mod.tbuddy"));
        store.cleanup_stale_sources();
        assert!(store.get_source("stale").is_none());
    }

    #[test]
    fn cleanup_stale_sources_keeps_existing_paths() {
        let mut store = ModArchiveStore::new();
        // temp_dir should exist
        let existing = std::env::temp_dir();
        store.register_source("good".into(), existing);
        store.cleanup_stale_sources();
        assert!(store.get_source("good").is_some());
    }

    // ========================================================================= //
    // is_sbuddy_supported / decrypt_sbuddy
    // ========================================================================= //

    #[test]
    fn is_sbuddy_supported_returns_value() {
        // Just verify it doesn't panic
        let _ = is_sbuddy_supported();
    }

    #[test]
    fn decrypt_sbuddy_bad_magic() {
        let err = decrypt_sbuddy(b"NOTVALID").unwrap_err();
        assert!(err.contains("bad magic") || err.contains("sbuddy"));
    }

    #[test]
    fn decrypt_sbuddy_too_short() {
        let err = decrypt_sbuddy(b"SHORT").unwrap_err();
        assert!(err.contains("bad magic") || err.contains("sbuddy"));
    }

    #[test]
    fn sbuddy_magic_is_8_bytes() {
        assert_eq!(SBUDDY_MAGIC.len(), 8);
        assert_eq!(SBUDDY_MAGIC, b"SBUDDY01");
    }

    // ========================================================================= //
    // ModArchiveStore: load_tbuddy with real zip
    // ========================================================================= //

    /// Create a .tbuddy zip with a root folder structure (required by ZipArchiveReader).
    /// The root folder name is extracted from the "id" field in manifest_json.
    fn create_tbuddy_zip(manifest_json: &str) -> PathBuf {
        use std::io::Write;
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let tbuddy_path = std::env::temp_dir().join(format!(
            "test_{}_{}.tbuddy",
            std::process::id(),
            n
        ));
        // Extract id from manifest for the root folder name
        let parsed: serde_json::Value = serde_json::from_str(manifest_json).unwrap();
        let root_name = parsed["id"].as_str().unwrap_or("mod");
        {
            let file = std::fs::File::create(&tbuddy_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::FileOptions::<()>::default();
            // Add root folder entry
            zip.add_directory(format!("{}/", root_name), options.clone()).unwrap();
            // Write manifest.json under root folder
            zip.start_file(format!("{}/manifest.json", root_name), options).unwrap();
            zip.write_all(manifest_json.as_bytes()).unwrap();
            zip.finish().unwrap();
        }
        tbuddy_path
    }

    #[test]
    fn load_tbuddy_reads_manifest() {
        let manifest_json = r#"{"id":"zipmod","version":"1.0.0"}"#;
        let path = create_tbuddy_zip(manifest_json);

        let mut store = ModArchiveStore::new();
        let (id, manifest) = store.load_tbuddy(&path).unwrap();
        assert_eq!(id, "zipmod");
        assert_eq!(manifest.id.as_ref(), "zipmod");
        assert_eq!(manifest.version.as_ref(), "1.0.0");

        // Cleanup
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn load_tbuddy_registers_source() {
        let manifest_json = r#"{"id":"srcmod","version":"0.1"}"#;
        let path = create_tbuddy_zip(manifest_json);

        let mut store = ModArchiveStore::new();
        store.load_tbuddy(&path).unwrap();
        assert!(store.get_source("srcmod").is_some());
        assert_eq!(store.get_source("srcmod").unwrap().mod_id, "srcmod");

        let _ = std::fs::remove_file(&path);
    }

    // ========================================================================= //
    // ModArchiveStore: loaded_ids
    // ========================================================================= //

    #[test]
    fn loaded_ids_empty_for_new_store() {
        let store = ModArchiveStore::new();
        assert!(store.loaded_ids().is_empty());
    }

    #[test]
    fn loaded_ids_contains_loaded_mods() {
        let manifest_json = r#"{"id":"loadedmod"}"#;
        let path = create_tbuddy_zip(manifest_json);

        let mut store = ModArchiveStore::new();
        store.load_tbuddy(&path).unwrap();
        let ids = store.loaded_ids();
        assert!(ids.contains(&"loadedmod".to_string()));

        let _ = std::fs::remove_file(&path);
    }

    // ========================================================================= //
    // ModArchiveStore: get / ensure_loaded / read_file / file_exists
    // ========================================================================= //

    #[test]
    fn get_returns_reader_for_loaded_mod() {
        let manifest_json = r#"{"id":"getmod"}"#;
        let path = create_tbuddy_zip(manifest_json);

        let mut store = ModArchiveStore::new();
        store.load_tbuddy(&path).unwrap();
        let reader = store.get("getmod");
        assert!(reader.is_some());

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn get_returns_none_for_unknown_mod() {
        let mut store = ModArchiveStore::new();
        assert!(store.get("nonexistent").is_none());
    }

    #[test]
    fn contains_returns_true_for_loaded() {
        let manifest_json = r#"{"id":"containsmod"}"#;
        let path = create_tbuddy_zip(manifest_json);

        let mut store = ModArchiveStore::new();
        store.load_tbuddy(&path).unwrap();
        assert!(store.contains("containsmod"));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn read_file_from_archive() {
        let manifest_json = r#"{"id":"readmod"}"#;
        let path = create_tbuddy_zip(manifest_json);

        let mut store = ModArchiveStore::new();
        store.load_tbuddy(&path).unwrap();
        let data = store.read_file("readmod", "manifest.json");
        assert!(data.is_ok());
        let content = String::from_utf8(data.unwrap()).unwrap();
        assert!(content.contains("readmod"));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn read_file_not_found_in_archive() {
        let manifest_json = r#"{"id":"rfmod"}"#;
        let path = create_tbuddy_zip(manifest_json);

        let mut store = ModArchiveStore::new();
        store.load_tbuddy(&path).unwrap();
        let err = store.read_file("rfmod", "nonexistent.txt");
        assert!(err.is_err());

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn file_exists_in_archive() {
        let manifest_json = r#"{"id":"femod"}"#;
        let path = create_tbuddy_zip(manifest_json);

        let mut store = ModArchiveStore::new();
        store.load_tbuddy(&path).unwrap();
        assert!(store.file_exists("femod", "manifest.json"));
        assert!(!store.file_exists("femod", "nope.txt"));

        let _ = std::fs::remove_file(&path);
    }

    // ========================================================================= //
    // ModArchiveStore: evict_loaded + ensure_loaded re-loads from source
    // ========================================================================= //

    #[test]
    fn evict_and_reload_from_source() {
        let manifest_json = r#"{"id":"evictmod"}"#;
        let path = create_tbuddy_zip(manifest_json);

        let mut store = ModArchiveStore::new();
        store.load_tbuddy(&path).unwrap();
        assert!(store.contains("evictmod"));

        // Evict from memory
        store.evict_loaded("evictmod");
        assert!(!store.loaded_ids().contains(&"evictmod".to_string()));

        // Source should still be registered
        assert!(store.get_source("evictmod").is_some());

        // Re-load via get → ensure_loaded
        let reader = store.get("evictmod");
        assert!(reader.is_some());
        assert!(store.loaded_ids().contains(&"evictmod".to_string()));

        let _ = std::fs::remove_file(&path);
    }

    // ========================================================================= //
    // ModArchiveStore: enforce_limit (LRU eviction)
    // ========================================================================= //

    #[test]
    fn enforce_limit_evicts_oldest() {
        use crate::modules::constants::MOD_ARCHIVE_CACHE_MAX;

        let mut paths = Vec::new();
        let mut store = ModArchiveStore::new();

        // Load more than MOD_ARCHIVE_CACHE_MAX mods
        for i in 0..=MOD_ARCHIVE_CACHE_MAX {
            let id = format!("lrumod_{}", i);
            let json = format!(r#"{{"id":"{}"}}"#, id);
            let path = create_tbuddy_zip(&json);
            store.load_tbuddy(&path).unwrap();
            paths.push(path);
        }

        // Should have evicted the oldest
        assert!(store.loaded_ids().len() <= MOD_ARCHIVE_CACHE_MAX);

        // Cleanup
        for p in &paths {
            let _ = std::fs::remove_file(p);
        }
    }

    // ========================================================================= //
    // ModArchiveStore: alias_mod_id with loaded archive
    // ========================================================================= //

    #[test]
    fn alias_mod_id_migrates_loaded_archive() {
        let manifest_json = r#"{"id":"real_id"}"#;
        let path = create_tbuddy_zip(manifest_json);

        let mut store = ModArchiveStore::new();
        store.load_tbuddy(&path).unwrap();

        // The mod is loaded under "real_id"
        assert!(store.loaded_ids().contains(&"real_id".to_string()));

        // Alias old→new (in practice this happens when sbuddy filename differs from manifest.id)
        store.alias_mod_id("real_id", "new_id");

        // Archive should now be under new_id
        assert!(store.loaded_ids().contains(&"new_id".to_string()));
        assert!(!store.loaded_ids().contains(&"real_id".to_string()));

        // Source should also be aliased
        assert!(store.get_source("new_id").is_some());

        let _ = std::fs::remove_file(&path);
    }

    // ========================================================================= //
    // ArchiveSource fields
    // ========================================================================= //

    #[test]
    fn archive_source_clone_and_fields() {
        let src = ArchiveSource {
            file_path: PathBuf::from("/path/to/mod.tbuddy"),
            mod_id: "testmod".to_string(),
        };
        let cloned = src.clone();
        assert_eq!(cloned.mod_id, "testmod");
        assert_eq!(cloned.file_path, PathBuf::from("/path/to/mod.tbuddy"));
    }

    // ========================================================================= //
    // ModArchiveReaderExt: read_json / read_json_optional / read_json_list
    // ========================================================================= //

    #[test]
    fn zip_reader_ext_read_json_optional_returns_none_for_missing() {
        use super::ModArchiveReaderExt;
        let tbuddy_path = create_tbuddy_zip(r#"{"id":"extmod"}"#);
        let reader = ZipArchiveReader::from_file(&tbuddy_path).unwrap();
        let opt: Option<super::super::resource::ModManifest> = reader.read_json_optional("nope.json");
        assert!(opt.is_none());
        let _ = std::fs::remove_file(&tbuddy_path);
    }

    #[test]
    fn zip_reader_ext_read_json_list_returns_empty_for_missing() {
        use super::ModArchiveReaderExt;
        let tbuddy_path = create_tbuddy_zip(r#"{"id":"listmod"}"#);
        let reader = ZipArchiveReader::from_file(&tbuddy_path).unwrap();
        let list: Vec<super::super::resource::AssetInfo> = reader.read_json_list("asset/img.json");
        assert!(list.is_empty());
        let _ = std::fs::remove_file(&tbuddy_path);
    }

    // ========================================================================= //
    // ModArchiveStore: ensure_loaded reload from source path
    // ========================================================================= //

    #[test]
    fn ensure_loaded_reloads_evicted_archive() {
        let manifest_json = r#"{"id":"ensmod"}"#;
        let path = create_tbuddy_zip(manifest_json);

        let mut store = ModArchiveStore::new();
        store.load_tbuddy(&path).unwrap();
        assert!(store.loaded_ids().contains(&"ensmod".to_string()));

        // Evict from memory but keep source
        store.evict_loaded("ensmod");
        assert!(!store.loaded_ids().contains(&"ensmod".to_string()));
        assert!(store.get_source("ensmod").is_some());

        // ensure_loaded should reload from source
        assert!(store.ensure_loaded("ensmod").is_ok());
        assert!(store.loaded_ids().contains(&"ensmod".to_string()));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn ensure_loaded_fails_no_source() {
        let mut store = ModArchiveStore::new();
        let err = store.ensure_loaded("nosource");
        assert!(err.is_err());
        assert!(err.unwrap_err().contains("source not found"));
    }

    // ========================================================================= //
    // ModArchiveStore: read_file and file_exists with ensure_loaded
    // ========================================================================= //

    #[test]
    fn read_file_after_evict_reloads() {
        let manifest_json = r#"{"id":"rfevict"}"#;
        let path = create_tbuddy_zip(manifest_json);

        let mut store = ModArchiveStore::new();
        store.load_tbuddy(&path).unwrap();
        store.evict_loaded("rfevict");

        // read_file triggers ensure_loaded
        let data = store.read_file("rfevict", "manifest.json");
        assert!(data.is_ok());
        let content = String::from_utf8(data.unwrap()).unwrap();
        assert!(content.contains("rfevict"));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn file_exists_after_evict_reloads() {
        let manifest_json = r#"{"id":"feevict"}"#;
        let path = create_tbuddy_zip(manifest_json);

        let mut store = ModArchiveStore::new();
        store.load_tbuddy(&path).unwrap();
        store.evict_loaded("feevict");

        assert!(store.file_exists("feevict", "manifest.json"));
        assert!(!store.file_exists("feevict", "nonexist.txt"));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn file_exists_returns_false_for_unknown_mod() {
        let mut store = ModArchiveStore::new();
        assert!(!store.file_exists("unknown_mod_xyz", "manifest.json"));
    }

    #[test]
    fn read_file_returns_error_for_unknown_mod() {
        let mut store = ModArchiveStore::new();
        let err = store.read_file("unknown_mod_xyz", "manifest.json");
        assert!(err.is_err());
    }

    // ========================================================================= //
    // ModArchiveStore: contains after eviction
    // ========================================================================= //

    #[test]
    fn contains_reloads_after_eviction() {
        let manifest_json = r#"{"id":"containsev"}"#;
        let path = create_tbuddy_zip(manifest_json);

        let mut store = ModArchiveStore::new();
        store.load_tbuddy(&path).unwrap();
        store.evict_loaded("containsev");

        // contains triggers ensure_loaded
        assert!(store.contains("containsev"));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn contains_false_for_unknown() {
        let mut store = ModArchiveStore::new();
        assert!(!store.contains("no_such_mod"));
    }

    // ========================================================================= //
    // ModArchiveStore: load_reader_from_path
    // ========================================================================= //

    #[test]
    fn load_reader_from_path_tbuddy() {
        let manifest_json = r#"{"id":"lrmod"}"#;
        let path = create_tbuddy_zip(manifest_json);

        let reader = ModArchiveStore::load_reader_from_path(&path);
        assert!(reader.is_ok());

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn load_reader_from_path_unsupported_ext() {
        let tmp = std::env::temp_dir().join("test_unsupported.xyz");
        std::fs::write(&tmp, b"data").unwrap();
        let result = ModArchiveStore::load_reader_from_path(&tmp);
        assert!(result.is_err());
        let _ = std::fs::remove_file(&tmp);
    }

    // ========================================================================= //
    // ZipArchiveReader: full_path helper
    // ========================================================================= //

    #[test]
    fn zip_reader_full_path_empty_returns_root_slash() {
        let data = build_zip(vec![("mymod/", ""), ("mymod/a.txt", "x")]);
        let reader = ZipArchiveReader::from_bytes(data).unwrap();
        assert_eq!(reader.full_path(""), "mymod/");
        assert_eq!(reader.full_path("sub/file.txt"), "mymod/sub/file.txt");
    }

    // ========================================================================= //
    // ZipArchiveReader: list_dir edge cases
    // ========================================================================= //

    #[test]
    fn list_dir_root_returns_top_level_entries() {
        let data = build_zip(vec![
            ("root/", ""),
            ("root/manifest.json", r#"{"id":"test"}"#),
            ("root/asset/", ""),
            ("root/text/", ""),
            ("root/icon.png", "fake"),
        ]);
        let reader = ZipArchiveReader::from_bytes(data).unwrap();
        let entries = reader.list_dir("");
        let names: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        assert!(names.contains(&"manifest.json"));
        assert!(names.contains(&"asset"));
        assert!(names.contains(&"text"));
        assert!(names.contains(&"icon.png"));
    }

    // ========================================================================= //
    // ModArchiveReader trait: read_file_string via trait method
    // ========================================================================= //

    #[test]
    fn read_file_string_via_trait() {
        let data = build_zip(vec![("mod/", ""), ("mod/test.txt", "hello world")]);
        let reader = ZipArchiveReader::from_bytes(data).unwrap();
        let s = reader.read_file_string("test.txt").unwrap();
        assert_eq!(s, "hello world");
    }

    // ========================================================================= //
    // ModArchiveStore: touch / LRU order
    // ========================================================================= //

    #[test]
    fn touch_moves_to_end_of_access_order() {
        let mut store = ModArchiveStore::new();
        let p1 = create_tbuddy_zip(r#"{"id":"t1"}"#);
        let p2 = create_tbuddy_zip(r#"{"id":"t2"}"#);
        let p3 = create_tbuddy_zip(r#"{"id":"t3"}"#);

        store.load_tbuddy(&p1).unwrap();
        store.load_tbuddy(&p2).unwrap();
        store.load_tbuddy(&p3).unwrap();

        // Access t1 to move it to the end
        let _ = store.get("t1");

        // t1 should now be at the end of access_order
        let last = store.access_order.back().unwrap();
        assert_eq!(last, "t1");

        let _ = std::fs::remove_file(&p1);
        let _ = std::fs::remove_file(&p2);
        let _ = std::fs::remove_file(&p3);
    }

    // ========================================================================= //
    // ArchiveEntry Debug/Clone
    // ========================================================================= //

    #[test]
    fn archive_entry_clone_and_debug() {
        let entry = ArchiveEntry {
            path: "test/file.txt".to_string(),
            is_dir: false,
        };
        let cloned = entry.clone();
        assert_eq!(cloned.path, "test/file.txt");
        assert!(!cloned.is_dir);
        // Test Debug trait
        let debug = format!("{:?}", entry);
        assert!(debug.contains("file.txt"));
    }

    // ========================================================================= //
    // decrypt_sbuddy / encrypt_sbuddy with valid magic but no tool
    // ========================================================================= //

    #[test]
    fn encrypt_sbuddy_returns_result() {
        // If sbuddy tool is not embedded, this should fail gracefully
        let result = encrypt_sbuddy(b"test zip data");
        if !is_sbuddy_supported() {
            assert!(result.is_err());
        }
    }

    // ========================================================================= //
    // ModArchiveStore: clear, register_source, get_source, loaded_ids
    // ========================================================================= //

    /// Helper: create a tbuddy zip with the given mod id
    fn create_tbuddy_with_id(mod_id: &str) -> PathBuf {
        create_tbuddy_zip(&format!(r#"{{"id":"{}","version":"1.0.0"}}"#, mod_id))
    }

    #[test]
    fn store_clear_empties_everything() {
        let mut store = ModArchiveStore::new();
        let p = create_tbuddy_with_id("clear_test");
        let _ = store.load_tbuddy(std::path::Path::new(&p));
        assert!(!store.loaded_ids().is_empty());
        store.clear();
        assert!(store.loaded_ids().is_empty());
        assert!(store.sources.is_empty());
        assert!(store.access_order.is_empty());
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn register_source_and_get_source() {
        let mut store = ModArchiveStore::new();
        let path = std::path::PathBuf::from("/fake/mod.tbuddy");
        store.register_source("my_mod".to_string(), path.clone());

        let source = store.get_source("my_mod").unwrap();
        assert_eq!(source.mod_id, "my_mod");
        assert_eq!(source.file_path, path);

        // Non-existent should return None
        assert!(store.get_source("nonexistent").is_none());
    }

    #[test]
    fn loaded_ids_reflects_loaded_archives() {
        let mut store = ModArchiveStore::new();
        assert!(store.loaded_ids().is_empty());

        let p1 = create_tbuddy_with_id("loaded_x");
        let r1 = store.load_tbuddy(std::path::Path::new(&p1));
        assert!(r1.is_ok(), "load_tbuddy failed for loaded_x: {:?}", r1.err());

        let ids = store.loaded_ids();
        assert!(ids.contains(&"loaded_x".to_string()), "loaded_ids = {:?}", ids);
        assert_eq!(ids.len(), 1);

        let _ = std::fs::remove_file(&p1);
    }

    // ========================================================================= //
    // alias_mod_id: LRU migration
    // ========================================================================= //

    #[test]
    fn alias_mod_id_migrates_archive_and_lru() {
        let mut store = ModArchiveStore::new();
        let p = create_tbuddy_with_id("alias_old");
        let _ = store.load_tbuddy(std::path::Path::new(&p));

        // Verify old id exists
        assert!(store.archives.contains_key("alias_old"));
        assert!(store.access_order.iter().any(|id| id == "alias_old"));

        // Alias: old -> new
        store.alias_mod_id("alias_old", "alias_new");

        // Old should be gone, new should exist
        assert!(!store.archives.contains_key("alias_old"));
        assert!(store.archives.contains_key("alias_new"));
        assert!(!store.access_order.iter().any(|id| id == "alias_old"));
        assert!(store.access_order.iter().any(|id| id == "alias_new"));

        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn alias_mod_id_noop_when_old_not_loaded() {
        let mut store = ModArchiveStore::new();
        store.alias_mod_id("nonexistent", "new_id");
        assert!(store.archives.is_empty());
    }

    // ========================================================================= //
    // load_tbuddy
    // ========================================================================= //

    #[test]
    fn load_tbuddy_returns_mod_id_and_manifest() {
        let p = create_tbuddy_with_id("load_tb_test");
        let mut store = ModArchiveStore::new();
        let (mod_id, manifest) = store.load_tbuddy(std::path::Path::new(&p)).unwrap();
        assert_eq!(mod_id, "load_tb_test");
        assert_eq!(manifest.id.as_ref(), "load_tb_test");
        assert!(store.loaded_ids().contains(&"load_tb_test".to_string()));
        assert!(store.get_source("load_tb_test").is_some());
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn load_tbuddy_invalid_zip_returns_error() {
        let temp = std::env::temp_dir().join("invalid_load.tbuddy");
        std::fs::write(&temp, b"not a zip").unwrap();
        let mut store = ModArchiveStore::new();
        let result = store.load_tbuddy(&temp);
        assert!(result.is_err());
        let _ = std::fs::remove_file(&temp);
    }

    // ========================================================================= //
    // decrypt_sbuddy: magic validation
    // ========================================================================= //

    #[test]
    fn decrypt_sbuddy_rejects_short_data() {
        let result = decrypt_sbuddy(b"short");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("bad magic"));
    }

    #[test]
    fn decrypt_sbuddy_rejects_wrong_magic() {
        let result = decrypt_sbuddy(b"WRONGMAG_extra_data");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("bad magic"));
    }

    // ========================================================================= //
    // is_sbuddy_supported
    // ========================================================================= //

    #[test]
    fn is_sbuddy_supported_returns_bool() {
        let a = is_sbuddy_supported();
        let b = is_sbuddy_supported();
        assert_eq!(a, b);
    }

    // ========================================================================= //
    // evict_loaded preserves source
    // ========================================================================= //

    #[test]
    fn evict_loaded_preserves_source_mapping() {
        let mut store = ModArchiveStore::new();
        let p = create_tbuddy_with_id("evict_src");
        let _ = store.load_tbuddy(std::path::Path::new(&p));

        assert!(store.get_source("evict_src").is_some());
        assert!(store.archives.contains_key("evict_src"));

        store.evict_loaded("evict_src");

        assert!(store.get_source("evict_src").is_some());
        assert!(!store.archives.contains_key("evict_src"));

        let _ = std::fs::remove_file(&p);
    }

    // ========================================================================= //
    // remove fully removes both source and archive
    // ========================================================================= //

    #[test]
    fn remove_clears_source_and_archive() {
        let mut store = ModArchiveStore::new();
        let p = create_tbuddy_with_id("remove_test");
        let _ = store.load_tbuddy(std::path::Path::new(&p));

        store.remove("remove_test");
        assert!(store.get_source("remove_test").is_none());
        assert!(!store.archives.contains_key("remove_test"));
        assert!(!store.access_order.iter().any(|id| id == "remove_test"));

        let _ = std::fs::remove_file(&p);
    }

    // ========================================================================= //
    // read_file case-insensitive fallback
    // ========================================================================= //

    #[test]
    fn zip_reader_read_file_case_insensitive() {
        // Create a ZIP with a mixed-case file name
        let mut buf = Vec::new();
        {
            use std::io::Write;
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();
            zip.start_file("root/CamelCase.txt", opts).unwrap();
            zip.write_all(b"hello").unwrap();
            zip.finish().unwrap();
        }
        let reader = ZipArchiveReader::from_bytes(buf).unwrap();
        // Try reading with lowercase path — should fall back to case-insensitive search
        let result = reader.read_file("camelcase.txt");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), b"hello");
    }

    #[test]
    fn zip_reader_read_file_alt_trailing_slash() {
        // Some ZIP tools add trailing slashes; test the alt-path fallback
        let mut buf = Vec::new();
        {
            use std::io::Write;
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();
            zip.start_file("root/data.bin", opts).unwrap();
            zip.write_all(b"content").unwrap();
            zip.finish().unwrap();
        }
        let reader = ZipArchiveReader::from_bytes(buf).unwrap();
        let result = reader.read_file("data.bin");
        assert!(result.is_ok());
    }

    // ========================================================================= //
    // file_exists case-insensitive
    // ========================================================================= //

    #[test]
    fn zip_reader_file_exists_case_insensitive() {
        let mut buf = Vec::new();
        {
            use std::io::Write;
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();
            zip.start_file("root/MyFile.JSON", opts).unwrap();
            zip.write_all(b"{}").unwrap();
            zip.finish().unwrap();
        }
        let reader = ZipArchiveReader::from_bytes(buf).unwrap();
        // Lowercase query should find it via case-insensitive search
        assert!(reader.file_exists("myfile.json"));
        // Exact case should also work
        assert!(reader.file_exists("MyFile.JSON"));
    }

    // ========================================================================= //
    // list_dir entries
    // ========================================================================= //

    #[test]
    fn zip_reader_list_dir_returns_entries() {
        let mut buf = Vec::new();
        {
            use std::io::Write;
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();
            zip.start_file("root/text/en/info.json", opts).unwrap();
            zip.write_all(b"{}").unwrap();
            zip.start_file("root/text/zh/info.json", opts).unwrap();
            zip.write_all(b"{}").unwrap();
            zip.start_file("root/text/readme.txt", opts).unwrap();
            zip.write_all(b"hi").unwrap();
            zip.finish().unwrap();
        }
        let reader = ZipArchiveReader::from_bytes(buf).unwrap();
        let entries = reader.list_dir("text");
        // Should have: en (dir), zh (dir), readme.txt (file)
        assert!(entries.len() >= 2);
        let dirs: Vec<_> = entries.iter().filter(|e| e.is_dir).collect();
        assert!(dirs.len() >= 2);
    }

    // ========================================================================= //
    // alias_mod_id dedup in access_order
    // ========================================================================= //

    #[test]
    fn alias_mod_id_deduplicates_access_order() {
        let mut store = ModArchiveStore::new();
        let p = create_tbuddy_with_id("old_dedup");
        let _ = store.load_tbuddy(std::path::Path::new(&p));

        // Manually insert old_dedup multiple times in access_order
        store.access_order.push_back("old_dedup".to_string());
        store.access_order.push_back("old_dedup".to_string());

        store.alias_mod_id("old_dedup", "new_dedup");

        // After alias, access_order should have "new_dedup" only once
        let count = store.access_order.iter().filter(|x| *x == "new_dedup").count();
        assert_eq!(count, 1);
        // old_dedup should not appear
        assert!(!store.access_order.iter().any(|x| x == "old_dedup"));

        let _ = std::fs::remove_file(&p);
    }

    // ========================================================================= //
    // enforce_limit LRU eviction
    // ========================================================================= //

    #[test]
    fn enforce_limit_evicts_when_over_max() {
        let mut store = ModArchiveStore::new();
        // Load many mods to exceed cache limit
        let max = crate::modules::constants::MOD_ARCHIVE_CACHE_MAX;
        let mut paths = Vec::new();
        for i in 0..=(max + 2) {
            let id = format!("enforce_{}", i);
            let p = create_tbuddy_with_id(&id);
            let _ = store.load_tbuddy(std::path::Path::new(&p));
            paths.push(p);
        }

        // After enforce_limit, should not exceed max
        assert!(store.archives.len() <= max);
        // Sources should still be kept
        assert!(store.sources.len() > max);

        for p in paths {
            let _ = std::fs::remove_file(&p);
        }
    }

    // ========================================================================= //
    // cleanup_stale_sources
    // ========================================================================= //

    #[test]
    fn cleanup_stale_sources_removes_deleted_files() {
        let mut store = ModArchiveStore::new();
        let p = create_tbuddy_with_id("stale_test");
        let _ = store.load_tbuddy(std::path::Path::new(&p));
        assert!(store.get_source("stale_test").is_some());

        // Delete the file, then cleanup
        std::fs::remove_file(&p).unwrap();
        store.cleanup_stale_sources();

        // Source should be removed
        assert!(store.get_source("stale_test").is_none());
    }

    #[test]
    fn cleanup_stale_sources_keeps_existing_files() {
        let mut store = ModArchiveStore::new();
        let p = create_tbuddy_with_id("keep_test");
        let _ = store.load_tbuddy(std::path::Path::new(&p));

        store.cleanup_stale_sources();
        // File still exists, source should be kept
        assert!(store.get_source("keep_test").is_some());

        let _ = std::fs::remove_file(&p);
    }
}




