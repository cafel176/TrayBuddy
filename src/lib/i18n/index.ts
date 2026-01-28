/**
 * i18n - 多语言支持模块
 *
 * 该模块提供前端多语言支持，特性：
 * - 根据用户设置的语言代码加载对应语言文件
 * - 支持嵌套键路径访问（如 "settings.title"）
 * - 支持模板字符串替换（如 "{count} 个"）
 * - 响应语言切换事件实时更新
 * - 动态获取可用语言列表
 *
 * ## 使用示例
 * ```typescript
 * import { t, initI18n, currentLang, getAvailableLangs } from "$lib/i18n";
 * 
 * // 初始化（通常在 +page.svelte 的 onMount 中）
 * await initI18n();
 * 
 * // 获取翻译文本
 * const title = t("settings.title");  // "用户设置"
 * const msg = t("resource.statusRefreshed", { count: 5 });  // "已刷新 Mod 列表，共 5 个"
 * 
 * // 获取可用语言列表
 * const langs = getAvailableLangs();  // [{ code: "zh", name: "中文" }, ...]
 * ```
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { UserSettings } from "../types/asset";

// ============================================================================
// 语言文件导入 (从项目根目录 i18n/ 加载)
// ============================================================================

import zhLang from "../../../i18n/zh.json";
import enLang from "../../../i18n/en.json";
import jpLang from "../../../i18n/jp.json";

/** 语言信息接口 */
export interface LangInfo {
  /** 语言代码 */
  code: string;
  /** 语言显示名称 */
  name: string;
}

/** 支持的语言映射表 */
const LANG_MAP: Record<string, Record<string, unknown>> = {
  zh: zhLang,
  en: enLang,
  jp: jpLang,
};

/** 默认语言 */
const DEFAULT_LANG = "zh";

// ============================================================================
// 状态管理
// ============================================================================

/** 当前语言代码 */
let _currentLang = DEFAULT_LANG;

/** 当前语言字典 */
let _dict: Record<string, unknown> = zhLang;

/** 语言变更回调列表 */
let _listeners: Array<() => void> = [];

/** 设置变更事件取消函数 */
let _unlistenSettings: UnlistenFn | null = null;

// ============================================================================
// 公共 API
// ============================================================================

/**
 * 获取当前语言代码
 */
export function currentLang(): string {
  return _currentLang;
}

/**
 * 获取可用语言列表
 * 
 * 从 LANG_MAP 中动态读取所有已导入的语言文件
 * 每个语言文件顶层的 "lang" 字段作为显示名称
 * 
 * @returns 语言信息数组 [{ code: "zh", name: "中文" }, ...]
 */
export function getAvailableLangs(): LangInfo[] {
  return Object.entries(LANG_MAP).map(([code, dict]) => ({
    code,
    name: (dict as Record<string, unknown>).lang as string || code,
  }));
}

/**
 * 初始化 i18n 模块
 * 
 * 从后端加载用户设置，并监听语言变更事件
 */
export async function initI18n(): Promise<void> {
  try {
    // 加载用户设置获取语言
    const settings: UserSettings = await invoke("get_settings");
    setLang(settings.lang);

    // 监听设置变更
    _unlistenSettings = await listen<UserSettings>("settings-change", (event) => {
      // 只在 lang 字段存在且值变化时更新
      if ("lang" in event.payload && event.payload.lang !== _currentLang) {
        setLang(event.payload.lang);
      }
    });
  } catch (e) {
    console.error("Failed to init i18n:", e);
  }
}

/**
 * 销毁 i18n 模块
 * 
 * 取消事件监听
 */
export function destroyI18n(): void {
  _unlistenSettings?.();
  _unlistenSettings = null;
  _listeners = [];
}

/**
 * 设置当前语言
 * 
 * @param lang - 语言代码（如 "zh", "en", "jp"）
 * @param force - 是否强制更新（即使语言相同也触发回调）
 */
export function setLang(lang: string, force: boolean = false): void {
  if (_currentLang === lang && !force) return;
  
  _currentLang = lang;
  _dict = LANG_MAP[lang] || LANG_MAP[DEFAULT_LANG];
  
  // 通知所有监听者
  _listeners.forEach(fn => fn());
}

/**
 * 注册语言变更监听器
 * 
 * @param callback - 语言变更时的回调函数
 * @returns 取消监听的函数
 */
export function onLangChange(callback: () => void): () => void {
  _listeners.push(callback);
  return () => {
    _listeners = _listeners.filter(fn => fn !== callback);
  };
}

/**
 * 获取翻译文本
 * 
 * @param key - 翻译键路径，支持点号分隔（如 "settings.title"）
 * @param params - 可选的模板参数（如 { count: 5 }）
 * @returns 翻译后的文本，找不到时返回键名
 * 
 * @example
 * t("settings.title")  // "用户设置"
 * t("resource.statusRefreshed", { count: 5 })  // "已刷新 Mod 列表，共 5 个"
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const keys = key.split(".");
  let value: unknown = _dict;
  
  for (const k of keys) {
    if (value && typeof value === "object" && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      // 键不存在，返回原键名
      return key;
    }
  }
  
  if (typeof value !== "string") {
    return key;
  }
  
  // 替换模板参数
  if (params) {
    return value.replace(/\{(\w+)\}/g, (_, paramKey) => {
      return String(params[paramKey] ?? `{${paramKey}}`);
    });
  }
  
  return value;
}

/**
 * 获取翻译数组（如星期名列表）
 * 
 * @param key - 翻译键路径
 * @returns 翻译数组，找不到时返回空数组
 * 
 * @example
 * tArray("environment.weekdays")  // ["周日", "周一", ...]
 */
export function tArray(key: string): string[] {
  const keys = key.split(".");
  let value: unknown = _dict;
  
  for (const k of keys) {
    if (value && typeof value === "object" && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      return [];
    }
  }
  
  if (Array.isArray(value)) {
    return value as string[];
  }
  
  return [];
}

/**
 * 创建响应式翻译函数（用于 Svelte 5 $derived）
 * 
 * 返回一个函数，当语言变更时会触发重新计算
 * 
 * @example
 * // 在组件中
 * let _ = $state(t);
 * onMount(() => {
 *   return onLangChange(() => { _ = t; });
 * });
 * // 模板中使用
 * <h3>{_("settings.title")}</h3>
 */
export function getTranslator(): typeof t {
  return t;
}
