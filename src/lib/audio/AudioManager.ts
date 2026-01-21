import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface UserSettings {
  no_audio_mode: boolean;
  volume: number;
  lang: string;
  [key: string]: unknown;
}

/**
 * 音频管理器
 * - 支持静音模式控制
 * - 支持音量控制
 * - 支持播放指定音频
 */
export class AudioManager {
  private audio: HTMLAudioElement | null = null;
  private muted: boolean = false;
  private volume: number = 0.5;
  private lang: string = "zh";
  private unlistenSettings: UnlistenFn | null = null;
  private onEndCallback: (() => void) | null = null;

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
      // 获取音频完整路径 (后端会处理 fallback)
      const audioPath: string | null = await invoke("get_audio_path", {
        lang: this.lang,
        name: audioName,
      });

      console.log(`[AudioManager] play('${audioName}') lang='${this.lang}' -> path='${audioPath}'`);

      if (!audioPath) {
        console.warn(`Audio '${audioName}' not found for lang '${this.lang}'`);
        onEnd?.();
        return false;
      }
      
      // 创建音频元素
      this.audio = new Audio();
      const normalizedPath = audioPath.replace(/\\/g, "/");
      const audioUrl = convertFileSrc(normalizedPath);
      console.log(`[AudioManager] Audio URL: ${audioUrl}`);
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
        console.error(`[AudioManager] Failed to play audio '${audioName}':`, e, this.audio?.error);
        this.onEndCallback?.();
        this.onEndCallback = null;
      };

      // 开始播放
      console.log(`[AudioManager] Starting playback...`);
      await this.audio.play();
      console.log(`[AudioManager] Playback started successfully`);
      return true;
    } catch (e) {
      console.error(`[AudioManager] Exception playing audio '${audioName}':`, e);
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

// 创建单例
let audioManagerInstance: AudioManager | null = null;

/**
 * 获取或创建 AudioManager 实例
 */
export async function getAudioManager(): Promise<AudioManager> {
  if (!audioManagerInstance) {
    audioManagerInstance = new AudioManager();
    await audioManagerInstance.init();
  }
  return audioManagerInstance;
}
