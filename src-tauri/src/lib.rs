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

#![allow(unused)]

mod modules;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use modules::constants::{
    ANIMATION_AREA_HEIGHT, ANIMATION_AREA_WIDTH, ANIMATION_BORDER, BUBBLE_AREA_HEIGHT,
    BUBBLE_AREA_WIDTH, MAX_BUTTONS_PER_ROW, MAX_CHARS_PER_BUTTON, MAX_CHARS_PER_LINE,
    MOD_LOGIN_EVENT_DELAY_SECS, SHORT_TEXT_THRESHOLD, STATE_IDLE, STATE_MUSIC_END,
    STATE_MUSIC_START,     STATE_SILENCE, STATE_SILENCE_END, STATE_SILENCE_START, TRAY_ID_MAIN,
    WINDOW_LABEL_ABOUT, WINDOW_LABEL_ANIMATION, WINDOW_LABEL_LIVE2D, WINDOW_LABEL_MAIN,
    WINDOW_LABEL_MEMO, WINDOW_LABEL_MODS, WINDOW_LABEL_REMINDER, WINDOW_LABEL_REMINDER_ALERT,
    WINDOW_LABEL_SETTINGS, EVENT_LOGIN, EVENT_MUSIC_END, EVENT_MUSIC_START, EVENT_WORK,
    WORK_EVENT_COOLDOWN_SECS
};


use modules::event_manager::{emit, emit_from_tauri_window, emit_from_window, emit_settings, events};
use modules::environment::{
    get_cached_location, get_cached_weather, get_current_datetime, get_current_season,
    get_time_period, init_environment, DateTimeInfo, EnvironmentManager, GeoLocation, WeatherInfo,
};
use modules::media_observer::{
    get_cached_debug_info, MediaDebugInfo, MediaObserver, MediaPlaybackStatus,
};
use modules::process_observer::{
    get_cached_process_debug_info, ProcessDebugInfo, ProcessObserver, ProcessStartEvent,
};
use modules::resource::{
    self, AssetInfo, AudioInfo, CharacterInfo, ModInfo, ModType, ResourceManager, StateInfo,
    TextInfo, TriggerInfo,
};

use modules::state::StateManager;
use modules::storage::{
    MemoItem, ModData, ReminderItem, ReminderSchedule, Storage, UserInfo, UserSettings,
};
use modules::system_observer::{SystemDebugInfo, SystemObserver};
use modules::trigger::TriggerManager;
use modules::utils::i18n::get_i18n_text as get_i18n_text_cached;
use std::sync::{Arc, Mutex};
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Listener, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_autostart::ManagerExt;

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
static SESSION_OBSERVER_STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 标记后台服务是否已启动
/// 防止重复启动导致资源泄漏
static BACKGROUND_SERVICES_STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 待展示的提醒弹窗队列（提醒调度线程写入，提示窗口读取）
static PENDING_REMINDER_ALERTS: std::sync::Mutex<Vec<ReminderAlertPayload>> =
    std::sync::Mutex::new(Vec::new());

/// 进程触发 work 事件的节流时间（Unix 秒）
static LAST_WORK_EVENT_AT: std::sync::Mutex<Option<i64>> = std::sync::Mutex::new(None);


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
    storage: Mutex<Storage>,
    /// 媒体监听器引用：在独立线程中运行，用于捕获系统媒体播放状态并反馈给状态机
    media_observer: Mutex<Option<MediaObserver>>,
    /// 系统会话锁屏状态：原子布尔值，用于实时标记 Windows 是否处于锁屏或 UAC 界面，
    /// 从而辅助状态机决定是否应进入静默/免打扰模式。
    session_locked: Arc<std::sync::atomic::AtomicBool>,
}

// ========================================================================= //
// 核心辅助工具
// ========================================================================= //

/// 检查当前是否为 Release 优化构建
///
/// 该函数在运行时动态判断，主要用于启用某些仅在生产环境下需要的特性（如开机自启动）。
/// 逻辑基于编译时宏 `debug_assertions`。
fn is_release_build() -> bool {
    !cfg!(debug_assertions)
}

// ========================================================================= //
// 前端常量与环境查询 IPC 命令
// ========================================================================= //

/// 获取前端所需的几何与缩放常量
///
/// 计算逻辑：
/// 1. 从 Storage 中读取用户定义的 `animation_scale`。
/// 2. 计算缩放后的动画区域。
/// 3. 计算容纳气泡和角色的最小窗口尺寸。
/// 
/// 返回一个包含所有尺寸数值的 HashMap，方便前端动态布局。
#[tauri::command]
fn get_const_float(state: State<'_, AppState>) -> std::collections::HashMap<String, f64> {
    let storage = state.storage.lock().unwrap();
    let scale = storage.data.settings.animation_scale as f64;

    // 预分配容量以优化内存性能
    let mut map = std::collections::HashMap::with_capacity(7);
    
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

/// 获取当前构建模式
///
/// 返回 "release" 或 "debug"
#[tauri::command]
fn get_build_mode() -> String {
    if is_release_build() {
        "release".to_string()
    } else {
        "debug".to_string()
    }
}

// ========================================================================= //
// 用户设置命令
// ========================================================================= //

/// 使用时长/首次启动统计
#[derive(Debug, serde::Serialize)]
struct UsageStats {
    pub first_login: Option<i64>,
    pub total_usage_seconds: i64,
    /// 距离本次程序启动已过的秒数
    pub session_uptime_seconds: i64,
}


/// 获取用户设置
#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> UserSettings {
    let storage = state.storage.lock().unwrap();
    storage.data.settings.clone()
}

