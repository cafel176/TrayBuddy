// ========================================================================= //
// SpriteAnimator - 精灵动画播放器模块
// ========================================================================= //
//
// 本模块提供桌面宠物的精灵动画播放功能，支持：
// - 精灵图（Sprite Sheet）的帧动画播放
// - 序列帧动画与静态图片的处理
// - 正向播放与反向播放（乒乓动画）
// - 单次播放与循环播放模式
// - 渲染偏移量控制
// - 动画热切换（复用同一播放器实例）
// - 图片缓存（避免重复加载）
//
// 主要组件：
// - AssetInfo: 资产信息接口（从后端获取）
// - AnimationConfig: 动画配置接口
// - SpriteAnimator: 精灵动画播放器类
// - createAnimator: 便捷工厂函数
//
// 工作流程：
// 1. 通过状态名或资产名从后端获取资产信息
// 2. 构建动画配置并加载精灵图（优先使用缓存）
// 3. 使用 requestAnimationFrame 进行帧动画播放
// 4. 根据配置决定播放模式（循环/单次，正向/乒乓）
// 5. 切换动画时复用播放器实例，无需销毁重建
//
// ========================================================================= //

import { invoke, convertFileSrc } from "@tauri-apps/api/core";

// ========================================================================= //
// 图片缓存
// ========================================================================= //
//
// 全局图片缓存，避免重复加载相同的精灵图
// 使用 imgSrc URL 作为缓存键
// 支持 LRU 淘汰策略，防止内存无限增长
//

/** 最大缓存图片数量 */
const IMAGE_CACHE_MAX_SIZE = 20;

/** 全局图片缓存 Map */
const imageCache: Map<string, HTMLImageElement> = new Map();

/**
 * 添加图片到缓存（带 LRU 淘汰）
 * @param key 缓存键
 * @param img 图片元素
 */
function addToImageCache(key: string, img: HTMLImageElement): void {
  // 如果缓存已满，删除最早的条目（Map 保持插入顺序）
  if (imageCache.size >= IMAGE_CACHE_MAX_SIZE) {
    const firstKey = imageCache.keys().next().value;
    if (firstKey) {
      imageCache.delete(firstKey);
    }
  }
  imageCache.set(key, img);
}

/**
 * 从缓存获取图片（并更新访问顺序）
 * @param key 缓存键
 * @returns 缓存的图片或 undefined
 */
function getFromImageCache(key: string): HTMLImageElement | undefined {
  const img = imageCache.get(key);
  if (img) {
    // 移动到末尾（最近访问）
    imageCache.delete(key);
    imageCache.set(key, img);
  }
  return img;
}

// ========================================================================= //
// ModPath 缓存
// ========================================================================= //
//
// 缓存 mod 路径，避免每次加载动画都调用 invoke
//

/** 缓存的 mod 路径 */
let cachedModPath: string | null = null;

/**
 * 获取 mod 路径（带缓存）
 * @returns mod 路径
 */
async function getModPath(): Promise<string | null> {
  if (cachedModPath === null) {
    cachedModPath = await invoke("get_mod_path");
  }
  return cachedModPath;
}

/**
 * 清除 mod 路径缓存（Mod 切换时调用）
 */
export function clearModPathCache(): void {
  cachedModPath = null;
}

/**
 * 清除图片缓存（Mod 切换时调用）
 */
export function clearImageCache(): void {
  imageCache.clear();
}

// ========================================================================= //
// AssetInfo - 资产信息接口
// ========================================================================= //
// 
// 该接口定义了从后端 Rust 层获取的资产元数据结构
// 用于描述精灵图的帧布局、动画参数和渲染偏移
//

/**
 * 资产信息接口
 * 
 * 与后端 Rust 的 AssetInfo 结构对应，包含精灵图的完整元数据
 */
export interface AssetInfo {
  /** 资产唯一名称，用于索引和引用 */
  name: string;
  /** 精灵图文件路径（相对于 mod/assets 目录） */
  img: string;

  /** 是否为序列帧动画（false 表示静态图片） */
  sequence: boolean;
  /** 是否需要反向播放（乒乓动画效果） */
  need_reverse: boolean;
  /** 每帧持续时间（秒） */
  frame_time: number;

  /** 单帧宽度（像素） */
  frame_size_x: number;
  /** 单帧高度（像素） */
  frame_size_y: number;

