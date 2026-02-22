import { describe, expect, it, vi } from "vitest";
import { createI18nState, setupI18n, setupI18nWithUpdate } from "$lib/i18n/hooks";


describe("i18n hooks", () => {
  it("initializes state and triggers updates", async () => {
    const state = createI18nState();
    const onUpdate = vi.fn();

    await setupI18n(state, onUpdate);

    expect(state._langVersion.value).toBeGreaterThan(0);
    expect(onUpdate).toHaveBeenCalled();

    state.cleanup();
  });

  it("setupI18nWithUpdate returns cleanup", async () => {
    const onUpdate = vi.fn();
    const cleanup = await setupI18nWithUpdate(onUpdate);

    expect(onUpdate).toHaveBeenCalled();
    cleanup();
  });
});
