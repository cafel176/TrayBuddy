//! 公共工具模块
//!
//! 提供全项目通用的底层功能，包括：
//! - HTTP 网络请求工具
//! - 文件与 JSON 加载
//! - 窗口控制与 DWM API 包装
//! - 操作系统版本检测

pub mod fs;
pub mod http;
pub mod os_version;
pub mod window;
