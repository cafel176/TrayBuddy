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

  it("createI18nState _ function calls t and references langVersion", () => {
    const state = createI18nState();
    // _ should call t() and reference _langVersion for reactivity
    const result = state._("some.key");
    expect(typeof result).toBe("string");
    // Also test with params
    const result2 = state._("some.key", { count: 42 });
    expect(typeof result2).toBe("string");
  });

  it("createI18nState cleanup is idempotent", () => {
    const state = createI18nState();
    // Call cleanup multiple times — should not throw
    state.cleanup();
    state.cleanup();
    expect(state.unsubLang.value).toBeNull();
  });

  it("setupI18n without onLangUpdate callback", async () => {
    const state = createI18nState();

    // Call without the optional onLangUpdate
    await setupI18n(state);

    expect(state._langVersion.value).toBeGreaterThan(0);
    expect(state.unsubLang.value).not.toBeNull();

    state.cleanup();
  });

  it("setupI18n registers lang change listener", async () => {
    const state = createI18nState();
    const onUpdate = vi.fn();

    await setupI18n(state, onUpdate);

    // unsubLang should have been set by setupI18n
    expect(state.unsubLang.value).not.toBeNull();
    // langVersion should have been incremented at least once
    expect(state._langVersion.value).toBeGreaterThanOrEqual(1);

    state.cleanup();
    expect(state.unsubLang.value).toBeNull();
  });
});
