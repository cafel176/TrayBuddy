//! lib.rs 中拆出的非命令辅助函数
//!
//! 包含不属于 IPC 命令（`commands/`）但与应用核心流程紧密相关的辅助逻辑：
//! - 渲染窗口（animation / live2d / pngremix / threed）的创建与重建
//! - 托盘菜单构建与交互处理
//! - 全局键盘/鼠标输入钩子（Windows）
//! - 窗口图标管理
//! - 应用初始化流程

#![allow(unused)]

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::modules::constants::{
    ANIMATION_AREA_HEIGHT, ANIMATION_AREA_WIDTH, ANIMATION_BORDER, BUBBLE_AREA_HEIGHT,
    BUBBLE_AREA_WIDTH, MAX_BUTTONS_PER_ROW, MAX_CHARS_PER_BUTTON, MAX_CHARS_PER_LINE,
    MOD_LOGIN_EVENT_DELAY_SECS, RENDER_WINDOW_LABELS, SHORT_TEXT_THRESHOLD, STATE_IDLE, STATE_MUSIC_END,
    STATE_MUSIC_START,     STATE_SILENCE, STATE_SILENCE_END, STATE_SILENCE_START, TRAY_ID_MAIN,
    WINDOW_LABEL_ABOUT, WINDOW_LABEL_ANIMATION, WINDOW_LABEL_LIVE2D, WINDOW_LABEL_MAIN,
    WINDOW_LABEL_MEMO, WINDOW_LABEL_MODS, WINDOW_LABEL_PNGREMIX, WINDOW_LABEL_REMINDER, WINDOW_LABEL_REMINDER_ALERT,
    WINDOW_LABEL_SETTINGS, WINDOW_LABEL_THREED, EVENT_LOGIN, EVENT_MUSIC_END, EVENT_MUSIC_START, EVENT_WORK,
    WORK_EVENT_COOLDOWN_SECS
};


use crate::modules::event_manager::{emit, emit_from_tauri_window, emit_from_window, emit_settings, events};
use crate::modules::environment::{
    get_cached_location, get_cached_weather, get_current_datetime, get_current_season,
    get_time_period, init_environment, DateTimeInfo, EnvironmentManager, GeoLocation, WeatherInfo,
};
use crate::modules::media_observer::{
    get_cached_debug_info, MediaDebugInfo, MediaObserver, MediaPlaybackStatus,
};
use crate::modules::process_observer::{
    get_cached_process_debug_info, ProcessDebugInfo, ProcessObserver, ProcessStartEvent,
};
use crate::modules::resource::{
    self, AssetInfo, AudioInfo, CharacterInfo, ModInfo, ModType, ResourceManager, StateInfo,
    TextInfo, TriggerInfo,
};

use crate::modules::state::StateManager;
use crate::modules::storage::{
    MemoItem, ModData, ReminderItem, ReminderSchedule, Storage, UserInfo, UserSettings,
};
use crate::modules::system_observer::{SystemDebugInfo, SystemObserver};
use crate::modules::utils::i18n::get_i18n_text as get_i18n_text_cached;
use crate::app_state::*;
use crate::commands::*;
use std::sync::{Arc, Mutex, OnceLock};




use std::sync::atomic::{AtomicBool, Ordering};


use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Listener, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_autostart::ManagerExt;

// ========================================================================= //
// 全局输入状态（Windows）
// ========================================================================= //

/// 全局输入钩子是否已启动（防止重复安装）
#[cfg(target_os = "windows")]
static GLOBAL_INPUT_HOOK_STARTED: AtomicBool = AtomicBool::new(false);

/// 全局输入上下文（包含 AppHandle 和回调通道），用于钩子回调访问应用状态
#[cfg(target_os = "windows")]
static GLOBAL_INPUT_CONTEXT: OnceLock<GlobalInputContext> = OnceLock::new();
/// 全局键盘按键状态表，索引为虚拟键码 (0–255)，`true` 表示当前按下
#[cfg(target_os = "windows")]
static GLOBAL_KEY_STATES: OnceLock<Mutex<[bool; 256]>> = OnceLock::new();
/// 全局鼠标按键状态，`[0]` = 左键，`[1]` = 右键
#[cfg(target_os = "windows")]
static GLOBAL_MOUSE_STATES: OnceLock<Mutex<[bool; 2]>> = OnceLock::new();
/// 上一次轮询周期键盘监听是否启用（用于检测启用/禁用切换）
#[cfg(target_os = "windows")]
static GLOBAL_KEYBOARD_LAST_ENABLED: AtomicBool = AtomicBool::new(false);
/// 上一次轮询周期鼠标监听是否启用（用于检测启用/禁用切换）
#[cfg(target_os = "windows")]
static GLOBAL_MOUSE_LAST_ENABLED: AtomicBool = AtomicBool::new(false);




/// 内部函数：创建渲染窗口（统一逻辑）
///
/// 所有渲染窗口（animation、live2d、pngremix、threed）共享完全相同的
/// 创建流程：读取设置 → 计算尺寸 → 构建窗口 → 设置图标/事件/穿透/位置。
/// 唯一的差异是窗口标签和 i18n 标题键，通过参数传入。
fn inner_create_render_window(app: &tauri::AppHandle, label: &str, title_key: &str) -> Result<(), String> {
    let state: State<'_, AppState> = app.state();

    // 1. 获取缩放和位置设置
    let (scale, saved_position, is_silence, streamer_mode) = {
        let storage = state.storage.lock().unwrap();
        (
            storage.data.settings.animation_scale as f64,
            (
                storage.data.info.animation_window_x,
                storage.data.info.animation_window_y,
            ),
            storage.data.settings.silence_mode,
            storage.data.settings.streamer_mode,
        )
    };

    // 2. 计算窗口尺寸
    let bubble_area_height = BUBBLE_AREA_HEIGHT;
    let bubble_area_width = BUBBLE_AREA_WIDTH;
    let animation_area_height = ANIMATION_AREA_HEIGHT * scale;
    let animation_area_width = ANIMATION_AREA_WIDTH * scale;
    let window_width = bubble_area_width.max(animation_area_width);
    let window_height = bubble_area_height + animation_area_height;

    // 3. 构建并创建窗口（已存在则直接返回）
    if app.get_webview_window(label).is_some() {
        return Ok(());
    }

    let render_window =
        WebviewWindowBuilder::new(app, label, WebviewUrl::App(label.into()))
            .title(get_i18n_text(app, title_key))
            .inner_size(window_width, window_height)
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .resizable(false)
            .shadow(false)
            .skip_taskbar(!streamer_mode)
            .build()
            .map_err(|e| e.to_string())?;

    // 应用当前 Mod 的图标（用于 Alt-Tab / 任务管理器等显示）
    apply_window_icon(app, &render_window);

    // 渲染窗口拦截关闭事件，改为隐藏，以保持后台渲染进程常驻
    let w_clone = render_window.clone();
    render_window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = w_clone.hide();
        }
    });

    // 4. 初始鼠标穿透
    if is_silence {
        let _ = render_window.set_ignore_cursor_events(true);
    }

    // 5. 设置窗口位置
    if let (Some(x), Some(y)) = saved_position {
        let window_y = y - bubble_area_height;
        let _ = render_window
            .set_position(tauri::Position::Logical(LogicalPosition::new(x, window_y)));
    } else if let Some(monitor) = render_window.primary_monitor().ok().flatten() {
        let scale_factor = monitor.scale_factor();
        let screen_size = monitor.size();
        let screen_pos = monitor.position();
        const TASKBAR_HEIGHT: f64 = 48.0;

        let screen_w = screen_size.width as f64 / scale_factor;
        let screen_h = screen_size.height as f64 / scale_factor;

        let x = screen_pos.x as f64 + screen_w - window_width;
        let y = screen_pos.y as f64 + screen_h - window_height - TASKBAR_HEIGHT;

        let _ = render_window.set_position(tauri::Position::Logical(LogicalPosition::new(x, y)));
    }

    Ok(())
}

/// 创建动画窗口
pub(crate) fn inner_create_animation_window(app: &tauri::AppHandle) -> Result<(), String> {
    inner_create_render_window(app, WINDOW_LABEL_ANIMATION, "common.animationTitle")
}

/// 创建 Live2D 窗口
pub(crate) fn inner_create_live2d_window(app: &tauri::AppHandle) -> Result<(), String> {
    inner_create_render_window(app, WINDOW_LABEL_LIVE2D, "common.live2dTitle")
}

/// 创建 PngRemix 窗口
pub(crate) fn inner_create_pngremix_window(app: &tauri::AppHandle) -> Result<(), String> {
    inner_create_render_window(app, WINDOW_LABEL_PNGREMIX, "common.pngremixTitle")
}

/// 创建 3D 窗口
pub(crate) fn inner_create_threed_window(app: &tauri::AppHandle) -> Result<(), String> {
    inner_create_render_window(app, WINDOW_LABEL_THREED, "common.threeDTitle")
}



// ========================================================================= //
// 辅助函数
// ========================================================================= //

/// 获取当前活跃的渲染窗口（animation、live2d、pngremix 或 threed）
///
/// 按 RENDER_WINDOW_LABELS 顺序查找第一个存在的渲染窗口。
/// 用于需要操作"当前渲染窗口"但不关心具体类型的场景。
pub(crate) fn get_render_window(app: &tauri::AppHandle) -> Option<WebviewWindow> {
    RENDER_WINDOW_LABELS
        .iter()
        .find_map(|label| app.get_webview_window(label))
}

