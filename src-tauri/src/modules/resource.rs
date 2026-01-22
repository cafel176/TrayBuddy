use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;
use super::environment::get_current_datetime;
use super::environment::get_current_datetime;

// ========================================================================= //

fn default_name() -> String { "ERROR".to_string() }

// ========================================================================= //

/// 资产定义
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct AssetInfo {
    pub name: String,        // 资产名称 (如 "idle", "border")
    pub img: String,         // 文件名 (如 "idle.png")

    pub sequence: bool,      // 是否为序列帧 (true) 还是静态图 (false)
    pub need_reverse: bool,  // 循环时是否需要后接反向播放
    pub frame_time: f32,     // 每帧播放间隔 (秒)

    pub frame_size_x: u32,   // 单帧像素宽度
    pub frame_size_y: u32,   // 单帧像素高度

    pub frame_num_x: u32,    // X 轴单帧数量 (列数)
    pub frame_num_y: u32,    // Y 轴单帧数量 (行数)

    pub offset_x: i32,       // 渲染时 X 轴偏移 (像素)
    pub offset_y: i32,       // 渲染时 Y 轴偏移 (像素)
}

impl Default for AssetInfo {
    fn default() -> Self {
        Self {
            name: default_name(),
            img: String::new(),

            sequence: false,
            need_reverse: false,
            frame_time: 0.3,

            frame_size_x: 0,
            frame_size_y: 0,

            frame_num_x: 1,
            frame_num_y: 1,

            offset_x: 0,
            offset_y: 0,
        }
    }
}

// ========================================================================= //

/// 语音定义
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct AudioInfo {
    pub name: String,        // 语音名称 (如 "morning")
    pub audio: String,       // 语音文件名 (如 "morning.wav")
}

impl Default for AudioInfo {
    fn default() -> Self {
        Self {
            name: default_name(),
            audio: String::new(),
        }
    }
}

// ========================================================================= //

/// 对话文本定义
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct TextInfo {
    pub name: String,        // 文本名称
    pub text: String,        // 显示的文本内容
}

impl Default for TextInfo {
    fn default() -> Self {
        Self {
            name: default_name(),
            text: String::new(),
        }
    }
}

/// 角色多语言基础信息
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct CharacterInfo {
    pub id: String,          // 语言 ID (如 "zh")
    pub lang: String,        // 语言显示名称 (如 "中文")
    pub name: String,        // 角色在该语言下的名字
}

impl Default for CharacterInfo {
    fn default() -> Self {
        Self {
            id: default_name(),
            lang: default_name(),
            name: "Default".to_string(),
        }
    }
}

// ========================================================================= //

/// 状态定义
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct StateInfo {
    pub name: String,             // 状态名称

    pub persistent: bool,         // 是否为持久状态
    pub anima: String,            // 对应 AssetInfo 中的 name
    pub audio: String,            // 对应 AudioInfo 中的 name
    pub text: String,             // 对应 TextInfo 中的 name
    pub priority: u32,            // 优先级 (数值越大优先级越高)

    pub date_start: String,       // 允许生效日期起始 (格式: "MM-DD")
    pub date_end: String,         // 允许生效日期结束 (格式: "MM-DD")
    pub time_start: String,       // 允许生效时间起始 (格式: "HH:MM")
    pub time_end: String,         // 允许生效时间结束 (格式: "HH:MM")

    pub next_state: String,       // 播放完成后自动切换到的状态
    pub can_trigger_states: Vec<String>, // 可触发的子状态列表
    pub trigger_time: f32,        // 触发间隔时间 (秒)
    pub trigger_rate: f32,        // 触发概率 (0.0 - 1.0)
}

