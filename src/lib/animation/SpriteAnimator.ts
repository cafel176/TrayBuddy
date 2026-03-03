/**
 * SpriteAnimator - 精灵动画播放器模块
 *
 * 该模块提供基于 Canvas 的序列帧动画播放功能，是桌面宠物显示的核心组件。
 *
 * ## 主要功能
 * - 序列帧动画播放（支持正向、反向、往返循环）
 * - 图片资源 LRU 缓存（减少重复加载）
 * - 按状态名/资产名加载动画
 * - 单次播放模式（playOnce）
 * - 动画切换时保持播放状态
 *
 * ## 使用示例
 * ```typescript
 * const animator = new SpriteAnimator(canvasElement);
 * await animator.loadByStateName("idle");
 * animator.play();
 * ```
 *
 * ## 性能优化
 * - 使用 LRUCache 缓存已加载的图片，避免重复网络请求
 * - 动画切换时复用 Canvas 上下文
 * - 使用 requestAnimationFrame 实现流畅动画
 */

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { LRUCache } from "../utils/LRUCache";
import { getModPath, clearModPathCache } from "../utils/modPath";
import { buildModAssetUrl } from "../utils/modAssetUrl";
import type { AssetInfo, AnimationConfig } from "../types/asset";
import {
  computeSpriteDownsampleTarget,
  isBorderImage,
  type SpriteTexturePolicy,
} from "./animation_utils";

// ============================================================================
// Canvas 显示适配（仅影响元素显示尺寸，不改变内部绘制逻辑）
// ============================================================================

/**
 * Canvas 适配偏好：
 * - long: 优先适配图片长边（类似 contain，不裁切）
 * - short: 优先适配图片短边（类似 cover，可能裁切）
 * - legacy: 旧版逻辑（仅按高度缩放，宽度随图片比例自适应）
 */
export type CanvasFitPreference = "long" | "short" | "legacy";

/** Canvas 适配参数（容器与缩放比例）。 */
export type CanvasFitOptions = {
  /** 默认取 canvas.parentElement */
  container?: HTMLElement | null;
  /** 适配容器的比例（默认 0.8，用于匹配旧的 character-canvas: height 80% 逻辑） */
  scale?: number;
};


// ============================================================================
// 常量定义
// ============================================================================

/** 图片 LRU 缓存最大容量 */
const IMAGE_CACHE_MAX_SIZE = 4;
/** 边框图片缓存最大容量（避免长期驻留过多资源） */
const ALWAYS_IMAGE_CACHE_MAX_SIZE = 4;

const MEMORY_DEBUG_MODE = false;

// ============================================================================
// 贴图降采样（与 Live2D/ThreeD 对齐）
// ============================================================================

// 降采样策略和计算函数已提取到 animation_utils.ts

const SPRITE_TEX_OPT_NO_RESIZE_EPS = 0.999;
const SPRITE_TEX_OPT_RESIZE_QUALITY: ImageSmoothingQuality = "high";

/**
 * 将精灵图降采样到较小的 Canvas 上。
 */
function downsampleSpriteSheet(
  src: HTMLImageElement, tw: number, th: number,
): HTMLCanvasElement | null {
  const sw = src.naturalWidth || src.width;
  const sh = src.naturalHeight || src.height;
  if (!sw || !sh) return null;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(tw));
  canvas.height = Math.max(1, Math.floor(th));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = SPRITE_TEX_OPT_RESIZE_QUALITY;
  try {
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
  return canvas;
}


// ============================================================================
// 内存诊断日志（用于追踪内存问题）
// 仅在内存检测工具启动时生效（通过环境变量 TRAYBUDDY_MEMORY_DEBUG=1 启用）
// ============================================================================

/** 调试模式状态（延迟检测，由 initMemoryDebug 初始化） */
let memoryDebugEnabled: boolean | null = null;

/**
 * 初始化内存调试模式
 * 检测是否由内存检测工具启动（通过 Tauri 后端查询环境变量）
 */
export async function initMemoryDebug(): Promise<boolean> {
  if (memoryDebugEnabled !== null) return memoryDebugEnabled;
  
  try {
    // 通过 Tauri 命令查询环境变量
    const debugFlag: string | null = await invoke("get_env_var", { name: "TRAYBUDDY_MEMORY_DEBUG" });
    memoryDebugEnabled = debugFlag === "1";
    
    if (memoryDebugEnabled) {
      console.log("[Memory Debug] 内存调试模式已启用（由检测工具启动）");
    }
  } catch {
    // 查询失败时默认禁用
    memoryDebugEnabled = false;
  }
  
  return memoryDebugEnabled;
}

/** 检查调试模式是否启用（同步检查，未初始化则返回 false） */
function isMemoryDebugEnabled(): boolean {
  return memoryDebugEnabled === true || MEMORY_DEBUG_MODE;
}

/** 诊断日志记录 */
interface MemoryLogEntry {
  timestamp: number;      // 启动后秒数
  event: string;          // 事件类型
  details: string;        // 详细信息
  cacheSize: number;      // 当前普通缓存大小
  alwaysCacheSize: number; // 当前边框缓存大小
  cacheHit?: boolean;     // 是否缓存命中
  imageSrc?: string;      // 图片 URL（简化）
}

/** 日志存储 */
const memoryLogs: MemoryLogEntry[] = [];
const startTime = Date.now();
const MAX_MEMORY_LOGS = 200; // 限制日志条数，防止长时间运行内存增长

