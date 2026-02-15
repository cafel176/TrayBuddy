import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow, cursorPosition, LogicalPosition } from "@tauri-apps/api/window";
import { initI18n, destroyI18n, onLangChange } from "$lib/i18n";
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
  ModData,
  Live2DParameterSetting,
} from "$lib/types/asset";
import type BubbleManager from "$lib/bubble/BubbleManager.svelte";
import type { BubbleConfig } from "$lib/bubble/BubbleManager.svelte";
import {
  CURSOR_POLL_INTERVAL_MS,
  TRAY_ADAPTIVE_OFFSET_Y,
} from "$lib/constants";

export type ModDataToast = { id: number; delta: number };

export type DebugColors = {
  bubble: string;
  animation: string;
  character: string;
  border: string;
};

export type WindowCoreBindings = {
  setLangVersion: (value: number) => void;

  getShowCharacter: () => boolean;
  setShowCharacter: (value: boolean) => void;
  getShowBorder: () => boolean;
  setShowBorder: (value: boolean) => void;
  setModBorderEnabled: (value: boolean) => void;
  setCharacterZOffset: (value: number) => void;
  setBorderZOffset: (value: number) => void;

  getSilenceMode: () => boolean;
  setSilenceMode: (value: boolean) => void;
  getAnimationScale: () => number;
  setAnimationScale: (value: number) => void;
  getUserNickname: () => string;
  setUserNickname: (value: string) => void;

  setNoMod: (value: boolean) => void;

  getShowModDataPanel: () => boolean;
  setShowModDataPanel: (value: boolean) => void;
  getCurrentModData: () => ModData | null;
  setCurrentModData: (value: ModData | null) => void;
  getLastModDataValue: () => number | null;
  setLastModDataValue: (value: number | null) => void;
  getModDataToasts: () => ModDataToast[];
  setModDataToasts: (value: ModDataToast[]) => void;
  getModDataToastSeq: () => number;
  setModDataToastSeq: (value: number) => void;

  getDebugBordersEnabled: () => boolean;
  setDebugBordersEnabled: (value: boolean) => void;
  setDebugColors: (value: DebugColors) => void;
};

export type WindowCoreRefs = {
  getCharacterCanvas: () => HTMLCanvasElement | null;
  getBorderCanvas: () => HTMLCanvasElement | null;
  getBubbleManager: () => BubbleManager | null;
};

export type WindowCoreCallbacks = {
  playAnimation: (
    assetName: string,
    playOnce: boolean,
    onComplete: () => void,
    live2dParams?: Live2DParameterSetting[],
  ) => Promise<boolean>;
  onAnimationScaleChanged?: () => void;
  onBorderConfigLoaded?: (config: BorderConfig | null) => Promise<void> | void;
  getBorderPlayerReady?: () => boolean;
  onCharacterConfigLoaded?: (config: CharacterConfig | null) => void;
  /** 前端像素级透明度检测：给定窗口内坐标，判断该位置像素是否不透明。用于 live2d 鼠标穿透。 */
  isPixelOpaqueAtWindowPos?: (windowX: number, windowY: number) => boolean;
};

export type WindowCore = {
  init: () => Promise<void>;
  destroy: () => void;
  handleBranchSelect: (e: CustomEvent<BranchInfo>) => void;
  handleBubbleClose: () => void;
  handleBubbleShow: () => void;
  handleMouseDown: (e: MouseEvent) => void;
  handleMouseMove: (e: MouseEvent) => void;
  handleMouseUp: (e: MouseEvent) => void;
  handleContextMenu: (e: MouseEvent) => void;
};

