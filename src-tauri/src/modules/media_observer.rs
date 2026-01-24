//! 媒体状态监听模块
//! 
//! 混合使用两种 Windows API 监听系统音频播放状态：
//! - **GSMTC** (GlobalSystemMediaTransportControls): 获取媒体元数据（标题、艺术家）
//! - **Core Audio API** (IAudioSessionManager2): 检测所有正在播放音频的进程（包括不支持 SMTC 的应用）

#![allow(unused)]

use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

// ========================================================================= //
// 全局缓存
// ========================================================================= //

/// 缓存的媒体状态
static CACHED_MEDIA_STATE: Mutex<Option<MediaStateEvent>> = Mutex::new(None);

/// 获取缓存的媒体状态
pub fn get_cached_media_state() -> Option<MediaStateEvent> {
    CACHED_MEDIA_STATE.lock().ok().and_then(|guard| guard.clone())
}

/// 更新缓存的媒体状态
fn update_cached_media_state(event: &MediaStateEvent) {
    if let Ok(mut guard) = CACHED_MEDIA_STATE.lock() {
        *guard = Some(event.clone());
    }
}

// ========================================================================= //

/// 媒体播放状态
#[derive(Debug, Clone, PartialEq)]
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
#[derive(Debug, Clone)]
pub struct MediaStateEvent {
    pub status: MediaPlaybackStatus,
    pub title: Option<String>,
    pub artist: Option<String>,
    /// 播放应用的进程名/App ID
    pub app_id: Option<String>,
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
    pub fn start(&mut self) -> mpsc::UnboundedReceiver<MediaStateEvent> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.event_tx = Some(tx.clone());
        self.running.store(true, std::sync::atomic::Ordering::SeqCst);

        let running = self.running.clone();

