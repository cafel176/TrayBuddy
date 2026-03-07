//! Mod 资源管理命令
//!
//! 提供前端调用的 Mod 资源加载、切换、卸载等 IPC 命令：
//! - 加载/切换当前 Mod（读取资源清单、初始化状态机、重建渲染窗口）
//! - 卸载 Mod（清理资源、关闭渲染窗口）
//! - 查询 Mod 列表与资源详情

use crate::app_state::AppState;
use crate::get_i18n_text;
use crate::modules::constants::{
    MOD_LOGIN_EVENT_DELAY_SECS, STATE_IDLE, WINDOW_LABEL_ANIMATION, WINDOW_LABEL_LIVE2D,
    WINDOW_LABEL_MODS, WINDOW_LABEL_PNGREMIX, WINDOW_LABEL_THREED,
};
use crate::modules::resource::{
    self, AiToolsConfig, AssetInfo, AudioInfo, CharacterInfo, ModInfo, ModType, StateInfo, TextInfo, TriggerInfo,
};
use crate::modules::storage::{ModData, Storage};
use crate::{
    recreate_animation_window, recreate_live2d_window, recreate_pngremix_window,
    recreate_threed_window, restore_window_icons_sync, update_tray_icon_async,
    update_tray_icon_sync, update_window_icons_async,
};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};


// ========================================================================= //
// Mod 资源管理命令
// ========================================================================= //

