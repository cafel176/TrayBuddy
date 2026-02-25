/**
 * PngRemix 渲染引擎
 *
 * 将 other-tool/pngRemix预览/app.js 的渲染核心移植为 TypeScript class，
 * 提供与 Live2DPlayer 相同的公共 API，供 pngremix/+page.svelte 集成。
 */

import type {
  PngRemixConfig,
  PngRemixExpression,
  PngRemixMotion,
  PngRemixParameterSetting,
} from "$lib/types/asset";
import { buildModAssetUrl } from "$lib/utils/modAssetUrl";
import { capFps, getRenderDpr } from "./render_tuning";


// ============================================================================
// 全局脚本加载
// ============================================================================

let _scriptsLoaded = false;
let _scriptsPromise: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureScripts(): Promise<void> {
  if (_scriptsLoaded) return;
  if (_scriptsPromise) return _scriptsPromise;
  _scriptsPromise = (async () => {
    await loadScript("/pngremix-decoder.js");
    await loadScript("/model-normalizer.js");
    _scriptsLoaded = true;
  })();
  return _scriptsPromise;
}

// ============================================================================
// Mat2D — 2D 仿射矩阵
// ============================================================================

class Mat2D {
  a: number; b: number; c: number; d: number; e: number; f: number;
  constructor(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
    this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
  }
  static identity() { return new Mat2D(); }
  static translate(x: number, y: number) { return new Mat2D(1, 0, 0, 1, x, y); }
  static scale(x: number, y: number) { return new Mat2D(x, 0, 0, y, 0, 0); }
  static rotate(rad: number) {
    const cos = Math.cos(rad); const sin = Math.sin(rad);
    return new Mat2D(cos, sin, -sin, cos, 0, 0);
  }
  multiply(m: Mat2D): Mat2D {
    return new Mat2D(
      this.a * m.a + this.c * m.b, this.b * m.a + this.d * m.b,
      this.a * m.c + this.c * m.d, this.b * m.c + this.d * m.d,
      this.a * m.e + this.c * m.f + this.e, this.b * m.e + this.d * m.f + this.f,
    );
  }
  invert(): Mat2D {
    const det = this.a * this.d - this.b * this.c;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return Mat2D.identity();
    const id = 1 / det;
    return new Mat2D(
      this.d * id, -this.b * id, -this.c * id, this.a * id,
      (this.c * this.f - this.d * this.e) * id, (this.b * this.e - this.a * this.f) * id,
    );
  }
  applyToPoint(x: number, y: number) {
    return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f };
  }
}

// ============================================================================
// 数学 / 颜色 / 混合工具
// ============================================================================

interface Vec2 { x: number; y: number }
interface RGBA { r: number; g: number; b: number; a: number }

function clamp(n: number, a: number, b: number) {
  const x = Number(n); if (!Number.isFinite(x)) return a;
  return x < a ? a : x > b ? b : x;
}
function toRad(deg: number) { return (Number(deg) || 0) * Math.PI / 180; }
function lerp(a: number, b: number, t: number) {
  const x = Number(a) || 0; const y = Number(b) || 0;
  return x + (y - x) * clamp(t, 0, 1);
}
function wrapAngleRad(a: number) {
  const twoPi = Math.PI * 2; let x = (Number(a) || 0) % twoPi;
  if (x > Math.PI) x -= twoPi; if (x < -Math.PI) x += twoPi; return x;
}
function lerpAngle(a: number, b: number, t: number) {
  return (Number(a) || 0) + wrapAngleRad((Number(b) || 0) - (Number(a) || 0)) * clamp(t, 0, 1);
}
function moveToward(current: number, target: number, delta: number) {
  const c = Number(current) || 0; const t0 = Number(target) || 0; const d = Number(delta) || 0;
  if (d <= 0) return c;
  if (c < t0) return Math.min(t0, c + d);
  if (c > t0) return Math.max(t0, c - d);
  return c;
}
function wrap01(x: number) { const n = Number(x); if (!Number.isFinite(n)) return 0; const t = n % 1; return t < 0 ? t + 1 : t; }
function quantize01(x: number, steps: number) { return Math.round(clamp(x, 0, 1) * Math.max(1, steps)) / Math.max(1, steps); }

function mulColor(a: any, b: any): RGBA {
  return {
    r: clamp(a?.r ?? 1, 0, 1) * clamp(b?.r ?? 1, 0, 1),
    g: clamp(a?.g ?? 1, 0, 1) * clamp(b?.g ?? 1, 0, 1),
    b: clamp(a?.b ?? 1, 0, 1) * clamp(b?.b ?? 1, 0, 1),
    a: clamp(a?.a ?? 1, 0, 1) * clamp(b?.a ?? 1, 0, 1),
  };
}
function isWhiteRgb(c: any) {
  return Math.abs((c?.r ?? 1) - 1) < 1e-6 && Math.abs((c?.g ?? 1) - 1) < 1e-6 && Math.abs((c?.b ?? 1) - 1) < 1e-6;
}
function rgbToHsv(r: number, g: number, b: number) {
  const rr = clamp(r, 0, 1), gg = clamp(g, 0, 1), bb = clamp(b, 0, 1);
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb), d = max - min;
  let h = 0;
  if (d > 1e-12) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h = wrap01(h / 6);
  }
  return { h, s: max <= 1e-12 ? 0 : d / max, v: max };
}
function hsvToRgb(h: number, s: number, v: number) {
  const hh = wrap01(h), ss = clamp(s, 0, 1), vv = clamp(v, 0, 1);
  const i = Math.floor(hh * 6), f = hh * 6 - i;
  const p = vv * (1 - ss), q = vv * (1 - f * ss), t = vv * (1 - (1 - f) * ss);
  switch (i % 6) {
    case 0: return { r: vv, g: t, b: p }; case 1: return { r: q, g: vv, b: p };
    case 2: return { r: p, g: vv, b: t }; case 3: return { r: p, g: q, b: vv };
    case 4: return { r: t, g: p, b: vv }; default: return { r: vv, g: p, b: q };
  }
}

function compositeForBlendMode(mode: string): GlobalCompositeOperation {
  switch (String(mode || "Normal")) {
    case "Add": return "lighter";
    case "Multiply": return "multiply";
    case "Subtract": return "difference";
    case "Burn": return "multiply";
    default: return "source-over";
  }
}

// ============================================================================
// 图像解码（支持解码期降采样/封顶：逻辑尺寸=原图，像素数据可更小）
// ============================================================================

// 贴图解码策略默认值/阈值（仅作用于本文件的降采样/封顶逻辑）
const TEXTURE_DECODE_DEFAULT_MAX_DIM = 400;
const TEXTURE_DECODE_MIN_SCALE = 0.05;
const TEXTURE_DECODE_NO_RESIZE_EPS = 0.999;
const TEXTURE_DECODE_RESIZE_QUALITY = "high" as any;

// 贴图去重：对同内容 bytes 只解码一次，避免重复贴图占用多份内存
const TEXTURE_DEDUP_HASH_ALGO = "SHA-256";
const TEXTURE_DEDUP_FALLBACK_SAMPLE_BYTES = 32;
const _bytesHashKeyCache = new WeakMap<Uint8Array, Promise<string>>();

// 按需解码/缓存/LRU 回收
const TEXTURE_STREAM_DECODE_CONCURRENCY = 4;
const TEXTURE_STREAM_REQUEST_COOLDOWN_MS = 200;

// LRU 预算（估算：像素宽 * 像素高 * 4 bytes）
const TEXTURE_LRU_MAX_ITEMS_DEFAULT = 64;
// 注意：这里必须乘以 4（RGBA bytesPerPixel），否则会低估预算导致频繁回收/闪烁。
const TEXTURE_LRU_MAX_BYTES_DEFAULT = TEXTURE_LRU_MAX_ITEMS_DEFAULT * TEXTURE_DECODE_DEFAULT_MAX_DIM * TEXTURE_DECODE_DEFAULT_MAX_DIM * 4;
const TEXTURE_LRU_TRIM_GUARD_RATIO = 0.92; // 超预算后尽量裁到预算的 92%


function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function simpleBytesSignature(bytes: Uint8Array): string {
  // 仅用于极端情况下（无 SubtleCrypto）的去重 key，尽量降低碰撞概率
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

async function getBytesHashKey(bytes: Uint8Array): Promise<string> {
  const cached = _bytesHashKeyCache.get(bytes);
  if (cached) return cached;

  const p = (async () => {
    const cryptoObj: any = (globalThis as any).crypto;
    if (cryptoObj?.subtle?.digest) {
      const digest = await cryptoObj.subtle.digest(TEXTURE_DEDUP_HASH_ALGO, bytes);
      return `${TEXTURE_DEDUP_HASH_ALGO.toLowerCase()}:${bytesToHex(new Uint8Array(digest))}`;
    }
    return `sig:${simpleBytesSignature(bytes)}`;
  })();

  _bytesHashKeyCache.set(bytes, p);
  return p;
}

type TextureDecodePolicy = {


  /** 贴图解码分辨率封顶（像素）；<=0 表示不封顶 */
  maxDim: number;
  /** 额外降采样倍率（0-1）；<=0 视为 1 */
  scale: number;
};

function isGifBytes(b: Uint8Array) {
  return b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61;
}
function isPngBytes(b: Uint8Array) {
  return b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A;
}
function pngHasChunk(b: Uint8Array, chunk: string) {
  if (!isPngBytes(b) || chunk.length !== 4) return false;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = 8;
  while (off + 12 <= b.length) {
    const len = dv.getUint32(off, false);
    const type = String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7]);
    if (type === chunk) return true;
    off += 12 + len; if (len < 0 || off > b.length) break;
  }
  return false;
}

function tryReadPngSize(bytes: Uint8Array): { w: number; h: number } | null {
  // PNG signature(8) + IHDR length(4) + "IHDR"(4) + w(4) + h(4)
  if (!isPngBytes(bytes) || bytes.length < 24) return null;
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const w = dv.getUint32(16, false);
    const h = dv.getUint32(20, false);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    return { w, h };
  } catch {
    return null;
  }
}

function tryReadGifSize(bytes: Uint8Array): { w: number; h: number } | null {
  // GIF logical screen descriptor: width/height are little-endian uint16 at offset 6/8
  if (!isGifBytes(bytes) || bytes.length < 10) return null;
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const w = dv.getUint16(6, true);
    const h = dv.getUint16(8, true);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    return { w, h };
  } catch {
    return null;
  }
}

function getImageSize(d: any): { w: number; h: number } {
  // 实际像素尺寸（解码后的 drawable 尺寸）
  if (!d) return { w: 0, h: 0 };
  if (typeof ImageBitmap !== "undefined" && d instanceof ImageBitmap) return { w: d.width, h: d.height };
  if (d instanceof HTMLImageElement) return { w: d.naturalWidth || d.width, h: d.naturalHeight || d.height };
  if (d instanceof HTMLCanvasElement) return { w: d.width, h: d.height };
  return { w: 0, h: 0 };
}

function getImageLogicalSize(d: any): { w: number; h: number } {
  // 逻辑尺寸（用于布局/帧切分/裁剪）：默认等于实际像素尺寸，但支持在降采样时保持原图尺寸
  if (!d) return { w: 0, h: 0 };
  const lw = Number((d as any)._logicalW);
  const lh = Number((d as any)._logicalH);
  if (Number.isFinite(lw) && Number.isFinite(lh) && lw > 0 && lh > 0) return { w: lw, h: lh };
  return getImageSize(d);
}

function copyLogicalSize(dst: any, src: any) {
  if (!dst || !src) return;
  const { w, h } = getImageLogicalSize(src);
  if (w > 0 && h > 0) {
    (dst as any)._logicalW = w;
    (dst as any)._logicalH = h;
  }
}

function computeDecodeTarget(logicalW: number, logicalH: number, policy: TextureDecodePolicy | null | undefined): { w: number; h: number; scale: number } {
  const w0 = Math.max(1, Math.floor(Number(logicalW) || 1));
  const h0 = Math.max(1, Math.floor(Number(logicalH) || 1));
  if (!policy) return { w: w0, h: h0, scale: 1 };

  const baseScale = clamp(Number(policy.scale) || 1, TEXTURE_DECODE_MIN_SCALE, 1);

  let s = baseScale;
  const maxDim = Number(policy.maxDim);
  if (Number.isFinite(maxDim) && maxDim > 0) {
    const denom = Math.max(w0, h0);
    if (denom > 0) s = Math.min(s, maxDim / denom);
  }
  s = clamp(s, TEXTURE_DECODE_MIN_SCALE, 1);


  const tw = Math.max(1, Math.round(w0 * s));
  const th = Math.max(1, Math.round(h0 * s));
  return { w: tw, h: th, scale: s };
}

