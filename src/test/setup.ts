import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// ============================================================================
// DOM / 浏览器 API 基础补丁
// ============================================================================

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    return setTimeout(() => cb(Date.now()), 0) as unknown as number;
  };
}

if (!globalThis.cancelAnimationFrame) {
  globalThis.cancelAnimationFrame = (id: number) => {
    clearTimeout(id);
  };
}

if (!globalThis.ResizeObserver) {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error: global mock
  globalThis.ResizeObserver = ResizeObserverMock;
}

if (!globalThis.IntersectionObserver) {
  class IntersectionObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error: global mock
  globalThis.IntersectionObserver = IntersectionObserverMock;
}

if (!window.matchMedia) {
  window.matchMedia = (query: string) => {
    return {
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as MediaQueryList;
  };
}

if (!HTMLCanvasElement.prototype.getContext) {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as unknown as (
    contextId: string,
  ) => RenderingContext | null;
}

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}

if (!window.scrollTo) {
  window.scrollTo = () => {};
}

if (!globalThis.crypto) {
  // @ts-expect-error: global mock
  globalThis.crypto = {};
}

if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = () => `uuid-${Math.random().toString(16).slice(2)}`;
}

// ============================================================================
// Tauri API Mock
// ============================================================================

const mockInvoke = vi.fn(async (command: string) => {

  switch (command) {
    case "get_mod_search_paths":
    case "get_available_mods":
    case "get_memos":
    case "get_reminders":
    case "take_pending_reminder_alerts":
    case "get_all_states":
    case "get_all_triggers":
      return [];
    case "get_current_mod":
    case "get_mod_details":
    case "load_mod":
    case "load_mod_from_path":
    case "get_tbuddy_source_path":
    case "get_user_info":
    case "get_system_debug_info":
    case "get_process_debug_info":
    case "get_media_debug_info":
    case "get_current_state":
    case "get_persistent_state":
    case "get_next_state":
    case "get_weather_info":
    case "get_location_info":
      return null;
    case "get_datetime_info":
      return {
        year: 2026,
        month: 2,
        day: 22,
        hour: 10,
        minute: 30,
        second: 0,
        weekday: 0,
        timestamp: 1766428200,
      };
    case "get_season_info":
      return "winter";
    case "get_time_period_info":
      return "morning";

    case "get_settings":
      return {};
    case "is_state_locked":
    case "is_sbuddy_supported":
      return false;
    case "trigger_event":
    case "change_state":
    case "force_change_state":
    case "update_user_info":
    case "update_settings":
    case "open_path":
    case "open_dir":
    case "open_storage_dir":
    case "set_animation_scale":
    case "set_volume":
    case "set_mute":
    case "reset_animation_window_position":
    case "set_reminders":
    case "set_memos":
    case "export_mod_as_sbuddy":
      return true;
    case "import_mod_from_path_detailed":
      return { id: "", extractedPath: "" };
    case "get_mod_path":
      return "";
    case "get_env_var":
      return null;
    case "get_const_int":
      return {};
    case "get_bubble_style":
      return null;
    default:
      return null;
  }
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
  convertFileSrc: (path: string) => path,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({
  LogicalPosition: class {
    x: number;
    y: number;
    constructor(x: number, y: number) {
      this.x = x;
      this.y = y;
    }
  },
  cursorPosition: vi.fn(async () => ({ x: 0, y: 0 })),
  getCurrentWindow: vi.fn(() => ({
    setTitle: vi.fn(),
    setSize: vi.fn(),
    setPosition: vi.fn(),
    startDragging: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    isVisible: vi.fn(async () => true),
    setAlwaysOnTop: vi.fn(),
    setCursorIcon: vi.fn(),
    setDecorations: vi.fn(),
    setResizable: vi.fn(),
    setSkipTaskbar: vi.fn(),
    setIgnoreCursorEvents: vi.fn(),
    setFocus: vi.fn(),
    requestUserAttention: vi.fn(),
  })),
}));


vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "0.0.0-test"),
}));

vi.mock("@tauri-apps/api/path", () => ({
  resolveResource: vi.fn(async (path: string) => path),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: vi.fn(),
}));

// ============================================================================
// 动画/窗口模块 Mock（避免 WebGL/Canvas 重依赖）
// ============================================================================

const createWindowCoreMock = vi.fn((options?: unknown) => {
  const core = {
    init: vi.fn(async () => {}),
    destroy: vi.fn(),
    handleContextMenu: vi.fn(),
    handleBranchSelect: vi.fn(),
    handleBubbleClose: vi.fn(),
    handleBubbleShow: vi.fn(),
    handleMouseDown: vi.fn(),
  };
  (globalThis as any).__lastWindowCore = core;
  (globalThis as any).__lastWindowCoreOptions = options ?? null;
  return core;
});


vi.mock("$lib/animation/WindowCore", () => ({
  createWindowCore: createWindowCoreMock,
}));


class BasePlayerMock {
  init = vi.fn(async () => {});
  load = vi.fn(async () => {});
  destroy = vi.fn();
  setVisible = vi.fn();
  setAnimationScale = vi.fn();
  setTransitionDuration = vi.fn();
  setDebugMode = vi.fn();
  setFeatureFlags = vi.fn();
  setBackgroundLayersByEvent = vi.fn();
  getDebugInfo = vi.fn(() => ({
    finalScale: 1,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    baseFitScale: 1,
  }));
  playFromAnima = vi.fn(async () => true);
  isPixelOpaqueAtScreen = vi.fn(() => false);
  updateGlobalMouseFollow = vi.fn();
  debugPan = vi.fn();
  debugZoom = vi.fn();
  debugReset = vi.fn();
  triggerClickBounce = vi.fn();
}

vi.mock("$lib/animation/Live2DPlayer", () => ({
  Live2DPlayer: class Live2DPlayerMock extends BasePlayerMock {
    constructor(...args: any[]) {
      super(...args);
      (globalThis as any).__lastLive2DPlayer = this;
    }
  },
}));

vi.mock("$lib/animation/ThreeDPlayer", () => ({
  ThreeDPlayer: class ThreeDPlayerMock extends BasePlayerMock {
    constructor(...args: any[]) {
      super(...args);
      (globalThis as any).__lastThreeDPlayer = this;
    }
  },
}));

vi.mock("$lib/animation/PngRemixPlayer", () => ({
  PngRemixPlayer: class PngRemixPlayerMock extends BasePlayerMock {
    constructor(...args: any[]) {
      super(...args);
      (globalThis as any).__lastPngRemixPlayer = this;
    }
  },
}));


vi.mock("$lib/animation/SpriteAnimator", () => {
  class SpriteAnimatorMock {}
  SpriteAnimatorMock.prototype.setCanvasFit = vi.fn();
  SpriteAnimatorMock.prototype.switchToAsset = vi.fn(async () => true);
  SpriteAnimatorMock.prototype.loadByAssetName = vi.fn(async () => true);
  SpriteAnimatorMock.prototype.play = vi.fn();
  SpriteAnimatorMock.prototype.destroy = vi.fn();

  return {
    SpriteAnimator: SpriteAnimatorMock,
    getMemoryLogs: vi.fn(() => []),
    exportMemoryLogsCSV: vi.fn(() => ""),
    getCacheStats: vi.fn(() => ({ cacheSize: 0, alwaysCacheSize: 0 })),
    initMemoryDebug: vi.fn(async () => false),
    clearImageCache: vi.fn(),
  };
});

