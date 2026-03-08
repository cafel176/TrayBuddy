//! AI 工具运行时管理模块
//!
//! 管理与 AI 工具相关的运行时状态：
//! - 缓存焦点窗口匹配到的 ai_tools 进程名
//! - 为每个启用的工具维护一个独立的后台任务（按配置间隔截图）
//! - 提供工具开关控制接口

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tokio::sync::Notify;
use tokio::task::JoinHandle;

use super::screenshot;

// ========================================================================= //
// 全局缓存
// ========================================================================= //

/// 当前焦点窗口匹配到的 ai_tools 进程名（不区分大小写匹配后的原始 process_name）。
/// 当焦点窗口不匹配任何 ai_tools 配置时为 None。
static MATCHED_AI_TOOL_PROCESS: Mutex<Option<String>> = Mutex::new(None);

/// 工具运行时状态：工具名 -> 是否启用
static TOOL_ENABLED_MAP: Mutex<Option<HashMap<String, bool>>> = Mutex::new(None);

/// 工具后台任务句柄：工具名 -> JoinHandle
/// 注意：JoinHandle 不是 Send+Sync，用 tokio Mutex 包装
static TOOL_TASKS: std::sync::OnceLock<tokio::sync::Mutex<HashMap<String, JoinHandle<()>>>> =
    std::sync::OnceLock::new();

fn get_task_map() -> &'static tokio::sync::Mutex<HashMap<String, JoinHandle<()>>> {
    TOOL_TASKS.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()))
}

/// 工具任务配置缓存：工具名 -> 配置
/// 在 initialize_tools 时填充，供 start_tool_task 读取
static TOOL_CONFIGS: Mutex<Option<HashMap<String, AiToolTaskConfig>>> = Mutex::new(None);

/// 截图保留模式：true=每张截图带时间戳后缀全部保留，false=同名覆盖
static KEEP_SCREENSHOTS: AtomicBool = AtomicBool::new(false);

/// 信息窗口可见状态：工具名 -> 是否可见
static INFO_WINDOW_VISIBLE: Mutex<Option<HashMap<String, bool>>> = Mutex::new(None);

/// 手动截图通知：当用户按下热键时，notify_waiters() 唤醒所有 manual 类型任务
static MANUAL_CAPTURE_NOTIFY: std::sync::OnceLock<Notify> = std::sync::OnceLock::new();

fn get_manual_notify() -> &'static Notify {
    MANUAL_CAPTURE_NOTIFY.get_or_init(Notify::new)
}

// ========================================================================= //
// 工具类型
// ========================================================================= //

/// 工具截图触发类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolType {
    /// 自动定时截图
    Auto,
    /// 手动热键触发截图
    Manual,
}

impl Default for ToolType {
    fn default() -> Self {
        ToolType::Manual
    }
}

// ========================================================================= //
// 工具任务配置
// ========================================================================= //

/// 单个工具的任务配置（截图所需信息）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiToolTaskConfig {
    /// 匹配到的进程名（用于截图文件名前缀）
    pub process_name: String,
    /// 工具类型：auto 或 manual
    pub tool_type: ToolType,
    /// 截取矩形区域
    pub capture_x: i32,
    pub capture_y: i32,
    pub capture_width: u32,
    pub capture_height: u32,
    /// 是否需要信息窗口
    pub show_info_window: bool,
}

// ========================================================================= //
// 调试信息
// ========================================================================= //

/// AI 工具管理器的调试快照
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiToolDebugInfo {
    /// 当前匹配到的进程名
    pub matched_process: Option<String>,
    /// 各工具的运行时状态
    pub tools: Vec<AiToolDebugItem>,
    /// 活跃任务数
    pub active_task_count: usize,
    /// 最后更新时间
    pub last_update_time: String,
    /// 截图保留模式
    pub keep_screenshots: bool,
}