async function decodePngBytesToDrawable(bytes: Uint8Array, _name = "", policy?: TextureDecodePolicy | null): Promise<any> {
  if (bytes.length < 6) return null;
  const isGif = isGifBytes(bytes);
  const isPng = isPngBytes(bytes);
  const isApng = isPng && pngHasChunk(bytes, "acTL");
  const isAnimated = isGif || isApng;
  const mime = isGif ? "image/gif" : isPng ? "image/png" : "application/octet-stream";

  // 逻辑尺寸（优先从头部快速读取；失败时在解码后回填）
  const headerSize = isPng ? tryReadPngSize(bytes) : isGif ? tryReadGifSize(bytes) : null;
  const logicalW = headerSize?.w ?? 0;
  const logicalH = headerSize?.h ?? 0;
  const target = (!isAnimated && logicalW > 0 && logicalH > 0) ? computeDecodeTarget(logicalW, logicalH, policy) : { w: logicalW, h: logicalH, scale: 1 };

  const blob = new Blob([bytes], { type: mime });

  // 非动图 PNG：优先用 createImageBitmap 直接缩放解码，避免先解出大图
  if (!isAnimated && mime === "image/png" && typeof createImageBitmap === "function") {
    try {
      const needsResize = logicalW > 0 && logicalH > 0 && target.scale < TEXTURE_DECODE_NO_RESIZE_EPS;

      const bitmap = needsResize
        ? await createImageBitmap(blob, {
          resizeWidth: target.w,
          resizeHeight: target.h,
          // DOM lib 对 resizeQuality 的 union 可能不完整，这里做一下兼容
          resizeQuality: TEXTURE_DECODE_RESIZE_QUALITY,

        } as any)
        : await createImageBitmap(blob);

      (bitmap as any)._logicalW = logicalW > 0 ? logicalW : bitmap.width;
      (bitmap as any)._logicalH = logicalH > 0 ? logicalH : bitmap.height;
      return bitmap;
    } catch {
      /* fall through */
    }
  }

  // fallback：HTMLImageElement（动图 GIF/APNG 也走这里，浏览器负责播放）
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    if (isAnimated) (img as any)._isAnimated = true;

    const decodedW = img.naturalWidth || img.width;
    const decodedH = img.naturalHeight || img.height;
    const lw = logicalW > 0 ? logicalW : decodedW;
    const lh = logicalH > 0 ? logicalH : decodedH;

    // 仅对非动图尝试二次下采样（注意：这里仍会先解码原图，无法避免峰值内存）
    if (!isAnimated && lw > 0 && lh > 0) {
      const t2 = computeDecodeTarget(lw, lh, policy);
      if (t2.scale < TEXTURE_DECODE_NO_RESIZE_EPS && t2.w > 0 && t2.h > 0) {

        const c = document.createElement("canvas");
        c.width = t2.w;
        c.height = t2.h;
        const cctx = c.getContext("2d")!;
        cctx.imageSmoothingEnabled = true;
        cctx.imageSmoothingQuality = "high";
        cctx.drawImage(img, 0, 0, t2.w, t2.h);
        (c as any)._logicalW = lw;
        (c as any)._logicalH = lh;
        return c;
      }
    }

    (img as any)._logicalW = lw;
    (img as any)._logicalH = lh;
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function applySpriteTextureTransforms(drawable: any, spriteRaw: any) {
  if (!drawable || !spriteRaw || drawable._isAnimated) return drawable;
  const flipH = !!spriteRaw.flipped_h, flipV = !!spriteRaw.flipped_v;
  let rot = ((Math.floor(Number(spriteRaw.rotated) || 0) % 4) + 4) % 4;
  if (!flipH && !flipV && rot === 0) return drawable;
  const { w, h } = getImageSize(drawable);
  if (!w || !h) return drawable;
  const out = document.createElement("canvas");
  out.width = rot % 2 === 1 ? h : w; out.height = rot % 2 === 1 ? w : h;
  const ctx = out.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(rot * Math.PI / 2);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(drawable, -w / 2, -h / 2);

  // 逻辑尺寸需要随旋转变换（rot=1/3 时交换宽高）
  const logical = getImageLogicalSize(drawable);
  let lw = logical.w;
  let lh = logical.h;
  if (rot % 2 === 1) {
    const t = lw; lw = lh; lh = t;
  }
  (out as any)._logicalW = lw;
  (out as any)._logicalH = lh;

  return out;
}



// ============================================================================
// Tint cache
// ============================================================================

const TINT_CACHE_MAX_PER_DRAWABLE = 16;
type TintCacheEntry = { map: Map<string, HTMLCanvasElement>; order: string[] };

// drawable -> ("r,g,b" -> tintedCanvas)
let _tintCache = new WeakMap<any, TintCacheEntry>();

function clearTintCache(): void {
  _tintCache = new WeakMap<any, TintCacheEntry>();
}


function getTintedDrawable(drawable: any, color: RGBA) {
  if (!drawable || drawable._isAnimated || isWhiteRgb(color)) return drawable;
  const { w, h } = getImageSize(drawable);
  if (!w || !h) return drawable;

  const key = `${Math.round(clamp(color.r, 0, 1) * 255)},${Math.round(clamp(color.g, 0, 1) * 255)},${Math.round(clamp(color.b, 0, 1) * 255)}`;

  let entry = _tintCache.get(drawable);
  if (!entry) {
    entry = { map: new Map(), order: [] };
    _tintCache.set(drawable, entry);
  }

  const cached = entry.map.get(key);
  if (cached) {
    // LRU: touch
    const idx = entry.order.indexOf(key);
    if (idx >= 0) entry.order.splice(idx, 1);
    entry.order.push(key);
    return cached;
  }

  const c = document.createElement("canvas"); c.width = w; c.height = h;
  copyLogicalSize(c, drawable);
  const ctx = c.getContext("2d")!;
  ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
  ctx.drawImage(drawable, 0, 0);

  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = `rgb(${key})`; ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(drawable, 0, 0);

  entry.map.set(key, c);
  entry.order.push(key);
  if (entry.order.length > TINT_CACHE_MAX_PER_DRAWABLE) {
    const evictKey = entry.order.shift();
    if (evictKey) entry.map.delete(evictKey);
  }

  return c;
}

// ============================================================================
// drawImageFrame
// ============================================================================

function drawImageFrame(ctx: CanvasRenderingContext2D, drawable: any, hframes: number, vframes: number, frameIndex: number) {
  // 源矩形：按实际像素尺寸取帧；目标矩形：按逻辑尺寸绘制（降采样后仍保持原图大小）
  const src = getImageSize(drawable);
  const dst = getImageLogicalSize(drawable);
  if (!src.w || !src.h || !dst.w || !dst.h) return;

  const hf = Math.max(1, Math.floor(hframes || 1));
  const vf = Math.max(1, Math.floor(vframes || 1));
  const total = hf * vf;
  const f = total > 0 ? ((Math.floor(frameIndex || 0) % total) + total) % total : 0;

  const fwSrc = src.w / hf;
  const fhSrc = src.h / vf;
  const fxSrc = (f % hf) * fwSrc;
  const fySrc = Math.floor(f / hf) * fhSrc;

  const fwDst = dst.w / hf;
  const fhDst = dst.h / vf;
  ctx.drawImage(drawable, fxSrc, fySrc, fwSrc, fhSrc, -fwDst / 2, -fhDst / 2, fwDst, fhDst);
}


// ============================================================================
// RuntimeNode / RuntimeScene
// ============================================================================

/**
 * 运行时节点：对应一个 sprite 的渲染/动画状态。
 *
 * - runtime* 字段保存当前帧的动画结果
 * - _follow/_move 为鼠标跟随/移动的中间态缓存
 * - key/path/pathIds 用于可见性覆盖与调试定位
 */
class RuntimeNode {

  index: number;
  spriteId: any;
  parentId: any;
  name: string;
  type: string;
  raw: any;

  savedStatePatches: any[] = [];
  materializedStates: any[] = [];
  runtimeState: any = null;

  runtimeFrame: number | null = null;
  runtimeFrameOverride: number | null = null;
  _frameAcc = 0;
  runtimeWiggleRotation = 0;
  _rainbowHue = Number.NaN;
  _visiblePrev = false;
  _visibleNow = false;
  _texXform: any = null;

  baseWorldPos: Vec2 = { x: 0, y: 0 };
  runtimeFollowPos: Vec2 = { x: 0, y: 0 };
  runtimeFollowRot = 0;
  runtimeFollowScale: Vec2 = { x: 1, y: 1 };
  runtimeMovePos: Vec2 = { x: 0, y: 0 };
  runtimeMoveRot = 0;
  runtimeMoveScale: Vec2 = { x: 1, y: 1 };
  runtimeAutoRot = 0;

  _follow = {
    targetPos: { x: 0, y: 0 }, currentDir: { x: 0, y: 0 }, currentDist: 0,
    frameH: 0, frameV: 0,
    lastMouseCoords: { x: 0, y: 0 }, lastDist: { x: 0, y: 0 },
    dirVelAnimX: 0, dirVelAnimY: 0, scaleAxis: { x: 0, y: 0 },
  };
  _move = {
    shadow: { x: 0, y: 0 }, prevShadow: { x: 0, y: 0 }, rot: 0,
    scale: { x: 1, y: 1 }, pausedWobble: { x: 0, y: 0 }, pausedRot: 0,
    shouldRot: 0, lastBaseWorldPos: { x: 0, y: 0 }, hasLastBaseWorldPos: false,
  };

  key = "";
  path = "";
  pathIds = "";
  children: RuntimeNode[] = [];
  accZ = 0;

  constructor(sprite: any, index: number) {
    this.index = index;
    this.spriteId = sprite.spriteId;
    this.parentId = sprite.parentId;
    this.name = sprite.spriteName;
    this.type = sprite.spriteType;
    this.raw = sprite.raw;
  }

  getState(_stateId: number) {
    return this.runtimeState && typeof this.runtimeState === "object" ? this.runtimeState : null;
  }
}

/**
 * 运行时场景：承载全局播放状态与节点索引。
 *
 * - nodes/roots 为渲染树结构
 * - visibilityOverrides/hotkeyGroups 用于快捷键与可见性切换
 * - tick/bounce/mouthState 等为动画全局参数
 */
class RuntimeScene {

  model: any;
  textureManager: SpriteTextureManager | null = null;

  stateId = 0;
  enableClip = true;
  viewerJumpY = 0;
  mouthState = 0;
  blinking = false;
  autoBlink = false;
  _autoBlinkTimer: any = null;
  _blinkTimeout: any = null;
  playing = false;
  tick = 0;
  _rafId = 0;
  _lastTs = 0;
  bounceChange = 0;
  _bouncePosY = 0;
  _lastBounceY = 0;
  _clickBounce = { active: false, t: 0, dur: 0.5, amp: 50 };
  hasAnimatedTextures = false;

  // Visibility overrides keyed by RuntimeNode.key
  // - boolean: quick override
  // - { visible: boolean, source?: string, hotkey?: string }
  visibilityOverrides: Record<string, any> = {};

  // Hotkey groups derived from Remix save (raw.saved_keys / raw.saved_disappear)
  // Keep it loosely typed for compatibility across different exports.
  hotkeyGroups: any[] = [];
  availableHotkeys: Set<string> = new Set();


  spriteDrawableByIndex = new Map<number, any>();
  nodes: RuntimeNode[] = [];
  nodeBySpriteId = new Map<any, RuntimeNode>();
  roots: RuntimeNode[] = [];

  constructor(model: any) { this.model = model; }
}

// ============================================================================
// 按需解码 + LRU 贴图回收
// ============================================================================

type TextureCacheRecord = {
  promise: Promise<any>;
  drawable: any | null;
};

type TextureLruEntry = {
  bytes: number;
  lastUsed: number;
  indices: Set<number>;
  cacheKeys: Set<string>;
  transformedKeys: Set<string>;
};

class SpriteTextureManager {
  private scene: RuntimeScene;
  private spriteBytesByIndex: (Uint8Array | null)[];
  private spriteHeaderSizeByIndex: ({ w: number; h: number } | null)[];
  private spriteAnimatedByIndex: boolean[];
  private decodePolicy: TextureDecodePolicy | null;

  private maxItems: number;
  private maxBytes: number;

  private decodedCache = new Map<string, TextureCacheRecord>();
  private transformedCache = new Map<string, TextureCacheRecord>();

  private inFlightByIndex = new Map<number, Promise<void>>();
  private lastRequestMsByIndex = new Map<number, number>();

  private queue: RuntimeNode[] = [];
  private active = 0;

  private lruByDrawable = new Map<any, TextureLruEntry>();
  private totalBytes = 0;

  constructor(
    scene: RuntimeScene,
    spriteBytesByIndex: (Uint8Array | null)[],
    decodePolicy: TextureDecodePolicy | null,
    opts?: { maxItems?: number; maxBytes?: number },
  ) {
    this.scene = scene;
    this.spriteBytesByIndex = spriteBytesByIndex;
    this.decodePolicy = decodePolicy;

    this.maxItems = Math.max(16, Math.floor(opts?.maxItems ?? TEXTURE_LRU_MAX_ITEMS_DEFAULT));
    this.maxBytes = Math.max(16 * 1024 * 1024, Math.floor(opts?.maxBytes ?? TEXTURE_LRU_MAX_BYTES_DEFAULT));

    // 预解析头部尺寸/动图标记，保证未解码时也能算 clip/逻辑尺寸
    this.spriteHeaderSizeByIndex = new Array(spriteBytesByIndex.length).fill(null);
    this.spriteAnimatedByIndex = new Array(spriteBytesByIndex.length).fill(false);
    for (let i = 0; i < spriteBytesByIndex.length; i++) {
      const b = spriteBytesByIndex[i];
      if (!(b instanceof Uint8Array) || b.length < 6) continue;
      const isGif = isGifBytes(b);
      const isPng = isPngBytes(b);
      const isApng = isPng && pngHasChunk(b, "acTL");
      const isAnimated = isGif || isApng;
      this.spriteAnimatedByIndex[i] = isAnimated;
      this.spriteHeaderSizeByIndex[i] = isPng ? tryReadPngSize(b) : isGif ? tryReadGifSize(b) : null;
      if (isAnimated) this.scene.hasAnimatedTextures = true;
    }
  }

  dispose(): void {
    // 清理缓存引用，确保 LRU 回收/GC 生效
    this.queue.length = 0;
    this.decodedCache.clear();
    this.transformedCache.clear();
    this.inFlightByIndex.clear();
    this.lastRequestMsByIndex.clear();

    // 尽量释放 ImageBitmap
    for (const drawable of this.lruByDrawable.keys()) {
      if (drawable instanceof ImageBitmap) {
        try { drawable.close(); } catch { /* ignore */ }
      }
    }

    this.lruByDrawable.clear();
    this.totalBytes = 0;
    this.spriteBytesByIndex = [];
    this.spriteHeaderSizeByIndex = [];
    this.spriteAnimatedByIndex = [];
  }

  getNodeLogicalSize(node: RuntimeNode): { w: number; h: number } {
    const base = this.spriteHeaderSizeByIndex[node.index] || { w: 0, h: 0 };
    let w = base.w;
    let h = base.h;
    const rot = ((Math.floor(Number(node.raw?.rotated) || 0) % 4) + 4) % 4;
    if (rot % 2 === 1) {
      const t = w; w = h; h = t;
    }
    return { w, h };
  }

  request(node: RuntimeNode): void {
    if (!node) return;
    if (this.scene.spriteDrawableByIndex.has(node.index)) return;
    if (this.inFlightByIndex.has(node.index)) return;

    const now = performance.now();
    const last = this.lastRequestMsByIndex.get(node.index) || 0;
    if (last && now - last < TEXTURE_STREAM_REQUEST_COOLDOWN_MS) return;
    this.lastRequestMsByIndex.set(node.index, now);

    this.queue.push(node);
    this.pump();
  }

  touchDrawable(drawable: any): void {
    const e = this.lruByDrawable.get(drawable);
    if (e) e.lastUsed = performance.now();
  }

  trim(): void {
    // 若超预算，回收最久未使用资源
    const overItems = this.lruByDrawable.size > this.maxItems;
    const overBytes = this.totalBytes > this.maxBytes;
    if (!overItems && !overBytes) return;

    const targetBytes = Math.floor(this.maxBytes * TEXTURE_LRU_TRIM_GUARD_RATIO);

    while ((this.lruByDrawable.size > this.maxItems) || (this.totalBytes > this.maxBytes)) {
      let victim: any = null;
      let victimEntry: TextureLruEntry | null = null;
      let bestTs = Infinity;

      for (const [d, e] of this.lruByDrawable.entries()) {
        if (e.lastUsed < bestTs) {
          bestTs = e.lastUsed;
          victim = d;
          victimEntry = e;
        }
      }

      if (!victim || !victimEntry) break;

      // 从所有 index 解绑
      for (const idx of victimEntry.indices) {
        const cur = this.scene.spriteDrawableByIndex.get(idx);
        if (cur === victim) this.scene.spriteDrawableByIndex.delete(idx);
      }

      // 清理去重缓存 key（否则 Map 会一直强引用 drawable，LRU 失效）
      for (const k of victimEntry.cacheKeys) this.decodedCache.delete(k);
      for (const k of victimEntry.transformedKeys) this.transformedCache.delete(k);

      // 释放像素资源
      if (victim instanceof ImageBitmap) {
        try { victim.close(); } catch { /* ignore */ }
      }

      this.totalBytes -= victimEntry.bytes;
      this.lruByDrawable.delete(victim);

      // 若已经明显低于目标，提前停止
      if (this.totalBytes <= targetBytes && this.lruByDrawable.size <= this.maxItems) break;
    }
  }

  private pump(): void {
    while (this.active < TEXTURE_STREAM_DECODE_CONCURRENCY && this.queue.length > 0) {
      const node = this.queue.shift()!;
      this.active++;
      const p = this.ensureNodeDecoded(node)
        .catch(() => { /* ignore */ })
        .finally(() => {
          this.active--;
          this.inFlightByIndex.delete(node.index);
          this.trim();
          // 继续消费队列
          if (this.queue.length > 0) this.pump();
        });
      this.inFlightByIndex.set(node.index, p);
    }
  }

  private async ensureNodeDecoded(node: RuntimeNode): Promise<void> {
    const idx = node.index;
    const bytes = this.spriteBytesByIndex[idx];
    if (!(bytes instanceof Uint8Array) || bytes.length < 6) return;

    const isAnimated = !!this.spriteAnimatedByIndex[idx];

    let drawable: any = null;

    if (!isAnimated) {
      const key = await getBytesHashKey(bytes);

      let rec = this.decodedCache.get(key);
      if (!rec) {
        const promise = decodePngBytesToDrawable(bytes, node.name, this.decodePolicy);
        rec = { promise, drawable: null };
        this.decodedCache.set(key, rec);
        promise.then((d) => { rec!.drawable = d; }).catch(() => { /* ignore */ });
      }

      const base = await rec.promise;
      if (!base) return;

      const flipH = !!node.raw?.flipped_h, flipV = !!node.raw?.flipped_v;
      const rot = ((Math.floor(Number(node.raw?.rotated) || 0) % 4) + 4) % 4;
      node._texXform = null;

      if (flipH || flipV || rot !== 0) {
        const tKey = `${key}|fh${flipH ? 1 : 0}|fv${flipV ? 1 : 0}|r${rot}`;
        let trec = this.transformedCache.get(tKey);
        if (!trec) {
          const promise = Promise.resolve(applySpriteTextureTransforms(base, node.raw));
          trec = { promise, drawable: null };
          this.transformedCache.set(tKey, trec);
          promise.then((d) => { trec!.drawable = d; }).catch(() => { /* ignore */ });
        }
        drawable = await trec.promise;
      } else {
        drawable = base;
      }

      // 记录缓存 key：baseKey 对应 base drawable；transformedKey 对应变换后的 drawable
      const baseKey = key;
      const transformedKey = (flipH || flipV || rot !== 0)
        ? `${key}|fh${flipH ? 1 : 0}|fv${flipV ? 1 : 0}|r${rot}`
        : null;

      // base drawable 也要纳入 LRU（否则 decodedCache 会长期强引用导致无法回收）
      this.registerDrawable(base, -1);
      this.touchDrawable(base);
      this.attachCacheKey(base, baseKey, false);

      // 先写入 index->drawable，再纳入 LRU 与 key 追踪
      if (drawable) {
        this.scene.spriteDrawableByIndex.set(idx, drawable);
        this.registerDrawable(drawable, idx);
        this.touchDrawable(drawable);
        if (transformedKey) this.attachCacheKey(drawable, transformedKey, true);
      }
      return;


    } else {
      drawable = await decodePngBytesToDrawable(bytes, node.name, this.decodePolicy);
      if (!drawable) return;

      const flipH = !!node.raw?.flipped_h, flipV = !!node.raw?.flipped_v;
      const rot = ((Math.floor(Number(node.raw?.rotated) || 0) % 4) + 4) % 4;
      node._texXform = drawable._isAnimated && (flipH || flipV || rot !== 0) ? { flipH, flipV, rot } : null;
      if (!drawable._isAnimated) {
        node._texXform = null;
        drawable = applySpriteTextureTransforms(drawable, node.raw);
      }
    }

    if (!drawable) return;
    this.scene.spriteDrawableByIndex.set(idx, drawable);
    this.registerDrawable(drawable, idx);
    this.touchDrawable(drawable);
  }

  private attachCacheKey(drawable: any, key: string, transformed: boolean): void {
    const e = this.lruByDrawable.get(drawable);
    if (!e) return;
    if (transformed) e.transformedKeys.add(key);
    else e.cacheKeys.add(key);
  }

  private registerDrawable(drawable: any, idx: number): void {
    const now = performance.now();
    let e = this.lruByDrawable.get(drawable);
    if (!e) {
      const sz = getImageSize(drawable);
      const bytes = Math.max(0, Math.floor((sz.w || 0) * (sz.h || 0) * 4));
      e = {
        bytes,
        lastUsed: now,
        indices: new Set<number>(),
        cacheKeys: new Set<string>(),
        transformedKeys: new Set<string>(),
      };
      this.lruByDrawable.set(drawable, e);
      this.totalBytes += bytes;
    }
    e.indices.add(idx);
  }
}


// ============================================================================
// Deep clone / state machine
// ============================================================================


function deepClone(v: any): any {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(deepClone);
  if (v instanceof Uint8Array) return new Uint8Array(v);
  if (typeof v === "object") { const o: any = {}; for (const k of Object.keys(v)) o[k] = deepClone(v[k]); return o; }
  return v;
}

function cloneStateDefaults(): any {
  return deepClone((globalThis as any).ModelNormalizer?.STATE_DEFAULTS || {});
}

function applyStatePatchInPlace(state: any, patch: any) {
  if (!state || !patch) return state;
  for (const k of Object.keys(patch)) state[k] = deepClone(patch[k]);
  return state;
}

function materializeNodeState(node: RuntimeNode, id: number) {
  if (node.materializedStates[id]) { node.runtimeState = node.materializedStates[id]; return; }
  const patch = node.savedStatePatches[id] ?? null;
  const next = deepClone(node.runtimeState || cloneStateDefaults());
  if (patch) applyStatePatchInPlace(next, patch);
  node.materializedStates[id] = next;
  node.runtimeState = next;
}

function resetNodeAnimation(node: RuntimeNode, st: any) {
  node.runtimeFrame = 0; node.runtimeFrameOverride = null; node._frameAcc = 0;
}

function materializeSceneState(scene: RuntimeScene, targetStateId: number) {
  const count = Math.max(1, Math.floor(Number(scene.model?.stateCount) || 1));
  const id = clamp(Math.floor(targetStateId || 0), 0, count - 1);
  for (const n of scene.nodes) materializeNodeState(n, id);
  scene.stateId = id;
  for (const n of scene.nodes) {
    const st = n.getState(scene.stateId);
    if (st?.should_reset_state) resetNodeAnimation(n, st);
  }
}

function initNodeStateMachine(scene: RuntimeScene) {
  const count = Math.max(1, Math.floor(Number(scene.model?.stateCount) || 1));
  for (const n of scene.nodes) {
    n.savedStatePatches = Array.isArray(n.raw?.states) ? n.raw.states : new Array(count);
    n.materializedStates = new Array(count);
    n.runtimeState = cloneStateDefaults();
  }
  materializeSceneState(scene, 0);
}


// ============================================================================
// Node paths / hierarchy
// ============================================================================

function idPartForNode(node: RuntimeNode) {
  return node.spriteId !== null && node.spriteId !== undefined ? `id${node.spriteId}` : `i${node.index}`;
}

function assignNodePaths(scene: RuntimeScene) {
  function walk(node: RuntimeNode, parent: RuntimeNode | null) {
    const idPart = idPartForNode(node);
    node.pathIds = parent ? `${parent.pathIds}/${idPart}` : idPart;
    node.path = parent ? `${parent.path}/${node.name || idPart}` : (node.name || idPart);
    node.key = node.pathIds;
    for (const c of node.children) walk(c, node);
  }
  for (const r of scene.roots) walk(r, null);
}

// ============================================================================
// Mouth helpers
// ============================================================================

function getMouthKeyForState(scene: RuntimeScene, st: any, baseKey: string): string {
  if (!st || !baseKey || st.shared_movement) return baseKey;
  const mouth = Math.floor(Number(scene.mouthState ?? 0));
  const prefix = mouth === 1 ? "mo_" : mouth === 2 ? "scream_" : "";
  if (prefix) { const k = `${prefix}${baseKey}`; if (k in st) return k; }
  return baseKey;
}
function getMouthNumber(scene: RuntimeScene, st: any, baseKey: string, fallback = 0): number {
  const n = Number(st?.[getMouthKeyForState(scene, st, baseKey)]);
  return Number.isFinite(n) ? n : fallback;
}
function getMouthBool(scene: RuntimeScene, st: any, baseKey: string, fallback = false): boolean {
  const v = st?.[getMouthKeyForState(scene, st, baseKey)];
  if (typeof v === "boolean") return v;
  if (v === 0 || v === 1) return !!v;
  return fallback;
}

// ============================================================================
// Hotkey helpers (saved_keys / saved_disappear)
// ============================================================================

function normalizeKeyName(key: any): string {
  const s = String(key || "").trim().toUpperCase();
  if (!s) return "";

  // Accept F1..F12
  const m = /^F(\d{1,2})$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 12) return `F${n}`;
  }

  // Common variants
  if (s.startsWith("KEY_")) return normalizeKeyName(s.slice(4));
  return s;
}

