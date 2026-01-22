mod modules;

use modules::constants::{
    ANIMATION_WINDOW_BASE_WIDTH, ANIMATION_WINDOW_BASE_HEIGHT,
    ANIMATION_BORDER,
    STATE_IDLE,
};
use modules::environment::get_current_datetime;
use modules::resource::{ResourceManager, StateInfo, TriggerInfo, AssetInfo, AudioInfo, TextInfo, CharacterInfo, ModInfo};
use modules::state::StateManager;
use modules::storage::{Storage, UserSettings, UserInfo};
use modules::media_observer::{MediaObserver, MediaPlaybackStatus};
use std::sync::Mutex;
use tauri::{Manager, State, WebviewWindowBuilder, WebviewUrl, LogicalSize, LogicalPosition, Emitter};

// ========================================================================= //
// 应用全局状态
// ========================================================================= //

/// 应用全局状态，通过 Tauri 的状态管理器在各处共享
struct AppState {
    /// 资源管理器：负责 Mod 的加载、卸载和资源查询
    resource_manager: Mutex<ResourceManager>,
    /// 状态管理器：负责角色状态的切换和事件通知
    state_manager: Mutex<StateManager>,
    /// 存储管理器：负责用户设置和信息的持久化
    storage: Mutex<Storage>,
    /// 媒体监听器：监听系统媒体播放状态（仅保持引用，实际在独立线程运行）
    #[allow(dead_code)]
    media_observer: Mutex<Option<MediaObserver>>,
}

// ========================================================================= //
// 常量查询命令
// ========================================================================= //

/// 获取浮点型常量（窗口尺寸、缩放比例等）
#[tauri::command]
fn get_const_float(state: State<'_, AppState>) -> std::collections::HashMap<String, f64> {
    let storage = state.storage.lock().unwrap();
    let scale = storage.data.settings.animation_scale as f64;
    
    let mut map = std::collections::HashMap::new();
    map.insert("animation_window_width".to_string(), ANIMATION_WINDOW_BASE_WIDTH * scale);
    map.insert("animation_window_height".to_string(), ANIMATION_WINDOW_BASE_HEIGHT * scale);
    map.insert("animation_scale".to_string(), scale);
    map
}

/// 获取字符串型常量（资源名称等）
#[tauri::command]
fn get_const_text() -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    map.insert(ANIMATION_BORDER.to_string(), ANIMATION_BORDER.to_string());
    map
}

// ========================================================================= //
// 用户设置命令
// ========================================================================= //

/// 获取用户设置
#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> UserSettings {
    let storage = state.storage.lock().unwrap();
    storage.data.settings.clone()
}

