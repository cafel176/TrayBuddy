<!--
=========================================================================
AI Tool Info Window (+page.svelte)
=========================================================================
独立信息窗口，由 AI 工具任务线程管理生命周期。
通过 URL query 参数 ?tool=xxx 获取工具名。
仅显示后端推送的 AI 回复文本。
支持拖拽移动和边缘拖拽调整大小。
=========================================================================
-->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";

  const EDGE = 6;
  const appWindow = getCurrentWindow();

  function getToolName(): string {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get("tool") || "unknown";
  }

  let toolName = $state(getToolName());
  let displayText = $state("");
  let unlistenInfo: UnlistenFn | null = null;

  type ResizeDirection =
    | "North" | "South" | "East" | "West"
    | "NorthEast" | "NorthWest" | "SouthEast" | "SouthWest";

  /** 根据鼠标在窗口中的位置判断 resize 方向，返回 null 表示在内部（拖拽移动） */
  function getResizeDirection(e: MouseEvent): ResizeDirection | null {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const x = e.clientX;
    const y = e.clientY;

    const top = y < EDGE;
    const bottom = y > h - EDGE;
    const left = x < EDGE;
    const right = x > w - EDGE;

    if (top && left) return "NorthWest";
    if (top && right) return "NorthEast";
    if (bottom && left) return "SouthWest";
    if (bottom && right) return "SouthEast";
    if (top) return "North";
    if (bottom) return "South";
    if (left) return "West";
    if (right) return "East";
    return null;
  }

  function getCursorStyle(dir: ResizeDirection | null): string {
    if (!dir) return "grab";
    const map: Record<ResizeDirection, string> = {
      North: "n-resize", South: "s-resize",
      East: "e-resize", West: "w-resize",
      NorthEast: "ne-resize", NorthWest: "nw-resize",
      SouthEast: "se-resize", SouthWest: "sw-resize",
    };
    return map[dir];
  }

  function handleMouseDown(e: MouseEvent) {
    // 滚动条区域不触发拖拽
    const el = e.currentTarget as HTMLElement;
    if (el.scrollHeight > el.clientHeight && e.offsetX >= el.clientWidth) return;

    const dir = getResizeDirection(e);
    if (dir) {
      appWindow.startResizeDragging(dir);
    } else {
      appWindow.startDragging();
    }
  }

  function handleMouseMove(e: MouseEvent) {
    const dir = getResizeDirection(e);
    const el = e.currentTarget as HTMLElement;
    el.style.cursor = getCursorStyle(dir);
  }

  onMount(async () => {
    unlistenInfo = await listen<{ tool: string; message: string }>(
      "ai-tool-info-message",
      (event) => {
        if (event.payload.tool === toolName) {
          displayText = event.payload.message;
        }
      },
    );
  });

  onDestroy(() => {
    unlistenInfo?.();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="info-window" onmousedown={handleMouseDown} onmousemove={handleMouseMove}>
  <div class="info-text" onmousedown={handleMouseDown} onmousemove={handleMouseMove}>
    {#if displayText}
      {displayText}
    {:else}
      <span class="placeholder">...</span>
    {/if}
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: transparent;
    color: #333;
    overflow: hidden;
    user-select: none;
  }

  .info-window {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    padding: 8px 12px;
    box-sizing: border-box;
    background: rgba(255, 255, 255, 0.55);
    border-radius: 8px;
    border: 1px solid rgba(0, 0, 0, 0.08);
    cursor: grab;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }

  .info-window:active {
    cursor: grabbing;
  }

  .info-text {
    width: 100%;
    text-align: center;
    font-size: 13px;
    line-height: 1.6;
    color: #333;
    word-break: break-word;
    overflow-y: auto;
    max-height: 100%;
  }

  .placeholder {
    color: rgba(0, 0, 0, 0.2);
    font-style: italic;
  }

  .info-text::-webkit-scrollbar {
    width: 4px;
  }

  .info-text::-webkit-scrollbar-track {
    background: transparent;
  }

  .info-text::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.15);
    border-radius: 2px;
  }
</style>
