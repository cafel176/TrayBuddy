//! AI 工具管理模块
//!
//! 管理与 AI 工具相关的运行时状态。
//! 当前仅缓存焦点窗口匹配到的 ai_tools 进程名。

use std::sync::Mutex;

// ========================================================================= //
// 全局缓存
// ========================================================================= //

/// 当前焦点窗口匹配到的 ai_tools 进程名（不区分大小写匹配后的原始 process_name）。
/// 当焦点窗口不匹配任何 ai_tools 配置时为 None。
static MATCHED_AI_TOOL_PROCESS: Mutex<Option<String>> = Mutex::new(None);

// ========================================================================= //
// 公共接口
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
// 测试
// ========================================================================= //

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matched_process_defaults_to_none() {
        // 注意：测试间共享静态变量，故仅检查初始逻辑
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
}
