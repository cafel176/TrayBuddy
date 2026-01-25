//! TrayBuddy 应用主模块
//!
//! 桌面虚拟伴侣应用，支持：
//! - Mod 资源加载和管理
//! - 状态切换和动画播放
//! - 系统媒体监听
//! - 用户设置持久化
//!
//! # 模块架构
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                      AppState (全局状态)                      │
//! │  ┌─────────────────┬─────────────────┬─────────────────┐    │
//! │  │ ResourceManager │  StateManager   │    Storage      │    │
//! │  │   (资源管理)     │   (状态管理)    │  (持久化存储)   │    │
//! │  └─────────────────┴─────────────────┴─────────────────┘    │
//! │                              │                               │
//! │  ┌─────────────────┬─────────┴───────┬─────────────────┐    │
//! │  │ MediaObserver   │ TriggerManager  │  Environment    │    │
//! │  │  (媒体监听)      │   (触发管理)    │   (环境信息)    │    │
//! │  └─────────────────┴─────────────────┴─────────────────┘    │
//! └─────────────────────────────────────────────────────────────┘
//! ```

mod modules;

use modules::constants::{
    ANIMATION_AREA_HEIGHT, ANIMATION_AREA_WIDTH, ANIMATION_BORDER, BUBBLE_AREA_HEIGHT,
    BUBBLE_AREA_WIDTH, MAX_BUTTONS_PER_ROW, MAX_CHARS_PER_BUTTON, MAX_CHARS_PER_LINE,
    SHORT_TEXT_THRESHOLD, STATE_IDLE, STATE_SILENCE,
};
use modules::environment::{
    get_cached_location, get_cached_weather, get_current_datetime, get_current_season,
    get_time_period, init_environment, DateTimeInfo, EnvironmentManager, GeoLocation, WeatherInfo,
};
use modules::media_observer::{
    get_cached_debug_info, MediaDebugInfo, MediaObserver, MediaPlaybackStatus,
};
use modules::resource::{
    self, AssetInfo, AudioInfo, CharacterInfo, ModInfo, ResourceManager, StateInfo, TextInfo,
    TriggerInfo,
};
use modules::state::StateManager;
use modules::storage::{Storage, UserInfo, UserSettings};
use modules::system_observer::{SystemDebugInfo, SystemObserver};
use modules::trigger::TriggerManager;
use std::sync::{Arc, Mutex};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, WebviewWindowBuilder,
};

// ========================================================================= //
// 应用全局状态
// ========================================================================= //

/// 应用全局状态
///
/// 通过 Tauri 的状态管理器在命令处理函数中共享访问
pub struct AppState {
    /// 资源管理器：负责 Mod 的加载、卸载和资源查询
    pub resource_manager: Arc<Mutex<ResourceManager>>,
    /// 状态管理器：负责角色状态的切换和事件通知
    pub state_manager: Mutex<StateManager>,
    /// 存储管理器：负责用户设置和信息的持久化
    storage: Mutex<Storage>,
    /// 媒体监听器引用（实际在独立线程运行）
    #[allow(dead_code)]
    media_observer: Mutex<Option<MediaObserver>>,
}

// ========================================================================= //
// 常量查询命令
// ========================================================================= //

/// 获取浮点型常量（窗口尺寸、缩放比例等）
///
/// 返回的常量包括：
/// - `animation_window_width`: 动画窗口宽度
/// - `animation_window_height`: 动画窗口高度
/// - `animation_area_height`: 动画区域高度（角色显示区域，已缩放）
/// - `bubble_area_height`: 气泡区域高度（固定不缩放）
/// - `bubble_area_width`: 气泡区域宽度（固定不缩放）
/// - `animation_scale`: 缩放比例
#[tauri::command]
fn get_const_float(state: State<'_, AppState>) -> std::collections::HashMap<String, f64> {
    let storage = state.storage.lock().unwrap();
    let scale = storage.data.settings.animation_scale as f64;

    // 预分配容量避免扩容
    let mut map = std::collections::HashMap::with_capacity(7);
    // 气泡区域固定尺寸，不随缩放变化
    let bubble_height = BUBBLE_AREA_HEIGHT;
    let bubble_width = BUBBLE_AREA_WIDTH;
    // 动画区域按比例缩放
    let animation_height = ANIMATION_AREA_HEIGHT * scale;
    let animation_width = ANIMATION_AREA_WIDTH * scale;
    // 窗口尺寸：宽度取两者最大值，高度为气泡+动画
    let window_width = bubble_width.max(animation_width);
    let window_height = bubble_height + animation_height;

    map.insert("animation_window_width".into(), window_width);
    map.insert("animation_window_height".into(), window_height);
    map.insert("animation_area_height".into(), animation_height);
    map.insert("animation_area_width".into(), animation_width);
    map.insert("bubble_area_height".into(), bubble_height);
    map.insert("bubble_area_width".into(), bubble_width);
    map.insert("animation_scale".into(), scale);
    map
}

