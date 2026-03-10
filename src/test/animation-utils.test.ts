import { describe, it, expect } from "vitest";
import {
  // WindowCore 纯逻辑
  formatDurationHms,
  calcDaysUsed,
  calcTotalUsageSeconds,
  // SpriteAnimator 纯逻辑
  computeSpriteDownsampleTarget,
  isBorderImage,
  // Live2DPlayer 纯逻辑
  getMotionPriority,
  buildNameKey,
  computeLive2DDecodeTarget,
  normalizeFsPath,
  normalizeStartDim,
  // ThreeDPlayer 纯逻辑
  computeTexDownsampleTarget,
  // PngRemixPlayer — Mat2D
  Mat2D,
  // PngRemixPlayer — 数学工具
  clamp,
  toRad,
  lerp,
  wrapAngleRad,
  lerpAngle,
  moveToward,
  wrap01,
  quantize01,
  // PngRemixPlayer — 颜色工具
  mulColor,
  rgbToHsv,
  hsvToRgb,
  compositeForBlendMode,
  // PngRemixPlayer — 字节/文件格式工具
  bytesToHex,
  simpleBytesSignature,
  isGifBytes,
  isPngBytes,
  pngHasChunk,
  tryReadPngSize,
  tryReadGifSize,
  // WindowCore 提取的纯逻辑
  isDragThresholdExceeded,
  isPlaybackComplete,
  replaceSpeechPlaceholders,
  calcModDataDelta,
  // Mods 页面提取的纯逻辑
  tokenizeLinks,
  toErrorMessage,
  needsHydrateSbuddy,
  resolveCharInfo,
} from "$lib/animation/animation_utils";

// ============================================================================
// WindowCore 纯逻辑
// ============================================================================

describe("formatDurationHms", () => {
  it("formats 0 seconds", () => {
    expect(formatDurationHms(0)).toBe("00:00:00");
  });

  it("formats seconds only", () => {
    expect(formatDurationHms(45)).toBe("00:00:45");
  });

  it("formats minutes and seconds", () => {
    expect(formatDurationHms(125)).toBe("00:02:05");
  });

  it("formats hours, minutes, seconds", () => {
    expect(formatDurationHms(3661)).toBe("01:01:01");
  });

  it("handles large values", () => {
    expect(formatDurationHms(86399)).toBe("23:59:59");
    expect(formatDurationHms(86400)).toBe("24:00:00");
  });

  it("clamps negative to 0", () => {
    expect(formatDurationHms(-100)).toBe("00:00:00");
  });

  it("floors fractional seconds", () => {
    expect(formatDurationHms(61.9)).toBe("00:01:01");
  });
});

describe("calcDaysUsed", () => {
  it("returns 0 for null timestamp", () => {
    expect(calcDaysUsed(null)).toBe(0);
  });

  it("returns 0 for 0 timestamp", () => {
    expect(calcDaysUsed(0)).toBe(0);
  });

  it("returns 1 for same day", () => {
    const now = new Date(2025, 5, 15, 12, 0, 0);
    const ts = Math.floor(new Date(2025, 5, 15, 8, 0, 0).getTime() / 1000);
    expect(calcDaysUsed(ts, now)).toBe(1);
  });

  it("returns 2 for next day", () => {
    const now = new Date(2025, 5, 16, 10, 0, 0);
    const ts = Math.floor(new Date(2025, 5, 15, 22, 0, 0).getTime() / 1000);
    expect(calcDaysUsed(ts, now)).toBe(2);
  });

  it("returns correct days for multi-day span", () => {
    const now = new Date(2025, 5, 20, 10, 0, 0);
    const ts = Math.floor(new Date(2025, 5, 15, 10, 0, 0).getTime() / 1000);
    expect(calcDaysUsed(ts, now)).toBe(6);
  });
});

describe("calcTotalUsageSeconds", () => {
  it("returns base when delta is 0", () => {
    const now = 1000;
    expect(calcTotalUsageSeconds(100, now, now)).toBe(100);
  });

  it("adds elapsed seconds", () => {
    const base = 1000;
    const baseAt = 10000;
    const now = 15000; // 5 seconds later
    expect(calcTotalUsageSeconds(base, baseAt, now)).toBe(1005);
  });

  it("clamps negative delta to 0", () => {
    expect(calcTotalUsageSeconds(100, 5000, 3000)).toBe(100);
  });
});

// ============================================================================
// SpriteAnimator 纯逻辑
// ============================================================================

