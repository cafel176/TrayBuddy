<!--
========================================================================= 
触发器调试组件 (TriggerDebugger.svelte)
=========================================================================

功能概述:
- 展示和测试应用的触发器系统
- 显示定时触发器的状态和配置
- 列出所有事件触发器及其可触发状态
- 提供手动触发事件的功能

触发器类型:
1. 定时触发器: 基于当前持久状态的 trigger_time 和 trigger_rate 配置
2. 事件触发器: 响应 click、login 等事件
=========================================================================
-->

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { onMount, onDestroy } from "svelte";

  // ======================================================================= //
  // 类型定义
  // ======================================================================= //

  /**
   * 触发器信息接口
   * 对应后端的 TriggerInfo 结构体
   */
  interface TriggerInfo {
    /** 触发事件名称 */
    event: string;
    /** 可触发的状态列表 */
    can_trigger_states: string[];
  }

  /**
   * 状态信息接口 (简化版)
   * 用于显示定时触发器相关信息
   */
  interface StateInfo {
    /** 状态名称 */
    name: string;
    /** 是否为持久状态 */
    persistent: boolean;
    /** 动画资源名 */
    anima: string;
    /** 音频资源名 */
    audio: string;
    /** 文本资源名 */
    text: string;
    /** 优先级 */
    priority: number;
    /** 定时触发间隔 (秒) */
    trigger_time: number;
    /** 定时触发概率 */
    trigger_rate: number;
    /** 可触发的状态列表 */
    can_trigger_states: string[];
  }

  /**
   * 状态变化事件数据
   */
  interface StateChangeEvent {
    /** 新的状态信息 */
    state: StateInfo;
    /** 是否只播放一次 */
    play_once: boolean;
  }

  // ======================================================================= //
  // 响应式状态
  // ======================================================================= //

  /** 所有触发器列表 */
  let triggers = $state<TriggerInfo[]>([]);
  
  /** 当前持久状态 (用于显示定时触发器配置) */
  let persistentState = $state<StateInfo | null>(null);
  
  /** 状态消息 */
  let statusMsg = $state("正在加载...");
  
  /** 事件日志记录 */
  let eventLog = $state<string[]>([]);
  
  /** 状态变化事件的取消监听函数 */
  let unlisten: (() => void) | null = null;

  /** 手动触发的自定义事件名输入 */
  let customEvent = $state("");

  // ======================================================================= //
  // 数据加载函数
  // ======================================================================= //

  /**
   * 从后端加载触发器和状态数据
   */
  async function loadData() {
    try {
      triggers = await invoke("get_all_triggers");
      persistentState = await invoke("get_persistent_state");
      statusMsg = `已加载 ${triggers.length} 个触发器`;
    } catch (e) {
      statusMsg = `加载失败: ${e}`;
    }
  }

  // ======================================================================= //
  // 触发函数
  // ======================================================================= //

  /**
   * 触发指定事件
   * @param eventName 事件名称
   */
  async function triggerEvent(eventName: string) {
    try {
      addLog(`触发事件: ${eventName}`);
      const result: boolean = await invoke("trigger_event", { eventName });
      if (result) {
        addLog(`事件 '${eventName}' 触发成功`);
        statusMsg = `触发成功: ${eventName}`;
      } else {
        addLog(`事件 '${eventName}' 未触发 (无触发器/状态或被阻止)`);
        statusMsg = `未触发: ${eventName}`;
      }
      await loadData();
    } catch (e) {
      addLog(`事件 '${eventName}' 触发失败: ${e}`);
      statusMsg = `触发失败: ${e}`;
    }
  }

  /**
   * 触发自定义事件 (从输入框)
   */
  async function triggerCustomEvent() {
    if (!customEvent.trim()) {
      statusMsg = "请输入事件名称";
      return;
    }
    await triggerEvent(customEvent.trim());
    customEvent = "";
  }

  // ======================================================================= //
  // 日志函数
  // ======================================================================= //

  /**
   * 添加日志条目
   * @param msg 日志消息
   */
  function addLog(msg: string) {
    const time = new Date().toLocaleTimeString();
    // 保留最近 30 条日志
    eventLog = [`[${time}] ${msg}`, ...eventLog.slice(0, 29)];
  }

  // ======================================================================= //
  // 生命周期
  // ======================================================================= //

  onMount(async () => {
    await loadData();
    
    // 监听后端状态变化事件
    unlisten = await listen<StateChangeEvent>("state-change", (event) => {
      const { state, play_once } = event.payload;
      addLog(`状态切换: ${state.name} (play_once: ${play_once})`);
      loadData();
    });
  });

  onDestroy(() => {
    unlisten?.();
  });
</script>

<!-- ======================================================================= -->
<!-- 组件模板 -->
<!-- ======================================================================= -->

