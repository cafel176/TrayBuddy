/**
 * Mod 资源 URL 统一构建模块
 *
 * 根据当前 Mod 的来源（文件夹 / .tbuddy archive）自动选择正确的 URL 方案：
 * - 文件夹 Mod：使用 Tauri 内建的 `convertFileSrc()` → `https://asset.localhost/...`
 * - Archive Mod：使用自定义协议 `tbuddy-asset://` 的平台适配 URL
 *   - Windows: `http://tbuddy-asset.localhost/{mod_id}/{path}`
 *   - macOS/Linux: `tbuddy-asset://localhost/{mod_id}/{path}`
 *
 * ## 使用示例
 * ```typescript
 * const url = buildModAssetUrl(modPath, "asset/idle.webp");
 * // 文件夹 mod → "https://asset.localhost/D%3A/mods/ema/asset/idle.webp"
 * // Archive mod (Windows) → "http://tbuddy-asset.localhost/ema/asset/idle.webp"
 * ```
 */

import { convertFileSrc } from "@tauri-apps/api/core";

/** archive mod path 的前缀标记（与 Rust 端 `read_mod_from_archive` 一致） */
const ARCHIVE_PREFIX = "tbuddy-archive://";

/**
 * 检测当前平台的自定义协议 URL 前缀格式。
 *
 * Tauri 在不同平台上对自定义协议的 URL 格式不同：
 * - Windows: `http://{scheme}.localhost/`
 * - macOS/Linux: `{scheme}://localhost/`
 *
 * 利用 `convertFileSrc` 做一次探测来确定当前平台格式。
 */
function detectArchiveUrlPrefix(): string {
  // 用 convertFileSrc 生成一个 asset URL，从中推断平台格式
  const probe = convertFileSrc("__probe__", "tbuddy-asset");
  // 结果形如:
  //   Windows: "http://tbuddy-asset.localhost/__probe__"  或  "https://tbuddy-asset.localhost/__probe__"
  //   macOS:   "tbuddy-asset://localhost/__probe__"
  const idx = probe.indexOf("__probe__");
  if (idx > 0) {
    return probe.slice(0, idx);
  }
  // fallback: 不太可能走到这里
  return "http://tbuddy-asset.localhost/";
}

/** 缓存探测结果，避免重复调用 */
let _archiveUrlPrefix: string | null = null;
function getArchiveUrlPrefix(): string {
  if (_archiveUrlPrefix === null) {
    _archiveUrlPrefix = detectArchiveUrlPrefix();
  }
  return _archiveUrlPrefix;
}

/**
 * 判断 modPath 是否来自 .tbuddy archive
 */
export function isArchiveMod(modPath: string): boolean {
  return modPath.startsWith(ARCHIVE_PREFIX);
}

/**
 * 从 archive mod path 中提取 mod_id
 *
 * @param modPath - 形如 "tbuddy-archive://ema" 的虚拟路径
 * @returns mod_id，如 "ema"
 */
export function getArchiveModId(modPath: string): string {
  return modPath.slice(ARCHIVE_PREFIX.length);
}

/**
 * 判断一个 URL 是否为 archive mod 的资源 URL（平台无关判断）
 */
export function isArchiveAssetUrl(url: string): boolean {
  return url.includes("tbuddy-asset");
}

/**
 * 将 archive mod 资源 URL 反解为 `tbuddy-archive://mod_id/path` 虚拟路径
 * （用于 `path_exists` 预检等后端操作）
 */
export function archiveAssetUrlToVirtualPath(url: string): string | null {
  const prefix = getArchiveUrlPrefix();
  if (url.startsWith(prefix)) {
    const rest = url.slice(prefix.length);
    return `tbuddy-archive://${rest}`;
  }
  return null;
}

/**
 * 构建 Mod 资源的可访问 URL
 *
 * @param modPath - Mod 根路径（来自 `getModPath()`）
 * @param relativePath - 相对于 Mod 根目录的路径，如 "asset/idle.webp"
 * @returns 可在 WebView 中使用的 URL
 */
export function buildModAssetUrl(modPath: string, relativePath: string): string {
  if (isArchiveMod(modPath)) {
    const modId = getArchiveModId(modPath);
    const cleanPath = relativePath.replace(/\\/g, "/").replace(/^\//, "");
    return `${getArchiveUrlPrefix()}${modId}/${cleanPath}`;
  }

  // 文件夹 mod：使用 Tauri 内建的 asset 协议
  const fullPath = `${modPath}/${relativePath}`.replace(/\\/g, "/");
  return convertFileSrc(fullPath);
}

/**
 * 构建 Mod 资源的可访问 URL（Live2D 专用）
 *
 * 与 `buildModAssetUrl` 的区别：对于文件夹 mod，会还原 `%2F` 和 `%3A`，
 * 保持 URL 层级结构，使 pixi-live2d-display 的相对路径解析正确工作。
 *
 * @param modPath - Mod 根路径
 * @param relativePath - 相对路径
 * @returns 可在 WebView 中使用的 URL（保留路径层级）
 */
export function buildModAssetUrlForLive2D(modPath: string, relativePath: string): string {
  if (isArchiveMod(modPath)) {
    // archive mod 的 URL 天然是正确的层级结构
    return buildModAssetUrl(modPath, relativePath);
  }

  // 文件夹 mod：convertFileSrc + 还原编码
  const fullPath = `${modPath}/${relativePath}`.replace(/\\/g, "/");
  const raw = convertFileSrc(fullPath);
  return raw.replace(/%2F/gi, "/").replace(/%3A/gi, ":");
}

/**
 * 构建 Mod 资源的可访问 URL（3D 专用）
 *
 * 与 `buildModAssetUrlForLive2D` 相同策略：对于文件夹 mod，还原 `%2F` 和 `%3A`，
 * 保持 URL 层级结构，使 three.js 的 GLTFLoader 相对路径解析正确工作。
 *
 * @param modPath - Mod 根路径
 * @param relativePath - 相对路径
 * @returns 可在 WebView 中使用的 URL（保留路径层级）
 */
export function buildModAssetUrlFor3D(modPath: string, relativePath: string): string {
  if (isArchiveMod(modPath)) {
    return buildModAssetUrl(modPath, relativePath);
  }

  // 文件夹 mod：convertFileSrc + 还原编码
  const fullPath = `${modPath}/${relativePath}`.replace(/\\/g, "/");
  const raw = convertFileSrc(fullPath);
  return raw.replace(/%2F/gi, "/").replace(/%3A/gi, ":");
}
