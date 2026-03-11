/**
 * 共享类型定义 - 资产相关接口
 *
 * 该文件定义了前端与后端共享的数据结构接口，确保前后端数据一致性。
 * 这些接口与后端 Rust 中的结构体一一对应。
 */

// ============================================================================
// 资产相关接口
// ============================================================================

/**
 * 资产信息接口
 *
 * 对应后端 Rust 的 `AssetInfo` 结构体。
 * 描述一个动画资产的所有属性，包括图片路径、帧布局、播放参数等。
 */
export interface AssetInfo {
  /** 资产名称（如 "idle", "border"） */
  name: string;
  /** 图片文件名（如 "idle.png"） */
  img: string;
  /** 是否为序列帧动画（false 表示静态图） */
  sequence: boolean;
  /** 原始帧序是否为反向排列 */
  origin_reverse: boolean;
  /** 是否需要往返播放（正向播完后反向播放） */
  need_reverse: boolean;
  /** 每帧播放间隔（秒） */
  frame_time: number;
  /** 单帧宽度（像素） */
  frame_size_x: number;
  /** 单帧高度（像素） */
  frame_size_y: number;
  /** X 轴帧数（精灵图的列数） */
  frame_num_x: number;
  /** Y 轴帧数（精灵图的行数） */
  frame_num_y: number;
  /** 渲染时的 X 偏移（像素） */
  offset_x: number;
  /** 渲染时的 Y 偏移（像素） */
  offset_y: number;
}

/** Mod 类型（sequence/live2d/pngremix/3d）。 */
export type ModType = "sequence" | "live2d" | "pngremix" | "3d";


// ============================================================================
// PngRemix 相关接口
// ============================================================================

/** PngRemix 模型配置。 */
export interface PngRemixModelConfig {
  name: string;
  pngremix_file: string;
  default_state_index: number;
  /** 模型整体缩放（窗口预览用，避免模型过大超出画布） */
  scale: number;
  max_fps: number;

  /**
   * 贴图解码分辨率封顶（像素）。
   *
   * 逻辑尺寸仍以原图为准，但实际解码出的像素会被缩小到不超过该值，
   * 渲染时再按逻辑尺寸放大，以降低运行时内存占用。
   * - <= 0：禁用封顶
   * - 未设置：默认 4096（只对超大贴图生效）
   */
  texture_decode_max_dim?: number;

  /**
   * 贴图解码额外降采样倍率（0-1）。
   *
   * 例如 0.5 表示在封顶前先按一半分辨率解码；
   * 渲染时仍按原图逻辑尺寸放大。
   * - <= 0：视为 1
   */
  texture_decode_scale?: number;
}


/** PngRemix 动画特性配置。 */
export interface PngRemixFeatures {
  mouse_follow: boolean;
  auto_blink: boolean;
  click_bounce: boolean;
  click_bounce_amp: number;
  click_bounce_duration: number;
  blink_speed: number;
  blink_chance: number;
  blink_hold_ratio: number;
}

/** PngRemix 表情条目。 */
export interface PngRemixExpression {
  name: string;
  state_index: number;
}

/** PngRemix 动作条目。 */
export interface PngRemixMotion {
  name: string;
  hotkey: string;
  description: string;
}

/** PngRemix 状态映射条目。 */
export interface PngRemixState {
  state: string;
  expression: string;
  motion: string;


  /**
   * 口型状态（对齐 PNGTuber Remix 的 Mouth enum）：
   * - 0 = Closed（闭嘴）
   * - 1 = Open（张嘴）
   * - 2 = Screaming（大叫/张嘴）
   *
   * 渲染阶段以 `mouthState !== 0` 作为"张嘴中"判定，
   * 驱动模型中 `should_talk/open_mouth` 口型层的显示。
   */
  mouth_state?: 0 | 1 | 2;

  scale: number;
  offset_x: number;
  offset_y: number;
}



/** PngRemix 配置汇总。 */
export interface PngRemixConfig {

  schema_version: number;
  model: PngRemixModelConfig;
  features: PngRemixFeatures;
  expressions: PngRemixExpression[];
  motions: PngRemixMotion[];
  states: PngRemixState[];
}

/** PngRemix 参数覆写（由状态触发）。 */
export interface PngRemixParameterSetting {