export function createWindowCore(options: {
  bindings: WindowCoreBindings;
  refs: WindowCoreRefs;
  callbacks: WindowCoreCallbacks;
}): WindowCore {
  const { bindings, refs, callbacks } = options;

  let audioManager: AudioManager | null = null;
  let triggerManager: TriggerManager | null = null;

  type PendingBranchSelection = {
    stateName: string;
    branches: BranchInfo[];
  };
  let pendingBranchSelection: PendingBranchSelection | null = null;

  let unlistenState: (() => void) | null = null;
  let unlistenSettings: (() => void) | null = null;
  let unlistenPlaybackReq: (() => void) | null = null;
  let unlistenModData: (() => void) | null = null;
  let unlistenGlobalKeydown: (() => void) | null = null;
  let unsubLang: (() => void) | null = null;

  let animationComplete = false;
  let audioComplete = false;
  let bubbleComplete = false;
  let isPlayOnce = false;
  let playSessionToken = 0;
  let bubbleSessionToken = 0;

  let globalKeyboardEnabled = false;

  let isBubbleVisible = false;
  let isClickThrough = true;
  let cursorPollTimer: ReturnType<typeof setInterval> | null = null;

  let isDragging = false;
  let isMouseDown = false;
  let mouseDownPos = { x: 0, y: 0 };
  const DRAG_THRESHOLD = 5;
  const DRAG_END_POLL_INTERVAL_MS = 30;
  let hasGlobalMouseListeners = false;
  let dragSessionSeq = 0;
  let activeDragSession = 0;
  let dragEndPollTimer: ReturnType<typeof setInterval> | null = null;
  let dragEndPollSawDown = false;

  let langVersion = 0;

  function bumpLangVersion() {
    langVersion += 1;
    bindings.setLangVersion(langVersion);
  }

  function applySpeechPlaceholders(raw: string): string {
    let text = raw;
    const nickname = bindings.getUserNickname();
    text = text.replace(/\{nickname\}/g, nickname);
    text = text.replace(/\{days_used\}/g, String(getDaysUsedNow()));
    text = text.replace(
      /\{(?:usage_hours|total_usage_hours)\}/g,
      String(getTotalUsageHoursNow()),
    );
    text = text.replace(/\{uptime\}/g, formatDurationHms(getSessionUptimeSecondsNow()));
    return text;
  }

  let firstLoginTs: number | null = null;
  let usageBaseSeconds = 0;
  let usageBaseAtMs = Date.now();
  let sessionUptimeBaseSeconds = 0;
  let sessionUptimeBaseAtMs = Date.now();

  function getTotalUsageSecondsNow(): number {
    const delta = Math.max(0, Math.floor((Date.now() - usageBaseAtMs) / 1000));
    return Math.max(0, Math.floor(usageBaseSeconds + delta));
  }

  function getSessionUptimeSecondsNow(): number {
    const delta = Math.max(
      0,
      Math.floor((Date.now() - sessionUptimeBaseAtMs) / 1000),
    );
    return Math.max(0, Math.floor(sessionUptimeBaseSeconds + delta));
  }

  function formatDurationHms(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad2 = (n: number) => String(n).padStart(2, "0");
    return `${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
  }

  function getDaysUsedNow(): number {
    if (!firstLoginTs) return 0;

    const first = new Date(firstLoginTs * 1000);
    const today = new Date();

    const firstMidnight = new Date(
      first.getFullYear(),
      first.getMonth(),
      first.getDate(),
    );
    const todayMidnight = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );

    const diffDays = Math.floor(
      (todayMidnight.getTime() - firstMidnight.getTime()) / 86400000,
    );
    return Math.max(1, diffDays + 1);
  }

  function getTotalUsageHoursNow(): number {
    return Math.floor(getTotalUsageSecondsNow() / 3600);
  }

  function pushModDataToast(delta: number) {
    if (!delta) return;

    const id = bindings.getModDataToastSeq() + 1;
    bindings.setModDataToastSeq(id);
    bindings.setModDataToasts([...bindings.getModDataToasts(), { id, delta }]);

    window.setTimeout(() => {
      bindings.setModDataToasts(
        bindings.getModDataToasts().filter((t) => t.id !== id),
      );
    }, 1400);
  }

  function applyModDataUpdate(data: ModData | null) {
    const next = data?.value;
    if (typeof next !== "number") {
      bindings.setCurrentModData(data);
      bindings.setLastModDataValue(null);
      return;
    }

    const last = bindings.getLastModDataValue();
    if (typeof last === "number" && next !== last) {
      pushModDataToast(next - last);
    }

    bindings.setCurrentModData(data);
    bindings.setLastModDataValue(next);
  }

  async function setClickThrough(ignore: boolean) {
    if (isClickThrough === ignore) return;
    try {
      await invoke("set_ignore_cursor_events", { ignore });
      isClickThrough = ignore;
    } catch (e) {
      console.error("[setClickThrough] Failed:", e);
    }
  }

  function getBubbleBounds(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null {
    if (!isBubbleVisible) return null;

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

  function startCursorPolling() {
    stopCursorPolling();
    cursorPollTimer = setInterval(async () => {
      try {
        if (bindings.getSilenceMode()) {
          await setClickThrough(true);
          return;
        }

        const bubbleBounds = getBubbleBounds();

        // live2d 窗口：使用前端像素级透明度检测
        if (callbacks.isPixelOpaqueAtWindowPos) {
          const cursor = await cursorPosition();  // PhysicalPosition
          const win = getCurrentWindow();
          const scaleFactor = await win.scaleFactor();
          const position = await win.outerPosition(); // PhysicalPosition

          // 两者都是物理坐标，直接相减得到窗口内物理偏移，再除以 scaleFactor 得到 CSS 逻辑坐标
          const localX = (cursor.x - position.x) / scaleFactor;
          const localY = (cursor.y - position.y) / scaleFactor;

          // 先检查气泡区域
          if (bubbleBounds) {
            const inBubble =
              localX >= bubbleBounds.left &&
              localX <= bubbleBounds.right &&
              localY >= bubbleBounds.top &&
              localY <= bubbleBounds.bottom;
            if (inBubble) {
              await setClickThrough(false);
              return;
            }
          }

          // 像素级检测 canvas 不透明区域
          const opaque = callbacks.isPixelOpaqueAtWindowPos(localX, localY);
          await setClickThrough(!opaque);

          // 每次轮询都通过 Tauri 在 OS 层面设置 cursor，
          // 因为 WebView2 在 ignore_cursor_events 切换后不会自动更新 CSS cursor
          if (opaque) {
            try {
              await getCurrentWindow().setCursorIcon("grab");
            } catch { /* ignore */ }
          } else {
            try {
              await getCurrentWindow().setCursorIcon("default");
            } catch { /* ignore */ }
          }
          return;
        }

        // animation 窗口：使用后端矩形区域判断
        const inInteractArea = await invoke<boolean>(
          "is_cursor_in_interact_area",
          {
            bubbleBounds: bubbleBounds,
          },
        );
        await setClickThrough(!inInteractArea);
      } catch {
        // ignore
      }
    }, CURSOR_POLL_INTERVAL_MS);
  }

  function stopCursorPolling() {
    if (cursorPollTimer) {
      clearInterval(cursorPollTimer);
      cursorPollTimer = null;
    }
  }

  function handleBubbleShow() {
    isBubbleVisible = true;
    startCursorPolling();
  }

  function stopDragEndPoll() {
    if (dragEndPollTimer) {
      clearInterval(dragEndPollTimer);
      dragEndPollTimer = null;
    }
    dragEndPollSawDown = false;
  }

  function startDragEndPoll(session: number) {
    stopDragEndPoll();
    dragEndPollTimer = setInterval(async () => {
      if (!isDragging || activeDragSession !== session) {
        stopDragEndPoll();
        return;
      }

      try {
        const down = await invoke<boolean>("is_left_mouse_down");
        if (down) {
          dragEndPollSawDown = true;
          return;
        }

        if (dragEndPollSawDown && !down) {
          finishDrag();
        }
      } catch {
        stopDragEndPoll();
      }
    }, DRAG_END_POLL_INTERVAL_MS);
  }

  function addGlobalMouseListeners() {
    if (hasGlobalMouseListeners) return;
    hasGlobalMouseListeners = true;
    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", handleMouseUp, true);
  }

  function removeGlobalMouseListeners() {
    if (!hasGlobalMouseListeners) return;
    hasGlobalMouseListeners = false;
    window.removeEventListener("mousemove", handleMouseMove, true);
    window.removeEventListener("mouseup", handleMouseUp, true);
  }

  function resumeCursorHandling() {
    startCursorPolling();
  }

  function finishDrag() {
    if (!isDragging) return;
    stopDragEndPoll();
    triggerManager?.trigger("drag_end", true);
    isDragging = false;
    isMouseDown = false;
    removeGlobalMouseListeners();
    resumeCursorHandling();
  }

  function handleMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;

    isDragging = false;
    isMouseDown = true;
    mouseDownPos = { x: e.screenX, y: e.screenY };
    activeDragSession = ++dragSessionSeq;

    stopCursorPolling();
    void setClickThrough(false);

    addGlobalMouseListeners();
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isMouseDown || isDragging) return;

    const dx = Math.abs(e.screenX - mouseDownPos.x);
    const dy = Math.abs(e.screenY - mouseDownPos.y);
    if (dx <= DRAG_THRESHOLD && dy <= DRAG_THRESHOLD) return;

    isDragging = true;
    const session = activeDragSession;

    triggerManager?.trigger("drag_start", true);

    startDragEndPoll(session);

    void getCurrentWindow()
      .startDragging()
      .catch((err) => {
        console.warn("[startDragging] Failed:", err);
        stopDragEndPoll();
        isDragging = false;
      });
  }

  async function handleMouseUp(e: MouseEvent) {
    if (e.button !== 0) return;

    if (isDragging) {
      finishDrag();
      return;
    }

    if (isMouseDown) {
      triggerManager?.trigger("click");

      try {
        await invoke("record_click_event");
      } catch (err) {
        console.error("Failed to record click event:", err);
      }
    }

    isMouseDown = false;
    removeGlobalMouseListeners();
    resumeCursorHandling();
  }

  async function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    try {
      await invoke("show_context_menu");
    } catch (err) {
      console.error("Failed to show context menu:", err);
    }
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    const keyCode = e.code;

    if (keyCode === "Space" && pendingBranchSelection?.branches?.length) {
      e.preventDefault();
      void chooseBranchBySpace();
      return;
    }

    // 当 global_keyboard 开启时，后端轮询线程已处理键盘事件，
    // 前端不再转发 keydown 触发，避免重复触发。
    if (!globalKeyboardEnabled) {
      triggerManager?.trigger(`keydown:${keyCode}`);
    }
  }

  /**
   * 处理后端全局键盘轮询发来的按键事件（不需要窗口 focus）。
   * 仅在 globalKeyboardEnabled 时有效，用于隐藏分支选择场景。
   */
  function handleBackendKeydown(keyCode: string) {
    if (!globalKeyboardEnabled) {
      console.log("[WindowCore] handleBackendKeydown skipped: globalKeyboardEnabled=false");
      return;
    }
    if (
      (keyCode === "Space" || keyCode === "Enter") &&
      pendingBranchSelection?.branches?.length
    ) {
      console.log("[WindowCore] handleBackendKeydown -> chooseBranchBySpace", keyCode);
      void chooseBranchBySpace();
    }
  }

  async function chooseBranchBySpace() {
    const pending = pendingBranchSelection;
    if (!pending || pending.branches.length === 0) return;

    const chosen = pending.branches[0];

    console.log("[BranchHidden] Space choose branch", {
      state: pending.stateName,
      chosenText: chosen.text,
      chosenNextState: chosen.next_state,
      options: pending.branches.map((b) => ({
        text: b.text,
        next_state: b.next_state,
      })),
      ts: Date.now(),
    });

    try {
      await invoke("set_next_state", { name: chosen.next_state });
      emit("next-state-changed", { name: chosen.next_state });
      pendingBranchSelection = null;
    } catch (error) {
      console.error("[BranchHidden] Failed to set next state:", error);
    }
  }

  async function syncDisplayMode(show: boolean) {
    const currentWindow = getCurrentWindow();
    if (!show) {
      try {
        const [physX, physY] = await invoke<[number, number]>(
          "get_tray_position",
        );
        const scale = await currentWindow.scaleFactor();
        const { width } = await currentWindow.innerSize();

        const logicalX = (physX - width / 2) / scale;
        const logicalY = physY / scale - 300 - TRAY_ADAPTIVE_OFFSET_Y;

        await currentWindow.setPosition(
          new LogicalPosition(logicalX, logicalY),
        );
      } catch (err) {
        console.warn("[Layout] Failed to move to tray:", err);
      }
    } else {
      try {
        const [savedX, savedY] = await invoke<[number | null, number | null]>(
          "get_saved_window_position",
        );
        if (savedX !== null && savedY !== null) {
          await currentWindow.setPosition(
            new LogicalPosition(savedX, savedY - 300),
          );
        }
      } catch (err) {
        console.warn("[Layout] Failed to restore saved position:", err);
      }
    }
  }

  async function showBubble(state: StateInfo, token: number) {
    try {
      if (!bindings.getShowCharacter()) {
        await syncDisplayMode(false);
      }
      if (playSessionToken !== token) return;

      let textContent = "";
      let textDuration = 0;
      if (state.text) {
        const settings = await invoke<{ lang: string }>("get_settings");
        if (playSessionToken !== token) return;
        const textInfo = await invoke<{
          text: string;
          duration?: number;
        } | null>("get_text_by_name", {
          lang: settings.lang || "zh",
          name: state.text,
        });
        if (playSessionToken !== token) return;
        if (textInfo) {
          textContent = applySpeechPlaceholders(textInfo.text);
          textDuration = (textInfo.duration ?? 3) * 1000;
        }
      }

      if (playSessionToken !== token) return;

      let processedBranches: BranchInfo[] = [];
      if (state.branch && state.branch.length > 0) {
        const settings = await invoke<{ lang: string }>("get_settings");
        if (playSessionToken !== token) return;
        const lang = settings.lang || "zh";

        for (const branch of state.branch) {
          const textInfo = await invoke<{
            text: string;
            duration?: number;
          } | null>("get_text_by_name", {
            lang: lang,
            name: branch.text,
          });
          if (playSessionToken !== token) return;

          const actualText = textInfo?.text || branch.text;

          processedBranches.push({
            text: applySpeechPlaceholders(actualText),
            next_state: branch.next_state,
          });
        }
      }

      if (playSessionToken !== token) return;

      const showBranchBubble = state.branch_show_bubble !== false;

      if (!showBranchBubble && processedBranches.length > 0) {
        // 有分支但气泡被禁用：分支存入 pending，气泡不显示分支按钮，文本照常显示
        pendingBranchSelection = {
          stateName: state.name,
          branches: processedBranches,
        };
        console.log("[showBubble] Branch bubble disabled; press Space to choose", {
          state: state.name,
          branches: processedBranches.map((b) => ({
            text: b.text,
            next_state: b.next_state,
          })),
        });
      } else {
        pendingBranchSelection = null;
      }

      // branch_show_bubble 为 false 且无分支（纯文本）：不显示气泡，但等待 duration
      if (!showBranchBubble && processedBranches.length === 0) {
        refs.getBubbleManager()?.hide();
        if (textDuration > 0) {
          setTimeout(() => {
            if (playSessionToken !== token) return;
            bubbleComplete = true;
            checkComplete();
          }, textDuration);
        } else {
          bubbleComplete = true;
          checkComplete();
        }
        return;
      }

      const bubbleConfig: BubbleConfig = {
        text: textContent,
        branches: showBranchBubble ? processedBranches : [],
        position: "top",
        typeSpeed: 50,
        duration: textDuration,
      };

      if (
        !bubbleConfig.text &&
        (!bubbleConfig.branches || bubbleConfig.branches.length === 0)
      ) {
        refs.getBubbleManager()?.hide();
        bubbleComplete = true;
        checkComplete();
        return;
      }

      refs.getBubbleManager()?.show(bubbleConfig);
    } catch (e) {
      console.error("[showBubble] Failed to show bubble:", e);
      bubbleComplete = true;
      checkComplete();
    }
  }

  async function handleBranchSelect(e: CustomEvent<BranchInfo>) {
    const branch = e.detail;

    console.log("[handleBranchSelect] Selected branch", {
      source: "bubbleUI",
      chosenText: branch.text,
      chosenNextState: branch.next_state,
      pendingState: pendingBranchSelection?.stateName,
      pendingOptions: pendingBranchSelection?.branches?.map((b) => ({
        text: b.text,
        next_state: b.next_state,
      })),
      ts: Date.now(),
    });

    try {
      await invoke("set_next_state", { name: branch.next_state });
      emit("next-state-changed", { name: branch.next_state });
      pendingBranchSelection = null;
    } catch (error) {
      console.error("[handleBranchSelect] Failed to set next state:", error);
    }
  }

  function emitPlaybackStatus() {
    emit("playback-status", {
      animationComplete,
      audioComplete,
      bubbleComplete,
      isPlayOnce,
    });
  }

  function checkComplete() {
    emitPlaybackStatus();

    if (isPlayOnce && animationComplete && audioComplete && bubbleComplete) {
      setTimeout(() => invoke("on_animation_complete"), 0);
    }
  }

  function handleBubbleClose() {
    isBubbleVisible = false;
    if (bubbleSessionToken !== playSessionToken) return;
    bubbleComplete = true;
    checkComplete();
  }

  async function playState(state: StateInfo, playOnce: boolean) {
    pendingBranchSelection = null;

    // 每次 playState 分配一个唯一 token，使并发调用中旧 session 的回调和后续代码失效。
    // 解决问题：快速连续的 state-change 事件（如 mod 切换期间 idle + login）
    // 导致旧 session 的 checkComplete 覆盖新 session 的完成标志，
    // 使 on_animation_complete 永远不被调用，后端 locked 永远无法解除。
    const token = ++playSessionToken;

    isPlayOnce = playOnce;
    animationComplete = false;
    audioComplete = false;
    bubbleComplete = false;

    const hasLive2dParams = Array.isArray(state.live2d_params) && state.live2d_params.length > 0;

    if (!state.anima && !hasLive2dParams) {
      animationComplete = true;
      checkComplete();
    } else {
      const success = await callbacks.playAnimation(state.anima, playOnce, () => {
        if (playSessionToken !== token) return;
        animationComplete = true;
        checkComplete();
      }, state.live2d_params);

      if (playSessionToken !== token) return;

      if (!success) {
        animationComplete = true;
        checkComplete();
      } else if (!playOnce) {
        animationComplete = true;
      }
    }

    if (playSessionToken !== token) return;

    if (audioManager && state.audio) {
      if (!playOnce) {
        const success = await audioManager.play(state.audio, undefined, true);
        if (playSessionToken !== token) return;
        if (success) {
          audioComplete = true;
          checkComplete();
        } else {
          console.warn(
            `[playState] Failed to start looping audio: ${state.audio}`,
          );
        }
      } else {
        audioManager.play(state.audio, () => {
          if (playSessionToken !== token) return;
          audioComplete = true;
          checkComplete();
        });
      }
    } else {
      audioComplete = true;
      checkComplete();
    }

    if (playSessionToken !== token) return;

    if (playOnce && (state.text || (state.branch && state.branch.length > 0))) {
      bubbleSessionToken = token;
      await showBubble(state, token);
    } else {
      if (!playOnce) {
        refs.getBubbleManager()?.hide();
      }
      bubbleComplete = true;
      checkComplete();
    }
  }

  async function init() {
    try {
      await setClickThrough(true);
      startCursorPolling();

      window.addEventListener("keydown", handleGlobalKeydown);

      // 监听后端全局键盘轮询事件（不需要窗口 focus 即可触发分支选择）
      unlistenGlobalKeydown = await listen<string>("global-keydown", (event) => {
        console.log("[WindowCore] Received global-keydown from backend:", event.payload, {
          globalKeyboardEnabled,
          hasPendingBranch: !!pendingBranchSelection?.branches?.length,
        });
        handleBackendKeydown(event.payload);
      });

      unsubLang = onLangChange(() => {
        bumpLangVersion();
      });
      await initI18n();
      bumpLangVersion();

      const settings: UserSettings = await invoke("get_settings");
      bindings.setShowCharacter(settings.show_character);
      bindings.setShowBorder(settings.show_border);
      bindings.setAnimationScale(settings.animation_scale);
      bindings.setSilenceMode(settings.silence_mode);
      bindings.setUserNickname(settings.nickname || "User");

      try {
        const usage = await invoke<{
          first_login: number | null;
          total_usage_seconds: number;
          session_uptime_seconds: number;
        }>("get_usage_stats");
        firstLoginTs =
          typeof usage.first_login === "number" ? usage.first_login : null;

        usageBaseSeconds = Number.isFinite(Number(usage.total_usage_seconds))
          ? Number(usage.total_usage_seconds)
          : 0;
        usageBaseAtMs = Date.now();

        sessionUptimeBaseSeconds = Number.isFinite(
          Number(usage.session_uptime_seconds),
        )
          ? Number(usage.session_uptime_seconds)
          : 0;
        sessionUptimeBaseAtMs = Date.now();
      } catch (e) {
        console.warn("Failed to load usage stats:", e);
      }

      if (bindings.getSilenceMode()) {
        await setClickThrough(true);
      }

      await syncDisplayMode(bindings.getShowCharacter());

      audioManager = await getAudioManager();
      triggerManager = getTriggerManager();

      const characterConfig: CharacterConfig | null = await invoke(
        "get_character_config",
      );
      if (characterConfig) {
        bindings.setCharacterZOffset(characterConfig.z_offset ?? 1);
      }
      callbacks.onCharacterConfigLoaded?.(characterConfig);

      const borderConfig: BorderConfig | null = await invoke("get_border_config");
      const modBorderEnabled = Boolean(
        borderConfig && borderConfig.enable && borderConfig.anima,
      );
      bindings.setModBorderEnabled(modBorderEnabled);
      if (borderConfig) {
        bindings.setBorderZOffset(borderConfig.z_offset ?? 2);
      }
      await callbacks.onBorderConfigLoaded?.(borderConfig);

      unlistenState = await listen<StateChangeEvent>(
        "state-change",
        async (event) => {
          await playState(event.payload.state, event.payload.play_once);
        },
      );

      unlistenSettings = await listen<UserSettings>(
        "settings-change",
        async (event) => {
          const payload = event.payload;

          if ("show_character" in payload) {
            bindings.setShowCharacter(payload.show_character);
          }
          if ("show_border" in payload) {
            bindings.setShowBorder(payload.show_border);
          }
          if ("silence_mode" in payload) {
            bindings.setSilenceMode(payload.silence_mode);
          }
          if ("animation_scale" in payload) {
            bindings.setAnimationScale(payload.animation_scale);
            setTimeout(() => callbacks.onAnimationScaleChanged?.(), 0);
          }
          if ("nickname" in payload) {
            bindings.setUserNickname(payload.nickname || "User");
          }

          const borderReady = callbacks.getBorderPlayerReady?.() ?? false;
          if (bindings.getShowBorder() && !borderReady) {
            const nextBorderConfig: BorderConfig | null = await invoke(
              "get_border_config",
            );
            const nextModBorderEnabled = Boolean(
              nextBorderConfig && nextBorderConfig.enable && nextBorderConfig.anima,
            );
            bindings.setModBorderEnabled(nextModBorderEnabled);
            if (nextBorderConfig) {
              bindings.setBorderZOffset(nextBorderConfig.z_offset ?? 2);
            }
            await callbacks.onBorderConfigLoaded?.(nextBorderConfig);
          }

          await syncDisplayMode(bindings.getShowCharacter());
        },
      );

      unlistenPlaybackReq = await listen("request-playback-status", () => {
        emitPlaybackStatus();
      });

      const currentState: StateInfo | null = await invoke("get_persistent_state");
      if (currentState) await playState(currentState, false);

      await invoke("start_login_detection");

      const currentMod: any = await invoke("get_current_mod");
      bindings.setNoMod(!currentMod);

      bindings.setShowModDataPanel(
        Boolean(currentMod?.manifest?.show_mod_data_panel),
      );
      globalKeyboardEnabled = Boolean(currentMod?.manifest?.global_keyboard);
      console.log("[WindowCore] globalKeyboardEnabled =", globalKeyboardEnabled, "manifest.global_keyboard =", currentMod?.manifest?.global_keyboard);
      if (bindings.getShowModDataPanel()) {
        try {
          const data = await invoke<ModData | null>("get_current_mod_data");
          applyModDataUpdate(data);
        } catch {
          applyModDataUpdate(null);
        }

        unlistenModData = await listen<ModData>(
          "mod-data-changed",
          (event) => {
            applyModDataUpdate(event.payload);
          },
        );
      }

      await listen("request-layout-info", () => {
        const info = [];
        const getInfo = (
          el: HTMLElement | HTMLCanvasElement | null,
          name: string,
        ) => {
          if (!el) return null;
          const style = window.getComputedStyle(el);
          return {
            name,
            width: (el as HTMLCanvasElement).width || el.offsetWidth,
            height: (el as HTMLCanvasElement).height || el.offsetHeight,
            displayWidth: el.clientWidth,
            displayHeight: el.clientHeight,
            zIndex: style.zIndex,
            visibility: style.visibility,
            opacity: style.opacity,
          };
        };

        const charInfo = getInfo(refs.getCharacterCanvas(), "character");
        if (charInfo) info.push(charInfo);

        const borderInfo = getInfo(refs.getBorderCanvas(), "border");
        if (borderInfo) info.push(borderInfo);

        const bubbleAreaEl = document.querySelector(
          ".bubble-area",
        ) as HTMLElement;
        const bubbleAreaInfo = getInfo(bubbleAreaEl, "bubbleArea");
        if (bubbleAreaInfo) info.push(bubbleAreaInfo);

        const bubbleEl = document.querySelector(".bubble") as HTMLElement;
        const bubbleInfo = getInfo(bubbleEl, "bubbleCanvas");
        if (bubbleInfo) info.push(bubbleInfo);

        emit("layout-info", info);
      });

      await listen<boolean>("toggle-debug-borders", (event) => {
        bindings.setDebugBordersEnabled(event.payload);
        if (event.payload) {
          const rc = () => `hsl(${Math.random() * 360}, 100%, 50%)`;
          bindings.setDebugColors({
            bubble: rc(),
            animation: rc(),
            character: rc(),
            border: rc(),
          });
        }
      });

      await listen<boolean>("layout-debugger-status", (event) => {
        const isTabActive = event.payload;
        if (!isTabActive) {
          bindings.setDebugBordersEnabled(false);
        }
      });
    } catch (e) {
      console.error("Failed to init:", e);
      bindings.setNoMod(true);
    }
  }

  function destroy() {
    window.removeEventListener("keydown", handleGlobalKeydown);
    removeGlobalMouseListeners();
    stopDragEndPoll();
    stopCursorPolling();

    audioManager?.destroy();
    triggerManager?.destroy();
    unlistenState?.();
    unlistenSettings?.();
    unlistenPlaybackReq?.();
    unlistenModData?.();
    unlistenGlobalKeydown?.();
    unsubLang?.();
    destroyI18n();
  }

  return {
    init,
    destroy,
    handleBranchSelect,
    handleBubbleClose,
    handleBubbleShow,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleContextMenu,
  };
}
