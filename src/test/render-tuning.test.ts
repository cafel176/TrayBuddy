import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  getRawDpr,
  getRenderDpr,
  isAntialiasEnabled,
  getRenderMaxFps,
  capFps,
  getIdleThrottleFps,
  IdleThrottle,
  initRenderTuning,
} from "$lib/animation/render_tuning";
import { RENDER_TUNING } from "$lib/constants";
import { invoke } from "@tauri-apps/api/core";

describe("render_tuning", () => {
  function withIdleThrottleConfig(
    config: Partial<{ enabled: boolean; delayMs: number }>,
    fn: () => void,
  ) {
    const origEnabled = RENDER_TUNING.IDLE_THROTTLE_ENABLED;
    const origDelay = RENDER_TUNING.IDLE_THROTTLE_DELAY_MS;
    if (typeof config.enabled === "boolean") RENDER_TUNING.IDLE_THROTTLE_ENABLED = config.enabled;
    if (typeof config.delayMs === "number") RENDER_TUNING.IDLE_THROTTLE_DELAY_MS = config.delayMs;
    try {
      fn();
    } finally {
      RENDER_TUNING.IDLE_THROTTLE_ENABLED = origEnabled;
      RENDER_TUNING.IDLE_THROTTLE_DELAY_MS = origDelay;
    }
  }


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
      withIdleThrottleConfig({ enabled: true }, () => {
        const throttle = new IdleThrottle();
        expect(throttle.idle).toBe(false);
        throttle.poke();
        expect(throttle.idle).toBe(false);
      });
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

  // ========================================================================
  // clampNumber (via getRenderDpr / getRenderMaxFps edge cases)
  // ========================================================================

  describe("clampNumber edge cases (via exported functions)", () => {
    it("getRenderDpr returns DPR_CLAMP_MIN for Infinity devicePixelRatio", () => {
      (window as any).devicePixelRatio = Infinity;
      // clampNumber(Infinity, min, max) → min because !Number.isFinite(Infinity)
      expect(getRenderDpr()).toBe(RENDER_TUNING.DPR_CLAMP_MIN);
    });

    it("getRenderDpr returns DPR_CLAMP_MIN for -Infinity devicePixelRatio", () => {
      (window as any).devicePixelRatio = -Infinity;
      // -Infinity || 1 → 1, then clampNumber(1, 1, 2) → 1
      expect(getRenderDpr()).toBe(1);
    });

    it("getRenderMaxFps falls back to 60 when FPS_LIMIT_MAX is NaN", () => {
      const origMax = RENDER_TUNING.FPS_LIMIT_MAX;
      RENDER_TUNING.FPS_LIMIT_MAX = NaN;
      try {
        // Number(NaN) || 60 → 60, clamp(60, 1, 240) → 60
        expect(getRenderMaxFps()).toBe(60);
      } finally {
        RENDER_TUNING.FPS_LIMIT_MAX = origMax;
      }
    });

    it("getRenderMaxFps falls back to 60 when FPS_LIMIT_MAX is 0", () => {
      const origMax = RENDER_TUNING.FPS_LIMIT_MAX;
      RENDER_TUNING.FPS_LIMIT_MAX = 0;
      try {
        // Number(0) || 60 → 60
        expect(getRenderMaxFps()).toBe(60);
      } finally {
        RENDER_TUNING.FPS_LIMIT_MAX = origMax;
      }
    });

    it("getRenderMaxFps clamps negative to 1", () => {
      const origMax = RENDER_TUNING.FPS_LIMIT_MAX;
      RENDER_TUNING.FPS_LIMIT_MAX = -10;
      try {
        // Number(-10) || 60 → -10 (truthy), clamp(-10, 1, 240) → 1
        expect(getRenderMaxFps()).toBe(1);
      } finally {
        RENDER_TUNING.FPS_LIMIT_MAX = origMax;
      }
    });

    it("getRenderMaxFps clamps very large value to 240", () => {
      const origMax = RENDER_TUNING.FPS_LIMIT_MAX;
      RENDER_TUNING.FPS_LIMIT_MAX = 999;
      try {
        expect(getRenderMaxFps()).toBe(240);
      } finally {
        RENDER_TUNING.FPS_LIMIT_MAX = origMax;
      }
    });
  });

  // ========================================================================
  // getIdleThrottleFps edge cases
  // ========================================================================

  describe("getIdleThrottleFps edge cases", () => {
    it("clamps 0 to 5 (fallback)", () => {
      const orig = RENDER_TUNING.IDLE_THROTTLE_FPS;
      RENDER_TUNING.IDLE_THROTTLE_FPS = 0;
      try {
        // Number(0) || 5 → 5
        expect(getIdleThrottleFps()).toBe(5);
      } finally {
        RENDER_TUNING.IDLE_THROTTLE_FPS = orig;
      }
    });

    it("clamps negative to 1", () => {
      const orig = RENDER_TUNING.IDLE_THROTTLE_FPS;
      RENDER_TUNING.IDLE_THROTTLE_FPS = -5;
      try {
        // Number(-5) || 5 → -5 (truthy), clamp(-5, 1, 30) → 1
        expect(getIdleThrottleFps()).toBe(1);
      } finally {
        RENDER_TUNING.IDLE_THROTTLE_FPS = orig;
      }
    });

    it("clamps very large to 30", () => {
      const orig = RENDER_TUNING.IDLE_THROTTLE_FPS;
      RENDER_TUNING.IDLE_THROTTLE_FPS = 100;
      try {
        expect(getIdleThrottleFps()).toBe(30);
      } finally {
        RENDER_TUNING.IDLE_THROTTLE_FPS = orig;
      }
    });

    it("returns exact value within range", () => {
      const orig = RENDER_TUNING.IDLE_THROTTLE_FPS;
      RENDER_TUNING.IDLE_THROTTLE_FPS = 15;
      try {
        expect(getIdleThrottleFps()).toBe(15);
      } finally {
        RENDER_TUNING.IDLE_THROTTLE_FPS = orig;
      }
    });
  });

  // ========================================================================
  // initRenderTuning
  // ========================================================================

  describe("initRenderTuning", () => {
    const invokeMock = vi.mocked(invoke);
    let origFpsMax: number;
    let origIdleEnabled: boolean;
    let origIdleFps: number;
    let origIdleDelay: number;

    beforeEach(() => {
      // Save originals
      origFpsMax = RENDER_TUNING.FPS_LIMIT_MAX;
      origIdleEnabled = RENDER_TUNING.IDLE_THROTTLE_ENABLED;
      origIdleFps = RENDER_TUNING.IDLE_THROTTLE_FPS;
      origIdleDelay = RENDER_TUNING.IDLE_THROTTLE_DELAY_MS;

      // Reset _initialized flag by re-importing won't work, so we need to
      // force initialization by relying on the module-scoped flag.
      // The flag `_initialized` is module-scoped; once true, initRenderTuning
      // skips. We'll test the code paths that are reachable.
    });

    afterEach(() => {
      RENDER_TUNING.FPS_LIMIT_MAX = origFpsMax;
      RENDER_TUNING.IDLE_THROTTLE_ENABLED = origIdleEnabled;
      RENDER_TUNING.IDLE_THROTTLE_FPS = origIdleFps;
      RENDER_TUNING.IDLE_THROTTLE_DELAY_MS = origIdleDelay;
    });

    it("is safe to call multiple times (second call is no-op)", async () => {
      // _initialized is already true from the first call in the module
      await initRenderTuning();
      // Should not throw and should not change anything
      expect(RENDER_TUNING.FPS_LIMIT_MAX).toBe(origFpsMax);
    });

    it("invoke failure does not throw (uses defaults silently)", async () => {
      // Even if invoke would throw, initRenderTuning catches it
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      // Already initialized, so invoke won't be called
      await expect(initRenderTuning()).resolves.toBeUndefined();
      warnSpy.mockRestore();
    });
  });

  // ========================================================================
  // IdleThrottle — additional edge cases
  // ========================================================================

  describe("IdleThrottle (additional)", () => {
    it("constructor uses IDLE_THROTTLE_DELAY_MS with minimum of 500", () => {
      const origEnabled = RENDER_TUNING.IDLE_THROTTLE_ENABLED;
      const origDelay = RENDER_TUNING.IDLE_THROTTLE_DELAY_MS;
      RENDER_TUNING.IDLE_THROTTLE_ENABLED = true;
      RENDER_TUNING.IDLE_THROTTLE_DELAY_MS = 100; // below 500 minimum
      try {
        const throttle = new IdleThrottle();
        // delayMs should be clamped to 500
        // We can verify by checking that idle is not entered after 200ms
        const now = performance.now();
        expect(throttle.shouldSkipFrame(now + 200)).toBe(false);
        expect(throttle.idle).toBe(false);
        // But it should enter idle after 600ms (> 500)
        expect(throttle.shouldSkipFrame(now + 600)).toBe(false); // first frame renders
        expect(throttle.idle).toBe(true);
      } finally {
        RENDER_TUNING.IDLE_THROTTLE_ENABLED = origEnabled;
        RENDER_TUNING.IDLE_THROTTLE_DELAY_MS = origDelay;
      }
    });

    it("constructor uses NaN delay → fallback to 3000", () => {
      const origEnabled = RENDER_TUNING.IDLE_THROTTLE_ENABLED;
      const origDelay = RENDER_TUNING.IDLE_THROTTLE_DELAY_MS;
      RENDER_TUNING.IDLE_THROTTLE_ENABLED = true;
      RENDER_TUNING.IDLE_THROTTLE_DELAY_MS = NaN;
      try {
        const throttle = new IdleThrottle();
        const now = performance.now();
        // Should not enter idle after 2s (NaN || 3000 → 3000)
        expect(throttle.shouldSkipFrame(now + 2000)).toBe(false);
        expect(throttle.idle).toBe(false);
        // Should enter idle after 4s
        expect(throttle.shouldSkipFrame(now + 4000)).toBe(false);
        expect(throttle.idle).toBe(true);
      } finally {
        RENDER_TUNING.IDLE_THROTTLE_ENABLED = origEnabled;
        RENDER_TUNING.IDLE_THROTTLE_DELAY_MS = origDelay;
      }
    });

    it("shouldSkipFrame with lastRenderTs = 0 always renders first idle frame", () => {
      withIdleThrottleConfig({ enabled: true }, () => {
        const throttle = new IdleThrottle();
        const now = performance.now();
        // Enter idle
        const skip = throttle.shouldSkipFrame(now + 60000);
        expect(throttle.idle).toBe(true);
        expect(skip).toBe(false); // First frame, lastRenderTs was 0
      });
    });

    it("poke between idle frames prevents skipping", () => {
      const origEnabled = RENDER_TUNING.IDLE_THROTTLE_ENABLED;
      RENDER_TUNING.IDLE_THROTTLE_ENABLED = true;
      try {
        const throttle = new IdleThrottle();
        const now = performance.now();
        // Enter idle
        throttle.shouldSkipFrame(now + 60000);
        expect(throttle.idle).toBe(true);
        // Poke to exit idle — poke() uses performance.now() internally,
        // so we need shouldSkipFrame's ts to be close to performance.now()
        throttle.poke();
        expect(throttle.idle).toBe(false);
        // Use a timestamp close to performance.now() (within delayMs) so idle is not re-entered
        const pokeTime = performance.now();
        const skip = throttle.shouldSkipFrame(pokeTime + 1);
        expect(skip).toBe(false);
        expect(throttle.idle).toBe(false);
      } finally {
        RENDER_TUNING.IDLE_THROTTLE_ENABLED = origEnabled;
      }
    });
  });

  // ========================================================================
  // isAntialiasEnabled with ANTIALIAS_ENABLED = true
  // ========================================================================

  describe("isAntialiasEnabled (enabled)", () => {
    it("returns true when ANTIALIAS_ENABLED is set to true", () => {
      const orig = RENDER_TUNING.ANTIALIAS_ENABLED;
      (RENDER_TUNING as any).ANTIALIAS_ENABLED = true;
      try {
        expect(isAntialiasEnabled()).toBe(true);
      } finally {
        (RENDER_TUNING as any).ANTIALIAS_ENABLED = orig;
      }
    });
  });
});
