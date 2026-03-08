//! AI 工具运行时管理模块
//!
//! 管理与 AI 工具相关的运行时状态：
//! - 缓存焦点窗口匹配到的 ai_tools 窗口名
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

// ========================================================================= //
// 全局缓存
// ========================================================================= //

/// 当前焦点窗口匹配到的 ai_tools 窗口名（不区分大小写匹配后的原始 window_name）。
/// 当焦点窗口不匹配任何 ai_tools 配置时为 None。
static MATCHED_AI_TOOL_WINDOW: Mutex<Option<String>> = Mutex::new(None);

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
    let matched_window = get_matched_ai_tool_window();
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
        matched_window,
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
// 公共接口 — 窗口名匹配
// ========================================================================= //

/// 获取当前匹配到的 AI 工具窗口名
pub fn get_matched_ai_tool_window() -> Option<String> {
    MATCHED_AI_TOOL_WINDOW
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

/// 更新当前匹配到的 AI 工具窗口名
pub fn set_matched_ai_tool_window(name: Option<String>) {
    if let Ok(mut guard) = MATCHED_AI_TOOL_WINDOW.lock() {
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
    let window_name = get_matched_ai_tool_window();
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

    Some((window_name, items))
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

    let labels_to_destroy: Vec<String> = {
        let guard = match INFO_WINDOW_VISIBLE.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        match guard.as_ref() {
            Some(map) => map.keys().map(|name| info_window_label(name)).collect(),
            None => return,
        }
    }; // 锁已释放

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
/// 性能优化：当需要 AI 处理时，使用内存中截图→PNG→base64 的零磁盘 I/O 路径，
/// 仅在 keep_screenshots 模式下才额外写磁盘保存。
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

    // AI 路径：直接在内存中完成截图→PNG→base64，避免磁盘 I/O 和双重编解码
    let x = cfg.capture_x;
    let y = cfg.capture_y;
    let w = cfg.capture_width;
    let h = cfg.capture_height;

    let image_b64 = match tokio::task::spawn_blocking(move || {
        screenshot::capture_screen_region_as_png_base64(x, y, w, h)
    })
    .await
    {
        Ok(Ok(b64)) => b64,
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

    // 如果开启了截图保留模式，异步写入磁盘（不阻塞 AI 调用流程）
    if KEEP_SCREENSHOTS.load(Ordering::Relaxed) {
        let screenshots_dir = screenshots_dir.to_path_buf();
        let prefix = file_prefix.to_string();
        let b64_clone = image_b64.clone();
        tokio::task::spawn_blocking(move || {
            let ts = chrono::Local::now().format("%Y%m%d_%H%M%S_%3f");
            let filename = format!("{}_{}.png", prefix, ts);
            let save_path = screenshots_dir.join(&filename);
            if let Ok(png_bytes) = base64::Engine::decode(
                &base64::engine::general_purpose::STANDARD,
                &b64_clone,
            ) {
                let _ = std::fs::write(&save_path, &png_bytes);
            }
        });
    }

    // 从 settings 读取 API 配置
    let (api_key, base_url, model) = {
        let app_clone = app.clone();
        tokio::task::spawn_blocking(move || {
            use tauri::Manager;
            let app_state: tauri::State<crate::app_state::AppState> = app_clone.state();
            let storage = app_state.storage.lock().unwrap();
            let s = &storage.data.settings;
            (
                s.ai_api_key.to_string(),
                s.ai_chat_base_url.to_string(),
                s.ai_chat_model.to_string(),
            )
        })
        .await
        .unwrap_or_else(|_| (String::new(), String::new(), String::new()))
    };

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

    // 匹配 triggers（如果有）
    if !cfg.triggers.is_empty() {
        let matched = match_triggers(&ai_response, &cfg.triggers);
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
                // 自动模式：按间隔不断截图 + AI 识别
                // 优化：每 10 次循环才重新读取 interval 设置，减少 spawn_blocking 开销
                let mut cached_interval_secs: f64 = {
                    let app_clone = app.clone();
                    tokio::task::spawn_blocking(move || {
                        use tauri::Manager;
                        let app_state: tauri::State<crate::app_state::AppState> = app_clone.state();
                        let storage = app_state.storage.lock().unwrap();
                        storage.data.settings.ai_screenshot_interval.max(0.1) as f64
                    })
                    .await
                    .unwrap_or(1.0)
                };
                let mut loop_count: u32 = 0;
                const REFRESH_INTERVAL_EVERY_N: u32 = 10;

                loop {
                    // 定期刷新 interval 设置（避免每次循环都 spawn_blocking）
                    if loop_count > 0 && loop_count % REFRESH_INTERVAL_EVERY_N == 0 {
                        let app_clone = app.clone();
                        if let Ok(v) = tokio::task::spawn_blocking(move || {
                            use tauri::Manager;
                            let app_state: tauri::State<crate::app_state::AppState> = app_clone.state();
                            let storage = app_state.storage.lock().unwrap();
                            storage.data.settings.ai_screenshot_interval.max(0.1) as f64
                        })
                        .await
                        {
                            cached_interval_secs = v;
                        }
                    }
                    loop_count = loop_count.wrapping_add(1);

                    process_capture_with_ai(
                        &cfg,
                        &file_prefix,
                        &screenshots_dir,
                        &name_clone,
                        &app,
                    )
                    .await;

                    tokio::time::sleep(std::time::Duration::from_secs_f64(cached_interval_secs)).await;
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
    if let Ok(mut guard) = INFO_WINDOW_VISIBLE.lock() {
        *guard = None;
    }

    // 清空启用状态
    set_tool_enabled_map(None);

    // 清空匹配窗口名
    set_matched_ai_tool_window(None);

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
