// ========================================================================= //
// 音频管理模块 (AudioManager)
// ========================================================================= //
//
// 功能概述:
// - 提供统一的音频播放接口
// - 支持静音模式和音量控制
// - 自动响应用户设置变更
// - 单例模式确保全局唯一实例
// - 支持音频 URL 缓存，减少重复查询
//
// 使用方式:
// const audioManager = await getAudioManager();
// await audioManager.play("greeting", () => console.log("播放完成"));
// ========================================================================= //

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ========================================================================= //
// 类型定义
// ========================================================================= //

/**
 * 用户设置接口
 * 包含音频相关的用户配置项
 */
interface UserSettings {
  /** 是否启用静音模式 */
  no_audio_mode: boolean;
  /** 音量值 (0.0 - 1.0) */
  volume: number;
  /** 当前语言代码 (如 "zh", "en", "jp") */
  lang: string;
  /** 其他扩展设置 */
  [key: string]: unknown;
}

/**
 * 音频信息接口
 */
interface AudioInfo {
  name: string;
  audio: string;
}

// ========================================================================= //
// 模块级缓存
// ========================================================================= //

/** 缓存的 mod 路径 */
let cachedModPath: string | null = null;

/** 音频 URL 缓存 (key: `${lang}:${name}`) */
const audioUrlCache: Map<string, string> = new Map();

/** 最大音频 URL 缓存数量 */
const AUDIO_CACHE_MAX_SIZE = 50;

/**
 * 获取 mod 路径（带缓存）
 */
async function getModPath(): Promise<string | null> {
  if (cachedModPath === null) {
    cachedModPath = await invoke("get_mod_path");
  }
  return cachedModPath;
}

/**
 * 清除 AudioManager 的缓存（Mod 切换时调用）
 */
export function clearAudioCache(): void {
  cachedModPath = null;
  audioUrlCache.clear();
}

// ========================================================================= //
// AudioManager 类
// ========================================================================= //

/**
 * 音频管理器类
 * 
 * 负责管理应用中的音频播放，包括:
 * - 加载和播放 Mod 中的音频文件
 * - 根据语言设置选择正确的音频版本
 * - 响应设置变更实时调整音量和静音状态
 * - 提供播放完成回调机制
 */
export class AudioManager {
  // ======================================================================= //
  // 私有属性
  // ======================================================================= //

  /** 当前播放的 HTMLAudioElement 实例 */
  private audio: HTMLAudioElement | null = null;
  
  /** 静音状态标记 */
  private muted: boolean = false;
  
  /** 当前音量 (0.0 - 1.0) */
  private volume: number = 0.5;
  
  /** 当前语言代码，用于选择对应语言的音频 */
  private lang: string = "zh";
  
  /** 设置变更事件的取消监听函数 */
  private unlistenSettings: UnlistenFn | null = null;
  
  /** 音频播放结束后的回调函数 */
  private onEndCallback: (() => void) | null = null;

  // ======================================================================= //
  // 构造函数
  // ======================================================================= //

  constructor() {}

  /**
   * 初始化音频管理器
   */
  async init(): Promise<void> {
    // 获取初始设置
    const settings: UserSettings = await invoke("get_settings");
    this.muted = settings.no_audio_mode;
    this.volume = settings.volume;
    this.lang = settings.lang;

    // 监听设置变更
    this.unlistenSettings = await listen<UserSettings>("settings-change", (event) => {
      const settings = event.payload;
      this.muted = settings.no_audio_mode;
      this.volume = settings.volume;
      this.lang = settings.lang;

      // 更新当前播放音频的音量
      if (this.audio) {
        this.audio.volume = this.muted ? 0 : this.volume;
      }
    });
  }

