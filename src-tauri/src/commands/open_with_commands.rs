//! Open-with / file association integration

use crate::app_state::AppState;
use tauri::State;

/// 取出并清空待处理的“通过系统打开的 Mod 包路径”队列。
///
/// 前端（Mods 页面）在 mount 后调用，以实现：双击 .tbuddy/.sbuddy → 自动导入。
#[tauri::command]
pub(crate) fn take_pending_open_mod_archives(state: State<'_, AppState>) -> Vec<String> {
    let mut q = state.pending_open_mod_archives.lock().unwrap();
    std::mem::take(&mut *q)
}