  /** 参数类型："expression" 切换表情，"motion" 触发动作 */
  type: "expression" | "motion";
  /** 表情名或动作名 */
  name: string;
}

/** Live2D 模型配置。 */
export interface Live2DModelConfig {

  name: string;
  base_dir: string;
  model_json: string;
  textures_dir: string;
  motions_dir: string;
  expressions_dir: string;
  physics_json: string;
  pose_json: string;
  breath_json: string;
  /** 模型整体缩放（窗口预览用，避免模型过大超出窗口） */
  scale: number;
  eye_blink: boolean;
  lip_sync: boolean;
}

/** Live2D 动作配置。 */
export interface Live2DMotion {

  name: string;
  file: string;
  group: string;
  priority: string;
  fade_in_ms: number;
  fade_out_ms: number;
  loop: boolean;
}

/** Live2D 表情配置。 */
export interface Live2DExpression {

  name: string;
  file: string;
}

/** Live2D 状态映射配置。 */
export interface Live2DState {

  state: string;
  motion: string;
  expression: string;
  scale: number;
  offset_x: number;
  offset_y: number;
}

/** Live2D 背景/叠加层配置（合并了原 resources 的功能）。 */
export interface Live2DBackgroundLayer {
  name: string;
  file: string;
  /** 渲染层级：behind=模型后面(背景) | front=模型前面(叠加) */
  layer: string;
  scale: number;
  offset_x: number;
  offset_y: number;
  /** 关联事件名列表（如 "keydown:KeyA"）；留空则常驻显示 */
  events: string[];
  /** 触发时播放的音效名称（对应 `audio/<lang>/speech.json` 的 `name`；空字符串表示不播放） */
  audio: string;
  /** 目录（可选，用于工具侧分组/筛选） */
  dir: string;
}

/** Live2D 配置汇总。 */
export interface Live2DConfig {

  schema_version: number;
  model: Live2DModelConfig;
  motions: Live2DMotion[];
  expressions: Live2DExpression[];
  states: Live2DState[];
  background_layers: Live2DBackgroundLayer[];
}

// ============================================================================
// 3D 相关接口
// ============================================================================

/** 3D 模型类型（VRM/PMX）。 */
export type ThreeDModelType = "vrm" | "pmx";
/** 3D 动画类型（VRMA/VMD）。 */
export type ThreeDAnimationType = "vrma" | "vmd";


export interface ThreeDModelConfig {
  name: string;
  type: ThreeDModelType;
  file: string;
  scale: number;
  offset_x: number;
  offset_y: number;
  texture_base_dir: string;
  animation_base_dir: string;
}

/** 3D 动画条目。 */
export interface ThreeDAnimation {

  name: string;
  type: ThreeDAnimationType;

  /** 动画文件路径（animation_base_dir 非空时为相对路径，否则为相对 mod 根目录的完整路径） */
  file: string;

  /** 播放倍速 */
  speed: number;

  /** 动画采样 FPS（默认 60） */
  fps: number;
}

/** 3D 状态映射条目。 */
export interface ThreeDState {

  state: string;
  animation: string;
  scale: number;
  offset_x: number;
  offset_y: number;
}

/** 3D 配置汇总。 */
export interface ThreeDConfig {

  schema_version: number;
  model: ThreeDModelConfig;
  animations: ThreeDAnimation[];
  states: ThreeDState[];
}


/**
 * 动画配置接口
 *
 * 前端动画播放器使用的配置格式。
 * 由 `buildAnimationConfig` 函数从 `AssetInfo` 转换而来。
 */
export interface AnimationConfig {
  /** X 轴帧数（列数） */
  frameCountX: number;
  /** Y 轴帧数（行数） */
  frameCountY: number;
  /** 单帧宽度（像素） */
  frameWidth: number;
  /** 单帧高度（像素） */
  frameHeight: number;
  /** 帧间隔时间（毫秒） */
  frameTime: number;
  /** 图片 URL（经过 convertFileSrc 转换） */
  imgSrc: string;
  /** 是否为序列帧动画 */
  sequence: boolean;
  /** 原始帧序是否为反向 */
  originReverse: boolean;
  /** 是否需要往返播放 */
  needReverse: boolean;
  /** X 轴渲染偏移 */
  offsetX: number;
  /** Y 轴渲染偏移 */
  offsetY: number;
}

