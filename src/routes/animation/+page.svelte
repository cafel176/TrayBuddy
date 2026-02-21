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
  import { onMount, onDestroy, tick } from "svelte";
  import { t } from "$lib/i18n";
  import BubbleManager from "$lib/bubble/BubbleManager.svelte";
  import {
    SpriteAnimator,
    type CanvasFitPreference,
    getMemoryLogs,
    exportMemoryLogsCSV,
    getCacheStats,
    initMemoryDebug,
    clearImageCache,
  } from "$lib/animation/SpriteAnimator";
  import type { BorderConfig, CharacterConfig, ModData } from "$lib/types/asset";
  import {
    createWindowCore,
    type ModDataToast,
  } from "$lib/animation/WindowCore";

  // =========================================================================
  // DOM 引用
  // =========================================================================

  /** 角色动画 Canvas 元素引用 */
  let characterCanvas: HTMLCanvasElement;
  /** 边框动画 Canvas 元素引用（仅在 Mod 启用 border 时挂载） */
  let borderCanvas = $state<HTMLCanvasElement | null>(null);

  // =========================================================================
  // 序列帧播放层（SequencePlayer）
  // =========================================================================

  /** 角色动画播放器 */
  let characterAnimator: SpriteAnimator | null = null;
  /** 边框动画播放器 */
  let borderAnimator: SpriteAnimator | null = null;

  /** 气泡管理器 */
  let bubbleManager: BubbleManager;

  /** i18n 响应式翻译函数 - 使用版本号触发更新 */
  let _langVersion = $state(0);
  function _(key: string, params?: Record<string, string | number>): string {
    void _langVersion;
    return t(key, params);
  }

  // =========================================================================
  // 显示状态（由通用核心驱动）
  // =========================================================================

  let showCharacter = $state(true);
  let showBorder = $state(true);
  let modBorderEnabled = $state(false);
  let characterZOffset = $state(1);
  let borderZOffset = $state(2);
  let silenceMode = $state(false);
  let animationScale = $state(0.4);
  let userNickname = $state("User");

  let showModDataPanel = $state(false);
  let currentModData = $state<ModData | null>(null);
  let lastModDataValue = $state<number | null>(null);
  let modDataToasts = $state<ModDataToast[]>([]);
  let modDataToastSeq = $state(0);

  let noMod = $state(false);

  let debugBordersEnabled = $state(false);
  let debugColors = $state({
    bubble: "transparent",
    animation: "transparent",
    character: "transparent",
    border: "transparent",
  });

  // =========================================================================
  // Character Canvas 显示适配（序列帧专用）
  // =========================================================================

  const CHARACTER_CANVAS_FIT_SCALE_WITH_BORDER = 0.8;
  const CHARACTER_CANVAS_FIT_SCALE_NO_BORDER = 1.0;

  let characterCanvasFitPreference = $state<CanvasFitPreference>("short");

  function applyCharacterCanvasFit() {
    if (!characterCanvas || !characterAnimator) return;

    const scale = modBorderEnabled
      ? CHARACTER_CANVAS_FIT_SCALE_WITH_BORDER
      : CHARACTER_CANVAS_FIT_SCALE_NO_BORDER;

    characterAnimator.setCanvasFit(characterCanvasFitPreference, {
      container: characterCanvas.parentElement as HTMLElement | null,
      scale,
    });
  }

  async function playAnimation(
    assetName: string,
    playOnce: boolean,
    onComplete: () => void,
    _live2dParams?: unknown,
    _pngremixParams?: unknown,
  ): Promise<boolean> {
    if (!assetName) return false;

    if (!characterAnimator) {
      characterAnimator = new SpriteAnimator(characterCanvas);
    }

    const success = await characterAnimator.switchToAsset(
      assetName,
      playOnce,
      playOnce ? onComplete : undefined,
    );

    if (success) {
      applyCharacterCanvasFit();
    }

    return success;
  }

  async function handleBorderConfig(borderConfig: BorderConfig | null) {
    if (!borderConfig || !borderConfig.enable || !borderConfig.anima) return;
    if (!showBorder || borderAnimator) return;

    await tick();

    const borderAnima = borderConfig.anima;
    if (borderCanvas && borderAnima) {
      borderAnimator = new SpriteAnimator(borderCanvas);
      const success = await borderAnimator.loadByAssetName(borderAnima);
      if (success) borderAnimator.play();
    }
  }

  function handleCharacterConfig(config: CharacterConfig | null) {
    if (!config) return;
    const pref = config.canvas_fit_preference;
    if (pref === "long" || pref === "short" || pref === "legacy") {
      characterCanvasFitPreference = pref;
    }
  }

  const core = createWindowCore({
    bindings: {
      setLangVersion: (value) => {
        _langVersion = value;
      },
      getShowCharacter: () => showCharacter,
      setShowCharacter: (value) => {
        showCharacter = value;
      },
      getShowBorder: () => showBorder,
      setShowBorder: (value) => {
        showBorder = value;
      },
      setModBorderEnabled: (value) => {
        modBorderEnabled = value;
      },
      setCharacterZOffset: (value) => {
        characterZOffset = value;
      },
      setBorderZOffset: (value) => {
        borderZOffset = value;
      },
      getSilenceMode: () => silenceMode,
      setSilenceMode: (value) => {
        silenceMode = value;
      },
      getAnimationScale: () => animationScale,
      setAnimationScale: (value) => {
        animationScale = value;
      },
      getUserNickname: () => userNickname,
      setUserNickname: (value) => {
        userNickname = value;
      },
      setNoMod: (value) => {
        noMod = value;
      },
      getShowModDataPanel: () => showModDataPanel,
      setShowModDataPanel: (value) => {
        showModDataPanel = value;
      },
      getCurrentModData: () => currentModData,
      setCurrentModData: (value) => {
        currentModData = value;
      },
      getLastModDataValue: () => lastModDataValue,
      setLastModDataValue: (value) => {
        lastModDataValue = value;
      },
      getModDataToasts: () => modDataToasts,
      setModDataToasts: (value) => {
        modDataToasts = value;
      },
      getModDataToastSeq: () => modDataToastSeq,
      setModDataToastSeq: (value) => {
        modDataToastSeq = value;
      },
      getDebugBordersEnabled: () => debugBordersEnabled,
      setDebugBordersEnabled: (value) => {
        debugBordersEnabled = value;
      },
      setDebugColors: (value) => {
        debugColors = value;
      },
    },
    refs: {
      getCharacterCanvas: () => characterCanvas,
      getBorderCanvas: () => borderCanvas,
      getBubbleManager: () => bubbleManager,
    },
    callbacks: {
      playAnimation,
      onAnimationScaleChanged: () => applyCharacterCanvasFit(),
      onBorderConfigLoaded: handleBorderConfig,
      getBorderPlayerReady: () => Boolean(borderAnimator),
      onCharacterConfigLoaded: handleCharacterConfig,
    },
    windowType: "sequence",
  });

  async function initSequenceMemoryDebug() {
    const memoryDebugEnabled = await initMemoryDebug();
    if (memoryDebugEnabled) {
      // @ts-expect-error - 挂载调试函数到 window
      window.__getMemoryLogs = getMemoryLogs;
      // @ts-expect-error - 挂载调试函数到 window
      window.__exportMemoryLogsCSV = exportMemoryLogsCSV;
      // @ts-expect-error - 挂载调试函数到 window
      window.__getCacheStats = getCacheStats;
    }
  }

  onMount(() => {
    void initSequenceMemoryDebug();
    void core.init();
  });

  onDestroy(() => {
    core.destroy();
    characterAnimator?.destroy();
    borderAnimator?.destroy();
    clearImageCache();
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
=========================================================================
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="container"
  class:debug-border-active={debugBordersEnabled}
  class:no-border={!modBorderEnabled}
  oncontextmenu={core.handleContextMenu}
  style="outline: {debugBordersEnabled
    ? '1px dashed ' + debugColors.bubble
    : 'none'}; outline-offset: -1px; --debug-color-bubble: {debugColors.bubble};"
>
  <!-- 气泡区域 - 位于顶部 -->
  <div
    class="bubble-area"
    style="outline: {debugBordersEnabled
      ? '1px solid ' + debugColors.bubble
      : 'none'}; outline-offset: -1px;"
  >
    <BubbleManager
      bind:this={bubbleManager}
      on:branchSelect={core.handleBranchSelect}
      on:close={core.handleBubbleClose}
      on:show={core.handleBubbleShow}
    />
  </div>

  <!-- 动画区域 - 位于底部 -->
  <div
    class="animation-area"
    style="height: {showCharacter
      ? 500 * animationScale + 'px'
      : '0px'}; flex: 0 0 {showCharacter
      ? 500 * animationScale + 'px'
      : '0px'}; overflow: hidden; outline: {debugBordersEnabled
      ? '1px solid ' + debugColors.animation
      : 'none'}; outline-offset: -2px;"
  >
    <!-- 角色动画 Canvas -->
    <canvas
      class="character-canvas"
      class:hidden={!showCharacter}
      style="z-index: {characterZOffset}; outline: {debugBordersEnabled
        ? '2px solid ' + debugColors.character
        : 'none'}; outline-offset: -2px;"
      bind:this={characterCanvas}
      onmousedown={core.handleMouseDown}
    ></canvas>

    <!-- 边框动画 Canvas（仅在 Mod 启用 border 时挂载） -->
    {#if modBorderEnabled}
      <canvas
        class="border-canvas"
        class:hidden={!showCharacter || !showBorder}
        style="z-index: {borderZOffset}; outline: {debugBordersEnabled
          ? '2px solid ' + debugColors.border
          : 'none'}; outline-offset: -2px;"
        bind:this={borderCanvas}
      ></canvas>
    {/if}




    <!-- 当前 Mod 数据（左上角，仅数值 + 变化上漂提示） -->
    {#if showModDataPanel}
      <div class="mod-data-hud" aria-label={_("animation.modDataValueAria")}>

        <div class="mod-data-panel">
          {currentModData?.value ?? "-"}
        </div>

        <div class="mod-data-toast-layer" aria-hidden="true">
          {#each modDataToasts as toast, i (toast.id)}
            <div
              class="mod-data-toast {toast.delta > 0 ? 'pos' : 'neg'}"
              style="--toast-offset: {i};"
            >
              {toast.delta > 0 ? `+${toast.delta}` : `${toast.delta}`}
            </div>
          {/each}
        </div>
      </div>
    {/if}



    <!-- 空 Mod 提示 -->
    {#if noMod}
      <div class="no-mod-hint">
        {_("common.noModHint")}
      </div>
    {/if}
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
=========================================================================
-->
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

  /* Mod 数据 HUD（动画区左上角） */
  .mod-data-hud {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 300;
    pointer-events: none;
  }

  /* Mod 数据面板（仅显示数值） */
  .mod-data-panel {
    display: inline-flex;
    align-items: center;
    justify-content: center;

    padding: 4px 6px;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.35);
    color: rgba(255, 255, 255, 0.92);

    font-size: 12px;
    line-height: 1;
    font-weight: 600;
    font-variant-numeric: tabular-nums;

    backdrop-filter: blur(4px);
    border: 1px solid rgba(255, 255, 255, 0.18);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);

    /* 轻微字距，数字更清晰 */
    letter-spacing: 0.2px;
  }

  /* 数值变化提示：上漂并渐隐 */
  .mod-data-toast-layer {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 0;
  }

  .mod-data-toast {
    position: absolute;
    left: 50%;
    top: calc(-2px - var(--toast-offset, 0) * 10px);
    transform: translate(-50%, 0);

    font-size: 11px;
    line-height: 1;
    font-weight: 600;
    font-variant-numeric: tabular-nums;

    padding: 2px 4px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.22);
    border: 1px solid rgba(255, 255, 255, 0.12);

    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);

    opacity: 0;
    animation: mod-data-float 1.35s ease-out forwards;
  }

  .mod-data-toast.pos {
    color: rgba(120, 255, 170, 0.98);
  }

  .mod-data-toast.neg {
    color: rgba(255, 140, 140, 0.98);
  }

  @keyframes mod-data-float {
    0% {
      opacity: 0;
      transform: translate(-50%, 2px);
    }
    12% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -22px);
    }
  }



  /* 角色 Canvas - 居中显示 */
  .character-canvas {
    display: block;
    position: absolute;
    left: 50%;
    top: 45%;
    transform: translate(-50%, -50%); /* 完美居中 */
    /* 由 JS 动态设置 style.width/style.height 以控制长边/短边适配 */
    pointer-events: auto; /* Canvas 接收鼠标事件 */
    cursor: grab; /* 提示可拖拽 */
  }

  /* 当 Mod 未启用 border 时，让角色在动画区域更居中、可占用更多高度 */
  .no-border .character-canvas {
    top: 50%;
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

  /* 空 Mod 提示样式 */
  .no-mod-hint {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 12px 20px;
    border-radius: 12px;
    font-size: 14px;
    text-align: center;
    max-width: 280px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 200;
    pointer-events: auto;
    border: 1px solid rgba(255, 255, 255, 0.2);
    backdrop-filter: blur(4px);
    line-height: 1.5;
  }

  /* ----------------------------------------------------------------------- */
  /* 动态布局调试辅助样式 (Global) */
  /* ----------------------------------------------------------------------- */
  :global(.debug-border-active .bubble) {
    outline: 2px solid var(--debug-color-bubble, magenta) !important;
    outline-offset: -2px !important;
  }
</style>
