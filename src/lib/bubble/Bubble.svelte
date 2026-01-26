<!--
=========================================================================
对话气泡组件 (Bubble.svelte)
=========================================================================

功能概述:
- 显示对话内容（支持打字机效果）
- 显示分支选项
- 弹性动画效果
- 自动消失（可配置）
- 支持从 mod 加载自定义样式

使用示例:
<Bubble 
  text="你好！" 
  branches={[{ text: "OK", next_state: "next" }]}
  on:branchSelect={handleBranchSelect}
  on:close={handleClose}
/>
=========================================================================
-->

<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import { spring } from "svelte/motion";
  import TypewriterText from "./TypewriterText.svelte";
  import BranchOptions, { type BranchInfo } from "./BranchOptions.svelte";
  import { calculateDisplayDuration } from "./markdown";
  import {
    bubbleStyle,
    type BubbleStyleConfig,
    toStyleString,
    toCssVars,
  } from "./bubbleStyle";
  import {
    BUBBLE_DEFAULT_AUTO_CLOSE_MS,
    BUBBLE_CLOSE_ANIMATION_MS,
  } from "$lib/constants";

  // ======================================================================= //
  // Props
  // ======================================================================= //

  /** 显示的文本内容 */
  export let text: string = "";

  /** 分支选项 */
  export let branches: BranchInfo[] = [];

  /** 自动消失时间（毫秒），0 表示不自动消失 */
  export let duration: number = 0;

  /** 气泡位置 */
  export let position: "top" | "left" | "right" = "top";

  /** 打字速度（毫秒/字符） */
  export let typeSpeed: number = 50;

  // ======================================================================= //
  // 状态
  // ======================================================================= //

  /** 弹性缩放动画 */
  const scale = spring(0, {
    stiffness: 0.15,
    damping: 0.4,
  });

  /** 透明度动画 */
  const opacity = spring(0, {
    stiffness: 0.2,
    damping: 0.5,
  });

  /** 是否显示分支选项（文本显示完成后显示） */
  let showBranches = false;

  /** 自动关闭定时器 */
  let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

  /** 是否正在关闭 */
  let isClosing = false;

  /** 已选中的分支（选中后只显示该分支且禁用） */
  let selectedBranch: BranchInfo | null = null;

  /** 当前样式 */
  let style: BubbleStyleConfig;
  $: style = $bubbleStyle;

  // ======================================================================= //
  // 事件
  // ======================================================================= //

  const dispatch = createEventDispatcher<{
    /** 选择了分支 */
    branchSelect: BranchInfo;
    /** 气泡关闭 */
    close: void;
    /** 文本显示完成 */
    textComplete: void;
  }>();

  // ======================================================================= //
  // 生命周期
  // ======================================================================= //

  onMount(() => {
    // 弹入动画
    scale.set(1);
    opacity.set(1);

    // 如果没有文本，直接处理自动关闭逻辑
    if (!text) {
      showBranches = true;
      // 设置自动关闭（有分支选项的气泡也会在持续时间后消失）
      const autoCloseDuration =
        duration > 0 ? duration : BUBBLE_DEFAULT_AUTO_CLOSE_MS;
      startAutoClose(autoCloseDuration);
    }
  });

  onDestroy(() => {
    clearAutoCloseTimer();
  });

  // ======================================================================= //
  // 方法
  // ======================================================================= //

  /**
   * 文本显示完成
   */
  function handleTextComplete() {
    showBranches = true;
    dispatch("textComplete");

    // 设置自动关闭（有分支选项的气泡也会在持续时间后消失）
    const autoCloseDuration =
      duration > 0 ? duration : calculateDisplayDuration(text);
    startAutoClose(autoCloseDuration);
  }

  /**
   * 分支选择
   */
  function handleBranchSelect(e: CustomEvent<BranchInfo>) {
    // 设置选中的分支（隐藏其他按钮，仅显示选中的）
    selectedBranch = e.detail;
    dispatch("branchSelect", e.detail);
    // 不立即关闭，等待持续时间完成后自动关闭
  }

  /**
   * 开始自动关闭倒计时
   */
  function startAutoClose(delay: number) {
    clearAutoCloseTimer();
    autoCloseTimer = setTimeout(() => {
      close();
    }, delay);
  }

  /**
   * 清除自动关闭定时器
   */
  function clearAutoCloseTimer() {
    if (autoCloseTimer) {
      clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
    }
  }

  /**
   * 关闭气泡
   */
  export function close() {
    if (isClosing) return;
    isClosing = true;

    clearAutoCloseTimer();

    // 弹出动画
    scale.set(0.8);
    opacity.set(0);

    // 动画完成后触发关闭事件
    setTimeout(() => {
      dispatch("close");
    }, BUBBLE_CLOSE_ANIMATION_MS);
  }

  /**
   * 点击气泡外部关闭（仅当没有分支选项时）
   */
  function handleBackdropClick() {
    if (branches.length === 0 && showBranches) {
      close();
    }
  }

  // ======================================================================= //
  // 动态样式计算
  // ======================================================================= //

  $: bubbleMainStyle = style ? toStyleString(style.bubble) : "";

  // 尾巴使用 CSS 变量动态映射
  $: tailVars = style ? toCssVars(style.bubble.tail, "tail") : "";

  $: decorTopStyle = style?.bubble.decoration_top
    ? toStyleString(style.bubble.decoration_top)
    : "";
  $: decorBottomStyle = style?.bubble.decoration_bottom
    ? toStyleString(style.bubble.decoration_bottom)
    : "";
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="bubble-wrapper position-{position}"
  style="transform: scale({$scale}); opacity: {$opacity}; {tailVars}"
