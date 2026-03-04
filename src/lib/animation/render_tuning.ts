/**
 * 渲染调优参数计算工具
 *
 * 基于 `RENDER_TUNING` 常量，提供 DPR 缩放、抗锯齿开关、FPS 上限等
 * 渲染参数的运行时计算。所有动画引擎（Sprite / Live2D / PngRemix / 3D）
 * 共用这些参数，确保全局渲染策略一致。
 *
 * 启动时调用 `initRenderTuning()` 从后端加载 `config/render_tuning.json`
 * 覆盖 `RENDER_TUNING` 中的 FPS / idle 相关默认值。
 *
 * @module render_tuning
 */
import { RENDER_TUNING } from "$lib/constants";
import { invoke } from "@tauri-apps/api/core";

/** 标记是否已完成初始化，避免重复调用 */
let _initialized = false;

/**
 * 从后端加载 `config/render_tuning.json` 配置并覆盖 `RENDER_TUNING` 中的可变字段。
 *
 * 应在各窗口页面创建播放器实例**之前**调用一次。
 * 多次调用是安全的（仅首次生效）。
 */
export async function initRenderTuning(): Promise<void> {
  if (_initialized) return;
  _initialized = true;

  try {
    const cfg = await invoke<{
      fps_limit_max: number;
      idle_throttle_enabled: boolean;
      idle_throttle_fps: number;
      idle_throttle_delay_ms: number;
    }>("get_render_tuning");

    if (cfg) {
      if (typeof cfg.fps_limit_max === "number" && cfg.fps_limit_max > 0) {
        RENDER_TUNING.FPS_LIMIT_MAX = cfg.fps_limit_max;
      }
      if (typeof cfg.idle_throttle_enabled === "boolean") {
        RENDER_TUNING.IDLE_THROTTLE_ENABLED = cfg.idle_throttle_enabled;
      }
      if (typeof cfg.idle_throttle_fps === "number" && cfg.idle_throttle_fps > 0) {
        RENDER_TUNING.IDLE_THROTTLE_FPS = cfg.idle_throttle_fps;
      }
      if (typeof cfg.idle_throttle_delay_ms === "number" && cfg.idle_throttle_delay_ms > 0) {
        RENDER_TUNING.IDLE_THROTTLE_DELAY_MS = cfg.idle_throttle_delay_ms;
      }
    }
  } catch (e) {
    // 后端命令不可用（如测试环境），静默使用默认值
    console.warn("[render_tuning] initRenderTuning failed, using defaults:", e);
  }
}

/**
 * 将数值限制在 `[min, max]` 范围内。
 * 若 `value` 不是有限数（NaN / Infinity），返回 `min` 作为安全兜底。
 */
function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * 获取当前设备的原始 DPR (Device Pixel Ratio)。
 *
 * - 仅在浏览器环境可用；SSR / jsdom 测试环境兜底返回 `1`。
 * - 对非正数和非数值做安全兜底。
 */
export function getRawDpr(): number {
  if (typeof window === "undefined") return 1;
  const dpr = Number((window as any).devicePixelRatio) || 1;
  return dpr > 0 ? dpr : 1;
}

/**
 * 获取经过全局限幅的渲染 DPR。
 *
 * 若 `RENDER_TUNING.DPR_CLAMP_ENABLED` 为 `true`，则将原始 DPR
 * 限制在 `[DPR_CLAMP_MIN, DPR_CLAMP_MAX]` 范围内，避免高 DPR 设备
 * 造成显存/性能瓶颈。
 */
export function getRenderDpr(): number {
  const dpr = getRawDpr();
  if (!RENDER_TUNING.DPR_CLAMP_ENABLED) return dpr;
  return clampNumber(dpr, RENDER_TUNING.DPR_CLAMP_MIN, RENDER_TUNING.DPR_CLAMP_MAX);
}

