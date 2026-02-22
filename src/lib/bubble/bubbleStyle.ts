/**
 * 气泡样式管理模块
 * 
 * 负责从后端加载 mod 目录下的 bubble_style.json 配置，
 * 并提供给 Bubble 和 BranchOptions 组件使用。
 */

import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

// ========================================================================= //
// 类型定义
// ========================================================================= //

/** 装饰图层样式（文字/图标等） */
export interface DecorationStyle {
  content: string;
  [key: string]: any;
}

/** 气泡尾巴样式 */
export interface TailStyle {
  [key: string]: any;
}

/** 气泡主体样式 */
export interface BubbleStyle {
  decoration_top?: DecorationStyle;
  decoration_bottom?: DecorationStyle;
  tail: TailStyle;
  [key: string]: any;
}

/** 分支容器样式 */
export interface BranchContainerStyle {
  [key: string]: any;
}

/** 分支按钮样式 */
export interface BranchButtonStyle {
  [key: string]: any;
}

/** 分支按钮 hover 样式 */
export interface BranchButtonHoverStyle {
  [key: string]: any;
}

/** 分支按钮 active 样式 */
export interface BranchButtonActiveStyle {
  [key: string]: any;
}


/** 分支样式 */
export interface BranchStyle {
  container: BranchContainerStyle;
  button: BranchButtonStyle;
  button_hover: BranchButtonHoverStyle;
  button_active: BranchButtonActiveStyle;
  decoration_left: DecorationStyle;
  decoration_right: DecorationStyle;
  [key: string]: any;
}

/** 完整气泡样式配置 */
export interface BubbleStyleConfig {
  bubble: BubbleStyle;
  branch: BranchStyle;
}

// ========================================================================= //
// 默认样式
// ========================================================================= //

export const defaultStyle: BubbleStyleConfig = {
  bubble: {
    tail: {
      size: '10px',
      color: 'transparent'
    }
  },
  branch: {
    container: { gap: '5px' },
    button: {},
    button_hover: {},
    button_active: {},
    decoration_left: { content: '' },
    decoration_right: { content: '' }
  }
};

// ========================================================================= //
// 样式存储
// ========================================================================= //

/** 当前气泡样式 */
export const bubbleStyle = writable<BubbleStyleConfig>(defaultStyle);

/** 样式是否已加载 */
export const styleLoaded = writable<boolean>(false);

// ========================================================================= //
// 加载函数
// ========================================================================= //

/**
 * 从后端加载气泡样式
 */
export async function loadBubbleStyle(): Promise<void> {
  try {
    const style = await invoke<BubbleStyleConfig | null>('get_bubble_style');
    if (style) {
      // 深度合并，确保缺失的字段使用默认值
      const merged = deepMerge(defaultStyle, style);
      bubbleStyle.set(merged);
    } else {
      bubbleStyle.set(defaultStyle);
    }
    styleLoaded.set(true);
  } catch (e) {
    console.error('[bubbleStyle] Failed to load bubble style:', e);
    bubbleStyle.set(defaultStyle);
    styleLoaded.set(true);
  }
}

/**
 * 获取当前样式
 */
export function getCurrentStyle(): BubbleStyleConfig {
  return get(bubbleStyle);
}

// ========================================================================= //
// 工具函数
// ========================================================================= //

/**
 * 深度合并对象
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof target[key] === 'object' &&
        target[key] !== null
      ) {
        result[key] = deepMerge(target[key], source[key] as any);
      } else {
        result[key] = source[key] as any;
      }
    }
  }

  return result;
}

/**
 * 将对象转换为 CSS 样式字符串
 * 自动将 snake_case 转换为 kebab-case
 */
export function toStyleString(obj: Record<string, any> | undefined | null): string {
  if (!obj) return '';

  return Object.entries(obj)
    .filter(([key, value]) =>
      typeof value !== 'object' &&
      value !== undefined &&
      value !== null &&
      key !== 'content' &&
      key !== 'content_hover' &&
      !key.includes('_hover') &&
      !key.includes('_active')
    )
    .map(([key, value]) => {
      const cssKey = key.replace(/_/g, '-');
      // 处理内容相关的特殊情况
      if (cssKey === 'font-family' && typeof value === 'string' && !value.startsWith('"')) {
        return `${cssKey}: ${value};`;
      }
      return `${cssKey}: ${value};`;
    })
    .join(' ');
}

/**
 * 将对象转换为 CSS 变量字符串
 */
export function toCssVars(obj: Record<string, any> | undefined | null, prefix: string): string {
  if (!obj) return '';

  return Object.entries(obj)
    .filter(([key, value]) =>
      typeof value !== 'object' &&
      value !== undefined &&
      value !== null
    )
    .map(([key, value]) => {
      // 约定：保留 hover/active 后缀，用于在 CSS 中区分不同状态
      // 例如：color_hover -> --decor-left-color-hover
      const cleanKey = key
        .replace(/_hover$/g, '-hover')
        .replace(/_active$/g, '-active')
        .replace(/_/g, '-');
      return `--${prefix}-${cleanKey}: ${value};`;
    })
    .join(' ');
}
