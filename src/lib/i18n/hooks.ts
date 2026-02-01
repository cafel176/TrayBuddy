/**
 * i18n Hooks - 多语言 Svelte 辅助函数
 *
 * 提供响应式的 i18n 初始化和翻译函数，简化组件中的多语言支持代码。
 *
 * ## 使用方式
 * ```svelte
 * <script lang="ts">
 *   import { createI18nState, useI18n } from "$lib/i18n/hooks";
 *   import { onMount, onDestroy } from "svelte";
 *
 *   // 创建 i18n 状态
 *   const { _, _langVersion, cleanup } = createI18nState();
 *
 *   // 在 onMount 中初始化
 *   onMount(() => {
 *     useI18n(_langVersion, () => {
 *       // 可选：语言变更时的额外操作
 *       getCurrentWindow().setTitle(_("common.title"));
 *     });
 *   });
 *
 *   // 在 onDestroy 中清理
 *   onDestroy(cleanup);
 * </script>
 * ```
 */

import { t, initI18n, destroyI18n, onLangChange } from "./index";

/**
 * i18n 状态配置接口
 */
export interface I18nStateConfig {
  /** 语言变更时的回调（在初始化和每次切换时调用） */
  onLangUpdate?: () => void;
  /** 是否自动调用 initI18n（默认 true） */
  autoInit?: boolean;
}

/**
 * i18n 状态返回值接口
 */
export interface I18nState {
  /** 响应式翻译函数 */
  _: (key: string, params?: Record<string, string | number>) => string;
  /** 语言版本号（用于触发 Svelte 响应式更新） */
  _langVersion: { value: number };
  /** 取消监听函数 */
  unsubLang: { value: (() => void) | null };
  /** 清理函数（在 onDestroy 中调用） */
  cleanup: () => void;
}

/**
 * 创建 i18n 响应式状态
 *
 * 返回一个包含翻译函数和语言版本号的对象，用于 Svelte 组件的响应式更新。
 *
 * @returns i18n 状态对象
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   const { _, _langVersion, cleanup } = createI18nState();
 *   // 使用 $: 或 $derived 跟踪 _langVersion.value 来触发重渲染
 * </script>
 * ```
 */
export function createI18nState(): I18nState {
  const _langVersion = { value: 0 };
  const unsubLang: { value: (() => void) | null } = { value: null };

  /**
   * 响应式翻译函数
   * 通过引用 _langVersion 建立 Svelte 响应式依赖
   */
  function _(key: string, params?: Record<string, string | number>): string {
    void _langVersion.value; // 建立响应式依赖
    return t(key, params);
  }

  /**
   * 清理函数
   */
  function cleanup(): void {
    unsubLang.value?.();
    unsubLang.value = null;
    destroyI18n();
  }

  return {
    _,
    _langVersion,
    unsubLang,
    cleanup,
  };
}

/**
 * 初始化 i18n 并设置语言变更监听
 *
 * 应在 onMount 中调用。会自动调用 initI18n() 并注册语言变更监听器。
 *
 * @param state - createI18nState() 返回的状态对象
 * @param onLangUpdate - 可选的语言变更回调
 *
 * @example
 * ```svelte
 * onMount(async () => {
 *   await setupI18n(state, () => {
 *     getCurrentWindow().setTitle(_("common.title"));
 *   });
 * });
 * ```
 */
export async function setupI18n(
  state: I18nState,
  onLangUpdate?: () => void
): Promise<void> {
  // 注册语言变更监听
  state.unsubLang.value = onLangChange(() => {
    state._langVersion.value++;
    onLangUpdate?.();
  });

  // 初始化 i18n
  await initI18n();

  // 触发初始更新
  state._langVersion.value++;
  onLangUpdate?.();
}
