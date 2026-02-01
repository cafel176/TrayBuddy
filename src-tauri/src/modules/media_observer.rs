//! 媒体状态监听模块
//!
//! 混合使用两种 Windows API 监听系统音频播放状态：
//! - **GSMTC** (GlobalSystemMediaTransportControls): 获取媒体元数据（标题、艺术家）
//! - **Core Audio API** (IAudioSessionManager2): 检测所有正在播放音频的进程（包括不支持 SMTC 的应用）

#![allow(unused)]

use super::event_manager::{DEBUG_EVENT_TYPE_MEDIA, emit_debug_update};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::Manager;
use tokio::sync::mpsc;

// ========================================================================= //
// 字符串常量
// ========================================================================= //

/// 播放状态：播放中
const PLAYBACK_STATUS_PLAYING: &str = "Playing";

/// 播放状态：已暂停
const PLAYBACK_STATUS_PAUSED: &str = "Paused";

/// 播放状态：已停止
const PLAYBACK_STATUS_STOPPED: &str = "Stopped";

/// 播放状态：已关闭
const PLAYBACK_STATUS_CLOSED: &str = "Closed";

/// 播放状态：已打开
const PLAYBACK_STATUS_OPENED: &str = "Opened";

/// 播放状态：切换中
const PLAYBACK_STATUS_CHANGING: &str = "Changing";

/// 播放状态：未知
const PLAYBACK_STATUS_UNKNOWN: &str = "Unknown";

// ========================================================================= //

/// 会话状态：活跃
const SESSION_STATE_ACTIVE: &str = "Active";

/// 会话状态：非活跃
const SESSION_STATE_INACTIVE: &str = "Inactive";

/// 会话状态：已过期
const SESSION_STATE_EXPIRED: &str = "Expired";

// ========================================================================= //

/// 状态源：GSMTC（播放中）
const STATE_SOURCE_GSMTC_PLAYING: &str = "GSMTC (Playing)";

/// 状态源：GSMTC（已暂停）
const STATE_SOURCE_GSMTC_PAUSED: &str = "GSMTC (Paused)";

/// 状态源：Core Audio
const STATE_SOURCE_CORE_AUDIO: &str = "Core Audio";

/// 状态源：Core Audio + GSMTC 元数据
const STATE_SOURCE_CORE_AUDIO_GSMTC: &str = "Core Audio + GSMTC metadata";

/// 状态源：无（已停止）
const STATE_SOURCE_NONE_STOPPED: &str = "None (Stopped)";

/// 状态：错误
const STATUS_ERROR: &str = "Error";

/// 状态：无信息
const STATUS_NO_INFO: &str = "NoInfo";

// ========================================================================= //

/// 时间格式：短格式（小时:分钟:秒）
const TIME_FORMAT_SHORT: &str = "%H:%M:%S";

// ========================================================================= //
// 全局缓存
// ========================================================================= //

/// 观察者启动时间
static OBSERVER_START_TIME: Mutex<Option<Instant>> = Mutex::new(None);

// ========================================================================= //

/// 缓存的媒体状态
static CACHED_MEDIA_STATE: Mutex<Option<MediaStateEvent>> = Mutex::new(None);

