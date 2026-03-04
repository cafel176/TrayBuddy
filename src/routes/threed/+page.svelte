<!--
========================================================================= 
3D 窗口页面 (+page.svelte)
=========================================================================

使用 Three.js + @pixiv/three-vrm 渲染 VRM/PMX 3D 模型，
通过 WindowCore 集成交互、气泡、音频与 mod_data。
========================================================================= 
-->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { t } from "$lib/i18n";
  import BubbleManager from "$lib/bubble/BubbleManager.svelte";
  import { initRenderTuning } from "$lib/animation/render_tuning";
  import type { ThreeDConfig, ModData, ModType, ModManifest, ModInfo } from "$lib/types/asset";
  import type { Live2DParameterSetting, PngRemixParameterSetting } from "$lib/types/asset";

  import {
    createWindowCore,
    type ModDataToast,
  } from "$lib/animation/WindowCore";
  import { ThreeDPlayer } from "$lib/animation/ThreeDPlayer";

  // =========================================================================
  // DOM 引用
  // =========================================================================

  let threedCanvas: HTMLCanvasElement;
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
  let userNickname = $state(t("common.defaultUserName"));

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

  let threedConfig: ThreeDConfig | null = null;
  let modPath = "";
  let player: ThreeDPlayer | null = null;

  // =========================================================================
  // ThreeD Player 初始化
  // =========================================================================

  async function initThreeDPlayer() {
    try {
      const mod = (await invoke("get_current_mod")) as ModInfo | null;
      console.log("[3D Page] get_current_mod result:", mod ? {
        path: mod.path,
        mod_type: mod.manifest?.mod_type,
        hasThreeD: !!mod.threed,
        animationsCount: mod.threed?.animations?.length,
        statesCount: mod.threed?.states?.length,
      } : null);

      if (!mod || mod.manifest?.mod_type !== "3d" || !mod.threed) {
        console.warn("[3D Page] Skipping init: no 3d mod loaded");
        return;
      }

      modPath = mod.path;
      threedConfig = mod.threed;

      console.log("[3D Page] 3D config loaded:", {
        model: threedConfig.model.name,
        file: threedConfig.model.file,
        animations: threedConfig.animations.length,
        states: threedConfig.states?.length ?? 0,
      });

      // 初始化 ThreeDPlayer 渲染引擎
      player = new ThreeDPlayer(threedCanvas);
      await player.init();
      await player.load(modPath, threedConfig, {
        enable_texture_downsample: mod.manifest?.enable_texture_downsample,
        texture_downsample_start_dim: mod.manifest?.texture_downsample_start_dim,
      });
      player.setAnimationScale(animationScale);

      // 从用户设置中读取 3D 动画过渡时长
      try {
        const settings = await invoke<{ threed_cross_fade_duration?: number }>("get_settings");
        if (settings?.threed_cross_fade_duration != null) {
          player.setTransitionDuration(settings.threed_cross_fade_duration);
        }
      } catch { /* ignore */ }
    } catch (error) {
      console.error("Failed to init 3D player:", error);
    }
  }

  async function playAnimation(
    assetName: string,
    playOnce: boolean,
    onComplete: () => void,
    _live2dParams?: Live2DParameterSetting[],
    _pngremixParams?: PngRemixParameterSetting[],
  ): Promise<boolean> {
    if (!threedConfig || !player) return false;
    return player.playFromAnima(assetName, { playOnce, onComplete });
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
        // 3D 当前不使用边框动画
      },
      setCharacterZOffset: () => {
        // 3D 当前不需要 z-index 偏移
      },
      setBorderZOffset: () => {
        // 3D 当前不需要边框层
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
      getCharacterCanvas: () => threedCanvas,
      getBorderCanvas: () => null,
      getBubbleManager: () => bubbleManager,
    },
    callbacks: {
      playAnimation,
      onAnimationScaleChanged: () => {
        if (player) player.setAnimationScale(animationScale);
      },
      onTransitionDurationChanged: (duration: number) => {
        if (player) player.setTransitionDuration(duration);
      },
      isPixelOpaqueAtWindowPos: (windowX: number, windowY: number) => {
        if (!player) return false;
        return player.isPixelOpaqueAtScreen(windowX, windowY);
      },
      skipBackendCursorIcon: true,
    },
    windowType: "3d",
  });

  // =========================================================================
  // beforeunload 兜底 destroy
  // =========================================================================

  let _destroyed = false;

  function _doDestroy() {
    if (_destroyed) return;
    _destroyed = true;
    if (player) {
      player.destroy();
      player = null;
    }
    core.destroy();
  }

  function _onBeforeUnload() {
    _doDestroy();
  }

  onMount(() => {
    window.addEventListener("beforeunload", _onBeforeUnload);
    console.log("[3D Page] onMount: window.innerWidth:", window.innerWidth, "window.innerHeight:", window.innerHeight);
    const init = async () => {
      // 从 config/render_tuning.json 加载渲染调优参数（在播放器创建前）
      await initRenderTuning();
      await initThreeDPlayer();
      await core.init();
    };

    init().catch((error) => console.error("3D init failed:", error));
  });

  onDestroy(() => {
    window.removeEventListener("beforeunload", _onBeforeUnload);
    _doDestroy();
  });

</script>


<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="container"
  class:debug-border-active={debugBordersEnabled}
  oncontextmenu={core.handleContextMenu}
  style:outline={debugBordersEnabled
    ? '1px dashed ' + debugColors.bubble
    : 'none'}
  style:outline-offset="-1px"
  style:--debug-color-bubble={debugColors.bubble}
>
  <div
    class="bubble-area"
    style:outline={debugBordersEnabled
      ? '1px solid ' + debugColors.bubble
      : 'none'}
    style:outline-offset="-1px"
  >
    <BubbleManager
      bind:this={bubbleManager}
      on:branchSelect={core.handleBranchSelect}
      on:close={core.handleBubbleClose}
      on:show={core.handleBubbleShow}
    />
  </div>

  <div
    class="threed-area"
    style:outline={debugBordersEnabled
      ? '1px solid ' + debugColors.animation
      : 'none'}
    style:outline-offset="-2px"
  >
    <canvas
      class="threed-canvas"
      class:hidden={!showCharacter}
      style:outline={debugBordersEnabled
        ? '2px solid ' + debugColors.character
        : 'none'}
      style:outline-offset="-2px"
      bind:this={threedCanvas}
      onmousedown={(e) => {
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

  .threed-area {
    flex: 1 1 auto;
    position: relative;
    pointer-events: none;
    overflow: hidden;
  }

  .threed-canvas {
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: auto;
    cursor: grab;
  }

  .threed-canvas:active {
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