describe("computeSpriteDownsampleTarget", () => {
  it("returns original when disabled", () => {
    const result = computeSpriteDownsampleTarget(1000, 500, {
      enabled: false, startDim: 0, maxDim: 0, scale: 1,
    });
    expect(result).toEqual({ w: 1000, h: 500, scale: 1 });
  });

  it("returns original when below startDim threshold", () => {
    const result = computeSpriteDownsampleTarget(400, 300, {
      enabled: true, startDim: 500, maxDim: 500, scale: 0.5,
    });
    expect(result).toEqual({ w: 400, h: 300, scale: 1 });
  });

  it("downsamples when above startDim", () => {
    const result = computeSpriteDownsampleTarget(1000, 800, {
      enabled: true, startDim: 500, maxDim: 500, scale: 1,
    });
    expect(result.w).toBeLessThan(1000);
    expect(result.h).toBeLessThan(800);
    expect(result.scale).toBeLessThan(1);
  });

  it("handles zero/negative dimensions", () => {
    const result = computeSpriteDownsampleTarget(0, 100, {
      enabled: true, startDim: 0, maxDim: 50, scale: 0.5,
    });
    expect(result).toEqual({ w: 0, h: 100, scale: 1 });
  });

  it("respects minimum scale", () => {
    const result = computeSpriteDownsampleTarget(10000, 10000, {
      enabled: true, startDim: 0, maxDim: 10, scale: 0.001,
    });
    expect(result.scale).toBeGreaterThanOrEqual(0.05);
  });
});

describe("isBorderImage", () => {
  it("detects border in URL", () => {
    expect(isBorderImage("asset/border_idle.webp")).toBe(true);
  });

  it("detects Border (case-insensitive)", () => {
    expect(isBorderImage("asset/BORDER.png")).toBe(true);
  });

  it("returns false for non-border", () => {
    expect(isBorderImage("asset/idle.webp")).toBe(false);
  });
});

// ============================================================================
// Live2DPlayer 纯逻辑
// ============================================================================

describe("getMotionPriority", () => {
  it("maps idle to 1", () => {
    expect(getMotionPriority("idle")).toBe(1);
  });

  it("maps normal to 2", () => {
    expect(getMotionPriority("normal")).toBe(2);
  });

  it("maps high to 3", () => {
    expect(getMotionPriority("high")).toBe(3);
  });

  it("maps force to 4", () => {
    expect(getMotionPriority("force")).toBe(4);
  });

  it("defaults to 2 for unknown", () => {
    expect(getMotionPriority("unknown")).toBe(2);
  });

  it("defaults to 2 for undefined", () => {
    expect(getMotionPriority()).toBe(2);
  });

  it("is case-insensitive", () => {
    expect(getMotionPriority("FORCE")).toBe(4);
    expect(getMotionPriority("Idle")).toBe(1);
  });
});

describe("buildNameKey", () => {
  it("trims and lowercases", () => {
    expect(buildNameKey("  Hello World  ")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(buildNameKey("")).toBe("");
  });

  it("handles falsy input", () => {
    expect(buildNameKey(null as any)).toBe("");
    expect(buildNameKey(undefined as any)).toBe("");
  });
});

describe("computeLive2DDecodeTarget", () => {
  it("returns original when disabled", () => {
    const result = computeLive2DDecodeTarget(2048, 2048, {
      enabled: false, maxDim: 1024, scale: 0.5, startDim: 0,
    });
    expect(result).toEqual({ w: 2048, h: 2048, scale: 1 });
  });

  it("skips when below startDim", () => {
    const result = computeLive2DDecodeTarget(500, 500, {
      enabled: true, maxDim: 1024, scale: 0.5, startDim: 1024,
    });
    expect(result).toEqual({ w: 500, h: 500, scale: 1 });
  });

  it("downsamples when above startDim", () => {
    const result = computeLive2DDecodeTarget(2048, 2048, {
      enabled: true, maxDim: 1024, scale: 1, startDim: 512,
    });
    expect(result.w).toBe(1024);
    expect(result.h).toBe(1024);
    expect(result.scale).toBe(0.5);
  });

  it("clamps invalid dimensions to 1", () => {
    const result = computeLive2DDecodeTarget(0, -5, {
      enabled: false, maxDim: 1024, scale: 1, startDim: 0,
    });
    expect(result.w).toBe(1);
    expect(result.h).toBe(1);
  });
});

describe("normalizeFsPath", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normalizeFsPath("C:\\Users\\test\\file.txt")).toBe("c:/users/test/file.txt");
  });

  it("trims whitespace", () => {
    expect(normalizeFsPath("  /path/to/file  ")).toBe("/path/to/file");
  });

  it("lowercases", () => {
    expect(normalizeFsPath("C:/MyPath/File.TXT")).toBe("c:/mypath/file.txt");
  });

  it("handles empty/null", () => {
    expect(normalizeFsPath("")).toBe("");
    expect(normalizeFsPath(null as any)).toBe("");
  });
});