impl Default for StateInfo {
    fn default() -> Self {
        Self {
            name: default_name(),

            persistent: false,
            anima: String::new(),
            audio: String::new(),
            text: String::new(),
            priority: 0,

            date_start: String::new(),
            date_end: String::new(),
            time_start: String::new(),
            time_end: String::new(),

            next_state: String::new(),
            can_trigger_states: Vec::new(),
            trigger_time: 0.0,
            trigger_rate: 0.0,
        }
    }
}

impl StateInfo {
    /// 判断当前时间是否在 time_start 和 time_end 之间
    /// 时间格式: "HH:MM"
    /// 如果 time_start 或 time_end 为空，则不做时间限制，返回 true
    pub fn is_time_valid(&self) -> bool {
        // 如果未设置时间限制，返回 true
        if self.time_start.is_empty() || self.time_end.is_empty() {
            return true;
        }

        let dt = get_current_datetime();
        let current_minutes = dt.hour * 60 + dt.minute;

        let start_minutes = self.parse_time(&self.time_start).unwrap_or(0);
        let end_minutes = self.parse_time(&self.time_end).unwrap_or(24 * 60);

        // 处理跨午夜的情况 (如 22:00 - 06:00)
        if start_minutes <= end_minutes {
            current_minutes >= start_minutes && current_minutes < end_minutes
        } else {
            current_minutes >= start_minutes || current_minutes < end_minutes
        }
    }

    /// 判断当前日期是否在 date_start 和 date_end 之间
    /// 日期格式: "MM-DD"
    /// 如果 date_start 或 date_end 为空，则不做日期限制，返回 true
    pub fn is_date_valid(&self) -> bool {
        // 如果未设置日期限制，返回 true
        if self.date_start.is_empty() || self.date_end.is_empty() {
            return true;
        }

        let dt = get_current_datetime();
        let current_day = dt.month * 100 + dt.day; // MMDD 格式

        let start_day = self.parse_date(&self.date_start).unwrap_or(0);
        let end_day = self.parse_date(&self.date_end).unwrap_or(1231);

        // 处理跨年的情况 (如 12-01 - 01-31)
        if start_day <= end_day {
            current_day >= start_day && current_day <= end_day
        } else {
            current_day >= start_day || current_day <= end_day
        }
    }

    /// 解析时间字符串 "HH:MM" 为分钟数
    fn parse_time(&self, time_str: &str) -> Option<u32> {
        if time_str.is_empty() {
            return None;
        }
        
        let parts: Vec<&str> = time_str.split(':').collect();
        if parts.len() != 2 {
            return None;
        }

        let hour: u32 = parts[0].parse().ok()?;
        let minute: u32 = parts[1].parse().ok()?;

        Some(hour * 60 + minute)
    }

    /// 解析日期字符串 "MM-DD" 为 MMDD 格式的数字
    fn parse_date(&self, date_str: &str) -> Option<u32> {
        if date_str.is_empty() {
            return None;
        }

        let parts: Vec<&str> = date_str.split('-').collect();
        if parts.len() != 2 {
            return None;
        }

        let month: u32 = parts[0].parse().ok()?;
        let day: u32 = parts[1].parse().ok()?;

        Some(month * 100 + day)
    }

    // ========================================================================= //

    /// 判断当前状态是否有效
    pub fn is_enable(&self) -> bool {
        self.is_date_valid() && self.is_time_valid()
    }

}

// ========================================================================= //

/// 触发器定义
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct TriggerInfo {
    pub event: String,                   // 触发事件名称
    pub can_trigger_states: Vec<String>, // 可触发的状态列表
}

impl Default for TriggerInfo {
    fn default() -> Self {
        Self {
            event: String::new(),
            can_trigger_states: Vec::new(),
        }
    }
}

// ========================================================================= //

/// Mod 全局清单 (manifest.json)
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct ModManifest {
    pub id: String,                // Mod 唯一标识
    pub version: String,           // Mod 版本
    pub author: String,            // 作者

    pub default_audio_lang_id: String, // 默认语音语言 ID
    pub default_text_lang_id: String,  // 默认文本语言 ID
    pub border_anima: String,      // 边框动画名称

    pub important_states: HashMap<String, StateInfo>, // 核心状态 (idle 等)
    pub states: Vec<StateInfo>,    // 其他状态
    pub triggers: Vec<TriggerInfo>, // 触发器列表
}

