//! 文件系统与 JSON 解析工具
//!
//! 提供对 JSON 文件的容错加载：
//! - [`load_json_list`] — 加载 JSON 数组，文件不存在或解析失败时返回空数组
//! - [`load_json_obj`] — 加载 JSON 对象，文件不存在或解析失败时返回 `None`
//!
//! 设计原则：上层不必关心文件是否存在，减少重复的 `if exists` 检查。

use serde::de::DeserializeOwned;
use std::fs;
use std::path::Path;

/// 加载 JSON 数组文件
///
/// - 文件不存在时返回空数组（避免上层判空）
/// - 解析失败时也返回空数组（用于容错）
pub fn load_json_list<T: DeserializeOwned>(path: &Path) -> Vec<T> {
    if !path.exists() {
        return Vec::new();
    }

    fs::File::open(path)
        .ok()
        .and_then(|file| {
            let reader = std::io::BufReader::new(file);
            serde_json::from_reader(reader).ok()
        })
        .unwrap_or_default()
}

/// 加载 JSON 对象文件
///
/// - 文件不存在返回 None
/// - 解析失败返回 None（由上层决定兜底策略）
pub fn load_json_obj<T: DeserializeOwned>(path: &Path) -> Option<T> {
    if !path.exists() {
        return None;
    }

    fs::File::open(path).ok().and_then(|file| {
        let reader = std::io::BufReader::new(file);
        serde_json::from_reader(reader).ok()
    })
}