function normalizeSavedDisappearEvent(ev: any): { hotkey: string; label: string } {
  if (!ev) return { hotkey: "", label: "" };

  // Some exports use plain strings like "F2"
  if (typeof ev === "string") {
    const k = normalizeKeyName(ev);
    return { hotkey: k, label: k || ev };
  }

  // Numbers might be keycode
  if (typeof ev === "number") {
    // Godot F1..F12 keycodes are not guaranteed here, so keep as label.
    return { hotkey: "", label: String(ev) };
  }

  // Object: try best-effort map to F1..F12 (matches preview tool behavior)
  if (typeof ev === "object") {
    const keycode = Number((ev as any).keycode ?? (ev as any).physical_keycode ?? (ev as any).physicalKeycode ?? NaN);
    if (Number.isFinite(keycode)) {
      // Godot 4: F1..F12 often map around 112..123 (browser-like). Best-effort.
      if (keycode >= 112 && keycode <= 123) {
        const k = `F${keycode - 111}`;
        return { hotkey: k, label: k };
      }
    }

    const keyText = (ev as any).key ?? (ev as any).as_text ?? (ev as any).asText ?? (ev as any).text;
    if (typeof keyText === "string") {
      const k = normalizeKeyName(keyText);
      return { hotkey: k, label: k || keyText };
    }

    return { hotkey: "", label: String((ev as any).type || "") };
  }

  return { hotkey: "", label: String(ev) };
}

