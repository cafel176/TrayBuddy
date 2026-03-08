//! TrayBuddy 应用主模块
//!
//! 桌面虚拟伴侣应用，支持：
//! - Mod 资源加载和管理
//! - 状态切换和动画播放
//! - 系统媒体监听
//! - 用户设置持久化
//!
//! # 模块架构
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                      AppState (全局状态)                      │
//! │  ┌─────────────────┬─────────────────┬─────────────────┐    │
//! │  │ ResourceManager │  StateManager   │    Storage      │    │
//! │  │   (资源管理)     │   (状态管理)    │  (持久化存储)   │    │
//! │  └─────────────────┴─────────────────┴─────────────────┘    │
//! │                              │                               │
//! │  ┌─────────────────┬─────────┴───────┬─────────────────┐    │
//! │  │ MediaObserver   │ TriggerManager  │  Environment    │    │
//! │  │  (媒体监听)      │   (触发管理)    │   (环境信息)    │    │
//! │  └─────────────────┴─────────────────┴─────────────────┘    │
//! └─────────────────────────────────────────────────────────────┘
//! ```

#![allow(unused)]

pub mod modules;

mod app_state;
mod commands;
mod lib_helpers;

pub(crate) use app_state::get_state_unlock_notify;
pub(crate) use lib_helpers::*;







#[cfg(windows)]
use std::os::windows::process::CommandExt;

use modules::constants::{
    ANIMATION_AREA_HEIGHT, ANIMATION_AREA_WIDTH, ANIMATION_BORDER, BUBBLE_AREA_HEIGHT,
    BUBBLE_AREA_WIDTH, MAX_BUTTONS_PER_ROW, MAX_CHARS_PER_BUTTON, MAX_CHARS_PER_LINE,
    MOD_LOGIN_EVENT_DELAY_SECS, RENDER_WINDOW_LABELS, SHORT_TEXT_THRESHOLD, STATE_IDLE, STATE_MUSIC_END,
    STATE_MUSIC_START,     STATE_SILENCE, STATE_SILENCE_END, STATE_SILENCE_START, TRAY_ID_MAIN,
    WINDOW_LABEL_ABOUT, WINDOW_LABEL_ANIMATION, WINDOW_LABEL_LIVE2D, WINDOW_LABEL_MAIN,
    WINDOW_LABEL_MEMO, WINDOW_LABEL_MODS, WINDOW_LABEL_PNGREMIX, WINDOW_LABEL_REMINDER, WINDOW_LABEL_REMINDER_ALERT,
    WINDOW_LABEL_SETTINGS, WINDOW_LABEL_THREED, EVENT_LOGIN, EVENT_MUSIC_END, EVENT_MUSIC_START, EVENT_WORK,
    WORK_EVENT_COOLDOWN_SECS
};


use modules::event_manager::{emit, emit_from_tauri_window, emit_from_window, emit_settings, events};
use modules::environment::{
    get_cached_location, get_cached_weather, get_current_datetime, get_current_season,
    get_time_period, init_environment, DateTimeInfo, EnvironmentManager, GeoLocation, WeatherInfo,
};
use modules::media_observer::{
    get_cached_debug_info, MediaDebugInfo, MediaObserver, MediaPlaybackStatus,
};
use modules::process_observer::{
    get_cached_process_debug_info, ProcessDebugInfo, ProcessObserver, ProcessStartEvent,
};
use modules::resource::{
    self, AssetInfo, AudioInfo, CharacterInfo, ModInfo, ModType, ResourceManager, StateInfo,
    TextInfo, TriggerInfo,
};

use modules::state::StateManager;
use modules::storage::{
    MemoItem, ModData, ReminderItem, ReminderSchedule, Storage, UserInfo, UserSettings,
};
use modules::system_observer::{SystemDebugInfo, SystemObserver};
use modules::trigger::TriggerManager;
use modules::utils::i18n::get_i18n_text as get_i18n_text_cached;
use app_state::*;
use commands::*;
use std::sync::{Arc, Mutex, OnceLock};




