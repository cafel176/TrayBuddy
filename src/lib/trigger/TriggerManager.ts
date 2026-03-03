/**
 * TriggerManager - 触发器管理模块
 *
 * 该模块负责前端事件触发，将用户交互转发给后端处理。
 *
 * ## 支持的事件
 * - `click` - 点击桌面宠物
 * - `click_up` - 左键松开（在动画窗口内释放左键时触发）
 * - `right_click` - 右键点击桌面宠物
 * - `right_click_up` - 右键松开（在动画窗口内释放右键时触发）
 * - `global_click` - 全局左键点击（不要求窗口焦点，由后端轮询触发）
 * - `global_click_up` - 全局左键松开（不要求窗口焦点，由后端轮询触发）
 * - `global_right_click` - 全局右键点击（不要求窗口焦点，由后端轮询触发）
 * - `global_right_click_up` - 全局右键松开（不要求窗口焦点，由后端轮询触发）
 * - `global_keydown` - 全局键盘按下（任意键按下时触发，不要求窗口焦点）
 * - `global_keyup` - 全局键盘松开（任意键松开时触发，不要求窗口焦点）
 * - `login` - 应用启动（登录）
 * - `drag_start` - 开始拖动 Animation window
 * - `drag_end` - 结束拖动 Animation window

 *
 * ## 触发流程
 * 1. 前端检测到用户交互（如点击/拖动）
 * 2. 调用 `TriggerManager.trigger("...")`
 * 3. TriggerManager 调用后端 `trigger_event` 命令
 * 4. 后端根据 Mod 配置执行状态切换
 *
 * ## 使用示例
 * ```typescript
 * const triggerManager = getTriggerManager();
 * await triggerManager.trigger("click");
 * ```
 */

import { invoke } from "@tauri-apps/api/core";

/** 支持的触发事件类型 */
export type TriggerEvent =
  | "click"
  | "click_up"
  | "right_click"
  | "right_click_up"
  | "global_click"
  | "global_click_up"
  | "global_right_click"
  | "global_right_click_up"
  | "global_keydown"
  | "global_keyup"
  | "login"
  | "login_silence"
  | "firstday"
  | "birthday"
  | "drag_start"
  | "drag_end"
;

/** 已支持的事件列表 */
const SUPPORTED_EVENTS: readonly TriggerEvent[] = [
  "click",
  "click_up",
  "right_click",
  "right_click_up",
  "global_click",
  "global_click_up",
  "global_right_click",
  "global_right_click_up",
  "global_keydown",
  "global_keyup",
  "login",
  "login_silence",
  "firstday",
  "birthday",
  "drag_start",
  "drag_end"
];

/**
 * 触发器管理器
 *
 * 负责：
 * - 验证事件名称的有效性
 * - 调用后端触发命令
 * - 提供事件列表查询
 */
export class TriggerManager {
  /**
   * 检查事件是否受支持
   * @param eventName - 事件名称
   * @returns 是否为有效的触发事件
   */
  isEventSupported(eventName: string): boolean {
    return (
      SUPPORTED_EVENTS.includes(eventName as TriggerEvent) ||
      eventName.startsWith("keydown:") ||
      eventName.startsWith("keyup:")
    );
  }

  /**
   * 获取所有支持的事件列表
   * @returns 事件名称数组
   */
  getSupportedEvents(): TriggerEvent[] {
    return [...SUPPORTED_EVENTS];
  }

  /**
   * 触发事件
   *
   * 将事件发送到后端，由后端根据 Mod 配置决定是否切换状态。
   *
   * @param eventName - 事件名称
   * @param force - 是否使用强制模式切换（忽略锁定/优先级等限制）
   * @returns 是否成功触发状态切换
   */
  async trigger(eventName: string, force = false): Promise<boolean> {
    // 验证事件名称
    if (!this.isEventSupported(eventName)) {
      console.warn(`[TriggerManager] Unknown event: '${eventName}'`);
      return false;
    }

    try {
      // 调用后端触发命令
      return await invoke("trigger_event", { eventName, force });
    } catch (e) {
      console.error(`[TriggerManager] Failed to trigger event '${eventName}':`, e);
      return false;
    }
  }

  /**
   * 销毁触发器管理器
   * 目前无需清理资源，保留以备将来扩展
   */
  destroy(): void {}
}

// ============================================================================
// 单例管理
// ============================================================================

/** 全局单例实例 */
let triggerManagerInstance: TriggerManager | null = null;

/**
 * 获取触发器管理器单例
 *
 * @returns 触发器管理器实例
 */
export function getTriggerManager(): TriggerManager {
  if (!triggerManagerInstance) {
    triggerManagerInstance = new TriggerManager();
  }
  return triggerManagerInstance;
}

/**
 * 重置触发器管理器单例
 *
 * 在 mod 切换时调用，配合 destroy() 使用。
 */
export function resetTriggerManagerInstance(): void {
  triggerManagerInstance = null;
}
