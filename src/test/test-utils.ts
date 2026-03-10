/**
 * 测试公共工具函数
 * 提取自各测试文件中重复定义的 flushAsync / resetStyle 等
 */
import { tick } from "svelte";
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