/// 更新用户设置，同时发送设置变更事件通知前端
#[tauri::command]
fn update_settings(settings: UserSettings, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut storage = state.storage.lock().unwrap();
    storage.update_settings(settings.clone())?;
    let _ = app.emit("settings-change", settings);
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

// ========================================================================= //
// Mod 资源管理命令
// ========================================================================= //

/// 获取 Mod 搜索路径列表
#[tauri::command]
fn get_mod_search_paths(state: State<'_, AppState>) -> Vec<String> {
    let rm = state.resource_manager.lock().unwrap();
    rm.search_paths.iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}

/// 获取可用的 Mod 列表
#[tauri::command]
fn get_available_mods(state: State<'_, AppState>) -> Vec<String> {
    let rm = state.resource_manager.lock().unwrap();
    rm.list_mods()
}

/// 加载指定 Mod，同时更新用户信息中的 current_mod
#[tauri::command]
fn load_mod(mod_name: String, state: State<'_, AppState>) -> Result<ModInfo, String> {
    let mut rm = state.resource_manager.lock().unwrap();
    let mod_info = rm.load_mod(&mod_name)?;
    
    // 自动更新用户信息并持久化
    let mut storage = state.storage.lock().unwrap();
    storage.data.info.current_mod = mod_name;
    let _ = storage.save();
    
    Ok(mod_info)
}

/// 卸载当前 Mod
#[tauri::command]
fn unload_mod(state: State<'_, AppState>) -> bool {
    let mut rm = state.resource_manager.lock().unwrap();
    rm.unload_mod()
}

/// 获取当前加载的 Mod 信息
#[tauri::command]
fn get_current_mod(state: State<'_, AppState>) -> Option<ModInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.current_mod.clone()
}

/// 获取当前 Mod 的路径
#[tauri::command]
fn get_mod_path(state: State<'_, AppState>) -> Option<String> {
    let rm = state.resource_manager.lock().unwrap();
    rm.current_mod.as_ref().map(|m| m.path.to_string_lossy().to_string())
}

/// 获取边框动画资源名称
#[tauri::command]
fn get_border_anima(state: State<'_, AppState>) -> Option<String> {
    let rm = state.resource_manager.lock().unwrap();
    rm.current_mod.as_ref().map(|m| m.manifest.border_anima.clone())
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

// ========================================================================= //
// 状态管理命令
// ========================================================================= //

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

/// 切换状态（根据状态类型自动选择切换方式）
#[tauri::command]
fn change_state(name: String, state: State<'_, AppState>) -> Result<bool, String> {
    let rm = state.resource_manager.lock().unwrap();
    let state_info = rm.get_state_by_name(&name)
        .ok_or_else(|| format!("State '{}' not found", name))?
        .clone();
    drop(rm);
    
    let mut sm = state.state_manager.lock().unwrap();
    sm.change_state(state_info)
}

/// 强制切换状态（忽略优先级和锁定检查）
#[tauri::command]
fn force_change_state(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let rm = state.resource_manager.lock().unwrap();
    let state_info = rm.get_state_by_name(&name)
        .ok_or_else(|| format!("State '{}' not found", name))?
        .clone();
    drop(rm);
    
    let mut sm = state.state_manager.lock().unwrap();
    let _ = sm.change_state_ex(state_info, true);
    Ok(())
}

/// 动画播放完成回调，触发状态切换逻辑
#[tauri::command]
fn on_animation_complete(state: State<'_, AppState>) {
    let mut sm = state.state_manager.lock().unwrap();
    sm.on_state_complete();
}

/// 检查状态是否被锁定
#[tauri::command]
fn is_state_locked(state: State<'_, AppState>) -> bool {
    let sm = state.state_manager.lock().unwrap();
    sm.is_locked()
}

// ========================================================================= //
// 窗口和系统命令
// ========================================================================= //

/// 设置动画缩放比例，并调整窗口大小
#[tauri::command]
fn set_animation_scale(scale: f64, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let scale = scale.clamp(0.1, 2.0);
    
    // 更新设置
    {
        let mut storage = state.storage.lock().unwrap();
        storage.data.settings.animation_scale = scale as f32;
        storage.save()?;
    }
    
    // 调整 animation 窗口大小
    let new_width = ANIMATION_WINDOW_BASE_WIDTH * scale;
    let new_height = ANIMATION_WINDOW_BASE_HEIGHT * scale;
    
    if let Some(window) = app.get_webview_window("animation") {
        window.set_size(LogicalSize::new(new_width, new_height))
            .map_err(|e| e.to_string())?;
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
        use std::process::Command;
        Command::new("explorer")
            .arg("/select,")
            .arg(&path)
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
// 应用入口
// ========================================================================= //

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // ========== 初始化核心管理器 ==========
            let mut rm = ResourceManager::new(app.handle());
            let mut sm = StateManager::new();
            let mut storage = Storage::new(app.handle());

            sm.set_app_handle(app.handle().clone());

            // ========== 记录登录时间 ==========
            let dt = get_current_datetime();
            storage.data.info.last_login = Some(dt.timestamp as i64);
            let _ = storage.save();

            // ========== 启动媒体监听器（独立线程） ==========
            start_media_observer(app.handle().clone());

            // ========== 自动加载上次使用的 Mod ==========
            let last_mod = &storage.data.info.current_mod;
            if !last_mod.is_empty() {
                if let Err(e) = rm.load_mod(last_mod) {
                    eprintln!("自动加载 Mod '{}' 失败: {}", last_mod, e);
                }
            }

            // ========== 计算窗口尺寸和位置 ==========
            let scale = storage.data.settings.animation_scale as f64;
            let window_width = ANIMATION_WINDOW_BASE_WIDTH * scale;
            let window_height = ANIMATION_WINDOW_BASE_HEIGHT * scale;
            let saved_position = (storage.data.info.animation_window_x, storage.data.info.animation_window_y);

            // ========== 创建动画窗口 ==========
            let animation_window = WebviewWindowBuilder::new(
                app,
                "animation",
                WebviewUrl::App("animation".into())
            )
            .title("Animation")
            .inner_size(window_width, window_height)
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .resizable(false)
            .shadow(false)
            .skip_taskbar(true)
            .build()
            .map_err(|e: tauri::Error| e.to_string())?;

            // ========== 设置窗口位置 ==========
            if let (Some(x), Some(y)) = saved_position {
                let _ = animation_window.set_position(tauri::Position::Logical(LogicalPosition::new(x, y)));
            } else if let Some(monitor) = animation_window.primary_monitor().ok().flatten() {
                // 首次启动，定位到屏幕右下角
                let scale_factor = monitor.scale_factor();
                let screen_size = monitor.size();
                let screen_pos = monitor.position();
                let taskbar_height = 48.0;
                
                let screen_w = screen_size.width as f64 / scale_factor;
                let screen_h = screen_size.height as f64 / scale_factor;
                
                let x = screen_pos.x as f64 + screen_w - window_width;
                let y = screen_pos.y as f64 + screen_h - window_height - taskbar_height;
                
                let _ = animation_window.set_position(tauri::Position::Logical(LogicalPosition::new(x, y)));
            }

            // ========== 初始化为 idle 状态 ==========
            if let Some(idle_state) = rm.get_state_by_name(STATE_IDLE) {
                let _ = sm.change_state(idle_state.clone());
            }

            // ========== 注册全局状态 ==========
            app.manage(AppState {
                resource_manager: Mutex::new(rm),
                state_manager: Mutex::new(sm),
                storage: Mutex::new(storage),
                media_observer: Mutex::new(None),
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // 主窗口关闭时保存动画窗口位置
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    save_animation_window_position(window);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // 常量查询
            get_const_float,
            get_const_text,
            // 用户设置
            get_settings,
            update_settings,
            get_user_info,
            update_user_info,
            // Mod 资源管理
            get_mod_search_paths,
            get_available_mods,
            load_mod,
            unload_mod,
            get_current_mod,
            get_mod_path,
            get_border_anima,
            get_state_by_name,
            get_trigger_by_event,
            get_asset_by_name,
            get_audio_by_name,
            get_text_by_name,
            get_info_by_lang,
            // 状态管理
            get_current_state,
            get_persistent_state,
            change_state,
            force_change_state,
            on_animation_complete,
            is_state_locked,
            // 窗口和系统
            set_animation_scale,
            open_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ========================================================================= //
// 辅助函数
// ========================================================================= //

/// 启动媒体监听器，在独立线程中运行
fn start_media_observer(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut observer = MediaObserver::new();
        let mut rx = observer.start();

        let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
        rt.block_on(async move {
            while let Some(event) = rx.recv().await {
                let state: State<AppState> = app_handle.state();

                match event.status {
                    MediaPlaybackStatus::Playing => {
                        // 检测到音乐播放，切换到 music 状态
                        let rm = state.resource_manager.lock().unwrap();
                        if let Some(music_state) = rm.get_state_by_name("music") {
                            let music_state = music_state.clone();
                            drop(rm);
                            let mut sm = state.state_manager.lock().unwrap();
                            let _ = sm.change_state(music_state);
                        }
                    }
                    MediaPlaybackStatus::Paused | MediaPlaybackStatus::Stopped => {
                        // 音乐停止，如果当前是 music 状态则返回 idle
                        let is_music = {
                            let sm = state.state_manager.lock().unwrap();
                            sm.get_persistent_state()
                                .map(|s| s.name == "music")
                                .unwrap_or(false)
                        };
                        
                        if is_music {
                            let rm = state.resource_manager.lock().unwrap();
                            if let Some(idle_state) = rm.get_state_by_name(STATE_IDLE) {
                                let idle_state = idle_state.clone();
                                drop(rm);
                                let mut sm = state.state_manager.lock().unwrap();
                                let _ = sm.change_state(idle_state);
                            }
                        }
                    }
                    _ => {}
                }
            }
        });
    });
}

/// 保存动画窗口位置到存储
fn save_animation_window_position(window: &tauri::Window) {
    let app = window.app_handle();
    
    if let Some(animation_window) = app.get_webview_window("animation") {
        if let Ok(position) = animation_window.outer_position() {
            let state: State<AppState> = window.state();
            let mut storage = state.storage.lock().unwrap();
            
            let scale_factor = animation_window.scale_factor().unwrap_or(1.0);
            storage.data.info.animation_window_x = Some(position.x as f64 / scale_factor);
            storage.data.info.animation_window_y = Some(position.y as f64 / scale_factor);
            
            let _ = storage.save();
        }
    }
}