// ============================================================================
// 音频相关接口
// ============================================================================

/**
 * 音频信息接口
 *
 * 对应后端 Rust 的 `AudioInfo` 结构体。
 */
export interface AudioInfo {
  /** 音频名称（如 "morning", "click"） */
  name: string;
  /** 音频文件名（如 "morning.wav"） */
  audio: string;
}

// ============================================================================
// 状态相关接口
// ============================================================================

/**
 * 分支信息接口
 * 
 * 对应后端 Rust 的 `BranchInfo` 结构体。
 * 用于对话分支选择。
 */
export interface BranchInfo {
  /** 分支显示文本 */
  text: string;
  /** 选择后跳转的状态名 */
  next_state: string;
}

/**
 * Mod 数据计数操作类型
 *
 * 对应后端 Rust 的 `ModDataCounterOp`。
 */
export type ModDataCounterOp = "add" | "sub" | "mul" | "div" | "set";

/**
 * Mod 数据计数配置
 *
 * 对应后端 Rust 的 `ModDataCounterConfig`。
 */
export interface ModDataCounterConfig {
  /** 操作类型 */
  op: ModDataCounterOp;
  /** 操作数（或 set 时的目标值） */
  value: number;
}

/**
 * Live2D 参数设置项
 *
 * 对应后端 Rust 的 `Live2DParameterSetting`。
 * 进入某个状态时覆写 Live2D 模型参数。
 */
export interface Live2DParameterSetting {
  /** Live2D 参数 ID（如 "ParamAngleX", "ParamEyeLOpen"）或部件 ID（如 "PartArmA"） */
  id: string;
  /** 目标值 */
  value: number;
  /** 目标类型："Parameter"（默认）设置参数值，"PartOpacity" 设置部件透明度 */
  target?: "Parameter" | "PartOpacity";
}

/**
 * 状态信息接口
 *
 * 对应后端 Rust 的 `StateInfo` 结构体。
 * 描述角色的一个状态及其关联资源。
 */
export interface CanTriggerState {
  /** 子状态名 */
  state: string;
  /** 权重（正整数；概率 = weight / sum(weight)） */
  weight: number;
}

export interface StateInfo {
  /** 状态名称（如 "idle", "morning"） */
  name: string;
  /** 是否为持久状态（false 表示临时状态） */
  persistent: boolean;
  /** 关联的动画资产名称 */
  anima: string;
  /** 关联的音频名称 */
  audio: string;
  /** 关联的文本名称 */
  text: string;
  /** 状态优先级（数值越大优先级越高） */
  priority: number;
  /** 日期范围起始 (MM-DD) */
  date_start?: string;
  /** 日期范围结束 (MM-DD) */
  date_end?: string;
  /** 时间范围起始 (HH:MM) */
  time_start?: string;
  /** 时间范围结束 (HH:MM) */
  time_end?: string;
  /** 播放完成后跳转的状态名 */
  next_state?: string;
  /** 定时触发间隔 (秒) */
  trigger_time?: number;
  /** 定时触发概率 (0.0 - 1.0) */
  trigger_rate?: number;
  /** 可触发的状态列表（加权随机） */
  can_trigger_states?: CanTriggerState[];

  /** 触发计数范围起点（包含） */
  trigger_counter_start?: number;
  /** 触发计数范围终点（包含） */
  trigger_counter_end?: number;

  /** 气温触发范围起点（包含，单位：°C） */
  trigger_temp_start?: number;
  /** 气温触发范围终点（包含，单位：°C） */
  trigger_temp_end?: number;

  /** 启动时长触发门槛（分钟；0 表示不限制） */
  trigger_uptime?: number;

  /** 天气触发条件（数组任意匹配；空数组表示不限制） */
  trigger_weather?: string[];

  /** 进入该状态时对当前 Mod 数据计数器执行操作（可选） */
  mod_data_counter?: ModDataCounterConfig;

  /** Live2D 参数覆写（仅 live2d 类型 Mod 有效） */
  live2d_params?: Live2DParameterSetting[];

  /** PngRemix 参数覆写（仅 pngremix 类型 Mod 有效） */
  pngremix_params?: PngRemixParameterSetting[];

