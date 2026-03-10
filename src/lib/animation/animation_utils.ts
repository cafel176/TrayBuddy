/**
 * animation_utils.ts - 从动画模块提取的纯逻辑函数集合
 *
 * 这些函数不依赖 DOM / Canvas / WebGL / PIXI / Three.js，
 * 可在 jsdom 测试环境中直接运行和测试。
 *
 * 来源文件：
 * - WindowCore.ts（时间/日期/ModData 计算）
 * - SpriteAnimator.ts（降采样目标计算、动画配置构建、边框判断）
 * - Live2DPlayer.ts（motion 优先级、名称归一化、降采样计算、localStorage 工具、路径归一化）
 * - PngRemixPlayer.ts（Mat2D 矩阵、数学/颜色/混合工具、文件格式检测）
 * - ThreeDPlayer.ts（降采样目标计算）
 */

// ============================================================================
// WindowCore 纯逻辑
// ============================================================================

/**
 * 将秒数格式化为 HH:MM:SS 格式。
 */
export function formatDurationHms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
}

/**
 * 根据首次登录时间戳（秒）计算已使用天数。
 * @param firstLoginTs - UNIX 时间戳（秒），null 时返回 0
 * @param now - 当前时间（可选，用于测试注入）
 */
export function calcDaysUsed(firstLoginTs: number | null, now?: Date): number {
  if (!firstLoginTs) return 0;

  const first = new Date(firstLoginTs * 1000);
  const today = now ?? new Date();

  const firstMidnight = new Date(
    first.getFullYear(),
    first.getMonth(),
    first.getDate(),
  );
  const todayMidnight = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  const diffDays = Math.floor(
    (todayMidnight.getTime() - firstMidnight.getTime()) / 86400000,
  );
  return Math.max(1, diffDays + 1);
}

/**
 * 根据基准秒数与基准时间点计算当前总使用秒数。
 */
export function calcTotalUsageSeconds(
  usageBaseSeconds: number,
  usageBaseAtMs: number,
  nowMs?: number,
): number {
  const now = nowMs ?? Date.now();
  const delta = Math.max(0, Math.floor((now - usageBaseAtMs) / 1000));
  return Math.max(0, Math.floor(usageBaseSeconds + delta));
}

// ============================================================================
// SpriteAnimator 纯逻辑
// ============================================================================

/** 精灵贴图降采样策略。 */
export type SpriteTexturePolicy = {
  enabled: boolean;
  startDim: number;
  maxDim: number;
  scale: number;
};

const SPRITE_TEX_OPT_MIN_SCALE = 0.05;

/**
 * 计算降采样目标尺寸（Sprite）。
 */
export function computeSpriteDownsampleTarget(
  w0: number,
  h0: number,
  policy: SpriteTexturePolicy,
): { w: number; h: number; scale: number } {
  if (!policy.enabled || w0 <= 0 || h0 <= 0) return { w: w0, h: h0, scale: 1 };

  const denom0 = Math.max(w0, h0);
  const startDim = Number(policy.startDim);
  if (
    Number.isFinite(startDim) &&
    startDim > 0 &&
    denom0 > 0 &&
    denom0 < startDim
  ) {
    return { w: w0, h: h0, scale: 1 };
  }

  let s = Math.max(
    SPRITE_TEX_OPT_MIN_SCALE,
    Math.min(1, Number(policy.scale) || 1),
  );
  const maxDim = Number(policy.maxDim);
  if (Number.isFinite(maxDim) && maxDim > 0) {
    const denom = Math.max(w0, h0);
    if (denom > 0) s = Math.min(s, maxDim / denom);
  }
  s = Math.max(SPRITE_TEX_OPT_MIN_SCALE, Math.min(1, s));

  const tw = Math.max(1, Math.round(w0 * s));
  const th = Math.max(1, Math.round(h0 * s));
  return { w: tw, h: th, scale: s };
}

/**
 * 判断是否为边框动画图片。
 */
export function isBorderImage(imgSrc: string): boolean {
  return imgSrc.toLowerCase().includes("border");
}

// ============================================================================
// Live2DPlayer 纯逻辑
// ============================================================================

