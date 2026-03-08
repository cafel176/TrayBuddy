/**
 * AiToolPanel 组件渲染与交互测试
 *
 * 覆盖:
 * - visible=false 不渲染
 * - visible=true + 空列表不渲染
 * - 工具列表渲染（name、type、checkbox）
 * - checkbox onToggle 回调
 * - showInfoWindow checkbox onToggleInfoWindow 回调
 * - 禁用时不显示 info window toggle
 * - i18n header 和 tooltip
 */
import { fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AiToolPanel from "../lib/components/AiToolPanel.svelte";

async function flushAsync() {
  await tick();
  await new Promise((r) => setTimeout(r, 0));
  await tick();
}

const MOCK_TOOLS = [
  {
    name: "watcher",
    type: "auto",
    enabled: true,
    showInfoWindow: true,
    infoWindowVisible: true,
  },
  {
    name: "manual-cap",
    type: "manual",
    enabled: false,
    showInfoWindow: true,
    infoWindowVisible: false,
  },
  {
    name: "simple",
    type: "auto",
    enabled: true,
    showInfoWindow: false,
    infoWindowVisible: false,
  },
];

describe("AiToolPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when visible is false", async () => {
    const { container } = render(AiToolPanel, {
      props: { visible: false, tools: MOCK_TOOLS },
    });
    await flushAsync();

    expect(container.querySelector(".ai-tool-panel")).toBeFalsy();
  });

  it("does not render when tools is empty", async () => {
    const { container } = render(AiToolPanel, {
      props: { visible: true, tools: [] },
    });
    await flushAsync();

    expect(container.querySelector(".ai-tool-panel")).toBeFalsy();
  });

  it("renders panel with tools when visible and tools provided", async () => {
    const { container } = render(AiToolPanel, {
      props: { visible: true, tools: MOCK_TOOLS },
    });
    await flushAsync();

    expect(container.querySelector(".ai-tool-panel")).toBeTruthy();
    expect(container.querySelector(".ai-tool-header")).toBeTruthy();

    const items = container.querySelectorAll(".ai-tool-item");
    expect(items.length).toBe(3);

    // tool names
    const names = container.querySelectorAll(".ai-tool-name");
    expect(names[0]?.textContent).toBe("watcher");
    expect(names[1]?.textContent).toBe("manual-cap");
    expect(names[2]?.textContent).toBe("simple");

    // tool types
    const types = container.querySelectorAll(".ai-tool-type");
    expect(types[0]?.textContent).toBe("auto");
    expect(types[1]?.textContent).toBe("manual");
  });

  it("checkbox states reflect enabled property", async () => {
    const { container } = render(AiToolPanel, {
      props: { visible: true, tools: MOCK_TOOLS },
    });
    await flushAsync();

    const checkboxes = container.querySelectorAll(
      ".ai-tool-item input[type='checkbox']",
    );
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false);
    expect((checkboxes[2] as HTMLInputElement).checked).toBe(true);
  });

  it("fires onToggle when tool checkbox changes", async () => {
    const onToggle = vi.fn();
    const { container } = render(AiToolPanel, {
      props: { visible: true, tools: MOCK_TOOLS, onToggle },
    });
    await flushAsync();

    const checkboxes = container.querySelectorAll(
      ".ai-tool-item input[type='checkbox']",
    );
    await fireEvent.change(checkboxes[1], { target: { checked: true } });
    await flushAsync();

    expect(onToggle).toHaveBeenCalledWith("manual-cap", true);
  });

  it("shows info window toggle only for enabled tools with showInfoWindow", async () => {
    const { container } = render(AiToolPanel, {
      props: { visible: true, tools: MOCK_TOOLS },
    });
    await flushAsync();

    // watcher: enabled=true, showInfoWindow=true → visible
    // manual-cap: enabled=false, showInfoWindow=true → hidden (因为 enabled=false)
    // simple: enabled=true, showInfoWindow=false → hidden
    const infoToggles = container.querySelectorAll(".ai-tool-info-toggle");
    expect(infoToggles.length).toBe(1);
  });

  it("fires onToggleInfoWindow when info checkbox changes", async () => {
    const onToggleInfoWindow = vi.fn();
    const { container } = render(AiToolPanel, {
      props: { visible: true, tools: MOCK_TOOLS, onToggleInfoWindow },
    });
    await flushAsync();

    const infoCheckbox = container.querySelector(
      ".ai-tool-info-toggle input[type='checkbox']",
    ) as HTMLInputElement;
    expect(infoCheckbox).toBeTruthy();

    await fireEvent.change(infoCheckbox, { target: { checked: false } });
    await flushAsync();

    expect(onToggleInfoWindow).toHaveBeenCalledWith("watcher", false);
  });

  it("renders info window checkbox as checked when infoWindowVisible is true", async () => {
    const { container } = render(AiToolPanel, {
      props: { visible: true, tools: MOCK_TOOLS },
    });
    await flushAsync();

    const infoCheckbox = container.querySelector(
      ".ai-tool-info-toggle input[type='checkbox']",
    ) as HTMLInputElement;
    expect(infoCheckbox?.checked).toBe(true);
  });

  it("renders i18n header text", async () => {
    const { container } = render(AiToolPanel, {
      props: { visible: true, tools: MOCK_TOOLS },
    });
    await flushAsync();

    const header = container.querySelector(".ai-tool-header");
    expect(header?.textContent?.trim()).toBeTruthy();
    // i18n 返回 key 本身在测试环境下也算合理
    expect(header?.textContent?.trim().length).toBeGreaterThan(0);
  });
});
