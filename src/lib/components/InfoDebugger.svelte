<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";

  interface UserInfo {
    last_login: number | null;
    current_mod: string;
    animation_window_x: number | null;
    animation_window_y: number | null;
  }

  let info = $state<UserInfo | null>(null);
  let statusMsg = $state("正在读取...");
  let saving = $state(false);

  async function loadInfo() {
    try {
      info = await invoke("get_user_info");
      statusMsg = "信息已加载";
    } catch (e) {
      statusMsg = `加载失败: ${e}`;
    }
  }

  async function saveInfo() {
    if (!info) return;
    saving = true;
    try {
      await invoke("update_user_info", { info });
      statusMsg = "已更新";
    } catch (e) {
      statusMsg = `更新失败: ${e}`;
    } finally {
      saving = false;
    }
  }

  function formatTime(ts: number | null) {
    if (!ts) return "从未登录";
    return new Date(ts).toLocaleString();
  }

  onMount(loadInfo);
</script>

<div class="info-debugger">
  <h4>UserInfo 调试器</h4>

  {#if info}
    <div class="data-row">
      <span class="label">最后登录:</span>
      <span class="value">{formatTime(info.last_login)}</span>
    </div>

    <div class="data-row">
      <span class="label">当前 Mod:</span>
      <span class="value">{info.current_mod || '未加载'}</span>
    </div>

    <div class="data-row">
      <span class="label">窗口位置:</span>
      <span class="value">
        {#if info.animation_window_x !== null && info.animation_window_y !== null}
          ({Math.round(info.animation_window_x)}, {Math.round(info.animation_window_y)})
        {:else}
          未保存
        {/if}
      </span>
    </div>

    <div class="hint">注：窗口位置在程序退出时自动保存。</div>
  {:else}
    <div class="loading">{statusMsg}</div>
  {/if}

  <div class="mini-status" class:error={statusMsg.includes('失败')}>
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

  input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid #ced4da;
    border-radius: 4px;
    font-size: 0.9em;
  }

  input:focus {
    border-color: #3498db;
    outline: none;
    box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.25);
  }

  .hint {
    font-size: 0.8em;
    color: #adb5bd;
    margin-top: 10px;
    font-style: italic;
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
    input {
      background: #2c3e50;
      border-color: #455a64;
      color: white;
    }
    .hint { color: #7f8c8d; }
  }
</style>
