//! 持久化存储模块
//!
//! 负责管理用户设置和应用信息的持久化存储。
//! 数据以 JSON 格式存储在应用配置目录下的 `storage.json` 文件中。
//!
//! ## 主要组件
//! - [`UserSettings`] - 用户个性化设置（语言、音量、显示选项等）
//! - [`UserInfo`] - 用户基础信息（登录时间、当前 Mod、窗口位置等）
//! - [`Storage`] - 存储管理器，负责数据的内存缓存与磁盘同步
//!
//! ## 性能说明
//! - 数据在内存中缓存，避免频繁磁盘读取
//! - 仅在数据变更时写入磁盘
//! - 使用 `serde_json` 的 pretty print 便于调试

#![allow(unused)]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

// ========================================================================= //

/// 用户个性化设置
///
/// 包含所有可由用户自定义的应用配置项。
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct UserSettings {
    pub nickname: Box<str>,         // 用户昵称
    pub birthday: Option<Box<str>>, // 用户生日 (格式: "MM-DD")

    pub lang: Box<str>,   // 界面语言
    pub auto_start: bool, // 是否随开机自启动

    pub no_audio_mode: bool, // 静音模式
    pub volume: f32,         // 全局音量 (0.0 到 1.0)

    pub silence_mode: bool,                 // 免打扰模式
    pub auto_silence_when_fullscreen: bool, // 开启全屏应用自动进入免打扰模式

    /// 主播模式：用于窗口捕捉兼容（开启时 animation 不再 skip_taskbar）
    pub streamer_mode: bool,


    pub show_character: bool, // 显示桌面挂件
    pub show_border: bool,    // 显示桌面挂件边框
    pub animation_scale: f32, // 动画窗口缩放比例 (0.5 到 2.0, 默认 1.0 即 100%)

    /// Live2D 功能开关
    pub live2d_mouse_follow: bool, // 鼠标跟随
    pub live2d_auto_interact: bool, // 自动交互

    /// 3D 动画切换过渡时长（秒）
    pub threed_cross_fade_duration: f32,

    /// AI API Key
    pub ai_api_key: Box<str>,
    /// AI 识别 API Base URL（兼容 OpenAI 的 chat/completions 端点）
    pub ai_chat_base_url: Box<str>,
    /// AI 图像识别/理解模型（用于 chat completions + vision）
    pub ai_chat_model: Box<str>,
    /// AI 截图频率（秒）
    pub ai_screenshot_interval: f32,
    /// 启动 AI 主动工具的快捷键 (F1-F12)
    pub ai_tool_hotkey: Box<str>,

}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            nickname: "User".into(),
            birthday: None,

            lang: "zh".into(),
            auto_start: true,

            no_audio_mode: false,
            volume: 1.0,

            silence_mode: false,
            auto_silence_when_fullscreen: false,
            streamer_mode: false,


            show_character: true,
            show_border: true,
            animation_scale: 0.4,

            live2d_mouse_follow: true,
            live2d_auto_interact: true,

            threed_cross_fade_duration: 0.3,

            ai_api_key: "".into(),
            ai_chat_base_url: "https://api.siliconflow.cn/v1".into(),
            ai_chat_model: "Pro/Qwen/Qwen2.5-VL-7B-Instruct".into(),
            ai_screenshot_interval: 1.0,
            ai_tool_hotkey: "F1".into(),

        }
    }
}

// ========================================================================= //

/// 备忘录条目（保存在 UserInfo 中）
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct MemoItem {
    /// 唯一 ID（前端生成 UUID）
    pub id: String,
    /// 分类名称
    pub category: Box<str>,
    /// 内容（支持多行）
    pub content: Box<str>,
    /// 是否置顶
    pub pinned: bool,
    /// 顺序（越小越靠前）
    pub order: i32,
}

impl Default for MemoItem {
    fn default() -> Self {
        Self {
            id: String::new(),
            category: "默认".into(),
            content: "".into(),
            pinned: false,
            order: 0,
        }
    }
}

