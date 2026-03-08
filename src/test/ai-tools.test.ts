/**
 * AI 工具配置管理模块 (aiTools.ts) 单元测试
 *
 * 覆盖:
 * - defaultAiToolsConfig 默认值
 * - aiToolsConfig / aiToolsLoaded store
 * - loadAiTools()：成功、返回 null、异常
 * - getCurrentAiTools()
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";

import {
  defaultAiToolsConfig,
  aiToolsConfig,
  aiToolsLoaded,
  loadAiTools,
  getCurrentAiTools,
} from "$lib/aiTools";

describe("aiTools module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 重置 store 到默认状态
    aiToolsConfig.set(defaultAiToolsConfig);
    aiToolsLoaded.set(false);
  });

  // ======================================================================= //
  // 默认值
  // ======================================================================= //

  it("defaultAiToolsConfig has empty ai_tools array", () => {
    expect(defaultAiToolsConfig).toEqual({ ai_tools: [] });
  });

  it("aiToolsConfig store defaults to empty config", () => {
    expect(get(aiToolsConfig)).toEqual({ ai_tools: [] });
  });

  it("aiToolsLoaded store defaults to false", () => {
    expect(get(aiToolsLoaded)).toBe(false);
  });

  // ======================================================================= //
  // loadAiTools - 成功
  // ======================================================================= //

  it("loadAiTools sets config and loaded on success", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    const mockConfig = {
      ai_tools: [
        {
          process_name: "chrome.exe",
          tool_data: [
            {
              name: "web-monitor",
              auto_start: true,
              tool_type: "auto",
              capture_rect: { x: 0, y: 0, width: 100, height: 100 },
              prompts: ["What do you see?"],
              triggers: [{ keyword: "error", trigger: "alert" }],
              show_info_window: true,
            },
          ],
        },
      ],
    };

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_ai_tools") return mockConfig;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    await loadAiTools();

    expect(get(aiToolsConfig)).toEqual(mockConfig);
    expect(get(aiToolsLoaded)).toBe(true);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ======================================================================= //
  // loadAiTools - null 返回
  // ======================================================================= //

  it("loadAiTools uses default config when invoke returns null", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_ai_tools") return null;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    await loadAiTools();

    expect(get(aiToolsConfig)).toEqual(defaultAiToolsConfig);
    expect(get(aiToolsLoaded)).toBe(true);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("loadAiTools uses default config when ai_tools is missing", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_ai_tools") return { other_field: true };
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    await loadAiTools();

    expect(get(aiToolsConfig)).toEqual(defaultAiToolsConfig);
    expect(get(aiToolsLoaded)).toBe(true);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ======================================================================= //
  // loadAiTools - 异常
  // ======================================================================= //

  it("loadAiTools handles invoke error gracefully", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_ai_tools") throw new Error("network error");
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await loadAiTools();

    expect(get(aiToolsConfig)).toEqual(defaultAiToolsConfig);
    expect(get(aiToolsLoaded)).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[aiTools]"),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  // ======================================================================= //
  // getCurrentAiTools
  // ======================================================================= //

  it("getCurrentAiTools returns current store value", () => {
    const config = { ai_tools: [{ process_name: "test", tool_data: [] }] };
    aiToolsConfig.set(config as any);
    expect(getCurrentAiTools()).toEqual(config);
  });

  it("getCurrentAiTools returns default after reset", () => {
    aiToolsConfig.set(defaultAiToolsConfig);
    expect(getCurrentAiTools()).toEqual(defaultAiToolsConfig);
  });
});
