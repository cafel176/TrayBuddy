// ========================================================================= //
// 触发器管理模块 (TriggerManager)
// ========================================================================= //
//
// 功能概述:
// - 前端触发器管理器，负责将用户交互事件发送到后端
// - 提供事件有效性检查和触发接口
// - 实际的触发逻辑（状态选择、概率判断等）由后端 TriggerManager 处理
//
// 支持的事件类型:
// - click: 用户点击角色时触发
// - login: 应用启动时触发
//
// 使用方式:
// const triggerManager = getTriggerManager();
// await triggerManager.trigger("click");
// ========================================================================= //

import { invoke } from "@tauri-apps/api/core";

// ========================================================================= //
// 类型定义
// ========================================================================= //

/**
 * 触发器事件类型
 * 定义所有可用的触发事件名称
 */
export type TriggerEvent = "click" | "login";

// ========================================================================= //
// TriggerManager 类
// ========================================================================= //

/**
 * 触发器管理器类
 * 
 * 提供前端事件触发的统一接口，将事件转发给后端处理。
 * 后端会根据当前状态、触发器配置和概率判断来决定是否切换状态。
 */
export class TriggerManager {
  // ======================================================================= //
  // 静态常量
  // ======================================================================= //

  /** 支持的事件名称列表 */
  private static readonly EVENTS: TriggerEvent[] = [
    "click",       // 点击角色
    "login"       // 应用启动
  ];

  // ======================================================================= //
  // 构造函数
  // ======================================================================= //

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
   * 触发事件
   * 
   * 将事件发送到后端处理，后端会：
   * 1. 查找对应的触发器配置
   * 2. 筛选可用状态
   * 3. 随机选择并切换状态
   * 
   * @param eventName 事件名称
   * @returns 是否成功触发
   */
  async trigger(eventName: string): Promise<boolean> {
    if (!this.isEventSupported(eventName)) {
      console.warn(`[TriggerManager] Unknown event: '${eventName}'`);
      return false;
    }

    console.log(`[TriggerManager] Triggering event: '${eventName}'`);

    try {
      const result: boolean = await invoke("trigger_event", { eventName });
      
      if (result) {
        console.log(`[TriggerManager] Event '${eventName}' triggered successfully`);
      } else {
        console.log(`[TriggerManager] Event '${eventName}' not triggered (no trigger/states or blocked)`);
      }
      
      return result;
    } catch (e) {
      console.error(`[TriggerManager] Failed to trigger event '${eventName}':`, e);
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

// ========================================================================= //
// 单例管理
// ========================================================================= //

/** TriggerManager 单例实例 */
let triggerManagerInstance: TriggerManager | null = null;

/**
 * 获取或创建 TriggerManager 单例实例
 * 
 * 使用单例模式确保全局只有一个触发器管理器实例。
 * 与 AudioManager 不同，TriggerManager 不需要异步初始化。
 * 
 * @returns TriggerManager 实例
 * 
 * @example
 * const triggerManager = getTriggerManager();
 * await triggerManager.trigger("click");
 */
export function getTriggerManager(): TriggerManager {
  if (!triggerManagerInstance) {
    triggerManagerInstance = new TriggerManager();
  }
  return triggerManagerInstance;
}