// ========================================================================= //
// 定时提醒（保存在 UserInfo 中）
// ========================================================================= //

/// 每周的星期几（1=周一 ... 7=周日）
pub type WeekdayNumber = u8;

/// 定时提醒调度规则（支持绝对时间/相对延迟/每周循环）。
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ReminderSchedule {

    /// 指定一个绝对时间（本地时间戳，秒）
    Absolute { timestamp: i64 },

    /// 从创建时刻起，延后一段时间触发（秒）
    After { seconds: u64, created_at: Option<i64> },

    /// 每周在某些天的某个时间触发（本地时间）
    Weekly {
        days: Vec<WeekdayNumber>,
        hour: u8,
        minute: u8,
    },
}

impl Default for ReminderSchedule {
    fn default() -> Self {
        Self::After {
            seconds: 60,
            created_at: None,
        }
    }
}

/// 定时提醒条目（用于持久化到 UserInfo）。
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct ReminderItem {

    /// 唯一 ID（前端生成 UUID）
    pub id: String,
    /// 文本内容
    pub text: Box<str>,
    /// 是否启用
    pub enabled: bool,

    /// 计划类型
    pub schedule: ReminderSchedule,

    /// 下次触发时间（本地时间戳，秒；由后端归一化维护）
    pub next_trigger_at: i64,
    /// 最近一次触发时间（本地时间戳，秒；用于去重）
    pub last_trigger_at: Option<i64>,
}

impl Default for ReminderItem {
    fn default() -> Self {
        Self {
            id: String::new(),
            text: "".into(),
            enabled: true,
            schedule: ReminderSchedule::default(),
            next_trigger_at: 0,
            last_trigger_at: None,
        }
    }
}

/// 每个 Mod 的独立数据（保存在 UserInfo 中）
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct ModData {


    /// Mod ID（使用 manifest.json 的 id 作为唯一标识）
    pub mod_id: String,
    /// 一个整型变量（可由 Mod/前端自由定义语义）
    pub value: i32,
}

impl Default for ModData {
    fn default() -> Self {
        Self {
            mod_id: "".into(),
            value: 0,
        }
    }
}

/// 用户基础信息
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct UserInfo {
    pub first_login: Option<i64>, // 第一次启动的时间戳
    pub last_login: Option<i64>,  // 最后一次启动的时间戳
    pub current_mod: Box<str>,    // 上次关闭前加载的 Mod ID（manifest.json 的 id）

    pub animation_window_x: Option<f64>, // animation 窗口上次关闭时的 X 坐标
    pub animation_window_y: Option<f64>, // animation 窗口上次关闭时的 Y 坐标

    pub launch_count: i32,        // 总启动次数
    pub total_usage_seconds: i64, // 累计使用时长（秒）
    pub total_click_count: i64,   // 总点击次数

    /// 各 Mod 的持久化数据（key = manifest.id）
    pub mod_data: HashMap<String, ModData>,

    /// 备忘录（按分类/顺序由前端渲染）
    pub memos: Vec<MemoItem>,

    /// 定时提醒（支持一次性/每周/延时）
    pub reminders: Vec<ReminderItem>,

}

impl Default for UserInfo {
    fn default() -> Self {
        Self {
            first_login: None,
            last_login: None,
            current_mod: "tutorial".into(),

            animation_window_x: None,
            animation_window_y: None,

            launch_count: 0,
            total_usage_seconds: 0,
            total_click_count: 0,

            mod_data: HashMap::new(),
            memos: Vec::new(),
            reminders: Vec::new(),

        }
    }
}

// ========================================================================= //

/// 存储在文件中的完整数据结构
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct AppStorageData {
    pub settings: UserSettings,
    pub info: UserInfo,
}

impl Default for AppStorageData {
    fn default() -> Self {
        Self {
            settings: UserSettings::default(),
            info: UserInfo::default(),
        }
    }
}

// ========================================================================= //

/// 存储管理器：负责数据的内存缓存与磁盘同步
pub struct Storage {
    pub data: AppStorageData, // 内存中的数据缓存
    storage_path: PathBuf,    // storage.json 的物理存储路径