/// 获取使用统计（用于文本占位符等）
///
/// - `first_login`: 第一次启动的 Unix 时间戳（秒）
/// - `total_usage_seconds`: 累计使用时长（秒，包含本次运行中尚未落盘的部分）
#[tauri::command]
fn get_usage_stats(state: State<'_, AppState>) -> UsageStats {
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
fn update_settings(
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
    for label in [WINDOW_LABEL_ANIMATION, WINDOW_LABEL_LIVE2D] {
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

/// 获取备忘录（存储于 UserInfo 内）
#[tauri::command]
fn get_memos(state: State<'_, AppState>) -> Vec<MemoItem> {
    let storage = state.storage.lock().unwrap();
    storage.data.info.memos.clone()
}

/// 设置备忘录（修改后立刻保存）
#[tauri::command]
fn set_memos(memos: Vec<MemoItem>, state: State<'_, AppState>) -> Result<(), String> {
    let mut storage = state.storage.lock().unwrap();
    storage.data.info.memos = memos;
    storage.save()
}

// ========================================================================= //
// 定时提醒（存储于 UserInfo 内）
// ========================================================================= //

fn compute_next_weekly_trigger_at(now_ts: i64, days: &[u8], hour: u8, minute: u8) -> i64 {
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

fn normalize_reminder(mut r: ReminderItem, now_ts: i64) -> ReminderItem {
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
fn get_reminders(state: State<'_, AppState>) -> Vec<ReminderItem> {
    let storage = state.storage.lock().unwrap();
    storage.data.info.reminders.clone()
}

/// 设置定时提醒（修改后立刻保存）
#[tauri::command]
fn set_reminders(reminders: Vec<ReminderItem>, state: State<'_, AppState>) -> Result<(), String> {
    use chrono::Local;

    let now_ts = Local::now().timestamp();
    let normalized: Vec<ReminderItem> = reminders
        .into_iter()
        .map(|r| normalize_reminder(r, now_ts))
        .collect();

    let mut storage = state.storage.lock().unwrap();
    storage.data.info.reminders = normalized;
    storage.save()
}

/// 读取并清空待展示的提醒弹窗队列
#[tauri::command]
fn take_pending_reminder_alerts() -> Vec<ReminderAlertPayload> {
    PENDING_REMINDER_ALERTS
        .lock()
        .ok()
        .map(|mut g| {
            let out = g.clone();
            g.clear();
            out
        })
        .unwrap_or_default()
}


/// 获取当前 Mod 的数据


#[tauri::command]
fn get_current_mod_data(state: State<'_, AppState>) -> Option<ModData> {
    let storage = state.storage.lock().unwrap();
    let mod_id = storage.data.info.current_mod.to_string();
    storage.data.info.mod_data.get(&mod_id).cloned()
}

/// 设置当前 Mod 的数值数据（如好感度、计数器等，会立即落盘）
#[tauri::command]
fn set_current_mod_data_value(
    value: i32,
    app: tauri::AppHandle,
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
    let mut rm = state.resource_manager.lock().unwrap();
    rm.list_mods()
}

/// Mod 加载的核心通用工作流
/// 
/// 这是一个复杂的异步过程，涉及资源加载、状态迁移、窗口重建以及系统集成更新。
/// 
/// # 参数
/// - `legacy_key`: 用于向后兼容旧版存储格式的 Mod 标识符。
/// - `load`: 闭包，实际执行资源管理器中的加载逻辑。
/// 
/// # 工作流步骤
/// 1. **清理环境**：关闭除了 Mod 管理器以外的所有窗口，防止旧资源的引用冲突。
/// 2. **执行加载**：调用 `ResourceManager` 解析 `manifest.json` 并索引所有资源文件。
/// 3. **数据迁移与初始化**：
///    - 检查是否存在旧格式的 Mod 数据并进行自动迁移。
///    - 更新当前活跃 Mod 标识并初始化其特有的存储空间（如果尚未存在）。
/// 4. **视觉更新**：异步更换托盘图标和所有窗口的图标。
/// 5. **状态机重置**：强制将角色状态切换至新 Mod 的 `idle` 状态。
/// 6. **界面重建**：完全销毁并重新创建动画渲染窗口（Animation Window），这是确保新资源（Canvas 尺寸、层级等）生效最可靠的方式。
/// 7. **事件触发**：延迟触发 Mod 登录事件，允许 Mod 执行初始化动作（如语音招呼）。
async fn load_mod_common<F>(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    legacy_key: Option<String>,
    load: F,
) -> Result<Arc<ModInfo>, String>
where
    F: FnOnce(&mut crate::modules::resource::ResourceManager) -> Result<Arc<ModInfo>, String>,
{
    // 0. 切换 Mod 时关闭除了 mods 以外的所有窗口（包括备忘录/提醒/设置/提醒弹窗等）
    // 理由：每个 Mod 的动画窗口参数可能完全不同，热重载不如重建窗口稳定。
    let windows = app.webview_windows();
    for (label, window) in windows {
        if label != WINDOW_LABEL_MODS {
            let _ = window.close();
        }
    }




    // 给一点时间让 OS 真正释放窗口资源（特别是 Windows 下的渲染句柄）
    tokio::time::sleep(std::time::Duration::from_millis(
        crate::modules::constants::MOD_SWITCH_WINDOW_DELAY_MS,
    ))
    .await;

    // 1. 加载资源：解析 manifest 并建立资源索引
    let mod_info = {
        let mut rm = state.resource_manager.lock().unwrap();
        load(&mut rm)?
    };

    // 2. 更新用户信息并持久化（处理数据迁移）
    {
        let mut storage = state.storage.lock().unwrap();
        let manifest_id = mod_info.manifest.id.to_string();

        // 兼容迁移逻辑：如果用户以前用的是文件夹名作为 ID，现在通过 manifest.id 自动转换
        if let Some(key) = legacy_key {
            if !key.is_empty() && key != manifest_id {
                if storage.data.info.mod_data.contains_key(&key) {
                    if !storage.data.info.mod_data.contains_key(&manifest_id) {
                        if let Some(mut old) = storage.data.info.mod_data.remove(&key) {
                            old.mod_id = manifest_id.clone();
                            storage.data.info.mod_data.insert(manifest_id.clone(), old);
                        }
                    } else {
                        // 两者共存时，以规范化的 manifest_id 为准
                        let _ = storage.data.info.mod_data.remove(&key);
                    }
                }
            }
        }

        storage.data.info.current_mod = manifest_id.clone().into();

        // 为新 Mod 初始化默认持久化数据
        let default_value = mod_info.manifest.mod_data_default_int;
        storage
            .data
            .info
            .mod_data
            .entry(manifest_id.clone())
            .or_insert(ModData {
                mod_id: manifest_id,
                value: default_value,
            });

        let _ = storage.save();
    }

    // 3. 异步更新全局视觉图标
    update_tray_icon_async(app.clone()).await;
    update_window_icons_async(app.clone()).await;

    // 4. 重置状态管理器为新 Mod 的 Idle 状态
    {
        let rm = state.resource_manager.lock().unwrap();
        let initial_state = rm
            .get_state_by_name(STATE_IDLE)
            .ok_or_else(|| get_i18n_text(&app, "backend.error.noIdleState"))?
            .clone();
        let mut sm = state.state_manager.lock().unwrap();
        // 强制切换，不检查当前是否有正在播放的不可中断动画
        let _ = sm.change_state_ex(initial_state, true, &rm);
    }

    // 5. 重建渲染窗口
    match mod_info.manifest.mod_type {
        ModType::Live2d => {
            recreate_live2d_window(app.clone()).await?;
        }
        ModType::Sequence => {
            recreate_animation_window(app.clone()).await?;
        }
    }


    // 6. 触发登录/加载完成事件（如播放打招呼语音）
    tokio::time::sleep(std::time::Duration::from_secs(MOD_LOGIN_EVENT_DELAY_SECS)).await;
    #[cfg(target_os = "windows")]
    trigger_login_events(&app);
    #[cfg(not(target_os = "windows"))]
    trigger_login_events_non_windows(&app);

    Ok(mod_info)
}

/// 从指定目录路径加载 Mod（用于导入后立即加载某个具体目录）
#[tauri::command]
async fn load_mod_from_path(
    mod_path: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Arc<ModInfo>, String> {
    use std::path::PathBuf;

    // 安全限制：仅允许加载 app_config_dir/mods 下的目录
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("{}: {}", get_i18n_text(&app, "backend.error.configDirFailed"), e))?;
    let mods_dir = dunce::canonicalize(config_dir.join("mods"))
        .map_err(|e| format!("Failed to canonicalize mods dir: {}", e))?;

    let target = dunce::canonicalize(PathBuf::from(&mod_path))
        .map_err(|e| format!("Failed to canonicalize mod path '{}': {}", mod_path, e))?;

    if !target.starts_with(&mods_dir) {
        return Err(get_i18n_text(&app, "backend.error.invalidModPath").replace("{path}", &mod_path));
    }

    // 兼容迁移：target 目录名可能是旧的 folder key
    let folder_key = target
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();

    load_mod_common(app, state, Some(folder_key), move |rm| {
        rm.load_mod_from_folder_path(target)
    })
    .await
}

/// 加载指定 Mod
#[tauri::command]
async fn load_mod(
    mod_id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Arc<ModInfo>, String> {
    let legacy_key = mod_id.clone();

    load_mod_common(app, state, Some(legacy_key), move |rm| rm.load_mod(&mod_id)).await
}


/// 卸载当前 Mod
#[tauri::command]
fn unload_mod(app: tauri::AppHandle, state: State<'_, AppState>) -> bool {
    let mut rm = state.resource_manager.lock().unwrap();
    let result = rm.unload_mod();

    // 卸载后恢复默认托盘图标和窗口图标（同步版本，因为函数本身是同步的）
    if result {
        update_tray_icon_sync(&app);
        restore_window_icons_sync(&app);
    }

    result
}

/// 获取当前加载的 Mod 信息
#[tauri::command]
fn get_current_mod(state: State<'_, AppState>) -> Option<Arc<ModInfo>> {
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

/// 判断指定路径是否存在（仅允许检查当前 Mod 目录内的路径）
#[tauri::command]
fn path_exists(path: String, state: State<'_, AppState>) -> bool {
    use std::path::PathBuf;

    let rm = state.resource_manager.lock().unwrap();
    let Some(mod_info) = rm.current_mod.as_ref() else {
        return false;
    };

    // 注意：Path::starts_with 是词法比较，`..` 可能绕过；这里 canonicalize 后再比较。
    let Ok(base) = dunce::canonicalize(&mod_info.path) else {
        return false;
    };

    let p = PathBuf::from(path);
    let Ok(p) = dunce::canonicalize(&p) else {
        // canonicalize 失败通常表示路径不存在/无权限
        return false;
    };

    if !p.starts_with(&base) {
        return false;
    }

    p.exists()
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
fn force_change_state(name: String, state: State<'_, AppState>) -> Result<(), String> {
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
fn on_animation_complete(state: State<'_, AppState>) {
    // 强制锁顺序：Resource -> State
    // 即使这里看似只需 State，但 on_state_complete 可能会触发 change_state，进而需要 Resource 锁
    let rm = state.resource_manager.lock().unwrap();
    let mut sm = state.state_manager.lock().unwrap();
    sm.on_state_complete(&rm);
}

/// 设置下一个待切换状态
#[tauri::command]
fn set_next_state(name: String, state: State<'_, AppState>) -> Result<(), String> {
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
fn trigger_event(
    event_name: String,
    force: Option<bool>,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let rm = state.resource_manager.lock().unwrap();
    let mut sm = state.state_manager.lock().unwrap();
    TriggerManager::trigger_event(&event_name, force.unwrap_or(false), &rm, &mut sm)
}

// ========================================================================= //
// 窗口和系统命令
// ========================================================================= //

/// 设置窗口鼠标穿透状态
///
/// 当 ignore 为 true 时，窗口不响应鼠标事件，鼠标可穿透到下层
#[tauri::command]
fn set_ignore_cursor_events(ignore: bool, app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL_ANIMATION) {
        window
            .set_ignore_cursor_events(ignore)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 检测当前左键是否按下（用于原生拖拽期间的 drag_end 判定）
#[tauri::command]
fn is_left_mouse_down() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
        // GetAsyncKeyState 返回 i16：若最高位为 1 则表示按键处于按下状态
        let down = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) < 0 };
        Ok(down)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("is_left_mouse_down not implemented for this platform".to_string())
    }
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
        .get_webview_window(WINDOW_LABEL_ANIMATION)
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

    // 发送音量变更事件
    let _ = emit(&app, events::VOLUME_CHANGE, volume);
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

    // 发送静音模式变更事件
    let _ = emit(&app, events::MUTE_CHANGE, mute);
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

    for label in [WINDOW_LABEL_ANIMATION, WINDOW_LABEL_LIVE2D] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .set_size(LogicalSize::new(new_width, new_height))
                .map_err(|e| e.to_string())?;
        }
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
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .creation_flags(CREATE_NO_WINDOW)
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
async fn get_location_info() -> Option<GeoLocation> {
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
async fn refresh_location_info() -> Option<GeoLocation> {
    let mut manager = EnvironmentManager::new();
    manager.refresh_location().await
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
async fn get_weather_info() -> Option<WeatherInfo> {
    // 优先返回全局缓存
    if let Some(weather) = get_cached_weather() {
        return Some(weather);
    }
    // 如果缓存为空，触发获取
    let mut manager = EnvironmentManager::new();
    manager.get_weather().await
}

// ========================================================================= //
// 媒体调试命令
// ========================================================================= //

/// 获取媒体调试信息
#[tauri::command]
fn get_media_debug_info() -> Option<MediaDebugInfo> {
    get_cached_debug_info()
}

/// 获取进程调试信息
#[tauri::command]
fn get_process_debug_info() -> Option<ProcessDebugInfo> {
    get_cached_process_debug_info()
}


// ========================================================================= //
// 应用入口
// ========================================================================= //

/// 应用入口点
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .setup(|app| {
            // ========== 初始化核心管理器 ==========
            let rm = Arc::new(Mutex::new(ResourceManager::new(app.handle())));
            let mut sm = StateManager::new();
            let mut storage = Storage::new(app.handle());

            // ========== 加载可配置资源（exe 同目录 config） ==========
            // 目前用于音乐应用识别关键字（MediaObserver）
            modules::media_observer::init_music_keywords_from_config();
            // 进程监测关键字（ProcessObserver）
            modules::process_observer::init_process_keywords_from_config();



            // 记录登录时间和启动次数
            let dt = get_current_datetime();
            let current_time = dt.timestamp as i64;

            // 如果是首次启动，记录首次登录时间
            if storage.data.info.first_login.is_none() {
                storage.data.info.first_login = Some(current_time);
            }

            // 更新最后登录时间
            storage.data.info.last_login = Some(current_time);

            // 增加启动次数
            storage.data.info.launch_count += 1;

            let _ = storage.save();

            // ========== 迁移：统一使用 manifest.id 作为 Mod 唯一标识 ==========
            {
                let mut changed = false;
                let current = storage.data.info.current_mod.to_string();

                let mut rm_guard = rm.lock().unwrap();

                // 1) 迁移 current_mod（历史版本可能存的是文件夹名）
                if !current.is_empty() {
                    if let Some(id) = rm_guard.resolve_mod_id(&current) {
                        if id != current {
                            storage.data.info.current_mod = id.into();
                            changed = true;
                        }
                    }
                }

                // 2) 迁移 mod_data 的 key（历史版本可能用文件夹名作为 key）
                let keys: Vec<String> = storage.data.info.mod_data.keys().cloned().collect();
                for k in keys {
                    let Some(id) = rm_guard.resolve_mod_id(&k) else {
                        continue;
                    };

                    if id == k {
                        continue;
                    }

                    if storage.data.info.mod_data.contains_key(&id) {
                        // 冲突时优先保留 manifest.id 对应的数据
                        let _ = storage.data.info.mod_data.remove(&k);
                        changed = true;
                        continue;
                    }

                    if let Some(mut v) = storage.data.info.mod_data.remove(&k) {
                        v.mod_id = id.clone();
                        storage.data.info.mod_data.insert(id, v);
                        changed = true;
                    }
                }

                drop(rm_guard);

                if changed {
                    let _ = storage.save();
                }
            }

            // ========== 同步开机自启动状态 ==========
            // 只在 Release 版本中允许启用开机自启动
            let autostart_manager = app.autolaunch();
            if storage.data.settings.auto_start {
                if is_release_build() {
                    let _ = autostart_manager.enable();
                } else {
                    // 开发模式下禁用自启动
                    eprintln!("[TrayBuddy] 开发模式下不支持开机自启动，已禁用");
                }
            } else {
                if is_release_build() {
                    let _ = autostart_manager.disable();
                } else {
                    // 开发模式下禁用自启动
                    eprintln!("[TrayBuddy] 开发模式下不支持开机自启动，已禁用");
                }
            }

            // 自动加载上次使用的 Mod
            let last_mod = storage.data.info.current_mod.clone();
            if !last_mod.is_empty() {
                // 注意：不要把 `rm.lock()` 写在 if-let 条件里。
                // 在某些情况下临时值生命周期可能延长到整个 if 语句末尾，导致 else 分支里再次 `rm.lock()` 时同线程二次上锁卡死。
                let load_result = { rm.lock().unwrap().load_mod(&last_mod) };

                match load_result {
                    Err(e) => {
                        eprintln!("[TrayBuddy] 自动加载 Mod '{}' 失败: {}", last_mod, e);
                    }
                    Ok(mod_info) => {
                        // 自动加载成功后更新托盘图标和窗口图标（同步版本，初始化阶段）
                        let app_handle = app.handle();
                        update_tray_icon_sync(&app_handle);
                        // 注意：此时还没有其他窗口，所以不需要调用 update_window_icons_sync

                        // 首次加载该 Mod 时创建数据（默认值来自 Mod manifest），并立即落盘
                        // 统一使用 manifest.id 作为 Mod 唯一标识
                        let default_value = mod_info.manifest.mod_data_default_int;
                        let mod_id = mod_info.manifest.id.to_string();

                        // 兼容迁移：last_mod 可能是旧的文件夹名
                        if mod_id != last_mod.as_ref() {
                            if storage.data.info.mod_data.contains_key(last_mod.as_ref()) {
                                if !storage.data.info.mod_data.contains_key(&mod_id) {
                                    if let Some(mut old) =
                                        storage.data.info.mod_data.remove(last_mod.as_ref())
                                    {
                                        old.mod_id = mod_id.clone();
                                        storage.data.info.mod_data.insert(mod_id.clone(), old);
                                    }
                                } else {
                                    let _ = storage.data.info.mod_data.remove(last_mod.as_ref());
                                }
                            }
                        }

                        storage.data.info.current_mod = mod_id.clone().into();

                        storage
                            .data
                            .info
                            .mod_data
                            .entry(mod_id.clone())
                            .or_insert(ModData {
                                mod_id,
                                value: default_value,
                            });
                        let _ = storage.save();
                    }
                }
            }


            // ========== 初始化状态 ==========
            let is_silence = storage.data.settings.silence_mode;

            let initial_state = {
                let rm_guard = rm.lock().unwrap();
                rm_guard.get_state_by_name(STATE_IDLE).cloned()
            }; // 锁在此处释放

            if let Some(state) = initial_state {
                // 重新获取锁来调用 change_state
                let rm_guard = rm.lock().unwrap();
                let _ = sm.change_state(state, &rm_guard);
            }

            sm.set_app_handle(app.handle().clone());

            // ========== 获取当前 Mod 类型（在 rm 被 move 之前） ==========
            let current_mod_type = {
                let rm_guard = rm.lock().unwrap();
                rm_guard.current_mod.as_ref().map(|m| m.manifest.mod_type)
            };

            // ========== 系统托盘 (System Tray) ==========
            // 必须在注册AppState之前创建，因为需要先使用rm
            let tray_icon = {
                // 1. 获取当前加载的 Mod 图标
                let icon = {
                    let rm_guard = rm.lock().unwrap();
                    if let Some(current_mod) = &rm_guard.current_mod {
                        if let Some(icon_path) = &current_mod.icon_path {
                            let full_icon_path = current_mod.path.join(icon_path.as_ref());
                            if full_icon_path.exists() {
                                Image::from_path(&full_icon_path)
                                    .unwrap_or_else(|_| app.default_window_icon().unwrap().clone())
                            } else {
                                app.default_window_icon().unwrap().clone()
                            }
                        } else {
                            app.default_window_icon().unwrap().clone()
                        }
                    } else {
                        app.default_window_icon().unwrap().clone()
                    }
                };
                icon
            };

            // ========== 注册全局状态（必须在创建窗口之前） ==========
            app.manage(AppState {
                resource_manager: rm,
                state_manager: Mutex::new(sm),
                storage: Mutex::new(storage),
                media_observer: Mutex::new(None),
                session_locked: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            });

            // ========== 监听设置变更以实时刷新托盘菜单 ==========
            {
                let app_handle = app.handle().clone();
                app.listen("settings-change", move |_| {
                    if let Some(tray) = app_handle.tray_by_id(TRAY_ID_MAIN) {
                        if let Ok(menu) = inner_build_tray_menu(&app_handle) {
                            let _ = tray.set_menu(Some(menu));
                        }
                    }
                });
            }

            // ========== 根据 Mod 类型创建对应的渲染窗口 ==========
            match current_mod_type {
                Some(ModType::Live2d) => {
                    inner_create_live2d_window(app.handle())?;
                }
                _ => {
                    // 默认（Sequence 或无 Mod）创建序列帧动画窗口
                    inner_create_animation_window(app.handle())?;
                }
            }

            // ========== 创建托盘 ==========
            {

                // 2. 创建菜单 (使用辅助函数支持国际化)
                let menu = inner_build_tray_menu(app.handle())?;

                // 3. 创建托盘
                let builder = TrayIconBuilder::with_id(TRAY_ID_MAIN)
                    .icon(tray_icon)
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(move |app, event| {
                        handle_menu_event(app, &event.id.as_ref());
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            ..
                        } = event
                        {
                            // 左键双击等逻辑可以在此添加
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
                    // animation 窗口无法触发这个
                    if window.label() == WINDOW_LABEL_MAIN || window.label() == WINDOW_LABEL_SETTINGS {
                        let app_state: State<AppState> = window.state();
                        let mut storage = app_state.storage.lock().unwrap();
                        storage.save();
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    if window.label() == WINDOW_LABEL_MAIN {
                        // 主窗口销毁时，强制关闭所有可能开启的局部调试状态
                        let _ = emit(&window.app_handle(), events::LAYOUT_DEBUGGER_STATUS, false);
                    } else if window.label() == WINDOW_LABEL_ANIMATION
                        || window.label() == WINDOW_LABEL_LIVE2D
                    {
                        let app_state: State<AppState> = window.state();
                        let mut storage = app_state.storage.lock().unwrap();
                        storage.save();
                    }
                }
                tauri::WindowEvent::Moved(_) => {
                    if window.label() == WINDOW_LABEL_ANIMATION
                        || window.label() == WINDOW_LABEL_LIVE2D
                    {
                        // 发送窗口位置更新事件（发送动画区域顶部位置，与保存一致）
                        if let Ok(position) = window.outer_position() {
                            let scale_factor = window.scale_factor().unwrap_or(1.0);
                            let x = position.x as f64 / scale_factor;
                            let y = position.y as f64 / scale_factor;
                            // 动画区域顶部 Y = 窗口 Y + 气泡区域高度
                            let animation_area_y = y + BUBBLE_AREA_HEIGHT;
                            let _ = emit_from_tauri_window(&window, events::WINDOW_POSITION_CHANGED, (x, animation_area_y));
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
            get_build_mode,
            // 用户设置
            get_settings,
            get_usage_stats,
            update_settings,
            get_user_info,

            update_user_info,
            get_memos,
            set_memos,
            get_reminders,
            set_reminders,
            take_pending_reminder_alerts,
            get_current_mod_data,



            set_current_mod_data_value,
            record_click_event,
            // Mod 资源管理
            get_mod_details,
            get_mod_search_paths,
            get_available_mods,
            load_mod,
            unload_mod,
            get_current_mod,
            get_mod_path,
            path_exists,
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
            is_left_mouse_down,
            get_cursor_position,
            is_cursor_in_interact_area,
            open_path,
            inspect_mod_tbuddy,
            pick_mod_tbuddy,
            import_mod_from_path,
            import_mod_from_path_detailed,
            load_mod_from_path,
            import_mod,
            recreate_animation_window,
            // 环境信息
            get_datetime_info,
            get_location_info,
            refresh_location_info,
            get_season_info,
            get_time_period_info,
            get_weather_info,
            // 媒体/进程调试
            get_media_debug_info,
            get_process_debug_info,
            get_system_debug_info,
            get_media_status,

            open_storage_dir,
            open_dir,
            show_context_menu,
            get_tray_position,
            get_saved_window_position,
            reset_animation_window_position,
            // 登录检测
            start_login_detection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 获取指定 Mod 的详细信息 (不加载)
#[tauri::command]
fn get_mod_details(
    state: State<'_, AppState>,
    mod_id: String,
) -> Result<modules::resource::ModSummary, String> {
    let mut mgr = state.resource_manager.lock().unwrap();
    mgr.read_mod_from_disk(&mod_id).map(|info| info.to_summary())
}

/// 解析 .tbuddy(zip) 中的 manifest 信息
#[derive(Debug, serde::Serialize)]
struct ModTbuddyPreflight {
    pub id: String,
    pub version: String,
}

fn get_tbuddy_root_folder(archive: &mut zip::ZipArchive<std::fs::File>) -> Result<String, String> {
    use std::path::Component;

    let mut root: Option<String> = None;

    for i in 0..archive.len() {
        let file = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(enclosed) = file.enclosed_name() else {
            continue;
        };

        let Some(Component::Normal(first)) = enclosed.components().next() else {
            continue;
        };

        let first = first.to_string_lossy().into_owned();
        match root.as_ref() {
            None => root = Some(first),
            Some(existing) if existing == &first => {}
            Some(existing) => {
                return Err(format!(
                    "Invalid .tbuddy file (multiple root folders: '{}' and '{}')",
                    existing, first
                ));
            }
        }
    }

    root.ok_or_else(|| "Invalid .tbuddy file (missing root folder)".into())
}

fn read_tbuddy_manifest(
    archive: &mut zip::ZipArchive<std::fs::File>,
    root_folder: &str,
) -> Result<modules::resource::ModManifest, String> {
    use std::io::Read;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(enclosed) = file.enclosed_name() else {
            continue;
        };

        let Some(first) = enclosed.components().next() else {
            continue;
        };
        if first.as_os_str() != std::ffi::OsStr::new(root_folder) {
            continue;
        }

        if enclosed
            .file_name()
            .map(|n| n == std::ffi::OsStr::new("manifest.json"))
            .unwrap_or(false)
        {
            let mut buf = Vec::new();
            file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            let content = String::from_utf8(buf).map_err(|e| e.to_string())?;
            return serde_json::from_str::<modules::resource::ModManifest>(&content)
                .map_err(|e| format!("Failed to parse manifest: {}", e));
        }
    }

    Err("Invalid .tbuddy file (manifest.json not found)".into())
}

struct ImportedModDisk {
    pub id: String,
    pub extracted_dir: std::path::PathBuf,
}

fn extract_tbuddy_to_mods_dir(app: &tauri::AppHandle, tbuddy_path: &std::path::Path) -> Result<ImportedModDisk, String> {
    use std::fs;
    use std::io;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn sanitize_windows_folder_name(input: &str) -> String {
        // Windows 文件名非法字符：< > : " / \ | ? *
        let mut s: String = input
            .trim()
            .chars()
            .map(|c| if "<>:\"/\\|?*".contains(c) { '_' } else { c })
            .collect();

        // Windows 不允许尾随空格/点
        while s.ends_with(' ') || s.ends_with('.') {
            s.pop();
        }

        if s.is_empty() {
            s = "imported".into();
        }

        // Windows 保留设备名（不区分大小写）
        let upper = s.to_uppercase();
        let reserved = [
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
            "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        ];
        if reserved.contains(&upper.as_str()) {
            s = format!("_{}", s);
        }

        s
    }


    // 1) 目标 mods 目录
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config dir: {}", e))?;
    let mods_dir = config_dir.join("mods");
    if !mods_dir.exists() {
        fs::create_dir_all(&mods_dir)
            .map_err(|e| format!("Failed to create mods directory: {}", e))?;
    }

    // 2) 打开 zip
    let file = fs::File::open(tbuddy_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|_| "Invalid .tbuddy file (not a valid zip)".to_string())?;

    // 3) 根目录名（用于 strip_prefix） + manifest.id（用于落盘目录名） + 时间戳（毫秒）
    let root_folder = get_tbuddy_root_folder(&mut archive)?;
    let manifest = read_tbuddy_manifest(&mut archive, &root_folder)?;

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();

    // 用 manifest.id 作为目录基名更稳定，并对 Windows 非法字符做清理
    let base_name = sanitize_windows_folder_name(manifest.id.as_ref());
    let new_root = format!("{}_{}", base_name, ts);


    // 4) 解压（替换顶层目录名，避免冲突）
    let root_prefix = std::path::PathBuf::from(&root_folder);
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(enclosed) = file.enclosed_name().map(|p| p.to_path_buf()) else {
            continue;
        };

        // 只处理 root_folder 下的内容
        let rel = match enclosed.strip_prefix(&root_prefix) {
            Ok(r) => r,
            Err(_) => continue,
        };

        let outpath = if rel.as_os_str().is_empty() {
            mods_dir.join(&new_root)
        } else {
            mods_dir.join(&new_root).join(rel)
        };

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
            }
            let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
            io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = file.unix_mode() {
                fs::set_permissions(&outpath, fs::Permissions::from_mode(mode))
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    // 5) 返回 manifest.id 与实际落盘目录
    let extracted_dir = mods_dir.join(&new_root);

    Ok(ImportedModDisk {
        id: manifest.id.to_string(),
        extracted_dir,
    })

}

/// 预解析 Mod (.tbuddy 文件) 的 manifest（不落盘，用于前端冲突提示）
#[tauri::command]
fn inspect_mod_tbuddy(file_path: String) -> Result<ModTbuddyPreflight, String> {
    use std::fs;
    use std::path::PathBuf;

    let p = PathBuf::from(file_path);
    let file = fs::File::open(&p).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|_| "Invalid .tbuddy file (not a valid zip)".to_string())?;

    let root = get_tbuddy_root_folder(&mut archive)?;
    let manifest = read_tbuddy_manifest(&mut archive, &root)?;

    Ok(ModTbuddyPreflight {
        id: manifest.id.to_string(),
        version: manifest.version.to_string(),
    })
}

/// 选择并预解析 Mod (.tbuddy 文件) 的 manifest（不落盘）
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ModTbuddyPick {
    pub file_path: String,
    pub id: String,
    pub version: String,
}

#[tauri::command]
fn pick_mod_tbuddy(app: tauri::AppHandle) -> Result<ModTbuddyPick, String> {
    use std::fs;
    use tauri_plugin_dialog::DialogExt;

    let file_path = app
        .dialog()
        .file()
        .add_filter("TrayBuddy Mod", &["tbuddy"])
        .blocking_pick_file();

    let selected_path = match file_path {
        Some(path) => match path {
            tauri_plugin_dialog::FilePath::Path(p) => p,
            _ => return Err("Unsupported file path".into()),
        },
        None => return Err("Canceled".into()),
    };

    let file = fs::File::open(&selected_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|_| "Invalid .tbuddy file (not a valid zip)".to_string())?;

    let root = get_tbuddy_root_folder(&mut archive)?;
    let manifest = read_tbuddy_manifest(&mut archive, &root)?;

    Ok(ModTbuddyPick {
        file_path: selected_path.to_string_lossy().into_owned(),
        id: manifest.id.to_string(),
        version: manifest.version.to_string(),
    })
}


#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportModResult {
    pub id: String,
    pub extracted_path: String,
}

/// 从指定路径导入 Mod (.tbuddy 文件)
///
/// - 顶层目录会自动追加时间戳，避免文件夹重复
#[tauri::command]
async fn import_mod_from_path(
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
    file_path: String,
) -> Result<String, String> {
    use std::path::PathBuf;

    let tbuddy_path = PathBuf::from(file_path);
    let imported = extract_tbuddy_to_mods_dir(&app, &tbuddy_path)?;

    let _ = emit(&app, events::REFRESH_MODS, imported.id.as_str());

    Ok(imported.id)
}

/// 从指定路径导入 Mod (.tbuddy 文件)，并返回导入目录路径
#[tauri::command]
async fn import_mod_from_path_detailed(
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
    file_path: String,
) -> Result<ImportModResult, String> {
    use std::path::PathBuf;

    let tbuddy_path = PathBuf::from(file_path);
    let imported = extract_tbuddy_to_mods_dir(&app, &tbuddy_path)?;

    let _ = emit(&app, events::REFRESH_MODS, imported.id.as_str());

    Ok(ImportModResult {
        id: imported.id,
        extracted_path: imported.extracted_dir.to_string_lossy().into_owned(),
    })
}



/// 导入 Mod (.tbuddy 文件)
///
/// 兼容旧前端：仍由后端弹出文件选择框。
/// 新实现同样会在顶层目录追加时间戳。
#[tauri::command]
async fn import_mod(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let file_path = app
        .dialog()
        .file()
        .add_filter("TrayBuddy Mod", &["tbuddy"])
        .blocking_pick_file();

    let selected_path = match file_path {
        Some(path) => match path {
            tauri_plugin_dialog::FilePath::Path(p) => p,
            _ => return Err("Unsupported file path".into()),
        },
        None => return Err("Canceled".into()),
    };

    import_mod_from_path(app, state, selected_path.to_string_lossy().into_owned()).await
}


/// 获取系统观察器调试信息
#[tauri::command]
fn get_system_debug_info() -> Option<SystemDebugInfo> {
    modules::system_observer::get_cached_debug_info()
}

/// 获取媒体状态（是否正在播放）
///
/// 调用 media_observer 获取缓存的媒体状态。
#[tauri::command]
fn get_media_status() -> bool {
    use modules::media_observer::{get_cached_media_state, MediaPlaybackStatus};
    match get_cached_media_state() {
        Some(event) => event.status == MediaPlaybackStatus::Playing,
        None => false,
    }
}

/// 重新创建动画窗口
///
/// 用于在 Mod 加载或比例调整后刷新窗口资源
#[tauri::command]
async fn recreate_animation_window(app: tauri::AppHandle) -> Result<(), String> {
    // 1. 关闭现有窗口
    if let Some(window) = app.get_webview_window(WINDOW_LABEL_ANIMATION) {
        // 先移除关闭拦截事件，否则 close() 可能会因为 API 拦截而不生效
        // 注意：Tauri v2 中无法直接移除之前闭包注册的事件，但我们可以尝试销毁它
        let _ = window.destroy();

        // 给 Tauri 一点时间在主事件循环中彻底销毁窗口并释放 label
        // 如果立即创建，会报错 "already exists"
        tokio::time::sleep(std::time::Duration::from_millis(
            modules::constants::WINDOW_RESIZE_DELAY_MS + 200, // 增加一点缓冲时间
        ))
        .await;
    }


    // 2. 创建新窗口
    inner_create_animation_window(&app)
}

/// 重新创建 Live2D 窗口
///
/// 用于在 Mod 加载后刷新窗口资源
#[tauri::command]
async fn recreate_live2d_window(app: tauri::AppHandle) -> Result<(), String> {
    // 1. 关闭现有窗口
    if let Some(window) = app.get_webview_window(WINDOW_LABEL_LIVE2D) {
        let _ = window.destroy();

        // 给 Tauri 一点时间在主事件循环中彻底销毁窗口并释放 label
        tokio::time::sleep(std::time::Duration::from_millis(
            modules::constants::WINDOW_RESIZE_DELAY_MS + 200,
        ))
        .await;
    }

    // 2. 创建新窗口
    inner_create_live2d_window(&app)
}

/// 内部函数：创建动画窗口
fn inner_create_animation_window(app: &tauri::AppHandle) -> Result<(), String> {

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

    // 3. 构建并创建窗口
    // 检查是否已存在同名窗口，如果存在则直接返回（防抖或异常处理）
    if let Some(existing) = app.get_webview_window(WINDOW_LABEL_ANIMATION) {
        return Ok(());
    }

    let animation_window =
        WebviewWindowBuilder::new(app, WINDOW_LABEL_ANIMATION, WebviewUrl::App(WINDOW_LABEL_ANIMATION.into()))

            .title(get_i18n_text(app, "common.animationTitle"))
            .inner_size(window_width, window_height)
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .resizable(false)
            .shadow(false)
            .skip_taskbar(!streamer_mode)
            .build()

            .map_err(|e| e.to_string())?;

    // 为动画窗口应用当前 Mod 的图标（用于 Alt-Tab / 任务管理器等显示）
    apply_window_icon(app, &animation_window);


    // 性能优化：动画窗口拦截关闭事件，改为隐藏，以保持后台渲染进程常驻
    // 其他工具窗口则遵循“关闭即销毁”策略以节省内存
    let w_clone = animation_window.clone();
    animation_window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = w_clone.hide();
        }
    });

    // 4. 初始鼠标穿透

    if is_silence {
        let _ = animation_window.set_ignore_cursor_events(true);
    }

    // 5. 设置窗口位置
    if let (Some(x), Some(y)) = saved_position {
        let window_y = y - bubble_area_height;
        let _ = animation_window
            .set_position(tauri::Position::Logical(LogicalPosition::new(x, window_y)));
    } else if let Some(monitor) = animation_window.primary_monitor().ok().flatten() {
        let scale_factor = monitor.scale_factor();
        let screen_size = monitor.size();
        let screen_pos = monitor.position();
        const TASKBAR_HEIGHT: f64 = 48.0;

        let screen_w = screen_size.width as f64 / scale_factor;
        let screen_h = screen_size.height as f64 / scale_factor;

        let x = screen_pos.x as f64 + screen_w - window_width;
        let y = screen_pos.y as f64 + screen_h - window_height - TASKBAR_HEIGHT;

        let _ = animation_window.set_position(tauri::Position::Logical(LogicalPosition::new(x, y)));
    }

    Ok(())
}

/// 内部函数：创建 Live2D 窗口
fn inner_create_live2d_window(app: &tauri::AppHandle) -> Result<(), String> {
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

    // 2. 计算窗口尺寸（暂与动画窗口保持一致）
    let bubble_area_height = BUBBLE_AREA_HEIGHT;
    let bubble_area_width = BUBBLE_AREA_WIDTH;
    let animation_area_height = ANIMATION_AREA_HEIGHT * scale;
    let animation_area_width = ANIMATION_AREA_WIDTH * scale;
    let window_width = bubble_area_width.max(animation_area_width);
    let window_height = bubble_area_height + animation_area_height;

    // 3. 构建并创建窗口
    if let Some(_existing) = app.get_webview_window(WINDOW_LABEL_LIVE2D) {
        return Ok(());
    }

    let live2d_window =
        WebviewWindowBuilder::new(app, WINDOW_LABEL_LIVE2D, WebviewUrl::App(WINDOW_LABEL_LIVE2D.into()))
            .title(get_i18n_text(app, "common.live2dTitle"))
            .inner_size(window_width, window_height)
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .resizable(false)
            .shadow(false)
            .skip_taskbar(!streamer_mode)
            .build()
            .map_err(|e| e.to_string())?;

    // 应用当前 Mod 图标
    apply_window_icon(app, &live2d_window);

    // 关闭时隐藏窗口
    let w_clone = live2d_window.clone();
    live2d_window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = w_clone.hide();
        }
    });

    // 4. 初始鼠标穿透
    if is_silence {
        let _ = live2d_window.set_ignore_cursor_events(true);
    }

    // 5. 设置窗口位置
    if let (Some(x), Some(y)) = saved_position {
        let window_y = y - bubble_area_height;
        let _ = live2d_window
            .set_position(tauri::Position::Logical(LogicalPosition::new(x, window_y)));
    } else if let Some(monitor) = live2d_window.primary_monitor().ok().flatten() {
        let scale_factor = monitor.scale_factor();
        let screen_size = monitor.size();
        let screen_pos = monitor.position();
        const TASKBAR_HEIGHT: f64 = 48.0;

        let screen_w = screen_size.width as f64 / scale_factor;
        let screen_h = screen_size.height as f64 / scale_factor;

        let x = screen_pos.x as f64 + screen_w - window_width;
        let y = screen_pos.y as f64 + screen_h - window_height - TASKBAR_HEIGHT;

        let _ = live2d_window
            .set_position(tauri::Position::Logical(LogicalPosition::new(x, y)));
    }

    Ok(())
}

/// 打开存储目录（包含 storage.json 文件）
#[tauri::command]
fn open_storage_dir(app_handle: tauri::AppHandle) -> Result<(), String> {

    let storage_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;

    let dir_path = storage_dir.to_string_lossy().to_string();

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

    #[cfg(not(target_os = "windows"))]
    {
        opener::reveal(&dir_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// 打开指定目录
#[tauri::command]
fn open_dir(path: String) -> Result<(), String> {
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

    #[cfg(not(target_os = "windows"))]
    {
        opener::reveal(&dir_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ========================================================================= //
// 辅助函数
// ========================================================================= //

/// 启动媒体监听器（独立线程）
fn start_media_observer(app_handle: tauri::AppHandle, skip_delay: bool) {
    std::thread::spawn(move || {
        let mut observer = MediaObserver::new();
        let rx = observer.start(app_handle.clone(), skip_delay);

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
                        let _ = TriggerManager::trigger_event(EVENT_MUSIC_START, false, &rm, &mut sm);
                    }
                    MediaPlaybackStatus::Paused | MediaPlaybackStatus::Stopped | MediaPlaybackStatus::Unknown => {
                        let rm = app_state.resource_manager.lock().unwrap();
                        let mut sm = app_state.state_manager.lock().unwrap();
                        let _ = TriggerManager::trigger_event(EVENT_MUSIC_END, false, &rm, &mut sm);
                    }
                    _ => {}
                }
            }
        });
    });
}

/// 启动进程监测器（独立线程）
///
/// - 监听“新进程启动”
/// - 若进程名包含 `config/process_observer_keywords.json` 中的任意关键字，则触发一次 `work` 事件
fn start_process_observer(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut observer = ProcessObserver::new();
        let rx = observer.start(app_handle.clone());

        let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
        rt.block_on(async move {
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
                use crate::modules::constants::{STATE_LOCK_MAX_RETRIES, STATE_LOCK_WAIT_INTERVAL_MS};
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

                let rm = app_state.resource_manager.lock().unwrap();
                let mut sm = app_state.state_manager.lock().unwrap();
                let _ = TriggerManager::trigger_event(EVENT_WORK, false, &rm, &mut sm);


            }
        });
    });
}

/// 启动提醒调度器（独立线程）
fn start_reminder_scheduler(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        use chrono::Local;
        use std::time::Duration;

        loop {
            std::thread::sleep(Duration::from_secs(1));

            let now_ts = Local::now().timestamp();
            let mut due: Vec<ReminderAlertPayload> = Vec::new();
            let mut changed = false;

            {
                let app_state: State<AppState> = app_handle.state();
                let mut storage = app_state.storage.lock().unwrap();

                for r in storage.data.info.reminders.iter_mut() {
                    if !r.enabled {
                        continue;
                    }

                    if r.next_trigger_at == 0 {
                        // 兜底：如果前端/历史数据没填 next_trigger_at，后端自动归一化
                        let normalized = normalize_reminder(r.clone(), now_ts);
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
                                    compute_next_weekly_trigger_at(now_ts, days, *hour, *minute);
                            }
                            ReminderSchedule::Absolute { .. } | ReminderSchedule::After { .. } => {
                                // 一次性提醒触发后自动关闭
                                r.enabled = false;
                            }
                        }

                        changed = true;
                    }
                }

                if changed {
                    let _ = storage.save();
                }
            }

            if due.is_empty() {
                continue;
            }

            // 写入待展示队列（提示窗口启动时可读取）
            if let Ok(mut guard) = PENDING_REMINDER_ALERTS.lock() {
                guard.extend(due.clone());
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

            // 推送更新事件（窗口已存在时可实时追加）
            let _ = emit(&app_handle, "reminder-alert-update", &due);
        }
    });
}


/// 保存动画窗口位置
///
/// 注意：保存的 y 是动画区域顶部的位置（窗口 y + 气泡区域高度），
/// 这样当气泡区域高度变化时，动画区域位置保持不变
fn save_animation_window_position(window: &tauri::Window) {
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

    // 获取 animation 窗口
    let animation_window = app.get_webview_window(WINDOW_LABEL_ANIMATION);

    if let Some(anim_win) = animation_window {
        if let Ok(position) = anim_win.outer_position() {
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
///
/// 使用缓存版本，避免每次调用都重新读取和解析 JSON 文件
fn get_i18n_text(app: &tauri::AppHandle, key: &str) -> String {
    let app_state: State<AppState> = app.state();
    let lang = {
        let storage = app_state.storage.lock().unwrap();
        storage.data.settings.lang.clone()
    };
    get_i18n_text_cached(app, &lang, key)
}

/// 内部函数：获取当前 Mod 的图标或默认图标
///
/// 优化：减少锁的获取次数，避免重复的图标路径解析逻辑
fn get_app_icon(app: &tauri::AppHandle) -> Option<Image<'_>> {
    if let Some(state) = app.try_state::<AppState>() {
        let rm = state.resource_manager.lock().unwrap();

        if let Some(current_mod) = &rm.current_mod {
            if let Some(icon_path) = &current_mod.icon_path {
                let full_icon_path = current_mod.path.join(icon_path.as_ref());
                if full_icon_path.exists() {
                    if let Ok(mod_icon) = Image::from_path(&full_icon_path) {
                        return Some(mod_icon);
                    }
                }
            }
        }
    }

    // 使用默认图标
    app.default_window_icon().cloned()
}

/// 内部函数：根据当前加载的Mod更新托盘图标（异步版本）
///
/// 优化：使用事件驱动，将阻塞操作放到后台线程，避免卡死主线程
async fn update_tray_icon_async(app: tauri::AppHandle) {
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
async fn update_window_icons_async(app: tauri::AppHandle) {
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

/// 内部函数：根据当前加载的Mod更新托盘图标（同步版本，用于非异步上下文）
///
/// 用途：在同步上下文中更新托盘图标（如卸载 mod 时）
fn update_tray_icon_sync(app: &tauri::AppHandle) {
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
fn restore_window_icons_sync(app: &tauri::AppHandle) {
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
fn inner_build_tray_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
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

/// 弹出上下文菜单命令 (供前端右键调用)
#[tauri::command]
fn show_context_menu(app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    let menu = inner_build_tray_menu(&app).map_err(|e| e.to_string())?;
    window.popup_menu(&menu).map_err(|e| e.to_string())?;
    Ok(())
}

/// 统一渲染/托盘菜单事件处理
fn handle_menu_event(app: &tauri::AppHandle, id: &str) {
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
                for label in [WINDOW_LABEL_ANIMATION, WINDOW_LABEL_LIVE2D] {
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

/// 获取系统托盘位置（用于隐藏模式下的吸附）
#[tauri::command]
fn get_tray_position(app: tauri::AppHandle) -> (f64, f64) {
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
    // 最终降级方案
    (1700.0, 1030.0)
}

/// 记录用户点击事件
///
/// 前端在每次用户触发点击事件时调用此命令，用于统计用户交互行为
#[tauri::command]
fn record_click_event(state: State<'_, AppState>) {
    let mut storage = state.storage.lock().unwrap();
    storage.data.info.total_click_count += 1;
    let _ = storage.save();
}

/// 获取保存的窗口位置
#[tauri::command]
fn get_saved_window_position(state: State<'_, AppState>) -> (Option<f64>, Option<f64>) {
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
fn reset_animation_window_position(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // 1. 获取动画窗口
    let window = app.get_webview_window(WINDOW_LABEL_ANIMATION)
        .ok_or_else(|| "Animation window not found".to_string())?;

    // 2. 获取当前的缩放比例
    let (scale, window_width, window_height) = {
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
        Err("Failed to get primary monitor".to_string())
    }
}

/// 启动登录检测（由前端调用）
///
/// 启动异步线程检测用户是否已登录到桌面，检测到后自动触发相应事件
/// 特殊日期判断（生日、首登录纪念日）和login触发都在session_observer回调内处理
#[tauri::command]
fn start_login_detection(app: tauri::AppHandle) -> Result<(), String> {
    use std::sync::atomic::Ordering;

    // 检查是否已经启动过，防止重复启动导致资源泄漏
    if SESSION_OBSERVER_STARTED.swap(true, Ordering::SeqCst) {
        // 已启动，直接返回
        return Ok(());
    }

    // 启动桌面会话检测（所有触发逻辑都在检测回调内）
    start_session_observer(app);

    Ok(())
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
fn determine_event_type(
    birthday: Option<&Box<str>>,
    first_login_timestamp: Option<i64>,
    is_silence_mode: bool,
) -> &'static str {
    use chrono::Datelike;

    let dt = get_current_datetime();

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

/// 非Windows平台的占位实现
#[cfg(not(target_os = "windows"))]
fn is_user_logged_in_desktop() -> bool {
    // 非Windows平台默认返回true，表示已登录
    true
}

/// 启动桌面会话监听器（使用 WTS 事件驱动）
#[cfg(target_os = "windows")]
fn start_session_observer(app_handle: tauri::AppHandle) {
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

    std::thread::spawn(move || {
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

/// 启动后台服务（避免死锁）
#[cfg(target_os = "windows")]
fn start_background_services(app_handle: &tauri::AppHandle) {
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

    // 启动进程监测器（独立线程，无锁）
    start_process_observer(app_handle.clone());

    // 启动定时提醒调度器（独立线程，无锁）
    start_reminder_scheduler(app_handle.clone());

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

/// 触发登录相关事件
#[cfg(target_os = "windows")]
fn trigger_login_events(app_handle: &tauri::AppHandle) {
    println!("[SessionObserver] 准备触发登录事件");

    // 获取 AppState 引用
    let app_state = app_handle.state::<AppState>();

    // 一次性获取所有需要的设置信息，避免重复获取锁
    // 内存优化：只克隆 birthday 的 Box<str>，而不是整个 settings
    // 同时判断是否存在有效备忘录（无备忘录则不弹窗）
    let (birthday_opt, first_login_timestamp, is_silence_mode, has_any_memo) = {
        let storage = app_state.storage.lock().unwrap();
        let has_any_memo = storage
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

    // 触发事件（获取资源管理器和状态管理器锁）
    println!("[SessionObserver] 触发事件: {}", event_name);

    let rm = app_state.resource_manager.lock().unwrap();
    let mut sm = app_state.state_manager.lock().unwrap();

    match TriggerManager::trigger_event(&event_name, false, &rm, &mut sm) {
        Ok(true) => println!("[SessionObserver] {}事件触发成功", event_name),
        Ok(false) => println!("[SessionObserver] {}事件未触发（无对应状态）", event_name),
        Err(e) => eprintln!("[SessionObserver] {}事件触发失败: {}", event_name, e),
    }

    // 释放锁
    drop(rm);
    drop(sm);

    // 结束锁屏后，触发 login 时弹出备忘录窗口
    // 若用户没有任何备忘录，则不弹出
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


/// 非Windows平台的占位实现
#[cfg(not(target_os = "windows"))]
fn start_session_observer(app_handle: tauri::AppHandle) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::thread;

    // 非Windows平台使用简化的轮询方式
    let login_triggered = Arc::new(AtomicBool::new(false));

    thread::spawn(move || {
        println!("[SessionObserver] 非Windows平台启动简化的会话检测线程");

        // 只需要触发一次，触发后退出循环
        loop {
            std::thread::sleep(std::time::Duration::from_secs(
                modules::constants::SESSION_OBSERVER_POLL_INTERVAL_SECS,
            ));

            // 启动后台服务
            start_background_services_non_windows(&app_handle);

            // 检查并触发登录事件
            if login_triggered.compare_exchange(
                false,
                true,
                Ordering::SeqCst,
                Ordering::Relaxed,
            ).is_ok() {
                println!("[SessionObserver] 非Windows平台模拟登录事件");
                trigger_login_events_non_windows(&app_handle);
                break; // 触发后退出循环
            }
        }
    });
}

/// 非Windows平台启动后台服务
#[cfg(not(target_os = "windows"))]
fn start_background_services_non_windows(app_handle: &tauri::AppHandle) {
    use std::sync::atomic::Ordering;

    // 检查是否已经启动过，防止重复启动导致资源泄漏
    if BACKGROUND_SERVICES_STARTED.swap(true, Ordering::SeqCst) {
        println!("[SessionObserver] 后台服务已启动，跳过重复启动（非Windows平台）");
        return;
    }

    println!("[SessionObserver] 启动后台服务（非Windows平台）");

    let app_state = app_handle.state::<AppState>();

    // 获取免打扰模式设置（短暂持有锁）
    let is_silence_mode = {
        let storage = app_state.storage.lock().unwrap();
        storage.data.settings.silence_mode
    };

    // 启动媒体监听器
    start_media_observer(app_handle.clone(), is_silence_mode);

    // 启动定时提醒调度器（独立线程，无锁）
    start_reminder_scheduler(app_handle.clone());

    // 启动系统状态观察器（独立线程，无锁）

    {
        let observer = SystemObserver::new();
        observer.start(app_handle.clone());
    }

    // 启动定时触发器
    {
        let mut sm = app_state.state_manager.lock().unwrap();
        sm.start_timer_loop(app_handle.clone());
    }
}

/// 非Windows平台的登录事件触发（简化版本）
#[cfg(not(target_os = "windows"))]
fn trigger_login_events_non_windows(app_handle: &tauri::AppHandle) {
    let app_state = app_handle.state::<AppState>();

    // 内存优化：只克隆 birthday 的 Box<str>，而不是整个 settings
    let (birthday_opt, first_login_timestamp, is_silence_mode) = {
        let storage = app_state.storage.lock().unwrap();
        (
            storage.data.settings.birthday.clone(),
            storage.data.info.first_login,
            storage.data.settings.silence_mode,
        )
    };

    // 使用统一的日期判定函数确定事件类型
    let event_name = determine_event_type(birthday_opt.as_ref(), first_login_timestamp, is_silence_mode);

    println!("[SessionObserver] 触发事件: {}", event_name);

    let rm = app_state.resource_manager.lock().unwrap();
    let mut sm = app_state.state_manager.lock().unwrap();

    match TriggerManager::trigger_event(&event_name, false, &rm, &mut sm) {
        Ok(true) => println!("[SessionObserver] {}事件触发成功", event_name),
        Ok(false) => println!("[SessionObserver] {}事件未触发（无对应状态）", event_name),
        Err(e) => eprintln!("[SessionObserver] {}事件触发失败: {}", event_name, e),
    }

    // 释放锁
    drop(rm);
    drop(sm);
}