/// 获取字符串型常量
#[tauri::command]
fn get_const_text() -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::with_capacity(1);
    map.insert(ANIMATION_BORDER.into(), ANIMATION_BORDER.into());
    map
}

/// 获取整数型常量（气泡文本相关）
///
/// 返回的常量包括：
/// - `short_text_threshold`: 按钮短文本阈值（字符数）
/// - `max_buttons_per_row`: 单行最大按钮数量
/// - `max_chars_per_line`: 单行最大字符数
/// - `max_chars_per_button`: 按钮文本最大字符数
#[tauri::command]
fn get_const_int() -> std::collections::HashMap<String, u32> {
    let mut map = std::collections::HashMap::with_capacity(4);
    map.insert("short_text_threshold".into(), SHORT_TEXT_THRESHOLD);
    map.insert("max_buttons_per_row".into(), MAX_BUTTONS_PER_ROW);
    map.insert("max_chars_per_line".into(), MAX_CHARS_PER_LINE);
    map.insert("max_chars_per_button".into(), MAX_CHARS_PER_BUTTON);
    map
}

/// 获取环境变量（用于检测调试模式等）
#[tauri::command]
fn get_env_var(name: String) -> Option<String> {
    std::env::var(&name).ok()
}

// ========================================================================= //
// 用户设置命令
// ========================================================================= //

/// 获取用户设置
#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> UserSettings {
    let storage = state.storage.lock().unwrap();
    storage.data.settings.clone()
}

/// 更新用户设置
#[tauri::command]
fn update_settings(
    settings: UserSettings,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut storage = state.storage.lock().unwrap();
    storage.update_settings(settings.clone())?;
    let _ = app.emit("settings-change", settings);
    Ok(())
}

/// 获取用户信息
#[tauri::command]
fn get_user_info(state: State<'_, AppState>) -> UserInfo {
    let storage = state.storage.lock().unwrap();
    storage.data.info.clone()
}

/// 更新用户信息
#[tauri::command]
fn update_user_info(info: UserInfo, state: State<'_, AppState>) -> Result<(), String> {
    let mut storage = state.storage.lock().unwrap();
    storage.update_user_info(info)
}

// ========================================================================= //
// Mod 资源管理命令
// ========================================================================= //