/** 记录内存相关事件（仅调试模式下生效） */
function logMemoryEvent(event: string, details: string, extra?: Partial<MemoryLogEntry>): void {
  if (!isMemoryDebugEnabled()) return;

  const entry: MemoryLogEntry = {
    timestamp: Math.round((Date.now() - startTime) / 1000),
    event,
    details,
    cacheSize: imageCache.size,
    alwaysCacheSize: alwaysImageCache.size,
    ...extra
  };
  memoryLogs.push(entry);

  // 超过限制时移除最早的日志
  if (memoryLogs.length > MAX_MEMORY_LOGS) {
    memoryLogs.shift();
  }

  // 控制台输出（方便实时观察）
  const cacheInfo = `[Normal: ${entry.cacheSize}/${IMAGE_CACHE_MAX_SIZE}, Always: ${entry.alwaysCacheSize}]`;
  const hitInfo = entry.cacheHit !== undefined ? (entry.cacheHit ? '✓HIT' : '✗MISS') : '';
  console.log(`[Memory] ${entry.timestamp}s | ${event} ${cacheInfo} ${hitInfo} | ${details}`);
}

/** 导出日志获取函数（供外部工具使用） */
export function getMemoryLogs(): MemoryLogEntry[] {
  if (!isMemoryDebugEnabled()) return [];
  return [...memoryLogs];
}

/** 导出日志为 CSV 格式 */
export function exportMemoryLogsCSV(): string {
  if (!isMemoryDebugEnabled()) return 'Memory debug mode not enabled';
  const header = 'Timestamp,Event,Details,CacheSize,AlwaysCacheSize,CacheHit,ImageSrc';
  const rows = memoryLogs.map(log =>
    `${log.timestamp},${log.event},"${log.details}",${log.cacheSize},${log.alwaysCacheSize},${log.cacheHit ?? ''},${log.imageSrc ?? ''}`
  );
  return [header, ...rows].join('\n');
}

/** 缓存统计（仅调试模式下更新） */
const cacheStats = {
  hits: 0,
  misses: 0,
  evictions: 0,
  loads: 0
};

/** 获取缓存统计信息 */
export function getCacheStats(): { 
  hits: number; 
  misses: number; 
  evictions: number; 
  hitRate: string; 
  alwaysCacheSize: number;
  normalCacheSize: number;
  debugEnabled: boolean 
} {
  const total = cacheStats.hits + cacheStats.misses;
  const hitRate = total > 0 ? ((cacheStats.hits / total) * 100).toFixed(1) + '%' : 'N/A';
  return {
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    evictions: cacheStats.evictions,
    hitRate,
    alwaysCacheSize: alwaysImageCache.size,  // 边框缓存大小（不会淘汰）
    normalCacheSize: imageCache.size,      // 普通 LRU 缓存大小（会淘汰）
    debugEnabled: isMemoryDebugEnabled()
  };
}

// ============================================================================
// 图片 LRU 缓存
// ============================================================================

/**
 * 图片缓存实例
 * - 最大缓存 4 张图片（减少 GPU 显存占用）
 * - 使用 LRU（最近最少使用）策略淘汰旧条目
 * - 缓存 key 为图片的完整 URL
 * 
 * 注意：精灵图解压后很大（如 wave.webp 32帧 ≈ 90MB GPU 纹理）
 *       过多缓存会占用大量 GPU 显存和系统内存。
 *       对于低内存设备，建议限制为 2 张图片（1 张当前播放，1 张待播）。
 */
const imageCache = new LRUCache<string, HTMLImageElement>(IMAGE_CACHE_MAX_SIZE);

/**
 * 边框图片独立缓存（带容量上限）
 * 边框动画始终显示，需要持久缓存以避免重复加载
 */
const alwaysImageCache = new LRUCache<string, HTMLImageElement>(ALWAYS_IMAGE_CACHE_MAX_SIZE);

function releaseImageResource(img: HTMLImageElement) {
  // 彻底释放图片资源：
  // 1. 清空事件处理器，避免内存泄漏
  img.onload = null;
  img.onerror = null;
  // 2. 设置 src 为空数据 URI，提示浏览器释放旧纹理占用的 GPU 显存。
  //    注意：不要在 set src 后再 removeAttribute('src')，否则浏览器会中止加载，
  //    导致旧纹理无法被替换、GPU 显存无法释放。
  img.src = 'data:,';
}

// 设置淘汰回调，主动释放被淘汰图片的引用
imageCache.setOnEvict((url, img) => {
  // 仅调试模式下记录统计
  if (isMemoryDebugEnabled()) {
    cacheStats.evictions++;
    const shortUrl = url.split('/').slice(-2).join('/');
    logMemoryEvent('EVICT', `淘汰图片: ${shortUrl}`, { imageSrc: shortUrl });
  }
  releaseImageResource(img);
});

alwaysImageCache.setOnEvict((url, img) => {
  if (isMemoryDebugEnabled()) {
    const shortUrl = url.split('/').slice(-2).join('/');
    logMemoryEvent('EVICT_ALWAYS', `淘汰边框图片: ${shortUrl}`, { imageSrc: shortUrl });
  }
  releaseImageResource(img);
});



// isBorderImage 已提取到 animation_utils.ts

/**
 * 清除图片缓存
 * 在 Mod 切换时调用，释放旧 Mod 的图片资源
 * 同时清除普通 LRU 缓存和边框独立缓存
 */
export function clearImageCache(): void {
  const alwaysCount = alwaysImageCache.size;
  const normalCount = imageCache.size;
  logMemoryEvent('CLEAR_CACHE', `清除全部缓存 - 持久: ${alwaysCount}张, 普通: ${normalCount}张`);
  
  // 清除边框独立缓存
  alwaysImageCache.clear();
  
  // 清除普通 LRU 缓存
  imageCache.clear();
  

}

