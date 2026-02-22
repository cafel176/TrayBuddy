import { describe, expect, it, vi } from "vitest";
import zhLang from "../../i18n/zh.json";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { destroyI18n, getAvailableLangs, initI18n, onLangChange, setLang, t, tArray } from "$lib/i18n";



describe("i18n utilities", () => {
  it("returns available languages with names", () => {
    const langs = getAvailableLangs();
    const zh = langs.find((l) => l.code === "zh");
    expect(zh?.name).toBeTruthy();
  });

  it("falls back to code when lang name is missing", () => {
    const original = (zhLang as any).lang;
    (zhLang as any).lang = "";

    const langs = getAvailableLangs();
    const zh = langs.find((l) => l.code === "zh");
    expect(zh?.name).toBe("zh");

    (zhLang as any).lang = original;
  });


  it("translates with params and falls back to key", () => {
    setLang("zh", true);
    expect(t("resource.statusRefreshed", { count: 5 })).toBe("已刷新 Mod 列表，共 5 个");
    expect(t("resource.statusRefreshed", { missing: 1 } as any)).toContain("{count}");
    expect(t("nonexistent.key")).toBe("nonexistent.key");
    expect(t("")).toBe("");
  });



  it("returns array translations", () => {
    setLang("zh", true);
    const weekdays = tArray("environment.weekdays");
    expect(weekdays.length).toBe(7);
    expect(weekdays[0]).toBe("周日");

    expect(tArray("memo")).toEqual([]);
  });


  it("notifies listeners on language change", () => {
    let called = 0;
    const off = onLangChange(() => { called += 1; });
    setLang("en", true);
    expect(called).toBeGreaterThan(0);
    off();
  });

  it("does not notify when language unchanged", () => {
    setLang("zh", true);
    let called = 0;
    const off = onLangChange(() => { called += 1; });
    const current = t("common.ok");
    setLang("zh", false);
    expect(t("common.ok")).toBe(current);
    expect(called).toBe(0);
    off();
  });


  it("initializes and listens for language changes", async () => {
    const invokeMock = vi.mocked(invoke);
    const listenMock = vi.mocked(listen);

    invokeMock.mockResolvedValueOnce({ lang: "en" } as any);

    let handler: ((event: { payload?: { lang?: unknown } }) => void) | null = null;
    listenMock.mockImplementationOnce(async (_event, cb) => {
      handler = cb as (event: { payload?: { lang?: unknown } }) => void;
      return () => {};
    });

    await initI18n();
    handler?.({ payload: { lang: 123 } });
    handler?.({ payload: { lang: "jp" } });

    destroyI18n();
  });

  it("handles init errors gracefully", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockRejectedValueOnce(new Error("boom"));

    await initI18n();
    destroyI18n();
  });
});


