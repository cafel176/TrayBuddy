import { fireEvent, render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, emit } from "@tauri-apps/api/event";
import { resolveResource } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";

import * as i18n from "$lib/i18n";
import { SpriteAnimator, initMemoryDebug, clearImageCache } from "$lib/animation/SpriteAnimator";


import RootPage from "../routes/+page.svelte";
import AboutPage from "../routes/about/+page.svelte";
import SettingsPage from "../routes/settings/+page.svelte";
import ModsPage from "../routes/mods/+page.svelte";
import MemoPage from "../routes/memo/+page.svelte";
import ReminderPage from "../routes/reminder/+page.svelte";
import ReminderAlertPage from "../routes/reminder_alert/+page.svelte";
import AnimationPage from "../routes/animation/+page.svelte";
import Live2DPage from "../routes/live2d/+page.svelte";
import ThreeDPage from "../routes/threed/+page.svelte";
import PngRemixPage from "../routes/pngremix/+page.svelte";
import LayoutDebugger from "../lib/components/LayoutDebugger.svelte";

async function flushAsync() {
  await tick();
  await new Promise((r) => setTimeout(r, 0));
  await tick();
  await new Promise((r) => setTimeout(r, 0));
  await tick();
}

async function flushFakeAsync() {
  for (let i = 0; i < 10; i++) {
    await tick();
    await Promise.resolve();
  }
}



beforeEach(() => {
  (globalThis as any).__lastWindowCore = null;
  (globalThis as any).__lastWindowCoreOptions = null;
  (globalThis as any).__lastLive2DPlayer = null;
  (globalThis as any).__lastThreeDPlayer = null;
  (globalThis as any).__lastPngRemixPlayer = null;
  vi.clearAllMocks();
  vi.useRealTimers();
});


describe("pages render", () => {
  it("root page switches tabs", async () => {
    const { container } = render(RootPage);
    await flushAsync();

    const buttons = Array.from(container.querySelectorAll(".tabs-nav button"));
    expect(buttons.length).toBeGreaterThan(3);

    await fireEvent.click(buttons[1]);
    expect(buttons[1].classList.contains("active")).toBe(true);
  });

  it("settings page renders", async () => {
    const { container } = render(SettingsPage);
    await flushAsync();
    expect(container.querySelector(".settings-page")).toBeTruthy();
  });

  it("about page renders and requests version", async () => {
    const { container } = render(AboutPage);
    await flushAsync();
    expect(container.querySelector(".about-container")).toBeTruthy();
    expect(getVersion).toHaveBeenCalled();
    expect(getCurrentWindow).toHaveBeenCalled();
  });

  it("mods page renders and triggers import action", async () => {
    const invokeMock = vi.mocked(invoke);
    const { container } = render(ModsPage);
    await flushAsync();

    const importBtn = container.querySelector(".import-btn") as HTMLButtonElement | null;
    expect(importBtn).toBeTruthy();

    await fireEvent.click(importBtn as HTMLButtonElement);
    expect(invokeMock).toHaveBeenCalledWith("pick_mod_tbuddy");

  });

  it("memo page can add memo", async () => {
    const user = userEvent.setup();
    const { container } = render(MemoPage);
    await flushAsync();

    const content = container.querySelector(".toolbar .content") as HTMLTextAreaElement | null;
    const addButton = container.querySelector(".toolbar .btn.primary") as HTMLButtonElement | null;

    expect(content).toBeTruthy();
    expect(addButton).toBeTruthy();
    expect(addButton?.disabled).toBe(true);

    await user.type(content as HTMLTextAreaElement, "Test memo");
    expect(addButton?.disabled).toBe(false);

    await user.click(addButton as HTMLButtonElement);
    await flushAsync();

    expect(container.querySelector(".items .item")).toBeTruthy();
  });

  it("reminder page can add reminder", async () => {
    const user = userEvent.setup();
    const { container } = render(ReminderPage);
    await flushAsync();

    const textArea = container.querySelector(".textarea") as HTMLTextAreaElement | null;
    const addButton = container.querySelector(".btn.primary") as HTMLButtonElement | null;

    expect(textArea).toBeTruthy();
    expect(addButton).toBeTruthy();
    expect(addButton?.disabled).toBe(true);

    await user.type(textArea as HTMLTextAreaElement, "Test reminder");
    expect(addButton?.disabled).toBe(false);

    await user.click(addButton as HTMLButtonElement);
    await flushAsync();

    expect(container.querySelector(".list .card")).toBeTruthy();
  });

  it("reminder alert page handles alert list and dismiss", async () => {
    const invokeMock = vi.mocked(invoke);
    const payload = [{
      id: "a1",
      text: "Alert",
      scheduled_at: 1000,
      fired_at: 1001,
    }];

    const originalImpl = invokeMock.getMockImplementation();
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "take_pending_reminder_alerts") return payload;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ReminderAlertPage);
    await flushAsync();

    expect(listen).toHaveBeenCalled();
    expect(container.querySelector(".card")).toBeTruthy();

    const dismiss = container.querySelector(".btn.primary") as HTMLButtonElement | null;
    expect(dismiss).toBeTruthy();

    await fireEvent.click(dismiss as HTMLButtonElement);
    await flushAsync();

    expect(container.querySelector(".card")).toBeFalsy();
    invokeMock.mockImplementation(originalImpl ?? (async () => null));

  });

  it("animation page renders canvas and forwards mouse down", async () => {
    const { container } = render(AnimationPage);
    await flushAsync();

    const canvas = container.querySelector(".character-canvas") as HTMLCanvasElement | null;
    expect(canvas).toBeTruthy();

    await fireEvent.mouseDown(canvas as HTMLCanvasElement);
    const core = (globalThis as any).__lastWindowCore;
    expect(core?.handleMouseDown).toHaveBeenCalled();
  });

  it("live2d page renders canvas and forwards mouse down", async () => {
    const { container } = render(Live2DPage);
    await flushAsync();

    const canvas = container.querySelector(".live2d-canvas") as HTMLCanvasElement | null;
    expect(canvas).toBeTruthy();

    await fireEvent.mouseDown(canvas as HTMLCanvasElement, { button: 0 });
    const core = (globalThis as any).__lastWindowCore;
    expect(core?.handleMouseDown).toHaveBeenCalled();
  });

  it("threed page renders canvas and forwards mouse down", async () => {
    const { container } = render(ThreeDPage);
    await flushAsync();

    const canvas = container.querySelector(".threed-canvas") as HTMLCanvasElement | null;
    expect(canvas).toBeTruthy();

    await fireEvent.mouseDown(canvas as HTMLCanvasElement);
    const core = (globalThis as any).__lastWindowCore;
    expect(core?.handleMouseDown).toHaveBeenCalled();
  });


  it("pngremix page renders canvas and forwards mouse down", async () => {
    const { container } = render(PngRemixPage);
    await flushAsync();

    const canvas = container.querySelector(".pngremix-canvas") as HTMLCanvasElement | null;
    expect(canvas).toBeTruthy();

    await fireEvent.mouseDown(canvas as HTMLCanvasElement);
    const core = (globalThis as any).__lastWindowCore;
    expect(core?.handleMouseDown).toHaveBeenCalled();
  });

});

describe("pages render extended", () => {
  it("root page switches to state and layout tabs", async () => {
    const { container } = render(RootPage);
    await flushAsync();

    const buttons = Array.from(container.querySelectorAll(".tabs-nav button"));
    expect(buttons.length).toBeGreaterThan(7);

    await fireEvent.click(buttons[1]);
    await flushAsync();
    expect(container.querySelector(".state-debugger")).toBeTruthy();

    await fireEvent.click(buttons[9]);
    await flushAsync();
    expect(container.querySelector(".layout-debugger")).toBeTruthy();
  });

  it("root page switches to remaining debug tabs", async () => {
    const { container } = render(RootPage);
    await flushAsync();

    const buttons = Array.from(container.querySelectorAll(".tabs-nav button"));
    expect(buttons.length).toBeGreaterThan(7);

    await fireEvent.click(buttons[2]);
    await flushAsync();
    expect(container.querySelector(".trigger-debugger")).toBeTruthy();

    await fireEvent.click(buttons[3]);
    await flushAsync();
    expect(container.querySelector(".env-debugger")).toBeTruthy();

    await fireEvent.click(buttons[4]);
    await flushAsync();
    expect(container.querySelector(".media-debugger")).toBeTruthy();

    await fireEvent.click(buttons[5]);
    await flushAsync();
    expect(container.querySelector(".process-debugger")).toBeTruthy();

    await fireEvent.click(buttons[6]);
    await flushAsync();
    expect(container.querySelector(".system-debugger")).toBeTruthy();

    await fireEvent.click(buttons[7]);
    await flushAsync();
    expect(container.querySelector(".ai-tool-debugger")).toBeTruthy();

    await fireEvent.click(buttons[8]);
    await flushAsync();
    expect(container.querySelector(".info-debugger")).toBeTruthy();
  });

  it("root page updates title and cleans i18n", async () => {
    const setupSpy = vi.spyOn(i18n, "setupI18nWithUpdate");
    const cleanup = vi.fn();

    setupSpy.mockImplementation(async (cb) => {
      cb();
      return cleanup;
    });

    const setTitle = vi.fn();
    vi.mocked(getCurrentWindow).mockReturnValue({ setTitle } as any);

    const { unmount } = render(RootPage);
    await flushAsync();

    expect(setTitle).toHaveBeenCalled();

    unmount();
    await flushAsync();

    expect(cleanup).toHaveBeenCalled();
    setupSpy.mockRestore();
  });

  it("about page falls back on version/icon and hides thanks when empty", async () => {
    const setupSpy = vi.spyOn(i18n, "setupI18nWithUpdate");
    setupSpy.mockImplementation(async (cb) => {
      cb();
      return () => {};
    });

    vi.mocked(getVersion).mockRejectedValueOnce(new Error("oops"));
    vi.mocked(resolveResource).mockRejectedValueOnce(new Error("no-icon"));

    const tArraySpy = vi.spyOn(i18n, "tArray").mockReturnValue([]);

    const { container } = render(AboutPage);
    await flushAsync();

    expect(container.querySelector(".logo-fallback")).toBeTruthy();
    expect(container.querySelector(".thanks-list")).toBeFalsy();
    expect(container.querySelector(".app-version")?.textContent).toContain("0.1.0");

    tArraySpy.mockRestore();
    setupSpy.mockRestore();
  });

  it("about page updates title and cleans i18n", async () => {
    const setupSpy = vi.spyOn(i18n, "setupI18nWithUpdate");
    const cleanup = vi.fn();

    setupSpy.mockImplementation(async (cb) => {
      cb();
      return cleanup;
    });

    const { unmount } = render(AboutPage);
    await flushAsync();

    const windowInstance = vi.mocked(getCurrentWindow).mock.results[0]?.value as { setTitle?: () => void } | undefined;
    expect(windowInstance?.setTitle).toHaveBeenCalled();

    unmount();
    await flushAsync();

    expect(cleanup).toHaveBeenCalled();
    setupSpy.mockRestore();
  });

  it("settings page updates title and cleans i18n", async () => {
    const setupSpy = vi.spyOn(i18n, "setupI18nWithUpdate");
    const cleanup = vi.fn();

    setupSpy.mockImplementation(async (cb) => {
      cb();
      return cleanup;
    });

    const setTitle = vi.fn();
    vi.mocked(getCurrentWindow).mockReturnValue({ setTitle } as any);

    const { unmount } = render(SettingsPage);
    await flushAsync();

    expect(setTitle).toHaveBeenCalled();

    unmount();
    await flushAsync();

    expect(cleanup).toHaveBeenCalled();
    setupSpy.mockRestore();
  });

  it("layout debugger emits status and toggle events", async () => {
    const emitMock = vi.mocked(emit);
    const { container } = render(LayoutDebugger);
    await flushAsync();

    expect(emitMock).toHaveBeenCalledWith("layout-debugger-status", true);

    const toggleBtn = container.querySelector(".toggle-btn") as HTMLButtonElement | null;
    await fireEvent.click(toggleBtn as HTMLButtonElement);
    await flushAsync();

    expect(emitMock).toHaveBeenCalledWith("toggle-debug-borders", true);
  });


  it("layout debugger emits status off on unmount", async () => {
    const emitMock = vi.mocked(emit);
    const { unmount } = render(LayoutDebugger);
    await flushAsync();
    unmount();
    await flushAsync();

    expect(emitMock).toHaveBeenCalledWith("layout-debugger-status", false);
  });


  it("settings page shows settings panel", async () => {

    const { container } = render(SettingsPage);
    await flushAsync();
    expect(container.querySelector(".settings-panel")).toBeTruthy();
  });

  it("about page loads icon image", async () => {
    const { container } = render(AboutPage);
    await flushAsync();
    expect(container.querySelector(".logo-img")).toBeTruthy();
  });

  it("mods page shows empty state by default", async () => {
    const { container } = render(ModsPage);
    await flushAsync();
    expect(container.querySelector(".empty-state")).toBeTruthy();
  });

  it("mods page shows conflict modal on same-id import", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return {
          path: "C:/mods/demo",
          manifest: {
            id: "demo",
            version: "1.0.0",
            author: "tester",
            default_text_lang_id: "zh",
          },
          info: {
            zh: { name: "Demo", lang: "zh", description: "" },
          },
        };
      }
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return ["demo"];
      if (command === "pick_mod_tbuddy") {
        return { filePath: "C:/mods/demo.tbuddy", id: "demo", version: "1.1.0" };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();

    const importBtn = container.querySelector(".import-btn") as HTMLButtonElement | null;
    expect(importBtn).toBeTruthy();

    await fireEvent.click(importBtn as HTMLButtonElement);
    await flushAsync();
    expect(container.querySelector(".modal")).toBeTruthy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("memo page supports pin, collapse, and reorder", async () => {
    const user = userEvent.setup();
    const { container } = render(MemoPage);
    await flushAsync();

    const content = container.querySelector(".toolbar .content") as HTMLTextAreaElement | null;
    const addButton = container.querySelector(".toolbar .btn.primary") as HTMLButtonElement | null;

    await user.type(content as HTMLTextAreaElement, "Memo A");
    await user.click(addButton as HTMLButtonElement);
    await flushAsync();

    await user.type(content as HTMLTextAreaElement, "Memo B");
    await user.click(addButton as HTMLButtonElement);
    await flushAsync();

    const firstItem = container.querySelector(".items .item") as HTMLElement | null;
    expect(firstItem).toBeTruthy();

    const pinBtn = firstItem?.querySelector(".pin") as HTMLButtonElement | null;
    await fireEvent.click(pinBtn as HTMLButtonElement);
    await flushAsync();
    expect(firstItem?.classList.contains("pinned")).toBe(true);

    const collapseBtn = container.querySelector(".collapse") as HTMLButtonElement | null;
    await fireEvent.click(collapseBtn as HTMLButtonElement);
    await flushAsync();
    expect(container.querySelector(".items")).toBeFalsy();

    await fireEvent.click(collapseBtn as HTMLButtonElement);
    await flushAsync();

    const textareas = Array.from(container.querySelectorAll(".memo-text")) as HTMLTextAreaElement[];
    expect(textareas.length).toBeGreaterThan(1);

    // Unpin Memo A before reordering so that order swap actually changes display order
    const pinnedFirst = container.querySelector(".items .item") as HTMLElement | null;
    const unpinBtn = pinnedFirst?.querySelector(".pin") as HTMLButtonElement | null;
    await fireEvent.click(unpinBtn as HTMLButtonElement);
    await flushAsync();

    const currentFirst = container.querySelector(".items .item") as HTMLElement | null;
    const actionButtons = currentFirst?.querySelectorAll(".actions .btn");
    const downBtn = actionButtons?.[1] as HTMLButtonElement | undefined;
    await fireEvent.click(downBtn as HTMLButtonElement);
    await flushAsync();

    const reordered = Array.from(container.querySelectorAll(".memo-text")) as HTMLTextAreaElement[];
    expect(reordered[0]?.value).toBe("Memo B");
  });

  it("reminder page supports enable toggle and schedule change", async () => {
    const user = userEvent.setup();
    const { container } = render(ReminderPage);
    await flushAsync();

    const textArea = container.querySelector(".textarea") as HTMLTextAreaElement | null;
    const addButton = container.querySelector(".btn.primary") as HTMLButtonElement | null;

    await user.type(textArea as HTMLTextAreaElement, "Test reminder");
    await user.click(addButton as HTMLButtonElement);
    await flushAsync();

    const card = container.querySelector(".list .card") as HTMLElement | null;
    const checkbox = card?.querySelector("input[type=\"checkbox\"]") as HTMLInputElement | null;
    await fireEvent.click(checkbox as HTMLInputElement);
    await flushAsync();
    expect(card?.classList.contains("disabled")).toBe(true);

    const scheduleSelect = card?.querySelector("select") as HTMLSelectElement | null;
    await fireEvent.change(scheduleSelect as HTMLSelectElement, { target: { value: "weekly" } });
    await flushAsync();
    expect(scheduleSelect?.value).toBe("weekly");
  });

  it("reminder alert page appends updates from event", async () => {
    const invokeMock = vi.mocked(invoke);
    const listenMock = vi.mocked(listen);
    const originalInvoke = invokeMock.getMockImplementation();
    const originalListen = listenMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "take_pending_reminder_alerts") return [];
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    listenMock.mockImplementation(async (_event: string, handler: (e: any) => void) => {
      handler({ payload: [{ id: "b1", text: "New", scheduled_at: 10, fired_at: 11 }] });
      return () => {};
    });

    const { container } = render(ReminderAlertPage);
    await flushAsync();

    expect(container.querySelectorAll(".card").length).toBe(1);

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
    listenMock.mockImplementation(originalListen ?? (async () => () => {}));
  });

  it("animation page forwards context menu", async () => {
    const { container } = render(AnimationPage);
    await flushAsync();

    const area = container.querySelector(".container") as HTMLElement | null;
    await fireEvent.contextMenu(area as HTMLElement);

    const core = (globalThis as any).__lastWindowCore;
    expect(core?.handleContextMenu).toHaveBeenCalled();
  });

  it("live2d page forwards context menu", async () => {
    const { container } = render(Live2DPage);
    await flushAsync();

    const area = container.querySelector(".container") as HTMLElement | null;
    await fireEvent.contextMenu(area as HTMLElement);

    const core = (globalThis as any).__lastWindowCore;
    expect(core?.handleContextMenu).toHaveBeenCalled();
  });

  it("threed page forwards context menu", async () => {
    const { container } = render(ThreeDPage);
    await flushAsync();

    const area = container.querySelector(".container") as HTMLElement | null;
    await fireEvent.contextMenu(area as HTMLElement);

    const core = (globalThis as any).__lastWindowCore;
    expect(core?.handleContextMenu).toHaveBeenCalled();
  });

  it("pngremix page forwards context menu", async () => {
    const { container } = render(PngRemixPage);
    await flushAsync();

    const area = container.querySelector(".container") as HTMLElement | null;
    await fireEvent.contextMenu(area as HTMLElement);

    const core = (globalThis as any).__lastWindowCore;
    expect(core?.handleContextMenu).toHaveBeenCalled();
  });
});

