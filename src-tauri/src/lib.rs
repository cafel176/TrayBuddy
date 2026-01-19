mod modules;

use modules::resource::{ModInfo, ResourceManager};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

struct AppState {
    resource_manager: Mutex<ResourceManager>,
}

#[tauri::command]
fn get_available_mods(state: State<'_, AppState>) -> Vec<String> {
    let rm = state.resource_manager.lock().unwrap();
    rm.list_mods()
}

#[tauri::command]
fn load_mod(mod_name: String, state: State<'_, AppState>) -> Result<ModInfo, String> {
    let mut rm = state.resource_manager.lock().unwrap();
    rm.load_mod(&mod_name)
}

#[tauri::command]
fn unload_mod(state: State<'_, AppState>) -> bool {
    let mut rm = state.resource_manager.lock().unwrap();
    rm.unload_mod()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let rm = ResourceManager::new(app.handle());
            app.manage(AppState {
                resource_manager: Mutex::new(rm),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_available_mods, load_mod, unload_mod])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

