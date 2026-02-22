//! 应用状态与基础工具

use crate::modules::media_observer::MediaObserver;
use crate::modules::mod_archive::ModArchiveStore;
use crate::modules::resource::ResourceManager;
use crate::modules::state::StateManager;
use crate::modules::storage::Storage;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, OnceLock};

// ========================================================================= //
// 提醒弹窗 Payload
// ========================================================================= //

#[derive(Debug, Clone, serde::Serialize)]
pub struct ReminderAlertPayload {
    pub id: String,
    pub text: String,
    pub scheduled_at: i64,
    pub fired_at: i64,
}

// ========================================================================= //
// 全局静态标记
// ========================================================================= //

/// 标记桌面会话检测是否已启动
/// 防止重复启动导致资源泄漏
pub(crate) static SESSION_OBSERVER_STARTED: AtomicBool = AtomicBool::new(false);

/// 标记后台服务是否已启动
/// 防止重复启动导致资源泄漏
pub(crate) static BACKGROUND_SERVICES_STARTED: AtomicBool = AtomicBool::new(false);

/// 待展示的提醒弹窗队列（提醒调度线程写入，提示窗口读取）
pub(crate) static PENDING_REMINDER_ALERTS: Mutex<Vec<ReminderAlertPayload>> =
    Mutex::new(Vec::new());

pub(crate) static REMINDER_SCHEDULER_NOTIFY: OnceLock<tokio::sync::Notify> = OnceLock::new();
pub(crate) static STATE_UNLOCK_NOTIFY: OnceLock<tokio::sync::Notify> = OnceLock::new();

pub(crate) fn get_reminder_scheduler_notify() -> &'static tokio::sync::Notify {
    REMINDER_SCHEDULER_NOTIFY.get_or_init(tokio::sync::Notify::new)
}

pub(crate) fn get_state_unlock_notify() -> &'static tokio::sync::Notify {
    STATE_UNLOCK_NOTIFY.get_or_init(tokio::sync::Notify::new)
}


/// 进程触发 work 事件的节流时间（Unix 秒）
pub(crate) static LAST_WORK_EVENT_AT: std::sync::Mutex<Option<i64>> = std::sync::Mutex::new(None);

// ========================================================================= //
// 日期验证常量
// ========================================================================= //

/// 月份最小值
pub const MONTH_MIN: u32 = 1;

/// 月份最大值
pub const MONTH_MAX: u32 = 12;

/// 日期最小值
pub const DAY_MIN: u32 = 1;

/// 日期最大值
pub const DAY_MAX: u32 = 31;

// ========================================================================= //
// 应用全局状态与初始化
// ========================================================================= //

/// 应用全局状态
///
/// 该结构体被封装在 `Arc` 中并通过 Tauri 的 `manage` 系统进行管理，
/// 允许在所有的 `tauri::command` 处理函数中通过 `State<AppState>` 安全地共享访问。
/// 所有内部成员都使用同步锁（Mutex/Atomic）以保证在多线程环境下的数据安全。
pub struct AppState {
    /// 资源管理器：负责 Mod 的扫描、加载、卸载及资源路径的解析与查询
    pub resource_manager: Arc<Mutex<ResourceManager>>,
    /// 状态管理器：驱动角色的状态机，处理状态切换逻辑、动画序列生成以及触发器响应
    pub state_manager: Mutex<StateManager>,
    /// 存储管理器：负责本地配置（settings.json）和用户数据（info.json）的持久化读写
    pub(crate) storage: Mutex<Storage>,
    /// 媒体监听器引用：在独立线程中运行，用于捕获系统媒体播放状态并反馈给状态机
    pub(crate) media_observer: Mutex<Option<MediaObserver>>,
    /// 系统会话锁屏状态：原子布尔值，用于实时标记 Windows 是否处于锁屏或 UAC 界面，
    /// 从而辅助状态机决定是否应进入静默/免打扰模式。
    pub(crate) session_locked: Arc<AtomicBool>,
    /// 全局键盘监听开关：由当前 Mod 的 global_keyboard 字段控制
    pub(crate) global_keyboard_enabled: Arc<AtomicBool>,
    /// 全局鼠标监听开关：由当前 Mod 的 global_mouse 字段控制
    pub(crate) global_mouse_enabled: Arc<AtomicBool>,


    /// Mod 包内存存储：管理从 .tbuddy 加载到内存中的 archive 实例
    pub archive_store: Arc<Mutex<ModArchiveStore>>,
}

// ========================================================================= //
// 核心辅助工具
// ========================================================================= //

/// 检查当前是否为 Release 优化构建
pub(crate) fn is_release_build() -> bool {
    !cfg!(debug_assertions)
}

/// 根据文件扩展名推断 MIME 类型（用于自定义协议 tbuddy-asset://）
pub(crate) fn guess_mime_type(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "json" | "json3" => "application/json",
        "js" => "application/javascript",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "txt" => "text/plain",
        "xml" => "application/xml",
        // 图片
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        // 音频
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "m4a" => "audio/mp4",
        "weba" => "audio/webm",
        // Live2D
        "moc3" => "application/octet-stream",
        "mtn" => "application/octet-stream",
        "exp3" | "exp" => "application/json",
        "physics3" | "physics" => "application/json",
        "pose3" | "pose" => "application/json",
        "model3" | "model" => "application/json",
        // 其他
        _ => "application/octet-stream",
    }
}

/// 简单 URL 解码（百分号编码 → 原始字符）
pub(crate) fn urlencoding_decode(input: &str) -> String {
    let mut result = Vec::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(val) = u8::from_str_radix(hex, 16) {
                    result.push(val);
                    i += 3;
                    continue;
                }
            }
        }
        result.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&result).into()
}
