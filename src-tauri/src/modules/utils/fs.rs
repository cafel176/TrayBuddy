//! 文件系统与 JSON 解析工具

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

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[derive(Debug, Serialize, Deserialize, PartialEq)]
    struct Item {
        id: u32,
        name: String,
    }

    fn temp_path(label: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        path.push(format!("traybuddy_fs_test_{}_{}.json", label, nanos));
        path
    }

    #[test]
    fn load_json_list_returns_empty_on_missing_or_invalid() {
        let missing = temp_path("missing");
        let list: Vec<Item> = load_json_list(&missing);
        assert!(list.is_empty());

        let invalid = temp_path("invalid");
        fs::write(&invalid, "not json").unwrap();
        let list: Vec<Item> = load_json_list(&invalid);
        assert!(list.is_empty());

        let _ = fs::remove_file(&invalid);
    }

    #[test]
    fn load_json_list_parses_valid_file() {
        let path = temp_path("valid_list");
        let data = vec![
            Item {
                id: 1,
                name: "a".to_string(),
            },
            Item {
                id: 2,
                name: "b".to_string(),
            },
        ];
        fs::write(&path, serde_json::to_string(&data).unwrap()).unwrap();

        let list: Vec<Item> = load_json_list(&path);
        assert_eq!(list, data);

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn load_json_obj_returns_none_on_missing_or_invalid() {
        let missing = temp_path("missing_obj");
        let value: Option<Item> = load_json_obj(&missing);
        assert!(value.is_none());

        let invalid = temp_path("invalid_obj");
        fs::write(&invalid, "not json").unwrap();
        let value: Option<Item> = load_json_obj(&invalid);
        assert!(value.is_none());

        let _ = fs::remove_file(&invalid);
    }

    #[test]
    fn load_json_obj_parses_valid_file() {
        let path = temp_path("valid_obj");
        let data = Item {
            id: 7,
            name: "ok".to_string(),
        };
        fs::write(&path, serde_json::to_string(&data).unwrap()).unwrap();

        let value: Option<Item> = load_json_obj(&path);
        assert_eq!(value, Some(data));

        let _ = fs::remove_file(&path);
    }
}

