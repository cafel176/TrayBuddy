use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use traybuddy_lib::modules::storage::{Storage, UserSettings};
use traybuddy_lib::modules::system_observer::{get_cached_debug_info, SystemObserver};

fn temp_path(label: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    path.push(format!("traybuddy_it_storage_{}_{}.json", label, nanos));
    path
}

#[test]
fn storage_new_with_path_and_save_work() {
    let path = temp_path("storage");
    let mut storage = Storage::new_with_path(path.clone());
    storage.data.settings = UserSettings {
        lang: "en".into(),
        ..UserSettings::default()
    };

    storage.save().unwrap();
    assert!(path.exists());

    let content = std::fs::read_to_string(&path).unwrap();
    assert!(content.contains("\"lang\": \"en\""));

    let _ = std::fs::remove_file(&path);
}

#[test]
fn system_observer_cache_is_empty_by_default() {
    assert!(get_cached_debug_info().is_none());

    let observer = SystemObserver::new();
    observer.stop();
}