  /** 精灵图水平方向帧数 */
  frame_num_x: number;
  /** 精灵图垂直方向帧数 */
  frame_num_y: number;

  /** 渲染时 X 轴偏移（像素） */
  offset_x: number;
  /** 渲染时 Y 轴偏移（像素） */
  offset_y: number;
}

// ========================================================================= //
// AnimationConfig - 动画配置接口
// ========================================================================= //
//
// 前端使用的动画配置结构，由 AssetInfo 转换而来
// 包含经过处理的参数（如帧时间从秒转换为毫秒）
//

/**
 * 动画配置接口
 * 
 * 用于初始化 SpriteAnimator 的配置参数
 * 从 AssetInfo 转换而来，适配前端播放需求
 */
export interface AnimationConfig {
  /** 精灵图水平方向帧数 */
  frameCountX: number;
  /** 精灵图垂直方向帧数 */
  frameCountY: number;
  /** 单帧宽度（像素） */
  frameWidth: number;
  /** 单帧高度（像素） */
  frameHeight: number;
  /** 每帧持续时间（毫秒，已从秒转换） */
  frameTime: number;
  /** 精灵图完整 URL（通过 convertFileSrc 转换） */
  imgSrc: string;
  /** 是否为序列帧动画 */
  sequence: boolean;
  /** 是否需要反向播放（乒乓动画） */
  needReverse: boolean;
  /** 渲染时 X 轴偏移（像素） */
  offsetX: number;
  /** 渲染时 Y 轴偏移（像素） */
  offsetY: number;
}

// ========================================================================= //
// SpriteAnimator - 精灵动画播放器类
// ========================================================================= //
//
// 核心动画播放器，负责：
// - 加载精灵图并管理图片资源
// - 根据配置切割精灵图帧
// - 使用 requestAnimationFrame 实现流畅的帧动画
// - 支持循环播放、单次播放、乒乓播放等多种模式
// - 支持动画热切换（switchToState/switchToAsset）
//
// 播放模式说明：
// - 普通循环：正向播放完毕后从头开始
// - 乒乓循环：正向播放完毕后反向播放，如此往复
// - 单次播放：播放一轮后停止并触发回调
//
// 帧索引计算：
// - frameX: 当前帧在精灵图中的水平位置（0-based）
// - frameY: 当前帧在精灵图中的垂直位置（0-based）
// - 总帧数 = frameCountX * frameCountY
//
// 性能优化：
// - 复用播放器实例，通过 switchToState/switchToAsset 切换动画
// - 使用全局图片缓存，避免重复加载相同的精灵图
// - 保持 requestAnimationFrame 循环运行，减少启停开销
//

/**
 * 精灵动画播放器类
 * 
 * 用于在 Canvas 上播放精灵图动画，支持动画热切换
 * 
 * @example
 * ```typescript
 * // 创建并初始加载
 * const animator = new SpriteAnimator(canvas);
 * await animator.loadByStateName("idle");
 * animator.play();
 * 
 * // 切换到新动画（复用实例，无需销毁重建）
 * await animator.switchToState("walking", false);
 * ```
 */
export class SpriteAnimator {
  // -------------------------------------------------------------------------
  // 私有属性 - Canvas 相关
  // -------------------------------------------------------------------------
  
  /** 目标画布元素 */
  private canvas: HTMLCanvasElement;
  /** 2D 渲染上下文 */
  private ctx: CanvasRenderingContext2D | null = null;
  /** 精灵图图片对象 */
  private img: HTMLImageElement | null = null;
  /** 当前加载的图片 URL（用于缓存判断） */
  private currentImgSrc: string = "";
  
  // -------------------------------------------------------------------------
  // 私有属性 - 帧状态
  // -------------------------------------------------------------------------
  
  /** 当前帧 X 索引 */
  private frameX = 0;
  /** 当前帧 Y 索引 */
  private frameY = 0;
  /** 精灵图水平帧数 */
  private frameCountX = 1;
  /** 精灵图垂直帧数 */
  private frameCountY = 1;
  /** 单帧宽度（像素） */
  private frameWidth = 0;
  /** 单帧高度（像素） */
  private frameHeight = 0;
  /** 每帧持续时间（毫秒） */
  private frameTime = 100;
  /** 上次帧更新时间戳 */
  private lastTime = 0;
  