describe("normalizeStartDim", () => {
  it("returns integer for valid number", () => {
    expect(normalizeStartDim(1024)).toBe(1024);
  });

  it("floors fractional values", () => {
    expect(normalizeStartDim(1024.7)).toBe(1024);
  });

  it("clamps negative to 0", () => {
    expect(normalizeStartDim(-10)).toBe(0);
  });

  it("returns null for NaN", () => {
    expect(normalizeStartDim("abc")).toBeNull();
  });

  it("returns null for Infinity", () => {
    expect(normalizeStartDim(Infinity)).toBeNull();
  });

  it("handles string numbers", () => {
    expect(normalizeStartDim("512")).toBe(512);
  });
});

// ============================================================================
// ThreeDPlayer 纯逻辑
// ============================================================================

describe("computeTexDownsampleTarget", () => {
  it("returns original when disabled", () => {
    const result = computeTexDownsampleTarget(4096, 4096, {
      enabled: false, startDim: 0, maxDim: 0, scale: 1,
    });
    expect(result).toEqual({ w: 4096, h: 4096, scale: 1 });
  });

  it("skips when below startDim", () => {
    const result = computeTexDownsampleTarget(256, 256, {
      enabled: true, startDim: 1024, maxDim: 1024, scale: 0.5,
    });
    expect(result).toEqual({ w: 256, h: 256, scale: 1 });
  });

  it("applies maxDim constraint", () => {
    const result = computeTexDownsampleTarget(4096, 4096, {
      enabled: true, startDim: 0, maxDim: 1024, scale: 1,
    });
    expect(result.w).toBe(1024);
    expect(result.h).toBe(1024);
    expect(result.scale).toBeCloseTo(0.25, 2);
  });

  it("applies scale factor", () => {
    const result = computeTexDownsampleTarget(2000, 1000, {
      enabled: true, startDim: 0, maxDim: 0, scale: 0.5,
    });
    expect(result.w).toBe(1000);
    expect(result.h).toBe(500);
    expect(result.scale).toBe(0.5);
  });

  it("returns original for near-1 scale", () => {
    const result = computeTexDownsampleTarget(1000, 1000, {
      enabled: true, startDim: 0, maxDim: 0, scale: 0.9999,
    });
    expect(result).toEqual({ w: 1000, h: 1000, scale: 1 });
  });
});

// ============================================================================
// PngRemixPlayer — Mat2D
// ============================================================================

describe("Mat2D", () => {
  it("identity matrix preserves points", () => {
    const m = Mat2D.identity();
    const p = m.applyToPoint(5, 10);
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(10);
  });

  it("translate shifts points", () => {
    const m = Mat2D.translate(10, 20);
    const p = m.applyToPoint(5, 5);
    expect(p.x).toBeCloseTo(15);
    expect(p.y).toBeCloseTo(25);
  });

  it("scale multiplies coordinates", () => {
    const m = Mat2D.scale(2, 3);
    const p = m.applyToPoint(4, 5);
    expect(p.x).toBeCloseTo(8);
    expect(p.y).toBeCloseTo(15);
  });

  it("rotate 90 degrees", () => {
    const m = Mat2D.rotate(Math.PI / 2);
    const p = m.applyToPoint(1, 0);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
  });

  it("multiply combines transforms", () => {
    const t = Mat2D.translate(10, 0);
    const s = Mat2D.scale(2, 2);
    const combined = t.multiply(s); // first scale, then translate
    const p = combined.applyToPoint(5, 0);
    expect(p.x).toBeCloseTo(20); // 5*2 + 10
  });

  it("invert produces inverse", () => {
    const m = Mat2D.translate(10, 20);
    const inv = m.invert();
    const p = m.multiply(inv).applyToPoint(7, 13);
    expect(p.x).toBeCloseTo(7);
    expect(p.y).toBeCloseTo(13);
  });

  it("invert of singular matrix returns identity", () => {
    const singular = new Mat2D(0, 0, 0, 0, 5, 5);
    const inv = singular.invert();
    expect(inv.a).toBe(1);
    expect(inv.d).toBe(1);
  });
});

// ============================================================================
// PngRemixPlayer — 数学工具
// ============================================================================