>
  <div class="bubble" style={bubbleMainStyle} on:click={handleBackdropClick}>
    <!-- 气泡装饰 - 顶部 -->
    {#if style?.bubble.decoration_top}
      <span class="bubble-decor-top" style={decorTopStyle}
        >{style.bubble.decoration_top.content}</span
      >
    {/if}

    <!-- 气泡装饰 - 底部 -->
    {#if style?.bubble.decoration_bottom}
      <span class="bubble-decor-bottom" style={decorBottomStyle}
        >{style.bubble.decoration_bottom.content}</span
      >
    {/if}

    <!-- 气泡尾巴 -->
    <div class="bubble-tail"></div>

    <!-- 文本内容 -->
    <div class="bubble-content">
      {#if text}
        <TypewriterText
          {text}
          speed={typeSpeed}
          on:complete={handleTextComplete}
        />
      {:else}
        <!-- 没有文本时直接显示分支 -->
        {#if branches.length > 0}
          <BranchOptions
            {branches}
            {selectedBranch}
            on:select={handleBranchSelect}
          />
        {/if}
      {/if}
    </div>

    <!-- 分支选项 -->
    {#if text && showBranches && branches.length > 0}
      <BranchOptions
        {branches}
        {selectedBranch}
        on:select={handleBranchSelect}
      />
    {/if}
  </div>
</div>

<style>
  .bubble-wrapper {
    position: relative;
    transform-origin: bottom center;
    z-index: 100;
    pointer-events: auto;
  }

  .position-top,
  .position-left,
  .position-right {
    display: block;
  }

  .bubble {
    position: relative;
  }

  .bubble-decor-top,
  .bubble-decor-bottom {
    position: absolute;
    pointer-events: none;
  }

  .bubble-tail {
    position: absolute;
    width: 0;
    height: 0;
  }

  .position-top .bubble-tail {
    bottom: calc(var(--tail-size) * -1);
    left: 50%;
    transform: translateX(-50%);
    border-left: var(--tail-size) solid transparent;
    border-right: var(--tail-size) solid transparent;
    border-top: var(--tail-size) solid var(--tail-color);
    filter: drop-shadow(var(--tail-shadow));
  }

  .position-left .bubble-tail {
    right: calc(var(--tail-size) * -1);
    top: 50%;
    transform: translateY(-50%);
    border-top: var(--tail-size) solid transparent;
    border-bottom: var(--tail-size) solid transparent;
    border-left: var(--tail-size) solid var(--tail-color);
  }

  .position-right .bubble-tail {
    left: calc(var(--tail-size) * -1);
    top: 50%;
    transform: translateY(-50%);
    border-top: var(--tail-size) solid transparent;
    border-bottom: var(--tail-size) solid transparent;
    border-right: var(--tail-size) solid var(--tail-color);
  }

  .bubble-content {
    word-wrap: break-word;
    word-break: break-word;
    position: relative;
    z-index: 1;
  }
</style>