/// 等待状态解锁（避免与 play_once 状态冲突）
///
/// 轮询检查状态管理器是否被锁定，最多等待 STATE_LOCK_MAX_RETRIES × STATE_LOCK_WAIT_INTERVAL_MS 毫秒。
/// 同时监听 state_unlock_notify 以便在状态解锁时立即返回。
async fn wait_for_state_unlock(app_state: &State<'_, AppState>) {
    use crate::modules::constants::{STATE_LOCK_MAX_RETRIES, STATE_LOCK_WAIT_INTERVAL_MS};
    let notify = get_state_unlock_notify();
    for _ in 0..STATE_LOCK_MAX_RETRIES {
        let is_locked = {
            let sm = app_state.state_manager.lock().unwrap();
            sm.is_locked()
        };
        if !is_locked {
            break;
        }
        tokio::select! {
            _ = notify.notified() => {},
            _ = tokio::time::sleep(tokio::time::Duration::from_millis(
                STATE_LOCK_WAIT_INTERVAL_MS,
            )) => {}
        }
    }
}

/// 启动媒体监听器（独立线程）
fn start_media_observer(app_handle: tauri::AppHandle, skip_delay: bool) {
    tauri::async_runtime::spawn(async move {
        let mut observer = MediaObserver::new();
        let rx = observer.start(app_handle.clone(), skip_delay);

        let mut rx = rx;
        while let Some(event) = rx.recv().await {
            let app_state: State<AppState> = app_handle.state();

            // 检查是否处于免打扰模式
            let is_silence = {
                let storage = app_state.storage.lock().unwrap();
                storage.data.settings.silence_mode
            };

            if is_silence {
                // 免打扰模式下忽略媒体状态变化
                continue;
            }

            // 等待状态解锁
            wait_for_state_unlock(&app_state).await;


            match event.status {
                MediaPlaybackStatus::Playing => {
                    let _ = app_state.trigger_event(EVENT_MUSIC_START, false);
                }
                MediaPlaybackStatus::Paused | MediaPlaybackStatus::Stopped | MediaPlaybackStatus::Unknown => {
                    let _ = app_state.trigger_event(EVENT_MUSIC_END, false);
                }
                _ => {}
            }
        }
    });
}


/// 启动进程监测器（独立线程）
///
/// - 监听"新进程启动"
/// - 若进程名包含 `config/process_observer_keywords.json` 中的任意关键字，则触发一次 `work` 事件
fn start_process_observer(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut observer = ProcessObserver::new();
        let rx = observer.start(app_handle.clone());

        let mut rx = rx;

        while let Some(ProcessStartEvent { pid, process_name, matched_keyword }) = rx.recv().await {
            let app_state: State<AppState> = app_handle.state();

            // 免打扰模式下不触发 work
            let is_silence = {
                let storage = app_state.storage.lock().unwrap();
                storage.data.settings.silence_mode
            };
            if is_silence {
                continue;
            }

            // 等待状态解锁（避免与 play_once 状态冲突）
            wait_for_state_unlock(&app_state).await;


            // work 事件节流：间隔不足则跳过
            let now_ts = chrono::Local::now().timestamp();
            let should_fire = {
                let mut guard = LAST_WORK_EVENT_AT.lock().unwrap();
                let ok = guard.map_or(true, |last| now_ts - last >= WORK_EVENT_COOLDOWN_SECS);
                if ok {
                    *guard = Some(now_ts);
                }
                ok
            };

            if !should_fire {
                continue;
            }

            #[cfg(debug_assertions)]
            println!(
                "[ProcessObserver] New process matched: pid={}, name={}, keyword={}",
                pid, process_name, matched_keyword
            );

            let _ = app_state.trigger_event(EVENT_WORK, false);
        }
    });
}


#[cfg(target_os = "windows")]
struct GlobalInputContext {
    app_handle: tauri::AppHandle,
    keyboard_enabled: Arc<AtomicBool>,
    mouse_enabled: Arc<AtomicBool>,
    drag_tracking_enabled: Arc<AtomicBool>,
}


#[cfg(target_os = "windows")]
fn get_global_input_context() -> Option<&'static GlobalInputContext> {
    GLOBAL_INPUT_CONTEXT.get()
}

#[cfg(target_os = "windows")]
pub(crate) fn set_drag_tracking_enabled(enabled: bool) -> bool {

    if let Some(ctx) = get_global_input_context() {
        ctx.drag_tracking_enabled
            .store(enabled, std::sync::atomic::Ordering::Relaxed);
        true
    } else {
        false
    }
}

#[cfg(target_os = "windows")]
fn get_global_key_states() -> &'static Mutex<[bool; 256]> {

    GLOBAL_KEY_STATES.get_or_init(|| Mutex::new([false; 256]))
}

#[cfg(target_os = "windows")]
fn get_global_mouse_states() -> &'static Mutex<[bool; 2]> {
    GLOBAL_MOUSE_STATES.get_or_init(|| Mutex::new([false; 2]))
}

#[cfg(target_os = "windows")]
fn reset_global_key_states() {
    if let Ok(mut guard) = get_global_key_states().lock() {
        for v in guard.iter_mut() {
            *v = false;
        }
    }
}

#[cfg(target_os = "windows")]
fn reset_global_mouse_states() {
    if let Ok(mut guard) = get_global_mouse_states().lock() {
        for v in guard.iter_mut() {
            *v = false;
        }
    }
}