function buildHotkeyGroups(scene: RuntimeScene) {
  // Match preview tool semantics (other-tool/pngRemix预览):
  // - `saved_keys` and `saved_disappear` are both treated as "hide on key".
  // - When hotkey k is applied: visible = !savedKeys.has(k)
  const groupsByParent = new Map<any, {
    parentId: any;
    nodes: Array<{ node: RuntimeNode; savedKeys: Set<string> }>;
  }>();
  const available = new Set<string>();

  for (const n of scene.nodes) {
    const raw = n.raw || {};
    if (raw.is_asset !== true) continue;

    const saved = Array.isArray((raw as any).saved_keys) ? (raw as any).saved_keys : [];
    const keysFromSavedKeys = saved
      .map(normalizeKeyName)
      .filter((x: string) => x.length > 0);

    const disappear = Array.isArray((raw as any).saved_disappear) ? (raw as any).saved_disappear : [];
    const keysFromDisappear: string[] = [];
    for (const ev of disappear) {
      const { hotkey } = normalizeSavedDisappearEvent(ev);
      if (hotkey) keysFromDisappear.push(hotkey);
    }

    const savedKeys = new Set<string>([...keysFromSavedKeys, ...keysFromDisappear]);
    if (savedKeys.size === 0) continue;

    const pid = n.parentId ?? null;
    if (!groupsByParent.has(pid)) {
      groupsByParent.set(pid, { parentId: pid, nodes: [] });
    }

    const g = groupsByParent.get(pid)!;
    g.nodes.push({ node: n, savedKeys });

    for (const k of savedKeys) available.add(k);
  }

  scene.hotkeyGroups = Array.from(groupsByParent.values());
  scene.availableHotkeys = available;
}



// ============================================================================
// Blink system
// ============================================================================


function getBlinkSpeedSeconds(features: PngRemixConfig["features"]): number {
  const s = Number(features?.blink_speed); return Number.isFinite(s) && s > 0 ? s : 1;
}
function getBlinkChance(features: PngRemixConfig["features"]): number {
  const c = Number(features?.blink_chance); return Number.isFinite(c) && c >= 1 ? Math.floor(c) : 10;
}
function getBlinkHoldSeconds(features: PngRemixConfig["features"]): number {
  return (features?.blink_hold_ratio ?? 0.2) * getBlinkSpeedSeconds(features);
}

// ============================================================================
// computeSceneBaseWorldPositions
// ============================================================================

function computeSceneBaseWorldPositions(scene: RuntimeScene) {
  function visit(node: RuntimeNode, parentMat: Mat2D) {
    const st = node.getState(scene.stateId); if (!st) return;
    const pos = st.position || { x: 0, y: 0 };
    const offset = st.offset || { x: 0, y: 0 };
    const scale = st.scale || { x: 1, y: 1 };
    const rotation = Number(st.rotation) || 0;
    let baseMat = parentMat
      .multiply(Mat2D.translate(Number(pos.x) || 0, Number(pos.y) || 0))
      .multiply(Mat2D.rotate(rotation))
      .multiply(Mat2D.scale(Number(scale.x) || 1, Number(scale.y) || 1));
    let spriteMat = baseMat.multiply(Mat2D.translate(Number(offset.x) || 0, Number(offset.y) || 0));
    if (st.flip_sprite_h || st.flip_sprite_v)
      spriteMat = spriteMat.multiply(Mat2D.scale(st.flip_sprite_h ? -1 : 1, st.flip_sprite_v ? -1 : 1));
    const p = spriteMat.applyToPoint(0, 0);
    node.baseWorldPos.x = p.x; node.baseWorldPos.y = p.y;
    for (const c of node.children) visit(c, spriteMat);
  }
  for (const r of scene.roots) visit(r, Mat2D.identity());
}

// ============================================================================
// stepNodeRuntime — 单节点每帧更新
// ============================================================================

/**
 * 单节点的每帧更新：推进帧动画、鼠标跟随、彩虹/摆动/移动等组合效果。
 *
 * 注意：该函数会同时更新 runtimeFrame 与跟随/移动的缓冲状态，
 * 是 PngRemix 动画效果的核心路径。
 */
