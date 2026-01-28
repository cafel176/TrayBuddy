//! 事件管理模块
//!
//! 提供统一的事件发送接口，规范化事件处理流程。
//!
//! # 功能特性
//!
//! - 统一的事件发送接口，避免代码重复
//! - 自动的错误处理和日志记录
//! - 支持可选的错误处理策略
//! - 事件发送失败时的容错机制
//!
//! # 使用示例
//!
//! ```rust,ignore
//! use crate::modules::event_manager::{emit, EmitOptions};
//!
//! // 基本使用（失败时静默忽略）
//! emit(&app_handle, "event-name", payload)?;
//!
//! // 失败时记录错误日志
//! emit(&app_handle, "event-name", payload, EmitOptions::log_on_error())?;
//!
//! // 失败时记录错误日志并返回错误
//! emit(&app_handle, "event-name", payload, EmitOptions::fail_on_error())?;
//! ```

use tauri::{AppHandle, WebviewWindow};
use tauri::Emitter;
use std::fmt;

// ========================================================================= //
// 公共常量
// ========================================================================= //

/// 事件名称常量定义
///
/// 集中管理所有事件名称，避免字符串散布在代码中。
pub mod events {
    /// 设置变更事件
    pub const SETTINGS_CHANGE: &str = "settings-change";

    /// 静音模式变更事件
    pub const MUTE_CHANGE: &str = "mute-change";

    /// 音量变更事件
    pub const VOLUME_CHANGE: &str = "volume-change";

    /// 角色状态变更事件
    pub const STATE_CHANGE: &str = "state-change";

    /// 模块刷新事件
    pub const REFRESH_MODS: &str = "refresh-mods";

    /// 窗口位置变更事件
    pub const WINDOW_POSITION_CHANGED: &str = "window-position-changed";

    /// 布局调试器状态事件
    pub const LAYOUT_DEBUGGER_STATUS: &str = "layout-debugger-status";

    /// 系统调试信息更新事件
    pub const SYSTEM_DEBUG_UPDATE: &str = "system-debug-update";

    /// 媒体调试信息更新事件
    pub const MEDIA_DEBUG_UPDATE: &str = "media-debug-update";

    /// 环境信息更新事件
    pub const ENVIRONMENT_UPDATED: &str = "environment-updated";
}

// ========================================================================= //
// 错误处理
// ========================================================================= //

/// 事件发送错误
#[derive(Debug)]
pub enum EmitError {
    /// Tauri Emitter 错误
    EmitterError(tauri::Error),
}

impl fmt::Display for EmitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EmitError::EmitterError(e) => write!(f, "Emitter error: {}", e),
        }
    }
}

impl std::error::Error for EmitError {}

impl From<tauri::Error> for EmitError {
    fn from(error: tauri::Error) -> Self {
        EmitError::EmitterError(error)
    }
}

// ========================================================================= //
// 配置选项
// ========================================================================= //

/// 事件发送选项
///
/// 控制事件发送失败时的行为。
#[derive(Debug, Clone, Copy, Default)]
pub enum EmitOptions {
    /// 默认选项：失败时静默忽略（仅日志记录）
    #[default]
    Silent,

    /// 失败时记录错误日志
    LogOnFailure,

    /// 失败时记录错误日志并返回错误
    FailOnFailure,
}

impl EmitOptions {
    /// 创建失败时记录日志的选项
    pub fn log_on_error() -> Self {
        Self::LogOnFailure
    }

    /// 创建失败时返回错误的选项
    pub fn fail_on_error() -> Self {
        Self::FailOnFailure
    }

    /// 判断失败时是否应该记录日志
    fn should_log(self) -> bool {
        matches!(self, Self::LogOnFailure | Self::FailOnFailure)
    }

    /// 判断失败时是否应该返回错误
    fn should_fail(self) -> bool {
        matches!(self, Self::FailOnFailure)
    }
}

// ========================================================================= //
// 公共函数
// ========================================================================= //

/// 发送事件到前端（默认选项，从 AppHandle）
///
/// 使用默认的 `Silent` 选项，失败时仅记录日志。
///
/// # 参数
///
/// * `app` - Tauri 应用句柄
/// * `event` - 事件名称（推荐使用 `events` 模块中的常量）
/// * `payload` - 事件负载，需要实现 `serde::Serialize`
///
/// # 返回
///
/// 总是返回 `Ok(())`，即使发送失败也会被捕获。
///
/// # 示例
///
/// ```rust,ignore
/// emit(&app_handle, events::VOLUME_CHANGE, volume)?;
/// ```
pub fn emit<T: serde::Serialize>(
    app: &AppHandle,
    event: &str,
    payload: T,
) -> Result<(), EmitError> {
    emit_with_options(app, event, payload, EmitOptions::default())
}

