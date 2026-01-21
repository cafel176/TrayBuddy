import { invoke, convertFileSrc } from "@tauri-apps/api/core";

/**
 * 资产信息接口
 */
export interface AssetInfo {
  name: string;
  img: string;

  sequence: boolean;
  need_reverse: boolean;
  frame_time: number;

  frame_size_x: number;
  frame_size_y: number;

  frame_num_x: number;
  frame_num_y: number;
}

/**
 * 动画配置
 */
export interface AnimationConfig {
  frameCountX: number;
  frameCountY: number;
  frameWidth: number;
  frameHeight: number;
  frameTime: number;
  imgSrc: string;
  sequence: boolean; // 是否为序列帧动画
  needReverse: boolean; // 是否需要反向播放
}

/**
 * Sprite 动画播放器类
 */
export class SpriteAnimator {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private img: HTMLImageElement | null = null;
  
  private frameX = 0;
  private frameY = 0;
  private frameCountX = 1;
  private frameCountY = 1;
  private frameWidth = 0;
  private frameHeight = 0;
  private frameTime = 100;
  private lastTime = 0;
  
  private animationId: number | null = null;
  private isPlaying = false;
  private isSequence = true; // 是否为序列帧动画
  private needReverse = false; // 是否需要反向播放
  private isReversing = false; // 当前是否正在反向播放
  private isPlayOnce = false; // 是否只播放一次
  private onCompleteCallback: (() => void) | null = null; // 播放完成回调

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  /**
   * 根据动作名称加载动画资源
   * @param actionName 动作名称（如 "idle", "border"）
   */
  async loadByActionName(actionName: string): Promise<boolean> {
    try {
      // 1. 获取 ActionInfo
      const action: any = await invoke("get_action_by_name", { name: actionName });
      if (!action) {
        console.error(`Action '${actionName}' not found`);
        return false;
      }

      // 2. 获取 AssetInfo
      const asset: AssetInfo | null = await invoke("get_asset_by_name", { name: action.anima });
      if (!asset) {
        console.error(`Asset '${action.anima}' not found for action '${actionName}'`);
        return false;
      }

      // 3. 获取 mod 路径
      const modPath: string | null = await invoke("get_mod_path");
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
        sequence: asset.sequence !== false, // 默认为 true
        needReverse: asset.need_reverse === true // 默认为 false
      };

      return this.loadWithConfig(config);
    } catch (e) {
      console.error(`Failed to load animation for action '${actionName}':`, e);
      return false;
    }
  }

  /**
   * 使用配置加载动画
   */
  loadWithConfig(config: AnimationConfig): Promise<boolean> {
    return new Promise((resolve) => {
      this.frameCountX = config.frameCountX;
      this.frameCountY = config.frameCountY;
      this.frameWidth = config.frameWidth;
      this.frameHeight = config.frameHeight;
      this.frameTime = config.frameTime;
      this.isSequence = config.sequence;
      this.needReverse = config.needReverse;
      this.isReversing = false;

      this.img = new Image();
      
      this.img.onload = () => {
        this.canvas.width = this.frameWidth;
        this.canvas.height = this.frameHeight;
        
        // 如果不是序列帧，直接绘制静态图片
        if (!this.isSequence) {
          this.drawCurrentFrame();
        }
        
        resolve(true);
      };

      this.img.onerror = (e) => {
        console.error("Image failed to load:", e);
        resolve(false);
      };

      this.img.src = config.imgSrc;
    });
  }

  /**
   * 开始播放动画
   */
  play(): void {
    // 非序列帧不需要播放动画
    if (!this.isSequence) return;
    
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.isPlayOnce = false;
    this.onCompleteCallback = null;
    this.lastTime = 0;
    this.animate(0);
  }

  /**
   * 播放一次动画，完成后调用回调
   */
  playOnce(onComplete?: () => void): void {
    // 非序列帧直接绘制并回调
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
    this.reset();
    this.animate(0);
  }

  /**
   * 停止播放动画
   */
  stop(): void {
    this.isPlaying = false;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * 重置到第一帧
   */
  reset(): void {
    this.frameX = 0;
    this.frameY = 0;
    this.lastTime = 0;
    this.isReversing = false;
    this.drawCurrentFrame();
  }

  /**
   * 获取 canvas 尺寸
   */
  getSize(): { width: number; height: number } {
    return {
      width: this.frameWidth,
      height: this.frameHeight
    };
  }

  /**
   * 销毁动画器，释放资源
   */
  destroy(): void {
    this.stop();
    this.img = null;
    this.ctx = null;
  }

  private animate = (time: number): void => {
    if (!this.isPlaying) return;

    if (!this.ctx || !this.img || !this.img.complete) {
      this.animationId = requestAnimationFrame(this.animate);
      return;
    }

    if (time - this.lastTime > this.frameTime) {
      this.drawCurrentFrame();
      this.advanceFrame();
      this.lastTime = time;
    }

    this.animationId = requestAnimationFrame(this.animate);
  };

  private drawCurrentFrame(): void {
    if (!this.ctx || !this.img) return;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    const sx = this.frameX * this.frameWidth;
    const sy = this.frameY * this.frameHeight;

    this.ctx.drawImage(
      this.img,
      sx, sy, this.frameWidth, this.frameHeight,
      0, 0, this.frameWidth, this.frameHeight
    );
  }

  private advanceFrame(): void {
    if (this.isReversing) {
      // 反向播放
      this.frameX--;
      if (this.frameX < 0) {
        this.frameX = this.frameCountX - 1;
        this.frameY--;
        if (this.frameY < 0) {
          // 反向播放完成，切换回正向
          this.isReversing = false;
          this.frameX = 0;
          this.frameY = 0;
          // 如果是播放一次模式，触发回调并停止
          if (this.isPlayOnce) {
            this.stop();
            this.onCompleteCallback?.();
            return;
          }
        }
      }
    } else {
      // 正向播放
      this.frameX++;
      if (this.frameX >= this.frameCountX) {
        this.frameX = 0;
        this.frameY++;
        if (this.frameY >= this.frameCountY) {
          if (this.needReverse) {
            // 正向播放完成，切换到反向播放
            this.isReversing = true;
            // 从最后一帧开始反向（跳过最后一帧避免重复）
            this.frameX = this.frameCountX - 2;
            this.frameY = this.frameCountY - 1;
            if (this.frameX < 0) {
              this.frameX = this.frameCountX - 1;
              this.frameY--;
              if (this.frameY < 0) {
                this.frameY = 0;
                this.frameX = 0;
                this.isReversing = false;
              }
            }
          } else {
            // 普通循环，回到第一帧
            this.frameY = 0;
            // 如果是播放一次模式，触发回调并停止
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

/**
 * 便捷函数：创建并初始化动画播放器
 */
export async function createAnimator(
  canvas: HTMLCanvasElement,
  actionName: string,
  autoPlay = true
): Promise<SpriteAnimator | null> {
  const animator = new SpriteAnimator(canvas);
  const success = await animator.loadByActionName(actionName);
  
  if (!success) {
    animator.destroy();
    return null;
  }

  if (autoPlay) {
    animator.play();
  }

  return animator;
}