describe("clamp", () => {
  it("clamps below min", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps above max", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("returns value in range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("returns min for NaN", () => {
    expect(clamp(NaN, 0, 10)).toBe(0);
  });
});

describe("toRad", () => {
  it("converts 180 degrees to PI", () => {
    expect(toRad(180)).toBeCloseTo(Math.PI);
  });

  it("converts 0 degrees to 0", () => {
    expect(toRad(0)).toBe(0);
  });

  it("converts 90 degrees to PI/2", () => {
    expect(toRad(90)).toBeCloseTo(Math.PI / 2);
  });
});

describe("lerp", () => {
  it("returns a at t=0", () => {
    expect(lerp(10, 20, 0)).toBe(10);
  });

  it("returns b at t=1", () => {
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it("returns midpoint at t=0.5", () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  it("clamps t below 0", () => {
    expect(lerp(10, 20, -1)).toBe(10);
  });

  it("clamps t above 1", () => {
    expect(lerp(10, 20, 2)).toBe(20);
  });
});

describe("wrapAngleRad", () => {
  it("wraps 2*PI to ~0", () => {
    expect(wrapAngleRad(Math.PI * 2)).toBeCloseTo(0, 10);
  });

  it("wraps -2*PI to ~0", () => {
    expect(wrapAngleRad(-Math.PI * 2)).toBeCloseTo(0, 10);
  });

  it("preserves values in range", () => {
    expect(wrapAngleRad(1)).toBeCloseTo(1);
  });
});

describe("lerpAngle", () => {
  it("interpolates between angles", () => {
    const result = lerpAngle(0, Math.PI, 0.5);
    expect(result).toBeCloseTo(Math.PI / 2);
  });
});

describe("moveToward", () => {
  it("moves toward target (positive direction)", () => {
    expect(moveToward(0, 10, 3)).toBe(3);
  });

  it("moves toward target (negative direction)", () => {
    expect(moveToward(10, 0, 3)).toBe(7);
  });

  it("does not overshoot", () => {
    expect(moveToward(0, 5, 10)).toBe(5);
  });

  it("returns current for zero delta", () => {
    expect(moveToward(5, 10, 0)).toBe(5);
  });

  it("returns current when already at target", () => {
    expect(moveToward(5, 5, 1)).toBe(5);
  });
});

describe("wrap01", () => {
  it("wraps 1.5 to 0.5", () => {
    expect(wrap01(1.5)).toBeCloseTo(0.5);
  });

  it("wraps -0.25 to 0.75", () => {
    expect(wrap01(-0.25)).toBeCloseTo(0.75);
  });

  it("returns 0 for NaN", () => {
    expect(wrap01(NaN)).toBe(0);
  });

  it("returns 0 for Infinity", () => {
    expect(wrap01(Infinity)).toBe(0);
  });
});

describe("quantize01", () => {
  it("quantizes to steps", () => {
    expect(quantize01(0.33, 4)).toBeCloseTo(0.25);
  });

  it("quantizes 0.5 to nearest step", () => {
    expect(quantize01(0.5, 2)).toBeCloseTo(0.5);
  });
});

// ============================================================================
// PngRemixPlayer — 颜色工具
// ============================================================================

describe("mulColor", () => {
  it("multiplies white by half-red", () => {
    const result = mulColor(
      { r: 1, g: 1, b: 1, a: 1 },
      { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    );
    expect(result.r).toBeCloseTo(0.5);
    expect(result.g).toBeCloseTo(0.5);
    expect(result.b).toBeCloseTo(0.5);
    expect(result.a).toBeCloseTo(1);
  });

  it("handles null/undefined properties", () => {
    const result = mulColor(null, { r: 0.5 });
    expect(result.r).toBeCloseTo(0.5);
    expect(result.a).toBeCloseTo(1); // defaults to 1
  });
});

describe("rgbToHsv / hsvToRgb roundtrip", () => {
  it("pure red", () => {
    const hsv = rgbToHsv(1, 0, 0);
    expect(hsv.h).toBeCloseTo(0);
    expect(hsv.s).toBeCloseTo(1);
    expect(hsv.v).toBeCloseTo(1);
    const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
    expect(rgb.r).toBeCloseTo(1);
    expect(rgb.g).toBeCloseTo(0);
    expect(rgb.b).toBeCloseTo(0);
  });

  it("pure green", () => {
    const hsv = rgbToHsv(0, 1, 0);
    expect(hsv.h).toBeCloseTo(1 / 3);
    expect(hsv.s).toBeCloseTo(1);
    expect(hsv.v).toBeCloseTo(1);
  });

  it("pure blue", () => {
    const hsv = rgbToHsv(0, 0, 1);
    expect(hsv.h).toBeCloseTo(2 / 3);
  });

  it("black", () => {
    const hsv = rgbToHsv(0, 0, 0);
    expect(hsv.v).toBeCloseTo(0);
    expect(hsv.s).toBe(0);
  });

  it("white", () => {
    const hsv = rgbToHsv(1, 1, 1);
    expect(hsv.s).toBeCloseTo(0);
    expect(hsv.v).toBeCloseTo(1);
  });

  it("arbitrary color roundtrip", () => {
    const hsv = rgbToHsv(0.6, 0.3, 0.8);
    const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
    expect(rgb.r).toBeCloseTo(0.6, 1);
    expect(rgb.g).toBeCloseTo(0.3, 1);
    expect(rgb.b).toBeCloseTo(0.8, 1);
  });
});

describe("compositeForBlendMode", () => {
  it("maps Add to add", () => {
    expect(compositeForBlendMode("Add")).toBe("add");
  });

  it("maps Multiply to multiply", () => {
    expect(compositeForBlendMode("Multiply")).toBe("multiply");
  });

  it("maps Subtract to difference", () => {
    expect(compositeForBlendMode("Subtract")).toBe("difference");
  });

  it("maps Burn to multiply", () => {
    expect(compositeForBlendMode("Burn")).toBe("multiply");
  });

  it("defaults to normal", () => {
    expect(compositeForBlendMode("Normal")).toBe("normal");
    expect(compositeForBlendMode("")).toBe("normal");
    expect(compositeForBlendMode("Unknown")).toBe("normal");
  });
});

// ============================================================================
// PngRemixPlayer — 字节/文件格式工具
// ============================================================================

describe("bytesToHex", () => {
  it("converts bytes to hex", () => {
    expect(bytesToHex(new Uint8Array([0x00, 0xff, 0x0a, 0xbc]))).toBe("00ff0abc");
  });

  it("handles empty array", () => {
    expect(bytesToHex(new Uint8Array([]))).toBe("");
  });
});

describe("simpleBytesSignature", () => {
  it("returns deterministic signature", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const sig1 = simpleBytesSignature(data);
    const sig2 = simpleBytesSignature(data);
    expect(sig1).toBe(sig2);
  });

  it("different data produces different signature", () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([5, 4, 3, 2, 1]);
    expect(simpleBytesSignature(a)).not.toBe(simpleBytesSignature(b));
  });

  it("includes length in signature", () => {
    const data = new Uint8Array([1, 2, 3]);
    expect(simpleBytesSignature(data)).toMatch(/^3:/);
  });
});

describe("isGifBytes", () => {
  it("detects GIF87a", () => {
    const gif87a = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
    expect(isGifBytes(gif87a)).toBe(true);
  });

  it("detects GIF89a", () => {
    const gif89a = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(isGifBytes(gif89a)).toBe(true);
  });

  it("rejects non-GIF", () => {
    expect(isGifBytes(new Uint8Array([0, 1, 2, 3, 4, 5]))).toBe(false);
  });

  it("rejects too short", () => {
    expect(isGifBytes(new Uint8Array([0x47, 0x49, 0x46]))).toBe(false);
  });
});

describe("isPngBytes", () => {
  it("detects PNG signature", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(isPngBytes(png)).toBe(true);
  });

  it("rejects non-PNG", () => {
    expect(isPngBytes(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))).toBe(false);
  });

  it("rejects too short", () => {
    expect(isPngBytes(new Uint8Array([0x89, 0x50]))).toBe(false);
  });
});

describe("pngHasChunk", () => {
  // Build a minimal PNG with IHDR chunk
  function buildMinimalPng(chunkType: string, chunkData: Uint8Array = new Uint8Array(0)): Uint8Array {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const len = chunkData.length;
    const lenBytes = [(len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff];
    const typeBytes = Array.from(chunkType).map((c) => c.charCodeAt(0));
    // CRC placeholder (4 bytes of zeros)
    const crc = [0, 0, 0, 0];
    return new Uint8Array([...sig, ...lenBytes, ...typeBytes, ...Array.from(chunkData), ...crc]);
  }

  it("finds existing chunk", () => {
    const png = buildMinimalPng("IHDR", new Uint8Array(13));
    expect(pngHasChunk(png, "IHDR")).toBe(true);
  });

  it("returns false for missing chunk", () => {
    const png = buildMinimalPng("IHDR", new Uint8Array(13));
    expect(pngHasChunk(png, "tEXt")).toBe(false);
  });

  it("rejects non-PNG", () => {
    expect(pngHasChunk(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), "IHDR")).toBe(false);
  });

  it("rejects wrong chunk name length", () => {
    const png = buildMinimalPng("IHDR", new Uint8Array(13));
    expect(pngHasChunk(png, "IH")).toBe(false);
  });
});

describe("tryReadPngSize", () => {
  function buildPngWithIHDR(width: number, height: number): Uint8Array {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    // IHDR chunk: length=13, type="IHDR", width(4), height(4), bitdepth(1), colortype(1), ...
    const ihdrLen = [0, 0, 0, 13]; // 13 bytes
    const ihdrType = [0x49, 0x48, 0x44, 0x52]; // "IHDR"
    const w = [(width >> 24) & 0xff, (width >> 16) & 0xff, (width >> 8) & 0xff, width & 0xff];
    const h = [(height >> 24) & 0xff, (height >> 16) & 0xff, (height >> 8) & 0xff, height & 0xff];
    const rest = [8, 6, 0, 0, 0]; // bitdepth=8, colortype=6 (RGBA), rest zeros
    const crc = [0, 0, 0, 0];
    return new Uint8Array([...sig, ...ihdrLen, ...ihdrType, ...w, ...h, ...rest, ...crc]);
  }

  it("reads PNG dimensions", () => {
    const png = buildPngWithIHDR(800, 600);
    const size = tryReadPngSize(png);
    expect(size).toEqual({ w: 800, h: 600 });
  });

  it("returns null for non-PNG", () => {
    expect(tryReadPngSize(new Uint8Array([0, 1, 2, 3]))).toBeNull();
  });

  it("returns null for too short data", () => {
    const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(tryReadPngSize(sig)).toBeNull();
  });
});

describe("tryReadGifSize", () => {
  function buildGifWithSize(width: number, height: number): Uint8Array {
    const sig = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // GIF89a
    const w = [width & 0xff, (width >> 8) & 0xff]; // little-endian uint16
    const h = [height & 0xff, (height >> 8) & 0xff];
    return new Uint8Array([...sig, ...w, ...h]);
  }

  it("reads GIF dimensions", () => {
    const gif = buildGifWithSize(320, 240);
    const size = tryReadGifSize(gif);
    expect(size).toEqual({ w: 320, h: 240 });
  });

  it("returns null for non-GIF", () => {
    expect(tryReadGifSize(new Uint8Array([0, 1, 2, 3, 4, 5]))).toBeNull();
  });

  it("returns null for too short data", () => {
    const sig = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00]);
    expect(tryReadGifSize(sig)).toBeNull();
  });
});