#[cfg(target_os = "windows")]
fn map_vk_code(vk: u32) -> Option<&'static str> {
    match vk {
        // 字母键 A-Z
        0x41 => Some("KeyA"), 0x42 => Some("KeyB"), 0x43 => Some("KeyC"), 0x44 => Some("KeyD"),
        0x45 => Some("KeyE"), 0x46 => Some("KeyF"), 0x47 => Some("KeyG"), 0x48 => Some("KeyH"),
        0x49 => Some("KeyI"), 0x4A => Some("KeyJ"), 0x4B => Some("KeyK"), 0x4C => Some("KeyL"),
        0x4D => Some("KeyM"), 0x4E => Some("KeyN"), 0x4F => Some("KeyO"), 0x50 => Some("KeyP"),
        0x51 => Some("KeyQ"), 0x52 => Some("KeyR"), 0x53 => Some("KeyS"), 0x54 => Some("KeyT"),
        0x55 => Some("KeyU"), 0x56 => Some("KeyV"), 0x57 => Some("KeyW"), 0x58 => Some("KeyX"),
        0x59 => Some("KeyY"), 0x5A => Some("KeyZ"),
        // 数字键 0-9
        0x30 => Some("Digit0"), 0x31 => Some("Digit1"), 0x32 => Some("Digit2"), 0x33 => Some("Digit3"),
        0x34 => Some("Digit4"), 0x35 => Some("Digit5"), 0x36 => Some("Digit6"), 0x37 => Some("Digit7"),
        0x38 => Some("Digit8"), 0x39 => Some("Digit9"),
        // 常用控制键
        0x08 => Some("Backspace"),  // VK_BACK
        0x09 => Some("Tab"),        // VK_TAB
        0x0D => Some("Enter"),      // VK_RETURN
        0x13 => Some("Pause"),      // VK_PAUSE
        0x14 => Some("CapsLock"),   // VK_CAPITAL
        0x1B => Some("Escape"),     // VK_ESCAPE
        0x20 => Some("Space"),      // VK_SPACE
        // 导航键
        0x21 => Some("PageUp"),     // VK_PRIOR
        0x22 => Some("PageDown"),   // VK_NEXT
        0x23 => Some("End"),        // VK_END
        0x24 => Some("Home"),       // VK_HOME
        0x25 => Some("ArrowLeft"),  // VK_LEFT
        0x26 => Some("ArrowUp"),    // VK_UP
        0x27 => Some("ArrowRight"), // VK_RIGHT
        0x28 => Some("ArrowDown"),  // VK_DOWN
        0x2C => Some("PrintScreen"),// VK_SNAPSHOT
        0x2D => Some("Insert"),     // VK_INSERT
        0x2E => Some("Delete"),     // VK_DELETE
        // 修饰键（通用）
        0x10 => Some("Shift"),   // VK_SHIFT
        0x11 => Some("Control"), // VK_CONTROL
        0x12 => Some("Alt"),     // VK_MENU
        // 修饰键（左右区分）— 低级键盘钩子会发送具体的左/右键码
        0xA0 => Some("Shift"),   // VK_LSHIFT
        0xA1 => Some("Shift"),   // VK_RSHIFT
        0xA2 => Some("Control"), // VK_LCONTROL
        0xA3 => Some("Control"), // VK_RCONTROL
        0xA4 => Some("Alt"),     // VK_LMENU
        0xA5 => Some("Alt"),     // VK_RMENU
        // Windows 键与应用键
        0x5B => Some("MetaLeft"),    // VK_LWIN
        0x5C => Some("MetaRight"),   // VK_RWIN
        0x5D => Some("ContextMenu"), // VK_APPS
        // 数字小键盘
        0x60 => Some("Numpad0"), 0x61 => Some("Numpad1"), 0x62 => Some("Numpad2"),
        0x63 => Some("Numpad3"), 0x64 => Some("Numpad4"), 0x65 => Some("Numpad5"),
        0x66 => Some("Numpad6"), 0x67 => Some("Numpad7"), 0x68 => Some("Numpad8"),
        0x69 => Some("Numpad9"),
        0x6A => Some("NumpadMultiply"),  // VK_MULTIPLY
        0x6B => Some("NumpadAdd"),       // VK_ADD
        0x6D => Some("NumpadSubtract"),  // VK_SUBTRACT
        0x6E => Some("NumpadDecimal"),   // VK_DECIMAL
        0x6F => Some("NumpadDivide"),    // VK_DIVIDE
        // F 键
        0x70 => Some("F1"),  0x71 => Some("F2"),  0x72 => Some("F3"),  0x73 => Some("F4"),
        0x74 => Some("F5"),  0x75 => Some("F6"),  0x76 => Some("F7"),  0x77 => Some("F8"),
        0x78 => Some("F9"),  0x79 => Some("F10"), 0x7A => Some("F11"), 0x7B => Some("F12"),
        0x7C => Some("F13"), 0x7D => Some("F14"), 0x7E => Some("F15"), 0x7F => Some("F16"),
        0x80 => Some("F17"), 0x81 => Some("F18"), 0x82 => Some("F19"), 0x83 => Some("F20"),
        0x84 => Some("F21"), 0x85 => Some("F22"), 0x86 => Some("F23"), 0x87 => Some("F24"),
        // 锁定键
        0x90 => Some("NumLock"),    // VK_NUMLOCK
        0x91 => Some("ScrollLock"), // VK_SCROLL
        // OEM 键（美式键盘布局）
        0xBA => Some("Semicolon"),    // VK_OEM_1  ;:
        0xBB => Some("Equal"),        // VK_OEM_PLUS  =+
        0xBC => Some("Comma"),        // VK_OEM_COMMA  ,<
        0xBD => Some("Minus"),        // VK_OEM_MINUS  -_
        0xBE => Some("Period"),       // VK_OEM_PERIOD  .>
        0xBF => Some("Slash"),        // VK_OEM_2  /?
        0xC0 => Some("Backquote"),    // VK_OEM_3  `~
        0xDB => Some("BracketLeft"),  // VK_OEM_4  [{
        0xDC => Some("Backslash"),    // VK_OEM_5  \|
        0xDD => Some("BracketRight"), // VK_OEM_6  ]}
        0xDE => Some("Quote"),        // VK_OEM_7  '"
        0xE2 => Some("IntlBackslash"), // VK_OEM_102 (ISO 键盘额外键)
        // 多媒体键
        0xAD => Some("AudioVolumeMute"),     // VK_VOLUME_MUTE
        0xAE => Some("AudioVolumeDown"),     // VK_VOLUME_DOWN
        0xAF => Some("AudioVolumeUp"),       // VK_VOLUME_UP
        0xB0 => Some("MediaTrackNext"),      // VK_MEDIA_NEXT_TRACK
        0xB1 => Some("MediaTrackPrevious"),  // VK_MEDIA_PREV_TRACK
        0xB2 => Some("MediaStop"),           // VK_MEDIA_STOP
        0xB3 => Some("MediaPlayPause"),      // VK_MEDIA_PLAY_PAUSE
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn should_emit_key_to_frontend(code: &str) -> bool {
    matches!(
        code,
        "Space" | "Enter" | "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"
    )
}

#[cfg(target_os = "windows")]
fn trigger_event_with_state_manager(event_name: &str) {
    let Some(ctx) = get_global_input_context() else {
        return;
    };
    let Some(app_state) = ctx.app_handle.try_state::<AppState>() else {
        return;
    };
    let _ = app_state.trigger_event(event_name, false);
}

#[cfg(target_os = "windows")]
fn emit_global_keyboard_event(code: &str, pressed: bool) {
    let Some(ctx) = get_global_input_context() else {
        return;
    };
    let event_name = if pressed {
        format!("keydown:{}", code)
    } else {
        format!("keyup:{}", code)
    };
    trigger_event_with_state_manager(&event_name);
    trigger_event_with_state_manager(if pressed { "global_keydown" } else { "global_keyup" });

    if should_emit_key_to_frontend(code) {
        let _ = ctx
            .app_handle
            .emit(if pressed { "global-keydown" } else { "global-keyup" }, code);
    }

    let _ = ctx.app_handle.emit(
        "global-key-state",
        serde_json::json!({
            "code": code,
            "pressed": pressed
        }),
    );
}

/// 检查按下的键是否为 AI 工具热键，如果是且当前有匹配进程，则触发 manual 截图
#[cfg(target_os = "windows")]
fn check_ai_tool_hotkey(code: &str, app: &tauri::AppHandle) {
    use crate::modules::ai_tool_manager;

    // 必须当前有匹配的 AI 工具进程
    if ai_tool_manager::get_matched_ai_tool_process().is_none() {
        return;
    }

    // 读取用户设置的热键
    let hotkey = {
        let app_state: tauri::State<AppState> = app.state();
        let storage = app_state.storage.lock().unwrap();
        storage.data.settings.ai_tool_hotkey.to_string()
    };

    // 比较按键码与热键设置（不区分大小写）
    if code.eq_ignore_ascii_case(&hotkey) {
        ai_tool_manager::notify_manual_capture();
    }
}

/// macOS 占位：全局键盘 hook 尚未实现，AI 工具热键检测无操作
#[cfg(target_os = "macos")]
fn check_ai_tool_hotkey(_code: &str, _app: &tauri::AppHandle) {}

/// Linux 占位：全局键盘 hook 尚未实现，AI 工具热键检测无操作
#[cfg(target_os = "linux")]
fn check_ai_tool_hotkey(_code: &str, _app: &tauri::AppHandle) {}

#[cfg(target_os = "windows")]
fn emit_global_mouse_state(button: &str, pressed: bool) {
    let Some(ctx) = get_global_input_context() else {
        return;
    };
    let _ = ctx.app_handle.emit(
        "global-mouse-state",
        serde_json::json!({
            "button": button,
            "pressed": pressed
        }),
    );
}

#[cfg(target_os = "windows")]
fn emit_drag_mouse_state(pressed: bool) {
    let Some(ctx) = get_global_input_context() else {
        return;
    };
    let _ = ctx.app_handle.emit(
        "drag-mouse-state",
        serde_json::json!({
            "pressed": pressed
        }),
    );
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn global_keyboard_hook_proc(

    code: i32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, HHOOK, KBDLLHOOKSTRUCT, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    let null_hook = HHOOK(std::ptr::null_mut());

    if code < 0 {
        return CallNextHookEx(null_hook, code, wparam, lparam);
    }

    let Some(ctx) = get_global_input_context() else {
        return CallNextHookEx(null_hook, code, wparam, lparam);
    };

    // AI 工具热键始终检测（不受 keyboard_enabled 开关影响）
    let msg = wparam.0 as u32;
    let is_down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
    let is_up = msg == WM_KEYUP || msg == WM_SYSKEYUP;

    if is_down || is_up {
        let kbd = *(lparam.0 as *const KBDLLHOOKSTRUCT);
        let vk = kbd.vkCode as usize;
        if vk < 256 {
            if let Some(key_code) = map_vk_code(kbd.vkCode) {
                // AI 工具热键：无论 keyboard_enabled 如何都检测
                if is_down {
                    check_ai_tool_hotkey(key_code, &ctx.app_handle);
                }

                // 其余全局键盘事件仍受 keyboard_enabled 控制
                if ctx.keyboard_enabled.load(Ordering::Relaxed) {
                    if !GLOBAL_KEYBOARD_LAST_ENABLED.swap(true, Ordering::Relaxed) {
                        reset_global_key_states();
                    }
                    let mut states = get_global_key_states().lock().unwrap();
                    let was_pressed = states[vk];
                    if is_down && !was_pressed {
                        states[vk] = true;
                        drop(states);
                        emit_global_keyboard_event(key_code, true);
                    } else if is_up && was_pressed {
                        states[vk] = false;
                        drop(states);
                        emit_global_keyboard_event(key_code, false);
                    }
                } else if GLOBAL_KEYBOARD_LAST_ENABLED.swap(false, Ordering::Relaxed) {
                    reset_global_key_states();
                }
            }
        }
    }

    CallNextHookEx(null_hook, code, wparam, lparam)
}


#[cfg(target_os = "windows")]
unsafe extern "system" fn global_mouse_hook_proc(
    code: i32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, HHOOK, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_RBUTTONDOWN, WM_RBUTTONUP,
    };

    let null_hook = HHOOK(std::ptr::null_mut());

    if code < 0 {
        return CallNextHookEx(null_hook, code, wparam, lparam);
    }

    let Some(ctx) = get_global_input_context() else {
        return CallNextHookEx(null_hook, code, wparam, lparam);
    };

    let mouse_enabled = ctx.mouse_enabled.load(Ordering::Relaxed);
    let drag_tracking_enabled = ctx.drag_tracking_enabled.load(Ordering::Relaxed);

    if !mouse_enabled && !drag_tracking_enabled {
        if GLOBAL_MOUSE_LAST_ENABLED.swap(false, Ordering::Relaxed) {
            reset_global_mouse_states();
        }
        return CallNextHookEx(null_hook, code, wparam, lparam);
    }

    if !GLOBAL_MOUSE_LAST_ENABLED.swap(true, Ordering::Relaxed) {
        reset_global_mouse_states();
    }

    let msg = wparam.0 as u32;
    let (idx, event_name, pressed) = match msg {
        WM_LBUTTONDOWN => (0usize, "global_click", true),
        WM_LBUTTONUP => (0usize, "global_click", false),
        WM_RBUTTONDOWN => (1usize, "global_right_click", true),
        WM_RBUTTONUP => (1usize, "global_right_click", false),
        _ => return CallNextHookEx(null_hook, code, wparam, lparam),
    };

    let mut states = get_global_mouse_states().lock().unwrap();
    let was_pressed = states[idx];

    if pressed && !was_pressed {
        states[idx] = true;
        drop(states);
        if mouse_enabled {
            trigger_event_with_state_manager(event_name);
            emit_global_mouse_state(event_name, true);
        } else if drag_tracking_enabled && event_name == "global_click" {
            emit_drag_mouse_state(true);
        }
    } else if !pressed && was_pressed {
        states[idx] = false;
        drop(states);
        if mouse_enabled {
            emit_global_mouse_state(event_name, false);
            let up_event_name = match event_name {
                "global_click" => "global_click_up",
                "global_right_click" => "global_right_click_up",
                _ => "",
            };
            if !up_event_name.is_empty() {
                trigger_event_with_state_manager(up_event_name);
            }
        } else if drag_tracking_enabled && event_name == "global_click" {
            emit_drag_mouse_state(false);
        }
    }


    CallNextHookEx(null_hook, code, wparam, lparam)
}


/// 启动全局输入监听器（系统 Hook 事件驱动）
fn start_global_input_hook(app_handle: tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HINSTANCE;
        use windows::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows::Win32::UI::WindowsAndMessaging::{
            DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage,
            UnhookWindowsHookEx, MSG, WH_KEYBOARD_LL, WH_MOUSE_LL,
        };


        if GLOBAL_INPUT_HOOK_STARTED.swap(true, Ordering::SeqCst) {
            return;
        }

        let keyboard_enabled = {
            let app_state = app_handle.state::<AppState>();
            app_state.global_keyboard_enabled.clone()
        };
        let mouse_enabled = {
            let app_state = app_handle.state::<AppState>();
            app_state.global_mouse_enabled.clone()
        };

        let drag_tracking_enabled = Arc::new(AtomicBool::new(false));

        let _ = GLOBAL_INPUT_CONTEXT.set(GlobalInputContext {
            app_handle,
            keyboard_enabled,
            mouse_enabled,
            drag_tracking_enabled,
        });


        std::thread::spawn(|| unsafe {
            let module = GetModuleHandleW(None).unwrap_or_default();
            let hinstance = HINSTANCE(module.0);



            let hook_keyboard = SetWindowsHookExW(
                WH_KEYBOARD_LL,
                Some(global_keyboard_hook_proc),
                hinstance,
                0,
            )
            .ok();
            let hook_mouse = SetWindowsHookExW(
                WH_MOUSE_LL,
                Some(global_mouse_hook_proc),
                hinstance,
                0,
            )
            .ok();

            if hook_keyboard.is_none() {
                println!("[GlobalInput] Failed to install keyboard hook");
            }
            if hook_mouse.is_none() {
                println!("[GlobalInput] Failed to install mouse hook");
            }

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).into() {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            if let Some(hook) = hook_keyboard {
                let _ = UnhookWindowsHookEx(hook);
            }
            if let Some(hook) = hook_mouse {
                let _ = UnhookWindowsHookEx(hook);
            }
        });
    }


    /// TODO(cross-platform): macOS — 使用 CGEventTap 监听全局键盘/鼠标事件（需要辅助功能权限）；
    ///                        Linux — 使用 XRecord 扩展或 /dev/input 监听全局输入事件。
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app_handle;
        eprintln!("[GlobalInputHook] 全局输入钩子在非 Windows 平台暂未实现");
    }
}

