//! 公共工具模块
//!
//! 提供全项目通用的底层功能，包括：
//! - HTTP 网络请求工具
//! - 文件与 JSON 加载
//! - 窗口控制与 DWM API 包装
//! - 操作系统版本检测
//! - i18n 国际化文本缓存
//! - 线程安全的全局缓存值封装
//! - 异步读取 AppState 的辅助函数

pub mod cached_value;
pub mod fs;
pub mod http;
pub mod i18n;
pub mod os_version;
pub mod window;

// 重导出常用类型
pub use cached_value::CachedValue;
