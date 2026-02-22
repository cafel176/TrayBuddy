import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import { describe, expect, it, vi } from "vitest";
import Bubble from "$lib/bubble/Bubble.svelte";
import { bubbleStyle, defaultStyle } from "$lib/bubble/bubbleStyle";

function resetStyle() {
  bubbleStyle.set({
    bubble: { ...defaultStyle.bubble },
    branch: {
      ...defaultStyle.branch,
      decoration_left: { ...defaultStyle.branch.decoration_left },
      decoration_right: { ...defaultStyle.branch.decoration_right },
    },
  });
}

describe("Bubble", () => {
  it("renders branches immediately without text", async () => {
    resetStyle();
    const branches = [
      { text: "OK", next_state: "next" },
      { text: "Cancel", next_state: "cancel" },
    ];

    const { container } = render(Bubble, { props: { text: "", branches } });
    await tick();

    expect(container.querySelector(".branch-options")).toBeTruthy();
    expect(container.querySelector(".typewriter-text")).toBeFalsy();
  });

  it("shows branches after text completes", async () => {
    resetStyle();
    const branches = [
      { text: "A", next_state: "state_a" },
      { text: "B", next_state: "state_b" },
    ];

    const { container } = render(Bubble, {
      props: { text: "Hello", branches, duration: 120 },
    });
    await tick();

    expect(container.querySelector(".branch-options")).toBeFalsy();

    const textEl = container.querySelector(".typewriter-text") as HTMLElement | null;
    await fireEvent.click(textEl as HTMLElement);
    await tick();

    expect(container.querySelector(".branch-options")).toBeTruthy();
  });

  it("closes on backdrop click when no branches", async () => {
    vi.useFakeTimers();
    bubbleStyle.set({
      bubble: {
        ...defaultStyle.bubble,
        decoration_top: { content: "^" },
        decoration_bottom: { content: "v" },
      },
      branch: {
        ...defaultStyle.branch,
        decoration_left: { ...defaultStyle.branch.decoration_left },
        decoration_right: { ...defaultStyle.branch.decoration_right },
      },
    });

    const { container } = render(Bubble, { props: { text: "", branches: [] } });
    await tick();

    const wrapper = container.querySelector(".bubble-wrapper") as HTMLElement | null;
    const bubble = container.querySelector(".bubble") as HTMLElement | null;
    await fireEvent.click(bubble as HTMLElement);
    await tick();

    expect(wrapper?.getAttribute("style")).toContain("opacity: 0");

    vi.useRealTimers();
  });

  it("does not close on backdrop click when branches exist", async () => {
    vi.useFakeTimers();
    resetStyle();

    const branches = [{ text: "A", next_state: "state_a" }];
    const { container } = render(Bubble, { props: { text: "", branches } });
    await tick();

    vi.runOnlyPendingTimers();
    await tick();

    const wrapper = container.querySelector(".bubble-wrapper") as HTMLElement | null;
    const bubble = container.querySelector(".bubble") as HTMLElement | null;
    const beforeStyle = wrapper?.getAttribute("style") ?? "";

    await fireEvent.click(bubble as HTMLElement);
    await tick();

    const afterStyle = wrapper?.getAttribute("style") ?? "";
    expect(afterStyle).toBe(beforeStyle);

    vi.useRealTimers();
  });


  it("auto closes after text completes when duration is set", async () => {
    vi.useFakeTimers();
    resetStyle();

    const { container } = render(Bubble, {
      props: { text: "Hello", branches: [], duration: 120 },
    });
    await tick();

    const textEl = container.querySelector(".typewriter-text") as HTMLElement | null;
    await fireEvent.click(textEl as HTMLElement);
    await tick();

    vi.advanceTimersByTime(120);
    await tick();

    const wrapper = container.querySelector(".bubble-wrapper") as HTMLElement | null;
    expect(wrapper?.getAttribute("style")).toContain("opacity: 0");

    vi.useRealTimers();
  });

  it("auto closes using calculated duration when duration is zero", async () => {
    vi.useFakeTimers();
    resetStyle();

    const { container } = render(Bubble, {
      props: { text: "Hi", branches: [], duration: 0 },
    });
    await tick();

    const textEl = container.querySelector(".typewriter-text") as HTMLElement | null;
    await fireEvent.click(textEl as HTMLElement);
    await tick();

    vi.advanceTimersByTime(2000);
    await tick();

    const wrapper = container.querySelector(".bubble-wrapper") as HTMLElement | null;
    expect(wrapper?.getAttribute("style")).toContain("opacity: 0");

    vi.useRealTimers();
  });

  it("auto closes when empty text uses duration override", async () => {
    vi.useFakeTimers();
    resetStyle();

    const { container } = render(Bubble, {
      props: { text: "", branches: [], duration: 150 },
    });
    await tick();

    vi.advanceTimersByTime(150);
    await tick();

    const wrapper = container.querySelector(".bubble-wrapper") as HTMLElement | null;
    expect(wrapper?.getAttribute("style")).toContain("opacity: 0");

    vi.useRealTimers();
  });

  it("renders with null style values", async () => {
    bubbleStyle.set(null as unknown as typeof defaultStyle);

    const { container } = render(Bubble, { props: { text: "", branches: [] } });
    await tick();

    expect(container.querySelector(".bubble-wrapper")).toBeTruthy();

    resetStyle();
  });

  it("does not double close when already closing", async () => {
    vi.useFakeTimers();
    resetStyle();

    const { component } = render(Bubble, { props: { text: "", branches: [] } });
    await tick();

    component.close();
    component.close();
    vi.runOnlyPendingTimers();
    await tick();

    vi.useRealTimers();
  });
});



