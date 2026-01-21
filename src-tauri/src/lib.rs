mod modules;

use modules::constants::{
    ANIMATION_WINDOW_BASE_WIDTH, ANIMATION_WINDOW_BASE_HEIGHT,
    ANIMATION_IDLE, ANIMATION_BORDER, ANIMATION_MORNING,
    STATE_IDLE,
};
use modules::resource::{ModInfo, ResourceManager, ActionInfo, AssetInfo, AudioInfo, TextInfo, CharacterInfo};
use modules::state::{StateManager, StateInfo};
use modules::storage::{Storage, UserSettings, UserInfo};
use std::sync::Mutex;
use tauri::{Manager, State, WebviewWindowBuilder, WebviewUrl, LogicalSize, LogicalPosition, Emitter};

struct AppState {
    resource_manager: Mutex<ResourceManager>,
    state_manager: Mutex<StateManager>,
    storage: Mutex<Storage>,
}

// ========================================================================= //

/// 常量名称管理
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

/// 常量名称管理
#[tauri::command]
fn get_const_text() -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    map.insert(ANIMATION_IDLE.to_string(), ANIMATION_IDLE.to_string());
    map.insert(ANIMATION_BORDER.to_string(), ANIMATION_BORDER.to_string());
    map.insert(ANIMATION_MORNING.to_string(), ANIMATION_MORNING.to_string());   
    map
}

// ========================================================================= //

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> UserSettings {
    let storage = state.storage.lock().unwrap();
    storage.data.settings.clone()
}

#[tauri::command]
fn update_settings(settings: UserSettings, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut storage = state.storage.lock().unwrap();
    storage.update_settings(settings.clone())?;
    // 发送设置变更事件
    let _ = app.emit("settings-change", settings);
    Ok(())
}

#[tauri::command]
fn get_user_info(state: State<'_, AppState>) -> UserInfo {
    let storage = state.storage.lock().unwrap();
    storage.data.info.clone()
}

#[tauri::command]
fn update_user_info(info: UserInfo, state: State<'_, AppState>) -> Result<(), String> {
    let mut storage = state.storage.lock().unwrap();
    storage.update_user_info(info)
}

// ========================================================================= //

#[tauri::command]
fn get_mod_search_paths(state: State<'_, AppState>) -> Vec<String> {
    let rm = state.resource_manager.lock().unwrap();
    rm.search_paths.iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}

#[tauri::command]
fn get_available_mods(state: State<'_, AppState>) -> Vec<String> {
    let rm = state.resource_manager.lock().unwrap();
    rm.list_mods()
}

#[tauri::command]
fn load_mod(mod_name: String, state: State<'_, AppState>) -> Result<ModInfo, String> {
    let mut rm = state.resource_manager.lock().unwrap();
    let mod_info = rm.load_mod(&mod_name)?;
    
    // 自动修改 UserInfo 内的 current_mod
    let mut storage = state.storage.lock().unwrap();
    storage.data.info.current_mod = mod_name;
    let _ = storage.save(); // 立即同步到磁盘
    
    Ok(mod_info)
}

#[tauri::command]
fn unload_mod(state: State<'_, AppState>) -> bool {
    let mut rm = state.resource_manager.lock().unwrap();
    rm.unload_mod()
}

#[tauri::command]
fn get_current_mod(state: State<'_, AppState>) -> Option<ModInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.current_mod.clone()
}