/// 获取 Mod 搜索路径列表
#[tauri::command]
pub(crate) fn get_mod_search_paths(state: State<'_, AppState>) -> Vec<String> {
    let rm = state.resource_manager.lock().unwrap();
    rm.search_paths
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

/// 获取可用的 Mod 列表
#[tauri::command]
pub(crate) fn get_available_mods(state: State<'_, AppState>) -> Vec<String> {
    let mut rm = state.resource_manager.lock().unwrap();
    rm.list_mods()
}

/// 获取 Mod 列表的“快速摘要”（不解密 .sbuddy）
///
/// 用途：用于 Mods 页面列表快速渲染（显示版本/类型等），
/// 避免启动时对大量 `.sbuddy` 逐个解密导致卡顿。
#[tauri::command]
pub(crate) fn get_mod_summaries_fast(state: State<'_, AppState>) -> Vec<resource::ModSummary> {
    let mut rm = state.resource_manager.lock().unwrap();
    rm.list_mod_summaries_fast()
}


/// Mod 加载后的公共 storage 更新逻辑
///
/// 处理数据迁移（旧文件夹名 → manifest.id）、更新 current_mod、初始化 mod_data。
/// 被 `load_mod_common`（运行时切换）和启动时自动加载共同使用。
pub(crate) fn apply_mod_storage_update(
    storage: &mut Storage,
    mod_info: &ModInfo,
    legacy_key: Option<&str>,
) {

    let manifest_id = mod_info.manifest.id.to_string();

    // 兼容迁移：旧版可能用文件夹名作为 key
    if let Some(key) = legacy_key {
        if !key.is_empty() && key != manifest_id {
            if storage.data.info.mod_data.contains_key(key) {
                if !storage.data.info.mod_data.contains_key(&manifest_id) {
                    if let Some(mut old) = storage.data.info.mod_data.remove(key) {
                        old.mod_id = manifest_id.clone();
                        storage.data.info.mod_data.insert(manifest_id.clone(), old);
                    }
                } else {
                    let _ = storage.data.info.mod_data.remove(key);
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
    app: AppHandle,
    state: State<'_, AppState>,
    legacy_key: Option<String>,
    load: F,
) -> Result<Arc<ModInfo>, String>
where
    F: FnOnce(&mut crate::modules::resource::ResourceManager) -> Result<Arc<ModInfo>, String>,
{
    // 0. 记录当前 Mod 类型（用于后续判断是否跨类型切换）
    // 同时记录旧 mod_id（若为 archive mod，用于切换后主动释放内存缓存）。
    let (old_mod_type, old_archive_mod_id) = {
        let rm = state.resource_manager.lock().unwrap();
        let old_type = rm.current_mod.as_ref().map(|m| m.manifest.mod_type);
        let old_archive_id = rm.current_mod.as_ref().and_then(|m| {
            let p = m.path.to_string_lossy();
            p.strip_prefix("tbuddy-archive://").map(|s| s.to_string())
        });
        (old_type, old_archive_id)
    };

    // 关闭除 mods 以外的所有窗口
    // 理由：每个 Mod 的动画窗口参数可能完全不同，热重载不如重建窗口稳定。
    //
    // 策略：
    // - 渲染窗口（animation/live2d/pngremix/threed）注册了 CloseRequested 拦截器（close → hide），
    //   这里调用 close() 会将其隐藏以复用 WebView2，减少“被迫启动”的冷启动次数。
    // - 工具窗口（destroy_on_close: true）则会按 Tauri 默认行为被销毁。
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
        apply_mod_storage_update(&mut storage, &mod_info, legacy_key.as_deref());
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

    // 4.5. 更新全局键盘监听开关
    state.global_keyboard_enabled.store(
        mod_info.manifest.global_keyboard,
        std::sync::atomic::Ordering::Relaxed,
    );

    // 4.6. 更新全局鼠标监听开关
    state.global_mouse_enabled.store(
        mod_info.manifest.global_mouse,
        std::sync::atomic::Ordering::Relaxed,
    );

    // 5. 重建渲染窗口
    // 跨类型切换时（Sequence ↔ Live2D），必须 destroy() 旧类型的渲染窗口。
    // 因为渲染窗口注册了 CloseRequested 拦截器（close → hide），
    // 步骤 0 的 close() 只会隐藏而非销毁，旧窗口会在后台继续播放音频。
    let new_mod_type = mod_info.manifest.mod_type;
    if old_mod_type.is_some() && old_mod_type != Some(new_mod_type) {
        let old_label = match old_mod_type.unwrap() {
            ModType::Live2d => WINDOW_LABEL_LIVE2D,
            ModType::Sequence => WINDOW_LABEL_ANIMATION,
            ModType::Pngremix => WINDOW_LABEL_PNGREMIX,
            ModType::ThreeD => WINDOW_LABEL_THREED,
        };
        if let Some(old_window) = app.get_webview_window(old_label) {
            let _ = old_window.destroy();
            tokio::time::sleep(std::time::Duration::from_millis(
                crate::modules::constants::WINDOW_RESIZE_DELAY_MS + 200,
            ))
            .await;
        }
    }

    match new_mod_type {
        ModType::Live2d => {
            recreate_live2d_window(app.clone()).await?;
        }
        ModType::Sequence => {
            recreate_animation_window(app.clone()).await?;
        }
        ModType::Pngremix => {
            recreate_pngremix_window(app.clone()).await?;
        }
        ModType::ThreeD => {
            recreate_threed_window(app.clone()).await?;
        }
    }

    // 5.5 低内存策略：切换完成后主动淘汰旧 archive 的“已加载字节”，避免常驻占用
    if let Some(old_id) = old_archive_mod_id {
        // 若新 mod 恰好还是同一个 id，则不做处理
        if old_id != mod_info.manifest.id.to_string() {
            let mut store = state.archive_store.lock().unwrap();
            store.evict_loaded(&old_id);
        }
    }

    // 6. 触发登录/加载完成事件（如播放打招呼语音）
    tokio::time::sleep(std::time::Duration::from_secs(MOD_LOGIN_EVENT_DELAY_SECS)).await;
    #[cfg(target_os = "windows")]
    crate::trigger_login_events(&app);
    #[cfg(not(target_os = "windows"))]
    crate::trigger_login_events_non_windows(&app);


    Ok(mod_info)
}

/// 从指定路径加载 Mod（支持文件夹路径和 .tbuddy 文件路径）
///
/// 用于导入后立即加载某个具体 mod
#[tauri::command]
pub(crate) async fn load_mod_from_path(
    mod_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Arc<ModInfo>, String> {
    use std::path::PathBuf;

    let target_path = PathBuf::from(&mod_path);

    // 如果是 .tbuddy 或 .sbuddy 文件，通过 archive store 中的 mod_id 加载
    let is_archive_file = target_path
        .extension()
        .map(|e| e == "tbuddy" || e == "sbuddy")
        .unwrap_or(false);
    if is_archive_file {
        // 从 archive store 中查找对应的 mod_id
        let archive_store = {
            let rm = state.resource_manager.lock().unwrap();
            rm.get_archive_store().cloned()
        };
        let mod_id = archive_store.and_then(|store| {
            let mut s = store.lock().unwrap();

            // 用文件名推断 mod_id: "{mod_id}.tbuddy" 或 "{mod_id}.sbuddy"
            let file_stem = target_path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            if s.contains(&file_stem) {
                Some(file_stem)
            } else {
                None
            }
        });

        if let Some(id) = mod_id {
            let legacy_key = id.clone();
            return load_mod_common(app, state, Some(legacy_key), move |rm| rm.load_mod(&id)).await;
        } else {
            return Err(format!("Archive mod not found in store for path: {}", mod_path));
        }
    }

    // 文件夹路径：安全限制 + 原有逻辑
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
pub(crate) async fn load_mod(
    mod_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Arc<ModInfo>, String> {
    let legacy_key = mod_id.clone();

    load_mod_common(app, state, Some(legacy_key), move |rm| rm.load_mod(&mod_id)).await
}

/// 卸载当前 Mod
#[tauri::command]
pub(crate) fn unload_mod(app: AppHandle, state: State<'_, AppState>) -> bool {
    // 卸载前记录当前 archive mod_id（如果是 archive mod）
    let old_archive_mod_id = {
        let rm = state.resource_manager.lock().unwrap();
        rm.current_mod.as_ref().and_then(|m| {
            let p = m.path.to_string_lossy();
            p.strip_prefix("tbuddy-archive://").map(|s| s.to_string())
        })
    };

    let result = {
        let mut rm = state.resource_manager.lock().unwrap();
        rm.unload_mod()
    };
    // rm 锁已释放

    // 卸载后主动淘汰该 archive 的已加载字节（保留 source 映射，后续需要可再加载）
    if result {
        if let Some(old_id) = old_archive_mod_id {
            let mut store = state.archive_store.lock().unwrap();
            store.evict_loaded(&old_id);
        }

        // 卸载后恢复默认托盘图标和窗口图标（同步版本，因为函数本身是同步的）
        update_tray_icon_sync(&app);
        restore_window_icons_sync(&app);
    }

    result
}

/// 获取当前加载的 Mod 信息
#[tauri::command]
pub(crate) fn get_current_mod(state: State<'_, AppState>) -> Option<Arc<ModInfo>> {
    let rm = state.resource_manager.lock().unwrap();
    rm.current_mod.clone()
}

/// 获取当前 Mod 的路径
#[tauri::command]
pub(crate) fn get_mod_path(state: State<'_, AppState>) -> Option<String> {
    let rm = state.resource_manager.lock().unwrap();
    rm.current_mod
        .as_ref()
        .map(|m| m.path.to_string_lossy().into_owned())
}

/// 判断指定路径是否存在（仅允许检查当前 Mod 目录内的路径）
///
/// 对于 archive mod：检查 archive 内文件是否存在
/// 对于文件夹 mod：检查磁盘文件系统
///
/// # 锁序安全
/// 先从 `resource_manager` 提取 mod 路径信息并释放锁，再按需获取 `archive_store` 锁，
/// 避免同时持有两把锁。
#[tauri::command]
pub(crate) fn path_exists(path: String, state: State<'_, AppState>) -> bool {
    use std::path::PathBuf;

    // 从 rm 提取所需信息后立即释放锁
    let mod_path = {
        let rm = state.resource_manager.lock().unwrap();
        let Some(mod_info) = rm.current_mod.as_ref() else {
            return false;
        };
        mod_info.path.clone()
    };
    // rm 锁已释放

    let mod_path_str = mod_path.to_string_lossy();

    // archive mod：tbuddy-archive://{mod_id}
    if mod_path_str.starts_with("tbuddy-archive://") {
        let mod_id = &mod_path_str["tbuddy-archive://".len()..];
        // path 可能是绝对路径 "tbuddy-archive://mod_id/asset/xxx" 或相对路径 "asset/xxx"
        let relative = if path.starts_with(&*mod_path_str) {
            path[mod_path_str.len()..].trim_start_matches('/').to_string()
        } else {
            // 兼容：path 可能是 "tbuddy-archive://mod_id/asset/xxx" 格式
            path.clone()
        };
        let mut store = state.archive_store.lock().unwrap();
        return store.file_exists(mod_id, &relative);
    }

    // 文件夹 mod：原有逻辑
    let Ok(base) = dunce::canonicalize(&mod_path) else {
        return false;
    };

    let p = PathBuf::from(path);
    let Ok(p) = dunce::canonicalize(&p) else {
        return false;
    };

    if !p.starts_with(&base) {
        return false;
    }

    p.exists()
}

/// 获取边框配置
#[tauri::command]
pub(crate) fn get_border_config(state: State<'_, AppState>) -> Option<resource::BorderConfig> {
    let rm = state.resource_manager.lock().unwrap();
    rm.current_mod.as_ref().map(|m| m.manifest.border.clone())
}

/// 获取角色配置
#[tauri::command]
pub(crate) fn get_character_config(state: State<'_, AppState>) -> Option<resource::CharacterConfig> {
    let rm = state.resource_manager.lock().unwrap();
    rm.current_mod
        .as_ref()
        .map(|m| m.manifest.character.clone())
}

/// 根据名称获取状态信息
#[tauri::command]
pub(crate) fn get_state_by_name(name: String, state: State<'_, AppState>) -> Option<StateInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_state_by_name(&name).cloned()
}

/// 根据事件名获取触发器信息
#[tauri::command]
pub(crate) fn get_trigger_by_event(event: String, state: State<'_, AppState>) -> Option<TriggerInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_trigger_by_event(&event).cloned()
}

/// 根据名称获取动画资产信息
#[tauri::command]
pub(crate) fn get_asset_by_name(name: String, state: State<'_, AppState>) -> Option<AssetInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_asset_by_name(&name).cloned()
}

/// 根据语言和名称获取音频信息
#[tauri::command]
pub(crate) fn get_audio_by_name(
    lang: String,
    name: String,
    state: State<'_, AppState>,
) -> Option<AudioInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_audio_by_name(&lang, &name).cloned()
}

/// 根据语言和名称获取文本信息
#[tauri::command]
pub(crate) fn get_text_by_name(
    lang: String,
    name: String,
    state: State<'_, AppState>,
) -> Option<TextInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_text_by_name(&lang, &name).cloned()
}

/// 根据语言获取角色信息
#[tauri::command]
pub(crate) fn get_info_by_lang(lang: String, state: State<'_, AppState>) -> Option<CharacterInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_info_by_lang(&lang).cloned()
}

/// 获取气泡样式配置
#[tauri::command]
pub(crate) fn get_bubble_style(state: State<'_, AppState>) -> Option<serde_json::Value> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_bubble_style()
}

/// 获取 AI 工具配置
#[tauri::command]
pub(crate) fn get_ai_tools(state: State<'_, AppState>) -> Option<AiToolsConfig> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_ai_tools()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::resource::{build_test_mod_info, ModManifest};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_storage_path(tag: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("traybuddy_storage_{}_{}.json", tag, nanos))
    }

    #[test]
    fn apply_mod_storage_update_migrates_legacy_key_and_sets_current() {
        let path = temp_storage_path("migrate");
        let mut storage = Storage::new_with_path(path.clone());

        storage.data.info.mod_data.insert(
            "legacy".to_string(),
            ModData {
                mod_id: "legacy".to_string(),
                value: 7,
            },
        );

        let mut manifest = ModManifest::default();
        manifest.id = "new_mod".into();
        manifest.mod_data_default_int = 42;
        let mod_info = build_test_mod_info(manifest);

        apply_mod_storage_update(&mut storage, &mod_info, Some("legacy"));

        assert_eq!(&*storage.data.info.current_mod, "new_mod");
        assert!(!storage.data.info.mod_data.contains_key("legacy"));
        let data = storage.data.info.mod_data.get("new_mod").unwrap();
        assert_eq!(data.value, 7);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn apply_mod_storage_update_keeps_existing_manifest_key() {
        let path = temp_storage_path("conflict");
        let mut storage = Storage::new_with_path(path.clone());

        storage.data.info.mod_data.insert(
            "legacy".to_string(),
            ModData {
                mod_id: "legacy".to_string(),
                value: 1,
            },
        );
        storage.data.info.mod_data.insert(
            "new_mod".to_string(),
            ModData {
                mod_id: "new_mod".to_string(),
                value: 99,
            },
        );

        let mut manifest = ModManifest::default();
        manifest.id = "new_mod".into();
        let mod_info = build_test_mod_info(manifest);

        apply_mod_storage_update(&mut storage, &mod_info, Some("legacy"));

        assert!(!storage.data.info.mod_data.contains_key("legacy"));
        let data = storage.data.info.mod_data.get("new_mod").unwrap();
        assert_eq!(data.value, 99);

        let _ = std::fs::remove_file(path);
    }
}

