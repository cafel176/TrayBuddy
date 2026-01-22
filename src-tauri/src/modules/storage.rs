use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

// ========================================================================= //

/// 用户个性化设置
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct UserSettings {
    pub nickname: String,            // 用户昵称
    pub birthday: Option<String>,    // 用户生日 (格式: "MM-DD")
    
    pub lang: String,                // 界面语言
    pub auto_start: bool,            // 是否随开机自启动

    pub no_audio_mode: bool,         // 静音模式
    pub volume: f32,                 // 全局音量 (0.0 到 1.0)

    pub silence_mode: bool,          // 免打扰模式
    pub auto_silence_when_fullscreen: bool, // 开启全屏应用自动进入免打扰模式

    pub show_character: bool,        // 显示桌面挂件
    pub show_border: bool,           // 显示桌面挂件边框
    pub animation_scale: f32,        // 动画窗口缩放比例 (0.5 到 2.0, 默认 1.0 即 100%)
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            nickname: "User".to_string(),
            birthday: None,

            lang: "zh".to_string(),
            auto_start: true,

            no_audio_mode: false,
            volume: 1.0,

            silence_mode: false,
            auto_silence_when_fullscreen: true,

            show_character: true,
            show_border: true,
            animation_scale: 0.5,
        }
    }
}

// ========================================================================= //

/// 用户基础信息
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct UserInfo {
    pub first_login: Option<i64>,        // 第一次启动的时间戳
    pub last_login: Option<i64>,         // 最后一次启动的时间戳
    pub current_mod: String,             // 上次关闭前加载的 Mod ID

    pub animation_window_x: Option<f64>, // animation 窗口上次关闭时的 X 坐标
    pub animation_window_y: Option<f64>, // animation 窗口上次关闭时的 Y 坐标
}

impl Default for UserInfo {
    fn default() -> Self {
        Self {
            first_login: None,
            last_login: None,
            current_mod: "ema".to_string(),

            animation_window_x: None,
            animation_window_y: None,
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
    pub data: AppStorageData,    // 内存中的数据缓存
    storage_path: PathBuf,       // storage.json 的物理存储路径
}

impl Storage {
    /// 初始化存储管理器
    /// 会自动定位到应用配置目录，如果 storage.json 存在则加载，
    /// 否则创建一个包含默认值的初始环境。
    pub fn new(app_handle: &tauri::AppHandle) -> Self {
        let storage_dir = Self::get_storage_dir(app_handle);
        let storage_path = storage_dir.join("storage.json");
        let data = Self::load(&storage_path);

        Self { data, storage_path }
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
    pub fn save(&self) -> Result<(), String> {
        let content = serde_json::to_string_pretty(&self.data)
            .map_err(|e| format!("序列化存储数据失败: {}", e))?;
        fs::write(&self.storage_path, content)
            .map_err(|e| format!("写入存储文件失败: {}", e))?;
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