/// 单个工具的调试状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiToolDebugItem {
    /// 工具名
    pub name: String,
    /// 工具类型
    pub tool_type: ToolType,
    /// 是否启用
    pub enabled: bool,
    /// 是否有正在运行的后台任务
    pub has_task: bool,
    /// 后台任务的 tokio task ID（若有运行中的任务）
    pub task_id: Option<String>,
    /// 是否配置了信息窗口
    pub show_info_window: bool,
    /// 信息窗口当前是否可见
    pub info_window_visible: bool,
}

/// 缓存的调试信息
static CACHED_DEBUG_INFO: Mutex<Option<AiToolDebugInfo>> = Mutex::new(None);

/// 获取缓存的调试信息（供 Tauri Command 首次拉取）
pub fn get_cached_debug_info() -> Option<AiToolDebugInfo> {
    CACHED_DEBUG_INFO
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

/// 更新缓存的调试信息
fn update_cached_debug_info(info: AiToolDebugInfo) {
    if let Ok(mut guard) = CACHED_DEBUG_INFO.lock() {
        *guard = Some(info);
    }
}

/// 生成当前调试快照并更新缓存，返回快照
pub async fn snapshot_debug_info() -> AiToolDebugInfo {
    let matched_process = get_matched_ai_tool_process();
    let enabled_map = get_tool_enabled_map();

    let tasks = get_task_map().lock().await;

    let tools: Vec<AiToolDebugItem> = if let Some(ref map) = enabled_map {
        let configs = TOOL_CONFIGS.lock().ok();
        let info_visible = INFO_WINDOW_VISIBLE.lock().ok();
        map.iter()
            .map(|(name, enabled)| {
                let task_id = tasks
                    .get(name)
                    .map(|handle| format!("{}", handle.id()));
                let tool_type = configs
                    .as_ref()
                    .and_then(|g| g.as_ref()?.get(name).map(|c| c.tool_type))
                    .unwrap_or_default();
                let show_info_window = configs
                    .as_ref()
                    .and_then(|g| g.as_ref()?.get(name).map(|c| c.show_info_window))
                    .unwrap_or(false);
                let info_window_visible = info_visible
                    .as_ref()
                    .and_then(|g| g.as_ref()?.get(name).copied())
                    .unwrap_or(false);
                AiToolDebugItem {
                    name: name.clone(),
                    tool_type,
                    enabled: *enabled,
                    has_task: tasks.contains_key(name),
                    task_id,
                    show_info_window,
                    info_window_visible,
                }
            })
            .collect()
    } else {
        vec![]
    };

    let active_task_count = tasks.len();
    drop(tasks);

    let info = AiToolDebugInfo {
        matched_process,
        tools,
        active_task_count,
        last_update_time: chrono::Local::now().format("%H:%M:%S").to_string(),
        keep_screenshots: KEEP_SCREENSHOTS.load(Ordering::Relaxed),
    };

    update_cached_debug_info(info.clone());
    info
}

/// 生成调试快照并通过事件推送到前端
pub async fn emit_debug_snapshot(app: &tauri::AppHandle) {
    let info = snapshot_debug_info().await;
    let _ = super::event_manager::emit_debug_update(
        app,
        super::event_manager::DEBUG_EVENT_TYPE_AI_TOOL,
        &info,
    );
}

// ========================================================================= //
// 公共接口 — 截图保留模式
// ========================================================================= //

/// 获取截图保留模式
pub fn get_keep_screenshots() -> bool {
    KEEP_SCREENSHOTS.load(Ordering::Relaxed)
}

/// 设置截图保留模式
pub fn set_keep_screenshots(keep: bool) {
    KEEP_SCREENSHOTS.store(keep, Ordering::Relaxed);
}

// ========================================================================= //
// 公共接口 — 进程匹配
// ========================================================================= //

/// 获取当前匹配到的 AI 工具进程名
pub fn get_matched_ai_tool_process() -> Option<String> {
    MATCHED_AI_TOOL_PROCESS
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

/// 更新当前匹配到的 AI 工具进程名
pub fn set_matched_ai_tool_process(name: Option<String>) {
    if let Ok(mut guard) = MATCHED_AI_TOOL_PROCESS.lock() {
        *guard = name;
    }
}

// ========================================================================= //
// 公共接口 — 工具启用状态
// ========================================================================= //

/// 获取当前所有工具的启用状态（工具名 -> 是否启用）
pub fn get_tool_enabled_map() -> Option<HashMap<String, bool>> {
    TOOL_ENABLED_MAP
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

/// 设置工具启用状态表
pub fn set_tool_enabled_map(map: Option<HashMap<String, bool>>) {
    if let Ok(mut guard) = TOOL_ENABLED_MAP.lock() {
        *guard = map;
    }
}

/// 设置单个工具的启用状态，返回是否变更成功
pub fn set_tool_enabled(name: &str, enabled: bool) -> bool {
    if let Ok(mut guard) = TOOL_ENABLED_MAP.lock() {
        if let Some(ref mut map) = *guard {
            if let Some(val) = map.get_mut(name) {
                *val = enabled;
                return true;
            }
        }
    }
    false
}

/// 获取单个工具的启用状态
pub fn is_tool_enabled(name: &str) -> bool {
    TOOL_ENABLED_MAP
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref()?.get(name).copied())
        .unwrap_or(false)
}

/// 构建用于前端事件推送的完整工具列表（含 type、show_info_window 等完整信息）。
/// 供 toggle_ai_tool / toggle_ai_tool_info_window 命令发送事件使用。
pub fn build_tool_items_for_event() -> Option<(Option<String>, Vec<serde_json::Value>)> {
    let enabled_map = get_tool_enabled_map()?;
    let process_name = get_matched_ai_tool_process();
    let configs = TOOL_CONFIGS.lock().ok();
    let info_visible = INFO_WINDOW_VISIBLE.lock().ok();

    let items: Vec<serde_json::Value> = enabled_map
        .iter()
        .map(|(name, enabled)| {
            let (tool_type_str, show_info) = configs
                .as_ref()
                .and_then(|g| {
                    let cfg = g.as_ref()?.get(name)?;
                    let t = match cfg.tool_type {
                        ToolType::Auto => "auto",
                        ToolType::Manual => "manual",
                    };
                    Some((t, cfg.show_info_window))
                })
                .unwrap_or(("manual", false));

            let info_visible_val = info_visible
                .as_ref()
                .and_then(|g| g.as_ref()?.get(name).copied())
                .unwrap_or(false);

            serde_json::json!({
                "name": name,
                "type": tool_type_str,
                "enabled": enabled,
                "show_info_window": show_info,
                "info_window_visible": info_visible_val,
            })
        })
        .collect();

    Some((process_name, items))
}

// ========================================================================= //
// 公共接口 — 工具配置
// ========================================================================= //

/// 获取指定工具的任务配置
fn get_tool_config(name: &str) -> Option<AiToolTaskConfig> {
    TOOL_CONFIGS
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref()?.get(name).cloned())
}

// ========================================================================= //
// 公共接口 — 手动截图触发
// ========================================================================= //

/// 通知所有 manual 类型的活跃任务执行一次截图。
/// 由全局键盘钩子在检测到热键按下时调用。
pub fn notify_manual_capture() {
    get_manual_notify().notify_waiters();
    #[cfg(debug_assertions)]
    println!("[AiToolManager] Manual capture triggered by hotkey");
}

// ========================================================================= //
// 公共接口 — 信息窗口管理
// ========================================================================= //

/// AI 工具信息窗口的标签前缀
const AI_TOOL_INFO_WINDOW_PREFIX: &str = "ai_tool_info_";

/// 生成信息窗口标签：`ai_tool_info_{tool_name}`
pub fn info_window_label(tool_name: &str) -> String {
    format!("{}{}", AI_TOOL_INFO_WINDOW_PREFIX, tool_name)
}

/// 获取信息窗口可见状态
pub fn is_info_window_visible(tool_name: &str) -> bool {
    INFO_WINDOW_VISIBLE
        .lock()
        .ok()
        .and_then(|g| g.as_ref()?.get(tool_name).copied())
        .unwrap_or(false)
}

/// 设置信息窗口可见状态
fn set_info_window_visible(tool_name: &str, visible: bool) {
    if let Ok(mut guard) = INFO_WINDOW_VISIBLE.lock() {
        if let Some(ref mut map) = *guard {
            if let Some(val) = map.get_mut(tool_name) {
                *val = visible;
            }
        }
    }
}

/// 创建 AI 工具信息窗口
pub fn create_info_window(app: &tauri::AppHandle, tool_name: &str) {
    use tauri::Manager;
    use tauri::WebviewWindowBuilder;
    use tauri::WebviewUrl;

    let label = info_window_label(tool_name);

    // 已存在则显示
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.set_focus();
        set_info_window_visible(tool_name, true);
        return;
    }

    let title = format!("AI Tool Info - {}", tool_name);
    let url = format!("ai_tool_info?tool={}", tool_name);

    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title(&title)
        .inner_size(420.0, 320.0)
        .resizable(true)
        .center();

    if let Ok(window) = builder.build() {
        crate::lib_helpers::apply_window_icon(app, &window);
        set_info_window_visible(tool_name, true);

        #[cfg(debug_assertions)]
        println!("[AiToolManager] Info window created for tool: {}", tool_name);
    }
}

