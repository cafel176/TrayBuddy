//! 系统文件关联集成
//!
//! 处理用户通过系统"打开方式"（双击 `.tbuddy` / `.sbuddy` 文件）
//! 启动应用时的待导入 Mod 包队列。前端 Mods 页面 mount 后调用
//! [`take_pending_open_mod_archives`] 取出队列并执行自动导入。

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
