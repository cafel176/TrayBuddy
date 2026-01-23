<!--
========================================================================= 
动画窗口页面 (animation/+page.svelte)
=========================================================================

功能概述:
- 桌面宠物的主显示窗口
- 渲染角色动画和边框动画
- 处理用户交互 (点击、拖拽)
- 响应后端状态变化事件，同步播放动画和音频

核心功能:
1. 动画播放: 使用 SpriteAnimator 播放角色和边框动画
2. 音频同步: 使用 AudioManager 播放状态关联的音频
3. 事件触发: 使用 TriggerManager 响应用户点击等事件
4. 窗口拖拽: 支持拖拽移动窗口位置

状态变化流程:
1. 后端发送 state-change 事件
2. 前端接收并调用 playState()
3. 同时播放动画和音频
4. 播放完成后通知后端 (如果是 play_once 模式)
=========================================================================
-->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { SpriteAnimator } from "$lib/animation/SpriteAnimator";
  import { getAudioManager, type AudioManager } from "$lib/audio/AudioManager";
  import { getTriggerManager, type TriggerManager } from "$lib/trigger/TriggerManager";

  // ======================================================================= //
  // DOM 引用
  // ======================================================================= //

  /** 角色动画 Canvas 元素 */
  let characterCanvas: HTMLCanvasElement;
  
  /** 边框动画 Canvas 元素 */
  let borderCanvas: HTMLCanvasElement;
  
  // ======================================================================= //
  // 核心管理器实例
  // ======================================================================= //
  
  /** 角色动画播放器 */
  let characterAnimator: SpriteAnimator | null = null;
  
  /** 边框动画播放器 */
  let borderAnimator: SpriteAnimator | null = null;
  
  /** 音频管理器 */
  let audioManager: AudioManager | null = null;
  
  /** 触发器管理器 */
  let triggerManager: TriggerManager | null = null;
  
  /** 状态变化事件监听器取消函数 */
  let unlistenState: (() => void) | null = null;
  
  /** 设置变化事件监听器取消函数 */
  let unlistenSettings: (() => void) | null = null;

  // ======================================================================= //
  // 显示控制状态
  // ======================================================================= //

  /** 是否显示角色 */
  let showCharacter = true;
  
  /** 是否显示边框 */
  let showBorder = true;
  
  /** 角色 z-index 偏移量 */
  let characterZOffset = 1;

  /** 边框 z-index 偏移量 */
  let borderZOffset = 2;

  // ======================================================================= //
  // 播放同步状态
  // ======================================================================= //

  /** 动画播放完成标记 */
  let animationComplete = false;
  
  /** 音频播放完成标记 */
  let audioComplete = false;
  
  /** 是否为单次播放模式 (用于等待音频和动画都完成) */
  let isPlayOnce = false;

  // ======================================================================= //
  // 拖拽检测状态
  // ======================================================================= //

  /** 是否正在拖拽 */
  let isDragging = false;
  
  /** 鼠标是否按下 */
  let isMouseDown = false;
  
  /** 鼠标按下时的位置 */
  let mouseDownPos = { x: 0, y: 0 };
  
  /** 拖拽检测阈值 (像素) - 移动超过此距离视为拖拽而非点击 */
  const DRAG_THRESHOLD = 5;

  // ======================================================================= //
  // 类型定义
  // ======================================================================= //

  /**
   * 状态信息接口 (简化版)
   */
  interface StateInfo {
    /** 状态名称 */
    name: string;
    /** 是否为持久状态 */
    persistent: boolean;
    /** 动画资源名 */
    anima: string;
    /** 音频资源名 */
    audio: string;
    /** 文本资源名 */
    text: string;
    /** 优先级 */
    priority: number;
  }

  /**
   * 状态变化事件数据
   */
  interface StateChangeEvent {
    /** 新的状态信息 */
    state: StateInfo;
    /** 是否只播放一次 */
    play_once: boolean;
  }

  /**
   * 用户设置接口 (简化版)
   */
  interface UserSettings {
    /** 是否显示角色 */
    show_character: boolean;
    /** 是否显示边框 */
    show_border: boolean;
  }

  // ======================================================================= //
  // 初始化函数
  // ======================================================================= //

  /**
   * 初始化动画窗口
   * 加载设置、初始化管理器、设置事件监听
   */
  async function init() {
    try {
      // 1. 获取初始设置
      const settings: UserSettings = await invoke("get_settings");
      showCharacter = settings.show_character;
      showBorder = settings.show_border;

      // 2. 初始化音频管理器
      audioManager = await getAudioManager();

      // 3. 初始化触发器管理器
      triggerManager = getTriggerManager();

      // 4. 获取角色配置并应用 z_offset
      interface CharacterConfig {
        z_offset: number;
      }
      const characterConfig: CharacterConfig | null = await invoke("get_character_config");
      if (characterConfig) {
        characterZOffset = characterConfig.z_offset ?? 1;
      }

      // 5. 加载边框动画 (如果启用)
      interface BorderConfig {
        anima: string;
        enable: boolean;
        z_offset: number;
      }
      const borderConfig: BorderConfig | null = await invoke("get_border_config");
      if (borderConfig && borderConfig.enable && borderConfig.anima) {
        // 应用 z_offset 设置
        borderZOffset = borderConfig.z_offset ?? 2;
        
        borderAnimator = new SpriteAnimator(borderCanvas);
        const success = await borderAnimator.loadByAssetName(borderConfig.anima);
        if (success) {
          borderAnimator.play();
        } else {
          console.error("Failed to load border animator");
        }
      }

      // 5. 监听后端状态切换事件
      unlistenState = await listen<StateChangeEvent>("state-change", async (event) => {
        const { state, play_once } = event.payload;
        await playState(state, play_once);
      });

      // 6. 监听设置变更事件
      unlistenSettings = await listen<UserSettings>("settings-change", (event) => {
        const settings = event.payload;
        showCharacter = settings.show_character;
        showBorder = settings.show_border;
      });

      // 7. 初始化完成后，获取并播放当前持久状态
      const currentState: StateInfo | null = await invoke("get_persistent_state");
      if (currentState) {
        await playState(currentState, false);
      }

      // 8. 触发 login 事件
      console.log("[init] All initialization complete, triggering login event");
      triggerManager?.trigger("login");
    } catch (e) {
      console.error("Failed to init actions:", e);
    }
  }

  // ======================================================================= //
  // 状态播放函数
  // ======================================================================= //

  /**
   * 播放状态 (同时播放动画和音频)
   * @param state 状态信息
   * @param playOnce 是否只播放一次
   */
  async function playState(state: StateInfo, playOnce: boolean) {
    isPlayOnce = playOnce;
    animationComplete = false;
    audioComplete = false;

    // 播放动画
    await playAnimation(state.anima, playOnce);

    // 播放音频
    if (audioManager && state.audio) {
      audioManager.play(state.audio, () => {
        audioComplete = true;
        checkComplete();
      });
    } else {
      // 没有音频，直接标记完成
      audioComplete = true;
      checkComplete();
    }
  }

  /**
   * 检查动画和音频是否都完成
   * 如果是单次播放模式且都完成，通知后端
   */
  function checkComplete() {
    if (isPlayOnce && animationComplete && audioComplete) {
      // 使用 setTimeout 延迟调用，避免在后端持有锁时同步调用导致死锁
      setTimeout(() => {
        invoke("on_animation_complete");
      }, 0);
    }
  }

  /**
   * 播放指定动画
   * 
   * 使用 switchToAsset 复用现有播放器实例，避免销毁重建
   * 
   * @param assetName 动画资产名 (对应状态的 anima 字段)
   * @param playOnce 是否只播放一次
   */
  async function playAnimation(assetName: string, playOnce: boolean) {
    // 没有指定动画资产，直接标记完成
    if (!assetName) {
      animationComplete = true;
      checkComplete();
      return;
    }

    // 如果还没有创建播放器，先创建一个
    if (!characterAnimator) {
      characterAnimator = new SpriteAnimator(characterCanvas);
    }

    // 使用 switchToAsset 切换动画（复用实例，使用图片缓存）
    // 注意: 传入的是资产名 (anima)，而不是状态名
    const success = await characterAnimator.switchToAsset(
      assetName,
      playOnce,
      playOnce ? () => {
        // 单次播放完成回调
        animationComplete = true;
        checkComplete();
      } : undefined
    );

    if (!success) {
      console.error(`Failed to switch to animation '${assetName}'`);
      animationComplete = true;
      checkComplete();
      return;
    }

    // 循环播放模式不需要等待完成
    if (!playOnce) {
      animationComplete = true;
    }
  }

  // ======================================================================= //
  // 鼠标交互处理
  // ======================================================================= //

  /**
   * 鼠标按下事件处理
   * 记录初始位置，准备检测拖拽或点击
   */
  function handleMouseDown(e: MouseEvent) {
    if (e.button === 0) { // 仅处理左键
      isDragging = false;
      isMouseDown = true;
      mouseDownPos = { x: e.screenX, y: e.screenY };
    }
  }

  /**
   * 鼠标移动事件处理
   * 检测移动距离，超过阈值则启动窗口拖拽
   */
  async function handleMouseMove(e: MouseEvent) {
    if (isMouseDown && !isDragging) {
      const dx = Math.abs(e.screenX - mouseDownPos.x);
      const dy = Math.abs(e.screenY - mouseDownPos.y);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        isDragging = true;
        // 启动 Tauri 窗口拖拽
        await getCurrentWindow().startDragging();
      }
    }
  }

  /**
   * 鼠标抬起事件处理
   * 如果未发生拖拽，则触发点击事件
   */
  function handleMouseUp(e: MouseEvent) {
    if (e.button === 0) { // 仅处理左键
      if (isMouseDown && !isDragging) {
        // 非拖拽的点击，触发 click 事件
        console.log("[handleMouseUp] Click detected, triggering click event");
        triggerManager?.trigger("click");
      }
      isMouseDown = false;
      isDragging = false;
    }
  }

  // ======================================================================= //
  // 生命周期
  // ======================================================================= //

  onMount(() => {
    init();
  });

  onDestroy(() => {
    // 清理资源
    characterAnimator?.destroy();
    borderAnimator?.destroy();
    audioManager?.destroy();
    triggerManager?.destroy();
    unlistenState?.();
    unlistenSettings?.();
  });