impl Default for ModManifest {
    fn default() -> Self {
        Self {
            id: default_name(),
            version: String::new(),
            author: String::new(),

            default_audio_lang_id: String::new(),
            default_text_lang_id: String::new(),
            border_anima: String::new(),

            important_states: HashMap::new(),
            states: Vec::new(),
            triggers: Vec::new(),
        }
    }
}

impl ModManifest {
    /// 根据名称查找状态 (如 "idle", "morning")
    pub fn get_state_by_name(&self, name: &str) -> Option<&StateInfo> {
        self.important_states.get(name)
            .or_else(|| self.states.iter().find(|s| s.name == name))
    }

    /// 根据事件名称查找触发器
    pub fn get_trigger_by_event(&self, event: &str) -> Option<&TriggerInfo> {
        self.triggers.iter().find(|t| t.event == event)
    }
}

// ========================================================================= //

/// 加载后的完整 Mod 信息
#[derive(Debug, Serialize, Clone)]
pub struct ModInfo {
    pub path: PathBuf,                               // Mod 根目录绝对路径
    pub manifest: ModManifest,
    
    pub imgs: Vec<AssetInfo>,                        // 杂图资产
    pub sequences: Vec<AssetInfo>,                   // 序列帧资产
    pub audios: HashMap<String, Vec<AudioInfo>>,     // 语言代码 -> 语音资产
    pub texts: HashMap<String, Vec<TextInfo>>,      // 语言代码 -> 对话文本
    pub info: HashMap<String, CharacterInfo>,        // 语言代码 -> 基础信息
}

impl ModInfo {
    /// 根据名称从 manifest 中查找状态
    pub fn get_state_by_name(&self, name: &str) -> Option<&StateInfo> {
        self.manifest.get_state_by_name(name)
    }

    /// 根据事件名称从 manifest 中查找触发器
    pub fn get_trigger_by_event(&self, event: &str) -> Option<&TriggerInfo> {
        self.manifest.get_trigger_by_event(event)
    }

    /// 根据名称查找资产信息 (优先查找静态图 imgs，找不到再查找序列帧 sequences)
    pub fn get_asset_by_name(&self, name: &str) -> Option<&AssetInfo> {
        self.imgs.iter().find(|a| a.name == name)
            .or_else(|| self.sequences.iter().find(|a| a.name == name))
    }

    /// 根据语言代码和名称查找语音信息 (若找不到则尝试默认语言)
    pub fn get_audio_by_name(&self, lang: &str, name: &str) -> Option<&AudioInfo> {
        self.audios.get(lang)
            .and_then(|list| list.iter().find(|a| a.name == name))
            .or_else(|| {
                self.audios.get(&self.manifest.default_audio_lang_id)
                    .and_then(|list| list.iter().find(|a| a.name == name))
            })
    }

    /// 根据语言代码和名称查找对话文本 (若找不到则尝试默认语言)
    pub fn get_text_by_name(&self, lang: &str, name: &str) -> Option<&TextInfo> {
        self.texts.get(lang)
            .and_then(|list| list.iter().find(|s| s.name == name))
            .or_else(|| {
                self.texts.get(&self.manifest.default_text_lang_id)
                    .and_then(|list| list.iter().find(|s| s.name == name))
            })
    }

    /// 根据语言代码查找角色基础信息
    pub fn get_info_by_lang(&self, lang: &str) -> Option<&CharacterInfo> {
        self.info.get(lang)
    }
}

// ========================================================================= //

/// 资源管理器：负责 Mod 的扫描、解析与内存映射
pub struct ResourceManager {
    pub current_mod: Option<ModInfo>, // 当前加载的 Mod
    pub search_paths: Vec<PathBuf>, // 所有探测到的有效 mods 目录列表
}

