/**
 * AI Tool Info 页面测试
 *
 * 覆盖:
 * - 页面渲染
 * - placeholder 显示
 * - 事件监听
 * - 事件接收后文本更新
 * - 鼠标拖拽交互
 * - resize 方向判断
 */
import { fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import AiToolInfoPage from "../routes/ai_tool_info/+page.svelte";

async function flushAsync() {
  await tick();
  await new Promise((r) => setTimeout(r, 0));
  await tick();
}

describe("AI Tool Info Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 模拟 URL query 参数
    const originalLocation = window.location;
    // @ts-expect-error: mock location
    delete window.location;
    window.location = {
      ...originalLocation,
      search: "?tool=test-tool",
    } as Location;
  });

  it("renders info window with placeholder", async () => {
    const { container } = render(AiToolInfoPage);
    await flushAsync();

    expect(container.querySelector(".info-window")).toBeTruthy();
    expect(container.querySelector(".placeholder")).toBeTruthy();
    expect(container.querySelector(".placeholder")?.textContent).toBe("...");
  });

  it("subscribes to ai-tool-info-message event", async () => {
    const listenMock = vi.mocked(listen);
    render(AiToolInfoPage);
    await flushAsync();

    expect(listenMock).toHaveBeenCalledWith(
      "ai-tool-info-message",
      expect.any(Function),
    );
  });

  it("updates display text when receiving matching event", async () => {
    const listenMock = vi.mocked(listen);
    let eventCallback: ((event: any) => void) | null = null;

    listenMock.mockImplementation(async (event: string, cb: any) => {
      if (event === "ai-tool-info-message") {
        eventCallback = cb;
      }
      return () => {};
    });

    const { container } = render(AiToolInfoPage);
    await flushAsync();

    expect(eventCallback).not.toBeNull();
    eventCallback!({
      payload: { tool: "test-tool", message: "AI says hello" },
    });
    await flushAsync();

    const infoText = container.querySelector(".info-text");
    expect(infoText?.textContent?.trim()).toBe("AI says hello");
    expect(container.querySelector(".placeholder")).toBeFalsy();
  });

  it("ignores events for different tool names", async () => {
    const listenMock = vi.mocked(listen);
    let eventCallback: ((event: any) => void) | null = null;

    listenMock.mockImplementation(async (event: string, cb: any) => {
      if (event === "ai-tool-info-message") {
        eventCallback = cb;
      }
      return () => {};
    });

    const { container } = render(AiToolInfoPage);
    await flushAsync();

    eventCallback!({
      payload: { tool: "other-tool", message: "Should not appear" },
    });
    await flushAsync();

    expect(container.querySelector(".placeholder")).toBeTruthy();
  });

  it("handles mousedown for dragging (center area)", async () => {
    const mockWindow = vi.mocked(getCurrentWindow)();

    const { container } = render(AiToolInfoPage);
    await flushAsync();

    const infoWindow = container.querySelector(
      ".info-window",
    ) as HTMLDivElement;
    expect(infoWindow).toBeTruthy();

    // 模拟在窗口中心点击（非边缘）→ 启动拖拽
    await fireEvent.mouseDown(infoWindow, {
      clientX: 50,
      clientY: 50,
    });
  });

  it("handles mousemove for cursor style", async () => {
    const { container } = render(AiToolInfoPage);
    await flushAsync();

    const infoWindow = container.querySelector(
      ".info-window",
    ) as HTMLDivElement;

    await fireEvent.mouseMove(infoWindow, {
      clientX: 50,
      clientY: 50,
    });

    // 内部区域 cursor 应为 grab
    expect(infoWindow.style.cursor).toBe("grab");
  });

  it("cleans up listener on destroy", async () => {
    const listenMock = vi.mocked(listen);
    const unlistenFn = vi.fn();
    listenMock.mockResolvedValue(unlistenFn);

    const { unmount } = render(AiToolInfoPage);
    await flushAsync();

    unmount();
    expect(unlistenFn).toHaveBeenCalled();
  });

  it("shows resize cursor and triggers resize dragging at window edge", async () => {
    const mockWindow = vi.mocked(getCurrentWindow)();

    // Set window dimensions for edge detection using configurable getters
    const origInnerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    const origInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });

    const { container } = render(AiToolInfoPage);
    await flushAsync();

    const infoWindow = container.querySelector(
      ".info-window",
    ) as HTMLDivElement;

    // Move mouse to top-left corner (NorthWest edge)
    await fireEvent.mouseMove(infoWindow, { clientX: 2, clientY: 2 });
    expect(infoWindow.style.cursor).toBe("nw-resize");

    // Move mouse to bottom-right corner (SouthEast edge)
    await fireEvent.mouseMove(infoWindow, { clientX: 798, clientY: 598 });
    expect(infoWindow.style.cursor).toBe("se-resize");

    // Move mouse to top edge (North)
    await fireEvent.mouseMove(infoWindow, { clientX: 400, clientY: 2 });
    expect(infoWindow.style.cursor).toBe("n-resize");

    // Move mouse to right edge (East)
    await fireEvent.mouseMove(infoWindow, { clientX: 798, clientY: 300 });
    expect(infoWindow.style.cursor).toBe("e-resize");

    // Mousedown at edge triggers resize dragging
    // In jsdom scrollHeight/clientHeight are both 0, so scrollbar check (0 > 0) is false => passes through
    await fireEvent.mouseDown(infoWindow, { clientX: 2, clientY: 2 });
    expect(mockWindow.startResizeDragging).toHaveBeenCalledWith("NorthWest");

    // Restore
    if (origInnerWidth) Object.defineProperty(window, "innerWidth", origInnerWidth);
    if (origInnerHeight) Object.defineProperty(window, "innerHeight", origInnerHeight);
  });

  it("triggers startDragging when mousedown in center (non-edge)", async () => {
    const mockWindow = vi.mocked(getCurrentWindow)();

    const origInnerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    const origInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });

    const { container } = render(AiToolInfoPage);
    await flushAsync();

    const infoWindow = container.querySelector(
      ".info-window",
    ) as HTMLDivElement;

    // In jsdom, scrollHeight=0 and clientHeight=0, so scrollbar check (0>0) is false => passes through
    // clientX=400, clientY=300 is center of 800x600 → getResizeDirection returns null → startDragging
    await fireEvent.mouseDown(infoWindow, { clientX: 400, clientY: 300 });
    expect(mockWindow.startDragging).toHaveBeenCalled();

    // Restore
    if (origInnerWidth) Object.defineProperty(window, "innerWidth", origInnerWidth);
    if (origInnerHeight) Object.defineProperty(window, "innerHeight", origInnerHeight);
  });

  it("skips dragging when clicking scrollbar area", async () => {
    const mockWindow = vi.mocked(getCurrentWindow)();

    const origInnerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    const origInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });

    const { container } = render(AiToolInfoPage);
    await flushAsync();

    const infoWindow = container.querySelector(
      ".info-window",
    ) as HTMLDivElement;

    // Simulate scrollbar visible: scrollHeight > clientHeight, offsetX >= clientWidth
    Object.defineProperty(infoWindow, "scrollHeight", { value: 500, configurable: true });
    Object.defineProperty(infoWindow, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(infoWindow, "clientWidth", { value: 100, configurable: true });

    // Create a real MouseEvent with offsetX we control
    const mouseEvent = new MouseEvent("mousedown", {
      clientX: 400,
      clientY: 300,
      bubbles: true,
    });
    // offsetX is read-only, override it
    Object.defineProperty(mouseEvent, "offsetX", { value: 150 });
    infoWindow.dispatchEvent(mouseEvent);
    await flushAsync();

    // scrollHeight(500) > clientHeight(200) && offsetX(150) >= clientWidth(100) → early return
    expect(mockWindow.startDragging).not.toHaveBeenCalled();
    expect(mockWindow.startResizeDragging).not.toHaveBeenCalled();

    // Restore
    if (origInnerWidth) Object.defineProperty(window, "innerWidth", origInnerWidth);
    if (origInnerHeight) Object.defineProperty(window, "innerHeight", origInnerHeight);
  });
});
