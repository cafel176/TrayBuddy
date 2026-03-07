<!--
=========================================================================
气泡管理器组件 (BubbleManager.svelte)
=========================================================================

功能概述:
- 管理气泡的显示/隐藏
- 提供 show/hide API
- 处理分支选择事件

使用示例:
<script>
  let bubbleManager: BubbleManager;
  
  bubbleManager.show({
    text: "你好！",
    branches: [{ text: "OK", next_state: "next" }]
  });
</script>

<BubbleManager 
  bind:this={bubbleManager} 
  on:branchSelect={handleBranchSelect}
/>
=========================================================================
-->

<script lang="ts" context="module">
  import type { BranchInfo } from '$lib/types/asset';
  
  /** 气泡配置 */
  export interface BubbleConfig {
    /** 文本内容（支持简易 Markdown） */
    text: string;
    /** 分支选项 */
    branches?: BranchInfo[];
    /** 自动消失时间（毫秒），0 表示根据文本长度自动计算 */
    duration?: number;
    /** 气泡位置 */
    position?: 'top' | 'left' | 'right';
    /** 打字速度（毫秒/字符） */
    typeSpeed?: number;
  }
  
  // 重新导出 BranchInfo 保持向后兼容
  export type { BranchInfo } from '$lib/types/asset';
</script>

<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import Bubble from './Bubble.svelte';
  import { loadBubbleStyle } from './bubbleStyle';
  import { loadAiTools } from '$lib/aiTools';
  import { BUBBLE_SWITCH_DELAY_MS } from '$lib/constants';

  // ======================================================================= //
  // 状态
  // ======================================================================= //

  /** 当前显示的气泡配置 */
  let currentConfig: BubbleConfig | null = null;
  
  /** 是否显示气泡 */
  let isVisible = false;
  
  /** 样式是否已加载 */
  let styleReady = false;

  // ======================================================================= //
  // 事件
  // ======================================================================= //

  const dispatch = createEventDispatcher<{
    /** 选择了分支 */
    branchSelect: BranchInfo;
    /** 气泡关闭 */
    close: void;
    /** 气泡显示 */
    show: BubbleConfig;
  }>();

  // ======================================================================= //
  // 生命周期
  // ======================================================================= //

  onMount(async () => {
    // 加载气泡样式
    await loadBubbleStyle();
    // 加载 AI 工具配置
    await loadAiTools();
    styleReady = true;
  });

  // ======================================================================= //
  // 公共 API
  // ======================================================================= //

  /**
   * 显示气泡
   * @param config 气泡配置
   */
  export function show(config: BubbleConfig): void {
    // 如果有正在显示的气泡，先关闭
    if (isVisible) {
      hide();
      // 短暂延迟后显示新气泡
      setTimeout(() => {
        currentConfig = config;
        isVisible = true;
        dispatch('show', config);
      }, BUBBLE_SWITCH_DELAY_MS);
    } else {
      currentConfig = config;
      isVisible = true;
      dispatch('show', config);
    }
  }

  /**
   * 隐藏气泡
   */
  export function hide(): void {
    isVisible = false;
    currentConfig = null;
  }

  /**
   * 检查气泡是否显示中
   */
  export function isShowing(): boolean {
    return isVisible;
  }

  // ======================================================================= //
  // 事件处理
  // ======================================================================= //

  /**
   * 处理分支选择
   */
  function handleBranchSelect(e: CustomEvent<BranchInfo>) {
    dispatch('branchSelect', e.detail);
  }

  /**
   * 处理气泡关闭
   */
  function handleClose() {
    isVisible = false;
    currentConfig = null;
    dispatch('close');
  }
</script>

{#if styleReady && isVisible && currentConfig}
  <Bubble
    text={currentConfig.text}
    branches={currentConfig.branches || []}
    duration={currentConfig.duration || 0}
    position={currentConfig.position || 'top'}
    typeSpeed={currentConfig.typeSpeed || 50}
    on:branchSelect={handleBranchSelect}
    on:close={handleClose}
  />
{/if}