function stepNodeRuntime(scene: RuntimeScene, node: RuntimeNode, dtSec: number, enableMouseFollow: boolean, mouseWorld: Vec2, hasMouse: boolean) {

  const st = node.getState(scene.stateId); if (!st) return;

  const shouldDelta = scene.model?.settings?.should_delta !== false;
  const smoothing = 1 - Math.pow(1 - 0.05, dtSec * 60);

  // --- Sprite sheet animation ---
  const hf = Math.max(1, Math.floor(Number(st.hframes) || 1));
  const vf = Math.max(1, Math.floor(Number(st.vframes) || 1));
  const total = hf * vf;

  if (st.non_animated_sheet || total <= 1 || st.advanced_lipsync) {
    node.runtimeFrame = null; node._frameAcc = 0;
  } else {
    const speed = Math.max(0, Number(st.animation_speed) || 0);
    if (node.runtimeFrame === null || node.runtimeFrame === undefined) node.runtimeFrame = Math.floor(Number(st.frame) || 0);
    if (speed > 0) {
      node._frameAcc += dtSec * speed;
      const steps = Math.floor(node._frameAcc);
      if (steps > 0) {
        node._frameAcc -= steps;
        const cur = Math.floor(node.runtimeFrame || 0);
        node.runtimeFrame = st.one_shot ? Math.min(total - 1, cur + steps) : ((cur + steps) % total + total) % total;
      }
    }
  }

  // --- animate_to_mouse ---
  node.runtimeFrameOverride = null;
  if (enableMouseFollow && st.non_animated_sheet && st.animate_to_mouse && total > 1) {
    const base = node.baseWorldPos;
    const mx = mouseWorld.x - base.x, my = mouseWorld.y - base.y;
    const dist = Math.hypot(mx, my);
    const dirx = dist > 1e-6 ? mx / dist : 0, diry = dist > 1e-6 ? my / dist : 0;
    const rangeX = Math.max(0, getMouthNumber(scene, st, "look_at_mouse_pos", 0));
    const rangeY = Math.max(0, getMouthNumber(scene, st, "look_at_mouse_pos_y", 0));
    if (rangeX > 1e-6 && rangeY > 1e-6) {
      const distX = dirx * Math.min(dist, rangeX), distY = diry * Math.min(dist, rangeY);
      const normX = distX / (2 * rangeX) + 0.5, normY = distY / (2 * rangeY) + 0.5;
      const frameX = clamp(Math.floor(normX * hf), 0, hf - 1);
      const frameY = clamp(Math.floor(normY * vf), 0, vf - 1);
      const speed2 = Math.max(0, Number(st.animate_to_mouse_speed) || 0);
      const step = speed2 * (shouldDelta ? dtSec * 60 : 1);
      node._follow.frameH = moveToward(node._follow.frameH, frameX, step);
      node._follow.frameV = moveToward(node._follow.frameV, frameY, step);
      node.runtimeFrameOverride = Math.floor(node._follow.frameV) * hf + Math.floor(node._follow.frameH);
    }
  }

  // --- Wiggle ---
  if (st.wiggle) {
    const target = Math.sin((scene.tick || 0) * (Number(st.wiggle_freq) || 0)) * toRad(Number(st.wiggle_amp) || 0);
    node.runtimeWiggleRotation = lerp(node.runtimeWiggleRotation, target, smoothing);
  } else { node.runtimeWiggleRotation = lerp(node.runtimeWiggleRotation, 0, smoothing); }
  if (st.follow_parent_effects) {
    const parent = scene.nodeBySpriteId.get(node.parentId);
    if (parent) node.runtimeWiggleRotation = parent.runtimeWiggleRotation || 0;
  }

  // --- Rainbow ---
  if (st.rainbow) {
    if (!Number.isFinite(node._rainbowHue)) {
      const base = st.tint || { r: 1, g: 1, b: 1 };
      node._rainbowHue = rgbToHsv(base.r ?? 1, base.g ?? 1, base.b ?? 1).h;
    }
    node._rainbowHue = wrap01(node._rainbowHue + (Number(st.rainbow_speed) || 0) * dtSec);
  } else { node._rainbowHue = Number.NaN; }

  // --- Follow type / rotation / scale ---
  const followType = Math.floor(getMouthNumber(scene, st, "follow_type", 15));
  const followType2 = Math.floor(getMouthNumber(scene, st, "follow_type2", 15));
  const followType3 = Math.floor(getMouthNumber(scene, st, "follow_type3", 15));
  const mouseDelayRaw = clamp(getMouthNumber(scene, st, "mouse_delay", 0.1), 0, 1);

  // Godot/PngRemix 的跟随逻辑默认是按 60Hz tick 重复执行 lerp(x, target, mouse_delay)。
  // 如果我们只在低帧率下每帧执行一次，视觉上会变慢（例如 20fps 会慢约 3 倍）。
  // 这里把每帧 dt 合成为等价的 lerp 系数：tEff = 1 - (1 - t)^(dt*60)
  // 这样无论 render fps 如何变化，跟随速度都能与 60Hz tick 保持一致。
  const followTicks = shouldDelta ? Math.max(0, dtSec) * 60 : 1;
  const tEff = clamp(1 - Math.pow(1 - mouseDelayRaw, followTicks), 0, 1);
  const tPos = tEff;
  const tRs = tEff;

  const base = node.baseWorldPos;
  const mouseCoords = (enableMouseFollow && hasMouse) ? { x: mouseWorld.x - base.x, y: mouseWorld.y - base.y } : { x: 0, y: 0 };
  const mouseDist = Math.hypot(mouseCoords.x, mouseCoords.y);
  const mouseDir = mouseDist > 1e-6 ? { x: mouseCoords.x / mouseDist, y: mouseCoords.y / mouseDist } : { x: 0, y: 0 };

  // follow_mouse_velocity
  if (enableMouseFollow && hasMouse && getMouthBool(scene, st, "follow_mouse_velocity", false)) {
    const last = node._follow.lastMouseCoords;
    const md = { x: last.x - mouseCoords.x, y: last.y - mouseCoords.y };
    if (Math.abs(md.x) > 1e-6 || Math.abs(md.y) > 1e-6) {
      node._follow.lastMouseCoords = { x: mouseCoords.x, y: mouseCoords.y };
    }
    const dv = { x: Math.tanh(md.x), y: Math.tanh(md.y) };
    const dirVelX = -Math.sign(md.x), dirVelY = -Math.sign(md.y);
    const lenV = Math.hypot(dv.x, dv.y);
    const lookX = getMouthNumber(scene, st, "look_at_mouse_pos", 0);
    const lookY = getMouthNumber(scene, st, "look_at_mouse_pos_y", 0);
    node._follow.lastDist.x = lerp(node._follow.lastDist.x, dirVelX * lenV * lookX, 0.5);
    node._follow.lastDist.y = lerp(node._follow.lastDist.y, dirVelY * lenV * lookY, 0.5);
    node._follow.dirVelAnimX = md.x; node._follow.dirVelAnimY = md.y;
  }

  // Helper: followPositionCalculations
  // 注意：这里不要再对 targetPos 做一次 lerp。
  // 因为后面 runtimeFollowPos 还会 lerp(targetPos)，对"移动目标"会形成二阶低通，体感更黏、更滞后。
  // 直接计算目标位置（targetPos），只保留 runtimeFollowPos 的一次平滑即可。
  function followPositionCalculations(dir: Vec2, mDist: Vec2 | null) {
    const posXMin = getMouthNumber(scene, st, "pos_x_min", 0);
    const posXMax = getMouthNumber(scene, st, "pos_x_max", 0);
    const posYMin = getMouthNumber(scene, st, "pos_y_min", 0);
    const posYMax = getMouthNumber(scene, st, "pos_y_max", 0);

    const snap = !!st.snap_pos;

    let tx = 0;
    let ty = 0;

    if (mDist && (mDist.x !== 0 || mDist.y !== 0)) {
      tx = clamp(dir.x * mDist.x, posXMin, posXMax);
      ty = clamp(dir.y * mDist.y, posYMin, posYMax);
    } else {
      const posNormX = clamp(dir.x, -1, 1), posNormY = clamp(dir.y, -1, 1);
      const fx = Math.max(0.001, posNormX * 0.5 + 0.5), fy = Math.max(0.001, posNormY * 0.5 + 0.5);
      tx = lerp(posXMin, posXMax, fx);
      ty = lerp(posYMin, posYMax, fy);
    }

    if (snap) {
      if (dir.x !== 0) { node._follow.targetPos.x = tx; node._follow.currentDir.x = dir.x; }
      if (dir.y !== 0) { node._follow.targetPos.y = ty; node._follow.currentDir.y = dir.y; }
    } else {
      node._follow.targetPos.x = tx;
      node._follow.targetPos.y = ty;
      node._follow.currentDir.x = dir.x; node._follow.currentDir.y = dir.y;
    }

    node._follow.currentDist = Math.hypot(node._follow.targetPos.x, node._follow.targetPos.y);
  }

  // --- position ---
  if (followType === 15) {
    node._follow.targetPos.x = 0; node._follow.targetPos.y = 0;
    node.runtimeFollowPos.x = lerp(node.runtimeFollowPos.x, 0, tPos);
    node.runtimeFollowPos.y = lerp(node.runtimeFollowPos.y, 0, tPos);
  } else {
    if (followType === 0) {
      if (enableMouseFollow && hasMouse) {
        if (getMouthBool(scene, st, "follow_mouse_velocity", false))
          followPositionCalculations(mouseDir, node._follow.lastDist);
        else followPositionCalculations(mouseDir, { x: mouseDist, y: mouseDist });
      } else {
        node._follow.targetPos.x = lerp(node._follow.targetPos.x, 0, tPos);
        node._follow.targetPos.y = lerp(node._follow.targetPos.y, 0, tPos);
      }
    }
    if (st.animate_to_mouse && st.non_animated_sheet && !st.animate_to_mouse_track_pos) {
      node.runtimeFollowPos.x = lerp(node.runtimeFollowPos.x, 0, tPos);
      node.runtimeFollowPos.y = lerp(node.runtimeFollowPos.y, 0, tPos);
    } else {
      const invertX = getMouthBool(scene, st, "pos_invert_x", false);
      const invertY = getMouthBool(scene, st, "pos_invert_y", false);
      node.runtimeFollowPos.x = lerp(node.runtimeFollowPos.x, invertX ? -node._follow.targetPos.x : node._follow.targetPos.x, tPos);
      node.runtimeFollowPos.y = lerp(node.runtimeFollowPos.y, invertY ? -node._follow.targetPos.y : node._follow.targetPos.y, tPos);
    }
  }

  // --- rotation ---
  if (followType2 === 15) {
    node.runtimeFollowRot = lerpAngle(node.runtimeFollowRot, 0, tRs);
  } else {
    const toRadMaybe = (v: number) => { const n = Number(v) || 0; return Math.abs(n) > 6.5 ? toRad(n) : n; };
    function followControllerRotation(axis: Vec2) {
      const normalized = clamp(axis.x, -1, 1);
      const rotMin = toRadMaybe(getMouthNumber(scene, st, "rot_min", 0));
      const rotMax = toRadMaybe(getMouthNumber(scene, st, "rot_max", 0));
      const safeMin = clamp(getMouthNumber(scene, st, "rLimitMin", -180), -360, 360);
      const safeMax = clamp(getMouthNumber(scene, st, "rLimitMax", 180), -360, 360);
      return clamp(lerp(rotMin, rotMax, Math.max((normalized + 1) / 2, 0.001)), toRad(safeMin), toRad(safeMax));
    }
    let targetRot = 0;
    if (followType2 === 0) {
      if (!enableMouseFollow || !hasMouse) targetRot = 0;
      else if (getMouthBool(scene, st, "follow_mouse_velocity", false)) {
        const vx = node._follow.dirVelAnimX || 0;
        const normX = Math.abs(vx) > 1e-6 ? vx / Math.abs(vx) : 0;
        const normalizedMouse = clamp(normX / 2, -1, 1);
        const rotMin = toRadMaybe(getMouthNumber(scene, st, "rot_min", 0));
        const rotMax = toRadMaybe(getMouthNumber(scene, st, "rot_max", 0));
        const safeMin = clamp(getMouthNumber(scene, st, "rLimitMin", -180), -360, 360);
        const safeMax = clamp(getMouthNumber(scene, st, "rLimitMax", 180), -360, 360);
        targetRot = clamp(normalizedMouse * lerp(rotMin, rotMax, Math.max(0.01, normalizedMouse * 0.5)) * toRad(90), toRad(safeMin), toRad(safeMax));
      } else {
        targetRot = followControllerRotation({ x: mouseDir.x, y: 0 });
      }
    }
    node.runtimeFollowRot = lerpAngle(node.runtimeFollowRot, targetRot, tRs);
  }

  // --- scale ---
  if (followType3 === 15) {
    node.runtimeFollowScale.x = lerp(node.runtimeFollowScale.x, 1, tRs);
    node.runtimeFollowScale.y = lerp(node.runtimeFollowScale.y, 1, tRs);
  } else {
    const sMinX = getMouthNumber(scene, st, "scale_x_min", 0), sMaxX = getMouthNumber(scene, st, "scale_x_max", 0);
    const sMinY = getMouthNumber(scene, st, "scale_y_min", 0), sMaxY = getMouthNumber(scene, st, "scale_y_max", 0);
    let xVal = 0, yVal = 0;
    if (followType3 === 0) {
      if (!enableMouseFollow || !hasMouse) { xVal = 0; yVal = 0; }
      else if (getMouthBool(scene, st, "follow_mouse_velocity", false)) {
        const vx = node._follow.dirVelAnimX || 0;
        const normX = Math.abs(vx) > 1e-6 ? vx / Math.abs(vx) : 0;
        const nm = clamp(normX / 2, -1, 1);
        xVal = lerp(sMinX, sMaxX, Math.max(0.01, nm / 2));
        yVal = lerp(sMinY, sMaxY, Math.max(0.01, nm / 2));
      } else {
        xVal = clamp(mouseDir.x, sMinX, sMaxX); yVal = clamp(mouseDir.y, sMinY, sMaxY);
      }
    }
    if (getMouthBool(scene, st, "scale_invert_x", false)) xVal *= -1;
    if (getMouthBool(scene, st, "scale_invert_y", false)) yVal *= -1;
    node.runtimeFollowScale.x = lerp(node.runtimeFollowScale.x, 1 - clamp(xVal, sMinX, sMaxX), tRs);
    node.runtimeFollowScale.y = lerp(node.runtimeFollowScale.y, 1 - clamp(yVal, sMinY, sMaxY), tRs);
  }

  // --- movements ---
  const xAmp = getMouthNumber(scene, st, "xAmp", 0), xFrq = getMouthNumber(scene, st, "xFrq", 0);
  const yAmp = getMouthNumber(scene, st, "yAmp", 0), yFrq = getMouthNumber(scene, st, "yFrq", 0);
  const dragSpeed = getMouthNumber(scene, st, "dragSpeed", 0);
  const stretchAmount = getMouthNumber(scene, st, "stretchAmount", 0);
  const rdragStr = getMouthNumber(scene, st, "rdragStr", 0);
  const rotFrq = getMouthNumber(scene, st, "rot_frq", 0);
  const rLimitMin = getMouthNumber(scene, st, "rLimitMin", -180);
  const rLimitMax = getMouthNumber(scene, st, "rLimitMax", 180);

  const dragSnap = getMouthNumber(scene, st, "drag_snap", 999999);
  if (Number.isFinite(dragSnap) && dragSnap !== 999999) {
    if (node._move.hasLastBaseWorldPos) {
      const dd = Math.hypot(base.x - node._move.lastBaseWorldPos.x, base.y - node._move.lastBaseWorldPos.y);
      if (dd > dragSnap) { node._move.shadow.x = 0; node._move.shadow.y = 0; node._move.prevShadow.x = 0; node._move.prevShadow.y = 0; }
    }
    node._move.lastBaseWorldPos.x = base.x; node._move.lastBaseWorldPos.y = base.y;
    node._move.hasLastBaseWorldPos = true;
  }

  if (st.pause_movement) {
    const ud = shouldDelta ? dtSec : 1 / 60;
    node._move.pausedWobble.x += ud; node._move.pausedWobble.y += ud; node._move.pausedRot += ud;
  }

  const wobbleX = xAmp && xFrq ? Math.sin((scene.tick - node._move.pausedWobble.x) * xFrq) * xAmp : 0;
  const wobbleY = yAmp && yFrq ? Math.sin((scene.tick - node._move.pausedWobble.y) * yFrq) * yAmp : 0;

  // Auto rotation
  node.runtimeAutoRot = 0;
  if (getMouthBool(scene, st, "should_rotate", false)) {
    const speed3 = getMouthNumber(scene, st, "should_rot_speed", 0);
    node._move.shouldRot += speed3 * (shouldDelta ? dtSec * 60 : 1);
    node.runtimeAutoRot = node._move.shouldRot;
  } else { node._move.shouldRot = 0; }

  const targetPos = { x: (node.runtimeFollowPos.x || 0) + wobbleX, y: (node.runtimeFollowPos.y || 0) + wobbleY };
  node._move.prevShadow.x = node._move.shadow.x; node._move.prevShadow.y = node._move.shadow.y;

  if (dragSpeed > 0) {
    const tt = clamp(1 / dragSpeed, 0, 1);
    node._move.shadow.x = lerp(node._move.shadow.x, targetPos.x, tt);
    node._move.shadow.y = lerp(node._move.shadow.y, targetPos.y, tt);
  } else {
    node._move.shadow.x = lerp(node._move.shadow.x, targetPos.x, 0.85);
    node._move.shadow.y = lerp(node._move.shadow.y, targetPos.y, 0.85);
  }
  node.runtimeMovePos.x = node._move.shadow.x; node.runtimeMovePos.y = node._move.shadow.y;

  let length = (node._move.prevShadow.x - node._move.shadow.x) - (node._move.prevShadow.y - node._move.shadow.y);
  if (st.physics !== false) {
    const parent = scene.nodeBySpriteId.get(node.parentId);
    if (parent?._move) length += (parent._move.prevShadow.x - parent._move.shadow.x) + (parent._move.prevShadow.y - parent._move.shadow.y);
  }
  if (!st.ignore_bounce) length -= scene.bounceChange || 0;

  if (stretchAmount) {
    const yvel = length * stretchAmount * 0.01 * 0.5;
    node._move.scale.x = lerp(node._move.scale.x, 1 - yvel, 0.15);
    node._move.scale.y = lerp(node._move.scale.y, 1 + yvel, 0.15);
  } else {
    node._move.scale.x = lerp(node._move.scale.x, 1, 0.15);
    node._move.scale.y = lerp(node._move.scale.y, 1, 0.15);
  }
  node.runtimeMoveScale.x = node._move.scale.x; node.runtimeMoveScale.y = node._move.scale.y;

  let rot = 0;
  if (rotFrq && rdragStr) rot = Math.sin((scene.tick - node._move.pausedRot) * rotFrq) * toRad(rdragStr);
  node._move.rot = lerpAngle(node._move.rot, rot, 0.15);
  if (rdragStr) {
    let yvel2 = clamp(length * rdragStr * 0.5, Math.min(rLimitMin, rLimitMax), Math.max(rLimitMin, rLimitMax));
    node._move.rot = lerpAngle(node._move.rot, toRad(yvel2), 0.15);
  }
  node.runtimeMoveRot = node._move.rot;
}

// ============================================================================
// stepSceneRuntime
// ============================================================================

function stepSceneRuntime(scene: RuntimeScene, dtSec: number, enableMouseFollow: boolean, mouseWorld: Vec2, hasMouse: boolean) {
  computeSceneBaseWorldPositions(scene);
  function walk(n: RuntimeNode) {
    stepNodeRuntime(scene, n, dtSec, enableMouseFollow, mouseWorld, hasMouse);
    for (const c of n.children) walk(c);
  }
  for (const r of scene.roots) walk(r);
}

// ============================================================================
// updateGlobalBounce
// ============================================================================