  /**
   * 播放指定名称的音频
   * 
   * 使用 URL 缓存减少重复的后端查询
   * 
   * @param audioName 音频名称
   * @param onEnd 播放结束回调
   * @returns 是否成功开始播放
   */
  async play(audioName: string, onEnd?: () => void): Promise<boolean> {
    // 空名称直接返回成功（无需播放）
    if (!audioName) {
      onEnd?.();
      return true;
    }

    // 停止当前播放（注意：不触发之前的回调，因为我们要开始新的播放）
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    this.onEndCallback = null;

    try {
      // 构建缓存键
      const cacheKey = `${this.lang}:${audioName}`;
      let audioUrl = audioUrlCache.get(cacheKey);
      
      // 缓存未命中，查询后端
      if (!audioUrl) {
        // 获取音频信息 (后端会处理 fallback)
        const audioInfo: AudioInfo | null = await invoke("get_audio_by_name", {
          lang: this.lang,
          name: audioName,
        });

        if (!audioInfo) {
          console.warn(`Audio '${audioName}' not found for lang '${this.lang}'`);
          onEnd?.();
          return false;
        }

        // 获取 mod 路径并构建完整音频路径
        const modPath = await getModPath();
        if (!modPath) {
          console.warn("No mod loaded");
          onEnd?.();
          return false;
        }

        const audioPath = `${modPath}/audio/${audioInfo.audio}`;
        const normalizedPath = audioPath.replace(/\\/g, "/");
        audioUrl = convertFileSrc(normalizedPath);
        
        // 添加到缓存（带 LRU 淘汰）
        if (audioUrlCache.size >= AUDIO_CACHE_MAX_SIZE) {
          const firstKey = audioUrlCache.keys().next().value;
          if (firstKey) audioUrlCache.delete(firstKey);
        }
        audioUrlCache.set(cacheKey, audioUrl);
      }
      
      // 创建音频元素
      this.audio = new Audio();
      this.audio.src = audioUrl;
      this.audio.volume = this.muted ? 0 : this.volume;
      
      this.onEndCallback = onEnd || null;

      // 监听播放结束
      this.audio.onended = () => {
        this.onEndCallback?.();
        this.onEndCallback = null;
      };

      // 监听错误
      this.audio.onerror = (e) => {
        console.error(`Failed to play audio '${audioName}':`, e, this.audio?.error);
        this.onEndCallback?.();
        this.onEndCallback = null;
      };

      // 开始播放
      await this.audio.play();
      return true;
    } catch (e) {
      console.error(`Exception playing audio '${audioName}':`, e);
      onEnd?.();
      return false;
    }
  }

  /**
   * 停止当前播放
   */
  stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    // 触发回调（如果有）
    if (this.onEndCallback) {
      this.onEndCallback();
      this.onEndCallback = null;
    }
  }

  /**
   * 设置静音状态
   */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.audio) {
      this.audio.volume = muted ? 0 : this.volume;
    }
  }

  /**
   * 设置音量
   */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.audio && !this.muted) {
      this.audio.volume = this.volume;
    }
  }

  /**
   * 检查是否正在播放
   */
  isPlaying(): boolean {
    return this.audio !== null && !this.audio.paused;
  }

  /**
   * 销毁音频管理器
   */
  destroy(): void {
    this.stop();
    this.unlistenSettings?.();
    this.unlistenSettings = null;
  }
}

// ========================================================================= //
// 单例管理
// ========================================================================= //

/** AudioManager 单例实例 */
let audioManagerInstance: AudioManager | null = null;

/**
 * 获取或创建 AudioManager 单例实例
 * 
 * 首次调用时会创建新实例并初始化，后续调用返回已存在的实例。
 * 使用单例模式确保全局只有一个音频管理器，避免多个实例同时播放音频。
 * 
 * @returns 初始化完成的 AudioManager 实例
 * 
 * @example
 * const audioManager = await getAudioManager();
 * await audioManager.play("greeting");
 */
export async function getAudioManager(): Promise<AudioManager> {
  if (!audioManagerInstance) {
    audioManagerInstance = new AudioManager();
    await audioManagerInstance.init();
  }
  return audioManagerInstance;
}
