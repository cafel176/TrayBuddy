/**
 * 状态/触发器格式化工具函数
 *
 * 提供跨调试组件共享的格式化与判断逻辑。
 */

import { t } from "$lib/i18n";
import type {
  CanTriggerState,
  Live2DParameterSetting,
  PngRemixParameterSetting,
  StateInfo,
} from "$lib/types/asset";

export const I32_MIN = -2147483648;
export const I32_MAX = 2147483647;

/** 格式化触发计数器范围为 `[*, 10]` 形式。 */
export function formatTriggerCounterRange(start?: number, end?: number): string {
  const s = Number.isFinite(Number(start)) ? Number(start) : I32_MIN;
  const e = Number.isFinite(Number(end)) ? Number(end) : I32_MAX;

  const sText = s <= I32_MIN ? "*" : String(s);
  const eText = e >= I32_MAX ? "*" : String(e);
  return `[${sText}, ${eText}]`;
}

/** 判断计数器范围是否有限制。 */
export function isTriggerCounterRangeLimited(state: StateInfo): boolean {
  const s = Number.isFinite(Number(state.trigger_counter_start))
    ? Number(state.trigger_counter_start)
    : I32_MIN;
  const e = Number.isFinite(Number(state.trigger_counter_end))
    ? Number(state.trigger_counter_end)
    : I32_MAX;
  return s > I32_MIN || e < I32_MAX;
}

/** 格式化温度范围为 `[*°C, 30°C]` 形式。 */
export function formatTempRange(start?: number, end?: number): string {
  const s = Number.isFinite(Number(start)) ? Number(start) : I32_MIN;
  const e = Number.isFinite(Number(end)) ? Number(end) : I32_MAX;

  const sText = s <= I32_MIN ? "*" : `${s}°C`;
  const eText = e >= I32_MAX ? "*" : `${e}°C`;
  return `[${sText}, ${eText}]`;
}

/** 判断温度范围是否有限制。 */
export function isTempRangeLimited(state: StateInfo): boolean {
  const s = Number.isFinite(Number(state.trigger_temp_start))
    ? Number(state.trigger_temp_start)
    : I32_MIN;
  const e = Number.isFinite(Number(state.trigger_temp_end))
    ? Number(state.trigger_temp_end)
    : I32_MAX;
  return s > I32_MIN || e < I32_MAX;
}

/** 格式化天气条件列表。 */
export function formatWeather(weather?: string[]): string {
  return weather && weather.length > 0 ? weather.join(", ") : "";
}

/** 格式化运行时长（分钟）。在模板的响应式上下文中调用。 */
export function formatUptimeMinutes(minutes?: number): string {
  return t("state.uptimeMinutes", { minutes: minutes ?? 0 });
}

/** 格式化可触发状态列表（含权重）。 */
export function formatTriggerableStates(states?: CanTriggerState[]): string {
  if (!states || states.length === 0) return "";
  return states
    .map((s) => `${s.state}${(s.weight ?? 1) !== 1 ? `(${s.weight})` : ""}`)
    .join(", ");
}

/** 格式化 Live2D 参数列表。 */
export function formatLive2dParams(params?: Live2DParameterSetting[]): string {
  if (!params || params.length === 0) return "";
  return params
    .map((p) => {
      const target = p.target || "Parameter";
      return `${p.id}=${p.value} (${target})`;
    })
    .join(", ");
}

/** 判断 mod_data_counter 是否有实际效果（排除 add 0 / sub 0 等无效操作）。 */
export function isModDataCounterEffective(counter?: {
  op: string;
  value: number;
} | null): boolean {
  if (!counter) return false;
  if ((counter.op === "add" || counter.op === "sub") && counter.value === 0) {
    return false;
  }
  return true;
}

/** 格式化 PngRemix 参数列表。 */
export function formatPngRemixParams(params?: PngRemixParameterSetting[]): string {
  if (!params || params.length === 0) return "";
  return params.map((p) => `${p.type}:${p.name}`).join(", ");
}
