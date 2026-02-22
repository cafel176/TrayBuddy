import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import { describe, expect, it, vi } from "vitest";
import BubbleManager from "$lib/bubble/BubbleManager.svelte";
import { BUBBLE_SWITCH_DELAY_MS } from "$lib/constants";

describe("BubbleManager", () => {
  it("shows, hides, and switches bubbles", async () => {
    vi.useFakeTimers();
    const { component } = render(BubbleManager);

    await tick();
    await Promise.resolve();
    await tick();

    expect(component.isShowing()).toBe(false);

    component.show({ text: "Hello" });
    expect(component.isShowing()).toBe(true);

    component.show({ text: "Next" });
    vi.advanceTimersByTime(BUBBLE_SWITCH_DELAY_MS + 10);
    await tick();
    expect(component.isShowing()).toBe(true);

    component.hide();
    expect(component.isShowing()).toBe(false);

    vi.useRealTimers();
  });
});
