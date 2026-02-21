//! 系统状态观察器
//!
//! 负责监听系统事件并根据系统状态自动调整应用行为。
//! 目前主要功能：
//! - 监听前台窗口切换事件
//! - 检测当前是否有全屏应用运行
//! - 根据设置自动开启/关闭免打扰模式

#![allow(unused)]

use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::Emitter;
use tauri::Manager;
use tokio::sync::mpsc;

use super::constants::{STATE_SILENCE_END, STATE_SILENCE_START};
use super::event_manager::{DEBUG_EVENT_TYPE_SYSTEM, emit, emit_debug_update, emit_settings, events};
use super::utils::window::get_visual_window_rect;
use crate::AppState;

// ========================================================================= //
// 字符串常量
// ========================================================================= //

/// 时间格式：短格式（小时:分钟:秒）
const TIME_FORMAT_SHORT: &str = "%H:%M:%S";

// ========================================================================= //
// 调试信息
// ========================================================================= //

static CACHED_DEBUG_INFO: Mutex<Option<SystemDebugInfo>> = Mutex::new(None);

/// 系统观察器调试信息
#[derive(Debug, Clone, Serialize)]
pub struct SystemDebugInfo {
    /// 观察器是否运行中
    pub observer_running: bool,
    /// 最后检查时间
    pub last_check_time: String,
    /// 是否检测到全屏/繁忙
    pub is_fullscreen_busy: bool,
    /// 自动免打扰功能是否开启
    pub auto_dnd_enabled: bool,
    /// 当前是否是我们自动开启的免打扰
    pub is_auto_dnd_active: bool,
    /// 当前系统免打扰模式状态
    pub current_silence_mode: bool,
    /// 会话是否锁定
    pub session_locked: bool,
}

