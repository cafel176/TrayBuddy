/**
 * AI 工具配置管理模块
 * 
 * 负责从后端加载 mod 目录下的 ai_tools.json 配置，
 * 并提供给前端组件使用。
 */

import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import type { AiToolsConfig } from '$lib/types/asset';

// ========================================================================= //
// 默认配置
// ========================================================================= //

export const defaultAiToolsConfig: AiToolsConfig = {
  ai_tools: []
};

// ========================================================================= //
// Store
// ========================================================================= //

/** 当前 AI 工具配置 */
export const aiToolsConfig = writable<AiToolsConfig>(defaultAiToolsConfig);

/** 配置是否已加载 */
export const aiToolsLoaded = writable<boolean>(false);

// ========================================================================= //
// 加载函数
// ========================================================================= //

/**
 * 从后端加载 AI 工具配置
 */
export async function loadAiTools(): Promise<void> {
  try {
    const config = await invoke<AiToolsConfig | null>('get_ai_tools');
    if (config && config.ai_tools) {
      aiToolsConfig.set(config);
    } else {
      aiToolsConfig.set(defaultAiToolsConfig);
    }
    aiToolsLoaded.set(true);
  } catch (e) {
    console.error('[aiTools] Failed to load AI tools config:', e);
    aiToolsConfig.set(defaultAiToolsConfig);
    aiToolsLoaded.set(true);
  }
}

/**
 * 获取当前 AI 工具配置
 */
export function getCurrentAiTools(): AiToolsConfig {
  return get(aiToolsConfig);
}