    /// 程序启动时间（只用于“本次启动已运行多久”等实时占位符，**不会**被重置）
    app_start_time: std::time::Instant,

    /// 使用时长统计的检查点：用于把本次运行的增量累计到 `total_usage_seconds`，会在 `save()` 后重置
    usage_checkpoint_time: std::time::Instant,
}

impl Storage {
    /// 获取累计使用时长（秒，包含本次运行中尚未落盘的部分）
    #[inline]
    pub fn get_total_usage_seconds_now(&self) -> i64 {
        self.data.info.total_usage_seconds + self.usage_checkpoint_time.elapsed().as_secs() as i64
    }

    /// 获取“本次启动”已运行时长（秒）
    #[inline]
    pub fn get_session_uptime_seconds_now(&self) -> i64 {
        self.app_start_time.elapsed().as_secs() as i64
    }


    /// 使用指定路径初始化存储管理器（用于测试或工具场景）
    pub fn new_with_path(storage_path: PathBuf) -> Self {
        let data = Self::load(&storage_path);

        // 记录程序启动时间（不重置）
        let app_start_time = std::time::Instant::now();
        // 使用时长统计检查点（会在 save() 后重置，避免重复累计）
        let usage_checkpoint_time = app_start_time;

        Self {
            data,
            storage_path,
            app_start_time,
            usage_checkpoint_time,
        }
    }


    // ========================================================================= //