/// 获取缓存的调试信息
pub fn get_cached_debug_info() -> Option<SystemDebugInfo> {
    CACHED_DEBUG_INFO
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

/// 更新调试信息
fn update_cached_debug_info(info: SystemDebugInfo) {
    if let Ok(mut guard) = CACHED_DEBUG_INFO.lock() {
        *guard = Some(info);
    }
}

// ========================================================================= //
// 此文件仅在 Windows 下编译
// ========================================================================= //

#[cfg(target_os = "windows")]
pub struct SystemObserver {
    running: Arc<std::sync::atomic::AtomicBool>,
}

#[cfg(target_os = "windows")]
impl SystemObserver {
    pub fn new() -> Self {
        Self {
            running: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    // ========================================================================= //

    /// 启动观察器
    pub fn start(&self, app_handle: tauri::AppHandle) {
        let running = self.running.clone();
        running.store(true, std::sync::atomic::Ordering::SeqCst);

        // 启动消息循环线程（SetWinEventHook 需要消息循环）
        thread::spawn(move || {
            Self::event_loop(app_handle, running);
        });
    }

    pub fn stop(&self) {
        self.running
            .store(false, std::sync::atomic::Ordering::SeqCst);
    }

    // ========================================================================= //

    /// 消息循环与事件处理
    /// 
    /// **技术内幕：**
    /// Windows 的事件钩子 (`SetWinEventHook`) 要求调用线程必须拥有一个处于运行状态的消息循环（Message Loop）。
    /// 因此，我们专门为观察器开启了一个独立的线程，并在该线程中执行 `GetMessageW` 循环。
    /// 
    /// **监听事件：**
    /// 1. `EVENT_SYSTEM_FOREGROUND`: 当用户切换窗口（Alt+Tab）时触发。
    /// 2. `EVENT_OBJECT_LOCATIONCHANGE`: 当窗口移动、缩放或最大化时触发。
    /// 
    /// **防抖处理：**
    /// 由于位置变化事件非常频繁（拖拽时每帧都会触发），回调函数中仅向主逻辑发送一个极简的信号。
    /// 后端的 `check_loop` 会执行去抖动（Debounce），在信号停止后的 500ms 才执行昂贵的坐标计算逻辑。
    fn event_loop(app_handle: tauri::AppHandle, running: Arc<std::sync::atomic::AtomicBool>) {
        use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
        use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
        const EVENT_SYSTEM_FOREGROUND: u32 = 0x0003;
        const EVENT_OBJECT_LOCATIONCHANGE: u32 = 0x800B;
        const WINEVENT_OUTOFCONTEXT: u32 = 0x0000;
        use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
        use windows::Win32::UI::WindowsAndMessaging::{
            DispatchMessageW, GetMessageW, GetWindowLongW, TranslateMessage, GWL_STYLE, MSG,
            WS_MAXIMIZE, WS_POPUP,
        };

        // 创建通道用于从 Hook 回调向主逻辑发送信号
        let (tx, rx) = mpsc::unbounded_channel::<()>();

        // 将 tx 存入全局或线程局部存储，以便回调函数访问
        // 由于 C 回调签名限制，这里使用 lazy_static 或类似机制并不是最简单的方法
        // 对于简单实现，我们可以利用 channel 的特性。
        // 但 SetWinEventHook 的回调必须是 C 函数指针。
        // Rust 中处理此情况通常需要全局变量。

        // 为了避免复杂的全局状态管理，我们可以采用简单的轮询 + 自适应检查策略，
        // 或者使用 Win32 的消息机制。
        // 这里为了稳健性，其实可以结合：
        // 1. 启动一个线程，注册 Hook。
        // 2. Hook 回调中不做耗时操作，只设置标志位或发送 ThreadMessage。

        // 由于 unsafe 回调的复杂性，简单起见，且 Windows Hook 需要 Process 级别的全局性，
        // 我们对于 "TrayBuddy" 这种应用，使用一个低频的轮询检测全屏状态可能更安全且 bug 更少。
        // 但是用户明确要求 "事件驱动"。
        // 我们实现一个简化的事件驱动模型：


        // 定义回调函数
        unsafe extern "system" fn win_event_proc(
            _h_win_event_hook: HWINEVENTHOOK,
            event: u32,
            _hwnd: HWND,
            _id_object: i32,
            _id_child: i32,
            _id_event_thread: u32,
            _dw_ms_event_time: u32,
        ) {
            // 当发生前景切换或位置变化时
            if event == EVENT_SYSTEM_FOREGROUND || event == EVENT_OBJECT_LOCATIONCHANGE {
                // 发送自定义消息到当前线程的消息队列，通知检查状态
                // 这里我们简化处理：因为这是在回调中，我们不能直接调用 app_handle 逻辑（跨线程/重入风险）
                // 我们使用全局通道发送信号
                // 注意：使用 ok() 而非 unwrap()，避免在锁被污染时 panic
                if let Ok(guard) = GLOBAL_TX.lock() {
                    if let Some(sender) = &*guard {
                        let _ = sender.send(());
                    }
                }
            }
        }

        // 初始化全局通道
        // 这里在主线程初始化阶段，使用 unwrap() 是安全的
        *GLOBAL_TX.lock().unwrap() = Some(tx);

        unsafe {
            // 监听前景窗口切换
            let hook_foreground = SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                None,
                Some(win_event_proc),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            );

            // 监听窗口移动/大小改变（可能会产生大量事件，需要去抖动）
            let hook_location = SetWinEventHook(
                EVENT_OBJECT_LOCATIONCHANGE,
                EVENT_OBJECT_LOCATIONCHANGE,
                None,
                Some(win_event_proc),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            );

            // 启动检查逻辑任务（接收信号并去抖动）
            let app_handle_clone = app_handle.clone();
            let running_clone = running.clone();
            let tx_clone_for_check = rx; // 其实是 rx

            tauri::async_runtime::spawn(async move {
                Self::check_loop(app_handle_clone, running_clone, tx_clone_for_check).await;
            });


            // 消息循环
            let mut msg = MSG::default();
            while running.load(std::sync::atomic::Ordering::SeqCst) {
                // GetMessage 会阻塞直到有消息
                // 我们需要一种退出机制，但这在后台线程通常不需要优雅退出，因为主进程推出会杀死它。
                if GetMessageW(&mut msg, HWND(std::ptr::null_mut()), 0, 0).into() {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }

            UnhookWinEvent(hook_foreground);
            UnhookWinEvent(hook_location);
        }
    }

    /// 检查循环（带去抖动）
    async fn check_loop(
        app_handle: tauri::AppHandle,
        running: Arc<std::sync::atomic::AtomicBool>,
        mut rx: mpsc::UnboundedReceiver<()>,
    ) {
        // 本地状态，记录是否是我们自动开启了免打扰
        let mut we_enabled_dnd = false;

        // 立即执行一次初始检查，填充调试信息
        Self::check_and_update_state(&app_handle, &mut we_enabled_dnd).await;

        while running.load(std::sync::atomic::Ordering::SeqCst) {
            // 等待信号，或者每 N 秒自动检查一次（保底）
            let _ = tokio::select! {
                _ = rx.recv() => {},
                _ = tokio::time::sleep(Duration::from_secs(
                    crate::modules::constants::SYSTEM_OBSERVER_POLL_INTERVAL_SECS,
                )) => {},
            };

            // 去抖动：等待 500ms，让窗口动效完成
            tokio::time::sleep(Duration::from_millis(
                crate::modules::constants::SYSTEM_OBSERVER_DEBOUNCE_MS,
            ))
            .await;
            // 清空期间积压的信号
            while rx.try_recv().is_ok() {}

            // 执行检查
            Self::check_and_update_state(&app_handle, &mut we_enabled_dnd).await;
        }
    }

    /// 执行一次全屏检查和状态更新
    async fn check_and_update_state(app_handle: &tauri::AppHandle, we_enabled_dnd: &mut bool) {

        let app_state: tauri::State<AppState> = app_handle.state();

        // 1. 获取设置
        let (auto_silence, is_silence_mode) = {
            let storage = app_state.storage.lock().unwrap();
            (
                storage.data.settings.auto_silence_when_fullscreen,
                storage.data.settings.silence_mode,
            )
        };

        // 如果未开启自动检测功能且我们没有处于自动开启状态，我们仍然通过 check_loop 更新调试信息
        // 但不执行后续的切换逻辑

        // Debug: Log settings
        /* (Reducing noise, only log on impactful events or if needed specifically)
        if cfg!(debug_assertions) {
            // println!("[SystemObserver] Check: auto_silence={}, is_silence_mode={}", auto_silence, is_silence_mode);
        }
        */

        // 2. 获取锁屏状态
        let session_locked = {
            let app_state: tauri::State<AppState> = app_handle.state();
            app_state.session_locked.load(std::sync::atomic::Ordering::SeqCst)
        };

        // 3. 检测是否全屏/繁忙（耗时操作，放到阻塞线程池）
        let is_fullscreen = tokio::task::spawn_blocking(|| unsafe { Self::is_fullscreen_busy() })
            .await
            .unwrap_or(false);


        // 更新调试信息
        let debug_info = SystemDebugInfo {
            observer_running: true,
            last_check_time: chrono::Local::now().format(TIME_FORMAT_SHORT).to_string(),
            is_fullscreen_busy: is_fullscreen,
            auto_dnd_enabled: auto_silence,
            is_auto_dnd_active: *we_enabled_dnd,
            current_silence_mode: is_silence_mode,
            session_locked,
        };
        update_cached_debug_info(debug_info.clone());

        // 发送调试事件通知前端
        let _ = emit_debug_update(&app_handle, DEBUG_EVENT_TYPE_SYSTEM, &debug_info);

        // 确定目标状态：仅当开启自动免打扰且处于全屏且（未锁定或不抑制锁屏时DND）时，才应自动进入 DND
        let should_be_dnd = auto_silence && is_fullscreen
            && (!session_locked || !crate::modules::constants::SYSTEM_OBSERVER_SUPPRESS_DND_WHEN_LOCKED);

        #[cfg(debug_assertions)]
        if is_fullscreen {
            println!(
                "[SystemObserver] Fullscreen detected. Auto-DND enabled: {}, Session locked: {}, Should enter DND: {}",
                auto_silence, session_locked, should_be_dnd
            );
        }

        if should_be_dnd {
            // 目标：开启 DND
            if !is_silence_mode {
                println!("[SystemObserver] Detected Fullscreen/Busy. Auto-enabling DND.");
                if let Ok(()) = Self::set_dnd_mode(app_handle, true) {
                    if let Some(handler) =
                        Self::get_force_change_handler(app_handle, STATE_SILENCE_START)
                    {
                        let _ = handler();
                    }
                    *we_enabled_dnd = true;
                }
            }
            // 如果已经是 DND，可能是用户手动开启，也可能是我们之前开启，保持现状
        } else {
            // 目标：关闭 DND (仅当我们自动开启时)

            if is_silence_mode && *we_enabled_dnd {
                // 当前是 DND 且是我们开启的 -> 恢复正常
                println!("[SystemObserver] Exiting Auto-DND state.");
                if let Ok(()) = Self::set_dnd_mode(app_handle, false) {
                    if let Some(handler) =
                        Self::get_force_change_handler(app_handle, STATE_SILENCE_END)
                    {
                        let _ = handler();
                    }
                    *we_enabled_dnd = false;
                }
            } else if !is_silence_mode {
                // 当前不是 DND (用户手动关闭了)，重置标识
                *we_enabled_dnd = false;
            }
        }
    }

    /// 使用 SHQueryUserNotificationState 和 DWM 边界检测全屏/繁忙状态
    unsafe fn is_fullscreen_busy() -> bool {
        use windows::Win32::Foundation::RECT;
        use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
        use windows::Win32::Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        };
        use windows::Win32::UI::Shell::{
            SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE,
            QUNS_RUNNING_D3D_FULL_SCREEN,
        };
        use windows::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowLongW, GWL_STYLE, WS_POPUP,
        };

        // 1. 检查系统通知状态（全屏 D3D、演示模式、繁忙）
        let state_ok = if let Ok(state) = SHQueryUserNotificationState() {
            match state {
                QUNS_RUNNING_D3D_FULL_SCREEN | QUNS_PRESENTATION_MODE | QUNS_BUSY => true,
                _ => false,
            }
        } else {
            false
        };

        if !state_ok {
            return false;
        }

        // 2. 进一步验证：检查前景窗口是否占据了显示器的大部分或全部区域
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return false;
        }

        // 获取精确的视觉边界（排除阴影）
        let mut visual_rect = get_visual_window_rect(hwnd);
        if visual_rect.left == 0 && visual_rect.right == 0 {
            // 回退到普通 Rect
            use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
            if GetWindowRect(hwnd, &mut visual_rect).is_err() {
                return false;
            }
        }

        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if monitor.0.is_null() {
            return false;
        }

        let mut monitor_info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };

        if GetMonitorInfoW(monitor, &mut monitor_info).into() {
            let m_rect = monitor_info.rcMonitor;

            // 判定标准：窗口边界是否基本覆盖显示器边界
            let threshold = 5; // 允许稍微宽松一点的判定
            let is_covering_monitor = visual_rect.left <= m_rect.left + threshold
                && visual_rect.top <= m_rect.top + threshold
                && visual_rect.right >= m_rect.right - threshold
                && visual_rect.bottom >= m_rect.bottom - threshold;

            // 附加检查：全屏应用通常没有边框 (WS_POPUP) 或者是最大化的
            let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
            let looks_like_fullscreen = (style & WS_POPUP.0) != 0 || is_covering_monitor;

            return is_covering_monitor && looks_like_fullscreen;
        }

        false
    }

    /// 更新免打扰设置
    fn set_dnd_mode(app_handle: &tauri::AppHandle, enable: bool) -> Result<(), String> {
        let app_state: tauri::State<AppState> = app_handle.state();
        let mut storage = app_state.storage.lock().unwrap();

        storage.data.settings.silence_mode = enable;
        let settings = storage.data.settings.clone();
        storage.save()?;

        // Drops the lock explicitly before emitting event to avoid deadlock
        // (Listener inner_build_tray_menu needs to lock storage)
        drop(storage);

        #[cfg(debug_assertions)]
        println!(
            "[SystemObserver] set_dnd_mode called with enable={}",
            enable
        );

        // 发送设置变更事件到前端
        let _ = emit_settings(&app_handle, &settings);
        Ok(())
    }

    /// 获取强制状态切换的闭包（避免借用冲突）
    fn get_force_change_handler(
        app_handle: &tauri::AppHandle,
        target_state: &str,
    ) -> Option<Box<dyn Fn() -> Result<(), String>>> {
        let app_state: tauri::State<AppState> = app_handle.state();
        let rm = app_state.resource_manager.lock().unwrap();

        if let Some(state_info) = rm.get_state_by_name(target_state).cloned() {
            let app_handle_clone = app_handle.clone();
            return Some(Box::new(move || {
                let app_state: tauri::State<AppState> = app_handle_clone.state();
                // 关键修复：确保锁的获取顺序与主线程一致 (Resource -> State)
                // 主线程 (如 trigger_event) 是先锁 Resource 后锁 State
                // 这里如果只锁 State，内部 change_state_ex 可能会再次尝试锁 Resource，导致死锁

                // 1. 先获取 ResourceManager 锁
                let rm = app_state.resource_manager.lock().unwrap();
                // 2. 再获取 StateManager 锁
                let mut sm = app_state.state_manager.lock().unwrap();

                // 3. 使用 _with_rm 变体传入已持有的锁引用，避免死锁
                sm.change_state_ex(state_info.clone(), true, &rm)?;
                Ok(())
            }));
        }
        None
    }
}

// 全局静态变量用于回调通信
lazy_static::lazy_static! {
    static ref GLOBAL_TX: Mutex<Option<mpsc::UnboundedSender<()>>> = Mutex::new(None);
}

// Stub for non-Windows
#[cfg(not(target_os = "windows"))]
pub struct SystemObserver;

#[cfg(not(target_os = "windows"))]
impl SystemObserver {
    pub fn new() -> Self {
        Self
    }
    pub fn start(&self, _app: tauri::AppHandle) {}
    pub fn stop(&self) {}
}
