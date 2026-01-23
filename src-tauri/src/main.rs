//! TrayBuddy 应用程序入口
//!
//! 这是 Tauri 应用的主入口文件，负责启动整个桌面宠物应用。
//!
//! # 编译说明
//! - 在 Release 模式下，Windows 系统会隐藏控制台窗口
//! - 在 Debug 模式下，控制台窗口会显示，便于调试日志输出

// 在 Release 模式下禁用 Windows 控制台窗口（不要删除此行！）
// 这确保了发布版本运行时不会弹出黑色命令行窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// 应用程序主入口点
///
/// 调用 `traybuddy_lib::run()` 启动 Tauri 应用：
/// - 初始化核心管理器（资源、状态、存储）
/// - 创建动画窗口（桌面宠物显示窗口）
/// - 启动媒体监听器（音乐播放检测）
/// - 注册所有 Tauri 命令处理函数
fn main() {
    traybuddy_lib::run()
}