// ============================================================================
// WindowCore 提取的纯逻辑
// ============================================================================

describe("isDragThresholdExceeded", () => {
  it("returns false when within threshold", () => {
    expect(isDragThresholdExceeded(100, 100, 103, 102, 5)).toBe(false);
  });

  it("returns true when dx exceeds threshold", () => {
    expect(isDragThresholdExceeded(100, 100, 106, 100, 5)).toBe(true);
  });

  it("returns true when dy exceeds threshold", () => {
    expect(isDragThresholdExceeded(100, 100, 100, 106, 5)).toBe(true);
  });

  it("returns false at exact threshold", () => {
    expect(isDragThresholdExceeded(100, 100, 105, 100, 5)).toBe(false);
  });

  it("handles negative movement", () => {
    expect(isDragThresholdExceeded(100, 100, 94, 100, 5)).toBe(true);
  });

  it("handles zero threshold", () => {
    expect(isDragThresholdExceeded(100, 100, 101, 100, 0)).toBe(true);
  });

  it("returns false when start equals current", () => {
    expect(isDragThresholdExceeded(50, 50, 50, 50, 5)).toBe(false);
  });
});

describe("isPlaybackComplete", () => {
  it("returns true when all conditions met", () => {
    expect(isPlaybackComplete(true, true, true, true)).toBe(true);
  });

  it("returns false when not playOnce", () => {
    expect(isPlaybackComplete(false, true, true, true)).toBe(false);
  });

  it("returns false when animation not complete", () => {
    expect(isPlaybackComplete(true, false, true, true)).toBe(false);
  });

  it("returns false when audio not complete", () => {
    expect(isPlaybackComplete(true, true, false, true)).toBe(false);
  });

  it("returns false when bubble not complete", () => {
    expect(isPlaybackComplete(true, true, true, false)).toBe(false);
  });

  it("returns false when none complete", () => {
    expect(isPlaybackComplete(true, false, false, false)).toBe(false);
  });

  it("returns false when all complete but not playOnce", () => {
    expect(isPlaybackComplete(false, true, true, true)).toBe(false);
  });
});

