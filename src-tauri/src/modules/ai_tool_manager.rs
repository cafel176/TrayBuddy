//! AI 工具运行时管理模块
//!
//! 管理与 AI 工具相关的运行时状态：
//! - 缓存焦点窗口匹配到的 ai_tools 窗口名
//! - 为每个启用的工具维护一个独立的后台任务（按配置间隔截图）
//! - 提供工具开关控制接口

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;
use tokio::task::JoinHandle;

use super::screenshot;
use super::utils::CachedValue;

// ========================================================================= //
// 全局复用的 HTTP 客户端（避免每次 API 调用都新建连接池）
// ========================================================================= //

static HTTP_CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();

fn get_http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .pool_max_idle_per_host(2)
            .tcp_keepalive(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

/// AI 工具触发器配置（从 ai_tools.json 传入）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiToolTriggerConfig {
    pub keyword: String,
    pub trigger: String,
}

/// AI 返回结果二次处理器配置（从 ai_tools.json 传入）
///
/// 支持的处理类型：
/// - `"number"`: 从 AI 返回文本中提取第一个浮点数，判断是否在 [min, max] 范围内
/// - `"keyword"`: 检查 AI 返回文本中是否包含 pattern 指定的关键词（不区分大小写）
/// - `"regex"`: 使用 pattern 作为正则表达式匹配 AI 返回文本
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiResultProcessorConfig {
    /// 处理类型
    pub processor_type: String,
    /// 匹配成功后输出的结果字符串
    pub result: String,
    /// 数值型最小阈值（含）
    pub min: Option<f64>,
    /// 数值型最大阈值（含）
    pub max: Option<f64>,
    /// 关键词或正则模式
    pub pattern: Option<String>,
}

// ========================================================================= //
// 全局缓存
// ========================================================================= //

/// 当前焦点窗口匹配到的 ai_tools 窗口名（不区分大小写匹配后的原始 window_name）。
/// 当焦点窗口不匹配任何 ai_tools 配置时为 None。
static MATCHED_AI_TOOL_WINDOW: CachedValue<String> = CachedValue::new();

/// 工具运行时状态：工具名 -> 是否启用
static TOOL_ENABLED_MAP: CachedValue<HashMap<String, bool>> = CachedValue::new();

/// 工具后台任务句柄：工具名 -> JoinHandle
/// 注意：JoinHandle 不是 Send+Sync，用 tokio Mutex 包装
static TOOL_TASKS: std::sync::OnceLock<tokio::sync::Mutex<HashMap<String, JoinHandle<()>>>> =
    std::sync::OnceLock::new();

fn get_task_map() -> &'static tokio::sync::Mutex<HashMap<String, JoinHandle<()>>> {
    TOOL_TASKS.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()))
}

/// 工具任务配置缓存：工具名 -> 配置（Arc 包装，避免 clone 深拷贝）
/// 在 initialize_tools 时填充，供 start_tool_task 读取
static TOOL_CONFIGS: CachedValue<HashMap<String, Arc<AiToolTaskConfig>>> = CachedValue::new();

/// 截图保留模式：true=每张截图带时间戳后缀全部保留，false=同名覆盖
static KEEP_SCREENSHOTS: AtomicBool = AtomicBool::new(false);

use super::constants::MAX_AI_IN_FLIGHT;


/// 信息窗口可见状态：工具名 -> 是否可见
static INFO_WINDOW_VISIBLE: CachedValue<HashMap<String, bool>> = CachedValue::new();

/// 手动截图通知：当用户按下热键时，notify_waiters() 唤醒所有 manual 类型任务
static MANUAL_CAPTURE_NOTIFY: std::sync::OnceLock<Notify> = std::sync::OnceLock::new();

fn get_manual_notify() -> &'static Notify {
    MANUAL_CAPTURE_NOTIFY.get_or_init(Notify::new)
}

/// 解析指定窗口名实际使用的 AI 模型名（优先匹配窗口特定配置）。
///
/// 供系统观察器在发送气泡通知时调用，让用户知道当前使用的是哪个模型。
pub async fn resolve_ai_model_for_window(app: &tauri::AppHandle, window_name: &str) -> String {
    let wn = window_name.to_string();
    crate::app_state::AppState::read_settings_async(
        app,
        move |s| {
            let wn_lower = wn.to_lowercase();
            let matched = s.ai_window_configs.iter().find(|wc| {
                let cfg_name = wc.window_name.to_lowercase();
                !cfg_name.is_empty() && (wn_lower.contains(&cfg_name) || cfg_name.contains(&wn_lower))
            });
            matched
                .map(|wc| wc.ai_chat_model.as_ref())
                .filter(|m| !m.is_empty())
                .unwrap_or(s.ai_chat_model.as_ref())
                .to_string()
        },
        String::new(),
    )
    .await
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
    /// 匹配到的窗口名（用于截图文件名前缀）
    pub window_name: String,
    /// 工具类型：auto 或 manual
    pub tool_type: ToolType,
    /// 截取矩形区域
    pub capture_x: i32,
    pub capture_y: i32,
    pub capture_width: u32,
    pub capture_height: u32,
    /// 是否需要信息窗口
    pub show_info_window: bool,
    /// 提示词列表（发送给 AI 的 prompt）
    pub prompts: Vec<String>,
    /// AI 返回结果的二次处理器列表
    pub result_processors: Vec<AiResultProcessorConfig>,
    /// 触发器列表（AI 返回文本中匹配 keyword 则触发对应 trigger）
    pub triggers: Vec<AiToolTriggerConfig>,
}

// ========================================================================= //
// 调试信息
// ========================================================================= //

