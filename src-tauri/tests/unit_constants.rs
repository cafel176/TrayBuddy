use traybuddy_lib::modules::constants::*;

#[test]
fn animation_window_base_dimensions_match_formula() {
    let expected_width = ANIMATION_AREA_WIDTH.max(BUBBLE_AREA_WIDTH);
    let expected_height = ANIMATION_AREA_HEIGHT + BUBBLE_AREA_HEIGHT;
    assert_eq!(ANIMATION_WINDOW_BASE_WIDTH, expected_width);
    assert_eq!(ANIMATION_WINDOW_BASE_HEIGHT, expected_height);
}

#[test]
fn identifiers_are_stable() {
    assert_eq!(TRAY_ID_MAIN, "main");
    assert_eq!(WINDOW_LABEL_ANIMATION, "animation");
}

#[test]
fn window_labels_are_stable() {
    assert_eq!(WINDOW_LABEL_MAIN, "main");
    assert_eq!(WINDOW_LABEL_ANIMATION, "animation");
    assert_eq!(WINDOW_LABEL_LIVE2D, "live2d");
    assert_eq!(WINDOW_LABEL_PNGREMIX, "pngremix");
    assert_eq!(WINDOW_LABEL_THREED, "threed");
    assert_eq!(WINDOW_LABEL_SETTINGS, "settings");
    assert_eq!(WINDOW_LABEL_MODS, "mods");
    assert_eq!(WINDOW_LABEL_ABOUT, "about");
    assert_eq!(WINDOW_LABEL_MEMO, "memo");
    assert_eq!(WINDOW_LABEL_REMINDER, "reminder");
    assert_eq!(WINDOW_LABEL_REMINDER_ALERT, "reminder_alert");
}

#[test]
fn render_window_labels_contains_four() {
    assert_eq!(RENDER_WINDOW_LABELS.len(), 4);
    assert!(RENDER_WINDOW_LABELS.contains(&WINDOW_LABEL_ANIMATION));
    assert!(RENDER_WINDOW_LABELS.contains(&WINDOW_LABEL_LIVE2D));
    assert!(RENDER_WINDOW_LABELS.contains(&WINDOW_LABEL_PNGREMIX));
    assert!(RENDER_WINDOW_LABELS.contains(&WINDOW_LABEL_THREED));
}

#[test]
fn animation_area_dimensions_positive() {
    assert!(ANIMATION_AREA_WIDTH > 0.0);
    assert!(ANIMATION_AREA_HEIGHT > 0.0);
    assert!(BUBBLE_AREA_HEIGHT > 0.0);
    assert!(BUBBLE_AREA_WIDTH > 0.0);
}

#[test]
fn bubble_text_constants() {
    assert!(SHORT_TEXT_THRESHOLD > 0);
    assert!(MAX_BUTTONS_PER_ROW > 0);
    assert!(MAX_CHARS_PER_LINE > 0);
    assert!(MAX_CHARS_PER_BUTTON > 0);
}

#[test]
fn state_name_constants_are_stable() {
    assert_eq!(STATE_IDLE, "idle");
    assert_eq!(STATE_SILENCE, "silence");
    assert_eq!(STATE_SILENCE_START, "silence_start");
    assert_eq!(STATE_SILENCE_END, "silence_end");
    assert_eq!(STATE_DRAGGING, "dragging");
    assert_eq!(STATE_DRAG_START, "drag_start");
    assert_eq!(STATE_DRAG_END, "drag_end");
    assert_eq!(STATE_MUSIC, "music");
    assert_eq!(STATE_MUSIC_START, "music_start");
    assert_eq!(STATE_MUSIC_END, "music_end");
    assert_eq!(STATE_BIRTHDAY, "birthday");
    assert_eq!(STATE_FIRSTDAY, "firstday");
}

#[test]
fn event_name_constants_are_stable() {
    assert_eq!(EVENT_CLICK, "click");
    assert_eq!(EVENT_CLICK_UP, "click_up");
    assert_eq!(EVENT_RIGHT_CLICK, "right_click");
    assert_eq!(EVENT_RIGHT_CLICK_UP, "right_click_up");
    assert_eq!(EVENT_GLOBAL_CLICK, "global_click");
    assert_eq!(EVENT_GLOBAL_CLICK_UP, "global_click_up");
    assert_eq!(EVENT_GLOBAL_RIGHT_CLICK, "global_right_click");
    assert_eq!(EVENT_GLOBAL_RIGHT_CLICK_UP, "global_right_click_up");
    assert_eq!(EVENT_GLOBAL_KEYDOWN, "global_keydown");
    assert_eq!(EVENT_GLOBAL_KEYUP, "global_keyup");
    assert_eq!(EVENT_LOGIN, "login");
    assert_eq!(EVENT_MUSIC_START, "music_start");
    assert_eq!(EVENT_MUSIC_END, "music_end");
    assert_eq!(EVENT_WORK, "work");
    assert_eq!(EVENT_ANIMATION_DRAG_START, "drag_start");
    assert_eq!(EVENT_ANIMATION_DRAG_END, "drag_end");
}

#[test]
fn timing_constants_positive() {
    assert!(WEATHER_CACHE_DURATION_SECS > 0);
    assert!(WEATHER_API_TIMEOUT_SECS > 0);
    assert!(LOCATION_API_TIMEOUT_SECS > 0);
    assert!(MIN_TRIGGER_TIME_SECS > 0.0);
    assert!(TIMER_TRIGGER_CHECK_INTERVAL_SECS > 0);
    assert!(STATE_LOCK_WAIT_INTERVAL_MS > 0);
    assert!(STATE_LOCK_MAX_RETRIES > 0);
    assert!(MEDIA_EVENT_STARTUP_DELAY_SECS > 0);
    assert!(CORE_AUDIO_POLL_INTERVAL_SECS > 0);
    assert!(PROCESS_OBSERVER_POLL_INTERVAL_MS > 0);
    assert!(SYSTEM_OBSERVER_POLL_INTERVAL_SECS > 0);
    assert!(SYSTEM_OBSERVER_DEBOUNCE_MS > 0);
    assert!(WINDOW_RESIZE_DELAY_MS > 0);
    assert!(MOD_SWITCH_WINDOW_DELAY_MS > 0);
    assert!(MOD_LOGIN_EVENT_DELAY_SECS > 0);
    assert!(SESSION_OBSERVER_POLL_INTERVAL_SECS > 0);
    assert!(WORK_EVENT_COOLDOWN_SECS > 0);
}

#[test]
fn mod_archive_cache_max_is_reasonable() {
    assert!(MOD_ARCHIVE_CACHE_MAX >= 1);
}

#[test]
fn search_depth_constants_positive() {
    assert!(MODS_SEARCH_MAX_LEVELS_EXE > 0);
    assert!(MODS_SEARCH_MAX_LEVELS_CWD > 0);
}

#[test]
fn audio_peak_threshold_is_small_positive() {
    assert!(AUDIO_PEAK_THRESHOLD > 0.0);
    assert!(AUDIO_PEAK_THRESHOLD < 1.0);
}

#[test]
fn fullscreen_coverage_threshold_small_positive() {
    assert!(FULLSCREEN_COVERAGE_THRESHOLD > 0);
    assert!(FULLSCREEN_COVERAGE_THRESHOLD < 100);
}

#[test]
fn timer_trigger_check_interval_equals_min_trigger() {
    assert_eq!(TIMER_TRIGGER_CHECK_INTERVAL_SECS, MIN_TRIGGER_TIME_SECS as u64);
}
