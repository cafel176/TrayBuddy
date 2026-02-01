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

#![allow(unused)]

use super::environment::get_current_datetime;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::Manager;


use crate::modules::utils::fs::{load_json_list, load_json_obj};

// ========================================================================= //
// 资源匹配常量
// ========================================================================= //

/// 一天中的分钟数（用于时间范围计算）
///
/// **用途**: 当时间范围未设置或需要默认值时，使用此常量表示一天的总分钟数。
pub const MINUTES_PER_DAY: u32 = 24 * 60;

/// 年底默认日期（MMDD 格式）
///
/// **用途**: 当日期范围未设置结束日期时，使用此常量表示年底的默认日期。
pub const DEFAULT_END_OF_YEAR: u32 = 1231;

// ========================================================================= //
// 辅助函数
// ========================================================================= //

/// 默认名称（用于反序列化失败时）
#[inline]
fn default_name() -> Box<str> {
    "ERROR".into()
}

// ========================================================================= //
// 资产定义
// ========================================================================= //

/// 动画资产信息
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct AssetInfo {
    /// 资产名称（如 "idle", "border"）
    pub name: Box<str>,
    /// 图片文件名（如 "idle.png"）
    pub img: Box<str>,

    /// 是否为序列帧动画
    pub sequence: bool,
    /// 原始帧序列是否已反向排列（从后向前）
    pub origin_reverse: bool,
    /// 循环播放时是否需要反向播放（往返循环）
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
            img: "".into(),
            sequence: false,
            origin_reverse: false,
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
    pub name: Box<str>,
    /// 语音文件名（如 "morning.wav"）
    pub audio: Box<str>,
}

impl Default for AudioInfo {
    fn default() -> Self {
        Self {
            name: default_name(),
            audio: "".into(),
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
    pub name: Box<str>,
    /// 显示的文本内容
    pub text: Box<str>,
    /// 文本显示持续时间（秒），默认10秒
    pub duration: u32,
}

impl Default for TextInfo {
    fn default() -> Self {
        Self {
            name: default_name(),
            text: "".into(),
            duration: 5,
        }
    }
}

/// 角色多语言基础信息
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct CharacterInfo {
    /// 语言 ID（如 "zh"）
    pub id: Box<str>,
    /// 语言显示名称（如 "中文"）
    pub lang: Box<str>,
    /// 角色在该语言下的名字
    pub name: Box<str>,
    /// 角色描述
    pub description: Box<str>,
}

impl Default for CharacterInfo {
    fn default() -> Self {
        Self {
            id: default_name(),
            lang: default_name(),
            name: "Default".into(),
            description: "".into(),
        }
    }
}

// ========================================================================= //
// 状态定义
// ========================================================================= //

/// 进入某个状态时，对当前 Mod 的数据计数器执行的操作
#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum ModDataCounterOp {
    Add,
    Sub,
    Mul,
    Div,
    Set,
}

impl Default for ModDataCounterOp {
    fn default() -> Self {
        Self::Add
    }
}

/// Mod 数据计数配置（挂在每个 State 上）
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct ModDataCounterConfig {
    /// 操作类型：add/sub/mul/div/set
    pub op: ModDataCounterOp,
    /// 操作数（或 set 时的目标值）
    pub value: i32,
}

impl Default for ModDataCounterConfig {
    fn default() -> Self {
        Self {
            op: ModDataCounterOp::Add,
            value: 0,
        }
    }
}

/// 可触发子状态配置（状态名 + 权重）
///
/// - `state`: 子状态名
/// - `weight`: 正整数权重，用于加权随机（概率 = weight / sum(weight)）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CanTriggerState {
    /// 子状态名（兼容旧字段名 `name`）
    #[serde(alias = "name")]
    pub state: Box<str>,

    /// 正整数权重（缺省为 1）
    #[serde(default = "default_can_trigger_weight")]
    pub weight: u32,
}

