import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import { describe, expect, it, vi, afterEach } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import BranchOptions from "$lib/bubble/BranchOptions.svelte";
import { bubbleStyle, defaultStyle } from "$lib/bubble/bubbleStyle";
import { flushAsync as flush, resetBubbleStyle } from "./test-utils";

afterEach(() => {
  resetBubbleStyle();
});

describe("BranchOptions", () => {
  it("supports inline layout and keyboard selection", async () => {
    const branches = [
      { text: "A", next_state: "state_a" },
      { text: "B", next_state: "state_b" },
    ];

    const { container, rerender } = render(BranchOptions, { props: { branches } });
    await flush();

    const wrapper = container.querySelector(".branch-options") as HTMLElement | null;
    expect(wrapper?.classList.contains("inline-layout")).toBe(true);

    await fireEvent.keyDown(window, { key: "ArrowDown" });

    const buttons = Array.from(container.querySelectorAll(".branch-button")) as HTMLButtonElement[];
    expect(buttons[1]?.classList.contains("focused")).toBe(true);

    await fireEvent.click(buttons[1]);

    await rerender({ branches, selectedBranch: branches[0] });
    const updatedButtons = Array.from(container.querySelectorAll(".branch-button")) as HTMLButtonElement[];
    expect(updatedButtons[0]?.classList.contains("selected")).toBe(true);
    expect(updatedButtons[0]?.classList.contains("disabled")).toBe(true);
  });

  it("wraps long text and disables inline layout for many branches", async () => {
    const branches = [
      { text: "ABCDEFGHIJK", next_state: "state_long" },
      { text: "B", next_state: "state_b" },
      { text: "C", next_state: "state_c" },
    ];

    const { container } = render(BranchOptions, { props: { branches } });
    await flush();

    const wrapper = container.querySelector(".branch-options") as HTMLElement | null;
    expect(wrapper?.classList.contains("inline-layout")).toBe(false);

    const textEl = container.querySelector(".btn-text");
    expect(textEl?.textContent).toContain("\n");
  });

  it("updates hover decoration and handles backend keydown", async () => {
    const listenMock = vi.mocked(listen);
    let handler: ((event: { payload: string }) => void) | null = null;
    listenMock.mockImplementationOnce(async (_event, cb) => {
      handler = cb as (event: { payload: string }) => void;
      return () => {};
    });

    bubbleStyle.set({
      bubble: { ...defaultStyle.bubble },
      branch: {
        ...defaultStyle.branch,
        decoration_right: { content: ">", content_hover: ">>" },
      },
    });

    const branches = [
      { text: "A", next_state: "state_a" },
      { text: "B", next_state: "state_b" },
    ];

    const { container } = render(BranchOptions, { props: { branches } });
    await flush();

    const buttons = Array.from(container.querySelectorAll(".branch-button")) as HTMLButtonElement[];
    const firstButton = buttons[0] as HTMLElement;
    const getDecorRight = () =>
      (firstButton.querySelector(".decor-right") as HTMLElement | null)?.textContent ?? "";

    expect(getDecorRight()).toBe(">"
    );

    await fireEvent.mouseEnter(firstButton);
    await tick();
    expect(getDecorRight()).toBe(">>");

    await fireEvent.mouseLeave(firstButton);
    await tick();
    expect(getDecorRight()).toBe(">");

    handler?.({ payload: "ArrowDown" });
    await tick();
    expect(buttons[1]?.classList.contains("focused")).toBe(true);

    handler?.({ payload: "Space" });
  });

  it("skips focus changes when disabled and when selected", async () => {
    const branches = [
      { text: "A", next_state: "state_a" },
      { text: "B", next_state: "state_b" },
    ];

    const { container, rerender } = render(BranchOptions, {
      props: { branches, disabled: true },
    });
    await flush();

    await fireEvent.keyDown(window, { key: "ArrowDown" });
    await tick();

    const buttons = Array.from(container.querySelectorAll(".branch-button")) as HTMLButtonElement[];
    expect(buttons.every((button) => !button.classList.contains("focused"))).toBe(true);

    await rerender({ branches, selectedBranch: branches[0] });
    await fireEvent.keyDown(window, { key: "ArrowDown" });
    await tick();

    const updatedButtons = Array.from(container.querySelectorAll(".branch-button")) as HTMLButtonElement[];
    expect(updatedButtons.every((button) => !button.classList.contains("focused"))).toBe(true);
  });

  it("applies constants from backend and handles listen errors", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      short_text_threshold: 1,
      max_buttons_per_row: 1,
      max_chars_per_button: 2,
    });

    const listenMock = vi.mocked(listen);
    listenMock.mockImplementationOnce(async () => {
      throw new Error("listen failed");
    });

    const branches = [
      { text: "ABCD", next_state: "state_a" },
      { text: "EFGH", next_state: "state_b" },
    ];

    const { container } = render(BranchOptions, { props: { branches } });
    await flush();

    const wrapper = container.querySelector(".branch-options") as HTMLElement | null;
    expect(wrapper?.classList.contains("inline-layout")).toBe(false);

    const textEl = container.querySelector(".btn-text");
    expect(textEl?.textContent).toContain("\n");
  });

  it("does not render when hidden or empty", async () => {
    const { container, rerender } = render(BranchOptions, {
      props: { branches: [], visible: true },
    });
    await flush();

    expect(container.querySelector(".branch-options")).toBeFalsy();

    await rerender({ branches: [{ text: "A", next_state: "state_a" }], visible: false });
    await flush();
    expect(container.querySelector(".branch-options")).toBeFalsy();
  });

  it("wraps keyboard focus on ArrowUp and handles Enter", async () => {
    const branches = [
      { text: "A", next_state: "state_a" },
      { text: "B", next_state: "state_b" },
    ];

    const { container } = render(BranchOptions, { props: { branches } });
    await flush();

    await fireEvent.keyDown(window, { key: "ArrowUp" });
    await tick();

    const buttons = Array.from(container.querySelectorAll(".branch-button")) as HTMLButtonElement[];
    expect(buttons[1]?.classList.contains("focused")).toBe(true);

    await fireEvent.keyDown(window, { key: "Enter" });
  });

  it("handles backend ArrowUp/Enter and ignores when selected", async () => {
    const listenMock = vi.mocked(listen);
    let handler: ((event: { payload: string }) => void) | null = null;
    listenMock.mockImplementationOnce(async (_event, cb) => {
      handler = cb as (event: { payload: string }) => void;
      return () => {};
    });

    const branches = [
      { text: "A", next_state: "state_a" },
      { text: "B", next_state: "state_b" },
    ];

    const { container, rerender } = render(BranchOptions, { props: { branches } });
    await flush();

    handler?.({ payload: "ArrowUp" });
    await tick();

    const buttons = Array.from(container.querySelectorAll(".branch-button")) as HTMLButtonElement[];
    expect(buttons[1]?.classList.contains("focused")).toBe(true);

    handler?.({ payload: "Enter" });

    await rerender({ branches, selectedBranch: branches[0] });
    handler?.({ payload: "ArrowDown" });
  });

  it("handles disabled click and null style", async () => {
    const branches = [{ text: "A", next_state: "state_a" }];
    bubbleStyle.set(null as unknown as typeof defaultStyle);

    const { container } = render(BranchOptions, { props: { branches, disabled: true } });
    await flush();

    const button = container.querySelector(".branch-button") as HTMLButtonElement | null;
    await fireEvent.click(button as HTMLButtonElement);

    bubbleStyle.set(defaultStyle);
  });

  it("logs when constants load fails", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockRejectedValueOnce(new Error("boom"));

    const branches = [{ text: "A", next_state: "state_a" }];
    render(BranchOptions, { props: { branches } });
    await flush();
  });
});



