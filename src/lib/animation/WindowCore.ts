import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
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
  ) => Promise<boolean>;
  onAnimationScaleChanged?: () => void;
  onBorderConfigLoaded?: (config: BorderConfig | null) => Promise<void> | void;
  getBorderPlayerReady?: () => boolean;
  onCharacterConfigLoaded?: (config: CharacterConfig | null) => void;
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
  let unsubLang: (() => void) | null = null;

  let animationComplete = false;
  let audioComplete = false;
  let bubbleComplete = false;
  let isPlayOnce = false;

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

    triggerManager?.trigger(`keydown:${keyCode}`);
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

  async function showBubble(state: StateInfo) {
    try {
      if (!bindings.getShowCharacter()) {
        await syncDisplayMode(false);
      }

      let textContent = "";
      let textDuration = 0;
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
          textContent = applySpeechPlaceholders(textInfo.text);
          textDuration = (textInfo.duration ?? 3) * 1000;
        }
      }

      let processedBranches: BranchInfo[] = [];
      if (state.branch && state.branch.length > 0) {
        const settings = await invoke<{ lang: string }>("get_settings");
        const lang = settings.lang || "zh";

        for (const branch of state.branch) {
          const textInfo = await invoke<{
            text: string;
            duration?: number;
          } | null>("get_text_by_name", {
            lang: lang,
            name: branch.text,
          });

          const actualText = textInfo?.text || branch.text;

          processedBranches.push({
            text: applySpeechPlaceholders(actualText),
            next_state: branch.next_state,
          });
        }
      }

      const showBranchBubble = state.branch_show_bubble !== false;

      if (!showBranchBubble && processedBranches.length > 0) {
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
    bubbleComplete = true;
    checkComplete();
  }

  async function playState(state: StateInfo, playOnce: boolean) {
    pendingBranchSelection = null;

    isPlayOnce = playOnce;
    animationComplete = false;
    audioComplete = false;
    bubbleComplete = false;

    if (!state.anima) {
      animationComplete = true;
      checkComplete();
    } else {
      const success = await callbacks.playAnimation(state.anima, playOnce, () => {
        animationComplete = true;
        checkComplete();
      });

      if (!success) {
        animationComplete = true;
        checkComplete();
      } else if (!playOnce) {
        animationComplete = true;
      }
    }

    if (audioManager && state.audio) {
      if (!playOnce) {
        const success = await audioManager.play(state.audio, undefined, true);
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
          audioComplete = true;
          checkComplete();
        });
      }
    } else {
      audioComplete = true;
      checkComplete();
    }

    if (playOnce && (state.text || (state.branch && state.branch.length > 0))) {
      await showBubble(state);
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
