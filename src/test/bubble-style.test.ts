import { describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import {
  bubbleStyle,
  defaultStyle,
  getCurrentStyle,
  loadBubbleStyle,
  styleLoaded,
  toCssVars,
  toStyleString,
} from "$lib/bubble/bubbleStyle";

describe("bubbleStyle utilities", () => {
  it("converts style object to CSS string with filters", () => {
    const css = toStyleString({
      font_family: "Noto Sans",
      font_size: "12px",
      content: "ignored",
      content_hover: "ignored",
      color_hover: "#fff",
      color_active: "#000",
      nested: { a: 1 },
      padding_top: "4px",
    });

    expect(css).toContain("font-family: Noto Sans;");
    expect(css).toContain("font-size: 12px;");
    expect(css).toContain("padding-top: 4px;");
    expect(css).not.toContain("content:");
    expect(css).not.toContain("hover");
  });

  it("converts style object to CSS vars with hover/active suffix", () => {
    const cssVars = toCssVars(
      {
        color_hover: "#fff",
        color_active: "#000",
        border_radius: "6px",
      },
      "decor-left"
    );

    expect(cssVars).toContain("--decor-left-color-hover: #fff;");
    expect(cssVars).toContain("--decor-left-color-active: #000;");
    expect(cssVars).toContain("--decor-left-border-radius: 6px;");
  });

  it("loads bubble style and merges with defaults", async () => {
    const invokeMock = vi.mocked(invoke);
    const original = invokeMock.getMockImplementation();

    bubbleStyle.set(defaultStyle);
    styleLoaded.set(false);

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_bubble_style") {
        return {
          bubble: { tail: { size: "12px" } },
          branch: { container: { gap: "8px" } },
        };
      }
      return original ? original(command, args as never) : null;
    });

    await loadBubbleStyle();
    const current = getCurrentStyle();
    const loaded = get(styleLoaded);

    expect(current.bubble.tail.size).toBe("12px");
    expect(current.branch.container.gap).toBe("8px");
    expect(current.branch.button).toBeTruthy();
    expect(loaded).toBe(true);

    invokeMock.mockImplementation(original ?? (async () => null));
  });

  it("handles empty/invalid inputs gracefully", async () => {
    const invokeMock = vi.mocked(invoke);
    const original = invokeMock.getMockImplementation();

    expect(toStyleString(null)).toBe("");
    expect(toCssVars(undefined, "btn")).toBe("");

    const css = toStyleString({ font_family: '"Noto Sans"' });
    expect(css).toContain('font-family: "Noto Sans";');

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_bubble_style") return null;
      return original ? original(command, args as never) : null;
    });

    await loadBubbleStyle();
    expect(getCurrentStyle().bubble.tail.size).toBe(defaultStyle.bubble.tail.size);

    invokeMock.mockImplementation(async () => {
      throw new Error("boom");
    });

    await loadBubbleStyle();
    expect(get(styleLoaded)).toBe(true);

    invokeMock.mockImplementation(original ?? (async () => null));
  });
});

