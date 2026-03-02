/**
 * 状态消息工具函数
 *
 * 提供跨组件共享的状态消息判断逻辑。
 */

import { t } from "$lib/i18n";

/**
 * 检查状态消息是否包含错误信息。
 *
 * 判断方式：检测消息中是否含有翻译后的"失败"文本。
 * 需在 Svelte 组件的响应式上下文中调用（确保语言切换时重新求值）。
 */
export function isError(msg: string): boolean {
  return msg.includes(t("common.failed")) || msg.includes("failed");
}
