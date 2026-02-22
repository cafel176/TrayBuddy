use traybuddy_lib::modules::event_manager::EmitOptions;
use traybuddy_lib::modules::media_observer::is_music_app;

#[test]
fn emit_options_flags_are_consistent() {
    let default = EmitOptions::default();
    assert!(matches!(default, EmitOptions::Silent));

    let log = EmitOptions::log_on_error();
    assert!(matches!(log, EmitOptions::LogOnFailure));

    let fail = EmitOptions::fail_on_error();
    assert!(matches!(fail, EmitOptions::FailOnFailure));
}


#[test]
fn is_music_app_detects_keywords() {
    assert!(is_music_app("My Music Player"));
    assert!(is_music_app("QQMusic.exe"));
    assert!(!is_music_app("Notepad"));
}
