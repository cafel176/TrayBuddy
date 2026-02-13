//! 全局常量定义
//!
//! 所有模块都可以通过 `use crate::modules::constants::*` 访问这些常量。
//!
//! ## 常量分类
//! - 窗口标签常量 - 所有窗口的唯一标识符
//! - 托盘标识符常量 - 托盘图标和菜单的唯一标识符
//! - 窗口尺寸常量 - Animation 窗口的基础尺寸
//! - 动画/动作名称常量 - 内置动画的标识符
//! - 状态名称常量 - 内置状态的标识符
//! - 事件名称常量 - 触发事件的标识符

#![allow(unused)]

// ========================================================================= //
// 窗口标签常量
// ========================================================================= //

/// 主窗口标签
pub const WINDOW_LABEL_MAIN: &str = "main";

/// 动画窗口标签
pub const WINDOW_LABEL_ANIMATION: &str = "animation";

/// 设置窗口标签
pub const WINDOW_LABEL_SETTINGS: &str = "settings";

/// 模块管理窗口标签
pub const WINDOW_LABEL_MODS: &str = "mods";

/// 关于窗口标签
pub const WINDOW_LABEL_ABOUT: &str = "about";

// ========================================================================= //
// 托盘标识符常量
// ========================================================================= //

/// 主托盘图标ID
pub const TRAY_ID_MAIN: &str = "main";

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
pub const MAX_BUTTONS_PER_ROW: u32 = 2;

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

/// 拖动中状态名称（持续状态）
///
pub const STATE_DRAGGING: &str = "dragging";
/// 开始拖动状态名称（通常 play_once）
pub const STATE_DRAG_START: &str = "drag_start";
/// 结束拖动状态名称（通常 play_once）
pub const STATE_DRAG_END: &str = "drag_end";

pub const STATE_MUSIC: &str = "music";
pub const STATE_MUSIC_START: &str = "music_start";
pub const STATE_MUSIC_END: &str = "music_end";

pub const STATE_BIRTHDAY: &str = "birthday";
pub const STATE_FIRSTDAY: &str = "firstday";

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

/// 工作事件（由“进程监测”等后台功能触发）
pub const EVENT_WORK: &str = "work";

/// Animation 窗口开始拖动事件
pub const EVENT_ANIMATION_DRAG_START: &str = "drag_start";


/// Animation 窗口结束拖动事件
pub const EVENT_ANIMATION_DRAG_END: &str = "drag_end";


// ========================================================================= //
// 媒体监听常量
// ========================================================================= //

/// 媒体事件启动延迟（秒）
///
/// **用途**: 确保媒体相关事件（如 `music_start`）不会在 `login` 事件之前触发，
/// 让用户先看到登录动画，再响应媒体播放事件。
pub const MEDIA_EVENT_STARTUP_DELAY_SECS: u64 = 5;


/// Core Audio 轮询超时间隔（秒）
///
/// **用途**: GSMTC API 有事件通知，但 Core Audio API 没有，
/// 需要定期轮询检测不支持 GSMTC 的应用（如网页播放器）的音频状态。
/// 
/// 注意：当 GSMTC 可用时（Windows 10 1809+），大多数媒体应用会触发 GSMTC 事件，
/// 所以这个轮询主要是为不支持 GSMTC 的应用（如浏览器播放）提供保底检测。
/// 间隔设置为 2 秒以平衡响应速度和系统资源消耗。
pub const CORE_AUDIO_POLL_INTERVAL_SECS: u64 = 2;

/// 音量峰值阈值
///
/// **用途**: 判断音频是否达到有效播放水平的阈值。
pub const AUDIO_PEAK_THRESHOLD: f32 = 0.001;

// ========================================================================= //
// 环境信息常量
// ========================================================================= //

/// 天气缓存有效期（秒）
///
/// **用途**: 天气信息不需要实时更新，30 分钟缓存可减少 API 请求次数。
pub const WEATHER_CACHE_DURATION_SECS: u64 = 1800;

/// 天气 API 请求超时（秒）
///
/// **用途**: wttr.in API 响应较慢，设置较长超时以避免请求失败。
pub const WEATHER_API_TIMEOUT_SECS: u64 = 30;

/// 地理位置 API 请求超时（秒）
///
/// **用途**: ip-api.com API 超时限制，避免网络不佳时无限等待。
pub const LOCATION_API_TIMEOUT_SECS: u64 = 30;

