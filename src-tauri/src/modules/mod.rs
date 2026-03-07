//! TrayBuddy 核心模块
//!
//! 本模块包含应用的所有核心功能实现：
//!
//! - [`constants`] - 全局常量定义
//! - [`environment`] - 环境信息（时间、位置、天气）
//! - [`event_manager`] - 统一事件发送管理
//! - [`resource`] - Mod 资源加载与管理
//! - [`state`] - 角色状态管理与定时触发
//! - [`storage`] - 用户数据持久化存储
//! - [`media_observer`] - 系统媒体状态监听
//! - [`trigger`] - 事件触发处理
//! - [`utils`] - 公共工具类 (HTTP, FS, Window)

pub mod ai_tool_manager;
pub mod constants;
pub mod environment;
pub mod event_manager;
pub mod media_observer;
pub mod mod_archive;
pub mod process_observer;
pub mod render_tuning_config;
pub mod resource;
pub mod state;
pub mod storage;
pub mod system_observer;
pub mod trigger;

pub mod utils;
