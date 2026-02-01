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
  import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
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
    ModData,
  } from "$lib/types/asset";
  import BubbleManager, {
    type BubbleConfig,
  } from "$lib/bubble/BubbleManager.svelte";
  import {
    CURSOR_POLL_INTERVAL_MS,
    TRAY_ADAPTIVE_OFFSET_Y,
  } from "$lib/constants";

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

  /**
   * 分支选择（当禁用分支气泡 UI 时，用于通过空格键选择）
   */
  type PendingBranchSelection = {
    stateName: string;
    branches: BranchInfo[];
  };
  let pendingBranchSelection = $state<PendingBranchSelection | null>(null);


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
  let showCharacter = $state(true);
  /** 是否显示边框 */
  let showBorder = $state(true);
  /** 角色 Canvas 的 z-index */
  let characterZOffset = $state(1);
  /** 边框 Canvas 的 z-index */
  let borderZOffset = $state(2);
  /** 是否开启免打扰模式 */
  let silenceMode = $state(false);
  /** 动画区域缩放比例 */
  let animationScale = $state(0.4);
  /** 用户昵称（用于气泡占位符替换） */
  let userNickname = $state("User");

  /** 是否未加载任何 Mod */
  let noMod = $state(false);

  // =========================================================================
  // Mod 数据面板（动画区左上角 HUD）
  // =========================================================================

  /** 是否显示 Mod 数据面板（由 Mod manifest 控制） */
  let showModDataPanel = $state(false);

  /** 当前 Mod 的数据 */
  let currentModData = $state<ModData | null>(null);

  /** Mod 数据上次展示的 value（用于计算变化量） */
  let lastModDataValue = $state<number | null>(null);

  /** Mod 数据变化提示（上漂渐隐） */
  type ModDataToast = { id: number; delta: number };
  let modDataToasts = $state<ModDataToast[]>([]);
  let modDataToastSeq = $state(0);

  function pushModDataToast(delta: number) {
    // 不展示 0（也避免由于异常/并发导致的重复）
    if (!delta) return;

    const id = ++modDataToastSeq;
    modDataToasts = [...modDataToasts, { id, delta }];

    // 动画结束后自动移除
    window.setTimeout(() => {
      modDataToasts = modDataToasts.filter((t) => t.id !== id);
    }, 1400);
  }

  function applyModDataUpdate(data: ModData | null) {
    const next = data?.value;
    if (typeof next !== "number") {
      currentModData = data;
      lastModDataValue = null;
      return;
    }

    if (typeof lastModDataValue === "number" && next !== lastModDataValue) {
      pushModDataToast(next - lastModDataValue);
    }

    currentModData = data;
    lastModDataValue = next;
  }

  /** Mod 数据事件监听器取消函数 */
  let unlistenModData: (() => void) | null = null;


  /** 布局调试边框启用状态 */
  let debugBordersEnabled = $state(false);
  /** 布局调试边框颜色 */
  let debugColors = $state({
    bubble: "transparent",
    animation: "transparent",
    character: "transparent",
    border: "transparent",
  });

  // =========================================================================
  // 播放同步控制
  // =========================================================================

  /** 动画是否播放完成 */
  let animationComplete = $state(false);
  /** 音频是否播放完成 */
  let audioComplete = $state(false);
  /** 气泡是否显示完成（关闭或无气泡） */
  let bubbleComplete = $state(false);
  /** 当前是否为单次播放模式（临时状态） */
  let isPlayOnce = $state(false);

  // =========================================================================
  // 拖拽检测
  // =========================================================================

  /** 是否正在拖拽 */
  let isDragging = $state(false);
  /** 鼠标是否按下 */
  let isMouseDown = $state(false);
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
  function handleGlobalKeydown(e: KeyboardEvent) {
    // 使用 e.code 以获得物理按键名称（如 Space, KeyE, Digit1）
    // 这样可以避免空格被识别为 " " 的问题
    const keyCode = e.code;

    // 当禁用分支气泡 UI 时：仍允许使用空格键选择分支走向
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

    // 当前无 UI 时无法切换焦点，这里约定“空格 = 选择第 1 个分支”。
    const chosen = pending.branches[0];

    console.log("[BranchHidden] Space choose branch", {
      state: pending.stateName,
      chosenText: chosen.text,
      chosenNextState: chosen.next_state,
      options: pending.branches.map((b) => ({ text: b.text, next_state: b.next_state })),
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

  async function init() {
    try {
      // 默认启用窗口级鼠标穿透
      await setClickThrough(true);
      // 启动鼠标位置轮询
      startCursorPolling();

      // 注册全局键盘监听器（仅在窗口聚焦时生效）
      window.addEventListener("keydown", handleGlobalKeydown);


      // 注册语言变更监听
      unsubLang = onLangChange(() => {
        _langVersion++;
      });
      await initI18n();

      // 加载用户设置
      const settings: UserSettings = await invoke("get_settings");
      showCharacter = settings.show_character;
      showBorder = settings.show_border;
      animationScale = settings.animation_scale;
      silenceMode = settings.silence_mode;
      userNickname = settings.nickname || "User";

      // 实时同步初始鼠标穿透状态（不修改逻辑，仅保持之前状态）
      if (silenceMode) {
        await setClickThrough(true);
      }

      // 触发初始布局与位置同步
      await syncDisplayMode(showCharacter);

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
        async (event) => {
          const payload = event.payload;

          // 只更新存在的字段（兼容部分更新）
          if ("show_character" in payload) {
            showCharacter = payload.show_character;
          }
          if ("show_border" in payload) {
            showBorder = payload.show_border;
          }
          if ("silence_mode" in payload) {
            silenceMode = payload.silence_mode;
          }
          if ("animation_scale" in payload) {
            animationScale = payload.animation_scale;
          }
          if ("nickname" in payload) {
            userNickname = payload.nickname || "User";
          }

          // 动态加载边框 (如果之前未加载且现在启用了)
          if (showBorder && !borderAnimator && borderCanvas) {
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
          }
          // 重新显示时恢复位置
          await syncDisplayMode(showCharacter);
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

      // 启动桌面会话检测（包含特殊日期判断）
      // 检测到后会自动触发：birthday、firstday、login 或 login_silence
      console.log("[Animation] 启动桌面会话检测（包含特殊日期判断）");
      await invoke("start_login_detection");

      // 检查当前是否加载了 Mod
      const currentMod: any = await invoke("get_current_mod");
      noMod = !currentMod;

      // ---------------------------------------------------------------------
      // Mod 数据面板初始化
      // ---------------------------------------------------------------------
      showModDataPanel = Boolean(currentMod?.manifest?.show_mod_data_panel);
      if (showModDataPanel) {
        try {
          const data = await invoke<ModData | null>("get_current_mod_data");
          applyModDataUpdate(data);
        } catch {
          applyModDataUpdate(null);
        }

        // 监听后端广播的 Mod 数据更新
        unlistenModData = await listen<ModData>("mod-data-changed", (event) => {
          applyModDataUpdate(event.payload);
        });
      }


      // ---------------------------------------------------------------------
      // 布局调试监听
      // ---------------------------------------------------------------------

      // 响应布局信息请求
      await listen("request-layout-info", () => {
        const info = [];
        const getInfo = (el: HTMLElement | HTMLCanvasElement, name: string) => {
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

        const charInfo = getInfo(characterCanvas, "character");
        if (charInfo) info.push(charInfo);

        const borderInfo = getInfo(borderCanvas, "border");
        if (borderInfo) info.push(borderInfo);

        // 获取气泡区域信息
        const bubbleAreaEl = document.querySelector(
          ".bubble-area",
        ) as HTMLElement;
        const bubbleAreaInfo = getInfo(bubbleAreaEl, "bubbleArea");
        if (bubbleAreaInfo) info.push(bubbleAreaInfo);

        // 获取具体气泡内容信息 (尝试查找 .bubble 元素)
        const bubbleEl = document.querySelector(".bubble") as HTMLElement;
        const bubbleInfo = getInfo(bubbleEl, "bubbleCanvas");
        if (bubbleInfo) info.push(bubbleInfo);

        emit("layout-info", info);
      });

      // 响应调试边框切换
      await listen<boolean>("toggle-debug-borders", (event) => {
        debugBordersEnabled = event.payload;
        if (debugBordersEnabled) {
          const rc = () => `hsl(${Math.random() * 360}, 100%, 50%)`;
          debugColors = {
            bubble: rc(),
            animation: rc(),
            character: rc(),
            border: rc(),
          };
        }
      });

      // 响应调试页签状态，非调试状态下强制关闭边框显示
      await listen<boolean>("layout-debugger-status", (event) => {
        const isTabActive = event.payload;
        if (!isTabActive) {
          debugBordersEnabled = false;
        }
      });
    } catch (e) {
      console.error("Failed to init:", e);
      noMod = true;
    }
  }

  /**
   * 核心显示与位置同步逻辑
   * @param show 是否显示挂件
   */
  async function syncDisplayMode(show: boolean) {
    const currentWindow = getCurrentWindow();
    if (!show) {
      // 【隐藏模式】：移动到托盘上方默认位置备用（气泡弹出时会精确修正）
      try {
        const [physX, physY] =
          await invoke<[number, number]>("get_tray_position");
        const scale = await currentWindow.scaleFactor();
        const { width } = await currentWindow.innerSize();

        // 目标 X 对齐中轴线：(物理中心 - 物理宽度 / 2) / 比例
        const logicalX = (physX - width / 2) / scale;
        const logicalY = physY / scale - 300 - TRAY_ADAPTIVE_OFFSET_Y;

        await currentWindow.setPosition(
          new LogicalPosition(logicalX, logicalY),
        );
        // console.log(
        //   `[Layout] Sunk to tray centered via API: (${logicalX}, ${logicalY})`,
        // );
      } catch (err) {
        console.warn("[Layout] Failed to move to tray:", err);
      }
    } else {
      // 【显示模式】：将窗口恢复到用户保存的桌面位置
      try {
        const [savedX, savedY] = await invoke<[number | null, number | null]>(
          "get_saved_window_position",
        );
        if (savedX !== null && savedY !== null) {
          // savedY 在存储中是动画区域顶部坐标，窗口顶部 = savedY - 300
          await currentWindow.setPosition(
            new LogicalPosition(savedX, savedY - 300),
          );
          // console.log(`[Layout] Restored to saved: (${savedX}, ${savedY})`);
        }
      } catch (err) {
        console.warn("[Layout] Failed to restore saved position:", err);
      }
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
    // 进入新状态时，清理上一轮可能残留的“无气泡分支选择”上下文
    pendingBranchSelection = null;

    isPlayOnce = playOnce;
    animationComplete = false;
    audioComplete = false;
    bubbleComplete = false;


    // 开始播放动画
    await playAnimation(state.anima, playOnce);

    // 开始播放音频
    if (audioManager && state.audio) {
      if (!playOnce) {
        // 循环播放模式：立即标记音频完成，不等待
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
        // 单次播放模式：等待播放完成
        audioManager.play(state.audio, () => {
          audioComplete = true;
          checkComplete();
        });
      }
    } else {
      // 无音频，直接标记完成
      audioComplete = true;
      checkComplete();
    }

    // 显示气泡 (仅在临时状态下显示，或具有分支时显示)
    // 根据用户要求：切换至持久状态时，禁止显示气泡
    if (playOnce && (state.text || (state.branch && state.branch.length > 0))) {
      await showBubble(state);
    } else {
      // 如果是持久状态，且气泡管理器存在，则确保隐藏之前的气泡
      if (!playOnce) {
        bubbleManager?.hide();
      }
      // 无气泡需求，直接标记完成
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
      // 每次播放气泡时，若悬浮挂件隐藏，则尝试定位托盘并移动
      if (!showCharacter) {
        await syncDisplayMode(false);
      }

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
          // 替换昵称占位符 {nickname}
          textContent = textContent.replace(/\{nickname\}/g, userNickname);

          // 使用配置的duration（秒），转换为毫秒，如果未配置则默认10秒
          textDuration = (textInfo.duration ?? 10) * 1000;
        }
      }

      // 处理分支选项：将 branch.text 作为索引获取实际文本
      let processedBranches: BranchInfo[] = [];
      if (state.branch && state.branch.length > 0) {
        const settings = await invoke<{ lang: string }>("get_settings");
        const lang = settings.lang || "zh";
        
        for (const branch of state.branch) {
          // 调用 get_text_by_name 获取实际文本
          const textInfo = await invoke<{
            text: string;
            duration?: number;
          } | null>("get_text_by_name", {
            lang: lang,
            name: branch.text,
          });
          
          // 如果获取成功，使用实际文本；否则使用原 text
          const actualText = textInfo?.text || branch.text;
          
          processedBranches.push({
            text: actualText,
            next_state: branch.next_state,
          });
        }
      }

      // 是否显示分支气泡 UI（默认 true）
      const showBranchBubble = state.branch_show_bubble !== false;

      // 若禁用分支气泡 UI，则仍保存分支上下文以支持空格选择
      if (!showBranchBubble && processedBranches.length > 0) {
        pendingBranchSelection = {
          stateName: state.name,
          branches: processedBranches,
        };
        console.log("[showBubble] Branch bubble disabled; press Space to choose", {
          state: state.name,
          branches: processedBranches.map((b) => ({ text: b.text, next_state: b.next_state })),
        });
      } else {
        pendingBranchSelection = null;
      }

      // 构建气泡配置（禁用分支 UI 时不渲染按钮）
      const bubbleConfig: BubbleConfig = {
        text: textContent,
        branches: showBranchBubble ? processedBranches : [],
        position: "top",
        typeSpeed: 50,
        duration: textDuration,
      };

      // 如果既没有文本也没有分支 UI，就不展示气泡，直接完成
      if (!bubbleConfig.text && (!bubbleConfig.branches || bubbleConfig.branches.length === 0)) {
        bubbleManager?.hide();
        bubbleComplete = true;
        checkComplete();
        return;
      }

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

    console.log("[handleBranchSelect] Selected branch", {
      source: "bubbleUI",
      chosenText: branch.text, // 此时已经是实际文本（已被 get_text_by_name 解析）
      chosenNextState: branch.next_state,
      pendingState: pendingBranchSelection?.stateName,
      pendingOptions: pendingBranchSelection?.branches?.map((b) => ({
        text: b.text,
        next_state: b.next_state,
      })),
      ts: Date.now(),
    });


    try {
      // 设置下一个待切换状态（当前状态播放完毕后自动切换）
      await invoke("set_next_state", { name: branch.next_state });
      // 通知调试面板 next_state 已更新
      emit("next-state-changed", { name: branch.next_state });

      // 结束“无气泡分支选择”上下文（若存在）
      pendingBranchSelection = null;

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
  let isBubbleVisible = $state(false);

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
        // 免打扰模式下，直接启用窗口全穿透
        if (silenceMode) {
          await setClickThrough(true);
          return;
        }

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
  async function handleMouseUp(e: MouseEvent) {
    if (e.button === 0) {
      if (isMouseDown && !isDragging) {
        // 点击事件：触发 click 触发器
        triggerManager?.trigger("click");
        // 记录点击事件到统计
        try {
          await invoke("record_click_event");
        } catch (err) {
          console.error("Failed to record click event:", err);
        }
      }
      isMouseDown = false;
      isDragging = false;
    }
  }

  /**
   * 右键菜单事件处理
   *
   * 阻止浏览器默认菜单，并调用 Tauri 命令弹出与托盘一致的原生菜单
   */
  async function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    try {
      await invoke("show_context_menu");
    } catch (err) {
      console.error("Failed to show context menu:", err);
    }
  }

  // =========================================================================
  // 生命周期
  // =========================================================================

  // 组件挂载时初始化
  onMount(() => init());

  // 组件销毁时清理资源
  onDestroy(() => {
    window.removeEventListener("keydown", handleGlobalKeydown);
    stopCursorPolling();
    characterAnimator?.destroy();
    borderAnimator?.destroy();
    audioManager?.destroy();
    triggerManager?.destroy();
    unlistenState?.();
    unlistenSettings?.();
    unlistenPlaybackReq?.();
    unlistenModData?.();
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
<div
  class="container"
  class:debug-border-active={debugBordersEnabled}
  oncontextmenu={handleContextMenu}
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
      on:branchSelect={handleBranchSelect}
      on:close={handleBubbleClose}
      on:show={handleBubbleShow}
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
      onmousedown={handleMouseDown}
      onmousemove={handleMouseMove}
      onmouseup={handleMouseUp}
    ></canvas>

    <!-- 边框动画 Canvas -->
    <canvas
      class="border-canvas"
      class:hidden={!showCharacter || !showBorder}
      style="z-index: {borderZOffset}; outline: {debugBordersEnabled
        ? '2px solid ' + debugColors.border
        : 'none'}; outline-offset: -2px;"
      bind:this={borderCanvas}
    ></canvas>

    <!-- 当前 Mod 数据（左上角，仅数值 + 变化上漂提示） -->
    {#if showModDataPanel}
      <div class="mod-data-hud" aria-label="mod-data-value">
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
