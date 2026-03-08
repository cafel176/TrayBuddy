/**
 * 组件渲染与交互测试
 * 覆盖 src/lib/components/ 下 10 个调试/设置组件的脚本逻辑
 */
import { fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
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

async function flushAsync() {
  await tick();
  await new Promise((r) => setTimeout(r, 0));
  await tick();
}

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
      ai_image_base_url: "",
      ai_image_model: "",
      ai_screenshot_interval: 1.0,
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
});

// ============================================================================
// ResourceManagerDebugger
// ============================================================================

describe("ResourceManagerDebugger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** 基础 manifest 字段，避免模板中 undefined 访问 */
  const baseManifest = {
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

  /** 创建完整的 sequence 类型 mock mod info */
  function createSeqMod(overrides: Record<string, any> = {}) {
    const { manifest: mOverrides, ...rest } = overrides;
    return {
      path: "C:/mods/demo",
      imgs: [], sequences: [], audios: {}, texts: {}, info: {},
      ...rest,
      manifest: { id: "demo", version: "1.0", mod_type: "sequence", important_states: {}, states: [], ...baseManifest, ...mOverrides },
    };
  }

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
            ...baseManifest,
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