// 导出路径缓存清除函数和类型定义
export { clearModPathCache };
export type { AssetInfo, AnimationConfig };

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 将后端资产信息转换为前端动画配置
 *
 * @param asset - 后端返回的资产信息（AssetInfo）
 * @param modPath - 当前 Mod 的根目录路径
 * @returns 前端播放器使用的动画配置对象
 *
 * 转换内容：
 * - 构建完整的图片 URL（使用 Tauri 的 convertFileSrc 转换本地路径）
 * - 将帧时间从秒转换为毫秒
 * - 处理默认值（如未定义的帧数默认为 1）
 */
function buildAnimationConfig(asset: AssetInfo, modPath: string): AnimationConfig {
  // 构建资产文件的完整 URL（自动适配文件夹 mod 和 archive mod）
  const imgSrc = buildModAssetUrl(modPath, `asset/${asset.img}`);
  
  return {
    frameCountX: asset.frame_num_x || 1,        // X 轴帧数（列数）
    frameCountY: asset.frame_num_y || 1,        // Y 轴帧数（行数）
    frameWidth: asset.frame_size_x,             // 单帧宽度（像素）
    frameHeight: asset.frame_size_y,            // 单帧高度（像素）
    frameTime: (asset.frame_time || 0.1) * 1000, // 帧间隔（毫秒）
    imgSrc,                                     // 图片 URL
    sequence: asset.sequence !== false,         // 是否为序列帧动画
    originReverse: asset.origin_reverse === true, // 原始帧序是否反向
    needReverse: asset.need_reverse === true,   // 是否需要往返播放
    offsetX: asset.offset_x || 0,               // X 轴渲染偏移
    offsetY: asset.offset_y || 0                // Y 轴渲染偏移
  };
}

/**
 * 从后端获取资产信息
 *
 * @param assetName - 资产名称（如 "idle", "border"）
 * @returns 资产信息对象，不存在时返回 null
 */
async function fetchAssetInfo(assetName: string): Promise<AssetInfo | null> {
  return invoke("get_asset_by_name", { name: assetName });
}

// ============================================================================
// SpriteAnimator 类
// ============================================================================

/**
 * 精灵动画播放器
 *
 * 基于 Canvas 的序列帧动画播放器，支持：
 * - 从精灵图（sprite sheet）中裁剪并播放帧动画
 * - 正向播放、反向播放、往返循环
 * - 单次播放模式（播放完成后回调）
 * - 动画切换时保持播放状态
 *
 * ## 帧布局说明
 * 精灵图按网格排列帧，从左上角开始，先横向后纵向：
 * ```
 * [0,0] [1,0] [2,0] ...
 * [0,1] [1,1] [2,1] ...
 * ...
 * ```
 */
export class SpriteAnimator {
  // --- Canvas 相关 ---
  private canvas: HTMLCanvasElement;           // 目标 Canvas 元素
  private ctx: CanvasRenderingContext2D | null = null; // 2D 渲染上下文
  private img: HTMLImageElement | null = null; // 当前加载的精灵图（原始）
  private currentImgSrc = "";                  // 当前图片 URL（用于判断是否需要重新加载）

  // --- 贴图降采样 ---
  /** 降采样策略（由外部通过 setDownsamplePolicy 设置）。 */
  private dsPolicy: SpriteTexturePolicy = { enabled: false, startDim: 0, maxDim: 0, scale: 1 };
  /** 降采样后的精灵图 Canvas（null 表示未降采样，直接使用原图）。 */
  private dsImg: HTMLCanvasElement | null = null;
  /** 降采样比例（降采样后像素/原始像素），1 表示未降采样。 */
  private dsScale = 1;

  // --- Canvas 显示适配（仅影响元素显示尺寸） ---
  private fitPreference: CanvasFitPreference | null = null;
  private fitScale = 0.8;
  private fitContainer: HTMLElement | null = null;
  
  // --- 帧布局参数 ---
  private frameX = 0;              // 当前帧的 X 索引（列）
  private frameY = 0;              // 当前帧的 Y 索引（行）
  private frameCountX = 1;         // X 轴总帧数（列数）
  private frameCountY = 1;         // Y 轴总帧数（行数）
  private frameWidth = 0;          // 单帧宽度（像素）
  private frameHeight = 0;         // 单帧高度（像素）
  private frameTime = 100;         // 帧间隔时间（毫秒）
  private lastTime = 0;            // 上一帧的时间戳
  private offsetX = 0;             // 渲染时的 X 偏移
  private offsetY = 0;             // 渲染时的 Y 偏移
  
  // --- 播放控制 ---
  private animationId: number | null = null;   // requestAnimationFrame 返回的 ID
  private isPlaying = false;       // 是否正在播放
  private isSequence = true;       // 是否为序列帧（false 时为静态图）
  private originReverse = false;   // 原始帧序是否为反向
  private needReverse = false;     // 是否需要往返播放
  private isReversing = false;     // 当前是否在反向播放阶段
  private isPlayOnce = false;      // 是否为单次播放模式
  private onCompleteCallback: (() => void) | null = null; // 播放完成回调

  /** 窗口可见性状态 */
  private isVisible = true;
  /** 可见性变化监听器 */
  private visibilityHandler: (() => void) | null = null;
  /** 隐藏前保存的图片 URL（用于恢复） */
  private hiddenImgSrc: string | null = null;