#[tauri::command]
fn get_mod_path(state: State<'_, AppState>) -> Option<String> {
    let rm = state.resource_manager.lock().unwrap();
    rm.current_mod.as_ref().map(|m| m.path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_action_by_name(name: String, state: State<'_, AppState>) -> Option<ActionInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_action_by_name(&name).cloned()
}

#[tauri::command]
fn get_asset_by_name(name: String, state: State<'_, AppState>) -> Option<AssetInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_asset_by_name(&name).cloned()
}

#[tauri::command]
fn get_audio_by_name(lang: String, name: String, state: State<'_, AppState>) -> Option<AudioInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_audio_by_name(&lang, &name).cloned()
}

#[tauri::command]
fn get_speech_by_name(lang: String, name: String, state: State<'_, AppState>) -> Option<TextInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_speech_by_name(&lang, &name).cloned()
}

#[tauri::command]
fn get_info_by_lang(lang: String, state: State<'_, AppState>) -> Option<CharacterInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.get_info_by_lang(&lang).cloned()
}

// ========================================================================= //

#[tauri::command]
fn get_current_state(state: State<'_, AppState>) -> Option<StateInfo> {
    let sm = state.state_manager.lock().unwrap();
    sm.get_current_state().cloned()
}

#[tauri::command]
fn get_persistent_state(state: State<'_, AppState>) -> Option<StateInfo> {
    let sm = state.state_manager.lock().unwrap();
    sm.get_persistent_state().cloned()
}

#[tauri::command]
fn get_all_states(state: State<'_, AppState>) -> Vec<StateInfo> {
    let sm = state.state_manager.lock().unwrap();
    sm.get_all_states().clone()
}

#[tauri::command]
fn set_persistent_state(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut sm = state.state_manager.lock().unwrap();
    sm.set_persistent_state(&name)
}

#[tauri::command]
fn switch_state(name: String, state: State<'_, AppState>) -> Result<bool, String> {
    let mut sm = state.state_manager.lock().unwrap();
    sm.switch_state(&name)
}

#[tauri::command]
fn force_switch_state(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut sm = state.state_manager.lock().unwrap();
    sm.force_switch_state(&name)
}

#[tauri::command]
fn on_animation_complete(state: State<'_, AppState>) {
    let mut sm = state.state_manager.lock().unwrap();
    sm.on_animation_complete();
}

// ========================================================================= //

#[tauri::command]
fn set_animation_scale(scale: f64, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // 限制范围 0.1 到 2.0
    let scale = scale.clamp(0.1, 2.0);
    
    // 更新设置
    {
        let mut storage = state.storage.lock().unwrap();
        storage.data.settings.animation_scale = scale as f32;
        storage.save()?;
    }
    
    // 计算新尺寸
    let new_width = ANIMATION_WINDOW_BASE_WIDTH * scale;
    let new_height = ANIMATION_WINDOW_BASE_HEIGHT * scale;
    
    // 调整 animation 窗口大小
    if let Some(window) = app.get_webview_window("animation") {
        window.set_size(LogicalSize::new(new_width, new_height))
            .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

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
        // Fallback for other OS if needed, but the user is on Windows
        opener::reveal(&path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let mut rm = ResourceManager::new(app.handle());
            let mut sm = StateManager::new();
            let mut storage = Storage::new(app.handle());

            // 设置 StateManager 的 AppHandle
            sm.set_app_handle(app.handle().clone());

            // 4. 每次启动应用，自动记录时间戳并修改 UserInfo 内表明 last_login
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64;
            storage.data.info.last_login = Some(now);
            let _ = storage.save();

            // 1. ResourceManager 启动时，尝试从 UserInfo 的 current_mod 获取上次加载的 mod 名称并自动加载
            let last_mod = &storage.data.info.current_mod;
            if !last_mod.is_empty() {
                if let Err(e) = rm.load_mod(last_mod) {
                    eprintln!("自动加载上次 Mod '{}' 失败: {}", last_mod, e);
                } else {
                    println!("自动加载上次 Mod 成功: {}", last_mod);
                }
            } else {
                eprintln!("启动警告：UserInfo 中未记录上次使用的 current_mod");
            }

            // 2. 初始化 StateManager 持久状态为 idle
            if let Err(e) = sm.set_persistent_state(STATE_IDLE) {
                eprintln!("设置初始持久状态 'idle' 失败: {}", e);
            } else {
                println!("初始化持久状态为 'idle' 成功");
            }


            // 获取动画缩放比例
            let animation_scale = storage.data.settings.animation_scale as f64;
            let window_width = ANIMATION_WINDOW_BASE_WIDTH * animation_scale;
            let window_height = ANIMATION_WINDOW_BASE_HEIGHT * animation_scale;

            // 获取上次保存的窗口位置
            let saved_position = (storage.data.info.animation_window_x, storage.data.info.animation_window_y);

            app.manage(AppState {
                resource_manager: Mutex::new(rm),
                state_manager: Mutex::new(sm),
                storage: Mutex::new(storage),
            });

            // 新建另一个窗口，用于播放序列帧动画
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

            // 设置窗口位置：优先使用上次保存的位置，否则吸附到屏幕右下角
            if let (Some(x), Some(y)) = saved_position {
                // 使用上次保存的位置
                let _ = animation_window.set_position(tauri::Position::Logical(LogicalPosition::new(x, y)));
            } else if let Some(monitor) = animation_window.primary_monitor().ok().flatten() {
                // 首次启动，吸附到屏幕右下角
                let scale_factor = monitor.scale_factor();
                let screen_size = monitor.size();
                let screen_position = monitor.position();
                
                let taskbar_height = 48.0; // Windows 任务栏大约高度
                
                // 转换为逻辑像素
                let screen_width_logical = screen_size.width as f64 / scale_factor;
                let screen_height_logical = screen_size.height as f64 / scale_factor;
                
                let x = screen_position.x as f64 + screen_width_logical - window_width;
                let y = screen_position.y as f64 + screen_height_logical - window_height - taskbar_height;
                
                let _ = animation_window.set_position(tauri::Position::Logical(LogicalPosition::new(x, y)));
            }



            Ok(())
        })

        .on_window_event(|window, event| {
            // 每次退出应用时，保存 animation 窗口位置并同步到磁盘
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // 只在主窗口关闭时保存（避免重复保存）
                if window.label() == "main" {
                    let app = window.app_handle();
                    
                    // 保存 animation 窗口位置
                    if let Some(animation_window) = app.get_webview_window("animation") {
                        if let Ok(position) = animation_window.outer_position() {
                            let state: State<AppState> = window.state();
                            let mut storage = state.storage.lock().unwrap();
                            
                            // 获取 scale_factor 将物理像素转换为逻辑像素
                            let scale_factor = animation_window.scale_factor().unwrap_or(1.0);
                            storage.data.info.animation_window_x = Some(position.x as f64 / scale_factor);
                            storage.data.info.animation_window_y = Some(position.y as f64 / scale_factor);
                            
                            if let Err(e) = storage.save() {
                                eprintln!("退出保存数据失败: {}", e);
                            } else {
                                println!("退出保存数据成功，窗口位置: ({}, {})", position.x, position.y);
                            }
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_mod_search_paths, 
            get_available_mods, 
            load_mod, 
            unload_mod,
            open_path,
            get_settings,
            update_settings,
            get_user_info,
            update_user_info,
            get_current_mod,
            get_action_by_name,
            get_asset_by_name,
            get_mod_path,
            get_audio_by_name,
            get_speech_by_name,
            get_info_by_lang,
            get_const_float,
            get_const_text,
            set_animation_scale,
            // State Manager commands
            get_current_state,
            get_persistent_state,
            get_all_states,
            set_persistent_state,
            switch_state,
            force_switch_state,
            on_animation_complete
        ])

        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}



