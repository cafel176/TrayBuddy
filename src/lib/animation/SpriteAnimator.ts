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
import type { AssetInfo, AnimationConfig } from "../types/asset";

// ============================================================================
// 图片 LRU 缓存
// ============================================================================

/**
 * 图片缓存实例
 * - 最大缓存 20 张图片
 * - 使用 LRU（最近最少使用）策略淘汰旧条目
 * - 缓存 key 为图片的完整 URL
 */
const imageCache = new LRUCache<string, HTMLImageElement>(20);

/**
 * 清除图片缓存
 * 在 Mod 切换时调用，释放旧 Mod 的图片资源
 */
export function clearImageCache(): void {
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
  // 构建资产文件的完整路径
  const rawPath = `${modPath}/asset/${asset.img}`;
  // 将本地文件路径转换为可在 WebView 中使用的 URL
  const imgSrc = convertFileSrc(rawPath.replace(/\\/g, '/'));
  
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
  private img: HTMLImageElement | null = null; // 当前加载的精灵图
  private currentImgSrc = "";                  // 当前图片 URL（用于判断是否需要重新加载）
  
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

  /**
   * 创建动画播放器实例
   * @param canvas - 目标 Canvas 元素
   */
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
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
      const loaded = await this.loadImage(config.imgSrc);
      if (!loaded) return false;
      this.currentImgSrc = config.imgSrc;
    }
    
    // 应用新配置
    this.applyConfig(config);
    this.isPlayOnce = playOnce;
    this.onCompleteCallback = onComplete || null;
    
    // 调整 Canvas 尺寸以匹配帧大小
    this.canvas.width = this.frameWidth;
    this.canvas.height = this.frameHeight;
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
   *
   * @param imgSrc - 图片 URL
   * @returns 加载成功返回 true
   */
  private loadImage(imgSrc: string): Promise<boolean> {
    return new Promise((resolve) => {
      // 尝试从缓存获取
      const cached = imageCache.get(imgSrc);
      if (cached && cached.complete) {
        this.img = cached;
        resolve(true);
        return;
      }
      
      // 缓存未命中，创建新图片加载
      const newImg = new Image();
      newImg.onload = () => {
        imageCache.set(imgSrc, newImg);  // 存入缓存
        this.img = newImg;
        resolve(true);
      };
      newImg.onerror = () => resolve(false);
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
   * 获取当前帧尺寸
   * @returns 帧的宽度和高度
   */
  getSize(): { width: number; height: number } {
    return { width: this.frameWidth, height: this.frameHeight };
  }

  /**
   * 销毁播放器
   *
   * 停止播放并释放资源引用
   */
  destroy(): void {
    this.stop();
    this.img = null;
    this.ctx = null;
  }

  // ============================================================================
  // 动画循环
  // ============================================================================

  /**
   * 动画主循环
   *
   * 使用 requestAnimationFrame 实现流畅动画：
   * - 检查播放状态和资源加载状态
   * - 根据 frameTime 控制帧率
   * - 绘制当前帧并推进到下一帧
   *
   * @param time - requestAnimationFrame 提供的高精度时间戳
   */
  private animate = (time: number): void => {
    if (!this.isPlaying) return;

    // 等待资源就绪
    if (!this.ctx || !this.img || !this.img.complete) {
      this.animationId = requestAnimationFrame(this.animate);
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
   * 从精灵图中裁剪当前帧区域并绘制到 Canvas
   */
  private drawCurrentFrame(): void {
    if (!this.ctx || !this.img) return;
    
    // 清除画布
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // 计算源图像中的裁剪位置
    const sx = this.frameX * this.frameWidth;
    const sy = this.frameY * this.frameHeight;
    
    // 绘制帧（支持偏移）
    this.ctx.drawImage(
      this.img,
      sx, sy, this.frameWidth, this.frameHeight,    // 源区域
      this.offsetX, this.offsetY, this.frameWidth, this.frameHeight  // 目标区域
    );
  }

  /**
   * 推进到下一帧
   *
   * 根据 originReverse 选择正向或反向推进逻辑
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