/// 启动全局键盘监听器（独立线程）
///
/// 当 Mod 的 `global_keyboard` 为 true 时，使用系统级 Hook 事件驱动触发按键事件。
fn start_global_keyboard_listener(app_handle: tauri::AppHandle) {
    start_global_input_hook(app_handle);
}

/// 启动全局鼠标监听器（独立线程）
///
/// 当 Mod 的 `global_mouse` 为 true 时，使用系统级 Hook 事件驱动触发鼠标事件。
fn start_global_mouse_listener(app_handle: tauri::AppHandle) {
    start_global_input_hook(app_handle);
}


/// 启动提醒调度器（独立线程）
fn start_reminder_scheduler(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        use chrono::Local;
        use std::time::Duration;

        let notify = get_reminder_scheduler_notify();

        loop {
            let app_handle_for_storage = app_handle.clone();
            let (due, next_wait_secs) = tokio::task::spawn_blocking(move || {
                let now_ts = Local::now().timestamp();
                let mut due: Vec<ReminderAlertPayload> = Vec::new();
                let mut changed = false;
                let mut next_ts: Option<i64> = None;

                {
                    let app_state: State<AppState> = app_handle_for_storage.state();
                    let mut storage = app_state.storage.lock().unwrap();

                    for r in storage.data.info.reminders.iter_mut() {
                        if !r.enabled {
                            continue;
                        }

                        if r.next_trigger_at == 0 {
                            // 兜底：如果前端/历史数据没填 next_trigger_at，后端自动归一化
                            let normalized = crate::commands::normalize_reminder(r.clone(), now_ts);

                            *r = normalized;
                            changed = true;
                        }

                        if r.next_trigger_at > 0 && r.next_trigger_at <= now_ts {
                            // 去重：避免同一秒多次触发
                            if r.last_trigger_at
                                .map(|t| now_ts.saturating_sub(t) < 2)
                                .unwrap_or(false)
                            {
                                continue;
                            }

                            due.push(ReminderAlertPayload {
                                id: r.id.clone(),
                                text: r.text.to_string(),
                                scheduled_at: r.next_trigger_at,
                                fired_at: now_ts,
                            });

                            r.last_trigger_at = Some(now_ts);

                            match &r.schedule {
                                ReminderSchedule::Weekly { days, hour, minute } => {
                                    r.next_trigger_at =
                                        crate::commands::compute_next_weekly_trigger_at(now_ts, days, *hour, *minute);

                                }
                                ReminderSchedule::Absolute { .. } | ReminderSchedule::After { .. } => {
                                    // 一次性提醒触发后自动关闭
                                    r.enabled = false;
                                }
                            }

                            changed = true;
                        }

                        if r.enabled && r.next_trigger_at > 0 {
                            next_ts = Some(next_ts.map_or(r.next_trigger_at, |min| min.min(r.next_trigger_at)));
                        }
                    }

                    if changed {
                        let _ = storage.save();
                    }
                }

                let next_wait_secs = next_ts.map(|ts| {
                    let delta = ts - now_ts;
                    if delta <= 0 { 1 } else { delta as u64 }
                });

                (due, next_wait_secs)
            })
            .await
            .unwrap_or_default();

            if !due.is_empty() {
                // 推送更新事件（窗口已存在时可实时追加）
                let _ = emit(&app_handle, "reminder-alert-update", &due);

                // 写入待展示队列（提示窗口启动时可读取）
                if let Ok(mut guard) = PENDING_REMINDER_ALERTS.lock() {
                    guard.extend(due);
                    // 防止无界增长
                    if guard.len() > 50 {
                        let extra = guard.len() - 50;
                        guard.drain(0..extra);
                    }
                }

                // 弹出提示窗口（单窗口复用）
                let config = WindowConfig {
                    label: WINDOW_LABEL_REMINDER_ALERT,
                    url: "reminder_alert",
                    title_key: "common.reminderAlertTitle",
                    width: 480.0,
                    height: 360.0,
                    resizable: true,
                    center: true,
                    destroy_on_close: true,
                };
                show_or_create_window(&app_handle, config);
            }


            let wait_secs = next_wait_secs.unwrap_or(60);
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(wait_secs)) => {},
                _ = notify.notified() => {},
            }
        }
    });
}




/// 保存动画窗口位置
///
/// 注意：保存的 y 是动画区域顶部的位置（窗口 y + 气泡区域高度），
/// 这样当气泡区域高度变化时，动画区域位置保持不变
pub(crate) fn save_animation_window_position(window: &tauri::Window) {

    let app = window.app_handle();

    // 获取 app_state 以便访问 storage
    let app_state: State<AppState> = window.state();

    // 检查 show_character 设置，如果关闭了则不保存位置
    let should_save = {
        let storage = app_state.storage.lock().unwrap();
        storage.data.settings.show_character
    };

    if !should_save {
        return;
    }

    // 获取渲染窗口（animation、live2d、pngremix 或 threed）
    let render_window = get_render_window(app);

    if let Some(win) = render_window {
        if let Ok(position) = win.outer_position() {
            let mut storage = app_state.storage.lock().unwrap();

            let scale_factor = win.scale_factor().unwrap_or(1.0);
            // 气泡区域固定高度，不随缩放变化
            let bubble_area_height = BUBBLE_AREA_HEIGHT;

            let window_x = position.x as f64 / scale_factor;
            let window_y = position.y as f64 / scale_factor;

            // 保存动画区域顶部的 Y 位置（窗口 Y + 气泡区域高度）
            storage.data.info.animation_window_x = Some(window_x);
            storage.data.info.animation_window_y = Some(window_y + bubble_area_height);

            if let Err(e) = storage.save() {
                eprintln!("[TrayBuddy] {}: {}", get_i18n_text(app, "common.saveFailed"), e);
            }
        }
    }
}

/// 获取国际化文本 (用于后端窗口标题同步)
///
/// 使用缓存版本，避免每次调用都重新读取和解析 JSON 文件
pub(crate) fn get_i18n_text(app: &tauri::AppHandle, key: &str) -> String {

    let lang = app.try_state::<AppState>()
        .map(|s| {
            let storage = s.storage.lock().unwrap();
            storage.data.settings.lang.clone()
        })
        .unwrap_or_else(|| "en".to_string().into());
    get_i18n_text_cached(app, &lang, key)
}

/// 内部函数：获取当前 Mod 的图标或默认图标
///
/// - 文件夹 mod：从磁盘读取 `path/icon.*`
/// - archive mod（.tbuddy / .sbuddy）：从 archive_store 读取 `icon.*` 并落盘到临时目录再加载
///
/// 说明：Tauri 的 `Image::from_path` 需要真实文件路径；而 archive mod 的 `path` 是虚拟标记
/// `tbuddy-archive://{mod_id}`，因此必须走 archive_store。
pub(crate) fn get_app_icon(app: &tauri::AppHandle) -> Option<Image<'_>> {
    let default_icon = app.default_window_icon().cloned();

    let Some(state) = app.try_state::<AppState>() else {
        return default_icon;
    };

    // 仅提取需要的字段，避免 clone 整个 ModInfo
    let (mod_path, icon_rel) = {
        let rm = state.resource_manager.lock().unwrap();
        let Some(current_mod) = &rm.current_mod else {
            return default_icon;
        };
        let Some(icon_path) = &current_mod.icon_path else {
            return default_icon;
        };
        (current_mod.path.clone(), icon_path.to_string())
    };

    let mod_path_str = mod_path.to_string_lossy().into_owned();

    // archive mod：tbuddy-archive://{mod_id}
    if let Some(rest) = mod_path_str.strip_prefix("tbuddy-archive://") {
        let mod_id = rest.trim_start_matches('/');
        if mod_id.is_empty() {
            return default_icon;
        }

        let bytes = {
            let mut store = state.archive_store.lock().unwrap();
            store.read_file(mod_id, &icon_rel).ok()
        };

        let Some(bytes) = bytes else {
            return default_icon;
        };

        // 写入临时目录：避免要求 `Image::from_bytes` 的 API 依赖
        let dir = std::env::temp_dir().join("traybuddy_mod_icons");
        let _ = std::fs::create_dir_all(&dir);

        let safe_mod_id: String = mod_id
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
            .collect();
        let safe_rel = icon_rel.replace(['/', '\\'], "_");
        let temp_path = dir.join(format!("{}_{}", safe_mod_id, safe_rel));

        // 覆盖写入（图标通常很小，且该函数在后台线程中调用）
        let _ = std::fs::write(&temp_path, &bytes);

        if let Ok(img) = Image::from_path(&temp_path) {
            return Some(img);
        }

        return default_icon;
    }

    // 文件夹 mod：从真实文件系统路径读取
    let full_icon_path = mod_path.join(&icon_rel);
    if full_icon_path.exists() {
        if let Ok(mod_icon) = Image::from_path(&full_icon_path) {
            return Some(mod_icon);
        }
    }

    default_icon
}

