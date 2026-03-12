/**
 * 测试公共工具函数
 * 提取自各测试文件中重复定义的 flushAsync / resetStyle 等
 */
import { tick } from "svelte";
import { vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { bubbleStyle, defaultStyle } from "$lib/bubble/bubbleStyle";


/**
 * 刷新 Svelte 异步更新队列
 * 等待 tick + 微任务 + tick，确保组件完成挂载和异步数据加载
 */
export async function flushAsync() {
  await tick();
  await new Promise((r) => setTimeout(r, 0));
  await tick();
}

/**
 * 更彻底的异步刷新（用于 pages-render 等需要多轮刷新的场景）
 */
export async function flushDeep() {
  await tick();
  await new Promise((r) => setTimeout(r, 0));
  await tick();
  await new Promise((r) => setTimeout(r, 0));
  await tick();
}

/**
 * 用于 fakeTimers 模式下的异步刷新
 */
export async function flushFakeAsync(rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await tick();
    await Promise.resolve();
  }
}

/**
 * 重置 bubbleStyle 到默认值
 */
export function resetBubbleStyle() {
  bubbleStyle.set({
    bubble: { ...defaultStyle.bubble },
    branch: {
      ...defaultStyle.branch,
      decoration_left: { ...defaultStyle.branch.decoration_left },
      decoration_right: { ...defaultStyle.branch.decoration_right },
    },
  });
}

// ============================================================================
// 通用测试辅助：Tauri invoke 临时打桩、按钮查找
// ============================================================================

type InvokeHandler = (args?: unknown) => unknown | Promise<unknown>;

/**
 * 在一个作用域内临时覆盖 Tauri 的 `invoke` 行为，结束后自动还原。
 *
 * - 只覆盖 handlers 里声明的 command
 * - 其他 command 会回退到原始实现（通常是 `src/test/setup.ts` 里的全局 mock）
 */
export async function withTauriInvoke(
  handlers: Record<string, unknown | InvokeHandler>,
  fn: () => void | Promise<void>,
) {
  const invokeMock = vi.mocked(invoke);
  const originalImpl = invokeMock.getMockImplementation();

  invokeMock.mockImplementation(async (command: string, args?: unknown) => {
    if (Object.prototype.hasOwnProperty.call(handlers, command)) {
      const h = handlers[command];
      if (typeof h === "function") return (h as InvokeHandler)(args);
      return h;
    }
    return originalImpl ? originalImpl(command, args as never) : null;
  });

  try {
    await fn();
  } finally {
    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  }
}

/**
 * 在 container 内查找第一个文本命中（includes）的 button 并返回。
 * 用于兼容多语言按钮文本（如 Load/加载/読み込み）。
 */
export function findButtonByTextIncludes(container: HTMLElement, texts: string[]) {
  const btns = Array.from(container.querySelectorAll("button"));
  for (const btn of btns) {
    const text = btn.textContent || "";
    if (texts.some((t) => text.includes(t))) return btn as HTMLButtonElement;
  }
  return null;
}

/**
 * 点击第一个匹配文本（includes）的 button；找不到则返回 false。
 */
export function clickButtonByTextIncludes(container: HTMLElement, texts: string[]) {
  const btn = findButtonByTextIncludes(container, texts);
  if (!btn) return false;
  btn.click();
  return true;
}

