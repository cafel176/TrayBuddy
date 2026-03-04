//! Tauri IPC 命令入口模块
//!
//! 集中注册所有前端可调用的 `#[tauri::command]` 命令。
//! 按功能拆分到子模块：
//! - [`mod_archive_commands`] — Mod 包导入/导出/预检
//! - [`mod_resource_commands`] — Mod 资源加载/切换/卸载
//! - [`open_with_commands`] — 系统文件关联（双击 `.tbuddy` 打开）
//! - [`window_system_commands`] — 窗口控制、拖拽、锁定与系统交互
//!
//! 本文件自身包含：环境查询、存储读写、触发器、提醒等通用命令。

use crate::app_state::{
    get_reminder_scheduler_notify, is_release_build, AppState, PENDING_REMINDER_ALERTS,
    ReminderAlertPayload, SESSION_OBSERVER_STARTED,
};

use crate::get_i18n_text;
use crate::modules::constants::{
    ANIMATION_AREA_HEIGHT, ANIMATION_AREA_WIDTH, ANIMATION_BORDER, BUBBLE_AREA_HEIGHT,
    BUBBLE_AREA_WIDTH, MAX_BUTTONS_PER_ROW, MAX_CHARS_PER_BUTTON, MAX_CHARS_PER_LINE,
    SHORT_TEXT_THRESHOLD, TRAY_ID_MAIN,
};

use crate::modules::environment::{
    get_cached_location, get_cached_weather, get_current_datetime, get_current_season,
    get_time_period, DateTimeInfo, EnvironmentManager, GeoLocation, WeatherInfo,
};
use crate::modules::event_manager::{emit, events};
use crate::modules::media_observer::{get_cached_debug_info, MediaDebugInfo};
use crate::modules::process_observer::{get_cached_process_debug_info, ProcessDebugInfo};
use crate::modules::render_tuning_config::{self, RenderTuningConfig};
use crate::modules::resource::{StateInfo, TriggerInfo};
use crate::modules::storage::{
    MemoItem, ModData, ReminderItem, ReminderSchedule, UserInfo, UserSettings,
};
use crate::modules::system_observer::SystemDebugInfo;
use std::collections::HashMap;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_autostart::ManagerExt;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

pub mod mod_archive_commands;
pub mod mod_resource_commands;
pub mod open_with_commands;
pub mod window_system_commands;

pub use mod_archive_commands::*;
pub use mod_resource_commands::*;
pub use open_with_commands::*;
pub use window_system_commands::*;



// ========================================================================= //
// 前端常量与环境查询
// ========================================================================= //


