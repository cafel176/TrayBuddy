import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getRawDpr,
  getRenderDpr,
  isAntialiasEnabled,
  getRenderMaxFps,
  capFps,
} from "$lib/animation/render_tuning";

describe("render_tuning", () => {
  // ========================================================================
  // getRawDpr
  // ========================================================================

  describe("getRawDpr", () => {
    it("returns window.devicePixelRatio when available", () => {
      (window as any).devicePixelRatio = 2;
      expect(getRawDpr()).toBe(2);
    });

    it("returns 1 for zero devicePixelRatio", () => {
      (window as any).devicePixelRatio = 0;
      expect(getRawDpr()).toBe(1);
    });

    it("returns 1 for negative devicePixelRatio", () => {
      (window as any).devicePixelRatio = -1;
      expect(getRawDpr()).toBe(1);
    });

    it("returns 1 for NaN devicePixelRatio", () => {
      (window as any).devicePixelRatio = NaN;
      expect(getRawDpr()).toBe(1);
    });

    it("returns 1 for undefined devicePixelRatio", () => {
      (window as any).devicePixelRatio = undefined;
      expect(getRawDpr()).toBe(1);
    });
  });

  // ========================================================================
  // getRenderDpr
  // ========================================================================

  describe("getRenderDpr", () => {
    it("clamps dpr to [1, 2] by default (RENDER_TUNING.DPR_CLAMP_ENABLED is true)", () => {
      (window as any).devicePixelRatio = 3;
      // DPR_CLAMP_MAX is 2 per constants.ts
      expect(getRenderDpr()).toBe(2);
    });

    it("clamps dpr minimum to 1", () => {
      (window as any).devicePixelRatio = 0.5;
      expect(getRenderDpr()).toBe(1);
    });

    it("returns exact dpr when within range", () => {
      (window as any).devicePixelRatio = 1.5;
      expect(getRenderDpr()).toBe(1.5);
    });
  });

  // ========================================================================
  // isAntialiasEnabled
  // ========================================================================

  describe("isAntialiasEnabled", () => {
    it("returns false (ANTIALIAS_ENABLED is false in constants)", () => {
      expect(isAntialiasEnabled()).toBe(false);
    });
  });

  // ========================================================================
  // getRenderMaxFps
  // ========================================================================

  describe("getRenderMaxFps", () => {
    it("returns clamped FPS_LIMIT_MAX when FPS_LIMIT_ENABLED is true", () => {
      // FPS_LIMIT_ENABLED is true, FPS_LIMIT_MAX is 30
      const fps = getRenderMaxFps();
      expect(fps).toBe(30);
    });
  });

  // ========================================================================
  // capFps
  // ========================================================================

  describe("capFps", () => {
    it("returns the player fps when less than global cap", () => {
      // 20 < 30(global cap) → 20
      expect(capFps(20)).toBe(20);
    });

    it("caps to global fps limit when player fps exceeds it", () => {
      // global cap is 30, min(120, 30) = 30
      expect(capFps(120)).toBe(30);
    });

    it("falls back to 60 for zero input, then caps to global 30", () => {
      // 0 || 60 = 60, min(60, 30) = 30
      expect(capFps(0)).toBe(30);
    });

    it("falls back to 60 for negative input (-10 is clamped to 1, but -10||60 = 60 first)", () => {
      // Number(-10) || 60 → -10 (truthy), then clampNumber(-10, 1, 240) = 1, min(1, 30) = 1
      expect(capFps(-10)).toBe(1);
    });

    it("clamps NaN to 60 then caps to global 30", () => {
      // NaN → fallback 60, min(60, 30) = 30
      expect(capFps(NaN)).toBe(30);
    });

    it("clamps to 240 for very large input then caps to global 30", () => {
      // clamp(999, 1, 240) = 240, min(240, 30) = 30
      expect(capFps(999)).toBe(30);
    });
  });
});
