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
fn default_error_name() -> Box<str> {
    "ERROR".into()
}

#[derive(Debug, Deserialize)]

#[serde(untagged)]
enum TriggerWeatherDe {
    /// 旧版：单个字符串（例如 "Sunny" 或 "100"）
    Str(Box<str>),
    /// 新版：字符串数组（例如 ["Sunny", "Cloudy"]）
    Arr(Vec<Box<str>>),
}

/// 将 trigger_weather 字段统一解析为 Vec，并自动清理空白/空项。
///
/// 支持两种写法：
/// - 单字符串（兼容旧格式）
/// - 字符串数组（推荐）
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
            name: default_error_name(),
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

/// Live2D 模型基础配置（对应 Mod 中的 live2d.model）。
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
            name: default_error_name(),
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

/// Live2D 动作配置（对应 motions 列表）。
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
            name: default_error_name(),
            file: "".into(),

            group: "".into(),
            priority: "".into(),
            fade_in_ms: 0,
            fade_out_ms: 0,
            r#loop: false,
        }
    }
}

/// Live2D 表情配置（对应 expressions 列表）。
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Live2DExpression {

    pub name: Box<str>,
    pub file: Box<str>,
}



impl Default for Live2DExpression {
    fn default() -> Self {
        Self {
            name: default_error_name(),
            file: "".into(),

        }
    }
}


/// Live2D 状态映射（state → motion/expression/偏移）。
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
            state: default_error_name(),
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
    /// 触发时播放的音效名称（音频索引；空字符串表示不播放）
    pub audio: Box<str>,
    /// 图片所在目录（可选，用于工具侧分组/筛选）
    pub dir: Box<str>,
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
            audio: "".into(),
            dir: "".into(),
        }
    }
}

/// Live2D 配置汇总（模型/动作/表情/状态/图层）。
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Live2DConfig {

    pub schema_version: u32,
    pub model: Live2DModelConfig,
    pub motions: Vec<Live2DMotion>,
    pub expressions: Vec<Live2DExpression>,
    pub states: Vec<Live2DState>,
    /// 背景/叠加图层列表（已合并原 resources）
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

/// 3D 模型类型（VRM/PMX）。
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

    /// 动画文件根目录（相对 Mod 根目录）。为空表示不指定，直接使用 animation.file。
    pub animation_base_dir: Box<str>,
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
            animation_base_dir: "".into(),
        }
    }
}

/// 3D 动画类型（VRMA/VMD）。
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

    /// 动画文件路径（animation_base_dir 非空时为相对于该目录的路径，否则为相对 Mod 根目录的完整路径）
    pub file: Box<str>,

    /// 播放倍速
    pub speed: f64,

    /// 动画采样 FPS（默认 60）
    pub fps: u32,
}