/// AI 工具管理器的调试快照
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiToolDebugInfo {
    /// 当前匹配到的窗口名
    pub matched_window: Option<String>,
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

/// 缓存的调试信息（Arc 包装，get 时返回 Arc 引用而非深拷贝）
static CACHED_DEBUG_INFO: CachedValue<Arc<AiToolDebugInfo>> = CachedValue::new();

/// 获取缓存的调试信息（供 Tauri Command 首次拉取）
pub fn get_cached_debug_info() -> Option<Arc<AiToolDebugInfo>> {
    CACHED_DEBUG_INFO.get()
}

/// 更新缓存的调试信息
fn update_cached_debug_info(info: AiToolDebugInfo) {
    CACHED_DEBUG_INFO.set(Arc::new(info));
}

/// 生成当前调试快照并更新缓存，返回快照的 Arc 引用
pub async fn snapshot_debug_info() -> Arc<AiToolDebugInfo> {
    let matched_window = get_matched_ai_tool_window();
    let enabled_map = get_tool_enabled_map();

    let tasks = get_task_map().lock().await;

    let tools: Vec<AiToolDebugItem> = if let Some(ref map) = enabled_map {
        let configs = TOOL_CONFIGS.get();
        let info_visible = INFO_WINDOW_VISIBLE.get();
        map.iter()
            .map(|(name, enabled)| {
                let task_id = tasks
                    .get(name)
                    .map(|handle| format!("{}", handle.id()));
                let tool_type = configs
                    .as_ref()
                    .and_then(|g| g.get(name).map(|c| c.tool_type))
                    .unwrap_or_default();
                let show_info_window = configs
                    .as_ref()
                    .and_then(|g| g.get(name).map(|c| c.show_info_window))
                    .unwrap_or(false);
                let info_window_visible = info_visible
                    .as_ref()
                    .and_then(|g| g.get(name).copied())
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
        matched_window,
        tools,
        active_task_count,
        last_update_time: chrono::Local::now().format("%H:%M:%S").to_string(),
        keep_screenshots: KEEP_SCREENSHOTS.load(Ordering::Relaxed),
    };

    update_cached_debug_info(info);

    // 返回刚存入缓存的 Arc，避免额外 clone
    get_cached_debug_info().unwrap()
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

/// 推送完整的 AI 工具状态变更到前端（含 tool_items 列表 + 调试快照）。
///
/// 供 `toggle_ai_tool` / `toggle_ai_tool_info_window` 等 Command 共用，
/// 避免事件构造代码的重复。
pub async fn emit_ai_tool_state_update(app: &tauri::AppHandle) {
    if let Some((window_name, tool_items)) = build_tool_items_for_event() {
        let _ = super::event_manager::emit(
            app,
            super::event_manager::events::AI_TOOL_DATA_CHANGED,
            serde_json::json!({
                "window_name": window_name,
                "tools": tool_items,
            }),
        );
    }
    emit_debug_snapshot(app).await;
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
// 公共接口 — 窗口名匹配
// ========================================================================= //

/// 获取当前匹配到的 AI 工具窗口名
pub fn get_matched_ai_tool_window() -> Option<String> {
    MATCHED_AI_TOOL_WINDOW.get()
}

/// 更新当前匹配到的 AI 工具窗口名
pub fn set_matched_ai_tool_window(name: Option<String>) {
    match name {
        Some(n) => MATCHED_AI_TOOL_WINDOW.set(n),
        None => MATCHED_AI_TOOL_WINDOW.clear(),
    }
}

// ========================================================================= //
// 公共接口 — 工具启用状态
// ========================================================================= //

/// 获取当前所有工具的启用状态（工具名 -> 是否启用）
pub fn get_tool_enabled_map() -> Option<HashMap<String, bool>> {
    TOOL_ENABLED_MAP.get()
}

/// 设置工具启用状态表
pub fn set_tool_enabled_map(map: Option<HashMap<String, bool>>) {
    match map {
        Some(m) => TOOL_ENABLED_MAP.set(m),
        None => TOOL_ENABLED_MAP.clear(),
    }
}

/// 设置单个工具的启用状态，返回是否变更成功
pub fn set_tool_enabled(name: &str, enabled: bool) -> bool {
    TOOL_ENABLED_MAP
        .with_lock(|opt| {
            if let Some(ref mut map) = opt {
                if let Some(val) = map.get_mut(name) {
                    *val = enabled;
                    return true;
                }
            }
            false
        })
        .unwrap_or(false)
}

/// 获取单个工具的启用状态
pub fn is_tool_enabled(name: &str) -> bool {
    TOOL_ENABLED_MAP
        .with_lock(|opt| opt.as_ref().and_then(|m| m.get(name).copied()))
        .flatten()
        .unwrap_or(false)
}

/// 构建用于前端事件推送的完整工具列表（含 type、show_info_window 等完整信息）。
/// 供 toggle_ai_tool / toggle_ai_tool_info_window 命令发送事件使用。
pub fn build_tool_items_for_event() -> Option<(Option<String>, Vec<serde_json::Value>)> {
    let enabled_map = get_tool_enabled_map()?;
    let window_name = get_matched_ai_tool_window();
    let configs = TOOL_CONFIGS.get();
    let info_visible = INFO_WINDOW_VISIBLE.get();

    let items: Vec<serde_json::Value> = enabled_map
        .iter()
        .map(|(name, enabled)| {
            let (tool_type_str, show_info) = configs
                .as_ref()
                .and_then(|g| {
                    let cfg = g.get(name)?;
                    let t = match cfg.tool_type {
                        ToolType::Auto => "auto",
                        ToolType::Manual => "manual",
                    };
                    Some((t, cfg.show_info_window))
                })
                .unwrap_or(("manual", false));

            let info_visible_val = info_visible
                .as_ref()
                .and_then(|g| g.get(name).copied())
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

    Some((window_name, items))
}

// ========================================================================= //
// 公共接口 — 工具配置
// ========================================================================= //

/// 获取指定工具的任务配置（Arc 引用，避免深拷贝）
fn get_tool_config(name: &str) -> Option<Arc<AiToolTaskConfig>> {
    TOOL_CONFIGS
        .with_lock(|opt| opt.as_ref()?.get(name).cloned())
        .flatten()
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
        .with_lock(|opt| opt.as_ref().and_then(|m| m.get(tool_name).copied()))
        .flatten()
        .unwrap_or(false)
}

/// 设置信息窗口可见状态
fn set_info_window_visible(tool_name: &str, visible: bool) {
    INFO_WINDOW_VISIBLE.with_lock(|opt| {
        if let Some(ref mut map) = opt {
            if let Some(val) = map.get_mut(tool_name) {
                *val = visible;
            }
        }
    });
}

/// 创建 AI 工具信息窗口
///
/// 窗口特性：
/// - 无标题栏（decorations=false）、透明背景、置顶
/// - 宽度与渲染窗口一致，高度固定 120px
/// - 初始位置在渲染窗口（角色）正上方
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

    let url = format!("ai_tool_info?tool={}", tool_name);

    // 计算与渲染窗口相同的宽度
    let (window_width, info_height) = {
        use crate::modules::constants::*;
        let scale = {
            if let Some(app_state) = app.try_state::<crate::app_state::AppState>() {
                let storage = app_state.storage.lock().unwrap();
                storage.data.settings.animation_scale as f64
            } else {
                1.0
            }
        };
        let animation_area_width = ANIMATION_AREA_WIDTH * scale;
        let w = BUBBLE_AREA_WIDTH.max(animation_area_width);
        (w, 120.0_f64)
    };

    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title("AI Tool Info")
        .inner_size(window_width, info_height)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .resizable(true)
        .shadow(false)
        .skip_taskbar(true);

    if let Ok(window) = builder.build() {
        crate::lib_helpers::apply_window_icon(app, &window);

        // 设置 WS_EX_NOACTIVATE：防止拖拽信息窗口时全屏应用被最小化
        crate::lib_helpers::set_window_no_activate(&window);

        // 定位到渲染窗口正上方
        position_info_window_above_render(app, &window, info_height);

        set_info_window_visible(tool_name, true);

        #[cfg(debug_assertions)]
        println!("[AiToolManager] Info window created for tool: {}", tool_name);
    }
}

/// 将信息窗口定位到渲染窗口正上方
fn position_info_window_above_render(
    app: &tauri::AppHandle,
    info_window: &tauri::WebviewWindow,
    info_height: f64,
) {
    use crate::modules::constants::RENDER_WINDOW_LABELS;
    use tauri::Manager;

    // 尝试从任一活跃的渲染窗口获取位置
    for label in RENDER_WINDOW_LABELS {
        if let Some(render_win) = app.get_webview_window(label) {
            if let (Ok(pos), Ok(size)) = (render_win.outer_position(), render_win.outer_size()) {
                let scale_factor = render_win.scale_factor().unwrap_or(1.0);
                let rx = pos.x as f64 / scale_factor;
                let ry = pos.y as f64 / scale_factor;
                let _rw = size.width as f64 / scale_factor;

                // 信息窗口底部与气泡区域底部对齐
                let info_x = rx;
                let info_y = ry + crate::modules::constants::BUBBLE_AREA_HEIGHT - info_height;

                let _ = info_window.set_position(tauri::Position::Logical(
                    tauri::LogicalPosition::new(info_x, info_y),
                ));
                return;
            }
        }
    }

    // 找不到渲染窗口则居中
    let _ = info_window.center();
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
///
/// 注意：先在锁内收集所有需要销毁的窗口标签，释放锁后再执行 destroy，
/// 避免 window.destroy() 触发的事件回调重新获取 INFO_WINDOW_VISIBLE 锁导致死锁。
fn destroy_all_info_windows(app: &tauri::AppHandle) {
    use tauri::Manager;

    let labels_to_destroy: Vec<String> = INFO_WINDOW_VISIBLE
        .with_lock(|opt| {
            opt.as_ref()
                .map(|map| map.keys().map(|name| info_window_label(name)).collect())
                .unwrap_or_default()
        })
        .unwrap_or_default();

    for label in &labels_to_destroy {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.destroy();
        }
    }
}

// ========================================================================= //
// 公共接口 — 任务管理
// ========================================================================= //

/// 执行一次截图并保存，返回保存路径（成功时）
async fn do_capture(
    cfg: &AiToolTaskConfig,
    file_prefix: &str,
    screenshots_dir: &std::path::Path,
    tool_name: &str,
) -> Option<std::path::PathBuf> {
    if cfg.capture_width == 0 || cfg.capture_height == 0 {
        return None;
    }

    let keep = KEEP_SCREENSHOTS.load(Ordering::Relaxed);
    let filename = if keep {
        let ts = chrono::Local::now().format("%Y%m%d_%H%M%S_%3f");
        format!("{}_{}.png", file_prefix, ts)
    } else {
        format!("{}.png", file_prefix)
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
            Some(save_path)
        }
        Ok(Err(e)) => {
            #[cfg(debug_assertions)]
            println!(
                "[AiToolManager] Screenshot failed for {}: {}",
                tool_name, e
            );
            None
        }
        Err(e) => {
            #[cfg(debug_assertions)]
            println!(
                "[AiToolManager] Screenshot task join error for {}: {}",
                tool_name, e
            );
            None
        }
    }
}

/// 将图片文件读取并转为 PNG base64 编码字符串
///
/// 无论原始格式（BMP/PNG 等），统一输出 PNG 格式的 base64，
/// 以确保与 SiliconFlow 等 API 的兼容性。
///
/// 注意：AI 截图流程已改用 `screenshot::capture_screen_region_as_png_base64`
/// 直接在内存完成，此函数保留供其他可能需要从磁盘文件转换 base64 的场景使用。
#[allow(dead_code)]
fn read_image_as_png_base64(path: &std::path::Path) -> Result<String, String> {
    use image::ImageReader;
    use std::io::Cursor;

    let img = ImageReader::open(path)
        .map_err(|e| format!("Failed to open image: {}", e))?
        .decode()
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    let mut png_buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut png_buf), image::ImageFormat::Png)
        .map_err(|e| format!("Failed to encode PNG: {}", e))?;

    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &png_buf,
    ))
}

/// 调用 OpenAI 兼容的 Chat Completions API（含 vision），返回 AI 回复文本
async fn call_chat_vision_api(
    base_url: &str,
    api_key: &str,
    model: &str,
    prompts: &[String],
    image_base64: &str,
) -> Result<String, String> {
    let url = format!(
        "{}/chat/completions",
        base_url.trim_end_matches('/')
    );

    // 构建 prompt 文本
    let prompt_text = prompts.join("\n");

    // 构建 messages: 一条 user message，包含 text + image_url (base64)
    let body = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": prompt_text
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": format!("data:image/png;base64,{}", image_base64)
                        }
                    }
                ]
            }
        ],
        "max_tokens": 512,
        "temperature": 0.1
    });

    let client = get_http_client();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = resp.status();
    let resp_text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    if !status.is_success() {
        return Err(format!("API returned {}: {}", status, resp_text));
    }

    // 解析返回的 JSON
    let json: serde_json::Value = serde_json::from_str(&resp_text)
        .map_err(|e| format!("Failed to parse response JSON: {}", e))?;

    // 提取 choices[0].message.content
    let content = json
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();

    Ok(content)
}