impl ResourceManager {
    /// 初始化资源管理器
    pub fn new(app_handle: &tauri::AppHandle) -> Self {
        Self {
            current_mod: None,
            search_paths: Self::get_mod_search_paths(app_handle),
        }
    }

    // ========================================================================= //

    /// 获取所有可能的 mods 搜索路径
    fn get_mod_search_paths(app_handle: &tauri::AppHandle) -> Vec<PathBuf> {
        let mut search_paths = Vec::new();

        // 1. 默认路径：应用数据目录下的 mods 文件夹
        let mut app_config_mods = app_handle
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("mods");
        if let Ok(canonical) = dunce::canonicalize(&app_config_mods) {
            app_config_mods = canonical;
        }
        if app_config_mods.exists() && app_config_mods.is_dir() {
            search_paths.push(app_config_mods.clone());
        }
        println!("App config mods path: {:?}", app_config_mods);

        // 2. 尝试从应用可执行文件所在目录查找 (针对安装后的应用)
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let mut exe_mods = exe_dir.join("mods");
                if let Ok(canonical) = dunce::canonicalize(&exe_mods) {
                    exe_mods = canonical;
                }
                if exe_mods.exists() && exe_mods.is_dir() {
                    search_paths.push(exe_mods.clone());
                }
                println!("Exe mods path: {:?}", exe_mods);
            }
        }

        // 3. 尝试从当前工作目录的父目录查找 (针对开发环境)
        if let Ok(cwd) = std::env::current_dir() {
            if let Some(parent) = cwd.parent() {
                let mut project_mods = parent.join("mods");
                if let Ok(canonical) = dunce::canonicalize(&project_mods) {
                    project_mods = canonical;
                }
                if project_mods.exists() && project_mods.is_dir() {
                    search_paths.push(project_mods.clone());
                }
                println!("Project mods path: {:?}", project_mods);
            }
        }

        search_paths
    }

    /// 列出所有 search_paths 下的 mod 文件夹名 (去重)
    pub fn list_mods(&self) -> Vec<String> {
        let mut mods = std::collections::HashSet::new();
        for path in &self.search_paths {
            if let Ok(entries) = fs::read_dir(path) {
                for entry in entries.flatten() {
                    if entry.path().is_dir() {
                        if let Some(name) = entry.file_name().to_str() {
                            mods.insert(name.to_string());
                            println!("mods finded: {:?}", name.to_string());
                        }
                    }
                }
            }
        }
        let mut result: Vec<String> = mods.into_iter().collect();
        result.sort();
        result
    }

    /// 如果当前已加载 Mod，则将其卸载
    pub fn unload_mod(&mut self) -> bool {
        if self.current_mod.is_some() {
            self.current_mod = None;
            true
        } else {
            false
        }
    }

    /// 加载指定的 Mod 及其所有子资产
    pub fn load_mod(&mut self, mod_name: &str) -> Result<ModInfo, String> {
        let mod_path = self.search_paths.iter()
            .map(|p| p.join(mod_name))
            .find(|p| p.exists() && p.is_dir())
            .ok_or_else(|| format!("Mod directory '{}' not found in search paths", mod_name))?;

        // 1. 解析全局清单
        let manifest_path = mod_path.join("manifest.json");
        let manifest_content = fs::read_to_string(&manifest_path)
            .map_err(|e| format!("Failed to read manifest: {}", e))?;
        let manifest: ModManifest = serde_json::from_str(&manifest_content)
            .map_err(|e| format!("Failed to parse manifest: {}", e))?;

        // 2. 解析图像/动画定义 (assets/*.json)
        let assets_path = mod_path.join("assets");
        let imgs: Vec<AssetInfo> = self.load_json_list(&assets_path.join("img.json"));
        let sequences: Vec<AssetInfo> = self.load_json_list(&assets_path.join("sequence.json"));

        // 3. 解析多语言语音 (audio/[lang]/speech.json)
        let mut audios = HashMap::new();
        let audio_path = mod_path.join("audio");
        if let Ok(entries) = fs::read_dir(&audio_path) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let lang = entry.file_name().to_string_lossy().to_string();
                    let mapping: Vec<AudioInfo> = self.load_json_list(&entry.path().join("speech.json"));
                    audios.insert(lang, mapping);
                }
            }
        }

        // 4. 解析多语言文本 (text/[lang]/info.json, text/[lang]/speech.json)
        let mut info = HashMap::new();
        let mut texts = HashMap::new();
        let text_path = mod_path.join("text");
        if let Ok(entries) = fs::read_dir(&text_path) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let lang = entry.file_name().to_string_lossy().to_string();
                    
                    // 加载 info.json (角色多语言名等)
                    let char_info: Option<CharacterInfo> = self.load_json_obj(&entry.path().join("info.json"));
                    if let Some(mut char_info) = char_info {
                        if char_info.id.is_empty() || char_info.id == "ERROR" { 
                            char_info.id = lang.clone(); 
                        }
                        info.insert(lang.clone(), char_info);
                    }
                    
                    // 加载 speech.json (对话内容列表)
                    let speech_list: Vec<TextInfo> = self.load_json_list(&entry.path().join("speech.json"));
                    texts.insert(lang, speech_list);
                }
            }
        }

        let mod_info = ModInfo {
            path: mod_path,
            manifest,
            imgs,
            sequences,
            audios,
            info,
            texts,
        };

        self.current_mod = Some(mod_info.clone());
        Ok(mod_info)
    }

    // ========================================================================= //

    /// 根据名称从 manifest 中查找状态
    pub fn get_state_by_name(&self, name: &str) -> Option<&StateInfo> {
        self.current_mod.as_ref()?.get_state_by_name(name)
    }

    /// 根据事件名称从 manifest 中查找触发器
    pub fn get_trigger_by_event(&self, event: &str) -> Option<&TriggerInfo> {
        self.current_mod.as_ref()?.get_trigger_by_event(event)
    }

    /// 根据名称从当前加载的 Mod 中查找资产信息
    pub fn get_asset_by_name(&self, name: &str) -> Option<&AssetInfo> {
        self.current_mod.as_ref()?.get_asset_by_name(name)
    }

    /// 根据语言代码和名称从当前加载的 Mod 中查找语音信息
    pub fn get_audio_by_name(&self, lang: &str, name: &str) -> Option<&AudioInfo> {
        self.current_mod.as_ref()?.get_audio_by_name(lang, name)
    }

    /// 根据语言代码和名称从当前加载的 Mod 中查找对话文本
    pub fn get_text_by_name(&self, lang: &str, name: &str) -> Option<&TextInfo> {
        self.current_mod.as_ref()?.get_text_by_name(lang, name)
    }

    /// 根据语言代码从当前加载的 Mod 中查找角色基础信息
    pub fn get_info_by_lang(&self, lang: &str) -> Option<&CharacterInfo> {
        self.current_mod.as_ref()?.get_info_by_lang(lang)
    }

    // ========================================================================= //

    fn load_json_list<T: serde::de::DeserializeOwned>(&self, path: &Path) -> Vec<T> {
        if path.exists() {
            fs::read_to_string(path)
                .ok()
                .and_then(|c| serde_json::from_str(&c).ok())
                .unwrap_or_default()
        } else {
            Vec::new()
        }
    }

    fn load_json_obj<T: serde::de::DeserializeOwned>(&self, path: &Path) -> Option<T> {
        if path.exists() {
            fs::read_to_string(path)
                .ok()
                .and_then(|c| serde_json::from_str(&c).ok())
        } else {
            None
        }
    }

    // ========================================================================= //

}
