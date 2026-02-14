<!--
========================================================================= 
进程监测调试组件 (ProcessDebugger.svelte)
=========================================================================

功能概述:
- 显示进程监测器的详细状态信息
- 展示关键字表、轮询状态、最近新进程、最近命中记录
- 用于调试 work 事件触发问题
=========================================================================
-->

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { t, onLangChange } from "$lib/i18n";

  // ======================================================================= //
  // i18n 响应式支持
  // ======================================================================= //

  let _langVersion = $state(0);
  let unsubLang: (() => void) | null = null;

  function _(key: string, params?: Record<string, string | number>): string {
    void _langVersion;
    return t(key, params);
  }

  /** 检查状态消息是否包含错误信息 */
  function isError(msg: string): boolean {
    return msg.includes(_("common.failed")) || msg.includes("failed");
  }

  // ======================================================================= //
  // 类型定义（与后端 ProcessDebugInfo 对齐）
  // ======================================================================= //

  interface ProcessStartEvent {
    pid: number;
    process_name: string;
    matched_keyword: string;
  }

  interface ProcessNewProcessInfo {
    pid: number;
    parent_pid: number;
    is_child: boolean;
    process_name: string;
    matched_keyword: string | null;
  }


  interface ProcessDebugInfo {
    observer_running: boolean;
    uptime_secs: number;
    last_check_time: string;
    poll_interval_ms: number;
    keywords: string[];
    last_new_processes: ProcessNewProcessInfo[];
    last_matched: ProcessStartEvent | null;
    seen_pid_count: number;
    current_pid_count: number;
  }

  // ======================================================================= //
  // 响应式状态
  // ======================================================================= //

  let debugInfo = $state<ProcessDebugInfo | null>(null);
  let statusMsg = $state("");

  // ======================================================================= //
  // 数据加载
  // ======================================================================= //

  async function loadDebugInfo() {
    try {
      debugInfo = await invoke("get_process_debug_info");
      if (debugInfo) {
        statusMsg = `${_("process.statusUpdated")} ${debugInfo.last_check_time}`;
      } else {
        statusMsg = _("process.statusWaiting");
      }
    } catch (e) {
      statusMsg = `${_("common.loadFailed")} ${e}`;
    }
  }

  async function init() {
    statusMsg = _("process.statusReading");
    await loadDebugInfo();

    // 监听后端推送的更新事件
    const unlisten = await listen<ProcessDebugInfo>(
      "process-debug-update",
      (event) => {
        debugInfo = event.payload;
        statusMsg = `${_("process.statusUpdated")} ${debugInfo.last_check_time}`;
      },
    );

    return unlisten;
  }

  function formatUptime(secs: number): string {
    const hours = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m ${s}s`;
    } else if (mins > 0) {
      return `${mins}m ${s}s`;
    }
    return `${s}s`;
  }

  function formatPollInterval(ms: number): string {
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${ms}ms`;
  }

  // ======================================================================= //
  // 生命周期
  // ======================================================================= //

  onMount(() => {
    unsubLang = onLangChange(() => {
      _langVersion++;
    });

    let unlisten: (() => void) | undefined;

    init()
      .then((u) => (unlisten = u))
      .catch((err) => {
        console.error("ProcessDebugger init error:", err);
        statusMsg = `${_("common.failed")} ${err}`;
      });

    return () => {
      if (unlisten) unlisten();
      unsubLang?.();
    };
  });
</script>