  // -------------------------------------------------------------------------
  // 私有属性 - 渲染偏移
  // -------------------------------------------------------------------------
  
  /** 渲染偏移 X（像素） */
  private offsetX = 0;
  /** 渲染偏移 Y（像素） */
  private offsetY = 0;
  
  // -------------------------------------------------------------------------
  // 私有属性 - 播放控制
  // -------------------------------------------------------------------------
  
  /** requestAnimationFrame 返回的 ID */
  private animationId: number | null = null;
  /** 当前是否正在播放 */
  private isPlaying = false;
  /** 是否为序列帧动画（false 则为静态图） */
  private isSequence = true;
  /** 是否需要反向播放（乒乓模式） */
  private needReverse = false;
  /** 当前是否处于反向播放阶段 */
  private isReversing = false;
  /** 是否为单次播放模式 */
  private isPlayOnce = false;
  /** 播放完成回调函数 */
  private onCompleteCallback: (() => void) | null = null;

  /**
   * 构造函数
   * 
   * @param canvas 目标画布元素，动画将渲染到此画布
   */
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  // =========================================================================
  // 公共方法 - 按状态名加载
  // =========================================================================

  /**
   * 根据状态名称加载动画资源
   * 
   * 工作流程：
   * 1. 通过状态名从后端获取 StateInfo
   * 2. 根据 StateInfo.anima 获取对应的 AssetInfo
   * 3. 获取当前加载的 mod 路径
   * 4. 构建 AnimationConfig 并加载图片
   * 
   * @param stateName 状态名称（如 "idle", "morning", "click"）
   * @returns 加载成功返回 true，失败返回 false
   */
  async loadByStateName(stateName: string): Promise<boolean> {
    try {
      // 1. 获取 StateInfo
      const state: any = await invoke("get_state_by_name", { name: stateName });
      if (!state) {
        console.error(`State '${stateName}' not found`);
        return false;
      }

      // 2. 获取 AssetInfo
      const asset: AssetInfo | null = await invoke("get_asset_by_name", { name: state.anima });
      if (!asset) {
        console.error(`Asset '${state.anima}' not found for state '${stateName}'`);
        return false;
      }

      // 3. 获取 mod 路径（使用缓存）
      const modPath = await getModPath();
      if (!modPath) {
        console.error("No mod loaded");
        return false;
      }

      // 4. 构建配置
      // 将 Windows 路径分隔符统一为正斜杠，然后通过 convertFileSrc 转换为可访问的 URL
      const rawPath = `${modPath}/assets/${asset.img}`;
      const normalizedPath = rawPath.replace(/\\/g, '/');
      const imgSrc = convertFileSrc(normalizedPath);

      const config: AnimationConfig = {
        frameCountX: asset.frame_num_x || 1,
        frameCountY: asset.frame_num_y || 1,
        frameWidth: asset.frame_size_x,
        frameHeight: asset.frame_size_y,
        frameTime: (asset.frame_time || 0.1) * 1000,  // 秒 -> 毫秒
        imgSrc,
        sequence: asset.sequence !== false,           // 默认为 true
        needReverse: asset.need_reverse === true,     // 默认为 false
        offsetX: asset.offset_x || 0,
        offsetY: asset.offset_y || 0
      };

      return this.loadWithConfig(config);
    } catch (e) {
      console.error(`Failed to load animation for state '${stateName}':`, e);
      return false;
    }
  }

  // =========================================================================
  // 公共方法 - 按资产名加载
  // =========================================================================

