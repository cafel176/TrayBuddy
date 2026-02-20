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
use super::mod_archive::ModArchiveReaderExt;

/// 并发加载限制：限制同时加载大型配置或资源的线程数
/// 避免在快速切换 Mod 时产生瞬时堆内存高峰
lazy_static::lazy_static! {
    static ref LOAD_SEMAPHORE: Arc<tokio::sync::Semaphore> = Arc::new(tokio::sync::Semaphore::new(3));
}


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

#[inline]
fn default_trigger_counter_start() -> i32 {
    i32::MIN
}

#[inline]
fn default_trigger_counter_end() -> i32 {
    i32::MAX
}

#[inline]
fn default_trigger_temp_start() -> i32 {
    i32::MIN
}

#[inline]
fn default_trigger_temp_end() -> i32 {
    i32::MAX
}

#[inline]
fn default_trigger_uptime() -> i32 {
    0
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum TriggerWeatherDe {
    Str(Box<str>),
    Arr(Vec<Box<str>>),
}


#[inline]
fn deserialize_trigger_weather<'de, D>(deserializer: D) -> Result<Vec<Box<str>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;

    let raw: Option<TriggerWeatherDe> = Option::deserialize(deserializer)?;
    let mut out: Vec<Box<str>> = Vec::new();

    match raw {
        None => {}
        Some(TriggerWeatherDe::Str(s)) => {
            let t = s.as_ref().trim();
            if !t.is_empty() {
                out.push(t.into());
            }
        }
        Some(TriggerWeatherDe::Arr(arr)) => {
            for s in arr.into_iter() {
                let t = s.as_ref().trim();
                if !t.is_empty() {
                    out.push(t.into());
                }
            }
        }
    }

    Ok(out)
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
// Live2D 资产定义
// ========================================================================= //

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Live2DModelConfig {
    pub name: Box<str>,
    pub base_dir: Box<str>,
    pub model_json: Box<str>,
    pub textures_dir: Box<str>,
    pub motions_dir: Box<str>,
    pub expressions_dir: Box<str>,
    pub physics_json: Box<str>,
    pub pose_json: Box<str>,
    pub breath_json: Box<str>,
    /// 模型整体缩放（窗口预览用，避免模型过大超出窗口）
    pub scale: f64,
    pub eye_blink: bool,
    pub lip_sync: bool,
}

impl Default for Live2DModelConfig {
    fn default() -> Self {
        Self {
            name: default_name(),
            base_dir: "".into(),
            model_json: "".into(),
            textures_dir: "".into(),
            motions_dir: "".into(),
            expressions_dir: "".into(),
            physics_json: "".into(),
            pose_json: "".into(),
            breath_json: "".into(),
            scale: 1.0,
            eye_blink: false,
            lip_sync: false,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Live2DMotion {
    pub name: Box<str>,
    pub file: Box<str>,
    pub group: Box<str>,
    pub priority: Box<str>,
    pub fade_in_ms: u32,
    pub fade_out_ms: u32,
    pub r#loop: bool,
}

impl Default for Live2DMotion {
    fn default() -> Self {
        Self {
            name: default_name(),
            file: "".into(),
            group: "".into(),
            priority: "".into(),
            fade_in_ms: 0,
            fade_out_ms: 0,
            r#loop: false,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Live2DExpression {
    pub name: Box<str>,
    pub file: Box<str>,
}

impl Default for Live2DExpression {
    fn default() -> Self {
        Self {
            name: default_name(),
            file: "".into(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Live2DState {
    pub state: Box<str>,
    pub motion: Box<str>,
    pub expression: Box<str>,
    pub scale: f32,
    pub offset_x: i32,
    pub offset_y: i32,
}

impl Default for Live2DState {
    fn default() -> Self {
        Self {
            state: default_name(),
            motion: "".into(),
            expression: "".into(),
            scale: 1.0,
            offset_x: 0,
            offset_y: 0,
        }
    }
}

/// 将 JSON 中的单个字符串或字符串数组统一反序列化为 `Vec<String>`。
///
/// 兼容旧格式（`"event": "keydown:KeyA"` / `"event": "keyup:KeyA"`）
/// 和新格式（`"events": ["keydown:KeyA", "keyup:KeyA"]`）。
fn deserialize_string_or_vec<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de;

    struct StringOrVec;

    impl<'de> de::Visitor<'de> for StringOrVec {
        type Value = Vec<String>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a string or array of strings")
        }

        fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
            if v.is_empty() {
                Ok(Vec::new())
            } else {
                Ok(vec![v.to_string()])
            }
        }

        fn visit_string<E: de::Error>(self, v: String) -> Result<Self::Value, E> {
            if v.is_empty() {
                Ok(Vec::new())
            } else {
                Ok(vec![v])
            }
        }

        fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
            let mut vec = Vec::new();
            while let Some(s) = seq.next_element::<String>()? {
                if !s.is_empty() {
                    vec.push(s);
                }
            }
            Ok(vec)
        }
    }

    deserializer.deserialize_any(StringOrVec)
}

/// 背景层定义
///
/// 在 Live2D 模型下方或上方渲染的图片层。
/// 用于静态背景、按键叠加高亮等场景。
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Live2DBackgroundLayer {
    /// 层名称（标识用）
    pub name: Box<str>,
    /// 图片文件路径（相对于 base_dir）
    pub file: Box<str>,
    /// 渲染层级：\"behind\"（模型之后）或 \"front\"（模型之前）
    pub layer: Box<str>,
    /// 缩放比例（1.0 = 原尺寸）
    pub scale: f64,
    /// X 轴偏移（像素）
    pub offset_x: i32,
    /// Y 轴偏移（像素）
    pub offset_y: i32,
    /// 关联事件名列表（任意一个事件触发时显示），为空则常驻显示
    #[serde(alias = "event", deserialize_with = "deserialize_string_or_vec")]
    pub events: Vec<String>,
}

impl Default for Live2DBackgroundLayer {
    fn default() -> Self {
        Self {
            name: "".into(),
            file: "".into(),
            layer: "behind".into(),
            scale: 1.0,
            offset_x: 0,
            offset_y: 0,
            events: Vec::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Live2DConfig {
    pub schema_version: u32,
    pub model: Live2DModelConfig,
    pub motions: Vec<Live2DMotion>,
    pub expressions: Vec<Live2DExpression>,
    pub states: Vec<Live2DState>,
    /// 背景/叠加图层列表
    pub background_layers: Vec<Live2DBackgroundLayer>,
}

impl Default for Live2DConfig {
    fn default() -> Self {
        Self {
            schema_version: 1,
            model: Live2DModelConfig::default(),
            motions: Vec::new(),
            expressions: Vec::new(),
            states: Vec::new(),
            background_layers: Vec::new(),
        }
    }
}

// ========================================================================= //
// PngRemix 配置定义
// ========================================================================= //

/// PngRemix 模型配置
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct PngRemixModelConfig {
    /// 模型名称
    pub name: Box<str>,
    /// .pngRemix 文件路径（相对于 Mod 根目录）
    pub pngremix_file: Box<str>,
    /// 默认 state 索引
    pub default_state_index: u32,
    /// 模型整体缩放（窗口预览用，避免模型过大超出窗口）
    pub scale: f64,
    /// 帧率限制
    pub max_fps: u32,
}

impl Default for PngRemixModelConfig {
    fn default() -> Self {
        Self {
            name: "".into(),
            pngremix_file: "".into(),
            default_state_index: 0,
            scale: 1.0,
            max_fps: 60,
        }
    }
}

/// PngRemix 特性开关配置
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct PngRemixFeatures {
    /// 鼠标跟随
    pub mouse_follow: bool,
    /// 自动眨眼
    pub auto_blink: bool,
    /// 点击跳跃
    pub click_bounce: bool,
    /// 点击跳跃幅度
    pub click_bounce_amp: f64,
    /// 点击跳跃时长（秒）
    pub click_bounce_duration: f64,
    /// 眨眼速度
    pub blink_speed: f64,
    /// 眨眼概率（每秒）
    pub blink_chance: f64,
    /// 眨眼闭眼保持比例
    pub blink_hold_ratio: f64,
}

impl Default for PngRemixFeatures {
    fn default() -> Self {
        Self {
            mouse_follow: true,
            auto_blink: true,
            click_bounce: true,
            click_bounce_amp: 50.0,
            click_bounce_duration: 0.5,
            blink_speed: 1.0,
            blink_chance: 6.0,
            blink_hold_ratio: 0.2,
        }
    }
}

/// PngRemix 表情定义
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct PngRemixExpression {
    /// 表情名称
    pub name: Box<str>,
    /// 对应 .pngRemix 文件中的 state 索引
    pub state_index: u32,
}

impl Default for PngRemixExpression {
    fn default() -> Self {
        Self {
            name: "".into(),
            state_index: 0,
        }
    }
}

/// PngRemix 动作定义
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct PngRemixMotion {
    /// 动作名称
    pub name: Box<str>,
    /// 对应的 Hotkey（如 "F1"-"F9"）
    pub hotkey: Box<str>,
    /// 动作描述
    pub description: Box<str>,
}

impl Default for PngRemixMotion {
    fn default() -> Self {
        Self {
            name: "".into(),
            hotkey: "".into(),
            description: "".into(),
        }
    }
}

/// PngRemix 状态映射
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct PngRemixState {
    /// 状态名称（对应 StateInfo.anima）
    pub state: Box<str>,
    /// 对应的表情名
    pub expression: Box<str>,
    /// 对应的动作名
    pub motion: Box<str>,
    /// 口型状态：0=Closed, 1=Open, 2=Screaming
    pub mouth_state: Option<u8>,
    /// 缩放比例
    pub scale: f64,
    /// X 偏移
    pub offset_x: i32,
    /// Y 偏移
    pub offset_y: i32,
}

impl Default for PngRemixState {
    fn default() -> Self {
        Self {
            state: "".into(),
            expression: "".into(),
            motion: "".into(),
            mouth_state: None,
            scale: 1.0,
            offset_x: 0,
            offset_y: 0,
        }
    }
}

/// PngRemix 完整配置（对应 asset/pngremix.json）
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct PngRemixConfig {
    pub schema_version: u32,
    pub model: PngRemixModelConfig,
    pub features: PngRemixFeatures,
    pub expressions: Vec<PngRemixExpression>,
    pub motions: Vec<PngRemixMotion>,
    pub states: Vec<PngRemixState>,
}

impl Default for PngRemixConfig {
    fn default() -> Self {
        Self {
            schema_version: 1,
            model: PngRemixModelConfig::default(),
            features: PngRemixFeatures::default(),
            expressions: Vec::new(),
            motions: Vec::new(),
            states: Vec::new(),
        }
    }
}

/// PngRemix 参数设置项
///
/// 进入某个状态时覆写 PngRemix 的表情和动作
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct PngRemixParameterSetting {
    /// 参数类型："expression" 切换表情，"motion" 触发动作
    #[serde(rename = "type")]
    pub param_type: Box<str>,
    /// 表情名或动作名
    pub name: Box<str>,
}

impl Default for PngRemixParameterSetting {
    fn default() -> Self {
        Self {
            param_type: "expression".into(),
            name: "".into(),
        }
    }
}




// ========================================================================= //
// 3D 配置定义
// ========================================================================= //

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThreeDModelType {
    Vrm,
    Pmx,
}

impl Default for ThreeDModelType {
    fn default() -> Self {
        Self::Vrm
    }
}

/// 3D 模型基础配置
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct ThreeDModelConfig {
    /// 模型显示名
    pub name: Box<str>,

    /// 模型类型：vrm / pmx
    #[serde(rename = "type")]
    pub model_type: ThreeDModelType,

    /// 模型文件路径（相对于 Mod 根目录）
    pub file: Box<str>,

    /// 模型整体缩放（窗口预览用）
    pub scale: f64,
    /// X 偏移
    pub offset_x: i32,
    /// Y 偏移
    pub offset_y: i32,

    /// 贴图根目录（PMX 常用；相对 Mod 根目录）。为空表示不指定。
    pub texture_base_dir: Box<str>,
}

impl Default for ThreeDModelConfig {
    fn default() -> Self {
        Self {
            name: "".into(),
            model_type: ThreeDModelType::Vrm,
            file: "".into(),
            scale: 1.0,
            offset_x: 0,
            offset_y: 0,
            texture_base_dir: "".into(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThreeDAnimationType {
    Vrma,
    Vmd,
}

impl Default for ThreeDAnimationType {
    fn default() -> Self {
        Self::Vrma
    }
}

/// 3D 动画条目
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct ThreeDAnimation {
    /// 动画逻辑名（供状态映射引用）
    pub name: Box<str>,

    /// 动画类型：vrma / vmd
    #[serde(rename = "type")]
    pub animation_type: ThreeDAnimationType,

    /// 动画文件路径（相对于 Mod 根目录）
    pub file: Box<str>,

    /// 播放倍速
    pub speed: f64,

    /// VRMA bake 采样 FPS（仅 vrma 使用；默认 30）
    pub vrma_fps: u32,
}

impl Default for ThreeDAnimation {
    fn default() -> Self {
        Self {
            name: "".into(),
            animation_type: ThreeDAnimationType::Vrma,
            file: "".into(),
            speed: 1.0,
            vrma_fps: 60,
        }
    }
}

/// 3D 状态映射
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct ThreeDState {
    /// 状态名称（对应 StateInfo.anima）
    pub state: Box<str>,

    /// 对应动画名（ThreeDAnimation.name）
    pub animation: Box<str>,

    /// 缩放比例
    pub scale: f64,

    /// X 偏移
    pub offset_x: i32,

    /// Y 偏移
    pub offset_y: i32,
}

impl Default for ThreeDState {
    fn default() -> Self {
        Self {
            state: "".into(),
            animation: "".into(),
            scale: 1.0,
            offset_x: 0,
            offset_y: 0,
        }
    }
}

/// 3D 完整配置（对应 asset/3d.json）
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct ThreeDConfig {
    pub schema_version: u32,
    pub model: ThreeDModelConfig,
    pub animations: Vec<ThreeDAnimation>,
    pub states: Vec<ThreeDState>,
}

impl Default for ThreeDConfig {
    fn default() -> Self {
        Self {
            schema_version: 1,
            model: ThreeDModelConfig::default(),
            animations: Vec::new(),
            states: Vec::new(),
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
    /// 文本显示持续时间（秒），支持小数，默认 3 秒
    pub duration: f64,
}

impl Default for TextInfo {
    fn default() -> Self {
        Self {
            name: default_name(),
            text: "".into(),
            duration: 3.0,
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

/// Live2D 参数设置项
///
/// 进入某个状态时，用于覆写 Live2D 模型的参数值或部件透明度。
/// 每个条目指定一个参数/部件 ID 和目标值。
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Live2DParameterSetting {
    /// Live2D 参数 ID（如 "ParamAngleX", "ParamEyeLOpen"）或部件 ID（如 "PartArmA"）
    pub id: Box<str>,
    /// 目标值
    pub value: f64,
    /// 目标类型："Parameter"（默认）设置参数值，"PartOpacity" 设置部件透明度
    pub target: Box<str>,
}

impl Default for Live2DParameterSetting {
    fn default() -> Self {
        Self {
            id: "".into(),
            value: 0.0,
            target: "Parameter".into(),
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
/// 定义角色的一个具体行为状态（如 idle, hello, music_play）。
/// 一个状态包含了如何展示（anima）、如何说话（audio/text）以及在何时生效（date/time）的完整指令。
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct StateInfo {
    /// 状态唯一标识符（由 Mod 作者在 manifest 中定义）
    pub name: Box<str>,

    /// 持久性标记：
    /// - `true`: 该状态是一个持久基态（如 idle）。当临时状态播放完毕后，通常会回到当前活跃的持久状态。
    /// - `false`: 临时状态（如点击反应）。播放完后会销毁并寻找下一个状态。
    pub persistent: bool,
    
    /// 核心资产绑定：
    /// 分别对应 `assets/imgs` 或 `assets/sequences` 目录下的资产名
    pub anima: Box<str>,
    /// 语音资源名，映射到 `audios/` 目录
    pub audio: Box<str>,
    /// 对话文本名，映射到 `texts/` 目录
    pub text: Box<str>,
    
    /// 状态优先级：
    /// 用于决定是否可以“打断”当前正在播放的状态。数值越高，话语权越大。
    pub priority: u32,

    /// 环境约束 - 日期范围 (MM-DD)：
    /// 用于实现节日特效（如 12-25 圣诞节期间生效的特殊状态）。
    pub date_start: Box<str>,
    pub date_end: Box<str>,
    
    /// 环境约束 - 时间范围 (HH:MM)：
    /// 用于实现早晚问候（如 06:00 - 09:00 期间触发的状态）。
    pub time_start: Box<str>,
    pub time_end: Box<str>,

    /// 链式状态：播放完成后自动跳转到的下一个状态名（如有）
    pub next_state: Box<str>,
    
    /// 概率分支：播放完成后可随机触发的子状态列表。
    /// 系统会根据 `CanTriggerState` 中定义的权重执行加权随机选择。
    #[serde(default, deserialize_with = "deserialize_can_trigger_states")]
    pub can_trigger_states: Vec<CanTriggerState>,
    
    /// 自动触发间隔（秒）：
    /// 当角色处于此状态时，每隔多少秒执行一次随机分支触发。
    pub trigger_time: f32,
    /// 自动触发的基础概率：配合 `trigger_time` 使用。
    pub trigger_rate: f32,

    /// 触发计数范围起点（包含）
    /// 当当前 ModData.value 落在 [start, end] 范围内时，该状态才允许触发
    #[serde(default = "default_trigger_counter_start")]
    pub trigger_counter_start: i32,

    /// 触发计数范围终点（包含）
    /// 当当前 ModData.value 落在 [start, end] 范围内时，该状态才允许触发
    #[serde(default = "default_trigger_counter_end")]
    pub trigger_counter_end: i32,

    /// 气温触发范围起点（包含，单位：摄氏度）
    /// 当当前 environment.temperature 落在 [start, end] 范围内时，该状态才允许触发
    #[serde(default = "default_trigger_temp_start")]
    pub trigger_temp_start: i32,

    /// 气温触发范围终点（包含，单位：摄氏度）
    /// 当当前 environment.temperature 落在 [start, end] 范围内时，该状态才允许触发
    #[serde(default = "default_trigger_temp_end")]
    pub trigger_temp_end: i32,

    /// 启动时长触发门槛（分钟）
    /// 当“本次程序启动已运行分钟数” >= trigger_uptime 时，该状态才允许触发。
    /// - 0 表示不限制
    #[serde(default = "default_trigger_uptime")]
    pub trigger_uptime: i32,

    /// 天气触发条件（精确匹配，数组任意匹配）
    /// - 空数组表示不限制
    /// - 数组元素为纯数字：与 environment.condition_code（weatherCode）比较
    /// - 否则：与 environment.condition（中文/英文描述）比较
    ///
    /// 兼容旧格式：允许将 trigger_weather 写成字符串
    #[serde(default, deserialize_with = "deserialize_trigger_weather")]
    pub trigger_weather: Vec<Box<str>>,



    /// 计数器副作用：进入该状态时对 Mod 特有的变量执行增减操作（如好感度+1）
    pub mod_data_counter: Option<ModDataCounterConfig>,

    /// Live2D 参数覆写：进入该状态时设置 Live2D 模型的参数值
    /// 仅对 mod_type = "live2d" 的 Mod 有效
    pub live2d_params: Option<Vec<Live2DParameterSetting>>,

    /// PngRemix 参数覆写：进入该状态时切换表情/触发动作
    /// 仅对 mod_type = "pngremix" 的 Mod 有效
    pub pngremix_params: Option<Vec<PngRemixParameterSetting>>,

    /// 分支气泡交互控制：标记是否在界面上显示对话分支按钮
    pub branch_show_bubble: bool,
    /// 固定对话分支选项：用户交互式的后续状态选择
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
            trigger_counter_start: i32::MIN,
            trigger_counter_end: i32::MAX,
            trigger_temp_start: i32::MIN,
            trigger_temp_end: i32::MAX,
            trigger_uptime: 0,
            trigger_weather: Vec::new(),
            mod_data_counter: None,
            live2d_params: None,
            pngremix_params: None,
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
    /// 是否允许连续多次触发相同或相近的状态（默认 true）
    /// 
    /// - `true`：允许重复触发同一状态
    /// - `false`：会排除最近触发过的状态，避免重复。排除的历史状态数量为 `min(3, 可用状态数-1)`
    /// - 如果 `states` 内只有一个可用状态，则忽略此限制
    pub allow_repeat: bool,
}

impl Default for TriggerStateGroup {
    fn default() -> Self {
        Self {
            persistent_state: "".into(),
            states: Vec::new(),
            allow_repeat: true,
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

/// 角色 Canvas 显示适配偏好
///
/// - long: 优先适配长边（完整显示，类似 contain）
/// - short: 优先适配短边（尽量填满，类似 cover，可能裁切）
/// - legacy: 旧版逻辑（仅按高度缩放，宽度随图片比例自适应）
#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum CanvasFitPreference {
    Long,
    Short,
    Legacy,
}

impl Default for CanvasFitPreference {
    fn default() -> Self {
        Self::Legacy
    }
}

/// 角色渲染配置
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct CharacterConfig {
    /// Z轴偏移（渲染层级）
    pub z_offset: i32,

    /// 角色 Canvas 适配偏好（可选项；旧 Mod 不填写时默认 short）
    pub canvas_fit_preference: CanvasFitPreference,
}

impl Default for CharacterConfig {
    fn default() -> Self {
        Self {
            z_offset: 1,
            canvas_fit_preference: CanvasFitPreference::Short,
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

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModType {
    Sequence,
    Live2d,
    Pngremix,

    /// 3D Mod（VRM/PMX + VRMA/VMD）
    #[serde(rename = "3d")]
    ThreeD,
}

impl Default for ModType {
    fn default() -> Self {
        Self::Sequence
    }
}

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

    /// Mod 类型（sequence / live2d / pngremix / 3d）
    pub mod_type: ModType,

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

    /// 全局键盘监听：为 true 时即使动画窗口未获得焦点也能触发 keydown 事件
    pub global_keyboard: bool,

    /// 全局鼠标监听：为 true 时即使鼠标未点击角色也能触发 global_click / global_right_click 事件
    pub global_mouse: bool,

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
            mod_type: ModType::Sequence,
            default_audio_lang_id: "".into(),
            default_text_lang_id: "".into(),
            character: CharacterConfig::default(),
            border: BorderConfig::default(),
            show_mod_data_panel: false,
            mod_data_default_int: 0,
            global_keyboard: false,
            global_mouse: false,
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
    /// Live2D 动画配置（仅 live2d Mod 有值）
    pub live2d: Option<Live2DConfig>,
    /// PngRemix 动画配置（仅 pngremix Mod 有值）
    pub pngremix: Option<PngRemixConfig>,
    /// 3D 动画配置（仅 3d Mod 有值）
    pub threed: Option<ThreeDConfig>,
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

/// Mod 摘要信息（用于管理器列表展示，减少 IPC 传输开销）
#[derive(Debug, Serialize, Clone)]
pub struct ModSummary {
    pub path: PathBuf,
    pub manifest: ModManifest,
    pub info: HashMap<Box<str>, CharacterInfo>,
    pub icon_path: Option<Box<str>>,
    pub preview_path: Option<Box<str>>,
}

impl ModInfo {
    /// 转换为摘要信息
    pub fn to_summary(&self) -> ModSummary {
        ModSummary {
            path: self.path.clone(),
            manifest: self.manifest.clone(),
            info: self.info.clone(),
            icon_path: self.icon_path.clone(),
            preview_path: self.preview_path.clone(),
        }
    }

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

    /// 来自 .tbuddy 包的 mod_id 集合（用于区分磁盘 mod 和 archive mod）
    archive_mod_ids: std::collections::HashSet<String>,
    /// 对 ModArchiveStore 的引用（由 AppState 共享）
    archive_store: Option<Arc<std::sync::Mutex<super::mod_archive::ModArchiveStore>>>,
}

impl ResourceManager {
    /// 创建资源管理器
    pub fn new(app_handle: &tauri::AppHandle) -> Self {
        Self {
            current_mod: None,
            search_paths: Self::discover_mod_paths(app_handle),
            mod_index: HashMap::new(),
            folder_to_id: HashMap::new(),
            archive_mod_ids: std::collections::HashSet::new(),
            archive_store: None,
        }
    }

    /// 设置 archive store 引用（在 AppState 初始化后调用）
    pub fn set_archive_store(&mut self, store: Arc<std::sync::Mutex<super::mod_archive::ModArchiveStore>>) {
        self.archive_store = Some(store);
    }

    /// 获取 archive store 引用（用于外部导入操作）
    pub fn get_archive_store(&self) -> Option<&Arc<std::sync::Mutex<super::mod_archive::ModArchiveStore>>> {
        self.archive_store.as_ref()
    }

    /// 判断指定 mod 是否来自 .tbuddy archive
    pub fn is_archive_mod(&self, mod_id: &str) -> bool {
        self.archive_mod_ids.contains(mod_id)
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

        // 2.5 mods_test 目录（仅 Debug 模式下加载，用于开发测试）
        if let Ok(resource_dir) = app_handle.path().resource_dir() {
            let mods_path = resource_dir.join("mods_test");
            if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                #[cfg(debug_assertions)]
                println!("[ResourceManager] 资源目录 mods_test: {:?}", canonical);
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

        if let Ok(exe_path) = std::env::current_exe() {
            // 尝试向上查找多级父目录中的 mods 文件夹
            let mut current_dir = exe_path.parent();
            for level in 1..=crate::modules::constants::MODS_SEARCH_MAX_LEVELS_EXE {
                if let Some(dir) = current_dir {
                    let mods_path = dir.join("mods_test");
                    if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                        #[cfg(debug_assertions)]
                        println!(
                            "[ResourceManager] 程序目录 mods_test (level {}): {:?}",
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

        // 4. 开发环境：当前工作目录向上查找 mods
        if let Ok(cwd) = std::env::current_dir() {
            let mut current_dir = Some(cwd.as_path());
            for level in 1..=crate::modules::constants::MODS_SEARCH_MAX_LEVELS_CWD {
                if let Some(dir) = current_dir {
                    let mods_path = dir.join("mods_test");
                    if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                        #[cfg(debug_assertions)]
                        println!(
                            "[ResourceManager] 项目目录 mods_test (level {}): {:?}",
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
        self.archive_mod_ids.clear();

        for base in &self.search_paths {
            let Ok(entries) = fs::read_dir(base) else {
                continue;
            };

            for entry in entries.flatten() {
                let entry_path = entry.path();

                // ---------- 常规文件夹 Mod ----------
                if entry_path.is_dir() {
                    let folder = entry.file_name().to_string_lossy().into_owned();
                    let canonical_dir = dunce::canonicalize(&entry_path).unwrap_or(entry_path);

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

                    self.folder_to_id
                        .entry(folder.clone())
                        .or_insert_with(|| manifest_id.clone());

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
                    continue;
                }

                // ---------- .tbuddy 包文件 ----------
                if entry_path.is_file() {
                    let fname = entry.file_name().to_string_lossy().to_lowercase();
                    let is_tbuddy = fname.ends_with(".tbuddy");
                    let is_sbuddy = fname.ends_with(".sbuddy");
                    if !is_tbuddy && !is_sbuddy {
                        continue;
                    }

                    // .sbuddy 需要外部加密工具支持
                    if is_sbuddy && !super::mod_archive::is_sbuddy_supported() {
                        #[cfg(debug_assertions)]
                        println!(
                            "[ResourceManager] Skipping .sbuddy '{}' (sbuddy-crypto not found)",
                            entry_path.display()
                        );
                        continue;
                    }

                    let Some(store_arc) = &self.archive_store else {
                        continue;
                    };
                    let mut store = store_arc.lock().unwrap();

                    // 尝试加载到内存并读取 manifest
                    let (manifest_id, manifest_version) = if is_sbuddy {
                        match store.load_sbuddy(&entry_path) {
                            Ok((id, manifest)) => (id, manifest.version.to_string()),
                            Err(e) => {
                                #[cfg(debug_assertions)]
                                println!(
                                    "[ResourceManager] Failed to load .sbuddy '{}': {}",
                                    entry_path.display(),
                                    e
                                );
                                continue;
                            }
                        }
                    } else {
                        match store.load_tbuddy(&entry_path) {
                            Ok((id, manifest)) => (id, manifest.version.to_string()),
                            Err(e) => {
                                #[cfg(debug_assertions)]
                                println!(
                                    "[ResourceManager] Failed to load .tbuddy '{}': {}",
                                    entry_path.display(),
                                    e
                                );
                                continue;
                            }
                        }
                    };

                    // 同 id 版本比较（文件夹 mod 优先；包文件之间比版本号）
                    if let Some(existing) = self.mod_index.get(&manifest_id) {
                        // 如果已有同 id 的文件夹 mod，跳过（文件夹优先）
                        if !self.archive_mod_ids.contains(&manifest_id) {
                            continue;
                        }
                        let ord = Self::compare_version(&manifest_version, &existing.version);
                        if ord != Ordering::Greater {
                            continue;
                        }
                    }

                    let folder = entry.file_name().to_string_lossy().into_owned();
                    self.folder_to_id
                        .entry(folder.clone())
                        .or_insert_with(|| manifest_id.clone());

                    self.archive_mod_ids.insert(manifest_id.clone());
                    self.mod_index.insert(
                        manifest_id.clone(),
                        ModLocator {
                            id: manifest_id,
                            version: manifest_version,
                            folder,
                            path: entry_path,  // .tbuddy / .sbuddy 文件路径
                        },
                    );
                }
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

    /// 公开版本的 resolve_mod_path，供外部调用
    pub fn resolve_mod_path_public(&mut self, mod_id_or_folder: &str) -> Option<PathBuf> {
        self.resolve_mod_path(mod_id_or_folder)
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

    fn read_mod_from_path(&self, mod_path: PathBuf) -> Result<ModInfo, String> {
        // 使用信号量限制并发加载，防止内存抖动
        // 注意：由于 read_mod_from_path 是同步函数，我们使用 try_acquire
        // 如果无法获取许可（并发已满），我们依然继续加载，但记录警告
        let _permit = LOAD_SEMAPHORE.try_acquire(); 
        
        if !mod_path.exists() {
            return Err(format!("Mod path does not exist: {:?}", mod_path));
        }
        if !mod_path.is_dir() {
            return Err(format!("Mod path is not a directory: {:?}", mod_path));
        }

        // 解析 manifest.json
        let manifest_path = mod_path.join("manifest.json");
        let manifest: ModManifest = load_json_obj(&manifest_path)
            .ok_or_else(|| format!("Failed to load or parse manifest at {:?}", manifest_path))?;


        // 解析资产定义（使用 "asset" 目录而非 "assets"）
        let assets_path = mod_path.join("asset");
        let imgs = crate::modules::utils::fs::load_json_list(&assets_path.join("img.json"));
        let sequences =
            crate::modules::utils::fs::load_json_list(&assets_path.join("sequence.json"));
        let live2d = if manifest.mod_type == ModType::Live2d {
            crate::modules::utils::fs::load_json_obj(&assets_path.join("live2d.json"))
        } else {
            None
        };
        let pngremix = if manifest.mod_type == ModType::Pngremix {
            crate::modules::utils::fs::load_json_obj(&assets_path.join("pngremix.json"))
        } else {
            None
        };
        let threed = if manifest.mod_type == ModType::ThreeD {
            crate::modules::utils::fs::load_json_obj(&assets_path.join("3d.json"))
        } else {
            None
        };


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
            live2d,
            pngremix,
            threed,
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

    /// 从磁盘读取 Mod 信息（不加载到当前状态）
    ///
    /// 用于 Mod 预览或加载前的检查。
    /// 自动判断是文件夹 mod 还是 archive mod。
    pub fn read_mod_from_disk(&mut self, mod_id: &str) -> Result<ModInfo, String> {
        // 先检查是否为 archive mod
        if self.is_archive_mod(mod_id) {
            return self.read_mod_from_archive(mod_id);
        }

        // 查找 Mod 目录（优先使用 manifest.id 解析）
        let mod_path = self
            .resolve_mod_path(mod_id)
            .ok_or_else(|| format!("Mod '{}' not found", mod_id))?;

        self.read_mod_from_path(mod_path)
    }

    /// 从 archive 读取 Mod 信息
    fn read_mod_from_archive(&self, mod_id: &str) -> Result<ModInfo, String> {
        let store_arc = self
            .archive_store
            .as_ref()
            .ok_or_else(|| "Archive store not initialized".to_string())?;
        let store = store_arc.lock().unwrap();
        let reader = store
            .get(mod_id)
            .ok_or_else(|| format!("Archive for mod '{}' not loaded", mod_id))?;

        // 解析 manifest.json
        let manifest: ModManifest = reader
            .read_json("manifest.json")
            .map_err(|e| format!("Failed to parse manifest from archive: {}", e))?;

        // 解析资产定义
        let imgs: Vec<AssetInfo> = reader.read_json_list("asset/img.json");
        let sequences: Vec<AssetInfo> = reader.read_json_list("asset/sequence.json");
        let live2d: Option<Live2DConfig> = if manifest.mod_type == ModType::Live2d {
            reader.read_json_optional("asset/live2d.json")
        } else {
            None
        };
        let pngremix: Option<PngRemixConfig> = if manifest.mod_type == ModType::Pngremix {
            reader.read_json_optional("asset/pngremix.json")
        } else {
            None
        };
        let threed: Option<ThreeDConfig> = if manifest.mod_type == ModType::ThreeD {
            reader.read_json_optional("asset/3d.json")
        } else {
            None
        };

        // 解析多语言语音
        let mut audios: HashMap<Box<str>, Vec<AudioInfo>> = HashMap::new();
        for entry in reader.list_dir("audio") {
            if entry.is_dir {
                let lang: Box<str> = entry.path.into();
                let speech: Vec<AudioInfo> =
                    reader.read_json_list(&format!("audio/{}/speech.json", &*lang));
                audios.insert(lang, speech);
            }
        }

        // 解析多语言文本和角色信息
        let mut info: HashMap<Box<str>, CharacterInfo> = HashMap::new();
        let mut texts: HashMap<Box<str>, Vec<TextInfo>> = HashMap::new();
        for entry in reader.list_dir("text") {
            if entry.is_dir {
                let lang: Box<str> = entry.path.clone().into();
                if let Some(mut char_info) =
                    reader.read_json_optional::<CharacterInfo>(&format!("text/{}/info.json", &entry.path))
                {
                    if char_info.id.is_empty() || char_info.id.as_ref() == "ERROR" {
                        char_info.id = lang.clone();
                    }
                    info.insert(lang.clone(), char_info);
                }
                let speech_list: Vec<TextInfo> =
                    reader.read_json_list(&format!("text/{}/speech.json", &entry.path));
                texts.insert(lang, speech_list);
            }
        }

        // 解析气泡样式
        let bubble_style: Option<serde_json::Value> =
            reader.read_json_optional("bubble_style.json");

        // 探测预览图和图标
        let mut icon_path_val = None;
        let mut preview_path_val = None;

        for ext in ["ico", "png"] {
            let p = format!("icon.{}", ext);
            if reader.file_exists(&p) {
                icon_path_val = Some(p);
                break;
            }
        }

        for ext in ["png", "jpg", "jpeg", "webp"] {
            let p = format!("preview.{}", ext);
            if reader.file_exists(&p) {
                preview_path_val = Some(p);
                break;
            }
        }

        // archive mod 的 path 使用特殊标记：tbuddy-archive://{mod_id}
        // 前端通过此标记判断走 tbuddy-asset:// 协议
        let virtual_path = PathBuf::from(format!("tbuddy-archive://{}", mod_id));

        let mut mod_info = ModInfo {
            path: virtual_path,
            manifest,
            imgs,
            sequences,
            live2d,
            pngremix,
            threed,
            audios,
            info,
            texts,
            bubble_style,
            icon_path: icon_path_val.map(|s| s.into()),
            preview_path: preview_path_val.map(|s| s.into()),
            state_index: HashMap::new(),
            trigger_index: HashMap::new(),
            asset_index: HashMap::new(),
            audio_index: HashMap::new(),
            text_index: HashMap::new(),
        };

        mod_info.validate_and_fix_states();
        mod_info.build_indices();

        Ok(mod_info)
    }

    /// 从指定目录读取 Mod 信息（不通过索引解析 id）
    pub fn read_mod_from_folder_path(&self, mod_path: PathBuf) -> Result<ModInfo, String> {
        self.read_mod_from_path(mod_path)
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

    /// 从指定目录路径直接加载 Mod（用于导入后立即加载某个具体目录）
    pub fn load_mod_from_folder_path(&mut self, mod_path: PathBuf) -> Result<Arc<ModInfo>, String> {
        let mod_info = Arc::new(self.read_mod_from_folder_path(mod_path)?);
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
    /// 从当前加载的 Mod 缓存中获取，如果 Mod 未配置则返回默认样式。
    /// 默认样式文件放在 `mods/bubble_style.json`（跟随内置 mods 资源一起打包）。
    pub fn get_bubble_style(&self) -> Option<serde_json::Value> {
        let mod_info = self.current_mod.as_ref()?;

        // 如果 Mod 配置了 bubble_style，则返回
        if mod_info.bubble_style.is_some() {
            return mod_info.bubble_style.clone();
        }

        // 否则，加载默认气泡样式（mods/bubble_style.json）
        self.load_default_bubble_style()
    }

    /// 加载默认的气泡样式（mods/bubble_style.json）
    fn load_default_bubble_style(&self) -> Option<serde_json::Value> {
        // 1) 优先从已发现的 mods 根目录（配置目录 / 资源目录）中查找
        for mods_root in &self.search_paths {
            let bubble_style_path = mods_root.join("bubble_style.json");
            if bubble_style_path.exists() {
                #[cfg(debug_assertions)]
                println!("[ResourceManager] 加载默认 bubble_style: {:?}", bubble_style_path);
                return crate::modules::utils::fs::load_json_obj(&bubble_style_path);
            }
        }

        // 2) 兜底：开发环境下从当前工作目录查找
        let default_path = PathBuf::from("mods").join("bubble_style.json");
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