<div class="process-debugger">
  <div class="header">
    <h4>{_("process.title")}</h4>
    <div class="controls">
      <button class="refresh-btn" onclick={loadDebugInfo}>{_("common.refresh")}</button>
      <span class="auto-refresh-badge">{_("process.autoUpdate")}</span>
    </div>
  </div>

  {#if debugInfo}
    <!-- 基础状态 -->
    <section class="section">
      <h5>{_("process.observerStatus")}</h5>
      <div class="info-grid">
        <div class="info-item">
          <span class="label">{_("process.runningStatus")}</span>
          <span class="value" class:running={debugInfo.observer_running}>
            {debugInfo.observer_running ? _("common.running") : _("common.stopped")}
          </span>
        </div>
        <div class="info-item">
          <span class="label">{_("process.runtime")}</span>
          <span class="value">{formatUptime(debugInfo.uptime_secs)}</span>
        </div>
        <div class="info-item">
          <span class="label">{_("process.pollInterval")}</span>
          <span class="value">{formatPollInterval(debugInfo.poll_interval_ms)}</span>
        </div>
        <div class="info-item">
          <span class="label">{_("process.keywords")}</span>
          <span class="value">{debugInfo.keywords.length}</span>
        </div>
        <div class="info-item">
          <span class="label">{_("process.currentPidCount")}</span>
          <span class="value">{debugInfo.current_pid_count}</span>
        </div>
        <div class="info-item">
          <span class="label">{_("process.seenPidCount")}</span>
          <span class="value">{debugInfo.seen_pid_count}</span>
        </div>
      </div>

      {#if debugInfo.keywords.length > 0}
        <div class="keywords">
          {#each debugInfo.keywords.slice(0, 24) as kw}
            <span class="tag">{kw}</span>
          {/each}
          {#if debugInfo.keywords.length > 24}
            <span class="tag more">+{debugInfo.keywords.length - 24}</span>
          {/if}
        </div>
      {:else}
        <div class="empty-state">{_("process.noKeywords")}</div>
      {/if}
    </section>

    <!-- 最近命中 -->
    <section class="section">
      <h5>{_("process.lastMatched")}</h5>
      {#if debugInfo.last_matched}
        <div class="matched-card">
          <div class="row">
            <span class="pill">{_("process.pid")} {debugInfo.last_matched.pid}</span>
            <span class="pill">{debugInfo.last_matched.process_name}</span>
          </div>
          <div class="row">
            <span class="tag hit">{_("process.matchedKeyword")}: {debugInfo.last_matched.matched_keyword}</span>
          </div>
        </div>
      {:else}
        <div class="empty-state">{_("process.lastMatchedNone")}</div>
      {/if}
    </section>

    <!-- 最近新进程 -->
    <section class="section">
      <h5>
        {_("process.lastNewProcesses")} ({debugInfo.last_new_processes.length})
      </h5>
      {#if debugInfo.last_new_processes.length > 0}
        <div class="list">
          {#each debugInfo.last_new_processes as p}
            <div class="proc-row" class:hit={!!p.matched_keyword}>
              <div class="left">
                <span class="name">{p.process_name}</span>
                <span class="pid">{_("process.pid")} {p.pid}</span>
                <span class="pid">{_("process.ppid")} {p.parent_pid}</span>
                <span class="pid">{_("process.isChild")} {p.is_child ? _( "common.yes") : _("common.no")}</span>
              </div>

              <div class="right">
                {#if p.matched_keyword}
                  <span class="tag hit">{p.matched_keyword}</span>
                {:else}
                  <span class="tag">-</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="empty-state">{_("process.noNewProcesses")}</div>
      {/if}
    </section>
  {:else}
    <div class="loading">{statusMsg}</div>
  {/if}

  <div class="mini-status" class:error={isError(statusMsg)}>
    {statusMsg}
  </div>
</div>

<style>
  .process-debugger {
    background: #f8f9fa;
    border: 1px solid #dee2e6;
    border-radius: 8px;
    padding: 15px;
    margin: 10px auto;
    max-width: 600px;
    font-size: 0.9em;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
  }

  h4 {
    margin: 0;
    color: #495057;
    border-left: 4px solid #e67e22;
    padding-left: 10px;
  }

  h5 {
    margin: 0 0 10px 0;
    color: #6c757d;
    font-size: 0.95em;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .refresh-btn {
    padding: 5px 12px;
    background: #e67e22;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85em;
  }

  .refresh-btn:hover {
    background: #d35400;
  }

  .auto-refresh-badge {
    font-size: 0.85em;
    color: #27ae60;
    background: #e8f8f5;
    padding: 2px 8px;
    border-radius: 12px;
    border: 1px solid #27ae60;
  }

  .section {
    background: white;
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 12px;
    border: 1px solid #e9ecef;
  }

  .info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px;
  }

  .info-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .info-item .label {
    font-size: 0.8em;
    color: #868e96;
  }

  .info-item .value {
    font-weight: 600;
    color: #495057;
  }

  .info-item .value.running {
    color: #2ecc71;
  }

  .keywords {
    margin-top: 10px;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .tag {
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 0.75em;
    background: #dee2e6;
    color: #495057;
  }

  .tag.hit {
    background: #e67e22;
    color: white;
  }

  .tag.more {
    background: #95a5a6;
    color: white;
  }

  .matched-card {
    background: #fff7ed;
    border: 1px solid #fed7aa;
    border-radius: 6px;
    padding: 10px;
  }

  .row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 6px;
  }

  .pill {
    padding: 2px 8px;
    border-radius: 12px;
    background: #f1f3f5;
    font-size: 0.8em;
    color: #343a40;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .proc-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #f8f9fa;
    border-radius: 6px;
    padding: 10px;
    border-left: 3px solid #dee2e6;
  }

  .proc-row.hit {
    border-left-color: #e67e22;
  }

  .left {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .name {
    font-weight: 600;
    color: #343a40;
  }

  .pid {
    font-size: 0.75em;
    color: #868e96;
  }

  .empty-state {
    text-align: center;
    color: #adb5bd;
    padding: 12px;
    font-style: italic;
  }

  .loading {
    text-align: center;
    padding: 40px;
    color: #6c757d;
  }

  .mini-status {
    margin-top: 10px;
    font-size: 0.8em;
    text-align: right;
    color: #2ecc71;
  }

  .mini-status.error {
    color: #e74c3c;
  }

  @media (prefers-color-scheme: dark) {
    .process-debugger {
      background: #34495e;
      border-color: #455a64;
    }

    h4,
    h5 {
      color: #ecf0f1;
    }

    .section {
      background: #2c3e50;
      border-color: #455a64;
    }

    .info-item .label {
      color: #95a5a6;
    }
    .info-item .value {
      color: #ecf0f1;
    }

    .tag {
      background: #455a64;
      color: #bdc3c7;
    }

    .matched-card {
      background: #3d3a2c;
      border-color: #7f8c8d;
    }

    .pill {
      background: #455a64;
      color: #ecf0f1;
    }

    .proc-row {
      background: #3d5a6c;
      border-left-color: #455a64;
    }

    .name {
      color: #ecf0f1;
    }

    .empty-state,
    .loading {
      color: #7f8c8d;
    }
  }
</style>