  /**
   * 根据资产名称加载动画资源
   * 
   * 用于加载非状态关联的动画资源（如边框动画）
   * 直接通过资产名获取 AssetInfo，跳过状态查询
   * 
   * @param assetName 资产名称（如 "border", "effect_sparkle"）
   * @returns 加载成功返回 true，失败返回 false
   */
  async loadByAssetName(assetName: string): Promise<boolean> {
    try {
      // 1. 获取 AssetInfo
      const asset: AssetInfo | null = await invoke("get_asset_by_name", { name: assetName });
      if (!asset) {
        console.error(`Asset '${assetName}' not found`);
        return false;
      }

      // 2. 获取 mod 路径（使用缓存）
      const modPath = await getModPath();
      if (!modPath) {
        console.error("No mod loaded");
        return false;
      }

      // 3. 构建配置
      const rawPath = `${modPath}/assets/${asset.img}`;
      const normalizedPath = rawPath.replace(/\\/g, '/');
      const imgSrc = convertFileSrc(normalizedPath);

      const config: AnimationConfig = {
        frameCountX: asset.frame_num_x || 1,
        frameCountY: asset.frame_num_y || 1,
        frameWidth: asset.frame_size_x,
        frameHeight: asset.frame_size_y,
        frameTime: (asset.frame_time || 0.1) * 1000,
        imgSrc,
        sequence: asset.sequence !== false,
        needReverse: asset.need_reverse === true,
        offsetX: asset.offset_x || 0,
        offsetY: asset.offset_y || 0
      };

      return this.loadWithConfig(config);
    } catch (e) {
      console.error(`Failed to load animation for asset '${assetName}':`, e);
      return false;
    }
  }

  // =========================================================================
  // 公共方法 - 动画切换（推荐使用，避免销毁重建）
  // =========================================================================

  /**
   * 切换到新的状态动画
   * 
   * 复用当前播放器实例，无需销毁重建
   * 自动停止当前动画，加载新动画并开始播放
   * 使用图片缓存避免重复加载相同的精灵图
   * 
   * @param stateName 状态名称（如 "idle", "walking"）
   * @param playOnce 是否只播放一次
   * @param onComplete 播放完成回调（仅 playOnce=true 时有效）
   * @returns 切换成功返回 true，失败返回 false
   * 
   * @example
   * ```typescript
   * // 切换到循环动画
   * await animator.switchToState("idle", false);
   * 
   * // 切换到单次动画
   * await animator.switchToState("greeting", true, () => {
   *   console.log("Greeting animation completed");
   * });
   * ```
   */
  async switchToState(
    stateName: string,
    playOnce: boolean,
    onComplete?: () => void
  ): Promise<boolean> {
    try {
      // 1. 获取 StateInfo
      const state: any = await invoke("get_state_by_name", { name: stateName });
      if (!state) {
        console.error(`State '${stateName}' not found`);
        return false;
      }

      // 2. 获取 AssetInfo
      const asset: AssetInfo | null = await invoke("get_asset_by_name", { name: state.anima });
      if (!asset) {
        console.error(`Asset '${state.anima}' not found for state '${stateName}'`);
        return false;
      }

      // 3. 获取 mod 路径（使用缓存）
      const modPath = await getModPath();
      if (!modPath) {
        console.error("No mod loaded");
        return false;
      }

      // 4. 构建配置
      const rawPath = `${modPath}/assets/${asset.img}`;
      const normalizedPath = rawPath.replace(/\\/g, '/');
      const imgSrc = convertFileSrc(normalizedPath);

      const config: AnimationConfig = {
        frameCountX: asset.frame_num_x || 1,
        frameCountY: asset.frame_num_y || 1,
        frameWidth: asset.frame_size_x,
        frameHeight: asset.frame_size_y,
        frameTime: (asset.frame_time || 0.1) * 1000,
        imgSrc,
        sequence: asset.sequence !== false,
        needReverse: asset.need_reverse === true,
        offsetX: asset.offset_x || 0,
        offsetY: asset.offset_y || 0
      };

      // 5. 执行切换
      return this.switchWithConfig(config, playOnce, onComplete);
    } catch (e) {
      console.error(`Failed to switch to state '${stateName}':`, e);
      return false;
    }
  }

