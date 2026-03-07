//! AI 工具运行时管理模块
//!
//! 管理与 AI 工具相关的运行时状态：
//! - 缓存焦点窗口匹配到的 ai_tools 进程名
//! - 为每个启用的工具维护一个独立的后台任务
//! - 提供工具开关控制接口

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::task::JoinHandle;

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
}

/// 单个工具的调试状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiToolDebugItem {
    /// 工具名
    pub name: String,
    /// 是否启用
    pub enabled: bool,
    /// 是否有正在运行的后台任务
    pub has_task: bool,
    /// 后台任务的 tokio task ID（若有运行中的任务）
    pub task_id: Option<String>,
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
        map.iter()
            .map(|(name, enabled)| {
                let task_id = tasks
                    .get(name)
                    .map(|handle| format!("{}", handle.id()));
                AiToolDebugItem {
                    name: name.clone(),
                    enabled: *enabled,
                    has_task: tasks.contains_key(name),
                    task_id,
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

// ========================================================================= //
// 公共接口 — 任务管理
// ========================================================================= //

/// 为指定工具启动一个后台任务（当前任务体为空占位）
pub async fn start_tool_task(tool_name: String) {
    let mut tasks = get_task_map().lock().await;

    // 如果已存在任务，先终止
    if let Some(handle) = tasks.remove(&tool_name) {
        handle.abort();
    }

    let name_clone = tool_name.clone();
    let handle = tokio::spawn(async move {
        // 当前任务不做任何事，仅作为占位
        // 后续将在此处添加截图 + AI 识别逻辑
        #[cfg(debug_assertions)]
        println!("[AiToolManager] Task started for tool: {}", name_clone);

        // 保持任务存活直到被 abort
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
        }
    });

    tasks.insert(tool_name, handle);
}

/// 停止指定工具的后台任务
pub async fn stop_tool_task(tool_name: &str) {
    let mut tasks = get_task_map().lock().await;
    if let Some(handle) = tasks.remove(tool_name) {
        handle.abort();
        #[cfg(debug_assertions)]
        println!("[AiToolManager] Task stopped for tool: {}", tool_name);
    }
}

/// 停止所有工具的后台任务并清空状态
pub async fn clear_all() {
    // 清空任务
    {
        let mut tasks = get_task_map().lock().await;
        for (name, handle) in tasks.drain() {
            handle.abort();
            #[cfg(debug_assertions)]
            println!("[AiToolManager] Task aborted for tool: {}", name);
        }
    }

    // 清空启用状态
    set_tool_enabled_map(None);

    // 清空匹配进程
    set_matched_ai_tool_process(None);

    #[cfg(debug_assertions)]
    println!("[AiToolManager] All data cleared");
}

/// 根据 tool_data 初始化工具列表：设置启用状态并为 auto_start 工具启动任务
pub async fn initialize_tools(tools: &[(String, bool)]) {
    // 先清除旧状态
    clear_all().await;

    // 构建启用映射
    let mut map = HashMap::new();
    for (name, auto_start) in tools {
        map.insert(name.clone(), *auto_start);
    }
    set_tool_enabled_map(Some(map));

    // 为 auto_start 的工具启动任务
    for (name, auto_start) in tools {
        if *auto_start {
            start_tool_task(name.clone()).await;
        }
    }
}

/// 切换单个工具的启用状态，返回切换后的状态
pub async fn toggle_tool(tool_name: &str, enabled: bool) -> bool {
    let changed = set_tool_enabled(tool_name, enabled);
    if !changed {
        return enabled;
    }

    if enabled {
        start_tool_task(tool_name.to_string()).await;
    } else {
        stop_tool_task(tool_name).await;
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
}
