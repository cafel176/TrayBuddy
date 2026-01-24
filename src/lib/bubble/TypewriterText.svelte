<!--
=========================================================================
打字机文本效果组件 (TypewriterText.svelte)
=========================================================================

功能概述:
- 逐字显示文本内容，模拟打字机效果
- 支持简易 Markdown 解析
- 支持自定义打字速度
- 支持点击跳过动画直接显示完整内容

使用示例:
<TypewriterText 
  text="**你好！** 这是一段测试文本。" 
  speed={50} 
  on:complete={handleComplete} 
/>
=========================================================================
-->

<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { parseMarkdown } from './markdown';

  // ======================================================================= //
  // Props
  // ======================================================================= //

  /** 要显示的文本内容（支持简易 Markdown） */
  export let text: string = '';
  
  /** 每个字符的显示间隔（毫秒），默认 50ms */
  export let speed: number = 50;
  
  /** 是否立即显示全部内容（跳过动画） */
  export let instant: boolean = false;

  // ======================================================================= //
  // 常量（从后端加载，带默认值）
  // ======================================================================= //

  /** 单行最大字符数，超过此值且未遇到换行符时自动换行 */
  let MAX_CHARS_PER_LINE = 20;
  
  /** 常量加载版本号，用于触发响应式重新计算 */
  let constsVersion = 0;

  // ======================================================================= //
  // 状态
  // ======================================================================= //

  /** 当前显示的字符索引 */
  let currentIndex = 0;
  
  /** 当前显示的文本 */
  let displayedText = '';
  
  /** 是否已完成显示 */
  let isComplete = false;
  
  /** 定时器 ID */
  let timerId: ReturnType<typeof setInterval> | null = null;
  
  /** 上次处理的文本（用于检测变化） */
  let lastText = '';

  // ======================================================================= //
  // 事件
  // ======================================================================= //

  const dispatch = createEventDispatcher<{
    /** 文本显示完成 */
    complete: void;
    /** 正在显示中 */
    typing: { current: number; total: number };
  }>();

  // ======================================================================= //
  // 生命周期
  // ======================================================================= //

  onMount(async () => {
    // 从后端加载常量
    try {
      const consts = await invoke<Record<string, number>>('get_const_int');
      if (consts.max_chars_per_line) {
        MAX_CHARS_PER_LINE = consts.max_chars_per_line;
        constsVersion++;  // 触发响应式重新计算
      }
    } catch (e) {
      console.error('[TypewriterText] Failed to load constants:', e);
    }
    
    // 初始化时设置 lastText 为当前 text，触发响应式语句
    lastText = '';  // 确保响应式语句会在首次运行
  });

  onDestroy(() => {
    stopTyping();
  });

  // ======================================================================= //
  // 方法
  // ======================================================================= //

  /**
   * 处理文本自动换行
   * 当单行字符数超过 MAX_CHARS_PER_LINE 且未遇到换行符时自动插入换行
   */
  function autoWrapText(input: string): string {
    if (!input || MAX_CHARS_PER_LINE <= 0) return input;
    
    const lines = input.split('\n');
    const wrappedLines = lines.map(line => {
      if (line.length <= MAX_CHARS_PER_LINE) return line;
      
      // 对超长行进行分割
      const chunks: string[] = [];
      let remaining = line;
      while (remaining.length > MAX_CHARS_PER_LINE) {
        chunks.push(remaining.slice(0, MAX_CHARS_PER_LINE));
        remaining = remaining.slice(MAX_CHARS_PER_LINE);
      }
      if (remaining) chunks.push(remaining);
      return chunks.join('\n');
    });
    
    return wrappedLines.join('\n');
  }

  /** 处理后的文本（自动换行），constsVersion 用于在常量加载后触发重新计算 */
  $: processedText = (() => {
    void constsVersion;  // 依赖常量版本号
    return autoWrapText(text);
  })();

  /**
   * 开始打字效果
   */
  function startTyping() {
    currentIndex = 0;
    displayedText = '';
    isComplete = false;

    timerId = setInterval(() => {
      if (currentIndex < processedText.length) {
        displayedText = processedText.slice(0, currentIndex + 1);
        currentIndex++;
        dispatch('typing', { current: currentIndex, total: processedText.length });
      } else {
        stopTyping();
        isComplete = true;
        dispatch('complete');
      }
    }, speed);
  }

  /**
   * 停止打字效果
   */
  function stopTyping() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  /**
   * 显示全部内容
   */
  function showAll() {
    stopTyping();
    displayedText = processedText;
    currentIndex = processedText.length;
    isComplete = true;
    dispatch('complete');
  }

  /**
   * 点击跳过动画
   */
  function handleClick() {
    if (!isComplete) {
      showAll();
    }
  }

  // ======================================================================= //
  // 响应式
  // ======================================================================= //

  // 当 text 改变时重新开始（仅当文本实际改变时）
  $: if (text !== lastText) {
    lastText = text;
    stopTyping();
    if (!text || instant) {
      showAll();
    } else {
      startTyping();
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<span 
  class="typewriter-text"
  class:complete={isComplete}
  on:click={handleClick}
>
  {@html parseMarkdown(displayedText)}
  {#if !isComplete}
    <span class="cursor">|</span>
  {/if}
</span>

<style>
  .typewriter-text {
    display: inline-block;
    cursor: pointer;
    user-select: none;
    white-space: pre-wrap;
  }

  .typewriter-text :global(strong) {
    font-weight: bold;
  }

  .typewriter-text :global(a) {
    color: #4a9eff;
    text-decoration: underline;
  }

  .cursor {
    animation: blink 0.7s infinite;
    font-weight: normal;
  }

  @keyframes blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
  }
</style>
