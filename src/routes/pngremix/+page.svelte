<!--
========================================================================= 
PngRemix 窗口页面 (+page.svelte)
=========================================================================

当前阶段：使用通用 WindowCore 处理交互、气泡、音频与 mod_data，
PngRemix 渲染层暂为空占位。
========================================================================= 
-->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { t } from "$lib/i18n";
  import BubbleManager from "$lib/bubble/BubbleManager.svelte";
  import type { PngRemixConfig, ModData, ModType, PngRemixParameterSetting } from "$lib/types/asset";
  import type { Live2DParameterSetting } from "$lib/types/asset";

  import {
    createWindowCore,
    type ModDataToast,
  } from "$lib/animation/WindowCore";
  import { PngRemixPlayer } from "$lib/animation/PngRemixPlayer";

  interface ModManifest {
    mod_type?: ModType;
    global_keyboard?: boolean;
    global_mouse?: boolean;
  }

  interface ModInfo {
    path: string;
    manifest: ModManifest;
    pngremix?: PngRemixConfig;
  }

  // =========================================================================
  // DOM 引用
  // =========================================================================

  let pngremixCanvas: HTMLCanvasElement;
  let bubbleManager: BubbleManager;

  // =========================================================================
  // i18n 响应式翻译函数
  // =========================================================================

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
  let silenceMode = $state(false);
  let animationScale = $state(0.4);
  let userNickname = $state(_("common.defaultUserName"));


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

  let pngremixConfig: PngRemixConfig | null = null;
  let modPath = "";
  let player: PngRemixPlayer | null = null;

  // =========================================================================
  // PngRemix Player 初始化
  // =========================================================================

  async function initPngRemixPlayer() {
    try {
      const mod = (await invoke("get_current_mod")) as ModInfo | null;
      console.log("[PngRemix Page] get_current_mod result:", mod ? {
        path: mod.path,
        mod_type: mod.manifest?.mod_type,
        hasPngremix: !!mod.pngremix,
        expressionsCount: mod.pngremix?.expressions?.length,
        motionsCount: mod.pngremix?.motions?.length,
        statesCount: mod.pngremix?.states?.length,
      } : null);

      if (!mod || mod.manifest?.mod_type !== "pngremix" || !mod.pngremix) {
        console.warn("[PngRemix Page] Skipping init: no pngremix mod loaded");
        return;
      }

      modPath = mod.path;
      pngremixConfig = mod.pngremix;

      console.log("[PngRemix Page] PngRemix config loaded:", {
        model: pngremixConfig.model.name,
        file: pngremixConfig.model.pngremix_file,
        expressions: pngremixConfig.expressions.length,
        motions: pngremixConfig.motions.length,
        states: pngremixConfig.states.length,
      });

      // 初始化 PngRemixPlayer 渲染引擎
      player = new PngRemixPlayer(pngremixCanvas);
      await player.init(modPath, pngremixConfig);
      player.setAnimationScale(animationScale);
    } catch (error) {
      console.error("Failed to init PngRemix player:", error);
    }
  }

  async function playAnimation(
    assetName: string,
    playOnce: boolean,
    onComplete: () => void,
    _live2dParams?: Live2DParameterSetting[],
    pngremixParams?: PngRemixParameterSetting[],
  ): Promise<boolean> {
    if (!pngremixConfig || !player) return false;
    return player.playFromAnima(assetName, playOnce, onComplete, pngremixParams);
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
      setModBorderEnabled: () => {
        // PngRemix 当前不使用边框动画
      },
      setCharacterZOffset: () => {
        // PngRemix 当前不需要 z-index 偏移
      },
      setBorderZOffset: () => {
        // PngRemix 当前不需要边框层
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
      getCharacterCanvas: () => pngremixCanvas,
      getBorderCanvas: () => null,
      getBubbleManager: () => bubbleManager,
    },
    callbacks: {
      playAnimation,
      onAnimationScaleChanged: () => {
        if (player) player.setAnimationScale(animationScale);
      },
      // PngRemix：透明像素穿透（使用 PngRemixPlayer 内部的低分辨率 alpha 命中缓冲，避免主画布 getImageData 开销）
      isPixelOpaqueAtWindowPos: (windowX: number, windowY: number) => {
        if (!player) return false;
        return player.isPixelOpaqueAtScreen(windowX, windowY);
      },
      onCursorMove: (localX: number, localY: number) => {
        if (player) player.updateGlobalMouseFollow(localX, localY);
      },
      skipBackendCursorIcon: true,
    },
    windowType: "pngremix",
  });

  onMount(() => {
    console.log("[PngRemix Page] onMount: window.innerWidth:", window.innerWidth, "window.innerHeight:", window.innerHeight);
    const init = async () => {
      await initPngRemixPlayer();
      await core.init();
    };

    init().catch((error) => console.error("PngRemix init failed:", error));
  });

  onDestroy(() => {
    if (player) {
      player.destroy();
      player = null;
    }
    core.destroy();
  });

</script>


<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="container"
  class:debug-border-active={debugBordersEnabled}
  oncontextmenu={core.handleContextMenu}
  style="outline: {debugBordersEnabled
    ? '1px dashed ' + debugColors.bubble
    : 'none'}; outline-offset: -1px; --debug-color-bubble: {debugColors.bubble};"
>
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

  <div
    class="pngremix-area"
    style="outline: {debugBordersEnabled
      ? '1px solid ' + debugColors.animation
      : 'none'}; outline-offset: -2px;"
  >
    <canvas
      class="pngremix-canvas"
      class:hidden={!showCharacter}
      style="outline: {debugBordersEnabled
        ? '2px solid ' + debugColors.character
        : 'none'}; outline-offset: -2px;"
      bind:this={pngremixCanvas}
      onmousedown={(e) => {
        if (player) player.triggerClickBounce();
        core.handleMouseDown(e);
      }}
    ></canvas>

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

    {#if noMod}
      <div class="no-mod-hint">
        {_("common.noModHint")}
      </div>
    {/if}
  </div>
</div>

<style>
  :global(html),
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background-color: transparent;
    width: 100%;
    height: 100%;
  }

  .container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
  }

  .bubble-area {
    flex: 0 0 300px;
    width: 100%;
    align-self: center;
    position: relative;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    pointer-events: none;
    z-index: 100;
  }

  .pngremix-area {
    flex: 1 1 auto;
    position: relative;
    pointer-events: none;
    overflow: hidden;
  }

  .pngremix-canvas {
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: auto;
    cursor: grab;
  }

  .pngremix-canvas:active {
    cursor: grabbing;
  }

  .hidden {
    visibility: hidden;
  }

  .mod-data-hud {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 300;
    pointer-events: none;
  }

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

    letter-spacing: 0.2px;
  }

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

  :global(.debug-border-active .bubble) {
    outline: 2px solid var(--debug-color-bubble, magenta) !important;
    outline-offset: -2px !important;
  }
</style>