  /**
   * 切换到新的资产动画
   * 
   * 用于切换非状态关联的动画资源（如边框动画）
   * 
   * @param assetName 资产名称
   * @param playOnce 是否只播放一次
   * @param onComplete 播放完成回调
   * @returns 切换成功返回 true，失败返回 false
   */
  async switchToAsset(
    assetName: string,
    playOnce: boolean,
    onComplete?: () => void
  ): Promise<boolean> {
    try {
      // 1. 获取 AssetInfo
      const asset: AssetInfo | null = await invoke("get_asset_by_name", { name: assetName });
      if (!asset) {
        console.error(`Asset '${assetName}' not found`);
        return false;
      }

      // 2. 获取 mod 路径（使用缓存）
      const modPath = await getModPath();
      if (!modPath) {
        console.error("No mod loaded");
        return false;
      }

      // 3. 构建配置
      const rawPath = `${modPath}/assets/${asset.img}`;
      const normalizedPath = rawPath.replace(/\\/g, '/');
      const imgSrc = convertFileSrc(normalizedPath);

      const config: AnimationConfig = {
        frameCountX: asset.frame_num_x || 1,
        frameCountY: asset.frame_num_y || 1,
        frameWidth: asset.frame_size_x,
        frameHeight: asset.frame_size_y,
        frameTime: (asset.frame_time || 0.1) * 1000,
        imgSrc,
        sequence: asset.sequence !== false,
        needReverse: asset.need_reverse === true,
        offsetX: asset.offset_x || 0,
        offsetY: asset.offset_y || 0
      };

      // 4. 执行切换
      return this.switchWithConfig(config, playOnce, onComplete);
    } catch (e) {
      console.error(`Failed to switch to asset '${assetName}':`, e);
      return false;
    }
  }

  /**
   * 使用配置对象切换动画
   * 
   * 内部方法，处理实际的动画切换逻辑
   * 支持图片缓存，相同图片不会重复加载
   * 
   * @param config 动画配置对象
   * @param playOnce 是否只播放一次
   * @param onComplete 播放完成回调
   * @returns 切换成功返回 true，失败返回 false
   */
  async switchWithConfig(
    config: AnimationConfig,
    playOnce: boolean,
    onComplete?: () => void
  ): Promise<boolean> {
    // 检查是否需要加载新图片
    const needLoadImage = this.currentImgSrc !== config.imgSrc;
    
    // 更新帧参数（立即生效）
    this.frameCountX = config.frameCountX;
    this.frameCountY = config.frameCountY;
    this.frameWidth = config.frameWidth;
    this.frameHeight = config.frameHeight;
    this.frameTime = config.frameTime;
    this.isSequence = config.sequence;
    this.needReverse = config.needReverse;
    this.offsetX = config.offsetX || 0;
    this.offsetY = config.offsetY || 0;
    
    // 重置帧状态
    this.frameX = 0;
    this.frameY = 0;
    this.isReversing = false;
    this.lastTime = 0;
    
    // 更新播放模式
    this.isPlayOnce = playOnce;
    this.onCompleteCallback = onComplete || null;
    
    // 更新画布尺寸
    this.canvas.width = this.frameWidth;
    this.canvas.height = this.frameHeight;
    
    if (needLoadImage) {
      // 需要加载新图片
      const loaded = await this.loadImage(config.imgSrc);
      if (!loaded) {
        return false;
      }
      this.currentImgSrc = config.imgSrc;
    }
    
    // 开始播放
    if (this.isSequence) {
      // 序列帧动画
      if (!this.isPlaying) {
        this.isPlaying = true;
        this.animate(0);
      }
      // 如果已经在播放，循环会自动使用新参数
    } else {
      // 静态图片
      this.drawCurrentFrame();
      if (playOnce) {
        onComplete?.();
      }
    }
    
    return true;
  }

  /**
   * 加载图片（使用 LRU 缓存）
   * 
   * 优先从缓存获取，缓存未命中则加载并缓存
   * 使用 LRU 淘汰策略防止内存无限增长
   * 
   * @param imgSrc 图片 URL
   * @returns 加载成功返回 true，失败返回 false
   */
  private loadImage(imgSrc: string): Promise<boolean> {
    return new Promise((resolve) => {
      // 检查缓存（使用 LRU 获取）
      const cached = getFromImageCache(imgSrc);
      if (cached && cached.complete) {
        this.img = cached;
        resolve(true);
        return;
      }
      
      // 创建新图片并加载
      const newImg = new Image();
      
      newImg.onload = () => {
        // 添加到缓存（使用 LRU 添加）
        addToImageCache(imgSrc, newImg);
        this.img = newImg;
        resolve(true);
      };
      
      newImg.onerror = (e) => {
        console.error("Image failed to load:", e);
        resolve(false);
      };
      
      newImg.src = imgSrc;
    });
  }

  // =========================================================================
  // 公共方法 - 使用配置加载
  // =========================================================================

