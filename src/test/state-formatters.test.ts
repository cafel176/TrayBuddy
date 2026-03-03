import { describe, expect, it } from "vitest";
import {
  formatTriggerCounterRange,
  isTriggerCounterRangeLimited,
  formatTempRange,
  isTempRangeLimited,
  formatWeather,
  formatUptimeMinutes,
  formatTriggerableStates,
  formatLive2dParams,
  isModDataCounterEffective,
  formatPngRemixParams,
  I32_MIN,
  I32_MAX,
} from "$lib/utils/stateFormatters";
import type { StateInfo, CanTriggerState, Live2DParameterSetting, PngRemixParameterSetting } from "$lib/types/asset";

describe("stateFormatters", () => {
  // formatTriggerCounterRange
  it("formats unlimited counter range as [*, *]", () => {
    expect(formatTriggerCounterRange(I32_MIN, I32_MAX)).toBe("[*, *]");
    expect(formatTriggerCounterRange(undefined, undefined)).toBe("[*, *]");
  });

  it("formats partial counter range", () => {
    expect(formatTriggerCounterRange(0, 10)).toBe("[0, 10]");
    expect(formatTriggerCounterRange(5, I32_MAX)).toBe("[5, *]");
    expect(formatTriggerCounterRange(I32_MIN, 100)).toBe("[*, 100]");
  });

  it("handles NaN/non-finite counter values", () => {
    expect(formatTriggerCounterRange(NaN, NaN)).toBe("[*, *]");
  });

  // isTriggerCounterRangeLimited
  it("detects limited counter range", () => {
    const s = { trigger_counter_start: 0, trigger_counter_end: 10 } as StateInfo;
    expect(isTriggerCounterRangeLimited(s)).toBe(true);
  });

  it("detects unlimited counter range", () => {
    const s = { trigger_counter_start: I32_MIN, trigger_counter_end: I32_MAX } as StateInfo;
    expect(isTriggerCounterRangeLimited(s)).toBe(false);
  });

  it("handles undefined counter fields", () => {
    const s = {} as StateInfo;
    expect(isTriggerCounterRangeLimited(s)).toBe(false);
  });

  // formatTempRange
  it("formats temp range with °C", () => {
    expect(formatTempRange(0, 30)).toBe("[0°C, 30°C]");
    expect(formatTempRange(I32_MIN, I32_MAX)).toBe("[*, *]");
    expect(formatTempRange(undefined, 20)).toBe("[*, 20°C]");
    expect(formatTempRange(10, undefined)).toBe("[10°C, *]");
  });

  // isTempRangeLimited
  it("detects limited temp range", () => {
    const s = { trigger_temp_start: 0, trigger_temp_end: 30 } as StateInfo;
    expect(isTempRangeLimited(s)).toBe(true);
  });

  it("detects unlimited temp range", () => {
    const s = { trigger_temp_start: I32_MIN, trigger_temp_end: I32_MAX } as StateInfo;
    expect(isTempRangeLimited(s)).toBe(false);
  });

  // formatWeather
  it("formats weather conditions", () => {
    expect(formatWeather(["晴", "多云"])).toBe("晴, 多云");
    expect(formatWeather([])).toBe("");
    expect(formatWeather(undefined)).toBe("");
  });

  // formatUptimeMinutes
  it("formats uptime minutes", () => {
    const result = formatUptimeMinutes(30);
    expect(typeof result).toBe("string");
    const resultDefault = formatUptimeMinutes(undefined);
    expect(typeof resultDefault).toBe("string");
  });

  // formatTriggerableStates
  it("formats triggerable states with weights", () => {
    const states: CanTriggerState[] = [
      { state: "idle", weight: 1 },
      { state: "happy", weight: 3 },
    ];
    expect(formatTriggerableStates(states)).toBe("idle, happy(3)");
  });

  it("returns empty for no triggerable states", () => {
    expect(formatTriggerableStates([])).toBe("");
    expect(formatTriggerableStates(undefined)).toBe("");
  });

  it("handles weight=1 without parentheses", () => {
    const states: CanTriggerState[] = [{ state: "idle", weight: 1 }];
    expect(formatTriggerableStates(states)).toBe("idle");
  });

  it("handles undefined weight as default (1)", () => {
    const states = [{ state: "test" }] as CanTriggerState[];
    expect(formatTriggerableStates(states)).toBe("test");
  });

  // formatLive2dParams
  it("formats Live2D params", () => {
    const params: Live2DParameterSetting[] = [
      { id: "ParamEye", value: 1, target: "Live2D" },
      { id: "ParamMouth", value: 0.5 } as any,
    ];
    expect(formatLive2dParams(params)).toBe("ParamEye=1 (Live2D), ParamMouth=0.5 (Parameter)");
  });

  it("returns empty for no Live2D params", () => {
    expect(formatLive2dParams([])).toBe("");
    expect(formatLive2dParams(undefined)).toBe("");
  });

  // isModDataCounterEffective
  it("detects effective counter operations", () => {
    expect(isModDataCounterEffective({ op: "add", value: 5 })).toBe(true);
    expect(isModDataCounterEffective({ op: "set", value: 0 })).toBe(true);
    expect(isModDataCounterEffective({ op: "mul", value: 2 })).toBe(true);
  });

  it("detects ineffective counter operations", () => {
    expect(isModDataCounterEffective({ op: "add", value: 0 })).toBe(false);
    expect(isModDataCounterEffective({ op: "sub", value: 0 })).toBe(false);
    expect(isModDataCounterEffective(null)).toBe(false);
    expect(isModDataCounterEffective(undefined)).toBe(false);
  });

  // formatPngRemixParams
  it("formats PngRemix params", () => {
    const params: PngRemixParameterSetting[] = [
      { type: "expression", name: "happy" },
      { type: "motion", name: "wave" },
    ];
    expect(formatPngRemixParams(params)).toBe("expression:happy, motion:wave");
  });

  it("returns empty for no PngRemix params", () => {
    expect(formatPngRemixParams([])).toBe("");
    expect(formatPngRemixParams(undefined)).toBe("");
  });
});
