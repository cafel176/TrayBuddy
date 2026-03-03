import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  CURSOR_POLL_INTERVAL_MS,
  TYPEWRITER_DEFAULT_SPEED_MS,
  BUBBLE_SWITCH_DELAY_MS,
  BUBBLE_DEFAULT_AUTO_CLOSE_MS,
  BUBBLE_CLOSE_ANIMATION_MS,
  TRAY_ADAPTIVE_OFFSET_Y,
  DEBUG_CLOCK_UPDATE_INTERVAL_MS,
  RENDER_TUNING,
  logger,
} from "$lib/constants";

describe("constants", () => {
  // ========================================================================
  // 常量值稳定性测试
  // ========================================================================

  describe("exported constant values", () => {
    it("CURSOR_POLL_INTERVAL_MS is a positive number", () => {
      expect(CURSOR_POLL_INTERVAL_MS).toBe(150);
    });

    it("TYPEWRITER_DEFAULT_SPEED_MS is a positive number", () => {
      expect(TYPEWRITER_DEFAULT_SPEED_MS).toBe(50);
    });

    it("BUBBLE_SWITCH_DELAY_MS is a positive number", () => {
      expect(BUBBLE_SWITCH_DELAY_MS).toBe(250);
    });

    it("BUBBLE_DEFAULT_AUTO_CLOSE_MS is a positive number", () => {
      expect(BUBBLE_DEFAULT_AUTO_CLOSE_MS).toBe(2000);
    });

    it("BUBBLE_CLOSE_ANIMATION_MS is a positive number", () => {
      expect(BUBBLE_CLOSE_ANIMATION_MS).toBe(200);
    });

    it("TRAY_ADAPTIVE_OFFSET_Y is a positive number", () => {
      expect(TRAY_ADAPTIVE_OFFSET_Y).toBe(20);
    });

    it("DEBUG_CLOCK_UPDATE_INTERVAL_MS is a positive number", () => {
      expect(DEBUG_CLOCK_UPDATE_INTERVAL_MS).toBe(3000);
    });
  });

  // ========================================================================
  // RENDER_TUNING
  // ========================================================================

  describe("RENDER_TUNING", () => {
    it("has DPR clamp settings", () => {
      expect(RENDER_TUNING.DPR_CLAMP_ENABLED).toBe(true);
      expect(RENDER_TUNING.DPR_CLAMP_MIN).toBe(1);
      expect(RENDER_TUNING.DPR_CLAMP_MAX).toBe(2);
    });

    it("has antialias setting", () => {
      expect(RENDER_TUNING.ANTIALIAS_ENABLED).toBe(false);
    });

    it("has FPS limit settings", () => {
      expect(RENDER_TUNING.FPS_LIMIT_ENABLED).toBe(true);
      expect(RENDER_TUNING.FPS_LIMIT_MAX).toBe(30);
    });
  });

  // ========================================================================
  // logger
  // ========================================================================

  describe("logger", () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    let infoSpy: ReturnType<typeof vi.spyOn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      logSpy.mockRestore();
      infoSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("logger.warn always outputs", () => {
      logger.warn("test warning");
      expect(warnSpy).toHaveBeenCalledWith("test warning");
    });

    it("logger.error always outputs", () => {
      logger.error("test error");
      expect(errorSpy).toHaveBeenCalledWith("test error");
    });

    it("logger.debug calls console.log (in dev/test mode IS_DEV is true)", () => {
      logger.debug("debug msg");
      // In vitest, import.meta.env.DEV is true
      expect(logSpy).toHaveBeenCalledWith("debug msg");
    });

    it("logger.info calls console.info (in dev/test mode)", () => {
      logger.info("info msg");
      expect(infoSpy).toHaveBeenCalledWith("info msg");
    });

    it("logger methods accept multiple arguments", () => {
      logger.warn("a", "b", 123);
      expect(warnSpy).toHaveBeenCalledWith("a", "b", 123);
    });
  });
});
