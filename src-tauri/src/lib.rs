mod modules;

use modules::resource::{ModInfo, ResourceManager};
use modules::storage::{Storage, UserSettings, UserInfo};
use std::sync::Mutex;
use tauri::{Manager, State};


struct AppState {
    resource_manager: Mutex<ResourceManager>,
    storage: Mutex<Storage>,
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> UserSettings {
    let storage = state.storage.lock().unwrap();
    storage.data.settings.clone()
}

#[tauri::command]
fn update_settings(settings: UserSettings, state: State<'_, AppState>) -> Result<(), String> {
    let mut storage = state.storage.lock().unwrap();
    storage.update_settings(settings)
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
fn get_current_mod(state: State<'_, AppState>) -> Option<ModInfo> {
    let rm = state.resource_manager.lock().unwrap();
    rm.current_mod.clone()
}


#[tauri::command]
fn unload_mod(state: State<'_, AppState>) -> bool {
    let mut rm = state.resource_manager.lock().unwrap();
    rm.unload_mod()
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
            let mut storage = Storage::new(app.handle());

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


            app.manage(AppState {
                resource_manager: Mutex::new(rm),
                storage: Mutex::new(storage),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // 5. 每次退出应用时，自动更新用户信息并立即同步到磁盘
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state: State<AppState> = window.state();
                let storage = state.storage.lock().unwrap();
                if let Err(e) = storage.save() {
                    eprintln!("退出保存数据失败: {}", e);
                } else {
                    println!("退出保存数据成功");
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
            get_current_mod
        ])

        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}



