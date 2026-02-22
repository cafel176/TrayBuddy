use std::path::PathBuf;
use traybuddy_lib::modules::resource::ResourceManager;

fn mods_test_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("mods_test")
}

#[test]
fn resource_manager_query_helpers_work() {
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

    let states = rm.get_all_states();
    if let Some(state) = states.first() {
        let by_name = rm.get_state_by_name(state.name.as_ref());
        assert!(by_name.is_some());
    }

    let triggers = rm.get_all_triggers();
    if let Some(trigger) = triggers.first() {
        let by_event = rm.get_trigger_by_event(trigger.event.as_ref());
        assert!(by_event.is_some());
    }
}