  /** 是否显示对话分支气泡 UI（默认 true） */
  branch_show_bubble?: boolean;

  /** 对话分支选项 */
  branch?: BranchInfo[];

}


/**
 * 状态变化事件数据
 * 
 * 用于前端状态切换事件的载荷。
 */
export interface StateChangeEvent {
  /** 新的状态信息 */
  state: StateInfo;
  /** 是否只播放一次 */
  play_once: boolean;
}

// ============================================================================
// 触发器相关接口
// ============================================================================

/**
 * 触发条件状态组
 * 
 * 对应后端 Rust 的 `TriggerStateGroup` 结构体。
 * 定义在特定持久状态下可触发的状态列表。
 */
export interface TriggerStateGroup {
  /** 持久状态名称，为空字符串时表示任意持久状态都可触发 */
  persistent_state: string;
  /** 可触发的状态列表（加权随机） */
  states: CanTriggerState[];
  /** 是否允许重复触发（默认 true） */
  allow_repeat?: boolean;
}



/**
 * 触发器信息接口
 * 
 * 对应后端 Rust 的 `TriggerInfo` 结构体。
 */
export interface TriggerInfo {
  /** 触发事件名称 */
  event: string;
  /** 可触发的状态组列表（按持久状态分组） */
  can_trigger_states: TriggerStateGroup[];
}

// ============================================================================
// 角色/边框配置接口
// ============================================================================

/**
 * 角色渲染配置
 * 
 * 对应后端 Rust 的 `CharacterConfig` 结构体。
 */
export interface CharacterConfig {
  /** z-index 偏移值 */
  z_offset: number;

  /**
   * 角色 Canvas 显示适配偏好：
   * - long: 优先适配长边（完整显示）
   * - short: 优先适配短边（尽量填满，可能裁切）
   */
  canvas_fit_preference?: "long" | "short" | "legacy";
}

/**
 * 边框配置
 * 
 * 对应后端 Rust 的 `BorderConfig` 结构体。
 */
export interface BorderConfig {
  /** 边框动画资产名称 */
  anima: string;
  /** 是否启用边框 */
  enable: boolean;
  /** z-index 偏移值 */
  z_offset: number;
}

// ============================================================================
// 用户设置接口
// ============================================================================

/**
 * 用户设置接口
 *
 * 对应后端 Rust 的 `UserSettings` 结构体。
 * 包含所有可由用户自定义的应用配置项。
 */
export interface UserSettings {
  /** 用户昵称 */
  nickname: string;
  /** 用户生日（格式: "MM-DD"） */
  birthday: string;
  /** 界面/语音语言代码（如 "zh", "en", "jp"） */
  lang: string;
  /** 是否开机自启动 */
  auto_start: boolean;
  /** 是否启用静音模式 */
  no_audio_mode: boolean;
  /** 音量（0.0 - 1.0） */
  volume: number;
  /** 是否启用免打扰模式 */
  silence_mode: boolean;
  /** 全屏时是否自动进入免打扰 */
  auto_silence_when_fullscreen: boolean;
  /** 是否启用主播模式（窗口捕捉兼容：关闭 skip_taskbar） */
  streamer_mode: boolean;
  /** 是否显示桌面角色 */
  show_character: boolean;

  /** 是否显示边框装饰 */
  show_border: boolean;
  /** 动画窗口缩放比例（0.5 - 2.0） */
  animation_scale: number;

  /** Live2D 鼠标跟随 */
  live2d_mouse_follow: boolean;
  /** Live2D 自动交互 */
  live2d_auto_interact: boolean;

  /** 3D 动画切换过渡时长（秒） */
  threed_cross_fade_duration: number;

  /** AI API Key */
  ai_api_key: string;
  /** AI 识别 API Base URL（兼容 OpenAI 的 chat/completions 端点） */
  ai_chat_base_url: string;
  /** AI 图像识别/理解模型（用于 chat completions + vision） */
  ai_chat_model: string;
  /** AI 截图频率（秒） */
  ai_screenshot_interval: number;
  /** 启动 AI 主动工具的快捷键 (F1-F12) */
  ai_tool_hotkey: string;

}

/**
 * 每个 Mod 的独立数据
 *
 * 对应后端 Rust 的 `ModData` 结构体。
 */
