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

/** 装饰元素样式 */
export interface DecorationStyle {
  content: string;
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
  font_size: string;
  color: string;
  letter_spacing?: string;
  color_hover?: string;
  content_hover?: string;
  font_size_hover?: string;
}

/** 气泡尾巴样式 */
export interface TailStyle {
  size: string;
  color: string;
  shadow: string;
}

/** 气泡主体样式 */
export interface BubbleStyle {
  background: string;
  border: string;
  border_radius: string;
  padding: string;
  min_width: string;
  max_width: string;
  color: string;
  font_size: string;
  line_height: string;
  font_family: string;
  box_shadow: string;
  backdrop_filter: string;
  decoration_top?: DecorationStyle;
  decoration_bottom?: DecorationStyle;
  tail: TailStyle;
}

/** 分支容器样式 */
export interface BranchContainerStyle {
  gap: string;
  margin_top: string;
  padding_top: string;
  border_top: string;
}

/** 分支按钮样式 */
export interface BranchButtonStyle {
  padding: string;
  background: string;
  border: string;
  border_radius: string;
  color: string;
  font_size: string;
  box_shadow: string;
  backdrop_filter: string;
}

/** 分支按钮悬停样式 */
export interface BranchButtonHoverStyle {
  background: string;
  border_color: string;
  box_shadow: string;
  color: string;
  transform: string;
}

/** 分支按钮激活样式 */
export interface BranchButtonActiveStyle {
  background: string;
  box_shadow: string;
  transform: string;
}

/** 分支样式 */
export interface BranchStyle {
  container: BranchContainerStyle;
  button: BranchButtonStyle;
  button_hover: BranchButtonHoverStyle;
  button_active: BranchButtonActiveStyle;
  decoration_left: DecorationStyle;
  decoration_right: DecorationStyle;
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
    background: 'linear-gradient(145deg, rgba(255, 255, 255, 0.75) 0%, rgba(255, 245, 248, 0.72) 30%, rgba(255, 235, 242, 0.70) 70%, rgba(255, 225, 235, 0.68) 100%)',
    border: '1.5px solid rgba(255, 182, 193, 0.4)',
    border_radius: '16px',
    padding: '10px 14px',
    min_width: '120px',
    max_width: '380px',
    color: '#4a4a4a',
    font_size: '14px',
    line_height: '1.5',
    font_family: '"Microsoft YaHei", "PingFang SC", sans-serif',
    box_shadow: '0 3px 12px rgba(255, 182, 193, 0.18), 0 1px 4px rgba(0, 0, 0, 0.03), inset 0 1px 0 rgba(255, 255, 255, 0.6)',
    backdrop_filter: 'blur(12px)',
    decoration_top: {
      content: '✿ ❀ ✿',
      top: '4px',
      right: '6px',
      font_size: '9px',
      color: 'rgba(255, 150, 180, 0.35)',
      letter_spacing: '3px'
    },
    decoration_bottom: {
      content: '๑',
      bottom: '4px',
      left: '8px',
      font_size: '11px',
      color: 'rgba(255, 160, 190, 0.28)'
    },
    tail: {
      size: '10px',
      color: 'rgba(255, 225, 235, 0.70)',
      shadow: '0 2px 2px rgba(255, 182, 193, 0.2)'
    }
  },
  branch: {
    container: {
      gap: '5px',
      margin_top: '8px',
      padding_top: '8px',
      border_top: '1px dashed rgba(255, 180, 200, 0.35)'
    },
    button: {
      padding: '6px 12px 6px 26px',
      background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.72) 0%, rgba(255, 242, 248, 0.68) 100%)',
      border: '1px solid rgba(255, 185, 200, 0.35)',
      border_radius: '10px',
      color: '#5a5a5a',
      font_size: '13px',
      box_shadow: '0 1px 4px rgba(255, 182, 193, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.5)',
      backdrop_filter: 'blur(8px)'
    },
    button_hover: {
      background: 'linear-gradient(135deg, rgba(255, 235, 245, 0.85) 0%, rgba(255, 210, 230, 0.80) 100%)',
      border_color: 'rgba(255, 150, 180, 0.5)',
      box_shadow: '0 4px 14px rgba(255, 182, 193, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.6)',
      color: '#d85a8a',
      transform: 'translateY(-2px)'
    },
    button_active: {
      background: 'linear-gradient(135deg, rgba(255, 225, 240, 0.85) 0%, rgba(255, 200, 225, 0.80) 100%)',
      box_shadow: '0 2px 6px rgba(255, 182, 193, 0.18), inset 0 1px 3px rgba(255, 180, 200, 0.15)',
      transform: 'translateY(0)'
    },
    decoration_left: {
      content: '✿',
      left: '8px',
      font_size: '11px',
      color: 'rgba(255, 150, 180, 0.4)',
      color_hover: 'rgba(255, 100, 150, 0.7)'
    },
    decoration_right: {
      content: '·',
      content_hover: '❀',
      right: '8px',
      font_size: '16px',
      font_size_hover: '11px',
      color: 'rgba(255, 170, 195, 0.28)',
      color_hover: 'rgba(255, 130, 170, 0.55)'
    }
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