/// 销毁 AI 工具信息窗口
pub fn destroy_info_window(app: &tauri::AppHandle, tool_name: &str) {
    use tauri::Manager;

    let label = info_window_label(tool_name);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.destroy();
    }
    set_info_window_visible(tool_name, false);

    #[cfg(debug_assertions)]
    println!("[AiToolManager] Info window destroyed for tool: {}", tool_name);
}

/// 切换信息窗口显示/隐藏
pub fn toggle_info_window(app: &tauri::AppHandle, tool_name: &str, visible: bool) {
    use tauri::Manager;

    let label = info_window_label(tool_name);
    if visible {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.show();
            let _ = window.set_focus();
        } else {
            create_info_window(app, tool_name);
        }
    } else if let Some(window) = app.get_webview_window(&label) {
        let _ = window.hide();
    }
    set_info_window_visible(tool_name, visible);
}

/// 销毁所有 AI 工具信息窗口
fn destroy_all_info_windows(app: &tauri::AppHandle) {
    use tauri::Manager;

    if let Ok(guard) = INFO_WINDOW_VISIBLE.lock() {
        if let Some(ref map) = *guard {
            for name in map.keys() {
                let label = info_window_label(name);
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = window.destroy();
                }
            }
        }
    }
}

// ========================================================================= //
// 公共接口 — 任务管理
// ========================================================================= //