/// 获取前端所需的几何与缩放常量
///
/// 计算逻辑：
/// 1. 从 Storage 中读取用户定义的 `animation_scale`。
/// 2. 计算缩放后的动画区域。
/// 3. 计算容纳气泡和角色的最小窗口尺寸。
/// 
/// 返回一个包含所有尺寸数值的 HashMap，方便前端动态布局。
fn compute_const_float(scale: f64) -> HashMap<String, f64> {
    // 预分配容量以优化内存性能
    let mut map = HashMap::with_capacity(7);
    
    // 气泡区域尺寸在本项目中采用固定比例，不随角色缩放，以保证文本可读性
    let bubble_height = BUBBLE_AREA_HEIGHT;
    let bubble_width = BUBBLE_AREA_WIDTH;
    
    // 动画区域（角色本体）按用户比例缩放
    let animation_height = ANIMATION_AREA_HEIGHT * scale;
    let animation_width = ANIMATION_AREA_WIDTH * scale;
    
    // 窗口最终尺寸：宽度取气泡或角色的最大值，高度为两者之和
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

#[tauri::command]
pub fn get_const_float(state: State<'_, AppState>) -> HashMap<String, f64> {
    let storage = state.storage.lock().unwrap();
    let scale = storage.data.settings.animation_scale as f64;
    compute_const_float(scale)
}


/// 获取字符串型常量
#[tauri::command]
pub fn get_const_text() -> HashMap<String, String> {
    let mut map = HashMap::with_capacity(1);
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
pub fn get_const_int() -> HashMap<String, u32> {
    let mut map = HashMap::with_capacity(4);
    map.insert("short_text_threshold".into(), SHORT_TEXT_THRESHOLD);
    map.insert("max_buttons_per_row".into(), MAX_BUTTONS_PER_ROW);
    map.insert("max_chars_per_line".into(), MAX_CHARS_PER_LINE);
    map.insert("max_chars_per_button".into(), MAX_CHARS_PER_BUTTON);
    map
}

/// 获取环境变量（用于检测调试模式等）
#[tauri::command]
pub fn get_env_var(name: String) -> Option<String> {
    std::env::var(&name).ok()
}

/// 获取当前构建模式
///
/// 返回 "release" 或 "debug"
#[tauri::command]
pub fn get_build_mode() -> String {
    if is_release_build() {
        "release".to_string()
    } else {
        "debug".to_string()
    }
}

/// 获取渲染调优配置（从 config/render_tuning.json 加载）
///
/// 前端在初始化渲染引擎前调用，用于覆盖硬编码的 RENDER_TUNING 默认值。
/// 配置在程序启动时从 `config/render_tuning.json` 读取并缓存。
#[tauri::command]
pub fn get_render_tuning() -> RenderTuningConfig {
    render_tuning_config::get_render_tuning_config()
}

// ========================================================================= //
// 用户设置与用户信息
// ========================================================================= //

/// 使用时长/首次启动统计
#[derive(Debug, serde::Serialize)]
pub struct UsageStats {
    pub first_login: Option<i64>,
    pub total_usage_seconds: i64,
    /// 距离本次程序启动已过的秒数
    pub session_uptime_seconds: i64,
}

/// 获取用户设置
#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> UserSettings {
    let storage = state.storage.lock().unwrap();
    storage.data.settings.clone()
}

/// 获取使用统计（用于文本占位符等）
///
/// - `first_login`: 第一次启动的 Unix 时间戳（秒）
/// - `total_usage_seconds`: 累计使用时长（秒，包含本次运行中尚未落盘的部分）
#[tauri::command]
pub fn get_usage_stats(state: State<'_, AppState>) -> UsageStats {
    let storage = state.storage.lock().unwrap();
    UsageStats {
        first_login: storage.data.info.first_login,
        total_usage_seconds: storage.get_total_usage_seconds_now(),
        session_uptime_seconds: storage.get_session_uptime_seconds_now(),
    }
}

/// 更新用户设置
///
/// 这是一个核心 IPC 命令，不仅负责持久化配置，还会触发一系列系统级的副作用。
/// 
/// 流程：
/// 1. 获取 `storage` 互斥锁并更新内存中的设置。
/// 2. 释放锁，防止后续事件通知引起的回调（如果是同步执行）产生死锁。
/// 3. 向前端广播 `SETTINGS_CHANGE` 事件，使 UI 能够实时响应（如语言切换、透明度调整）。
/// 4. 处理副作用：目前主要是根据设置启用或禁用 Windows 开机自启动。
#[tauri::command]
pub fn update_settings(
    settings: UserSettings,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut storage = state.storage.lock().unwrap();
        storage.update_settings(settings.clone())?; // 需要 clone，因为 update_settings 会消费所有权
    } // 此时锁已释放，防止下方触发的事件回调再次尝试获取锁时产生死锁

    // 发送设置变更事件，通知所有窗口（尤其是设置窗口本身和其他监听窗口）
    let _ = emit(&app, events::SETTINGS_CHANGE, &settings);

    // --- 执行副作用 ---

    // 0. 主播模式副作用：用于窗口捕捉
    // 开启时让渲染窗口进入任务栏/可枚举窗口列表（skip_taskbar = false）
    let should_skip_taskbar = !settings.streamer_mode;
    for label in crate::modules::constants::RENDER_WINDOW_LABELS {
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

    // 1. 开机自启动副作用

    // 注意：由于安全和权限原因，开机自启动逻辑仅在 Release 构建下生效
    let autostart_manager = app.autolaunch();
    if settings.auto_start {
        if is_release_build() {
            let _ = autostart_manager.enable();
        } else {
            // 开发模式下仅在控制台输出提示，不实际修改注册表
            eprintln!("{}", get_i18n_text(&app, "backend.log.autostartDev"));
        }
    } else {
        if is_release_build() {
            let _ = autostart_manager.disable();
        } else {
            eprintln!("{}", get_i18n_text(&app, "backend.log.autostartDev"));
        }       
    }

    Ok(())
}

/// 获取用户信息
#[tauri::command]
pub fn get_user_info(state: State<'_, AppState>) -> UserInfo {
    let storage = state.storage.lock().unwrap();
    storage.data.info.clone()
}

/// 更新用户信息
#[tauri::command]
pub fn update_user_info(info: UserInfo, state: State<'_, AppState>) -> Result<(), String> {
    let mut storage = state.storage.lock().unwrap();
    storage.update_user_info(info)
}

/// 获取备忘录（存储于 UserInfo 内）
#[tauri::command]
pub fn get_memos(state: State<'_, AppState>) -> Vec<MemoItem> {
    let storage = state.storage.lock().unwrap();
    storage.data.info.memos.clone()
}

/// 设置备忘录（修改后立刻保存）
#[tauri::command]
pub fn set_memos(memos: Vec<MemoItem>, state: State<'_, AppState>) -> Result<(), String> {
    let mut storage = state.storage.lock().unwrap();
    storage.data.info.memos = memos;
    storage.save()
}

// ========================================================================= //
// 定时提醒
// ========================================================================= //

pub(crate) fn compute_next_weekly_trigger_at(now_ts: i64, days: &[u8], hour: u8, minute: u8) -> i64 {

    use chrono::{Datelike, Duration, Local, NaiveTime, TimeZone};
    use std::collections::HashSet;

    let now = Local.timestamp_opt(now_ts, 0).single().unwrap_or_else(Local::now);

    let mut set: HashSet<u8> = days
        .iter()
        .copied()
        .filter(|d| (1..=7).contains(d))
        .collect();
    if set.is_empty() {
        return now_ts + 365 * 24 * 3600; // 兜底：一年后
    }

    let h = (hour as u32).min(23);
    let m = (minute as u32).min(59);
    let t = NaiveTime::from_hms_opt(h, m, 0).unwrap_or_else(|| NaiveTime::from_hms_opt(0, 0, 0).unwrap());

    let today = now.date_naive();

    for offset in 0..=7 {
        let date = today + Duration::days(offset);
        let wd = date.weekday().number_from_monday() as u8;
        if !set.contains(&wd) {
            continue;
        }

        let naive = date.and_time(t);
        let candidate = Local
            .from_local_datetime(&naive)
            .earliest()
            .or_else(|| Local.from_local_datetime(&naive).latest())
            .unwrap_or_else(|| Local.from_utc_datetime(&naive));

        let ts = candidate.timestamp();
        if ts > now_ts {
            return ts;
        }
    }

    // 理论上不会走到这里（上面会命中下周同一天）。兜底：7 天后。
    now_ts + 7 * 24 * 3600
}

pub(crate) fn normalize_reminder(mut r: ReminderItem, now_ts: i64) -> ReminderItem {

    // 避免空文本导致“无意义提醒”
    r.text = r.text.as_ref().trim().to_string().into_boxed_str();

    match &mut r.schedule {
        ReminderSchedule::Absolute { timestamp } => {
            r.next_trigger_at = *timestamp;
        }
        ReminderSchedule::After { seconds, created_at } => {
            let base = created_at.unwrap_or(now_ts);
            *created_at = Some(base);
            r.next_trigger_at = base + (*seconds as i64);
        }
        ReminderSchedule::Weekly { days, hour, minute } => {
            r.next_trigger_at = compute_next_weekly_trigger_at(now_ts, days, *hour, *minute);
        }
    }

    r
}

/// 获取定时提醒
#[tauri::command]
pub fn get_reminders(state: State<'_, AppState>) -> Vec<ReminderItem> {
    let storage = state.storage.lock().unwrap();
    storage.data.info.reminders.clone()
}

/// 设置定时提醒（修改后立刻保存）
#[tauri::command]
pub fn set_reminders(reminders: Vec<ReminderItem>, state: State<'_, AppState>) -> Result<(), String> {
    use chrono::Local;

    let now_ts = Local::now().timestamp();
    let normalized: Vec<ReminderItem> = reminders
        .into_iter()
        .map(|r| normalize_reminder(r, now_ts))
        .collect();

    let mut storage = state.storage.lock().unwrap();
    storage.data.info.reminders = normalized;
    let result = storage.save();
    if result.is_ok() {
        get_reminder_scheduler_notify().notify_waiters();
    }
    result

}

/// 读取并清空待展示的提醒弹窗队列
#[tauri::command]
pub fn take_pending_reminder_alerts() -> Vec<ReminderAlertPayload> {
    PENDING_REMINDER_ALERTS
        .lock()
        .ok()
        .map(|mut g| std::mem::take(&mut *g))
        .unwrap_or_default()
}

// ========================================================================= //
// Mod 数据相关
// ========================================================================= //

/// 获取当前 Mod 的数据
#[tauri::command]
pub fn get_current_mod_data(state: State<'_, AppState>) -> Option<ModData> {
    let storage = state.storage.lock().unwrap();
    let mod_id = storage.data.info.current_mod.to_string();
    storage.data.info.mod_data.get(&mod_id).cloned()
}

/// 设置当前 Mod 的数值数据（如好感度、计数器等，会立即落盘）
#[tauri::command]
pub fn set_current_mod_data_value(
    value: i32,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ModData, String> {
    let mut storage = state.storage.lock().unwrap();
    let mod_id = storage.data.info.current_mod.to_string();

    // 先写入内存中的 map
    {
        let entry = storage.data.info.mod_data.entry(mod_id.clone()).or_insert(ModData {
            mod_id: mod_id.clone(),
            value,
        });
        entry.value = value;
    }

    // 立即保存到磁盘 info.json
    storage.save()?;

    // 取出更新后的数据用于返回和广播
    let data = storage
        .data
        .info
        .mod_data
        .get(&mod_id)
        .cloned()
        .unwrap_or(ModData {
            mod_id,
            value,
        });

    // 广播数据变更，允许 Mod 脚本实时响应
    let _ = emit(&app, events::MOD_DATA_CHANGED, data.clone());
    Ok(data)
}

// ========================================================================= //
// 状态管理
// ========================================================================= //

/// 获取所有预定义状态
#[tauri::command]
pub fn get_all_states(state: State<'_, AppState>) -> Vec<StateInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_all_states()
}

/// 获取当前状态
#[tauri::command]
pub fn get_current_state(state: State<'_, AppState>) -> Option<StateInfo> {
    let sm = state.state_manager.lock().unwrap();
    sm.get_current_state().cloned()
}

/// 获取持久状态
#[tauri::command]
pub fn get_persistent_state(state: State<'_, AppState>) -> Option<StateInfo> {
    let sm = state.state_manager.lock().unwrap();
    sm.get_persistent_state().cloned()
}

/// 获取下一个待切换状态
#[tauri::command]
pub fn get_next_state(state: State<'_, AppState>) -> Option<StateInfo> {
    let sm = state.state_manager.lock().unwrap();
    sm.get_next_state().cloned()
}

/// 切换状态（自动选择持久/临时模式）
#[tauri::command]
pub fn change_state(name: String, state: State<'_, AppState>) -> Result<bool, String> {
    // 强制锁顺序：Resource -> State
    let rm = state.resource_manager.lock().unwrap();
    let state_info = rm
        .get_state_by_name(&name)
        .ok_or_else(|| format!("State '{}' not found", name))?
        .clone();

    let mut sm = state.state_manager.lock().unwrap();
    // 使用传入锁的方法
    sm.change_state(state_info, &rm)
}

/// 强制切换状态（忽略优先级和锁定检查）
#[tauri::command]
pub fn force_change_state(name: String, state: State<'_, AppState>) -> Result<(), String> {
    // 强制锁顺序：Resource -> State
    let rm = state.resource_manager.lock().unwrap();
    let state_info = rm
        .get_state_by_name(&name)
        .ok_or_else(|| format!("State '{}' not found", name))?
        .clone();

    let mut sm = state.state_manager.lock().unwrap();
    // 使用传入锁的方法
    sm.change_state_ex(state_info, true, &rm)?;
    Ok(())
}

/// 动画播放完成回调
#[tauri::command]
pub fn on_animation_complete(state: State<'_, AppState>) {
    // 强制锁顺序：Resource -> State
    // 即使这里看似只需 State，但 on_state_complete 可能会触发 change_state，进而需要 Resource 锁
    let rm = state.resource_manager.lock().unwrap();
    let mut sm = state.state_manager.lock().unwrap();
    sm.on_state_complete(&rm);
}

/// 设置下一个待切换状态
#[tauri::command]
pub fn set_next_state(name: String, state: State<'_, AppState>) -> Result<(), String> {
    // 强制锁顺序：Resource -> State
    let rm = state.resource_manager.lock().unwrap();
    let state_info = rm
        .get_state_by_name(&name)
        .ok_or_else(|| format!("State '{}' not found", name))?
        .clone();

    let mut sm = state.state_manager.lock().unwrap();
    sm.set_next_state(state_info);
    Ok(())
}

/// 检查状态是否被锁定
#[tauri::command]
pub fn is_state_locked(state: State<'_, AppState>) -> bool {
    let sm = state.state_manager.lock().unwrap();
    sm.is_locked()
}

// ========================================================================= //
// 触发器
// ========================================================================= //

/// 获取所有触发器
#[tauri::command]
pub fn get_all_triggers(state: State<'_, AppState>) -> Vec<TriggerInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_all_triggers()
}

/// 触发事件
#[tauri::command]
pub fn trigger_event(
    event_name: String,
    force: Option<bool>,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    state.trigger_event(&event_name, force.unwrap_or(false))
}

// ========================================================================= //
// 环境信息
// ========================================================================= //

/// 获取当前日期时间信息
#[tauri::command]
pub fn get_datetime_info() -> DateTimeInfo {
    get_current_datetime()
}

/// 获取地理位置信息（优先使用全局缓存）
#[tauri::command]
pub async fn get_location_info() -> Option<GeoLocation> {
    // 优先返回全局缓存
    if let Some(location) = get_cached_location() {
        return Some(location);
    }
    // 如果缓存为空（初始化还未完成），触发获取
    let mut manager = EnvironmentManager::new();
    manager.get_location().await
}

/// 刷新地理位置信息（强制重新从 API 获取）
#[tauri::command]
pub async fn refresh_location_info() -> Option<GeoLocation> {
    let mut manager = EnvironmentManager::new();
    manager.refresh_location().await
}

/// 获取当前季节
#[tauri::command]
pub fn get_season_info() -> String {
    get_current_season().name().to_string()
}

/// 获取当前时间段
#[tauri::command]
pub fn get_time_period_info() -> String {
    get_time_period().to_string()
}

/// 获取天气信息（优先使用全局缓存）
#[tauri::command]
pub async fn get_weather_info() -> Option<WeatherInfo> {
    // 优先返回全局缓存
    if let Some(weather) = get_cached_weather() {
        return Some(weather);
    }
    // 如果缓存为空，触发获取
    let mut manager = EnvironmentManager::new();
    manager.get_weather().await
}

// ========================================================================= //
// 调试与观察器
// ========================================================================= //


/// 获取媒体调试信息
#[tauri::command]
pub fn get_media_debug_info() -> Option<MediaDebugInfo> {
    get_cached_debug_info()
}

/// 获取进程调试信息
#[tauri::command]
pub fn get_process_debug_info() -> Option<ProcessDebugInfo> {
    get_cached_process_debug_info()
}




/// 获取系统观察器调试信息
#[tauri::command]
pub fn get_system_debug_info() -> Option<SystemDebugInfo> {
    crate::modules::system_observer::get_cached_debug_info()
}

/// 获取媒体状态（是否正在播放）
///
/// 调用 media_observer 获取缓存的媒体状态。
#[tauri::command]
pub fn get_media_status() -> bool {
    use crate::modules::media_observer::{get_cached_media_state, MediaPlaybackStatus};
    match get_cached_media_state() {
        Some(event) => event.status == MediaPlaybackStatus::Playing,
        None => false,
    }
}

// ========================================================================= //
// 文件与路径命令
// ========================================================================= //

/// 打开存储目录（包含 storage.json 文件）
#[tauri::command]
pub fn open_storage_dir(app_handle: AppHandle) -> Result<(), String> {
    let storage_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;

    open_dir(storage_dir.to_string_lossy().to_string())
}

/// 获取 tbuddy archive mod 的 .tbuddy 文件实际磁盘路径
///
/// 对于 archive mod，返回 .tbuddy 文件所在的磁盘路径；
/// 对于普通文件夹 mod，返回 None。
#[tauri::command]
pub fn get_tbuddy_source_path(state: State<'_, AppState>, mod_id: String) -> Option<String> {
    let store = state.archive_store.lock().unwrap();
    store
        .get_source(&mod_id)
        .map(|s| s.file_path.to_string_lossy().into_owned())
}

/// 打开指定目录
#[tauri::command]
pub fn open_dir(path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    let dir_path = path;

    // 使用 open_path 逻辑打开目录
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("explorer")
            .arg(&dir_path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    /// macOS: open; Linux: xdg-open
    #[cfg(not(target_os = "windows"))]
    {
        open_dir_non_windows(&dir_path)?;
    }

    Ok(())
}

// ========================================================================= //
// 托盘与菜单命令
// ========================================================================= //

/// 弹出上下文菜单命令 (供前端右键调用)
#[tauri::command]
pub fn show_context_menu(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let menu = crate::inner_build_tray_menu(&app).map_err(|e| e.to_string())?;
    window.popup_menu(&menu).map_err(|e| e.to_string())?;
    Ok(())
}

/// 获取系统托盘位置（用于隐藏模式下的吸附）
#[tauri::command]
pub fn get_tray_position(app: AppHandle) -> (f64, f64) {
    // 使用 Tauri v2 官方提供的 TrayIcon::rect 接口
    if let Some(tray) = app.tray_by_id(TRAY_ID_MAIN) {
        if let Ok(Some(rect)) = tray.rect() {
            // Position 和 Size 是枚举，需要模式匹配来获取数值
            let x_val = match rect.position {
                tauri::Position::Physical(p) => p.x as f64,
                tauri::Position::Logical(l) => l.x,
            };
            let width_val = match rect.size {
                tauri::Size::Physical(s) => s.width as f64,
                tauri::Size::Logical(s) => s.width,
            };
            let y_val = match rect.position {
                tauri::Position::Physical(p) => p.y as f64,
                tauri::Position::Logical(l) => l.y,
            };

            let target_x = x_val + width_val / 2.0;
            let target_y = y_val;

            //println!("[Tray Logic] Found tray icon rect via API: {:?}", rect);
            return (target_x, target_y);
        }
    }
    // Windows 回退: 通过 Shell_TrayWnd 查找任务栏位置
    #[cfg(target_os = "windows")]
    {
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::RECT;
        use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, GetWindowRect};

        // 寻找任务栏 (Shell_TrayWnd)
        let class_name: Vec<u16> = "Shell_TrayWnd"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let tray_hwnd = unsafe {
            FindWindowW(PCWSTR::from_raw(class_name.as_ptr()), PCWSTR::null()).unwrap_or_default()
        };

        let mut rect = RECT::default();
        if !tray_hwnd.0.is_null() && unsafe { GetWindowRect(tray_hwnd, &mut rect).is_ok() } {
            // 兜底：返回任务栏右侧大致位置
            return (rect.right as f64 - 150.0, rect.top as f64);
        }
    }
    // 非 Windows: 使用跨平台占位函数
    #[cfg(not(target_os = "windows"))]
    {
        return get_tray_position_non_windows();
    }
    // 最终降级方案
    #[allow(unreachable_code)]
    (1700.0, 1030.0)
}

// ========================================================================= //
// 窗口位置与使用统计命令
// ========================================================================= //

/// 记录用户点击事件
///
/// 前端在每次用户触发点击事件时调用此命令，用于统计用户交互行为
#[tauri::command]
pub fn record_click_event(state: State<'_, AppState>) {
    let mut storage = state.storage.lock().unwrap();
    storage.data.info.total_click_count += 1;
    let _ = storage.save();
}

/// 获取保存的窗口位置
#[tauri::command]
pub fn get_saved_window_position(state: State<'_, AppState>) -> (Option<f64>, Option<f64>) {
    let storage = state.storage.lock().unwrap();
    (
        storage.data.info.animation_window_x,
        storage.data.info.animation_window_y,
    )
}

/// 重置动画窗口位置到默认位置
///
/// 将窗口移动到任务栏上方的默认位置，并清空用户保存的位置信息
#[tauri::command]
pub fn reset_animation_window_position(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // 1. 获取渲染窗口（animation、live2d、pngremix 或 threed）
    let window = crate::get_render_window(&app)
        .ok_or_else(|| get_i18n_text(&app, "backend.error.windowNotFound"))?;

    // 2. 获取当前的缩放比例
    let (_scale, window_width, window_height) = {
        let storage = state.storage.lock().unwrap();
        let scale = storage.data.settings.animation_scale as f64;
        let animation_area_height = ANIMATION_AREA_HEIGHT * scale;
        let bubble_area_width = BUBBLE_AREA_WIDTH;
        let animation_area_width = ANIMATION_AREA_WIDTH * scale;

        (
            scale,
            bubble_area_width.max(animation_area_width),
            BUBBLE_AREA_HEIGHT + animation_area_height,
        )
    };

    // 3. 计算默认位置（任务栏上方）
    if let Some(monitor) = window.primary_monitor().ok().flatten() {
        let scale_factor = monitor.scale_factor();
        let screen_size = monitor.size();
        let screen_pos = monitor.position();
        const TASKBAR_HEIGHT: f64 = 48.0;

        let screen_w = screen_size.width as f64 / scale_factor;
        let screen_h = screen_size.height as f64 / scale_factor;

        let x = screen_pos.x as f64 + screen_w - window_width;
        let y = screen_pos.y as f64 + screen_h - window_height - TASKBAR_HEIGHT;

        // 4. 移动窗口到默认位置
        window
            .set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)))
            .map_err(|e| e.to_string())?;

        // 5. 清空用户保存的位置信息
        {
            let mut storage = state.storage.lock().unwrap();
            storage.data.info.animation_window_x = None;
            storage.data.info.animation_window_y = None;
            storage.save().map_err(|e| e.to_string())?;
        }

        Ok(())
    } else {
        Err(get_i18n_text(&app, "backend.error.monitorNotFound"))
    }
}

