<!--
========================================================================= 
媒体调试组件 (MediaDebugger.svelte)
=========================================================================

功能概述:
- 显示媒体监听器的详细状态信息
- 包括 GSMTC 和 Core Audio 两种 API 的会话信息
- 用于调试音乐播放检测问题
=========================================================================
-->

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount, onDestroy } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { t, onLangChange } from "$lib/i18n";
  import { isError } from "$lib/utils/statusMessage";

  // ======================================================================= //
  // i18n 响应式支持
  // ======================================================================= //

  let _langVersion = $state(0);
  let unsubLang: (() => void) | null = null;

  function _(key: string, params?: Record<string, string | number>): string {
    void _langVersion;
    return t(key, params);
  }

  // ======================================================================= //
  // 类型定义
  // ======================================================================= //

  interface GsmtcSessionInfo {
    app_id: string;
    status: string;
    title: string | null;
    artist: string | null;
    is_music_app: boolean;
  }

  interface CoreAudioSessionInfo {
    pid: number;
    process_name: string;
    session_state: string;
    peak_value: number;
    is_music_app: boolean;
    is_playing: boolean;
  }

  interface MediaStateEvent {
    status: string;
    title: string | null;
    artist: string | null;
    app_id: string | null;
  }

  interface MediaDebugInfo {
    observer_running: boolean;
    uptime_secs: number;
    last_check_time: string;
    gsmtc_available: boolean;
    core_audio_available: boolean;
    gsmtc_sessions: GsmtcSessionInfo[];
    core_audio_sessions: CoreAudioSessionInfo[];
    combined_state: MediaStateEvent;
    state_source: string;
    registered_session_events: number;
  }

  // ======================================================================= //
  // 响应式状态
  // ======================================================================= //

  let debugInfo = $state<MediaDebugInfo | null>(null);
  let statusMsg = $state("");

  // ======================================================================= //
  // 数据加载
  // ======================================================================= //

  async function loadDebugInfo() {
    try {
      debugInfo = await invoke("get_media_debug_info");
      if (debugInfo) {
        statusMsg = `${_("media.statusUpdated")} ${debugInfo.last_check_time}`;
      } else {
        statusMsg = _("media.statusWaiting");
      }
    } catch (e) {
      statusMsg = `${_("common.loadFailed")} ${e}`;
    }
  }

  async function init() {
    statusMsg = _("media.statusReading");
    await loadDebugInfo();

    // 监听后端推送的更新事件
    const unlisten = await listen<MediaDebugInfo>(
      "media-debug-update",
      (event) => {
        debugInfo = event.payload;
        statusMsg = `${_("media.statusUpdated")} ${debugInfo.last_check_time}`;
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

  function getStatusColor(status: string): string {
    switch (status) {
      case "Playing":
        return "#2ecc71";
      case "Paused":
        return "#f39c12";
      case "Stopped":
        return "#95a5a6";
      case "Active":
        return "#3498db";
      default:
        return "#7f8c8d";
    }
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
        console.error("MediaDebugger init error:", err);
        statusMsg = `${_("common.failed")} ${err}`;
      });

    return () => {
      if (unlisten) unlisten();
      unsubLang?.();
    };
  });
</script>

<!-- ======================================================================= -->
<!-- 组件模板 -->
<!-- ======================================================================= -->

