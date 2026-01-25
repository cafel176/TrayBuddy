<!--
========================================================================= 
用户信息调试组件 (InfoDebugger.svelte)
=========================================================================

功能概述:
- 显示用户运行时信息，包括登录时间、当前 Mod、窗口位置等
- 提供只读视图，用于调试和查看应用状态

数据来源:
- 调用后端 get_user_info 命令获取 UserInfo 数据
=========================================================================
-->

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { onMount, onDestroy } from "svelte";
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
    return msg.includes(_("common.failed")) || msg.includes("failed") || msg.includes("失败");
  }

  // ======================================================================= //
  // 类型定义
  // ======================================================================= //

  /**
   * 用户信息接口
   * 对应后端的 UserInfo 结构体
   */
  interface UserInfo {
    /** 上次登录时间戳 (毫秒) */
    last_login: number | null;
    /** 当前加载的 Mod 名称 */
    current_mod: string;
    /** 动画窗口 X 坐标 */
    animation_window_x: number | null;
    /** 动画窗口 Y 坐标 */
    animation_window_y: number | null;
  }

  // ======================================================================= //
  // 响应式状态
  // ======================================================================= //

  /** 用户信息数据 */
  let info = $state<UserInfo | null>(null);
  
  /** 状态消息，用于显示加载/操作结果 */
  let statusMsg = $state("");
  
  /** 保存操作进行中标记 (预留功能) */
  let saving = $state(false);

  /** 事件监听器取消函数 */
  let unlistenPosition: (() => void) | null = null;

  // ======================================================================= //
  // 数据加载函数
  // ======================================================================= //

  /**
   * 从后端加载用户信息
   */
  async function loadInfo() {
    try {
      info = await invoke("get_user_info");
      statusMsg = _("info.statusLoaded");
    } catch (e) {
      statusMsg = `${_("common.loadFailed")} ${e}`;
    }
  }

  /**
   * 保存用户信息到后端 (预留功能)
   */
  async function saveInfo() {
    if (!info) return;
    saving = true;
    try {
      await invoke("update_user_info", { info });
      statusMsg = _("info.statusUpdated");
    } catch (e) {
      statusMsg = `${_("info.statusUpdateFailed")} ${e}`;
    } finally {
      saving = false;
    }
  }

  // ======================================================================= //
  // 工具函数
  // ======================================================================= //

  /**
   * 格式化时间戳为本地时间字符串
   * @param ts 时间戳 (毫秒)
   * @returns 格式化的时间字符串或"从未登录"
   */
  function formatTime(ts: number | null) {
    if (!ts) return _("info.neverLoggedIn");
    return new Date(ts).toLocaleString();
  }

  // ======================================================================= //
  // 生命周期
  // ======================================================================= //

  onMount(async () => {
    unsubLang = onLangChange(() => { _langVersion++; });
    statusMsg = _("info.statusReading");
    await loadInfo();
    
    // 监听窗口位置变化事件
    unlistenPosition = await listen<[number, number]>("window-position-changed", (event) => {
      if (info) {
        const [x, y] = event.payload;
        info.animation_window_x = x;
        info.animation_window_y = y;
      }
    });
  });

  onDestroy(() => {
    unsubLang?.();
    unlistenPosition?.();
  });
</script>

<!-- ======================================================================= -->
<!-- 组件模板 -->
<!-- ======================================================================= -->

<div class="info-debugger">
  <h4>{_("info.title")}</h4>

  {#if info}
    <!-- 最后登录时间 -->
    <div class="data-row">
      <span class="label">{_("info.lastLogin")}</span>
      <span class="value">{formatTime(info.last_login)}</span>
    </div>

    <!-- 当前加载的 Mod -->
    <div class="data-row">
      <span class="label">{_("info.currentMod")}</span>
      <span class="value">{info.current_mod || _("info.notLoaded")}</span>
    </div>

    <!-- 动画窗口位置 -->
    <div class="data-row">
      <span class="label">{_("info.windowPosition")}</span>
      <span class="value">
        {#if info.animation_window_x !== null && info.animation_window_y !== null}
          ({Math.round(info.animation_window_x)}, {Math.round(info.animation_window_y)})
        {:else}
          {_("info.notSaved")}
        {/if}
      </span>
    </div>

    <!-- 保存按钮 -->
    <div class="actions">
      <button class="save-btn" onclick={saveInfo} disabled={saving}>
        {saving ? _("common.saving") : _("common.save")}
      </button>
    </div>

    <div class="hint">{_("info.positionNote")}</div>
  {:else}
    <!-- 加载中状态 -->
    <div class="loading">{statusMsg}</div>
  {/if}

  <!-- 状态消息栏 -->
  <div class="mini-status" class:error={isError(statusMsg)}>
    {statusMsg}
  </div>
</div>

<style>
  .info-debugger {
    background: #f8f9fa;
    border: 1px solid #dee2e6;
    border-radius: 8px;
    padding: 15px;
    margin: 10px auto;
    max-width: 450px;
    font-size: 0.9em;
  }

  h4 {
    margin: 0 0 15px 0;
    color: #495057;
    border-left: 4px solid #3498db;
    padding-left: 10px;
  }

  .data-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }

  .label {
    font-weight: bold;
    color: #6c757d;
    min-width: 80px;
  }

  .value {
    color: #212529;
  }

  .hint {
    font-size: 0.8em;
    color: #adb5bd;
    margin-top: 10px;
    font-style: italic;
  }

  .actions {
    margin-top: 15px;
    display: flex;
    justify-content: flex-end;
  }

  .save-btn {
    padding: 8px 20px;
    background: #3498db;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9em;
    transition: background 0.2s;
  }

  .save-btn:hover:not(:disabled) {
    background: #2980b9;
  }

  .save-btn:disabled {
    background: #bdc3c7;
    cursor: not-allowed;
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
    .info-debugger {
      background: #34495e;
      border-color: #455a64;
    }
    h4 { color: #ecf0f1; }
    .label { color: #bdc3c7; }
    .value { color: #ecf0f1; }
    .hint { color: #7f8c8d; }
  }
</style>
