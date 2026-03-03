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

// ========================================================================= //
// fs::load_json_list
// ========================================================================= //

#[test]
fn load_json_list_returns_empty_on_missing_or_invalid() {
    let missing = temp_path("missing");
    let list: Vec<Item> = fs::load_json_list(&missing);
    assert!(list.is_empty());

    let invalid = temp_path("invalid");
    std::fs::write(&invalid, "not json").unwrap();
    let list: Vec<Item> = fs::load_json_list(&invalid);
    assert!(list.is_empty());

    let _ = std::fs::remove_file(&invalid);
}

#[test]
fn load_json_list_parses_valid_file() {
    let path = temp_path("valid_list");
    let data = vec![
        Item {
            id: 1,
            name: "a".to_string(),
        },
        Item {
            id: 2,
            name: "b".to_string(),
        },
    ];
    std::fs::write(&path, serde_json::to_string(&data).unwrap()).unwrap();

    let list: Vec<Item> = fs::load_json_list(&path);
    assert_eq!(list, data);

    let _ = std::fs::remove_file(&path);
}

// ========================================================================= //
// fs::load_json_obj
// ========================================================================= //

#[test]
fn load_json_obj_returns_none_on_missing_or_invalid() {
    let missing = temp_path("missing_obj");
    let value: Option<Item> = fs::load_json_obj(&missing);
    assert!(value.is_none());

    let invalid = temp_path("invalid_obj");
    std::fs::write(&invalid, "not json").unwrap();
    let value: Option<Item> = fs::load_json_obj(&invalid);
    assert!(value.is_none());

    let _ = std::fs::remove_file(&invalid);
}

#[test]
fn load_json_obj_parses_valid_file() {
    let path = temp_path("valid_obj");
    let data = Item {
        id: 7,
        name: "ok".to_string(),
    };
    std::fs::write(&path, serde_json::to_string(&data).unwrap()).unwrap();

    let value: Option<Item> = fs::load_json_obj(&path);
    assert_eq!(value, Some(data));

    let _ = std::fs::remove_file(&path);
}

// ========================================================================= //
// os_version::WindowsVersion
// ========================================================================= //

#[test]
fn test_version_comparison() {
    let win7 = os_version::WindowsVersion::WIN7;
    let win10 = os_version::WindowsVersion::WIN10;
    let win10_1809 = os_version::WindowsVersion::WIN10_1809;
    let win11 = os_version::WindowsVersion::WIN11;

    assert!(win10.is_at_least(&win7));
    assert!(win10_1809.is_at_least(&win10));
    assert!(win11.is_at_least(&win10_1809));
    assert!(!win7.is_at_least(&win10));
}

#[test]
fn version_is_at_least_covers_minor_branch() {
    // Same major, different minor — exercises the `self.minor > other.minor` branch
    let v6_0 = os_version::WindowsVersion { major: 6, minor: 0, build: 0 };
    let v6_1 = os_version::WindowsVersion { major: 6, minor: 1, build: 0 };
    assert!(v6_1.is_at_least(&v6_0));
    assert!(!v6_0.is_at_least(&v6_1));

    // Same major, same minor, different build
    let v6_1_b100 = os_version::WindowsVersion { major: 6, minor: 1, build: 100 };
    let v6_1_b200 = os_version::WindowsVersion { major: 6, minor: 1, build: 200 };
    assert!(v6_1_b200.is_at_least(&v6_1_b100));
    assert!(!v6_1_b100.is_at_least(&v6_1_b200));
    assert!(v6_1_b100.is_at_least(&v6_1_b100));
}

#[test]
fn test_version_identification() {
    assert!(os_version::WindowsVersion::WIN7.is_win7());
    assert!(os_version::WindowsVersion::WIN8.is_win8());
    assert!(os_version::WindowsVersion::WIN8_1.is_win8_1());
    assert!(os_version::WindowsVersion::WIN10.is_win10_or_later());
    assert!(os_version::WindowsVersion::WIN11.is_win11());
}

#[test]
fn helper_checks_cover_versions() {
    let win7 = os_version::WindowsVersion::WIN7;
    let win8 = os_version::WindowsVersion::WIN8;
    let win8_1 = os_version::WindowsVersion::WIN8_1;
    let win10 = os_version::WindowsVersion::WIN10;
    let win11 = os_version::WindowsVersion::WIN11;

    assert!(win7.is_win7());
    assert!(!win7.is_win10_or_later());
    assert!(win8.is_win8());
    assert!(!win8.is_win8_1());
    assert!(win8_1.is_win8_1());
    assert!(win10.is_win10_or_later());
    assert!(win11.is_win11());
    assert!(win11.is_at_least(&win10));
    assert!(!win10.is_at_least(&win11));
}

#[test]
fn runtime_helpers_match_version_checks() {
    let current = os_version::get_windows_version();
    assert!(current.major >= 6);

    let expected_gsmtc = current.is_at_least(&os_version::WindowsVersion::WIN10_1809);
    assert_eq!(os_version::is_gsmtc_available(), expected_gsmtc);

    let expected_legacy = current.is_win7() || current.is_win8() || current.is_win8_1();
    assert_eq!(os_version::is_legacy_windows(), expected_legacy);
}