#[inline]
fn default_can_trigger_weight() -> u32 {
    1
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum CanTriggerStateDe {
    Name(Box<str>),
    Obj(CanTriggerState),
}

fn deserialize_can_trigger_states<'de, D>(deserializer: D) -> Result<Vec<CanTriggerState>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;

    let raw: Vec<CanTriggerStateDe> = Vec::deserialize(deserializer)?;
    Ok(raw
        .into_iter()
        .filter_map(|v| match v {
            CanTriggerStateDe::Name(name) => {
                if name.is_empty() {
                    None
                } else {
                    Some(CanTriggerState {
                        state: name,
                        weight: 1,
                    })
                }
            }
            CanTriggerStateDe::Obj(obj) => {
                if obj.state.is_empty() {
                    None
                } else {
                    Some(obj)
                }
            }
        })
        .collect())
}

/// 状态信息
///
/// 定义角色的一个状态，包括动画、音频、触发条件等
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct StateInfo {
    /// 状态名称
    pub name: Box<str>,

    /// 是否为持久状态（false 表示临时状态）
    pub persistent: bool,
    /// 对应的动画资产名称
    pub anima: Box<str>,
    /// 对应的音频名称
    pub audio: Box<str>,
    /// 对应的文本名称
    pub text: Box<str>,
    /// 优先级（数值越大优先级越高）
    pub priority: u32,

    /// 允许生效的日期起始（格式: "MM-DD"）
    pub date_start: Box<str>,
    /// 允许生效的日期结束（格式: "MM-DD"）
    pub date_end: Box<str>,
    /// 允许生效的时间起始（格式: "HH:MM"）
    pub time_start: Box<str>,
    /// 允许生效的时间结束（格式: "HH:MM"）
    pub time_end: Box<str>,

    /// 播放完成后自动切换到的状态名称
    pub next_state: Box<str>,
    /// 可触发的子状态列表（加权随机）
    #[serde(default, deserialize_with = "deserialize_can_trigger_states")]
    pub can_trigger_states: Vec<CanTriggerState>,
    /// 触发间隔时间（秒），最小值为 300 秒（5 分钟）
    ///
    /// - 设为 0 表示禁用定时触发
    /// - 设为 > 0 但 < 300 的值会被自动修正为 300
    pub trigger_time: f32,
    /// 触发概率（0.0 - 1.0）
    pub trigger_rate: f32,

    /// 进入该状态时对当前 Mod 数据计数器执行操作（可选）
    pub mod_data_counter: Option<ModDataCounterConfig>,

    /// 是否显示对话分支气泡 UI
    ///
    /// - true：行为与当前版本完全一致（显示分支按钮）
    /// - false：仍会触发分支逻辑，但不显示气泡 UI（前端可用空格键选择）
    pub branch_show_bubble: bool,

    /// 对话分支选项
    pub branch: Vec<BranchInfo>,

}