/// 获取缓存的媒体状态
pub fn get_cached_media_state() -> Option<MediaStateEvent> {
    CACHED_MEDIA_STATE
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

/// 更新缓存的媒体状态
/// 只有音乐应用的状态变动才会被保存
fn update_cached_media_state(event: &MediaStateEvent) {
    // 如果 app_id 为 None，说明所有音乐应用都已退出，清除缓存
    if event.app_id.is_none() {
        #[cfg(debug_assertions)]
        println!("[MediaObserver] 清除媒体状态缓存（app_id 为 None）");
        if let Ok(mut guard) = CACHED_MEDIA_STATE.lock() {
            *guard = None;
        }
        return;
    }

    // 检查是否是音乐应用
    let should_save = event.app_id.as_deref().map(|id| is_music_app(id)).unwrap_or(false);

    if !should_save {
        return;
    }

    #[cfg(debug_assertions)]
    println!(
        "[MediaObserver] 更新媒体状态缓存 - Status: {:?}, App: {}, Title: {:?}",
        event.status,
        event.app_id.as_deref().unwrap_or("Unknown"),
        event.title.as_deref()
    );

    if let Ok(mut guard) = CACHED_MEDIA_STATE.lock() {
        *guard = Some(event.clone());
    }
}

// ========================================================================= //

/// 缓存的调试信息
static CACHED_DEBUG_INFO: Mutex<Option<MediaDebugInfo>> = Mutex::new(None);

/// 获取缓存的调试信息
pub fn get_cached_debug_info() -> Option<MediaDebugInfo> {
    CACHED_DEBUG_INFO
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

/// 更新缓存的调试信息
fn update_cached_debug_info(info: MediaDebugInfo) {
    if let Ok(mut guard) = CACHED_DEBUG_INFO.lock() {
        *guard = Some(info);
    }
}

// ========================================================================= //
// 辅助函数
// ========================================================================= //

/// 检查应用名称是否为音乐应用
///
/// 根据应用 ID 判断是否为音乐播放器应用
///
/// # 参数
///
/// * `app_id` - 应用 ID 或进程名
///
/// # 返回
///
/// 如果是音乐播放器返回 `true`，否则返回 `false`
///
/// # 示例
///
/// ```rust,ignore
/// if is_music_app("spotify") {
///     println!("这是音乐应用");
/// }
/// ```
pub fn is_music_app(app_id: &str) -> bool {
    let app_lower = app_id.to_lowercase();

    // 常见音乐播放器关键字
    let music_keywords = [
        "music",      // 通用：Apple Music, Windows Media Player 等
        "音乐",       // 中文音乐应用
        "player",     // 通用播放器：PotPlayer, MPC-HC Player 等
        "spotify",    // Spotify
        "qqmusic",    // QQ音乐
        "kugou",      // 酷狗音乐
        "kuwo",       // 酷我音乐
        "foobar",     // foobar2000
        "aimp",       // AIMP
        "winamp",     // Winamp
        "vlc",        // VLC
        "musicbee",   // MusicBee
        "groove",     // Groove Music
        "itunes",     // iTunes
        "netease",    // 网易云音乐 (NetEase Cloud Music)
        "cloudmusic", // 网易云音乐进程名
        "mpv",        // mpv 播放器
        "mpc-hc",     // Media Player Classic
        "wmplayer",   // Windows Media Player
    ];

    // 检查关键字（支持带空格的名称如 "cloud music"）
    let app_no_space = app_lower.replace(" ", "");

    music_keywords
        .iter()
        .any(|&keyword| app_lower.contains(keyword) || app_no_space.contains(keyword))
}

// ========================================================================= //
// 类型定义
// ========================================================================= //

/// 媒体播放状态
#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum MediaPlaybackStatus {
    /// 正在播放
    Playing,
    /// 已暂停
    Paused,
    /// 已停止
    Stopped,
    /// 未知状态
    Unknown,
}

/// 媒体状态变更事件
#[derive(Debug, Clone, Serialize)]
pub struct MediaStateEvent {
    pub status: MediaPlaybackStatus,
    pub title: Option<Box<str>>,
    pub artist: Option<Box<str>>,
    /// 播放应用的进程名/App ID
    pub app_id: Option<Box<str>>,
}

/// GSMTC 会话信息（调试用）
#[derive(Debug, Clone, Serialize)]
pub struct GsmtcSessionInfo {
    /// 应用 ID
    pub app_id: Box<str>,
    /// 播放状态
    pub status: Box<str>,
    /// 标题
    pub title: Option<Box<str>>,
    /// 艺术家
    pub artist: Option<Box<str>>,
    /// 是否被识别为音乐应用
    pub is_music_app: bool,
}

/// Core Audio 会话信息（调试用）
#[derive(Debug, Clone, Serialize)]
pub struct CoreAudioSessionInfo {
    /// 进程 ID
    pub pid: u32,
    /// 进程名
    pub process_name: Box<str>,
    /// 会话状态
    pub session_state: Box<str>,
    /// 音量峰值
    pub peak_value: f32,
    /// 是否被识别为音乐应用
    pub is_music_app: bool,
    /// 是否正在播放（峰值 > 阈值）
    pub is_playing: bool,
}

/// 媒体调试信息
#[derive(Debug, Clone, Serialize)]
pub struct MediaDebugInfo {
    /// 观察者是否运行中
    pub observer_running: bool,
    /// 运行时间（秒）
    pub uptime_secs: u64,
    /// 最后检查时间
    pub last_check_time: Box<str>,
    /// GSMTC 是否可用
    pub gsmtc_available: bool,
    /// Core Audio 是否可用
    pub core_audio_available: bool,
    /// GSMTC 会话列表
    pub gsmtc_sessions: Vec<GsmtcSessionInfo>,
    /// Core Audio 会话列表
    pub core_audio_sessions: Vec<CoreAudioSessionInfo>,
    /// 当前综合状态
    pub combined_state: MediaStateEvent,
    /// 状态来源
    pub state_source: Box<str>,
    /// 已注册的 GSMTC 事件数量
    pub registered_session_events: usize,
}

// ========================================================================= //

/// 媒体观察者 - 通过混合 API 监听系统音频播放状态
pub struct MediaObserver {
    /// 事件发送通道
    event_tx: Option<mpsc::UnboundedSender<MediaStateEvent>>,
    /// 是否正在运行
    running: Arc<std::sync::atomic::AtomicBool>,
}

impl MediaObserver {
    /// 创建新的媒体观察者
    pub fn new() -> Self {
        Self {
            event_tx: None,
            running: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    // ========================================================================= //

    /// 启动媒体监听（返回事件接收通道）
    pub fn start(
        &mut self,
        app_handle: tauri::AppHandle,
        skip_delay: bool,
    ) -> mpsc::UnboundedReceiver<MediaStateEvent> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.event_tx = Some(tx.clone());
        self.running
            .store(true, std::sync::atomic::Ordering::SeqCst);

        let running = self.running.clone();

        // 启动异步监听任务
        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
            rt.block_on(async move {
                Self::media_event_loop(tx, running, app_handle, skip_delay).await;
            });
        });

        rx
    }

    /// 停止媒体监听
    pub fn stop(&mut self) {
        self.running
            .store(false, std::sync::atomic::Ordering::SeqCst);
        self.event_tx = None;
    }

    // ========================================================================= //
    // Windows 混合 API 实现
    // ========================================================================= //

    /// 媒体事件监听循环（混合 GSMTC + Core Audio）
    #[cfg(windows)]
    async fn media_event_loop(
        tx: mpsc::UnboundedSender<MediaStateEvent>,
        running: Arc<std::sync::atomic::AtomicBool>,
        app_handle: tauri::AppHandle,
        skip_delay: bool,
    ) {
        use crate::modules::constants::MEDIA_EVENT_STARTUP_DELAY_SECS;
        use crate::modules::utils::os_version::is_gsmtc_available;
        use std::sync::atomic::Ordering;
        use tokio::sync::mpsc as tokio_mpsc;

        // 记录启动时间
        if let Ok(mut guard) = OBSERVER_START_TIME.lock() {
            *guard = Some(Instant::now());
        }

        // 启动延迟：等待应用初始化和 login 事件完成
        if !skip_delay {
            tokio::time::sleep(tokio::time::Duration::from_secs(
                MEDIA_EVENT_STARTUP_DELAY_SECS,
            ))
            .await;
        }

        // 初始化 COM（Core Audio 需要）
        let com_initialized = Self::init_com();
        if !com_initialized {
            eprintln!("[MediaObserver] COM 初始化失败");
            return;
        }

        // 检查 GSMTC 是否可用（Windows 10 1809+）
        // Windows 7/8/8.1 不支持 GSMTC，仅使用 Core Audio API
        let gsmtc_supported = is_gsmtc_available();

        #[cfg(debug_assertions)]
        if !gsmtc_supported {
            println!("[MediaObserver] GSMTC 不可用（需要 Windows 10 1809+），仅使用 Core Audio API");
        }

        // 获取 GSMTC 媒体会话管理器（可选，用于获取元数据）
        // 仅在支持的系统上尝试初始化
        let gsmtc_manager = if gsmtc_supported {
            tokio::task::block_in_place(|| {
                use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
                GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
                    .ok()
                    .and_then(|op| op.get().ok())
            })
        } else {
            None
        };

        // 创建内部事件通道
        let (internal_tx, mut internal_rx) = tokio_mpsc::unbounded_channel::<()>();

        // 用于跟踪状态变化
        let state = Arc::new(Mutex::new(MediaObserverState::new()));

        // 注册 GSMTC 事件（如果可用）
        let sessions_token: Option<windows::Foundation::EventRegistrationToken> =
            if let Some(ref manager) = gsmtc_manager {
                use windows::Foundation::TypedEventHandler;
                use windows::Media::Control::{
                    GlobalSystemMediaTransportControlsSessionManager, SessionsChangedEventArgs,
                };
                let internal_tx_sessions = internal_tx.clone();
                let sessions_handler = TypedEventHandler::<
                    GlobalSystemMediaTransportControlsSessionManager,
                    SessionsChangedEventArgs,
                >::new(move |_, _| {
                    let _ = internal_tx_sessions.send(());
                    windows::core::Result::Ok(())
                });
                manager.SessionsChanged(&sessions_handler).ok()
            } else {
                None
            };

        // 存储 GSMTC 会话事件 token
        let session_tokens = Arc::new(Mutex::new(Vec::<SessionEventTokens>::new()));

        // 初始注册 GSMTC 会话事件
        if let Some(ref manager) = gsmtc_manager {
            Self::register_gsmtc_session_events(manager, &internal_tx, &session_tokens);
        }

        // 获取初始状态并发送
        let (initial_event, initial_source) =
            Self::get_combined_media_state_with_source(gsmtc_manager.as_ref());

        // 更新初始调试信息
        Self::update_debug_info(
            &app_handle,
            &running,
            gsmtc_manager.as_ref(),
            com_initialized,
            &session_tokens,
            &initial_event,
            &initial_source,
        );

        // 更新初始状态
        if running.load(Ordering::SeqCst) {
            update_cached_media_state(&initial_event);
            let mut state_guard = state.lock().unwrap();

            // 记录初始状态但不一定发送
            // 只有当初始就是 Playing 时才发送（触发 music_start）
            // 如果初始是 Stopped/Paused，没必要在程序启动时立即发送，避免触发不必要的 music_end
            let should_send = initial_event.status == MediaPlaybackStatus::Playing;

            state_guard.update(&initial_event);
            if should_send {
                let _ = tx.send(initial_event);
            }
        }

        // 主事件循环
        while running.load(Ordering::SeqCst) {
            // 等待 GSMTC 事件通知或超时（超时用于轮询 Core Audio）
            // Core Audio 没有事件通知，需要定期轮询
            let _ = tokio::time::timeout(
                tokio::time::Duration::from_secs(
                    crate::modules::constants::CORE_AUDIO_POLL_INTERVAL_SECS,
                ),
                internal_rx.recv(),
            )
            .await;

            if !running.load(Ordering::SeqCst) {
                break;
            }

            // 重新注册 GSMTC 会话事件
            if let Some(ref manager) = gsmtc_manager {
                Self::register_gsmtc_session_events(manager, &internal_tx, &session_tokens);
            }

            // 获取当前状态（混合 GSMTC + Core Audio）
            let (current_event, state_source) =
                Self::get_combined_media_state_with_source(gsmtc_manager.as_ref());

            // 检查是否有变化
            let mut state_guard = state.lock().unwrap();
            let has_changed = state_guard.has_changed(&current_event);

            // 只在状态变化时更新调试信息（减少内存分配）
            if has_changed {
                Self::update_debug_info(
                    &app_handle,
                    &running,
                    gsmtc_manager.as_ref(),
                    com_initialized,
                    &session_tokens,
                    &current_event,
                    &state_source,
                );
            }

            if has_changed {
                let should_send = match current_event.status {
                    MediaPlaybackStatus::Playing => true,
                    MediaPlaybackStatus::Paused | MediaPlaybackStatus::Stopped => {
                        state_guard.has_played
                    }
                    MediaPlaybackStatus::Unknown => true,
                };

                #[cfg(debug_assertions)]
                println!(
                    "[MediaObserver] 状态变化 - 从 {:?} -> {:?}, App: {}, 标题: {:?}, 来源: {}, 发送事件: {}",
                    state_guard.last_status,
                    current_event.status,
                    current_event.app_id.as_deref().unwrap_or("None"),
                    current_event.title.as_deref(),
                    state_source,
                    should_send
                );

                update_cached_media_state(&current_event);
                state_guard.update(&current_event);
                drop(state_guard);

                if should_send && tx.send(current_event).is_err() {
                    break;
                }
            }
        }

        // 清理 GSMTC 事件监听
        if let (Some(ref manager), Some(token)) = (&gsmtc_manager, sessions_token) {
            let _ = manager.RemoveSessionsChanged(token);
        }

        // 清理会话事件 token
        if let Ok(tokens) = session_tokens.lock() {
            for session_token in tokens.iter() {
                session_token.cleanup();
            }
        }
        drop(session_tokens);
    }

    /// 初始化 COM 库
    #[cfg(windows)]
    fn init_com() -> bool {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

        unsafe {
            // COINIT_MULTITHREADED 适用于多线程环境
            CoInitializeEx(None, COINIT_MULTITHREADED).is_ok()
        }
    }

    /// 获取混合媒体状态（优先 GSMTC，回退到 Core Audio）
    #[cfg(windows)]
    fn get_combined_media_state(
        gsmtc_manager: Option<
            &windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager,
        >,
    ) -> MediaStateEvent {
        Self::get_combined_media_state_with_source(gsmtc_manager).0
    }

    /// 获取混合媒体状态，同时返回来源信息（调试用）
    #[cfg(windows)]
    fn get_combined_media_state_with_source(
        gsmtc_manager: Option<
            &windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager,
        >,
    ) -> (MediaStateEvent, String) {
        // 从 GSMTC 获取状态（有元数据）
        let gsmtc_event = gsmtc_manager.map(Self::get_gsmtc_media_state);

        // 从 Core Audio 获取状态（检测所有播放音频的进程）
        let core_audio_event = tokio::task::block_in_place(|| Self::get_core_audio_media_state());

        // 判断逻辑：
        // 1. 如果 GSMTC 检测到正在播放 -> 返回 GSMTC 结果（有元数据）
        // 2. 如果 Core Audio 检测到正在播放 -> 返回 Core Audio 结果（尝试补充 GSMTC 元数据）
        // 3. 如果 GSMTC 检测到暂停 -> 返回暂停状态
        // 4. 否则返回停止状态

        // 检查 GSMTC 播放状态
        if let Some(ref event) = gsmtc_event {
            if event.status == MediaPlaybackStatus::Playing {
                #[cfg(debug_assertions)]
                println!(
                    "[MediaObserver] GSMTC 检测到播放 - App: {}, Title: {:?}",
                    event.app_id.as_deref().unwrap_or("Unknown"),
                    event.title.as_deref()
                );
                return (event.clone(), STATE_SOURCE_GSMTC_PLAYING.to_string());
            }
        }

        // 检查 Core Audio 播放状态
        if let Some(ref event) = core_audio_event {
            if event.status == MediaPlaybackStatus::Playing {
                #[cfg(debug_assertions)]
                println!(
                    "[MediaObserver] Core Audio 检测到播放 - App: {}",
                    event.app_id.as_deref().unwrap_or("Unknown")
                );
                // 尝试从 GSMTC 补充元数据
                if let Some(ref gsmtc) = gsmtc_event {
                    if gsmtc.title.is_some() || gsmtc.artist.is_some() {
                        #[cfg(debug_assertions)]
                        println!(
                            "[MediaObserver] 补充 GSMTC 元数据 - Title: {:?}, Artist: {:?}",
                            gsmtc.title.as_deref(),
                            gsmtc.artist.as_deref()
                        );
                        return (
                            MediaStateEvent {
                                status: MediaPlaybackStatus::Playing,
                                title: gsmtc.title.clone(),
                                artist: gsmtc.artist.clone(),
                                app_id: event.app_id.clone(),
                            },
                            STATE_SOURCE_CORE_AUDIO_GSMTC.into(),
                        );
                    }
                }
                return (event.clone(), STATE_SOURCE_CORE_AUDIO.into());
            }
        }

        // 如果 GSMTC 检测到暂停或停止状态，需要用 Core Audio 验证进程是否还在
        if let Some(ref event) = gsmtc_event {
            if event.status == MediaPlaybackStatus::Paused || event.status == MediaPlaybackStatus::Stopped {
                // 如果 Core Audio 检测到没有应用在播放，说明应用已退出，返回 Stopped
                if core_audio_event.is_none() {
                    #[cfg(debug_assertions)]
                    println!(
                        "[MediaObserver] 应用已退出 - GSMTC: {:?}, Core Audio: None, 返回 Stopped",
                        event.status
                    );
                    return (
                        MediaStateEvent {
                            status: MediaPlaybackStatus::Stopped,
                            title: None,
                            artist: None,
                            app_id: None,  // 应用已退出，清除 app_id
                        },
                        STATE_SOURCE_NONE_STOPPED.into(),
                    );
                }
                // 否则返回 GSMTC 的状态
                #[cfg(debug_assertions)]
                println!(
                    "[MediaObserver] 应用暂停/停止但仍在运行 - GSMTC: {:?}, Core Audio: Playing, 返回 GSMTC 状态",
                    event.status
                );
                return (event.clone(), STATE_SOURCE_GSMTC_PAUSED.into());
            }
        }

        // 默认返回停止状态
        // 不再保留 app_id，因为所有应用都已经退出或停止
        #[cfg(debug_assertions)]
        println!(
            "[MediaObserver] 默认返回停止状态 - GSMTC: None, Core Audio: None",
        );

        (
            MediaStateEvent {
                status: MediaPlaybackStatus::Stopped,
                title: None,
                artist: None,
                app_id: None,  // 清除 app_id，表示没有活跃的音乐应用
            },
            STATE_SOURCE_NONE_STOPPED.into(),
        )
    }

    /// 更新调试信息
    #[cfg(windows)]
    fn update_debug_info(
        app_handle: &tauri::AppHandle,
        running: &Arc<std::sync::atomic::AtomicBool>,
        gsmtc_manager: Option<
            &windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager,
        >,
        core_audio_available: bool,
        session_tokens: &Arc<Mutex<Vec<SessionEventTokens>>>,
        combined_state: &MediaStateEvent,
        state_source: &str,
    ) {
        use chrono::Local;
        use std::sync::atomic::Ordering;

        let uptime_secs = OBSERVER_START_TIME
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|t| t.elapsed().as_secs()))
            .unwrap_or(0);

        let registered_events = session_tokens
            .lock()
            .map(|tokens| tokens.len())
            .unwrap_or(0);

        let gsmtc_sessions = gsmtc_manager
            .map(Self::collect_gsmtc_sessions)
            .unwrap_or_default();

        let core_audio_sessions =
            tokio::task::block_in_place(|| Self::collect_core_audio_sessions());

        let debug_info = MediaDebugInfo {
            observer_running: running.load(Ordering::SeqCst),
            uptime_secs,
            last_check_time: Local::now().format(TIME_FORMAT_SHORT).to_string().into(),
            gsmtc_available: gsmtc_manager.is_some(),
            core_audio_available,
            gsmtc_sessions,
            core_audio_sessions,
            combined_state: combined_state.clone(),
            state_source: state_source.into(),
            registered_session_events: registered_events,
        };

        // 发送更新事件
        let _ = emit_debug_update(&app_handle, DEBUG_EVENT_TYPE_MEDIA, &debug_info);

        update_cached_debug_info(debug_info);
    }

    /// 收集 GSMTC 会话信息（调试用）
    #[cfg(windows)]
    fn collect_gsmtc_sessions(
        manager: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager,
    ) -> Vec<GsmtcSessionInfo> {
        use windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus;

        let mut sessions = Vec::new();

        if let Ok(session_list) = manager.GetSessions() {
            for i in 0..session_list.Size().unwrap_or(0) {
                if let Ok(session) = session_list.GetAt(i) {
                    let app_id: Box<str> = session
                        .SourceAppUserModelId()
                        .ok()
                        .map(|s| s.to_string_lossy().into())
                        .unwrap_or_else(|| "".into());

                    let status = if let Ok(playback_info) = session.GetPlaybackInfo() {
                        match playback_info.PlaybackStatus() {
                            Ok(s) => match s {
                                GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => PLAYBACK_STATUS_PLAYING,
                                GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused => PLAYBACK_STATUS_PAUSED,
                                GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped => PLAYBACK_STATUS_STOPPED,
                                GlobalSystemMediaTransportControlsSessionPlaybackStatus::Closed => PLAYBACK_STATUS_CLOSED,
                                GlobalSystemMediaTransportControlsSessionPlaybackStatus::Opened => PLAYBACK_STATUS_OPENED,
                                GlobalSystemMediaTransportControlsSessionPlaybackStatus::Changing => PLAYBACK_STATUS_CHANGING,
                                _ => PLAYBACK_STATUS_UNKNOWN,
                            },
                            Err(_) => STATUS_ERROR,
                        }
                    } else {
                        STATUS_NO_INFO
                    };

                    let (title, artist) = Self::get_media_properties(&session);
                    let is_music_app = is_music_app(&app_id);

                    sessions.push(GsmtcSessionInfo {
                        app_id,
                        status: status.into(),
                        title: title.map(|s| s.into()),
                        artist: artist.map(|s| s.into()),
                        is_music_app,
                    });
                }
            }
        }

        sessions
    }

    /// 收集 Core Audio 会话信息（调试用）
    #[cfg(windows)]
    fn collect_core_audio_sessions() -> Vec<CoreAudioSessionInfo> {
        use windows::core::Interface;
        use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
        use windows::Win32::Media::Audio::{
            eMultimedia, eRender, AudioSessionStateActive, AudioSessionStateExpired,
            AudioSessionStateInactive, IAudioSessionEnumerator, IAudioSessionManager2,
            IMMDeviceEnumerator, MMDeviceEnumerator,
        };
        use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

        let mut sessions = Vec::new();

        unsafe {
            // 创建设备枚举器
            let enumerator: Result<IMMDeviceEnumerator, _> =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL);
            let enumerator = match enumerator {
                Ok(e) => e,
                Err(_) => return sessions,
            };

            // 获取默认音频输出设备
            let device = match enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) {
                Ok(d) => d,
                Err(_) => return sessions,
            };

            // 获取音频会话管理器
            let session_manager: Result<IAudioSessionManager2, _> =
                device.Activate(CLSCTX_ALL, None);
            let session_manager = match session_manager {
                Ok(m) => m,
                Err(_) => return sessions,
            };

            // 获取会话枚举器
            let session_enumerator: Result<IAudioSessionEnumerator, _> =
                session_manager.GetSessionEnumerator();
            let session_enumerator = match session_enumerator {
                Ok(e) => e,
                Err(_) => return sessions,
            };

            let count = session_enumerator.GetCount().unwrap_or(0);

            for i in 0..count {
                if let Ok(session_control) = session_enumerator.GetSession(i) {
                    let session_state = session_control
                        .GetState()
                        .map(|s| {
                            if s == AudioSessionStateActive {
                                SESSION_STATE_ACTIVE
                            } else if s == AudioSessionStateInactive {
                                SESSION_STATE_INACTIVE
                            } else if s == AudioSessionStateExpired {
                                SESSION_STATE_EXPIRED
                            } else {
                                PLAYBACK_STATUS_UNKNOWN
                            }
                        })
                        .unwrap_or(STATUS_ERROR);

                    if let Ok(session_control2) =
                        session_control
                            .cast::<windows::Win32::Media::Audio::IAudioSessionControl2>()
                    {
                        let pid = session_control2.GetProcessId().unwrap_or(0);

                        if pid > 0 {
                            let process_name = Self::get_process_name(pid)
                                .unwrap_or_else(|| format!("PID:{}", pid));

                            let peak_value = session_control
                                .cast::<IAudioMeterInformation>()
                                .ok()
                                .and_then(|meter| meter.GetPeakValue().ok())
                                .unwrap_or(0.0);

                            let is_music_app = is_music_app(&process_name);
                            let is_playing = peak_value > 0.001;

                            sessions.push(CoreAudioSessionInfo {
                                pid,
                                process_name: process_name.into(),
                                session_state: session_state.into(),
                                peak_value,
                                is_music_app,
                                is_playing,
                            });
                        }
                    }
                }
            }
        }

        sessions
    }

    /// 从 Core Audio API 获取正在播放音频的音乐应用
    /// 返回 (是否有音乐应用在播放, 事件)
    #[cfg(windows)]
    fn get_core_audio_media_state() -> Option<MediaStateEvent> {
        use windows::core::Interface;
        use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
        use windows::Win32::Media::Audio::{
            eMultimedia, eRender, AudioSessionStateActive, IAudioSessionEnumerator,
            IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator,
        };
        use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

        unsafe {
            // 创建设备枚举器
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;

            // 获取默认音频输出设备
            let device = enumerator
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
                .ok()?;

            // 获取音频会话管理器
            let session_manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None).ok()?;

            // 获取会话枚举器
            let session_enumerator: IAudioSessionEnumerator =
                session_manager.GetSessionEnumerator().ok()?;

            let count = session_enumerator.GetCount().ok()?;

            // 遍历所有音频会话
            for i in 0..count {
                if let Ok(session_control) = session_enumerator.GetSession(i) {
                    // 获取会话状态
                    if let Ok(state) = session_control.GetState() {
                        if state == AudioSessionStateActive {
                            // 获取进程 ID
                            if let Ok(session_control2) =
                                session_control
                                    .cast::<windows::Win32::Media::Audio::IAudioSessionControl2>()
                            {
                                if let Ok(pid) = session_control2.GetProcessId() {
                                    if pid > 0 {
                                        // 获取进程名
                                        if let Some(process_name) = Self::get_process_name(pid) {
                                            // 检查是否为音乐应用
                                            if is_music_app(&process_name) {
                                                // 检查是否真正有音频输出（通过音量峰值）
                                                let is_playing = if let Ok(meter) =
                                                    session_control.cast::<IAudioMeterInformation>()
                                                {
                                                    // 获取峰值，大于阈值表示正在播放
                                                    meter
                                                        .GetPeakValue()
                                                        .map(|peak| peak > 0.001)
                                                        .unwrap_or(false)
                                                } else {
                                                    // 无法获取音量信息，假设正在播放
                                                    true
                                                };

                                                if is_playing {
                                                    return Some(MediaStateEvent {
                                                        status: MediaPlaybackStatus::Playing,
                                                        title: None,
                                                        artist: None,
                                                        app_id: Some(process_name.into()),
                                                    });
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            None
        }
    }

    /// 根据进程 ID 获取进程名
    #[cfg(windows)]
    fn get_process_name(pid: u32) -> Option<String> {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;

            // 获取进程路径
            let mut buffer = [0u16; 260];
            let mut size = buffer.len() as u32;

            use windows::Win32::System::Threading::QueryFullProcessImageNameW;
            use windows::Win32::System::Threading::PROCESS_NAME_WIN32;

            let result = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                windows::core::PWSTR(buffer.as_mut_ptr()),
                &mut size,
            );

            let _ = CloseHandle(handle);

            if result.is_ok() {
                let path = String::from_utf16_lossy(&buffer[..size as usize]);
                // 从路径中提取文件名
                path.rsplit('\\').next().map(|s| s.to_string())
            } else {
                None
            }
        }
    }

    /// 从 GSMTC 获取媒体状态
    #[cfg(windows)]
    fn get_gsmtc_media_state(
        manager: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager,
    ) -> MediaStateEvent {
        use windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus;

        // 收集所有音乐应用的会话信息
        let mut playing_session: Option<MediaStateEvent> = None;
        let mut paused_session: Option<MediaStateEvent> = None;
        let mut any_music_session: Option<MediaStateEvent> = None;

        if let Ok(sessions) = manager.GetSessions() {
            for i in 0..sessions.Size().unwrap_or(0) {
                if let Ok(session) = sessions.GetAt(i) {
                    let app_id = session
                        .SourceAppUserModelId()
                        .ok()
                        .map(|s| s.to_string_lossy());

                    if let Some(ref id) = app_id {
                        if is_music_app(id) {
                            if let Ok(playback_info) = session.GetPlaybackInfo() {
                                let status = match playback_info.PlaybackStatus() {
                                    Ok(s) => match s {
                                        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => MediaPlaybackStatus::Playing,
                                        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused => MediaPlaybackStatus::Paused,
                                        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped => MediaPlaybackStatus::Stopped,
                                        _ => MediaPlaybackStatus::Unknown,
                                    },
                                    Err(_) => MediaPlaybackStatus::Unknown,
                                };

                                let (title, artist) = Self::get_media_properties(&session);
                                let event = MediaStateEvent {
                                    status: status.clone(),
                                    title,
                                    artist,
                                    app_id: app_id.map(|s| s.into()),
                                };

                                match status {
                                    MediaPlaybackStatus::Playing => {
                                        if playing_session.is_none() {
                                            playing_session = Some(event);
                                        }
                                    }
                                    MediaPlaybackStatus::Paused => {
                                        if paused_session.is_none() {
                                            paused_session = Some(event);
                                        }
                                    }
                                    _ => {
                                        if any_music_session.is_none() {
                                            any_music_session = Some(event);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        playing_session
            .or(paused_session)
            .or(any_music_session)
            .unwrap_or(MediaStateEvent {
                status: MediaPlaybackStatus::Stopped,
                title: None,
                artist: None,
                app_id: None,
            })
    }

    /// 注册 GSMTC 会话事件
    #[cfg(windows)]
    fn register_gsmtc_session_events(
        manager: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager,
        internal_tx: &tokio::sync::mpsc::UnboundedSender<()>,
        session_tokens: &Arc<Mutex<Vec<SessionEventTokens>>>,
    ) {
        use windows::Foundation::TypedEventHandler;
        use windows::Media::Control::{
            GlobalSystemMediaTransportControlsSession, MediaPropertiesChangedEventArgs,
            PlaybackInfoChangedEventArgs,
        };

        if let Ok(sessions) = manager.GetSessions() {
            for i in 0..sessions.Size().unwrap_or(0) {
                if let Ok(session) = sessions.GetAt(i) {
                    let session_id = session
                        .SourceAppUserModelId()
                        .ok()
                        .map(|s| s.to_string_lossy())
                        .unwrap_or_default();

                    // 1. 清理已关闭或重叠的会话（基于 session_id 或对象失效）
                    {
                        let mut tokens = session_tokens.lock().unwrap();
                        // 寻找并清理旧会话，释放 Windows 回调资源
                        for i in (0..tokens.len()).rev() {
                            if *tokens[i].session_id == *session_id {
                                let old_token = tokens.remove(i);
                                old_token.cleanup();
                            }
                        }
                    }

                    // 2. 只为音乐应用注册事件
                    if !is_music_app(&session_id) {
                        continue;
                    }

                    // 3. 注册事件，此处不使用 continue 以支持重新连接

                    // 注册 PlaybackInfoChanged 事件
                    let tx_playback = internal_tx.clone();
                    let playback_handler = TypedEventHandler::<
                        GlobalSystemMediaTransportControlsSession,
                        PlaybackInfoChangedEventArgs,
                    >::new(move |_, _| {
                        let _ = tx_playback.send(());
                        windows::core::Result::Ok(())
                    });
                    let playback_token = session.PlaybackInfoChanged(&playback_handler);

                    // 注册 MediaPropertiesChanged 事件
                    let tx_media = internal_tx.clone();
                    let media_handler = TypedEventHandler::<
                        GlobalSystemMediaTransportControlsSession,
                        MediaPropertiesChangedEventArgs,
                    >::new(move |_, _| {
                        let _ = tx_media.send(());
                        windows::core::Result::Ok(())
                    });
                    let media_token = session.MediaPropertiesChanged(&media_handler);

                    let mut tokens = session_tokens.lock().unwrap();
                    tokens.push(SessionEventTokens {
                        session_id: session_id.into(),
                        session: session.clone(),
                        playback_token,
                        media_token,
                    });
                }
            }
        }
    }

    /// 获取媒体属性（标题、艺术家）
    #[cfg(windows)]
    fn get_media_properties(
        session: &windows::Media::Control::GlobalSystemMediaTransportControlsSession,
    ) -> (Option<Box<str>>, Option<Box<str>>) {
        let properties = match session.TryGetMediaPropertiesAsync() {
            Ok(op) => match op.get() {
                Ok(p) => p,
                Err(_) => return (None, None),
            },
            Err(_) => return (None, None),
        };

        let title = properties.Title().ok().map(|s| s.to_string_lossy().into());
        let artist = properties.Artist().ok().map(|s| s.to_string_lossy().into());

        (title, artist)
    }

    /// 非 Windows 平台的空实现
    #[cfg(not(windows))]
    async fn media_event_loop(
        _tx: mpsc::UnboundedSender<MediaStateEvent>,
        _running: Arc<std::sync::atomic::AtomicBool>,
    ) {
        eprintln!("[MediaObserver] 媒体监听仅支持 Windows 平台");
    }
}

impl Default for MediaObserver {
    fn default() -> Self {
        Self::new()
    }
}

// ========================================================================= //
// 辅助结构
// ========================================================================= //

/// 媒体观察者内部状态（用于检测变化）
struct MediaObserverState {
    last_status: MediaPlaybackStatus,
    last_app_id: Option<Box<str>>,
    last_title: Option<Box<str>>,
    has_played: bool,
}

impl MediaObserverState {
    fn new() -> Self {
        Self {
            last_status: MediaPlaybackStatus::Unknown,
            last_app_id: None,
            last_title: None,
            has_played: false,
        }
    }

    fn has_changed(&self, event: &MediaStateEvent) -> bool {
        self.last_status != event.status
            || self.last_app_id != event.app_id
            || self.last_title != event.title
    }

    fn update(&mut self, event: &MediaStateEvent) {
        self.last_status = event.status.clone();
        self.last_app_id = event.app_id.clone();
        self.last_title = event.title.clone();
        if event.status == MediaPlaybackStatus::Playing {
            self.has_played = true;
        }
    }
}

/// GSMTC 会话事件 Token 存储（用于清理）
#[cfg(windows)]
struct SessionEventTokens {
    session_id: Box<str>,
    session: windows::Media::Control::GlobalSystemMediaTransportControlsSession,
    playback_token: windows::core::Result<windows::Foundation::EventRegistrationToken>,
    media_token: windows::core::Result<windows::Foundation::EventRegistrationToken>,
}

#[cfg(windows)]
impl SessionEventTokens {
    fn cleanup(&self) {
        if let Ok(token) = &self.playback_token {
            let _ = self.session.RemovePlaybackInfoChanged(*token);
        }
        if let Ok(token) = &self.media_token {
            let _ = self.session.RemoveMediaPropertiesChanged(*token);
        }
    }
}
