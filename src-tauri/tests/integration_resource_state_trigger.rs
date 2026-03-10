use std::path::PathBuf;
use traybuddy_lib::modules::resource::ResourceManager;
use traybuddy_lib::modules::state::{StateLimitsContext, StateManager};
use traybuddy_lib::modules::trigger::TriggerManager;

fn mods_test_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("mods_test")
}

#[test]
#[ignore = "requires mods_test directory with real mod data"]
fn resource_manager_can_list_and_load_mod() {
    let mods_dir = mods_test_dir();
    assert!(mods_dir.exists(), "mods_test directory not found");

    let mut rm = ResourceManager::new_with_search_paths(vec![mods_dir]);
    let mods = rm.list_mods();
    if mods.is_empty() {
        return;
    }

    let mod_id = mods[0].clone();
    let mod_info = rm.load_mod(&mod_id).unwrap();
    assert_eq!(mod_info.manifest.id.as_ref(), mod_id);

    let states = rm.get_all_states();
    assert!(!states.is_empty());
}

#[test]
#[ignore = "requires mods_test directory with real mod data"]
fn state_manager_can_switch_state_from_loaded_mod() {
    let mods_dir = mods_test_dir();
    assert!(mods_dir.exists(), "mods_test directory not found");

    let mut rm = ResourceManager::new_with_search_paths(vec![mods_dir]);
    let mods = rm.list_mods();
    if mods.is_empty() {
        return;
    }

    let mod_id = mods[0].clone();
    rm.load_mod(&mod_id).unwrap();

    let state = rm.get_all_states().first().cloned();
    let Some(state) = state else { return; };

    let mut sm = StateManager::new();
    let _ = sm.change_state(state.clone(), &rm).unwrap_or(false);
    assert!(sm.get_current_state().is_some());
}

#[test]
fn trigger_manager_can_run_against_loaded_mod() {
    let mods_dir = mods_test_dir();
    if !mods_dir.exists() {
        return;
    }

    let mut rm = ResourceManager::new_with_search_paths(vec![mods_dir]);
    let mods = rm.list_mods();
    if mods.is_empty() {
        return;
    }

    let mod_id = mods[0].clone();
    rm.load_mod(&mod_id).unwrap();

    let triggers = rm.get_all_triggers();
    if triggers.is_empty() {
        return;
    }

    let event = triggers[0].event.clone();
    let mut sm = StateManager::new();
    let limits_ctx = StateLimitsContext::default_unlimited();
    let result = TriggerManager::trigger_event(event.as_ref(), false, &rm, &mut sm, &limits_ctx);
    assert!(result.is_ok());
}