/// 获取 Mod 搜索路径列表
#[tauri::command]
fn get_mod_search_paths(state: State<'_, AppState>) -> Vec<String> {
    let rm = state.resource_manager.lock().unwrap();
    rm.search_paths
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

/// 获取可用的 Mod 列表
#[tauri::command]
fn get_available_mods(state: State<'_, AppState>) -> Vec<String> {
    let rm = state.resource_manager.lock().unwrap();
    rm.list_mods()
}

/// 加载指定 Mod
#[tauri::command]
fn load_mod(mod_name: String, state: State<'_, AppState>) -> Result<ModInfo, String> {
    let mut rm = state.resource_manager.lock().unwrap();
    let mod_info = rm.load_mod(&mod_name)?;

    // 自动更新用户信息并持久化
    let mut storage = state.storage.lock().unwrap();
    storage.data.info.current_mod = mod_name;
    let _ = storage.save();

    Ok(mod_info)
}

/// 卸载当前 Mod
#[tauri::command]
fn unload_mod(state: State<'_, AppState>) -> bool {
    let mut rm = state.resource_manager.lock().unwrap();
    rm.unload_mod()
}

/// 获取当前加载的 Mod 信息
#[tauri::command]
fn get_current_mod(state: State<'_, AppState>) -> Option<ModInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.current_mod.clone()
}

/// 获取当前 Mod 的路径
#[tauri::command]
fn get_mod_path(state: State<'_, AppState>) -> Option<String> {
    let rm = state.resource_manager.lock().unwrap();
    rm.current_mod
        .as_ref()
        .map(|m| m.path.to_string_lossy().into_owned())
}

/// 获取边框配置
#[tauri::command]
fn get_border_config(state: State<'_, AppState>) -> Option<resource::BorderConfig> {
    let rm = state.resource_manager.lock().unwrap();
    rm.current_mod.as_ref().map(|m| m.manifest.border.clone())
}

/// 获取角色配置
#[tauri::command]
fn get_character_config(state: State<'_, AppState>) -> Option<resource::CharacterConfig> {
    let rm = state.resource_manager.lock().unwrap();
    rm.current_mod
        .as_ref()
        .map(|m| m.manifest.character.clone())
}

/// 根据名称获取状态信息
#[tauri::command]
fn get_state_by_name(name: String, state: State<'_, AppState>) -> Option<StateInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_state_by_name(&name).cloned()
}

/// 根据事件名获取触发器信息
#[tauri::command]
fn get_trigger_by_event(event: String, state: State<'_, AppState>) -> Option<TriggerInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_trigger_by_event(&event).cloned()
}

/// 根据名称获取动画资产信息
#[tauri::command]
fn get_asset_by_name(name: String, state: State<'_, AppState>) -> Option<AssetInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_asset_by_name(&name).cloned()
}

/// 根据语言和名称获取音频信息
#[tauri::command]
fn get_audio_by_name(lang: String, name: String, state: State<'_, AppState>) -> Option<AudioInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_audio_by_name(&lang, &name).cloned()
}

/// 根据语言和名称获取文本信息
#[tauri::command]
fn get_text_by_name(lang: String, name: String, state: State<'_, AppState>) -> Option<TextInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_text_by_name(&lang, &name).cloned()
}

/// 根据语言获取角色信息
#[tauri::command]
fn get_info_by_lang(lang: String, state: State<'_, AppState>) -> Option<CharacterInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_info_by_lang(&lang).cloned()
}

/// 获取气泡样式配置
#[tauri::command]
fn get_bubble_style(state: State<'_, AppState>) -> Option<serde_json::Value> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_bubble_style()
}

// ========================================================================= //
// 状态管理命令
// ========================================================================= //

/// 获取所有预定义状态
#[tauri::command]
fn get_all_states(state: State<'_, AppState>) -> Vec<StateInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_all_states()
}

/// 获取当前状态
#[tauri::command]
fn get_current_state(state: State<'_, AppState>) -> Option<StateInfo> {
    let sm = state.state_manager.lock().unwrap();
    sm.get_current_state().cloned()
}

/// 获取持久状态
#[tauri::command]
fn get_persistent_state(state: State<'_, AppState>) -> Option<StateInfo> {
    let sm = state.state_manager.lock().unwrap();
    sm.get_persistent_state().cloned()
}

/// 获取下一个待切换状态
#[tauri::command]
fn get_next_state(state: State<'_, AppState>) -> Option<StateInfo> {
    let sm = state.state_manager.lock().unwrap();
    sm.get_next_state().cloned()
}

/// 切换状态（自动选择持久/临时模式）
#[tauri::command]
fn change_state(name: String, state: State<'_, AppState>) -> Result<bool, String> {
    let state_info = {
        let rm = state.resource_manager.lock().unwrap();
        rm.get_state_by_name(&name)
            .ok_or_else(|| format!("State '{}' not found", name))?
            .clone()
    };

    let mut sm = state.state_manager.lock().unwrap();
    sm.change_state(state_info)
}

/// 强制切换状态（忽略优先级和锁定检查）
#[tauri::command]
fn force_change_state(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let state_info = {
        let rm = state.resource_manager.lock().unwrap();
        rm.get_state_by_name(&name)
            .ok_or_else(|| format!("State '{}' not found", name))?
            .clone()
    };

    let mut sm = state.state_manager.lock().unwrap();
    sm.change_state_ex(state_info, true)?;
    Ok(())
}

/// 动画播放完成回调
#[tauri::command]
fn on_animation_complete(state: State<'_, AppState>) {
    let mut sm = state.state_manager.lock().unwrap();
    sm.on_state_complete();
}

/// 设置下一个待切换状态
#[tauri::command]
fn set_next_state(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let state_info = {
        let rm = state.resource_manager.lock().unwrap();
        rm.get_state_by_name(&name)
            .ok_or_else(|| format!("State '{}' not found", name))?
            .clone()
    };

    let mut sm = state.state_manager.lock().unwrap();
    sm.set_next_state(state_info);
    Ok(())
}

/// 检查状态是否被锁定
#[tauri::command]
fn is_state_locked(state: State<'_, AppState>) -> bool {
    let sm = state.state_manager.lock().unwrap();
    sm.is_locked()
}

// ========================================================================= //
// 触发器命令
// ========================================================================= //

/// 获取所有触发器
#[tauri::command]
fn get_all_triggers(state: State<'_, AppState>) -> Vec<TriggerInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_all_triggers()
}

/// 触发事件
#[tauri::command]
fn trigger_event(event_name: String, state: State<'_, AppState>) -> Result<bool, String> {
    let rm = state.resource_manager.lock().unwrap();
    let mut sm = state.state_manager.lock().unwrap();
    TriggerManager::trigger_event(&event_name, &rm, &mut sm)
}

// ========================================================================= //
// 窗口和系统命令
// ========================================================================= //

/// 设置窗口鼠标穿透状态
///
/// 当 ignore 为 true 时，窗口不响应鼠标事件，鼠标可穿透到下层
#[tauri::command]
fn set_ignore_cursor_events(ignore: bool, app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("animation") {
        window
            .set_ignore_cursor_events(ignore)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 获取当前鼠标位置（屏幕坐标）
#[tauri::command]
fn get_cursor_position() -> Result<(i32, i32), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

        let mut point = POINT { x: 0, y: 0 };
        unsafe {
            GetCursorPos(&mut point).map_err(|e| format!("GetCursorPos failed: {:?}", e))?;
        }
        Ok((point.x, point.y))
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("get_cursor_position not implemented for this platform".to_string())
    }
}

/// 气泡边界（相对于窗口的坐标）
#[derive(Debug, Clone, serde::Deserialize)]
struct BubbleBounds {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

/// 检查鼠标是否在交互区域内
///
/// 交互区域包括：
/// - 角色 Canvas 区域（始终需要交互）
/// - 气泡实际区域（由前端传入实际边界）
///
/// @param bubble_bounds 气泡的实际边界（相对于窗口），为 None 时表示气泡未显示
/// @return true 表示鼠标在交互区域内，需要禁用穿透
#[tauri::command]
fn is_cursor_in_interact_area(
    bubble_bounds: Option<BubbleBounds>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let storage = state.storage.lock().unwrap();
    let scale = storage.data.settings.animation_scale as f64;
    drop(storage);

    // 获取窗口位置和尺寸
    let window = app
        .get_webview_window("animation")
        .ok_or("Animation window not found")?;

    let position = window.outer_position().map_err(|e| e.to_string())?;
    let scale_factor = window.scale_factor().unwrap_or(1.0);

    // 窗口物理坐标转换为逻辑坐标
    let window_x = position.x as f64 / scale_factor;
    let window_y = position.y as f64 / scale_factor;

    // 计算动画区域的高度（随缩放变化）
    let animation_height = ANIMATION_AREA_HEIGHT * scale;
    let animation_width = ANIMATION_AREA_WIDTH * scale;

    // 窗口宽度取气泡和动画区域的最大值
    let window_width = BUBBLE_AREA_WIDTH.max(animation_width);

    // 角色 Canvas 区域边界（在气泡区域下方的动画区域内）
    // Canvas 使用 CSS: left: 50%, top: 45%, transform: translate(-50%, -50%), height: 80%
    let animation_area_top = window_y + BUBBLE_AREA_HEIGHT;
    let canvas_height = animation_height * 0.8;
    let canvas_width = canvas_height; // 假设宽高比 1:1
    let canvas_center_x = window_x + window_width / 2.0;
    let canvas_center_y = animation_area_top + animation_height * 0.45;
    let canvas_left = canvas_center_x - canvas_width / 2.0;
    let canvas_right = canvas_center_x + canvas_width / 2.0;
    let canvas_top = canvas_center_y - canvas_height / 2.0;
    let canvas_bottom = canvas_center_y + canvas_height / 2.0;

    // 获取鼠标位置
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

        let mut point = POINT { x: 0, y: 0 };
        unsafe {
            GetCursorPos(&mut point).map_err(|e| format!("GetCursorPos failed: {:?}", e))?;
        }

        // 鼠标逻辑坐标
        let cursor_x = point.x as f64 / scale_factor;
        let cursor_y = point.y as f64 / scale_factor;

        // 检查鼠标是否在角色 Canvas 区域内（始终需要交互）
        let in_canvas = cursor_x >= canvas_left
            && cursor_x <= canvas_right
            && cursor_y >= canvas_top
            && cursor_y <= canvas_bottom;

        // 检查鼠标是否在气泡实际区域内（前端传入实际边界）
        let in_bubble = if let Some(bounds) = bubble_bounds {
            // 将窗口相对坐标转换为屏幕坐标
            let bubble_left = window_x + bounds.left;
            let bubble_top = window_y + bounds.top;
            let bubble_right = window_x + bounds.right;
            let bubble_bottom = window_y + bounds.bottom;

            cursor_x >= bubble_left
                && cursor_x <= bubble_right
                && cursor_y >= bubble_top
                && cursor_y <= bubble_bottom
        } else {
            false
        };

        Ok(in_canvas || in_bubble)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

/// 设置音量（实时生效）
#[tauri::command]
fn set_volume(
    volume: f64,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let volume = volume.clamp(0.0, 1.0) as f32;

    // 更新设置并保存
    {
        let mut storage = state.storage.lock().unwrap();
        storage.data.settings.volume = volume;
        storage.save()?;
    }

    // 发送事件通知前端
    let _ = app.emit("volume-change", volume);
    Ok(())
}

/// 设置静音模式（实时生效）
#[tauri::command]
fn set_mute(mute: bool, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // 更新设置并保存
    {
        let mut storage = state.storage.lock().unwrap();
        storage.data.settings.no_audio_mode = mute;
        storage.save()?;
    }

    // 发送事件通知前端
    let _ = app.emit("mute-change", mute);
    Ok(())
}

/// 设置动画缩放比例并调整窗口大小
#[tauri::command]
fn set_animation_scale(
    scale: f64,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let scale = scale.clamp(0.1, 2.0);

    // 更新设置
    {
        let mut storage = state.storage.lock().unwrap();
        storage.data.settings.animation_scale = scale as f32;
        storage.save()?;
    }

    // 调整窗口大小 - 气泡区域固定尺寸，只有动画区域缩放
    let animation_width = ANIMATION_AREA_WIDTH * scale;
    let animation_height = ANIMATION_AREA_HEIGHT * scale;
    // 窗口宽度取气泡宽度和动画宽度的最大值
    let new_width = BUBBLE_AREA_WIDTH.max(animation_width);
    let new_height = BUBBLE_AREA_HEIGHT + animation_height;

    if let Some(window) = app.get_webview_window("animation") {
        window
            .set_size(LogicalSize::new(new_width, new_height))
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// 在文件管理器中打开指定路径
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        opener::reveal(&path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ========================================================================= //
// 环境信息命令
// ========================================================================= //

/// 获取当前日期时间信息
#[tauri::command]
fn get_datetime_info() -> DateTimeInfo {
    get_current_datetime()
}

/// 获取地理位置信息（优先使用全局缓存）
#[tauri::command]
fn get_location_info() -> Option<GeoLocation> {
    // 优先返回全局缓存
    if let Some(location) = get_cached_location() {
        return Some(location);
    }
    // 如果缓存为空（初始化还未完成），触发获取
    let mut manager = EnvironmentManager::new();
    manager.get_location()
}

/// 刷新地理位置信息（强制重新从 API 获取）
#[tauri::command]
fn refresh_location_info() -> Option<GeoLocation> {
    let mut manager = EnvironmentManager::new();
    manager.refresh_location()
}

/// 获取当前季节
#[tauri::command]
fn get_season_info() -> String {
    get_current_season().name().to_string()
}

/// 获取当前时间段
#[tauri::command]
fn get_time_period_info() -> String {
    get_time_period().to_string()
}

/// 获取天气信息（优先使用全局缓存）
#[tauri::command]
fn get_weather_info() -> Option<WeatherInfo> {
    // 优先返回全局缓存
    if let Some(weather) = get_cached_weather() {
        return Some(weather);
    }
    // 如果缓存为空，触发获取
    let mut manager = EnvironmentManager::new();
    manager.get_weather()
}

// ========================================================================= //
// 媒体调试命令
// ========================================================================= //

/// 获取媒体调试信息
#[tauri::command]
fn get_media_debug_info() -> Option<MediaDebugInfo> {
    get_cached_debug_info()
}

// ========================================================================= //
// 应用入口
// ========================================================================= //

/// 应用入口点
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // ========== 初始化核心管理器 ==========
            let rm = Arc::new(Mutex::new(ResourceManager::new(app.handle())));
            let mut sm = StateManager::new(Arc::clone(&rm));
            let mut storage = Storage::new(app.handle());

            // 记录登录时间
            let dt = get_current_datetime();
            storage.data.info.last_login = Some(dt.timestamp as i64);
            let _ = storage.save();

            // 自动加载上次使用的 Mod
            let last_mod = storage.data.info.current_mod.clone();
            if !last_mod.is_empty() {
                if let Err(e) = rm.lock().unwrap().load_mod(&last_mod) {
                    eprintln!("[TrayBuddy] 自动加载 Mod '{}' 失败: {}", last_mod, e);
                }
            }

            // ========== 初始化状态 ==========
            let is_silence = storage.data.settings.silence_mode;
            if !is_silence {
                let rm_guard = rm.lock().unwrap();
                if let Some(idle_state) = rm_guard.get_state_by_name(STATE_IDLE) {
                    let _ = sm.change_state(idle_state.clone());
                }
            } else {
                let rm_guard = rm.lock().unwrap();
                if let Some(silence_state) = rm_guard.get_state_by_name(STATE_SILENCE) {
                    let _ = sm.change_state(silence_state.clone());
                    println!(
                        "[TrayBuddy] Silence mode enabled on startup, entering silence_start state"
                    );
                }
            }

            sm.set_app_handle(app.handle().clone());
            // 启动定时触发器和设置事件发送器
            sm.start_timer_loop(app.handle().clone());

            // ========== 注册全局状态（必须在创建窗口之前） ==========
            app.manage(AppState {
                resource_manager: rm,
                state_manager: Mutex::new(sm),
                storage: Mutex::new(storage),
                media_observer: Mutex::new(None),
            });

            // ========== 初始化主窗口标题 ==========
            if let Some(main_window) = app.get_webview_window("main") {
                let title = get_i18n_text(app.handle(), "common.appTitle");
                let _ = main_window.set_title(&title);
            }

            // ========== 创建动画窗口 ==========
            // 重新获取 storage 引用（因为已经移入 AppState）
            let state: State<'_, AppState> = app.state();
            let storage_guard = state.storage.lock().unwrap();
            let scale = storage_guard.data.settings.animation_scale as f64;
            let saved_position = (
                storage_guard.data.info.animation_window_x,
                storage_guard.data.info.animation_window_y,
            );
            drop(storage_guard); // 释放锁

            // 气泡区域固定尺寸，动画区域随缩放变化
            let bubble_area_height = BUBBLE_AREA_HEIGHT;
            let bubble_area_width = BUBBLE_AREA_WIDTH;
            let animation_area_height = ANIMATION_AREA_HEIGHT * scale;
            let animation_area_width = ANIMATION_AREA_WIDTH * scale;
            // 窗口宽度取两者最大值
            let window_width = bubble_area_width.max(animation_area_width);
            let window_height = bubble_area_height + animation_area_height;

            let animation_window =
                WebviewWindowBuilder::new(app, "animation", WebviewUrl::App("animation".into()))
                    .title(get_i18n_text(app.handle(), "common.animationTitle"))
                    .inner_size(window_width, window_height)
                    .transparent(true)
                    .decorations(false)
                    .always_on_top(true)
                    .resizable(false)
                    .shadow(false)
                    .skip_taskbar(true)
                    .build()
                    .map_err(|e| e.to_string())?;

            // 设置窗口位置
            // 注意：保存的 y 是动画区域顶部的位置，需要减去气泡区域高度得到窗口顶部位置
            if let (Some(x), Some(y)) = saved_position {
                // y 是动画区域顶部，窗口顶部 = y - 气泡区域高度
                let window_y = y - bubble_area_height;
                let _ = animation_window
                    .set_position(tauri::Position::Logical(LogicalPosition::new(x, window_y)));
            } else if let Some(monitor) = animation_window.primary_monitor().ok().flatten() {
                // 首次启动，定位到屏幕右下角（动画区域底部贴近任务栏上方）
                let scale_factor = monitor.scale_factor();
                let screen_size = monitor.size();
                let screen_pos = monitor.position();
                const TASKBAR_HEIGHT: f64 = 48.0;

                let screen_w = screen_size.width as f64 / scale_factor;
                let screen_h = screen_size.height as f64 / scale_factor;

                let x = screen_pos.x as f64 + screen_w - window_width;
                // 窗口顶部 y = 屏幕底部 - 任务栏 - 动画区域高度 - 气泡区域高度
                let y = screen_pos.y as f64 + screen_h - window_height - TASKBAR_HEIGHT;

                let _ = animation_window
                    .set_position(tauri::Position::Logical(LogicalPosition::new(x, y)));
            }

            // 启动媒体监听器
            start_media_observer(app.handle().clone(), is_silence);

            // 启动系统状态观察器（监听全屏）
            #[cfg(target_os = "windows")]
            {
                let observer = SystemObserver::new();
                observer.start(app.handle().clone());
            }

            // ========== 系统托盘 (System Tray) ==========
            {
                // 1. 获取当前 Mod 的图标路径
                let mod_id = {
                    let state: State<AppState> = app.state();
                    let storage = state.storage.lock().unwrap();
                    storage.data.info.current_mod.clone()
                };

                // 尝试加载 Mod 图标，如果失败则使用应用默认图标
                // 假设 mods 目录在当前工作目录下
                let icon_path = std::path::Path::new("mods").join(&mod_id).join("icon.ico");
                let icon = if icon_path.exists() {
                    Image::from_path(&icon_path)
                        .unwrap_or_else(|_| app.default_window_icon().unwrap().clone())
                } else {
                    app.default_window_icon().unwrap().clone()
                };

                // 2. 创建菜单
                let settings_i =
                    MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
                let mod_i = MenuItem::with_id(app, "mod", "Mod", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&settings_i, &mod_i, &quit_i])?;

                // 3. 创建托盘
                let builder = TrayIconBuilder::new()
                    .icon(icon)
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(move |app, event| {
                        match event.id.as_ref() {
                            "quit" => app.exit(0),
                            "mod" => {
                                // 检查 Mod 窗口是否已存在
                                if let Some(window) = app.get_webview_window("mods") {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                } else {
                                    // 创建新的 Mod 窗口
                                    let _ = WebviewWindowBuilder::new(
                                        app,
                                        "mods",
                                        WebviewUrl::App("mods".into()),
                                    )
                                    .title(get_i18n_text(app, "common.modsTitle"))
                                    .inner_size(800.0, 700.0)
                                    .resizable(false)
                                    .build();
                                }
                            }
                            "settings" => {
                                // 检查设置窗口是否已存在
                                if let Some(window) = app.get_webview_window("settings") {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                } else {
                                    // 创建新的设置窗口
                                    let _ = WebviewWindowBuilder::new(
                                        app,
                                        "settings",
                                        WebviewUrl::App("settings".into()),
                                    )
                                    .title(get_i18n_text(app, "common.settingsTitle"))
                                    .inner_size(800.0, 700.0)
                                    .resizable(false)
                                    .build();
                                }
                            }
                            _ => {}
                        }
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            ..
                        } = event
                        {
                            //let app = tray.app_handle();
                            // if let Some(window) = app.get_webview_window("main") {
                            //     let _ = window.show();
                            //     let _ = window.set_focus();
                            // }
                        }
                    });

                builder.build(app)?;
            }

            // 在后台线程初始化环境信息（地理位置和天气）
            let app_handle_env = app.handle().clone();
            std::thread::spawn(move || {
                init_environment(Some(app_handle_env));
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { .. } => {
                    // main 窗口或 animation 窗口关闭时都保存位置
                    if window.label() == "main" || window.label() == "animation" {
                        save_animation_window_position(window);
                    }
                }
                tauri::WindowEvent::Moved(_) => {
                    if window.label() == "animation" {
                        // 发送窗口位置更新事件（发送动画区域顶部位置，与保存一致）
                        if let Ok(position) = window.outer_position() {
                            let scale_factor = window.scale_factor().unwrap_or(1.0);
                            let x = position.x as f64 / scale_factor;
                            let y = position.y as f64 / scale_factor;
                            // 动画区域顶部 Y = 窗口 Y + 气泡区域高度
                            let animation_area_y = y + BUBBLE_AREA_HEIGHT;
                            let _ = window.emit("window-position-changed", (x, animation_area_y));
                        }
                        // 实时保存窗口位置（防止异常退出丢失）
                        save_animation_window_position(window);
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            // 常量查询
            get_const_float,
            get_const_text,
            get_const_int,
            // 系统工具
            get_env_var,
            // 用户设置
            get_settings,
            update_settings,
            get_user_info,
            update_user_info,
            // Mod 资源管理
            get_mod_details,
            get_mod_search_paths,
            get_available_mods,
            load_mod,
            unload_mod,
            get_current_mod,
            get_mod_path,
            get_border_config,
            get_character_config,
            get_state_by_name,
            get_trigger_by_event,
            get_asset_by_name,
            get_audio_by_name,
            get_text_by_name,
            get_info_by_lang,
            get_bubble_style,
            // 状态管理
            get_all_states,
            get_current_state,
            get_persistent_state,
            get_next_state,
            change_state,
            force_change_state,
            set_next_state,
            on_animation_complete,
            is_state_locked,
            // 触发器
            get_all_triggers,
            trigger_event,
            // 窗口和系统
            set_volume,
            set_mute,
            set_animation_scale,
            set_ignore_cursor_events,
            get_cursor_position,
            is_cursor_in_interact_area,
            open_path,
            // 环境信息
            get_datetime_info,
            get_location_info,
            refresh_location_info,
            get_season_info,
            get_time_period_info,
            get_weather_info,
            // 媒体调试
            get_media_debug_info,
            get_system_debug_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 获取指定 Mod 的详细信息 (不加载)
#[tauri::command]
fn get_mod_details(
    state: State<'_, AppState>,
    mod_name: String,
) -> Result<modules::resource::ModInfo, String> {
    let mgr = state.resource_manager.lock().unwrap();
    mgr.read_mod_from_disk(&mod_name)
}

/// 获取系统观察器调试信息
#[tauri::command]
fn get_system_debug_info() -> Option<SystemDebugInfo> {
    modules::system_observer::get_cached_debug_info()
}

// ========================================================================= //
// 辅助函数
// ========================================================================= //

/// 启动媒体监听器（独立线程）
fn start_media_observer(app_handle: tauri::AppHandle, skip_delay: bool) {
    std::thread::spawn(move || {
        let mut observer = MediaObserver::new();
        let rx = observer.start(skip_delay);

        let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
        rt.block_on(async move {
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
                use crate::modules::constants::{
                    STATE_LOCK_MAX_RETRIES, STATE_LOCK_WAIT_INTERVAL_MS,
                };
                for _ in 0..STATE_LOCK_MAX_RETRIES {
                    let is_locked = {
                        let sm = app_state.state_manager.lock().unwrap();
                        sm.is_locked()
                    };
                    if !is_locked {
                        break;
                    }
                    tokio::time::sleep(tokio::time::Duration::from_millis(
                        STATE_LOCK_WAIT_INTERVAL_MS,
                    ))
                    .await;
                }

                match event.status {
                    MediaPlaybackStatus::Playing => {
                        let rm = app_state.resource_manager.lock().unwrap();
                        let mut sm = app_state.state_manager.lock().unwrap();
                        let _ = TriggerManager::trigger_music_start(&rm, &mut sm);
                    }
                    MediaPlaybackStatus::Paused | MediaPlaybackStatus::Stopped => {
                        let rm = app_state.resource_manager.lock().unwrap();
                        let mut sm = app_state.state_manager.lock().unwrap();
                        let _ = TriggerManager::trigger_music_end(&rm, &mut sm);
                    }
                    _ => {}
                }
            }
        });
    });
}

/// 保存动画窗口位置
///
/// 注意：保存的 y 是动画区域顶部的位置（窗口 y + 气泡区域高度），
/// 这样当气泡区域高度变化时，动画区域位置保持不变
fn save_animation_window_position(window: &tauri::Window) {
    let app = window.app_handle();

    // 获取 animation 窗口
    let animation_window = app.get_webview_window("animation");

    if let Some(anim_win) = animation_window {
        if let Ok(position) = anim_win.outer_position() {
            let app_state: State<AppState> = window.state();
            let mut storage = app_state.storage.lock().unwrap();

            let scale_factor = anim_win.scale_factor().unwrap_or(1.0);
            // 气泡区域固定高度，不随缩放变化
            let bubble_area_height = BUBBLE_AREA_HEIGHT;

            let window_x = position.x as f64 / scale_factor;
            let window_y = position.y as f64 / scale_factor;

            // 保存动画区域顶部的 Y 位置（窗口 Y + 气泡区域高度）
            storage.data.info.animation_window_x = Some(window_x);
            storage.data.info.animation_window_y = Some(window_y + bubble_area_height);

            if let Err(e) = storage.save() {
                eprintln!("[TrayBuddy] 保存窗口位置失败: {}", e);
            }
        }
    }
}

/// 获取国际化文本 (用于后端窗口标题同步)
fn get_i18n_text(app: &tauri::AppHandle, key: &str) -> String {
    let app_state: State<AppState> = app.state();

    // 1. 获取当前语言
    let lang = {
        let storage = app_state.storage.lock().unwrap();
        storage.data.settings.lang.clone()
    };

    // 2. 加载 i18n 资源文件
    // 虽然 Svelte 打包包含了资源，但后端需要直接从资源目录读取
    let i18n_path = app
        .path()
        .resource_dir()
        .unwrap_or_default()
        .join("i18n")
        .join(format!("{}.json", lang));

    // 如果资源目录下不存在（可能是开发模式），则尝试从当前工作目录下的 i18n 目录读取
    let i18n_path = if !i18n_path.exists() {
        std::path::PathBuf::from("i18n").join(format!("{}.json", lang))
    } else {
        i18n_path
    };

    if let Ok(content) = std::fs::read_to_string(i18n_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            let keys: Vec<&str> = key.split('.').collect();
            let mut current = &json;
            for k in keys {
                if let Some(val) = current.get(k) {
                    current = val;
                } else {
                    return key.to_string();
                }
            }
            if let Some(s) = current.as_str() {
                return s.to_string();
            }
        }
    }

    key.to_string()
}