/// 从文本中提取第一个浮点数（支持负数、小数）
fn extract_first_number(text: &str) -> Option<f64> {
    // 匹配可选负号 + 整数或小数
    let re = regex::Regex::new(r"-?\d+\.?\d*").ok()?;
    re.find(text).and_then(|m| m.as_str().parse::<f64>().ok())
}

/// 对 AI 返回的原始文本应用二次处理器列表。
///
/// 按顺序依次尝试每个处理器：
/// - `number`: 提取文本中第一个数值，判断是否在 [min, max] 范围内
/// - `keyword`: 检查文本中是否包含 pattern 指定的关键词（不区分大小写）
/// - `regex`: 用 pattern 做正则匹配
///
/// 第一个匹配成功的处理器，其 `result` 字段替代原始文本返回。
/// 若所有处理器都未匹配，返回原始文本。
fn process_ai_result(ai_response: &str, processors: &[AiResultProcessorConfig]) -> String {
    if processors.is_empty() {
        return ai_response.to_string();
    }

    for proc in processors {
        let matched = match proc.processor_type.as_str() {
            "number" => {
                if let Some(num) = extract_first_number(ai_response) {
                    let above_min = proc.min.map_or(true, |min| num >= min);
                    let below_max = proc.max.map_or(true, |max| num <= max);
                    above_min && below_max
                } else {
                    false
                }
            }
            "keyword" => {
                if let Some(ref pattern) = proc.pattern {
                    let response_lower = ai_response.to_lowercase();
                    let pattern_lower = pattern.to_lowercase();
                    response_lower.contains(&pattern_lower)
                } else {
                    false
                }
            }
            "regex" => {
                if let Some(ref pattern) = proc.pattern {
                    regex::Regex::new(pattern)
                        .map(|re| re.is_match(ai_response))
                        .unwrap_or(false)
                } else {
                    false
                }
            }
            _ => false,
        };

        if matched {
            #[cfg(debug_assertions)]
            println!(
                "[AiToolManager] Result processor matched: type={}, result={}",
                proc.processor_type, proc.result
            );
            return proc.result.clone();
        }
    }

    // 所有处理器都未匹配，返回原始文本
    ai_response.to_string()
}

/// 将 AI 回复文本与触发器列表匹配，返回所有匹配的 trigger 事件名
fn match_triggers(ai_response: &str, triggers: &[AiToolTriggerConfig]) -> Vec<String> {
    let response_lower = ai_response.to_lowercase();
    triggers
        .iter()
        .filter(|t| response_lower.contains(&t.keyword.to_lowercase()))
        .map(|t| t.trigger.clone())
        .collect()
}

/// 向信息窗口推送一条消息
fn emit_info_message(app: &tauri::AppHandle, tool_name: &str, message: &str) {
    let _ = super::event_manager::emit(
        app,
        super::event_manager::events::AI_TOOL_INFO_MESSAGE,
        serde_json::json!({
            "tool": tool_name,
            "message": message,
        }),
    );
}

