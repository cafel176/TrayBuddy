<!--
=========================================================================
分支选项组件 (BranchOptions.svelte)
=========================================================================

功能概述:
- 显示对话分支选项按钮
- 支持键盘导航（上下键选择，回车确认）
- 点击后触发选择事件
- 支持从 mod 加载自定义样式
- 自适应排布：短文本按钮可以在同一行显示

使用示例:
<BranchOptions 
  branches={[
    { text: "选项 A", next_state: "state_a" },
    { text: "选项 B", next_state: "state_b" }
  ]} 
  on:select={handleSelect} 
/>
=========================================================================
-->

<script lang="ts" context="module">
  /** 分支信息 */
  export interface BranchInfo {
    /** 选项按钮显示的文本 */
    text: string;
    /** 点击后跳转到的状态名称 */
    next_state: string;
  }
</script>

<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { bubbleStyle, type BubbleStyleConfig } from './bubbleStyle';

  // ======================================================================= //
  // Props
  // ======================================================================= //

  /** 分支选项列表 */
  export let branches: BranchInfo[] = [];
  
  /** 是否显示选项（用于延迟显示） */
  export let visible: boolean = true;

  /** 已选中的分支（选中后只显示该分支且禁用） */
  export let selectedBranch: BranchInfo | null = null;

  /** 是否禁用所有按钮 */
  export let disabled: boolean = false;

  // ======================================================================= //
  // 常量（从后端加载，带默认值）
  // ======================================================================= //

  /** 按钮文本长度阈值（字符数），短于此值的按钮可以并排显示 */
  let SHORT_TEXT_THRESHOLD = 6;
  
  /** 单行最大按钮数量 */
  let MAX_BUTTONS_PER_ROW = 3;
  
  /** 按钮文本最大字符数，超过此值自动换行 */
  let MAX_CHARS_PER_BUTTON = 8;
  
  /** 常量加载版本号，用于触发响应式重新计算 */
  let constsVersion = 0;

  // ======================================================================= //
  // 状态
  // ======================================================================= //

  /** 当前高亮的选项索引 */
  let focusedIndex = 0;

  /** 组件容器引用 */
  let containerRef: HTMLDivElement;

  /** 当前样式 */
  let style: BubbleStyleConfig;
  $: style = $bubbleStyle;

  // ======================================================================= //
  // 事件
  // ======================================================================= //

  const dispatch = createEventDispatcher<{
    /** 选择了某个分支 */
    select: BranchInfo;
  }>();

  // ======================================================================= //
  // 方法
  // ======================================================================= //

  /**
   * 处理按钮文本自动换行
   * 当字符数超过 MAX_CHARS_PER_BUTTON 时自动插入换行
   */
  function wrapButtonText(input: string): string {
    if (!input || MAX_CHARS_PER_BUTTON <= 0 || input.length <= MAX_CHARS_PER_BUTTON) {
      return input;
    }
    
    const chunks: string[] = [];
    let remaining = input;
    while (remaining.length > MAX_CHARS_PER_BUTTON) {
      chunks.push(remaining.slice(0, MAX_CHARS_PER_BUTTON));
      remaining = remaining.slice(MAX_CHARS_PER_BUTTON);
    }
    if (remaining) chunks.push(remaining);
    return chunks.join('\n');
  }

  /**
   * 选择分支
   */
  function selectBranch(branch: BranchInfo) {
    if (disabled || selectedBranch) return;
    dispatch('select', branch);
  }

  /**
   * 键盘事件处理
   */
  function handleKeydown(e: KeyboardEvent) {
    if (!visible || branches.length === 0 || disabled || selectedBranch) return;

    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault();
        focusedIndex = (focusedIndex - 1 + branches.length) % branches.length;
        break;
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault();
        focusedIndex = (focusedIndex + 1) % branches.length;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        selectBranch(branches[focusedIndex]);
        break;
    }
  }

  // ======================================================================= //
  // 计算属性
  // ======================================================================= //

  /** 要显示的分支（如果有选中则只显示选中的） */
  $: displayBranches = selectedBranch ? [selectedBranch] : branches;

  /**
   * 处理后的分支文本（自动换行）
   * constsVersion 用于在常量加载后触发重新计算
   */
  $: wrappedBranches = (() => {
    void constsVersion;  // 依赖常量版本号
    return displayBranches.map(b => ({
      ...b,
      wrappedText: wrapButtonText(b.text)
    }));
  })();

  /**
   * 判断是否所有按钮的文本都足够短，可以使用行内布局
   * constsVersion 用于在常量加载后触发重新计算
   */
  $: useInlineLayout = (() => {
    void constsVersion;  // 依赖常量版本号
    if (displayBranches.length <= 1) return false;
    if (displayBranches.length > MAX_BUTTONS_PER_ROW) return false;
    return displayBranches.every(b => b.text.length <= SHORT_TEXT_THRESHOLD);
  })();

  // ======================================================================= //
  // 生命周期
  // ======================================================================= //

  onMount(async () => {
    // 从后端加载常量
    try {
      const consts = await invoke<Record<string, number>>('get_const_int');
      if (consts.short_text_threshold) SHORT_TEXT_THRESHOLD = consts.short_text_threshold;
      if (consts.max_buttons_per_row) MAX_BUTTONS_PER_ROW = consts.max_buttons_per_row;
      if (consts.max_chars_per_button) MAX_CHARS_PER_BUTTON = consts.max_chars_per_button;
      constsVersion++;  // 触发响应式重新计算
    } catch (e) {
      console.error('[BranchOptions] Failed to load constants:', e);
    }
    
    // 聚焦容器以接收键盘事件
    containerRef?.focus();
  });

  // ======================================================================= //
  // 动态样式计算
  // ======================================================================= //

  $: containerStyle = style ? `
    gap: ${style.branch.container.gap};
    margin-top: ${style.branch.container.margin_top};
    padding-top: ${style.branch.container.padding_top};
    border-top: ${style.branch.container.border_top};
  ` : '';

  $: buttonBaseStyle = style ? `
    padding: ${style.branch.button.padding};
    background: ${style.branch.button.background};
    border: ${style.branch.button.border};
    border-radius: ${style.branch.button.border_radius};
    color: ${style.branch.button.color};
    font-size: ${style.branch.button.font_size};
    box-shadow: ${style.branch.button.box_shadow};
    backdrop-filter: ${style.branch.button.backdrop_filter};
  ` : '';

  // CSS 变量用于 hover/active 状态
  $: cssVars = style ? `
    --btn-hover-bg: ${style.branch.button_hover.background};
    --btn-hover-border-color: ${style.branch.button_hover.border_color};
    --btn-hover-shadow: ${style.branch.button_hover.box_shadow};
    --btn-hover-color: ${style.branch.button_hover.color};
    --btn-hover-transform: ${style.branch.button_hover.transform};
    --btn-active-bg: ${style.branch.button_active.background};
    --btn-active-shadow: ${style.branch.button_active.box_shadow};
    --btn-active-transform: ${style.branch.button_active.transform};
    --decor-left-content: "${style.branch.decoration_left.content}";
    --decor-left-left: ${style.branch.decoration_left.left};
    --decor-left-font-size: ${style.branch.decoration_left.font_size};
    --decor-left-color: ${style.branch.decoration_left.color};
    --decor-left-color-hover: ${style.branch.decoration_left.color_hover};
    --decor-right-content: "${style.branch.decoration_right.content}";
    --decor-right-content-hover: "${style.branch.decoration_right.content_hover}";
    --decor-right-right: ${style.branch.decoration_right.right};
    --decor-right-font-size: ${style.branch.decoration_right.font_size};
    --decor-right-font-size-hover: ${style.branch.decoration_right.font_size_hover};
    --decor-right-color: ${style.branch.decoration_right.color};
    --decor-right-color-hover: ${style.branch.decoration_right.color_hover};
  ` : '';