        // 启动异步监听任务
        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
            rt.block_on(async move {
                Self::media_event_loop(tx, running).await;
            });
        });

        rx
    }

    /// 停止媒体监听
    pub fn stop(&mut self) {
        self.running.store(false, std::sync::atomic::Ordering::SeqCst);
        self.event_tx = None;
    }

    /// 检查应用名称是否为音乐应用
    fn is_music_app(app_id: &str) -> bool {
        let app_lower = app_id.to_lowercase();
        
        // 常见音乐播放器关键字
        let music_keywords = [
            "music",        // 通用：Apple Music, Windows Media Player 等
            "音乐",         // 中文音乐应用
            "spotify",      // Spotify
            "qqmusic",      // QQ音乐
            "kugou",        // 酷狗音乐
            "kuwo",         // 酷我音乐
            "foobar",       // foobar2000
            "aimp",         // AIMP
            "winamp",       // Winamp
            "potplayer",    // PotPlayer
            "vlc",          // VLC
            "musicbee",     // MusicBee
            "groove",       // Groove Music
            "itunes",       // iTunes
            "netease",      // 网易云音乐 (NetEase Cloud Music)
            "cloudmusic",   // 网易云音乐进程名
        ];
        
        // 检查关键字（支持带空格的名称如 "cloud music"）
        let app_no_space = app_lower.replace(" ", "");
        
        music_keywords.iter().any(|&keyword| {
            app_lower.contains(keyword) || app_no_space.contains(keyword)
        })
    }

    // ========================================================================= //
    // Windows 混合 API 实现
    // ========================================================================= //

    /// 媒体事件监听循环（混合 GSMTC + Core Audio）
    #[cfg(windows)]
    async fn media_event_loop(
        tx: mpsc::UnboundedSender<MediaStateEvent>,
        running: Arc<std::sync::atomic::AtomicBool>,
    ) {
        use crate::modules::constants::MEDIA_OBSERVER_STARTUP_DELAY_SECS;
        use std::sync::atomic::Ordering;
        use tokio::sync::mpsc as tokio_mpsc;
        use windows::Foundation::TypedEventHandler;
        use windows::Media::Control::{
            GlobalSystemMediaTransportControlsSession,
            GlobalSystemMediaTransportControlsSessionManager,
            SessionsChangedEventArgs,
        };

        // 启动延迟：等待应用初始化和 login 事件完成
        tokio::time::sleep(tokio::time::Duration::from_secs(MEDIA_OBSERVER_STARTUP_DELAY_SECS)).await;

        // 初始化 COM（Core Audio 需要）
        if !Self::init_com() {
            eprintln!("[MediaObserver] COM 初始化失败");
            return;
        }

        // 获取 GSMTC 媒体会话管理器（可选，用于获取元数据）
        let gsmtc_manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .ok()
            .and_then(|op| op.get().ok());

        // 创建内部事件通道
        let (internal_tx, mut internal_rx) = tokio_mpsc::unbounded_channel::<()>();

        // 用于跟踪状态变化
        let state = Arc::new(Mutex::new(MediaObserverState::new()));

        // 注册 GSMTC 事件（如果可用）
        let sessions_token = if let Some(ref manager) = gsmtc_manager {
            let internal_tx_sessions = internal_tx.clone();
            let sessions_handler = TypedEventHandler::<
                GlobalSystemMediaTransportControlsSessionManager,
                SessionsChangedEventArgs,
            >::new(move |_, _| {
                let _ = internal_tx_sessions.send(());
                Ok(())
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
        let initial_event = Self::get_combined_media_state(gsmtc_manager.as_ref());
        if initial_event.status == MediaPlaybackStatus::Playing {
            // 延迟发送初始 Playing 状态，让 login 事件先完成
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
            if running.load(Ordering::SeqCst) {
                update_cached_media_state(&initial_event);
                state.lock().unwrap().update(&initial_event);
                let _ = tx.send(initial_event);
            }
        } else {
            update_cached_media_state(&initial_event);
            state.lock().unwrap().update(&initial_event);
        }

        // 主事件循环
        while running.load(Ordering::SeqCst) {
            // 等待 GSMTC 事件通知或超时（超时用于轮询 Core Audio）
            // Core Audio 没有事件通知，需要定期轮询
            let _ = tokio::time::timeout(
                tokio::time::Duration::from_secs(2),
                internal_rx.recv(),
            ).await;

            if !running.load(Ordering::SeqCst) {
                break;
            }

            // 重新注册 GSMTC 会话事件
            if let Some(ref manager) = gsmtc_manager {
                Self::register_gsmtc_session_events(manager, &internal_tx, &session_tokens);
            }

            // 获取当前状态（混合 GSMTC + Core Audio）
            let current_event = Self::get_combined_media_state(gsmtc_manager.as_ref());

            // 检查是否有变化
            let mut state_guard = state.lock().unwrap();
            if state_guard.has_changed(&current_event) {
                let should_send = match current_event.status {
                    MediaPlaybackStatus::Playing => true,
                    MediaPlaybackStatus::Paused | MediaPlaybackStatus::Stopped => state_guard.has_played,
                    MediaPlaybackStatus::Unknown => false,
                };

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
        gsmtc_manager: Option<&windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager>,
    ) -> MediaStateEvent {
        // 从 GSMTC 获取状态（有元数据）
        let gsmtc_event = gsmtc_manager.map(Self::get_gsmtc_media_state);
        
        // 从 Core Audio 获取状态（检测所有播放音频的进程）
        let core_audio_event = Self::get_core_audio_media_state();

        // 判断逻辑：
        // 1. 如果 GSMTC 检测到正在播放 -> 返回 GSMTC 结果（有元数据）
        // 2. 如果 Core Audio 检测到正在播放 -> 返回 Core Audio 结果（尝试补充 GSMTC 元数据）
        // 3. 如果 GSMTC 检测到暂停 -> 返回暂停状态
        // 4. 否则返回停止状态

        // 检查 GSMTC 播放状态
        if let Some(ref event) = gsmtc_event {
            if event.status == MediaPlaybackStatus::Playing {
                return event.clone();
            }
        }

        // 检查 Core Audio 播放状态
        if let Some(ref event) = core_audio_event {
            if event.status == MediaPlaybackStatus::Playing {
                // 尝试从 GSMTC 补充元数据
                if let Some(ref gsmtc) = gsmtc_event {
                    if gsmtc.title.is_some() || gsmtc.artist.is_some() {
                        return MediaStateEvent {
                            status: MediaPlaybackStatus::Playing,
                            title: gsmtc.title.clone(),
                            artist: gsmtc.artist.clone(),
                            app_id: event.app_id.clone(),
                        };
                    }
                }
                return event.clone();
            }
        }

        // 如果 GSMTC 检测到暂停状态，返回暂停
        if let Some(ref event) = gsmtc_event {
            if event.status == MediaPlaybackStatus::Paused {
                return event.clone();
            }
        }

        // 默认返回停止状态
        // 保留最后已知的 app_id 以便追踪
        let last_app_id = gsmtc_event.as_ref()
            .and_then(|e| e.app_id.clone())
            .or_else(|| core_audio_event.as_ref().and_then(|e| e.app_id.clone()));

        MediaStateEvent {
            status: MediaPlaybackStatus::Stopped,
            title: None,
            artist: None,
            app_id: last_app_id,
        }
    }

    /// 从 Core Audio API 获取正在播放音频的音乐应用
    /// 返回 (是否有音乐应用在播放, 事件)
    #[cfg(windows)]
    fn get_core_audio_media_state() -> Option<MediaStateEvent> {
        use windows::Win32::Media::Audio::{
            eRender, eMultimedia,
            IMMDeviceEnumerator, MMDeviceEnumerator,
            IAudioSessionManager2, IAudioSessionEnumerator,
            AudioSessionStateActive,
        };
        use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
        use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
        use windows::core::Interface;

        unsafe {
            // 创建设备枚举器
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(
                &MMDeviceEnumerator,
                None,
                CLSCTX_ALL,
            ).ok()?;

            // 获取默认音频输出设备
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia).ok()?;

            // 获取音频会话管理器
            let session_manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None).ok()?;

            // 获取会话枚举器
            let session_enumerator: IAudioSessionEnumerator = session_manager.GetSessionEnumerator().ok()?;

            let count = session_enumerator.GetCount().ok()?;

            // 遍历所有音频会话
            for i in 0..count {
                if let Ok(session_control) = session_enumerator.GetSession(i) {
                    // 获取会话状态
                    if let Ok(state) = session_control.GetState() {
                        if state == AudioSessionStateActive {
                            // 获取进程 ID
                            if let Ok(session_control2) = session_control.cast::<windows::Win32::Media::Audio::IAudioSessionControl2>() {
                                if let Ok(pid) = session_control2.GetProcessId() {
                                    if pid > 0 {
                                        // 获取进程名
                                        if let Some(process_name) = Self::get_process_name(pid) {
                                            // 检查是否为音乐应用
                                            if Self::is_music_app(&process_name) {
                                                // 检查是否真正有音频输出（通过音量峰值）
                                                let is_playing = if let Ok(meter) = session_control.cast::<IAudioMeterInformation>() {
                                                    // 获取峰值，大于阈值表示正在播放
                                                    meter.GetPeakValue().map(|peak| peak > 0.001).unwrap_or(false)
                                                } else {
                                                    // 无法获取音量信息，假设正在播放
                                                    true
                                                };

                                                if is_playing {
                                                    return Some(MediaStateEvent {
                                                        status: MediaPlaybackStatus::Playing,
                                                        title: None,
                                                        artist: None,
                                                        app_id: Some(process_name),
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
        use windows::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        use windows::Win32::Foundation::CloseHandle;

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
                    let app_id = session.SourceAppUserModelId()
                        .ok()
                        .map(|s| s.to_string_lossy());
                    
                    if let Some(ref id) = app_id {
                        if Self::is_music_app(id) {
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
                                    app_id: app_id.clone() 
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
            GlobalSystemMediaTransportControlsSession,
            MediaPropertiesChangedEventArgs,
            PlaybackInfoChangedEventArgs,
        };

        if let Ok(sessions) = manager.GetSessions() {
            for i in 0..sessions.Size().unwrap_or(0) {
                if let Ok(session) = sessions.GetAt(i) {
                    let session_id = session.SourceAppUserModelId()
                        .ok()
                        .map(|s| s.to_string_lossy())
                        .unwrap_or_default();

                    // 检查是否已注册
                    {
                        let tokens = session_tokens.lock().unwrap();
                        if tokens.iter().any(|t| t.session_id == session_id) {
                            continue;
                        }
                    }

                    // 只为音乐应用注册事件
                    if !Self::is_music_app(&session_id) {
                        continue;
                    }

                    // 注册 PlaybackInfoChanged 事件
                    let tx_playback = internal_tx.clone();
                    let playback_handler = TypedEventHandler::<
                        GlobalSystemMediaTransportControlsSession,
                        PlaybackInfoChangedEventArgs,
                    >::new(move |_, _| {
                        let _ = tx_playback.send(());
                        Ok(())
                    });
                    let playback_token = session.PlaybackInfoChanged(&playback_handler);

                    // 注册 MediaPropertiesChanged 事件
                    let tx_media = internal_tx.clone();
                    let media_handler = TypedEventHandler::<
                        GlobalSystemMediaTransportControlsSession,
                        MediaPropertiesChangedEventArgs,
                    >::new(move |_, _| {
                        let _ = tx_media.send(());
                        Ok(())
                    });
                    let media_token = session.MediaPropertiesChanged(&media_handler);

                    let mut tokens = session_tokens.lock().unwrap();
                    tokens.push(SessionEventTokens {
                        session_id,
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
    ) -> (Option<String>, Option<String>) {
        let properties = match session.TryGetMediaPropertiesAsync() {
            Ok(op) => match op.get() {
                Ok(p) => p,
                Err(_) => return (None, None),
            },
            Err(_) => return (None, None),
        };

        let title = properties.Title().ok().map(|s| s.to_string_lossy());
        let artist = properties.Artist().ok().map(|s| s.to_string_lossy());

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
    fn default() -> Self { Self::new() }
}

// ========================================================================= //
// 辅助结构
// ========================================================================= //

/// 媒体观察者内部状态（用于检测变化）
struct MediaObserverState {
    last_status: MediaPlaybackStatus,
    last_app_id: Option<String>,
    last_title: Option<String>,
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
    session_id: String,
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