<div class="media-debugger">
  <div class="header">
    <h4>{_("media.title")}</h4>
    <div class="controls">
      <button class="refresh-btn" onclick={loadDebugInfo}
        >{_("common.refresh")}</button
      >
      <span class="auto-refresh-badge">{_("media.autoUpdate")}</span>
    </div>
  </div>

  {#if debugInfo}
    <!-- 基础状态 -->
    <section class="section">
      <h5>{_("media.observerStatus")}</h5>
      <div class="info-grid">
        <div class="info-item">
          <span class="label">{_("media.runningStatus")}</span>
          <span class="value" class:running={debugInfo.observer_running}>
            {debugInfo.observer_running
              ? _("common.running")
              : _("common.stopped")}
          </span>
        </div>
        <div class="info-item">
          <span class="label">{_("media.runtime")}</span>
          <span class="value">{formatUptime(debugInfo.uptime_secs)}</span>
        </div>
        <div class="info-item">
          <span class="label">{_("media.gsmtc")}</span>
          <span class="value" class:available={debugInfo.gsmtc_available}>
            {debugInfo.gsmtc_available
              ? _("common.enabled")
              : _("common.disabled")}
          </span>
        </div>
        <div class="info-item">
          <span class="label">{_("media.coreAudio")}</span>
          <span class="value" class:available={debugInfo.core_audio_available}>
            {debugInfo.core_audio_available
              ? _("common.enabled")
              : _("common.disabled")}
          </span>
        </div>
        <div class="info-item">
          <span class="label">{_("media.registeredEvents")}</span>
          <span class="value">{debugInfo.registered_session_events}</span>
        </div>
      </div>
    </section>

    <!-- 综合状态 -->
    <section class="section">
      <h5>{_("media.currentStatus")}</h5>
      <div class="combined-state">
        <div
          class="state-badge"
          style="background: {getStatusColor(debugInfo.combined_state.status)}"
        >
          {debugInfo.combined_state.status}
        </div>
        <div class="state-details">
          <div>
            <strong>{_("media.source")}</strong>
            {debugInfo.state_source}
          </div>
          {#if debugInfo.combined_state.app_id}
            <div>
              <strong>{_("media.app")}</strong>
              {debugInfo.combined_state.app_id}
            </div>
          {/if}
          {#if debugInfo.combined_state.title}
            <div>
              <strong>{_("media.titleLabel")}</strong>
              {debugInfo.combined_state.title}
            </div>
          {/if}
          {#if debugInfo.combined_state.artist}
            <div>
              <strong>{_("media.artist")}</strong>
              {debugInfo.combined_state.artist}
            </div>
          {/if}
        </div>
      </div>
    </section>

    <!-- GSMTC 会话 -->
    <section class="section">
      <h5>{_("media.gsmtcSessions")} ({debugInfo.gsmtc_sessions.length})</h5>
      {#if debugInfo.gsmtc_sessions.length > 0}
        <div class="sessions-list">
          {#each debugInfo.gsmtc_sessions as session}
            <div class="session-card" class:music-app={session.is_music_app}>
              <div class="session-header">
                <span class="app-id" title={session.app_id}>
                  {session.app_id.length > 40
                    ? session.app_id.slice(0, 40) + "..."
                    : session.app_id}
                </span>
                <span
                  class="status-badge"
                  style="background: {getStatusColor(session.status)}"
                >
                  {session.status}
                </span>
              </div>
              <div class="session-info">
                {#if session.title}
                  <div class="meta">🎵 {session.title}</div>
                {/if}
                {#if session.artist}
                  <div class="meta">👤 {session.artist}</div>
                {/if}
                <div class="tags">
                  {#if session.is_music_app}
                    <span class="tag music">{_("media.musicApp")}</span>
                  {:else}
                    <span class="tag other">{_("media.otherApp")}</span>
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="empty-state">{_("media.noGsmtcSession")}</div>
      {/if}
    </section>

    <!-- Core Audio 会话 -->
    <section class="section">
      <h5>
        {_("media.coreAudioSessions")} ({debugInfo.core_audio_sessions.length})
      </h5>
      {#if debugInfo.core_audio_sessions.length > 0}
        <div class="sessions-list">
          {#each debugInfo.core_audio_sessions as session}
            <div
              class="session-card"
              class:music-app={session.is_music_app}
              class:playing={session.is_playing}
            >
              <div class="session-header">
                <span class="process-name">{session.process_name}</span>
                <span class="pid">PID: {session.pid}</span>
              </div>
              <div class="session-info">
                <div class="audio-meter">
                  <span class="label">{_("media.volumePeak")}</span>
                  <div class="meter-bar">
                    <div
                      class="meter-fill"
                      style="width: {Math.min(session.peak_value * 100, 100)}%"
                      class:active={session.is_playing}
                    ></div>
                  </div>
                  <span class="value"
                    >{(session.peak_value * 100).toFixed(2)}%</span
                  >
                </div>
                <div class="tags">
                  <span
                    class="tag"
                    style="background: {getStatusColor(session.session_state)}"
                  >
                    {session.session_state}
                  </span>
                  {#if session.is_music_app}
                    <span class="tag music">{_("media.musicApp")}</span>
                  {/if}
                  {#if session.is_playing}
                    <span class="tag playing">{_("media.nowPlaying")}</span>
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="empty-state">{_("media.noCoreAudioSession")}</div>
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
  .media-debugger {
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
    border-left: 4px solid #9b59b6;
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
    background: #9b59b6;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85em;
  }

  .refresh-btn:hover {
    background: #8e44ad;
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

  .info-item .value.available {
    color: #3498db;
  }

  .combined-state {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }

  .state-badge {
    padding: 8px 16px;
    border-radius: 20px;
    color: white;
    font-weight: 600;
    font-size: 0.9em;
  }

  .state-details {
    flex: 1;
    font-size: 0.85em;
    line-height: 1.6;
  }

  .sessions-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .session-card {
    background: #f8f9fa;
    border-radius: 6px;
    padding: 10px;
    border-left: 3px solid #dee2e6;
  }

  .session-card.music-app {
    border-left-color: #9b59b6;
  }

  .session-card.playing {
    background: #e8f5e9;
  }

  .session-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }

  .app-id,
  .process-name {
    font-weight: 600;
    color: #343a40;
    font-size: 0.9em;
  }

  .pid {
    font-size: 0.75em;
    color: #868e96;
  }

  .status-badge {
    padding: 2px 8px;
    border-radius: 10px;
    color: white;
    font-size: 0.75em;
  }

  .session-info {
    font-size: 0.85em;
  }

  .meta {
    color: #495057;
    margin-bottom: 4px;
  }

  .tags {
    display: flex;
    gap: 4px;
    margin-top: 6px;
    flex-wrap: wrap;
  }

  .tag {
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 0.7em;
    background: #dee2e6;
    color: #495057;
  }

  .tag.music {
    background: #9b59b6;
    color: white;
  }

  .tag.other {
    background: #95a5a6;
    color: white;
  }

  .tag.playing {
    background: #2ecc71;
    color: white;
  }

  .audio-meter {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .audio-meter .label {
    font-size: 0.8em;
    color: #868e96;
    min-width: 60px;
  }

  .meter-bar {
    flex: 1;
    height: 8px;
    background: #e9ecef;
    border-radius: 4px;
    overflow: hidden;
  }

  .meter-fill {
    height: 100%;
    background: #95a5a6;
    transition: width 0.2s;
  }

  .meter-fill.active {
    background: #2ecc71;
  }

  .audio-meter .value {
    font-size: 0.8em;
    color: #495057;
    min-width: 50px;
    text-align: right;
  }

  .empty-state {
    text-align: center;
    color: #adb5bd;
    padding: 20px;
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
    .media-debugger {
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

    .session-card {
      background: #3d5a6c;
      border-left-color: #455a64;
    }

    .session-card.music-app {
      border-left-color: #9b59b6;
    }

    .session-card.playing {
      background: #1e4620;
    }

    .app-id,
    .process-name {
      color: #ecf0f1;
    }
    .meta {
      color: #bdc3c7;
    }
    .state-details {
      color: #bdc3c7;
    }

    .meter-bar {
      background: #455a64;
    }
    .tag {
      background: #455a64;
      color: #bdc3c7;
    }

    .empty-state,
    .loading {
      color: #7f8c8d;
    }
  }
</style>
