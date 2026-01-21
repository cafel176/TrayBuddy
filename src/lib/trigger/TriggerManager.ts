import { invoke } from "@tauri-apps/api/core";

/**
 * 触发器事件类型
 */
export type TriggerEvent = "click" | "login";

/**
 * 时间段类型
 */
export type TimeOfDay = "morning" | "noon" | "evening" | "night";

/**
 * 触发器管理器
 * 管理各种事件触发及其对应的处理逻辑
 */
export class TriggerManager {
  /** 支持的事件名数组 */
  private static readonly EVENTS: TriggerEvent[] = ["click", "login"];

  constructor() {}

  /**
   * 检查事件是否受支持
   */
  isEventSupported(eventName: string): eventName is TriggerEvent {
    return TriggerManager.EVENTS.includes(eventName as TriggerEvent);
  }

  /**
   * 获取所有支持的事件
   */
  getSupportedEvents(): TriggerEvent[] {
    return [...TriggerManager.EVENTS];
  }

  /**
   * 解析并执行事件
   * @param eventName 事件名称
   * @returns 是否成功触发
   */
  async trigger(eventName: string): Promise<boolean> {
    if (!this.isEventSupported(eventName)) {
      console.warn(`[TriggerManager] Unknown event: '${eventName}'`);
      return false;
    }

    console.log(`[TriggerManager] Triggering event: '${eventName}'`);

    switch (eventName) {
      case "click":
        return this.handleClick();
      case "login":
        return this.handleLogin();
      default:
        return false;
    }
  }

  /**
   * 获取当前时间段
   * - 早上: 6:00 - 11:59
   * - 中午: 12:00 - 17:59
   * - 晚上: 18:00 - 22:59
   * - 深夜: 23:00 - 5:59
   */
  private getTimeOfDay(): TimeOfDay {
    const hour = new Date().getHours();
    
    if (hour >= 6 && hour < 12) {
      return "morning";
    } else if (hour >= 12 && hour < 18) {
      return "noon";
    } else if (hour >= 18 && hour < 23) {
      return "evening";
    } else {
      return "night";
    }
  }

  /**
   * 处理 click 事件
   * 切换到 morning state
   */
  private async handleClick(): Promise<boolean> {
    try {
      const result: boolean = await invoke("switch_state", { name: "morning" });
      if (result) {
        console.log("[TriggerManager] Switched to morning state");
      } else {
        console.log("[TriggerManager] State switch blocked (locked or low priority)");
      }
      return result;
    } catch (e) {
      console.error("[TriggerManager] Failed to switch state:", e);
      return false;
    }
  }

  /**
   * 处理 login 事件
   * 根据当前时间段切换到对应状态
   */
  private async handleLogin(): Promise<boolean> {
    const timeOfDay = this.getTimeOfDay();
    const hour = new Date().getHours();
    console.log(`[TriggerManager] Login event - Hour: ${hour}, Time of day: ${timeOfDay}`);

    try {
      let stateName: string;
      
      switch (timeOfDay) {
        case "morning":
          stateName = "morning";
          console.log("[TriggerManager] Good morning!");
          break;
        case "noon":
          stateName = "noon";
          console.log("[TriggerManager] Good afternoon!");
          break;
        case "evening":
          stateName = "evening";
          console.log("[TriggerManager] Good evening!");
          break;
        case "night":
          stateName = "night";
          console.log("[TriggerManager] It's late, take care!");
          break;
      }

      console.log(`[TriggerManager] Attempting to switch to state: ${stateName}`);
      const result: boolean = await invoke("switch_state", { name: stateName });
      console.log(`[TriggerManager] switch_state result: ${result}`);
      
      if (result) {
        console.log(`[TriggerManager] Successfully switched to ${stateName} state`);
      } else {
        console.log("[TriggerManager] State switch blocked (locked or low priority)");
      }
      return result;
    } catch (e) {
      console.error("[TriggerManager] Failed to handle login event:", e);
      return false;
    }
  }

  /**
   * 销毁触发器管理器
   */
  destroy(): void {
    // 目前无需清理
  }
}

// 单例实例
let triggerManagerInstance: TriggerManager | null = null;

/**
 * 获取或创建 TriggerManager 实例
 */
export function getTriggerManager(): TriggerManager {
  if (!triggerManagerInstance) {
    triggerManagerInstance = new TriggerManager();
  }
  return triggerManagerInstance;
}
