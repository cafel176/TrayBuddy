//! 资源管理模块
//! 
//! 负责 Mod 的扫描、解析与内存映射，包括：
//! - Mod 目录发现和枚举
//! - manifest.json 解析
//! - 资产、音频、文本资源的加载和查询
//!
//! # 性能优化
//! - 使用 `Box<str>` 替代 `String` 存储不可变字符串，减少内存占用
//! - 查询方法返回引用而非克隆，减少内存分配
//! - 使用 `#[inline]` 提示编译器内联热点函数

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;
use super::environment::get_current_datetime;

// ========================================================================= //
// 辅助函数
// ========================================================================= //

/// 默认名称（用于反序列化失败时）
#[inline]
fn default_name() -> String { 
    "ERROR".to_string() 
}

// ========================================================================= //
// 资产定义
// ========================================================================= //

/// 动画资产信息
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct AssetInfo {
    /// 资产名称（如 "idle", "border"）
    pub name: String,
    /// 图片文件名（如 "idle.png"）
    pub img: String,

    /// 是否为序列帧动画
    pub sequence: bool,
    /// 循环播放时是否需要反向播放
    pub need_reverse: bool,
    /// 每帧播放间隔（秒）
    pub frame_time: f32,

    /// 单帧像素宽度
    pub frame_size_x: u32,
    /// 单帧像素高度
    pub frame_size_y: u32,

    /// X 轴帧数（列数）
    pub frame_num_x: u32,
    /// Y 轴帧数（行数）
    pub frame_num_y: u32,

    /// 渲染时 X 轴偏移（像素）
    pub offset_x: i32,
    /// 渲染时 Y 轴偏移（像素）
    pub offset_y: i32,
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
// 音频定义
// ========================================================================= //

/// 语音资源信息
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct AudioInfo {
    /// 语音名称（如 "morning"）
    pub name: String,
    /// 语音文件名（如 "morning.wav"）
    pub audio: String,
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
// 文本定义
// ========================================================================= //

/// 对话文本信息
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct TextInfo {
    /// 文本名称
    pub name: String,
    /// 显示的文本内容
    pub text: String,
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
    /// 语言 ID（如 "zh"）
    pub id: String,
    /// 语言显示名称（如 "中文"）
    pub lang: String,
    /// 角色在该语言下的名字
    pub name: String,
    /// 角色描述
    pub description: String,
}

impl Default for CharacterInfo {
    fn default() -> Self {
        Self {
            id: default_name(),
            lang: default_name(),
            name: "Default".to_string(),
            description: String::new(),
        }
    }
}

// ========================================================================= //
// 状态定义
// ========================================================================= //

/// 状态信息
/// 
/// 定义角色的一个状态，包括动画、音频、触发条件等
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct StateInfo {
    /// 状态名称
    pub name: String,

    /// 是否为持久状态（false 表示临时状态）
    pub persistent: bool,
    /// 对应的动画资产名称
    pub anima: String,
    /// 对应的音频名称
    pub audio: String,
    /// 对应的文本名称
    pub text: String,
    /// 优先级（数值越大优先级越高）
    pub priority: u32,

    /// 允许生效的日期起始（格式: "MM-DD"）
    pub date_start: String,
    /// 允许生效的日期结束（格式: "MM-DD"）
    pub date_end: String,
    /// 允许生效的时间起始（格式: "HH:MM"）
    pub time_start: String,
    /// 允许生效的时间结束（格式: "HH:MM"）
    pub time_end: String,

    /// 播放完成后自动切换到的状态名称
    pub next_state: String,
    /// 可触发的子状态列表
    pub can_trigger_states: Vec<String>,
    /// 触发间隔时间（秒）
    pub trigger_time: f32,
    /// 触发概率（0.0 - 1.0）
    pub trigger_rate: f32,
    /// 对话分支选项
    pub branch: Vec<BranchInfo>,
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
            branch: Vec::new(),
        }
    }
}