/**
 * 将 motion priority 映射为数值级别。
 * idle < normal < high < force
 */
export function getMotionPriority(priority?: string): number {
  const map: Record<string, number> = {
    idle: 1,
    normal: 2,
    high: 3,
    force: 4,
  };
  const key = String(priority || "").toLowerCase();
  return map[key] ?? 2;
}

/**
 * 将名称归一化为可用于 Map 键的形式。
 */
export function buildNameKey(name: string): string {
  return String(name || "").trim().toLowerCase();
}

/** Live2D 贴图降采样策略。 */
export type Live2DTextureDecodePolicy = {
  enabled: boolean;
  maxDim: number;
  scale: number;
  startDim: number;
};

const LIVE2D_TEX_OPT_MIN_SCALE = 0.05;

/**
 * 计算降采样目标尺寸（Live2D）。
 */
export function computeLive2DDecodeTarget(
  w: number,
  h: number,
  policy: Live2DTextureDecodePolicy,
): { w: number; h: number; scale: number } {
  const w0 = Math.max(1, Math.floor(Number(w) || 1));
  const h0 = Math.max(1, Math.floor(Number(h) || 1));
  if (!policy.enabled) return { w: w0, h: h0, scale: 1 };

  const denom0 = Math.max(w0, h0);
  const startDim = Number(policy.startDim);
  if (
    Number.isFinite(startDim) &&
    startDim > 0 &&
    denom0 > 0 &&
    denom0 < startDim
  ) {
    return { w: w0, h: h0, scale: 1 };
  }

  let s = Math.max(
    LIVE2D_TEX_OPT_MIN_SCALE,
    Math.min(1, Number(policy.scale) || 1),
  );
  const maxDim = Number(policy.maxDim);
  if (Number.isFinite(maxDim) && maxDim > 0) {
    const denom = Math.max(w0, h0);
    if (denom > 0) s = Math.min(s, maxDim / denom);
  }
  s = Math.max(LIVE2D_TEX_OPT_MIN_SCALE, Math.min(1, s));

  const tw = Math.max(1, Math.round(w0 * s));
  const th = Math.max(1, Math.round(h0 * s));
  return { w: tw, h: th, scale: s };
}

/**
 * 路径归一化（统一斜杠、小写、去空格）。
 */
export function normalizeFsPath(p: string): string {
  return String(p || "")
    .replace(/\\/g, "/")
    .trim()
    .toLowerCase();
}

/**
 * 将参数值归一化为整数维度值。
 * 返回 null 表示无效输入。
 */
export function normalizeStartDim(v: any): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

// ============================================================================
// ThreeDPlayer 纯逻辑
// ============================================================================

/** 3D 纹理降采样策略。 */
export type ThreeDTexturePolicy = {
  enabled: boolean;
  startDim: number;
  maxDim: number;
  scale: number;
};

const TEX_OPT_MIN_SCALE = 0.05;
const TEX_OPT_NO_RESIZE_EPS = 0.999;

/**
 * 计算降采样目标尺寸（3D）。
 */
export function computeTexDownsampleTarget(
  w0: number,
  h0: number,
  policy: ThreeDTexturePolicy,
): { w: number; h: number; scale: number } {
  if (!policy.enabled || w0 <= 0 || h0 <= 0) return { w: w0, h: h0, scale: 1 };

  const maxSide = Math.max(w0, h0);

  if (policy.startDim > 0 && maxSide < policy.startDim)
    return { w: w0, h: h0, scale: 1 };

  let s = policy.scale;

  if (policy.maxDim > 0 && maxSide * s > policy.maxDim) {
    s = policy.maxDim / maxSide;
  }

  s = Math.max(TEX_OPT_MIN_SCALE, Math.min(1, s));
  if (s >= TEX_OPT_NO_RESIZE_EPS) return { w: w0, h: h0, scale: 1 };

  return {
    w: Math.max(1, Math.round(w0 * s)),
    h: Math.max(1, Math.round(h0 * s)),
    scale: s,
  };
}

// ============================================================================
// PngRemixPlayer 纯逻辑 — 2D 仿射矩阵
// ============================================================================

/**
 * 2D 仿射矩阵 [a c e; b d f; 0 0 1]
 */