/// 内部函数：根据当前加载的Mod更新托盘图标（异步版本）
///
/// 优化：使用事件驱动，将阻塞操作放到后台线程，避免卡死主线程
pub(crate) async fn update_tray_icon_async(app: tauri::AppHandle) {

    let app_handle = app.clone();
    tokio::task::spawn_blocking(move || {
        let icon_to_use = get_app_icon(&app_handle);

        if let Some(tray) = app_handle.tray_by_id(TRAY_ID_MAIN) {
            if let Some(icon) = icon_to_use {
                let _ = tray.set_icon(Some(icon));
            } else {
                let _ = tray.set_icon(app_handle.default_window_icon().cloned());
            }
        }
    });
}

/// 内部函数：根据当前加载的Mod更新所有窗口的任务栏图标（异步版本）
///
/// 优化：使用事件驱动，将阻塞操作放到后台线程，避免卡死主线程
/// 内存优化：减少锁持有时间，将图标获取和窗口更新分离
pub(crate) async fn update_window_icons_async(app: tauri::AppHandle) {

    let app_handle = app.clone();
    tokio::task::spawn_blocking(move || {
        // 在持有锁时仅获取图标
        let icon_to_use = get_app_icon(&app_handle);

        if icon_to_use.is_none() {
            // 无法获取 mod 图标，直接返回
            return;
        }

        let icon = icon_to_use.unwrap();

        // 锁已释放，现在执行 UI 操作
        // 更新所有窗口的图标
        let windows = app_handle.webview_windows();
        for (_label, window) in windows {
            // clone 图标用于每个窗口设置
            let _ = window.set_icon(icon.clone());
        }

    });
}

/// 内部函数：恢复所有窗口的默认图标（异步版本）
///
/// 优化：使用事件驱动，将阻塞操作放到后台线程，避免卡死主线程
/// 内存优化：减少锁持有时间，将图标获取和窗口更新分离
async fn restore_window_icons_async(app: tauri::AppHandle) {
    let app_handle = app.clone();
    tokio::task::spawn_blocking(move || {
        // 在不持有锁时获取默认图标
        let default_icon = app_handle.default_window_icon().cloned();

        if default_icon.is_none() {
            return;
        }

        let icon = default_icon.unwrap();

        // 锁已释放，现在执行 UI 操作
        // 恢复所有窗口的默认图标
        let windows = app_handle.webview_windows();
        for (_label, window) in windows {
            // clone 图标用于每个窗口设置
            let _ = window.set_icon(icon.clone());
        }

    });
}

/// 内部函数：为窗口设置正确的图标（Mod 图标或默认图标）
///
/// 优化：使用共享的 get_app_icon 函数，避免重复的锁获取和路径解析逻辑
fn apply_window_icon(app: &tauri::AppHandle, window: &WebviewWindow) {
    if let Some(icon) = get_app_icon(app) {
        let _ = window.set_icon(icon);
    }
}

// ========================================================================= //
// 窗口管理工具函数
// ========================================================================= //

/// 窗口配置结构体
///
/// 用于统一窗口创建参数，减少重复代码
struct WindowConfig<'a> {
    /// 窗口标签（唯一标识）
    label: &'a str,
    /// 窗口 URL 路径
    url: &'a str,
    /// i18n 标题键
    title_key: &'a str,
    /// 窗口宽度
    width: f64,
    /// 窗口高度
    height: f64,
    /// 是否可调整大小
    resizable: bool,
    /// 是否居中显示
    center: bool,
    /// 是否在关闭时销毁（而不是隐藏）
    destroy_on_close: bool,
}



/// 显示或创建窗口的通用函数
///
/// 代码复用优化：将重复的窗口显示/创建逻辑统一为一个函数
///
/// # 参数
/// - `app`: Tauri 应用句柄
/// - `config`: 窗口配置
///
/// # 行为
/// - 如果窗口已存在，显示并聚焦
/// - 如果窗口不存在，创建新窗口并应用图标
fn show_or_create_window(app: &tauri::AppHandle, config: WindowConfig) {
    if let Some(window) = app.get_webview_window(config.label) {
        let _ = window.show();
        let _ = window.unminimize(); // 确保窗口不是最小化状态
        let _ = window.set_focus();
    } else {

        let mut builder = WebviewWindowBuilder::new(
            app,
            config.label,
            WebviewUrl::App(config.url.into()),
        )
        // 性能优化：限制每个 Webview 的资源占用
        // 某些版本的 WebView2 支持通过这种方式传递参数，或者在环境初始化时设置
        .title(get_i18n_text(app, config.title_key))

        .inner_size(config.width, config.height)
        .resizable(config.resizable);

        if config.center {
            builder = builder.center();
        }

        if let Ok(window) = builder.build() {
            apply_window_icon(app, &window);
            
            // 如果配置了销毁，则不拦截关闭事件，让其默认销毁窗口及对应的渲染进程
            // 注意：Tauri 默认行为就是关闭窗口即销毁，
            // 我们只需要确保没有全局的 close 拦截器将其改为 hide 即可。
            if !config.destroy_on_close {
                let w_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w_clone.hide();
                    }
                });
            }
        }

    }
}

// ========================================================================= //
// Open-with: 双击 .tbuddy/.sbuddy 自动导入
// ========================================================================= //

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenModArchivePayload {
    file_path: String,
}

/// 显示/创建 Mods 窗口（供 open-with 场景直接拉起）。
pub(crate) fn show_mods_window(app: &tauri::AppHandle) {
    let config = WindowConfig {
        label: "mods",
        url: "mods",
        title_key: "common.modsTitle",
        width: 800.0,
        height: 700.0,
        resizable: true,
        center: false,
        destroy_on_close: true,
    };
    show_or_create_window(app, config);
}

/// 从启动参数/二次启动参数中提取 .tbuddy/.sbuddy 路径，
/// 拉起 Mods 窗口，并通知前端自动导入。
pub(crate) fn handle_open_mod_archives_from_args(app: &tauri::AppHandle, args: &[String]) {
    // 过滤：只保留真实文件路径（忽略 --minimized 等 flags）
    let mut paths: Vec<String> = Vec::new();
    for a in args {
        if a.starts_with('-') {
            continue;
        }
        let p = std::path::Path::new(a);
        let ext = p
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if ext != "tbuddy" && ext != "sbuddy" {
            continue;
        }
        // 仅在文件存在时处理（避免把 "mods" 等路由当成参数误判）
        if !p.is_file() {
            continue;
        }
        paths.push(a.to_string());
    }

    if paths.is_empty() {
        return;
    }

    // 写入待处理队列（即使 emit 时机太早也能兜底）
    {
        let state: State<'_, AppState> = app.state();
        let mut q = state.pending_open_mod_archives.lock().unwrap();
        for p in &paths {
            if !q.contains(p) {
                q.push(p.clone());
            }
        }
    }

    // 拉起 Mods 窗口并尝试即时通知
    show_mods_window(app);

    if let Some(w) = app.get_webview_window("mods") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();

        for p in paths {
            let _ = w.emit(
                "open-mod-archive",
                OpenModArchivePayload {
                    file_path: p,
                },
            );
        }
    }
}

/// 内部函数：根据当前加载的Mod更新托盘图标（同步版本，用于非异步上下文）
///
/// 用途：在同步上下文中更新托盘图标（如卸载 mod 时）
pub(crate) fn update_tray_icon_sync(app: &tauri::AppHandle) {

    if let Some(tray) = app.tray_by_id(TRAY_ID_MAIN) {
        if let Some(icon) = get_app_icon(app) {
            let _ = tray.set_icon(Some(icon));
        } else {
            let _ = tray.set_icon(app.default_window_icon().cloned());
        }
    }
}

/// 内部函数：恢复所有窗口的默认图标（同步版本，用于非异步上下文）
///
/// 用途：在同步上下文中恢复窗口图标（如卸载 mod 时）
pub(crate) fn restore_window_icons_sync(app: &tauri::AppHandle) {

    if let Some(default_icon) = app.default_window_icon() {
        // 恢复所有窗口的默认图标
        let windows = app.webview_windows();
        for (_label, window) in windows {
            let _ = window.set_icon(default_icon.clone());
        }
    }

}