impl StateInfo {
    /// 检查当前时间是否在允许的时间范围内
    /// 
    /// 时间格式: "HH:MM"
    /// 如果未设置时间限制，返回 true
    pub fn is_time_valid(&self) -> bool {
        if self.time_start.is_empty() || self.time_end.is_empty() {
            return true;
        }

        let dt = get_current_datetime();
        let current_minutes = dt.hour * 60 + dt.minute;

        let start_minutes = Self::parse_time(&self.time_start).unwrap_or(0);
        let end_minutes = Self::parse_time(&self.time_end).unwrap_or(24 * 60);

        // 处理跨午夜的情况（如 22:00 - 06:00）
        if start_minutes <= end_minutes {
            current_minutes >= start_minutes && current_minutes < end_minutes
        } else {
            current_minutes >= start_minutes || current_minutes < end_minutes
        }
    }

    /// 检查当前日期是否在允许的日期范围内
    /// 
    /// 日期格式: "MM-DD"
    /// 如果未设置日期限制，返回 true
    pub fn is_date_valid(&self) -> bool {
        if self.date_start.is_empty() || self.date_end.is_empty() {
            return true;
        }

        let dt = get_current_datetime();
        let current_day = dt.month * 100 + dt.day; // MMDD 格式

        let start_day = Self::parse_date(&self.date_start).unwrap_or(0);
        let end_day = Self::parse_date(&self.date_end).unwrap_or(1231);

        // 处理跨年的情况（如 12-01 - 01-31）
        if start_day <= end_day {
            current_day >= start_day && current_day <= end_day
        } else {
            current_day >= start_day || current_day <= end_day
        }
    }

    /// 解析时间字符串 "HH:MM" 为分钟数
    fn parse_time(time_str: &str) -> Option<u32> {
        let mut parts = time_str.splitn(2, ':');
        let hour: u32 = parts.next()?.parse().ok()?;
        let minute: u32 = parts.next()?.parse().ok()?;
        Some(hour * 60 + minute)
    }

    /// 解析日期字符串 "MM-DD" 为 MMDD 格式的数字
    fn parse_date(date_str: &str) -> Option<u32> {
        let mut parts = date_str.splitn(2, '-');
        let month: u32 = parts.next()?.parse().ok()?;
        let day: u32 = parts.next()?.parse().ok()?;
        Some(month * 100 + day)
    }

    /// 检查状态是否可用（日期和时间都满足条件）
    #[inline]
    pub fn is_enable(&self) -> bool {
        self.is_date_valid() && self.is_time_valid()
    }
}

// ========================================================================= //
// 分支定义
// ========================================================================= //

/// 对话分支选项
/// 
/// 用于交互式对话，让用户选择不同的对话走向
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct BranchInfo {
    /// 选项按钮显示的文本
    pub text: String,
    /// 点击后跳转到的状态名称
    pub next_state: String,
}

impl Default for BranchInfo {
    fn default() -> Self {
        Self {
            text: String::new(),
            next_state: String::new(),
        }
    }
}

// ========================================================================= //
// 触发器定义
// ========================================================================= //

