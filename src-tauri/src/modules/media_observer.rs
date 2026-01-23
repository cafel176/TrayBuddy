//! 媒体状态监听模块
//! 通过 Windows GSMTC (GlobalSystemMediaTransportControls) 监听系统音频播放状态

#![allow(unused)]

use std::sync::Arc;
use tokio::sync::mpsc;

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

/// 媒体观察者 - 监听系统音频播放状态
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
                Self::media_polling_loop(tx, running).await;
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
        app_lower.contains("music") || app_id.contains("音乐")
    }

    // ========================================================================= //

    /// 媒体状态轮询循环
    #[cfg(windows)]
    async fn media_polling_loop(
        tx: mpsc::UnboundedSender<MediaStateEvent>,
        running: Arc<std::sync::atomic::AtomicBool>,
    ) {
        use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;

        // 启动延迟：等待应用初始化和 login 事件完成
        // 这确保 music_start 不会在 login 之前触发
        const STARTUP_DELAY_SECS: u64 = 5;
        println!("[MediaObserver] 等待 {} 秒后启动媒体监听...", STARTUP_DELAY_SECS);
        tokio::time::sleep(tokio::time::Duration::from_secs(STARTUP_DELAY_SECS)).await;

        // 尝试获取媒体会话管理器
        let manager = match GlobalSystemMediaTransportControlsSessionManager::RequestAsync() {
            Ok(op) => match op.get() {
                Ok(m) => m,
                Err(e) => {
                    eprintln!("[MediaObserver] 无法获取媒体会话管理器: {:?}", e);
                    return;
                }
            },
            Err(e) => {
                eprintln!("[MediaObserver] RequestAsync 失败: {:?}", e);
                return;
            }
        };

        let mut last_status = MediaPlaybackStatus::Unknown;
        let mut last_app_id: Option<String> = None;
        let mut has_played = false;
        let mut pending_send_countdown: i32 = 0;
        let mut pending_playing_event: Option<MediaStateEvent> = None;

        println!("[MediaObserver] 媒体监听已启动");

        while running.load(std::sync::atomic::Ordering::SeqCst) {
            // 处理延迟发送的事件
            if pending_send_countdown > 0 {
                pending_send_countdown -= 1;
                if pending_send_countdown == 0 {
                    if let Some(event) = pending_playing_event.take() {
                        if tx.send(event).is_err() { break; }
                    }
                }
            }

            let current_event = Self::get_current_media_state(&manager);

            // 只在状态变化或应用变化时处理
            let app_changed = current_event.app_id != last_app_id;
            let status_changed = current_event.status != last_status;
            
            if status_changed || app_changed {
                let should_send = match current_event.status {
                    MediaPlaybackStatus::Playing => {
                        // 从 Unknown 变为 Playing 时延迟发送，让 login 事件先完成
                        if last_status == MediaPlaybackStatus::Unknown {
                            pending_playing_event = Some(current_event.clone());
                            pending_send_countdown = 2;
                            has_played = true;
                            false
                        } else {
                            has_played = true;
                            true
                        }
                    }
                    MediaPlaybackStatus::Paused | MediaPlaybackStatus::Stopped => has_played,
                    MediaPlaybackStatus::Unknown => false,
                };
                
                last_status = current_event.status.clone();
                last_app_id = current_event.app_id.clone();

                if should_send && tx.send(current_event).is_err() {
                    break;
                }
            }

            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        }

        println!("[MediaObserver] 媒体监听已停止");
    }

    /// 获取当前媒体状态
    #[cfg(windows)]
    fn get_current_media_state(
        manager: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager,
    ) -> MediaStateEvent {
        use windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus;

        // 获取所有会话，查找音乐应用的会话
        if let Ok(sessions) = manager.GetSessions() {
            for i in 0..sessions.Size().unwrap_or(0) {
                if let Ok(session) = sessions.GetAt(i) {
                    // 获取应用 ID
                    let app_id = session.SourceAppUserModelId()
                        .ok()
                        .map(|s| s.to_string_lossy());
                    
                    // 检查是否为音乐应用
                    if let Some(ref id) = app_id {
                        if Self::is_music_app(id) {
                            // 获取播放信息
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

                                // 如果是播放状态，返回这个会话的信息
                                if status == MediaPlaybackStatus::Playing {
                                    let (title, artist) = Self::get_media_properties(&session);
                                    return MediaStateEvent { status, title, artist, app_id };
                                }
                            }
                        }
                    }
                }
            }
        }

        // 没有找到正在播放的音乐应用，返回停止状态
        MediaStateEvent {
            status: MediaPlaybackStatus::Stopped,
            title: None,
            artist: None,
            app_id: None,
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
    async fn media_polling_loop(
        _tx: mpsc::UnboundedSender<MediaStateEvent>,
        _running: Arc<std::sync::atomic::AtomicBool>,
    ) {
        eprintln!("[MediaObserver] 媒体监听仅支持 Windows 平台");
    }
}

impl Default for MediaObserver {
    fn default() -> Self { Self::new() }
}