/// 内部函数：构建国际化托盘菜单
///
/// 内存优化：避免克隆整个 settings，只提取需要的布尔值
pub(crate) fn inner_build_tray_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {

    let app_state: State<AppState> = app.state();
    // 内存优化：只提取需要的字段，避免克隆整个 settings 结构体
    let (no_audio_mode, silence_mode, streamer_mode, show_character) = {
        let storage = app_state.storage.lock().unwrap();
        (
            storage.data.settings.no_audio_mode,
            storage.data.settings.silence_mode,
            storage.data.settings.streamer_mode,
            storage.data.settings.show_character,
        )
    };


    let about_i = MenuItem::with_id(
        app,
        "about",
        get_i18n_text(app, "menu.about"),
        true,
        None::<&str>,
    )?;
    let other_tools_i = MenuItem::with_id(
        app,
        "open_other_tool_dir",
        get_i18n_text(app, "menu.otherTools"),
        true,
        None::<&str>,
    )?;

    let mod_editor_i = MenuItem::with_id(
        app,
        "open_mod_tool_dir",
        get_i18n_text(app, "menu.modEditor"),
        true,
        None::<&str>,
    )?;
    let settings_i = MenuItem::with_id(
      app,
      "settings",
      get_i18n_text(app, "menu.settings"),
      true,
      None::<&str>,
    )?;
    let memo_i = MenuItem::with_id(
      app,
      "memo",
      get_i18n_text(app, "menu.memo"),
      true,
      None::<&str>,
    )?;
    let reminder_i = MenuItem::with_id(
      app,
      "reminder",
      get_i18n_text(app, "menu.reminder"),
      true,
      None::<&str>,
    )?;
    let mod_i = MenuItem::with_id(
      app,
      "mod",
      get_i18n_text(app, "menu.mods"),
      true,
      None::<&str>,
    )?;
    let debugger_i = MenuItem::with_id(
      app,
      "debugger",
      get_i18n_text(app, "menu.debugger"),
      true,
      None::<&str>,
    )?;


    let sep1 = PredefinedMenuItem::separator(app)?;

    let mute_i = CheckMenuItem::with_id(
        app,
        "toggle_mute",
        get_i18n_text(app, "menu.mute"),
        true,
        no_audio_mode,
        None::<&str>,
    )?;
    let silence_i = CheckMenuItem::with_id(
        app,
        "toggle_silence",
        get_i18n_text(app, "menu.silence"),
        true,
        silence_mode,
        None::<&str>,
    )?;

    let streamer_mode_i = CheckMenuItem::with_id(
        app,
        "toggle_streamer_mode",
        get_i18n_text(app, "menu.streamerMode"),
        true,
        streamer_mode,
        None::<&str>,
    )?;

    let show_widget_i = CheckMenuItem::with_id(

        app,
        "toggle_show_widget",
        get_i18n_text(app, "menu.showCharacter"),
        true,
        show_character,
        None::<&str>,
    )?;

    let sep2 = PredefinedMenuItem::separator(app)?;

    let quit_i = MenuItem::with_id(
        app,
        "quit",
        get_i18n_text(app, "menu.quit"),
        true,
        None::<&str>,
    )?;

    let sep3 = PredefinedMenuItem::separator(app)?;

    Menu::with_items(
        app,
        &[
            &about_i,
            &other_tools_i,
            &mod_editor_i,
            &sep3,
            &debugger_i,
            &mod_i,
            &settings_i,
            &memo_i,
            &reminder_i,


            &sep2,
            &streamer_mode_i,
            &show_widget_i,
            &mute_i,
            &silence_i,
            &sep1,
            &quit_i,
        ],
    )
}



/// 统一渲染/托盘菜单事件处理
pub(crate) fn handle_menu_event(app: &tauri::AppHandle, id: &str) {

    match id {
        "open_mod_tool_dir" | "open_other_tool_dir" => {
            let subdir = if id == "open_mod_tool_dir" {
                "mod-tool"
            } else {
                "other-tool"
            };

            // 优先使用可执行文件所在目录（发布版符合预期），开发模式下回退到工作目录
            let resolved = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.join(subdir)))
                .filter(|p| p.exists())
                .or_else(|| {
                    let p = std::path::PathBuf::from(subdir);
                    if p.exists() { Some(p) } else { None }
                });

            if let Some(path) = resolved {
                if let Err(e) = open_dir(path.to_string_lossy().to_string()) {
                    eprintln!("[Menu] Failed to open dir '{}': {}", subdir, e);
                }
            } else {
                eprintln!("[Menu] Tool dir not found: {}", subdir);
            }
        }
        "quit" => {
            let app_state: State<AppState> = app.state();
            let mut storage = app_state.storage.lock().unwrap();
            storage.save();

            app.exit(0)
        }
        "about" | "settings" | "mod" | "debugger" | "memo" | "reminder" => {
            // 优化：对于这些工具窗口，如果已经打开，尝试聚焦；
            // 考虑未来改为关闭即销毁，而不是隐藏
            let label = match id {
                "about" => "about",
                "settings" => "settings",
                "mod" => "mods",
                "memo" => WINDOW_LABEL_MEMO,
                "reminder" => WINDOW_LABEL_REMINDER,
                "debugger" => WINDOW_LABEL_MAIN,
                _ => id
            };

            let config = match id {
                "about" => WindowConfig {
                    label: "about",
                    url: "about",
                    title_key: "menu.about",
                    width: 500.0,
                    height: 720.0,
                    resizable: true,
                    center: true,
                    destroy_on_close: true, // 工具窗口，关闭即销毁，释放进程
                },
                "debugger" => WindowConfig {
                    label: WINDOW_LABEL_MAIN,
                    url: "index.html",
                    title_key: "common.appTitle",
                    width: 800.0,
                    height: 600.0,
                    resizable: true,
                    center: false,
                    destroy_on_close: true,
                },
                "mod" => WindowConfig {
                    label: "mods",
                    url: "mods",
                    title_key: "common.modsTitle",
                    width: 800.0,
                    height: 700.0,
                    resizable: true,
                    center: false,
                    destroy_on_close: true,
                },
                "settings" => WindowConfig {
                    label: "settings",
                    url: "settings",
                    title_key: "common.settingsTitle",
                    width: 800.0,
                    height: 700.0,
                    resizable: true,
                    center: false,
                    destroy_on_close: true,
                },
                "memo" => WindowConfig {
                    label: WINDOW_LABEL_MEMO,
                    url: "memo",
                    title_key: "common.memoTitle",
                    width: 720.0,
                    height: 760.0,
                    resizable: true,
                    center: true,
                    destroy_on_close: true,
                },
                "reminder" => WindowConfig {
                    label: WINDOW_LABEL_REMINDER,
                    url: "reminder",
                    title_key: "common.reminderTitle",
                    width: 760.0,
                    height: 760.0,
                    resizable: true,
                    center: true,
                    destroy_on_close: true,
                },

                _ => unreachable!()
            };
            
            show_or_create_window(app, config);
        }

        "toggle_mute" | "toggle_silence" | "toggle_streamer_mode" | "toggle_show_widget" => {

            // 提取 settings 和需要的字段
            let (settings) = {
                let app_state: State<AppState> = app.state();
                let mut storage = app_state.storage.lock().unwrap();
                match id {
                    "toggle_mute" => {
                        storage.data.settings.no_audio_mode = !storage.data.settings.no_audio_mode
                    }
                    "toggle_silence" => {
                        storage.data.settings.silence_mode = !storage.data.settings.silence_mode
                    }
                    "toggle_streamer_mode" => {
                        storage.data.settings.streamer_mode = !storage.data.settings.streamer_mode
                    }
                    "toggle_show_widget" => {
                        storage.data.settings.show_character = !storage.data.settings.show_character
                    }

                    _ => {}
                }
                let settings = storage.data.settings.clone();
                let _ = storage.save();
                settings
            };

            // 广播设置变更 (供所有窗口 UI 同步)
            let _ = emit_settings(&app, &settings);

            // --- 执行副作用 ---

            // 1. 静音模式副作用
            if id == "toggle_mute" {
                let _ = emit(&app, events::MUTE_CHANGE, settings.no_audio_mode);
            }

            // 2. 主播模式副作用：用于窗口捕捉（开启时不再 skip_taskbar）
            if id == "toggle_streamer_mode" {
                let should_skip_taskbar = !settings.streamer_mode;
                for label in RENDER_WINDOW_LABELS {
                    if let Some(window) = app.get_webview_window(label) {
                        if let Err(e) = window.set_skip_taskbar(should_skip_taskbar) {
                            eprintln!(
                                "[StreamerMode] set_skip_taskbar({}) failed: {}",
                                should_skip_taskbar,
                                e
                            );
                        }
                    }
                }
            }


            // 3. 免打扰模式副作用 (修复死锁：提前释放锁)
            if id == "toggle_silence" {


                let target_state = if get_media_status() {
                    // 后面可能增加从music到silence的特殊动画
                    if settings.silence_mode {
                        STATE_SILENCE_START
                    } 
                    else {
                        STATE_SILENCE_END
                    }
                } else {
                    if settings.silence_mode {
                        STATE_SILENCE_START
                    } 
                    else {
                        STATE_SILENCE_END
                    }
                };

                let state_info = {
                    let app_state: State<AppState> = app.state();
                    let rm = app_state.resource_manager.lock().unwrap();
                    rm.get_state_by_name(target_state).cloned()
                }; // 锁在此处释放

                if let Some(state_info) = state_info {
                    let app_state = app.state::<AppState>();
                    let rm = app_state.resource_manager.lock().unwrap();
                    let mut sm = app_state.state_manager.lock().unwrap();
                    let _ = sm.change_state_ex(state_info, true, &rm);
                }
            }
        }
        _ => {}
    }
}





// ========================================================================= //
// 桌面会话检测
// ========================================================================= //

/// 解析生日日期字符串（格式：MM-DD）
/// 返回 (月, 日) 或 None
///
/// 内存优化：避免创建临时 Vec，使用直接解析
fn parse_birthday_date(birthday: &str) -> Option<(u32, u32)> {
    // 直接使用 split_once 而不是 collect 到 Vec，避免堆分配
    let (month_str, day_str) = birthday.split_once('-')?;
    let month = month_str.parse::<u32>().ok()?;
    let day = day_str.parse::<u32>().ok()?;
    // 验证日期有效性
    if month >= MONTH_MIN && month <= MONTH_MAX
        && day >= DAY_MIN && day <= DAY_MAX
    {
        Some((month, day))
    } else {
        None
    }
}