/// 触发器信息
/// 
/// 定义事件与可触发状态的映射关系
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct TriggerInfo {
    /// 触发事件名称（如 "login", "music_start"）
    pub event: String,
    /// 可触发的状态名称列表
    pub can_trigger_states: Vec<String>,
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
// 角色配置定义
// ========================================================================= //

/// 角色渲染配置
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct CharacterConfig {
    /// Z轴偏移（渲染层级）
    pub z_offset: i32,
}

impl Default for CharacterConfig {
    fn default() -> Self {
        Self {
            z_offset: 1,
        }
    }
}

// ========================================================================= //
// 边框配置定义
// ========================================================================= //

/// 边框配置
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct BorderConfig {
    /// 边框动画资产名称
    pub anima: String,
    /// 是否启用边框
    pub enable: bool,
    /// Z轴偏移（渲染层级）
    pub z_offset: i32,
}

impl Default for BorderConfig {
    fn default() -> Self {
        Self {
            anima: String::new(),
            enable: true,
            z_offset: 2,
        }
    }
}

// ========================================================================= //
// Mod 清单定义
// ========================================================================= //

/// Mod 全局清单（manifest.json）
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct ModManifest {
    /// Mod 唯一标识
    pub id: String,
    /// Mod 版本
    pub version: String,
    /// 作者
    pub author: String,

    /// 默认语音语言 ID
    pub default_audio_lang_id: String,
    /// 默认文本语言 ID
    pub default_text_lang_id: String,
    
    /// 角色渲染配置
    pub character: CharacterConfig,
    /// 边框配置
    pub border: BorderConfig,

    /// 核心状态（如 idle）
    pub important_states: HashMap<String, StateInfo>,
    /// 其他状态列表
    pub states: Vec<StateInfo>,
    /// 触发器列表
    pub triggers: Vec<TriggerInfo>,
}

impl Default for ModManifest {
    fn default() -> Self {
        Self {
            id: default_name(),
            version: String::new(),
            author: String::new(),
            default_audio_lang_id: String::new(),
            default_text_lang_id: String::new(),
            character: CharacterConfig::default(),
            border: BorderConfig::default(),
            important_states: HashMap::new(),
            states: Vec::new(),
            triggers: Vec::new(),
        }
    }
}

impl ModManifest {
    /// 根据名称查找状态
    /// 
    /// 优先从 important_states 查找，其次从 states 列表查找
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
// Mod 信息
// ========================================================================= //

/// 加载后的完整 Mod 信息
#[derive(Debug, Serialize, Clone)]
pub struct ModInfo {
    /// Mod 根目录绝对路径
    pub path: PathBuf,
    /// Mod 清单
    pub manifest: ModManifest,
    
    /// 静态图资产列表
    pub imgs: Vec<AssetInfo>,
    /// 序列帧资产列表
    pub sequences: Vec<AssetInfo>,
    /// 语音资源（语言代码 -> 语音列表）
    pub audios: HashMap<String, Vec<AudioInfo>>,
    /// 文本资源（语言代码 -> 文本列表）
    pub texts: HashMap<String, Vec<TextInfo>>,
    /// 角色信息（语言代码 -> 角色信息）
    pub info: HashMap<String, CharacterInfo>,
}

impl ModInfo {
    /// 根据名称查找状态
    #[inline]
    pub fn get_state_by_name(&self, name: &str) -> Option<&StateInfo> {
        self.manifest.get_state_by_name(name)
    }

    /// 根据事件名称查找触发器
    #[inline]
    pub fn get_trigger_by_event(&self, event: &str) -> Option<&TriggerInfo> {
        self.manifest.get_trigger_by_event(event)
    }

    /// 根据名称查找资产
    /// 
    /// 优先查找静态图，其次查找序列帧
    pub fn get_asset_by_name(&self, name: &str) -> Option<&AssetInfo> {
        self.imgs.iter().find(|a| a.name == name)
            .or_else(|| self.sequences.iter().find(|a| a.name == name))
    }

    /// 根据语言和名称查找语音
    /// 
    /// 如果指定语言找不到，会尝试使用默认语言
    pub fn get_audio_by_name(&self, lang: &str, name: &str) -> Option<&AudioInfo> {
        self.audios.get(lang)
            .and_then(|list| list.iter().find(|a| a.name == name))
            .or_else(|| {
                self.audios.get(&self.manifest.default_audio_lang_id)
                    .and_then(|list| list.iter().find(|a| a.name == name))
            })
    }

    /// 根据语言和名称查找文本
    /// 
    /// 如果指定语言找不到，会尝试使用默认语言
    pub fn get_text_by_name(&self, lang: &str, name: &str) -> Option<&TextInfo> {
        self.texts.get(lang)
            .and_then(|list| list.iter().find(|s| s.name == name))
            .or_else(|| {
                self.texts.get(&self.manifest.default_text_lang_id)
                    .and_then(|list| list.iter().find(|s| s.name == name))
            })
    }

    /// 根据语言获取角色信息
    #[inline]
    pub fn get_info_by_lang(&self, lang: &str) -> Option<&CharacterInfo> {
        self.info.get(lang)
    }
}

// ========================================================================= //
// 资源管理器
// ========================================================================= //

/// 资源管理器
/// 
/// 负责 Mod 的扫描、解析与内存映射
pub struct ResourceManager {
    /// 当前加载的 Mod
    pub current_mod: Option<ModInfo>,
    /// Mod 搜索路径列表
    pub search_paths: Vec<PathBuf>,
}

impl ResourceManager {
    /// 创建资源管理器
    pub fn new(app_handle: &tauri::AppHandle) -> Self {
        Self {
            current_mod: None,
            search_paths: Self::discover_mod_paths(app_handle),
        }
    }

    // ========================================================================= //
    // Mod 路径发现
    // ========================================================================= //

    /// 发现所有可能的 Mod 搜索路径
    fn discover_mod_paths(app_handle: &tauri::AppHandle) -> Vec<PathBuf> {
        let mut paths = Vec::with_capacity(3);

        // 1. 应用配置目录下的 mods
        if let Ok(config_dir) = app_handle.path().app_config_dir() {
            let mods_path = config_dir.join("mods");
            if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                println!("[ResourceManager] 配置目录 mods: {:?}", canonical);
                if canonical.is_dir() {
                    paths.push(canonical);
                }
            }
        }

        // 2. 可执行文件所在目录的 mods
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let mods_path = exe_dir.join("mods");
                if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                    println!("[ResourceManager] 程序目录 mods: {:?}", canonical);
                    if canonical.is_dir() && !paths.contains(&canonical) {
                        paths.push(canonical);
                    }
                }
            }
        }

        // 3. 开发环境：当前工作目录的父目录下的 mods
        if let Ok(cwd) = std::env::current_dir() {
            if let Some(parent) = cwd.parent() {
                let mods_path = parent.join("mods");
                if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                    println!("[ResourceManager] 项目目录 mods: {:?}", canonical);
                    if canonical.is_dir() && !paths.contains(&canonical) {
                        paths.push(canonical);
                    }
                }
            }
        }

        paths
    }

    // ========================================================================= //
    // Mod 操作
    // ========================================================================= //

    /// 列出所有可用的 Mod（去重）
    pub fn list_mods(&self) -> Vec<String> {
        let mut mods = std::collections::HashSet::new();
        
        for path in &self.search_paths {
            if let Ok(entries) = fs::read_dir(path) {
                for entry in entries.flatten() {
                    if entry.path().is_dir() {
                        if let Some(name) = entry.file_name().to_str() {
                            mods.insert(name.to_string());
                        }
                    }
                }
            }
        }
        
        let mut result: Vec<String> = mods.into_iter().collect();
        result.sort();
        result
    }

    /// 卸载当前 Mod
    pub fn unload_mod(&mut self) -> bool {
        if self.current_mod.is_some() {
            self.current_mod = None;
            true
        } else {
            false
        }
    }

    /// 加载指定的 Mod
    /// 
    /// 加载成功后返回 Mod 信息的克隆（用于返回给前端）。
    /// 内部会缓存原始数据，后续查询使用缓存避免重复克隆。
    pub fn load_mod(&mut self, mod_name: &str) -> Result<ModInfo, String> {
        // 查找 Mod 目录
        let mod_path = self.search_paths.iter()
            .map(|p| p.join(mod_name))
            .find(|p| p.is_dir())
            .ok_or_else(|| format!("Mod '{}' not found", mod_name))?;

        // 解析 manifest.json
        let manifest_path = mod_path.join("manifest.json");
        let manifest_content = fs::read_to_string(&manifest_path)
            .map_err(|e| format!("Failed to read manifest: {}", e))?;
        let manifest: ModManifest = serde_json::from_str(&manifest_content)
            .map_err(|e| format!("Failed to parse manifest: {}", e))?;

        // 解析资产定义（使用 "asset" 目录而非 "assets"）
        let assets_path = mod_path.join("asset");
        let imgs = Self::load_json_list(&assets_path.join("img.json"));
        let sequences = Self::load_json_list(&assets_path.join("sequence.json"));

        // 解析多语言语音
        let audios = Self::load_multilang_resources::<AudioInfo>(&mod_path.join("audio"), "speech.json");

        // 解析多语言文本和角色信息
        let text_path = mod_path.join("text");
        let (info, texts) = Self::load_text_resources(&text_path);

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

    /// 加载文本资源（角色信息 + 对话文本）
    fn load_text_resources(text_path: &Path) -> (HashMap<String, CharacterInfo>, HashMap<String, Vec<TextInfo>>) {
        let mut info = HashMap::new();
        let mut texts = HashMap::new();
        
        if let Ok(entries) = fs::read_dir(text_path) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let lang = entry.file_name().to_string_lossy().into_owned();
                    
                    // 加载角色信息
                    if let Some(mut char_info) = Self::load_json_obj::<CharacterInfo>(&entry.path().join("info.json")) {
                        if char_info.id.is_empty() || char_info.id == "ERROR" {
                            char_info.id.clone_from(&lang);
                        }
                        info.insert(lang.clone(), char_info);
                    }
                    
                    // 加载对话文本
                    let speech_list: Vec<TextInfo> = Self::load_json_list(&entry.path().join("speech.json"));
                    texts.insert(lang, speech_list);
                }
            }
        }
        
        (info, texts)
    }

    // ========================================================================= //
    // 资源查询（代理到 ModInfo）
    // ========================================================================= //

    /// 获取所有状态（important_states + states）
    /// 
    /// 注意：此方法会克隆所有状态，仅在需要完整列表时使用
    pub fn get_all_states(&self) -> Vec<StateInfo> {
        match &self.current_mod {
            Some(m) => {
                // 预分配容量，避免多次扩容
                let capacity = m.manifest.important_states.len() + m.manifest.states.len();
                let mut states = Vec::with_capacity(capacity);
                states.extend(m.manifest.important_states.values().cloned());
                states.extend(m.manifest.states.iter().cloned());
                states
            }
            None => Vec::new(),
        }
    }

    /// 获取所有触发器
    /// 
    /// 注意：此方法会克隆所有触发器，仅在需要完整列表时使用
    #[inline]
    pub fn get_all_triggers(&self) -> Vec<TriggerInfo> {
        self.current_mod.as_ref()
            .map(|m| m.manifest.triggers.clone())
            .unwrap_or_default()
    }

    /// 根据名称查找状态
    #[inline]
    pub fn get_state_by_name(&self, name: &str) -> Option<&StateInfo> {
        self.current_mod.as_ref()?.get_state_by_name(name)
    }

    /// 根据事件名称查找触发器
    #[inline]
    pub fn get_trigger_by_event(&self, event: &str) -> Option<&TriggerInfo> {
        self.current_mod.as_ref()?.get_trigger_by_event(event)
    }

    /// 根据名称查找资产
    #[inline]
    pub fn get_asset_by_name(&self, name: &str) -> Option<&AssetInfo> {
        self.current_mod.as_ref()?.get_asset_by_name(name)
    }

    /// 根据语言和名称查找语音
    #[inline]
    pub fn get_audio_by_name(&self, lang: &str, name: &str) -> Option<&AudioInfo> {
        self.current_mod.as_ref()?.get_audio_by_name(lang, name)
    }

    /// 根据语言和名称查找文本
    #[inline]
    pub fn get_text_by_name(&self, lang: &str, name: &str) -> Option<&TextInfo> {
        self.current_mod.as_ref()?.get_text_by_name(lang, name)
    }

    /// 根据语言获取角色信息
    #[inline]
    pub fn get_info_by_lang(&self, lang: &str) -> Option<&CharacterInfo> {
        self.current_mod.as_ref()?.get_info_by_lang(lang)
    }

    // ========================================================================= //
    // JSON 加载辅助函数
    // ========================================================================= //

    /// 加载 JSON 数组文件
    fn load_json_list<T: serde::de::DeserializeOwned>(path: &Path) -> Vec<T> {
        if !path.exists() {
            return Vec::new();
        }
        
        fs::read_to_string(path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default()
    }

    /// 加载 JSON 对象文件
    fn load_json_obj<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
        if !path.exists() {
            return None;
        }
        
        fs::read_to_string(path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
    }

    /// 加载多语言资源（遍历语言子目录）
    fn load_multilang_resources<T: serde::de::DeserializeOwned>(
        base_path: &Path,
        filename: &str,
    ) -> HashMap<String, Vec<T>> {
        let mut result = HashMap::new();
        
        if let Ok(entries) = fs::read_dir(base_path) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let lang = entry.file_name().to_string_lossy().into_owned();
                    let resources: Vec<T> = Self::load_json_list(&entry.path().join(filename));
                    result.insert(lang, resources);
                }
            }
        }
        
        result
    }
}