impl Default for StateInfo {
    fn default() -> Self {
        Self {
            name: default_name(),
            persistent: false,
            anima: "".into(),
            audio: "".into(),
            text: "".into(),
            priority: 0,
            date_start: "".into(),
            date_end: "".into(),
            time_start: "".into(),
            time_end: "".into(),
            next_state: "".into(),
            can_trigger_states: Vec::new(),
            trigger_time: 0.0,
            trigger_rate: 0.0,
            mod_data_counter: None,
            branch_show_bubble: true,
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
        let end_minutes = Self::parse_time(&self.time_end).unwrap_or(
            MINUTES_PER_DAY
        );

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
        let end_day = Self::parse_date(&self.date_end).unwrap_or(
            DEFAULT_END_OF_YEAR
        );

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
    pub text: Box<str>,
    /// 点击后跳转到的状态名称
    pub next_state: Box<str>,
}

impl Default for BranchInfo {
    fn default() -> Self {
        Self {
            text: "".into(),
            next_state: "".into(),
        }
    }
}

// ========================================================================= //
// 触发器定义
// ========================================================================= //

/// 触发条件状态组
///
/// 定义在特定持久状态下可触发的状态列表
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct TriggerStateGroup {
    /// 持久状态名称，为空字符串时表示任意持久状态都可触发
    pub persistent_state: Box<str>,
    /// 可触发的状态列表（加权随机）
    #[serde(default, deserialize_with = "deserialize_can_trigger_states")]
    pub states: Vec<CanTriggerState>,
}


impl Default for TriggerStateGroup {
    fn default() -> Self {
        Self {
            persistent_state: "".into(),
            states: Vec::new(),
        }
    }
}

/// 触发器信息
///
/// 定义事件与可触发状态的映射关系
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct TriggerInfo {
    /// 触发事件名称（如 "login", "music_start"）
    pub event: Box<str>,
    /// 可触发的状态组列表（按持久状态分组）
    pub can_trigger_states: Vec<TriggerStateGroup>,
}

impl Default for TriggerInfo {
    fn default() -> Self {
        Self {
            event: "".into(),
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
        Self { z_offset: 1 }
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
    pub anima: Box<str>,
    /// 是否启用边框
    pub enable: bool,
    /// Z轴偏移（渲染层级）
    pub z_offset: i32,
}

impl Default for BorderConfig {
    fn default() -> Self {
        Self {
            anima: "".into(),
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
    pub id: Box<str>,
    /// Mod 版本
    pub version: Box<str>,
    /// 作者
    pub author: Box<str>,

    /// 默认语音语言 ID
    pub default_audio_lang_id: Box<str>,
    /// 默认文本语言 ID
    pub default_text_lang_id: Box<str>,

    /// 角色渲染配置
    pub character: CharacterConfig,
    /// 边框配置
    pub border: BorderConfig,

    /// 是否在动画窗口左上角显示 Mod 数据面板
    pub show_mod_data_panel: bool,
    /// Mod 数据的默认 int 初始值（首次加载该 Mod 时写入 UserInfo）
    pub mod_data_default_int: i32,

    /// 核心状态（如 idle）
    pub important_states: HashMap<Box<str>, StateInfo>,
    /// 其他状态列表
    pub states: Vec<StateInfo>,
    /// 触发器列表
    pub triggers: Vec<TriggerInfo>,
}

impl Default for ModManifest {
    fn default() -> Self {
        Self {
            id: default_name(),
            version: "".into(),
            author: "".into(),
            default_audio_lang_id: "".into(),
            default_text_lang_id: "".into(),
            character: CharacterConfig::default(),
            border: BorderConfig::default(),
            show_mod_data_panel: false,
            mod_data_default_int: 0,
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
        self.important_states
            .get(name)
            .or_else(|| self.states.iter().find(|s| &*s.name == name))
    }

    /// 根据事件名称查找触发器
    pub fn get_trigger_by_event(&self, event: &str) -> Option<&TriggerInfo> {
        self.triggers.iter().find(|t| &*t.event == event)
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
    pub audios: HashMap<Box<str>, Vec<AudioInfo>>,
    /// 文本资源（语言代码 -> 文本列表）
    pub texts: HashMap<Box<str>, Vec<TextInfo>>,
    /// 角色信息（语言代码 -> 角色信息）
    pub info: HashMap<Box<str>, CharacterInfo>,
    /// 气泡样式配置（从 bubble_style.json 加载）
    pub bubble_style: Option<serde_json::Value>,
    /// 图标路径（相对路径，如 "icon.ico"）
    pub icon_path: Option<Box<str>>,
    /// 预览图路径（相对路径，如 "preview.png"）
    pub preview_path: Option<Box<str>>,

    // --- 索引（用于 O(1) 查询，不序列化） ---
    #[serde(skip)]
    state_index: HashMap<Box<str>, usize>,
    #[serde(skip)]
    trigger_index: HashMap<Box<str>, usize>,
    #[serde(skip)]
    asset_index: HashMap<Box<str>, (bool, usize)>, // (is_sequence, index)
    #[serde(skip)]
    audio_index: HashMap<Box<str>, HashMap<Box<str>, usize>>, // lang -> name -> index
    #[serde(skip)]
    text_index: HashMap<Box<str>, HashMap<Box<str>, usize>>, // lang -> name -> index
}

impl ModInfo {
    /// 构建查询索引（加载后调用）
    fn build_indices(&mut self) {
        // 状态索引
        self.state_index = self
            .manifest
            .states
            .iter()
            .enumerate()
            .map(|(i, s)| (s.name.clone(), i))
            .collect();

        // 触发器索引
        self.trigger_index = self
            .manifest
            .triggers
            .iter()
            .enumerate()
            .map(|(i, t)| (t.event.clone(), i))
            .collect();

        // 资产索引
        self.asset_index = self
            .imgs
            .iter()
            .enumerate()
            .map(|(i, a)| (a.name.clone(), (false, i)))
            .chain(
                self.sequences
                    .iter()
                    .enumerate()
                    .map(|(i, a)| (a.name.clone(), (true, i))),
            )
            .collect();

        // 音频索引
        for (lang, audios) in &self.audios {
            let idx: HashMap<Box<str>, usize> = audios
                .iter()
                .enumerate()
                .map(|(i, a)| (a.name.clone(), i))
                .collect();
            self.audio_index.insert(lang.clone(), idx);
        }

        // 文本索引
        for (lang, texts) in &self.texts {
            let idx: HashMap<Box<str>, usize> = texts
                .iter()
                .enumerate()
                .map(|(i, t)| (t.name.clone(), i))
                .collect();
            self.text_index.insert(lang.clone(), idx);
        }
    }

    /// 验证并修正状态配置
    ///
    /// 对所有状态的 trigger_time 进行检查：
    /// - 如果 trigger_time > 0 且 < MIN_TRIGGER_TIME_SECS，则修正为 MIN_TRIGGER_TIME_SECS
    /// - trigger_time = 0 表示禁用定时触发，不做修正
    fn validate_and_fix_states(&mut self) {
        use crate::modules::constants::MIN_TRIGGER_TIME_SECS;

        // 修正 important_states 中的 trigger_time
        for (name, state) in self.manifest.important_states.iter_mut() {
            if state.trigger_time > 0.0 && state.trigger_time < MIN_TRIGGER_TIME_SECS {
                eprintln!(
                    "[ResourceManager] 警告: 状态 '{}' 的 trigger_time ({:.1}s) 小于最小值，已修正为 {:.0}s",
                    name, state.trigger_time, MIN_TRIGGER_TIME_SECS
                );
                state.trigger_time = MIN_TRIGGER_TIME_SECS;
            }
        }

        // 修正 states 中的 trigger_time
        for state in self.manifest.states.iter_mut() {
            if state.trigger_time > 0.0 && state.trigger_time < MIN_TRIGGER_TIME_SECS {
                eprintln!(
                    "[ResourceManager] 警告: 状态 '{}' 的 trigger_time ({:.1}s) 小于最小值，已修正为 {:.0}s",
                    state.name, state.trigger_time, MIN_TRIGGER_TIME_SECS
                );
                state.trigger_time = MIN_TRIGGER_TIME_SECS;
            }
        }
    }

    /// 根据名称查找状态（O(1) 查询）
    #[inline]
    pub fn get_state_by_name(&self, name: &str) -> Option<&StateInfo> {
        // 优先从 important_states 查找
        self.manifest.important_states.get(name).or_else(|| {
            self.state_index
                .get(name)
                .and_then(|&i| self.manifest.states.get(i))
        })
    }

    /// 根据事件名称查找触发器（O(1) 查询）
    #[inline]
    pub fn get_trigger_by_event(&self, event: &str) -> Option<&TriggerInfo> {
        self.trigger_index
            .get(event)
            .and_then(|&i| self.manifest.triggers.get(i))
    }

    /// 根据名称查找资产（O(1) 查询）
    pub fn get_asset_by_name(&self, name: &str) -> Option<&AssetInfo> {
        self.asset_index.get(name).and_then(|&(is_seq, i)| {
            if is_seq {
                self.sequences.get(i)
            } else {
                self.imgs.get(i)
            }
        })
    }

    /// 根据语言和名称查找语音（O(1) 查询）
    pub fn get_audio_by_name(&self, lang: &str, name: &str) -> Option<&AudioInfo> {
        self.audio_index
            .get(lang)
            .and_then(|idx| idx.get(name))
            .and_then(|&i| self.audios.get(lang)?.get(i))
            .or_else(|| {
                let default_lang = &self.manifest.default_audio_lang_id;
                self.audio_index
                    .get(default_lang)
                    .and_then(|idx| idx.get(name))
                    .and_then(|&i| self.audios.get(default_lang)?.get(i))
            })
    }

    /// 根据语言和名称查找文本（O(1) 查询）
    pub fn get_text_by_name(&self, lang: &str, name: &str) -> Option<&TextInfo> {
        self.text_index
            .get(lang)
            .and_then(|idx| idx.get(name))
            .and_then(|&i| self.texts.get(lang)?.get(i))
            .or_else(|| {
                let default_lang = &self.manifest.default_text_lang_id;
                self.text_index
                    .get(default_lang)
                    .and_then(|idx| idx.get(name))
                    .and_then(|&i| self.texts.get(default_lang)?.get(i))
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

/// Mod 位置索引项（用于通过 manifest.id 解析到真实目录）
#[derive(Debug, Clone)]
struct ModLocator {
    /// manifest.json 中的 id
    id: String,
    /// manifest.json 中的 version（用于同 id 多版本选择）
    version: String,
    /// Mod 文件夹名（目录名）
    folder: String,
    /// Mod 根目录绝对路径
    path: PathBuf,
}


/// 资源管理器
///
/// 负责 Mod 的扫描、解析与内存映射
pub struct ResourceManager {
    /// 当前加载的 Mod
    pub current_mod: Option<Arc<ModInfo>>,
    /// Mod 搜索路径列表
    pub search_paths: Vec<PathBuf>,

    /// manifest.id -> ModLocator（以 manifest.id 为唯一标识）
    mod_index: HashMap<String, ModLocator>,
    /// folder -> manifest.id（兼容旧逻辑/迁移用）
    folder_to_id: HashMap<String, String>,
}

impl ResourceManager {
    /// 创建资源管理器
    pub fn new(app_handle: &tauri::AppHandle) -> Self {
        Self {
            current_mod: None,
            search_paths: Self::discover_mod_paths(app_handle),
            mod_index: HashMap::new(),
            folder_to_id: HashMap::new(),
        }
    }

    // ========================================================================= //
    // Mod 路径发现
    // ========================================================================= //

    /// 发现所有可能的 Mod 搜索路径
    fn discover_mod_paths(app_handle: &tauri::AppHandle) -> Vec<PathBuf> {
        let mut paths = Vec::with_capacity(4);

        // 1. 应用配置目录下的 mods（用户自定义 Mod）
        if let Ok(config_dir) = app_handle.path().app_config_dir() {
            let mods_path = config_dir.join("mods");
            if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                #[cfg(debug_assertions)]
                println!("[ResourceManager] 配置目录 mods: {:?}", canonical);
                if canonical.is_dir() {
                    paths.push(canonical);
                }
            }
        }

        // 2. 打包资源目录下的 mods（内置 Mod，Release 打包时包含）
        if let Ok(resource_dir) = app_handle.path().resource_dir() {
            let mods_path = resource_dir.join("mods");
            if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                #[cfg(debug_assertions)]
                println!("[ResourceManager] 资源目录 mods: {:?}", canonical);
                if canonical.is_dir() && !paths.contains(&canonical) {
                    paths.push(canonical);
                }
            }
        }

        // 3. 可执行文件所在目录的 mods
        if let Ok(exe_path) = std::env::current_exe() {
            // 尝试向上查找多级父目录中的 mods 文件夹
            let mut current_dir = exe_path.parent();
            for level in 1..=crate::modules::constants::MODS_SEARCH_MAX_LEVELS_EXE {
                if let Some(dir) = current_dir {
                    let mods_path = dir.join("mods");
                    if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                        #[cfg(debug_assertions)]
                        println!(
                            "[ResourceManager] 程序目录 mods (level {}): {:?}",
                            level, canonical
                        );
                        if canonical.is_dir() && !paths.contains(&canonical) {
                            paths.push(canonical);
                        }
                    }
                    current_dir = dir.parent();
                } else {
                    break;
                }
            }
        }

        // 4. 开发环境：当前工作目录向上查找 mods
        if let Ok(cwd) = std::env::current_dir() {
            let mut current_dir = Some(cwd.as_path());
            for level in 1..=crate::modules::constants::MODS_SEARCH_MAX_LEVELS_CWD {
                if let Some(dir) = current_dir {
                    let mods_path = dir.join("mods");
                    if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                        #[cfg(debug_assertions)]
                        println!(
                            "[ResourceManager] 项目目录 mods (level {}): {:?}",
                            level, canonical
                        );
                        if canonical.is_dir() && !paths.contains(&canonical) {
                            paths.push(canonical);
                        }
                    }
                    current_dir = dir.parent();
                } else {
                    break;
                }
            }
        }

        paths
    }

    // ========================================================================= //
    // Mod 操作
    // ========================================================================= //

    /// 重建 mod 索引（manifest.id -> path, folder -> id）
    ///
    /// 搜索顺序遵循 `search_paths` 的优先级：越靠前优先级越高。
    fn parse_version(version: &str) -> (Vec<u64>, Option<String>) {
        let v = version.trim().trim_start_matches('v').trim_start_matches('V');
        if v.is_empty() {
            return (vec![0], None);
        }

        let (main, pre) = match v.split_once('-') {
            Some((a, b)) => (a, Some(b.to_string())),
            None => (v, None),
        };

        let nums: Vec<u64> = main
            .split('.')
            .map(|part| {
                let digits: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
                digits.parse::<u64>().unwrap_or(0)
            })
            .collect();

        (if nums.is_empty() { vec![0] } else { nums }, pre)
    }

    /// 版本比较：返回 a 相对 b 的大小
    ///
    /// - 先比较数字段（按点分隔）
    /// - 数字段相同：无 pre-release 的版本更大（例如 1.0.0 > 1.0.0-beta）
    /// - 都有 pre-release：按字符串比较
    fn compare_version(a: &str, b: &str) -> Ordering {
        if a == b {
            return Ordering::Equal;
        }

        let (an, apre) = Self::parse_version(a);
        let (bn, bpre) = Self::parse_version(b);

        let max_len = an.len().max(bn.len());
        for i in 0..max_len {
            let av = *an.get(i).unwrap_or(&0);
            let bv = *bn.get(i).unwrap_or(&0);
            match av.cmp(&bv) {
                Ordering::Equal => {}
                ord => return ord,
            }
        }

        match (&apre, &bpre) {
            (None, Some(_)) => Ordering::Greater,
            (Some(_), None) => Ordering::Less,
            (Some(a1), Some(b1)) => a1.cmp(b1),
            (None, None) => Ordering::Equal,
        }
    }

    fn rebuild_mod_index(&mut self) {
        self.mod_index.clear();
        self.folder_to_id.clear();

        for base in &self.search_paths {
            let Ok(entries) = fs::read_dir(base) else {
                continue;
            };

            for entry in entries.flatten() {
                let dir_path = entry.path();
                if !dir_path.is_dir() {
                    continue;
                }

                let folder = entry.file_name().to_string_lossy().into_owned();
                let canonical_dir = dunce::canonicalize(&dir_path).unwrap_or(dir_path);

                // 尝试读取 manifest.json 获取 (manifest.id, manifest.version)
                let manifest_path = canonical_dir.join("manifest.json");
                let (manifest_id, manifest_version) = if manifest_path.exists() {
                    fs::read_to_string(&manifest_path)
                        .ok()
                        .and_then(|s| serde_json::from_str::<ModManifest>(&s).ok())
                        .map(|m| (m.id.to_string(), m.version.to_string()))
                        .unwrap_or_else(|| (folder.clone(), "".to_string()))
                } else {
                    (folder.clone(), "".to_string())
                };

                // folder -> id（首个发现者优先）
                self.folder_to_id
                    .entry(folder.clone())
                    .or_insert_with(|| manifest_id.clone());

                // id -> locator：
                // - 若同 id 多个 mod：选择版本号更新的
                // - 若版本号相同：保留先发现的
                if let Some(existing) = self.mod_index.get(&manifest_id) {
                    let ord = Self::compare_version(&manifest_version, &existing.version);
                    if ord != Ordering::Greater {
                        continue;
                    }
                }

                self.mod_index.insert(
                    manifest_id.clone(),
                    ModLocator {
                        id: manifest_id,
                        version: manifest_version,
                        folder,
                        path: canonical_dir,
                    },
                );
            }
        }
    }


    /// 解析 Mod 标识符为实际目录路径
    ///
    /// - 首选：`manifest.json` 中的 `id`
    /// - 兼容：历史上使用的文件夹名
    fn resolve_mod_path(&mut self, mod_id_or_folder: &str) -> Option<PathBuf> {
        self.rebuild_mod_index();

        if let Some(locator) = self.mod_index.get(mod_id_or_folder) {
            return Some(locator.path.clone());
        }

        if let Some(id) = self.folder_to_id.get(mod_id_or_folder) {
            if let Some(locator) = self.mod_index.get(id) {
                return Some(locator.path.clone());
            }
        }

        // 最后兜底：按 folder 直接拼路径（兼容旧逻辑）
        for base in &self.search_paths {
            let p = base.join(mod_id_or_folder);
            if p.is_dir() {
                return Some(p);
            }
        }

        None
    }

    /// 将传入的标识符解析为 manifest.id
    ///
    /// - 如果本身就是 manifest.id：原样返回
    /// - 如果是文件夹名：返回对应 manifest.id
    pub fn resolve_mod_id(&mut self, mod_id_or_folder: &str) -> Option<String> {
        self.rebuild_mod_index();
        if self.mod_index.contains_key(mod_id_or_folder) {
            Some(mod_id_or_folder.to_string())
        } else {
            self.folder_to_id.get(mod_id_or_folder).cloned()
        }
    }

    /// 列出所有可用的 Mod（以 manifest.id 作为唯一标识）
    pub fn list_mods(&mut self) -> Vec<String> {
        self.rebuild_mod_index();
        let mut result: Vec<String> = self.mod_index.keys().cloned().collect();
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
    /// 从磁盘读取 Mod 信息（不加载到当前状态）
    ///
    /// 用于 Mod 预览或加载前的检查
    pub fn read_mod_from_disk(&mut self, mod_id: &str) -> Result<ModInfo, String> {
        // 查找 Mod 目录（优先使用 manifest.id 解析）
        let mod_path = self
            .resolve_mod_path(mod_id)
            .ok_or_else(|| format!("Mod '{}' not found", mod_id))?;


        // 解析 manifest.json
        let manifest_path = mod_path.join("manifest.json");
        let manifest_content = fs::read_to_string(&manifest_path)
            .map_err(|e| format!("Failed to read manifest: {}", e))?;
        let manifest: ModManifest = serde_json::from_str(&manifest_content)
            .map_err(|e| format!("Failed to parse manifest: {}", e))?;

        // 解析资产定义（使用 "asset" 目录而非 "assets"）
        let assets_path = mod_path.join("asset");
        let imgs = crate::modules::utils::fs::load_json_list(&assets_path.join("img.json"));
        let sequences =
            crate::modules::utils::fs::load_json_list(&assets_path.join("sequence.json"));

        // 解析多语言语音
        let audios =
            Self::load_multilang_resources::<AudioInfo>(&mod_path.join("audio"), "speech.json");

        // 解析多语言文本和角色信息
        let text_path = mod_path.join("text");
        let (info, texts) = Self::load_text_resources(&text_path);

        // 解析气泡样式
        let bubble_style = crate::modules::utils::fs::load_json_obj::<serde_json::Value>(
            &mod_path.join("bubble_style.json"),
        );

        // 探测预览图和图标
        let mut icon_path = None;
        let mut preview_path = None;

        for ext in ["ico", "png"] {
            let p = mod_path.join(format!("icon.{}", ext));
            if p.exists() {
                icon_path = Some(format!("icon.{}", ext));
                break;
            }
        }

        for ext in ["png", "jpg", "jpeg", "webp"] {
            let p = mod_path.join(format!("preview.{}", ext));
            if p.exists() {
                preview_path = Some(format!("preview.{}", ext));
                break;
            }
        }

        let mut mod_info = ModInfo {
            path: mod_path,
            manifest,
            imgs,
            sequences,
            audios,
            info,
            texts,
            bubble_style,
            icon_path: icon_path.map(|s| s.into()),
            preview_path: preview_path.map(|s| s.into()),
            state_index: HashMap::new(),
            trigger_index: HashMap::new(),
            asset_index: HashMap::new(),
            audio_index: HashMap::new(),
            text_index: HashMap::new(),
        };

        // 验证并修正状态配置
        mod_info.validate_and_fix_states();

        // 构建查询索引
        mod_info.build_indices();

        Ok(mod_info)
    }

    /// 加载指定的 Mod
    ///
    /// 加载成功后返回 Mod 信息的克隆（用于返回给前端）。
    /// 内部会缓存原始数据，后续查询使用缓存避免重复克隆。
    pub fn load_mod(&mut self, mod_id: &str) -> Result<Arc<ModInfo>, String> {
        let mod_info = Arc::new(self.read_mod_from_disk(mod_id)?);
        let result = mod_info.clone();

        self.current_mod = Some(mod_info);
        Ok(result)
    }

    fn load_text_resources(
        text_path: &Path,
    ) -> (
        HashMap<Box<str>, CharacterInfo>,
        HashMap<Box<str>, Vec<TextInfo>>,
    ) {
        let mut info = HashMap::new();
        let mut texts = HashMap::new();

        if let Ok(entries) = fs::read_dir(text_path) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let lang: Box<str> = entry.file_name().to_string_lossy().into();

                    // 加载角色信息
                    if let Some(mut char_info) =
                        crate::modules::utils::fs::load_json_obj::<CharacterInfo>(
                            &entry.path().join("info.json"),
                        )
                    {
                        if char_info.id.is_empty() || char_info.id.as_ref() == "ERROR" {
                            char_info.id = lang.clone();
                        }
                        info.insert(lang.clone(), char_info);
                    }

                    // 加载对话文本
                    let speech_list: Vec<TextInfo> = crate::modules::utils::fs::load_json_list(
                        &entry.path().join("speech.json"),
                    );
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
        self.current_mod
            .as_ref()
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

    /// 加载多语言资源（遍历语言子目录）
    fn load_multilang_resources<T: serde::de::DeserializeOwned>(
        base_path: &Path,
        filename: &str,
    ) -> HashMap<Box<str>, Vec<T>> {
        let mut result = HashMap::new();

        if let Ok(entries) = fs::read_dir(base_path) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let lang: Box<str> = entry.file_name().to_string_lossy().into();
                    let resources: Vec<T> =
                        crate::modules::utils::fs::load_json_list(&entry.path().join(filename));
                    result.insert(lang, resources);
                }
            }
        }

        result
    }

    /// 获取气泡样式配置
    ///
    /// 从当前加载的 Mod 缓存中获取，如果 Mod 未配置则返回默认样式
    pub fn get_bubble_style(&self) -> Option<serde_json::Value> {
        let mod_info = self.current_mod.as_ref()?;
        
        // 如果 Mod 配置了 bubble_style，则返回
        if mod_info.bubble_style.is_some() {
            return mod_info.bubble_style.clone();
        }
        
        // 否则，尝试加载默认的 src/bubble_style.json
        Self::load_default_bubble_style()
    }
    
    /// 加载默认的气泡样式（src/bubble_style.json）
    fn load_default_bubble_style() -> Option<serde_json::Value> {
        // 尝试从资源目录读取（打包后的情况）
        if let Ok(mut src_path) = std::env::current_exe() {
            // 向上查找 src 目录
            for _level in 0..=3 {
                if let Some(parent) = src_path.parent() {
                    let bubble_style_path = parent.join("src").join("bubble_style.json");
                    if bubble_style_path.exists() {
                        #[cfg(debug_assertions)]
                        println!("[ResourceManager] 加载默认 bubble_style: {:?}", bubble_style_path);
                        return crate::modules::utils::fs::load_json_obj(&bubble_style_path);
                    }
                    src_path = parent.to_path_buf();
                }
            }
        }
        
        // 如果找不到，尝试从当前工作目录读取（开发环境）
        let default_path = PathBuf::from("src").join("bubble_style.json");
        if default_path.exists() {
            #[cfg(debug_assertions)]
            println!("[ResourceManager] 从工作目录加载默认 bubble_style: {:?}", default_path);
            return crate::modules::utils::fs::load_json_obj(&default_path);
        }
        
        #[cfg(debug_assertions)]
        println!("[ResourceManager] 未找到默认 bubble_style.json");
        None
    }
}