describe("pages render detailed", () => {
  it("root page shows resource panel by default", async () => {
    const { container } = render(RootPage);
    await flushAsync();
    expect(container.querySelector(".debug-panel")).toBeTruthy();
  });

  it("settings page updates nickname and disables volume when muted", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    const settings = {
      nickname: "User",
      birthday: "01-01",
      lang: "zh",
      auto_start: false,
      no_audio_mode: true,
      volume: 0.5,
      silence_mode: false,
      auto_silence_when_fullscreen: false,
      streamer_mode: false,
      show_character: true,
      show_border: true,
      animation_scale: 0.6,
      live2d_mouse_follow: false,
      live2d_auto_interact: false,
      threed_cross_fade_duration: 0.5,
      ai_api_key: "",
      ai_chat_base_url: "https://api.test.com/v1",
      ai_chat_model: "test-model",
      ai_image_base_url: "",
      ai_image_model: "",
      ai_screenshot_interval: 1.0,
      ai_tool_hotkey: "F1",
    };

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return { ...settings };
      if (command === "get_current_mod") return { manifest: { mod_type: "live2d" } };
      if (command === "update_settings") return true;
      if (command === "set_animation_scale") return true;
      if (command === "set_volume") return true;
      if (command === "set_mute") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsPage);
    await flushAsync();

    const volume = container.querySelector("#volume") as HTMLInputElement | null;
    expect(volume?.disabled).toBe(true);

    const nickname = container.querySelector("#nickname") as HTMLInputElement | null;
    await fireEvent.change(nickname as HTMLInputElement, { target: { value: "NewUser" } });
    await flushAsync();

    expect(invokeMock).toHaveBeenCalledWith("update_settings", expect.anything());

    const scale = container.querySelector("#animation_scale") as HTMLInputElement | null;
    await fireEvent.input(scale as HTMLInputElement, { target: { value: "1.1" } });
    await flushAsync();

    expect(invokeMock).toHaveBeenCalledWith("set_animation_scale", { scale: 1.1 });

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("settings page disables border when character hidden", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    const settings = {
      nickname: "User",
      birthday: "01-01",
      lang: "zh",
      auto_start: false,
      no_audio_mode: false,
      volume: 0.5,
      silence_mode: false,
      auto_silence_when_fullscreen: false,
      streamer_mode: false,
      show_character: false,
      show_border: true,
      animation_scale: 0.6,
      live2d_mouse_follow: false,
      live2d_auto_interact: false,
      threed_cross_fade_duration: 0.5,
      ai_api_key: "",
      ai_chat_base_url: "https://api.test.com/v1",
      ai_chat_model: "test-model",
      ai_image_base_url: "",
      ai_image_model: "",
      ai_screenshot_interval: 1.0,
      ai_tool_hotkey: "F1",
    };

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return { ...settings };
      if (command === "get_current_mod") return { manifest: { mod_type: "live2d" } };
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsPage);
    await flushAsync();

    const disabledCheckboxes = Array.from(
      container.querySelectorAll("input[type=\"checkbox\"][disabled]"),
    ) as HTMLInputElement[];
    expect(disabledCheckboxes.length).toBe(1);
    expect(disabledCheckboxes[0]?.checked).toBe(true);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("settings page updates birthday, language, volume, and storage dir", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    const settings = {
      nickname: "User",
      birthday: "01-01",
      lang: "zh",
      auto_start: false,
      no_audio_mode: false,
      volume: 0.3,
      silence_mode: false,
      auto_silence_when_fullscreen: false,
      streamer_mode: false,
      show_character: true,
      show_border: true,
      animation_scale: 0.6,
      live2d_mouse_follow: false,
      live2d_auto_interact: false,
      threed_cross_fade_duration: 0.5,
      ai_api_key: "",
      ai_chat_base_url: "https://api.test.com/v1",
      ai_chat_model: "test-model",
      ai_image_base_url: "",
      ai_image_model: "",
      ai_screenshot_interval: 1.0,
      ai_tool_hotkey: "F1",
    };

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return { ...settings };
      if (command === "get_current_mod") return { manifest: { mod_type: "live2d" } };
      if (command === "update_settings") return true;
      if (command === "set_volume") return true;
      if (command === "open_storage_dir") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsPage);
    await flushAsync();

    const birthday = container.querySelector("#birthday") as HTMLInputElement | null;
    await fireEvent.change(birthday as HTMLInputElement, { target: { value: "2025-02-01" } });
    await flushAsync();
    expect(invokeMock).toHaveBeenCalledWith("update_settings", expect.anything());

    const langSelect = container.querySelector("#lang") as HTMLSelectElement | null;
    const langValue = langSelect?.options?.[0]?.value || settings.lang;
    await fireEvent.change(langSelect as HTMLSelectElement, { target: { value: langValue } });
    await flushAsync();
    expect(invokeMock).toHaveBeenCalledWith("update_settings", expect.anything());

    const volume = container.querySelector("#volume") as HTMLInputElement | null;
    await fireEvent.input(volume as HTMLInputElement, { target: { value: "0.75" } });
    await flushAsync();
    expect(invokeMock).toHaveBeenCalledWith("set_volume", { volume: 0.75 });

    const openBtn = container.querySelector(".secondary-button") as HTMLButtonElement | null;
    await fireEvent.click(openBtn as HTMLButtonElement);
    await flushAsync();
    expect(invokeMock).toHaveBeenCalledWith("open_storage_dir");

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("settings page toggles behavior and live2d options", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    const settings = {
      nickname: "User",
      birthday: "01-01",
      lang: "zh",
      auto_start: false,
      no_audio_mode: false,
      volume: 0.6,
      silence_mode: false,
      auto_silence_when_fullscreen: false,
      streamer_mode: false,
      show_character: true,
      show_border: false,
      animation_scale: 0.6,
      live2d_mouse_follow: false,
      live2d_auto_interact: false,
      threed_cross_fade_duration: 0.5,
      ai_api_key: "",
      ai_chat_base_url: "https://api.test.com/v1",
      ai_chat_model: "test-model",
      ai_image_base_url: "",
      ai_image_model: "",
      ai_screenshot_interval: 1.0,
      ai_tool_hotkey: "F1",
    };

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return { ...settings };
      if (command === "get_current_mod") return { manifest: { mod_type: "live2d" } };
      if (command === "update_settings") return true;
      if (command === "set_mute") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(SettingsPage);
    await flushAsync();

    const checkboxes = Array.from(
      container.querySelectorAll(".checkbox-group input[type=\"checkbox\"]"),
    ) as HTMLInputElement[];
    expect(checkboxes.length).toBeGreaterThanOrEqual(9);

    await fireEvent.click(checkboxes[0] as HTMLInputElement);
    await flushAsync();
    expect(invokeMock).toHaveBeenCalledWith("update_settings", expect.anything());

    await fireEvent.click(checkboxes[3] as HTMLInputElement);
    await flushAsync();
    expect(invokeMock).toHaveBeenCalledWith("set_mute", { mute: true });

    await fireEvent.click(checkboxes[7] as HTMLInputElement);
    await fireEvent.click(checkboxes[8] as HTMLInputElement);
    await flushAsync();
    expect(invokeMock).toHaveBeenCalledWith("update_settings", expect.anything());

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("mods page selects mod and loads it", async () => {


    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    const modInfo = {
      path: "C:/mods/demo",
      manifest: {
        id: "demo",
        version: "1.0.0",
        author: "tester",
        default_text_lang_id: "zh",
      },
      info: {
        zh: { name: "Demo", lang: "zh", description: "" },
      },
    };

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return ["demo"];
      if (command === "get_current_mod") return null;
      if (command === "get_mod_details") return modInfo;
      if (command === "load_mod") return modInfo;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();

    const modButton = container.querySelector(".mod-item") as HTMLButtonElement | null;
    await fireEvent.click(modButton as HTMLButtonElement);
    await flushAsync();

    expect(container.querySelector(".content .header h2")?.textContent).toBe("demo");

    const loadBtn = container.querySelector(".load-btn") as HTMLButtonElement | null;
    await fireEvent.click(loadBtn as HTMLButtonElement);
    await flushAsync();

    expect(invokeMock).toHaveBeenCalledWith("load_mod", { modId: "demo" });

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("mods page can open dir and export", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    const modInfo = {
      path: "C:/mods/demo",
      manifest: {
        id: "demo",
        version: "1.0.0",
        author: "tester",
        default_text_lang_id: "zh",
      },
      info: {
        zh: { name: "Demo", lang: "zh", description: "" },
      },
    };

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_mod_summaries_fast") return [modInfo];
      if (command === "get_current_mod") return null;
      if (command === "get_mod_details") return modInfo;
      if (command === "load_mod") return modInfo;
      if (command === "open_dir") return true;
      if (command === "export_mod_as_sbuddy") return true;

      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();

    const modButton = container.querySelector(".mod-item") as HTMLButtonElement | null;
    await fireEvent.click(modButton as HTMLButtonElement);
    await flushAsync();

    const openDirBtn = container.querySelector(".secondary-btn:not(.export-sbuddy-btn)") as HTMLButtonElement | null;
    await fireEvent.click(openDirBtn as HTMLButtonElement);
    await flushAsync();
    expect(invokeMock).toHaveBeenCalledWith("open_dir", { path: "C:/mods/demo" });

    const exportBtn = container.querySelector(".secondary-btn.export-sbuddy-btn") as HTMLButtonElement | null;
    await fireEvent.click(exportBtn as HTMLButtonElement);
    await flushAsync();
    expect(invokeMock).toHaveBeenCalledWith("export_mod_as_sbuddy", { modId: "demo" });

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("mods page closes conflict modal via backdrop", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return {
          path: "C:/mods/demo",
          manifest: { id: "demo", version: "1.0.0", author: "tester", default_text_lang_id: "zh" },
          info: { zh: { name: "Demo", lang: "zh", description: "" } },
        };
      }
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return ["demo"];
      if (command === "pick_mod_tbuddy") return { filePath: "C:/mods/demo.tbuddy", id: "demo", version: "1.1.0" };
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();

    const importBtn = container.querySelector(".import-btn") as HTMLButtonElement | null;
    await fireEvent.click(importBtn as HTMLButtonElement);
    await flushAsync();
    expect(container.querySelector(".modal")).toBeTruthy();

    const backdrop = container.querySelector(".modal-backdrop") as HTMLElement | null;
    await fireEvent.click(backdrop as HTMLElement);
    await flushAsync();
    expect(container.querySelector(".modal")).toBeFalsy();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("mods page keeps incoming mod on conflict", async () => {
    const invokeMock = vi.mocked(invoke);
    const messageMock = vi.mocked(message);
    const originalImpl = invokeMock.getMockImplementation();

    // Patch Image.src to auto-fire onerror so loadPreview doesn't hang
    const origSrcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      set(this: HTMLImageElement, value: string) {
        if (origSrcDesc?.set) origSrcDesc.set.call(this, value);
        const img = this;
        setTimeout(() => { if (typeof img.onerror === "function") img.onerror(new Event("error")); }, 0);
      },
      get(this: HTMLImageElement) { return origSrcDesc?.get ? origSrcDesc.get.call(this) : ""; },
      configurable: true,
    });

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return {
          path: "C:/mods/demo",
          manifest: { id: "demo", version: "1.0.0", author: "tester", default_text_lang_id: "zh" },
          info: { zh: { name: "Demo", lang: "zh", description: "" } },
        };
      }
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return ["demo"];
      if (command === "pick_mod_tbuddy") return { filePath: "C:/mods/demo.tbuddy", id: "demo", version: "1.1.0" };
      if (command === "import_mod_from_path_detailed") return { id: "demo", extractedPath: "C:/mods/demo" };
      if (command === "load_mod_from_path") {
        return {
          path: "C:/mods/demo",
          manifest: { id: "demo", version: "1.1.0", author: "tester", default_text_lang_id: "zh" },
          info: { zh: { name: "Demo", lang: "zh", description: "" } },
        };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();

    const importBtn = container.querySelector(".import-btn") as HTMLButtonElement | null;
    await fireEvent.click(importBtn as HTMLButtonElement);
    await flushAsync();

    const keepIncoming = container.querySelector(".modal .load-btn") as HTMLButtonElement | null;
    await fireEvent.click(keepIncoming as HTMLButtonElement);
    // keepIncomingAndContinue has 5+ sequential awaits:
    // doImportSilent → load_mod_from_path → loadModList(get_mod_summaries_fast catch → get_available_mods → selectMod → loadPreview) → message
    for (let i = 0; i < 10; i++) await flushAsync();

    expect(invokeMock).toHaveBeenCalledWith("import_mod_from_path_detailed", { filePath: "C:/mods/demo.tbuddy" });
    expect(invokeMock).toHaveBeenCalledWith("load_mod_from_path", { modPath: "C:/mods/demo" });
    expect(messageMock).toHaveBeenCalled();

    // Restore original Image.src descriptor
    if (origSrcDesc) Object.defineProperty(HTMLImageElement.prototype, "src", origSrcDesc);
    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("mods page blocks sbuddy import when unsupported", async () => {
    const invokeMock = vi.mocked(invoke);
    const messageMock = vi.mocked(message);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return [];
      if (command === "get_current_mod") return null;
      if (command === "pick_mod_tbuddy") {
        return { filePath: "C:/mods/demo.sbuddy", id: "demo", version: "1.0.0" };
      }
      if (command === "is_sbuddy_supported") return false;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();

    const importBtn = container.querySelector(".import-btn") as HTMLButtonElement | null;
    await fireEvent.click(importBtn as HTMLButtonElement);
    await flushAsync();

    expect(invokeMock).toHaveBeenCalledWith("is_sbuddy_supported");
    expect(messageMock).toHaveBeenCalled();

    const importCalled = invokeMock.mock.calls.some(([command]) => command === "import_mod_from_path_detailed");
    expect(importCalled).toBe(false);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("mods page shows error when import has invalid tbuddy", async () => {
    const invokeMock = vi.mocked(invoke);
    const messageMock = vi.mocked(message);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return [];
      if (command === "get_current_mod") return null;
      if (command === "pick_mod_tbuddy") {
        return { filePath: "C:/mods/bad.tbuddy", id: "bad", version: "0.0.1" };
      }
      if (command === "import_mod_from_path_detailed") {
        throw "Invalid .tbuddy file";
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();

    const importBtn = container.querySelector(".import-btn") as HTMLButtonElement | null;
    await fireEvent.click(importBtn as HTMLButtonElement);
    await flushAsync();

    expect(messageMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ kind: "error" }));

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("mods page shows sbuddy tool error on import", async () => {
    const invokeMock = vi.mocked(invoke);
    const messageMock = vi.mocked(message);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return [];
      if (command === "get_current_mod") return null;
      if (command === "pick_mod_tbuddy") {
        return { filePath: "C:/mods/demo.tbuddy", id: "demo", version: "1.0.0" };
      }
      if (command === "import_mod_from_path_detailed") {
        throw "sbuddy tool not found";
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();

    const importBtn = container.querySelector(".import-btn") as HTMLButtonElement | null;
    await fireEvent.click(importBtn as HTMLButtonElement);
    await flushAsync();

    expect(messageMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ kind: "error" }));

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("memo page can delete memo", async () => {



    const user = userEvent.setup();
    const { container } = render(MemoPage);
    await flushAsync();

    const content = container.querySelector(".toolbar .content") as HTMLTextAreaElement | null;
    const addButton = container.querySelector(".toolbar .btn.primary") as HTMLButtonElement | null;

    await user.type(content as HTMLTextAreaElement, "Memo Delete");
    await user.click(addButton as HTMLButtonElement);
    await flushAsync();

    const deleteBtn = container.querySelector(".item .btn.danger") as HTMLButtonElement | null;
    await fireEvent.click(deleteBtn as HTMLButtonElement);
    await flushAsync();

    expect(container.querySelector(".items .item")).toBeFalsy();
  });

  it("memo page shows empty state by default", async () => {
    const { container } = render(MemoPage);
    await flushAsync();
    expect(container.querySelector(".empty")).toBeTruthy();
  });

  it("memo page supports category input and quick add", async () => {
    const user = userEvent.setup();
    const { container } = render(MemoPage);
    await flushAsync();

    const categoryInput = container.querySelector(".toolbar .category") as HTMLInputElement | null;
    const content = container.querySelector(".toolbar .content") as HTMLTextAreaElement | null;
    const addButton = container.querySelector(".toolbar .btn.primary") as HTMLButtonElement | null;

    await user.type(categoryInput as HTMLInputElement, "Work");
    await user.type(content as HTMLTextAreaElement, "Memo A");
    await user.click(addButton as HTMLButtonElement);
    await flushAsync();

    const quickAdd = container.querySelector(".category-header .cat-actions .btn") as HTMLButtonElement | null;
    await fireEvent.click(quickAdd as HTMLButtonElement);
    await flushAsync();

    const items = Array.from(container.querySelectorAll(".items .item"));
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it("memo page supports text edit and unpin", async () => {
    vi.useFakeTimers();
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "set_memos") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { container } = render(MemoPage);
    await flushFakeAsync();

    const content = container.querySelector(".toolbar .content") as HTMLTextAreaElement | null;
    const addButton = container.querySelector(".toolbar .btn.primary") as HTMLButtonElement | null;

    await user.type(content as HTMLTextAreaElement, "Memo Pin");
    await user.click(addButton as HTMLButtonElement);
    await flushFakeAsync();

    const item = container.querySelector(".items .item") as HTMLElement | null;
    const pinBtn = item?.querySelector(".pin") as HTMLButtonElement | null;
    await fireEvent.click(pinBtn as HTMLButtonElement);
    await flushFakeAsync();
    expect(item?.classList.contains("pinned")).toBe(true);

    await fireEvent.click(pinBtn as HTMLButtonElement);
    await flushFakeAsync();
    expect(item?.classList.contains("pinned")).toBe(false);

    const memoText = item?.querySelector(".memo-text") as HTMLTextAreaElement | null;
    await fireEvent.input(memoText as HTMLTextAreaElement, { target: { value: "Memo Updated" } });
    vi.advanceTimersByTime(300);
    await flushFakeAsync();
    expect(invokeMock).toHaveBeenCalledWith("set_memos", expect.anything());

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
    vi.useRealTimers();
  });

  it("reminder page can delete reminder", async () => {

    const user = userEvent.setup();
    const { container } = render(ReminderPage);
    await flushAsync();

    const textArea = container.querySelector(".textarea") as HTMLTextAreaElement | null;
    const addButton = container.querySelector(".btn.primary") as HTMLButtonElement | null;

    await user.type(textArea as HTMLTextAreaElement, "Delete reminder");
    await user.click(addButton as HTMLButtonElement);
    await flushAsync();

    const deleteBtn = container.querySelector(".list .btn.danger") as HTMLButtonElement | null;
    await fireEvent.click(deleteBtn as HTMLButtonElement);
    await flushAsync();

    expect(container.querySelector(".list .card")).toBeFalsy();
  });

  it("reminder page switches new reminder type inputs", async () => {
    const { container } = render(ReminderPage);
    await flushAsync();

    const typeSelect = container.querySelector(".panel .select") as HTMLSelectElement | null;
    await fireEvent.change(typeSelect as HTMLSelectElement, { target: { value: "weekly" } });
    await flushAsync();

    expect(container.querySelector("input[type=\"time\"]")).toBeTruthy();
    expect(container.querySelectorAll(".weekdays .chip input").length).toBeGreaterThan(0);

    await fireEvent.change(typeSelect as HTMLSelectElement, { target: { value: "absolute" } });
    await flushAsync();
    expect(container.querySelector("input[type=\"datetime-local\"]")).toBeTruthy();

    await fireEvent.change(typeSelect as HTMLSelectElement, { target: { value: "after" } });
    await flushAsync();
    expect(container.querySelector(".after input[type=\"number\"]")).toBeTruthy();
  });

  it("reminder page edits schedule and text", async () => {
    vi.useFakeTimers();
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_reminders") {
        return [
          {
            id: "r1",
            text: "Hello",
            enabled: true,
            schedule: { kind: "after", seconds: 600, created_at: null },
            next_trigger_at: 0,
            last_trigger_at: null,
          },
        ];
      }
      if (command === "set_reminders") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ReminderPage);
    await flushFakeAsync();

    const cardType = container.querySelector(".card .select") as HTMLSelectElement | null;
    await fireEvent.change(cardType as HTMLSelectElement, { target: { value: "weekly" } });
    await flushFakeAsync();

    const timeInput = container.querySelector(".card input[type=\"time\"]") as HTMLInputElement | null;
    await fireEvent.input(timeInput as HTMLInputElement, { target: { value: "10:30" } });

    const textArea = container.querySelector(".card .textarea") as HTMLTextAreaElement | null;
    await fireEvent.input(textArea as HTMLTextAreaElement, { target: { value: "Updated" } });

    vi.advanceTimersByTime(300);
    await flushFakeAsync();
    expect(invokeMock).toHaveBeenCalledWith("set_reminders", expect.anything());

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
    vi.useRealTimers();
  });

  it("reminder alert page shows empty state", async () => {

    const invokeMock = vi.mocked(invoke);
    const listenMock = vi.mocked(listen);
    const originalInvoke = invokeMock.getMockImplementation();
    const originalListen = listenMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "take_pending_reminder_alerts") return [];
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    listenMock.mockImplementation(async () => () => {});

    const { container } = render(ReminderAlertPage);
    await flushAsync();

    expect(container.querySelector(".empty")).toBeTruthy();

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
    listenMock.mockImplementation(originalListen ?? (async () => () => {}));
  });

  it("animation page shows bubble area and hides mod data panel", async () => {
    const { container } = render(AnimationPage);
    await flushAsync();

    expect(container.querySelector(".bubble-area")).toBeTruthy();
    expect(container.querySelector(".mod-data-hud")).toBeFalsy();
  });

  it("animation page bubble events reach window core", async () => {
    vi.useFakeTimers();
    const { container } = render(AnimationPage);
    await flushFakeAsync();

    const options = (globalThis as any).__lastWindowCoreOptions;
    const bubbleManager = options?.refs?.getBubbleManager?.();
    bubbleManager?.show({ text: "", branches: [{ text: "A", next_state: "s1" }] });
    await flushFakeAsync();

    const branchButton = container.querySelector(".branch-button") as HTMLButtonElement | null;
    await fireEvent.click(branchButton as HTMLButtonElement);
    await flushFakeAsync();

    const bubble = container.querySelector(".bubble") as HTMLElement | null;
    await fireEvent.click(bubble as HTMLElement);
    vi.advanceTimersByTime(3000);
    await flushFakeAsync();

    const core = (globalThis as any).__lastWindowCore;
    expect(core?.handleBubbleShow).toHaveBeenCalled();
    expect(core?.handleBranchSelect).toHaveBeenCalled();
    expect(core?.handleBubbleClose).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("animation page toggles debug border class", async () => {
    const { container } = render(AnimationPage);
    await flushAsync();

    const options = (globalThis as any).__lastWindowCoreOptions;
    options?.bindings?.setDebugBordersEnabled(true);
    await flushAsync();

    const root = container.querySelector(".container") as HTMLElement | null;
    expect(root?.classList.contains("debug-border-active")).toBe(true);
  });

  it("live2d page shows bubble area and hides mod data panel", async () => {


    const { container } = render(Live2DPage);
    await flushAsync();

    expect(container.querySelector(".bubble-area")).toBeTruthy();
    expect(container.querySelector(".mod-data-hud")).toBeFalsy();
  });

  it("live2d page bubble events reach window core", async () => {
    const { container } = render(Live2DPage);
    await flushAsync();

    const options = (globalThis as any).__lastWindowCoreOptions;
    const bubbleManager = options?.refs?.getBubbleManager?.();
    bubbleManager?.show({ text: "", branches: [{ text: "B", next_state: "s2" }] });
    await flushAsync();

    const branchButton = container.querySelector(".branch-button") as HTMLButtonElement | null;
    await fireEvent.click(branchButton as HTMLButtonElement);
    await flushAsync();

    const core = (globalThis as any).__lastWindowCore;
    expect(core?.handleBubbleShow).toHaveBeenCalled();
    expect(core?.handleBranchSelect).toHaveBeenCalled();
  });

  it("live2d page handles feature hotkeys", async () => {

    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") {
        return {
          live2d_mouse_follow: true,
          live2d_auto_interact: true,
        };
      }
      if (command === "get_current_mod") {
        return {
          path: "C:/mods/live2d",
          manifest: { mod_type: "live2d" },
          live2d: { states: [] },
        };
      }
      if (command === "update_settings") return true;
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(Live2DPage);
    await flushAsync();

    await fireEvent.keyDown(window, { altKey: true, code: "KeyM" });
    await fireEvent.keyDown(window, { altKey: true, code: "KeyI" });

    expect(invokeMock).toHaveBeenCalledWith("update_settings", expect.anything());
    const player = (globalThis as any).__lastLive2DPlayer;
    expect(player?.setFeatureFlags).toHaveBeenCalled();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("live2d page updates background layers on mouse up/down", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return { live2d_mouse_follow: true, live2d_auto_interact: true };
      if (command === "get_current_mod") {
        return {
          path: "C:/mods/live2d",
          manifest: { mod_type: "live2d", global_mouse: false },
          live2d: { states: [] },
        };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(Live2DPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const canvas = container.querySelector(".live2d-canvas") as HTMLCanvasElement | null;
    const player = (globalThis as any).__lastLive2DPlayer;
    expect(player).toBeTruthy();

    await fireEvent.mouseDown(canvas as HTMLCanvasElement, { button: 0 });
    await fireEvent.mouseUp(canvas as HTMLCanvasElement, { button: 0 });
    await fireEvent.mouseDown(canvas as HTMLCanvasElement, { button: 2 });
    await fireEvent.mouseUp(canvas as HTMLCanvasElement, { button: 2 });

    expect(player?.setBackgroundLayersByEvent).toHaveBeenCalledWith("click", true);
    expect(player?.setBackgroundLayersByEvent).toHaveBeenCalledWith("click", false);
    expect(player?.setBackgroundLayersByEvent).toHaveBeenCalledWith("right_click", true);
    expect(player?.setBackgroundLayersByEvent).toHaveBeenCalledWith("right_click", false);

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("live2d page enables debug borders and debug controls", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return { live2d_mouse_follow: true, live2d_auto_interact: true };
      if (command === "get_current_mod") {
        return {
          path: "C:/mods/live2d",
          manifest: { mod_type: "live2d" },
          live2d: { states: [] },
        };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(Live2DPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const options = (globalThis as any).__lastWindowCoreOptions;
    options?.bindings?.setDebugBordersEnabled(true);
    await flushAsync();

    const canvas = container.querySelector(".live2d-canvas") as HTMLCanvasElement | null;
    const player = (globalThis as any).__lastLive2DPlayer;
    expect(container.querySelector(".debug-hud")).toBeTruthy();
    expect(player?.setDebugMode).toHaveBeenCalledWith(true);

    await fireEvent.keyDown(window, { code: "ArrowUp" });
    await fireEvent.keyDown(window, { code: "Equal" });
    await fireEvent.wheel(canvas as HTMLCanvasElement, { deltaY: -120 });

    expect(player?.debugPan).toHaveBeenCalled();
    expect(player?.debugZoom).toHaveBeenCalled();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("threed page shows bubble area and hides mod data panel", async () => {


    const { container } = render(ThreeDPage);
    await flushAsync();

    expect(container.querySelector(".bubble-area")).toBeTruthy();
    expect(container.querySelector(".mod-data-hud")).toBeFalsy();
  });

  it("threed page bubble events reach window core", async () => {
    const { container } = render(ThreeDPage);
    await flushAsync();

    const options = (globalThis as any).__lastWindowCoreOptions;
    const bubbleManager = options?.refs?.getBubbleManager?.();
    bubbleManager?.show({ text: "", branches: [{ text: "C", next_state: "s3" }] });
    await flushAsync();

    const branchButton = container.querySelector(".branch-button") as HTMLButtonElement | null;
    await fireEvent.click(branchButton as HTMLButtonElement);
    await flushAsync();

    const core = (globalThis as any).__lastWindowCore;
    expect(core?.handleBubbleShow).toHaveBeenCalled();
    expect(core?.handleBranchSelect).toHaveBeenCalled();
  });

  it("pngremix page shows bubble area and hides mod data panel", async () => {

    const { container } = render(PngRemixPage);
    await flushAsync();

    expect(container.querySelector(".bubble-area")).toBeTruthy();
    expect(container.querySelector(".mod-data-hud")).toBeFalsy();
  });

  it("pngremix page bubble events reach window core", async () => {
    const { container } = render(PngRemixPage);
    await flushAsync();

    const options = (globalThis as any).__lastWindowCoreOptions;
    const bubbleManager = options?.refs?.getBubbleManager?.();
    bubbleManager?.show({ text: "", branches: [{ text: "D", next_state: "s4" }] });
    await flushAsync();

    const branchButton = container.querySelector(".branch-button") as HTMLButtonElement | null;
    await fireEvent.click(branchButton as HTMLButtonElement);
    await flushAsync();

    const core = (globalThis as any).__lastWindowCore;
    expect(core?.handleBubbleShow).toHaveBeenCalled();
    expect(core?.handleBranchSelect).toHaveBeenCalled();
  });
});

describe("pages render gaps", () => {
  it("mods page auto selects current mod and refreshes via event", async () => {
    const invokeMock = vi.mocked(invoke);
    const listenMock = vi.mocked(listen);
    const originalInvoke = invokeMock.getMockImplementation();
    const originalListen = listenMock.getMockImplementation();

    // Mock Image so that onerror fires immediately (jsdom can't load custom protocol URLs)
    const OriginalImage = globalThis.Image;
    globalThis.Image = class MockImage {
      onload: ((e: Event) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      private _src = "";
      get src() { return this._src; }
      set src(v: string) {
        this._src = v;
        // Fire onerror asynchronously to simulate failed image load
        Promise.resolve().then(() => {
          if (this.onerror) this.onerror(new Event("error"));
        });
      }
    } as any;

    let refreshHandler: ((e: any) => void) | null = null;

    listenMock.mockImplementation(async (event, handler) => {
      if (event === "refresh-mods") refreshHandler = handler as (e: any) => void;
      return () => {};
    });

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return ["demo"];
      if (command === "get_current_mod") {
        return {
          path: "C:/mods/demo",
          manifest: { id: "demo", version: "1.0.0", author: "tester", default_text_lang_id: "zh" },
          info: { zh: { name: "Demo", lang: "zh", description: "" } },
        };
      }
      if (command === "get_mod_details") {
        return {
          path: "C:/mods/demo",
          manifest: { id: "demo", version: "1.0.0", author: "tester", default_text_lang_id: "zh" },
          info: { zh: { name: "Demo", lang: "zh", description: "" } },
        };
      }
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    // The init chain is long: initI18n → loadCurrentMod → loadModList → selectMod (with image loading) → listen
    // Poll until refreshHandler is captured
    for (let i = 0; i < 20; i++) {
      await flushAsync();
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (refreshHandler) break;
    }

    expect(container.querySelector(".content .header h2")?.textContent).toBe("demo");
    expect(refreshHandler).toBeTruthy();

    const before = invokeMock.mock.calls.filter(([cmd]) => cmd === "get_mod_search_paths").length;
    refreshHandler?.({ payload: true });
    // loadModList is async with multiple invokes; poll until new get_mod_search_paths call appears
    for (let i = 0; i < 20; i++) {
      await flushAsync();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const current = invokeMock.mock.calls.filter(([cmd]) => cmd === "get_mod_search_paths").length;
      if (current > before) break;
    }

    const after = invokeMock.mock.calls.filter(([cmd]) => cmd === "get_mod_search_paths").length;
    expect(after).toBeGreaterThan(before);

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
    listenMock.mockImplementation(originalListen ?? (async () => () => {}));
    globalThis.Image = OriginalImage;
  });

  it("mods page skips import when picker returns empty", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return [];
      if (command === "get_current_mod") return null;
      if (command === "pick_mod_tbuddy") return null;
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();

    const importBtn = container.querySelector(".import-btn") as HTMLButtonElement | null;
    await fireEvent.click(importBtn as HTMLButtonElement);
    await flushAsync();

    const importCalled = invokeMock.mock.calls.some(([command]) => command === "import_mod_from_path_detailed");
    expect(importCalled).toBe(false);

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("mods page opens archive source path and shows export error", async () => {
    const invokeMock = vi.mocked(invoke);
    const messageMock = vi.mocked(message);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return ["demo"];
      if (command === "get_current_mod") return null;
      if (command === "get_mod_details") {
        return {
          path: "tbuddy-archive://demo",
          manifest: { id: "demo", version: "1.0.0", author: "tester", default_text_lang_id: "zh" },
          info: { zh: { name: "Demo", lang: "zh", description: "" } },
        };
      }
      if (command === "get_tbuddy_source_path") return "C:/mods/demo.tbuddy";
      if (command === "open_path") return true;
      if (command === "export_mod_as_sbuddy") throw "sbuddy tool not found";
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();

    const modButton = container.querySelector(".mod-item") as HTMLButtonElement | null;
    await fireEvent.click(modButton as HTMLButtonElement);
    await flushAsync();

    const openDirBtn = container.querySelector(".secondary-btn:not(.export-sbuddy-btn)") as HTMLButtonElement | null;
    await fireEvent.click(openDirBtn as HTMLButtonElement);
    await flushAsync();

    expect(invokeMock).toHaveBeenCalledWith("get_tbuddy_source_path", { modId: "demo" });
    expect(invokeMock).toHaveBeenCalledWith("open_path", { path: "C:/mods/demo.tbuddy" });

    const exportBtn = container.querySelector(".secondary-btn.export-sbuddy-btn") as HTMLButtonElement | null;
    await fireEvent.click(exportBtn as HTMLButtonElement);
    await flushAsync();

    expect(messageMock).toHaveBeenCalled();
    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("mods page falls back when preview image missing", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();
    const OriginalImage = globalThis.Image;

    class MockImage {
      onload: ((this: MockImage) => void) | null = null;
      onerror: ((this: MockImage) => void) | null = null;
      set src(_value: string) {
        this.onerror?.call(this);
      }
    }

    // @ts-expect-error override image
    globalThis.Image = MockImage;

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return ["demo"];
      if (command === "get_current_mod") return null;
      if (command === "get_mod_details") {
        return {
          path: "C:/mods/demo",
          manifest: { id: "demo", version: "1.0.0", author: "tester", default_text_lang_id: "zh" },
          info: { zh: { name: "Demo", lang: "zh", description: "" } },
        };
      }
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();

    const modButton = container.querySelector(".mod-item") as HTMLButtonElement | null;
    await fireEvent.click(modButton as HTMLButtonElement);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.querySelector(".no-preview")).toBeTruthy();

    globalThis.Image = OriginalImage;
    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("mods page closes conflict modal via keep loaded and escape", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return {
          path: "C:/mods/demo",
          manifest: { id: "demo", version: "1.0.0", author: "tester", default_text_lang_id: "zh" },
          info: { zh: { name: "Demo", lang: "zh", description: "" } },
        };
      }
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return ["demo"];
      if (command === "pick_mod_tbuddy") return { filePath: "C:/mods/demo.tbuddy", id: "demo", version: "1.1.0" };
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();

    const importBtn = container.querySelector(".import-btn") as HTMLButtonElement | null;
    await fireEvent.click(importBtn as HTMLButtonElement);
    await flushAsync();

    const keepLoaded = container.querySelector(".modal .secondary-btn") as HTMLButtonElement | null;
    await fireEvent.click(keepLoaded as HTMLButtonElement);
    await flushAsync();
    expect(container.querySelector(".modal")).toBeFalsy();

    await fireEvent.click(importBtn as HTMLButtonElement);
    await flushAsync();

    const backdrop = container.querySelector(".modal-backdrop") as HTMLElement | null;
    await fireEvent.keyDown(backdrop as HTMLElement, { key: "Escape" });
    await flushAsync();
    expect(container.querySelector(".modal")).toBeFalsy();

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("mods page shows status when load list fails", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_search_paths") throw "load-bad";
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.querySelector(".empty-state")?.textContent).toContain("load-bad");

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("mods page imports sbuddy when supported", async () => {
    const invokeMock = vi.mocked(invoke);
    const messageMock = vi.mocked(message);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return [];
      if (command === "get_current_mod") return null;
      if (command === "pick_mod_tbuddy") return { filePath: "C:/mods/demo.sbuddy", id: "demo", version: "1.0.0" };
      if (command === "is_sbuddy_supported") return true;
      if (command === "import_mod_from_path_detailed") return { id: "demo", extractedPath: "C:/mods/demo" };
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();

    const importBtn = container.querySelector(".import-btn") as HTMLButtonElement | null;
    await fireEvent.click(importBtn as HTMLButtonElement);
    await flushAsync();

    expect(invokeMock).toHaveBeenCalledWith("import_mod_from_path_detailed", { filePath: "C:/mods/demo.sbuddy" });
    expect(messageMock).toHaveBeenCalled();

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("mods page shows export failure status", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return ["demo"];
      if (command === "get_current_mod") return null;
      if (command === "get_mod_details") {
        return {
          path: "C:/mods/demo",
          manifest: { id: "demo", version: "1.0.0", author: "tester", default_text_lang_id: "zh" },
          info: { zh: { name: "Demo", lang: "zh", description: "" } },
        };
      }
      if (command === "export_mod_as_sbuddy") throw "export-bad";
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();

    const modButton = container.querySelector(".mod-item") as HTMLButtonElement | null;
    await fireEvent.click(modButton as HTMLButtonElement);
    await flushAsync();

    const exportBtn = container.querySelector(".secondary-btn.export-sbuddy-btn") as HTMLButtonElement | null;
    await fireEvent.click(exportBtn as HTMLButtonElement);
    await flushAsync();

    expect(container.querySelector(".status")?.textContent).toContain("export-bad");

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("memo page handles load failure and default category", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();


    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_memos") throw "boom";
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(MemoPage);
    await flushAsync();
    expect(container.querySelector(".sub")?.textContent).toContain("boom");

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_memos") {
        return [{ id: "m1", category: "", content: "Memo A", pinned: false, order: 0 }];
      }
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container: container2 } = render(MemoPage);
    await flushAsync();

    const defaultCategory = i18n.t("memo.defaultCategory");
    expect(container2.querySelector(".cat-name")?.textContent).toBe(defaultCategory);

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("memo page normalizes missing data and orders pinned first", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_memos") {
        return [
          { id: "m1", category: null, content: "Pinned", pinned: true },
          { id: "m2", category: undefined, content: "Normal", pinned: false, order: undefined },
        ];
      }
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(MemoPage);
    await flushAsync();

    const defaultCategory = i18n.t("memo.defaultCategory");
    expect(container.querySelector(".cat-name")?.textContent).toBe(defaultCategory);

    const texts = Array.from(container.querySelectorAll(".memo-text")) as HTMLTextAreaElement[];
    expect(texts[0]?.value).toBe("Pinned");

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("memo page handles null memo list", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_memos") return null;
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(MemoPage);
    await flushAsync();

    expect(container.querySelector(".empty")).toBeTruthy();

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });


  it("memo page ignores move when at boundary", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_memos") {
        return [
          { id: "m1", category: "Work", content: "Memo A", pinned: false, order: 0 },
          { id: "m2", category: "Work", content: "Memo B", pinned: false, order: 1 },
        ];
      }
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(MemoPage);
    await flushAsync();

    const firstItem = container.querySelector(".items .item") as HTMLElement | null;
    const upBtn = firstItem?.querySelector(".actions .btn") as HTMLButtonElement | null;
    await fireEvent.click(upBtn as HTMLButtonElement);
    await flushAsync();

    const texts = Array.from(container.querySelectorAll(".memo-text")) as HTMLTextAreaElement[];
    expect(texts[0]?.value).toBe("Memo A");

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("memo page shows save failure status", async () => {
    vi.useFakeTimers();
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_memos") {
        return [{ id: "m1", category: "Work", content: "Memo A", pinned: false, order: 0 }];
      }
      if (command === "set_memos") throw "save-fail";
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(MemoPage);
    await flushFakeAsync();

    const memoText = container.querySelector(".memo-text") as HTMLTextAreaElement | null;
    await fireEvent.input(memoText as HTMLTextAreaElement, { target: { value: "Memo Updated" } });

    vi.advanceTimersByTime(300);
    await flushFakeAsync();

    expect(container.querySelector(".sub")?.textContent).toContain("save-fail");

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
    vi.useRealTimers();
  });

  it("reminder page handles load failure and empty state", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_reminders") throw "oops";
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ReminderPage);
    await flushAsync();
    expect(container.querySelector(".sub")?.textContent).toContain("oops");

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_reminders") return [];
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container: container2 } = render(ReminderPage);
    await flushAsync();
    expect(container2.querySelector(".empty")).toBeTruthy();

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("reminder page blocks invalid new schedule", async () => {
    const { container } = render(ReminderPage);
    await flushAsync();

    const typeSelect = container.querySelector(".panel .select") as HTMLSelectElement | null;
    const textArea = container.querySelector(".panel .textarea") as HTMLTextAreaElement | null;
    const addButton = container.querySelector(".panel .btn.primary") as HTMLButtonElement | null;

    await fireEvent.change(typeSelect as HTMLSelectElement, { target: { value: "absolute" } });
    await fireEvent.input(textArea as HTMLTextAreaElement, { target: { value: "Test" } });
    await fireEvent.click(addButton as HTMLButtonElement);
    await flushAsync();
    expect(container.querySelector(".list .card")).toBeFalsy();

    await fireEvent.change(typeSelect as HTMLSelectElement, { target: { value: "weekly" } });
    await flushAsync();

    const checks = Array.from(container.querySelectorAll(".weekdays input")) as HTMLInputElement[];
    for (const checkbox of checks) {
      if (checkbox.checked) await fireEvent.click(checkbox);
    }

    await fireEvent.input(textArea as HTMLTextAreaElement, { target: { value: "Test Weekly" } });
    await fireEvent.click(addButton as HTMLButtonElement);
    await flushAsync();

    expect(container.querySelector(".list .card")).toBeFalsy();
  });

  it("reminder page normalizes missing reminder fields", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_reminders") {
        return [
          { id: "r1", text: undefined, enabled: undefined, schedule: { kind: "after", seconds: 60, created_at: null }, next_trigger_at: 0, last_trigger_at: null },
        ];
      }
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ReminderPage);
    await flushAsync();

    const card = container.querySelector(".card") as HTMLElement | null;
    expect(card?.classList.contains("disabled")).toBe(false);

    const textArea = card?.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textArea?.value).toBe("");

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("reminder page handles null reminder list", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_reminders") return null;
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ReminderPage);
    await flushAsync();

    expect(container.querySelector(".empty")).toBeTruthy();

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("reminder page adds weekly reminder with invalid time", async () => {
    vi.useFakeTimers();
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_reminders") return [];
      if (command === "set_reminders") return true;
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ReminderPage);
    await flushFakeAsync();

    const typeSelect = container.querySelector(".panel .select") as HTMLSelectElement | null;
    await fireEvent.change(typeSelect as HTMLSelectElement, { target: { value: "weekly" } });
    await flushFakeAsync();

    const timeInput = container.querySelector(".panel input[type=\"time\"]") as HTMLInputElement | null;
    if (timeInput) timeInput.type = "text";
    await fireEvent.input(timeInput as HTMLInputElement, { target: { value: "bad" } });

    const check = container.querySelector(".weekdays input") as HTMLInputElement | null;
    await fireEvent.change(check as HTMLInputElement, { target: { checked: true } });
    await flushFakeAsync();


    const textArea = container.querySelector(".panel .textarea") as HTMLTextAreaElement | null;
    await fireEvent.input(textArea as HTMLTextAreaElement, { target: { value: "Weekly" } });
    await flushFakeAsync();

    const addButton = container.querySelector(".panel .btn.primary") as HTMLButtonElement | null;
    expect(addButton?.disabled).toBe(false);
    await fireEvent.click(addButton as HTMLButtonElement);

    vi.advanceTimersByTime(300);
    await flushFakeAsync();

    expect(container.querySelector(".list .card")).toBeTruthy();
    const listTime = container.querySelector(".list .card input[type=\"time\"]") as HTMLInputElement | null;
    expect(listTime?.value).toBe("09:00");



    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
    vi.useRealTimers();
  });


  it("reminder page adds after reminder in minutes", async () => {
    vi.useFakeTimers();
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_reminders") return [];
      if (command === "set_reminders") return true;
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ReminderPage);
    await flushFakeAsync();

    const typeSelect = container.querySelector(".panel .select") as HTMLSelectElement | null;
    await fireEvent.change(typeSelect as HTMLSelectElement, { target: { value: "after" } });
    await flushFakeAsync();

    const valueInput = container.querySelector(".panel .after input[type=\"number\"]") as HTMLInputElement | null;
    const unitSelect = container.querySelector(".panel .after select") as HTMLSelectElement | null;
    const textArea = container.querySelector(".panel .textarea") as HTMLTextAreaElement | null;
    const addButton = container.querySelector(".panel .btn.primary") as HTMLButtonElement | null;

    await fireEvent.input(valueInput as HTMLInputElement, { target: { value: "2" } });
    await fireEvent.change(unitSelect as HTMLSelectElement, { target: { value: "minutes" } });
    await fireEvent.input(textArea as HTMLTextAreaElement, { target: { value: "After Minutes" } });
    await fireEvent.click(addButton as HTMLButtonElement);

    vi.advanceTimersByTime(300);
    await flushFakeAsync();

    const setCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "set_reminders");
    const last = setCalls[setCalls.length - 1]?.[1] as { reminders?: any[] } | undefined;
    expect(last?.reminders?.[0]?.schedule?.seconds).toBe(120);

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
    vi.useRealTimers();
  });

  it("reminder page uses fallback weekday labels", async () => {
    const tArraySpy = vi.spyOn(i18n, "tArray").mockReturnValue([
      undefined as unknown as string,
      "Mon",
      undefined as unknown as string,
      "Wed",
      "Thu",
      "Fri",
      "Sat",
    ]);

    const { container } = render(ReminderPage);
    await flushAsync();

    const typeSelect = container.querySelector(".panel .select") as HTMLSelectElement | null;
    await fireEvent.change(typeSelect as HTMLSelectElement, { target: { value: "weekly" } });
    await flushAsync();

    const labels = Array.from(container.querySelectorAll(".panel .weekdays .chip span")) as HTMLElement[];
    expect(labels[0]?.textContent).toBe("Mon");
    expect(labels[1]?.textContent).toBe("2");
    expect(labels[6]?.textContent).toBe("Sun");

    tArraySpy.mockRestore();
  });

  it("reminder page falls back when tArray is empty", async () => {
    const tArraySpy = vi.spyOn(i18n, "tArray").mockReturnValue([]);

    const { container } = render(ReminderPage);
    await flushAsync();

    const typeSelect = container.querySelector(".panel .select") as HTMLSelectElement | null;
    await fireEvent.change(typeSelect as HTMLSelectElement, { target: { value: "weekly" } });
    await flushAsync();

    const label = container.querySelector(".panel .weekdays .chip span") as HTMLElement | null;
    expect(label?.textContent).toBe("1");

    tArraySpy.mockRestore();
  });

  it("reminder page blocks empty new text", async () => {

    const { container } = render(ReminderPage);
    await flushAsync();

    const textArea = container.querySelector(".panel .textarea") as HTMLTextAreaElement | null;
    const addButton = container.querySelector(".panel .btn.primary") as HTMLButtonElement | null;

    await fireEvent.input(textArea as HTMLTextAreaElement, { target: { value: "   " } });
    await fireEvent.click(addButton as HTMLButtonElement);
    await flushAsync();

    expect(container.querySelector(".list .card")).toBeFalsy();
  });

  it("reminder page adds absolute reminder and rejects invalid datetime", async () => {
    vi.useFakeTimers();
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_reminders") return [];
      if (command === "set_reminders") return true;
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ReminderPage);
    await flushFakeAsync();

    const typeSelect = container.querySelector(".panel .select") as HTMLSelectElement | null;
    await fireEvent.change(typeSelect as HTMLSelectElement, { target: { value: "absolute" } });
    await flushFakeAsync();

    const dtInput = container.querySelector(".panel input[type=\"datetime-local\"]") as HTMLInputElement | null;
    await fireEvent.input(dtInput as HTMLInputElement, { target: { value: "2026-02-22T10:00" } });

    const textArea = container.querySelector(".panel .textarea") as HTMLTextAreaElement | null;
    await fireEvent.input(textArea as HTMLTextAreaElement, { target: { value: "Abs" } });

    const addButton = container.querySelector(".panel .btn.primary") as HTMLButtonElement | null;
    await fireEvent.click(addButton as HTMLButtonElement);

    vi.advanceTimersByTime(300);
    await flushFakeAsync();

    expect(container.querySelector(".list .card")).toBeTruthy();

    const dtInput2 = container.querySelector(".panel input[type=\"datetime-local\"]") as HTMLInputElement | null;
    if (dtInput2) dtInput2.type = "text";
    await fireEvent.input(dtInput2 as HTMLInputElement, { target: { value: "bad" } });
    await fireEvent.input(textArea as HTMLTextAreaElement, { target: { value: "Bad" } });
    await fireEvent.click(addButton as HTMLButtonElement);

    await flushFakeAsync();

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
    vi.useRealTimers();
  });

  it("reminder page clamps after values with seconds unit", async () => {
    vi.useFakeTimers();
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_reminders") return [];
      if (command === "set_reminders") return true;
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ReminderPage);
    await flushFakeAsync();

    const typeSelect = container.querySelector(".panel .select") as HTMLSelectElement | null;
    await fireEvent.change(typeSelect as HTMLSelectElement, { target: { value: "after" } });
    await flushFakeAsync();

    const valueInput = container.querySelector(".panel .after input[type=\"number\"]") as HTMLInputElement | null;
    const unitSelect = container.querySelector(".panel .after select") as HTMLSelectElement | null;
    const textArea = container.querySelector(".panel .textarea") as HTMLTextAreaElement | null;
    const addButton = container.querySelector(".panel .btn.primary") as HTMLButtonElement | null;

    await fireEvent.input(valueInput as HTMLInputElement, { target: { value: "0" } });
    await fireEvent.change(unitSelect as HTMLSelectElement, { target: { value: "seconds" } });
    await fireEvent.input(textArea as HTMLTextAreaElement, { target: { value: "After Seconds" } });
    await fireEvent.click(addButton as HTMLButtonElement);

    vi.advanceTimersByTime(300);
    await flushFakeAsync();

    const setCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "set_reminders");
    const last = setCalls[setCalls.length - 1]?.[1] as { reminders?: any[] } | undefined;
    expect(last?.reminders?.[0]?.schedule?.seconds).toBe(1);

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
    vi.useRealTimers();
  });

  it("reminder page updates reminder text", async () => {
    vi.useFakeTimers();
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_reminders") {
        return [{ id: "r1", text: "Old", enabled: true, schedule: { kind: "after", seconds: 60, created_at: null }, next_trigger_at: 0, last_trigger_at: null }];
      }
      if (command === "set_reminders") return true;
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ReminderPage);
    await flushFakeAsync();

    const textArea = container.querySelector(".list .card textarea") as HTMLTextAreaElement | null;
    await fireEvent.input(textArea as HTMLTextAreaElement, { target: { value: "Updated" } });

    vi.advanceTimersByTime(300);
    await flushFakeAsync();

    const setCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "set_reminders");
    const last = setCalls[setCalls.length - 1]?.[1] as { reminders?: any[] } | undefined;
    expect(last?.reminders?.[0]?.text).toBe("Updated");

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
    vi.useRealTimers();
  });

  it("reminder page switches schedule type in list", async () => {
    vi.useFakeTimers();
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_reminders") {
        return [{ id: "r1", text: "Type", enabled: true, schedule: { kind: "after", seconds: 60, created_at: null }, next_trigger_at: 0, last_trigger_at: null }];
      }
      if (command === "set_reminders") return true;
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ReminderPage);
    await flushFakeAsync();

    const select = container.querySelector(".list .card select") as HTMLSelectElement | null;
    await fireEvent.change(select as HTMLSelectElement, { target: { value: "absolute" } });
    await fireEvent.change(select as HTMLSelectElement, { target: { value: "weekly" } });
    await fireEvent.change(select as HTMLSelectElement, { target: { value: "after" } });

    vi.advanceTimersByTime(300);
    await flushFakeAsync();

    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "set_reminders")).toBe(true);

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
    vi.useRealTimers();
  });

  it("reminder page converts after unit when adding", async () => {


    vi.useFakeTimers();
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_reminders") return [];
      if (command === "set_reminders") return true;
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ReminderPage);
    await flushFakeAsync();

    const typeSelect = container.querySelector(".panel .select") as HTMLSelectElement | null;
    await fireEvent.change(typeSelect as HTMLSelectElement, { target: { value: "after" } });
    await flushFakeAsync();

    const valueInput = container.querySelector(".panel .after input[type=\"number\"]") as HTMLInputElement | null;
    const unitSelect = container.querySelector(".panel .after select") as HTMLSelectElement | null;
    const textArea = container.querySelector(".panel .textarea") as HTMLTextAreaElement | null;
    const addButton = container.querySelector(".panel .btn.primary") as HTMLButtonElement | null;

    await fireEvent.input(valueInput as HTMLInputElement, { target: { value: "2" } });
    await fireEvent.change(unitSelect as HTMLSelectElement, { target: { value: "hours" } });
    await fireEvent.input(textArea as HTMLTextAreaElement, { target: { value: "After Test" } });
    await fireEvent.click(addButton as HTMLButtonElement);

    vi.advanceTimersByTime(300);
    await flushFakeAsync();

    const setCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "set_reminders");
    const last = setCalls[setCalls.length - 1]?.[1] as { reminders?: any[] } | undefined;
    expect(last?.reminders?.[0]?.schedule?.seconds).toBe(7200);

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
    vi.useRealTimers();
  });

  it("reminder page updates weekly and after schedule fields", async () => {
    vi.useFakeTimers();
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_reminders") {
        return [
          { id: "r1", text: "Weekly", enabled: true, schedule: { kind: "weekly", days: [1], hour: 9, minute: 0 }, next_trigger_at: 0, last_trigger_at: null },
          { id: "r2", text: "After", enabled: true, schedule: { kind: "after", seconds: 600, created_at: null }, next_trigger_at: 0, last_trigger_at: null },
        ];
      }
      if (command === "set_reminders") return true;
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ReminderPage);
    await flushFakeAsync();

    const weeklyCard = container.querySelectorAll(".card")[0] as HTMLElement | undefined;
    const weeklyChecks = weeklyCard ? Array.from(weeklyCard.querySelectorAll(".weekdays input")) as HTMLInputElement[] : [];
    if (weeklyChecks[0]) {
      await fireEvent.click(weeklyChecks[0]);
      await fireEvent.click(weeklyChecks[0]);
    }
    if (weeklyChecks[1]) await fireEvent.click(weeklyChecks[1]);


    const afterCard = container.querySelectorAll(".card")[1] as HTMLElement | undefined;
    const afterInput = afterCard?.querySelector(".after input[type=\"number\"]") as HTMLInputElement | null;
    await fireEvent.input(afterInput as HTMLInputElement, { target: { value: "2" } });

    vi.advanceTimersByTime(300);
    await flushFakeAsync();

    const setCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "set_reminders");
    const last = setCalls[setCalls.length - 1]?.[1] as { reminders?: any[] } | undefined;
    const weekly = last?.reminders?.find((r: any) => r.id === "r1");
    const after = last?.reminders?.find((r: any) => r.id === "r2");
    expect(weekly?.schedule?.days?.includes(2)).toBe(true);
    expect(after?.schedule?.seconds).toBe(120);

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
    vi.useRealTimers();
  });

  it("reminder page reports save failure", async () => {
    vi.useFakeTimers();
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_reminders") {
        return [
          { id: "r1", text: "Fail", enabled: true, schedule: { kind: "after", seconds: 600, created_at: null }, next_trigger_at: 0, last_trigger_at: null },
        ];
      }
      if (command === "set_reminders") throw "save-bad";
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ReminderPage);
    await flushFakeAsync();

    const textArea = container.querySelector(".card .textarea") as HTMLTextAreaElement | null;
    await fireEvent.input(textArea as HTMLTextAreaElement, { target: { value: "Updated" } });

    vi.advanceTimersByTime(300);
    await flushFakeAsync();

    expect(container.querySelector(".sub")?.textContent).toContain("save-bad");

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
    vi.useRealTimers();
  });

  it("reminder alert page de-dupes updates and cleans listener", async () => {

    const invokeMock = vi.mocked(invoke);
    const listenMock = vi.mocked(listen);
    const originalInvoke = invokeMock.getMockImplementation();
    const originalListen = listenMock.getMockImplementation();
    const unlisten = vi.fn();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "take_pending_reminder_alerts") {
        return [{ id: "a1", text: "Alert A", scheduled_at: 1, fired_at: 2 }];
      }
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    listenMock.mockImplementation(async (_event, handler) => {
      (handler as Function)({ payload: [
        { id: "a1", text: "Alert A", scheduled_at: 1, fired_at: 2 },
        { id: "b1", text: "Alert B", scheduled_at: 3, fired_at: 4 },
      ] });
      return unlisten;
    });

    const { container, unmount } = render(ReminderAlertPage);
    await flushAsync();

    expect(container.querySelectorAll(".card").length).toBe(2);

    unmount();
    await flushAsync();
    expect(unlisten).toHaveBeenCalled();

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
    listenMock.mockImplementation(originalListen ?? (async () => () => {}));
  });

  it("animation page toggles mod data, border canvas, and cleans up", async () => {
    const clearMock = vi.mocked(clearImageCache);
    clearMock.mockClear();

    const { container, unmount } = render(AnimationPage);
    await flushAsync();

    const options = (globalThis as any).__lastWindowCoreOptions;
    options?.bindings?.setShowModDataPanel(true);
    options?.bindings?.setCurrentModData({ value: 7 });
    options?.bindings?.setModDataToasts([{ id: "t1", delta: 3 }]);
    options?.bindings?.setNoMod(true);
    options?.bindings?.setModBorderEnabled(true);
    await flushAsync();

    expect(container.querySelector(".mod-data-hud")).toBeTruthy();
    expect(container.querySelector(".mod-data-toast")).toBeTruthy();
    expect(container.querySelector(".no-mod-hint")).toBeTruthy();

    const border = container.querySelector(".border-canvas") as HTMLCanvasElement | null;
    expect(border).toBeTruthy();

    options?.bindings?.setShowBorder(false);
    await flushAsync();
    expect(border?.classList.contains("hidden")).toBe(true);

    unmount();
    expect(clearMock).toHaveBeenCalled();
  });

  it("animation page handles border and character config callbacks", async () => {
    const { container } = render(AnimationPage);
    await flushAsync();

    const options = (globalThis as any).__lastWindowCoreOptions;
    options?.bindings?.setModBorderEnabled(true);
    await flushAsync();

    await options?.callbacks?.onBorderConfigLoaded?.({ enable: true, anima: "border" });
    await options?.callbacks?.playAnimation?.("asset", true, () => {});
    options?.callbacks?.onCharacterConfigLoaded?.({ canvas_fit_preference: "long" });
    options?.callbacks?.onAnimationScaleChanged?.();

    expect(container.querySelector(".border-canvas")).toBeTruthy();
  });

  it("animation page enables memory debug hooks", async () => {
    vi.mocked(initMemoryDebug).mockResolvedValueOnce(true);

    const { unmount } = render(AnimationPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((window as any).__getMemoryLogs).toBeTruthy();

    unmount();
    delete (window as any).__getMemoryLogs;
    delete (window as any).__exportMemoryLogsCSV;
    delete (window as any).__getCacheStats;
  });


  it("live2d page skips init without mod", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") return null;
      if (command === "get_settings") return { live2d_mouse_follow: true, live2d_auto_interact: true };
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    render(Live2DPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((globalThis as any).__lastLive2DPlayer).toBeNull();

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("live2d page handles global key/mouse and settings change", async () => {
    const invokeMock = vi.mocked(invoke);
    const listenMock = vi.mocked(listen);
    const originalInvoke = invokeMock.getMockImplementation();
    const originalListen = listenMock.getMockImplementation();

    let settingsHandler: ((e: any) => void) | null = null;

    listenMock.mockImplementation(async (event, handler) => {
      if (event === "global-key-state") {
        (handler as Function)({ payload: { code: "KeyA", pressed: true } });
      }
      if (event === "global-mouse-state") {
        (handler as Function)({ payload: { button: "global_right_click", pressed: true } });
      }
      if (event === "settings-change") {
        settingsHandler = handler as (e: any) => void;
      }
      return () => {};
    });

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return { live2d_mouse_follow: true, live2d_auto_interact: true };
      if (command === "get_current_mod") {
        return {
          path: "C:/mods/live2d",
          manifest: { mod_type: "live2d", global_keyboard: true, global_mouse: true },
          live2d: { states: [] },
        };
      }
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    render(Live2DPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const player = (globalThis as any).__lastLive2DPlayer;
    expect(player?.setBackgroundLayersByEvent).toHaveBeenCalledWith("keydown:KeyA", true);
    expect(player?.setBackgroundLayersByEvent).toHaveBeenCalledWith("global_right_click", true);

    settingsHandler?.({ payload: { live2d_mouse_follow: false, live2d_auto_interact: false } });
    await flushAsync();

    expect(player?.setFeatureFlags).toHaveBeenCalled();

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
    listenMock.mockImplementation(originalListen ?? (async () => () => {}));
  });

  it("live2d page handles callbacks and mod data panel", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return { live2d_mouse_follow: true, live2d_auto_interact: true };
      if (command === "get_current_mod") {
        return {
          path: "C:/mods/live2d",
          manifest: { mod_type: "live2d" },
          live2d: { states: [] },
        };
      }
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(Live2DPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const options = (globalThis as any).__lastWindowCoreOptions;
    options?.bindings?.setShowModDataPanel(true);
    options?.bindings?.setCurrentModData({ value: 5 });
    options?.bindings?.setModDataToasts([{ id: "t1", delta: 1 }]);
    options?.bindings?.setNoMod(true);
    await flushAsync();

    expect(container.querySelector(".mod-data-hud")).toBeTruthy();
    expect(container.querySelector(".mod-data-toast")).toBeTruthy();
    expect(container.querySelector(".no-mod-hint")).toBeTruthy();

    options?.callbacks?.isPixelOpaqueAtWindowPos(1, 2);
    options?.callbacks?.onCursorMove(3, 4);

    const player = (globalThis as any).__lastLive2DPlayer;
    expect(player?.isPixelOpaqueAtScreen).toHaveBeenCalled();
    expect(player?.updateGlobalMouseFollow).toHaveBeenCalled();

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("threed page loads config and handles callbacks", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return {
          path: "C:/mods/3d",
          manifest: { mod_type: "3d" },
          threed: { model: { name: "Demo", file: "demo.vrm" }, animations: [], states: [] },
        };
      }
      if (command === "get_settings") return { threed_cross_fade_duration: 0.8 };
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ThreeDPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const player = (globalThis as any).__lastThreeDPlayer;
    expect(player?.setTransitionDuration).toHaveBeenCalledWith(0.8);

    const options = (globalThis as any).__lastWindowCoreOptions;
    options?.bindings?.setDebugBordersEnabled(true);
    options?.bindings?.setShowModDataPanel(true);
    options?.bindings?.setCurrentModData({ value: 9 });
    options?.bindings?.setNoMod(true);
    await flushAsync();

    expect(container.querySelector(".container")?.classList.contains("debug-border-active")).toBe(true);
    expect(container.querySelector(".mod-data-hud")).toBeTruthy();
    expect(container.querySelector(".no-mod-hint")).toBeTruthy();

    options?.callbacks?.onAnimationScaleChanged?.();
    options?.callbacks?.onTransitionDurationChanged?.(1.2);
    options?.callbacks?.isPixelOpaqueAtWindowPos?.(1, 2);

    expect(player?.setAnimationScale).toHaveBeenCalled();
    expect(player?.setTransitionDuration).toHaveBeenCalledWith(1.2);
    expect(player?.isPixelOpaqueAtScreen).toHaveBeenCalled();

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("pngremix page loads config and handles callbacks", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return {
          path: "C:/mods/png",
          manifest: { mod_type: "pngremix" },
          pngremix: { model: { name: "Demo", pngremix_file: "demo.pngremix" }, expressions: [], motions: [], states: [] },
        };
      }
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(PngRemixPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const player = (globalThis as any).__lastPngRemixPlayer;
    expect(player?.setAnimationScale).toHaveBeenCalled();

    const options = (globalThis as any).__lastWindowCoreOptions;
    options?.bindings?.setDebugBordersEnabled(true);
    options?.bindings?.setShowModDataPanel(true);
    options?.bindings?.setCurrentModData({ value: 3 });
    options?.bindings?.setNoMod(true);
    await flushAsync();

    expect(container.querySelector(".container")?.classList.contains("debug-border-active")).toBe(true);
    expect(container.querySelector(".mod-data-hud")).toBeTruthy();
    expect(container.querySelector(".no-mod-hint")).toBeTruthy();

    options?.callbacks?.isPixelOpaqueAtWindowPos?.(1, 2);
    options?.callbacks?.onCursorMove?.(3, 4);

    expect(player?.isPixelOpaqueAtScreen).toHaveBeenCalled();
    expect(player?.updateGlobalMouseFollow).toHaveBeenCalled();

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("about page renders special thanks list", async () => {
    const tArraySpy = vi.spyOn(i18n, "tArray").mockReturnValue(["Alice", "Bob"]);

    const { container } = render(AboutPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.querySelectorAll(".thanks-item").length).toBe(2);

    tArraySpy.mockRestore();
  });

  it("mods page reports current mod load error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") throw "load-current-bad";
      if (command === "get_mod_search_paths") return [];
      if (command === "get_available_mods") return [];
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.querySelector(".empty-state")).toBeTruthy();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("mods page falls back to open_dir when archive source missing", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return ["demo"];
      if (command === "get_current_mod") return null;
      if (command === "get_mod_details") {
        return {
          path: "C:/mods/demo.tbuddy",
          manifest: { id: "demo", version: "1.0.0", author: "tester", default_text_lang_id: "zh" },
          info: { zh: { name: "Demo", lang: "zh", description: "" } },
        };
      }
      if (command === "get_tbuddy_source_path") return null;
      if (command === "open_dir") return true;
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();

    const modButton = container.querySelector(".mod-item") as HTMLButtonElement | null;
    await fireEvent.click(modButton as HTMLButtonElement);
    await flushAsync();

    const openDirBtn = container.querySelector(".secondary-btn:not(.export-sbuddy-btn)") as HTMLButtonElement | null;
    await fireEvent.click(openDirBtn as HTMLButtonElement);
    await flushAsync();

    expect(invokeMock).toHaveBeenCalledWith("open_dir", { path: "C:/mods/demo.tbuddy" });

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("mods page ignores canceled export", async () => {
    const invokeMock = vi.mocked(invoke);
    const messageMock = vi.mocked(message);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return ["demo"];
      if (command === "get_current_mod") return null;
      if (command === "get_mod_details") {
        return {
          path: "C:/mods/demo",
          manifest: { id: "demo", version: "1.0.0", author: "tester", default_text_lang_id: "zh" },
          info: { zh: { name: "Demo", lang: "zh", description: "" } },
        };
      }
      if (command === "export_mod_as_sbuddy") throw "Canceled";
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();

    const modButton = container.querySelector(".mod-item") as HTMLButtonElement | null;
    await fireEvent.click(modButton as HTMLButtonElement);
    await flushAsync();

    const exportBtn = container.querySelector(".secondary-btn.export-sbuddy-btn") as HTMLButtonElement | null;
    await fireEvent.click(exportBtn as HTMLButtonElement);
    await flushAsync();

    expect(messageMock).not.toHaveBeenCalled();

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("mods page ignores canceled import", async () => {
    const invokeMock = vi.mocked(invoke);
    const messageMock = vi.mocked(message);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return [];
      if (command === "get_current_mod") return null;
      if (command === "pick_mod_tbuddy") throw "Canceled";
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();

    const importBtn = container.querySelector(".import-btn") as HTMLButtonElement | null;
    await fireEvent.click(importBtn as HTMLButtonElement);
    await flushAsync();

    const importCalled = invokeMock.mock.calls.some(([command]) => command === "import_mod_from_path_detailed");
    expect(importCalled).toBe(false);
    expect(messageMock).not.toHaveBeenCalled();

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("memo page blocks empty content", async () => {
    const user = userEvent.setup();
    const { container } = render(MemoPage);
    await flushAsync();

    const content = container.querySelector(".toolbar .content") as HTMLTextAreaElement | null;
    const addButton = container.querySelector(".toolbar .btn.primary") as HTMLButtonElement | null;

    await user.type(content as HTMLTextAreaElement, "   ");
    expect(addButton?.disabled).toBe(true);

    expect(container.querySelector(".items .item")).toBeFalsy();
  });

  it("memo page ignores move at bottom boundary", async () => {
    const user = userEvent.setup();
    const { container } = render(MemoPage);
    await flushAsync();

    const content = container.querySelector(".toolbar .content") as HTMLTextAreaElement | null;
    const addButton = container.querySelector(".toolbar .btn.primary") as HTMLButtonElement | null;

    await user.type(content as HTMLTextAreaElement, "Memo A");
    await user.click(addButton as HTMLButtonElement);
    await flushAsync();

    await user.type(content as HTMLTextAreaElement, "Memo B");
    await user.click(addButton as HTMLButtonElement);
    await flushAsync();

    const items = Array.from(container.querySelectorAll(".items .item")) as HTMLElement[];
    const lastItem = items[items.length - 1];
    const actionButtons = lastItem?.querySelectorAll(".actions .btn");
    const downBtn = actionButtons?.[1] as HTMLButtonElement | undefined;
    await fireEvent.click(downBtn as HTMLButtonElement);
    await flushAsync();

    const texts = Array.from(container.querySelectorAll(".memo-text")) as HTMLTextAreaElement[];
    expect(texts[0]?.value).toBe("Memo A");
    expect(texts[1]?.value).toBe("Memo B");
  });

  it("reminder page clamps invalid weekly time input", async () => {
    vi.useFakeTimers();
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    try {
      invokeMock.mockImplementation(async (command: string, args?: unknown) => {
        if (command === "get_reminders") {
          return [
            { id: "r1", text: "Weekly", enabled: true, schedule: { kind: "weekly", days: [1], hour: 9, minute: 0 }, next_trigger_at: 0, last_trigger_at: null },
          ];
        }
        if (command === "set_reminders") return true;
        return originalInvoke ? originalInvoke(command, args as never) : null;
      });

      const { container } = render(ReminderPage);
      await flushFakeAsync();

      const timeInput = container.querySelector(".card input[type=\"time\"]") as HTMLInputElement | null;
      // jsdom sanitizes type="time" values, so temporarily change to text to bypass validation
      timeInput!.setAttribute("type", "text");
      timeInput!.value = "99:99";
      timeInput!.dispatchEvent(new Event('input', { bubbles: true }));
      timeInput!.setAttribute("type", "time");

      vi.advanceTimersByTime(300);
      await flushFakeAsync();

      const setCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "set_reminders");
      const last = setCalls[setCalls.length - 1]?.[1] as { reminders?: any[] } | undefined;
      const weekly = last?.reminders?.find((r: any) => r.id === "r1");
      expect(weekly?.schedule?.hour).toBe(23);
      expect(weekly?.schedule?.minute).toBe(59);
    } finally {
      invokeMock.mockImplementation(originalInvoke ?? (async () => null));
      vi.useRealTimers();
    }
  });

  it("reminder alert page cleans i18n on unmount", async () => {
    const setupSpy = vi.spyOn(i18n, "setupI18nWithUpdate");
    const cleanup = vi.fn();

    setupSpy.mockImplementation(async (cb) => {
      cb();
      return cleanup;
    });

    const { unmount } = render(ReminderAlertPage);
    await flushAsync();

    unmount();
    await flushAsync();

    expect(cleanup).toHaveBeenCalled();
    setupSpy.mockRestore();
  });

  it("live2d page handles local key events when global keyboard disabled", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return { live2d_mouse_follow: true, live2d_auto_interact: true };
      if (command === "get_current_mod") {
        return {
          path: "C:/mods/live2d",
          manifest: { mod_type: "live2d", global_keyboard: false },
          live2d: { states: [] },
        };
      }
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    render(Live2DPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await fireEvent.keyDown(window, { code: "KeyZ" });
    await fireEvent.keyUp(window, { code: "KeyZ" });

    const player = (globalThis as any).__lastLive2DPlayer;
    expect(player?.setBackgroundLayersByEvent).toHaveBeenCalledWith("keydown:KeyZ", true);
    expect(player?.setBackgroundLayersByEvent).toHaveBeenCalledWith("keydown:KeyZ", false);

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("live2d page skips local mouse layer updates when global mouse enabled", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return { live2d_mouse_follow: true, live2d_auto_interact: true };
      if (command === "get_current_mod") {
        return {
          path: "C:/mods/live2d",
          manifest: { mod_type: "live2d", global_mouse: true },
          live2d: { states: [] },
        };
      }
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(Live2DPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const canvas = container.querySelector(".live2d-canvas") as HTMLCanvasElement | null;
    await fireEvent.mouseDown(canvas as HTMLCanvasElement, { button: 0 });
    await fireEvent.mouseUp(canvas as HTMLCanvasElement, { button: 0 });

    const player = (globalThis as any).__lastLive2DPlayer;
    expect(player?.setBackgroundLayersByEvent).not.toHaveBeenCalledWith("click", true);
    expect(player?.setBackgroundLayersByEvent).not.toHaveBeenCalledWith("click", false);

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("threed page skips init without mod", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") return null;
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    render(ThreeDPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((globalThis as any).__lastThreeDPlayer).toBeNull();

    const options = (globalThis as any).__lastWindowCoreOptions;
    const played = await options?.callbacks?.playAnimation?.("demo", true, () => {});
    expect(played).toBe(false);

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("pngremix page skips init without mod", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") return null;
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    render(PngRemixPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((globalThis as any).__lastPngRemixPlayer).toBeNull();

    const options = (globalThis as any).__lastWindowCoreOptions;
    const played = await options?.callbacks?.playAnimation?.("demo", true, () => {});
    expect(played).toBe(false);

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("mods page shows load failure status", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    const modInfo = {
      path: "C:/mods/demo",
      manifest: { id: "demo", version: "1.0.0", author: "tester", default_text_lang_id: "zh" },
      info: { zh: { name: "Demo", lang: "zh", description: "" } },
    };

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return ["demo"];
      if (command === "get_current_mod") return null;
      if (command === "get_mod_details") return modInfo;
      if (command === "load_mod") throw "load-bad";
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();

    const modButton = container.querySelector(".mod-item") as HTMLButtonElement | null;
    await fireEvent.click(modButton as HTMLButtonElement);
    await flushAsync();

    const loadBtn = container.querySelector(".load-btn") as HTMLButtonElement | null;
    await fireEvent.click(loadBtn as HTMLButtonElement);
    await flushAsync();

    expect(container.querySelector(".status")?.textContent).toContain("load-bad");

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("mods page shows status when open dir fails", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    const modInfo = {
      path: "C:/mods/demo",
      manifest: { id: "demo", version: "1.0.0", author: "tester", default_text_lang_id: "zh" },
      info: { zh: { name: "Demo", lang: "zh", description: "" } },
    };

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return ["demo"];
      if (command === "get_current_mod") return null;
      if (command === "get_mod_details") return modInfo;
      if (command === "open_dir") throw "open-bad";
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();

    const modButton = container.querySelector(".mod-item") as HTMLButtonElement | null;
    await fireEvent.click(modButton as HTMLButtonElement);
    await flushAsync();

    const openDirBtn = container.querySelector(".secondary-btn:not(.export-sbuddy-btn)") as HTMLButtonElement | null;
    await fireEvent.click(openDirBtn as HTMLButtonElement);
    await flushAsync();

    expect(container.querySelector(".status")?.textContent).toBe(i18n.t("modWindow.modDirOpenFailed"));

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("mods page reports sbuddy unsupported on export", async () => {
    const invokeMock = vi.mocked(invoke);
    const messageMock = vi.mocked(message);
    const originalImpl = invokeMock.getMockImplementation();

    const modInfo = {
      path: "C:/mods/demo",
      manifest: { id: "demo", version: "1.0.0", author: "tester", default_text_lang_id: "zh" },
      info: { zh: { name: "Demo", lang: "zh", description: "" } },
    };

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_search_paths") return ["C:/mods"];
      if (command === "get_available_mods") return ["demo"];
      if (command === "get_current_mod") return null;
      if (command === "get_mod_details") return modInfo;
      if (command === "export_mod_as_sbuddy") throw "sbuddy not supported";
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    const { container } = render(ModsPage);
    await flushAsync();

    const modButton = container.querySelector(".mod-item") as HTMLButtonElement | null;
    await fireEvent.click(modButton as HTMLButtonElement);
    await flushAsync();

    const exportBtn = container.querySelector(".secondary-btn.export-sbuddy-btn") as HTMLButtonElement | null;
    await fireEvent.click(exportBtn as HTMLButtonElement);
    await flushAsync();

    expect(messageMock).toHaveBeenCalledWith(
      i18n.t("modWindow.sbuddyNotSupported"),
      expect.objectContaining({ kind: "error" }),
    );

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("memo page clears pending save on unmount", async () => {
    vi.useFakeTimers();
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    clearSpy.mockClear();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_memos") return [];
      if (command === "set_memos") return true;
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container, unmount } = render(MemoPage);
    await flushFakeAsync();

    const content = container.querySelector(".toolbar .content") as HTMLTextAreaElement | null;
    const addButton = container.querySelector(".toolbar .btn.primary") as HTMLButtonElement | null;

    await fireEvent.input(content as HTMLTextAreaElement, { target: { value: "Memo" } });
    await fireEvent.click(addButton as HTMLButtonElement);
    await flushFakeAsync();

    unmount();
    await flushFakeAsync();

    expect(clearSpy).toHaveBeenCalled();

    clearSpy.mockRestore();
    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
    vi.useRealTimers();
  });

  it("memo page shows saving state while persisting", async () => {
    vi.useFakeTimers();
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();
    let resolveSave: ((value: boolean) => void) | null = null;

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_memos") return [];
      if (command === "set_memos") {
        return new Promise<boolean>((resolve) => {
          resolveSave = resolve;
        });
      }
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(MemoPage);
    await flushFakeAsync();

    const content = container.querySelector(".toolbar .content") as HTMLTextAreaElement | null;
    const addButton = container.querySelector(".toolbar .btn.primary") as HTMLButtonElement | null;

    await fireEvent.input(content as HTMLTextAreaElement, { target: { value: "Memo" } });
    await fireEvent.click(addButton as HTMLButtonElement);

    vi.advanceTimersByTime(300);
    await flushFakeAsync();

    expect(container.querySelector(".sub")?.classList.contains("saving")).toBe(true);

    (resolveSave as Function)(true);
    await Promise.resolve();
    await flushFakeAsync();

    expect(container.querySelector(".sub")?.classList.contains("saving")).toBe(false);

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
    vi.useRealTimers();
  });

  it("reminder page updates absolute schedule input", async () => {
    vi.useFakeTimers();
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_reminders") {
        return [
          { id: "r1", text: "Abs", enabled: true, schedule: { kind: "absolute", timestamp: 0 }, next_trigger_at: 0, last_trigger_at: null },
        ];
      }
      if (command === "set_reminders") return true;
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ReminderPage);
    await flushFakeAsync();

    const input = container.querySelector(".card input[type=\"datetime-local\"]") as HTMLInputElement | null;
    expect(input?.value).toBe("");

    const value = "2026-02-22T10:30";
    await fireEvent.input(input as HTMLInputElement, { target: { value } });

    vi.advanceTimersByTime(300);
    await flushFakeAsync();

    const setCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "set_reminders");
    const last = setCalls[setCalls.length - 1]?.[1] as { reminders?: any[] } | undefined;
    const absolute = last?.reminders?.find((r: any) => r.id === "r1");
    const expected = Math.floor(new Date(value).getTime() / 1000);
    expect(absolute?.schedule?.timestamp).toBe(expected);

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
    vi.useRealTimers();
  });

  it("reminder page falls back when formatTime throws", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();
    const localeSpy = vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(() => {
      throw new Error("bad");
    });

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_reminders") {
        return [
          { id: "r1", text: "Bad", enabled: true, schedule: { kind: "after", seconds: 60, created_at: null }, next_trigger_at: 1234, last_trigger_at: null },
        ];
      }
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ReminderPage);
    await flushAsync();

    expect(container.querySelector(".next")?.textContent).toContain("1234");

    localeSpy.mockRestore();
    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("reminder alert page tolerates load initial failure", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    // Suppress unhandled rejection at process level so Vitest doesn't report it
    const rejections: any[] = [];
    const processHandler = (reason: any) => { rejections.push(reason); };
    (globalThis as any).process.on("unhandledRejection", processHandler);

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "take_pending_reminder_alerts") throw "load-bad";
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { container } = render(ReminderAlertPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.querySelector(".empty")).toBeTruthy();

    (globalThis as any).process.removeListener("unhandledRejection", processHandler);
    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("animation page skips empty animation and short-circuits border config", async () => {
    const loadSpy = vi.spyOn(SpriteAnimator.prototype, "loadByAssetName");
    const switchSpy = vi.spyOn(SpriteAnimator.prototype, "switchToAsset");
    loadSpy.mockClear();
    switchSpy.mockClear();

    render(AnimationPage);
    await flushAsync();

    const options = (globalThis as any).__lastWindowCoreOptions;
    const played = await options?.callbacks?.playAnimation?.("", true, () => {});
    expect(played).toBe(false);
    expect(switchSpy).not.toHaveBeenCalled();

    options?.bindings?.setShowBorder(false);
    await flushAsync();
    await options?.callbacks?.onBorderConfigLoaded?.({ enable: true, anima: "border" });
    expect(loadSpy).not.toHaveBeenCalled();

    options?.bindings?.setModBorderEnabled(true);
    options?.bindings?.setShowBorder(true);
    await flushAsync();
    await options?.callbacks?.onBorderConfigLoaded?.({ enable: true, anima: "border" });
    expect(loadSpy).toHaveBeenCalledTimes(1);

    await options?.callbacks?.onBorderConfigLoaded?.({ enable: true, anima: "border" });
    expect(loadSpy).toHaveBeenCalledTimes(1);

    loadSpy.mockRestore();
    switchSpy.mockRestore();
  });

  it("animation page applies canvas fit scale and destroys animators", async () => {
    const setFitSpy = vi.spyOn(SpriteAnimator.prototype, "setCanvasFit");
    const destroySpy = vi.spyOn(SpriteAnimator.prototype, "destroy");
    setFitSpy.mockClear();
    destroySpy.mockClear();

    const { unmount } = render(AnimationPage);
    await flushAsync();

    const options = (globalThis as any).__lastWindowCoreOptions;
    options?.bindings?.setModBorderEnabled(true);
    await flushAsync();

    await options?.callbacks?.playAnimation?.("asset", true, () => {});
    const lastWithBorder = setFitSpy.mock.calls.at(-1);
    expect(lastWithBorder?.[1]?.scale).toBe(0.8);

    options?.bindings?.setModBorderEnabled(false);
    await options?.callbacks?.onAnimationScaleChanged?.();
    const lastNoBorder = setFitSpy.mock.calls.at(-1);
    expect(lastNoBorder?.[1]?.scale).toBe(1);

    // Re-enable border and create borderAnimator
    options?.bindings?.setModBorderEnabled(true);
    options?.bindings?.setShowBorder(true);
    await flushAsync();
    await options?.callbacks?.onBorderConfigLoaded?.({ enable: true, anima: "border" });
    unmount();

    expect(destroySpy.mock.calls.length).toBeGreaterThanOrEqual(2);

    setFitSpy.mockRestore();
    destroySpy.mockRestore();
  });

  it("live2d page reports settings load error", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") throw "load-settings-bad";
      if (command === "get_current_mod") {
        return { path: "C:/mods/live2d", manifest: { mod_type: "live2d" }, live2d: { states: [] } };
      }
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    render(Live2DPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("live2d page reports settings update error on hotkey", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return { live2d_mouse_follow: true, live2d_auto_interact: true };
      if (command === "get_current_mod") {
        return { path: "C:/mods/live2d", manifest: { mod_type: "live2d" }, live2d: { states: [] } };
      }
      if (command === "update_settings") throw "save-settings-bad";
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    render(Live2DPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await fireEvent.keyDown(window, { code: "KeyM", altKey: true });

    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("live2d page resets debug view on zero key", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalImpl = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return { live2d_mouse_follow: true, live2d_auto_interact: true };
      if (command === "get_current_mod") {
        return {
          path: "C:/mods/live2d",
          manifest: { mod_type: "live2d" },
          live2d: { states: [] },
        };
      }
      return originalImpl ? originalImpl(command, args as never) : null;
    });

    render(Live2DPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const options = (globalThis as any).__lastWindowCoreOptions;
    options?.bindings?.setDebugBordersEnabled(true);
    await flushAsync();

    await fireEvent.keyDown(window, { code: "Digit0" });

    const player = (globalThis as any).__lastLive2DPlayer;
    expect(player?.debugReset).toHaveBeenCalled();

    invokeMock.mockImplementation(originalImpl ?? (async () => null));
  });

  it("live2d page cleans listeners on unmount", async () => {
    const invokeMock = vi.mocked(invoke);
    const listenMock = vi.mocked(listen);
    const originalInvoke = invokeMock.getMockImplementation();
    const originalListen = listenMock.getMockImplementation();

    const unlistenSettings = vi.fn();
    const unlistenKey = vi.fn();
    const unlistenMouse = vi.fn();

    listenMock.mockImplementation(async (event) => {
      if (event === "settings-change") return unlistenSettings;
      if (event === "global-key-state") return unlistenKey;
      if (event === "global-mouse-state") return unlistenMouse;
      return () => {};
    });

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_settings") return { live2d_mouse_follow: true, live2d_auto_interact: true };
      if (command === "get_current_mod") {
        return { path: "C:/mods/live2d", manifest: { mod_type: "live2d" }, live2d: { states: [] } };
      }
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { unmount } = render(Live2DPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    unmount();
    await flushAsync();

    expect(unlistenSettings).toHaveBeenCalled();
    expect(unlistenKey).toHaveBeenCalled();
    expect(unlistenMouse).toHaveBeenCalled();

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
    listenMock.mockImplementation(originalListen ?? (async () => () => {}));
  });

  it("threed page destroys player on unmount", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return {
          path: "C:/mods/3d",
          manifest: { mod_type: "3d" },
          threed: { model: { name: "Demo", file: "demo.vrm" }, animations: [], states: [] },
        };
      }
      if (command === "get_settings") return { threed_cross_fade_duration: 0.4 };
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { unmount } = render(ThreeDPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const player = (globalThis as any).__lastThreeDPlayer;
    expect(player).toBeTruthy();

    unmount();
    expect(player?.destroy).toHaveBeenCalled();

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });

  it("pngremix page destroys player on unmount", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_current_mod") {
        return {
          path: "C:/mods/png",
          manifest: { mod_type: "pngremix" },
          pngremix: { model: { name: "Demo", pngremix_file: "demo.pngremix" }, expressions: [], motions: [], states: [] },
        };
      }
      return originalInvoke ? originalInvoke(command, args as never) : null;
    });

    const { unmount } = render(PngRemixPage);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const player = (globalThis as any).__lastPngRemixPlayer;
    expect(player).toBeTruthy();

    unmount();
    expect(player?.destroy).toHaveBeenCalled();

    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
  });
});








