/**
 * Bubble System - 对话气泡系统
 * 
 * 导出所有公共组件和类型
 */

export { default as BubbleManager } from './BubbleManager.svelte';
export { default as Bubble } from './Bubble.svelte';
export { default as TypewriterText } from './TypewriterText.svelte';
export { default as BranchOptions } from './BranchOptions.svelte';

export type { BubbleConfig, BranchInfo } from './BubbleManager.svelte';
export { parseMarkdown, calculateDisplayDuration } from './markdown';
