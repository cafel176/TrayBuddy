<!--
=========================================================================
AI Tool Info Window (+page.svelte)
=========================================================================
独立信息窗口，由 AI 工具任务线程管理生命周期。
通过 URL query 参数 ?tool=xxx 获取工具名。
用于显示截图结果、AI 回复等信息。
=========================================================================
-->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";

  /** 从 URL query 获取工具名 */
  function getToolName(): string {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get("tool") || "unknown";
  }

  let toolName = $state(getToolName());
  let messages = $state<{ time: string; content: string }[]>([]);
  let unlistenInfo: UnlistenFn | null = null;

  function formatTime(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  }

  onMount(async () => {
    // 设置窗口标题
    const appWindow = getCurrentWindow();
    await appWindow.setTitle(`AI Tool Info - ${toolName}`);

    messages.push({ time: formatTime(), content: `Info window opened for tool: ${toolName}` });

    // 监听 AI 工具信息事件（后端可在未来推送截图结果、AI 回复等）
    unlistenInfo = await listen<{ tool: string; message: string }>(
      "ai-tool-info-message",
      (event) => {
        if (event.payload.tool === toolName) {
          messages = [
            ...messages,
            { time: formatTime(), content: event.payload.message },
          ];
        }
      },
    );
  });

  onDestroy(() => {
    unlistenInfo?.();
  });
</script>

<div class="info-window">
  <header class="info-header">
    <span class="tool-name">{toolName}</span>
    <span class="tool-badge">AI Tool</span>
  </header>

  <div class="info-content">
    {#if messages.length === 0}
      <div class="empty-state">Waiting for data...</div>
    {:else}
      {#each messages as msg}
        <div class="info-message">
          <span class="msg-time">{msg.time}</span>
          <span class="msg-content">{msg.content}</span>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #1a1a2e;
    color: #e0e0e0;
    overflow: hidden;
  }

  .info-window {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .info-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: #16213e;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }

  .tool-name {
    font-weight: 700;
    font-size: 14px;
    color: #e0e0e0;
  }

  .tool-badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(79, 195, 247, 0.2);
    color: #4fc3f7;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .info-content {
    flex: 1;
    overflow-y: auto;
    padding: 10px 14px;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: rgba(255, 255, 255, 0.3);
    font-size: 13px;
    font-style: italic;
  }

  .info-message {
    display: flex;
    gap: 8px;
    padding: 4px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    font-size: 12px;
    line-height: 1.5;
  }

  .msg-time {
    color: rgba(255, 255, 255, 0.35);
    font-family: monospace;
    font-size: 11px;
    flex-shrink: 0;
    min-width: 60px;
  }

  .msg-content {
    color: #e0e0e0;
    word-break: break-word;
  }

  .info-content::-webkit-scrollbar {
    width: 6px;
  }

  .info-content::-webkit-scrollbar-track {
    background: transparent;
  }

  .info-content::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
  }

  .info-content::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.25);
  }
</style>