function updateGlobalBounce(scene: RuntimeScene, dtSec: number, features: PngRemixConfig["features"]) {
  const settings = scene.model?.settings || {};
  const enabled = !!settings.bounce_state;
  const yAmpV = enabled ? (Number(settings.yAmp) || 0) : 0;
  const yFrqV = enabled ? (Number(settings.yFrq) || 0) : 0;

  const targetY = yAmpV && yFrqV ? Math.sin(scene.tick * yFrqV) * yAmpV : 0;
  const sm = 1 - Math.pow(1 - 0.08, dtSec * 60);
  scene._bouncePosY = lerp(scene._bouncePosY, targetY, clamp(sm, 0, 1));

  let clickY = 0;
  if (features.click_bounce && scene._clickBounce.active) {
    const cb = scene._clickBounce;
    cb.t += Math.max(0, dtSec);
    const dur = Math.max(0.05, cb.dur);
    const p = clamp(cb.t / dur, 0, 1);
    clickY = -Math.sin(p * Math.PI) * Math.max(0, cb.amp);
    if (p >= 1) cb.active = false;
  }

  const bounceY = scene._bouncePosY + clickY;
  scene.viewerJumpY = bounceY;
  const hold = scene._lastBounceY || 0;
  scene.bounceChange = hold - bounceY;
  scene._lastBounceY = bounceY;
}

// ============================================================================
// buildDrawList
// ============================================================================

interface DrawItem {
  order: number; z: number; mat: Mat2D; clip: any[];
  alpha: number; blend: GlobalCompositeOperation; drawable: any; texXform: any;
  hf: number; vf: number; frame: number;
}

/**
 * 构建可绘制列表：按树遍历计算可见性、颜色、变换与裁剪栈。
 *
 * 输出的 DrawItem 会在后续排序并逐项渲染。
 */
function buildDrawList(scene: RuntimeScene, rootSpriteMat: Mat2D): DrawItem[] {

  const items: DrawItem[] = [];
  for (const n of scene.nodes) n._visibleNow = false;
  const orderCounter = { v: 0 };
  const clipStack: any[] = [];

  function visit(node: RuntimeNode, parentSpriteMat: Mat2D, parentZ: number, inheritedRainbowHue: number | null) {
    const st = node.getState(scene.stateId); if (!st) return;
    const overrideRaw = scene.visibilityOverrides[node.key];
    const override = overrideRaw && typeof overrideRaw === "object" ? overrideRaw : null;
    const overrideValue = override ? override.visible : overrideRaw;
    if (overrideValue === false) return;

    let visible = st.visible !== false;
    const baseModulate = mulColor(st.colored, st.tint);

    let rainbowHueForSelf: number | null = null;
    let rainbowHueForChildren = inheritedRainbowHue;
    if (st.rainbow && Number.isFinite(node._rainbowHue)) {
      const hq = quantize01(node._rainbowHue, 60);
      rainbowHueForSelf = hq;
      if (!st.rainbow_self) rainbowHueForChildren = hq;
    } else if (Number.isFinite(inheritedRainbowHue ?? NaN)) {
      rainbowHueForSelf = inheritedRainbowHue;
    }

    let modulate = baseModulate;
    if (Number.isFinite(rainbowHueForSelf ?? NaN)) {
      const hsv = rgbToHsv(baseModulate.r, baseModulate.g, baseModulate.b);
      const rgb = hsvToRgb(rainbowHueForSelf!, 1, hsv.v);
      modulate = { r: rgb.r, g: rgb.g, b: rgb.b, a: baseModulate.a };
    }
    const alpha = clamp(modulate.a, 0, 1);

    if (node.raw?.is_asset && overrideValue !== true) {
      visible = visible && !!node.raw.was_active_before;
    }
    if (st.should_talk) {
      const openMouth = !!st.open_mouth;
      const mouthOpenNow = Math.floor(scene.mouthState) !== 0;
      visible = visible && (mouthOpenNow ? openMouth : !openMouth);
    }
    if (st.should_blink) {
      const openEyes = !!st.open_eyes;
      visible = visible && (scene.blinking ? !openEyes : openEyes);
    }
    if (!visible || alpha <= 0.001) return;

    node._visibleNow = true;
    if (!node._visiblePrev && (st.should_reset || st.one_shot)) resetNodeAnimation(node, st);

    const localZ = Number(st.z_index ?? 0) || 0;
    const z = parentZ + localZ;
    const pos = st.position || { x: 0, y: 0 };
    const offset = st.offset || { x: 0, y: 0 };
    const followPos = node.runtimeFollowPos, movePos = node.runtimeMovePos;
    const posX = (Number(pos.x) || 0) + (followPos.x || 0) + (movePos.x || 0);
    const posY = (Number(pos.y) || 0) + (followPos.y || 0) + (movePos.y || 0);
    const baseScale = st.scale || { x: 1, y: 1 };
    const followScale = node.runtimeFollowScale, moveScale = node.runtimeMoveScale;
    const scale = {
      x: (Number(baseScale.x) || 1) * (followScale.x || 1) * (moveScale.x || 1),
      y: (Number(baseScale.y) || 1) * (followScale.y || 1) * (moveScale.y || 1),
    };
    const rotation = (Number(st.rotation) || 0)
      + (node.runtimeWiggleRotation || 0) + (node.runtimeFollowRot || 0)
      + (node.runtimeMoveRot || 0) + (node.runtimeAutoRot || 0);

    let baseMat = parentSpriteMat
      .multiply(Mat2D.translate(posX, posY))
      .multiply(Mat2D.rotate(rotation))
      .multiply(Mat2D.scale(scale.x || 1, scale.y || 1));
    let spriteMat = baseMat.multiply(Mat2D.translate(Number(offset.x) || 0, Number(offset.y) || 0));
    if (st.flip_sprite_h || st.flip_sprite_v)
      spriteMat = spriteMat.multiply(Mat2D.scale(st.flip_sprite_h ? -1 : 1, st.flip_sprite_v ? -1 : 1));

    let drawable = scene.spriteDrawableByIndex.get(node.index);

    // 按需解码：仅当节点真的可见时才触发贴图解码
    if (!drawable && scene.textureManager) {
      scene.textureManager.request(node);
    }

    if (drawable && scene.textureManager) {
      scene.textureManager.touchDrawable(drawable);
    }

    const tintedDrawable = drawable ? getTintedDrawable(drawable, modulate) : null;

    if (tintedDrawable) {
      items.push({
        order: orderCounter.v++, z, mat: spriteMat, clip: clipStack.slice(),
        alpha, blend: compositeForBlendMode(st.blend_mode),
        drawable: tintedDrawable, texXform: node._texXform || null,
        hf: st.hframes ?? 1, vf: st.vframes ?? 1,
        frame: node.runtimeFrameOverride ?? node.runtimeFrame ?? st.frame ?? 0,
      });
    }

    const shouldClipChildren = scene.enableClip && Number(st.clip || 0) !== 0;
    let pushedClip = false;
    if (shouldClipChildren) {
      let w = 0, h = 0;
      if (drawable) {
        const s = getImageLogicalSize(drawable);
        w = s.w; h = s.h;
      } else if (scene.textureManager) {
        const s = scene.textureManager.getNodeLogicalSize(node);
        w = s.w; h = s.h;
      }

      if (w > 0 && h > 0) {
        const hfC = Math.max(1, Math.floor(Number(st.hframes) || 1));
        const vfC = Math.max(1, Math.floor(Number(st.vframes) || 1));
        clipStack.push({ mat: spriteMat, x: -w / hfC / 2, y: -h / vfC / 2, w: w / hfC, h: h / vfC });
        pushedClip = true;
      }
    }

    for (const c of node.children) visit(c, spriteMat, z, rainbowHueForChildren);
    if (pushedClip) clipStack.pop();

  }

  for (const r of scene.roots) visit(r, rootSpriteMat, 0, null);
  for (const n of scene.nodes) n._visiblePrev = !!n._visibleNow;
  return items;
}

// ============================================================================
// sortDrawItems / drawItem / renderScene
// ============================================================================

function sortDrawItems(list: DrawItem[]) {
  list.sort((a, b) => (a.z - b.z) || (a.order - b.order));
}

function drawItem(ctx: CanvasRenderingContext2D, item: DrawItem) {
  if (!item.drawable) return;
  const hadClip = item.clip.length > 0;
  if (hadClip) {
    ctx.save();
    for (const clip of item.clip) {
      ctx.setTransform(clip.mat.a, clip.mat.b, clip.mat.c, clip.mat.d, clip.mat.e, clip.mat.f);
      ctx.beginPath(); ctx.rect(clip.x, clip.y, clip.w, clip.h); ctx.clip();
    }
  }
  ctx.globalCompositeOperation = item.blend;
  ctx.globalAlpha = item.alpha;
  ctx.setTransform(item.mat.a, item.mat.b, item.mat.c, item.mat.d, item.mat.e, item.mat.f);
  const tx = item.texXform;
  if (tx && (tx.flipH || tx.flipV || tx.rot)) {
    ctx.save();
    ctx.rotate((Number(tx.rot) || 0) * Math.PI / 2);
    ctx.scale(tx.flipH ? -1 : 1, tx.flipV ? -1 : 1);
    drawImageFrame(ctx, item.drawable, item.hf, item.vf, item.frame);
    ctx.restore();
  } else {
    drawImageFrame(ctx, item.drawable, item.hf, item.vf, item.frame);
  }
  if (hadClip) ctx.restore();
}

function renderScene(scene: RuntimeScene, canvas: HTMLCanvasElement, zoom: number, panX: number, panY: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const center = Mat2D.translate(w / 2, h / 2)
    .multiply(Mat2D.translate(panX, panY))
    .multiply(Mat2D.scale(zoom, zoom));
  const jumpY = scene.viewerJumpY || 0;
  const rootMat = Math.abs(jumpY) > 1e-6 ? center.multiply(Mat2D.translate(0, jumpY)) : center;

  const items = buildDrawList(scene, rootMat);
  sortDrawItems(items);
  ctx.imageSmoothingEnabled = true;
  for (const it of items) drawItem(ctx, it);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  // LRU 回收：在每帧渲染后做一次预算检查
  scene.textureManager?.trim();
}


// ============================================================================
// buildRuntimeScene
// ============================================================================

async function buildRuntimeScene(normalizedModel: any, decodePolicy: TextureDecodePolicy | null = null): Promise<RuntimeScene> {

  const scene = new RuntimeScene(normalizedModel);

  scene.nodes = normalizedModel.sprites.map((s: any) => new RuntimeNode(s, s.index));
  for (const n of scene.nodes) if (n.spriteId !== null && n.spriteId !== undefined) scene.nodeBySpriteId.set(n.spriteId, n);

  scene.roots = [];
  for (const n of scene.nodes) n.children = [];
  for (const n of scene.nodes) {
    const parent = scene.nodeBySpriteId.get(n.parentId);
    if (parent && n.parentId !== null && n.parentId !== undefined) parent.children.push(n);
    else scene.roots.push(n);
  }
  assignNodePaths(scene);
  initNodeStateMachine(scene);
  buildHotkeyGroups(scene);

  // 保留压缩贴图 bytes（内存远小于解码后像素），用于按需解码 + LRU 反复回收/重建
  const spriteBytesByIndex: (Uint8Array | null)[] = new Array(scene.nodes.length).fill(null);
  for (let i = 0; i < scene.nodes.length; i++) {
    const spriteInfo = normalizedModel.sprites?.[i];
    const b = spriteInfo?.imgBytes;
    if (b instanceof Uint8Array && b.length >= 6) {
      spriteBytesByIndex[i] = b;
      // 解除 normalizedModel 对 bytes 的引用，便于后续释放 model 对象
      spriteInfo.imgBytes = null;
    }
  }

  scene.textureManager = new SpriteTextureManager(scene, spriteBytesByIndex, decodePolicy, {
    maxItems: TEXTURE_LRU_MAX_ITEMS_DEFAULT,
    maxBytes: TEXTURE_LRU_MAX_BYTES_DEFAULT,
  });

  return scene;
}



// ============================================================================
// fitViewToContent
// ============================================================================

function fitViewToContent(scene: RuntimeScene, canvasW: number, canvasH: number): { zoom: number; panX: number; panY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;
  for (const n of scene.nodes) {
    const st = n.getState(scene.stateId); if (!st || st.visible === false) continue;
    const p = st.position || { x: 0, y: 0 };
    minX = Math.min(minX, Number(p.x) || 0); minY = Math.min(minY, Number(p.y) || 0);
    maxX = Math.max(maxX, Number(p.x) || 0); maxY = Math.max(maxY, Number(p.y) || 0);
    count++;
  }
  if (!count || !Number.isFinite(minX)) return { zoom: 1, panX: 0, panY: 0 };
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const cw = Math.max(1, maxX - minX), ch = Math.max(1, maxY - minY);
  const s = Math.min(canvasW / cw, canvasH / ch) * 0.65;
  const zoom = clamp(s, 0.05, 6);
  return { zoom, panX: -cx * zoom, panY: -cy * zoom };
}

// ============================================================================
// PngRemixPlayer
// ============================================================================

/** PngRemix 功能开关（鼠标跟随等）。 */
export type PngRemixFeatureFlags = {
  mouseFollow: boolean;
};