export interface ModData {
  /** Mod ID（使用 manifest.json 的 id 作为唯一标识） */
  mod_id: string;
  /** 一个整型变量（可由 Mod/前端自由定义语义） */
  value: number;
}

/**
 * 用户基础信息
 * 
 * 对应后端 Rust 的 `UserInfo` 结构体。
 */
export interface UserInfo {
  /** 第一次启动的时间戳 */
  first_login: number | null;
  /** 最后一次启动的时间戳 */
  last_login: number | null;

  /** 上次关闭前加载的 Mod ID（manifest.json 的 id） */
  current_mod: string;

  /** animation 窗口上次关闭时的 X 坐标 */
  animation_window_x: number | null;
  /** animation 窗口上次关闭时的 Y 坐标 */
  animation_window_y: number | null;

  /** 总启动次数 */
  launch_count: number;
  /** 累计使用时长（秒） */
  total_usage_seconds: number;
  /** 总点击次数 */
  total_click_count: number;

  /** 各 Mod 的持久化数据（key = manifest.id） */
  mod_data: Record<string, ModData>;
}

/**
 * 日期时间信息
 * 
 * 对应后端 Rust 的 `DateTimeInfo` 结构体。
 */
export interface DateTimeInfo {
  /** 年 */
  year: number;
  /** 月 (1-12) */
  month: number;
  /** 日 (1-31) */
  day: number;
  /** 时 (0-23) */
  hour: number;
  /** 分 (0-59) */
  minute: number;
  /** 秒 (0-59) */
  second: number;
  /** 星期几 (0=周日, 1=周一, ..., 6=周六) */
  weekday: number;
  /** Unix 时间戳 (秒) */
  timestamp: number;
}

// ============================================================================
// Mod 清单与信息接口
// ============================================================================

/**
 * Mod 清单接口
 *
 * 对应后端 Rust 的 `ModManifest` 结构体。
 * 包含 Mod 的元信息和配置，字段按使用场景可选。
 */
export interface ModManifest {
  /** Mod 唯一标识 */
  id: string;
  /** Mod 版本号 */
  version: string;
  /** Mod 作者 */
  author: string;
  /** Mod 类型 */
  mod_type?: ModType;
  /** 默认音频语言 ID */
  default_audio_lang_id: string;
  /** 默认文本语言 ID */
  default_text_lang_id: string;
  /** 角色渲染配置 */
  character: CharacterConfig;
  /** 边框配置 */
  border: BorderConfig;
  /** 是否显示 Mod 数据面板 */
  show_mod_data_panel: boolean;
  /** Mod 数据计数器默认值 */
  mod_data_default_int: number;
  /** 是否启用贴图降采样 */
  enable_texture_downsample: boolean;
  /** 贴图降采样起始维度 */
  texture_downsample_start_dim: number;
  /** 是否启用全局键盘监听 */
  global_keyboard: boolean;
  /** 是否启用全局鼠标监听 */
  global_mouse: boolean;

  /**
   * PngRemix 专用：鼠标跟随幅度缩放（仅影响 follow 相关：pos/rot/scale/animate_to_mouse 的范围）。
   * - 1.0：默认（不缩放）
   * - <1.0：减小跟随幅度
   * - >1.0：增大跟随幅度
   */
  pngremix_follow_amp_scale?: number;

  /**
   * PngRemix 专用：摆动/晃动幅度缩放（仅影响 motion 相关：xAmp/yAmp、wiggle_amp、stretchAmount、rdragStr 等）。
   * - 1.0：默认（不缩放）
   * - <1.0：减小摆动幅度
   * - >1.0：增大摆动幅度
   */
  pngremix_motion_amp_scale?: number;

  /**
   * PngRemix 专用：摆动/晃动频率缩放（仅影响 motion 相关：xFrq/yFrq、wiggle_freq、rot_frq 等）。
   * - 1.0：默认（不缩放）
   * - <1.0：降低摆动频率（更慢）
   * - >1.0：提高摆动频率（更快）
   */
  pngremix_motion_frq_scale?: number;

  /** 重要状态映射 */
  important_states: Record<string, StateInfo>;
  /** 所有状态列表 */
  states: StateInfo[];
  /** 所有触发器列表 */
  triggers: TriggerInfo[];
}

/**
 * 文本信息接口
 *
 * 对应后端 Mod 的文本条目。
 */
