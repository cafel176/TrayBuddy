/**
 * AudioManager - 音频管理模块
 *
 * 该模块负责桌面宠物的语音播放功能，支持：
 * - 多语言语音资源加载和播放
 * - 音量控制和静音模式
 * - 用户设置实时同步（通过事件监听）
 * - 音频 URL 缓存（减少重复查询）
 *
 * ## 数据流
 * 1. 前端调用 `play(audioName)` 请求播放语音
 * 2. AudioManager 向后端查询语音文件路径
 * 3. 使用 HTML5 Audio API 播放语音
 * 4. 播放完成后触发回调
 *
 * ## 使用示例
 * ```typescript
 * const audioManager = await getAudioManager();
 * await audioManager.play("morning", () => {
 *   console.log("语音播放完成");
 * });
 * ```
 */

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { LRUCache } from "../utils/LRUCache";
import { getModPath, clearModPathCache } from "../utils/modPath";
import type { AudioInfo, UserSettings } from "../types/asset";

// ============================================================================
// 音频 URL 缓存
// ============================================================================

/**
 * 音频 URL 缓存实例
 * - 最大缓存 50 条记录
 * - 缓存 key 格式: "语言:音频名"（如 "zh:morning"）
 * - 缓存 value 为完整的音频文件 URL
 */
const audioUrlCache = new LRUCache<string, string>(50);

/**
 * 清除音频缓存
 * 在 Mod 切换时调用，确保使用新 Mod 的音频资源
 */
export function clearAudioCache(): void {
  clearModPathCache();   // 清除 Mod 路径缓存
  audioUrlCache.clear(); // 清除音频 URL 缓存
}

// ============================================================================
// AudioManager 类
// ============================================================================

/**
 * 音频管理器
 *
 * 管理桌面宠物的语音播放，特性：
 * - 同一时间只播放一个语音（新语音会停止旧语音）
 * - 自动响应用户设置变更（音量、静音、语言）
 * - 支持播放完成回调
 *
 * ## 生命周期
 * 1. 创建实例
 * 2. 调用 `init()` 初始化（加载设置、注册事件监听）
 * 3. 使用 `play()` 播放语音
 * 4. 销毁时调用 `destroy()` 清理资源
 */
export class AudioManager {
  /** 当前 Audio 元素（同一时间只有一个） */
  private audio: HTMLAudioElement | null = null;
  /** 是否静音 */
  private muted = false;
  /** 音量（0.0 - 1.0） */
  private volume = 0.5;
  /** 当前语言（用于查询对应语言的语音资源） */
  private lang = "zh";
  /** 设置变更事件的取消监听函数 */
  private unlistenSettings: UnlistenFn | null = null;
  /** 音量变更事件的取消监听函数 */
  private unlistenVolume: UnlistenFn | null = null;
  /** 静音变更事件的取消监听函数 */
  private unlistenMute: UnlistenFn | null = null;
  /** 播放完成回调 */
  private onEndCallback: (() => void) | null = null;

  constructor() { }

  /**
   * 初始化音频管理器
   *
   * 执行操作：
   * 1. 从后端加载用户设置（音量、静音、语言）
   * 2. 注册事件监听，实时同步设置变更
   */
  async init(): Promise<void> {
    // 加载初始设置
    const settings: UserSettings = await invoke("get_settings");
    this.muted = settings.no_audio_mode;
    this.volume = settings.volume;
    this.lang = settings.lang;

    // 监听完整设置变更事件（保存按钮触发）
    this.unlistenSettings = await listen<UserSettings>("settings-change", (event) => {
      const s = event.payload;

      // 只更新存在的字段（兼容部分更新）
      if ("no_audio_mode" in s) {
        this.muted = s.no_audio_mode;
      }
      if ("volume" in s) {
        this.volume = s.volume;
      }
      if ("lang" in s) {
        this.lang = s.lang;
      }

      // 立即更新当前播放的音量
      if (this.audio) {
        this.audio.volume = this.muted ? 0 : this.volume;
      }
    });

    // 监听实时音量变更事件
    this.unlistenVolume = await listen<number>("volume-change", (event) => {
      this.volume = event.payload;
      if (this.audio && !this.muted) {
        this.audio.volume = this.volume;
      }
    });

    // 监听实时静音变更事件
    this.unlistenMute = await listen<boolean>("mute-change", (event) => {
      this.muted = event.payload;
      if (this.audio) {
        this.audio.volume = this.muted ? 0 : this.volume;
      }
    });
  }

