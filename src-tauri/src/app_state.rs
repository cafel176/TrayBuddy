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
///
/// # 锁序规范（Lock Ordering Convention）
///
/// 当需要同时持有多把锁时，**必须**按以下顺序获取，以防止死锁：
///
/// ```text
/// storage → resource_manager → state_manager
///                               ↓
///                          archive_store
/// ```
///
/// 即：
/// 1. `storage` 优先级最高，必须最先获取（并在获取其他锁之前释放）
/// 2. `resource_manager` 次之
/// 3. `state_manager` 最后获取
/// 4. `archive_store` 可在 `resource_manager` 之后获取（但不可在持有 `archive_store` 时反向获取 rm）
///
/// **关键规则**：
/// - 绝不可在持有 `state_manager` 锁时获取 `storage` 锁
/// - 绝不可在持有 `archive_store` 锁时获取 `resource_manager` 锁
/// - 在需要 storage 数据来过滤状态的场景，使用 `StateLimitsContext::prefetch()` 在获取 rm/sm 之前预取
/// - 各全局静态 Mutex（`CACHED_MEDIA_STATE` 等）互不嵌套，可独立获取释放
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

    /// 待处理的“通过系统打开的 Mod 包路径”队列（双击 .tbuddy/.sbuddy）
    /// - 冷启动：setup 时写入；
    /// - 已运行：single-instance 回调写入。
    /// 前端 Mods 页面会在 mount 时取走并触发导入。
    pub pending_open_mod_archives: Mutex<Vec<String>>,

    /// Mod 包内存存储：管理从 .tbuddy 加载到内存中的 archive 实例
    pub archive_store: Arc<Mutex<ModArchiveStore>>,
}

impl AppState {
    /// 安全地触发事件（封装正确的锁获取顺序）
    ///
    /// 按照锁序规范 `storage → resource_manager → state_manager` 的顺序获取锁，
    /// 避免调用者手动管理锁顺序时出错。
    ///
    /// # 参数
    /// - `event_name`: 触发器事件名称
    /// - `force`: 是否强制切换（忽略优先级与锁定检查）
    pub(crate) fn trigger_event(&self, event_name: &str, force: bool) -> Result<bool, String> {
        use crate::modules::state::StateLimitsContext;
        use crate::modules::trigger::TriggerManager;

        // 1. 先从 storage 预取限制判断数据（获取并立即释放 storage 锁）
        let limits_ctx = StateLimitsContext::prefetch(self);
        // 2. 获取 resource_manager 锁
        let rm = self.resource_manager.lock().unwrap();
        // 3. 获取 state_manager 锁
        let mut sm = self.state_manager.lock().unwrap();
        // 4. 执行触发
        TriggerManager::trigger_event(event_name, force, &rm, &mut sm, &limits_ctx)
    }

    /// 在 `spawn_blocking` 中读取 `UserSettings` 的指定字段，避免在 async 上下文中阻塞 tokio 线程。
    ///
    /// # 用法
    /// ```ignore
    /// let (key, url) = AppState::read_settings_async(&app, |s| {
    ///     (s.ai_api_key.to_string(), s.ai_chat_base_url.to_string())
    /// }, (String::new(), String::new())).await;
    /// ```
    pub async fn read_settings_async<T, F>(
        app: &tauri::AppHandle,
        f: F,
        default: T,
    ) -> T
    where
        T: Send + 'static,
        F: FnOnce(&crate::modules::storage::UserSettings) -> T + Send + 'static,
    {
        let app_clone = app.clone();
        tokio::task::spawn_blocking(move || {
            use tauri::Manager;
            let app_state: tauri::State<AppState> = app_clone.state();
            let storage = app_state.storage.lock().unwrap();
            f(&storage.data.settings)
        })
        .await
        .unwrap_or(default)
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guess_mime_type_handles_known_and_unknown() {
        assert_eq!(guess_mime_type("config.json"), "application/json");
        assert_eq!(guess_mime_type("sound.mp3"), "audio/mpeg");
        assert_eq!(guess_mime_type("image.unknown"), "application/octet-stream");
    }

    #[test]
    fn urlencoding_decode_handles_percent_sequences() {
        assert_eq!(urlencoding_decode("hello%20world"), "hello world");
        assert_eq!(urlencoding_decode("%E4%BD%A0%E5%A5%BD"), "你好");
        assert_eq!(urlencoding_decode("100%"), "100%");
    }
}

