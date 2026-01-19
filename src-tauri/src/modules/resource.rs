use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

// ========================================================================= //

fn default_name() -> String { "ERROR".to_string() }

fn default_sequence() -> bool { false }
fn default_frame_time() -> f32 { 0.3 }
fn default_frame_num() -> u32 { 1 }

// ========================================================================= //

/// 资产定义
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AssetInfo {
    #[serde(default = "default_name")]
    pub name: String,        // 资产名称 (如 "idle", "border")

    pub img: String,         // 文件名 (如 "idle.png")

    #[serde(default = "default_sequence")]
    pub sequence: bool,      // 是否为序列帧 (true) 还是静态图 (false)
    #[serde(default = "default_frame_time")]
    pub frame_time: f32,     // 每帧播放间隔 (秒)

    pub frame_size_x: u32,   // 单帧像素宽度
    pub frame_size_y: u32,   // 单帧像素高度

    #[serde(default = "default_frame_num")]
    pub frame_num_x: u32,    // X 轴单帧数量 (列数)
    #[serde(default = "default_frame_num")]
    pub frame_num_y: u32,    // Y 轴单帧数量 (行数)
}

// ========================================================================= //

/// 语音定义
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AudioInfo {
    #[serde(default = "default_name")]
    pub name: String,        // 语音名称 (如 "morning")

    pub audio: String,       // 语音文件名 (如 "morning.wav")
}

// ========================================================================= //

/// 对话文本定义
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TextInfo {
    #[serde(default = "default_name")]
    pub name: String,        // 文本名称

    pub text: String,        // 显示的文本内容
}

/// 角色多语言基础信息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CharacterInfo {
    #[serde(default = "default_name")]
    pub id: String,          // 语言 ID (如 "zh")
    #[serde(default = "default_name")]
    pub lang: String,        // 语言显示名称 (如 "中文")

    pub name: String,        // 角色在该语言下的名字
}

// ========================================================================= //

/// 动作映射定义
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActionInfo {
    pub anima: String,       // 对应 AssetInfo 中的 name
}

/// Mod 全局清单 (manifest.json)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModManifest {
    pub id: String,          // Mod 唯一标识
    pub version: String,     // Mod 版本
    pub author: String,      // 作者
    pub default_audio_lang_id: String, // 默认语音语言 ID
    
    pub important_actions: HashMap<String, ActionInfo>, // 核心动作 (border, idle 等)
    pub actions: HashMap<String, ActionInfo>,           // 其他动作 
}

impl ModManifest {
    /// 根据名称查找动作映射 (如 "border", "idle")
    pub fn get_action_by_name(&self, name: &str) -> Option<&ActionInfo> {
        self.important_actions.get(name).or(self.actions.get(name))
    }
}

// ========================================================================= //

/// 加载后的完整 Mod 信息
#[derive(Debug, Serialize, Clone)]
pub struct ModInfo {
    pub path: PathBuf,       // Mod 根目录绝对路径
    pub manifest: ModManifest,
    
    pub imgs: Vec<AssetInfo>,     // 静态/杂图资产
    pub sequences: Vec<AssetInfo>,  // 动画资产
    pub audios: HashMap<String, Vec<AudioInfo>>,     // 语言代码 -> 语音资产
    pub speech: HashMap<String, Vec<TextInfo>>,      // 语言代码 -> 对话文本
    pub info: HashMap<String, CharacterInfo>,        // 语言代码 -> 基础信息
}

impl ModInfo {
    /// 根据名称从 manifest 中查找核心动作映射
    pub fn get_action_by_name(&self, name: &str) -> Option<&ActionInfo> {
        self.manifest.get_action_by_name(name)
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

    /// 根据语言代码和名称查找对话文本
    pub fn get_speech_by_name(&self, lang: &str, name: &str) -> Option<&TextInfo> {
        self.speech.get(lang)?.iter().find(|s| s.name == name)
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
    pub important_action_names: Vec<String>, // 预定义的关键动作名称列表
}

impl ResourceManager {
    /// 初始化资源管理器
    pub fn new(app_handle: &tauri::AppHandle) -> Self {
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

        Self {
            current_mod: None,
            search_paths,
            important_action_names: vec![
                "border".to_string(), 
                "idle".to_string()
            ],
        }
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

        // 验证关键动作是否存在
        for action_name in &self.important_action_names {
            if !manifest.important_actions.contains_key(action_name) {
                return Err(format!("Missing important action: '{}' in manifest.json", action_name));
            }
        }

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
        let mut speech = HashMap::new();
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
                    speech.insert(lang, speech_list);
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
            speech,
        };

        self.current_mod = Some(mod_info.clone());
        Ok(mod_info)
    }

    /// 根据名称从 manifest 中查找核心动作映射
    pub fn get_action_by_name(&self, name: &str) -> Option<&ActionInfo> {
        self.current_mod.as_ref()?.get_action_by_name(name)
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
    pub fn get_speech_by_name(&self, lang: &str, name: &str) -> Option<&TextInfo> {
        self.current_mod.as_ref()?.get_speech_by_name(lang, name)
    }

    /// 根据语言代码从当前加载的 Mod 中查找角色基础信息
    pub fn get_info_by_lang(&self, lang: &str) -> Option<&CharacterInfo> {
        self.current_mod.as_ref()?.get_info_by_lang(lang)
    }

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
}
