use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use traybuddy_lib::modules::utils::{fs, os_version};

#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct Item {
    id: u32,
    name: String,
}

fn temp_path(label: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    path.push(format!("traybuddy_it_utils_{}_{}.json", label, nanos));
    path
}

#[test]
fn fs_load_json_list_and_obj_work() {
    let list_path = temp_path("list");
    let list = vec![
        Item {
            id: 1,
            name: "a".to_string(),
        },
        Item {
            id: 2,
            name: "b".to_string(),
        },
    ];
    std::fs::write(&list_path, serde_json::to_string(&list).unwrap()).unwrap();

    let got_list: Vec<Item> = fs::load_json_list(&list_path);
    assert_eq!(got_list, list);

    let obj_path = temp_path("obj");
    let obj = Item {
        id: 7,
        name: "ok".to_string(),
    };
    std::fs::write(&obj_path, serde_json::to_string(&obj).unwrap()).unwrap();

    let got_obj: Option<Item> = fs::load_json_obj(&obj_path);
    assert_eq!(got_obj, Some(obj));

    let _ = std::fs::remove_file(&list_path);
    let _ = std::fs::remove_file(&obj_path);
}

#[test]
fn windows_version_helpers_work() {
    let win7 = os_version::WindowsVersion::WIN7;
    let win10 = os_version::WindowsVersion::WIN10;
    let win11 = os_version::WindowsVersion::WIN11;

    assert!(win10.is_at_least(&win7));
    assert!(win11.is_win11());
    assert!(win7.is_win7());
    assert!(!win7.is_win10_or_later());
}
