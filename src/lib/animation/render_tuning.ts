/**
 * 渲染调优参数计算工具
 *
 * 基于 `RENDER_TUNING` 常量，提供 DPR 缩放、抗锯齿开关、FPS 上限等
 * 渲染参数的运行时计算。所有动画引擎（Sprite / Live2D / PngRemix / 3D）
 * 共用这些参数，确保全局渲染策略一致。
 *
 * @module render_tuning
 */
import { RENDER_TUNING } from "$lib/constants";

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
 * 将某个“播放器自身的 FPS 上限”再叠加全局上限（若开启）。
 */
export function capFps(perPlayerMaxFps: number): number {
  const safe = clampNumber(Number(perPlayerMaxFps) || 60, 1, 240);
  const globalCap = getRenderMaxFps();
  return globalCap ? Math.min(safe, globalCap) : safe;
}
