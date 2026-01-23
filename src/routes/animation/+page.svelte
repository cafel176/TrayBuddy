<!--
=========================================================================
动画窗口页面 (+page.svelte)
=========================================================================

功能概述:
- 桌面宠物的主显示窗口，渲染角色动画和边框动画
- 监听后端状态切换事件，同步播放动画和音频
- 支持鼠标拖拽移动窗口位置
- 支持点击触发互动事件

技术架构:
- 使用两层 Canvas 分别渲染角色和边框（支持不同 z-index）
- 通过 Tauri 事件监听后端状态变化
- 使用 SpriteAnimator 播放序列帧动画
- 使用 AudioManager 播放语音

显示控制:
- showCharacter: 控制角色可见性
- showBorder: 控制边框可见性
- 支持实时响应用户设置变更

播放同步:
- 动画和音频并行播放
- 等待两者都完成后通知后端（playOnce 模式）
- 后端收到通知后切换到下一个状态

交互逻辑:
- 鼠标按下+移动超过阈值 → 拖拽窗口
- 鼠标按下+释放无移动 → 触发点击事件
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
  import type { StateInfo, UserSettings } from "$lib/types/asset";

  // =========================================================================
  // DOM 引用
  // =========================================================================

  /** 角色动画 Canvas 元素引用 */
  let characterCanvas: HTMLCanvasElement;
  /** 边框动画 Canvas 元素引用 */
  let borderCanvas: HTMLCanvasElement;
  
  // =========================================================================
  // 核心管理器
  // =========================================================================
  
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

  // =========================================================================
  // 显示状态
  // =========================================================================

  /** 是否显示角色 */
  let showCharacter = true;
  /** 是否显示边框 */
  let showBorder = true;
  /** 角色 Canvas 的 z-index */
  let characterZOffset = 1;
  /** 边框 Canvas 的 z-index */
  let borderZOffset = 2;

  // =========================================================================
  // 播放同步控制
  // =========================================================================

  /** 动画是否播放完成 */
  let animationComplete = false;
  /** 音频是否播放完成 */
  let audioComplete = false;
  /** 当前是否为单次播放模式（临时状态） */
  let isPlayOnce = false;

  // =========================================================================
  // 拖拽检测
  // =========================================================================

  /** 是否正在拖拽 */
  let isDragging = false;
  /** 鼠标是否按下 */
  let isMouseDown = false;
  /** 鼠标按下时的位置 */
  let mouseDownPos = { x: 0, y: 0 };
  /** 判定为拖拽的移动阈值（像素） */
  const DRAG_THRESHOLD = 5;

  // =========================================================================
  // 本地类型定义
  // =========================================================================

  /** 后端发送的状态切换事件结构 */
  interface StateChangeEvent {
    /** 切换到的状态信息 */
    state: StateInfo;
    /** 是否为单次播放模式 */
    play_once: boolean;
  }

  /** 角色渲染配置 */
  interface CharacterConfig {
    /** z-index 偏移值 */
    z_offset: number;
  }

  /** 边框配置 */
  interface BorderConfig {
    /** 边框动画资产名称 */
    anima: string;
    /** 是否启用边框 */
    enable: boolean;
    /** z-index 偏移值 */
    z_offset: number;
  }

  // =========================================================================
  // 初始化
  // =========================================================================

  /**
   * 页面初始化
   *
   * 执行顺序：
   * 1. 加载用户设置（显示/隐藏角色和边框）
   * 2. 初始化管理器（音频、触发器）
   * 3. 加载边框动画（如果启用）
   * 4. 注册状态变化事件监听
   * 5. 播放初始状态动画
   * 6. 触发 login 事件
   */
  async function init() {
    try {
      // 加载用户设置
      const settings: UserSettings = await invoke("get_settings");
      showCharacter = settings.show_character;
      showBorder = settings.show_border;

      // 初始化管理器
      audioManager = await getAudioManager();
      triggerManager = getTriggerManager();

      // 获取角色渲染配置
      const characterConfig: CharacterConfig | null = await invoke("get_character_config");
      if (characterConfig) {
        characterZOffset = characterConfig.z_offset ?? 1;
      }

      // 获取边框配置并初始化边框动画
      const borderConfig: BorderConfig | null = await invoke("get_border_config");
      if (borderConfig && borderConfig.enable && borderConfig.anima) {
        borderZOffset = borderConfig.z_offset ?? 2;
        borderAnimator = new SpriteAnimator(borderCanvas);
        const success = await borderAnimator.loadByAssetName(borderConfig.anima);
        if (success) borderAnimator.play();
      }

      // 注册状态变化事件监听
      unlistenState = await listen<StateChangeEvent>("state-change", async (event) => {
        await playState(event.payload.state, event.payload.play_once);
      });

      // 注册设置变化事件监听
      unlistenSettings = await listen<UserSettings>("settings-change", (event) => {
        showCharacter = event.payload.show_character;
        showBorder = event.payload.show_border;
      });

      // 播放初始持久状态
      const currentState: StateInfo | null = await invoke("get_persistent_state");
      if (currentState) await playState(currentState, false);

      // 触发 login 事件（可能切换到欢迎动画）
      triggerManager?.trigger("login");
    } catch (e) {
      console.error("Failed to init:", e);
    }
  }

  // =========================================================================
  // 状态播放
  // =========================================================================

  /**
   * 播放状态动画和音频
   *
   * @param state - 状态信息
   * @param playOnce - 是否为单次播放模式
   *
   * 播放流程：
   * 1. 重置完成标志
   * 2. 开始播放动画
   * 3. 开始播放音频
   * 4. 等待两者都完成（playOnce 模式）
   * 5. 通知后端动画完成
   */
  async function playState(state: StateInfo, playOnce: boolean) {
    isPlayOnce = playOnce;
    animationComplete = false;
    audioComplete = false;

    // 开始播放动画
    await playAnimation(state.anima, playOnce);

    // 开始播放音频
    if (audioManager && state.audio) {
      audioManager.play(state.audio, () => {
        audioComplete = true;
        checkComplete();
      });
    } else {
      // 无音频，直接标记完成
      audioComplete = true;
      checkComplete();
    }
  }

  /**
   * 检查动画和音频是否都完成
   *
   * 仅在 playOnce 模式下有效：
   * - 两者都完成后通知后端
   * - 后端会切换到 next_state 或 persistent_state
   */
  function checkComplete() {
    if (isPlayOnce && animationComplete && audioComplete) {
      // 使用 setTimeout 避免在回调中直接调用后端
      setTimeout(() => invoke("on_animation_complete"), 0);
    }
  }

  /**
   * 播放动画
   *
   * @param assetName - 动画资产名称
   * @param playOnce - 是否为单次播放
   */
  async function playAnimation(assetName: string, playOnce: boolean) {
    // 无动画资产，直接标记完成
    if (!assetName) {
      animationComplete = true;
      checkComplete();
      return;
    }

    // 懒加载创建动画播放器
    if (!characterAnimator) {
      characterAnimator = new SpriteAnimator(characterCanvas);
    }

    // 切换到新动画
    const success = await characterAnimator.switchToAsset(
      assetName,
      playOnce,
      playOnce ? () => { animationComplete = true; checkComplete(); } : undefined
    );

    // 加载失败，标记完成
    if (!success) {
      animationComplete = true;
      checkComplete();
      return;
    }

    // 循环播放模式下直接标记动画完成（不等待回调）
    if (!playOnce) animationComplete = true;
  }

  // =========================================================================
  // 鼠标交互
  // =========================================================================

  /**
   * 鼠标按下事件处理
   *
   * 记录按下位置，用于后续判断是拖拽还是点击
   */
  function handleMouseDown(e: MouseEvent) {
    if (e.button === 0) {  // 仅处理左键
      isDragging = false;
      isMouseDown = true;
      mouseDownPos = { x: e.screenX, y: e.screenY };
    }
  }

  /**
   * 鼠标移动事件处理
   *
   * 检测移动距离是否超过阈值：
   * - 超过则开始拖拽窗口
   * - 使用 Tauri 的 startDragging API 实现原生拖拽
   */
  async function handleMouseMove(e: MouseEvent) {
    if (isMouseDown && !isDragging) {
      const dx = Math.abs(e.screenX - mouseDownPos.x);
      const dy = Math.abs(e.screenY - mouseDownPos.y);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        isDragging = true;
        await getCurrentWindow().startDragging();
      }
    }
  }

  /**
   * 鼠标释放事件处理
   *
   * 判断是点击还是拖拽结束：
   * - 未移动过阈值 → 触发点击事件
   * - 已开始拖拽 → 拖拽结束，无操作
   */
  function handleMouseUp(e: MouseEvent) {
    if (e.button === 0) {
      if (isMouseDown && !isDragging) {
        // 点击事件：触发 click 触发器
        triggerManager?.trigger("click");
      }
      isMouseDown = false;
      isDragging = false;
    }
  }

  // =========================================================================
  // 生命周期
  // =========================================================================

  // 组件挂载时初始化
  onMount(() => init());

  // 组件销毁时清理资源
  onDestroy(() => {
    characterAnimator?.destroy();
    borderAnimator?.destroy();
    audioManager?.destroy();
    triggerManager?.destroy();
    unlistenState?.();
    unlistenSettings?.();
  });
