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

// ========================================================================= //
// 状态名称常量
// ========================================================================= //

/// Idle 状态名称
pub const STATE_IDLE: &str = "idle";

/// Morning 状态名称
pub const STATE_MORNING: &str = "morning";