  /**
   * 创建动画播放器实例
   * @param canvas - 目标 Canvas 元素
   */
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // 优化 Canvas 上下文配置，减少 GPU 开销
    this.ctx = canvas.getContext("2d", {
      alpha: true,             // 需要透明背景
      willReadFrequently: false // 不频繁读取像素数据
    });
    
    // 监听窗口可见性变化
    this.visibilityHandler = () => {
      const wasVisible = this.isVisible;
      this.isVisible = document.visibilityState === 'visible';
      
      if (!this.isVisible && wasVisible) {
        // 窗口变为不可见：释放当前图片引用以减少 GPU 纹理占用
        // 仅断开引用，不要重置 src，否则会导致缓存中的图片损坏
        if (this.img) {
          this.hiddenImgSrc = this.currentImgSrc;
          this.img = null;
        }
        // 同步释放降采样 Canvas
        if (this.dsImg) {
          this.dsImg.width = 0;
          this.dsImg.height = 0;
          this.dsImg = null;
        }
        this.dsScale = 1;
      } else if (this.isVisible && !wasVisible) {


        // 窗口恢复可见：重新加载图片并恢复动画
        if (this.hiddenImgSrc) {
          const restoreSrc = this.hiddenImgSrc;
          this.loadImage(restoreSrc).then((ok) => {
            if (!ok) {
              // 图片恢复失败：避免动画线程空转。
              // 单次播放模式下直接视为播放完成，让状态机继续。
              if (this.isPlayOnce) {
                this.stop();
                this.onCompleteCallback?.();
              } else {
                this.stop();
              }
              // 保留 hiddenImgSrc，便于后续可能的再次恢复/诊断
              return;
            }

            this.hiddenImgSrc = null;
            if (this.isPlaying && this.animationId === null) {
              this.animate(0);
            }
          });
        } else if (this.isPlaying && this.animationId === null) {
          this.animate(0);
        }

      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  // ============================================================================
  // 贴图降采样配置
  // ============================================================================

  /**
   * 设置贴图降采样策略。
   *
   * 调用时机：在创建 SpriteAnimator 后、加载图片之前调用。
   * 已加载的图片不会重新降采样（下次 loadImage 时生效）。
   *
   * @param enabled  - 是否启用降采样
   * @param startDim - 触发降采样的最长边阈值（像素）；<=0 表示不限制
   */
  setDownsamplePolicy(enabled: boolean, startDim: number): void {
    const dim = Math.max(0, Math.floor(Number(startDim) || 0));
    this.dsPolicy = { enabled, startDim: dim, maxDim: dim, scale: 1 };
  }

  /**
   * 对已加载的原始图片尝试降采样。
   * 生成降采样后的 Canvas 存入 dsImg，并计算 dsScale。
   * 若未启用或未达到阈值，dsImg 为 null，dsScale 为 1。
   */
  private applyDownsample(): void {
    this.dsImg = null;
    this.dsScale = 1;

    if (!this.img || !this.dsPolicy.enabled) return;

    const w0 = this.img.naturalWidth || this.img.width;
    const h0 = this.img.naturalHeight || this.img.height;
    if (w0 <= 0 || h0 <= 0) return;

    const target = computeSpriteDownsampleTarget(w0, h0, this.dsPolicy);
    if (target.scale >= SPRITE_TEX_OPT_NO_RESIZE_EPS) return;

    const canvas = downsampleSpriteSheet(this.img, target.w, target.h);
    if (!canvas) return;

    this.dsImg = canvas;
    this.dsScale = target.scale;
  }

  // ============================================================================
  // 按状态名加载
  // ============================================================================

  /**
   * 按状态名加载动画
   *
   * 加载流程：
   * 1. 从后端获取状态信息（包含关联的动画资产名）
   * 2. 根据资产名获取资产详情
   * 3. 构建动画配置并加载
   *
   * @param stateName - 状态名称（如 "idle", "morning"）
   * @returns 加载成功返回 true，失败返回 false
   */
  async loadByStateName(stateName: string): Promise<boolean> {
    try {
      // 获取状态信息，提取关联的动画资产名
      const state: { anima: string } | null = await invoke("get_state_by_name", { name: stateName });
      if (!state) return false;

      // 获取动画资产详情
      const asset = await fetchAssetInfo(state.anima);
      if (!asset) return false;

      // 获取 Mod 路径用于构建资源 URL
      const modPath = await getModPath();
      if (!modPath) return false;

      // 构建配置并加载
      return this.loadWithConfig(buildAnimationConfig(asset, modPath));
    } catch (e) {
      console.error(`Failed to load animation for state '${stateName}':`, e);
      return false;
    }
  }

  // ============================================================================
  // 按资产名加载
  // ============================================================================

  /**
   * 按资产名加载动画
   *
   * 直接使用资产名加载，跳过状态查询步骤。
   * 适用于加载边框等非状态关联的动画。
   *
   * @param assetName - 资产名称（如 "border"）
   * @returns 加载成功返回 true，失败返回 false
   */
  async loadByAssetName(assetName: string): Promise<boolean> {
    try {
      const asset = await fetchAssetInfo(assetName);
      if (!asset) return false;

      const modPath = await getModPath();
      if (!modPath) return false;

      return this.loadWithConfig(buildAnimationConfig(asset, modPath));
    } catch (e) {
      console.error(`Failed to load animation for asset '${assetName}':`, e);
      return false;
    }
  }

  // ============================================================================
  // 动画切换（推荐使用，复用实例）
  // ============================================================================

  /**
   * 切换到指定状态的动画
   *
   * 推荐使用此方法而非重新创建实例，因为：
   * - 复用 Canvas 上下文，减少资源开销
   * - 如果图片相同，跳过加载步骤
   * - 保持播放状态的连续性
   *
   * @param stateName - 目标状态名
   * @param playOnce - 是否单次播放（播放完成后触发回调）
   * @param onComplete - 播放完成回调（仅 playOnce=true 时有效）
   * @returns 切换成功返回 true
   */
  async switchToState(stateName: string, playOnce: boolean, onComplete?: () => void): Promise<boolean> {
    logMemoryEvent('SWITCH_STATE', `切换状态: ${stateName}, playOnce=${playOnce}`);
    try {
      const state: { anima: string } | null = await invoke("get_state_by_name", { name: stateName });
      if (!state) return false;

      const asset = await fetchAssetInfo(state.anima);
      if (!asset) return false;

      const modPath = await getModPath();
      if (!modPath) return false;

      return this.switchWithConfig(buildAnimationConfig(asset, modPath), playOnce, onComplete);
    } catch (e) {
      console.error(`Failed to switch to state '${stateName}':`, e);
      return false;
    }
  }

  /**
   * 切换到指定资产的动画
   *
   * @param assetName - 目标资产名
   * @param playOnce - 是否单次播放
   * @param onComplete - 播放完成回调
   * @returns 切换成功返回 true
   */
  async switchToAsset(assetName: string, playOnce: boolean, onComplete?: () => void): Promise<boolean> {
    logMemoryEvent('SWITCH_ASSET', `切换资产: ${assetName}, playOnce=${playOnce}`);
    try {
      const asset = await fetchAssetInfo(assetName);
      if (!asset) return false;

      const modPath = await getModPath();
      if (!modPath) return false;

      return this.switchWithConfig(buildAnimationConfig(asset, modPath), playOnce, onComplete);
    } catch (e) {
      console.error(`Failed to switch to asset '${assetName}':`, e);
      return false;
    }
  }

  /**
   * 使用配置切换动画
   *
   * 核心切换逻辑：
   * 1. 检查图片是否需要重新加载（URL 变化时加载）
   * 2. 应用新的帧布局配置
   * 3. 设置播放模式（单次/循环）
   * 4. 开始或继续播放
   *
   * @param config - 动画配置对象
   * @param playOnce - 是否单次播放
   * @param onComplete - 播放完成回调
   * @returns 切换成功返回 true
   */
  async switchWithConfig(config: AnimationConfig, playOnce: boolean, onComplete?: () => void): Promise<boolean> {
    // 仅当图片 URL 变化时才重新加载
    if (this.currentImgSrc !== config.imgSrc) {
      // 重要：切换时先保留旧图。
      // 如果新图加载失败，则不改变当前显示（满足“找不到图片就不做任何事”），同时避免动画空转。
      const prevImg = this.img;
      const prevImgSrc = this.currentImgSrc;
      const wasPlaying = this.isPlaying;

      const loaded = await this.loadImage(config.imgSrc);
      if (!loaded) {
        this.img = prevImg;
        // 若原本在播放但当前没有可用图片，停止以避免 requestAnimationFrame 空转
        if (wasPlaying && !this.img) {
          this.stop();
        }
        this.currentImgSrc = prevImgSrc;
        return false;
      }

      this.currentImgSrc = config.imgSrc;
    }

    
    // 应用新配置
    this.applyConfig(config);
    this.isPlayOnce = playOnce;
    this.onCompleteCallback = onComplete || null;
    
    // 调整 Canvas 尺寸以匹配帧大小
    // 优化：仅在尺寸变化时重置宽高度，避免不必要的缓冲区重分配
    if (this.canvas.width !== this.frameWidth) this.canvas.width = this.frameWidth;
    if (this.canvas.height !== this.frameHeight) this.canvas.height = this.frameHeight;

    // 资源或帧尺寸变化后，尝试刷新显示适配
    this.applyCanvasFit();

    this.drawCurrentFrame();
    
    // 启动动画循环
    if (this.isSequence) {
      if (!this.isPlaying) {
        this.isPlaying = true;
        this.animate(0);
      }
    } else if (playOnce) {
      // 静态图直接触发完成回调
      onComplete?.();
    }
    
    return true;
  }

  /**
   * 加载图片（带缓存）
   *
   * 优先从 LRU 缓存获取，缓存未命中时创建新 Image 对象加载。
   * 边框动画使用独立缓存，不被 LRU 淘汰。
   *
   * @param imgSrc - 图片 URL
   * @returns 加载成功返回 true
   */
  private loadImage(imgSrc: string): Promise<boolean> {
    return new Promise(async (resolve) => {
      const shortUrl = imgSrc.split('/').slice(-2).join('/');
      const debugMode = isMemoryDebugEnabled();
      const isBorder = isBorderImage(imgSrc);
      
      // 根据是否为边框选择不同的缓存
      const cache = isBorder ? alwaysImageCache : imageCache;
      
      // 尝试从缓存获取
      const cached = cache.get(imgSrc);
      if (cached && cached.complete && cached.naturalWidth > 0) {
        if (debugMode) {
          cacheStats.hits++;
          const cacheType = isBorder ? 'Always' : 'Normal';
          logMemoryEvent('LOAD_IMAGE', `加载${cacheType}图片: ${shortUrl} (命中率: ${getCacheStats().hitRate})`, { cacheHit: true, imageSrc: shortUrl });
        }
        this.img = cached;
        this.applyDownsample();
        resolve(true);
        return;
      }

      // 如果缓存里存在“已完成但实际加载失败”的坏条目（naturalWidth=0），剔除避免后续误用
      if (cached && cached.complete && cached.naturalWidth === 0) {
        try {
          cache.delete(imgSrc);
        } catch {}
      }

      
      // 缓存未命中，创建新图片加载
      if (debugMode) {
        cacheStats.misses++;
        cacheStats.loads++;
        const cacheType = isBorder ? 'Always' : 'Normal';
        logMemoryEvent('LOAD_IMAGE', `加载${cacheType}图片: ${shortUrl} (命中率: ${getCacheStats().hitRate})`, { cacheHit: false, imageSrc: shortUrl });
      }
      
      const newImg = new Image();
      newImg.onload = async () => {
        try {
          // 使用 decode() 确保图片解码完成，减少首帧渲染时的 CPU 抖动
          await newImg.decode();
          cache.set(imgSrc, newImg);
          this.img = newImg;
          this.applyDownsample();
          if (debugMode) {
            logMemoryEvent('IMAGE_LOADED', `图片加载并解码完成: ${shortUrl}`, { imageSrc: shortUrl });
          }
          resolve(true);
        } catch (e) {
          console.error("Image decode failed:", e);
          // 解码失败时退回到 onload 逻辑（部分环境可能不支持 decode）
          cache.set(imgSrc, newImg);
          this.img = newImg;
          this.applyDownsample();
          resolve(true);
        }
      };
      newImg.onerror = () => {
        if (debugMode) {
          logMemoryEvent('IMAGE_ERROR', `图片加载失败: ${shortUrl}`, { imageSrc: shortUrl });
        }
        resolve(false);
      };
      newImg.src = imgSrc;
    });
  }

  /**
   * 应用动画配置
   *
   * 更新所有帧布局参数并重置帧位置到起始帧
   *
   * @param config - 动画配置对象
   */
  private applyConfig(config: AnimationConfig): void {
    this.frameCountX = config.frameCountX;
    this.frameCountY = config.frameCountY;
    this.frameWidth = config.frameWidth;
    this.frameHeight = config.frameHeight;
    this.frameTime = config.frameTime;
    this.isSequence = config.sequence;
    this.originReverse = config.originReverse;
    this.needReverse = config.needReverse;
    this.offsetX = config.offsetX || 0;
    this.offsetY = config.offsetY || 0;
    this.resetFramePosition();
  }

  /**
   * 重置帧位置到起始帧
   *
   * 根据 originReverse 决定起始位置：
   * - originReverse=false: 从 [0,0] 开始正向播放
   * - originReverse=true: 从 [maxX,maxY] 开始反向播放
   */
  private resetFramePosition(): void {
    if (this.originReverse) {
      // 反向模式：从最后一帧开始
      this.frameX = this.frameCountX - 1;
      this.frameY = this.frameCountY - 1;
      this.isReversing = true;
    } else {
      // 正向模式：从第一帧开始
      this.frameX = 0;
      this.frameY = 0;
      this.isReversing = false;
    }
    this.lastTime = 0;
  }

  // ============================================================================
  // 使用配置加载
  // ============================================================================

  /**
   * 使用配置加载动画（初始化专用）
   *
   * 与 switchWithConfig 的区别：
   * - loadWithConfig 用于首次加载，不自动开始播放
   * - switchWithConfig 用于运行时切换，会保持/恢复播放状态
   *
   * @param config - 动画配置对象
   * @returns 加载成功返回 true
   */
  async loadWithConfig(config: AnimationConfig): Promise<boolean> {
    const loaded = await this.loadImage(config.imgSrc);
    if (!loaded) return false;
    
    this.currentImgSrc = config.imgSrc;
    this.applyConfig(config);
    
    // 设置 Canvas 尺寸并绘制首帧
    this.canvas.width = this.frameWidth;
    this.canvas.height = this.frameHeight;

    // 首次加载后，尝试刷新显示适配
    this.applyCanvasFit();

    this.drawCurrentFrame();
    
    return true;
  }

  // ============================================================================
  // 播放控制
  // ============================================================================

  /**
   * 开始循环播放动画
   *
   * 如果已在播放或非序列帧动画，调用无效
   */
  play(): void {
    if (!this.isSequence || this.isPlaying) return;
    this.isPlaying = true;
    this.isPlayOnce = false;
    this.onCompleteCallback = null;
    this.lastTime = 0;
    this.animate(0);
  }

  /**
   * 单次播放动画
   *
   * 从头开始播放一次，完成后触发回调。
   * 静态图会立即触发回调。
   *
   * @param onComplete - 播放完成回调
   */
  playOnce(onComplete?: () => void): void {
    // 静态图：直接绘制并触发回调
    if (!this.isSequence) {
      this.drawCurrentFrame();
      onComplete?.();
      return;
    }
    
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.isPlayOnce = true;
    this.onCompleteCallback = onComplete || null;
    this.lastTime = 0;
    this.reset();  // 重置到起始帧
    this.animate(0);
  }

  /**
   * 停止播放
   *
   * 取消动画循环，保持当前帧显示
   */
  stop(): void {
    this.isPlaying = false;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * 重置到起始帧
   */
  reset(): void {
    this.resetFramePosition();
    this.drawCurrentFrame();
  }

  /**
   * 设置 Canvas 显示适配策略
   *
   * 说明：这是对 DOM 元素 `style.width/height` 的调整，
   * 不会改变 `canvas.width/height`（也不会改变 drawImage 的裁剪/绘制逻辑）。
   */
  setCanvasFit(prefer: CanvasFitPreference | null, options?: CanvasFitOptions): void {
    this.fitPreference = prefer;
    this.fitScale = options?.scale ?? this.fitScale;
    this.fitContainer = options?.container ?? this.fitContainer;

    // prefer=null 表示清空适配，交还给 CSS
    if (!this.fitPreference) {
      this.canvas.style.width = "";
      this.canvas.style.height = "";
      return;
    }

    this.applyCanvasFit();
  }

  /**
   * 获取当前帧尺寸
   * @returns 帧的宽度和高度
   */
  getSize(): { width: number; height: number } {
    return { width: this.frameWidth, height: this.frameHeight };
  }

  private applyCanvasFit(): void {
    if (!this.fitPreference) return;

    const container = this.fitContainer ?? (this.canvas.parentElement as HTMLElement | null);
    if (!container) return;

    const containerW = container.clientWidth;
    const containerH = container.clientHeight;
    if (!containerW || !containerH) return;

    if (!this.frameWidth || !this.frameHeight) return;

    const targetW = containerW * this.fitScale;
    const targetH = containerH * this.fitScale;

    // legacy：旧版逻辑，只按高度缩放，宽度随图片比例自适应
    if (this.fitPreference === "legacy") {
      this.canvas.style.width = "";
      this.canvas.style.height = `${Math.max(1, Math.round(targetH))}px`;
      return;
    }

    const isWide = this.frameWidth >= this.frameHeight;
    const longSideIsWidth = isWide;

    // 选择“用宽还是用高”来做适配基准
    const fitBy: "width" | "height" = (() => {
      if (this.fitPreference === "long") {
        return longSideIsWidth ? "width" : "height";
      }
      // short
      return longSideIsWidth ? "height" : "width";
    })();

    const scale = fitBy === "width" ? targetW / this.frameWidth : targetH / this.frameHeight;

    const displayW = Math.max(1, Math.round(this.frameWidth * scale));
    const displayH = Math.max(1, Math.round(this.frameHeight * scale));

    this.canvas.style.width = `${displayW}px`;
    this.canvas.style.height = `${displayH}px`;
  }


  /**
   * 销毁播放器
   *
   * 停止播放并释放资源引用
   */
  destroy(): void {
    this.stop();
    // 移除可见性监听器
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    
    // 断开当前图片引用（不修改 img.src，由 clearImageCache 的 onEvict 统一释放）
    this.img = null;

    // 释放降采样 Canvas
    if (this.dsImg) {
      this.dsImg.width = 0;
      this.dsImg.height = 0;
      this.dsImg = null;
    }
    this.dsScale = 1;
    
    // 清零 canvas 缓冲区，释放 Canvas 2D 上下文持有的最后一帧 GPU 纹理
    try {
      this.canvas.width = 0;
      this.canvas.height = 0;
    } catch { /* ignore */ }
    
    this.ctx = null;
    this.currentImgSrc = "";
    this.hiddenImgSrc = null;
  }

  // ============================================================================
  // 动画循环
  // ============================================================================

  /**
   * 动画主循环
   *
   * 通过 requestAnimationFrame 实现与显示器刷新率同步的高效渲染。
   * 
   * # 性能控制：
   * 1. **可见性检查**：当 `isVisible` 为 false（窗口最小化或完全遮挡）时，立即跳出循环，
   *    此时 `animationId` 被置为 null，完全停止 JavaScript 线程的计算开销。
   * 2. **异步等待**：如果图片尚未加载完成或 Context 丢失，会进入等待模式，不执行绘制。
   * 3. **频率控制**：通过对比 `time` 与 `lastTime`，确保动画按照 `frameTime`（Mod 定义的帧率）播放，
   *    而非无限制地以 144Hz 或更高频率渲染，从而大幅节省 CPU/GPU 资源。
   *
   * @param time - requestAnimationFrame 自动传入的高精度时间戳（毫秒）
   */
  private animate = (time: number): void => {
    if (!this.isPlaying) return;
    
    // 窗口不可见时暂停动画循环，减少 GPU 占用
    if (!this.isVisible) {
      this.animationId = null;
      return;
    }

    // 等待资源就绪
    if (!this.ctx || !this.img || !this.img.complete) {
      this.animationId = requestAnimationFrame(this.animate);
      return;
    }

    // 图片已完成但无有效尺寸：视为加载失败，避免 drawImage 抛错/空转
    if (this.img.naturalWidth === 0) {
      if (this.isPlayOnce) {
        this.stop();
        this.onCompleteCallback?.();
      } else {
        this.stop();
      }
      return;
    }


    // 检查是否到达帧切换时间
    if (time - this.lastTime > this.frameTime) {
      this.drawCurrentFrame();
      this.advanceFrame();
      this.lastTime = time;
    }

    // 继续下一帧
    this.animationId = requestAnimationFrame(this.animate);
  };

  /**
   * 绘制当前帧
   *
   * 从精灵图中裁剪当前帧区域并绘制到 Canvas。
   * 若启用了降采样（dsImg 不为 null），则从降采样 Canvas 中按缩放后的坐标裁剪，
   * 并拉伸绘制到逻辑尺寸的目标区域，从而实现"降采样后放大到原始尺寸"。
   */
  private drawCurrentFrame(): void {
    if (!this.ctx || !this.img) return;
    
    // 清除画布
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 选择绘制源：有降采样版本时使用它，否则用原图
    const src: CanvasImageSource = this.dsImg ?? this.img;
    const s = this.dsScale;

    // 计算源图像中的裁剪位置（按降采样比例缩放）
    const sx = this.frameX * this.frameWidth * s;
    const sy = this.frameY * this.frameHeight * s;
    const sw = this.frameWidth * s;
    const sh = this.frameHeight * s;
    
    // 绘制帧（支持偏移）：目标区域始终使用逻辑尺寸
    this.ctx.drawImage(
      src,
      sx, sy, sw, sh,                                               // 源区域（降采样后的像素坐标）
      this.offsetX, this.offsetY, this.frameWidth, this.frameHeight  // 目标区域（逻辑尺寸）
    );
  }

  /**
   * 推进至下一帧索引
   *
   * 这是一个高度优化的有限状态机逻辑，用于处理各种复杂的播放模式：
   * 
   * # 播放算法：
   * 1. **正向/反向起始 (originReverse)**: 
   *    有些精灵图设计是倒序的，通过此标记决定是从 `[0,0]` 开始还是从 `[maxX,maxY]` 开始。
   * 2. **往返循环 (needReverse)**: 
   *    实现类似“呼吸”或“眨眼”的平滑效果（0->1->2->1->0）。
   *    开启后，当到达序列尽头时，不直接跳回起点，而是反转播放方向。
   * 3. **单次播放 (isPlayOnce)**: 
   *    用于触发动作。当一个完整的循环（包含往返阶段）结束后，自动执行 `stop()` 
   *    并触发 `onCompleteCallback` 回调，使后端能够检测到动画结束并切换回 `idle`。
   */
  private advanceFrame(): void {
    if (this.originReverse) {
      this.advanceFrameReverse();
    } else {
      this.advanceFrameForward();
    }
  }

  /**
   * 反向起始的帧推进逻辑
   *
   * 当 originReverse=true 时使用：
   * - 起始于最后一帧，向前推进（帧索引递减）
   * - 到达第一帧后，如果 needReverse=true 则反向播放回去
   * - 否则循环回到最后一帧继续
   */
  private advanceFrameReverse(): void {
    if (this.isReversing) {
      // 反向阶段：帧索引递减
      this.frameX--;
      if (this.frameX < 0) {
        this.frameX = this.frameCountX - 1;
        this.frameY--;
        if (this.frameY < 0) {
          // 到达第一帧
          if (this.needReverse) {
            // 需要往返：切换到正向阶段
            this.isReversing = false;
            this.frameX = Math.min(1, this.frameCountX - 1);
            this.frameY = 0;
          } else {
            // 不需要往返：循环回最后一帧
            this.frameX = this.frameCountX - 1;
            this.frameY = this.frameCountY - 1;
            if (this.isPlayOnce) {
              this.stop();
              this.onCompleteCallback?.();
            }
          }
        }
      }
    } else {
      // 正向阶段（往返播放的回程）：帧索引递增
      this.frameX++;
      if (this.frameX >= this.frameCountX) {
        this.frameX = 0;
        this.frameY++;
        if (this.frameY >= this.frameCountY) {
          // 到达最后一帧，切换回反向阶段
          this.isReversing = true;
          this.frameX = Math.max(0, this.frameCountX - 2);
          this.frameY = this.frameCountY - 1;
          if (this.isPlayOnce) {
            this.stop();
            this.onCompleteCallback?.();
          }
        }
      }
    }
  }

  /**
   * 正向起始的帧推进逻辑
   *
   * 当 originReverse=false 时使用：
   * - 起始于第一帧，向后推进（帧索引递增）
   * - 到达最后一帧后，如果 needReverse=true 则反向播放回去
   * - 否则循环回到第一帧继续
   */
  private advanceFrameForward(): void {
    if (this.isReversing) {
      // 反向阶段（往返播放的回程）：帧索引递减
      this.frameX--;
      if (this.frameX < 0) {
        this.frameX = this.frameCountX - 1;
        this.frameY--;
        if (this.frameY < 0) {
          // 到达第一帧，切换回正向阶段
          this.isReversing = false;
          this.frameX = 0;
          this.frameY = 0;
          if (this.isPlayOnce) {
            this.stop();
            this.onCompleteCallback?.();
          }
        }
      }
    } else {
      // 正向阶段：帧索引递增
      this.frameX++;
      if (this.frameX >= this.frameCountX) {
        this.frameX = 0;
        this.frameY++;
        if (this.frameY >= this.frameCountY) {
          // 到达最后一帧
          if (this.needReverse) {
            // 需要往返：切换到反向阶段
            this.isReversing = true;
            this.frameX = Math.max(0, this.frameCountX - 2);
            this.frameY = this.frameCountY - 1;
          } else {
            // 不需要往返：循环回第一帧
            this.frameY = 0;
            if (this.isPlayOnce) {
              this.stop();
              this.onCompleteCallback?.();
            }
          }
        }
      }
    }
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建并初始化动画播放器
 *
 * 便捷工厂函数，一步完成：
 * 1. 创建 SpriteAnimator 实例
 * 2. 按状态名加载动画
 * 3. 可选自动开始播放
 *
 * @param canvas - 目标 Canvas 元素
 * @param stateName - 状态名称
 * @param autoPlay - 是否自动开始播放（默认 true）
 * @returns 成功返回播放器实例，失败返回 null
 *
 * @example
 * ```typescript
 * const animator = await createAnimator(canvasEl, "idle");
 * if (animator) {
 *   // 使用 animator...
 * }
 * ```
 */
export async function createAnimator(
  canvas: HTMLCanvasElement,
  stateName: string,
  autoPlay = true
): Promise<SpriteAnimator | null> {
  const animator = new SpriteAnimator(canvas);
  const success = await animator.loadByStateName(stateName);
  
  if (!success) {
    animator.destroy();
    return null;
  }

  if (autoPlay) animator.play();
  return animator;
}