</script>

<!-- =========================================================================
     模板区域
     =========================================================================
     
     布局说明:
     - 外层 container 占满整个窗口
     - 两个 Canvas 使用绝对定位叠加
     - 角色 Canvas 居中显示
     - 边框 Canvas 位于底部居中
     
     显示控制:
     - hidden 类控制可见性（visibility: hidden 保持占位）
     - z-index 通过内联 style 动态设置
     
     交互:
     - 整个 container 响应鼠标事件
     - 使用 grab/grabbing 光标提示可拖拽
========================================================================= -->
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

<!-- =========================================================================
     样式区域
     =========================================================================
     
     关键样式说明:
     - 透明背景：实现窗口透明效果
     - 绝对定位：Canvas 叠加显示
     - transform 居中：响应式居中定位
     - grab 光标：提示用户可拖拽
========================================================================= -->
<style>
  /* 全局样式重置 - 透明背景实现窗口穿透 */
  :global(html), :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background-color: transparent;  /* 透明背景 */
    width: 100%;
    height: 100%;
  }
  
  /* 主容器 - 占满窗口 */
  .container {
    position: relative;
    width: 100%;
    height: 100%;
    cursor: grab;  /* 提示可拖拽 */
  }
  
  /* 拖拽中的光标 */
  .container:active {
    cursor: grabbing;
  }
  
  /* 角色 Canvas - 居中显示 */
  .character-canvas {
    display: block;
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);  /* 完美居中 */
    height: 80%;  /* 高度占窗口 80% */
  }
  
  /* 边框 Canvas - 底部居中 */
  .border-canvas {
    display: block;
    position: absolute;
    left: 50%;
    top: 85%;  /* 位于窗口底部 */
    transform: translate(-50%, -50%);
    width: 100%;  /* 宽度占满 */
  }
  
  /* 隐藏状态 - 使用 visibility 保持占位 */
  .hidden {
    visibility: hidden;
  }
</style>
