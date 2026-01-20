<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { SpriteAnimator, createAnimator } from "$lib/animation/SpriteAnimator";

  let idleCanvas: HTMLCanvasElement;
  let borderCanvas: HTMLCanvasElement;
  
  let idleAnimator: SpriteAnimator | null = null;
  let borderAnimator: SpriteAnimator | null = null;

  async function init() {
    try {
      // 获取常量
      const constVars: Record<string, string> = await invoke("get_const_text");

      // 创建 idle 动画
      idleAnimator = await createAnimator(idleCanvas, constVars.idle);
      if (!idleAnimator) {
        console.error("Failed to create idle animator");
      }

      // 创建 border 动画
      borderAnimator = await createAnimator(borderCanvas, constVars.border);
      if (!borderAnimator) {
        console.error("Failed to create border animator");
      }
    } catch (e) {
      console.error("Failed to init animations:", e);
    }
  }

  // 鼠标拖拽窗口
  async function handleMouseDown(e: MouseEvent) {
    if (e.button === 0) { // 左键
      await getCurrentWindow().startDragging();
    }
  }

  onMount(() => {
    init();
  });

  onDestroy(() => {
    idleAnimator?.destroy();
    borderAnimator?.destroy();
  });
</script>

<div class="container" on:mousedown={handleMouseDown}>
  <canvas class="idle-canvas" bind:this={idleCanvas}></canvas>
  <canvas class="border-canvas" bind:this={borderCanvas}></canvas>
</div>

<style>
  :global(html), :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background-color: transparent;
    width: 100%;
    height: 100%;
  }
  .container {
    position: relative;
    width: 100%;
    height: 100%;
    cursor: grab;
  }
  .container:active {
    cursor: grabbing;
  }
  .idle-canvas {
    display: block;
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    height: 90%;
    z-index: 1;
  }
  .border-canvas {
    display: block;
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 100%;
    z-index: 2;
  }
</style>
