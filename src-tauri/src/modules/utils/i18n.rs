//! i18n 国际化文本缓存模块
//!
//! 该模块提供后端国际化文本的缓存读取功能，避免每次获取文本时重复读取和解析 JSON 文件。
//!
//! ## 功能特性
//! - 缓存已加载的语言文件，减少磁盘 I/O
//! - 支持多语言切换（切换时自动加载新语言）
//! - 支持嵌套键路径访问（如 "menu.about"）
//!
//! ## 使用示例
//! ```text
//! let text = get_i18n_text(app, "zh", "menu.about");
//! ```



use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::OnceLock;

// ============================================================================
// 缓存结构
// ============================================================================

/// i18n 缓存条目
struct I18nCache {
    /// 当前缓存的语言代码
    lang: String,
    /// 解析后的 JSON 数据
    data: Value,
}

/// 全局 i18n 缓存
static I18N_CACHE: OnceLock<Mutex<Option<I18nCache>>> = OnceLock::new();

/// 获取或初始化缓存
fn get_cache() -> &'static Mutex<Option<I18nCache>> {
    I18N_CACHE.get_or_init(|| Mutex::new(None))
}

// ============================================================================
// 公共 API
// ============================================================================

/// 获取国际化文本
///
/// 优化版本：使用缓存避免重复读取文件
///
/// # 参数
/// - `app`: Tauri 应用句柄
/// - `lang`: 语言代码（如 "zh", "en"）
/// - `key`: 文本键路径，支持点号分隔（如 "menu.about"）
///
/// # 返回
/// 翻译后的文本，找不到时返回键名
pub fn get_i18n_text(app: &tauri::AppHandle, lang: &str, key: &str) -> String {
    // 尝试从缓存获取
    let mut cache_guard = match get_cache().lock() {
        Ok(guard) => guard,
        Err(_) => return key.to_string(),
    };

    // 检查缓存是否命中（语言匹配）
    let need_reload = match &*cache_guard {
        Some(cache) => cache.lang != lang,
        None => true,
    };

    // 需要重新加载
    if need_reload {
        if let Some(data) = load_i18n_file(app, lang) {
            *cache_guard = Some(I18nCache {
                lang: lang.to_string(),
                data,
            });
        } else {
            return key.to_string();
        }
    }

    // 从缓存中查找键
    if let Some(cache) = &*cache_guard {
        return get_nested_value(&cache.data, key).unwrap_or_else(|| key.to_string());
    }

    key.to_string()
}

/// 清除 i18n 缓存
///
/// 在语言切换或资源更新时调用
#[allow(dead_code)]
pub fn clear_i18n_cache() {
    if let Ok(mut guard) = get_cache().lock() {
        *guard = None;
    }
}

// ============================================================================
// 内部函数
// ============================================================================

/// 加载 i18n 文件
fn load_i18n_file(app: &tauri::AppHandle, lang: &str) -> Option<Value> {
    use tauri::Manager;

    // 尝试从资源目录读取
    let i18n_path = app
        .path()
        .resource_dir()
        .ok()?
        .join("i18n")
        .join(format!("{}.json", lang));

    // 如果资源目录下不存在（开发模式），则尝试从当前工作目录读取
    let i18n_path = if i18n_path.exists() {
        i18n_path
    } else {
        PathBuf::from("i18n").join(format!("{}.json", lang))
    };

    // 读取并解析文件
    let content = std::fs::read_to_string(&i18n_path).ok()?;
    serde_json::from_str(&content).ok()
}

/// 从嵌套 JSON 中获取值
///
/// 注意：该逻辑应与前端 `src/lib/i18n/index.ts` 的点号路径解析保持一致，
/// 避免前后端翻译键行为不一致。
fn get_nested_value(json: &Value, key: &str) -> Option<String> {
    let keys: Vec<&str> = key.split('.').collect();
    let mut current = json;

    for k in keys {
        current = current.get(k)?;
    }

    current.as_str().map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn get_nested_value_returns_nested_string() {
        let data = json!({
            "menu": {
                "about": "关于",
                "nested": { "deep": "深层" }
            }
        });

        assert_eq!(get_nested_value(&data, "menu.about"), Some("关于".to_string()));
        assert_eq!(
            get_nested_value(&data, "menu.nested.deep"),
            Some("深层".to_string())
        );
        assert_eq!(get_nested_value(&data, "menu.missing"), None);
    }

    #[test]
    fn get_nested_value_top_level_key() {
        let data = json!({ "hello": "world" });
        assert_eq!(get_nested_value(&data, "hello"), Some("world".to_string()));
    }

    #[test]
    fn get_nested_value_returns_none_for_non_string() {
        let data = json!({ "count": 42 });
        assert_eq!(get_nested_value(&data, "count"), None);
    }

    #[test]
    fn get_nested_value_returns_none_for_null() {
        let data = json!({ "key": null });
        assert_eq!(get_nested_value(&data, "key"), None);
    }

    #[test]
    fn get_nested_value_returns_none_for_array() {
        let data = json!({ "list": [1, 2, 3] });
        assert_eq!(get_nested_value(&data, "list"), None);
    }

    #[test]
    fn get_nested_value_returns_none_for_object() {
        let data = json!({ "obj": { "inner": "val" } });
        assert_eq!(get_nested_value(&data, "obj"), None);
    }

    #[test]
    fn get_nested_value_deeply_nested() {
        let data = json!({ "a": { "b": { "c": { "d": "deep" } } } });
        assert_eq!(get_nested_value(&data, "a.b.c.d"), Some("deep".to_string()));
    }

    #[test]
    fn get_nested_value_empty_key() {
        let data = json!({ "": "empty_key" });
        assert_eq!(get_nested_value(&data, ""), Some("empty_key".to_string()));
    }

    #[test]
    fn clear_i18n_cache_does_not_panic() {
        // Just verify it doesn't panic when called multiple times
        clear_i18n_cache();
        clear_i18n_cache();
    }

    #[test]
    fn get_cache_returns_same_instance() {
        let cache1 = get_cache();
        let cache2 = get_cache();
        // Both should point to the same static
        assert!(std::ptr::eq(cache1, cache2));
    }
}