</script>

<!-- ======================================================================= -->
<!-- 组件模板 -->
<!-- ======================================================================= -->

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div 
  class="container" 
  on:mousedown={handleMouseDown}
  on:mousemove={handleMouseMove}
  on:mouseup={handleMouseUp}
>
  <!-- 角色动画 Canvas -->
  <canvas 
    class="character-canvas" 
    class:hidden={!showCharacter}
    style="z-index: {characterZOffset};"
    bind:this={characterCanvas}
  ></canvas>
  
  <!-- 边框动画 Canvas -->
  <canvas 
    class="border-canvas" 
    class:hidden={!showCharacter || !showBorder}
    style="z-index: {borderZOffset};"
    bind:this={borderCanvas}
  ></canvas>
</div>

<!-- ======================================================================= -->
<!-- 样式定义 -->
<!-- ======================================================================= -->

<style>
  /* ----------------------------------------------------------------------- */
  /* 全局样式重置 - 透明背景 */
  /* ----------------------------------------------------------------------- */
  
  :global(html), :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background-color: transparent;
    width: 100%;
    height: 100%;
  }
  
  /* ----------------------------------------------------------------------- */
  /* 容器样式 - 支持拖拽 */
  /* ----------------------------------------------------------------------- */
  
  .container {
    position: relative;
    width: 100%;
    height: 100%;
    cursor: grab;
  }
  
  .container:active {
    cursor: grabbing;
  }
  
  /* ----------------------------------------------------------------------- */
  /* 角色动画 Canvas 样式 */
  /* ----------------------------------------------------------------------- */
  
  .character-canvas {
    display: block;
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    height: 80%;
    /* z-index 通过内联样式动态设置，基于 characterZOffset */
  }
  
  /* ----------------------------------------------------------------------- */
  /* 边框动画 Canvas 样式 */
  /* ----------------------------------------------------------------------- */
  
  .border-canvas {
    display: block;
    position: absolute;
    left: 50%;
    top: 85%;
    transform: translate(-50%, -50%);
    width: 100%;
    /* z-index 通过内联样式动态设置，基于 borderZOffset */
  }
  
  /* ----------------------------------------------------------------------- */
  /* 隐藏样式 */
  /* ----------------------------------------------------------------------- */
  
  .hidden {
    visibility: hidden;
  }
</style>
