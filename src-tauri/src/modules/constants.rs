/// 全局常量定义
/// 所有模块都可以通过 use crate::modules::constants::* 访问

// ========================================================================= //
// 窗口尺寸常量
// ========================================================================= //

/// Animation 窗口基础宽度
pub const ANIMATION_WINDOW_BASE_WIDTH: f64 = 500.0;

/// Animation 窗口基础高度
pub const ANIMATION_WINDOW_BASE_HEIGHT: f64 = 500.0;

// ========================================================================= //
// 动画/动作名称常量
// ========================================================================= //

/// Idle 动画名称
pub const ANIMATION_IDLE: &str = "idle";

/// Border 动画名称
pub const ANIMATION_BORDER: &str = "border";

/// Morning 动画名称
pub const ANIMATION_MORNING: &str = "morning";
pub const ANIMATION_NOON: &str = "noon";
pub const ANIMATION_EVENING: &str = "evening";
pub const ANIMATION_NIGHT: &str = "night";

/// Music 动画名称 (听歌状态动画)
pub const ANIMATION_MUSIC: &str = "music";

// ========================================================================= //
// 状态名称常量
// ========================================================================= //

/// Idle 状态名称
pub const STATE_IDLE: &str = "idle";

/// Music 状态名称 (播放音乐中 - 持久状态)
pub const STATE_MUSIC: &str = "music";

/// Morning 状态名称 (早上问候)
pub const STATE_MORNING: &str = "morning";

/// Noon 状态名称 (中午问候)
pub const STATE_NOON: &str = "noon";

/// Evening 状态名称 (晚上问候)
pub const STATE_EVENING: &str = "evening";

/// Night 状态名称 (深夜问候)
pub const STATE_NIGHT: &str = "night";
