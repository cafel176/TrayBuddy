<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { SpriteAnimator, createAnimator } from "$lib/animation/SpriteAnimator";

  let characterCanvas: HTMLCanvasElement;
  let borderCanvas: HTMLCanvasElement;
  
  let characterAnimator: SpriteAnimator | null = null;
  let borderAnimator: SpriteAnimator | null = null;
  let unlistenState: (() => void) | null = null;
  let unlistenSettings: (() => void) | null = null;

  // 显隐控制状态
  let showCharacter = true;
  let showBorder = true;

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

  interface UserSettings {
    show_character: boolean;
    show_border: boolean;
    [key: string]: unknown;
  }

  async function init() {
    try {
      // 获取常量
      const constVars: Record<string, string> = await invoke("get_const_text");

      // 获取初始设置
      const settings: UserSettings = await invoke("get_settings");
      showCharacter = settings.show_character;
      showBorder = settings.show_border;

      // 创建 border 动画 (始终播放)
      borderAnimator = await createAnimator(borderCanvas, constVars.border);
      if (!borderAnimator) {
        console.error("Failed to create border animator");
      }

      // 监听状态切换事件
      unlistenState = await listen<StateChangeEvent>("state-change", async (event) => {
        const { state, play_once } = event.payload;
        await playAnimation(state.action, play_once);
      });

      // 监听设置变更事件
      unlistenSettings = await listen<UserSettings>("settings-change", (event) => {
        const settings = event.payload;
        showCharacter = settings.show_character;
        showBorder = settings.show_border;
      });

      // 初始化完成后，主动获取当前持久状态并播放
      const currentState: StateInfo | null = await invoke("get_persistent_state");
      if (currentState) {
        await playAnimation(currentState.action, false);
      }
    } catch (e) {
      console.error("Failed to init actions:", e);
    }
  }

  async function playAnimation(animationName: string, playOnce: boolean) {
    // 停止并销毁当前动画
    if (characterAnimator) {
      characterAnimator.destroy();
      characterAnimator = null;
    }

    // 创建新动画，不自动播放
    characterAnimator = await createAnimator(characterCanvas, animationName, false);
    if (!characterAnimator) {
      console.error(`Failed to create animator for '${animationName}'`);
      return;
    }

    if (playOnce) {
      // 播放一次，完成后通知后端
      characterAnimator.playOnce(() => {
        invoke("on_animation_complete");
      });
    } else {
      // 循环播放
      characterAnimator.play();
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
    characterAnimator?.destroy();
    borderAnimator?.destroy();
    unlistenState?.();
    unlistenSettings?.();
  });
</script>

<div class="container" on:mousedown={handleMouseDown}>
  <canvas 
    class="character-canvas" 
    class:hidden={!showCharacter}
    bind:this={characterCanvas}
  ></canvas>
  <canvas 
    class="border-canvas" 
    class:hidden={!showCharacter || !showBorder}
    bind:this={borderCanvas}
  ></canvas>
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
  .character-canvas {
    display: block;
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    height: 80%;
    z-index: 1;
  }
  .border-canvas {
    display: block;
    position: absolute;
    left: 50%;
    top: 85%;
    transform: translate(-50%, -50%);
    width: 100%;
    z-index: 2;
  }
  .hidden {
    visibility: hidden;
  }
</style>