/// 执行一次截图并保存
async fn do_capture(
    cfg: &AiToolTaskConfig,
    file_prefix: &str,
    screenshots_dir: &std::path::Path,
    tool_name: &str,
) {
    if cfg.capture_width == 0 || cfg.capture_height == 0 {
        return;
    }

    let keep = KEEP_SCREENSHOTS.load(Ordering::Relaxed);
    let filename = if keep {
        let ts = chrono::Local::now().format("%Y%m%d_%H%M%S_%3f");
        format!("{}_{}.bmp", file_prefix, ts)
    } else {
        format!("{}.bmp", file_prefix)
    };

    let save_path = screenshots_dir.join(&filename);

    let x = cfg.capture_x;
    let y = cfg.capture_y;
    let w = cfg.capture_width;
    let h = cfg.capture_height;
    let path = save_path.clone();

    let result =
        tokio::task::spawn_blocking(move || screenshot::capture_screen_region(x, y, w, h, &path))
            .await;

    match result {
        Ok(Ok(())) => {
            #[cfg(debug_assertions)]
            println!(
                "[AiToolManager] Screenshot saved: {}",
                save_path.display()
            );
        }
        Ok(Err(e)) => {
            #[cfg(debug_assertions)]
            println!(
                "[AiToolManager] Screenshot failed for {}: {}",
                tool_name, e
            );
        }
        Err(e) => {
            #[cfg(debug_assertions)]
            println!(
                "[AiToolManager] Screenshot task join error for {}: {}",
                tool_name, e
            );
        }
    }
}