    /// 从磁盘加载存储数据，若文件不存在或解析失败则返回默认值
    fn load(storage_path: &PathBuf) -> AppStorageData {
        if storage_path.exists() {
            let content = fs::read_to_string(storage_path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            AppStorageData::default()
        }
    }

    /// 将当前内存中的数据序列化并保存到磁盘文件
    ///
    /// 在保存前会自动计算并累加本次使用时长到 total_usage_seconds
    pub fn save(&mut self) -> Result<(), String> {
        // 计算并累加本次使用时长（从上次检查点到现在）
        let elapsed = self.usage_checkpoint_time.elapsed().as_secs() as i64;
        self.data.info.total_usage_seconds += elapsed;
        // 更新检查点为当前时间，避免重复累计
        self.usage_checkpoint_time = std::time::Instant::now();

        let content = serde_json::to_string_pretty(&self.data)
            .map_err(|e| format!("Failed to serialize storage data: {}", e))?;
        fs::write(&self.storage_path, content).map_err(|e| format!("Failed to write storage file: {}", e))?;
        Ok(())
    }

    /// 更新用户设置并立即同步到磁盘
    pub fn update_settings(&mut self, settings: UserSettings) -> Result<(), String> {
        self.data.settings = settings;
        self.save()
    }

    /// 更新用户信息并立即同步到磁盘
    pub fn update_user_info(&mut self, info: UserInfo) -> Result<(), String> {
        self.data.info = info;
        self.save()
    }
}

// 运行时函数（依赖 AppHandle），拆分到独立文件以便排除覆盖率统计
include!("storage_runtime.rs");

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};


    fn temp_path(label: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        path.push(format!("traybuddy_storage_test_{}_{}.json", label, nanos));
        path
    }

    #[test]
    fn load_missing_returns_default() {
        let path = temp_path("missing");
        if path.exists() {
            let _ = fs::remove_file(&path);
        }

        let data = Storage::load(&path);
        assert_eq!(data.settings.lang.as_ref(), "zh");
        assert_eq!(data.info.current_mod.as_ref(), "tutorial");
    }

    #[test]
    fn load_invalid_returns_default() {
        let path = temp_path("invalid");
        fs::write(&path, "not json").unwrap();

        let data = Storage::load(&path);
        assert_eq!(data.settings.lang.as_ref(), "zh");
        assert_eq!(data.info.current_mod.as_ref(), "tutorial");

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn load_valid_parses_data() {
        let path = temp_path("valid");
        let mut data = AppStorageData::default();
        data.settings.lang = "en".into();
        data.info.current_mod = "test_mod".into();
        let content = serde_json::to_string_pretty(&data).unwrap();
        fs::write(&path, content).unwrap();

        let loaded = Storage::load(&path);
        assert_eq!(loaded.settings.lang.as_ref(), "en");
        assert_eq!(loaded.info.current_mod.as_ref(), "test_mod");

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn load_directory_returns_default() {
        let path = temp_path("dir");
        fs::create_dir_all(&path).unwrap();

        let loaded = Storage::load(&path);
        assert_eq!(loaded.settings.lang.as_ref(), "zh");
        assert_eq!(loaded.info.current_mod.as_ref(), "tutorial");

        let _ = fs::remove_dir_all(&path);
    }

    #[test]
    fn save_writes_json_file() {
        let path = temp_path("save");
        let mut data = AppStorageData::default();
        data.settings.lang = "en".into();
        data.info.current_mod = "saved_mod".into();

        let mut storage = Storage {
            data: data.clone(),
            storage_path: path.clone(),
            app_start_time: Instant::now(),
            usage_checkpoint_time: Instant::now(),
        };

        storage.save().unwrap();
        let content = fs::read_to_string(&path).unwrap();
        let saved: AppStorageData = serde_json::from_str(&content).unwrap();
        assert_eq!(saved.settings.lang.as_ref(), "en");
        assert_eq!(saved.info.current_mod.as_ref(), "saved_mod");

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn update_settings_updates_and_persists() {
        let path = temp_path("update_settings");
        let mut storage = Storage::new_with_path(path.clone());
        let mut settings = storage.data.settings.clone();
        settings.lang = "jp".into();
        settings.no_audio_mode = true;

        storage.update_settings(settings).unwrap();
        let saved = Storage::load(&path);
        assert_eq!(saved.settings.lang.as_ref(), "jp");
        assert!(saved.settings.no_audio_mode);

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn update_user_info_updates_and_persists() {
        let path = temp_path("update_info");
        let mut storage = Storage::new_with_path(path.clone());
        let mut info = storage.data.info.clone();
        info.current_mod = "new_mod".into();
        info.launch_count = 42;

        storage.update_user_info(info).unwrap();
        let saved = Storage::load(&path);
        assert_eq!(saved.info.current_mod.as_ref(), "new_mod");
        assert_eq!(saved.info.launch_count, 42);

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn usage_and_uptime_include_elapsed() {
        let path = temp_path("usage");
        let data = AppStorageData::default();
        let mut storage = Storage {
            data,
            storage_path: path,
            app_start_time: Instant::now() - Duration::from_secs(3),
            usage_checkpoint_time: Instant::now() - Duration::from_secs(2),
        };
        storage.data.info.total_usage_seconds = 10;

        let total = storage.get_total_usage_seconds_now();
        let uptime = storage.get_session_uptime_seconds_now();

        assert!(total >= 12);
        assert!(uptime >= 3);
    }

    #[test]
    fn defaults_cover_structs() {
        let settings = UserSettings::default();
        assert_eq!(settings.lang.as_ref(), "zh");

        let memo = MemoItem::default();
        assert_eq!(memo.order, 0);

        let reminder = ReminderItem::default();
        assert!(reminder.enabled);
        match reminder.schedule {
            ReminderSchedule::After { seconds, created_at } => {
                assert_eq!(seconds, 60);
                assert!(created_at.is_none());
            }
            _ => panic!("unexpected schedule default"),
        }

        let mod_data = ModData::default();
        assert_eq!(mod_data.value, 0);

        let info = UserInfo::default();
        assert_eq!(info.current_mod.as_ref(), "tutorial");
    }

    #[test]
    fn save_returns_error_when_path_is_directory() {
        let path = temp_path("save_dir");
        fs::create_dir_all(&path).unwrap();

        let mut storage = Storage {
            data: AppStorageData::default(),
            storage_path: path.clone(),
            app_start_time: Instant::now(),
            usage_checkpoint_time: Instant::now(),
        };

        let err = storage.save().unwrap_err();
        assert!(err.contains("Failed to write storage file"));

        let _ = fs::remove_dir_all(&path);
    }

    // ========================================================================= //
    // ReminderSchedule serde edge cases
    // ========================================================================= //

    #[test]
    fn reminder_schedule_absolute_serde_roundtrip() {
        let schedule = ReminderSchedule::Absolute { timestamp: 1700000000 };
        let json = serde_json::to_string(&schedule).unwrap();
        assert!(json.contains("\"kind\":\"absolute\""));
        let parsed: ReminderSchedule = serde_json::from_str(&json).unwrap();
        match parsed {
            ReminderSchedule::Absolute { timestamp } => assert_eq!(timestamp, 1700000000),
            _ => panic!("expected Absolute"),
        }
    }

    #[test]
    fn reminder_schedule_after_serde_roundtrip() {
        let schedule = ReminderSchedule::After { seconds: 300, created_at: Some(1000) };
        let json = serde_json::to_string(&schedule).unwrap();
        assert!(json.contains("\"kind\":\"after\""));
        let parsed: ReminderSchedule = serde_json::from_str(&json).unwrap();
        match parsed {
            ReminderSchedule::After { seconds, created_at } => {
                assert_eq!(seconds, 300);
                assert_eq!(created_at, Some(1000));
            }
            _ => panic!("expected After"),
        }
    }

    #[test]
    fn reminder_schedule_weekly_serde_roundtrip() {
        let schedule = ReminderSchedule::Weekly { days: vec![1, 3, 5], hour: 9, minute: 30 };
        let json = serde_json::to_string(&schedule).unwrap();
        assert!(json.contains("\"kind\":\"weekly\""));
        let parsed: ReminderSchedule = serde_json::from_str(&json).unwrap();
        match parsed {
            ReminderSchedule::Weekly { days, hour, minute } => {
                assert_eq!(days, vec![1, 3, 5]);
                assert_eq!(hour, 9);
                assert_eq!(minute, 30);
            }
            _ => panic!("expected Weekly"),
        }
    }

    // ========================================================================= //
    // ModData serde
    // ========================================================================= //

    #[test]
    fn mod_data_serde_roundtrip() {
        let md = ModData { mod_id: "test_mod".into(), value: 42 };
        let json = serde_json::to_string(&md).unwrap();
        let parsed: ModData = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.mod_id, "test_mod");
        assert_eq!(parsed.value, 42);
    }

    #[test]
    fn mod_data_from_empty_json() {
        let parsed: ModData = serde_json::from_str("{}").unwrap();
        assert_eq!(parsed.mod_id, "");
        assert_eq!(parsed.value, 0);
    }

    // ========================================================================= //
    // MemoItem serde
    // ========================================================================= //

    #[test]
    fn memo_item_serde_roundtrip() {
        let memo = MemoItem {
            id: "uuid1".into(),
            category: "工作".into(),
            content: "完成任务".into(),
            pinned: true,
            order: 1,
        };
        let json = serde_json::to_string(&memo).unwrap();
        let parsed: MemoItem = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "uuid1");
        assert!(parsed.pinned);
    }

    #[test]
    fn memo_item_from_empty_json() {
        let parsed: MemoItem = serde_json::from_str("{}").unwrap();
        assert_eq!(parsed.category.as_ref(), "默认");
        assert!(!parsed.pinned);
    }

    // ========================================================================= //
    // ReminderItem serde
    // ========================================================================= //

    #[test]
    fn reminder_item_serde_roundtrip() {
        let item = ReminderItem {
            id: "r1".into(),
            text: "提醒".into(),
            enabled: false,
            schedule: ReminderSchedule::Absolute { timestamp: 9999 },
            next_trigger_at: 9999,
            last_trigger_at: Some(5000),
        };
        let json = serde_json::to_string(&item).unwrap();
        let parsed: ReminderItem = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "r1");
        assert!(!parsed.enabled);
        assert_eq!(parsed.last_trigger_at, Some(5000));
    }

    // ========================================================================= //
    // AppStorageData serde
    // ========================================================================= //

    #[test]
    fn app_storage_data_from_empty_json() {
        let parsed: AppStorageData = serde_json::from_str("{}").unwrap();
        assert_eq!(parsed.settings.lang.as_ref(), "zh");
        assert_eq!(parsed.info.current_mod.as_ref(), "tutorial");
    }

    #[test]
    fn app_storage_data_roundtrip() {
        let mut data = AppStorageData::default();
        data.settings.lang = "en".into();
        data.info.launch_count = 5;
        data.info.mod_data.insert("mod1".into(), ModData { mod_id: "mod1".into(), value: 10 });

        let json = serde_json::to_string(&data).unwrap();
        let parsed: AppStorageData = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.settings.lang.as_ref(), "en");
        assert_eq!(parsed.info.launch_count, 5);
        assert_eq!(parsed.info.mod_data.get("mod1").unwrap().value, 10);
    }

    // ========================================================================= //
    // UserSettings defaults
    // ========================================================================= //

    #[test]
    fn user_settings_all_defaults() {
        let s = UserSettings::default();
        assert_eq!(s.nickname.as_ref(), "User");
        assert!(s.birthday.is_none());
        assert_eq!(s.lang.as_ref(), "zh");
        assert!(s.auto_start);
        assert!(!s.no_audio_mode);
        assert_eq!(s.volume, 1.0);
        assert!(!s.silence_mode);
        assert!(!s.auto_silence_when_fullscreen);
        assert!(!s.streamer_mode);
        assert!(s.show_character);
        assert!(s.show_border);
        assert_eq!(s.animation_scale, 0.4);
        assert!(s.live2d_mouse_follow);
        assert!(s.live2d_auto_interact);
        assert_eq!(s.threed_cross_fade_duration, 0.3);
        assert_eq!(s.ai_api_key.as_ref(), "");
        assert_eq!(s.ai_chat_base_url.as_ref(), "https://api.siliconflow.cn/v1");
        assert_eq!(s.ai_chat_model.as_ref(), "Pro/Qwen/Qwen2.5-VL-7B-Instruct");
        assert_eq!(s.ai_screenshot_interval, 1.0);
        assert_eq!(s.ai_tool_hotkey.as_ref(), "F1");
    }

    // ========================================================================= //
    // UserInfo defaults
    // ========================================================================= //

    #[test]
    fn user_info_all_defaults() {
        let info = UserInfo::default();
        assert!(info.first_login.is_none());
        assert!(info.last_login.is_none());
        assert_eq!(info.current_mod.as_ref(), "tutorial");
        assert!(info.animation_window_x.is_none());
        assert!(info.animation_window_y.is_none());
        assert_eq!(info.launch_count, 0);
        assert_eq!(info.total_usage_seconds, 0);
        assert_eq!(info.total_click_count, 0);
        assert!(info.mod_data.is_empty());
        assert!(info.memos.is_empty());
        assert!(info.reminders.is_empty());
    }

    // ========================================================================= //
    // new_with_path creates file on first save
    // ========================================================================= //

    #[test]
    fn new_with_path_nonexistent_creates_default() {
        let path = temp_path("new_with_path");
        let storage = Storage::new_with_path(path.clone());
        assert_eq!(storage.data.settings.lang.as_ref(), "zh");
        assert!(!path.exists()); // not saved yet
    }

    // ========================================================================= //
    // save accumulates usage time
    // ========================================================================= //

    #[test]
    fn save_accumulates_usage_and_resets_checkpoint() {
        let path = temp_path("usage_accum");
        let mut storage = Storage {
            data: AppStorageData::default(),
            storage_path: path.clone(),
            app_start_time: Instant::now() - Duration::from_secs(10),
            usage_checkpoint_time: Instant::now() - Duration::from_secs(5),
        };
        storage.data.info.total_usage_seconds = 100;

        storage.save().unwrap();
        // After save, usage should have been accumulated
        assert!(storage.data.info.total_usage_seconds >= 105);

        let _ = fs::remove_file(&path);
    }
}


