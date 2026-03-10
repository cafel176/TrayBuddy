import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { TriggerManager, getTriggerManager, resetTriggerManagerInstance } from "$lib/trigger/TriggerManager";

describe("TriggerManager", () => {
  beforeEach(() => {
    resetTriggerManagerInstance();
  });

  it("validates supported events", () => {
    const manager = new TriggerManager();
    expect(manager.isEventSupported("click")).toBe(true);
    expect(manager.isEventSupported("keydown:A")).toBe(true);
    expect(manager.isEventSupported("keyup:Enter")).toBe(true);
    expect(manager.isEventSupported("unknown_event")).toBe(false);
  });

  it("returns supported events list", () => {
    const manager = new TriggerManager();
    const list = manager.getSupportedEvents();
    expect(list).toContain("login_silence");
    expect(list).toContain("drag_end");
  });

  it("does not invoke backend for unsupported events", async () => {
    const manager = new TriggerManager();
    const invokeMock = vi.mocked(invoke);
    const result = await manager.trigger("not_supported");
    expect(result).toBe(false);
    expect(invokeMock).not.toHaveBeenCalledWith("trigger_event", expect.anything());
  });

  it("invokes backend for supported events", async () => {
    const manager = new TriggerManager();
    const invokeMock = vi.mocked(invoke);
    const original = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "trigger_event") return true;
      return original ? original(command, args as never) : null;
    });

    const result = await manager.trigger("click", true);
    expect(result).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("trigger_event", { eventName: "click", force: true });

    invokeMock.mockImplementation(original ?? (async () => null));
  });

  it("returns false when backend throws", async () => {
    const manager = new TriggerManager();
    const invokeMock = vi.mocked(invoke);
    const original = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "trigger_event") throw new Error("boom");
      return original ? original(command) : null;
    });

    const result = await manager.trigger("click");
    expect(result).toBe(false);

    invokeMock.mockImplementation(original ?? (async () => null));
  });

  it("destroy does not throw", () => {
    const manager = new TriggerManager();
    expect(() => manager.destroy()).not.toThrow();
  });

  it("getTriggerManager returns singleton", () => {
    const a = getTriggerManager();
    const b = getTriggerManager();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(TriggerManager);
  });

  it("resetTriggerManagerInstance clears singleton", () => {
    const a = getTriggerManager();
    resetTriggerManagerInstance();
    const b = getTriggerManager();
    expect(a).not.toBe(b);
  });

  it("trigger with default force=false", async () => {
    const manager = new TriggerManager();
    const invokeMock = vi.mocked(invoke);
    const original = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "trigger_event") return true;
      return original ? original(command, args as never) : null;
    });

    const result = await manager.trigger("login");
    expect(result).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("trigger_event", { eventName: "login", force: false });

    invokeMock.mockImplementation(original ?? (async () => null));
  });
});
