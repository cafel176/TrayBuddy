import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import TypewriterText from "$lib/bubble/TypewriterText.svelte";


describe("TypewriterText", () => {
  it("types text and completes", async () => {
    vi.useFakeTimers();
    const { container } = render(TypewriterText, {
      props: { text: "AB", speed: 10 },
    });

    await tick();
    await Promise.resolve();
    await tick();

    vi.advanceTimersByTime(1000);
    await tick();
    await Promise.resolve();
    await tick();

    expect(container.querySelector(".cursor")).toBeFalsy();
    expect(container.querySelector(".typewriter-text")?.classList.contains("complete")).toBe(true);

    vi.useRealTimers();
  });

  it("click skips typing and shows full text", async () => {
    vi.useFakeTimers();
    const { container } = render(TypewriterText, {
      props: { text: "Hello", speed: 1000 },
    });

    await tick();
    const el = container.querySelector(".typewriter-text") as HTMLElement | null;
    await fireEvent.click(el as HTMLElement);
    await tick();

    expect(container.querySelector(".cursor")).toBeFalsy();
    expect(container.querySelector(".typewriter-text")?.classList.contains("complete")).toBe(true);

    vi.useRealTimers();
  });

  it("renders instantly when instant is true", async () => {
    const { container } = render(TypewriterText, {
      props: { text: "Instant", instant: true },
    });

    await tick();

    expect(container.querySelector(".cursor")).toBeFalsy();
    expect(container.querySelector(".typewriter-text")?.classList.contains("complete")).toBe(true);
  });

  it("wraps long text when max_chars_per_line is provided", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ max_chars_per_line: 2 });

    const { container, rerender } = render(TypewriterText, {
      props: { text: "ABCD", instant: true },
    });

    await tick();
    await rerender({ text: "ABCDE", instant: true });
    await tick();

    const html = container.querySelector(".typewriter-text")?.innerHTML ?? "";
    expect(html).toContain("<br>");
  });


  it("does not wrap when max_chars_per_line is non-positive", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ max_chars_per_line: -1 });

    const { container } = render(TypewriterText, {
      props: { text: "ABCD", instant: true },
    });

    await tick();

    const html = container.querySelector(".typewriter-text")?.innerHTML ?? "";
    expect(html).not.toContain("<br>");
  });
});

