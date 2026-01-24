//! 全局常量定义
//!
//! 所有模块都可以通过 `use crate::modules::constants::*` 访问这些常量。
//!
//! ## 常量分类
//! - 窗口尺寸常量 - Animation 窗口的基础尺寸
//! - 动画/动作名称常量 - 内置动画的标识符
//! - 状态名称常量 - 内置状态的标识符
//! - 事件名称常量 - 触发事件的标识符

#![allow(unused)]

// ========================================================================= //
// 窗口尺寸常量
// ========================================================================= //

/// 动画区域基础宽度（角色显示区域，会随缩放变化）
pub const ANIMATION_AREA_WIDTH: f64 = 500.0;

/// 动画区域基础高度（角色显示区域，会随缩放变化）
pub const ANIMATION_AREA_HEIGHT: f64 = 500.0;

/// 气泡区域高度（在动画区域上方，固定不缩放）
pub const BUBBLE_AREA_HEIGHT: f64 = 300.0;

/// 气泡区域宽度（固定不缩放）
pub const BUBBLE_AREA_WIDTH: f64 = 300.0;

/// Animation 窗口基础宽度（取动画区域和气泡区域宽度的最大值）
pub const ANIMATION_WINDOW_BASE_WIDTH: f64 = if ANIMATION_AREA_WIDTH > BUBBLE_AREA_WIDTH {
    ANIMATION_AREA_WIDTH
} else {
    BUBBLE_AREA_WIDTH
};

/// Animation 窗口基础高度（动画区域 + 气泡区域）
pub const ANIMATION_WINDOW_BASE_HEIGHT: f64 = ANIMATION_AREA_HEIGHT + BUBBLE_AREA_HEIGHT;

// ========================================================================= //
// 气泡文本常量
// ========================================================================= //

/// 按钮短文本阈值（字符数），短于此值的按钮可以并排显示
pub const SHORT_TEXT_THRESHOLD: u32 = 5;

/// 单行最大按钮数量（并排显示时）
pub const MAX_BUTTONS_PER_ROW: u32 = 3;

/// 单行最大字符数，超过此值且未遇到换行符时自动换行
pub const MAX_CHARS_PER_LINE: u32 = 15;

/// 按钮文本最大字符数，超过此值自动换行
pub const MAX_CHARS_PER_BUTTON: u32 = 12;

// ========================================================================= //
// 动画/动作名称常量
// ========================================================================= //

/// Border 动画名称
pub const ANIMATION_BORDER: &str = "border";

// ========================================================================= //
// 状态名称常量
// ========================================================================= //

/// Idle 状态名称
pub const STATE_IDLE: &str = "idle";
pub const STATE_SILENCE: &str = "silence";
pub const STATE_SILENCE_START: &str = "silence_start";
pub const STATE_SILENCE_END: &str = "silence_end";

// ========================================================================= //
// 事件名称常量
// ========================================================================= //

/// 点击事件
pub const EVENT_CLICK: &str = "click";

/// 登录事件
pub const EVENT_LOGIN: &str = "login";

/// 音乐开始事件
pub const EVENT_MUSIC_START: &str = "music_start";

/// 音乐结束事件
pub const EVENT_MUSIC_END: &str = "music_end";

// ========================================================================= //
// 媒体监听常量
// ========================================================================= //

/// 媒体监听启动延迟（秒），确保 music_start 不会在 login 之前触发
pub const MEDIA_OBSERVER_STARTUP_DELAY_SECS: u64 = 5;

/// Core Audio 轮询超时间隔（秒），GSMTC 有事件通知但 Core Audio 没有，需定期轮询
pub const CORE_AUDIO_POLL_INTERVAL_SECS: u64 = 5;

// ========================================================================= //
// 环境信息常量
// ========================================================================= //

/// 天气缓存有效期（秒），默认 30 分钟
pub const WEATHER_CACHE_DURATION_SECS: u64 = 1800;

/// 天气 API 请求超时（秒）
pub const WEATHER_API_TIMEOUT_SECS: u64 = 10;

/// 地理位置 API 请求超时（秒）
pub const LOCATION_API_TIMEOUT_SECS: u64 = 10;

// ========================================================================= //
// 定时触发器常量
// ========================================================================= //

/// 触发器最小触发间隔时间（秒），防止过于频繁的触发
pub const MIN_TRIGGER_TIME_SECS: f32 = 300.0;

/// 定时触发器检查间隔（秒）
pub const TIMER_TRIGGER_CHECK_INTERVAL_SECS: u64 = MIN_TRIGGER_TIME_SECS as u64;

// ========================================================================= //
// 状态锁等待常量
// ========================================================================= //

/// 等待状态解锁的重试间隔（毫秒）
pub const STATE_LOCK_WAIT_INTERVAL_MS: u64 = 500;

/// 等待状态解锁的最大重试次数
pub const STATE_LOCK_MAX_RETRIES: u32 = 60;
