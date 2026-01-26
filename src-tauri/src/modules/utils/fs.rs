//! 文件系统与 JSON 解析工具

use serde::de::DeserializeOwned;
use std::fs;
use std::path::Path;

/// 加载 JSON 数组文件
pub fn load_json_list<T: DeserializeOwned>(path: &Path) -> Vec<T> {
    if !path.exists() {
        return Vec::new();
    }

    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

/// 加载 JSON 对象文件
pub fn load_json_obj<T: DeserializeOwned>(path: &Path) -> Option<T> {
    if !path.exists() {
        return None;
    }

    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
}
