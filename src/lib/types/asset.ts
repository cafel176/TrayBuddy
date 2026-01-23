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
 * 状态信息接口
 *
 * 对应后端 Rust 的 `StateInfo` 结构体（部分字段）。
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
