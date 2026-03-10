/**
 * AiToolDebugger 组件渲染与交互测试
 *
 * 覆盖:
 * - 初始加载状态
 * - 调试信息渲染（工具列表、匹配窗口、任务状态）
 * - null/error 状态
 * - 刷新按钮
 * - 事件推送更新
 * - keep_screenshots toggle
 * - 空工具列表
 */
import { fireEvent, render } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import AiToolDebugger from "../lib/components/AiToolDebugger.svelte";
import { flushAsync } from "./test-utils";

const MOCK_DEBUG_INFO = {
  matched_window: "Visual Studio Code",
  tools: [
    {
      name: "code-watcher",
      tool_type: "auto",
      enabled: true,
      has_task: true,
      task_id: "42",
      show_info_window: true,
      info_window_visible: true,
    },
    {
      name: "manual-capture",
      tool_type: "manual",
      enabled: false,
      has_task: false,
      task_id: null,
      show_info_window: false,
      info_window_visible: false,
    },
  ],
  active_task_count: 1,
  last_update_time: "14:30:00",
  keep_screenshots: false,
};

describe("AiToolDebugger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state initially when invoke returns null", async () => {
    const { container } = render(AiToolDebugger);
    await flushAsync();

    expect(container.querySelector(".ai-tool-debugger")).toBeTruthy();
    expect(container.querySelector(".loading")).toBeTruthy();
  });

  it("renders debug info when invoke returns data", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_ai_tool_debug_info") return MOCK_DEBUG_INFO;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(AiToolDebugger);
    await flushAsync();

    // 基础区块渲染
    expect(container.querySelector(".info-grid")).toBeTruthy();
    expect(container.querySelector(".tool-table")).toBeTruthy();
    expect(container.querySelector(".status-cards")).toBeTruthy();

    // 匹配窗口显示
    const values = container.querySelectorAll(".value.mono");
    const matchedWindowText = Array.from(values)
      .map((el) => el.textContent?.trim())
      .find((t) => t?.includes("Visual Studio Code"));
    expect(matchedWindowText).toBeTruthy();

    // 工具行数
    const toolRows = container.querySelectorAll(".tool-row:not(.tool-header)");
    expect(toolRows.length).toBe(2);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("shows error status when invoke throws", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_ai_tool_debug_info")
        throw new Error("backend error");
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(AiToolDebugger);
    await flushAsync();

    const statusEl = container.querySelector(".mini-status");
    expect(statusEl?.classList.contains("error")).toBe(true);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("refresh button reloads data", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_ai_tool_debug_info") return MOCK_DEBUG_INFO;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(AiToolDebugger);
    await flushAsync();

    const refreshBtn = container.querySelector(".refresh-btn");
    expect(refreshBtn).toBeTruthy();

    const callCountBefore = invokeMock.mock.calls.filter(
      (c) => c[0] === "get_ai_tool_debug_info",
    ).length;

    await fireEvent.click(refreshBtn!);
    await flushAsync();

    const callCountAfter = invokeMock.mock.calls.filter(
      (c) => c[0] === "get_ai_tool_debug_info",
    ).length;

    expect(callCountAfter).toBeGreaterThan(callCountBefore);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("updates on backend event push", async () => {
    const invokeMock = vi.mocked(invoke);
    const listenMock = vi.mocked(listen);
    const originalImpl = invokeMock.getMockImplementation();
    let eventCallback: ((event: any) => void) | null = null;

    // 拦截 listen 调用，捕获回调
    listenMock.mockImplementation(async (event: string, cb: any) => {
      if (event === "ai-tool-debug-update") {
        eventCallback = cb;
      }
      return () => {};
    });

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_ai_tool_debug_info") return MOCK_DEBUG_INFO;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(AiToolDebugger);
    await flushAsync();

    // 模拟后端推送更新
    const updatedInfo = {
      ...MOCK_DEBUG_INFO,
      matched_window: "Firefox",
      active_task_count: 3,
      last_update_time: "15:00:00",
    };

    expect(eventCallback).not.toBeNull();
    eventCallback!({ payload: updatedInfo });
    await flushAsync();

    const values = container.querySelectorAll(".value.mono");
    const firefoxText = Array.from(values)
      .map((el) => el.textContent?.trim())
      .find((t) => t?.includes("Firefox"));
    expect(firefoxText).toBeTruthy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("keep_screenshots checkbox calls toggle_keep_screenshots", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_ai_tool_debug_info") return MOCK_DEBUG_INFO;
      if (command === "toggle_keep_screenshots") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(AiToolDebugger);
    await flushAsync();

    const checkbox = container.querySelector(
      '.toggle-row input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(checkbox).toBeTruthy();

    await fireEvent.change(checkbox, { target: { checked: true } });
    await flushAsync();

    expect(invokeMock).toHaveBeenCalledWith("toggle_keep_screenshots", {
      keep: true,
    });

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("shows empty hint when no tools", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_ai_tool_debug_info")
        return {
          ...MOCK_DEBUG_INFO,
          matched_window: null,
          tools: [],
          active_task_count: 0,
        };
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(AiToolDebugger);
    await flushAsync();

    expect(container.querySelector(".empty-hint")).toBeTruthy();
    expect(container.querySelectorAll(".tool-row").length).toBe(0);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("displays auto and manual tool type badges correctly", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_ai_tool_debug_info") return MOCK_DEBUG_INFO;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(AiToolDebugger);
    await flushAsync();

    const autoBadge = container.querySelector(".type-auto");
    const manualBadge = container.querySelector(".type-manual");
    expect(autoBadge).toBeTruthy();
    expect(manualBadge).toBeTruthy();

    // enabled/disabled badges
    const onBadges = container.querySelectorAll(".badge.on");
    const offBadges = container.querySelectorAll(".badge.off");
    expect(onBadges.length).toBeGreaterThan(0);
    expect(offBadges.length).toBeGreaterThan(0);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("keep_screenshots toggle handles error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_ai_tool_debug_info") return MOCK_DEBUG_INFO;
      if (command === "toggle_keep_screenshots")
        throw new Error("toggle error");
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = render(AiToolDebugger);
    await flushAsync();

    const checkbox = container.querySelector(
      '.toggle-row input[type="checkbox"]',
    ) as HTMLInputElement;
    await fireEvent.change(checkbox, { target: { checked: true } });
    await flushAsync();

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("handles init error when listen throws", async () => {
    const invokeMock = vi.mocked(invoke);
    const listenMock = vi.mocked(listen);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_ai_tool_debug_info") return MOCK_DEBUG_INFO;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    listenMock.mockRejectedValueOnce(new Error("listen fail"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = render(AiToolDebugger);
    await flushAsync();

    expect(consoleSpy).toHaveBeenCalledWith(
      "AiToolDebugger init error:",
      expect.any(Error),
    );

    // unmount should not throw even when unlisten is undefined
    unmount();

    consoleSpy.mockRestore();
    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("renders waiting status when debugInfo is explicitly null", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_ai_tool_debug_info") return null;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(AiToolDebugger);
    await flushAsync();

    // When debugInfo is null, should show loading/waiting state
    expect(container.querySelector(".loading")).toBeTruthy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("cleans up unlisten and lang subscription on unmount", async () => {
    const invokeMock = vi.mocked(invoke);
    const listenMock = vi.mocked(listen);
    const originalImpl = invokeMock.getMockImplementation();
    const unlistenFn = vi.fn();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_ai_tool_debug_info") return MOCK_DEBUG_INFO;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    listenMock.mockResolvedValueOnce(unlistenFn);

    const { unmount } = render(AiToolDebugger);
    await flushAsync();

    unmount();
    expect(unlistenFn).toHaveBeenCalled();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });
});
