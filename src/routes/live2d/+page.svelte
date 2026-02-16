<!--
========================================================================= 
Live2D 窗口页面 (+page.svelte)
=========================================================================

当前阶段：使用通用 WindowCore 处理交互、气泡、音频与 mod_data，
Live2D 渲染层暂为空占位。
========================================================================= 
-->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { t } from "$lib/i18n";
  import BubbleManager from "$lib/bubble/BubbleManager.svelte";
  import type { Live2DConfig, Live2DParameterSetting, ModData, ModType, UserSettings } from "$lib/types/asset";

  import {
    createWindowCore,
    type ModDataToast,
  } from "$lib/animation/WindowCore";
  import {
    Live2DPlayer,
    type Live2DFeatureFlags,
  } from "$lib/animation/Live2DPlayer";

  interface ModManifest {
    mod_type?: ModType;
    global_keyboard?: boolean;
    global_mouse?: boolean;
  }

  interface ModInfo {
    path: string;
    manifest: ModManifest;
    live2d?: Live2DConfig;
  }

  let userSettings = $state<UserSettings | null>(null);

  function buildFeatureFlags(settings: UserSettings | null): Live2DFeatureFlags {
    return {
      mouseFollow: settings?.live2d_mouse_follow ?? true,
      autoInteract: settings?.live2d_auto_interact ?? true,
    };
  }

  function syncFeatureFlags(settings: UserSettings | null) {
    featureFlags = buildFeatureFlags(settings);
    live2dPlayer?.setFeatureFlags(featureFlags);
  }

  async function loadUserSettings() {
    try {
      const settings = (await invoke("get_settings")) as UserSettings;
      userSettings = settings;
      syncFeatureFlags(settings);
    } catch (error) {
      console.error("Failed to load Live2D settings:", error);
    }
  }

  async function updateUserSettings(next: Partial<UserSettings>) {
    if (!userSettings) return;
    const updated = { ...userSettings, ...next } as UserSettings;
    userSettings = updated;
    try {
      await invoke("update_settings", { settings: updated });
    } catch (error) {
      console.error("Failed to update Live2D settings:", error);
    }
  }


  // =========================================================================
  // DOM 引用
  // =========================================================================

  let live2dCanvas: HTMLCanvasElement;
  let bubbleManager: BubbleManager;

  // =========================================================================
  // i18n 响应式翻译函数 - 使用版本号触发更新
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

  // Debug 视角 HUD
  let debugHud = $state({ scale: 1, offsetX: 0, offsetY: 0, baseFitScale: 0, finalScale: 0 });

  let featureFlags = $state<Live2DFeatureFlags>({
    mouseFollow: true,
    autoInteract: true,
  });


  let live2dPlayer: Live2DPlayer | null = null;
  let live2dConfig: Live2DConfig | null = null;
  let modPath = "";
  let unbindFeatureHotkeys: (() => void) | null = null;
  let unbindOverlayKeyListeners: (() => void) | null = null;
  let unlistenSettings: UnlistenFn | null = null;
  let unlistenKeyState: UnlistenFn | null = null;
  let unlistenMouseState: UnlistenFn | null = null;
  let globalKeyboardEnabled = false;
  let globalMouseEnabled = false;


  // =========================================================================
  // 叠加层事件驱动（按键/鼠标 → background_layers 显示/隐藏）
  // =========================================================================

  /**
   * 绑定本地键盘事件到叠加层（非 global_keyboard 模式时使用）。
   * global_keyboard 模式下由后端 global-key-state 事件驱动。
   */
  function bindOverlayKeyListeners() {
    const onKeyDown = (e: KeyboardEvent) => {
      if (globalKeyboardEnabled) return; // 后端已处理
      live2dPlayer?.setBackgroundLayersByEvent(`keydown:${e.code}`, true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (globalKeyboardEnabled) return;
      live2dPlayer?.setBackgroundLayersByEvent(`keydown:${e.code}`, false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    unbindOverlayKeyListeners = () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }

  /**
   * 监听后端 global-key-state 事件（全局键盘按下/松开），驱动叠加层。
   */
  async function listenGlobalKeyState() {
    unlistenKeyState = await listen<{ code: string; pressed: boolean }>(
      "global-key-state",
      (event) => {
        const { code, pressed } = event.payload;
        live2dPlayer?.setBackgroundLayersByEvent(`keydown:${code}`, pressed);
      },
    );
  }

  /**
   * 监听后端 global-mouse-state 事件（全局鼠标按下/松开），驱动叠加层。
   */
  async function listenGlobalMouseState() {
    unlistenMouseState = await listen<{ button: string; pressed: boolean }>(
      "global-mouse-state",
      (event) => {
        const { button, pressed } = event.payload;
        // button 为 "global_click" / "global_right_click"
        live2dPlayer?.setBackgroundLayersByEvent(button, pressed);
      },
    );
  }


  function bindFeatureHotkeys() {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey) return;

      if (e.code === "KeyM") {
        e.preventDefault();
        featureFlags = {
          ...featureFlags,
          mouseFollow: !featureFlags.mouseFollow,
        };
        live2dPlayer?.setFeatureFlags(featureFlags);
        void updateUserSettings({
          live2d_mouse_follow: featureFlags.mouseFollow,
        });
        console.info("Live2D mouseFollow:", featureFlags.mouseFollow);
      }

      if (e.code === "KeyI") {
        e.preventDefault();
        featureFlags = {
          ...featureFlags,
          autoInteract: !featureFlags.autoInteract,
        };
        live2dPlayer?.setFeatureFlags(featureFlags);
        void updateUserSettings({
          live2d_auto_interact: featureFlags.autoInteract,
        });
        console.info("Live2D autoInteract:", featureFlags.autoInteract);
      }
    };

    window.addEventListener("keydown", handler);
    unbindFeatureHotkeys = () => window.removeEventListener("keydown", handler);
  }

  // =========================================================================
  // Debug 视角控制
  // =========================================================================

  let unbindDebugControls: (() => void) | null = null;

  function refreshDebugHud() {
    if (live2dPlayer && debugBordersEnabled) {
      debugHud = live2dPlayer.getDebugInfo();
    }
  }

  function bindDebugControls() {
    unbindDebugControls?.();

    const ZOOM_STEP = 0.1;
    const PAN_STEP = 20;
    const ZOOM_WHEEL_FACTOR = 0.001;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!debugBordersEnabled || !live2dPlayer) return;

      // 方向键平移（Shift 加速）
      const step = e.shiftKey ? PAN_STEP * 3 : PAN_STEP;

      if (e.code === "ArrowUp") { e.preventDefault(); live2dPlayer.debugPan(0, -step); refreshDebugHud(); return; }
      if (e.code === "ArrowDown") { e.preventDefault(); live2dPlayer.debugPan(0, step); refreshDebugHud(); return; }
      if (e.code === "ArrowLeft") { e.preventDefault(); live2dPlayer.debugPan(-step, 0); refreshDebugHud(); return; }
      if (e.code === "ArrowRight") { e.preventDefault(); live2dPlayer.debugPan(step, 0); refreshDebugHud(); return; }

      // +/- 缩放
      if (e.code === "Equal" || e.code === "NumpadAdd") { e.preventDefault(); live2dPlayer.debugZoom(ZOOM_STEP); refreshDebugHud(); return; }
      if (e.code === "Minus" || e.code === "NumpadSubtract") { e.preventDefault(); live2dPlayer.debugZoom(-ZOOM_STEP); refreshDebugHud(); return; }

      // 0 重置
      if (e.code === "Digit0" || e.code === "Numpad0") { e.preventDefault(); live2dPlayer.debugReset(); refreshDebugHud(); return; }
    };

    const onWheel = (e: WheelEvent) => {
      if (!debugBordersEnabled || !live2dPlayer) return;
      e.preventDefault();
      const delta = -e.deltaY * ZOOM_WHEEL_FACTOR;
      live2dPlayer.debugZoom(delta);
      refreshDebugHud();
    };

    window.addEventListener("keydown", onKeyDown);
    live2dCanvas?.addEventListener("wheel", onWheel, { passive: false });

    unbindDebugControls = () => {
      window.removeEventListener("keydown", onKeyDown);
      live2dCanvas?.removeEventListener("wheel", onWheel);
    };
  }


  async function initLive2DPlayer() {
    try {
      const mod = (await invoke("get_current_mod")) as ModInfo | null;
      console.log("[Live2D Page] get_current_mod result:", mod ? {
        path: mod.path,
        mod_type: mod.manifest?.mod_type,
        hasLive2d: !!mod.live2d,
        statesCount: mod.live2d?.states?.length,
      } : null);

      if (!mod || mod.manifest?.mod_type !== "live2d" || !mod.live2d) {
        console.warn("[Live2D Page] Skipping init: no live2d mod loaded");
        return;
      }

      modPath = mod.path;
      live2dConfig = mod.live2d;
      globalKeyboardEnabled = Boolean(mod.manifest?.global_keyboard);
      globalMouseEnabled = Boolean(mod.manifest?.global_mouse);

      console.log("[Live2D Page] Canvas element:", live2dCanvas?.clientWidth, "x", live2dCanvas?.clientHeight);
      console.log("[Live2D Page] Canvas parent:", live2dCanvas?.parentElement?.clientWidth, "x", live2dCanvas?.parentElement?.clientHeight);

      live2dPlayer = new Live2DPlayer(live2dCanvas, {
        featureFlags,
      });
      await live2dPlayer.init();
      await live2dPlayer.load(modPath, live2dConfig);
      live2dPlayer.setVisible(showCharacter);
      live2dPlayer.setAnimationScale(animationScale);
      console.log("[Live2D Page] Player init complete, animationScale:", animationScale);
    } catch (error) {
      console.error("Failed to init Live2D player:", error);
    }
  }

  async function playAnimation(
    assetName: string,
    playOnce: boolean,
    onComplete: () => void,
    live2dParams?: Live2DParameterSetting[],
  ): Promise<boolean> {
    if (!live2dPlayer || !live2dConfig) return false;
    return live2dPlayer.playFromAnima(assetName, {
      playOnce,
      onComplete,
      animationScale,
      live2dParams,
    });
  }

  const core = createWindowCore({
    bindings: {
      setLangVersion: (value) => {
        _langVersion = value;
      },
      getShowCharacter: () => showCharacter,
      setShowCharacter: (value) => {
        showCharacter = value;
        live2dPlayer?.setVisible(value);
      },
      getShowBorder: () => showBorder,
      setShowBorder: (value) => {
        showBorder = value;
      },
      setModBorderEnabled: () => {
        // Live2D 当前不使用边框动画
      },
      setCharacterZOffset: () => {
        // Live2D 当前不需要 z-index 偏移
      },
      setBorderZOffset: () => {
        // Live2D 当前不需要边框层
      },
      getSilenceMode: () => silenceMode,
      setSilenceMode: (value) => {
        silenceMode = value;
      },
      getAnimationScale: () => animationScale,
      setAnimationScale: (value) => {
        animationScale = value;
        live2dPlayer?.setAnimationScale(value);
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
        live2dPlayer?.setDebugMode(value);
        if (value) refreshDebugHud();
      },
      setDebugColors: (value) => {
        debugColors = value;
      },
    },
    refs: {
      getCharacterCanvas: () => live2dCanvas,
      getBorderCanvas: () => null,
      getBubbleManager: () => bubbleManager,
    },
    callbacks: {
      playAnimation,
      onAnimationScaleChanged: () => live2dPlayer?.setAnimationScale(animationScale),
      isPixelOpaqueAtWindowPos: (windowX: number, windowY: number) => {
        return live2dPlayer?.isPixelOpaqueAtScreen(windowX, windowY) ?? false;
      },
      onCursorMove: (localX: number, localY: number) => {
        live2dPlayer?.updateGlobalMouseFollow(localX, localY);
      },
    },
  });

  onMount(() => {
    console.log("[Live2D Page] onMount: window.innerWidth:", window.innerWidth, "window.innerHeight:", window.innerHeight);
    bindFeatureHotkeys();
    bindDebugControls();
    bindOverlayKeyListeners();
    const init = async () => {
      unlistenSettings = await listen<UserSettings>(
        "settings-change",
        (event) => {
          userSettings = event.payload;
          syncFeatureFlags(userSettings);
        },
      );

      await loadUserSettings();
      await initLive2DPlayer();

      // 叠加层事件监听（全局键盘/鼠标按下松开）
      await listenGlobalKeyState();
      await listenGlobalMouseState();

      await core.init();
    };

    init().catch((error) => console.error("Live2D init failed:", error));
  });

  onDestroy(() => {
    unbindFeatureHotkeys?.();
    unbindDebugControls?.();
    unbindOverlayKeyListeners?.();
    unlistenSettings?.();
    unlistenKeyState?.();
    unlistenMouseState?.();
    live2dPlayer?.destroy();
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
    class="live2d-area"
    style="outline: {debugBordersEnabled
      ? '1px solid ' + debugColors.animation
      : 'none'}; outline-offset: -2px;"
  >
    <canvas
      class="live2d-canvas"
      class:hidden={!showCharacter}
      style="outline: {debugBordersEnabled
        ? '2px solid ' + debugColors.character
        : 'none'}; outline-offset: -2px;"
      bind:this={live2dCanvas}
      onmousedown={(e) => {
        core.handleMouseDown(e);
        if (!globalMouseEnabled && e.button === 0) {
          live2dPlayer?.setBackgroundLayersByEvent("click", true);
        } else if (!globalMouseEnabled && e.button === 2) {
          live2dPlayer?.setBackgroundLayersByEvent("right_click", true);
        }
      }}
      onmouseup={(e) => {
        if (!globalMouseEnabled && e.button === 0) {
          live2dPlayer?.setBackgroundLayersByEvent("click", false);
        } else if (!globalMouseEnabled && e.button === 2) {
          live2dPlayer?.setBackgroundLayersByEvent("right_click", false);
        }
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

    {#if debugBordersEnabled}
      <div class="debug-hud">
        <div class="debug-hud-title">Live2D Debug</div>
        <div>Scale: {debugHud.finalScale.toFixed(3)} (debug: {debugHud.scale.toFixed(2)}x)</div>
        <div>Offset: {debugHud.offsetX.toFixed(0)}, {debugHud.offsetY.toFixed(0)}</div>
        <div>BaseFit: {debugHud.baseFitScale.toFixed(4)}</div>
        <div class="debug-hud-help">
          Arrow: pan | +/-: zoom | 0: reset | Shift: fast
        </div>
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

  .live2d-area {
    flex: 1 1 auto;
    position: relative;
    pointer-events: none;
    overflow: hidden;
  }

  .live2d-canvas {
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: auto;
    cursor: grab;
  }

  .live2d-canvas:active {
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

  .debug-hud {
    position: absolute;
    bottom: 8px;
    right: 8px;
    z-index: 400;
    pointer-events: none;
    background: rgba(0, 0, 0, 0.7);
    color: rgba(255, 255, 255, 0.9);
    font-family: monospace;
    font-size: 11px;
    line-height: 1.5;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    backdrop-filter: blur(4px);
    white-space: nowrap;
  }

  .debug-hud-title {
    font-weight: 700;
    margin-bottom: 2px;
    color: #ffcc00;
  }

  .debug-hud-help {
    margin-top: 4px;
    color: rgba(255, 255, 255, 0.55);
    font-size: 10px;
  }
</style>