// ========================================================================= //
// 登录检测命令
// ========================================================================= //

/// 启动登录检测（由前端调用）
///
/// 启动异步线程检测用户是否已登录到桌面，检测到后自动触发相应事件
/// 特殊日期判断（生日、首登录纪念日）和login触发都在session_observer回调内处理
#[tauri::command]
pub fn start_login_detection(app: AppHandle) -> Result<(), String> {
    use std::sync::atomic::Ordering;

    // 检查是否已经启动过，防止重复启动导致资源泄漏
    if SESSION_OBSERVER_STARTED.swap(true, Ordering::SeqCst) {
        // 已启动，直接返回
        return Ok(());
    }

    // 启动桌面会话检测（所有触发逻辑都在检测回调内）
    crate::start_session_observer(app);

    Ok(())
}

// ========================================================================= //
// 非 Windows 平台占位函数
// ========================================================================= //

/// 非 Windows 平台打开目录。
///
/// TODO(cross-platform): macOS — 使用 `open <dir>`；
///                        Linux — 使用 `xdg-open <dir>`。
#[cfg(not(target_os = "windows"))]
fn open_dir_non_windows(dir_path: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(dir_path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(dir_path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("open_dir not implemented for this platform".to_string())
}

/// 非 Windows 平台获取系统托盘/Dock 位置（用于窗口吸附定位）。
///
/// TODO(cross-platform): macOS — 通过 NSScreen.visibleFrame 推算 Dock 位置；
///                        Linux — 通过 _NET_WORKAREA X11 属性推算面板位置。
#[cfg(not(target_os = "windows"))]
fn get_tray_position_non_windows() -> (f64, f64) {
    // 降级：返回屏幕右下角的大致位置
    (1700.0, 1030.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::storage::{ReminderItem, ReminderSchedule};
    use chrono::{Datelike, Local, TimeZone};

    #[test]
    fn compute_next_weekly_trigger_falls_back_when_no_days() {
        let now_ts = 1_700_000_000;
        let next = compute_next_weekly_trigger_at(now_ts, &[], 10, 30);
        assert_eq!(next, now_ts + 365 * 24 * 3600);
    }

    #[test]
    fn compute_next_weekly_trigger_picks_same_day_if_future_time() {
        let now = Local.with_ymd_and_hms(2025, 1, 1, 10, 0, 0).single().unwrap();
        let weekday = now.weekday().number_from_monday() as u8;
        let now_ts = now.timestamp();

        let next = compute_next_weekly_trigger_at(now_ts, &[weekday], 10, 30);
        let expected = Local.with_ymd_and_hms(2025, 1, 1, 10, 30, 0).single().unwrap();
        assert_eq!(next, expected.timestamp());
    }

    #[test]
    fn normalize_reminder_trims_text_and_sets_next_trigger() {
        let now_ts = 1_700_000_100;
        let reminder = ReminderItem {
            id: "r1".to_string(),
            text: "  hello  ".into(),
            enabled: true,
            schedule: ReminderSchedule::After {
                seconds: 60,
                created_at: None,
            },
            next_trigger_at: 0,
            last_trigger_at: None,
        };

        let normalized = normalize_reminder(reminder, now_ts);
        assert_eq!(&*normalized.text, "hello");
        match normalized.schedule {
            ReminderSchedule::After { seconds, created_at } => {
                assert_eq!(seconds, 60);
                assert_eq!(created_at, Some(now_ts));
            }
            _ => panic!("unexpected schedule"),
        }
        assert_eq!(normalized.next_trigger_at, now_ts + 60);

        let absolute = ReminderItem {
            schedule: ReminderSchedule::Absolute { timestamp: 12345 },
            ..ReminderItem::default()
        };
        let normalized = normalize_reminder(absolute, now_ts);
        assert_eq!(normalized.next_trigger_at, 12345);
    }

    #[test]
    fn normalize_reminder_weekly_schedules_next_time() {
        let now = Local.with_ymd_and_hms(2025, 1, 2, 8, 0, 0).single().unwrap();
        let weekday = now.weekday().number_from_monday() as u8;
        let reminder = ReminderItem {
            schedule: ReminderSchedule::Weekly {
                days: vec![weekday],
                hour: 9,
                minute: 0,
            },
            ..ReminderItem::default()
        };

        let normalized = normalize_reminder(reminder, now.timestamp());
        assert!(normalized.next_trigger_at > now.timestamp());
    }

    #[test]
    fn compute_const_float_scales_window() {
        let map = compute_const_float(1.0);
        let expected_animation_height = ANIMATION_AREA_HEIGHT;
        let expected_animation_width = ANIMATION_AREA_WIDTH;
        let expected_window_width = BUBBLE_AREA_WIDTH.max(expected_animation_width);
        let expected_window_height = BUBBLE_AREA_HEIGHT + expected_animation_height;

        assert_eq!(map.get("animation_scale"), Some(&1.0));
        assert_eq!(map.get("animation_area_height"), Some(&expected_animation_height));
        assert_eq!(map.get("animation_area_width"), Some(&expected_animation_width));
        assert_eq!(map.get("animation_window_width"), Some(&expected_window_width));
        assert_eq!(map.get("animation_window_height"), Some(&expected_window_height));
    }

    #[test]
    fn get_const_text_contains_border() {
        let map = get_const_text();
        assert_eq!(map.get(ANIMATION_BORDER), Some(&ANIMATION_BORDER.to_string()));
    }

    #[test]
    fn get_const_int_contains_expected_keys() {
        let map = get_const_int();
        assert_eq!(map.get("short_text_threshold"), Some(&SHORT_TEXT_THRESHOLD));
        assert_eq!(map.get("max_buttons_per_row"), Some(&MAX_BUTTONS_PER_ROW));
        assert_eq!(map.get("max_chars_per_line"), Some(&MAX_CHARS_PER_LINE));
        assert_eq!(map.get("max_chars_per_button"), Some(&MAX_CHARS_PER_BUTTON));
    }
}