/**
 * PngRemix 播放器：负责加载 .pngRemix 模型并驱动表达/动作/鼠标跟随。
 */
export class PngRemixPlayer {

  private canvas: HTMLCanvasElement;
  private config: PngRemixConfig | null = null;
  private modPath = "";
  private scene: RuntimeScene | null = null;
  private destroyed = false;

  // Camera
  private zoom = 1;
  private panX = 0;
  private panY = 0;

  // Mouse tracking
  private hasMouse = false;
  private mouseWorld: Vec2 = { x: 0, y: 0 };
  private mouseCanvas: Vec2 = { x: 0, y: 0 };
  private mouseDirty = false;
  private cameraDirty = true;

  // Local high-frequency mouse follow (when the WebView can receive pointer events)
  private localMouseMoveHandler: ((e: PointerEvent | MouseEvent) => void) | null = null;
  private localMouseLeaveHandler: ((e: MouseEvent) => void) | null = null;

  private lastLocalMouseTs = 0;

  // Feature flags
  private enableMouseFollow = true;
  private enableClickBounce = true;
  private enableAutoBlink = true;

  // Animation scale (from WindowCore)
  private animationScale = 0.4;

  // Model scale (from pngremixConfig.model.scale)
  private modelScale = 1;

  // Per-State view overrides (from pngremixConfig.states mapping)
  private stateScale = 1;
  private stateOffsetX = 0;
  private stateOffsetY = 0;

  // Current expression/motion state
  private currentExpression: PngRemixExpression | null = null;
  private currentMotion: PngRemixMotion | null = null;

  // Resize observer
  private resizeObserver: ResizeObserver | null = null;