describe("replaceSpeechPlaceholders", () => {
  it("replaces {nickname}", () => {
    expect(replaceSpeechPlaceholders("Hello {nickname}!", "Alice", 1, 0, "00:00:00"))
      .toBe("Hello Alice!");
  });

  it("replaces {days_used}", () => {
    expect(replaceSpeechPlaceholders("Day {days_used}", "Bob", 42, 0, "00:00:00"))
      .toBe("Day 42");
  });

  it("replaces {usage_hours}", () => {
    expect(replaceSpeechPlaceholders("{usage_hours}h used", "X", 1, 100, "00:00:00"))
      .toBe("100h used");
  });

  it("replaces {total_usage_hours}", () => {
    expect(replaceSpeechPlaceholders("{total_usage_hours}h", "X", 1, 55, "00:00:00"))
      .toBe("55h");
  });

  it("replaces {uptime}", () => {
    expect(replaceSpeechPlaceholders("Uptime: {uptime}", "X", 1, 0, "01:23:45"))
      .toBe("Uptime: 01:23:45");
  });

  it("replaces multiple placeholders", () => {
    const result = replaceSpeechPlaceholders(
      "Hi {nickname}, day {days_used}, {usage_hours}h, uptime {uptime}",
      "Test", 10, 5, "02:30:00",
    );
    expect(result).toBe("Hi Test, day 10, 5h, uptime 02:30:00");
  });

  it("replaces multiple occurrences of same placeholder", () => {
    expect(replaceSpeechPlaceholders("{nickname} is {nickname}", "Eve", 1, 0, "00:00:00"))
      .toBe("Eve is Eve");
  });

  it("returns text unchanged when no placeholders", () => {
    expect(replaceSpeechPlaceholders("plain text", "X", 1, 0, "00:00:00"))
      .toBe("plain text");
  });

  it("handles empty string", () => {
    expect(replaceSpeechPlaceholders("", "X", 1, 0, "00:00:00")).toBe("");
  });
});