impl Default for ThreeDAnimation {
    fn default() -> Self {
        Self {
            name: "".into(),
            animation_type: ThreeDAnimationType::Vrma,
            file: "".into(),
            speed: 1.0,
            fps: 60,
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
            name: default_error_name(),
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
            name: default_error_name(),
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
            id: default_error_name(),
            lang: default_error_name(),
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
#[serde(default)]
pub struct CanTriggerState {
    /// 子状态名（兼容旧字段名 `name`）
    #[serde(alias = "name")]
    pub state: Box<str>,

    /// 正整数权重（缺省为 1）
    pub weight: u32,
}

impl Default for CanTriggerState {
    fn default() -> Self {
        Self {
            state: "".into(),
            weight: 1,
        }
    }
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
    /// 用于决定是否可以"打断"当前正在播放的状态。数值越高，话语权越大。
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
    #[serde(deserialize_with = "deserialize_can_trigger_states")]
    pub can_trigger_states: Vec<CanTriggerState>,

    
    /// 自动触发间隔（秒）：
    /// 当角色处于此状态时，每隔多少秒执行一次随机分支触发。
    pub trigger_time: f32,
    /// 自动触发的基础概率：配合 `trigger_time` 使用。
    pub trigger_rate: f32,

    /// 触发计数范围起点（包含）
    /// 当当前 ModData.value 落在 [start, end] 范围内时，该状态才允许触发
    pub trigger_counter_start: i32,

    /// 触发计数范围终点（包含）
    /// 当当前 ModData.value 落在 [start, end] 范围内时，该状态才允许触发
    pub trigger_counter_end: i32,

    /// 气温触发范围起点（包含，单位：摄氏度）
    /// 当当前 environment.temperature 落在 [start, end] 范围内时，该状态才允许触发
    pub trigger_temp_start: i32,

    /// 气温触发范围终点（包含，单位：摄氏度）
    /// 当当前 environment.temperature 落在 [start, end] 范围内时，该状态才允许触发
    pub trigger_temp_end: i32,

    /// 启动时长触发门槛（分钟）
    /// 当"本次程序启动已运行分钟数" >= trigger_uptime 时，该状态才允许触发。
    /// - 0 表示不限制
    pub trigger_uptime: i32,


    /// 天气触发条件（精确匹配，数组任意匹配）
    /// - 空数组表示不限制
    /// - 数组元素为纯数字：与 environment.condition_code（weatherCode）比较
    /// - 否则：与 environment.condition（中文/英文描述）比较
    ///
    /// 兼容旧格式：允许将 trigger_weather 写成字符串
    #[serde(deserialize_with = "deserialize_trigger_weather")]
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
            name: default_error_name(),
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

        Self::check_time_range(current_minutes, &self.time_start, &self.time_end)
    }

    /// 纯函数：检查 current_minutes 是否在 [start, end) 时间范围内
    ///
    /// 支持跨午夜的情况（如 22:00 - 06:00）
    fn check_time_range(current_minutes: u32, time_start: &str, time_end: &str) -> bool {
        let start_minutes = Self::parse_time(time_start).unwrap_or(0);
        let end_minutes = Self::parse_time(time_end).unwrap_or(
            MINUTES_PER_DAY
        );

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

        Self::check_date_range(current_day, &self.date_start, &self.date_end)
    }

    /// 纯函数：检查 current_day (MMDD) 是否在 [start, end] 日期范围内
    ///
    /// 支持跨年的情况（如 12-01 - 01-31）
    fn check_date_range(current_day: u32, date_start: &str, date_end: &str) -> bool {
        let start_day = Self::parse_date(date_start).unwrap_or(0);
        let end_day = Self::parse_date(date_end).unwrap_or(
            DEFAULT_END_OF_YEAR
        );

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
    #[serde(deserialize_with = "deserialize_can_trigger_states")]
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

/// Mod 类型（sequence/live2d/pngremix/3d）。
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

    /// 是否启用贴图降采样（对 Live2D/PngRemix 的贴图解码策略生效）
    ///
    /// - false: 不对贴图做降采样/封顶（默认）
    /// - true: 允许贴图降采样/封顶（实际策略由各播放器内部阈值/设置决定）
    pub enable_texture_downsample: bool,

    /// 开始降采样的贴图尺寸阈值（像素；最长边）
    ///
    /// - 0: 不设阈值，所有贴图都可按策略降采样（默认）
    /// - >0: 仅当 max(width,height) >= threshold 时才允许触发降采样
    pub texture_downsample_start_dim: u32,

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
            id: default_error_name(),
            version: "".into(),

            author: "".into(),
            mod_type: ModType::Sequence,
            default_audio_lang_id: "".into(),
            default_text_lang_id: "".into(),
            character: CharacterConfig::default(),
            border: BorderConfig::default(),
            show_mod_data_panel: false,
            mod_data_default_int: 0,
            enable_texture_downsample: false,
            texture_downsample_start_dim: 0,
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
// AI Tools 配置
// ========================================================================= //

/// AI 工具截取矩形区域
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
#[serde(default)]
pub struct AiCaptureRect {
    /// 左上角 X 坐标
    pub x: i32,
    /// 左上角 Y 坐标
    pub y: i32,
    /// 宽度
    pub width: u32,
    /// 高度
    pub height: u32,
}

/// AI 工具类型
#[derive(Debug, Deserialize, Serialize, Clone, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AiToolType {
    /// 手动触发（用户主动截图）
    #[default]
    Manual,
    /// 自动触发（定时截图）
    Auto,
}

/// AI 返回结果的二次处理规则
///
/// 对 AI 返回的原始文本进行结构化匹配与转换。
/// 支持的处理类型：
/// - `"number"`: 从 AI 返回文本中提取数值，判断是否在 [min, max] 范围内
/// - `"keyword"`: 检查 AI 返回文本中是否包含指定关键词（不区分大小写）
/// - `"regex"`: 使用正则表达式匹配 AI 返回文本
///
/// 匹配成功时，输出 `result` 字段指定的文本（替代原始 AI 返回文本传递给 triggers）。
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
#[serde(default)]
pub struct AiResultProcessor {
    /// 处理类型：`"number"` / `"keyword"` / `"regex"`
    #[serde(rename = "type")]
    pub processor_type: Box<str>,
    /// 匹配成功后输出的结果字符串（传递给 triggers 做关键词匹配）
    pub result: Box<str>,
    /// 数值型匹配的最小阈值（含），仅 `type = "number"` 时有效
    pub min: Option<f64>,
    /// 数值型匹配的最大阈值（含），仅 `type = "number"` 时有效
    pub max: Option<f64>,
    /// 关键词 / 正则表达式模式，仅 `type = "keyword"` 或 `type = "regex"` 时有效
    pub pattern: Option<Box<str>>,
}

/// AI 工具触发映射：关键词 → 触发器名称
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
#[serde(default)]
pub struct AiToolTrigger {
    /// AI 识别结果中的关键词
    pub keyword: Box<str>,
    /// 匹配后要触发的 trigger name（对应 manifest 中的触发器事件名）
    pub trigger: Box<str>,
}

/// 单个 AI 小工具配置
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
#[serde(default)]
pub struct AiToolData {
    /// 工具名称
    pub name: Box<str>,
    /// 是否自动启动
    pub auto_start: bool,
    /// 类型：手动 (manual) 或自动 (auto)
    #[serde(rename = "type")]
    pub tool_type: AiToolType,
    /// 屏幕截取矩形区域
    pub capture_rect: AiCaptureRect,
    /// 提示词组，指导 AI 如何识别截图
    pub prompts: Vec<Box<str>>,
    /// AI 返回结果的二次处理规则列表（可选）
    /// 按顺序依次尝试匹配，第一个匹配成功的处理器的 `result` 将替代原始 AI 返回文本传给 triggers
    pub result_processors: Vec<AiResultProcessor>,
    /// 关键词 → 触发器映射列表：AI 识别结果命中关键词时触发对应的 trigger
    pub triggers: Vec<AiToolTrigger>,
    /// 是否显示信息窗口（截图结果/AI 回复等）
    pub show_info_window: bool,
}

/// 单个窗口名的 AI 工具配置
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
#[serde(default)]
pub struct AiToolProcess {
    /// 窗口名（用于与焦点窗口标题做匹配）
    pub window_name: Box<str>,
    /// AI 小工具列表
    pub tool_data: Vec<AiToolData>,
}

/// AI 工具配置文件顶层结构（对应 ai_tools.json）
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
#[serde(default)]
pub struct AiToolsConfig {
    /// AI 工具列表（每项对应一个窗口名）
    pub ai_tools: Vec<AiToolProcess>,
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
    /// AI 工具配置（从 ai_tools.json 加载，可选，Arc 包装避免频繁 clone）
    pub ai_tools: Option<Arc<AiToolsConfig>>,
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
    pub(crate) fn build_indices(&mut self) {
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

    /// `.sbuddy` 解密后缓存的真实 manifest 关键信息。
    ///
    /// canonical_file_path -> (manifest.id, manifest.version, manifest.mod_type)
    ///
    /// 目的：
    /// - 当 `.sbuddy` 文件名不等于 `manifest.id` 时，扫描阶段仍可"无解密"地建立正确索引
    /// - Mods 列表在刷新时可直接显示已解密过的 `.sbuddy` 的真实类型/版本
    sbuddy_manifest_cache: HashMap<PathBuf, (String, String, ModType)>,

}


// 运行时方法（依赖 AppHandle，不可单元测试）拆分到独立文件以便排除覆盖率统计
include!("resource_runtime.rs");

impl ResourceManager {
    /// 创建资源管理器（自定义搜索路径，用于测试或工具场景）
    pub fn new_with_search_paths(search_paths: Vec<PathBuf>) -> Self {
        Self {
            current_mod: None,
            search_paths,
            mod_index: HashMap::new(),
            folder_to_id: HashMap::new(),
            archive_mod_ids: std::collections::HashSet::new(),
            archive_store: None,
            sbuddy_manifest_cache: HashMap::new(),
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

    // discover_mod_paths() 已移至 resource_runtime.rs

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

    // rebuild_mod_index, resolve_mod_path, list_mods, list_mod_summaries_fast,
    // read_mod_from_path, load_mod, load_text_resources, load_multilang_resources,
    // get_bubble_style, load_default_bubble_style 等文件系统操作方法
    // 已移至 resource_fs_runtime.rs

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

}

// 文件系统操作方法（涉及 Mod 索引重建、archive 扫描、读取/加载等）
// 拆分到独立文件以便排除覆盖率统计
include!("resource_fs_runtime.rs");

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use std::cmp::Ordering;

    #[derive(Debug, Deserialize)]
    struct TriggerWeatherHolder {
        #[serde(deserialize_with = "deserialize_trigger_weather")]
        trigger_weather: Vec<Box<str>>,
    }

    #[derive(Debug, Deserialize)]
    struct EventsHolder {
        #[serde(deserialize_with = "deserialize_string_or_vec")]
        events: Vec<String>,
    }

    #[derive(Debug, Deserialize)]
    struct CanTriggerHolder {
        #[serde(deserialize_with = "deserialize_can_trigger_states")]
        states: Vec<CanTriggerState>,
    }

    #[test]
    fn parse_version_and_compare() {
        let (nums, pre) = ResourceManager::parse_version("v1.2.3-beta");
        assert_eq!(nums, vec![1, 2, 3]);
        assert_eq!(pre.as_deref(), Some("beta"));

        assert_eq!(ResourceManager::compare_version("1.0.0", "1.0.0"), Ordering::Equal);
        assert_eq!(ResourceManager::compare_version("1.0.1", "1.0.0"), Ordering::Greater);
        assert_eq!(ResourceManager::compare_version("1.0.0", "1.0.1"), Ordering::Less);
        assert_eq!(
            ResourceManager::compare_version("1.0.0", "1.0.0-beta"),
            Ordering::Greater
        );
    }

    #[test]
    fn compare_version_pre_release_less_than_release() {
        // (Some(_), None) -> Ordering::Less
        assert_eq!(
            ResourceManager::compare_version("1.0.0-alpha", "1.0.0"),
            Ordering::Less
        );
        // (Some(_), Some(_)) -> string compare
        assert_eq!(
            ResourceManager::compare_version("1.0.0-alpha", "1.0.0-beta"),
            Ordering::Less
        );
        assert_eq!(
            ResourceManager::compare_version("1.0.0-beta", "1.0.0-alpha"),
            Ordering::Greater
        );
    }

    #[test]
    fn deserialize_string_or_vec_visit_string_branch() {
        // Deserializing a JSON String value uses visit_string (owned string),
        // while visit_str is for borrowed strings. Both branches should work.
        let empty: EventsHolder = serde_json::from_str(r#"{"events": ""}"#).unwrap();
        assert!(empty.events.is_empty());

        // serde_json typically calls visit_str for string values; visit_string is
        // the owned-String variant which serde_json may call in some paths.
        // We can verify correctness via the EventsHolder with non-empty value:
        let single: EventsHolder = serde_json::from_str(r#"{"events": "click"}"#).unwrap();
        assert_eq!(single.events, vec!["click".to_string()]);
    }

    #[test]
    fn deserialize_trigger_weather_supports_string_and_array() {
        let single: TriggerWeatherHolder = serde_json::from_str(
            r#"{"trigger_weather": "  Sunny  "}"#,
        )
        .unwrap();

        assert_eq!(single.trigger_weather, vec!["Sunny".into()]);

        let arr: TriggerWeatherHolder = serde_json::from_str(
            r#"{"trigger_weather": ["Rain", " " , "Cloudy"]}"#,
        )
        .unwrap();

        assert_eq!(arr.trigger_weather, vec!["Rain".into(), "Cloudy".into()]);
    }

    #[test]
    fn deserialize_string_or_vec_supports_event_alias() {
        let single: EventsHolder = serde_json::from_str(r#"{"events": "click"}"#).unwrap();

        assert_eq!(single.events, vec!["click".to_string()]);

        let arr: EventsHolder =
            serde_json::from_str(r#"{"events": ["a", "b"]}"#).unwrap();

        assert_eq!(arr.events, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn deserialize_can_trigger_states_supports_string_and_object() {
        let holder: CanTriggerHolder = serde_json::from_str(
            r#"{"states": ["idle", {"state": "hello", "weight": 3}] }"#,
        )
        .unwrap();

        assert_eq!(holder.states.len(), 2);
        assert_eq!(holder.states[0].state.as_ref(), "idle");
        assert_eq!(holder.states[0].weight, 1);
        assert_eq!(holder.states[1].state.as_ref(), "hello");
        assert_eq!(holder.states[1].weight, 3);
    }

    // ================================================================
    // Default 实现测试（按类型分组）
    // ================================================================

    #[test]
    fn core_types_default_values() {
        // AssetInfo
        let a = AssetInfo::default();
        assert_eq!(a.name.as_ref(), "ERROR");
        assert!(!a.sequence);
        assert_eq!(a.frame_time, 0.3);
        assert_eq!(a.frame_num_x, 1);
        assert_eq!(a.frame_num_y, 1);
        assert_eq!(a.offset_x, 0);

        // AudioInfo / TextInfo / CharacterInfo
        let audio = AudioInfo::default();
        assert_eq!(audio.name.as_ref(), "ERROR");
        assert_eq!(audio.audio.as_ref(), "");
        let text = TextInfo::default();
        assert_eq!(text.name.as_ref(), "ERROR");
        assert_eq!(text.duration, 3.0);
        let ci = CharacterInfo::default();
        assert_eq!(ci.name.as_ref(), "Default");
        assert_eq!(ci.id.as_ref(), "ERROR");

        // CanTriggerState / BranchInfo / TriggerInfo / TriggerStateGroup
        let cts = CanTriggerState::default();
        assert_eq!(cts.weight, 1);
        assert_eq!(cts.state.as_ref(), "");
        let bi = BranchInfo::default();
        assert_eq!(bi.text.as_ref(), "");
        let tsg = TriggerStateGroup::default();
        assert!(tsg.allow_repeat);
        assert!(tsg.states.is_empty());
        let ti = TriggerInfo::default();
        assert_eq!(ti.event.as_ref(), "");
        assert!(ti.can_trigger_states.is_empty());

        // ModDataCounterOp / Config
        assert!(matches!(ModDataCounterOp::default(), ModDataCounterOp::Add));
        let mdc = ModDataCounterConfig::default();
        assert!(matches!(mdc.op, ModDataCounterOp::Add));
        assert_eq!(mdc.value, 0);

        // Enum defaults
        assert!(matches!(ModType::default(), ModType::Sequence));
        assert!(matches!(CanvasFitPreference::default(), CanvasFitPreference::Legacy));
    }

    #[test]
    fn state_and_manifest_default_values() {
        let s = StateInfo::default();
        assert_eq!(s.name.as_ref(), "ERROR");
        assert!(!s.persistent);
        assert_eq!(s.priority, 0);
        assert_eq!(s.trigger_counter_start, i32::MIN);
        assert_eq!(s.trigger_counter_end, i32::MAX);
        assert_eq!(s.trigger_temp_start, i32::MIN);
        assert_eq!(s.trigger_temp_end, i32::MAX);
        assert_eq!(s.trigger_uptime, 0);
        assert!(s.trigger_weather.is_empty());
        assert!(s.mod_data_counter.is_none());
        assert!(s.branch_show_bubble);
        assert!(s.branch.is_empty());

        let m = ModManifest::default();
        assert_eq!(m.id.as_ref(), "ERROR");
        assert!(!m.global_keyboard);
        assert!(!m.global_mouse);
        assert!(!m.show_mod_data_panel);

        let cc = CharacterConfig::default();
        assert_eq!(cc.z_offset, 1);
        let bc = BorderConfig::default();
        assert!(bc.enable);
        assert_eq!(bc.z_offset, 2);
    }

    #[test]
    fn live2d_types_default_values() {
        let c = Live2DModelConfig::default();
        assert_eq!(c.name.as_ref(), "ERROR");
        assert_eq!(c.scale, 1.0);
        assert!(!c.eye_blink);
        assert!(!c.lip_sync);
        let m = Live2DMotion::default();
        assert_eq!(m.name.as_ref(), "ERROR");
        assert!(!m.r#loop);
        assert_eq!(m.fade_in_ms, 0);
        let e = Live2DExpression::default();
        assert_eq!(e.name.as_ref(), "ERROR");
        assert_eq!(e.file.as_ref(), "");
        let s = Live2DState::default();
        assert_eq!(s.state.as_ref(), "ERROR");
        assert_eq!(s.scale, 1.0);
        let b = Live2DBackgroundLayer::default();
        assert_eq!(b.layer.as_ref(), "behind");
        assert_eq!(b.scale, 1.0);
        assert!(b.events.is_empty());
        let cfg = Live2DConfig::default();
        assert_eq!(cfg.schema_version, 1);
        assert!(cfg.motions.is_empty());
        assert!(cfg.states.is_empty());
        let ps = Live2DParameterSetting::default();
        assert_eq!(ps.target.as_ref(), "Parameter");
        assert_eq!(ps.value, 0.0);
    }

    #[test]
    fn pngremix_types_default_values() {
        let c = PngRemixModelConfig::default();
        assert_eq!(c.scale, 1.0);
        assert_eq!(c.max_fps, 60);
        let f = PngRemixFeatures::default();
        assert!(f.mouse_follow);
        assert!(f.auto_blink);
        assert!(f.click_bounce);
        assert_eq!(f.click_bounce_amp, 50.0);
        let e = PngRemixExpression::default();
        assert_eq!(e.state_index, 0);
        let s = PngRemixState::default();
        assert_eq!(s.scale, 1.0);
        assert!(s.mouth_state.is_none());
        let cfg = PngRemixConfig::default();
        assert_eq!(cfg.schema_version, 1);
        assert!(cfg.expressions.is_empty());
        let m = PngRemixMotion::default();
        assert_eq!(m.name.as_ref(), "");
        let p = PngRemixParameterSetting::default();
        assert_eq!(p.param_type.as_ref(), "expression");
    }

    #[test]
    fn threed_types_default_values() {
        assert_eq!(ThreeDModelType::default(), ThreeDModelType::Vrm);
        assert_eq!(ThreeDAnimationType::default(), ThreeDAnimationType::Vrma);
        let c = ThreeDModelConfig::default();
        assert_eq!(c.model_type, ThreeDModelType::Vrm);
        assert_eq!(c.scale, 1.0);
        let a = ThreeDAnimation::default();
        assert_eq!(a.animation_type, ThreeDAnimationType::Vrma);
        assert_eq!(a.speed, 1.0);
        assert_eq!(a.fps, 60);
        let s = ThreeDState::default();
        assert_eq!(s.scale, 1.0);
        let cfg = ThreeDConfig::default();
        assert_eq!(cfg.schema_version, 1);
        assert!(cfg.animations.is_empty());
    }

    // ================================================================
    // Serde 反序列化测试
    // ================================================================

    #[test]
    fn serde_state_info_roundtrip() {
        let json = r#"{
            "name": "idle",
            "persistent": true,
            "anima": "idle_anim",
            "priority": 5,
            "trigger_time": 10.0,
            "trigger_rate": 0.5,
            "trigger_counter_start": -10,
            "trigger_counter_end": 100,
            "trigger_temp_start": -5,
            "trigger_temp_end": 35,
            "trigger_uptime": 60,
            "trigger_weather": ["100", "Sunny"],
            "can_trigger_states": [],
            "branch": []
        }"#;
        let s: StateInfo = serde_json::from_str(json).unwrap();
        assert_eq!(s.name.as_ref(), "idle");
        assert!(s.persistent);
        assert_eq!(s.priority, 5);
        assert_eq!(s.trigger_counter_start, -10);
        assert_eq!(s.trigger_counter_end, 100);
        assert_eq!(s.trigger_temp_start, -5);
        assert_eq!(s.trigger_temp_end, 35);
        assert_eq!(s.trigger_uptime, 60);
        assert_eq!(s.trigger_weather.len(), 2);
    }

    #[test]
    fn serde_state_info_minimal() {
        let json = r#"{"can_trigger_states": []}"#;
        let s: StateInfo = serde_json::from_str(json).unwrap();
        assert_eq!(s.name.as_ref(), "ERROR");
        assert!(!s.persistent);
    }

    #[test]
    fn serde_mod_manifest_roundtrip() {
        let json = r#"{
            "id": "test_mod",
            "version": "1.0.0",
            "author": "tester",
            "mod_type": "sequence",
            "important_states": {},
            "states": [],
            "triggers": []
        }"#;
        let m: ModManifest = serde_json::from_str(json).unwrap();
        assert_eq!(m.id.as_ref(), "test_mod");
        assert_eq!(m.version.as_ref(), "1.0.0");
        assert!(matches!(m.mod_type, ModType::Sequence));
    }

    #[test]
    fn serde_mod_type_variants() {
        let s: ModType = serde_json::from_str(r#""sequence""#).unwrap();
        assert!(matches!(s, ModType::Sequence));
        let l: ModType = serde_json::from_str(r#""live2d""#).unwrap();
        assert!(matches!(l, ModType::Live2d));
        let p: ModType = serde_json::from_str(r#""pngremix""#).unwrap();
        assert!(matches!(p, ModType::Pngremix));
        let t: ModType = serde_json::from_str(r#""3d""#).unwrap();
        assert!(matches!(t, ModType::ThreeD));
    }

    #[test]
    fn serde_asset_info_roundtrip() {
        let json = r#"{
            "name": "walk",
            "img": "walk.png",
            "sequence": true,
            "frame_time": 0.1,
            "frame_size_x": 64,
            "frame_size_y": 64,
            "frame_num_x": 4,
            "frame_num_y": 2,
            "offset_x": -10,
            "offset_y": 5
        }"#;
        let a: AssetInfo = serde_json::from_str(json).unwrap();
        assert_eq!(a.name.as_ref(), "walk");
        assert!(a.sequence);
        assert_eq!(a.frame_time, 0.1);
        assert_eq!(a.frame_size_x, 64);
        assert_eq!(a.frame_num_x, 4);
    }

    #[test]
    fn serde_trigger_info_roundtrip() {
        let json = r#"{
            "event": "click",
            "can_trigger_states": [
                {
                    "persistent_state": "",
                    "states": ["react1", {"state": "react2", "weight": 3}]
                }
            ]
        }"#;
        let t: TriggerInfo = serde_json::from_str(json).unwrap();
        assert_eq!(t.event.as_ref(), "click");
        assert_eq!(t.can_trigger_states.len(), 1);
        assert_eq!(t.can_trigger_states[0].states.len(), 2);
        assert_eq!(t.can_trigger_states[0].states[1].weight, 3);
    }

    #[test]
    fn serde_branch_info_roundtrip() {
        let json = r#"{"text": "Say hello", "next_state": "hello"}"#;
        let b: BranchInfo = serde_json::from_str(json).unwrap();
        assert_eq!(b.text.as_ref(), "Say hello");
        assert_eq!(b.next_state.as_ref(), "hello");
    }

    #[test]
    fn serde_live2d_config_roundtrip() {
        let json = r#"{
            "schema_version": 2,
            "model": {"name": "model1", "scale": 0.5},
            "motions": [{"name": "wave", "file": "wave.motion3.json"}],
            "expressions": [{"name": "happy", "file": "happy.exp3.json"}],
            "states": [{"state": "idle", "motion": "wave"}],
            "background_layers": []
        }"#;
        let c: Live2DConfig = serde_json::from_str(json).unwrap();
        assert_eq!(c.schema_version, 2);
        assert_eq!(c.motions.len(), 1);
        assert_eq!(c.expressions.len(), 1);
    }

    #[test]
    fn serde_pngremix_config_roundtrip() {
        let json = r#"{
            "schema_version": 1,
            "model": {"name": "pm", "pngremix_file": "test.pngRemix"},
            "features": {"mouse_follow": false},
            "expressions": [{"name": "happy", "state_index": 1}],
            "motions": [],
            "states": []
        }"#;
        let c: PngRemixConfig = serde_json::from_str(json).unwrap();
        assert!(!c.features.mouse_follow);
        assert_eq!(c.expressions[0].state_index, 1);
    }

    #[test]
    fn serde_three_d_config_roundtrip() {
        let json = r#"{
            "schema_version": 1,
            "model": {"name": "m", "type": "pmx", "file": "model.pmx"},
            "animations": [{"name": "idle", "type": "vmd", "file": "idle.vmd"}],
            "states": [{"state": "idle", "animation": "idle"}]
        }"#;
        let c: ThreeDConfig = serde_json::from_str(json).unwrap();
        assert_eq!(c.model.model_type, ThreeDModelType::Pmx);
        assert_eq!(c.animations[0].animation_type, ThreeDAnimationType::Vmd);
    }

    // ================================================================
    // 反序列化器边界测试
    // ================================================================

    #[test]
    fn deserialize_trigger_weather_null() {
        let h: TriggerWeatherHolder =
            serde_json::from_str(r#"{"trigger_weather": null}"#).unwrap();
        assert!(h.trigger_weather.is_empty());
    }

    #[test]
    fn deserialize_trigger_weather_empty_string() {
        let h: TriggerWeatherHolder =
            serde_json::from_str(r#"{"trigger_weather": "   "}"#).unwrap();
        assert!(h.trigger_weather.is_empty());
    }

    #[test]
    fn deserialize_trigger_weather_empty_array() {
        let h: TriggerWeatherHolder =
            serde_json::from_str(r#"{"trigger_weather": []}"#).unwrap();
        assert!(h.trigger_weather.is_empty());
    }

    #[test]
    fn deserialize_string_or_vec_empty_string() {
        let h: EventsHolder = serde_json::from_str(r#"{"events": ""}"#).unwrap();
        assert!(h.events.is_empty());
    }

    #[test]
    fn deserialize_string_or_vec_empty_array() {
        let h: EventsHolder = serde_json::from_str(r#"{"events": []}"#).unwrap();
        assert!(h.events.is_empty());
    }

    #[test]
    fn deserialize_string_or_vec_filters_empty() {
        let h: EventsHolder =
            serde_json::from_str(r#"{"events": ["a", "", "b"]}"#).unwrap();
        assert_eq!(h.events, vec!["a", "b"]);
    }

    #[test]
    fn deserialize_can_trigger_states_empty_name_filtered() {
        let h: CanTriggerHolder =
            serde_json::from_str(r#"{"states": ["", "ok", {"state": "", "weight": 5}]}"#).unwrap();
        assert_eq!(h.states.len(), 1);
        assert_eq!(h.states[0].state.as_ref(), "ok");
    }

    #[test]
    fn deserialize_can_trigger_states_with_name_alias() {
        let h: CanTriggerHolder =
            serde_json::from_str(r#"{"states": [{"name": "abc", "weight": 2}]}"#).unwrap();
        assert_eq!(h.states[0].state.as_ref(), "abc");
        assert_eq!(h.states[0].weight, 2);
    }

    // ================================================================
    // parse_version / compare_version 边界
    // ================================================================

    #[test]
    fn parse_version_empty() {
        let (nums, pre) = ResourceManager::parse_version("");
        assert_eq!(nums, vec![0]);
        assert!(pre.is_none());
    }

    #[test]
    fn parse_version_v_prefix() {
        let (nums, _) = ResourceManager::parse_version("V2.0");
        assert_eq!(nums, vec![2, 0]);
    }

    #[test]
    fn compare_version_unequal_segments() {
        assert_eq!(
            ResourceManager::compare_version("1.0", "1.0.0"),
            Ordering::Equal
        );
        assert_eq!(
            ResourceManager::compare_version("1.0.0.1", "1.0.0"),
            Ordering::Greater
        );
    }

    #[test]
    fn compare_version_both_prerelease() {
        assert_eq!(
            ResourceManager::compare_version("1.0.0-alpha", "1.0.0-beta"),
            Ordering::Less
        );
    }

    // ================================================================
    // ResourceManager 基础方法测试
    // ================================================================

    #[test]
    fn new_resource_manager_is_empty_and_queries_return_none() {
        let rm = ResourceManager::new_with_search_paths(vec![]);
        // 初始化检查
        assert!(rm.current_mod.is_none());
        assert!(rm.search_paths.is_empty());
        // 无 mod 时所有查询应返回 None/empty
        assert!(rm.get_all_states().is_empty());
        assert!(rm.get_all_triggers().is_empty());
        assert!(rm.get_state_by_name("idle").is_none());
        assert!(rm.get_trigger_by_event("click").is_none());
        assert!(rm.get_asset_by_name("idle").is_none());
        assert!(rm.get_audio_by_name("zh", "hello").is_none());
        assert!(rm.get_text_by_name("zh", "hello").is_none());
        assert!(rm.get_info_by_lang("zh").is_none());
        assert!(rm.get_bubble_style().is_none());
        assert!(rm.get_archive_store().is_none());
        assert!(!rm.is_archive_mod("nonexistent"));
    }

    #[test]
    fn unload_mod_returns_false_when_none() {
        let mut rm = ResourceManager::new_with_search_paths(vec![]);
        assert!(!rm.unload_mod());
    }

    // ================================================================
    // ModManifest 查询方法测试
    // ================================================================

    #[test]
    fn mod_manifest_get_state_by_name_from_important() {
        let mut m = ModManifest::default();
        let mut s = StateInfo::default();
        s.name = "idle".into();
        m.important_states.insert("idle".into(), s);
        assert!(m.get_state_by_name("idle").is_some());
        assert!(m.get_state_by_name("missing").is_none());
    }

    #[test]
    fn mod_manifest_get_state_by_name_from_states() {
        let mut m = ModManifest::default();
        let mut s = StateInfo::default();
        s.name = "hello".into();
        m.states.push(s);
        assert!(m.get_state_by_name("hello").is_some());
    }

    #[test]
    fn mod_manifest_get_trigger_by_event() {
        let mut m = ModManifest::default();
        let mut t = TriggerInfo::default();
        t.event = "click".into();
        m.triggers.push(t);
        assert!(m.get_trigger_by_event("click").is_some());
        assert!(m.get_trigger_by_event("hover").is_none());
    }

    // ================================================================
    // ModInfo 索引与查询测试
    // ================================================================

    #[test]
    fn mod_info_build_indices_and_queries() {
        let mut manifest = ModManifest::default();
        manifest.default_audio_lang_id = "zh".into();
        manifest.default_text_lang_id = "zh".into();

        let mut s1 = StateInfo::default();
        s1.name = "idle".into();
        let mut s2 = StateInfo::default();
        s2.name = "hello".into();
        manifest.states = vec![s1, s2];

        let mut t1 = TriggerInfo::default();
        t1.event = "click".into();
        manifest.triggers = vec![t1];

        let mut info = build_test_mod_info(manifest);

        let a1 = AssetInfo { name: "bg".into(), ..Default::default() };
        info.imgs = vec![a1];
        let a2 = AssetInfo { name: "walk".into(), ..Default::default() };
        info.sequences = vec![a2];

        let mut audio_map = HashMap::new();
        audio_map.insert("zh".into(), vec![AudioInfo { name: "greet".into(), audio: "greet.wav".into() }]);
        info.audios = audio_map;

        let mut text_map = HashMap::new();
        text_map.insert("zh".into(), vec![TextInfo { name: "hello_txt".into(), text: "hello".into(), duration: 3.0 }]);
        info.texts = text_map;

        info.build_indices();

        // state lookup
        assert!(info.get_state_by_name("idle").is_some());
        assert!(info.get_state_by_name("hello").is_some());
        assert!(info.get_state_by_name("missing").is_none());

        // trigger lookup
        assert!(info.get_trigger_by_event("click").is_some());
        assert!(info.get_trigger_by_event("hover").is_none());

        // asset lookup
        assert!(info.get_asset_by_name("bg").is_some());
        assert!(info.get_asset_by_name("walk").is_some());
        assert!(info.get_asset_by_name("missing").is_none());

        // audio lookup
        assert!(info.get_audio_by_name("zh", "greet").is_some());
        assert!(info.get_audio_by_name("en", "greet").is_some()); // fallback
        assert!(info.get_audio_by_name("zh", "missing").is_none());

        // text lookup
        assert!(info.get_text_by_name("zh", "hello_txt").is_some());
        assert!(info.get_text_by_name("en", "hello_txt").is_some()); // fallback
        assert!(info.get_text_by_name("zh", "missing").is_none());

        // info lookup
        assert!(info.get_info_by_lang("zh").is_none()); // not set in test
    }

    #[test]
    fn mod_info_get_info_by_lang() {
        let manifest = ModManifest::default();
        let mut info = build_test_mod_info(manifest);
        let ci = CharacterInfo { id: "zh".into(), lang: "Chinese".into(), name: "Test".into(), description: "".into() };
        info.info.insert("zh".into(), ci);
        assert_eq!(info.get_info_by_lang("zh").unwrap().name.as_ref(), "Test");
        assert!(info.get_info_by_lang("en").is_none());
    }

    // ================================================================
    // StateInfo 时间/日期解析测试
    // ================================================================

    #[test]
    fn parse_time_valid() {
        assert_eq!(StateInfo::parse_time("08:30"), Some(8 * 60 + 30));
        assert_eq!(StateInfo::parse_time("00:00"), Some(0));
        assert_eq!(StateInfo::parse_time("23:59"), Some(23 * 60 + 59));
    }

    #[test]
    fn parse_time_invalid() {
        assert!(StateInfo::parse_time("").is_none());
        assert!(StateInfo::parse_time("abc").is_none());
        assert!(StateInfo::parse_time("12").is_none());
    }

    #[test]
    fn parse_date_valid() {
        assert_eq!(StateInfo::parse_date("01-01"), Some(101));
        assert_eq!(StateInfo::parse_date("12-31"), Some(1231));
    }

    #[test]
    fn parse_date_invalid() {
        assert!(StateInfo::parse_date("").is_none());
        assert!(StateInfo::parse_date("abc").is_none());
    }

    // ================================================================
    // validate_and_fix_states 测试
    // ================================================================

    // ================================================================
    // ResourceManager 磁盘操作测试
    // ================================================================

    #[test]
    fn list_mods_with_temp_dir() {
        let dir = std::env::temp_dir().join("tbuddy_test_list_mods");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        // 创建一个简单的 mod 目录
        let mod_dir = dir.join("test_mod_1");
        fs::create_dir_all(&mod_dir).unwrap();
        fs::write(
            mod_dir.join("manifest.json"),
            r#"{"id": "my_mod", "version": "1.0.0", "can_trigger_states": [], "important_states": {}, "states": [], "triggers": []}"#,
        ).unwrap();

        let mut rm = ResourceManager::new_with_search_paths(vec![dir.clone()]);
        let mods = rm.list_mods();
        assert!(mods.contains(&"my_mod".to_string()));

        // resolve_mod_id
        assert_eq!(rm.resolve_mod_id("my_mod"), Some("my_mod".to_string()));
        // folder -> id
        assert_eq!(rm.resolve_mod_id("test_mod_1"), Some("my_mod".to_string()));
        // unknown
        assert_eq!(rm.resolve_mod_id("unknown"), None);

        // resolve_mod_path
        assert!(rm.resolve_mod_path_public("my_mod").is_some());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_mod_from_path_basic() {
        let dir = std::env::temp_dir().join("tbuddy_test_read_mod");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let mod_dir = dir.join("basic_mod");
        fs::create_dir_all(mod_dir.join("asset")).unwrap();
        fs::create_dir_all(mod_dir.join("text").join("zh")).unwrap();
        fs::create_dir_all(mod_dir.join("audio").join("zh")).unwrap();

        fs::write(
            mod_dir.join("manifest.json"),
            r#"{"id": "basic", "version": "1.0.0", "mod_type": "sequence", "can_trigger_states": [], "important_states": {}, "states": [{"name": "idle", "persistent": true, "can_trigger_states": []}], "triggers": []}"#,
        ).unwrap();
        fs::write(
            mod_dir.join("asset").join("img.json"),
            r#"[{"name": "idle", "img": "idle.png"}]"#,
        ).unwrap();
        fs::write(
            mod_dir.join("text").join("zh").join("info.json"),
            r#"{"id": "zh", "lang": "Chinese", "name": "TestChar"}"#,
        ).unwrap();
        fs::write(
            mod_dir.join("text").join("zh").join("speech.json"),
            r#"[{"name": "hello", "text": "hi"}]"#,
        ).unwrap();

        let rm = ResourceManager::new_with_search_paths(vec![dir.clone()]);
        let info = rm.read_mod_from_path(mod_dir).unwrap();
        assert_eq!(info.manifest.id.as_ref(), "basic");
        assert_eq!(info.imgs.len(), 1);
        assert!(info.info.contains_key("zh"));
        assert!(info.get_state_by_name("idle").is_some());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_text_resources_empty_dir() {
        let dir = std::env::temp_dir().join("tbuddy_test_empty_text");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let (info, texts) = ResourceManager::load_text_resources(&dir);
        assert!(info.is_empty());
        assert!(texts.is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_text_resources_nonexistent() {
        let (info, texts) = ResourceManager::load_text_resources(Path::new("/nonexistent"));
        assert!(info.is_empty());
        assert!(texts.is_empty());
    }

    // ================================================================
    // rebuild_mod_index / version selection 测试
    // ================================================================

    #[test]
    fn rebuild_mod_index_picks_higher_version() {
        let dir1 = std::env::temp_dir().join("tbuddy_test_idx_v1");
        let dir2 = std::env::temp_dir().join("tbuddy_test_idx_v2");
        let _ = fs::remove_dir_all(&dir1);
        let _ = fs::remove_dir_all(&dir2);

        // dir1: version 1.0.0
        let m1 = dir1.join("mymod");
        fs::create_dir_all(&m1).unwrap();
        fs::write(m1.join("manifest.json"),
            r#"{"id": "mymod", "version": "1.0.0", "important_states": {}, "states": [], "triggers": []}"#,
        ).unwrap();

        // dir2: version 2.0.0
        let m2 = dir2.join("mymod");
        fs::create_dir_all(&m2).unwrap();
        fs::write(m2.join("manifest.json"),
            r#"{"id": "mymod", "version": "2.0.0", "important_states": {}, "states": [], "triggers": []}"#,
        ).unwrap();

        // search_paths 顺序: dir1 先, dir2 后 — dir1 优先级高
        // 但 dir2 版本更高，所以 dir2 应该被选中
        let mut rm = ResourceManager::new_with_search_paths(vec![dir1.clone(), dir2.clone()]);
        let mods = rm.list_mods();
        assert!(mods.contains(&"mymod".to_string()));

        let _ = fs::remove_dir_all(&dir1);
        let _ = fs::remove_dir_all(&dir2);
    }

    // ================================================================
    // get_all_states / get_all_triggers 含 mod 测试
    // ================================================================

    #[test]
    fn get_all_states_with_loaded_mod() {
        let mut rm = ResourceManager::new_with_search_paths(vec![]);
        let mut manifest = ModManifest::default();

        let mut idle = StateInfo::default();
        idle.name = "idle".into();
        idle.persistent = true;
        manifest.important_states.insert("idle".into(), idle);

        let mut hello = StateInfo::default();
        hello.name = "hello".into();
        manifest.states.push(hello);

        let mut info = build_test_mod_info(manifest);
        info.build_indices();
        rm.current_mod = Some(Arc::new(info));

        let states = rm.get_all_states();
        assert_eq!(states.len(), 2);
        let triggers = rm.get_all_triggers();
        assert!(triggers.is_empty());
    }

    #[test]
    fn query_proxies_with_loaded_mod() {
        let mut rm = ResourceManager::new_with_search_paths(vec![]);
        let mut manifest = ModManifest::default();
        manifest.default_audio_lang_id = "zh".into();
        manifest.default_text_lang_id = "zh".into();

        let mut s = StateInfo::default();
        s.name = "idle".into();
        manifest.states.push(s);

        let mut t = TriggerInfo::default();
        t.event = "click".into();
        manifest.triggers.push(t);

        let mut info = build_test_mod_info(manifest);
        info.imgs = vec![AssetInfo { name: "bg".into(), ..Default::default() }];
        info.build_indices();
        rm.current_mod = Some(Arc::new(info));

        assert!(rm.get_state_by_name("idle").is_some());
        assert!(rm.get_trigger_by_event("click").is_some());
        assert!(rm.get_asset_by_name("bg").is_some());
    }

    // ================================================================
    // get_bubble_style / load_default_bubble_style 测试
    // ================================================================

    #[test]
    fn get_bubble_style_returns_mod_style() {
        let mut rm = ResourceManager::new_with_search_paths(vec![]);
        let manifest = ModManifest::default();
        let mut info = build_test_mod_info(manifest);
        info.bubble_style = Some(serde_json::json!({"color": "red"}));
        info.build_indices();
        rm.current_mod = Some(Arc::new(info));

        let style = rm.get_bubble_style().unwrap();
        assert_eq!(style["color"], "red");
    }

    #[test]
    fn get_bubble_style_falls_back_to_default() {
        let dir = std::env::temp_dir().join("tbuddy_test_bubble_default");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("bubble_style.json"),
            r#"{"font": "sans-serif"}"#,
        ).unwrap();

        let mut rm = ResourceManager::new_with_search_paths(vec![dir.clone()]);
        let manifest = ModManifest::default();
        let mut info = build_test_mod_info(manifest);
        info.bubble_style = None;
        info.build_indices();
        rm.current_mod = Some(Arc::new(info));

        let style = rm.get_bubble_style().unwrap();
        assert_eq!(style["font"], "sans-serif");

        let _ = fs::remove_dir_all(&dir);
    }

    // ================================================================
    // unload_mod 测试
    // ================================================================

    #[test]
    fn unload_mod_clears_current() {
        let mut rm = ResourceManager::new_with_search_paths(vec![]);
        let manifest = ModManifest::default();
        let mut info = build_test_mod_info(manifest);
        info.build_indices();
        rm.current_mod = Some(Arc::new(info));
        assert!(rm.unload_mod());
        assert!(rm.current_mod.is_none());
        assert!(!rm.unload_mod());
    }

    // ================================================================
    // load_mod / read_mod_from_disk 测试
    // ================================================================

    #[test]
    fn load_mod_and_read_from_disk() {
        let dir = std::env::temp_dir().join("tbuddy_test_load_mod");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let mod_dir = dir.join("loadable");
        fs::create_dir_all(mod_dir.join("asset")).unwrap();
        fs::write(
            mod_dir.join("manifest.json"),
            r#"{"id": "loadable", "version": "0.1", "mod_type": "sequence", "important_states": {}, "states": [{"name":"idle","persistent":true,"can_trigger_states":[]}], "triggers": []}"#,
        ).unwrap();

        let mut rm = ResourceManager::new_with_search_paths(vec![dir.clone()]);

        // read_mod_from_disk
        let info = rm.read_mod_from_disk("loadable").unwrap();
        assert_eq!(info.manifest.id.as_ref(), "loadable");

        // load_mod
        let arc = rm.load_mod("loadable").unwrap();
        assert_eq!(arc.manifest.id.as_ref(), "loadable");
        assert!(rm.current_mod.is_some());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_mod_from_disk_not_found() {
        let mut rm = ResourceManager::new_with_search_paths(vec![]);
        let err = rm.read_mod_from_disk("nonexistent").unwrap_err();
        assert!(err.contains("not found"));
    }

    // ================================================================
    // load_multilang_resources 测试
    // ================================================================

    #[test]
    fn load_multilang_resources_reads_langs() {
        let dir = std::env::temp_dir().join("tbuddy_test_multilang");
        let _ = fs::remove_dir_all(&dir);
        let zh_dir = dir.join("zh");
        let en_dir = dir.join("en");
        fs::create_dir_all(&zh_dir).unwrap();
        fs::create_dir_all(&en_dir).unwrap();
        fs::write(zh_dir.join("speech.json"), r#"[{"name":"a","audio":"a.wav"}]"#).unwrap();
        fs::write(en_dir.join("speech.json"), r#"[{"name":"b","audio":"b.wav"}]"#).unwrap();

        let result = ResourceManager::load_multilang_resources::<AudioInfo>(&dir, "speech.json");
        assert_eq!(result.len(), 2);
        assert!(result.contains_key("zh"));
        assert!(result.contains_key("en"));

        let _ = fs::remove_dir_all(&dir);
    }

    // ================================================================
    // check_time_range / check_date_range 纯函数测试
    // ================================================================

    #[test]
    fn check_time_range_normal() {
        // 09:00 - 17:00, current 12:00 (720 min)
        assert!(StateInfo::check_time_range(720, "09:00", "17:00"));
        // boundary: exactly at start
        assert!(StateInfo::check_time_range(540, "09:00", "17:00"));
        // boundary: exactly at end (exclusive)
        assert!(!StateInfo::check_time_range(1020, "09:00", "17:00"));
        // before start
        assert!(!StateInfo::check_time_range(480, "09:00", "17:00"));
    }

    #[test]
    fn check_time_range_cross_midnight() {
        // 22:00 - 06:00
        assert!(StateInfo::check_time_range(1380, "22:00", "06:00")); // 23:00
        assert!(StateInfo::check_time_range(0, "22:00", "06:00"));    // 00:00
        assert!(StateInfo::check_time_range(300, "22:00", "06:00"));  // 05:00
        assert!(!StateInfo::check_time_range(360, "22:00", "06:00")); // 06:00 (exclusive)
        assert!(!StateInfo::check_time_range(720, "22:00", "06:00")); // 12:00
    }

    #[test]
    fn check_time_range_invalid_strings() {
        // invalid parse => start=0, end=MINUTES_PER_DAY => always true for valid current
        assert!(StateInfo::check_time_range(720, "abc", "xyz"));
        assert!(StateInfo::check_time_range(0, "", "17:00"));
    }

    #[test]
    fn check_time_range_same_start_end() {
        // start==end => range is empty => always false
        assert!(!StateInfo::check_time_range(540, "09:00", "09:00"));
        assert!(!StateInfo::check_time_range(0, "09:00", "09:00"));
    }

    #[test]
    fn check_date_range_normal() {
        // 03-01 to 06-30
        assert!(StateInfo::check_date_range(401, "03-01", "06-30")); // Apr 1
        assert!(StateInfo::check_date_range(301, "03-01", "06-30")); // boundary start
        assert!(StateInfo::check_date_range(630, "03-01", "06-30")); // boundary end (inclusive)
        assert!(!StateInfo::check_date_range(701, "03-01", "06-30")); // Jul 1
        assert!(!StateInfo::check_date_range(201, "03-01", "06-30")); // Feb 1
    }

    #[test]
    fn check_date_range_cross_year() {
        // 12-01 to 01-31
        assert!(StateInfo::check_date_range(1225, "12-01", "01-31")); // Dec 25
        assert!(StateInfo::check_date_range(115, "12-01", "01-31"));  // Jan 15
        assert!(!StateInfo::check_date_range(201, "12-01", "01-31")); // Feb 1
        assert!(!StateInfo::check_date_range(601, "12-01", "01-31")); // Jun 1
    }

    #[test]
    fn check_date_range_invalid_strings() {
        // invalid parse => start=0, end=DEFAULT_END_OF_YEAR => always true
        assert!(StateInfo::check_date_range(601, "abc", "xyz"));
    }

    #[test]
    fn check_date_range_same_start_end() {
        // same day => only that day is valid
        assert!(StateInfo::check_date_range(601, "06-01", "06-01"));
        assert!(!StateInfo::check_date_range(602, "06-01", "06-01"));
    }



    // ================================================================
    // is_time_valid / is_date_valid / is_enable 测试
    // ================================================================

    #[test]
    fn is_time_valid_empty_bounds() {
        let s = StateInfo::default();
        assert!(s.is_time_valid()); // empty start/end => always valid
    }

    #[test]
    fn is_time_valid_with_wide_range() {
        let mut s = StateInfo::default();
        s.time_start = "00:00".into();
        s.time_end = "23:59".into();
        // 当前时间一定在 00:00-23:59 范围内
        assert!(s.is_time_valid());
    }

    #[test]
    fn is_date_valid_empty_bounds() {
        let s = StateInfo::default();
        assert!(s.is_date_valid()); // empty start/end => always valid
    }

    #[test]
    fn is_date_valid_with_full_year_range() {
        let mut s = StateInfo::default();
        s.date_start = "01-01".into();
        s.date_end = "12-31".into();
        // 当前日期一定在 01-01 到 12-31 范围内
        assert!(s.is_date_valid());
    }

    // ================================================================
    // list_mod_summaries_fast (folder mod branch) 测试
    // ================================================================

    #[test]
    fn list_mod_summaries_fast_folder_mod() {
        let dir = std::env::temp_dir().join("tbuddy_test_summaries_fast");
        let _ = fs::remove_dir_all(&dir);

        let mod_dir = dir.join("fastmod");
        fs::create_dir_all(mod_dir.join("asset")).unwrap();
        fs::create_dir_all(mod_dir.join("text").join("zh")).unwrap();

        fs::write(
            mod_dir.join("manifest.json"),
            r#"{"id":"fastmod","version":"1.2.3","mod_type":"sequence","default_text_lang_id":"zh","important_states":{},"states":[],"triggers":[]}"#,
        ).unwrap();

        // icon and preview
        fs::write(mod_dir.join("icon.png"), b"fake_icon").unwrap();
        fs::write(mod_dir.join("preview.webp"), b"fake_preview").unwrap();

        // text/zh/info.json
        fs::write(
            mod_dir.join("text").join("zh").join("info.json"),
            r#"{"name":"TestChar","id":"zh"}"#,
        ).unwrap();

        let mut rm = ResourceManager::new_with_search_paths(vec![dir.clone()]);
        let summaries = rm.list_mod_summaries_fast();

        assert_eq!(summaries.len(), 1);
        let s = &summaries[0];
        assert_eq!(s.manifest.id.as_ref(), "fastmod");
        assert_eq!(s.manifest.version.as_ref(), "1.2.3");
        assert_eq!(s.icon_path.as_deref(), Some("icon.png"));
        assert_eq!(s.preview_path.as_deref(), Some("preview.webp"));
        assert!(s.info.contains_key("zh"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_mod_summaries_fast_folder_no_manifest() {
        let dir = std::env::temp_dir().join("tbuddy_test_summaries_no_manifest");
        let _ = fs::remove_dir_all(&dir);

        // folder without manifest.json
        let mod_dir = dir.join("bare_folder");
        fs::create_dir_all(&mod_dir).unwrap();

        let mut rm = ResourceManager::new_with_search_paths(vec![dir.clone()]);
        let summaries = rm.list_mod_summaries_fast();

        assert_eq!(summaries.len(), 1);
        // uses folder name as id
        assert_eq!(summaries[0].manifest.id.as_ref(), "bare_folder");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_mod_summaries_fast_with_icon_ico() {
        let dir = std::env::temp_dir().join("tbuddy_test_summaries_ico");
        let _ = fs::remove_dir_all(&dir);

        let mod_dir = dir.join("icomod");
        fs::create_dir_all(&mod_dir).unwrap();
        fs::write(
            mod_dir.join("manifest.json"),
            r#"{"id":"icomod","version":"1.0","important_states":{},"states":[],"triggers":[]}"#,
        ).unwrap();
        fs::write(mod_dir.join("icon.ico"), b"fake_ico").unwrap();
        fs::write(mod_dir.join("preview.jpg"), b"fake_jpg").unwrap();

        let mut rm = ResourceManager::new_with_search_paths(vec![dir.clone()]);
        let summaries = rm.list_mod_summaries_fast();
        assert_eq!(summaries[0].icon_path.as_deref(), Some("icon.ico"));
        assert_eq!(summaries[0].preview_path.as_deref(), Some("preview.jpg"));

        let _ = fs::remove_dir_all(&dir);
    }

    // ================================================================
    // load_mod_from_folder_path 测试
    // ================================================================

    #[test]
    fn load_mod_from_folder_path_works() {
        let dir = std::env::temp_dir().join("tbuddy_test_folder_load");
        let _ = fs::remove_dir_all(&dir);

        let mod_dir = dir.join("fmod");
        fs::create_dir_all(mod_dir.join("asset")).unwrap();
        fs::write(
            mod_dir.join("manifest.json"),
            r#"{"id":"fmod","version":"0.1","mod_type":"sequence","important_states":{},"states":[{"name":"idle","persistent":true,"can_trigger_states":[]}],"triggers":[]}"#,
        ).unwrap();

        let mut rm = ResourceManager::new_with_search_paths(vec![dir.clone()]);
        let arc = rm.load_mod_from_folder_path(mod_dir).unwrap();
        assert_eq!(arc.manifest.id.as_ref(), "fmod");
        assert!(rm.current_mod.is_some());

        let _ = fs::remove_dir_all(&dir);
    }

    // ================================================================
    // load_default_bubble_style 返回 None 测试
    // ================================================================

    #[test]
    fn load_default_bubble_style_returns_none() {
        let rm = ResourceManager::new_with_search_paths(vec![]);
        assert!(rm.load_default_bubble_style().is_none());
    }

    // ================================================================
    // resolve_mod_id / resolve_mod_path 测试
    // ================================================================

    #[test]
    fn resolve_mod_id_by_manifest_id() {
        let dir = std::env::temp_dir().join("tbuddy_test_resolve_id");
        let _ = fs::remove_dir_all(&dir);

        let mod_dir = dir.join("myfolder");
        fs::create_dir_all(&mod_dir).unwrap();
        fs::write(
            mod_dir.join("manifest.json"),
            r#"{"id":"real_id","version":"1.0","important_states":{},"states":[],"triggers":[]}"#,
        ).unwrap();

        let mut rm = ResourceManager::new_with_search_paths(vec![dir.clone()]);

        // by manifest id
        assert_eq!(rm.resolve_mod_id("real_id"), Some("real_id".to_string()));
        // by folder name
        assert_eq!(rm.resolve_mod_id("myfolder"), Some("real_id".to_string()));
        // unknown
        assert_eq!(rm.resolve_mod_id("unknown"), None);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_mod_path_public_works() {
        let dir = std::env::temp_dir().join("tbuddy_test_resolve_path");
        let _ = fs::remove_dir_all(&dir);

        let mod_dir = dir.join("pathmod");
        fs::create_dir_all(&mod_dir).unwrap();
        fs::write(
            mod_dir.join("manifest.json"),
            r#"{"id":"pathmod","version":"1.0","important_states":{},"states":[],"triggers":[]}"#,
        ).unwrap();

        let mut rm = ResourceManager::new_with_search_paths(vec![dir.clone()]);
        rm.rebuild_mod_index();

        let p = rm.resolve_mod_path_public("pathmod");
        assert!(p.is_some());

        let _ = fs::remove_dir_all(&dir);
    }

    // ================================================================
    // ModInfo 查询方法测试
    // ================================================================

    #[test]
    fn mod_info_get_audio_by_name_fallback_default_lang() {
        let mut rm = ResourceManager::new_with_search_paths(vec![]);
        let mut manifest = ModManifest::default();
        manifest.default_audio_lang_id = "zh".into();

        let mut info = build_test_mod_info(manifest);
        info.audios.insert(
            "zh".into(),
            vec![AudioInfo { name: "hello".into(), audio: "hello.wav".into(), ..Default::default() }],
        );
        info.build_indices();
        rm.current_mod = Some(Arc::new(info));

        // query with "en" falls back to "zh"
        assert!(rm.get_audio_by_name("en", "hello").is_some());
        assert_eq!(rm.get_audio_by_name("en", "hello").unwrap().audio.as_ref(), "hello.wav");
    }

    #[test]
    fn mod_info_get_text_by_name_fallback_default_lang() {
        let mut rm = ResourceManager::new_with_search_paths(vec![]);
        let mut manifest = ModManifest::default();
        manifest.default_text_lang_id = "zh".into();

        let mut info = build_test_mod_info(manifest);
        info.texts.insert(
            "zh".into(),
            vec![TextInfo { name: "greet".into(), ..Default::default() }],
        );
        info.build_indices();
        rm.current_mod = Some(Arc::new(info));

        // query with "en" falls back to "zh"
        assert!(rm.get_text_by_name("en", "greet").is_some());
    }

    #[test]
    fn mod_info_get_asset_by_name_sequence() {
        let mut rm = ResourceManager::new_with_search_paths(vec![]);
        let manifest = ModManifest::default();
        let mut info = build_test_mod_info(manifest);
        info.sequences = vec![AssetInfo { name: "walk".into(), sequence: true, ..Default::default() }];
        info.build_indices();
        rm.current_mod = Some(Arc::new(info));

        let a = rm.get_asset_by_name("walk").unwrap();
        assert!(a.sequence);
    }

    #[test]
    fn mod_info_to_summary() {
        let mut manifest = ModManifest::default();
        manifest.id = "summod".into();
        let mut info = build_test_mod_info(manifest);
        info.icon_path = Some("icon.png".into());
        info.preview_path = Some("preview.webp".into());
        info.build_indices();

        let summary = info.to_summary();
        assert_eq!(summary.manifest.id.as_ref(), "summod");
        assert_eq!(summary.icon_path.as_deref(), Some("icon.png"));
        assert_eq!(summary.preview_path.as_deref(), Some("preview.webp"));
    }

    // ================================================================
    // validate_and_fix_states 测试
    // ================================================================

    #[test]
    fn validate_and_fix_states_clamps_trigger_time() {
        use crate::modules::constants::MIN_TRIGGER_TIME_SECS;

        let mut manifest = ModManifest::default();

        // important_state with too-small trigger_time
        let mut imp = StateInfo::default();
        imp.name = "idle".into();
        imp.trigger_time = 0.5; // < MIN_TRIGGER_TIME_SECS
        manifest.important_states.insert("idle".into(), imp);

        // normal state with too-small trigger_time
        let mut s = StateInfo::default();
        s.name = "wave".into();
        s.trigger_time = 1.0;
        manifest.states.push(s);

        // normal state with 0 (disabled, should not be changed)
        let mut s2 = StateInfo::default();
        s2.name = "still".into();
        s2.trigger_time = 0.0;
        manifest.states.push(s2);

        let mut info = build_test_mod_info(manifest);
        info.validate_and_fix_states();

        assert_eq!(
            info.manifest.important_states.get("idle").unwrap().trigger_time,
            MIN_TRIGGER_TIME_SECS
        );
        assert_eq!(info.manifest.states[0].trigger_time, MIN_TRIGGER_TIME_SECS);
        assert_eq!(info.manifest.states[1].trigger_time, 0.0); // unchanged
    }

    #[test]
    fn validate_and_fix_states_no_change_when_valid() {
        let mut manifest = ModManifest::default();
        let mut s = StateInfo::default();
        s.name = "idle".into();
        s.trigger_time = 30.0;
        manifest.states.push(s);

        let mut info = build_test_mod_info(manifest);
        info.validate_and_fix_states();
        assert_eq!(info.manifest.states[0].trigger_time, 30.0);
    }

    // ================================================================
    // read_mod_from_path 边界测试
    // ================================================================

    #[test]
    fn read_mod_from_path_nonexistent() {
        let rm = ResourceManager::new_with_search_paths(vec![]);
        let err = rm.read_mod_from_path(PathBuf::from("/nonexistent_path_xxx")).unwrap_err();
        assert!(err.contains("does not exist"));
    }

    #[test]
    fn read_mod_from_path_not_dir() {
        let f = std::env::temp_dir().join("tbuddy_test_notdir.txt");
        fs::write(&f, "hello").unwrap();
        let rm = ResourceManager::new_with_search_paths(vec![]);
        let err = rm.read_mod_from_path(f.clone()).unwrap_err();
        assert!(err.contains("not a directory"));
        let _ = fs::remove_file(&f);
    }

    #[test]
    fn read_mod_from_path_no_manifest() {
        let dir = std::env::temp_dir().join("tbuddy_test_no_manifest_path");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let rm = ResourceManager::new_with_search_paths(vec![]);
        let err = rm.read_mod_from_path(dir.clone()).unwrap_err();
        assert!(err.contains("manifest"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_mod_from_path_with_live2d_type() {
        let dir = std::env::temp_dir().join("tbuddy_test_live2d_path");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("asset")).unwrap();
        fs::create_dir_all(dir.join("text").join("zh")).unwrap();

        fs::write(
            dir.join("manifest.json"),
            r#"{"id":"l2d","version":"1.0","mod_type":"live2d","important_states":{},"states":[],"triggers":[]}"#,
        ).unwrap();
        fs::write(
            dir.join("asset").join("live2d.json"),
            r#"{"schema_version":1,"model":{"name":"m"},"motions":[],"expressions":[],"states":[],"background_layers":[]}"#,
        ).unwrap();
        fs::write(
            dir.join("text").join("zh").join("info.json"),
            r#"{"name":"L2DChar","id":""}"#,
        ).unwrap();
        fs::write(
            dir.join("text").join("zh").join("speech.json"),
            r#"[{"name":"hi","text":"hello"}]"#,
        ).unwrap();

        let rm = ResourceManager::new_with_search_paths(vec![]);
        let info = rm.read_mod_from_path(dir.clone()).unwrap();
        assert!(info.live2d.is_some());
        assert_eq!(info.manifest.mod_type, ModType::Live2d);
        // info.json with empty id should be fixed
        assert!(info.info.contains_key("zh"));
        assert_eq!(info.info.get("zh").unwrap().id.as_ref(), "zh");
        assert!(info.texts.contains_key("zh"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_mod_from_path_with_pngremix_type() {
        let dir = std::env::temp_dir().join("tbuddy_test_pngremix_path");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("asset")).unwrap();

        fs::write(
            dir.join("manifest.json"),
            r#"{"id":"prmod","version":"1.0","mod_type":"pngremix","important_states":{},"states":[],"triggers":[]}"#,
        ).unwrap();
        fs::write(
            dir.join("asset").join("pngremix.json"),
            r#"{"schema_version":1,"model":{"name":"m","pngremix_file":"t.pngRemix"},"features":{},"expressions":[],"motions":[],"states":[]}"#,
        ).unwrap();

        let rm = ResourceManager::new_with_search_paths(vec![]);
        let info = rm.read_mod_from_path(dir.clone()).unwrap();
        assert!(info.pngremix.is_some());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_mod_from_path_with_3d_type() {
        let dir = std::env::temp_dir().join("tbuddy_test_3d_path");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("asset")).unwrap();

        fs::write(
            dir.join("manifest.json"),
            r#"{"id":"tdmod","version":"1.0","mod_type":"3d","important_states":{},"states":[],"triggers":[]}"#,
        ).unwrap();
        fs::write(
            dir.join("asset").join("3d.json"),
            r#"{"schema_version":1,"model":{"name":"m","file":"m.vrm"},"animations":[],"states":[]}"#,
        ).unwrap();

        let rm = ResourceManager::new_with_search_paths(vec![]);
        let info = rm.read_mod_from_path(dir.clone()).unwrap();
        assert!(info.threed.is_some());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_mod_from_path_icon_and_preview_detection() {
        let dir = std::env::temp_dir().join("tbuddy_test_icon_detect");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        fs::write(
            dir.join("manifest.json"),
            r#"{"id":"iconmod","version":"1.0","important_states":{},"states":[],"triggers":[]}"#,
        ).unwrap();
        fs::write(dir.join("icon.ico"), b"ico").unwrap();
        fs::write(dir.join("preview.jpeg"), b"jpeg").unwrap();

        let rm = ResourceManager::new_with_search_paths(vec![]);
        let info = rm.read_mod_from_path(dir.clone()).unwrap();
        assert_eq!(info.icon_path.as_deref(), Some("icon.ico"));
        assert_eq!(info.preview_path.as_deref(), Some("preview.jpeg"));

        let _ = fs::remove_dir_all(&dir);
    }

    // ================================================================
    // rebuild_mod_index 边界测试
    // ================================================================

    #[test]
    fn rebuild_mod_index_invalid_search_path() {
        let mut rm = ResourceManager::new_with_search_paths(vec![PathBuf::from("/nonexistent_xxx")]);
        rm.rebuild_mod_index();
        assert!(rm.mod_index.is_empty());
    }

    #[test]
    fn rebuild_mod_index_folder_no_manifest_uses_folder_name() {
        let dir = std::env::temp_dir().join("tbuddy_test_rebuild_bare");
        let _ = fs::remove_dir_all(&dir);
        let mod_dir = dir.join("barefolder");
        fs::create_dir_all(&mod_dir).unwrap();

        let mut rm = ResourceManager::new_with_search_paths(vec![dir.clone()]);
        rm.rebuild_mod_index();

        assert!(rm.mod_index.contains_key("barefolder"));
        assert!(rm.folder_to_id.contains_key("barefolder"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rebuild_mod_index_same_id_lower_version_skipped() {
        let dir1 = std::env::temp_dir().join("tbuddy_test_skip_v1");
        let dir2 = std::env::temp_dir().join("tbuddy_test_skip_v2");
        let _ = fs::remove_dir_all(&dir1);
        let _ = fs::remove_dir_all(&dir2);

        // dir1: higher priority, version 2.0.0
        let m1 = dir1.join("dup");
        fs::create_dir_all(&m1).unwrap();
        fs::write(m1.join("manifest.json"),
            r#"{"id":"dup","version":"2.0.0","important_states":{},"states":[],"triggers":[]}"#,
        ).unwrap();

        // dir2: lower priority, version 1.0.0 (should be skipped)
        let m2 = dir2.join("dup");
        fs::create_dir_all(&m2).unwrap();
        fs::write(m2.join("manifest.json"),
            r#"{"id":"dup","version":"1.0.0","important_states":{},"states":[],"triggers":[]}"#,
        ).unwrap();

        let mut rm = ResourceManager::new_with_search_paths(vec![dir1.clone(), dir2.clone()]);
        rm.rebuild_mod_index();

        let locator = rm.mod_index.get("dup").unwrap();
        assert_eq!(locator.version, "2.0.0");

        let _ = fs::remove_dir_all(&dir1);
        let _ = fs::remove_dir_all(&dir2);
    }

    // ================================================================
    // set_archive_store 测试
    // ================================================================

    #[test]
    fn set_archive_store_and_get() {
        let mut rm = ResourceManager::new_with_search_paths(vec![]);
        assert!(rm.get_archive_store().is_none());

        let store = Arc::new(std::sync::Mutex::new(crate::modules::mod_archive::ModArchiveStore::new()));
        rm.set_archive_store(store);
        assert!(rm.get_archive_store().is_some());
    }

    // ================================================================
    // build_indices 高级测试
    // ================================================================

    #[test]
    fn build_indices_comprehensive() {
        let mut manifest = ModManifest::default();

        let mut s1 = StateInfo::default();
        s1.name = "idle".into();
        manifest.states.push(s1);

        let mut t1 = TriggerInfo::default();
        t1.event = "click".into();
        manifest.triggers.push(t1);

        let mut info = build_test_mod_info(manifest);
        info.imgs = vec![AssetInfo { name: "bg".into(), ..Default::default() }];
        info.sequences = vec![AssetInfo { name: "walk".into(), sequence: true, ..Default::default() }];
        info.audios.insert("zh".into(), vec![
            AudioInfo { name: "hi".into(), audio: "hi.wav".into(), ..Default::default() },
        ]);
        info.texts.insert("zh".into(), vec![
            TextInfo { name: "greet".into(), ..Default::default() },
        ]);
        info.build_indices();

        assert!(info.get_state_by_name("idle").is_some());
        assert!(info.get_trigger_by_event("click").is_some());
        assert!(info.get_asset_by_name("bg").is_some());
        assert!(info.get_asset_by_name("walk").is_some());
        assert!(info.get_audio_by_name("zh", "hi").is_some());
        assert!(info.get_text_by_name("zh", "greet").is_some());
    }

    // ================================================================
    // load_text_resources 更多路径
    // ================================================================

    #[test]
    fn load_text_resources_fixes_empty_id() {
        let dir = std::env::temp_dir().join("tbuddy_test_text_fix_id");
        let _ = fs::remove_dir_all(&dir);
        let zh_dir = dir.join("en");
        fs::create_dir_all(&zh_dir).unwrap();
        fs::write(zh_dir.join("info.json"), r#"{"name":"Char","id":""}"#).unwrap();
        fs::write(zh_dir.join("speech.json"), r#"[{"name":"a"}]"#).unwrap();

        let (info, texts) = ResourceManager::load_text_resources(&dir);
        // empty id should be replaced with lang key
        assert_eq!(info.get("en").unwrap().id.as_ref(), "en");
        assert_eq!(texts.get("en").unwrap().len(), 1);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_text_resources_fixes_error_id() {
        let dir = std::env::temp_dir().join("tbuddy_test_text_fix_error_id");
        let _ = fs::remove_dir_all(&dir);
        let ja_dir = dir.join("ja");
        fs::create_dir_all(&ja_dir).unwrap();
        fs::write(ja_dir.join("info.json"), r#"{"name":"Char","id":"ERROR"}"#).unwrap();

        let (info, _) = ResourceManager::load_text_resources(&dir);
        assert_eq!(info.get("ja").unwrap().id.as_ref(), "ja");

        let _ = fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
pub(crate) fn build_test_mod_info(manifest: ModManifest) -> ModInfo {
    ModInfo {
        path: std::path::PathBuf::from("test_mod"),
        manifest,
        imgs: Vec::new(),
        sequences: Vec::new(),
        live2d: None,
        pngremix: None,
        threed: None,
        audios: HashMap::new(),
        texts: HashMap::new(),
        info: HashMap::new(),
        bubble_style: None,
        ai_tools: None,
        icon_path: None,
        preview_path: None,
        state_index: HashMap::new(),
        trigger_index: HashMap::new(),
        asset_index: HashMap::new(),
        audio_index: HashMap::new(),
        text_index: HashMap::new(),
    }
}


