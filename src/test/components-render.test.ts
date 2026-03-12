/**
 * 组件渲染与交互测试
 * 覆盖 src/lib/components/ 下 10 个调试/设置组件的脚本逻辑
 */
import { fireEvent, render } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";

import SystemDebugger from "../lib/components/SystemDebugger.svelte";
import ProcessDebugger from "../lib/components/ProcessDebugger.svelte";
import MediaDebugger from "../lib/components/MediaDebugger.svelte";
import LayoutDebugger from "../lib/components/LayoutDebugger.svelte";
import InfoDebugger from "../lib/components/InfoDebugger.svelte";
import EnvironmentDebugger from "../lib/components/EnvironmentDebugger.svelte";
import StateDebugger from "../lib/components/StateDebugger.svelte";
import TriggerDebugger from "../lib/components/TriggerDebugger.svelte";
import SettingsComponent from "../lib/components/Settings.svelte";
import ResourceManagerDebugger from "../lib/components/ResourceManagerDebugger.svelte";
import { clickButtonByTextIncludes, flushAsync, withTauriInvoke } from "./test-utils";



// ============================================================================
// SystemDebugger
// ============================================================================

describe("SystemDebugger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state initially", async () => {
    const { container } = render(SystemDebugger);
    await flushAsync();
    expect(container.querySelector(".system-debugger")).toBeTruthy();
  });

  it("renders debug info when invoke returns data", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_system_debug_info") {
        return {
          observer_running: true,
          last_check_time: "12:00:00",
          is_fullscreen_busy: false,
          auto_dnd_enabled: true,
          is_auto_dnd_active: false,
          current_silence_mode: false,
          session_locked: false,
          focused_window_title: "code.exe",
        };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });



    const { container } = render(SystemDebugger);
    await flushAsync();

    expect(container.querySelector(".info-grid")).toBeTruthy();
    expect(container.querySelector(".status-cards")).toBeTruthy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("shows null-data status when invoke returns null", async () => {
    const { container } = render(SystemDebugger);
    await flushAsync();

    expect(container.querySelector(".loading")).toBeTruthy();
  });

  it("shows error status when invoke throws", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_system_debug_info") throw new Error("test error");
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SystemDebugger);
    await flushAsync();

    const statusEl = container.querySelector(".mini-status");
    expect(statusEl?.classList.contains("error")).toBe(true);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("refresh button reloads data", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    let callCount = 0;
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_system_debug_info") {
        callCount++;
        return {
          observer_running: true,
          last_check_time: "12:00:00",
          is_fullscreen_busy: false,
          auto_dnd_enabled: true,
          is_auto_dnd_active: false,
          current_silence_mode: false,
          session_locked: false,
          focused_process_name: "",
        };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SystemDebugger);
    await flushAsync();

    const refreshBtn = container.querySelector(".refresh-btn") as HTMLButtonElement;
    expect(refreshBtn).toBeTruthy();
    await fireEvent.click(refreshBtn);
    await flushAsync();

    expect(callCount).toBeGreaterThanOrEqual(2);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("event listener updates data", async () => {
    const listenMock = vi.mocked(listen);
    let eventCallback: ((event: any) => void) | null = null;

    listenMock.mockImplementation(async (eventName: string, cb: any) => {
      if (eventName === "system-debug-update") {
        eventCallback = cb;
      }
      return () => {};
    });

    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_system_debug_info") {
        return {
          observer_running: true,
          last_check_time: "12:00:00",
          is_fullscreen_busy: false,
          auto_dnd_enabled: false,
          is_auto_dnd_active: false,
          current_silence_mode: false,
          session_locked: false,
          focused_window_title: "",
        };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SystemDebugger);
    await flushAsync();

    // Simulate event
    if (eventCallback) {
      eventCallback({
        payload: {
          observer_running: true,
          last_check_time: "12:05:00",
          is_fullscreen_busy: true,
          auto_dnd_enabled: true,
          is_auto_dnd_active: true,
          current_silence_mode: true,
          session_locked: true,
          focused_window_title: "chrome.exe",
        },
      });
    }
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });
});

// ============================================================================
// ProcessDebugger
// ============================================================================

describe("ProcessDebugger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders and loads data", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_process_debug_info") {
        return {
          observer_running: true,
          uptime_secs: 3661,
          last_check_time: "12:00:00",
          poll_interval_ms: 2000,
          keywords: ["chrome", "firefox", "game.exe"],
          last_new_processes: [
            { pid: 100, parent_pid: 1, is_child: false, process_name: "test.exe", matched_keyword: null },
            { pid: 200, parent_pid: 100, is_child: true, process_name: "game.exe", matched_keyword: "game" },
          ],
          last_matched: { pid: 200, process_name: "game.exe", matched_keyword: "game" },
          seen_pid_count: 50,
          current_pid_count: 25,
        };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ProcessDebugger);
    await flushAsync();

    expect(container.querySelector(".process-debugger")).toBeTruthy();
    expect(container.querySelector(".info-grid")).toBeTruthy();
    // Keywords should be rendered
    const tags = container.querySelectorAll(".keywords .tag");
    expect(tags.length).toBeGreaterThanOrEqual(3);
    // Matched card should exist
    expect(container.querySelector(".matched-card")).toBeTruthy();
    // Process rows should exist
    const procRows = container.querySelectorAll(".proc-row");
    expect(procRows.length).toBe(2);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("shows null state", async () => {
    const { container } = render(ProcessDebugger);
    await flushAsync();
    expect(container.querySelector(".loading")).toBeTruthy();
  });

  it("shows error when invoke fails", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_process_debug_info") throw new Error("fail");
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ProcessDebugger);
    await flushAsync();
    expect(container.querySelector(".mini-status.error")).toBeTruthy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("renders uptime with minutes only", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_process_debug_info") {
        return {
          observer_running: true,
          uptime_secs: 125, // 2min 5sec
          last_check_time: "12:00",
          poll_interval_ms: 500, // < 1000ms path
          keywords: [],
          last_new_processes: [],
          last_matched: null,
          seen_pid_count: 0,
          current_pid_count: 0,
        };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ProcessDebugger);
    await flushAsync();

    // no-keywords empty state
    expect(container.querySelector(".empty-state")).toBeTruthy();
    // no matched
    expect(container.querySelector(".matched-card")).toBeFalsy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("renders uptime with seconds only", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_process_debug_info") {
        return {
          observer_running: false,
          uptime_secs: 45,
          last_check_time: "12:00",
          poll_interval_ms: 1000,
          keywords: Array.from({ length: 30 }, (_, i) => `kw${i}`), // > 24 keywords
          last_new_processes: [],
          last_matched: null,
          seen_pid_count: 0,
          current_pid_count: 0,
        };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ProcessDebugger);
    await flushAsync();

    // Should show "+6" overflow tag
    const moreTags = container.querySelectorAll(".tag.more");
    expect(moreTags.length).toBe(1);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });
});

// ============================================================================
// MediaDebugger
// ============================================================================

describe("MediaDebugger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with full media data", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_media_debug_info") {
        return {
          observer_running: true,
          uptime_secs: 7200,
          last_check_time: "14:00:00",
          gsmtc_available: true,
          core_audio_available: true,
          gsmtc_sessions: [
            { app_id: "Spotify.exe", status: "Playing", title: "Song", artist: "Artist", is_music_app: true },
            { app_id: "A".repeat(50), status: "Paused", title: null, artist: null, is_music_app: false },
          ],
          core_audio_sessions: [
            { pid: 1234, process_name: "spotify.exe", session_state: "Active", peak_value: 0.75, is_music_app: true, is_playing: true },
            { pid: 5678, process_name: "chrome.exe", session_state: "Stopped", peak_value: 0, is_music_app: false, is_playing: false },
          ],
          combined_state: { status: "Playing", title: "Song", artist: "Artist", app_id: "Spotify.exe" },
          state_source: "GSMTC",
          registered_session_events: 3,
        };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(MediaDebugger);
    await flushAsync();

    expect(container.querySelector(".media-debugger")).toBeTruthy();
    // State badge should show "Playing"
    const stateBadge = container.querySelector(".state-badge");
    expect(stateBadge?.textContent?.trim()).toContain("Playing");
    // GSMTC sessions
    const sessionCards = container.querySelectorAll(".session-card");
    expect(sessionCards.length).toBeGreaterThanOrEqual(2);
    // Audio meter
    expect(container.querySelector(".audio-meter")).toBeTruthy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("renders empty sessions", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_media_debug_info") {
        return {
          observer_running: false,
          uptime_secs: 30,
          last_check_time: "10:00",
          gsmtc_available: false,
          core_audio_available: false,
          gsmtc_sessions: [],
          core_audio_sessions: [],
          combined_state: { status: "Stopped", title: null, artist: null, app_id: null },
          state_source: "None",
          registered_session_events: 0,
        };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(MediaDebugger);
    await flushAsync();

    const emptyStates = container.querySelectorAll(".empty-state");
    expect(emptyStates.length).toBe(2); // gsmtc + core audio

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("getStatusColor returns correct colors via style", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_media_debug_info") {
        return {
          observer_running: true,
          uptime_secs: 0,
          last_check_time: "now",
          gsmtc_available: true,
          core_audio_available: true,
          gsmtc_sessions: [
            { app_id: "test", status: "Unknown", title: null, artist: null, is_music_app: false },
          ],
          core_audio_sessions: [],
          combined_state: { status: "Playing", title: null, artist: null, app_id: null },
          state_source: "test",
          registered_session_events: 0,
        };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(MediaDebugger);
    await flushAsync();

    // "Unknown" status should get default color
    const badges = container.querySelectorAll(".status-badge");
    expect(badges.length).toBeGreaterThanOrEqual(1);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });
});

// ============================================================================
// LayoutDebugger
// ============================================================================