describe("calcModDataDelta", () => {
  it("returns null for undefined next value", () => {
    expect(calcModDataDelta(undefined, 10)).toBeNull();
  });

  it("returns null when next is not a number", () => {
    expect(calcModDataDelta(undefined, null)).toBeNull();
  });

  it("returns null when last is null (first time)", () => {
    expect(calcModDataDelta(10, null)).toBeNull();
  });

  it("returns positive delta", () => {
    expect(calcModDataDelta(15, 10)).toBe(5);
  });

  it("returns negative delta", () => {
    expect(calcModDataDelta(3, 10)).toBe(-7);
  });

  it("returns null when values are equal", () => {
    expect(calcModDataDelta(10, 10)).toBeNull();
  });

  it("handles zero values", () => {
    expect(calcModDataDelta(0, 5)).toBe(-5);
    expect(calcModDataDelta(5, 0)).toBe(5);
  });

  it("handles negative numbers", () => {
    expect(calcModDataDelta(-3, -10)).toBe(7);
  });
});

// ============================================================================
// Mods 页面提取的纯逻辑
// ============================================================================

describe("tokenizeLinks", () => {
  it("returns empty array for empty string", () => {
    expect(tokenizeLinks("")).toEqual([]);
  });

  it("returns single text token for plain text", () => {
    expect(tokenizeLinks("hello world")).toEqual([
      { kind: "text", value: "hello world" },
    ]);
  });

  it("extracts a single HTTP URL", () => {
    const result = tokenizeLinks("Visit https://example.com for details");
    expect(result).toEqual([
      { kind: "text", value: "Visit " },
      { kind: "link", href: "https://example.com", text: "https://example.com" },
      { kind: "text", value: " for details" },
    ]);
  });

  it("extracts HTTP URL (not just HTTPS)", () => {
    const result = tokenizeLinks("Go to http://example.com now");
    expect(result).toEqual([
      { kind: "text", value: "Go to " },
      { kind: "link", href: "http://example.com", text: "http://example.com" },
      { kind: "text", value: " now" },
    ]);
  });

  it("handles URL at start of text", () => {
    const result = tokenizeLinks("https://example.com is great");
    expect(result).toEqual([
      { kind: "link", href: "https://example.com", text: "https://example.com" },
      { kind: "text", value: " is great" },
    ]);
  });

  it("handles URL at end of text", () => {
    const result = tokenizeLinks("Visit https://example.com");
    expect(result).toEqual([
      { kind: "text", value: "Visit " },
      { kind: "link", href: "https://example.com", text: "https://example.com" },
    ]);
  });

  it("strips trailing punctuation from URLs", () => {
    const result = tokenizeLinks("See https://example.com, for info.");
    expect(result).toHaveLength(4);
    expect(result[1]).toEqual({ kind: "link", href: "https://example.com", text: "https://example.com" });
    expect(result[2]).toEqual({ kind: "text", value: "," });
  });

  it("strips trailing parenthesis", () => {
    const result = tokenizeLinks("(https://example.com/path)");
    expect(result.find(t => t.kind === "link")).toEqual({
      kind: "link",
      href: "https://example.com/path",
      text: "https://example.com/path",
    });
  });

  it("handles multiple URLs", () => {
    const result = tokenizeLinks("A https://a.com B https://b.com C");
    const links = result.filter(t => t.kind === "link");
    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({ kind: "link", href: "https://a.com", text: "https://a.com" });
    expect(links[1]).toEqual({ kind: "link", href: "https://b.com", text: "https://b.com" });
  });

  it("handles URL with path and query", () => {
    const result = tokenizeLinks("https://example.com/path?key=val&foo=bar");
    expect(result).toEqual([
      { kind: "link", href: "https://example.com/path?key=val&foo=bar", text: "https://example.com/path?key=val&foo=bar" },
    ]);
  });

  it("returns text token for input without URLs", () => {
    expect(tokenizeLinks("no links here")).toEqual([
      { kind: "text", value: "no links here" },
    ]);
  });

  it("strips multiple trailing punctuation marks", () => {
    const result = tokenizeLinks("Check https://example.com!!");
    const link = result.find(t => t.kind === "link");
    expect(link).toEqual({ kind: "link", href: "https://example.com", text: "https://example.com" });
  });
});