export class Mat2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  constructor(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
  }
  static identity() {
    return new Mat2D();
  }
  static translate(x: number, y: number) {
    return new Mat2D(1, 0, 0, 1, x, y);
  }
  static scale(x: number, y: number) {
    return new Mat2D(x, 0, 0, y, 0, 0);
  }
  static rotate(rad: number) {
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return new Mat2D(cos, sin, -sin, cos, 0, 0);
  }
  multiply(m: Mat2D): Mat2D {
    return new Mat2D(
      this.a * m.a + this.c * m.b,
      this.b * m.a + this.d * m.b,
      this.a * m.c + this.c * m.d,
      this.b * m.c + this.d * m.d,
      this.a * m.e + this.c * m.f + this.e,
      this.b * m.e + this.d * m.f + this.f,
    );
  }
  invert(): Mat2D {
    const det = this.a * this.d - this.b * this.c;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return Mat2D.identity();
    const id = 1 / det;
    return new Mat2D(
      this.d * id,
      -this.b * id,
      -this.c * id,
      this.a * id,
      (this.c * this.f - this.d * this.e) * id,
      (this.b * this.e - this.a * this.f) * id,
    );
  }
  applyToPoint(x: number, y: number) {
    return {
      x: this.a * x + this.c * y + this.e,
      y: this.b * x + this.d * y + this.f,
    };
  }
}

// ============================================================================
// PngRemixPlayer 纯逻辑 — 数学工具
// ============================================================================

export function clamp(n: number, a: number, b: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return x < a ? a : x > b ? b : x;
}

export function toRad(deg: number): number {
  return (Number(deg) || 0) * (Math.PI / 180);
}

export function lerp(a: number, b: number, t: number): number {
  const x = Number(a) || 0;
  const y = Number(b) || 0;
  return x + (y - x) * clamp(t, 0, 1);
}

export function wrapAngleRad(a: number): number {
  const twoPi = Math.PI * 2;
  let x = (Number(a) || 0) % twoPi;
  if (x > Math.PI) x -= twoPi;
  if (x < -Math.PI) x += twoPi;
  return x;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return (
    (Number(a) || 0) +
    wrapAngleRad((Number(b) || 0) - (Number(a) || 0)) * clamp(t, 0, 1)
  );
}

export function moveToward(
  current: number,
  target: number,
  delta: number,
): number {
  const c = Number(current) || 0;
  const t0 = Number(target) || 0;
  const d = Number(delta) || 0;
  if (d <= 0) return c;
  if (c < t0) return Math.min(t0, c + d);
  if (c > t0) return Math.max(t0, c - d);
  return c;
}

export function wrap01(x: number): number {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  const t = n % 1;
  return t < 0 ? t + 1 : t;
}

export function quantize01(x: number, steps: number): number {
  return (
    Math.round(clamp(x, 0, 1) * Math.max(1, steps)) / Math.max(1, steps)
  );
}

// ============================================================================
// PngRemixPlayer 纯逻辑 — 颜色工具
// ============================================================================

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function mulColor(a: any, b: any): RGBA {
  return {
    r: clamp(a?.r ?? 1, 0, 1) * clamp(b?.r ?? 1, 0, 1),
    g: clamp(a?.g ?? 1, 0, 1) * clamp(b?.g ?? 1, 0, 1),
    b: clamp(a?.b ?? 1, 0, 1) * clamp(b?.b ?? 1, 0, 1),
    a: clamp(a?.a ?? 1, 0, 1) * clamp(b?.a ?? 1, 0, 1),
  };
}

export function rgbToHsv(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; v: number } {
  const rr = clamp(r, 0, 1),
    gg = clamp(g, 0, 1),
    bb = clamp(b, 0, 1);
  const max = Math.max(rr, gg, bb),
    min = Math.min(rr, gg, bb),
    d = max - min;
  let h = 0;
  if (d > 1e-12) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h = wrap01(h / 6);
  }
  return { h, s: max <= 1e-12 ? 0 : d / max, v: max };
}