  /**
   * 播放语音
   *
   * 播放流程：
   * 1. 停止当前播放的语音（如果有）
   * 2. 查询语音文件路径（优先使用缓存）
   * 3. 创建 Audio 元素播放
   * 4. 播放完成后触发回调
   *
   * @param audioName - 语音名称（如 "morning", "click"）
   * @param onEnd - 播放完成回调
   * @param loop - 是否循环播放
   * @returns 成功返回 true
   */
  async play(audioName: string, onEnd?: () => void, loop: boolean = false): Promise<boolean> {
    // 空名称直接触发完成回调
    if (!audioName) {
      onEnd?.();
      return true;
    }

    // 停止当前播放
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    this.onEndCallback = null;

    try {
      // 构建缓存 key 并尝试从缓存获取 URL
      const cacheKey = `${this.lang}:${audioName}`;
      let audioUrl = audioUrlCache.get(cacheKey);

      // 缓存未命中，从后端查询
      if (!audioUrl) {
        const audioInfo: AudioInfo | null = await invoke("get_audio_by_name", {
          lang: this.lang,
          name: audioName,
        });

        if (!audioInfo) {
          onEnd?.();
          return false;
        }

        // 构建完整的音频文件 URL
        const modPath = await getModPath();
        if (!modPath) {
          onEnd?.();
          return false;
        }

        const audioPath = `${modPath}/audio/${audioInfo.audio}`.replace(/\\/g, "/");
        audioUrl = convertFileSrc(audioPath);
        audioUrlCache.set(cacheKey, audioUrl);  // 存入缓存
      }

      // 创建并播放 Audio
      this.audio = new Audio();
      this.audio.src = audioUrl;
      this.audio.volume = this.muted ? 0 : this.volume;
      this.audio.loop = loop;
      this.onEndCallback = loop ? null : (onEnd || null);

      // 注册播放完成事件
      this.audio.onended = () => {
        this.onEndCallback?.();
        this.onEndCallback = null;
      };

      // 注册播放错误事件
      this.audio.onerror = () => {
        console.error(`Exception playing audio '${audioName}'`);
        this.onEndCallback?.();
        this.onEndCallback = null;
      };

      await this.audio.play();
      return true;
    } catch (e) {
      console.error(`Exception playing audio '${audioName}':`, e);
      this.onEndCallback?.();
      this.onEndCallback = null;
      return false;
    }
  }

  /**
   * 停止当前播放
   *
   * 停止播放并立即触发完成回调
   */
  stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    if (this.onEndCallback) {
      this.onEndCallback();
      this.onEndCallback = null;
    }
  }

  /**
   * 设置静音模式
   * @param muted - 是否静音
   */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.audio) {
      this.audio.volume = muted ? 0 : this.volume;
    }
  }

  /**
   * 设置音量
   * @param volume - 音量值（0.0 - 1.0）
   */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.audio && !this.muted) {
      this.audio.volume = this.volume;
    }
  }

  /**
   * 检查是否正在播放
   * @returns 正在播放返回 true
   */
  isPlaying(): boolean {
    return this.audio !== null && !this.audio.paused;
  }

  /**
   * 销毁音频管理器
   *
   * 停止播放并取消事件监听
   */
  destroy(): void {
    this.stop();
    this.unlistenSettings?.();
    this.unlistenSettings = null;
    this.unlistenVolume?.();
    this.unlistenVolume = null;
    this.unlistenMute?.();
    this.unlistenMute = null;
  }
}

// ============================================================================
// 单例管理
// ============================================================================

/** 全局单例实例 */
let audioManagerInstance: AudioManager | null = null;

/**
 * 获取音频管理器单例
 *
 * 首次调用时创建并初始化实例，后续调用返回同一实例。
 * 使用单例模式确保全局只有一个音频播放器，避免多个语音同时播放。
 *
 * @returns 初始化完成的音频管理器实例
 */
export async function getAudioManager(): Promise<AudioManager> {
  if (!audioManagerInstance) {
    audioManagerInstance = new AudioManager();
    await audioManagerInstance.init();
  }
  return audioManagerInstance;
}