  // Hit-test buffer (for transparent-pixel click-through)
  private hitTestCanvas: HTMLCanvasElement | null = null;
  private hitTestCtx: CanvasRenderingContext2D | null = null;
  private hitTestScale = 0.25; // smaller = faster readback
  private hitTestDirty = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    // Create an offscreen hit-test buffer. We keep it small and enable willReadFrequently.
    this.hitTestCanvas = document.createElement("canvas");
    this.hitTestCtx = this.hitTestCanvas.getContext("2d", {
      alpha: true,
      willReadFrequently: true,
    });
  }

  // ==== PUBLIC API ====

  /**
   * 初始化播放器并加载 PngRemix 模型资源。
   */
  async init(modPath: string, config: PngRemixConfig): Promise<void> {

    this.modPath = modPath;
    this.config = config;

    await ensureScripts();

    // Fetch the .pngRemix file
    const url = buildModAssetUrl(modPath, config.model.pngremix_file);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch pngRemix: ${resp.status}`);
    let ab = await resp.arrayBuffer();

    const W = (globalThis as any);
    let decoded = W.PngRemixDecoder.decode(ab);
    let normalized = W.ModelNormalizer.normalizePngRemixModel(decoded);
    ab = null as any;

    // 贴图解码降采样/封顶：逻辑尺寸按原图，实际像素可更小（降低内存占用）
    const maxDimRaw = Number((config.model as any)?.texture_decode_max_dim);
    const scaleRaw = Number((config.model as any)?.texture_decode_scale);
    const maxDim = Number.isFinite(maxDimRaw) ? Math.floor(maxDimRaw) : TEXTURE_DECODE_DEFAULT_MAX_DIM;
    const scale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? clamp(scaleRaw, TEXTURE_DECODE_MIN_SCALE, 1) : 1;
    const decodePolicy: TextureDecodePolicy | null = (maxDim > 0 || scale < TEXTURE_DECODE_NO_RESIZE_EPS) ? { maxDim, scale } : null;


    this.scene = await buildRuntimeScene(normalized, decodePolicy);

    decoded = null as any;
    normalized = null as any;


    // Apply config features
    this.applyConfigFeatures(config);

    // Apply default state
    if (config.model.default_state_index > 0) {
      materializeSceneState(this.scene, config.model.default_state_index);
    }

    // 按需解码预热：预请求初始状态下可见的贴图，减少首帧空白/闪烁
    try {
      buildDrawList(this.scene, Mat2D.identity());
    } catch {
      /* ignore */
    }

    // Apply model scale

    this.modelScale = Number((config.model as any)?.scale) || 1;

    // Setup canvas and fit
    this.resizeCanvas();
    this.bindResize();
    this.recomputeView();

    // Start playback
    this.startPlayback();

    // Start auto blink
    if (this.enableAutoBlink && this.config) {
      this.startAutoBlink();
    }

  }

  /**
   * 释放渲染资源与监听器。
   */
  destroy(): void {

    this.destroyed = true;
    this.stopPlayback();
    this.stopAutoBlink();
    this.unbindLocalMouseFollow();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    const hadTextureManager = !!this.scene?.textureManager;
    if (this.scene?.textureManager) {
      this.scene.textureManager.dispose();
      this.scene.textureManager = null;
    }

    // 显式关闭 ImageBitmap 以立即释放 GPU 纹理资源（注意：贴图可能被多个 sprite 共享）
    if (this.scene?.spriteDrawableByIndex) {
      if (!hadTextureManager) {
        const closed = new Set<any>();
        for (const drawable of this.scene.spriteDrawableByIndex.values()) {
          if (drawable instanceof ImageBitmap) {
            if (closed.has(drawable)) continue;
            closed.add(drawable);
            try { drawable.close(); } catch { /* ignore */ }
          }
        }
      }
      this.scene.spriteDrawableByIndex.clear();
    }

    clearTintCache();
    this.scene = null;

    this.config = null;
    this.hitTestCanvas = null;
    this.hitTestCtx = null;
  }


  /**
   * Called by WindowCore when backend enters a new StateInfo.
   * assetName == StateInfo.anima. For pngremix, we map it via pngremixConfig.states.
   */
  /**
   * 由 WindowCore 触发的状态播放入口（StateInfo.anima）。
   */
  playFromAnima(
    animaName: string,
    playOnce: boolean,
    onComplete: () => void,
    pngremixParams?: PngRemixParameterSetting[],
  ): boolean {

    if (!this.scene || !this.config) return false;

    // 1) Apply state mapping: StateInfo.anima -> PngRemixState (expression/motion/scale/offset)
    const key = String(animaName || "").trim();
    const mapping = this.config.states?.find((s) => String(s?.state || "").trim() === key) || null;
    if (mapping) {
      this.applyPngRemixStateMapping(mapping);
    }

    // 2) Apply explicit overrides (if provided)
    this.applyPngRemixParams(pngremixParams);

    // PngRemix has no finite animation duration concept.
    // For playOnce, call onComplete shortly after applying switches.
    if (playOnce) setTimeout(onComplete, 100);
    return true;
  }

  /**
   * Update mouse position from WindowCore cursor tracking.
   * 注意：WindowCore 传入的是"窗口视口坐标"（CSS 逻辑像素），不是 canvas 内部坐标。
   * 如果直接当成 canvas 坐标，会在某些布局（如 canvas 不在 (0,0)）下产生跳变，表现为鬼畜抖动/点头。
   */
  updateGlobalMouseFollow(localX: number, localY: number): void {
    if (!this.scene) return;

    // 如果最近已经收到过 canvas 内的高频 pointer/mouse 事件，就优先使用它们，
    // 避免 windowcore(轮询) 与 local events 混用导致坐标系切换。
    const now = performance.now();
    if (this.lastLocalMouseTs > 0 && now - this.lastLocalMouseTs < 200) {
      return;
    }

    this.recordMouseViewportPosition(localX, localY, "windowcore");
  }

  /**
   * 检测 canvas 上指定坐标附近是否存在不透明像素。
   * 使用多点采样（中心 + 周围扩展），在模型边缘提供足够的容差，
   * 使穿透可以在鼠标到达模型之前提前关闭。
   * @param screenX 窗口内 X 坐标（CSS 逻辑坐标）
   * @param screenY 窗口内 Y 坐标（CSS 逻辑坐标）
   * @param alphaThreshold alpha 阈值（0-255），低于此值视为透明
   * @returns true = 不透明（拦截鼠标），false = 透明（允许穿透）
   */
  isPixelOpaqueAtScreen(screenX: number, screenY: number, alphaThreshold = 10): boolean {
    const rect = this.canvas.getBoundingClientRect();

    // screenX/screenY 为窗口视口坐标（CSS 逻辑像素）。先转为 canvas 内部坐标（CSS）。
    const cssX = screenX - rect.left;
    const cssY = screenY - rect.top;

    if (cssX < 0 || cssY < 0 || cssX >= rect.width || cssY >= rect.height) {
      return false;
    }

    // Prefer hit-test buffer to avoid getImageData on the main render canvas.
    if (this.hitTestDirty) this.updateHitTestBuffer();
    const hit = this.hitTestCanvas;
    const ctx = this.hitTestCtx;
    if (!hit || !ctx || hit.width <= 0 || hit.height <= 0) return false;

    const dpr = getRenderDpr();
    const scale = clamp(this.hitTestScale, 0.05, 1);


    // Map to device pixels then to hit buffer pixels.
    const px = cssX * dpr;
    const py = cssY * dpr;
    let hx = Math.floor(px * scale);
    let hy = Math.floor(py * scale);

    // Read a tiny block (3x3) to be robust against AA edges.
    const startX = clamp(hx - 1, 0, Math.max(0, hit.width - 1));
    const startY = clamp(hy - 1, 0, Math.max(0, hit.height - 1));
    const w = Math.min(3, hit.width - startX);
    const h = Math.min(3, hit.height - startY);

    try {
      const data = ctx.getImageData(startX, startY, w, h).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] >= alphaThreshold) return true;
      }
    } catch {
      return false;
    }

    return false;
  }

  setAnimationScale(scale: number): void {
    this.animationScale = scale;
    // NOTE: animationScale 由 Rust 端通过调整窗口/canvas 的物理尺寸实现。
    // 这里不再把 animationScale 叠加到相机 zoom 上，否则会出现“窗口变大 + 相机再放大”导致裁切。
    // ResizeObserver 会在 canvas 尺寸变化时自动触发 resizeCanvas + recomputeView。
  }


  setFeatureFlags(flags: PngRemixFeatureFlags): void {
    this.enableMouseFollow = flags.mouseFollow;
    this.syncMouseFollowBindings();
  }

  triggerClickBounce(): void {
    if (!this.scene || !this.config) return;
    const features = this.config.features;
    if (!features.click_bounce) return;
    this.scene._clickBounce.active = true;
    this.scene._clickBounce.t = 0;
    this.scene._clickBounce.dur = features.click_bounce_duration || 0.5;
    this.scene._clickBounce.amp = features.click_bounce_amp || 50;
  }

  /**
   * 直接切换到指定表情状态。
   */
  playExpression(name: string): void {

    if (!this.scene || !this.config) return;
    const expr = this.config.expressions.find((e) => e.name === name);
    if (!expr) { console.warn("[PngRemixPlayer] Expression not found:", name); return; }
    this.currentExpression = expr;
    materializeSceneState(this.scene, expr.state_index);
  }

  /**
   * 触发指定动作（可附带快捷键驱动）。
   */
  playMotion(name: string): void {

    if (!this.scene || !this.config) return;
    const motion = this.config.motions.find((m) => m.name === name);
    if (!motion) { console.warn("[PngRemixPlayer] Motion not found:", name); return; }
    this.currentMotion = motion;
    const hotkey = String(motion.hotkey || "").trim();
    if (hotkey) this.applyHotkey(hotkey);
  }

  // ==== PRIVATE ====

  private applyConfigFeatures(config: PngRemixConfig): void {
    const f = config.features;
    this.enableMouseFollow = f.mouse_follow;
    this.enableAutoBlink = f.auto_blink;
    this.enableClickBounce = f.click_bounce;

    this.syncMouseFollowBindings();

    if (this.scene) {
      this.scene._clickBounce.amp = f.click_bounce_amp || 50;
      this.scene._clickBounce.dur = f.click_bounce_duration || 0.5;
    }
  }

  private recomputeView(): void {
    if (!this.scene) return;

    const fit = fitViewToContent(this.scene, this.canvas.width, this.canvas.height);

    // NOTE: 不把 WindowCore 的 animationScale 叠加到相机。
    // animationScale 会由 Rust 调整窗口大小，canvas 变大后 fit.zoom 会自然变化。
    const factor = (Number(this.modelScale) || 1) * (Number(this.stateScale) || 1);
    const dpr = getRenderDpr();

    // fit.panX/panY are derived from fit.zoom, so they should be scaled together.
    this.zoom = fit.zoom * factor;
    this.panX = fit.panX * factor + (Number(this.stateOffsetX) || 0) * dpr;
    this.panY = fit.panY * factor + (Number(this.stateOffsetY) || 0) * dpr;


    this.cameraDirty = true;
    this.mouseDirty = true;
  }

  private applyPngRemixParams(pngremixParams?: PngRemixParameterSetting[]): void {
    if (!this.scene || !this.config) return;
    if (!pngremixParams || pngremixParams.length === 0) return;
    for (const p of pngremixParams) {
      if (p.type === "expression") this.playExpression(p.name);
      else if (p.type === "motion") this.playMotion(p.name);
    }
  }

  private applyPngRemixStateMapping(state: PngRemixConfig["states"][number]): void {
    const scene = this.scene;
    if (!scene) return;

    // Mouth state overrides (optional)
    // 对齐预览工具（other-tool/pngRemix预览）的语义：
    // - mouth_state: 0=Closed, 1=Open, 2=Screaming
    // - 渲染阶段以 `mouthState !== 0` 作为"张嘴中"判定
    const mouthStateRaw = Number((state as any).mouth_state);
    if (Number.isFinite(mouthStateRaw)) {
      scene.mouthState = clamp(Math.floor(mouthStateRaw), 0, 2);
    }


    // View overrides
    this.stateScale = Number((state as any).scale) || 1;
    this.stateOffsetX = Number((state as any).offset_x) || 0;
    this.stateOffsetY = Number((state as any).offset_y) || 0;
    this.recomputeView();

    // Expression/motion
    const expr = String((state as any).expression || "").trim();
    if (expr) this.playExpression(expr);
    const motion = String((state as any).motion || "").trim();
    if (motion) this.playMotion(motion);
  }


  private applyHotkey(hotkey: string): void {
    const scene = this.scene;
    if (!scene) return;

    const k = normalizeKeyName(hotkey);
    if (!k) return;

    // If the scene was created by an older instance, rebuild groups lazily.
    if (!scene.availableHotkeys || !(scene.availableHotkeys instanceof Set) || !scene.hotkeyGroups) {
      buildHotkeyGroups(scene);
    }

    // Clear previous hotkey-created overrides (keep manual overrides).
    if (scene.visibilityOverrides) {
      for (const key of Object.keys(scene.visibilityOverrides)) {
        const v = scene.visibilityOverrides[key];
        const src = (v && typeof v === "object") ? String((v as any).source || "") : "";
        if (src === "hotkey" || src.startsWith("hotkey")) {
          delete scene.visibilityOverrides[key];
        }
      }
    }

    const applyByScan = () => {
      // Fallback path: scan raw sprite bindings directly.
      // This matches preview tool behavior: saved_keys + saved_disappear are "hide on key".
      const byParent = new Map<any, RuntimeNode[]>();
      for (const node of scene.nodes) {
        const raw = node.raw || {};
        if ((raw as any).is_asset !== true) continue;
        const pid = node.parentId ?? null;
        if (!byParent.has(pid)) byParent.set(pid, []);
        byParent.get(pid)!.push(node);
      }

      const getSavedKeys = (raw: any): Set<string> => {
        const sk = raw && Array.isArray(raw.saved_keys) ? raw.saved_keys : [];
        const keysFromSaved = sk.map(normalizeKeyName).filter((x: string) => x.length > 0);

        const sd = raw && Array.isArray(raw.saved_disappear) ? raw.saved_disappear : [];
        const keysFromDisappear: string[] = [];
        for (const ev of sd) {
          const { hotkey } = normalizeSavedDisappearEvent(ev);
          if (hotkey) keysFromDisappear.push(hotkey);
        }

        return new Set<string>([...keysFromSaved, ...keysFromDisappear]);
      };

      for (const [, nodes] of byParent) {
        // Only consider "binding groups" to avoid forcing visibility for unrelated single assets.
        if (nodes.length < 2) continue;

        const savedByNode = new Map<RuntimeNode, Set<string>>();
        for (const n of nodes) {
          const s = getSavedKeys(n.raw);
          if (s.size > 0) savedByNode.set(n, s);
        }

        // Skip groups that do not mention this hotkey.
        const groupRelevant = nodes.some((n) => (savedByNode.get(n) || new Set<string>()).has(k));
        if (!groupRelevant) continue;

        for (const n of nodes) {
          const savedKeys = savedByNode.get(n) || new Set<string>();
          const visible = !savedKeys.has(k);
          scene.visibilityOverrides[n.key] = { visible, source: "hotkey", hotkey: k };
        }
      }
    };

    // Prefer prebuilt groups if available; otherwise fall back to scanning.
    if (!scene.availableHotkeys || !scene.availableHotkeys.has(k) || !scene.hotkeyGroups || scene.hotkeyGroups.length === 0) {
      applyByScan();
      return;
    }

    // Apply hotkey overrides using preview-tool semantics.
    // For each hotkey group: if the node's savedKeys contains k -> hide; otherwise show.
    let applied = false;
    for (const g of scene.hotkeyGroups || []) {
      const nodes = (g && Array.isArray((g as any).nodes)) ? (g as any).nodes : [];
      if (!nodes.length) continue;

      // Skip groups that do not mention this hotkey, to avoid force-showing unrelated assets.
      const groupRelevant = nodes.some((x: any) => x?.savedKeys instanceof Set && x.savedKeys.has(k));
      if (!groupRelevant) continue;
      applied = true;

      for (const x of nodes) {
        const savedKeys = (x as any)?.savedKeys;
        const hideOnKey = savedKeys instanceof Set && savedKeys.has(k);
        scene.visibilityOverrides[x.node.key] = {
          visible: !hideOnKey,
          source: "hotkey",
          hotkey: k,
        };
      }
    }

    if (!applied) applyByScan();
  }



  private resizeCanvas(): void {
    // Avoid getBoundingClientRect() in the hot path (can trigger layout).
    // clientWidth/Height are CSS pixels.
    const dpr = getRenderDpr();
    const cssW = this.canvas.clientWidth;

    const cssH = this.canvas.clientHeight;
    const w = Math.max(1, Math.floor(cssW * dpr));
    const h = Math.max(1, Math.floor(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.cameraDirty = true;
      this.mouseDirty = true;
      this.hitTestDirty = true;
    }
  }

  private bindResize(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas();
      this.recomputeView();
    });
    this.resizeObserver.observe(this.canvas);
  }

  private getCameraMatrix(): Mat2D {
    const w = this.canvas.width, h = this.canvas.height;
    return Mat2D.translate(w / 2, h / 2)
      .multiply(Mat2D.translate(this.panX, this.panY))
      .multiply(Mat2D.scale(this.zoom, this.zoom));
  }

  private recordMouseViewportPosition(viewX: number, viewY: number, source: string): void {
    // viewX/viewY 是窗口视口坐标（client 坐标系），需要转换到 canvas 内部坐标。
    const rect = this.canvas.getBoundingClientRect();
    this.recordMouseCssPosition(viewX - rect.left, viewY - rect.top, source);
  }

  private recordMouseCssPosition(cssX: number, cssY: number, source: string): void {
    if (!this.scene) return;
    this.hasMouse = true;
    const dpr = getRenderDpr();
    this.mouseCanvas.x = cssX * dpr;
    this.mouseCanvas.y = cssY * dpr;
    this.mouseDirty = true;

    if (source !== "windowcore") this.lastLocalMouseTs = performance.now();
  }

  private updateHitTestBuffer(): void {
    const src = this.canvas;
    const dst = this.hitTestCanvas;
    const ctx = this.hitTestCtx;
    if (!dst || !ctx) return;

    const scale = clamp(this.hitTestScale, 0.05, 1);
    const w = Math.max(1, Math.floor(src.width * scale));
    const h = Math.max(1, Math.floor(src.height * scale));

    if (dst.width !== w || dst.height !== h) {
      dst.width = w;
      dst.height = h;
    }

    // Copy the final composited frame (with alpha) into the small buffer.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, w, h);

    this.hitTestDirty = false;
  }

  private syncMouseFollowBindings(): void {
    // Use local pointer events when possible; WindowCore polling is only ~7Hz by default (see CURSOR_POLL_INTERVAL_MS).

    if (!this.enableMouseFollow || !this.scene) {
      this.unbindLocalMouseFollow();
      return;
    }
    this.bindLocalMouseFollow();
  }

  private bindLocalMouseFollow(): void {
    if (this.localMouseMoveHandler) return;

    this.localMouseMoveHandler = (e: PointerEvent | MouseEvent) => {
      const anyE = e as any;
      const ox = Number(anyE.offsetX);
      const oy = Number(anyE.offsetY);
      if (Number.isFinite(ox) && Number.isFinite(oy)) {
        this.recordMouseCssPosition(ox, oy, e.type);
        return;
      }
      // Fallback: compute from client coords
      const rect = this.canvas.getBoundingClientRect();
      this.recordMouseCssPosition((e as MouseEvent).clientX - rect.left, (e as MouseEvent).clientY - rect.top, e.type);
    };

    this.localMouseLeaveHandler = () => {
      // Keep hasMouse=true (follow can still be driven by WindowCore polling / last known mouse)
    };

    this.canvas.addEventListener("pointermove", this.localMouseMoveHandler as any, { passive: true });
    this.canvas.addEventListener("mousemove", this.localMouseMoveHandler as any, { passive: true });
    this.canvas.addEventListener("mouseleave", this.localMouseLeaveHandler as any, { passive: true });
  }

  private unbindLocalMouseFollow(): void {
    if (!this.localMouseMoveHandler) return;
    this.canvas.removeEventListener("pointermove", this.localMouseMoveHandler as any);
    this.canvas.removeEventListener("mousemove", this.localMouseMoveHandler as any);
    if (this.localMouseLeaveHandler) this.canvas.removeEventListener("mouseleave", this.localMouseLeaveHandler as any);
    this.localMouseMoveHandler = null;
    this.localMouseLeaveHandler = null;
  }

  private updateMouseWorld(): void {
    if (!this.scene || !this.hasMouse) return;
    if (!this.mouseDirty && !this.cameraDirty) return;
    const inv = this.getCameraMatrix().invert();
    const p = inv.applyToPoint(this.mouseCanvas.x, this.mouseCanvas.y);
    this.mouseWorld.x = p.x;
    this.mouseWorld.y = p.y;
    this.mouseDirty = false;
    this.cameraDirty = false;
  }

  // Blink system
  private startAutoBlink(): void {
    this.stopAutoBlink();
    if (!this.scene || !this.config) return;
    this.scene.autoBlink = true;
    const intervalMs = Math.max(50, Math.floor(getBlinkSpeedSeconds(this.config.features) * 1000));
    this.scene._autoBlinkTimer = setInterval(() => {
      if (!this.scene || !this.config) return;
      const chance = getBlinkChance(this.config.features);
      if (Math.floor(Math.random() * chance) === 0) this.triggerBlink();
    }, intervalMs);
  }

  private stopAutoBlink(): void {
    if (!this.scene) return;
    this.scene.autoBlink = false;
    if (this.scene._autoBlinkTimer) { clearInterval(this.scene._autoBlinkTimer); this.scene._autoBlinkTimer = null; }
    if (this.scene._blinkTimeout) { clearTimeout(this.scene._blinkTimeout); this.scene._blinkTimeout = null; }
  }

  private triggerBlink(): void {
    if (!this.scene || !this.config) return;
    this.scene.blinking = true;
    if (this.scene._blinkTimeout) clearTimeout(this.scene._blinkTimeout);
    const holdMs = Math.max(30, Math.floor(getBlinkHoldSeconds(this.config.features) * 1000));
    this.scene._blinkTimeout = setTimeout(() => {
      if (this.scene) this.scene.blinking = false;
    }, holdMs);
  }

  // Playback loop
  private startPlayback(): void {
    this.stopPlayback();
    if (!this.scene) return;
    this.scene.playing = true;

    const maxFpsRaw = Number(this.config?.model?.max_fps) || 60;
    const maxFps = capFps(maxFpsRaw);
    const minDeltaMs = 1000 / Math.max(1, clamp(maxFps, 1, 240));

    const frame = (ts: number) => {
      if (this.destroyed || !this.scene) return;
      if (!this.scene.playing) return;

      const last = this.scene._lastTs || 0;
      if (last && ts - last < minDeltaMs) {
        this.scene._rafId = requestAnimationFrame(frame);
        return;
      }

      const dtSec = last ? clamp((ts - last) / 1000, 0, 0.1) : 1 / maxFps;
      this.scene._lastTs = ts;

      const shouldDelta = this.scene.model?.settings?.should_delta !== false;
      this.scene.tick += shouldDelta ? dtSec * 60 : 1;

      if (this.config) updateGlobalBounce(this.scene, dtSec, this.config.features);

      this.updateMouseWorld();
      stepSceneRuntime(this.scene, dtSec, this.enableMouseFollow, this.mouseWorld, this.hasMouse);
      this.resizeCanvas();
      renderScene(this.scene, this.canvas, this.zoom, this.panX, this.panY);
      // Update hit-test alpha buffer after we rendered a new frame.
      this.hitTestDirty = true;
      this.updateHitTestBuffer();

      this.scene._rafId = requestAnimationFrame(frame);
    };

    this.scene._rafId = requestAnimationFrame(frame);
  }

  private stopPlayback(): void {
    if (!this.scene) return;
    this.scene.playing = false;
    if (this.scene._rafId) { cancelAnimationFrame(this.scene._rafId); this.scene._rafId = 0; }
    this.scene._lastTs = 0;
  }
}