export function hsvToRgb(
  h: number,
  s: number,
  v: number,
): { r: number; g: number; b: number } {
  const hh = wrap01(h),
    ss = clamp(s, 0, 1),
    vv = clamp(v, 0, 1);
  const i = Math.floor(hh * 6),
    f = hh * 6 - i;
  const p = vv * (1 - ss),
    q = vv * (1 - f * ss),
    t = vv * (1 - (1 - f) * ss);
  switch (i % 6) {
    case 0:
      return { r: vv, g: t, b: p };
    case 1:
      return { r: q, g: vv, b: p };
    case 2:
      return { r: p, g: vv, b: t };
    case 3:
      return { r: p, g: q, b: vv };
    case 4:
      return { r: t, g: p, b: vv };
    default:
      return { r: vv, g: p, b: q };
  }
}

export type PngRemixBlendMode = "normal" | "add" | "multiply" | "difference";

export function compositeForBlendMode(mode: string): PngRemixBlendMode {
  switch (String(mode || "Normal")) {
    case "Add":
      return "add";
    case "Multiply":
      return "multiply";
    case "Subtract":
      return "difference";
    case "Burn":
      return "multiply";
    default:
      return "normal";
  }
}

// ============================================================================
// PngRemixPlayer 纯逻辑 — 字节/文件格式工具
// ============================================================================

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

const TEXTURE_DEDUP_FALLBACK_SAMPLE_BYTES = 32;

export function simpleBytesSignature(bytes: Uint8Array): string {
  const len = bytes.byteLength;
  const n = Math.min(TEXTURE_DEDUP_FALLBACK_SAMPLE_BYTES, len);

  let h = 2166136261 >>> 0; // FNV-1a 32
  const step = Math.max(1, Math.floor(len / 2048));
  for (let i = 0; i < len; i += step) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619) >>> 0;
  }

  const head = bytesToHex(bytes.subarray(0, n));
  const tail = bytesToHex(bytes.subarray(Math.max(0, len - n), len));
  return `${len}:${h.toString(16)}:${head}:${tail}`;
}

export function isGifBytes(b: Uint8Array): boolean {
  return (
    b.length >= 6 &&
    b[0] === 0x47 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) &&
    b[5] === 0x61
  );
}

export function isPngBytes(b: Uint8Array): boolean {
  return (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  );
}

export function pngHasChunk(b: Uint8Array, chunk: string): boolean {
  if (!isPngBytes(b) || chunk.length !== 4) return false;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = 8;
  while (off + 12 <= b.length) {
    const len = dv.getUint32(off, false);
    const type = String.fromCharCode(
      b[off + 4],
      b[off + 5],
      b[off + 6],
      b[off + 7],
    );
    if (type === chunk) return true;
    off += 12 + len;
    if (len < 0 || off > b.length) break;
  }
  return false;
}

export function tryReadPngSize(
  bytes: Uint8Array,
): { w: number; h: number } | null {
  if (!isPngBytes(bytes) || bytes.length < 24) return null;
  if (
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  )
    return null;
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const w = dv.getUint32(16, false);
    const h = dv.getUint32(20, false);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
      return null;
    return { w, h };
  } catch {
    return null;
  }
}

export function tryReadGifSize(
  bytes: Uint8Array,
): { w: number; h: number } | null {
  if (!isGifBytes(bytes) || bytes.length < 10) return null;
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const w = dv.getUint16(6, true);
    const h = dv.getUint16(8, true);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
      return null;
    return { w, h };
  } catch {
    return null;
  }
}

// ============================================================================
// WindowCore 纯逻辑 — 从内联闭包提取的可测试函数
// ============================================================================

/**
 * 判断拖拽阈值是否被超过。
 * @param startX - 鼠标按下时的 screenX
 * @param startY - 鼠标按下时的 screenY
 * @param currentX - 当前 screenX
 * @param currentY - 当前 screenY
 * @param threshold - 位移阈值（像素）
 */
export function isDragThresholdExceeded(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  threshold: number,
): boolean {
  return (
    Math.abs(currentX - startX) > threshold ||
    Math.abs(currentY - startY) > threshold
  );
}

/**
 * 判断 playOnce 播放是否三要素全部完成。
 */
export function isPlaybackComplete(
  isPlayOnce: boolean,
  animationComplete: boolean,
  audioComplete: boolean,
  bubbleComplete: boolean,
): boolean {
  return isPlayOnce && animationComplete && audioComplete && bubbleComplete;
}

