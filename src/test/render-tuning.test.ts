import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getRawDpr,
  getRenderDpr,
  isAntialiasEnabled,
  getRenderMaxFps,
  capFps,
  getIdleThrottleFps,
  IdleThrottle,
} from "$lib/animation/render_tuning";
import { RENDER_TUNING } from "$lib/constants";

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

  // ========================================================================
  // getIdleThrottleFps
  // ========================================================================

  describe("getIdleThrottleFps", () => {
    it("returns a number in [1, 30]", () => {
      const fps = getIdleThrottleFps();
      expect(fps).toBeGreaterThanOrEqual(1);
      expect(fps).toBeLessThanOrEqual(30);
    });
  });

  // ========================================================================
  // IdleThrottle
  // ========================================================================

  describe("IdleThrottle", () => {
    it("poke resets idle state", () => {
      const origEnabled = RENDER_TUNING.IDLE_THROTTLE_ENABLED;
      RENDER_TUNING.IDLE_THROTTLE_ENABLED = true;
      try {
        const throttle = new IdleThrottle();
        expect(throttle.idle).toBe(false);
        throttle.poke();
        expect(throttle.idle).toBe(false);
      } finally {
        RENDER_TUNING.IDLE_THROTTLE_ENABLED = origEnabled;
      }
    });

    it("shouldSkipFrame returns false when not idle", () => {
      const origEnabled = RENDER_TUNING.IDLE_THROTTLE_ENABLED;
      RENDER_TUNING.IDLE_THROTTLE_ENABLED = true;
      try {
        const throttle = new IdleThrottle();
        throttle.poke();
        const ts = performance.now() + 100;
        expect(throttle.shouldSkipFrame(ts)).toBe(false);
      } finally {
        RENDER_TUNING.IDLE_THROTTLE_ENABLED = origEnabled;
      }
    });

    it("enters idle after delay and throttles frames", () => {
      const origEnabled = RENDER_TUNING.IDLE_THROTTLE_ENABLED;
      RENDER_TUNING.IDLE_THROTTLE_ENABLED = true;
      try {
        const throttle = new IdleThrottle();
        // Simulate time passing beyond the delay threshold
        const now = performance.now();
        // Force idle by advancing timestamp well beyond delay
        const futureTs = now + 60000; // 60 seconds later
        // First call should detect idle transition and render
        const skip1 = throttle.shouldSkipFrame(futureTs);
        expect(throttle.idle).toBe(true);
        expect(skip1).toBe(false); // First frame after entering idle should render

        // Immediately subsequent frame should be skipped (within idleMinDeltaMs)
        const skip2 = throttle.shouldSkipFrame(futureTs + 1);
        expect(skip2).toBe(true);

        // Frame well after idle delta should render
        const skip3 = throttle.shouldSkipFrame(futureTs + 1000);
        expect(skip3).toBe(false);
      } finally {
        RENDER_TUNING.IDLE_THROTTLE_ENABLED = origEnabled;
      }
    });

    it("poke exits idle state", () => {
      const origEnabled = RENDER_TUNING.IDLE_THROTTLE_ENABLED;
      RENDER_TUNING.IDLE_THROTTLE_ENABLED = true;
      try {
        const throttle = new IdleThrottle();
        const now = performance.now();
        // Force into idle
        throttle.shouldSkipFrame(now + 60000);
        expect(throttle.idle).toBe(true);
        // Poke should exit idle
        throttle.poke();
        expect(throttle.idle).toBe(false);
      } finally {
        RENDER_TUNING.IDLE_THROTTLE_ENABLED = origEnabled;
      }
    });

    it("shouldSkipFrame returns false when throttle is disabled", () => {
      const origEnabled = RENDER_TUNING.IDLE_THROTTLE_ENABLED;
      RENDER_TUNING.IDLE_THROTTLE_ENABLED = false;
      try {
        const throttle = new IdleThrottle();
        const ts = performance.now() + 60000;
        expect(throttle.shouldSkipFrame(ts)).toBe(false);
      } finally {
        RENDER_TUNING.IDLE_THROTTLE_ENABLED = origEnabled;
      }
    });
  });

  // ========================================================================
  // getRenderDpr with DPR_CLAMP_ENABLED = false
  // ========================================================================

  describe("getRenderDpr (clamp disabled)", () => {
    it("returns raw dpr when clamp is disabled", () => {
      const origEnabled = RENDER_TUNING.DPR_CLAMP_ENABLED;
      RENDER_TUNING.DPR_CLAMP_ENABLED = false;
      try {
        (window as any).devicePixelRatio = 3;
        expect(getRenderDpr()).toBe(3);
      } finally {
        RENDER_TUNING.DPR_CLAMP_ENABLED = origEnabled;
      }
    });
  });

  // ========================================================================
  // getRenderMaxFps with FPS_LIMIT_ENABLED = false
  // ========================================================================

  describe("getRenderMaxFps (limit disabled)", () => {
    it("returns null when fps limit is disabled", () => {
      const origEnabled = RENDER_TUNING.FPS_LIMIT_ENABLED;
      RENDER_TUNING.FPS_LIMIT_ENABLED = false;
      try {
        expect(getRenderMaxFps()).toBeNull();
      } finally {
        RENDER_TUNING.FPS_LIMIT_ENABLED = origEnabled;
      }
    });
  });

  // ========================================================================
  // capFps with no global cap
  // ========================================================================

  describe("capFps (no global cap)", () => {
    it("returns player fps directly when global cap is null", () => {
      const origEnabled = RENDER_TUNING.FPS_LIMIT_ENABLED;
      RENDER_TUNING.FPS_LIMIT_ENABLED = false;
      try {
        expect(capFps(120)).toBe(120);
      } finally {
        RENDER_TUNING.FPS_LIMIT_ENABLED = origEnabled;
      }
    });
  });
});