<div class="trigger-debugger">
  <h3>TriggerManager 调试面板</h3>

  <!-- ================================================================= -->
  <!-- 定时触发器状态区域 -->
  <!-- ================================================================= -->
  
  <div class="section timer-section">
    <h4>定时触发器状态</h4>
    {#if persistentState}
      <div class="timer-info">
        <!-- 当前持久状态名称 -->
        <div class="info-row">
          <span class="label">当前持久状态:</span>
          <span class="value state-name">{persistentState.name}</span>
        </div>
        <!-- 触发间隔 -->
        <div class="info-row">
          <span class="label">触发间隔:</span>
          <span class="value">
            {#if persistentState.trigger_time > 0}
              {persistentState.trigger_time} 秒
            {:else}
              <span class="disabled">未启用</span>
            {/if}
          </span>
        </div>
        <!-- 触发概率 -->
        <div class="info-row">
          <span class="label">触发概率:</span>
          <span class="value">
            {#if persistentState.trigger_rate > 0}
              {(persistentState.trigger_rate * 100).toFixed(0)}%
            {:else}
              <span class="disabled">未启用</span>
            {/if}
          </span>
        </div>
        <!-- 可触发的状态列表 -->
        <div class="info-row">
          <span class="label">可触发状态:</span>
          <div class="state-tags">
            {#if persistentState.can_trigger_states.length > 0}
              {#each persistentState.can_trigger_states as stateName}
                <span class="tag state-tag">{stateName}</span>
              {/each}
            {:else}
              <span class="disabled">无</span>
            {/if}
          </div>
        </div>
        <!-- 定时触发器启用状态 -->
        <div class="timer-status">
          {#if persistentState.trigger_time > 0 && persistentState.trigger_rate > 0 && persistentState.can_trigger_states.length > 0}
            <span class="badge active">定时触发已启用</span>
          {:else}
            <span class="badge inactive">定时触发未启用</span>
          {/if}
        </div>
      </div>
    {:else}
      <div class="empty">无持久状态</div>
    {/if}
  </div>

  <!-- ================================================================= -->
  <!-- 事件触发器列表 -->
  <!-- ================================================================= -->
  
  <div class="section">
    <h4>事件触发器</h4>
    {#if triggers.length > 0}
      <div class="trigger-list">
        {#each triggers as trigger}
          <div class="trigger-card">
            <div class="trigger-header">
              <span class="trigger-event">{trigger.event}</span>
              <button class="btn-trigger" onclick={() => triggerEvent(trigger.event)}>
                触发
              </button>
            </div>
            <div class="trigger-states">
              {#if trigger.can_trigger_states.length > 0}
                {#each trigger.can_trigger_states as stateName}
                  <span class="tag state-tag">{stateName}</span>
                {/each}
              {:else}
                <span class="no-states">(无可触发状态)</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty">当前 Mod 未定义触发器</div>
    {/if}
  </div>

  <!-- ================================================================= -->
  <!-- 手动触发区域 -->
  <!-- ================================================================= -->
  
  <div class="section">
    <h4>手动触发事件</h4>
    <!-- 自定义事件输入 -->
    <div class="manual-trigger">
      <input 
        type="text" 
        placeholder="输入事件名称 (如 click, login)" 
        bind:value={customEvent}
        onkeydown={(e) => e.key === 'Enter' && triggerCustomEvent()}
      />
      <button class="btn-primary" onclick={triggerCustomEvent}>触发</button>
    </div>
    <!-- 快捷触发按钮 -->
    <div class="quick-triggers">
      <button class="btn-quick" onclick={() => triggerEvent("click")}>click</button>
      <button class="btn-quick" onclick={() => triggerEvent("login")}>login</button>
    </div>
  </div>

  <!-- ================================================================= -->
  <!-- 事件日志区域 -->
  <!-- ================================================================= -->
  
  <div class="section">
    <div class="section-header">
      <h4>事件日志</h4>
      <button class="btn-tiny" onclick={() => eventLog = []}>清空</button>
    </div>
    <div class="event-log">
      {#each eventLog as log}
        <div class="log-item">{log}</div>
      {:else}
        <div class="log-empty">暂无事件</div>
      {/each}
    </div>
  </div>

  <!-- ================================================================= -->
  <!-- 操作按钮 -->
  <!-- ================================================================= -->
  
  <div class="actions">
    <button class="refresh" onclick={loadData}>刷新数据</button>
  </div>

  <!-- 状态消息栏 -->
  <div class="status-bar" class:error={statusMsg.includes('失败')}>
    {statusMsg}
  </div>
</div>

<style>
  .trigger-debugger {
    background: #ffffff;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
    max-width: 600px;
    margin: 20px auto;
    color: #333;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  }

  h3 {
    margin-top: 0;
    color: #2c3e50;
    border-bottom: 2px solid #eee;
    padding-bottom: 10px;
    margin-bottom: 20px;
  }

  h4 {
    margin: 0 0 10px 0;
    color: #34495e;
    font-size: 0.95em;
  }

  .section {
    margin-bottom: 20px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .timer-section {
    background: #f8f9fa;
    border-radius: 8px;
    padding: 15px;
    border-left: 4px solid #9b59b6;
  }

  .timer-info {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .info-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .label {
    font-weight: 500;
    color: #7f8c8d;
    min-width: 100px;
  }

  .value {
    color: #2c3e50;
  }

  .state-name {
    font-weight: bold;
    color: #8e44ad;
  }

  .disabled {
    color: #bdc3c7;
    font-style: italic;
  }

  .timer-status {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #eee;
  }

  .badge {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 0.8em;
    font-weight: bold;
  }

  .badge.active {
    background: #27ae60;
    color: white;
  }

  .badge.inactive {
    background: #bdc3c7;
    color: #7f8c8d;
  }

  .trigger-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .trigger-card {
    background: #f8f9fa;
    border: 1px solid #eee;
    border-left: 3px solid #9b59b6;
    padding: 10px;
    border-radius: 4px;
  }

  .trigger-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .trigger-event {
    font-weight: bold;
    color: #8e44ad;
    font-size: 1em;
  }

  .trigger-states {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .state-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .tag {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.8em;
  }

  .state-tag {
    background: #fdebd0;
    border: 1px solid #f39c12;
    color: #d35400;
  }

  .no-states {
    font-size: 0.85em;
    color: #95a5a6;
    font-style: italic;
  }

  .empty {
    color: #bdc3c7;
    font-style: italic;
    text-align: center;
    padding: 15px;
  }

  .manual-trigger {
    display: flex;
    gap: 10px;
    margin-bottom: 10px;
  }

  .manual-trigger input {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 0.9em;
  }

  .quick-triggers {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .btn-trigger {
    padding: 4px 10px;
    font-size: 0.8em;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: #9b59b6;
    color: white;
    transition: all 0.2s;
  }

  .btn-trigger:hover {
    background: #8e44ad;
  }

  .btn-primary {
    padding: 8px 16px;
    font-size: 0.9em;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    background: #3498db;
    color: white;
    font-weight: 600;
    transition: all 0.2s;
  }

  .btn-primary:hover {
    background: #2980b9;
  }

  .btn-quick {
    padding: 5px 12px;
    font-size: 0.8em;
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
    background: #fff;
    color: #666;
    transition: all 0.2s;
  }

  .btn-quick:hover {
    border-color: #9b59b6;
    color: #9b59b6;
  }

  .btn-tiny {
    padding: 2px 6px;
    font-size: 0.7em;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    background: #bdc3c7;
    color: #2c3e50;
  }

  .btn-tiny:hover {
    background: #95a5a6;
  }

  .event-log {
    background: #2c3e50;
    border-radius: 6px;
    padding: 10px;
    max-height: 150px;
    overflow-y: auto;
    font-family: 'Consolas', monospace;
    font-size: 0.75em;
  }

  .log-item {
    color: #1abc9c;
    margin-bottom: 3px;
  }

  .log-empty {
    color: #7f8c8d;
    font-style: italic;
  }

  .actions {
    display: flex;
    gap: 10px;
  }

  .refresh {
    flex: 1;
    padding: 10px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    background: #9b59b6;
    color: white;
    font-weight: 600;
    transition: all 0.2s;
  }

  .refresh:hover {
    background: #8e44ad;
  }

  .status-bar {
    margin-top: 15px;
    font-size: 0.85em;
    color: #7f8c8d;
    text-align: center;
    padding: 5px;
    background: #f8f9fa;
    border-radius: 4px;
  }

  .status-bar.error {
    color: #e74c3c;
    background: #fdf2f2;
  }

  @media (prefers-color-scheme: dark) {
    .trigger-debugger {
      background: #2c3e50;
      color: #ecf0f1;
    }

    h3 {
      color: #ecf0f1;
      border-bottom-color: #34495e;
    }

    h4 {
      color: #bdc3c7;
    }

    .timer-section {
      background: #34495e;
    }

    .trigger-card {
      background: #34495e;
      border-color: #455a64;
    }

    .manual-trigger input {
      background: #34495e;
      border-color: #455a64;
      color: #ecf0f1;
    }

    .btn-quick {
      background: #34495e;
      border-color: #455a64;
      color: #bdc3c7;
    }

    .status-bar {
      background: #34495e;
      color: #bdc3c7;
    }

    .status-bar.error {
      background: #5a3e3e;
    }


    .value {
      color: #ecf0f1;
    }

    .label {
      color: #95a5a6;
    }
  }
</style>
