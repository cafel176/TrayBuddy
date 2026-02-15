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
            auto_silence_when_fullscreen: true,
            streamer_mode: false,


            show_character: true,
            show_border: true,
            animation_scale: 0.4,

            live2d_mouse_follow: true,
            live2d_auto_interact: true,

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
            current_mod: "ema".into(),

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


    /// 初始化存储管理器
    /// 会自动定位到应用配置目录，如果 storage.json 存在则加载，
    /// 否则创建一个包含默认值的初始环境。
    pub fn new(app_handle: &tauri::AppHandle) -> Self {

        let storage_dir = Self::get_storage_dir(app_handle);
        let storage_path = storage_dir.join("storage.json");
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

    /// 获取应用配置存储目录路径
    fn get_storage_dir(app_handle: &tauri::AppHandle) -> PathBuf {
        let storage_dir = app_handle
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| PathBuf::from("."));

        // 确保目录存在
        if !storage_dir.exists() {
            let _ = fs::create_dir_all(&storage_dir);
        }

        #[cfg(debug_assertions)]
        println!("storage path: {:?}", storage_dir);

        storage_dir
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
            .map_err(|e| format!("序列化存储数据失败: {}", e))?;
        fs::write(&self.storage_path, content).map_err(|e| format!("写入存储文件失败: {}", e))?;
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