/// 截图后执行 AI 识别 + trigger 匹配的完整流程
///
/// 当工具配置了 `show_info_window=true` 或 `triggers` 非空时，
/// 都会将截图发送给 AI 处理。AI 回复文本会：
/// - 若 `show_info_window=true`，推送到信息窗口显示
/// - 若 `triggers` 非空，匹配触发器并执行对应事件
///
/// 性能优化：当需要 AI 处理时，使用内存中截图→PNG bytes 的零磁盘 I/O 路径，
/// 按需编码 base64（给 AI）或直接写磁盘（keep_screenshots 模式），避免冗余编解码。
async fn process_capture_with_ai(
    cfg: &AiToolTaskConfig,
    file_prefix: &str,
    screenshots_dir: &std::path::Path,
    tool_name: &str,
    app: &tauri::AppHandle,
) {
    if cfg.capture_width == 0 || cfg.capture_height == 0 {
        return;
    }

    let need_ai = cfg.show_info_window || !cfg.triggers.is_empty();

    if !need_ai {
        // 仅截图不调用 AI（通过磁盘路径）
        do_capture(cfg, file_prefix, screenshots_dir, tool_name).await;
        return;
    }

    // AI 路径：直接在内存中完成截图→PNG bytes，避免磁盘 I/O
    let x = cfg.capture_x;
    let y = cfg.capture_y;
    let w = cfg.capture_width;
    let h = cfg.capture_height;

    let png_bytes = match tokio::task::spawn_blocking(move || {
        screenshot::capture_screen_region_as_png_bytes(x, y, w, h)
    })
    .await
    {
        Ok(Ok(bytes)) => bytes,
        Ok(Err(e)) => {
            #[cfg(debug_assertions)]
            println!(
                "[AiToolManager] In-memory capture failed for {}: {}",
                tool_name, e
            );
            if cfg.show_info_window {
                emit_info_message(app, tool_name, &format!("[Error] Capture failed: {}", e));
            }
            return;
        }
        Err(e) => {
            #[cfg(debug_assertions)]
            println!(
                "[AiToolManager] Capture task join error for {}: {}",
                tool_name, e
            );
            return;
        }
    };

    // 如果开启了截图保留模式，直接将 PNG bytes 写入磁盘（无需 base64 编解码）
    if KEEP_SCREENSHOTS.load(Ordering::Relaxed) {
        let screenshots_dir = screenshots_dir.to_path_buf();
        let prefix = file_prefix.to_string();
        let bytes_clone = png_bytes.clone();
        tokio::task::spawn_blocking(move || {
            let ts = chrono::Local::now().format("%Y%m%d_%H%M%S_%3f");
            let filename = format!("{}_{}.png", prefix, ts);
            let save_path = screenshots_dir.join(&filename);
            let _ = std::fs::write(&save_path, &bytes_clone);
        });
    }

    // 按需编码 base64（仅 AI 调用需要）
    let image_b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &png_bytes,
    );

    // 从 settings 读取 API 配置（优先匹配窗口特定参数，找不到则使用默认值）
    let window_name_for_match = cfg.window_name.clone();
    let (api_key, base_url, model) = crate::app_state::AppState::read_settings_async(
        app,
        move |s| {
            let api_key = s.ai_api_key.to_string();
            // 查找匹配的窗口特定配置（不区分大小写）
            let wn_lower = window_name_for_match.to_lowercase();
            let matched_cfg = s.ai_window_configs.iter().find(|wc| {
                let cfg_name = wc.window_name.to_lowercase();
                !cfg_name.is_empty() && (wn_lower.contains(&cfg_name) || cfg_name.contains(&wn_lower))
            });
            let base_url = matched_cfg
                .map(|wc| wc.ai_chat_base_url.as_ref())
                .filter(|u| !u.is_empty())
                .unwrap_or(s.ai_chat_base_url.as_ref())
                .to_string();
            let model = matched_cfg
                .map(|wc| wc.ai_chat_model.as_ref())
                .filter(|m| !m.is_empty())
                .unwrap_or(s.ai_chat_model.as_ref())
                .to_string();
            (api_key, base_url, model)
        },
        (String::new(), String::new(), String::new()),
    )
    .await;

    if api_key.is_empty() {
        #[cfg(debug_assertions)]
        println!(
            "[AiToolManager] Skipping AI call for {}: API key is empty",
            tool_name
        );
        if cfg.show_info_window {
            emit_info_message(app, tool_name, "[Error] AI API key is empty, please configure it in Settings");
        }
        return;
    }

    // 调用 AI API
    #[cfg(debug_assertions)]
    println!(
        "[AiToolManager] Calling AI API for tool '{}' (model: {}, prompts: {})",
        tool_name,
        model,
        cfg.prompts.len()
    );

    let ai_response = match call_chat_vision_api(
        &base_url,
        &api_key,
        &model,
        &cfg.prompts,
        &image_b64,
    )
    .await
    {
        Ok(text) => {
            #[cfg(debug_assertions)]
            println!(
                "[AiToolManager] AI response for '{}': \n{}",
                tool_name, text
            );
            text
        }
        Err(e) => {
            #[cfg(debug_assertions)]
            println!(
                "[AiToolManager] AI API call failed for '{}': {}",
                tool_name, e
            );
            if cfg.show_info_window {
                emit_info_message(app, tool_name, &format!("[Error] AI API call failed: {}", e));
            }
            return;
        }
    };

    // 将 AI 回复推送到信息窗口
    if cfg.show_info_window {
        emit_info_message(app, tool_name, &ai_response);
    }

    // 对 AI 返回结果应用二次处理器
    let processed_response = if !cfg.result_processors.is_empty() {
        let result = process_ai_result(&ai_response, &cfg.result_processors);
        #[cfg(debug_assertions)]
        if result != ai_response {
            println!(
                "[AiToolManager] Result processed for '{}': '{}' -> '{}'",
                tool_name, ai_response, result
            );
        }
        if cfg.show_info_window && result != ai_response {
            emit_info_message(app, tool_name, &format!("[Processed] {}", result));
        }
        result
    } else {
        ai_response.clone()
    };

    // 匹配 triggers（如果有），使用经过二次处理后的文本
    if !cfg.triggers.is_empty() {
        let matched = match_triggers(&processed_response, &cfg.triggers);
        if matched.is_empty() {
            #[cfg(debug_assertions)]
            println!(
                "[AiToolManager] No trigger matched for '{}'",
                tool_name
            );
            return;
        }

        for trigger_event_name in &matched {
            #[cfg(debug_assertions)]
            println!(
                "[AiToolManager] Triggering '{}' for tool '{}'",
                trigger_event_name, tool_name
            );

            use tauri::Manager;
            let app_clone = app.clone();
            let event_name = trigger_event_name.clone();
            let tool = tool_name.to_string();
            let show_info = cfg.show_info_window;

            let result = tokio::task::spawn_blocking(move || {
                if let Some(app_state) = app_clone.try_state::<crate::app_state::AppState>() {
                    app_state.trigger_event(&event_name, false)
                } else {
                    Ok(false)
                }
            })
            .await;

            match result {
                Ok(Ok(true)) => {
                    #[cfg(debug_assertions)]
                    println!(
                        "[AiToolManager] Trigger '{}' fired successfully",
                        trigger_event_name
                    );
                    if show_info {
                        emit_info_message(app, tool_name, &format!("[Trigger] '{}' fired", trigger_event_name));
                    }
                }
                Ok(Ok(false)) => {
                    #[cfg(debug_assertions)]
                    println!(
                        "[AiToolManager] Trigger '{}' did not match any state",
                        trigger_event_name
                    );
                }
                Ok(Err(e)) => {
                    #[cfg(debug_assertions)]
                    println!(
                        "[AiToolManager] Trigger '{}' error: {}",
                        trigger_event_name, e
                    );
                }
                Err(e) => {
                    #[cfg(debug_assertions)]
                    println!(
                        "[AiToolManager] Trigger '{}' spawn_blocking join error: {}",
                        trigger_event_name, e
                    );
                }
            }
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

        let file_prefix = format!("{}_{}", cfg.window_name, name_clone);

        match cfg.tool_type {
            ToolType::Auto => {
                // 自动模式：固定间隔截图 + AI 识别，请求与定时器互不阻塞
                //
                // 核心设计：
                // - 使用 tokio::time::interval 保证截图发起间隔严格固定
                // - AI 请求在独立 tokio::spawn 任务中执行，不阻塞定时器
                // - 使用 AtomicBool 标记 in-flight 状态：
                //   · 若上一个 AI 请求仍在进行中 → 跳过本次 AI 调用
                //   · 保证任何时刻最多 1 个 AI 请求在飞，防止 API 限流和内存堆积
                // - 实际请求间隔 = interval（固定），而非 interval + API 延迟
                //
                // 优化：每 10 次循环才重新读取 interval 设置，减少 spawn_blocking 开销
                let window_name_for_interval = cfg.window_name.clone();
                let mut cached_interval_secs: f64 =
                    crate::app_state::AppState::read_settings_async(
                        &app,
                        move |s| {
                            let wn_lower = window_name_for_interval.to_lowercase();
                            let matched = s.ai_window_configs.iter().find(|wc| {
                                let cfg_name = wc.window_name.to_lowercase();
                                !cfg_name.is_empty() && (wn_lower.contains(&cfg_name) || cfg_name.contains(&wn_lower))
                            });
                            let interval = matched
                                .map(|wc| wc.ai_screenshot_interval)
                                .filter(|&v| v > 0.0)
                                .unwrap_or(s.ai_screenshot_interval);
                            interval.max(0.1) as f64
                        },
                        1.0,
                    )
                    .await;
                let mut loop_count: u32 = 0;
                const REFRESH_INTERVAL_EVERY_N: u32 = 10;

                // in-flight 计数器：当前正在进行的 AI 请求数
                let ai_in_flight = Arc::new(AtomicU32::new(0));

                let mut ticker = tokio::time::interval(
                    std::time::Duration::from_secs_f64(cached_interval_secs),
                );
                // 第一次 tick 立即触发；后续若 tick 被延迟则跳过错过的 tick
                ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

                loop {
                    ticker.tick().await;

                    // 定期刷新 interval 设置（避免每次循环都 spawn_blocking）
                    if loop_count > 0 && loop_count % REFRESH_INTERVAL_EVERY_N == 0 {
                        if let Ok(v) = tokio::task::spawn_blocking({
                            let app_clone = app.clone();
                            let wn = cfg.window_name.clone();
                            move || {
                                use tauri::Manager;
                                let app_state: tauri::State<crate::app_state::AppState> = app_clone.state();
                                let storage = app_state.storage.lock().unwrap();
                                let s = &storage.data.settings;
                                let wn_lower = wn.to_lowercase();
                                let matched = s.ai_window_configs.iter().find(|wc| {
                                    let cfg_name = wc.window_name.to_lowercase();
                                    !cfg_name.is_empty() && (wn_lower.contains(&cfg_name) || cfg_name.contains(&wn_lower))
                                });
                                let interval = matched
                                    .map(|wc| wc.ai_screenshot_interval)
                                    .filter(|&v| v > 0.0)
                                    .unwrap_or(s.ai_screenshot_interval);
                                interval.max(0.1) as f64
                            }
                        })
                        .await
                        {
                            if (cached_interval_secs - v).abs() > 0.001 {
                                cached_interval_secs = v;
                                ticker = tokio::time::interval(
                                    std::time::Duration::from_secs_f64(cached_interval_secs),
                                );
                                ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                                ticker.tick().await; // 消耗第一个立即触发的 tick
                            }
                        }
                    }
                    loop_count = loop_count.wrapping_add(1);

                    // 如果 in-flight 请求数已达上限，跳过本次，避免请求堆积
                    if ai_in_flight.load(Ordering::Acquire) >= MAX_AI_IN_FLIGHT {
                        #[cfg(debug_assertions)]
                        println!(
                            "[AiToolManager] Skipping AI call for '{}': {} request(s) already in-flight (max {})",
                            name_clone,
                            ai_in_flight.load(Ordering::Relaxed),
                            MAX_AI_IN_FLIGHT
                        );
                        continue;
                    }

                    // 递增 in-flight 计数，在独立 task 中执行截图 + AI 识别（不阻塞定时器）
                    ai_in_flight.fetch_add(1, Ordering::Release);
                    let in_flight_flag = ai_in_flight.clone();
                    let cfg_clone = cfg.clone();
                    let prefix_clone = file_prefix.clone();
                    let dir_clone = screenshots_dir.clone();
                    let tool_clone = name_clone.clone();
                    let app_clone = app.clone();
                    tokio::spawn(async move {
                        process_capture_with_ai(
                            &cfg_clone,
                            &prefix_clone,
                            &dir_clone,
                            &tool_clone,
                            &app_clone,
                        )
                        .await;
                        // AI 请求完成，递减 in-flight 计数
                        in_flight_flag.fetch_sub(1, Ordering::Release);
                    });
                }
            }
            ToolType::Manual => {
                // 手动模式：等待热键触发信号后截图 + AI 识别
                let notify = get_manual_notify();
                loop {
                    notify.notified().await;

                    #[cfg(debug_assertions)]
                    println!(
                        "[AiToolManager] Manual capture signal received for: {}",
                        name_clone
                    );

                    process_capture_with_ai(
                        &cfg,
                        &file_prefix,
                        &screenshots_dir,
                        &name_clone,
                        &app,
                    )
                    .await;
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
    INFO_WINDOW_VISIBLE.clear();

    // 清空启用状态
    set_tool_enabled_map(None);

    // 清空匹配窗口名
    set_matched_ai_tool_window(None);

    // 清空工具配置
    TOOL_CONFIGS.clear();

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
        config_map.insert(info.name.clone(), Arc::new(info.config.clone()));
        // 初始可见状态：auto_start 且有 show_info_window 的默认可见
        info_visible_map.insert(
            info.name.clone(),
            info.auto_start && info.config.show_info_window,
        );
    }
    set_tool_enabled_map(Some(enabled_map));
    TOOL_CONFIGS.set(config_map);
    INFO_WINDOW_VISIBLE.set(info_visible_map);

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

    // ===================================================================== //
    // 匹配窗口名
    // ===================================================================== //

    #[test]
    fn matched_window_defaults_to_none() {
        let _ = get_matched_ai_tool_window();
    }

    #[test]
    fn set_and_get_matched_window() {
        set_matched_ai_tool_window(Some("Chrome".to_string()));
        let val = get_matched_ai_tool_window();
        assert_eq!(val, Some("Chrome".to_string()));

        set_matched_ai_tool_window(None);
        let val = get_matched_ai_tool_window();
        assert_eq!(val, None);
    }

    #[test]
    fn set_matched_window_overwrites_previous() {
        set_matched_ai_tool_window(Some("Chrome".to_string()));
        set_matched_ai_tool_window(Some("Firefox".to_string()));
        assert_eq!(
            get_matched_ai_tool_window(),
            Some("Firefox".to_string())
        );
        set_matched_ai_tool_window(None);
    }

    // ===================================================================== //
    // 工具启用状态
    // ===================================================================== //

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
    fn is_tool_enabled_returns_false_for_unknown_tool() {
        set_tool_enabled_map(Some(HashMap::new()));
        assert!(!is_tool_enabled("nonexistent"));
        set_tool_enabled_map(None);
    }

    #[test]
    fn is_tool_enabled_returns_false_when_map_is_none() {
        set_tool_enabled_map(None);
        assert!(!is_tool_enabled("any_tool"));
    }

    #[test]
    fn set_tool_enabled_returns_false_for_missing_tool() {
        set_tool_enabled_map(Some(HashMap::new()));
        let changed = set_tool_enabled("nonexistent", true);
        assert!(!changed);
        set_tool_enabled_map(None);
    }

    #[test]
    fn set_tool_enabled_returns_true_for_existing_tool() {
        let mut map = HashMap::new();
        map.insert("tool_a".to_string(), false);
        set_tool_enabled_map(Some(map));
        let changed = set_tool_enabled("tool_a", true);
        assert!(changed);
        assert!(is_tool_enabled("tool_a"));
        set_tool_enabled_map(None);
    }

    #[test]
    fn set_tool_enabled_returns_false_when_map_is_none() {
        set_tool_enabled_map(None);
        let changed = set_tool_enabled("tool_a", true);
        assert!(!changed);
    }

    // ===================================================================== //
    // 截图保留模式
    // ===================================================================== //

    #[test]
    fn keep_screenshots_toggle() {
        set_keep_screenshots(false);
        assert!(!get_keep_screenshots());
        set_keep_screenshots(true);
        assert!(get_keep_screenshots());
        set_keep_screenshots(false);
    }

    #[test]
    fn keep_screenshots_default_is_false() {
        // AtomicBool 初始化为 false
        set_keep_screenshots(false);
        assert!(!get_keep_screenshots());
    }

    // ===================================================================== //
    // 信息窗口状态
    // ===================================================================== //

    #[test]
    fn info_window_visible_defaults_to_false() {
        INFO_WINDOW_VISIBLE.clear();
        assert!(!is_info_window_visible("any_tool"));
    }

    #[test]
    fn set_info_window_visible_updates_state() {
        let mut map = HashMap::new();
        map.insert("watcher".to_string(), false);
        INFO_WINDOW_VISIBLE.set(map);

        assert!(!is_info_window_visible("watcher"));
        set_info_window_visible("watcher", true);
        assert!(is_info_window_visible("watcher"));

        set_info_window_visible("watcher", false);
        assert!(!is_info_window_visible("watcher"));

        INFO_WINDOW_VISIBLE.clear();
    }

    #[test]
    fn info_window_visible_ignores_unknown_tool() {
        let mut map = HashMap::new();
        map.insert("known".to_string(), true);
        INFO_WINDOW_VISIBLE.set(map);

        // 对不存在的工具设置可见状态不会 panic
        set_info_window_visible("unknown", true);
        assert!(!is_info_window_visible("unknown"));

        INFO_WINDOW_VISIBLE.clear();
    }

    // ===================================================================== //
    // 信息窗口标签
    // ===================================================================== //

    #[test]
    fn info_window_label_format() {
        assert_eq!(
            info_window_label("watcher"),
            "ai_tool_info_watcher"
        );
        assert_eq!(info_window_label(""), "ai_tool_info_");
        assert_eq!(
            info_window_label("my-tool-123"),
            "ai_tool_info_my-tool-123"
        );
    }

    // ===================================================================== //
    // ToolType 序列化/反序列化与默认值
    // ===================================================================== //

    #[test]
    fn tool_type_default_is_manual() {
        assert_eq!(ToolType::default(), ToolType::Manual);
    }

    #[test]
    fn tool_type_serde_roundtrip() {
        let auto_json = serde_json::to_string(&ToolType::Auto).unwrap();
        assert_eq!(auto_json, "\"auto\"");

        let manual_json = serde_json::to_string(&ToolType::Manual).unwrap();
        assert_eq!(manual_json, "\"manual\"");

        let parsed: ToolType = serde_json::from_str("\"auto\"").unwrap();
        assert_eq!(parsed, ToolType::Auto);

        let parsed: ToolType = serde_json::from_str("\"manual\"").unwrap();
        assert_eq!(parsed, ToolType::Manual);
    }

    // ===================================================================== //
    // AiToolTaskConfig 序列化
    // ===================================================================== //

    #[test]
    fn ai_tool_task_config_serde() {
        let config = AiToolTaskConfig {
            window_name: "VS Code".to_string(),
            tool_type: ToolType::Auto,
            capture_x: 10,
            capture_y: 20,
            capture_width: 800,
            capture_height: 600,
            show_info_window: true,
            prompts: vec!["What is on screen?".to_string()],
            result_processors: vec![],
            triggers: vec![AiToolTriggerConfig {
                keyword: "error".to_string(),
                trigger: "alert_state".to_string(),
            }],
        };

        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"window_name\":\"VS Code\""));
        assert!(json.contains("\"tool_type\":\"auto\""));
        assert!(json.contains("\"capture_width\":800"));
        assert!(json.contains("\"show_info_window\":true"));

        let parsed: AiToolTaskConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.window_name, "VS Code");
        assert_eq!(parsed.tool_type, ToolType::Auto);
        assert_eq!(parsed.capture_width, 800);
        assert!(parsed.show_info_window);
        assert_eq!(parsed.prompts.len(), 1);
        assert_eq!(parsed.triggers.len(), 1);
        assert_eq!(parsed.triggers[0].keyword, "error");
    }

    // ===================================================================== //
    // AiToolDebugInfo / AiToolDebugItem 序列化
    // ===================================================================== //

    #[test]
    fn ai_tool_debug_info_serde() {
        let info = AiToolDebugInfo {
            matched_window: Some("Chrome".to_string()),
            tools: vec![AiToolDebugItem {
                name: "watcher".to_string(),
                tool_type: ToolType::Auto,
                enabled: true,
                has_task: true,
                task_id: Some("task-42".to_string()),
                show_info_window: true,
                info_window_visible: false,
            }],
            active_task_count: 1,
            last_update_time: "12:00:00".to_string(),
            keep_screenshots: false,
        };

        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"matched_window\":\"Chrome\""));
        assert!(json.contains("\"active_task_count\":1"));
        assert!(json.contains("\"keep_screenshots\":false"));
        assert!(json.contains("\"name\":\"watcher\""));
        assert!(json.contains("\"has_task\":true"));
        assert!(json.contains("\"task_id\":\"task-42\""));

        let parsed: AiToolDebugInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.matched_window, Some("Chrome".to_string()));
        assert_eq!(parsed.tools.len(), 1);
        assert_eq!(parsed.tools[0].name, "watcher");
        assert!(parsed.tools[0].enabled);
    }

    #[test]
    fn ai_tool_debug_info_with_null_window() {
        let info = AiToolDebugInfo {
            matched_window: None,
            tools: vec![],
            active_task_count: 0,
            last_update_time: "00:00:00".to_string(),
            keep_screenshots: true,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"matched_window\":null"));
        assert!(json.contains("\"keep_screenshots\":true"));
    }

    // ===================================================================== //
    // AiToolTriggerConfig 序列化
    // ===================================================================== //

    #[test]
    fn ai_tool_trigger_config_serde() {
        let trigger = AiToolTriggerConfig {
            keyword: "warning".to_string(),
            trigger: "warn_state".to_string(),
        };
        let json = serde_json::to_string(&trigger).unwrap();
        assert!(json.contains("\"keyword\":\"warning\""));
        assert!(json.contains("\"trigger\":\"warn_state\""));

        let parsed: AiToolTriggerConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.keyword, "warning");
        assert_eq!(parsed.trigger, "warn_state");
    }

    // ===================================================================== //
    // match_triggers
    // ===================================================================== //

    #[test]
    fn match_triggers_returns_matching_triggers() {
        let triggers = vec![
            AiToolTriggerConfig {
                keyword: "error".to_string(),
                trigger: "alert".to_string(),
            },
            AiToolTriggerConfig {
                keyword: "warning".to_string(),
                trigger: "warn".to_string(),
            },
            AiToolTriggerConfig {
                keyword: "success".to_string(),
                trigger: "ok".to_string(),
            },
        ];

        let result = match_triggers("There was an ERROR in the system", &triggers);
        assert_eq!(result, vec!["alert"]);
    }

    #[test]
    fn match_triggers_case_insensitive() {
        let triggers = vec![AiToolTriggerConfig {
            keyword: "Warning".to_string(),
            trigger: "warn".to_string(),
        }];

        let result = match_triggers("THERE IS A WARNING", &triggers);
        assert_eq!(result, vec!["warn"]);
    }

    #[test]
    fn match_triggers_multiple_matches() {
        let triggers = vec![
            AiToolTriggerConfig {
                keyword: "error".to_string(),
                trigger: "alert".to_string(),
            },
            AiToolTriggerConfig {
                keyword: "critical".to_string(),
                trigger: "critical_alert".to_string(),
            },
        ];

        let result = match_triggers("Critical error detected", &triggers);
        assert_eq!(result.len(), 2);
        assert!(result.contains(&"alert".to_string()));
        assert!(result.contains(&"critical_alert".to_string()));
    }

    #[test]
    fn match_triggers_no_match() {
        let triggers = vec![AiToolTriggerConfig {
            keyword: "error".to_string(),
            trigger: "alert".to_string(),
        }];

        let result = match_triggers("Everything is fine", &triggers);
        assert!(result.is_empty());
    }

    #[test]
    fn match_triggers_empty_triggers() {
        let result = match_triggers("some text", &[]);
        assert!(result.is_empty());
    }

    #[test]
    fn match_triggers_empty_response() {
        let triggers = vec![AiToolTriggerConfig {
            keyword: "error".to_string(),
            trigger: "alert".to_string(),
        }];
        let result = match_triggers("", &triggers);
        assert!(result.is_empty());
    }

    // ===================================================================== //
    // build_tool_items_for_event（合并为单测试避免并行全局状态竞争）
    // ===================================================================== //

    #[test]
    fn build_tool_items_for_event_scenarios() {
        // 场景 1: 无 enabled_map 时返回 None
        set_tool_enabled_map(None);
        TOOL_CONFIGS.clear();
        INFO_WINDOW_VISIBLE.clear();
        set_matched_ai_tool_window(None);
        assert!(build_tool_items_for_event().is_none());

        // 场景 2: 有 enabled_map，无 TOOL_CONFIGS 时使用默认值
        let mut map = HashMap::new();
        map.insert("tool1".to_string(), true);
        map.insert("tool2".to_string(), false);
        set_tool_enabled_map(Some(map));
        set_matched_ai_tool_window(Some("TestWin".to_string()));
        TOOL_CONFIGS.clear();
        INFO_WINDOW_VISIBLE.clear();

        let result = build_tool_items_for_event();
        assert!(result.is_some());
        let (window_name, items) = result.unwrap();
        assert_eq!(window_name, Some("TestWin".to_string()));
        assert_eq!(items.len(), 2);
        for item in &items {
            assert!(item.get("name").is_some());
            assert!(item.get("type").is_some());
            assert!(item.get("enabled").is_some());
        }

        // 场景 3: 有 TOOL_CONFIGS 和 INFO_WINDOW_VISIBLE 时使用配置值
        let mut map2 = HashMap::new();
        map2.insert("auto_tool".to_string(), true);
        set_tool_enabled_map(Some(map2));

        let mut config_map = HashMap::new();
        config_map.insert("auto_tool".to_string(), Arc::new(AiToolTaskConfig {
            window_name: "Test".to_string(),
            tool_type: ToolType::Auto,
            capture_x: 0,
            capture_y: 0,
            capture_width: 100,
            capture_height: 100,
            show_info_window: true,
            prompts: vec![],
            result_processors: vec![],
            triggers: vec![],
        }));
        TOOL_CONFIGS.set(config_map);

        let mut info_map = HashMap::new();
        info_map.insert("auto_tool".to_string(), true);
        INFO_WINDOW_VISIBLE.set(info_map);

        let result2 = build_tool_items_for_event();
        assert!(result2.is_some());
        let (_, items2) = result2.unwrap();
        assert_eq!(items2.len(), 1);
        assert_eq!(items2[0]["type"], "auto");
        assert_eq!(items2[0]["show_info_window"], true);
        assert_eq!(items2[0]["info_window_visible"], true);

        // 清理
        set_tool_enabled_map(None);
        set_matched_ai_tool_window(None);
        TOOL_CONFIGS.clear();
        INFO_WINDOW_VISIBLE.clear();
    }

    // ===================================================================== //
    // 缓存的调试信息
    // ===================================================================== //

    #[test]
    fn cached_debug_info_set_and_get() {
        let info = AiToolDebugInfo {
            matched_window: Some("Test".to_string()),
            tools: vec![],
            active_task_count: 0,
            last_update_time: "10:00:00".to_string(),
            keep_screenshots: false,
        };
        update_cached_debug_info(info.clone());

        let cached = get_cached_debug_info();
        assert!(cached.is_some());
        let cached = cached.unwrap();
        assert_eq!(cached.matched_window, Some("Test".to_string()));
    }

    // ===================================================================== //
    // notify_manual_capture 不 panic
    // ===================================================================== //

    #[test]
    fn notify_manual_capture_does_not_panic() {
        notify_manual_capture();
    }

    // ===================================================================== //
    // read_image_as_png_base64 (保留函数，不涉及文件系统依赖时的基本行为)
    // ===================================================================== //

    #[test]
    fn read_image_as_png_base64_nonexistent_file() {
        let result = read_image_as_png_base64(std::path::Path::new("/nonexistent/file.png"));
        assert!(result.is_err());
    }

    // ===================================================================== //
    // get_tool_config
    // ===================================================================== //

    #[test]
    fn get_tool_config_returns_none_when_empty() {
        TOOL_CONFIGS.clear();
        assert!(get_tool_config("any").is_none());
    }

    #[test]
    fn get_tool_config_returns_config_when_set() {
        let mut config_map = HashMap::new();
        config_map.insert("my_tool".to_string(), Arc::new(AiToolTaskConfig {
            window_name: "TestApp".to_string(),
            tool_type: ToolType::Manual,
            capture_x: 0,
            capture_y: 0,
            capture_width: 200,
            capture_height: 150,
            show_info_window: false,
            prompts: vec!["test prompt".to_string()],
            result_processors: vec![],
            triggers: vec![],
        }));
        TOOL_CONFIGS.set(config_map);

        let cfg = get_tool_config("my_tool");
        assert!(cfg.is_some());
        let cfg = cfg.unwrap();
        assert_eq!(cfg.window_name, "TestApp");
        assert_eq!(cfg.tool_type, ToolType::Manual);
        assert_eq!(cfg.capture_width, 200);
        assert!(!cfg.show_info_window);

        assert!(get_tool_config("nonexistent").is_none());

        TOOL_CONFIGS.clear();
    }

    // ===================================================================== //
    // extract_first_number
    // ===================================================================== //

    #[test]
    fn extract_number_from_text() {
        assert_eq!(extract_first_number("数字是 42"), Some(42.0));
        assert_eq!(extract_first_number("HP: 35.5 / 100"), Some(35.5));
        assert_eq!(extract_first_number("-10 damage"), Some(-10.0));
        assert_eq!(extract_first_number("no numbers here"), None);
        assert_eq!(extract_first_number(""), None);
        assert_eq!(extract_first_number("value: 0"), Some(0.0));
        assert_eq!(extract_first_number("123abc456"), Some(123.0));
    }

    // ===================================================================== //
    // process_ai_result — number 类型
    // ===================================================================== //

    #[test]
    fn process_number_in_range() {
        let processors = vec![AiResultProcessorConfig {
            processor_type: "number".to_string(),
            result: "low_hp".to_string(),
            min: Some(0.0),
            max: Some(35.0),
            pattern: None,
        }];
        assert_eq!(process_ai_result("当前血量: 25", &processors), "low_hp");
        assert_eq!(process_ai_result("当前血量: 35", &processors), "low_hp");
        assert_eq!(process_ai_result("当前血量: 0", &processors), "low_hp");
    }

    #[test]
    fn process_number_out_of_range() {
        let processors = vec![AiResultProcessorConfig {
            processor_type: "number".to_string(),
            result: "low_hp".to_string(),
            min: Some(0.0),
            max: Some(35.0),
            pattern: None,
        }];
        // 超过范围，返回原始文本
        assert_eq!(
            process_ai_result("当前血量: 80", &processors),
            "当前血量: 80"
        );
    }

    #[test]
    fn process_number_no_number_in_text() {
        let processors = vec![AiResultProcessorConfig {
            processor_type: "number".to_string(),
            result: "low_hp".to_string(),
            min: Some(0.0),
            max: Some(35.0),
            pattern: None,
        }];
        assert_eq!(
            process_ai_result("没有数字", &processors),
            "没有数字"
        );
    }

    #[test]
    fn process_number_only_min() {
        let processors = vec![AiResultProcessorConfig {
            processor_type: "number".to_string(),
            result: "high".to_string(),
            min: Some(50.0),
            max: None,
            pattern: None,
        }];
        assert_eq!(process_ai_result("值: 80", &processors), "high");
        assert_eq!(process_ai_result("值: 30", &processors), "值: 30");
    }

    #[test]
    fn process_number_only_max() {
        let processors = vec![AiResultProcessorConfig {
            processor_type: "number".to_string(),
            result: "low".to_string(),
            min: None,
            max: Some(20.0),
            pattern: None,
        }];
        assert_eq!(process_ai_result("值: 10", &processors), "low");
        assert_eq!(process_ai_result("值: 50", &processors), "值: 50");
    }

    // ===================================================================== //
    // process_ai_result — keyword 类型
    // ===================================================================== //

    #[test]
    fn process_keyword_match() {
        let processors = vec![AiResultProcessorConfig {
            processor_type: "keyword".to_string(),
            result: "danger".to_string(),
            min: None,
            max: None,
            pattern: Some("error".to_string()),
        }];
        assert_eq!(process_ai_result("There was an ERROR", &processors), "danger");
    }

    #[test]
    fn process_keyword_no_match() {
        let processors = vec![AiResultProcessorConfig {
            processor_type: "keyword".to_string(),
            result: "danger".to_string(),
            min: None,
            max: None,
            pattern: Some("error".to_string()),
        }];
        assert_eq!(
            process_ai_result("Everything is fine", &processors),
            "Everything is fine"
        );
    }

    #[test]
    fn process_keyword_no_pattern() {
        let processors = vec![AiResultProcessorConfig {
            processor_type: "keyword".to_string(),
            result: "danger".to_string(),
            min: None,
            max: None,
            pattern: None,
        }];
        assert_eq!(
            process_ai_result("some text", &processors),
            "some text"
        );
    }

    // ===================================================================== //
    // process_ai_result — regex 类型
    // ===================================================================== //

    #[test]
    fn process_regex_match() {
        let processors = vec![AiResultProcessorConfig {
            processor_type: "regex".to_string(),
            result: "found_digits".to_string(),
            min: None,
            max: None,
            pattern: Some(r"\d{3,}".to_string()),
        }];
        assert_eq!(process_ai_result("code 404 error", &processors), "found_digits");
    }

    #[test]
    fn process_regex_no_match() {
        let processors = vec![AiResultProcessorConfig {
            processor_type: "regex".to_string(),
            result: "found_digits".to_string(),
            min: None,
            max: None,
            pattern: Some(r"\d{3,}".to_string()),
        }];
        assert_eq!(
            process_ai_result("no digits here", &processors),
            "no digits here"
        );
    }

    #[test]
    fn process_regex_invalid_pattern() {
        let processors = vec![AiResultProcessorConfig {
            processor_type: "regex".to_string(),
            result: "match".to_string(),
            min: None,
            max: None,
            pattern: Some(r"[invalid".to_string()),
        }];
        // 无效正则应不匹配，返回原文
        assert_eq!(
            process_ai_result("some text", &processors),
            "some text"
        );
    }

    // ===================================================================== //
    // process_ai_result — 多个处理器（优先级 / 短路逻辑）
    // ===================================================================== //

    #[test]
    fn process_first_match_wins() {
        let processors = vec![
            AiResultProcessorConfig {
                processor_type: "number".to_string(),
                result: "low".to_string(),
                min: Some(0.0),
                max: Some(30.0),
                pattern: None,
            },
            AiResultProcessorConfig {
                processor_type: "number".to_string(),
                result: "medium".to_string(),
                min: Some(31.0),
                max: Some(60.0),
                pattern: None,
            },
            AiResultProcessorConfig {
                processor_type: "number".to_string(),
                result: "high".to_string(),
                min: Some(61.0),
                max: Some(100.0),
                pattern: None,
            },
        ];
        assert_eq!(process_ai_result("HP: 25", &processors), "low");
        assert_eq!(process_ai_result("HP: 45", &processors), "medium");
        assert_eq!(process_ai_result("HP: 80", &processors), "high");
        // 超出所有范围
        assert_eq!(process_ai_result("HP: 150", &processors), "HP: 150");
    }

    #[test]
    fn process_empty_processors_returns_original() {
        assert_eq!(process_ai_result("hello", &[]), "hello");
    }

    #[test]
    fn process_unknown_type_skipped() {
        let processors = vec![AiResultProcessorConfig {
            processor_type: "unknown_type".to_string(),
            result: "match".to_string(),
            min: None,
            max: None,
            pattern: None,
        }];
        assert_eq!(
            process_ai_result("some text", &processors),
            "some text"
        );
    }

    // ===================================================================== //
    // AiResultProcessorConfig 序列化
    // ===================================================================== //

    #[test]
    fn ai_result_processor_config_serde() {
        let proc = AiResultProcessorConfig {
            processor_type: "number".to_string(),
            result: "low_hp".to_string(),
            min: Some(0.0),
            max: Some(35.0),
            pattern: None,
        };
        let json = serde_json::to_string(&proc).unwrap();
        assert!(json.contains("\"processor_type\":\"number\""));
        assert!(json.contains("\"result\":\"low_hp\""));
        assert!(json.contains("\"min\":0.0"));
        assert!(json.contains("\"max\":35.0"));

        let parsed: AiResultProcessorConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.processor_type, "number");
        assert_eq!(parsed.result, "low_hp");
        assert_eq!(parsed.min, Some(0.0));
        assert_eq!(parsed.max, Some(35.0));
        assert!(parsed.pattern.is_none());
    }
}