/// 为指定工具启动一个后台任务。
/// - `auto` 类型：按 ai_screenshot_interval 间隔自动截图
/// - `manual` 类型：等待热键触发（MANUAL_CAPTURE_NOTIFY）后截图一次
/// - 若工具配置了 show_info_window，启动时自动创建信息窗口
pub async fn start_tool_task(tool_name: String, app: tauri::AppHandle) {
    let mut tasks = get_task_map().lock().await;

    // 如果已存在任务，先终止
    if let Some(handle) = tasks.remove(&tool_name) {
        handle.abort();
    }

    let config = get_tool_config(&tool_name);

    // 若配置了 show_info_window，创建信息窗口
    if let Some(ref cfg) = config {
        if cfg.show_info_window {
            create_info_window(&app, &tool_name);
        }
    }

    let name_clone = tool_name.clone();

    let handle = tokio::spawn(async move {
        #[cfg(debug_assertions)]
        println!("[AiToolManager] Task started for tool: {}", name_clone);

        let Some(cfg) = config else {
            #[cfg(debug_assertions)]
            println!(
                "[AiToolManager] No config for tool: {}, task idle",
                name_clone
            );
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
            }
        };

        // 确定截图保存目录
        let screenshots_dir = {
            use tauri::Manager;
            let base_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let dir = base_dir.join("ai_screenshots");
            if !dir.exists() {
                let _ = std::fs::create_dir_all(&dir);
            }
            dir
        };

        let file_prefix = format!("{}_{}", cfg.process_name, name_clone);

        match cfg.tool_type {
            ToolType::Auto => {
                // 自动模式：按间隔不断截图
                loop {
                    let interval_secs = {
                        use tauri::Manager;
                        let app_state: tauri::State<crate::app_state::AppState> = app.state();
                        let storage = app_state.storage.lock().unwrap();
                        storage.data.settings.ai_screenshot_interval.max(0.1) as f64
                    };

                    do_capture(&cfg, &file_prefix, &screenshots_dir, &name_clone).await;

                    tokio::time::sleep(std::time::Duration::from_secs_f64(interval_secs)).await;
                }
            }
            ToolType::Manual => {
                // 手动模式：等待热键触发信号后截图一次
                let notify = get_manual_notify();
                loop {
                    notify.notified().await;

                    #[cfg(debug_assertions)]
                    println!(
                        "[AiToolManager] Manual capture signal received for: {}",
                        name_clone
                    );

                    do_capture(&cfg, &file_prefix, &screenshots_dir, &name_clone).await;
                }
            }
        }
    });

    tasks.insert(tool_name, handle);
}

/// 停止指定工具的后台任务并销毁对应信息窗口
pub async fn stop_tool_task(tool_name: &str, app: &tauri::AppHandle) {
    let mut tasks = get_task_map().lock().await;
    if let Some(handle) = tasks.remove(tool_name) {
        handle.abort();
        #[cfg(debug_assertions)]
        println!("[AiToolManager] Task stopped for tool: {}", tool_name);
    }

    // 销毁信息窗口（如果有）
    destroy_info_window(app, tool_name);
}