</script>

<svelte:window on:keydown={handleKeydown} />

{#if visible && branches.length > 0}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div 
    class="branch-options"
    class:inline-layout={useInlineLayout}
    style="{containerStyle} {cssVars}"
    bind:this={containerRef}
    tabindex="0"
    role="listbox"
    aria-label="对话选项"
  >
    {#each wrappedBranches as branch, index}
      <button
        class="branch-button"
        class:compact={useInlineLayout}
        class:focused={index === focusedIndex && !selectedBranch}
        class:selected={selectedBranch !== null}
        class:disabled={disabled || selectedBranch !== null}
        style={buttonBaseStyle}
        role="option"
        aria-selected={index === focusedIndex}
        aria-disabled={disabled || selectedBranch !== null}
        on:click={() => selectBranch(branch)}
        on:mouseenter={() => { if (!selectedBranch) focusedIndex = index; }}
      >
        <span class="decor-left">{style?.branch.decoration_left.content || '✿'}</span>
        <span class="btn-text">{branch.wrappedText}</span>
        <span class="decor-right">{style?.branch.decoration_right.content || '·'}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .branch-options {
    display: flex;
    flex-direction: column;
    outline: none;
  }

  /* 行内布局 - 按钮并排显示 */
  .branch-options.inline-layout {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
  }

  .branch-button {
    cursor: pointer;
    transition: all 0.25s ease;
    text-align: center;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* 紧凑模式 - 行内布局时的按钮样式 */
  .branch-button.compact {
    flex: 1;
    min-width: auto;
    padding-left: 18px !important;
    padding-right: 6px !important;
  }

  .btn-text {
    flex: 1;
    white-space: pre-wrap;
  }

  /* 紧凑模式下文本不伸展 */
  .branch-button.compact .btn-text {
    flex: none;
  }

  .decor-left {
    position: absolute;
    left: var(--decor-left-left, 8px);
    top: 50%;
    transform: translateY(-50%);
    font-size: var(--decor-left-font-size, 11px);
    color: var(--decor-left-color, rgba(255, 150, 180, 0.4));
    transition: all 0.25s ease;
  }

  .decor-right {
    position: absolute;
    right: var(--decor-right-right, 8px);
    top: 50%;
    transform: translateY(-50%);
    font-size: var(--decor-right-font-size, 16px);
    color: var(--decor-right-color, rgba(255, 170, 195, 0.28));
    transition: all 0.25s ease;
  }

  .branch-button:hover,
  .branch-button.focused {
    background: var(--btn-hover-bg) !important;
    border-color: var(--btn-hover-border-color) !important;
    transform: var(--btn-hover-transform);
    box-shadow: var(--btn-hover-shadow) !important;
    color: var(--btn-hover-color) !important;
  }

  .branch-button:hover .decor-left,
  .branch-button.focused .decor-left {
    color: var(--decor-left-color-hover, rgba(255, 100, 150, 0.7));
    transform: translateY(-50%) rotate(15deg) scale(1.15);
  }

  .branch-button:hover .decor-right,
  .branch-button.focused .decor-right {
    font-size: var(--decor-right-font-size-hover, 11px);
    color: var(--decor-right-color-hover, rgba(255, 130, 170, 0.55));
  }

  .branch-button:active {
    transform: var(--btn-active-transform) !important;
    box-shadow: var(--btn-active-shadow) !important;
    background: var(--btn-active-bg) !important;
  }

  /* 禁用状态 */
  .branch-button.disabled {
    cursor: default;
    opacity: 0.7;
    pointer-events: none;
  }

  /* 选中状态 - 保持高亮样式 */
  .branch-button.selected {
    background: var(--btn-hover-bg) !important;
    border-color: var(--btn-hover-border-color) !important;
    box-shadow: var(--btn-hover-shadow) !important;
    color: var(--btn-hover-color) !important;
  }

  .branch-button.selected .decor-left {
    color: var(--decor-left-color-hover, rgba(255, 100, 150, 0.7));
  }

  .branch-button.selected .decor-right {
    font-size: var(--decor-right-font-size-hover, 11px);
    color: var(--decor-right-color-hover, rgba(255, 130, 170, 0.55));
  }
</style>
