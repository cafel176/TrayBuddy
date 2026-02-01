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
 * 状态信息接口
 *
 * 对应后端 Rust 的 `StateInfo` 结构体。
 * 描述角色的一个状态及其关联资源。
 */
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
  /** 可触发的状态列表 */
  can_trigger_states?: string[];

  /** 进入该状态时对当前 Mod 数据计数器执行操作（可选） */
  mod_data_counter?: ModDataCounterConfig;

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
  /** 可触发的状态名称列表 */
  states: string[];
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
  /** 是否显示桌面角色 */
  show_character: boolean;
  /** 是否显示边框装饰 */
  show_border: boolean;
  /** 动画窗口缩放比例（0.5 - 2.0） */
  animation_scale: number;
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