/** 返回全局抗锯齿是否开启（基于 `RENDER_TUNING.ANTIALIAS_ENABLED`）。 */
export function isAntialiasEnabled(): boolean {
  return !!RENDER_TUNING.ANTIALIAS_ENABLED;
}

/**
 * 获取全局 FPS 上限值。
 *
 * - 若 `RENDER_TUNING.FPS_LIMIT_ENABLED` 为 `false`，返回 `null`（不限制）。
 * - 否则返回 `[1, 240]` 范围内的整数，0/负数/非数值兜底为 60。
 */
export function getRenderMaxFps(): number | null {
  if (!RENDER_TUNING.FPS_LIMIT_ENABLED) return null;
  return clampNumber(Number(RENDER_TUNING.FPS_LIMIT_MAX) || 60, 1, 240);
}

/**
 * 将某个"播放器自身的 FPS 上限"再叠加全局上限（若开启）。
 */
export function capFps(perPlayerMaxFps: number): number {
  const safe = clampNumber(Number(perPlayerMaxFps) || 60, 1, 240);
  const globalCap = getRenderMaxFps();
  return globalCap ? Math.min(safe, globalCap) : safe;
}

/**
 * 获取 idle 降频后的帧率（FPS）。
 *
 * 返回 `RENDER_TUNING.IDLE_THROTTLE_FPS` 经安全钳制后的值（范围 `[1, 30]`）。
 * 供各播放器在 idle 状态下统一使用，避免硬编码。
 */
export function getIdleThrottleFps(): number {
  return clampNumber(Number(RENDER_TUNING.IDLE_THROTTLE_FPS) || 5, 1, 30);
}

// =========================================================================
// Idle Throttle — 无交互/无状态切换时自动降低渲染帧率
// =========================================================================

/**
 * 通用 idle 降频控制器。
 *
 * 用法：
 * 1. 在状态切换、鼠标交互、动画切换等事件中调用 `poke()`
 * 2. 在 rAF 回调中调用 `shouldSkipFrame(ts)` 判断是否应跳过本帧渲染
 *
 * 原理：最后一次 `poke()` 后超过 `delayMs` 毫秒未收到新活动，
 * 即进入 idle 状态，此时帧间隔切换为 `1000/idleFps`（远大于正常帧间隔），
 * 大幅降低 GPU 绘制频率。
 */
export class IdleThrottle {
  private lastActivityTs = 0;
  private lastRenderTs = 0;
  private _idle = false;
  private readonly enabled: boolean;
  private readonly delayMs: number;
  private readonly idleMinDeltaMs: number;

  constructor() {
    this.enabled = !!RENDER_TUNING.IDLE_THROTTLE_ENABLED;
    this.delayMs = Math.max(500, Number(RENDER_TUNING.IDLE_THROTTLE_DELAY_MS) || 3000);
    this.idleMinDeltaMs = 1000 / getIdleThrottleFps();
    this.lastActivityTs = performance.now();
  }

  /** 标记一次"活动"，立即退出 idle 状态。 */
  poke(): void {
    this.lastActivityTs = performance.now();
    this._idle = false;
  }

  /** 当前是否处于 idle 降频状态。 */
  get idle(): boolean {
    return this._idle;
  }

  /**
   * 在 rAF 回调开头调用。返回 `true` 表示本帧应跳过渲染。
   * @param ts requestAnimationFrame 传入的时间戳
   */
  shouldSkipFrame(ts: number): boolean {
    if (!this.enabled) return false;

    // 判断是否进入 idle
    if (!this._idle && ts - this.lastActivityTs > this.delayMs) {
      this._idle = true;
    }

    if (!this._idle) return false;

    // idle 状态：按 idleMinDeltaMs 限频
    if (this.lastRenderTs > 0 && ts - this.lastRenderTs < this.idleMinDeltaMs) {
      return true; // 跳过
    }
    this.lastRenderTs = ts;
    return false;
  }
}
