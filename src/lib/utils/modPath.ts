/**
 * Mod 路径缓存模块
 *
 * 提供当前加载的 Mod 根目录路径获取功能。
 * 使用缓存避免重复调用后端 IPC。
 *
 * ## 缓存策略
 * - 首次调用时从后端获取路径
 * - 后续调用直接返回缓存
 * - Mod 切换时需手动调用 `clearModPathCache()` 清除缓存
 *
 * ## 使用示例
 * ```typescript
 * const modPath = await getModPath();
 * // modPath = "D:/TrayBuddy/mods/ema"
 *
 * // Mod 切换后
 * clearModPathCache();
 * ```
 */

import { invoke } from "@tauri-apps/api/core";

/** 缓存的 Mod 路径 */
let cachedModPath: string | null = null;

/**
 * 获取当前 Mod 的根目录路径
 *
 * 路径用于构建资源文件的完整 URL：
 * - 动画图片: `${modPath}/asset/${img}`
 * - 音频文件: `${modPath}/audio/${lang}/${audio}`
 *
 * @returns Mod 根目录路径，未加载 Mod 时返回 null
 */
export async function getModPath(): Promise<string | null> {
  if (cachedModPath === null) {
    cachedModPath = await invoke("get_mod_path");
  }
  return cachedModPath;
}

/**
 * 清除 Mod 路径缓存
 *
 * 在以下情况调用：
 * - 切换到不同的 Mod
 * - 卸载当前 Mod
 */
export function clearModPathCache(): void {
  cachedModPath = null;
}