// ========================================================================= //
// 定时触发器常量
// ========================================================================= //

/// 触发器最小触发间隔时间（秒）
///
/// **用途**: 防止状态过于频繁切换，至少间隔 5 分钟才会触发下一次随机事件。
pub const MIN_TRIGGER_TIME_SECS: f32 = 1.0;

/// 定时触发器检查间隔（秒）
///
/// **用途**: 后台线程每隔此时间检查一次是否需要触发随机状态切换。
pub const TIMER_TRIGGER_CHECK_INTERVAL_SECS: u64 = MIN_TRIGGER_TIME_SECS as u64;

// ========================================================================= //
// 状态管理常量
// ========================================================================= //

/// 等待状态解锁的重试间隔（毫秒）
///
/// **用途**: 当临时状态播放中（锁定中）时，等待解锁的轮询间隔。
pub const STATE_LOCK_WAIT_INTERVAL_MS: u64 = 500;

/// 等待状态解锁的最大重试次数
///
/// **用途**: 最多等待 60 × 500ms = 30 秒，超过则放弃等待。
pub const STATE_LOCK_MAX_RETRIES: u32 = 60;

// ========================================================================= //
// 系统观察者常量
// ========================================================================= //

/// 系统观察者轮询间隔（秒）
///
/// **用途**: 全屏检测的保底轮询间隔，每秒检查一次。
/// 主要依赖 Windows 事件钩子，轮询仅作为保底机制。
pub const SYSTEM_OBSERVER_POLL_INTERVAL_SECS: u64 = 3;

/// 系统观察者去抖动延迟（毫秒）
///
/// **用途**: 窗口切换事件后等待窗口动效完成再检测全屏状态，
/// 避免动画过程中的误判。
pub const SYSTEM_OBSERVER_DEBOUNCE_MS: u64 = 1500;

/// 锁屏时是否允许触发免打扰模式
///
/// **用途**: 控制在系统锁屏状态下，是否允许因全屏窗口触发免打扰模式。
/// - true: 锁屏时不触发免打扰（避免锁屏窗口误判为全屏应用）
/// - false: 锁屏时仍然可能触发免打扰
pub const SYSTEM_OBSERVER_SUPPRESS_DND_WHEN_LOCKED: bool = false;

// ========================================================================= //
// 窗口操作常量
// ========================================================================= //

/// 重建动画窗口时的延迟时间（毫秒）
///
/// **用途**: 等待旧窗口完全销毁后再创建新窗口，
/// 避免窗口句柄冲突。
pub const WINDOW_RESIZE_DELAY_MS: u64 = 300;

/// Mod 加载前的窗口销毁延迟（毫秒）
///
/// **用途**: 切换 Mod 时先销毁旧窗口，等待此时间后创建新窗口。
pub const MOD_SWITCH_WINDOW_DELAY_MS: u64 = 300;

/// Mod 加载后触发登录事件的延迟（秒）
///
/// **用途**: Mod 加载和窗口重建完成后，等待此时间再触发登录事件，
/// 避免状态冲突。
pub const MOD_LOGIN_EVENT_DELAY_SECS: u64 = 1;

// ========================================================================= //
// 会话观察者常量
// ========================================================================= //

/// 非 Windows 平台的会话检测轮询间隔（秒）
///
/// **用途**: 非 Windows 平台使用简化的轮询方式检测用户登录状态，
/// 每隔此时间检查一次是否需要触发登录事件。
pub const SESSION_OBSERVER_POLL_INTERVAL_SECS: u64 = 2;

// ========================================================================= //
// 资源加载常量
// ========================================================================= //

/// mods 文件夹查找的最大父目录级数
///
/// **用途**: 从可执行文件所在目录开始向上查找 mods 文件夹时的最大搜索深度。
pub const MODS_SEARCH_MAX_LEVELS_EXE: u32 = 4;

/// mods 文件夹查找的最大父目录级数（开发环境）
///
/// **用途**: 从当前工作目录开始向上查找 mods 文件夹时的最大搜索深度。
pub const MODS_SEARCH_MAX_LEVELS_CWD: u32 = 2;

// ========================================================================= //
// 系统相关常量
// ========================================================================= //

/// 全屏覆盖阈值（像素）
///
/// **用途**: 判断窗口是否覆盖全屏时的最小覆盖范围（像素）。
pub const FULLSCREEN_COVERAGE_THRESHOLD: i32 = 5;
