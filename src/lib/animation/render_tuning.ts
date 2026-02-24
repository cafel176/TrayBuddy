import { RENDER_TUNING } from "$lib/constants";

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function getRawDpr(): number {
  // 仅在浏览器环境可用；SSR/测试环境兜底为 1。
  if (typeof window === "undefined") return 1;
  const dpr = Number((window as any).devicePixelRatio) || 1;
  return dpr > 0 ? dpr : 1;
}

export function getRenderDpr(): number {
  const dpr = getRawDpr();
  if (!RENDER_TUNING.DPR_CLAMP_ENABLED) return dpr;
  return clampNumber(dpr, RENDER_TUNING.DPR_CLAMP_MIN, RENDER_TUNING.DPR_CLAMP_MAX);
}

export function isAntialiasEnabled(): boolean {
  return !!RENDER_TUNING.ANTIALIAS_ENABLED;
}

export function getRenderMaxFps(): number | null {
  if (!RENDER_TUNING.FPS_LIMIT_ENABLED) return null;
  // 兼容：避免 0/负数/非数值导致除零。
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