/// 发送事件到前端（默认选项，从 Window）
///
/// 使用默认的 `Silent` 选项，失败时仅记录日志。
///
/// # 参数
///
/// * `window` - Tauri 窗口句柄
/// * `event` - 事件名称（推荐使用 `events` 模块中的常量）
/// * `payload` - 事件负载，需要实现 `serde::Serialize`
///
/// # 返回
///
/// 总是返回 `Ok(())`，即使发送失败也会被捕获。
///
/// # 示例
///
/// ```rust,ignore
/// emit_from_window(&window, events::WINDOW_POSITION_CHANGED, (x, y))?;
/// ```
pub fn emit_from_window<T: serde::Serialize>(
    window: &WebviewWindow,
    event: &str,
    payload: T,
) -> Result<(), EmitError> {
    emit_with_options_window(window, event, payload, EmitOptions::default())
}

/// 发送事件到前端（带选项，从 AppHandle）
///
/// 提供灵活的错误处理策略。
///
/// # 参数
///
/// * `app` - Tauri 应用句柄
/// * `event` - 事件名称（推荐使用 `events` 模块中的常量）
/// * `payload` - 事件负载，需要实现 `serde::Serialize`
/// * `options` - 发送选项，控制失败时的行为
///
/// # 返回
///
/// - `Ok(())` - 事件发送成功（或失败但选项允许忽略）
/// - `Err(EmitError)` - 事件发送失败且选项要求返回错误
///
/// # 示例
///
/// ```rust,ignore
/// // 基本使用（失败时静默）
/// emit(&app_handle, events::SETTINGS_CHANGE, settings)?;
///
/// // 失败时记录日志
/// emit_with_options(
///     &app_handle,
///     events::SETTINGS_CHANGE,
///     settings,
///     EmitOptions::log_on_error(),
/// )?;
///
/// // 失败时返回错误
/// emit_with_options(
///     &app_handle,
///     events::SETTINGS_CHANGE,
///     settings,
///     EmitOptions::fail_on_error(),
/// )?;
/// ```
pub fn emit_with_options<T: serde::Serialize>(
    app: &AppHandle,
    event: &str,
    payload: T,
    options: EmitOptions,
) -> Result<(), EmitError> {
    match app.emit(event, payload) {
        Ok(_) => Ok(()),
        Err(e) => {
            if options.should_log() {
                eprintln!(
                    "[EventManager] Failed to emit event '{}': {}",
                    event, e
                );
            }
            if options.should_fail() {
                Err(EmitError::EmitterError(e))
            } else {
                Ok(())
            }
        }
    }
}

/// 发送事件到前端（带选项，从 Window）
///
/// 提供灵活的错误处理策略。
///
/// # 参数
///
/// * `window` - Tauri 窗口句柄
/// * `event` - 事件名称（推荐使用 `events` 模块中的常量）
/// * `payload` - 事件负载，需要实现 `serde::Serialize`
/// * `options` - 发送选项，控制失败时的行为
///
/// # 返回
///
/// - `Ok(())` - 事件发送成功（或失败但选项允许忽略）
/// - `Err(EmitError)` - 事件发送失败且选项要求返回错误
pub fn emit_with_options_window<T: serde::Serialize>(
    window: &WebviewWindow,
    event: &str,
    payload: T,
    options: EmitOptions,
) -> Result<(), EmitError> {
    match window.emit(event, payload) {
        Ok(_) => Ok(()),
        Err(e) => {
            if options.should_log() {
                eprintln!(
                    "[EventManager] Failed to emit event '{}': {}",
                    event, e
                );
            }
            if options.should_fail() {
                Err(EmitError::EmitterError(e))
            } else {
                Ok(())
            }
        }
    }
}

// ========================================================================= //
// 专用辅助函数
// ========================================================================= //

/// 发送设置变更事件
///
/// 发送完整的 UserSettings 对象到前端。
///
/// # 参数
///
/// * `app` - Tauri 应用句柄
/// * `settings` - 设置对象（需要实现 `serde::Serialize`）
///
/// # 示例
///
/// ```rust,ignore
/// emit_settings(&app, &settings)?;
/// ```
pub fn emit_settings<T: serde::Serialize>(
    app: &AppHandle,
    settings: &T,
) -> Result<(), EmitError> {
    emit_with_options(app, events::SETTINGS_CHANGE, settings, EmitOptions::default())
}

/// 发送调试信息更新事件
///
/// 用于调试面板的数据更新。
///
/// # 参数
///
/// * `app` - Tauri 应用句柄
/// * `event_type` - 调试事件类型（system / media）
/// * `debug_info` - 调试信息对象（需要实现 `serde::Serialize`）
pub fn emit_debug_update<T: serde::Serialize>(
    app: &AppHandle,
    event_type: &str,
    debug_info: &T,
) -> Result<(), EmitError> {
    let event_name = match event_type {
        "system" => events::SYSTEM_DEBUG_UPDATE,
        "media" => events::MEDIA_DEBUG_UPDATE,
        _ => {
            eprintln!("[EventManager] Unknown debug event type: {}", event_type);
            return Ok(());
        }
    };

    emit_with_options(app, event_name, debug_info, EmitOptions::log_on_error())
}