/**
 * 替换气泡文本中的占位符（纯文本变换）。
 * @param raw - 原始文本
 * @param nickname - 用户昵称
 * @param daysUsed - 使用天数
 * @param totalUsageHours - 总使用小时数
 * @param uptimeFormatted - 已格式化的 session uptime (HH:MM:SS)
 */
export function replaceSpeechPlaceholders(
  raw: string,
  nickname: string,
  daysUsed: number,
  totalUsageHours: number,
  uptimeFormatted: string,
): string {
  let text = raw;
  text = text.replace(/\{nickname\}/g, nickname);
  text = text.replace(/\{days_used\}/g, String(daysUsed));
  text = text.replace(
    /\{(?:usage_hours|total_usage_hours)\}/g,
    String(totalUsageHours),
  );
  text = text.replace(/\{uptime\}/g, uptimeFormatted);
  return text;
}

/**
 * 计算 ModData 变化 delta。
 * @returns delta 数值，如果没有变化或输入无效则返回 null
 */
export function calcModDataDelta(
  nextValue: number | undefined,
  lastValue: number | null,
): number | null {
  if (typeof nextValue !== "number") return null;
  if (typeof lastValue === "number" && nextValue !== lastValue) {
    return nextValue - lastValue;
  }
  return null;
}

// ============================================================================
// Mods 页面纯逻辑 — 从 +page.svelte 提取的可测试函数
// ============================================================================

/**
 * 从文本中提取 URL 链接，返回 text/link 混合 token 数组。
 * 处理结尾常见标点裁剪（避免把 ")" / "," 等算进 URL）。
 */
export type DescToken =
  | { kind: "text"; value: string }
  | { kind: "link"; href: string; text: string };

export function tokenizeLinks(input: string): DescToken[] {
  if (!input) return [];

  const tokens: DescToken[] = [];
  const regex = /\bhttps?:\/\/[^\s<>"']+/gi;
  let lastIndex = 0;

  for (const m of input.matchAll(regex)) {
    const raw = m[0];
    const index = m.index ?? 0;

    if (index > lastIndex) {
      tokens.push({ kind: "text", value: input.slice(lastIndex, index) });
    }

    // 处理结尾常见标点，避免把 ")" / "," 等算进 URL
    let href = raw;
    let trailing = "";
    while (href.length > 0 && /[),.;!?]$/.test(href)) {
      trailing = href.slice(-1) + trailing;
      href = href.slice(0, -1);
    }

    if (href) {
      tokens.push({ kind: "link", href, text: href });
    } else {
      // 极端兜底：如果被裁剪到空，按原文输出
      tokens.push({ kind: "text", value: raw });
    }

    if (trailing) {
      tokens.push({ kind: "text", value: trailing });
    }

    lastIndex = index + raw.length;
  }

  if (lastIndex < input.length) {
    tokens.push({ kind: "text", value: input.slice(lastIndex) });
  }

  return tokens.length ? tokens : [{ kind: "text", value: input }];
}

/**
 * 将各种错误类型统一转为字符串消息。
 */
export function toErrorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    for (const val of Object.values(obj)) {
      if (typeof val === "string") return val;
    }
  }
  return String(e);
}

/**
 * 判断一个 mod 是否需要后台 hydrate（archive 路径且 version 为空）。
 * @param isArchive - 路径是否为 archive mod
 * @param version - mod manifest version
 */
export function needsHydrateSbuddy(
  isArchive: boolean,
  version: string | undefined | null,
): boolean {
  return isArchive && (!version || version.trim().length === 0);
}

/**
 * 多语言角色信息回退选择。
 * @param info - 角色信息字典 {lang: CharacterInfo}
 * @param currentLang - 当前语言
 * @param defaultLang - 默认语言
 * @returns 匹配的 CharacterInfo 或 null
 */
export function resolveCharInfo<T>(
  info: Record<string, T> | null | undefined,
  currentLang: string,
  defaultLang: string,
): T | null {
  if (!info) return null;
  return info[currentLang] || info[defaultLang] || Object.values(info)[0] || null;
}