use std::sync::atomic::{AtomicBool, Ordering};


use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Listener, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_autostart::ManagerExt;

// ========================================================================= //
// 应用入口
// ========================================================================= //


/// 应用入口点
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 创建共享的 archive store（在 Builder 之前，因为 protocol handler 和 AppState 都需要引用它）
    let shared_archive_store = Arc::new(Mutex::new(modules::mod_archive::ModArchiveStore::new()));
    let protocol_store = shared_archive_store.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        // 单实例：二次启动（例如双击 .tbuddy/.sbuddy）转发参数给现有实例
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            handle_open_mod_archives_from_args(app, &argv);
        }))
        // ========== 自定义协议：tbuddy-asset:// ========== 
        // 用于从内存中的 .tbuddy archive 流式返回资源文件
        // 前端发送的 URL 格式因平台而异：
        //   Windows: http://tbuddy-asset.localhost/mod_id/path
        //   macOS:   tbuddy-asset://localhost/mod_id/path
        // Tauri 内部统一转换后传入回调的 URI 格式:
        //   tbuddy-asset://localhost/mod_id/path
        .register_uri_scheme_protocol("tbuddy-asset", move |_app, request| {
            use tauri::http::Response;

            let uri = request.uri().to_string();
            #[cfg(debug_assertions)]
            println!("[tbuddy-asset] Request URI: {}", uri);

            // 去掉协议前缀，可能的格式:
            //   "tbuddy-asset://localhost/mod_id/path"
            //   "tbuddy-asset://mod_id/path"   (理论上)
            //   "tbuddy-asset:///mod_id/path"   (某些情况)
            let stripped = uri
                .strip_prefix("tbuddy-asset://")
                .or_else(|| uri.strip_prefix("tbuddy-asset:"))
                .unwrap_or("");

            // 去掉可能的 "localhost" 前缀
            let stripped = stripped
                .strip_prefix("localhost/")
                .or_else(|| stripped.strip_prefix("localhost"))
                .unwrap_or(stripped);

            // 去掉开头的斜杠
            let stripped = stripped.trim_start_matches('/');

            let (mod_id, file_path) = match stripped.find('/') {
                Some(pos) => (&stripped[..pos], &stripped[pos + 1..]),
                None => (stripped, ""),
            };

            // URL 解码
            let mod_id = urlencoding_decode(mod_id);
            let file_path = {
                // 一些模型/配置会出现 `asset/live2d//xxx.model3.json` 这样的重复斜杠，
                // 这里做一次规范化，避免 archive 查找失败 (404)。
                let raw = urlencoding_decode(file_path).replace('\\', "/");

                // collapse multiple '/'
                let mut out = String::with_capacity(raw.len());
                let mut prev_slash = false;
                for ch in raw.chars() {
                    if ch == '/' {
                        if prev_slash {
                            continue;
                        }
                        prev_slash = true;
                        out.push('/');
                    } else {
                        prev_slash = false;
                        out.push(ch);
                    }
                }

                out.trim_start_matches('/').to_string()
            };

            #[cfg(debug_assertions)]
            println!("[tbuddy-asset] mod_id={}, file_path={}", mod_id, file_path);

            if mod_id.is_empty() || file_path.is_empty() {
                return Response::builder()
                    .status(400)
                    .header("Access-Control-Allow-Origin", "*")
                    .body(b"Bad request: missing mod_id or path".to_vec())
                    .unwrap();
            }

            let mut store = protocol_store.lock().unwrap();
            match store.read_file(&mod_id, &file_path) {


                Ok(data) => {
                    let mime = guess_mime_type(&file_path);
                    Response::builder()
                        .status(200)
                        .header("Content-Type", mime)
                        .header("Access-Control-Allow-Origin", "*")
                        .body(data)
                        .unwrap()
                }
                Err(_e) => {
                    #[cfg(debug_assertions)]
                    println!("[tbuddy-asset] Not found: {}/{} - {}", mod_id, file_path, _e);
                    Response::builder()
                        .status(404)
                        .header("Access-Control-Allow-Origin", "*")
                        .body(format!("Not found: {}/{}", mod_id, file_path).into_bytes())
                        .unwrap()
                }
            }
        })
        .setup(move |app| {
            // ========== 初始化核心管理器 ==========
            let rm = Arc::new(Mutex::new(ResourceManager::new(app.handle())));
            // 将共享的 archive store 注入 ResourceManager，使其能扫描 .tbuddy 文件
            rm.lock().unwrap().set_archive_store(shared_archive_store.clone());
            let mut sm = StateManager::new();
            let mut storage = Storage::new(app.handle());

            // ========== 加载可配置资源（exe 同目录 config） ==========
            // 目前用于音乐应用识别关键字（MediaObserver）
            modules::media_observer::init_music_keywords_from_config();
            // 进程监测关键字（ProcessObserver）
            modules::process_observer::init_process_keywords_from_config();
            // 渲染调优参数（前端 FPS / idle 降频等）
            modules::render_tuning_config::init_render_tuning_from_config();



            // 记录登录时间和启动次数
            let dt = get_current_datetime();
            let current_time = dt.timestamp as i64;

            // 如果是首次启动，记录首次登录时间
            if storage.data.info.first_login.is_none() {
                storage.data.info.first_login = Some(current_time);
            }

            // 更新最后登录时间
            storage.data.info.last_login = Some(current_time);

            // 增加启动次数
            storage.data.info.launch_count += 1;

            let _ = storage.save();

            // ========== 迁移：统一使用 manifest.id 作为 Mod 唯一标识 ==========
            {
                let mut changed = false;
                let current = storage.data.info.current_mod.to_string();

                let mut rm_guard = rm.lock().unwrap();

                // 1) 迁移 current_mod（历史版本可能存的是文件夹名）
                if !current.is_empty() {
                    if let Some(id) = rm_guard.resolve_mod_id(&current) {
                        if id != current {
                            storage.data.info.current_mod = id.into();
                            changed = true;
                        }
                    }
                }

                // 2) 迁移 mod_data 的 key（历史版本可能用文件夹名作为 key）
                let keys: Vec<String> = storage.data.info.mod_data.keys().cloned().collect();
                for k in keys {
                    let Some(id) = rm_guard.resolve_mod_id(&k) else {
                        continue;
                    };

                    if id == k {
                        continue;
                    }

                    if storage.data.info.mod_data.contains_key(&id) {
                        // 冲突时优先保留 manifest.id 对应的数据
                        let _ = storage.data.info.mod_data.remove(&k);
                        changed = true;
                        continue;
                    }

                    if let Some(mut v) = storage.data.info.mod_data.remove(&k) {
                        v.mod_id = id.clone();
                        storage.data.info.mod_data.insert(id, v);
                        changed = true;
                    }
                }

                drop(rm_guard);

                if changed {
                    let _ = storage.save();
                }
            }

            // ========== 同步开机自启动状态 ==========
            // 只在 Release 版本中允许启用开机自启动
            let autostart_manager = app.autolaunch();
            if storage.data.settings.auto_start {
                if is_release_build() {
                    let _ = autostart_manager.enable();
                } else {
                    // 开发模式下禁用自启动
                    eprintln!("{}", get_i18n_text(app.handle(), "backend.log.autostartDisabled"));
                }
            } else {
                if is_release_build() {
                    let _ = autostart_manager.disable();
                } else {
                    // 开发模式下禁用自启动
                    eprintln!("{}", get_i18n_text(app.handle(), "backend.log.autostartDisabled"));
                }
            }

            // 自动加载上次使用的 Mod
            let last_mod = storage.data.info.current_mod.clone();
            if !last_mod.is_empty() {
                // 注意：不要把 `rm.lock()` 写在 if-let 条件里。
                // 在某些情况下临时值生命周期可能延长到整个 if 语句末尾，导致 else 分支里再次 `rm.lock()` 时同线程二次上锁卡死。
                let load_result = { rm.lock().unwrap().load_mod(&last_mod) };

                match load_result {
                    Err(e) => {
                        eprintln!("{}", get_i18n_text(app.handle(), "backend.log.modLoadFailed")
                            .replace("{name}", &last_mod)
                            .replace("{error}", &e.to_string()));
                    }
                    Ok(mod_info) => {
                        // 自动加载成功后更新托盘图标（同步版本，初始化阶段）
                        let app_handle = app.handle();
                        update_tray_icon_sync(&app_handle);

                        // 公共逻辑：数据迁移 + current_mod 更新 + mod_data 初始化
                        apply_mod_storage_update(
                            &mut storage,
                            &mod_info,
                            Some(last_mod.as_ref()),
                        );
                    }
                }
            }

            // 从已加载的 Mod 中读取 global_keyboard 初始值
            let initial_global_keyboard = {
                let rm_guard = rm.lock().unwrap();
                rm_guard.current_mod.as_ref()
                    .map(|m| m.manifest.global_keyboard)
                    .unwrap_or(false)
            };

            // 从已加载的 Mod 中读取 global_mouse 初始值
            let initial_global_mouse = {
                let rm_guard = rm.lock().unwrap();
                rm_guard.current_mod.as_ref()
                    .map(|m| m.manifest.global_mouse)
                    .unwrap_or(false)
            };

            // ========== 初始化状态 ==========
            let is_silence = storage.data.settings.silence_mode;

            let initial_state = {
                let rm_guard = rm.lock().unwrap();
                rm_guard.get_state_by_name(STATE_IDLE).cloned()
            }; // 锁在此处释放

            if let Some(state) = initial_state {
                // 重新获取锁来调用 change_state
                let rm_guard = rm.lock().unwrap();
                let _ = sm.change_state(state, &rm_guard);
            }

            sm.set_app_handle(app.handle().clone());

            // ========== 获取当前 Mod 类型（在 rm 被 move 之前） ==========
            let current_mod_type = {
                let rm_guard = rm.lock().unwrap();
                rm_guard.current_mod.as_ref().map(|m| m.manifest.mod_type)
            };

            // ========== 系统托盘 (System Tray) ==========
            // 必须在注册AppState之前创建，因为需要先使用rm
            let tray_icon = {
                // 1) 获取当前加载的 Mod 图标
                // - 文件夹 mod：直接从磁盘读取
                // - archive mod：从 shared_archive_store 读取 icon.* 并落盘到临时目录再加载
                //
                // 锁序安全：先从 rm 提取数据并释放锁，再获取 archive_store 锁
                let mod_icon_info = {
                    let rm_guard = rm.lock().unwrap();
                    rm_guard.current_mod.as_ref().and_then(|m| {
                        m.icon_path.as_ref().map(|icon| {
                            (m.path.clone(), icon.clone())
                        })
                    })
                };
                // rm 锁已释放

                if let Some((mod_path, icon_path)) = mod_icon_info {
                    let mod_path_str = mod_path.to_string_lossy().into_owned();
                    if let Some(rest) = mod_path_str.strip_prefix("tbuddy-archive://") {
                        let mod_id = rest.trim_start_matches('/');
                        if !mod_id.is_empty() {
                            let bytes = {
                                let mut store = shared_archive_store.lock().unwrap();
                                store.read_file(mod_id, icon_path.as_ref()).ok()
                            };
                            if let Some(bytes) = bytes {
                                let dir = std::env::temp_dir().join("traybuddy_mod_icons");
                                let _ = std::fs::create_dir_all(&dir);
                                let safe_mod_id: String = mod_id
                                    .chars()
                                    .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
                                    .collect();
                                let safe_rel = icon_path.as_ref().replace(['/', '\\'], "_");
                                let temp_path = dir.join(format!("{}_{}", safe_mod_id, safe_rel));
                                let _ = std::fs::write(&temp_path, &bytes);
                                if let Ok(img) = Image::from_path(&temp_path) {
                                    img
                                } else {
                                    app.default_window_icon().unwrap().clone()
                                }
                            } else {
                                app.default_window_icon().unwrap().clone()
                            }
                        } else {
                            app.default_window_icon().unwrap().clone()
                        }
                    } else {
                        let full_icon_path = mod_path.join(icon_path.as_ref());
                        if full_icon_path.exists() {
                            Image::from_path(&full_icon_path)
                                .unwrap_or_else(|_| app.default_window_icon().unwrap().clone())
                        } else {
                            app.default_window_icon().unwrap().clone()
                        }
                    }
                } else {
                    app.default_window_icon().unwrap().clone()
                }
            };

            // ========== 注册全局状态（必须在创建窗口之前） ==========
            app.manage(AppState {
                resource_manager: rm,
                state_manager: Mutex::new(sm),
                storage: Mutex::new(storage),
                media_observer: Mutex::new(None),
                session_locked: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                global_keyboard_enabled: Arc::new(std::sync::atomic::AtomicBool::new(initial_global_keyboard)),
                global_mouse_enabled: Arc::new(std::sync::atomic::AtomicBool::new(initial_global_mouse)),
                pending_open_mod_archives: Mutex::new(Vec::new()),
                archive_store: shared_archive_store,
            });

            // ========== 监听设置变更以实时刷新托盘菜单 ==========
            {
                let app_handle = app.handle().clone();
                app.listen("settings-change", move |_| {
                    if let Some(tray) = app_handle.tray_by_id(TRAY_ID_MAIN) {
                        if let Ok(menu) = inner_build_tray_menu(&app_handle) {
                            let _ = tray.set_menu(Some(menu));
                        }
                    }
                });
            }

            // ========== 根据 Mod 类型创建对应的渲染窗口 ==========
            match current_mod_type {
                Some(ModType::Live2d) => {
                    inner_create_live2d_window(app.handle())?;
                }
                Some(ModType::Pngremix) => {
                    inner_create_pngremix_window(app.handle())?;
                }
                Some(ModType::ThreeD) => {
                    inner_create_threed_window(app.handle())?;
                }
                _ => {
                    // 默认（Sequence 或无 Mod）创建序列帧动画窗口
                    inner_create_animation_window(app.handle())?;
                }
            }

            // ========== 创建托盘 ==========
            {

                // 2. 创建菜单 (使用辅助函数支持国际化)
                let menu = inner_build_tray_menu(app.handle())?;

                // 3. 创建托盘
                let builder = TrayIconBuilder::with_id(TRAY_ID_MAIN)
                    .icon(tray_icon)
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(move |app, event| {
                        handle_menu_event(app, &event.id.as_ref());
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            ..
                        } = event
                        {
                            // 左键双击等逻辑可以在此添加
                        }
                    });

                builder.build(app)?;
            }

            // 在后台线程初始化环境信息（地理位置和天气）
            let app_handle_env = app.handle().clone();
            let _ = std::thread::Builder::new()
                .name("traybuddy-env".to_string())
                .spawn(move || {
                    crate::modules::utils::thread::set_current_thread_description("traybuddy: env-init");
                    init_environment(Some(app_handle_env));
                });

            // 冷启动：如果是通过双击 .tbuddy/.sbuddy 启动，自动拉起 Mods 并导入
            let cli_args: Vec<String> = std::env::args().skip(1).collect();
            handle_open_mod_archives_from_args(app.handle(), &cli_args);

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { .. } => {
                    // animation 窗口无法触发这个
                    if window.label() == WINDOW_LABEL_MAIN || window.label() == WINDOW_LABEL_SETTINGS {
                        let app_state: State<AppState> = window.state();
                        let mut storage = app_state.storage.lock().unwrap();
                        storage.save();
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    if window.label() == WINDOW_LABEL_MAIN {
                        // 主窗口销毁时，强制关闭所有可能开启的局部调试状态
                        let _ = emit(&window.app_handle(), events::LAYOUT_DEBUGGER_STATUS, false);
                    } else if RENDER_WINDOW_LABELS.contains(&window.label()) {
                        let app_state: State<AppState> = window.state();
                        let mut storage = app_state.storage.lock().unwrap();
                        storage.save();
                    }
                }
                tauri::WindowEvent::Moved(_) => {
                    if RENDER_WINDOW_LABELS.contains(&window.label()) {
                        // 发送窗口位置更新事件（发送动画区域顶部位置，与保存一致）
                        if let Ok(position) = window.outer_position() {
                            let scale_factor = window.scale_factor().unwrap_or(1.0);
                            let x = position.x as f64 / scale_factor;
                            let y = position.y as f64 / scale_factor;
                            // 动画区域顶部 Y = 窗口 Y + 气泡区域高度
                            let animation_area_y = y + BUBBLE_AREA_HEIGHT;
                            let _ = emit_from_tauri_window(&window, events::WINDOW_POSITION_CHANGED, (x, animation_area_y));
                        }
                        // 实时保存窗口位置（防止异常退出丢失）
                        save_animation_window_position(window);
                    }
                }

                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            // 常量查询
            get_const_float,
            get_const_text,
            get_const_int,
            // 系统工具
            get_env_var,
            get_build_mode,
            // 渲染调优配置
            get_render_tuning,
            // 用户设置
            get_settings,
            get_usage_stats,
            update_settings,
            get_user_info,

            update_user_info,
            get_memos,
            set_memos,
            get_reminders,
            set_reminders,
            take_pending_reminder_alerts,
            get_current_mod_data,



            set_current_mod_data_value,
            record_click_event,
            // Mod 资源管理
            get_mod_details,
            get_mod_search_paths,
            get_available_mods,
            get_mod_summaries_fast,
            load_mod,

            unload_mod,
            get_current_mod,
            get_mod_path,
            path_exists,
            get_border_config,
            get_character_config,
            get_state_by_name,
            get_trigger_by_event,
            get_asset_by_name,
            get_audio_by_name,
            get_text_by_name,
            get_info_by_lang,
            get_bubble_style,
            get_ai_tools,
            toggle_ai_tool,
            toggle_ai_tool_info_window,
            toggle_keep_screenshots,
            // 状态管理
            get_all_states,
            get_current_state,
            get_persistent_state,
            get_next_state,
            change_state,
            force_change_state,
            set_next_state,
            on_animation_complete,
            is_state_locked,
            // 触发器
            get_all_triggers,
            trigger_event,
            // 窗口和系统
            set_volume,
            set_mute,
            set_animation_scale,
            set_ignore_cursor_events,
            is_left_mouse_down,
            set_drag_end_tracking,
            get_cursor_position,

            is_cursor_in_interact_area,
            open_path,
            inspect_mod_tbuddy,
            take_pending_open_mod_archives,
            pick_mod_tbuddy,
            import_mod_from_path,
            import_mod_from_path_detailed,
            load_mod_from_path,
            import_mod,
            is_sbuddy_supported,
            export_mod_as_sbuddy,
            recreate_animation_window,
            recreate_threed_window,
            // 环境信息
            get_datetime_info,
            get_location_info,
            refresh_location_info,
            get_season_info,
            get_time_period_info,
            get_weather_info,
            // 媒体/进程调试
            get_media_debug_info,
            get_process_debug_info,
            get_system_debug_info,
            get_ai_tool_debug_info,
            get_media_status,

            open_storage_dir,
            open_dir,
            get_tbuddy_source_path,
            show_context_menu,
            get_tray_position,
            get_saved_window_position,
            reset_animation_window_position,
            // 登录检测
            start_login_detection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}



