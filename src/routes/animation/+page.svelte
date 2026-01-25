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
  import { t, initI18n, destroyI18n, onLangChange } from "$lib/i18n";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, emit } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import {
    SpriteAnimator,
    getMemoryLogs,
    exportMemoryLogsCSV,
    getCacheStats,
    initMemoryDebug,
  } from "$lib/animation/SpriteAnimator";
  import { getAudioManager, type AudioManager } from "$lib/audio/AudioManager";
  import {
    getTriggerManager,
    type TriggerManager,
  } from "$lib/trigger/TriggerManager";
  import type {
    StateInfo,
    StateChangeEvent,
    BranchInfo,
    CharacterConfig,
    BorderConfig,
    UserSettings,
  } from "$lib/types/asset";
  import BubbleManager, {
    type BubbleConfig,
  } from "$lib/bubble/BubbleManager.svelte";
  import { CURSOR_POLL_INTERVAL_MS } from "$lib/constants";

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

  /** 气泡管理器 */
  let bubbleManager: BubbleManager;

  /** 状态变化事件监听器取消函数 */
  let unlistenState: (() => void) | null = null;
  /** 设置变化事件监听器取消函数 */
  let unlistenSettings: (() => void) | null = null;
  /** 播放状态请求事件监听器取消函数 */
  let unlistenPlaybackReq: (() => void) | null = null;
  /** i18n 响应式翻译函数 - 使用版本号触发更新 */
  let _langVersion = $state(0);
  let unsubLang: (() => void) | null = null;

  /** 响应式翻译函数 */
  function _(key: string, params?: Record<string, string | number>): string {
    // 依赖 _langVersion 使 Svelte 能追踪变化
    void _langVersion;
    return t(key, params);
  }

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
  /** 气泡是否显示完成（关闭或无气泡） */
  let bubbleComplete = false;
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
      // 默认启用窗口级鼠标穿透
      await setClickThrough(true);
      // 启动鼠标位置轮询
      startCursorPolling();

      // 注册语言变更监听
      unsubLang = onLangChange(() => {
        _langVersion++;
        getCurrentWindow().setTitle(_("common.animationTitle"));
      });
      await initI18n();
      _langVersion++;
      getCurrentWindow().setTitle(_("common.animationTitle"));

      // 加载用户设置
      const settings: UserSettings = await invoke("get_settings");
      showCharacter = settings.show_character;
      showBorder = settings.show_border;

      // 初始化管理器
      audioManager = await getAudioManager();
      triggerManager = getTriggerManager();

      // 初始化内存调试模式（仅检测工具启动时生效）
      const memoryDebugEnabled = await initMemoryDebug();
      if (memoryDebugEnabled) {
        // 仅在调试模式下暴露内存日志函数到全局 window 对象
        // @ts-expect-error - 挂载调试函数到 window
        window.__getMemoryLogs = getMemoryLogs;
        // @ts-expect-error - 挂载调试函数到 window
        window.__exportMemoryLogsCSV = exportMemoryLogsCSV;
        // @ts-expect-error - 挂载调试函数到 window
        window.__getCacheStats = getCacheStats;
      }

      // 获取角色渲染配置
      const characterConfig: CharacterConfig | null = await invoke(
        "get_character_config",
      );
      if (characterConfig) {
        characterZOffset = characterConfig.z_offset ?? 1;
      }

      // 获取边框配置并初始化边框动画
      const borderConfig: BorderConfig | null =
        await invoke("get_border_config");
      if (borderConfig && borderConfig.enable && borderConfig.anima) {
        borderZOffset = borderConfig.z_offset ?? 2;
        borderAnimator = new SpriteAnimator(borderCanvas);
        const success = await borderAnimator.loadByAssetName(
          borderConfig.anima,
        );
        if (success) borderAnimator.play();
      }

      // 注册状态变化事件监听
      unlistenState = await listen<StateChangeEvent>(
        "state-change",
        async (event) => {
          await playState(event.payload.state, event.payload.play_once);
        },
      );

      // 注册设置变化事件监听
      unlistenSettings = await listen<UserSettings>(
        "settings-change",
        (event) => {
          showCharacter = event.payload.show_character;
          showBorder = event.payload.show_border;
        },
      );

      // 注册播放状态请求事件监听
      unlistenPlaybackReq = await listen("request-playback-status", () => {
        emitPlaybackStatus();
      });

      // 播放初始持久状态
      const currentState: StateInfo | null = await invoke(
        "get_persistent_state",
      );
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
    bubbleComplete = false;

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

    // 显示气泡 (如果有文本或分支)
    if (state.text || (state.branch && state.branch.length > 0)) {
      await showBubble(state);
    } else {
      // 无气泡，直接标记完成
      bubbleComplete = true;
      checkComplete();
    }
  }

  /**
   * 显示气泡
   * @param state 状态信息
   */
  async function showBubble(state: StateInfo) {
    try {
      // 获取文本内容
      let textContent = "";
      let textDuration = 0; // 默认0表示使用自动计算
      if (state.text) {
        const settings = await invoke<{ lang: string }>("get_settings");
        const textInfo = await invoke<{
          text: string;
          duration?: number;
        } | null>("get_text_by_name", {
          lang: settings.lang || "zh",
          name: state.text,
        });
        if (textInfo) {
          textContent = textInfo.text;
          // 使用配置的duration（秒），转换为毫秒，如果未配置则默认10秒
          textDuration = (textInfo.duration ?? 10) * 1000;
        }
      }

      // 构建气泡配置
      const bubbleConfig: BubbleConfig = {
        text: textContent,
        branches: state.branch || [],
        position: "top",
        typeSpeed: 50,
        duration: textDuration,
      };

      // 显示气泡
      bubbleManager?.show(bubbleConfig);
    } catch (e) {
      console.error("[showBubble] Failed to show bubble:", e);
    }
  }

  /**
   * 处理分支选择
   * @param branch 选择的分支
   */
  async function handleBranchSelect(e: CustomEvent<BranchInfo>) {
    const branch = e.detail;
    console.log(
      "[handleBranchSelect] Selected branch:",
      branch.text,
      "-> next_state:",
      branch.next_state,
    );

    try {
      // 设置下一个待切换状态（当前状态播放完毕后自动切换）
      await invoke("set_next_state", { name: branch.next_state });
      // 通知调试面板 next_state 已更新
      emit("next-state-changed", { name: branch.next_state });
    } catch (error) {
      console.error("[handleBranchSelect] Failed to set next state:", error);
    }
  }

  /**
   * 检查动画、音频和气泡是否都完成
   *
   * 仅在 playOnce 模式下有效：
   * - 三者都完成后通知后端
   * - 后端会切换到 next_state 或 persistent_state
   */
  function checkComplete() {
    // 发送调试事件
    emitPlaybackStatus();

    if (isPlayOnce && animationComplete && audioComplete && bubbleComplete) {
      // 使用 setTimeout 避免在回调中直接调用后端
      setTimeout(() => invoke("on_animation_complete"), 0);
    }
  }

  /**
   * 发送播放状态到调试面板
   */
  function emitPlaybackStatus() {
    emit("playback-status", {
      animationComplete,
      audioComplete,
      bubbleComplete,
      isPlayOnce,
    });
  }

  /**
   * 处理气泡关闭事件
   */
  function handleBubbleClose() {
    isBubbleVisible = false;
    bubbleComplete = true;
    checkComplete();
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
      playOnce
        ? () => {
            animationComplete = true;
            checkComplete();
          }
        : undefined,
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
  // 鼠标交互 & 窗口级穿透
  // =========================================================================

  /** 气泡是否显示中 */
  let isBubbleVisible = false;

  /** 当前穿透状态 */
  let isClickThrough = true;

  /** 鼠标位置轮询定时器 */
  let cursorPollTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * 设置窗口穿透状态
   */
  async function setClickThrough(ignore: boolean) {
    if (isClickThrough === ignore) return;
    try {
      await invoke("set_ignore_cursor_events", { ignore });
      isClickThrough = ignore;
    } catch (e) {
      console.error("[setClickThrough] Failed:", e);
    }
  }

  /**
   * 获取气泡的实际边界（相对于窗口）
   * @returns 气泡边界 { left, top, right, bottom } 或 null
   */
  function getBubbleBounds(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null {
    if (!isBubbleVisible) return null;

    // 查找气泡 wrapper 元素
    const bubbleEl = document.querySelector(".bubble-wrapper");
    if (!bubbleEl) return null;

    const rect = bubbleEl.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    };
  }

  /**
   * 启动鼠标位置轮询
   * 定期检查鼠标是否在交互区域内：
   * - 角色 Canvas 区域（始终需要交互）
   * - 气泡实际区域（仅当气泡显示时，检测气泡的实际边界）
   */
  function startCursorPolling() {
    stopCursorPolling();
    cursorPollTimer = setInterval(async () => {
      try {
        // 获取气泡实际边界
        const bubbleBounds = getBubbleBounds();

        // 检查鼠标是否在交互区域内
        const inInteractArea = await invoke<boolean>(
          "is_cursor_in_interact_area",
          {
            bubbleBounds: bubbleBounds,
          },
        );
        // 鼠标在交互区域内时禁用穿透，否则启用穿透
        await setClickThrough(!inInteractArea);
      } catch (e) {
        // 出错时保持当前状态
      }
    }, CURSOR_POLL_INTERVAL_MS);
  }

  /**
   * 停止鼠标位置轮询
   */
  function stopCursorPolling() {
    if (cursorPollTimer) {
      clearInterval(cursorPollTimer);
      cursorPollTimer = null;
    }
  }

  /**
   * 气泡显示事件处理
   */
  function handleBubbleShow() {
    isBubbleVisible = true;
    // 开始轮询
    startCursorPolling();
  }

  /**
   * 鼠标按下事件处理
   *
   * 记录按下位置，用于后续判断是拖拽还是点击
   */
  function handleMouseDown(e: MouseEvent) {
    if (e.button === 0) {
      // 仅处理左键
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
    stopCursorPolling();
    characterAnimator?.destroy();
    borderAnimator?.destroy();
    audioManager?.destroy();
    triggerManager?.destroy();
    unlistenState?.();
    unlistenSettings?.();
    unlistenPlaybackReq?.();
    unsubLang?.();
    destroyI18n();
  });
</script>

<!-- =========================================================================
     模板区域
     =========================================================================
     
     布局说明:
     - 外层 container 占满整个窗口（500x700）
     - 上方为气泡区域（高度 200px）
     - 下方为动画区域（高度 500px，包含角色和边框 Canvas）
     - 两个 Canvas 使用绝对定位叠加在动画区域内
     
     显示控制:
     - hidden 类控制可见性（visibility: hidden 保持占位）
     - z-index 通过内联 style 动态设置
     
     交互:
     - 动画区域响应鼠标事件
     - 使用 grab/grabbing 光标提示可拖拽
========================================================================= -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="container">
  <!-- 气泡区域 - 位于顶部 -->
  <div class="bubble-area">
    <BubbleManager
      bind:this={bubbleManager}
      on:branchSelect={handleBranchSelect}
      on:close={handleBubbleClose}
      on:show={handleBubbleShow}
    />
  </div>

  <!-- 动画区域 - 位于底部 -->
  <div class="animation-area">
    <!-- 角色动画 Canvas -->
    <canvas
      class="character-canvas"
      class:hidden={!showCharacter}
      style="z-index: {characterZOffset};"
      bind:this={characterCanvas}
      on:mousedown={handleMouseDown}
      on:mousemove={handleMouseMove}
      on:mouseup={handleMouseUp}
    ></canvas>

    <!-- 边框动画 Canvas -->
    <canvas
      class="border-canvas"
      class:hidden={!showCharacter || !showBorder}
      style="z-index: {borderZOffset};"
      bind:this={borderCanvas}
    ></canvas>
  </div>
</div>

<!-- =========================================================================
     样式区域
     =========================================================================
     
     关键样式说明:
     - 透明背景：实现窗口透明效果
     - 容器使用 flex 布局：上方气泡区域(固定600px) + 下方动画区域(占用剩余空间)
     - 气泡区域固定高度，不随animation_scale缩放
     - 动画区域随animation_scale缩放
     - grab 光标：提示用户可拖拽
========================================================================= -->
<style>
  /* 全局样式重置 - 透明背景实现窗口穿透 */
  :global(html),
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background-color: transparent; /* 透明背景 */
    width: 100%;
    height: 100%;
  }

  /* 主容器 - 使用 flex 布局分为上下两部分 */
  .container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
  }

  /* ----------------------------------------------------------------------- */
  /* 气泡区域 - 位于顶部，固定尺寸（不随缩放变化） */
  /* ----------------------------------------------------------------------- */

  .bubble-area {
    flex: 0 0 300px; /* 固定高度 300px */
    width: 500px; /* 固定宽度 500px */
    min-width: 500px;
    align-self: center; /* 水平居中 */
    position: relative;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    pointer-events: none; /* CSS 层面穿透（窗口级穿透由后端控制） */
    z-index: 100; /* 气泡层级高于 Canvas */
  }

  /* ----------------------------------------------------------------------- */
  /* 动画区域 - 位于底部，占用剩余空间（随缩放变化） */
  /* ----------------------------------------------------------------------- */

  .animation-area {
    flex: 1 1 auto; /* 占用剩余空间 */
    position: relative;
    pointer-events: none; /* 区域本身鼠标穿透 */
  }

  /* 角色 Canvas - 居中显示 */
  .character-canvas {
    display: block;
    position: absolute;
    left: 50%;
    top: 45%;
    transform: translate(-50%, -50%); /* 完美居中 */
    height: 80%; /* 高度占动画区域 80% */
    pointer-events: auto; /* Canvas 接收鼠标事件 */
    cursor: grab; /* 提示可拖拽 */
  }

  .character-canvas:active {
    cursor: grabbing;
  }

  /* 边框 Canvas - 底部居中 */
  .border-canvas {
    display: block;
    position: absolute;
    left: 50%;
    top: 80%; /* 位于动画区域底部 */
    transform: translate(-50%, -50%);
    height: 35%; /* 宽度占满 */
    pointer-events: none; /* 边框不接收鼠标事件 */
  }

  /* 隐藏状态 - 使用 visibility 保持占位 */
  .hidden {
    visibility: hidden;
  }
</style>
