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

    // ===================================================================== //
    // get_nested_value — 基本路径查找
    // ===================================================================== //

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

    // ===================================================================== //
    // get_nested_value — 非字符串类型返回 None
    // ===================================================================== //

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
    fn get_nested_value_returns_none_for_boolean() {
        let data = json!({ "flag": true });
        assert_eq!(get_nested_value(&data, "flag"), None);
    }

    #[test]
    fn get_nested_value_returns_none_for_float() {
        let data = json!({ "pi": 3.14 });
        assert_eq!(get_nested_value(&data, "pi"), None);
    }

    // ===================================================================== //
    // get_nested_value — 深层嵌套
    // ===================================================================== //

    #[test]
    fn get_nested_value_deeply_nested() {
        let data = json!({ "a": { "b": { "c": { "d": "deep" } } } });
        assert_eq!(get_nested_value(&data, "a.b.c.d"), Some("deep".to_string()));
    }

    #[test]
    fn get_nested_value_five_levels_deep() {
        let data = json!({ "l1": { "l2": { "l3": { "l4": { "l5": "bottom" } } } } });
        assert_eq!(
            get_nested_value(&data, "l1.l2.l3.l4.l5"),
            Some("bottom".to_string())
        );
    }

    // ===================================================================== //
    // get_nested_value — 边界条件
    // ===================================================================== //

    #[test]
    fn get_nested_value_empty_key() {
        let data = json!({ "": "empty_key" });
        assert_eq!(get_nested_value(&data, ""), Some("empty_key".to_string()));
    }

    #[test]
    fn get_nested_value_key_not_found_at_root() {
        let data = json!({ "a": "value" });
        assert_eq!(get_nested_value(&data, "b"), None);
    }

    #[test]
    fn get_nested_value_key_not_found_in_nested() {
        let data = json!({ "a": { "b": "value" } });
        assert_eq!(get_nested_value(&data, "a.c"), None);
    }

    #[test]
    fn get_nested_value_partial_path_is_not_string() {
        // a.b 是一个对象，不是字符串
        let data = json!({ "a": { "b": { "c": "value" } } });
        assert_eq!(get_nested_value(&data, "a.b"), None);
    }

    #[test]
    fn get_nested_value_path_through_non_object() {
        // a 是一个字符串，试图继续访问 a.b 应返回 None
        let data = json!({ "a": "string_value" });
        assert_eq!(get_nested_value(&data, "a.b"), None);
    }

    #[test]
    fn get_nested_value_path_through_array() {
        let data = json!({ "a": [1, 2, 3] });
        assert_eq!(get_nested_value(&data, "a.0"), None);
    }

    #[test]
    fn get_nested_value_path_through_null() {
        let data = json!({ "a": null });
        assert_eq!(get_nested_value(&data, "a.b"), None);
    }

    #[test]
    fn get_nested_value_empty_string_value() {
        let data = json!({ "empty": "" });
        assert_eq!(get_nested_value(&data, "empty"), Some("".to_string()));
    }

    #[test]
    fn get_nested_value_unicode_key_and_value() {
        let data = json!({ "菜单": { "关于": "TrayBuddy" } });
        assert_eq!(
            get_nested_value(&data, "菜单.关于"),
            Some("TrayBuddy".to_string())
        );
    }

    #[test]
    fn get_nested_value_key_with_spaces() {
        let data = json!({ "key with spaces": "val" });
        assert_eq!(
            get_nested_value(&data, "key with spaces"),
            Some("val".to_string())
        );
    }

    #[test]
    fn get_nested_value_key_with_special_chars() {
        let data = json!({ "key-name_1": "val" });
        assert_eq!(
            get_nested_value(&data, "key-name_1"),
            Some("val".to_string())
        );
    }

    #[test]
    fn get_nested_value_consecutive_dots() {
        // "a..b" splits into ["a", "", "b"]
        let data = json!({ "a": { "": { "b": "deep_empty" } } });
        assert_eq!(
            get_nested_value(&data, "a..b"),
            Some("deep_empty".to_string())
        );
    }

    #[test]
    fn get_nested_value_on_empty_json_object() {
        let data = json!({});
        assert_eq!(get_nested_value(&data, "any"), None);
    }

    // ===================================================================== //
    // clear_i18n_cache
    // ===================================================================== //

    #[test]
    fn clear_i18n_cache_does_not_panic() {
        clear_i18n_cache();
        clear_i18n_cache();
    }

    #[test]
    fn clear_i18n_cache_clears_stored_data() {
        // 手动设置缓存然后清除
        {
            let mut guard = get_cache().lock().unwrap();
            *guard = Some(I18nCache {
                lang: "en".to_string(),
                data: json!({"test": "value"}),
            });
        }

        clear_i18n_cache();

        {
            let guard = get_cache().lock().unwrap();
            assert!(guard.is_none());
        }
    }

    // ===================================================================== //
    // get_cache — 单例检查
    // ===================================================================== //

    #[test]
    fn get_cache_returns_same_instance() {
        let cache1 = get_cache();
        let cache2 = get_cache();
        assert!(std::ptr::eq(cache1, cache2));
    }

    #[test]
    fn get_cache_returns_lockable_mutex() {
        let cache = get_cache();
        let guard = cache.lock();
        assert!(guard.is_ok());
    }

    // ===================================================================== //
    // I18nCache 结构体 — 直接操作
    // ===================================================================== //

    #[test]
    fn i18n_cache_set_and_read() {
        let mut guard = get_cache().lock().unwrap();
        *guard = Some(I18nCache {
            lang: "zh".to_string(),
            data: json!({"menu": {"about": "关于"}}),
        });

        if let Some(ref cache) = *guard {
            assert_eq!(cache.lang, "zh");
            assert_eq!(
                get_nested_value(&cache.data, "menu.about"),
                Some("关于".to_string())
            );
        } else {
            panic!("Cache should not be None");
        }

        // 清理
        *guard = None;
    }

    #[test]
    fn i18n_cache_language_switch() {
        let mut guard = get_cache().lock().unwrap();

        // 先设中文
        *guard = Some(I18nCache {
            lang: "zh".to_string(),
            data: json!({"hello": "你好"}),
        });

        assert_eq!(guard.as_ref().unwrap().lang, "zh");

        // 切换为英文
        *guard = Some(I18nCache {
            lang: "en".to_string(),
            data: json!({"hello": "Hello"}),
        });

        assert_eq!(guard.as_ref().unwrap().lang, "en");
        assert_eq!(
            get_nested_value(&guard.as_ref().unwrap().data, "hello"),
            Some("Hello".to_string())
        );

        // 清理
        *guard = None;
    }

    #[test]
    fn i18n_cache_need_reload_check() {
        let mut guard = get_cache().lock().unwrap();

        // 缓存为 None 时需要 reload
        let need_reload_none = guard.is_none();
        assert!(need_reload_none);

        // 设置为 zh
        *guard = Some(I18nCache {
            lang: "zh".to_string(),
            data: json!({}),
        });

        // 同语言不需要 reload
        let need_reload_same = match &*guard {
            Some(cache) => cache.lang != "zh",
            None => true,
        };
        assert!(!need_reload_same);

        // 不同语言需要 reload
        let need_reload_diff = match &*guard {
            Some(cache) => cache.lang != "en",
            None => true,
        };
        assert!(need_reload_diff);

        // 清理
        *guard = None;
    }
}