describe("toErrorMessage", () => {
  it("returns string error directly", () => {
    expect(toErrorMessage("something failed")).toBe("something failed");
  });

  it("extracts message from Error object", () => {
    expect(toErrorMessage(new Error("oops"))).toBe("oops");
  });

  it("extracts message from object with message property", () => {
    expect(toErrorMessage({ message: "custom error" })).toBe("custom error");
  });

  it("extracts first string value from arbitrary object", () => {
    expect(toErrorMessage({ code: 404, detail: "not found" })).toBe("not found");
  });

  it("returns String(e) for number", () => {
    expect(toErrorMessage(42)).toBe("42");
  });

  it("returns String(e) for null", () => {
    expect(toErrorMessage(null)).toBe("null");
  });

  it("returns String(e) for undefined", () => {
    expect(toErrorMessage(undefined)).toBe("undefined");
  });

  it("handles empty object", () => {
    expect(toErrorMessage({})).toBe("[object Object]");
  });

  it("handles object with only non-string values", () => {
    expect(toErrorMessage({ code: 500, count: 3 })).toBe("[object Object]");
  });
});

describe("needsHydrateSbuddy", () => {
  it("returns true for archive mod with empty version", () => {
    expect(needsHydrateSbuddy(true, "")).toBe(true);
  });

  it("returns true for archive mod with whitespace version", () => {
    expect(needsHydrateSbuddy(true, "  ")).toBe(true);
  });

  it("returns true for archive mod with null version", () => {
    expect(needsHydrateSbuddy(true, null)).toBe(true);
  });

  it("returns true for archive mod with undefined version", () => {
    expect(needsHydrateSbuddy(true, undefined)).toBe(true);
  });

  it("returns false for archive mod with valid version", () => {
    expect(needsHydrateSbuddy(true, "1.0.0")).toBe(false);
  });

  it("returns false for non-archive mod with empty version", () => {
    expect(needsHydrateSbuddy(false, "")).toBe(false);
  });

  it("returns false for non-archive mod with valid version", () => {
    expect(needsHydrateSbuddy(false, "2.0")).toBe(false);
  });
});

describe("resolveCharInfo", () => {
  const info = {
    zh: { name: "中文名" },
    en: { name: "English Name" },
    ja: { name: "日本語名" },
  };

  it("returns current language match", () => {
    expect(resolveCharInfo(info, "zh", "en")).toEqual({ name: "中文名" });
  });

  it("falls back to default language", () => {
    expect(resolveCharInfo(info, "fr", "en")).toEqual({ name: "English Name" });
  });

  it("falls back to first available entry", () => {
    expect(resolveCharInfo(info, "fr", "ko")).toEqual({ name: "中文名" });
  });

  it("returns null for null info", () => {
    expect(resolveCharInfo(null, "zh", "en")).toBeNull();
  });

  it("returns null for undefined info", () => {
    expect(resolveCharInfo(undefined, "zh", "en")).toBeNull();
  });

  it("returns null for empty info object", () => {
    expect(resolveCharInfo({}, "zh", "en")).toBeNull();
  });

  it("handles single language info", () => {
    expect(resolveCharInfo({ de: { name: "Deutsch" } }, "fr", "en")).toEqual({ name: "Deutsch" });
  });
});
