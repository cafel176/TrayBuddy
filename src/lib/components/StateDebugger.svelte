<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { onMount, onDestroy } from "svelte";

  interface StateInfo {
    name: string;
    persistent: boolean;
    action: string;
    audio: string;
    text: string;
    priority: number;
  }

  interface StateChangeEvent {
    state: StateInfo;
    play_once: boolean;
  }

  let allStates = $state<StateInfo[]>([]);
  let currentState = $state<StateInfo | null>(null);
  let persistentState = $state<StateInfo | null>(null);
  let isLocked = $state(false);
  let statusMsg = $state("正在加载...");
  let eventLog = $state<string[]>([]);
  let unlisten: (() => void) | null = null;

  async function loadStates() {
    try {
      allStates = await invoke("get_all_states");
      currentState = await invoke("get_current_state");
      persistentState = await invoke("get_persistent_state");
      isLocked = await invoke("is_state_locked");
      statusMsg = "状态已加载";
    } catch (e) {
      statusMsg = `加载失败: ${e}`;
    }
  }

  async function switchState(name: string) {
    try {
      const success = await invoke("switch_state", { name });
      if (success) {
        statusMsg = `切换到状态: ${name}`;
        addLog(`switch_state("${name}") -> 成功`);
      } else {
        statusMsg = `切换失败: 优先级不足或状态锁定`;
        addLog(`switch_state("${name}") -> 失败 (优先级不足或锁定)`);
      }
      await loadStates();
    } catch (e) {
      statusMsg = `切换失败: ${e}`;
      addLog(`switch_state("${name}") -> 错误: ${e}`);
    }
  }

  async function forceSwitch(name: string) {
    try {
      await invoke("force_switch_state", { name });
      statusMsg = `强制切换到: ${name}`;
      addLog(`force_switch_state("${name}") -> 成功`);
      await loadStates();
    } catch (e) {
      statusMsg = `强制切换失败: ${e}`;
      addLog(`force_switch_state("${name}") -> 错误: ${e}`);
    }
  }

  async function setPersistent(name: string) {
    try {
      await invoke("set_persistent_state", { name });
      statusMsg = `设置持久状态: ${name}`;
      addLog(`set_persistent_state("${name}") -> 成功`);
      await loadStates();
    } catch (e) {
      statusMsg = `设置失败: ${e}`;
      addLog(`set_persistent_state("${name}") -> 错误: ${e}`);
    }
  }

  function addLog(msg: string) {
    const time = new Date().toLocaleTimeString();
    eventLog = [`[${time}] ${msg}`, ...eventLog.slice(0, 19)];
  }

  onMount(async () => {
    await loadStates();
    
    // 监听状态变化事件
    unlisten = await listen<StateChangeEvent>("state-change", (event) => {
      const { state, play_once } = event.payload;
      addLog(`事件: state-change -> ${state.name} (play_once: ${play_once})`);
      loadStates();
    });
  });

  onDestroy(() => {
    unlisten?.();
  });
</script>

<div class="state-debugger">
  <h3>StateManager 调试面板</h3>

  <div class="state-cards">
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
      {:else}
        <div class="empty">无</div>
      {/if}
    </div>

    <div class="state-card persistent">
      <div class="card-header">持久状态</div>
      {#if persistentState}
        <div class="state-name">{persistentState.name}</div>
        <div class="state-meta">
          <span class="action">动画: {persistentState.action}</span>
        </div>
      {:else}
        <div class="empty">无</div>
      {/if}
    </div>
  </div>

  <div class="section">
    <h4>预定义状态列表</h4>
    <div class="states-table">
      <div class="table-header">
        <span class="col-name">名称</span>
        <span class="col-type">类型</span>
        <span class="col-action">动画</span>
        <span class="col-priority">优先级</span>
        <span class="col-ops">操作</span>
      </div>
      {#each allStates as state}
        <div class="table-row" class:active={currentState?.name === state.name}>
          <span class="col-name">{state.name}</span>
          <span class="col-type">
            <span class="badge small" class:persistent={state.persistent}>
              {state.persistent ? '持久' : '临时'}
            </span>
          </span>
          <span class="col-action">{state.action}</span>
          <span class="col-priority">{state.priority}</span>
          <span class="col-ops">
            <button class="btn-small" onclick={() => switchState(state.name)} title="切换状态 (检查优先级)">
              切换
            </button>
            <button class="btn-small force" onclick={() => forceSwitch(state.name)} title="强制切换 (忽略优先级)">
              强制
            </button>
            {#if state.persistent}
              <button class="btn-small set-persistent" onclick={() => setPersistent(state.name)} title="设为持久状态">
                设持久
              </button>
            {/if}
          </span>
        </div>
      {/each}
    </div>
  </div>

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

  <div class="actions">
    <button class="refresh" onclick={loadStates}>刷新状态</button>
  </div>

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
    grid-template-columns: 1fr 1fr;
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

  .card-header {
    font-size: 0.75em;
    color: #7f8c8d;
    text-transform: uppercase;
    margin-bottom: 5px;
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

  .priority, .action {
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

  .states-table {
    border: 1px solid #eee;
    border-radius: 6px;
    overflow: hidden;
  }

  .table-header {
    display: grid;
    grid-template-columns: 80px 60px 80px 60px 1fr;
    gap: 10px;
    padding: 8px 10px;
    background: #f1f2f6;
    font-weight: bold;
    font-size: 0.8em;
    color: #666;
  }

  .table-row {
    display: grid;
    grid-template-columns: 80px 60px 80px 60px 1fr;
    gap: 10px;
    padding: 8px 10px;
    border-top: 1px solid #eee;
    font-size: 0.85em;
    align-items: center;
  }

  .table-row.active {
    background: #e8f4fd;
  }

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

  .btn-small.set-persistent {
    background: #27ae60;
  }

  .btn-small.set-persistent:hover {
    background: #1e8449;
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

    .status-bar {
      background: #34495e;
      color: #bdc3c7;
    }

    .status-bar.error {
      background: #5a3e3e;
    }
  }
</style>