/// 统一的日期判定函数，集中处理所有日期相关的事件类型判定
/// 优先级：生日 > 首登录纪念日 > 普通登录
///
/// 内存优化：返回 &'static str 而不是 String，避免堆分配
fn determine_event_type_with_datetime(
    birthday: Option<&Box<str>>,
    first_login_timestamp: Option<i64>,
    is_silence_mode: bool,
    dt: DateTimeInfo,
) -> &'static str {
    use chrono::Datelike;

    // 1. 生日判断（最高优先级）
    if let Some(ref bday) = birthday {
        if !bday.is_empty() {
            if let Some((bday_month, bday_day)) = parse_birthday_date(bday) {
                if bday_month == dt.month && bday_day == dt.day {
                    println!("[SessionObserver] 今天是生日，优先触发 birthday 事件");
                    return "birthday";
                }
            }
        }
    }

    // 2. 首登录纪念日判断
    if let Some(timestamp) = first_login_timestamp {
        let first_login_date = chrono::DateTime::from_timestamp(timestamp, 0)
            .map(|dt| dt.naive_utc().date())
            .unwrap_or_else(|| chrono::NaiveDate::from_ymd_opt(1970, 1, 1).unwrap());

        let first_login_year = first_login_date.year();
        let first_login_month = first_login_date.month() as u32;
        let first_login_day = first_login_date.day();

        let current_year = dt.year as u32;
        let current_month = dt.month;
        let current_day = dt.day;

        // 仅在年份大于首次登录年份且月日相符时触发
        if current_year > first_login_year as u32 && current_month == first_login_month && current_day == first_login_day {
            println!("[SessionObserver] 今天是首登录纪念日，优先触发 firstday 事件");
            return "firstday";
        }
    }

    // 3. 普通登录
    if is_silence_mode {
        "login_silence"
    } else {
        "login"
    }
}

fn determine_event_type(
    birthday: Option<&Box<str>>,
    first_login_timestamp: Option<i64>,
    is_silence_mode: bool,
) -> &'static str {
    let dt = get_current_datetime();
    determine_event_type_with_datetime(birthday, first_login_timestamp, is_silence_mode, dt)
}



/// 检测当前会话是否未锁定（用户在桌面上）
/// 
/// 兼容性说明：
/// - Windows 10/11: 检测 "Windows.UI.Core.CoreWindow" 和 "ApplicationFrameWindow" 类名
/// - Windows 8/8.1: 检测 "LockScreen" 类名
/// - Windows 7: 检测 "LogonUI" 窗口进程
#[cfg(target_os = "windows")]
fn is_user_logged_in_desktop() -> bool {
    use crate::modules::utils::os_version::{get_windows_version, WindowsVersion};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetWindowThreadProcessId};

    unsafe {
        // 检查是否有前台窗口
        // 锁屏时，GetForegroundWindow 返回 0 或特定的锁屏窗口句柄
        let hwnd = GetForegroundWindow();

        // 如果没有前台窗口，可能是锁屏状态
        if hwnd.is_invalid() {
            return false;
        }

        // 获取窗口类名
        let mut class_name = [0u16; 256];
        if GetClassNameW(hwnd, &mut class_name) > 0 {
            let len = class_name.iter().position(|&x| x == 0).unwrap_or(class_name.len());
            let class_str = String::from_utf16_lossy(&class_name[..len]);

            // 锁屏窗口的类名判断
            // Windows 10/11: "Windows.UI.Core.CoreWindow", "ApplicationFrameWindow"
            // Windows 8/8.1: "LockScreen", "LockAppHost"
            // Windows 7: "LogonUI" (需要通过进程名检测)
            if class_str.contains("Windows.UI.Core.CoreWindow")
                || class_str.contains("ApplicationFrameWindow")
                || class_str.contains("LockScreen")
                || class_str.contains("LockAppHost")
            {
                return false;
            }

            // Windows 7 特殊处理：检测 LogonUI 窗口
            let win_ver = get_windows_version();
            if win_ver.is_win7() {
                // Windows 7 锁屏窗口类名可能是 "#32770" (对话框) 或其他
                // 更可靠的方法是检测进程名是否为 LogonUI.exe
                let mut pid: u32 = 0;
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
                if pid > 0 {
                    if let Some(name) = get_process_name_by_pid(pid) {
                        if name.to_lowercase().contains("logonui") {
                            return false;
                        }
                    }
                }
            }
        }

        // 有前台窗口且不是锁屏窗口，认为已登录
        true
    }
}

/// 根据 PID 获取进程名（用于 Windows 7 锁屏检测）
#[cfg(target_os = "windows")]
fn get_process_name_by_pid(pid: u32) -> Option<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;

        let mut buffer = [0u16; 260];
        let mut size = buffer.len() as u32;

        let result = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buffer.as_mut_ptr()),
            &mut size,
        );

        let _ = CloseHandle(handle);

        if result.is_ok() {
            let path = String::from_utf16_lossy(&buffer[..size as usize]);
            path.rsplit('\\').next().map(|s| s.to_string())
        } else {
            None
        }
    }
}

/// 非 Windows 平台的登录桌面检测。
///
/// TODO(cross-platform): macOS — 通过 CGSessionCopyCurrentDictionary 检测屏幕锁定状态；
///                        Linux — 通过 D-Bus org.freedesktop.login1 查询会话锁定状态。
#[cfg(not(target_os = "windows"))]
fn is_user_logged_in_desktop() -> bool {
    // 非 Windows 平台默认返回 true，表示已登录
    true
}

/// 启动桌面会话监听器（使用 WTS 事件驱动）
#[cfg(target_os = "windows")]
pub(crate) fn start_session_observer(app_handle: tauri::AppHandle) {

    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::*;
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::System::RemoteDesktop::{NOTIFY_FOR_THIS_SESSION, WTSRegisterSessionNotification, WTSUnRegisterSessionNotification};
    use windows::Win32::UI::WindowsAndMessaging::*;
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;

    // WTS 会话事件常量
    const WTS_SESSION_LOCK: u32 = 7;
    const WTS_SESSION_UNLOCK: u32 = 8;

    let _ = std::thread::Builder::new()
        .name("traybuddy-session-observer".to_string())
        .spawn(move || {
            crate::modules::utils::thread::set_current_thread_description("traybuddy: session-observer");
            println!("[SessionObserver] 启动 WTS 会话监听线程");

            unsafe {
            // 注册窗口类
            let class_name_wstr: Vec<u16> = "TrayBuddySessionObserver\0".encode_utf16().collect();
            let title_wstr: Vec<u16> = "TrayBuddy Session Observer\0".encode_utf16().collect();

            let wnd_class = WNDCLASSW {
                style: WNDCLASS_STYLES(0),
                lpfnWndProc: Some(session_window_proc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: GetModuleHandleW(PCWSTR::null()).unwrap_or_default().into(),
                hIcon: HICON::default(),
                hCursor: HCURSOR::default(),
                hbrBackground: HBRUSH::default(),
                lpszMenuName: PCWSTR::null(),
                lpszClassName: PCWSTR::from_raw(class_name_wstr.as_ptr()),
            };

            if RegisterClassW(&wnd_class) == 0 {
                eprintln!("[SessionObserver] 窗口类注册失败: {:?}", GetLastError());
                return;
            }

            // 创建隐藏窗口
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                PCWSTR::from_raw(class_name_wstr.as_ptr()),
                PCWSTR::from_raw(title_wstr.as_ptr()),
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                HWND::default(),
                HMENU::default(),
                GetModuleHandleW(PCWSTR::null()).unwrap_or_default(),
                None,
            );

            let hwnd = match hwnd {
                Ok(h) => h,
                Err(e) => {
                    eprintln!("[SessionObserver] 窗口创建失败: {:?}", e);
                    return;
                }
            };

            if hwnd.is_invalid() {
                eprintln!("[SessionObserver] 窗口创建失败: {:?}", GetLastError());
                return;
            }

            // 保存上下文到窗口用户数据
            let session_locked = {
                let app_state: tauri::State<AppState> = app_handle.state();
                app_state.session_locked.clone()
            };

            // 设置初始锁屏状态
            let is_logged_in = is_user_logged_in_desktop();
            session_locked.store(!is_logged_in, Ordering::SeqCst);

            let context = SessionObserverContext {
                app_handle: app_handle.clone(),
                session_locked,
            };

            SetWindowLongPtrW(hwnd, GWLP_USERDATA, Box::into_raw(Box::new(context)) as isize);

            // 注册 WTS 会话通知
            if WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION).is_err() {
                eprintln!("[SessionObserver] WTS 会话通知注册失败: {:?}", GetLastError());
                let _ = DestroyWindow(hwnd);
                return;
            }

            println!("[SessionObserver] WTS 会话通知注册成功");

            // 初始状态检查：如果程序启动时用户已经解锁，主动触发登录事件
            if is_logged_in {
                println!("[SessionObserver] 程序启动时检测到用户已登录，主动触发登录事件");

                // 启动后台服务
                start_background_services(&app_handle);

                // 检查并触发登录事件
                trigger_login_events(&app_handle);
            }

            // 消息循环
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, HWND::default(), 0, 0).into() {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            // 清理
            let _ = WTSUnRegisterSessionNotification(hwnd);
            let _ = DestroyWindow(hwnd);
        }
    });
}

/// 会话观察器上下文
#[cfg(target_os = "windows")]
struct SessionObserverContext {
    app_handle: tauri::AppHandle,
    session_locked: Arc<std::sync::atomic::AtomicBool>,
}

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};