/// 停止所有工具的后台任务、销毁所有信息窗口并清空状态
pub async fn clear_all(app: &tauri::AppHandle) {
    // 清空任务
    {
        let mut tasks = get_task_map().lock().await;
        for (name, handle) in tasks.drain() {
            handle.abort();
            #[cfg(debug_assertions)]
            println!("[AiToolManager] Task aborted for tool: {}", name);
        }
    }

    // 销毁所有信息窗口
    destroy_all_info_windows(app);

    // 清空信息窗口可见状态
    if let Ok(mut guard) = INFO_WINDOW_VISIBLE.lock() {
        *guard = None;
    }

    // 清空启用状态
    set_tool_enabled_map(None);

    // 清空匹配进程
    set_matched_ai_tool_process(None);

    // 清空工具配置
    if let Ok(mut guard) = TOOL_CONFIGS.lock() {
        *guard = None;
    }

    #[cfg(debug_assertions)]
    println!("[AiToolManager] All data cleared");
}

/// 工具初始化信息：工具名、是否自启动、工具类型、任务配置
pub struct ToolInitInfo {
    pub name: String,
    pub auto_start: bool,
    pub config: AiToolTaskConfig,
}

/// 根据 tool_data 初始化工具列表：设置启用状态并为 auto_start 工具启动任务
pub async fn initialize_tools(tools: &[ToolInitInfo], app: &tauri::AppHandle) {
    // 先清除旧状态
    clear_all(app).await;

    // 构建启用映射、配置映射和信息窗口可见映射
    let mut enabled_map = HashMap::new();
    let mut config_map = HashMap::new();
    let mut info_visible_map = HashMap::new();
    for info in tools {
        enabled_map.insert(info.name.clone(), info.auto_start);
        config_map.insert(info.name.clone(), info.config.clone());
        // 初始可见状态：auto_start 且有 show_info_window 的默认可见
        info_visible_map.insert(
            info.name.clone(),
            info.auto_start && info.config.show_info_window,
        );
    }
    set_tool_enabled_map(Some(enabled_map));
    if let Ok(mut guard) = TOOL_CONFIGS.lock() {
        *guard = Some(config_map);
    }
    if let Ok(mut guard) = INFO_WINDOW_VISIBLE.lock() {
        *guard = Some(info_visible_map);
    }

    // 为 auto_start 的工具启动任务
    for info in tools {
        if info.auto_start {
            start_tool_task(info.name.clone(), app.clone()).await;
        }
    }
}

/// 切换单个工具的启用状态，返回切换后的状态
pub async fn toggle_tool(tool_name: &str, enabled: bool, app: &tauri::AppHandle) -> bool {
    let changed = set_tool_enabled(tool_name, enabled);
    if !changed {
        return enabled;
    }

    if enabled {
        start_tool_task(tool_name.to_string(), app.clone()).await;
    } else {
        stop_tool_task(tool_name, app).await;
    }

    enabled
}

// ========================================================================= //
// 测试
// ========================================================================= //

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matched_process_defaults_to_none() {
        let _ = get_matched_ai_tool_process();
    }

    #[test]
    fn set_and_get_matched_process() {
        set_matched_ai_tool_process(Some("chrome.exe".to_string()));
        let val = get_matched_ai_tool_process();
        assert_eq!(val, Some("chrome.exe".to_string()));

        set_matched_ai_tool_process(None);
        let val = get_matched_ai_tool_process();
        assert_eq!(val, None);
    }

    #[test]
    fn tool_enabled_map_operations() {
        let mut map = HashMap::new();
        map.insert("kill".to_string(), true);
        map.insert("test".to_string(), false);
        set_tool_enabled_map(Some(map));

        assert!(is_tool_enabled("kill"));
        assert!(!is_tool_enabled("test"));

        set_tool_enabled("test", true);
        assert!(is_tool_enabled("test"));

        set_tool_enabled_map(None);
        assert!(!is_tool_enabled("kill"));
    }

    #[test]
    fn keep_screenshots_toggle() {
        set_keep_screenshots(false);
        assert!(!get_keep_screenshots());
        set_keep_screenshots(true);
        assert!(get_keep_screenshots());
        set_keep_screenshots(false);
    }
}
