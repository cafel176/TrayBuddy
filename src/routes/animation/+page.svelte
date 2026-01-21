<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { SpriteAnimator, createAnimator } from "$lib/animation/SpriteAnimator";
  import { getAudioManager, type AudioManager } from "$lib/audio/AudioManager";
  import { getTriggerManager, type TriggerManager } from "$lib/trigger/TriggerManager";

  let characterCanvas: HTMLCanvasElement;
  let borderCanvas: HTMLCanvasElement;
  
  let characterAnimator: SpriteAnimator | null = null;
  let borderAnimator: SpriteAnimator | null = null;
  let audioManager: AudioManager | null = null;
  let triggerManager: TriggerManager | null = null;
  let unlistenState: (() => void) | null = null;
  let unlistenSettings: (() => void) | null = null;

  // 显隐控制状态
  let showCharacter = true;
  let showBorder = true;

  // 播放完成计数器 (用于等待音频和动画都完成)
  let animationComplete = false;
  let audioComplete = false;
  let isPlayOnce = false;

  // 拖拽检测
  let isDragging = false;
  let isMouseDown = false;
  let mouseDownPos = { x: 0, y: 0 };
  const DRAG_THRESHOLD = 5; // 移动超过此像素数视为拖拽

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

      // 初始化音频管理器
      audioManager = await getAudioManager();

      // 初始化触发器管理器
      triggerManager = getTriggerManager();

      // 创建 border 动画 (始终播放)
      borderAnimator = await createAnimator(borderCanvas, constVars.border);
      if (!borderAnimator) {
        console.error("Failed to create border animator");
      }

      // 监听状态切换事件
      unlistenState = await listen<StateChangeEvent>("state-change", async (event) => {
        const { state, play_once } = event.payload;
        await playState(state, play_once);
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
        await playState(currentState, false);
      }

      // 所有初始化完成后，触发 login 事件
      console.log("[init] All initialization complete, triggering login event");
      triggerManager?.trigger("login");
    } catch (e) {
      console.error("Failed to init actions:", e);
    }
  }

  /**
   * 播放状态 (同时播放动画和音频)
   */
  async function playState(state: StateInfo, playOnce: boolean) {
    console.log(`[playState] name='${state.name}' audio='${state.audio}' playOnce=${playOnce}`);
    isPlayOnce = playOnce;
    animationComplete = false;
    audioComplete = false;

    // 播放动画
    await playAnimation(state.action, playOnce);

    // 播放音频
    if (audioManager && state.audio) {
      console.log(`[playState] Calling audioManager.play('${state.audio}')`);
      audioManager.play(state.audio, () => {
        console.log(`[playState] Audio completed`);
        audioComplete = true;
        checkComplete();
      });
    } else {
      // 没有音频，直接标记完成
      console.log(`[playState] No audio to play (audioManager=${!!audioManager}, audio='${state.audio}')`);
      audioComplete = true;
    }
  }

  /**
   * 检查是否都完成，如果是则通知后端
   */
  function checkComplete() {
    if (isPlayOnce && animationComplete && audioComplete) {
      invoke("on_animation_complete");
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
      animationComplete = true;
      checkComplete();
      return;
    }

    if (playOnce) {
      // 播放一次，完成后标记
      characterAnimator.playOnce(() => {
        animationComplete = true;
        checkComplete();
      });
    } else {
      // 循环播放
      characterAnimator.play();
      animationComplete = true; // 循环播放不需要等待完成
    }
  }

  // 鼠标按下 - 记录位置，准备拖拽或单击
  function handleMouseDown(e: MouseEvent) {
    if (e.button === 0) { // 左键
      isDragging = false;
      isMouseDown = true;
      mouseDownPos = { x: e.screenX, y: e.screenY };
    }
  }

  // 鼠标移动 - 检测是否超过拖拽阈值，超过则启动拖拽
  async function handleMouseMove(e: MouseEvent) {
    if (isMouseDown && !isDragging) {
      const dx = Math.abs(e.screenX - mouseDownPos.x);
      const dy = Math.abs(e.screenY - mouseDownPos.y);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        isDragging = true;
        // 超过阈值，启动窗口拖拽
        await getCurrentWindow().startDragging();
      }
    }
  }

  // 鼠标抬起 - 如果未拖拽则触发 click 事件
  function handleMouseUp(e: MouseEvent) {
    if (e.button === 0) {
      if (isMouseDown && !isDragging) {
        // 非拖拽单击，触发 click 事件
        console.log("[handleMouseUp] Click detected, triggering click event");
        triggerManager?.trigger("click");
      }
      isMouseDown = false;
      isDragging = false;
    }
  }

  onMount(() => {
    init();
  });

  onDestroy(() => {
    characterAnimator?.destroy();
    borderAnimator?.destroy();
    audioManager?.destroy();
    triggerManager?.destroy();
    unlistenState?.();
    unlistenSettings?.();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div 
  class="container" 
  on:mousedown={handleMouseDown}
  on:mousemove={handleMouseMove}
  on:mouseup={handleMouseUp}
>
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