/// 会话窗口过程函数
#[cfg(target_os = "windows")]
unsafe extern "system" fn session_window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    use std::sync::atomic::Ordering;
    use windows::Win32::Foundation::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    // WTS 会话事件常量
    const WTS_SESSION_LOCK: u32 = 7;
    const WTS_SESSION_UNLOCK: u32 = 8;

    match msg {
        WM_WTSSESSION_CHANGE => {
            let event_code = wparam.0 as u32;
            let session_id = lparam.0 as u32;

            // 获取窗口用户数据
            let context_ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut SessionObserverContext;
            if !context_ptr.is_null() {
                let context = &*context_ptr;

                match event_code {
                    WTS_SESSION_UNLOCK => {
                        println!("[SessionObserver] 检测到会话解锁 (session_id: {})", session_id);

                        // 更新锁屏状态
                        context.session_locked.store(false, Ordering::SeqCst);

                        // 启动后台服务
                        start_background_services(&context.app_handle);

                        // 触发登录事件（每次解锁都会触发）
                        trigger_login_events(&context.app_handle);
                    }
                    WTS_SESSION_LOCK => {
                        println!("[SessionObserver] 检测到会话锁定 (session_id: {})", session_id);

                        // 更新锁屏状态
                        context.session_locked.store(true, Ordering::SeqCst);
                    }
                    _ => {}
                }
            }
        }

        WM_DESTROY => {
            // 清理上下文
            let context_ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut SessionObserverContext;
            if !context_ptr.is_null() {
                let _ = Box::from_raw(context_ptr);
            }
            PostQuitMessage(0);
        }

        _ => {}
    }

    DefWindowProcW(hwnd, msg, wparam, lparam)
}

/// 启动后台服务的公共逻辑（平台无关）
///
/// 包含所有平台共享的服务启动：媒体监听、提醒调度、系统观察、定时触发。
/// Windows 平台额外启动进程监测和全局输入监听。
fn start_background_services_common(app_handle: &tauri::AppHandle, is_windows: bool) {
    use std::sync::atomic::Ordering;

    // 检查是否已经启动过，防止重复启动导致资源泄漏
    if BACKGROUND_SERVICES_STARTED.swap(true, Ordering::SeqCst) {
        println!("[SessionObserver] 后台服务已启动，跳过重复启动");
        return;
    }

    println!("[SessionObserver] 启动后台服务");

    let app_state = app_handle.state::<AppState>();

    // 获取免打扰模式设置（短暂持有锁）
    let is_silence_mode = {
        let storage = app_state.storage.lock().unwrap();
        storage.data.settings.silence_mode
    };

    // 启动媒体监听器（独立线程，无锁）
    start_media_observer(app_handle.clone(), is_silence_mode);

    // 启动定时提醒调度器（独立线程，无锁）
    start_reminder_scheduler(app_handle.clone());

    // Windows 平台额外服务
    if is_windows {
        // 启动进程监测器（独立线程，无锁）
        start_process_observer(app_handle.clone());

        // 启动全局键盘监听器（独立线程）
        start_global_keyboard_listener(app_handle.clone());

        // 启动全局鼠标监听器（独立线程）
        start_global_mouse_listener(app_handle.clone());
    }

    // 启动系统状态观察器（独立线程，无锁）
    {
        let observer = SystemObserver::new();
        observer.start(app_handle.clone());
    }

    // 启动定时触发器（短暂持有锁）
    {
        let mut sm = app_state.state_manager.lock().unwrap();
        sm.start_timer_loop(app_handle.clone());
    }
}

/// 启动后台服务（避免死锁）
#[cfg(target_os = "windows")]
fn start_background_services(app_handle: &tauri::AppHandle) {
    start_background_services_common(app_handle, true);
}

/// 触发登录相关事件的公共逻辑（平台无关）
fn trigger_login_events_common(app_handle: &tauri::AppHandle, check_memo: bool) {
    println!("[SessionObserver] 准备触发登录事件");

    let app_state = app_handle.state::<AppState>();

    // 一次性获取所有需要的设置信息
    let (birthday_opt, first_login_timestamp, is_silence_mode, has_any_memo) = {
        let storage = app_state.storage.lock().unwrap();
        let has_any_memo = check_memo && storage
            .data
            .info
            .memos
            .iter()
            .any(|m| !m.content.as_ref().trim().is_empty());
        (
            storage.data.settings.birthday.clone(),
            storage.data.info.first_login,
            storage.data.settings.silence_mode,
            has_any_memo,
        )
    };

    // 使用统一的日期判定函数确定事件类型
    let event_name = determine_event_type(birthday_opt.as_ref(), first_login_timestamp, is_silence_mode);

    // 触发事件
    println!("[SessionObserver] 触发事件: {}", event_name);
    match app_state.trigger_event(&event_name, false) {
        Ok(true) => println!("[SessionObserver] {}事件触发成功", event_name),
        Ok(false) => println!("[SessionObserver] {}事件未触发（无对应状态）", event_name),
        Err(e) => eprintln!("[SessionObserver] {}事件触发失败: {}", event_name, e),
    }

    // login 时弹出备忘录窗口（若用户有备忘录内容）
    if event_name == EVENT_LOGIN && has_any_memo {
        let config = WindowConfig {
            label: WINDOW_LABEL_MEMO,
            url: "memo",
            title_key: "common.memoTitle",
            width: 720.0,
            height: 760.0,
            resizable: true,
            center: true,
            destroy_on_close: true,
        };
        show_or_create_window(app_handle, config);
    }
}

/// 触发登录相关事件
#[cfg(target_os = "windows")]
pub(crate) fn trigger_login_events(app_handle: &tauri::AppHandle) {
    trigger_login_events_common(app_handle, true);
}


/// 非 Windows 平台的会话观察器。
///
/// TODO(cross-platform): macOS — 使用 NSDistributedNotificationCenter 监听
///                                com.apple.screenIsLocked / com.apple.screenIsUnlocked；
///                        Linux — 使用 D-Bus 监听 org.freedesktop.login1.Session 的
///                                Lock/Unlock 信号。
#[cfg(not(target_os = "windows"))]
pub(crate) fn start_session_observer(app_handle: tauri::AppHandle) {

    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    // 非Windows平台使用简化的轮询方式
    let login_triggered = Arc::new(AtomicBool::new(false));

    tauri::async_runtime::spawn(async move {
        println!("[SessionObserver] 非Windows平台启动简化的会话检测线程");

        // 只需要触发一次，触发后退出循环
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(
                modules::constants::SESSION_OBSERVER_POLL_INTERVAL_SECS,
            ))
            .await;

            // 启动后台服务
            start_background_services_non_windows(&app_handle);

            // 检查并触发登录事件
            if login_triggered.compare_exchange(
                false,
                true,
                Ordering::SeqCst,
                Ordering::Relaxed,
            )
            .is_ok()
            {
                println!("[SessionObserver] 非Windows平台模拟登录事件");
                trigger_login_events_non_windows(&app_handle);
                break; // 触发后退出循环
            }
        }
    });
}


/// 非 Windows 平台启动后台服务。
///
/// TODO(cross-platform): 当各观察器（媒体/进程/系统）的跨平台实现完成后，
///                        此函数的逻辑可以与 Windows 版 start_background_services 统一。
#[cfg(not(target_os = "windows"))]
fn start_background_services_non_windows(app_handle: &tauri::AppHandle) {
    start_background_services_common(app_handle, false);
}

/// 非 Windows 平台的登录事件触发。
///
/// TODO(cross-platform): 当会话观察器的跨平台实现完成后，
///                        此函数可以与 Windows 版 trigger_login_events 统一。
#[cfg(not(target_os = "windows"))]
pub(crate) fn trigger_login_events_non_windows(app_handle: &tauri::AppHandle) {
    trigger_login_events_common(app_handle, false);
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Datelike, TimeZone, Utc};


    fn make_datetime(year: i32, month: u32, day: u32) -> DateTimeInfo {
        let dt = Utc.with_ymd_and_hms(year, month, day, 8, 0, 0).single().unwrap();
        DateTimeInfo {
            year: year as u32,
            month,
            day,
            hour: 8,
            minute: 0,
            second: 0,
            weekday: dt.weekday().num_days_from_sunday(),
            timestamp: dt.timestamp() as u64,
        }
    }

    #[test]
    fn parse_birthday_date_rejects_invalid_and_accepts_valid() {

        assert_eq!(parse_birthday_date("02-29"), Some((2, 29)));
        assert_eq!(parse_birthday_date("12-31"), Some((12, 31)));
        assert_eq!(parse_birthday_date("13-01"), None);
        assert_eq!(parse_birthday_date("00-10"), None);
        assert_eq!(parse_birthday_date("02-30"), Some((2, 30)));

        assert_eq!(parse_birthday_date("0229"), None);
        assert_eq!(parse_birthday_date("aa-bb"), None);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn map_vk_code_covers_known_keys() {
        assert_eq!(map_vk_code(0x41), Some("KeyA"));
        assert_eq!(map_vk_code(0x30), Some("Digit0"));
        assert_eq!(map_vk_code(0x70), Some("F1"));
        assert_eq!(map_vk_code(0xFF), None);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn should_emit_key_to_frontend_allows_navigation_keys() {
        assert!(should_emit_key_to_frontend("Space"));
        assert!(should_emit_key_to_frontend("Enter"));
        assert!(should_emit_key_to_frontend("ArrowUp"));
        assert!(should_emit_key_to_frontend("ArrowDown"));
        assert!(should_emit_key_to_frontend("ArrowLeft"));
        assert!(should_emit_key_to_frontend("ArrowRight"));
        assert!(!should_emit_key_to_frontend("KeyA"));
    }

    #[test]
    fn determine_event_type_prefers_birthday() {
        let birthday: Box<str> = "02-23".into();
        let dt = make_datetime(2026, 2, 23);
        let result = determine_event_type_with_datetime(Some(&birthday), None, false, dt);
        assert_eq!(result, "birthday");
    }

    #[test]
    fn determine_event_type_handles_firstday_and_silence() {
        let first_login = Utc.with_ymd_and_hms(2025, 2, 23, 0, 0, 0).single().unwrap();
        let dt = make_datetime(2026, 2, 23);
        let result = determine_event_type_with_datetime(None, Some(first_login.timestamp()), false, dt);
        assert_eq!(result, "firstday");

        let normal = determine_event_type_with_datetime(None, None, true, make_datetime(2026, 3, 1));
        assert_eq!(normal, "login_silence");
    }
}