  /**
   * 使用配置对象加载动画
   * 
   * 底层加载方法，被 loadByStateName 和 loadByAssetName 调用
   * 负责实际的图片加载和参数初始化
   * 使用全局图片缓存避免重复加载
   * 
   * @param config 动画配置对象
   * @returns Promise，图片加载成功返回 true，失败返回 false
   */
  loadWithConfig(config: AnimationConfig): Promise<boolean> {
    return new Promise(async (resolve) => {
      // 初始化帧参数
      this.frameCountX = config.frameCountX;
      this.frameCountY = config.frameCountY;
      this.frameWidth = config.frameWidth;
      this.frameHeight = config.frameHeight;
      this.frameTime = config.frameTime;
      this.isSequence = config.sequence;
      this.needReverse = config.needReverse;
      this.offsetX = config.offsetX || 0;
      this.offsetY = config.offsetY || 0;
      this.isReversing = false;
      
      // 设置画布尺寸为单帧尺寸
      this.canvas.width = this.frameWidth;
      this.canvas.height = this.frameHeight;

      // 加载图片（使用缓存）
      const loaded = await this.loadImage(config.imgSrc);
      if (!loaded) {
        resolve(false);
        return;
      }
      
      this.currentImgSrc = config.imgSrc;
      
      // 如果不是序列帧，直接绘制静态图片
      if (!this.isSequence) {
        this.drawCurrentFrame();
      }
      
      resolve(true);
    });
  }

  // =========================================================================
  // 公共方法 - 播放控制
  // =========================================================================

  /**
   * 开始循环播放动画
   * 
   * 从当前帧开始持续播放，直到调用 stop() 为止
   * 非序列帧动画调用此方法无效
   */
  play(): void {
    // 非序列帧不需要播放动画
    if (!this.isSequence) return;
    
    // 防止重复启动
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.isPlayOnce = false;
    this.onCompleteCallback = null;
    this.lastTime = 0;
    this.animate(0);
  }

  /**
   * 播放一次动画后停止
   * 
   * 从第一帧开始播放，完成一轮后自动停止并触发回调
   * 非序列帧动画会直接绘制当前帧并触发回调
   * 
   * @param onComplete 播放完成后的回调函数（可选）
   */
  playOnce(onComplete?: () => void): void {
    // 非序列帧直接绘制并回调
    if (!this.isSequence) {
      this.drawCurrentFrame();
      onComplete?.();
      return;
    }
    
    // 防止重复启动
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.isPlayOnce = true;
    this.onCompleteCallback = onComplete || null;
    this.lastTime = 0;
    this.reset();  // 重置到第一帧
    this.animate(0);
  }

