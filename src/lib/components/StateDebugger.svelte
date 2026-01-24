<!--
========================================================================= 
状态管理调试组件 (StateDebugger.svelte)
=========================================================================

功能概述:
- 显示和管理应用的状态系统
- 展示当前状态、持久状态、下一状态的详细信息
- 提供状态切换功能 (普通切换和强制切换)
- 实时监听状态变化事件并记录日志

核心概念:
- 当前状态 (Current State): 正在播放的状态
- 持久状态 (Persistent State): 默认/待机状态
- 下一状态 (Next State): 队列中等待播放的状态
- 状态锁定: 高优先级状态播放时会锁定，阻止低优先级切换
=========================================================================
-->

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen, emit } from "@tauri-apps/api/event";
  import { onMount, onDestroy } from "svelte";

  // ======================================================================= //
  // 类型定义
  // ======================================================================= //

  /**
   * 分支信息接口
   * 用于对话分支选择
   */
  interface BranchInfo {
    /** 分支显示文本 */
    text: string;
    /** 选择后跳转的状态名 */
    next_state: string;
  }

  /**
   * 状态信息接口
   * 对应后端的 StateInfo 结构体
   */
  interface StateInfo {
    /** 状态名称 (唯一标识) */
    name: string;
    /** 是否为持久状态 */
    persistent: boolean;
    /** 关联的动画资源名 */
    anima: string;
    /** 关联的音频资源名 */
    audio: string;
    /** 关联的文本资源名 */
    text: string;
    /** 优先级 (数值越大优先级越高) */
    priority: number;
    /** 日期范围起始 (MM-DD) */
    date_start: string;
    /** 日期范围结束 (MM-DD) */
    date_end: string;
    /** 时间范围起始 (HH:MM) */
    time_start: string;
    /** 时间范围结束 (HH:MM) */
    time_end: string;
    /** 播放完成后跳转的状态名 */
    next_state: string;
    /** 定时触发间隔 (秒) */
    trigger_time: number;
    /** 定时触发概率 (0.0 - 1.0) */
    trigger_rate: number;
    /** 可触发的状态列表 */
    can_trigger_states: string[];
    /** 对话分支选项 */
    branch: BranchInfo[];
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

  /** 所有预定义状态列表 */
  let allStates = $state<StateInfo[]>([]);
  
  /** 当前正在播放的状态 */
  let currentState = $state<StateInfo | null>(null);
  
  /** 当前的持久状态 (默认状态) */
  let persistentState = $state<StateInfo | null>(null);
  
  /** 队列中的下一个状态 */
  let nextState = $state<StateInfo | null>(null);
  
  /** 状态是否被锁定 */
  let isLocked = $state(false);
  
  /** 状态消息 */
  let statusMsg = $state("正在加载...");
  
  /** 事件日志记录 (最新在前) */
  let eventLog = $state<string[]>([]);
  
  /** 状态变化事件的取消监听函数 */
  let unlisten: (() => void) | null = null;
  
  /** 播放状态事件的取消监听函数 */
  let unlistenPlayback: (() => void) | null = null;
  
  /** next_state变化事件的取消监听函数 */
  let unlistenNextState: (() => void) | null = null;

  // ======================================================================= //
  // 前端播放状态 (来自 animation 窗口)
  // ======================================================================= //
  
  /** 动画是否完成 */
  let animationComplete = $state(false);
  /** 音频是否完成 */
  let audioComplete = $state(false);
  /** 气泡是否完成 */
  let bubbleComplete = $state(false);
  /** 是否为单次播放模式 */
  let isPlayOnce = $state(false);

  // ======================================================================= //
  // 数据加载函数
  // ======================================================================= //

  /**
   * 从后端加载所有状态数据
   */
  async function loadStates() {
    try {
      allStates = await invoke("get_all_states");
      currentState = await invoke("get_current_state");
      persistentState = await invoke("get_persistent_state");
      nextState = await invoke("get_next_state");
      isLocked = await invoke("is_state_locked");
      statusMsg = "状态已加载";
    } catch (e) {
      statusMsg = `加载失败: ${e}`;
    }
  }
  
  /**
   * 仅刷新 nextState（用于 next-state-changed 事件）
   */
  async function refreshNextState() {
    try {
      nextState = await invoke("get_next_state");
      addLog(`next_state 已更新: ${nextState?.name || '无'}`);
    } catch (e) {
      console.error('Failed to refresh next state:', e);
    }
  }

  // ======================================================================= //
  // 状态切换函数
  // ======================================================================= //

  /**
   * 普通状态切换 (会检查优先级和锁定状态)
   * @param name 目标状态名称
   */
  async function changeState(name: string) {
    try {
      const success = await invoke("change_state", { name });
      if (success) {
        statusMsg = `切换到状态: ${name}`;
        addLog(`change_state("${name}") -> 成功`);
      } else {
        statusMsg = `切换失败: 优先级不足或状态锁定`;
        addLog(`change_state("${name}") -> 失败 (优先级不足或锁定)`);
      }
      await loadStates();
    } catch (e) {
      statusMsg = `切换失败: ${e}`;
      addLog(`change_state("${name}") -> 错误: ${e}`);
    }
  }

  /**
   * 强制状态切换 (忽略优先级和锁定)
   * @param name 目标状态名称
   */
  async function forceChangeState(name: string) {
    try {
      await invoke("force_change_state", { name });
      statusMsg = `强制切换到: ${name}`;
      addLog(`force_change_state("${name}") -> 成功`);
      await loadStates();
    } catch (e) {
      statusMsg = `强制切换失败: ${e}`;
      addLog(`force_change_state("${name}") -> 错误: ${e}`);
    }
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
    // 保留最近 20 条日志
    eventLog = [`[${time}] ${msg}`, ...eventLog.slice(0, 19)];
  }

  // ======================================================================= //
  // 生命周期
  // ======================================================================= //

  onMount(async () => {
    await loadStates();
    
    // 监听后端状态变化事件
    unlisten = await listen<StateChangeEvent>("state-change", (event) => {
      const { state, play_once } = event.payload;
      addLog(`事件: state-change -> ${state.name} (play_once: ${play_once})`);
      loadStates();
    });
    
    // 监听前端播放状态事件
    unlistenPlayback = await listen<{
      animationComplete: boolean;
      audioComplete: boolean;
      bubbleComplete: boolean;
      isPlayOnce: boolean;
    }>("playback-status", (event) => {
      animationComplete = event.payload.animationComplete;
      audioComplete = event.payload.audioComplete;
      bubbleComplete = event.payload.bubbleComplete;
      isPlayOnce = event.payload.isPlayOnce;
    });
    
    // 监听 next_state 变化事件（分支选择时触发）
    unlistenNextState = await listen<{ name: string }>("next-state-changed", (event) => {
      addLog(`事件: next-state-changed -> ${event.payload.name}`);
      refreshNextState();
    });
    
    // 请求当前播放状态
    emit('request-playback-status');
  });

  onDestroy(() => {
    unlisten?.();
    unlistenPlayback?.();
    unlistenNextState?.();
  });
</script>

<!-- ======================================================================= -->
<!-- 组件模板 -->
<!-- ======================================================================= -->

<div class="state-debugger">
  <h3>StateManager 调试面板</h3>

  <!-- ================================================================= -->
  <!-- 状态卡片区域 - 展示三个核心状态 -->
  <!-- ================================================================= -->
  
  <div class="state-cards">
    <!-- 当前状态卡片 -->
    <div class="state-card current">
      <div class="card-header">当前状态</div>
      {#if currentState}
        <div class="state-name">{currentState.name}</div>
        <div class="state-meta">
          <span class="badge" class:persistent={currentState.persistent}>
            {currentState.persistent ? '持久' : '临时'}
          </span>
          <span class="priority">优先级: {currentState.priority}</span>
          {#if isLocked}
            <span class="badge locked">锁定中</span>
          {/if}
        </div>
        <div class="state-detail">
          {#if currentState.anima}<div class="detail-row"><span class="label">动画:</span> {currentState.anima}</div>{/if}
          {#if currentState.audio}<div class="detail-row"><span class="label">音频:</span> {currentState.audio}</div>{/if}
          {#if currentState.text}<div class="detail-row"><span class="label">文本:</span> {currentState.text}</div>{/if}
          {#if currentState.next_state}<div class="detail-row"><span class="label">后续状态:</span> <span class="next-state-value">{currentState.next_state}</span></div>{/if}
        </div>
        <!-- 对话分支信息 (如果有) -->
        {#if currentState.branch && currentState.branch.length > 0}
          <div class="branch-info">
            <span class="label">分支选项:</span>
            {#each currentState.branch as b}
              <span class="branch-item">{b.text} → {b.next_state}</span>
            {/each}
          </div>
        {/if}
      {:else}
        <div class="empty">无</div>
      {/if}
    </div>

    <!-- 持久状态卡片 -->
    <div class="state-card persistent">
      <div class="card-header">持久状态</div>
      {#if persistentState}
        <div class="state-name">{persistentState.name}</div>
        <div class="state-meta">
          <span class="anima">动画: {persistentState.anima}</span>
        </div>
      {:else}
        <div class="empty">无</div>
      {/if}
    </div>

    <!-- 下一状态卡片 (队列中的状态) -->
    <div class="state-card next">
      <div class="card-header">队列状态</div>
      <div class="card-hint">当前状态播放完毕后切换</div>
      {#if nextState}
        <div class="state-name">{nextState.name}</div>
        <div class="state-meta">
          <span class="badge" class:persistent={nextState.persistent}>
            {nextState.persistent ? '持久' : '临时'}
          </span>
        </div>
      {:else}
        <div class="empty">无 (将回到持久状态)</div>
      {/if}
    </div>
  </div>

  <!-- ================================================================= -->
  <!-- 前端播放状态区域 -->
  <!-- ================================================================= -->
  
  <div class="section">
    <h4>前端播放状态</h4>
    <div class="playback-status">
      <div class="status-item" class:complete={animationComplete}>
        <span class="status-label">动画</span>
        <span class="status-value">{animationComplete ? '完成' : '播放中'}</span>
      </div>
      <div class="status-item" class:complete={audioComplete}>
        <span class="status-label">音频</span>
        <span class="status-value">{audioComplete ? '完成' : '播放中'}</span>
      </div>
      <div class="status-item" class:complete={bubbleComplete}>
        <span class="status-label">气泡</span>
        <span class="status-value">{bubbleComplete ? '完成' : '显示中'}</span>
      </div>
      <div class="status-item mode">
        <span class="status-label">模式</span>
        <span class="status-value">{isPlayOnce ? '单次播放' : '循环播放'}</span>
      </div>
    </div>
  </div>

  <!-- ================================================================= -->
  <!-- 状态列表表格 -->
  <!-- ================================================================= -->
  
  <div class="section">
    <h4>预定义状态列表</h4>
    <div class="states-table">
      <!-- 表头 -->
      <div class="table-header">
        <span class="col-name">名称</span>
        <span class="col-type">类型</span>
        <span class="col-priority">优先级</span>
        <span class="col-resources">资源</span>
        <span class="col-extra">附加信息</span>
        <span class="col-ops">操作</span>
      </div>
      <!-- 状态行 -->
      {#each allStates as state}
        <div class="table-row" class:active={currentState?.name === state.name}>
          <span class="col-name">{state.name}</span>
          <span class="col-type">
            <span class="badge small" class:persistent={state.persistent}>
              {state.persistent ? '持久' : '临时'}
            </span>
          </span>
          <span class="col-priority">{state.priority}</span>
          <span class="col-resources">
            {#if state.anima}<span class="resource-tag anima" title="动画">🎬{state.anima}</span>{/if}
            {#if state.audio}<span class="resource-tag audio" title="音频">🔊{state.audio}</span>{/if}
            {#if state.text}<span class="resource-tag text" title="文本">💬{state.text}</span>{/if}
          </span>
          <span class="col-extra">
            {#if state.next_state}
              <span class="extra-tag next" title="后续状态">→{state.next_state}</span>
            {/if}
            {#if state.trigger_time > 0}
              <span class="extra-tag timer" title="定时触发: 每{state.trigger_time}s, 概率{(state.trigger_rate * 100).toFixed(0)}%">⏱{state.trigger_time}s</span>
            {/if}
            {#if state.can_trigger_states && state.can_trigger_states.length > 0}
              <span class="extra-tag trigger" title="可触发: {state.can_trigger_states.join(', ')}">🎯{state.can_trigger_states.length}</span>
            {/if}
            {#if state.branch && state.branch.length > 0}
              <span class="extra-tag branch" title="分支选项:\n{state.branch.map(b => `${b.text} → ${b.next_state}`).join('\n')}">🔀{state.branch.length}</span>
            {/if}
            {#if state.date_start || state.date_end}
              <span class="extra-tag date" title="日期: {state.date_start || '*'} ~ {state.date_end || '*'}">📅</span>
            {/if}
            {#if state.time_start || state.time_end}
              <span class="extra-tag time" title="时间: {state.time_start || '*'} ~ {state.time_end || '*'}">🕐</span>
            {/if}
          </span>
          <span class="col-ops">
            <!-- 普通切换按钮 -->
            <button class="btn-small" onclick={() => changeState(state.name)} title="切换状态 (检查优先级)">
              切换
            </button>
            <!-- 强制切换按钮 -->
            <button class="btn-small force" onclick={() => forceChangeState(state.name)} title="强制切换 (忽略优先级)">
              强制
            </button>
          </span>
        </div>
      {/each}
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
    <button class="refresh" onclick={loadStates}>刷新状态</button>
  </div>

  <!-- 状态消息栏 -->
  <div class="status-bar" class:error={statusMsg.includes('失败')}>
    {statusMsg}
  </div>
</div>

<style>
  .state-debugger {
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

  .state-cards {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 15px;
    margin-bottom: 20px;
  }

  .state-card {
    background: #f8f9fa;
    border-radius: 8px;
    padding: 12px;
    border-left: 4px solid #bdc3c7;
  }

  .state-card.current {
    border-left-color: #3498db;
  }

  .state-card.persistent {
    border-left-color: #27ae60;
  }

  .state-card.next {
    border-left-color: #9b59b6;
  }

  .branch-info {
    margin-top: 8px;
    font-size: 0.75em;
    color: #7f8c8d;
  }

  .branch-info .label {
    display: block;
    margin-bottom: 3px;
  }

  .branch-item {
    display: inline-block;
    background: #ecf0f1;
    padding: 2px 6px;
    border-radius: 3px;
    margin: 2px 4px 2px 0;
    color: #2c3e50;
  }

  .card-header {
    font-size: 0.75em;
    color: #7f8c8d;
    text-transform: uppercase;
    margin-bottom: 5px;
  }

  .card-hint {
    font-size: 0.65em;
    color: #95a5a6;
    margin-bottom: 8px;
  }

  .state-name {
    font-size: 1.2em;
    font-weight: bold;
    color: #2c3e50;
  }

  .state-meta {
    display: flex;
    gap: 10px;
    margin-top: 5px;
    font-size: 0.8em;
  }

  .state-detail {
    margin-top: 8px;
    font-size: 0.75em;
    color: #7f8c8d;
  }

  .detail-row {
    margin-bottom: 2px;
  }

  .detail-row .label {
    color: #95a5a6;
  }

  .next-state-value {
    color: #9b59b6;
    font-weight: bold;
  }

  .empty {
    color: #bdc3c7;
    font-style: italic;
  }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.75em;
    font-weight: bold;
    background: #e74c3c;
    color: white;
  }

  .badge.persistent {
    background: #27ae60;
  }

  .badge.locked {
    background: #e74c3c;
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  .badge.small {
    padding: 1px 5px;
    font-size: 0.7em;
  }

  .priority, .anima {
    color: #7f8c8d;
  }

  .section {
    margin-bottom: 20px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .playback-status {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }

  .status-item {
    background: #fee2e2;
    border-radius: 6px;
    padding: 10px;
    text-align: center;
    border: 2px solid #fca5a5;
    transition: all 0.3s;
  }

  .status-item.complete {
    background: #d1fae5;
    border-color: #6ee7b7;
  }

  .status-item.mode {
    background: #e0e7ff;
    border-color: #a5b4fc;
  }

  .status-label {
    display: block;
    font-size: 0.75em;
    color: #6b7280;
    margin-bottom: 4px;
  }

  .status-value {
    display: block;
    font-weight: bold;
    font-size: 0.9em;
    color: #374151;
  }

  .states-table {
    border: 1px solid #eee;
    border-radius: 6px;
    overflow: hidden;
    overflow-x: auto;
  }

  .table-header {
    display: grid;
    grid-template-columns: 80px 50px 45px 1fr 1fr 90px;
    gap: 8px;
    padding: 8px 10px;
    background: #f1f2f6;
    font-weight: bold;
    font-size: 0.75em;
    color: #666;
    min-width: 550px;
  }

  .table-row {
    display: grid;
    grid-template-columns: 80px 50px 45px 1fr 1fr 90px;
    gap: 8px;
    padding: 8px 10px;
    border-top: 1px solid #eee;
    font-size: 0.8em;
    align-items: center;
    min-width: 550px;
  }

  .table-row.active {
    background: #e8f4fd;
  }

  .col-name {
    font-weight: 600;
    word-break: break-all;
  }

  .col-resources, .col-extra {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }

  .resource-tag {
    display: inline-block;
    font-size: 0.75em;
    padding: 1px 4px;
    border-radius: 3px;
    background: #ecf0f1;
    color: #7f8c8d;
    white-space: nowrap;
  }

  .resource-tag.anima { background: #fef5e7; color: #d68910; }
  .resource-tag.audio { background: #e8f6f3; color: #16a085; }
  .resource-tag.text { background: #ebf5fb; color: #2980b9; }

  .extra-tag {
    display: inline-block;
    font-size: 0.7em;
    padding: 1px 3px;
    border-radius: 3px;
    background: #f5f6fa;
    color: #7f8c8d;
    cursor: help;
  }

  .extra-tag.next { background: #f5eef8; color: #8e44ad; }
  .extra-tag.timer { background: #fef9e7; color: #b7950b; }
  .extra-tag.trigger { background: #eafaf1; color: #1e8449; }
  .extra-tag.branch { background: #fdf2e9; color: #d35400; }
  .extra-tag.date { background: #ebedef; color: #566573; }
  .extra-tag.time { background: #ebedef; color: #566573; }

  .col-ops {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
  }

  .btn-small {
    padding: 3px 8px;
    font-size: 0.75em;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: #3498db;
    color: white;
    transition: all 0.2s;
  }

  .btn-small:hover {
    background: #2980b9;
  }

  .btn-small.force {
    background: #e67e22;
  }

  .btn-small.force:hover {
    background: #d35400;
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
    .state-debugger {
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

    .state-card {
      background: #34495e;
    }

    .state-name {
      color: #ecf0f1;
    }

    .card-hint {
      color: #7f8c8d;
    }

    .state-detail {
      color: #95a5a6;
    }

    .next-state-value {
      color: #bb8fce;
    }

    .states-table {
      border-color: #34495e;
    }

    .table-header {
      background: #34495e;
      color: #bdc3c7;
    }

    .table-row {
      border-top-color: #3d566e;
    }

    .table-row.active {
      background: #3d566e;
    }

    .resource-tag {
      background: #3d566e;
      color: #bdc3c7;
    }

    .resource-tag.anima { background: #4a3d1e; color: #f1c40f; }
    .resource-tag.audio { background: #1e4d3d; color: #2ecc71; }
    .resource-tag.text { background: #2e4a62; color: #5dade2; }

    .extra-tag {
      background: #3d566e;
      color: #bdc3c7;
    }

    .extra-tag.next { background: #4a3d5a; color: #bb8fce; }
    .extra-tag.timer { background: #4a4a1e; color: #f1c40f; }
    .extra-tag.trigger { background: #1e4a3d; color: #2ecc71; }
    .extra-tag.branch { background: #4a3d2e; color: #e67e22; }

    .status-bar {
      background: #34495e;
      color: #bdc3c7;
    }

    .status-bar.error {
      background: #5a3e3e;
    }

    .status-item {
      background: #5a3e3e;
      border-color: #7f5a5a;
    }

    .status-item.complete {
      background: #2d5a4a;
      border-color: #4a8a6a;
    }

    .status-item.mode {
      background: #3d4a6a;
      border-color: #5a6a8a;
    }

    .status-label {
      color: #9ca3af;
    }

    .status-value {
      color: #ecf0f1;
    }
  }
</style>