export interface TextInfo {
  /** 文本名称 */
  name: string;
  /** 文本内容 */
  text: string;
  /** 显示时长 */
  duration: number;
}

/**
 * 角色本地化信息
 *
 * 对应后端 Mod 的 info.json 条目。
 */
export interface CharacterInfo {
  /** 角色名称 */
  name: string;
  /** 语言代码 */
  lang: string;
  /** 角色 ID */
  id?: string;
  /** 角色描述 */
  description: string;
}

// ========================================================================= //
// AI Tools 配置（与后端 `resource.rs` 序列化字段对齐）
// ========================================================================= //

/** AI 工具截取矩形区域 */
export interface AiCaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** AI 工具触发映射：关键词 → 触发器名称 */
export interface AiToolTrigger {
  /** AI 识别结果中的关键词 */
  keyword: string;
  /** 匹配后要触发的 trigger name（对应 manifest 中的触发器事件名） */
  trigger: string;
}

/** AI 返回结果二次处理器（ai_tools.json 的 result_processors） */
export interface AiResultProcessor {
  /** 处理类型：number/keyword/regex（或未来扩展） */
  type: "number" | "keyword" | "regex" | string;
  /** 匹配成功后输出的结果字符串 */
  result: string;
  /** 数值型最小阈值（含），仅 number 有意义 */
  min?: number;
  /** 数值型最大阈值（含），仅 number 有意义 */
  max?: number;
  /** keyword/regex 的匹配模式 */
  pattern?: string;
}

/** 单个 AI 小工具配置（对应 ai_tools.json -> tool_data[]） */
export interface AiToolData {
  /** 工具名称 */
  name: string;
  /** 是否自动启动 */
  auto_start: boolean;
  /**
   * 工具类型。
   * 注意：后端/配置文件字段名为 `type`（不是 tool_type）。
   */
  type: "manual" | "auto";
  /** 兼容历史字段：tool_type */
  tool_type?: "manual" | "auto";
  /** 屏幕截取矩形区域 */
  capture_rect: AiCaptureRect;
  /** 提示词组 */
  prompts: string[];
  /** AI 返回结果二次处理器列表（可选） */
  result_processors?: AiResultProcessor[];
  /** 关键词 → 触发器映射列表 */
  triggers: AiToolTrigger[];
  /** 是否显示信息窗口 */
  show_info_window: boolean;
}

/** 单个窗口名的 AI 工具配置（对应 ai_tools.json 的一项） */
export interface AiToolProcess {
  /** 窗口名（用于与焦点窗口标题做匹配） */
  window_name: string;
  /** 兼容历史字段：process_name */
  process_name?: string;
  /** AI 小工具列表 */
  tool_data: AiToolData[];
}

/** AI 工具配置文件顶层结构 */
export interface AiToolsConfig {
  /** AI 工具列表（每项对应一个窗口名） */
  ai_tools: AiToolProcess[];
}


/**
 * Mod 完整信息接口
 *
 * 对应后端 load_mod / get_mod_info 返回的完整 Mod 数据。
 */
export interface ModInfo {
  /** Mod 文件系统路径 */
  path: string;
  /** 气泡样式配置（后端从 bubble_style.json 读取并透传 JSON；不存在则为 null/undefined） */
  bubble_style?: Record<string, any> | null;
  /** AI 工具配置（从 ai_tools.json 加载） */
  ai_tools?: AiToolsConfig | null;
  /** 图标路径 */
  icon_path?: string | null;
  /** 预览图路径 */
  preview_path?: string | null;
  /** Mod 清单 */
  manifest: ModManifest;
  /** 静态图资产列表 */
  imgs: AssetInfo[];
  /** 序列帧资产列表 */
  sequences: AssetInfo[];
  /** Live2D 配置 */
  live2d?: Live2DConfig;
  /** PngRemix 配置 */
  pngremix?: PngRemixConfig;
  /** 3D 配置 */
  threed?: ThreeDConfig;
  /** 音频资源（按语言分组） */
  audios: Record<string, AudioInfo[]>;
  /** 文本资源（按语言分组） */
  texts: Record<string, TextInfo[]>;
  /** 角色信息（按语言分组） */
  info: Record<string, CharacterInfo>;
}