  /**
   * 停止播放动画
   * 
   * 取消 requestAnimationFrame 并将播放状态置为停止
   * 当前帧画面将保持在画布上
   */
  stop(): void {
    this.isPlaying = false;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * 重置动画到第一帧
   * 
   * 将帧索引归零并立即绘制第一帧
   * 不影响播放状态
   */
  reset(): void {
    this.frameX = 0;
    this.frameY = 0;
    this.lastTime = 0;
    this.isReversing = false;
    this.drawCurrentFrame();
  }

  /**
   * 获取画布（单帧）尺寸
   * 
   * @returns 包含 width 和 height 的对象
   */
  getSize(): { width: number; height: number } {
    return {
      width: this.frameWidth,
      height: this.frameHeight
    };
  }

  /**
   * 销毁动画器，释放资源
   * 
   * 停止播放并清空图片和上下文引用
   * 调用后此实例不应再被使用
   */
  destroy(): void {
    this.stop();
    this.img = null;
    this.ctx = null;
  }

  // =========================================================================
  // 私有方法 - 动画循环
  // =========================================================================

  /**
   * 动画主循环
   * 
   * 使用 requestAnimationFrame 实现的动画循环
   * 根据 frameTime 控制帧切换频率
   * 
   * @param time requestAnimationFrame 提供的时间戳
   */
  private animate = (time: number): void => {
    // 检查播放状态
    if (!this.isPlaying) return;

    // 检查资源是否就绪
    if (!this.ctx || !this.img || !this.img.complete) {
      this.animationId = requestAnimationFrame(this.animate);
      return;
    }

    // 根据帧时间间隔更新帧
    if (time - this.lastTime > this.frameTime) {
      this.drawCurrentFrame();
      this.advanceFrame();
      this.lastTime = time;
    }

    // 继续下一帧
    this.animationId = requestAnimationFrame(this.animate);
  };

  // =========================================================================
  // 私有方法 - 帧绘制
  // =========================================================================

  /**
   * 绘制当前帧
   * 
   * 从精灵图中切割出当前帧区域并绘制到画布
   * 支持渲染偏移量
   */
  private drawCurrentFrame(): void {
    if (!this.ctx || !this.img) return;

    // 清空画布
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // 计算精灵图中当前帧的源坐标
    const sx = this.frameX * this.frameWidth;
    const sy = this.frameY * this.frameHeight;

    // 应用偏移量绘制到画布
    this.ctx.drawImage(
      this.img,
      sx, sy, this.frameWidth, this.frameHeight,        // 源区域
      this.offsetX, this.offsetY, this.frameWidth, this.frameHeight  // 目标区域（含偏移）
    );
  }

  // =========================================================================
  // 私有方法 - 帧推进
  // =========================================================================

  /**
   * 推进到下一帧
   * 
   * 处理帧索引的更新，支持以下模式：
   * - 正向循环：到达最后一帧后回到第一帧
   * - 乒乓模式：到达最后一帧后反向播放到第一帧
   * - 单次播放：完成一轮后停止并触发回调
   * 
   * 帧遍历顺序：
   * - 先水平（X 方向）遍历一行
   * - 行末换到下一行继续
   */
  private advanceFrame(): void {
    if (this.isReversing) {
      // -----------------------------------------------------------------------
      // 反向播放阶段
      // -----------------------------------------------------------------------
      this.frameX--;
      if (this.frameX < 0) {
        // 当前行播放完毕，切换到上一行
        this.frameX = this.frameCountX - 1;
        this.frameY--;
        if (this.frameY < 0) {
          // 反向播放完成，切换回正向
          this.isReversing = false;
          this.frameX = 0;
          this.frameY = 0;
          // 如果是单次播放模式，触发回调并停止
          if (this.isPlayOnce) {
            this.stop();
            this.onCompleteCallback?.();
            return;
          }
        }
      }
    } else {
      // -----------------------------------------------------------------------
      // 正向播放阶段
      // -----------------------------------------------------------------------
      this.frameX++;
      if (this.frameX >= this.frameCountX) {
        // 当前行播放完毕，切换到下一行
        this.frameX = 0;
        this.frameY++;
        if (this.frameY >= this.frameCountY) {
          // 所有帧播放完毕
          if (this.needReverse) {
            // 乒乓模式：切换到反向播放
            this.isReversing = true;
            // 从倒数第二帧开始反向（避免最后一帧重复播放）
            this.frameX = this.frameCountX - 2;
            this.frameY = this.frameCountY - 1;
            // 处理边界情况（帧数过少）
            if (this.frameX < 0) {
              this.frameX = this.frameCountX - 1;
              this.frameY--;
              if (this.frameY < 0) {
                // 帧数太少，无法形成有效的乒乓动画
                this.frameY = 0;
                this.frameX = 0;
                this.isReversing = false;
              }
            }
          } else {
            // 普通循环模式：回到第一帧
            this.frameY = 0;
            // 如果是单次播放模式，触发回调并停止
            if (this.isPlayOnce) {
              this.stop();
              this.onCompleteCallback?.();
              return;
            }
          }
        }
      }
    }
  }
}

// ========================================================================= //
// createAnimator - 便捷工厂函数
// ========================================================================= //
//
// 提供一站式的动画器创建流程：
// 1. 创建 SpriteAnimator 实例
// 2. 加载指定状态的动画资源
// 3. 可选自动开始播放
//
// 失败时会自动清理资源并返回 null
//

/**
 * 创建并初始化精灵动画播放器
 * 
 * 便捷工厂函数，封装了创建、加载和播放的完整流程
 * 
 * @param canvas 目标画布元素
 * @param stateName 要加载的状态名称
 * @param autoPlay 是否自动开始播放，默认 true
 * @returns 成功返回 SpriteAnimator 实例，失败返回 null
 * 
 * @example
 * ```typescript
 * const animator = await createAnimator(canvas, "idle");
 * if (animator) {
 *   // 动画已经开始播放
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
    // 加载失败，清理资源
    animator.destroy();
    return null;
  }

  if (autoPlay) {
    animator.play();
  }

  return animator;
}
