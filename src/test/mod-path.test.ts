import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { clearModPathCache, getModPath } from "$lib/utils/modPath";

describe("modPath cache", () => {
  it("caches mod path and refreshes after clear", async () => {
    const invokeMock = vi.mocked(invoke);
    const original = invokeMock.getMockImplementation();

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_mod_path") return "C:/mods/demo";
      return original ? original(command, args as never) : null;
    });

    clearModPathCache();
    const first = await getModPath();
    const second = await getModPath();

    expect(first).toBe("C:/mods/demo");
    expect(second).toBe("C:/mods/demo");
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "get_mod_path").length).toBe(1);

    clearModPathCache();
    await getModPath();
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "get_mod_path").length).toBe(2);

    invokeMock.mockImplementation(original ?? (async () => null));
  });
});