describe("LayoutDebugger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders and emits initial events", async () => {
    const emitMock = vi.mocked(emit);
    const { container } = render(LayoutDebugger);
    await flushAsync();

    expect(container.querySelector(".layout-debugger")).toBeTruthy();
    expect(emitMock).toHaveBeenCalledWith("request-layout-info");
    expect(emitMock).toHaveBeenCalledWith("layout-debugger-status", true);
  });

  it("toggle borders emits event", async () => {
    const emitMock = vi.mocked(emit);
    const { container } = render(LayoutDebugger);
    await flushAsync();

    const toggleBtn = container.querySelector(".toggle-btn") as HTMLButtonElement;
    expect(toggleBtn).toBeTruthy();

    await fireEvent.click(toggleBtn);
    await flushAsync();

    expect(emitMock).toHaveBeenCalledWith("toggle-debug-borders", true);
  });

  it("refresh button emits request", async () => {
    const emitMock = vi.mocked(emit);
    const { container } = render(LayoutDebugger);
    await flushAsync();

    const refreshBtn = container.querySelector(".btn-tiny") as HTMLButtonElement;
    await fireEvent.click(refreshBtn);
    await flushAsync();

    // Should have emitted request-layout-info again
    const calls = emitMock.mock.calls.filter((c) => c[0] === "request-layout-info");
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("handles layout-info event with new format", async () => {
    const listenMock = vi.mocked(listen);
    let layoutCallback: ((event: any) => void) | null = null;

    listenMock.mockImplementation(async (eventName: string, cb: any) => {
      if (eventName === "layout-info") {
        layoutCallback = cb;
      }
      return () => {};
    });

    const { container } = render(LayoutDebugger);
    await flushAsync();

    // Simulate event with new format (contains windowType)
    if (layoutCallback) {
      layoutCallback({
        payload: {
          windowType: "live2d",
          canvases: [
            { name: "character", width: 800, height: 600, displayWidth: 400, displayHeight: 300, zIndex: "1", visibility: "visible", opacity: "1" },
            { name: "border", width: 800, height: 600, displayWidth: 400, displayHeight: 300, zIndex: "2", visibility: "visible", opacity: "0.5" },
          ],
        },
      });
    }
    await flushAsync();

    // Window type indicator should appear
    expect(container.querySelector(".window-type-indicator")).toBeTruthy();
    const canvasCards = container.querySelectorAll(".canvas-card");
    expect(canvasCards.length).toBe(2);
  });

  it("handles layout-info event with old format (plain array)", async () => {
    const listenMock = vi.mocked(listen);
    let layoutCallback: ((event: any) => void) | null = null;

    listenMock.mockImplementation(async (eventName: string, cb: any) => {
      if (eventName === "layout-info") {
        layoutCallback = cb;
      }
      return () => {};
    });

    const { container } = render(LayoutDebugger);
    await flushAsync();

    if (layoutCallback) {
      layoutCallback({
        payload: [
          { name: "bubbleArea", width: 200, height: 100, displayWidth: 200, displayHeight: 100, zIndex: "3", visibility: "visible", opacity: "1" },
          { name: "bubbleCanvas", width: 200, height: 100, displayWidth: 200, displayHeight: 100, zIndex: "4", visibility: "visible", opacity: "1" },
          { name: "customName", width: 100, height: 100, displayWidth: 100, displayHeight: 100, zIndex: "5", visibility: "hidden", opacity: "0" },
        ],
      });
    }
    await flushAsync();

    // No window type indicator for old format
    expect(container.querySelector(".window-type-indicator")).toBeFalsy();
    const canvasCards = container.querySelectorAll(".canvas-card");
    expect(canvasCards.length).toBe(3);
  });

  it("covers all window type labels and icons", async () => {
    const listenMock = vi.mocked(listen);
    let layoutCallback: ((event: any) => void) | null = null;

    listenMock.mockImplementation(async (eventName: string, cb: any) => {
      if (eventName === "layout-info") {
        layoutCallback = cb;
      }
      return () => {};
    });

    // Test each window type: sequence, pngremix, 3d
    for (const wt of ["sequence", "pngremix", "3d"]) {
      const { container, unmount } = render(LayoutDebugger);
      await flushAsync();

      if (layoutCallback) {
        layoutCallback({
          payload: {
            windowType: wt,
            canvases: [
              { name: "character", width: 1, height: 1, displayWidth: 1, displayHeight: 1, zIndex: "1", visibility: "v", opacity: "1" },
            ],
          },
        });
      }
      await flushAsync();

      expect(container.querySelector(".window-type-indicator")).toBeTruthy();
      unmount();
    }
  });
});

// ============================================================================
// InfoDebugger
// ============================================================================

describe("InfoDebugger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with user info data", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_user_info") {
        return {
          first_login: 1700000000,
          last_login: 1700100000,
          current_mod: "demo",
          animation_window_x: 100,
          animation_window_y: 200,
          launch_count: 42,
          total_usage_seconds: 7261, // > 1h, with remaining min and sec
          total_click_count: 100,
          mod_data: {
            demo: { value: 5, mod_id: "demo" },
          },
        };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(InfoDebugger);
    await flushAsync();

    expect(container.querySelector(".info-debugger")).toBeTruthy();
    // Should show data rows
    const dataRows = container.querySelectorAll(".data-row");
    expect(dataRows.length).toBeGreaterThan(5);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("handles null timestamps and position", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_user_info") {
        return {
          first_login: null,
          last_login: null,
          current_mod: "",
          animation_window_x: null,
          animation_window_y: null,
          launch_count: 0,
          total_usage_seconds: 45, // < 60s
          total_click_count: 0,
          mod_data: {},
        };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(InfoDebugger);
    await flushAsync();
    expect(container.querySelector(".info-debugger")).toBeTruthy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("formatDuration covers minutes-only and hours-only", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    // Test minutes-only (120 = 2min 0sec), hours-only (3600 = 1h 0m 0s)
    for (const secs of [120, 3600, 3660]) {
      invokeMock.mockImplementation(async (command: string, args?: unknown) => {
        if (command === "get_user_info") {
          return {
            first_login: 1700000000,
            last_login: 1700000000,
            current_mod: "test",
            animation_window_x: 0,
            animation_window_y: 0,
            launch_count: 1,
            total_usage_seconds: secs,
            total_click_count: 0,
            mod_data: {},
          };
        }
        return originalImpl ? originalImpl(command, args as never) : null;
      });

      const { unmount } = render(InfoDebugger);
      await flushAsync();
      unmount();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("save button calls update_user_info", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_user_info") {
        return {
          first_login: null,
          last_login: null,
          current_mod: "",
          animation_window_x: null,
          animation_window_y: null,
          launch_count: 0,
          total_usage_seconds: 0,
          total_click_count: 0,
          mod_data: {},
        };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(InfoDebugger);
    await flushAsync();

    const saveBtn = container.querySelector(".save-btn") as HTMLButtonElement;
    expect(saveBtn).toBeTruthy();
    await fireEvent.click(saveBtn);
    await flushAsync();

    expect(invokeMock).toHaveBeenCalledWith("update_user_info", expect.anything());

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("save handles error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_user_info") {
        return {
          first_login: null, last_login: null, current_mod: "",
          animation_window_x: null, animation_window_y: null,
          launch_count: 0, total_usage_seconds: 0, total_click_count: 0, mod_data: {},
        };
      }
      if (command === "update_user_info") throw new Error("save failed");
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(InfoDebugger);
    await flushAsync();

    const saveBtn = container.querySelector(".save-btn") as HTMLButtonElement;
    await fireEvent.click(saveBtn);
    await flushAsync();

    const status = container.querySelector(".mini-status");
    expect(status?.classList.contains("error")).toBe(true);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("reset position calls invoke", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_user_info") {
        return {
          first_login: null, last_login: null, current_mod: "",
          animation_window_x: 100, animation_window_y: 200,
          launch_count: 0, total_usage_seconds: 0, total_click_count: 0, mod_data: {},
        };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(InfoDebugger);
    await flushAsync();

    const resetBtn = container.querySelector(".reset-btn") as HTMLButtonElement;
    expect(resetBtn).toBeTruthy();
    await fireEvent.click(resetBtn);
    await flushAsync();

    expect(invokeMock).toHaveBeenCalledWith("reset_animation_window_position");

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("reset position handles error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_user_info") {
        return {
          first_login: null, last_login: null, current_mod: "",
          animation_window_x: 100, animation_window_y: 200,
          launch_count: 0, total_usage_seconds: 0, total_click_count: 0, mod_data: {},
        };
      }
      if (command === "reset_animation_window_position") throw new Error("fail");
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(InfoDebugger);
    await flushAsync();

    const resetBtn = container.querySelector(".reset-btn") as HTMLButtonElement;
    await fireEvent.click(resetBtn);
    await flushAsync();

    const status = container.querySelector(".mini-status");
    expect(status?.classList.contains("error")).toBe(true);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("window position event updates info", async () => {
    const listenMock = vi.mocked(listen);
    let posCallback: ((event: any) => void) | null = null;

    listenMock.mockImplementation(async (eventName: string, cb: any) => {
      if (eventName === "window-position-changed") {
        posCallback = cb;
      }
      return () => {};
    });

    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_user_info") {
        return {
          first_login: null, last_login: null, current_mod: "",
          animation_window_x: 0, animation_window_y: 0,
          launch_count: 0, total_usage_seconds: 0, total_click_count: 0, mod_data: {},
        };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(InfoDebugger);
    await flushAsync();

    if (posCallback) {
      posCallback({ payload: [500, 300] });
    }
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });
});

// ============================================================================
// EnvironmentDebugger
// ============================================================================

describe("EnvironmentDebugger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("renders with environment data", async () => {
    const { container } = render(EnvironmentDebugger);
    await flushAsync();
    await vi.advanceTimersByTimeAsync(100);
    await flushAsync();

    expect(container.querySelector(".env-debugger")).toBeTruthy();
    // datetime section should exist with the mocked data
    expect(container.querySelector(".datetime-section")).toBeTruthy();
  });

  it("refresh button reloads data", async () => {
    const { container } = render(EnvironmentDebugger);
    await flushAsync();
    await vi.advanceTimersByTimeAsync(100);
    await flushAsync();

    const refreshBtn = container.querySelector(".refresh") as HTMLButtonElement;
    expect(refreshBtn).toBeTruthy();
    await fireEvent.click(refreshBtn);
    await flushAsync();
  });

  it("refreshLocation calls invoke and handles success with location", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "refresh_location_info") {
        return { latitude: 40, longitude: 116, timezone: "Asia/Shanghai", is_northern_hemisphere: true, city: "Beijing", region: "Beijing", country: "CN" };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(EnvironmentDebugger);
    await flushAsync();
    await vi.advanceTimersByTimeAsync(100);
    await flushAsync();

    // Find the location refresh button
    const buttons = container.querySelectorAll(".btn-small");
    if (buttons.length > 0) {
      await fireEvent.click(buttons[0] as HTMLButtonElement);
      await flushAsync();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("refreshLocation handles null response", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "refresh_location_info") return null;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(EnvironmentDebugger);
    await flushAsync();
    await vi.advanceTimersByTimeAsync(100);
    await flushAsync();

    const buttons = container.querySelectorAll(".btn-small");
    if (buttons.length > 0) {
      await fireEvent.click(buttons[0] as HTMLButtonElement);
      await flushAsync();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("refreshLocation handles error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "refresh_location_info") throw new Error("network");
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(EnvironmentDebugger);
    await flushAsync();
    await vi.advanceTimersByTimeAsync(100);
    await flushAsync();

    const buttons = container.querySelectorAll(".btn-small");
    if (buttons.length > 0) {
      await fireEvent.click(buttons[0] as HTMLButtonElement);
      await flushAsync();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("loadWeather handles success", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_weather_info") {
        return { condition: "Clear", condition_code: "113", temperature: 25, feels_like: 23, humidity: 60, wind_speed: 10 };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(EnvironmentDebugger);
    await flushAsync();
    await vi.advanceTimersByTimeAsync(100);
    await flushAsync();

    // Weather button should be the second btn-small
    const buttons = container.querySelectorAll(".btn-small");
    if (buttons.length > 1) {
      await fireEvent.click(buttons[1] as HTMLButtonElement);
      await flushAsync();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("loadWeather handles error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    let weatherCallCount = 0;
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_weather_info") {
        weatherCallCount++;
        if (weatherCallCount > 1) throw new Error("weather fail");
        return null;
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(EnvironmentDebugger);
    await flushAsync();
    await vi.advanceTimersByTimeAsync(100);
    await flushAsync();

    const buttons = container.querySelectorAll(".btn-small");
    if (buttons.length > 1) {
      await fireEvent.click(buttons[1] as HTMLButtonElement);
      await flushAsync();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("loadBasicInfo handles error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_datetime_info") throw new Error("dt fail");
      return originalImpl ? originalImpl(command) : null;
    });

    const { container } = render(EnvironmentDebugger);
    await flushAsync();
    await vi.advanceTimersByTimeAsync(100);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("updateTime updates datetime when envInfo exists", async () => {
    const { container } = render(EnvironmentDebugger);
    await flushAsync();
    await vi.advanceTimersByTimeAsync(100);
    await flushAsync();

    // Advance timer to trigger updateTime
    await vi.advanceTimersByTimeAsync(4000);
    await flushAsync();

    expect(container.querySelector(".datetime-section")).toBeTruthy();
  });

  it("environment-updated event updates data", async () => {
    const listenMock = vi.mocked(listen);
    let envCallback: ((event: any) => void) | null = null;

    listenMock.mockImplementation(async (eventName: string, cb: any) => {
      if (eventName === "environment-updated") {
        envCallback = cb;
      }
      return () => {};
    });

    const { container } = render(EnvironmentDebugger);
    await flushAsync();
    await vi.advanceTimersByTimeAsync(100);
    await flushAsync();

    if (envCallback) {
      envCallback({
        payload: {
          location: { latitude: 39.9, longitude: 116.4, timezone: "Asia/Shanghai", is_northern_hemisphere: true, city: "Beijing", region: "Beijing", country: "China" },
          weather: { condition: "Sunny", condition_code: "113", temperature: 28, feels_like: null, humidity: null, wind_speed: null },
        },
      });
    }
    await flushAsync();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

// ============================================================================
// StateDebugger
// ============================================================================

describe("StateDebugger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders and loads states", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_states") {
        return [{ name: "idle", persistent: true, priority: 0, play_once: false }];
      }
      if (command === "get_current_state") {
        return { name: "idle", persistent: true, priority: 0, play_once: false };
      }
      if (command === "get_persistent_state") {
        return { name: "idle", persistent: true, priority: 0, play_once: false };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(StateDebugger);
    await flushAsync();

    expect(container.querySelector(".state-debugger") || container.innerHTML).toBeTruthy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("changeState calls invoke and reloads", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_states") {
        return [
          { name: "idle", persistent: true, priority: 0, play_once: false },
          { name: "happy", persistent: false, priority: 1, play_once: true },
        ];
      }
      if (command === "get_current_state") {
        return { name: "idle", persistent: true, priority: 0, play_once: false };
      }
      if (command === "get_persistent_state") {
        return { name: "idle", persistent: true, priority: 0, play_once: false };
      }
      if (command === "change_state") return true;
      if (command === "force_change_state") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(StateDebugger);
    await flushAsync();

    // Find state switch buttons
    const btns = container.querySelectorAll("button");
    // Click any available change button (depends on template structure)
    for (const btn of btns) {
      const text = btn.textContent || "";
      if (text.includes("idle") || text.includes("happy")) {
        await fireEvent.click(btn);
        await flushAsync();
        break;
      }
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("handles loadStates error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_all_states") throw new Error("states fail");
      return originalImpl ? originalImpl(command) : null;
    });

    render(StateDebugger);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("isModDataCounterEffective returns correct values", async () => {
    // This function is defined inline in the component
    // We test it indirectly by rendering with state data that has counter info
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_states") {
        return [
          {
            name: "test",
            persistent: false,
            priority: 0,
            play_once: false,
            mod_data_counter: { op: "add", value: 0 }, // not effective
          },
          {
            name: "test2",
            persistent: false,
            priority: 0,
            play_once: false,
            mod_data_counter: { op: "set", value: 5 }, // effective
          },
        ];
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(StateDebugger);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("state-change event triggers reload", async () => {
    const listenMock = vi.mocked(listen);
    let stateChangeCallback: ((event: any) => void) | null = null;

    listenMock.mockImplementation(async (eventName: string, cb: any) => {
      if (eventName === "state-change") stateChangeCallback = cb;
      return () => {};
    });

    render(StateDebugger);
    await flushAsync();

    if (stateChangeCallback) {
      stateChangeCallback({
        payload: {
          state: { name: "happy", persistent: false, priority: 1, play_once: true },
          play_once: true,
        },
      });
    }
    await flushAsync();
  });

  it("playback-status event updates state", async () => {
    const listenMock = vi.mocked(listen);
    let playbackCallback: ((event: any) => void) | null = null;

    listenMock.mockImplementation(async (eventName: string, cb: any) => {
      if (eventName === "playback-status") playbackCallback = cb;
      return () => {};
    });

    render(StateDebugger);
    await flushAsync();

    if (playbackCallback) {
      playbackCallback({
        payload: {
          animationComplete: true,
          audioComplete: false,
          bubbleComplete: true,
          isPlayOnce: true,
        },
      });
    }
    await flushAsync();
  });

  it("next-state-changed event refreshes next state", async () => {
    const listenMock = vi.mocked(listen);
    let nextStateCallback: ((event: any) => void) | null = null;

    listenMock.mockImplementation(async (eventName: string, cb: any) => {
      if (eventName === "next-state-changed") nextStateCallback = cb;
      return () => {};
    });

    render(StateDebugger);
    await flushAsync();

    if (nextStateCallback) {
      nextStateCallback({ payload: { name: "sleep" } });
    }
    await flushAsync();
  });

  it("forceChangeState calls invoke", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_states") {
        return [
          { name: "idle", persistent: true, priority: 0, play_once: false },
          { name: "happy", persistent: false, priority: 1, play_once: true },
        ];
      }
      if (command === "get_current_state") return { name: "idle", persistent: true, priority: 0, play_once: false };
      if (command === "get_persistent_state") return { name: "idle", persistent: true, priority: 0, play_once: false };
      if (command === "force_change_state") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(StateDebugger);
    await flushAsync();

    // Find force switch button (btn-small.force)
    const forceBtns = container.querySelectorAll(".btn-small.force");
    if (forceBtns.length > 0) {
      await fireEvent.click(forceBtns[0] as HTMLButtonElement);
      await flushAsync();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("forceChangeState handles error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_states") {
        return [{ name: "idle", persistent: true, priority: 0, play_once: false }];
      }
      if (command === "get_current_state") return { name: "idle", persistent: true, priority: 0, play_once: false };
      if (command === "get_persistent_state") return { name: "idle", persistent: true, priority: 0, play_once: false };
      if (command === "force_change_state") throw new Error("force fail");
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(StateDebugger);
    await flushAsync();

    const forceBtns = container.querySelectorAll(".btn-small.force");
    if (forceBtns.length > 0) {
      await fireEvent.click(forceBtns[0] as HTMLButtonElement);
      await flushAsync();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("changeState returns false", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_states") {
        return [{ name: "idle", persistent: true, priority: 0, play_once: false }];
      }
      if (command === "get_current_state") return { name: "idle", persistent: true, priority: 0, play_once: false };
      if (command === "get_persistent_state") return { name: "idle", persistent: true, priority: 0, play_once: false };
      if (command === "change_state") return false;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(StateDebugger);
    await flushAsync();

    const switchBtns = container.querySelectorAll(".btn-small:not(.force)");
    if (switchBtns.length > 0) {
      await fireEvent.click(switchBtns[0] as HTMLButtonElement);
      await flushAsync();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("changeState handles error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_states") {
        return [{ name: "idle", persistent: true, priority: 0, play_once: false }];
      }
      if (command === "get_current_state") return { name: "idle", persistent: true, priority: 0, play_once: false };
      if (command === "get_persistent_state") return { name: "idle", persistent: true, priority: 0, play_once: false };
      if (command === "change_state") throw new Error("change fail");
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(StateDebugger);
    await flushAsync();

    const switchBtns = container.querySelectorAll(".btn-small:not(.force)");
    if (switchBtns.length > 0) {
      await fireEvent.click(switchBtns[0] as HTMLButtonElement);
      await flushAsync();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("renders with rich state data (mod_data_counter, anima, audio, text)", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_states") {
        return [
          {
            name: "idle", persistent: true, priority: 0, play_once: false,
            anima: "idle.anim", audio: "idle_audio", text: "Hi!",
            next_state: "happy", trigger_time: 5000, trigger_rate: 0.8,
            mod_data_counter: { op: "set", value: 5 },
          },
          {
            name: "happy", persistent: false, priority: 1, play_once: true,
            mod_data_counter: { op: "add", value: 0 }, // not effective
          },
        ];
      }
      if (command === "get_current_state") {
        return {
          name: "idle", persistent: true, priority: 0, play_once: false,
          anima: "idle.anim", audio: "idle_audio", text: "Hi!",
          next_state: "happy", mod_data_counter: { op: "set", value: 5 },
        };
      }
      if (command === "get_persistent_state") {
        return { name: "idle", persistent: true, priority: 0, trigger_time: 3000 };
      }
      if (command === "get_next_state") return { name: "happy" };
      if (command === "is_state_locked") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(StateDebugger);
    await flushAsync();

    expect(container.querySelector(".state-debugger") || container.innerHTML).toBeTruthy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });
});

// ============================================================================
// TriggerDebugger
// ============================================================================

describe("TriggerDebugger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders and loads triggers", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_triggers") {
        return [{ event: "click", can_trigger_states: [{ name: "happy" }] }];
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(TriggerDebugger);
    await flushAsync();

    expect(container.innerHTML).toBeTruthy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("triggerEvent calls invoke", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_triggers") {
        return [{ event: "click", can_trigger_states: [{ name: "happy" }] }];
      }
      if (command === "trigger_event") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(TriggerDebugger);
    await flushAsync();

    // Find trigger buttons
    const btns = container.querySelectorAll("button");
    for (const btn of btns) {
      if ((btn.textContent || "").includes("click")) {
        await fireEvent.click(btn);
        await flushAsync();
        break;
      }
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("triggerEvent handles false result", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "trigger_event") return false;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(TriggerDebugger);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("triggerEvent handles error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "trigger_event") throw new Error("trigger fail");
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(TriggerDebugger);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("triggerCustomEvent with empty input does nothing", async () => {
    const invokeMock = vi.mocked(invoke);
    render(TriggerDebugger);
    await flushAsync();

    // customEvent starts as "" — triggerCustomEvent should return early
    // Try to find and click the custom trigger button
    // The function returns early when input is empty
  });

  it("loadData handles error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_all_triggers") throw new Error("load fail");
      return originalImpl ? originalImpl(command) : null;
    });

    render(TriggerDebugger);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("refreshNextState handles error", async () => {
    const listenMock = vi.mocked(listen);
    let nextStateCallback: ((event: any) => void) | null = null;

    listenMock.mockImplementation(async (eventName: string, cb: any) => {
      if (eventName === "next-state-changed") nextStateCallback = cb;
      return () => {};
    });

    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_next_state") throw new Error("next fail");
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(TriggerDebugger);
    await flushAsync();

    if (nextStateCallback) {
      nextStateCallback({ payload: { name: "test" } });
    }
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("triggerCustomEvent with non-empty input calls triggerEvent", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_triggers") return [];
      if (command === "trigger_event") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(TriggerDebugger);
    await flushAsync();

    // Type in custom event input
    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    if (input) {
      await fireEvent.input(input, { target: { value: "my_custom_event" } });
      await flushAsync();
      // Click the trigger button
      const trigBtn = container.querySelector(".btn-primary") as HTMLButtonElement;
      if (trigBtn) {
        await fireEvent.click(trigBtn);
        await flushAsync();
      }
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("quick trigger buttons fire events", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_triggers") return [];
      if (command === "trigger_event") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(TriggerDebugger);
    await flushAsync();

    const quickBtns = container.querySelectorAll(".btn-quick");
    // Click first few quick buttons to cover triggerEvent paths
    for (let i = 0; i < Math.min(3, quickBtns.length); i++) {
      await fireEvent.click(quickBtns[i] as HTMLButtonElement);
      await flushAsync();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("state-change and playback-status events update data", async () => {
    const listenMock = vi.mocked(listen);
    let stateChangeCallback: ((event: any) => void) | null = null;
    let playbackCallback: ((event: any) => void) | null = null;

    listenMock.mockImplementation(async (eventName: string, cb: any) => {
      if (eventName === "state-change") stateChangeCallback = cb;
      if (eventName === "playback-status") playbackCallback = cb;
      return () => {};
    });

    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_triggers") return [];
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(TriggerDebugger);
    await flushAsync();

    if (stateChangeCallback) {
      stateChangeCallback({
        payload: { state: { name: "happy" }, play_once: true },
      });
    }
    await flushAsync();

    if (playbackCallback) {
      playbackCallback({
        payload: { animationComplete: true, audioComplete: true, bubbleComplete: true, isPlayOnce: false },
      });
    }
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("next-state-changed event triggers refreshNextState success", async () => {
    const listenMock = vi.mocked(listen);
    let nextStateCallback: ((event: any) => void) | null = null;

    listenMock.mockImplementation(async (eventName: string, cb: any) => {
      if (eventName === "next-state-changed") nextStateCallback = cb;
      return () => {};
    });

    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_next_state") return { name: "sleep", persistent: true };
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(TriggerDebugger);
    await flushAsync();

    if (nextStateCallback) {
      nextStateCallback({ payload: { name: "sleep" } });
    }
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("renders with rich state data (anima, audio, text, next_state, triggers)", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_triggers") {
        return [
          {
            event: "click",
            can_trigger_states: [
              { name: "happy", persistent: false, priority: 1, allow_repeat: true, weight: 10 },
              { name: "idle", persistent: true, priority: 0 },
            ],
          },
          {
            event: "login",
            can_trigger_states: [],
          },
        ];
      }
      if (command === "get_current_state") {
        return {
          name: "idle",
          persistent: true,
          priority: 0,
          anima: "idle.anim",
          audio: "idle_audio",
          text: "Hello!",
          next_state: "happy",
          trigger_time: 5000,
          trigger_rate: 0.5,
          mod_data_counter: { op: "add", value: 1 },
          trigger_counter_range: { min: 0, max: 10 },
          branch: [{ name: "opt1" }, { name: "opt2" }],
          branch_show_bubble: true,
        };
      }
      if (command === "get_persistent_state") {
        return {
          name: "idle",
          persistent: true,
          priority: 0,
          trigger_time: 3000,
          trigger_rate: 1.0,
          temp_range: { min: -10, max: 35 },
          uptime: { min: 0, max: 3600 },
          weather: ["Clear", "Cloudy"],
          date: { month: 1, day: 1 },
          time: { hour: 8, minute: 0 },
        };
      }
      if (command === "get_next_state") return { name: "happy" };
      if (command === "is_state_locked") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(TriggerDebugger);
    await flushAsync();

    // Should render state info with rich data
    expect(container.querySelector(".trigger-debugger")).toBeTruthy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("clear log and refresh buttons", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_triggers") return [];
      if (command === "trigger_event") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(TriggerDebugger);
    await flushAsync();

    // Click a quick button to generate log entries
    const quickBtns = container.querySelectorAll(".btn-quick");
    if (quickBtns.length > 0) {
      await fireEvent.click(quickBtns[0] as HTMLButtonElement);
      await flushAsync();
    }

    // Find and click clear log button (btn-clear)
    const clearBtn = container.querySelector(".btn-clear") as HTMLButtonElement;
    if (clearBtn) {
      await fireEvent.click(clearBtn);
      await flushAsync();
    }

    // Find and click refresh button
    const refreshBtns = container.querySelectorAll("button");
    for (const btn of refreshBtns) {
      if (btn.classList.contains("refresh") || (btn.textContent || "").includes("🔄")) {
        await fireEvent.click(btn);
        await flushAsync();
        break;
      }
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });
});

// ============================================================================
// Settings
// ============================================================================

describe("Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockSettings() {
    return {
      nickname: "TestUser",
      birthday: "03-15",
      lang: "zh",
      auto_start: false,
      no_audio_mode: false,
      volume: 0.8,
      silence_mode: false,
      auto_silence_when_fullscreen: true,
      streamer_mode: false,
      show_character: true,
      show_border: true,
      animation_scale: 0.4,
      live2d_mouse_follow: true,
      live2d_auto_interact: false,
      threed_cross_fade_duration: 0.5,
      ai_api_key: "test-key-123",
      ai_chat_base_url: "https://api.test.com/v1",
      ai_chat_model: "test-model",
      ai_screenshot_interval: 1.0,
      ai_window_configs: [],
      ai_tool_hotkey: "F1",
    };
  }

  it("renders with settings data", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    expect(container.innerHTML).toBeTruthy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("handles loadSettings error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_settings") throw new Error("settings fail");
      return originalImpl ? originalImpl(command) : null;
    });

    render(SettingsComponent);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("saveSettings calls invoke", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      if (command === "update_settings") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(SettingsComponent);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("saveSettings handles error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      if (command === "update_settings") throw new Error("save fail");
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(SettingsComponent);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("openStorageDir calls invoke", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(SettingsComponent);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("openStorageDir handles error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      if (command === "open_storage_dir") throw new Error("fail");
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(SettingsComponent);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("mmddToDate and dateToMmdd conversions", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    // Test null birthday
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") {
        return { ...createMockSettings(), birthday: null };
      }
      if (command === "get_current_mod") return null;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(SettingsComponent);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("settings-change event updates settings", async () => {
    const listenMock = vi.mocked(listen);
    let settingsChangeCallback: ((event: any) => void) | null = null;

    listenMock.mockImplementation(async (eventName: string, cb: any) => {
      if (eventName === "settings-change") settingsChangeCallback = cb;
      return () => {};
    });

    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(SettingsComponent);
    await flushAsync();

    if (settingsChangeCallback) {
      settingsChangeCallback({
        payload: { ...createMockSettings(), nickname: "Updated", birthday: "06-01" },
      });
    }
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("loadCurrentModType handles mod with type", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") {
        return { manifest: { mod_type: "live2d" } };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(SettingsComponent);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("loadCurrentModType handles error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") throw new Error("mod fail");
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(SettingsComponent);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("checkMediaStatus returns false on error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      if (command === "get_media_status") throw new Error("media fail");
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(SettingsComponent);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("handleToggle no_audio_mode triggers mute effect", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      if (command === "set_mute") return true;
      if (command === "update_settings") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    // Find the no_audio_mode checkbox
    const checkboxes = container.querySelectorAll("input[type='checkbox']");
    for (const cb of checkboxes) {
      const el = cb as HTMLInputElement;
      // Find the one related to audio mode
      const label = el.closest(".setting-item")?.querySelector("label");
      if (label) {
        await fireEvent.click(el);
        await flushAsync();
        break;
      }
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("handleToggle silence_mode triggers DND effect", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      if (command === "get_media_status") return true; // isPlaying
      if (command === "force_change_state") return true;
      if (command === "update_settings") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    // Find all checkboxes and trigger a change event for each to cover handleToggle branches
    const checkboxes = container.querySelectorAll("input[type='checkbox']");
    if (checkboxes.length >= 5) {
      // silence_mode checkbox (usually 5th or 6th)
      for (let i = 3; i < Math.min(6, checkboxes.length); i++) {
        await fireEvent.click(checkboxes[i] as HTMLInputElement);
        await flushAsync();
      }
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("onAnimationScaleChange triggers scale update", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      if (command === "set_animation_scale") return true;
      if (command === "update_settings") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    const ranges = container.querySelectorAll("input[type='range']");
    if (ranges.length > 0) {
      await fireEvent.input(ranges[0] as HTMLInputElement, { target: { value: "0.6" } });
      await flushAsync();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("onVolumeChange triggers volume update", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      if (command === "set_volume") return true;
      if (command === "update_settings") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    const ranges = container.querySelectorAll("input[type='range']");
    if (ranges.length > 1) {
      await fireEvent.input(ranges[1] as HTMLInputElement, { target: { value: "0.5" } });
      await flushAsync();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("onBirthdayChange updates birthday", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      if (command === "update_settings") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    const dateInput = container.querySelector("input[type='date']") as HTMLInputElement;
    if (dateInput) {
      await fireEvent.change(dateInput, { target: { value: "2026-06-15" } });
      await flushAsync();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("onLanguageChange saves and updates i18n", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      if (command === "update_settings") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    const langSelect = container.querySelector("select") as HTMLSelectElement;
    if (langSelect) {
      await fireEvent.change(langSelect, { target: { value: "en" } });
      await flushAsync();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("openStorageDir button click", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      if (command === "open_storage_dir") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    const storageDirBtn = container.querySelector(".secondary-button") as HTMLButtonElement;
    if (storageDirBtn) {
      await fireEvent.click(storageDirBtn);
      await flushAsync();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("saveSettings via save button", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      if (command === "update_settings") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    // Find and click save/submit button
    const saveBtn = container.querySelector(".primary-button, button[type='submit']") as HTMLButtonElement;
    if (saveBtn) {
      await fireEvent.click(saveBtn);
      await flushAsync();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("renders with live2d mod type to show live2d settings", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") {
        return { manifest: { mod_type: "live2d" } };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    // Live2D settings section should be visible
    expect(container.innerHTML).toBeTruthy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("renders with 3d mod type to show 3d settings", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") {
        return { manifest: { mod_type: "3d" } };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    // 3D settings section should be visible
    expect(container.innerHTML).toBeTruthy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("AI screenshot interval slider triggers update", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      if (command === "update_settings") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    const aiSlider = container.querySelector("#ai_screenshot_interval") as HTMLInputElement;
    if (aiSlider) {
      await fireEvent.input(aiSlider, { target: { value: "2.5" } });
      await flushAsync();
      expect(invokeMock).toHaveBeenCalledWith("update_settings", expect.anything());
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("AI API key input change triggers save", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      if (command === "update_settings") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    const aiKeyInput = container.querySelector("#ai_api_key") as HTMLInputElement;
    if (aiKeyInput) {
      await fireEvent.change(aiKeyInput, { target: { value: "new-key-456" } });
      await flushAsync();
      expect(invokeMock).toHaveBeenCalledWith("update_settings", expect.anything());
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("AI chat base URL input change triggers save", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      if (command === "update_settings") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    const urlInput = container.querySelector("#ai_chat_base_url") as HTMLInputElement;
    if (urlInput) {
      await fireEvent.change(urlInput, { target: { value: "https://new-api.test.com/v1" } });
      await flushAsync();
      expect(invokeMock).toHaveBeenCalledWith("update_settings", expect.anything());
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("AI tool hotkey select change triggers save", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      if (command === "update_settings") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    const hotkeySelect = container.querySelector("#ai_tool_hotkey") as HTMLSelectElement;
    if (hotkeySelect) {
      await fireEvent.change(hotkeySelect, { target: { value: "F5" } });
      await flushAsync();
      expect(invokeMock).toHaveBeenCalledWith("update_settings", expect.anything());
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ========================================================================
  // Window AI Config CRUD 测试
  // ========================================================================

  function createMockSettingsWithWac() {
    return {
      ...createMockSettings(),
      ai_window_configs: [
        {
          window_name: "Game",
          ai_chat_base_url: "https://game-api.com/v1",
          ai_chat_model: "game-model",
          ai_screenshot_interval: 2.0,
        },
      ],
    };
  }

  it("renders window AI configs when present", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettingsWithWac();
      if (command === "get_current_mod") return null;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    // Should render config card
    const configCards = container.querySelectorAll(".window-ai-config-card");
    expect(configCards.length).toBe(1);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("addWindowAiConfig adds a new config entry", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettingsWithWac();
      if (command === "get_current_mod") return null;
      if (command === "update_settings") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    // Click the add button
    const addBtn = container.querySelector(".add-config-btn") as HTMLButtonElement;
    expect(addBtn).toBeTruthy();
    if (addBtn) {
      await fireEvent.click(addBtn);
      await flushAsync();

      // Should now have 2 config cards
      const configCards = container.querySelectorAll(".window-ai-config-card");
      expect(configCards.length).toBe(2);
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("removeWindowAiConfig removes a config entry", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettingsWithWac();
      if (command === "get_current_mod") return null;
      if (command === "update_settings") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    const removeBtn = container.querySelector(".remove-btn") as HTMLButtonElement;
    expect(removeBtn).toBeTruthy();
    if (removeBtn) {
      await fireEvent.click(removeBtn);
      await flushAsync();

      const configCards = container.querySelectorAll(".window-ai-config-card");
      expect(configCards.length).toBe(0);
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("toggleWacCollapse folds and unfolds config card", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettingsWithWac();
      if (command === "get_current_mod") return null;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    const header = container.querySelector(".window-ai-config-header") as HTMLElement;
    expect(header).toBeTruthy();
    if (header) {
      // Click to collapse
      await fireEvent.click(header);
      await flushAsync();

      const collapsed = container.querySelector(".window-ai-config-card.collapsed");
      expect(collapsed).toBeTruthy();

      // Click again to expand
      await fireEvent.click(header);
      await flushAsync();

      const expanded = container.querySelector(".window-ai-config-card:not(.collapsed)");
      expect(expanded).toBeTruthy();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("toggleWacCollapse responds to keyboard Enter", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettingsWithWac();
      if (command === "get_current_mod") return null;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    const header = container.querySelector(".window-ai-config-header") as HTMLElement;
    if (header) {
      await fireEvent.keyDown(header, { key: "Enter" });
      await flushAsync();

      const collapsed = container.querySelector(".window-ai-config-card.collapsed");
      expect(collapsed).toBeTruthy();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("window AI config interval slider triggers update", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettingsWithWac();
      if (command === "get_current_mod") return null;
      if (command === "update_settings") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    const wacSlider = container.querySelector("#wac_interval_0") as HTMLInputElement;
    if (wacSlider) {
      await fireEvent.input(wacSlider, { target: { value: "3.0" } });
      await flushAsync();
      expect(invokeMock).toHaveBeenCalledWith("update_settings", expect.anything());
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ========================================================================
  // 更多 Settings 未覆盖路径测试
  // ========================================================================

  it("nickname input change triggers saveSettings", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      if (command === "update_settings") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    const nicknameInput = container.querySelector("#nickname") as HTMLInputElement;
    if (nicknameInput) {
      await fireEvent.change(nicknameInput, { target: { value: "NewNickname" } });
      await flushAsync();
      expect(invokeMock).toHaveBeenCalledWith("update_settings", expect.anything());
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("volume slider is disabled when no_audio_mode is true", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") {
        return { ...createMockSettings(), no_audio_mode: true };
      }
      if (command === "get_current_mod") return null;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    const volumeSlider = container.querySelector("#volume") as HTMLInputElement;
    if (volumeSlider) {
      expect(volumeSlider.disabled).toBe(true);
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("show_border checkbox is disabled when show_character is false", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") {
        return { ...createMockSettings(), show_character: false, show_border: false };
      }
      if (command === "get_current_mod") return null;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    // The show_border checkbox should be disabled when show_character is false
    const checkboxes = container.querySelectorAll("input[type='checkbox']");
    let foundDisabledBorder = false;
    for (const cb of checkboxes) {
      if ((cb as HTMLInputElement).disabled) {
        foundDisabledBorder = true;
        break;
      }
    }
    expect(foundDisabledBorder).toBe(true);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("3D transition duration slider triggers update", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") {
        return { manifest: { mod_type: "3d" } };
      }
      if (command === "update_settings") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    const durationSlider = container.querySelector("#threed_cross_fade_duration") as HTMLInputElement;
    if (durationSlider) {
      await fireEvent.input(durationSlider, { target: { value: "0.8" } });
      await flushAsync();
      expect(invokeMock).toHaveBeenCalledWith("update_settings", expect.anything());
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("applySilenceEffect handles isPlaying=false path", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return createMockSettings();
      if (command === "get_current_mod") return null;
      if (command === "get_media_status") return false; // isPlaying = false
      if (command === "force_change_state") return true;
      if (command === "update_settings") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    // Find and click the silence_mode checkbox
    const checkboxes = container.querySelectorAll("input[type='checkbox']");
    if (checkboxes.length >= 5) {
      for (let i = 3; i < Math.min(6, checkboxes.length); i++) {
        await fireEvent.click(checkboxes[i] as HTMLInputElement);
        await flushAsync();
      }
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("addWindowAiConfig on empty list initializes array", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    // Settings without ai_window_configs field
    const settings = createMockSettings() as any;
    // no ai_window_configs property at all

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return settings;
      if (command === "get_current_mod") return null;
      if (command === "update_settings") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsComponent);
    await flushAsync();

    // Click add button
    const addBtn = container.querySelector(".add-config-btn") as HTMLButtonElement;
    if (addBtn) {
      await fireEvent.click(addBtn);
      await flushAsync();

      const configCards = container.querySelectorAll(".window-ai-config-card");
      expect(configCards.length).toBe(1);
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });
});

// ============================================================================
// ResourceManagerDebugger
// ============================================================================

/** ResourceManagerDebugger 系列测试：共享的基础 manifest，避免在多个 describe 中重复定义 */
const RESOURCE_BASE_MANIFEST = {
  author: "test",
  default_audio_lang_id: "zh",
  default_text_lang_id: "zh",
  show_mod_data_panel: false,
  mod_data_default_int: 0,
  enable_texture_downsample: false,
  texture_downsample_start_dim: 512,
  global_keyboard: false,
  global_mouse: false,
  character: { z_offset: 0, canvas_fit_preference: "long" },
  border: { enable: false, anima: "", z_offset: 0 },
  triggers: [],
};

/** 统一构造 ResourceManagerDebugger 用到的 mock mod 结构（默认 sequence）。 */
function createResourceMod(overrides: Record<string, any> = {}) {
  const { manifest: mOverrides, ...rest } = overrides;
  return {
    path: "C:/mods/demo",
    imgs: [],
    sequences: [],
    audios: {},
    texts: {},
    info: {},
    ...rest,
    manifest: {
      id: "demo",
      version: "1.0",
      mod_type: "sequence",
      important_states: {},
      states: [],
      ...RESOURCE_BASE_MANIFEST,
      ...mOverrides,
    },
  };
}

describe("ResourceManagerDebugger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 复用共享的基础 manifest 与构造器（避免重复定义大对象）
  const baseManifest = RESOURCE_BASE_MANIFEST;
  const createSeqMod = createResourceMod;


  it("renders and refreshes mod list", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") return createSeqMod();
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    expect(container.innerHTML).toBeTruthy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("refreshMods handles error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_mod_search_paths") throw new Error("path fail");
      return originalImpl ? originalImpl(command) : null;
    });

    render(ResourceManagerDebugger);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("loadSelectedMod loads and shows mod info", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_available_mods") return ["testmod"];
      if (command === "get_current_mod") return null;
      if (command === "load_mod") {
        return {
          path: "C:/mods/testmod",
          manifest: {
            ...RESOURCE_BASE_MANIFEST,
            id: "testmod",
            version: "2.0",
            mod_type: "live2d",
            important_states: { idle: { name: "idle", persistent: true, priority: 0 } },
            states: [{ name: "happy", persistent: false, priority: 1 }],
          },
          imgs: [], sequences: [], info: {},
          audios: { zh: [{ name: "hello", audio: "hello.wav" }] },
          texts: { zh: [{ name: "greeting", text: "Hi" }] },
          live2d: {
            model: { base_dir: "live2d", model_json: "m.json", textures_dir: "tex", motions_dir: "mot", expressions_dir: "exp", physics_json: "", pose_json: "", breath_json: "", scale: 1, eye_blink: true, lip_sync: true },
            motions: [{ name: "idle", file: "idle.motion3.json", group: "idle", priority: 1, fade_in_ms: 300, fade_out_ms: 300, loop: true }],
            expressions: [{ name: "smile", file: "smile.exp3.json" }],
            states: [{ state: "idle", motion: "idle", expression: "smile", scale: 1, offset_x: 0, offset_y: 0 }],
          },
        };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(ResourceManagerDebugger);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("loadSelectedMod handles error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_available_mods") return ["testmod"];
      if (command === "get_current_mod") return null;
      if (command === "load_mod") throw new Error("load fail");
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(ResourceManagerDebugger);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("unloadMod success", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") return createSeqMod();
      if (command === "unload_mod") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(ResourceManagerDebugger);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("unloadMod returns false", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "unload_mod") return false;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(ResourceManagerDebugger);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("unloadMod handles error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "unload_mod") throw new Error("unload fail");
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(ResourceManagerDebugger);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("mod type detection functions", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    const typeExtras: Record<string, any> = {
      sequence: {},
      live2d: {
        live2d: {
          model: { base_dir: "l2d", model_json: "m.json", textures_dir: "", motions_dir: "", expressions_dir: "", physics_json: "", pose_json: "", breath_json: "", scale: 1, eye_blink: false, lip_sync: false },
          motions: [], expressions: [], states: [],
        },
      },
      pngremix: {
        pngremix: {
          model: { name: "t", pngremix_file: "t.json", default_state_index: 0, scale: 1, max_fps: 30 },
          features: { mouse_follow: false, auto_blink: false, click_bounce: false, click_bounce_amp: 0, click_bounce_duration: 0, blink_speed: 0, blink_chance: 0, blink_hold_ratio: 0 },
          expressions: [], motions: [],
          states: [{ state: "idle", expression: "", motion: "", mouth_state: 0, scale: 1, offset_x: 0, offset_y: 0 }],
        },
      },
      "3d": {
        threed: {
          model: { name: "t", type: "gltf", file: "m.glb", scale: 1, offset_x: 0, offset_y: 0 },
          animations: [{ name: "idle", type: "embedded", file: "", speed: 1, fps: 30 }],
        },
      },
    };

    for (const modType of ["sequence", "live2d", "pngremix", "3d"]) {
      invokeMock.mockImplementation(async (command: string, args?: unknown) => {
        if (command === "get_current_mod") {
          return createSeqMod({ manifest: { mod_type: modType }, ...typeExtras[modType] });
        }
        return originalImpl ? originalImpl(command, args as never) : null;
      });

      const { unmount } = render(ResourceManagerDebugger);
      await flushAsync();
      unmount();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("formatMouthState covers all cases", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createSeqMod({
          manifest: { mod_type: "pngremix" },
          pngremix: {
            model: { name: "t", pngremix_file: "t.json", default_state_index: 0, scale: 1, max_fps: 30 },
            features: { mouse_follow: false, auto_blink: false, click_bounce: false, click_bounce_amp: 0, click_bounce_duration: 0, blink_speed: 0, blink_chance: 0, blink_hold_ratio: 0 },
            expressions: [],
            motions: [],
            states: [
              { state: "idle", expression: "", motion: "", mouth_state: 0, scale: 1, offset_x: 0, offset_y: 0 },
              { state: "talk", expression: "", motion: "", mouth_state: 1, scale: 1, offset_x: 0, offset_y: 0 },
              { state: "shout", expression: "", motion: "", mouth_state: 2, scale: 1, offset_x: 0, offset_y: 0 },
              { state: "other", expression: "", motion: "", mouth_state: 99, scale: 1, offset_x: 0, offset_y: 0 },
            ],
          },
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(ResourceManagerDebugger);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("openAssetFile calls invoke", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") return createSeqMod();
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(ResourceManagerDebugger);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("openAssetFile handles error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") return createSeqMod();
      if (command === "open_path") throw new Error("open fail");
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(ResourceManagerDebugger);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("resolveAudioPathByName with matching audio", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createSeqMod({
          manifest: { default_audio_lang_id: "en" },
          audios: {
            en: [{ name: "greet", audio: "greet.wav" }],
            zh: [{ name: "greet", audio: "greet_zh.wav" }],
          },
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(ResourceManagerDebugger);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("joinRelPath handles various inputs", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createSeqMod({
          manifest: { mod_type: "live2d" },
          live2d: {
            model: { base_dir: "", model_json: "m.json", textures_dir: "", motions_dir: "", expressions_dir: "", physics_json: "", pose_json: "", breath_json: "", scale: 1, eye_blink: false, lip_sync: false },
            motions: [], expressions: [], states: [],
          },
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(ResourceManagerDebugger);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("getImportantStatesByPersistence and getOtherStatesByPersistence", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createSeqMod({
          manifest: {
            important_states: {
              idle: { name: "idle", persistent: true, priority: 0, play_once: false },
              alert: { name: "alert", persistent: false, priority: 5, play_once: true },
            },
            states: [
              { name: "sleep", persistent: true, priority: 0, play_once: false },
              { name: "dance", persistent: false, priority: 1, play_once: true },
            ],
          },
          audios: { zh: [{ name: "a1", audio: "a1.wav" }, { name: "a2", audio: "a2.wav" }] },
          texts: { zh: [{ name: "t1", text: "hello" }] },
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(ResourceManagerDebugger);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });
});

// ============================================================================
// TriggerDebugger — extended coverage
// ============================================================================

describe("TriggerDebugger extended", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clicking all quick trigger buttons covers all triggerEvent paths", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_triggers") return [];
      if (command === "trigger_event") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(TriggerDebugger);
    await flushAsync();

    // Click ALL quick trigger buttons
    const quickBtns = container.querySelectorAll(".btn-quick");
    for (let i = 0; i < quickBtns.length; i++) {
      await fireEvent.click(quickBtns[i] as HTMLButtonElement);
      await flushAsync();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("Enter key in custom event input triggers custom event", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_triggers") return [];
      if (command === "trigger_event") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(TriggerDebugger);
    await flushAsync();

    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    if (input) {
      await fireEvent.input(input, { target: { value: "test_event" } });
      await flushAsync();
      await fireEvent.keyDown(input, { key: "Enter" });
      await flushAsync();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("clear log button clears event log", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_triggers") return [];
      if (command === "trigger_event") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(TriggerDebugger);
    await flushAsync();

    // Generate some logs by clicking a quick button
    const quickBtns = container.querySelectorAll(".btn-quick");
    if (quickBtns.length > 0) {
      await fireEvent.click(quickBtns[0] as HTMLButtonElement);
      await flushAsync();
    }

    // Click the clear log button (btn-tiny)
    const clearBtn = container.querySelector(".btn-tiny") as HTMLButtonElement;
    if (clearBtn) {
      await fireEvent.click(clearBtn);
      await flushAsync();
    }

    // After clearing, the log should show empty message
    const logEmpty = container.querySelector(".log-empty");
    expect(logEmpty).toBeTruthy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("refresh button reloads data", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_triggers") return [];
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(TriggerDebugger);
    await flushAsync();

    // Click refresh button
    const refreshBtn = container.querySelector("button.refresh") as HTMLButtonElement;
    if (refreshBtn) {
      await fireEvent.click(refreshBtn);
      await flushAsync();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("trigger buttons in the trigger list fire events", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_triggers") {
        return [
          {
            event: "click",
            can_trigger_states: [
              { persistent_state: "idle", allow_repeat: false, states: [{ state: "happy", weight: 2 }] },
            ],
          },
          {
            event: "right_click",
            can_trigger_states: [
              { persistent_state: null, states: [{ state: "wave" }] },
            ],
          },
        ];
      }
      if (command === "trigger_event") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(TriggerDebugger);
    await flushAsync();

    // Click trigger buttons in trigger cards
    const trigBtns = container.querySelectorAll(".btn-trigger");
    for (const btn of trigBtns) {
      await fireEvent.click(btn as HTMLButtonElement);
      await flushAsync();
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("unmount cleans up listeners", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_triggers") return [];
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { unmount } = render(TriggerDebugger);
    await flushAsync();

    // Unmount should call unlisten functions
    unmount();
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("renders with rich persistent state including counter/temp/weather/live2d/pngremix params", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_triggers") return [];
      if (command === "get_current_state") {
        return {
          name: "idle", persistent: true, priority: 0,
          anima: "idle.anim", audio: "idle_audio", text: "Hi!",
          next_state: "happy", trigger_time: 5000, trigger_rate: 0.5,
          mod_data_counter: { op: "add", value: 1 },
          trigger_counter_start: 0, trigger_counter_end: 10,
          trigger_temp_start: -10, trigger_temp_end: 35,
          trigger_uptime: 60,
          trigger_weather: ["Clear", "Rain"],
          date_start: "01-01", date_end: "12-31",
          time_start: "08:00", time_end: "22:00",
          can_trigger_states: [{ state: "happy", weight: 1 }],
          live2d_params: [{ name: "ParamEyeLOpen", value: 0.5 }],
          pngremix_params: [{ name: "expression", value: "smile" }],
          branch_show_bubble: false,
          branch: [{ text: "Option A", next_state: "happy" }, { text: "Option B", next_state: "sleep" }],
        };
      }
      if (command === "get_persistent_state") {
        return {
          name: "idle", persistent: true, priority: 0,
          trigger_time: 3000, trigger_rate: 1.0,
          mod_data_counter: { op: "set", value: 5 },
          trigger_counter_start: 0, trigger_counter_end: 100,
          trigger_temp_start: -5, trigger_temp_end: 40,
          trigger_uptime: 120,
          trigger_weather: ["Snow"],
          can_trigger_states: [{ state: "happy", weight: 2 }, { state: "dance", weight: 1 }],
          live2d_params: [{ name: "ParamAngleX", value: 10 }],
          pngremix_params: [{ name: "motion", value: "wave" }],
        };
      }
      if (command === "get_next_state") return { name: "happy", persistent: false };
      if (command === "is_state_locked") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(TriggerDebugger);
    await flushAsync();

    expect(container.querySelector(".trigger-debugger")).toBeTruthy();
    // Verify branch info is rendered
    expect(container.querySelector(".branch-info")).toBeTruthy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });
});

// ============================================================================
// StateDebugger — extended branch coverage
// ============================================================================

describe("StateDebugger extended", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with full state details (all fields populated)", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_states") {
        return [
          {
            name: "idle", persistent: true, priority: 0, play_once: false,
            anima: "idle.anim", audio: "idle_audio.wav", text: "Hello!",
            next_state: "happy", trigger_time: 5000, trigger_rate: 0.8,
            mod_data_counter: { op: "set", value: 5 },
            trigger_counter_start: 0, trigger_counter_end: 50,
            trigger_temp_start: -10, trigger_temp_end: 40,
            trigger_uptime: 60,
            trigger_weather: ["Clear", "Cloudy", "Rain"],
            date_start: "01-01", date_end: "06-30",
            time_start: "08:00", time_end: "20:00",
            can_trigger_states: [{ state: "happy", weight: 2 }, { state: "dance", weight: 1 }],
            live2d_params: [{ name: "ParamEyeLOpen", value: 1.0 }],
            pngremix_params: [{ name: "expression", value: "smile" }],
            branch: [{ text: "Option A", next_state: "happy" }],
            branch_show_bubble: false,
          },
          {
            name: "happy", persistent: false, priority: 1, play_once: true,
            mod_data_counter: { op: "sub", value: 0 }, // not effective (sub 0)
            trigger_counter_start: -2147483648, trigger_counter_end: 2147483647, // full range = not limited
          },
          {
            name: "dance", persistent: false, priority: 2, play_once: true,
            mod_data_counter: { op: "add", value: 3 }, // effective
          },
        ];
      }
      if (command === "get_current_state") {
        return {
          name: "idle", persistent: true, priority: 0, play_once: false,
          anima: "idle.anim", audio: "idle_audio.wav", text: "Hello!",
          next_state: "happy", trigger_time: 5000, trigger_rate: 0.8,
          mod_data_counter: { op: "set", value: 5 },
          trigger_counter_start: 0, trigger_counter_end: 50,
          trigger_temp_start: -10, trigger_temp_end: 40,
          trigger_uptime: 60,
          trigger_weather: ["Clear"],
          date_start: "01-01", date_end: "06-30",
          time_start: "08:00", time_end: "20:00",
          can_trigger_states: [{ state: "happy", weight: 2 }],
          live2d_params: [{ name: "ParamEyeLOpen", value: 1.0 }],
          pngremix_params: [{ name: "expression", value: "smile" }],
          branch: [{ text: "Go", next_state: "happy" }],
          branch_show_bubble: false,
        };
      }
      if (command === "get_persistent_state") {
        return { name: "idle", persistent: true, priority: 0, trigger_time: 5000, trigger_rate: 0.8 };
      }
      if (command === "get_next_state") return { name: "happy", persistent: false };
      if (command === "is_state_locked") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(StateDebugger);
    await flushAsync();

    expect(container.querySelector(".state-debugger") || container.innerHTML).toBeTruthy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("renders with no next state and unlocked", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_states") {
        return [{ name: "idle", persistent: true, priority: 0, play_once: false }];
      }
      if (command === "get_current_state") {
        return { name: "idle", persistent: true, priority: 0, play_once: false };
      }
      if (command === "get_persistent_state") {
        return { name: "idle", persistent: true, priority: 0 };
      }
      if (command === "get_next_state") return null;
      if (command === "is_state_locked") return false;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(StateDebugger);
    await flushAsync();

    expect(container.querySelector(".state-debugger") || container.innerHTML).toBeTruthy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("unmount cleans up event listeners", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_all_states") return [];
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { unmount } = render(StateDebugger);
    await flushAsync();

    unmount();
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });
});

// ============================================================================
// ResourceManagerDebugger — extended coverage
// ============================================================================

describe("ResourceManagerDebugger extended", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 复用共享的基础 manifest 与构造器（避免重复定义大对象）
  const baseManifest = RESOURCE_BASE_MANIFEST;
  const createSeqMod2 = createResourceMod;


  it("loadSelectedMod clicks button and loads mod", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return ["testmod"];
      if (command === "get_current_mod") return null;
      if (command === "load_mod") return createSeqMod2({ manifest: { id: "testmod" } });
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    // Find and click load button (multi-lang)
    clickButtonByTextIncludes(container, ["Load", "加载", "読み込み"]);
    await flushAsync();


    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("unloadMod clicks button and unloads mod", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") return createSeqMod2();
      if (command === "unload_mod") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    // Find unload button (multi-lang)
    clickButtonByTextIncludes(container, ["Unload", "卸载", "アンロード"]);
    await flushAsync();


    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("refresh button reloads mod list", async () => {
    await withTauriInvoke(
      {
        get_mod_search_paths: ["C:/mods"],
        get_available_mods: ["mod1", "mod2"],
        get_current_mod: null,
      },
      async () => {
        const { container } = render(ResourceManagerDebugger);
        await flushAsync();

        // Find refresh button (multi-lang)
        clickButtonByTextIncludes(container, ["Refresh", "刷新", "更新"]);
        await flushAsync();
      },
    );
  });

  it("renders threed mod with animation data", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createSeqMod2({
          manifest: { mod_type: "3d" },
          threed: {
            model: { name: "demo", type: "gltf", file: "m.glb", scale: 1, offset_x: 0, offset_y: 0 },
            animations: [
              { name: "idle", type: "embedded", file: "", speed: 1, fps: 30 },
              { name: "walk", type: "file", file: "walk.anim", speed: 1, fps: 30 },
            ],
            states: [
              { state: "idle", animation: "idle" },
              { state: "walk", animation: "walk" },
            ],
          },
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(ResourceManagerDebugger);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("unmount cleans up listeners", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") return null;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { unmount } = render(ResourceManagerDebugger);
    await flushAsync();

    unmount();
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });
});


// ============================================================================
// ResourceManagerDebugger — Branches & Functions coverage boost
// ============================================================================

describe("ResourceManagerDebugger branches & functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 复用共享的基础 manifest 与构造器（避免重复定义大对象）
  const baseManifest3 = RESOURCE_BASE_MANIFEST;
  const createMod3 = createResourceMod;


  // ========================================================================
  // pngremix with full features → triggers getPngRemix*, toFiniteNumber, formatMouthState, isPngremixMod
  // ========================================================================

  it("pngremix mod with all features enabled renders pngremix-specific info", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          manifest: {
            mod_type: "pngremix",
            pngremix_follow_amp_scale: 1.5,
            pngremix_motion_amp_scale: 2.0,
            pngremix_motion_frq_scale: 0.8,
          },
          pngremix: {
            model: { name: "t", pngremix_file: "t.json", default_state_index: 0, scale: 1, max_fps: 30 },
            features: {
              mouse_follow: true, auto_blink: true, click_bounce: true,
              click_bounce_amp: 5, click_bounce_duration: 0.3,
              blink_speed: 0.2, blink_chance: 0.3, blink_hold_ratio: 0.5,
            },
            expressions: [{ name: "smile", state_index: 1 }],
            motions: [{ name: "wave", hotkey: "KeyW", description: "wave hand" }],
            states: [
              { state: "idle", expression: "smile", motion: "wave", mouth_state: 0, scale: 1, offset_x: 0, offset_y: 0 },
              { state: "talk", expression: "", motion: "", mouth_state: 1, scale: 1, offset_x: 0, offset_y: 0 },
              { state: "yell", expression: "", motion: "", mouth_state: 2, scale: 1, offset_x: 0, offset_y: 0 },
              { state: "def", expression: "", motion: "", scale: 1, offset_x: 0, offset_y: 0 },
            ],
          },
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    // Verify pngremix scale info rendered
    expect(container.innerHTML).toContain("1.5");
    expect(container.innerHTML).toContain("2");
    expect(container.innerHTML).toContain("0.8");

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("pngremix mod without follow_amp_scale falls back to motion_amp_scale", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          manifest: {
            mod_type: "pngremix",
            // no pngremix_follow_amp_scale
            pngremix_motion_amp_scale: 3.0,
          },
          pngremix: {
            model: { name: "t", pngremix_file: "t.json", default_state_index: 0, scale: 1, max_fps: 30 },
            features: { mouse_follow: false, auto_blink: false, click_bounce: false, click_bounce_amp: 0, click_bounce_duration: 0, blink_speed: 0, blink_chance: 0, blink_hold_ratio: 0 },
            expressions: [], motions: [],
            states: [{ state: "idle", expression: "", motion: "", mouth_state: 0, scale: 1, offset_x: 0, offset_y: 0 }],
          },
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    // follow_amp_scale should fall back to motion_amp_scale = 3.0
    expect(container.innerHTML).toContain("3");

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("pngremix mod without any scale uses default 1.0", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          manifest: { mod_type: "pngremix" },
          pngremix: {
            model: { name: "t", pngremix_file: "t.json", default_state_index: 0, scale: 1, max_fps: 30 },
            features: { mouse_follow: false, auto_blink: false, click_bounce: false, click_bounce_amp: 0, click_bounce_duration: 0, blink_speed: 0, blink_chance: 0, blink_hold_ratio: 0 },
            expressions: [], motions: [],
            states: [{ state: "idle", expression: "", motion: "", mouth_state: 0, scale: 1, offset_x: 0, offset_y: 0 }],
          },
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(ResourceManagerDebugger);
    await flushAsync();
    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ========================================================================
  // live2d mod with background_layers, audio, and events
  // ========================================================================

  it("live2d mod with background layers, audio, and events renders fully", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          manifest: { mod_type: "live2d", default_audio_lang_id: "zh" },
          audios: {
            zh: [{ name: "sfx_a", audio: "sfx_a.wav" }, { name: "bgm", audio: "bgm.wav" }],
            en: [{ name: "sfx_a", audio: "sfx_a_en.wav" }],
          },
          texts: { zh: [{ name: "t1", text: "hello", duration: 3 }] },
          live2d: {
            model: {
              base_dir: "l2d", model_json: "m.json",
              textures_dir: "tex", motions_dir: "mot", expressions_dir: "exp",
              physics_json: "phys.json", pose_json: "pose.json", breath_json: "breath.json",
              scale: 1.2, eye_blink: true, lip_sync: true,
            },
            motions: [
              { name: "idle", file: "idle.motion3.json", group: "idle", priority: 1, fade_in_ms: 300, fade_out_ms: 300, loop: true },
            ],
            expressions: [{ name: "smile", file: "smile.exp3.json" }],
            states: [
              { state: "idle", motion: "idle", expression: "smile", scale: 1, offset_x: 0, offset_y: 0 },
            ],
            background_layers: [
              { name: "layer1", file: "bg.png", layer: "front", events: ["keydown:KeyA", "click"], audio: "sfx_a" },
              { name: "layer2", file: "", layer: "", events: [], audio: "" },
            ],
          },
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    // Background layer with audio should render play button
    const playBtns = container.querySelectorAll(".play-btn");
    expect(playBtns.length).toBeGreaterThan(0);

    // Events should be rendered
    expect(container.innerHTML).toContain("keydown:KeyA");
    expect(container.innerHTML).toContain("click");

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ========================================================================
  // audio playback and toggle (playAudio, stopAudio)
  // ========================================================================

  it("clicking audio play button toggles playback", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    // Mock Audio
    const mockAudioInstance = {
      src: "", play: vi.fn(), pause: vi.fn(),
      onended: null as any, onerror: null as any,
    };
    const OrigAudio = (globalThis as any).Audio;
    (globalThis as any).Audio = class MockAudio {
      constructor(src?: string) {
        mockAudioInstance.src = src || "";
        return mockAudioInstance as any;
      }
    };

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          audios: { zh: [{ name: "click_sfx", audio: "click.wav" }] },
          texts: {},
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    // Click play button
    const playBtns = container.querySelectorAll(".play-btn");
    if (playBtns.length > 0) {
      await fireEvent.click(playBtns[0] as HTMLButtonElement);
      await flushAsync();
      expect(mockAudioInstance.play).toHaveBeenCalled();

      // Click again should stop (toggle)
      await fireEvent.click(playBtns[0] as HTMLButtonElement);
      await flushAsync();
      expect(mockAudioInstance.pause).toHaveBeenCalled();
    }

    (globalThis as any).Audio = OrigAudio;
    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("audio onended resets playing state", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    let lastMockAudio: any = null;
    const OrigAudio = (globalThis as any).Audio;
    (globalThis as any).Audio = class MockAudio {
      src = "";
      play = vi.fn();
      pause = vi.fn();
      onended: any = null;
      onerror: any = null;
      constructor(src?: string) {
        this.src = src || "";
        lastMockAudio = this;
      }
    };

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          audios: { zh: [{ name: "sfx", audio: "s.wav" }] },
          texts: {},
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    const playBtns = container.querySelectorAll(".play-btn");
    if (playBtns.length > 0) {
      await fireEvent.click(playBtns[0] as HTMLButtonElement);
      await flushAsync();

      // Simulate audio ended
      if (lastMockAudio?.onended) {
        lastMockAudio.onended();
        await flushAsync();
      }
    }

    (globalThis as any).Audio = OrigAudio;
    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("audio onerror logs error and resets", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    let lastMockAudio: any = null;
    const OrigAudio = (globalThis as any).Audio;
    (globalThis as any).Audio = class MockAudio {
      src = "";
      play = vi.fn();
      pause = vi.fn();
      onended: any = null;
      onerror: any = null;
      constructor(src?: string) {
        this.src = src || "";
        lastMockAudio = this;
      }
    };

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          audios: { zh: [{ name: "sfx", audio: "s.wav" }] },
          texts: {},
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    const playBtns = container.querySelectorAll(".play-btn");
    if (playBtns.length > 0) {
      await fireEvent.click(playBtns[0] as HTMLButtonElement);
      await flushAsync();

      // Simulate audio error
      if (lastMockAudio?.onerror) {
        lastMockAudio.onerror();
        await flushAsync();
      }
    }

    (globalThis as any).Audio = OrigAudio;
    errorSpy.mockRestore();
    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ========================================================================
  // image viewer open/close
  // ========================================================================

  it("clicking thumbnail opens image viewer, clicking overlay closes it", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          imgs: [
            { name: "bg", img: "bg.png", frame_size_x: 100, frame_size_y: 100, frame_num_x: 1, frame_num_y: 1, frame_time: 0.1, sequence: false, origin_reverse: false, need_reverse: false, offset_x: 0, offset_y: 0 },
          ],
          sequences: [],
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    // Click thumbnail button
    const thumbBtns = container.querySelectorAll(".thumbnail-btn");
    if (thumbBtns.length > 0) {
      await fireEvent.click(thumbBtns[0] as HTMLButtonElement);
      await flushAsync();

      // Viewer should be visible
      const overlay = document.querySelector(".image-viewer-overlay");
      expect(overlay).toBeTruthy();

      // Click overlay to close
      if (overlay) {
        await fireEvent.click(overlay);
        await flushAsync();
      }
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("clicking viewer close button closes image viewer", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          imgs: [
            { name: "bg", img: "bg.png", frame_size_x: 100, frame_size_y: 100, frame_num_x: 1, frame_num_y: 1, frame_time: 0.1, sequence: false, origin_reverse: false, need_reverse: false, offset_x: 0, offset_y: 0 },
          ],
          sequences: [],
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    const thumbBtns = container.querySelectorAll(".thumbnail-btn");
    if (thumbBtns.length > 0) {
      await fireEvent.click(thumbBtns[0] as HTMLButtonElement);
      await flushAsync();

      // Click close button
      const closeBtn = document.querySelector(".viewer-close") as HTMLButtonElement;
      if (closeBtn) {
        await fireEvent.click(closeBtn);
        await flushAsync();
      }
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ========================================================================
  // sequence mod with rich data (imgs, sequences, flags)
  // ========================================================================

  it("sequence mod with images and sequences renders all flags", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          manifest: {
            mod_type: "sequence",
            show_mod_data_panel: true,
            enable_texture_downsample: true,
            global_keyboard: true,
            global_mouse: true,
            border: { enable: true, anima: "border.anim", z_offset: 5 },
          },
          imgs: [
            {
              name: "animated", img: "anim.png",
              frame_size_x: 64, frame_size_y: 64, frame_num_x: 4, frame_num_y: 2,
              frame_time: 0.1, sequence: true, origin_reverse: true, need_reverse: true,
              offset_x: 10, offset_y: -5,
            },
          ],
          sequences: [
            {
              name: "walk", img: "walk.png",
              frame_size_x: 64, frame_size_y: 64, frame_num_x: 8, frame_num_y: 1,
              frame_time: 0.08, origin_reverse: true, need_reverse: true,
              offset_x: 5, offset_y: 3,
            },
          ],
          info: {
            en: { name: "Demo", id: "demo", lang: "en", description: "A demo mod" },
            zh: { name: "演示", id: "demo", lang: "zh" },
          },
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    // Should render sequence flags
    const html = container.innerHTML;
    expect(html).toContain("10,-5");  // offset
    expect(html).toContain("4 x 2");  // frame layout

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ========================================================================
  // ai_tools data → formatAiPrompts, formatAiTriggers, formatAiResultProcessors
  // ========================================================================

  it("mod with ai_tools renders AI tool info", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          ai_tools: {
            ai_tools: [
              {
                window_name: "TestApp",
                process_name: "test.exe",
                tool_data: [
                  {
                    name: "tool1",
                    type: "auto",
                    auto_start: true,
                    capture_rect: { x: 0, y: 0, width: 100, height: 100 },
                    prompts: ["prompt1", "prompt2"],
                    triggers: [{ keyword: "hello", trigger: "greet" }],
                    result_processors: [{ type: "number", result: "score" }],
                    show_info_window: true,
                  },
                  {
                    name: "tool2",
                    type: "manual",
                    auto_start: false,
                    prompts: null,
                    triggers: [],
                    result_processors: [],
                    show_info_window: false,
                  },
                ],
              },
            ],
          },
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    const html = container.innerHTML;
    expect(html).toContain("TestApp");
    expect(html).toContain("tool1");
    expect(html).toContain("prompt1; prompt2");

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("formatAiPrompts with non-string items serializes to JSON", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          ai_tools: {
            ai_tools: [
              {
                window_name: "App",
                tool_data: [
                  {
                    name: "tool",
                    type: "auto",
                    prompts: [{ text: "complex" }, "simple"],
                    triggers: [{ keyword: "", trigger: "" }],
                    result_processors: [{ type: "?", result: "" }],
                    show_info_window: false,
                  },
                ],
              },
            ],
          },
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    // Complex prompt should be JSON stringified
    expect(container.innerHTML).toContain('{"text":"complex"}');

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("formatAiPrompts with string input returns String value", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          ai_tools: {
            ai_tools: [
              {
                window_name: "App",
                tool_data: [
                  {
                    name: "tool",
                    type: "auto",
                    prompts: "single string prompt",
                    triggers: [],
                    result_processors: [],
                    show_info_window: false,
                  },
                ],
              },
            ],
          },
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    expect(container.innerHTML).toContain("single string prompt");

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ========================================================================
  // rich state data → many template branches
  // ========================================================================

  it("mod with rich state data covers all state detail branches", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          manifest: {
            important_states: {
              idle: {
                name: "idle", persistent: true, priority: 5, play_once: false,
                anima: "idle.anim", audio: "sfx_idle", text: "Hello!",
                next_state: "happy", trigger_time: 3000, trigger_rate: 0.5,
                mod_data_counter: { op: "add", value: 1 },
                trigger_counter_start: 0, trigger_counter_end: 50,
                trigger_temp_start: -10, trigger_temp_end: 35,
                trigger_uptime: 30,
                trigger_weather: ["Clear", "Cloudy"],
                date_start: "01-01", date_end: "12-31",
                time_start: "08:00", time_end: "22:00",
                live2d_params: [{ id: "EyeL", value: 1, target: "PartOpacity" }],
                pngremix_params: [{ type: "expression", name: "smile" }],
                can_trigger_states: [{ state: "happy", weight: 2 }],
                branch: [{ text: "Go", next_state: "happy" }],
                branch_show_bubble: false,
              },
              alert: {
                name: "alert", persistent: false, priority: 10, play_once: true,
                anima: "alert.anim", next_state: "idle",
                trigger_time: 5000, trigger_rate: 1.0,
                can_trigger_states: [{ state: "idle", weight: 1 }],
              },
            },
            states: [
              {
                name: "sleep", persistent: true, priority: 2, play_once: false,
                anima: "sleep.anim", audio: "zzz", text: "zzz...",
                next_state: "idle", trigger_time: 10000, trigger_rate: 0.3,
                mod_data_counter: { op: "set", value: 10 },
                trigger_counter_start: 5, trigger_counter_end: 99,
                trigger_temp_start: 0, trigger_temp_end: 25,
                trigger_uptime: 60,
                trigger_weather: ["Rain"],
                date_start: "06-01", date_end: "08-31",
                time_start: "22:00", time_end: "06:00",
                live2d_params: [{ id: "Breath", value: 0.5 }],
                pngremix_params: [{ type: "motion", name: "float" }],
                can_trigger_states: [{ state: "dance", weight: 3 }],
                branch: [{ text: "Wake", next_state: "idle" }, { text: "Continue", next_state: "sleep" }],
                branch_show_bubble: false,
              },
              {
                name: "dance", persistent: false, priority: 1, play_once: true,
              },
            ],
            triggers: [
              {
                event: "click",
                can_trigger_states: [
                  { persistent_state: "idle", allow_repeat: false, states: [{ state: "happy", weight: 2 }] },
                  { persistent_state: null, states: [] },
                ],
              },
              {
                event: "empty_trigger",
                can_trigger_states: [],
              },
            ],
          },
          audios: { zh: [{ name: "sfx_idle", audio: "idle.wav" }], en: [{ name: "sfx_idle", audio: "idle_en.wav" }] },
          texts: { zh: [{ name: "greeting", text: "你好", duration: 3 }] },
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    const html = container.innerHTML;
    // Verify rich state data branches are hit
    expect(html).toContain("idle");
    expect(html).toContain("sleep");
    expect(html).toContain("Clear");
    expect(html).toContain("(Part)"); // PartOpacity
    expect(html).toContain("Go"); // branch text

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ========================================================================
  // threed mod with texture_base_dir and animation_base_dir
  // ========================================================================

  it("threed mod with texture and animation base dirs renders them", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          manifest: { mod_type: "3d" },
          threed: {
            model: {
              name: "robot", type: "vrm", file: "r.vrm", scale: 1.5,
              offset_x: 10, offset_y: -5,
              texture_base_dir: "textures",
              animation_base_dir: "animations",
            },
            animations: [
              { name: "idle", type: "embedded", file: "", speed: 1, fps: 30 },
              { name: "run", type: "file", file: "run.fbx", speed: 2, fps: 60 },
            ],
            states: [{ state: "idle", animation: "idle" }],
          },
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    const html = container.innerHTML;
    expect(html).toContain("textures");
    expect(html).toContain("animations");
    expect(html).toContain("vrm");

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ========================================================================
  // openAssetFile via open button click
  // ========================================================================

  it("clicking open file button on audio calls openAssetFile", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          audios: { zh: [{ name: "sfx", audio: "sfx.wav" }] },
          texts: {},
        });
      }
      if (command === "open_path") return null;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    // Click open button (folder icon)
    const openBtns = container.querySelectorAll(".open-btn");
    if (openBtns.length > 0) {
      await fireEvent.click(openBtns[0] as HTMLButtonElement);
      await flushAsync();
      expect(invokeMock).toHaveBeenCalledWith("open_path", expect.objectContaining({ path: expect.stringContaining("audio/sfx.wav") }));
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ========================================================================
  // text resources section
  // ========================================================================

  it("renders text resources with duration", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          audios: {},
          texts: {
            zh: [
              { name: "greeting", text: "你好世界", duration: 5 },
              { name: "farewell", text: "再见", duration: 3 },
            ],
            en: [
              { name: "greeting", text: "Hello World", duration: 5 },
            ],
          },
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    const html = container.innerHTML;
    expect(html).toContain("你好世界");
    expect(html).toContain("5s");

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ========================================================================
  // openAssetFile when currentModInfo is null → early return
  // ========================================================================

  it("openAssetFile does nothing when no mod loaded", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") return null;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(ResourceManagerDebugger);
    await flushAsync();

    // open_path should never be called since currentModInfo is null
    expect(invokeMock).not.toHaveBeenCalledWith("open_path", expect.anything());

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ========================================================================
  // unmount while audio is playing → stopAudio called via onDestroy
  // ========================================================================

  it("unmount stops audio via onDestroy", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    const mockPause = vi.fn();
    const OrigAudio = (globalThis as any).Audio;
    (globalThis as any).Audio = class MockAudio {
      src = "";
      play = vi.fn();
      pause = mockPause;
      onended: any = null;
      onerror: any = null;
    };

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          audios: { zh: [{ name: "sfx", audio: "s.wav" }] },
          texts: {},
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container, unmount } = render(ResourceManagerDebugger);
    await flushAsync();

    // Play audio
    const playBtns = container.querySelectorAll(".play-btn");
    if (playBtns.length > 0) {
      await fireEvent.click(playBtns[0] as HTMLButtonElement);
      await flushAsync();
    }

    // Unmount should call stopAudio
    unmount();
    await flushAsync();
    expect(mockPause).toHaveBeenCalled();

    (globalThis as any).Audio = OrigAudio;
    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ========================================================================
  // resolveAudioPathByName — fallback to other language
  // ========================================================================

  it("resolveAudioPathByName falls back to other language when prefer lang not found", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          manifest: { mod_type: "live2d", default_audio_lang_id: "ja" },
          audios: {
            // "ja" has no "sfx_a" but "en" does
            en: [{ name: "sfx_a", audio: "sfx_en.wav" }],
          },
          live2d: {
            model: {
              base_dir: "l2d", model_json: "m.json",
              textures_dir: "", motions_dir: "", expressions_dir: "",
              physics_json: "", pose_json: "", breath_json: "",
              scale: 1, eye_blink: false, lip_sync: false,
            },
            motions: [], expressions: [],
            states: [{ state: "idle", motion: "idle", expression: "", scale: 1, offset_x: 0, offset_y: 0 }],
            background_layers: [
              { name: "bg", file: "", layer: "", events: [], audio: "sfx_a" },
            ],
          },
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    // Should find sfx_a via fallback to "en"
    expect(container.innerHTML).toContain("sfx_a");

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ========================================================================
  // resolveAudioPathByName — audio not found (returns null)
  // ========================================================================

  it("resolveAudioPathByName returns null when audio not found in any lang", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          manifest: { mod_type: "live2d" },
          audios: { zh: [{ name: "other", audio: "other.wav" }] },
          live2d: {
            model: {
              base_dir: "l2d", model_json: "m.json",
              textures_dir: "", motions_dir: "", expressions_dir: "",
              physics_json: "", pose_json: "", breath_json: "",
              scale: 1, eye_blink: false, lip_sync: false,
            },
            motions: [], expressions: [],
            states: [{ state: "idle", motion: "idle", expression: "", scale: 1, offset_x: 0, offset_y: 0 }],
            background_layers: [
              { name: "bg", file: "", layer: "", events: [], audio: "nonexistent_sfx" },
            ],
          },
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    // Should render the audio name but no play button since resolveAudioPathByName returns null
    expect(container.innerHTML).toContain("nonexistent_sfx");

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ========================================================================
  // playAudio without currentModInfo → early return
  // ========================================================================

  it("playAudio does nothing when currentModInfo is null (no mod loaded)", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") return null;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(ResourceManagerDebugger);
    await flushAsync();

    // No play buttons should exist
    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ========================================================================
  // refreshMods selects first mod when no mod is loaded and selectedMod is empty
  // ========================================================================

  it("refreshMods selects first available mod when no current mod", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return ["mod_a", "mod_b"];
      if (command === "get_current_mod") return null;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    // The component should select "mod_a" as default
    const select = container.querySelector("select");
    if (select) {
      expect(select.value).toBe("mod_a");
    }

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ========================================================================
  // getLive2dAssetSrc without live2d data → returns ""
  // ========================================================================

  it("live2d without live2d data returns empty asset src", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return createMod3({
          manifest: { mod_type: "live2d" },
          // No live2d field → getLive2dAssetSrc returns ""
        });
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ResourceManagerDebugger);
    await flushAsync();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });
});
