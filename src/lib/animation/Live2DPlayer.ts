import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  buildModAssetUrlForLive2D,
  decodeFileSrcUrl,
  joinPath,
  normalizePath,
  parseArchiveVirtualPath,
} from "../utils/modAssetUrl";
import { getRenderDpr, getRenderMaxFps, isAntialiasEnabled } from "./render_tuning";
import {
  getMotionPriority,
  buildNameKey,
  computeLive2DDecodeTarget as computeDecodeTarget,
  normalizeFsPath,
  normalizeStartDim,
  type Live2DTextureDecodePolicy,
} from "./animation_utils";

import type {
  Live2DConfig,
  Live2DExpression,
  Live2DMotion,
  Live2DState,
  Live2DParameterSetting,
  Live2DBackgroundLayer,
} from "$lib/types/asset";

/** Live2D 功能开关（鼠标跟随/自动交互）。 */
export type Live2DFeatureFlags = {
  mouseFollow: boolean;
  autoInteract: boolean;
};

/** Live2D 播放器初始化参数。 */
export type Live2DPlayerOptions = {
  featureFlags?: Live2DFeatureFlags;
};


type MotionEntry = {
  group: string;
  index: number;
  motion: Live2DMotion;
};

type PlayOptions = {
  playOnce: boolean;
  animationScale: number;
  onComplete: () => void;
  live2dParams?: Live2DParameterSetting[];
};

declare global {
  interface Window {
    PIXI?: any;
    Live2DCubismCore?: any;
  }
}

let live2dLibPromise: Promise<void> | null = null;



/**
 * 将文件路径转换为可在 WebView 中使用的 URL，保留路径层级结构。
 *
 * - Archive mod (tbuddy-archive://): 通过 buildModAssetUrlForLive2D 生成平台兼容的 URL
 * - 文件夹 mod: convertFileSrc + 还原 %2F/%3A
 */
function toAssetUrl(filePath: string): string {
  const normalized = normalizePath(filePath);
  const parsed = parseArchiveVirtualPath(normalized);
  if (parsed) {
    return buildModAssetUrlForLive2D(parsed.modPath, parsed.relativePath);
  }
  return decodeFileSrcUrl(convertFileSrc(normalized));
}


/**
 * 动态加载脚本并去重。
 *
 * 通过 data-live2d-src 标记避免重复插入，
 * 并在已存在脚本完成加载后复用 Promise。
 */
function loadScript(src: string): Promise<void> {

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-live2d-src="${src}"]`);
    if (existing) {
      if (existing.getAttribute("data-loaded") === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error(`Failed to load ${src}`)),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.setAttribute("data-live2d-src", src);
    script.addEventListener(
      "load",
      () => {
        script.setAttribute("data-loaded", "true");
        resolve();
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => reject(new Error(`Failed to load ${src}`)),
      { once: true },
    );
    document.head.appendChild(script);
  });
}

/**
 * 确保 Live2D 渲染依赖已加载并可用。
 *
 * 首次调用时会加载 pixi / live2dcubismcore / pixi-live2d-display，
 * 后续调用会复用同一个初始化 Promise。
 */
async function ensureLive2DLibs(): Promise<void> {

  if (window.PIXI && window.PIXI.live2d?.Live2DModel && window.Live2DCubismCore) {
    // SDK 已加载，但仍需确保 CubismConfig 已设置（组件重新挂载时可能走到这里）
    applyCubism4Config();
    return;
  }

  if (!live2dLibPromise) {
    live2dLibPromise = (async () => {
      await loadScript("/pixi.min.js");
      await loadScript("/live2dcubismcore.min.js");
      await loadScript("/pixi-live2d-display.min.js");
    })();
  }

  await live2dLibPromise;

  if (!window.PIXI || !window.PIXI.live2d?.Live2DModel) {
    throw new Error("Live2D libs not loaded");
  }
  if (!window.Live2DCubismCore) {
    throw new Error("Live2D Cubism Core not loaded");
  }

  applyCubism4Config();
}

/**
 * 启用 motion 文件中 PartOpacity 曲线的正确应用。
 *
 * SDK 默认 setOpacityFromMotion=false，此时 motion3.json 中 Target:"PartOpacity"
 * 的曲线会被错误地当作 Parameter 处理（按 Part ID 查找 Parameter Index），
 * 导致找不到对应 Parameter 而被跳过，PartOpacity 不生效。
 * 设为 true 后 SDK 会调用 setPartOpacityById 正确设置部件透明度。
 */
function applyCubism4Config(): void {
  // CubismConfig 对象在 SDK 中有两个访问路径：
  //   1. window.PIXI.live2d.CubismConfig   （直接导出）
  //   2. window.PIXI.live2d.config.cubism4  （通过 config 属性）
  // 两者指向同一个对象，修改任意一个即可。
  const cubism4Config =
    window.PIXI?.live2d?.CubismConfig ??
    window.PIXI?.live2d?.config?.cubism4;
  if (cubism4Config) {
    cubism4Config.setOpacityFromMotion = true;
  }
}

// getMotionPriority, buildNameKey 已提取到 animation_utils.ts

function dbg(_tag: string, ..._args: any[]) {}

type BackendModInfo = {
  path?: string;
  manifest?: {
    enable_texture_downsample?: boolean;
    texture_downsample_start_dim?: number;
  };
} | null;

// normalizeFsPath, normalizeStartDim 已提取到 animation_utils.ts

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type TextureDownsampleSettings = {
  enabled: boolean;
  startDim: number;
};

// normalizeStartDim 已提取到 animation_utils.ts

/**
 * 从后端读取当前 Mod 的贴图降采样设置：
 * - manifest.enable_texture_downsample
 * - manifest.texture_downsample_start_dim
 *
 * 说明：
 * - **启动/切换 Mod** 时，这里以 backend 的 `get_current_mod` 为准，避免前端缓存造成时序错乱。
 * - 若 `get_current_mod.path` 与当前要加载的 `expectedModPath` 不一致，会短暂重试。
 * - 两个字段在同一次 `get_current_mod` 里读取，避免切换时出现“读到不同 mod 的字段”的竞态。
 */
async function resolveTextureDownsampleSettingsFromBackend(
  expectedModPath: string,
  fallback?: Partial<TextureDownsampleSettings>,
): Promise<TextureDownsampleSettings> {
  const expected = normalizeFsPath(expectedModPath);

  const fbEnabled = typeof fallback?.enabled === "boolean" ? fallback.enabled : null;
  const fbStartDim = normalizeStartDim(fallback?.startDim);

  let lastEnabled: boolean | null = null;
  let lastStartDim: number | null = null;

  for (let i = 0; i < 12; i++) {
    try {
      const mod = (await invoke("get_current_mod")) as BackendModInfo;
      const p = mod?.path ? normalizeFsPath(String(mod.path)) : "";

      const vEnabled = mod?.manifest?.enable_texture_downsample;
      if (typeof vEnabled === "boolean") {
        lastEnabled = vEnabled;
      }

      const vStartDim = normalizeStartDim(mod?.manifest?.texture_downsample_start_dim);
      if (vStartDim !== null) {
        lastStartDim = vStartDim;
      }

      const enabled = lastEnabled ?? fbEnabled;
      const startDim = lastStartDim ?? fbStartDim;

      if (expected && p && p === expected && enabled !== null && startDim !== null) {
        return { enabled, startDim };
      }

      // 如果没有期望路径（极少见），那就尽量用后端的值
      if (!expected && enabled !== null && startDim !== null) {
        return { enabled, startDim };
      }

    } catch {
      // ignore
    }

    if (i < 11) await sleepMs(80);
  }

  return {
    enabled: lastEnabled ?? fbEnabled ?? false,
    startDim: lastStartDim ?? fbStartDim ?? 0,
  };
}

// ============================================================================
// Live2D 贴图优化：记录逻辑尺寸 + 降采样（默认开启） + LRU（默认关闭）
// ============================================================================

// 降采样策略默认值/阈值
const LIVE2D_TEX_OPT_SCALE_DEFAULT = 1;      // 额外倍率（0-1）
const LIVE2D_TEX_OPT_MIN_SCALE = 0.05;
const LIVE2D_TEX_OPT_NO_RESIZE_EPS = 0.999;
const LIVE2D_TEX_OPT_RESIZE_QUALITY = "high" as any;

// 降采样后放大策略（全局开关）
// - 默认：pixelated/nearest（更清晰但更锯齿）
// - 可通过 localStorage 的 `tb_live2d_upscale_mode` 切换："pixelated"/"nearest"/"none" 或 "high"/"linear"/"smooth"
type Live2DUpscaleMode = "high" | "pixelated";
const LIVE2D_UPSCALE_MODE_KEY = "tb_live2d_upscale_mode";
const LIVE2D_UPSCALE_MODE_DEFAULT: Live2DUpscaleMode = "high";

// LRU 默认值/阈值（默认关闭）
const LIVE2D_TEX_LRU_ENABLED_DEFAULT = false;
const LIVE2D_TEX_LRU_MAX_ITEMS_DEFAULT = 256;
const LIVE2D_TEX_LRU_MAX_MB_DEFAULT = 512;
const LIVE2D_TEX_LRU_MIN_ITEMS = 32;
const LIVE2D_TEX_LRU_MIN_MB = 16;

// Live2DTextureDecodePolicy, computeDecodeTarget 已提取到 animation_utils.ts

function readLocalStorageNumber(key: string, defaultValue: number): number {
  try {
    if (typeof localStorage === "undefined") return defaultValue;
    const raw = localStorage.getItem(key);
    if (raw == null || raw === "") return defaultValue;
    const n = Number(raw);
    return Number.isFinite(n) ? n : defaultValue;
  } catch {
    return defaultValue;
  }
}

function readLocalStorageBool(key: string, defaultValue: boolean): boolean {
  try {
    if (typeof localStorage === "undefined") return defaultValue;
    const raw = localStorage.getItem(key);
    if (raw == null) return defaultValue;
    if (raw === "1" || raw === "true") return true;
    if (raw === "0" || raw === "false") return false;
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

function readLocalStorageString(key: string, defaultValue: string): string {
  try {
    if (typeof localStorage === "undefined") return defaultValue;
    const raw = localStorage.getItem(key);
    return raw == null ? defaultValue : String(raw);
  } catch {
    return defaultValue;
  }
}

function getLive2DUpscaleMode(): Live2DUpscaleMode {
  const v = readLocalStorageString(LIVE2D_UPSCALE_MODE_KEY, LIVE2D_UPSCALE_MODE_DEFAULT).toLowerCase();
  if (v === "pixelated" || v === "nearest" || v === "none") return "pixelated";
  if (v === "high" || v === "linear" || v === "smooth") return "high";
  return LIVE2D_UPSCALE_MODE_DEFAULT;
}

function applyLive2DCanvasResampleSettings(ctx: CanvasRenderingContext2D): void {
  const mode = getLive2DUpscaleMode();
  if (mode === "pixelated") {
    ctx.imageSmoothingEnabled = false;
    return;
  }
  ctx.imageSmoothingEnabled = true;
  (ctx as any).imageSmoothingQuality = LIVE2D_TEX_OPT_RESIZE_QUALITY;
}

function applyLive2DBaseTextureScaleMode(bt: any): void {
  const PIXI = (window as any).PIXI;
  const scaleModes = PIXI?.SCALE_MODES;
  if (!scaleModes || !bt) return;

  const mode = getLive2DUpscaleMode();
  const desired = (mode === "pixelated") ? scaleModes.NEAREST : scaleModes.LINEAR;
  if (desired === undefined || desired === null) return;

  try { bt.scaleMode = desired; } catch { /* ignore */ }
  // 某些 Pixi 版本需要 update 才会把 scaleMode 应用到 GPU sampler
  try { bt.update?.(); } catch { /* ignore */ }
}


// computeDecodeTarget 已提取到 animation_utils.ts

function getDrawableSize(src: any): { w: number; h: number } {
  if (!src) return { w: 0, h: 0 };
  if (typeof ImageBitmap !== "undefined" && src instanceof ImageBitmap) return { w: src.width, h: src.height };
  if (src instanceof HTMLImageElement) return { w: src.naturalWidth || src.width, h: src.naturalHeight || src.height };
  if (src instanceof HTMLCanvasElement) return { w: src.width, h: src.height };
  return { w: Number(src.width) || 0, h: Number(src.height) || 0 };
}

function getDrawableLogicalSize(src: any): { w: number; h: number } {
  if (!src) return { w: 0, h: 0 };
  const lw = Number((src as any)._logicalW);
  const lh = Number((src as any)._logicalH);
  if (Number.isFinite(lw) && Number.isFinite(lh) && lw > 0 && lh > 0) return { w: lw, h: lh };
  return getDrawableSize(src);
}

async function downsampleToCanvas(src: any, tw: number, th: number): Promise<HTMLCanvasElement | null> {
  const { w: lw, h: lh } = getDrawableLogicalSize(src);
  const { w: sw, h: sh } = getDrawableSize(src);
  if (!sw || !sh) return null;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(tw));
  canvas.height = Math.max(1, Math.floor(th));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  applyLive2DCanvasResampleSettings(ctx);
  try {
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }

  // 记录“逻辑尺寸”（原图尺寸），便于 Sprite 侧按需放大回原逻辑大小
  (canvas as any)._logicalW = lw || sw;
  (canvas as any)._logicalH = lh || sh;
  return canvas;
}

type Live2DLruEntry = { bytes: number; lastUsed: number; pinned: number };

class Live2DTextureLRU {
  private static lru = new Map<string, Live2DLruEntry>();
  private static totalBytes = 0;

  static enabled(): boolean {
    return readLocalStorageBool("tb_live2d_tex_lru", LIVE2D_TEX_LRU_ENABLED_DEFAULT);
  }

  static limits(): { maxItems: number; maxBytes: number } {
    const maxItems = Math.max(LIVE2D_TEX_LRU_MIN_ITEMS, Math.floor(readLocalStorageNumber("tb_live2d_tex_lru_max_items", LIVE2D_TEX_LRU_MAX_ITEMS_DEFAULT)));
    const maxMb = Math.max(LIVE2D_TEX_LRU_MIN_MB, readLocalStorageNumber("tb_live2d_tex_lru_max_mb", LIVE2D_TEX_LRU_MAX_MB_DEFAULT));
    return { maxItems, maxBytes: Math.floor(maxMb * 1024 * 1024) };
  }

  static touch(key: string, bytes: number): void {
    if (!key) return;
    const now = performance.now();
    let e = this.lru.get(key);
    if (!e) {
      e = { bytes: Math.max(0, Math.floor(bytes || 0)), lastUsed: now, pinned: 0 };
      this.lru.set(key, e);
      this.totalBytes += e.bytes;
    } else {
      e.lastUsed = now;
      // bytes 变化（例如降采样后变小）时更新
      const b = Math.max(0, Math.floor(bytes || 0));
      if (Number.isFinite(b) && b >= 0 && b !== e.bytes) {
        this.totalBytes += (b - e.bytes);
        e.bytes = b;
      }
    }

    if (this.enabled()) this.trim();
  }

  static pin(key: string): void {
    if (!key) return;
    const e = this.lru.get(key) ?? { bytes: 0, lastUsed: performance.now(), pinned: 0 };
    e.pinned += 1;
    this.lru.set(key, e);
  }

  static unpin(key: string): void {
    const e = this.lru.get(key);
    if (!e) return;
    e.pinned = Math.max(0, e.pinned - 1);
  }

  static trim(): void {
    if (!this.enabled()) return;

    const { maxItems, maxBytes } = this.limits();
    const overItems = this.lru.size > maxItems;
    const overBytes = this.totalBytes > maxBytes;
    if (!overItems && !overBytes) return;

    // 只淘汰未 pinned 的最久未使用条目
    while (this.lru.size > maxItems || this.totalBytes > maxBytes) {
      let victimKey: string | null = null;
      let bestTs = Infinity;
      for (const [k, e] of this.lru.entries()) {
        if (e.pinned > 0) continue;
        if (e.lastUsed < bestTs) {
          bestTs = e.lastUsed;
          victimKey = k;
        }
      }
      if (!victimKey) break;
      this.evictFromPixiCaches(victimKey);
      const e = this.lru.get(victimKey);
      if (e) this.totalBytes -= e.bytes;
      this.lru.delete(victimKey);
    }
  }

  private static evictFromPixiCaches(key: string): void {
    const PIXI = (window as any).PIXI;
    if (!PIXI) return;

    const texCache = PIXI?.utils?.TextureCache ?? PIXI?.TextureCache ?? {};
    const baseCache = PIXI?.utils?.BaseTextureCache ?? PIXI?.BaseTextureCache ?? {};

    try {
      const tex = texCache[key];
      tex?.destroy?.(true);
    } catch {
      // ignore
    }
    try {
      const bt = baseCache[key];
      bt?.destroy?.();
    } catch {
      // ignore
    }

    try {
      if (PIXI?.Texture?.removeFromCache) PIXI.Texture.removeFromCache(key);
      else delete texCache[key];
    } catch {
      // ignore
    }
    try {
      if (PIXI?.BaseTexture?.removeFromCache) PIXI.BaseTexture.removeFromCache(key);
      else delete baseCache[key];
    } catch {
      // ignore
    }
  }
}

/**
 * Live2DPlayer
 *
 * 负责 Live2D 模型的加载、播放与交互：
 * - 动作/表情管理与优先级控制
 * - 鼠标跟随与参数覆写
 * - 背景与前景图层渲染
 */
export class Live2DPlayer {

  private canvas: HTMLCanvasElement;
  private app: any | null = null;

  /**
   * 世界容器：将 model + background_layers 放在同一个容器里统一缩放/居中。
   * 这样“角色缩放”变化时，背景/资源会自动同步。
   */
  private world: any | null = null;

  private model: any | null = null;
  private config: Live2DConfig | null = null;
  private modPath = "";

  /** 当前 Mod 是否允许贴图降采样（来源：后端 manifest.enable_texture_downsample）。 */
  private modDownsampleEnabled = false;
  /** 触发降采样的贴图尺寸阈值（来源：后端 manifest.texture_downsample_start_dim；0 表示不限制）。 */
  private modDownsampleStartDim = 0;

  private featureFlags: Live2DFeatureFlags;
  private motionMap = new Map<string, MotionEntry>();
  private expressionMap = new Map<string, number>();
  private motionDurationCache = new Map<string, number>();
  private resizeObserver: ResizeObserver | null = null;
  private lastResizeWidth = 0;
  private lastResizeHeight = 0;
  private lastResizeDpr = 0;
  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private playToken = 0;
  private playTimer: ReturnType<typeof setTimeout> | null = null;
  private motionFinishHandler: (() => void) | null = null;
  private activeState: Live2DState | null = null;
  private animationScale = 1;
  private modelScale = 1;
  private baseFitScale = 1;
  private paramOverrideCleanup: (() => void) | null = null;

  // 全局鼠标追踪（穿透状态下也生效）
  private hasMouseParams = false;
  private hasCustomMouseXY = false; // 模型是否有 ParamMouseX/Y 自定义参数
  private mouseXYCleanup: (() => void) | null = null;
  private latestMouseX = 0; // 归一化后的鼠标 X（-1 ~ 1 映射到参数范围）
  private latestMouseY = 0; // 归一化后的鼠标 Y

  // Debug 视角控制
  private debugMode = false;
  private debugScale = 1;
  private debugOffsetX = 0;
  private debugOffsetY = 0;

  // 背景/叠加图层 Sprite
  private bgSpriteBehind: any[] = [];  // layer="behind" 的 PIXI.Sprite（模型之后）
  private bgSpriteFront: any[] = [];   // layer="front" 的 PIXI.Sprite（模型之前）
  private bgLayerConfigs: Live2DBackgroundLayer[] = [];
  private bgSpriteMap = new Map<string, any>(); // name -> PIXI.Sprite

  // 背景层创建时的模型缩放（用于兼容旧逻辑；当前主要用于调试/排查）
  private bgBaseModelScale = 1;

  // 贴图优化：当前模型资源前缀（用于判定“哪些贴图属于当前 Live2D 模型”）
  private assetUrlPrefix = "";
  private pinnedTextureKeys = new Set<string>();
  private bgTextureKeys = new Set<string>();


  // 贴图优化：全局 Loader middleware 是否已安装
  private static texOptInstalled = false;
  private static texOptPlayers = new Set<Live2DPlayer>();

  // 贴图优化：对 PIXI.BaseTexture.from(url) 的 hook（用于处理绕过 Loader 的加载路径）
  private static texOptBaseTextureFromInstalled = false;




  constructor(canvas: HTMLCanvasElement, options?: Live2DPlayerOptions) {
    this.canvas = canvas;
    this.featureFlags = {
      mouseFollow: true,
      autoInteract: true,
      ...options?.featureFlags,
    };
  }

  /**
   * 初始化 Live2D 渲染环境与事件绑定。
   */
  async init(): Promise<void> {

    dbg("init", "start, canvas:", this.canvas.clientWidth, "x", this.canvas.clientHeight);
    await ensureLive2DLibs();
    dbg("init", "libs loaded, PIXI:", !!window.PIXI, "CubismCore:", !!window.Live2DCubismCore);

    // 注册贴图优化（按需安装全局 Loader middleware）
    Live2DPlayer.installGlobalTextureOptimizer();
    Live2DPlayer.texOptPlayers.add(this);


    this.initPixiApp();
    this.bindResize();
    this.bindMouseFollow();
    dbg("init", "done");
  }

  /**
   * 销毁渲染资源与事件监听。
   */
  destroy(): void {

    this.playToken += 1;
    this.clearPlayTimer();
    this.detachMotionFinishHandler();
    this.unbindMouseFollow();
    this.cleanupParamOverride();
    this.cleanupMouseXYHook();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.motionDurationCache.clear();
    this.removeBackgroundLayers();

    if (this.model && this.app) {
      this.app.stage.removeChild(this.model);
      this.model.destroy();
    }
    this.model = null;

    // 贴图优化：解除 pinned，允许 LRU 淘汰
    this.updatePinnedTextureKeys(new Set());
    Live2DPlayer.texOptPlayers.delete(this);

    // 清理 PIXI 全局 TextureCache / BaseTextureCache 中当前模型的贴图资源，
    // 避免切换 Mod 后旧模型的 GPU 纹理残留。
    this.cleanupPixiGlobalCaches();

    this.app?.destroy(true, { children: true });
    this.app = null;
    this.world = null;
    this.config = null;

    this.motionMap.clear();
    this.expressionMap.clear();
    this.pinnedTextureKeys.clear();
    this.bgTextureKeys.clear();
    this.assetUrlPrefix = "";
  }


  /**
   * 更新功能开关并同步鼠标跟随。
   */
  setFeatureFlags(flags: Live2DFeatureFlags): void {

    this.featureFlags = { ...flags };
    this.applyFeatureFlags();
    this.bindMouseFollow();
  }

  /**
   * 设置模型可见性。
   */
  setVisible(visible: boolean): void {

    if (this.model) {
      this.model.visible = visible;
    }
  }

  /**
   * 设置全局动画缩放（由 WindowCore 控制）。
   */
  setAnimationScale(scale: number): void {

    this.animationScale = scale;
    this.applyCurrentTransform();
  }

  /**
   * 检测 canvas 上指定坐标附近是否存在不透明像素。
   * 使用多点采样（中心 + 周围扩展），在模型边缘提供足够的容差，
   * 使穿透可以在鼠标到达模型之前提前关闭（与 animation 窗口的"矩形大于实际 canvas"策略类似）。
   * @param screenX 窗口内 X 坐标（CSS 逻辑坐标）
   * @param screenY 窗口内 Y 坐标（CSS 逻辑坐标）
   * @param alphaThreshold alpha 阈值（0-255），低于此值视为透明
   * @returns true = 不透明（拦截鼠标），false = 透明（允许穿透）
   */
  isPixelOpaqueAtScreen(screenX: number, screenY: number, alphaThreshold = 10): boolean {
    if (!this.app) return false;

    const gl = this.app.renderer.gl as WebGLRenderingContext | undefined;
    if (!gl) return false;

    const rect = this.canvas.getBoundingClientRect();
    const resolution = this.app.renderer.resolution || 1;

    // 多层采样：提前在模型周围 ~30px CSS 范围内就判定为"在交互区"
    // 这样穿透会在鼠标到达模型之前提前关闭，确保 cursor 样式及时生效
    const MARGINS = [0, 15, 30];
    const pixel = new Uint8Array(4);

    for (const margin of MARGINS) {
      const offsets = margin === 0
        ? [[0, 0]]
        : [
            [-margin, 0], [margin, 0],
            [0, -margin], [0, margin],
            [-margin, -margin], [margin, -margin],
            [-margin, margin], [margin, margin],
          ];

      for (const [dx, dy] of offsets) {
        const cssX = screenX - rect.left + dx;
        const cssY = screenY - rect.top + dy;

        if (cssX < 0 || cssY < 0 || cssX >= rect.width || cssY >= rect.height) {
          continue;
        }

        const px = Math.round(cssX * resolution);
        const py = Math.round((rect.height - cssY) * resolution);

        gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

        if (pixel[3] >= alphaThreshold) {
          return true;
        }
      }
    }

    return false;
  }

  // =========================================================================
  // Debug 视角控制
  // =========================================================================

  /**
   * 进入/退出调试视角模式（缩放/偏移可调）。
   */
  setDebugMode(enabled: boolean): void {

    this.debugMode = enabled;
    if (!enabled) {
      this.debugScale = 1;
      this.debugOffsetX = 0;
      this.debugOffsetY = 0;
    }
    this.applyStateTransform();
    dbg("debugMode", enabled ? "ON" : "OFF");
  }

  debugZoom(delta: number): void {
    this.debugScale = Math.max(0.05, Math.min(10, this.debugScale + delta));
    this.applyStateTransform();
    dbg("debugZoom", "scale:", this.debugScale.toFixed(3));
  }

  debugPan(dx: number, dy: number): void {
    this.debugOffsetX += dx;
    this.debugOffsetY += dy;
    this.applyStateTransform();
    dbg("debugPan", "offset:", this.debugOffsetX.toFixed(0), this.debugOffsetY.toFixed(0));
  }

  debugReset(): void {
    this.debugScale = 1;
    this.debugOffsetX = 0;
    this.debugOffsetY = 0;
    this.applyStateTransform();
    dbg("debugReset", "reset to defaults");
  }

  getDebugInfo(): { scale: number; offsetX: number; offsetY: number; baseFitScale: number; finalScale: number } {
    const stateScale = this.activeState
      ? (Number.isFinite(this.activeState.scale) ? this.activeState.scale : 1)
      : 1;

    const modelScale = Number.isFinite(this.modelScale) && this.modelScale > 0
      ? this.modelScale
      : 1;

    // Live2D 窗口缩放：使用 WindowCore 的 animationScale，使“窗口缩放”和“角色/背景”同步。
    const animScale = Number.isFinite(this.animationScale) && this.animationScale > 0 ? this.animationScale : 1;

    return {
      scale: this.debugScale,
      offsetX: this.debugOffsetX,
      offsetY: this.debugOffsetY,
      baseFitScale: this.baseFitScale,
      finalScale: this.baseFitScale * modelScale * stateScale * this.debugScale * animScale,
    };
  }

  /**
   * 加载 Live2D 模型与资源映射，并应用基础缩放/叠加层。
   */
  async load(modPath: string, config: Live2DConfig, manifest?: { enable_texture_downsample?: boolean; texture_downsample_start_dim?: number }): Promise<void> {
    // Stop previous playback lifecycle before replacing model/runtime bindings.
    this.playToken += 1;
    this.clearPlayTimer();
    this.detachMotionFinishHandler();
    this.cleanupParamOverride();
    this.cleanupMouseXYHook();

    const ds = await resolveTextureDownsampleSettingsFromBackend(modPath, {
      enabled: manifest?.enable_texture_downsample,
      startDim: manifest?.texture_downsample_start_dim,
    });
    this.modDownsampleEnabled = ds.enabled;
    this.modDownsampleStartDim = ds.startDim;

    dbg("load", "modPath:", modPath, "model:", config.model.model_json, "enable_texture_downsample:", ds.enabled, "texture_downsample_start_dim:", ds.startDim);
    this.config = config;
    this.modPath = modPath;
    this.modelScale = Number((config.model as any)?.scale) || 1;
    this.motionMap.clear();
    this.expressionMap.clear();
    this.motionDurationCache.clear();


    if (!this.app) {
      this.initPixiApp();
    }

    if (this.model && this.app) {
      const root = this.world ?? this.app.stage;
      try { root?.removeChild(this.model); } catch { /* ignore */ }
      try { this.app.stage.removeChild(this.model); } catch { /* ignore */ }
      this.model.destroy();
      this.model = null;
    }

    // 贴图优化：切换模型前先解除上一轮 pinned，避免 LRU 永远不回收
    this.updatePinnedTextureKeys(new Set());


    const baseDir = config.model.base_dir;
    const modelJson = config.model.model_json;
    const modelPath = joinPath(modPath, baseDir, modelJson).replace(/\\/g, "/");
    const modelUrl = toAssetUrl(modelPath);

    // 贴图优化：以 modelUrl 所在目录作为前缀（Live2D 贴图通常与 model3.json 同目录或子目录）
    const slash = modelUrl.lastIndexOf("/");
    this.assetUrlPrefix = slash >= 0 ? modelUrl.slice(0, slash + 1) : "";

    dbg("load", "modelPath:", modelPath, "modelUrl:", modelUrl);


    const Live2DModel = window.PIXI?.live2d?.Live2DModel;
    if (!Live2DModel) {
      dbg("load", "ERROR: Live2DModel class not found!");
      return;
    }

    try {
      this.model = await Live2DModel.from(modelUrl, {
        autoInteract: this.featureFlags.autoInteract,
        autoUpdate: true,
      });
      dbg("load", "model loaded OK, model.width:", this.model.width, "model.height:", this.model.height);
    } catch (err) {
      dbg("load", "ERROR loading model:", err);
      throw err;
    }

    this.model.anchor.set(0.5, 0.5);
    this.model.visible = true;


    const root = this.world ?? this.app?.stage;
    root?.addChild(this.model);


    this.buildMotionMap();
    this.buildExpressionMap();
    this.detectMouseParams();
    this.updateFitScale();
    this.applyFeatureFlags();
    this.applyInitialTransform();

    // 加载背景/叠加图层
    await this.loadBackgroundLayers();

    // 贴图优化：pin 当前模型相关贴图（只 pin baseDir 下的资源），供 LRU 判断可淘汰对象
    this.refreshPinnedTextures();

    // 贴图优化兜底：有些模型会直接创建 HTMLImageElement 并走 BaseTexture.from(img)，
    // 或者用其它方式绕过 Loader/from(url) 路径；因此在 load 后做一次 cache 扫描兜底。
    setTimeout(() => {
      void this.optimizeCachedModelBaseTextures();
    }, 0);


    // 贴图优化兜底（二次扫描）：部分资源可能在模型 load 后延迟创建
    setTimeout(() => {
      void this.optimizeCachedModelBaseTextures();
    }, 1000);


    dbg("load", "complete. motionMap keys:", [...this.motionMap.keys()],
      "expressionMap keys:", [...this.expressionMap.keys()],
      "baseFitScale:", this.baseFitScale,
      "renderer:", this.app?.renderer?.width, "x", this.app?.renderer?.height);
  }

  /**
   * 根据 anima 状态播放 Live2D 动作/表情，并处理 playOnce 完成回调。
   *
   * - 即使未命中状态映射，也会应用 live2d_params 以保证参数覆写生效
   * - 表情必须在 startMotion 后应用，避免被 stopAllMotions 清空
   */
  async playFromAnima(assetName: string, options: PlayOptions): Promise<boolean> {

    dbg("playFromAnima", "assetName:", assetName, "playOnce:", options.playOnce, "scale:", options.animationScale);
    if (!this.model || !this.config) {
      dbg("playFromAnima", "SKIP: model=", !!this.model, "config=", !!this.config);
      return false;
    }

    // 即使 live2d.json 中没有对应的 state 映射，也应用 Live2D 参数覆写
    this.applyLive2DParameters(options.live2dParams);

    const targetState = this.config.states.find(
      (state) => state.state === assetName,
    );
    if (!targetState) {
      dbg("playFromAnima", "no matching live2d state for", assetName, "— applying params only");
      if (options.playOnce) options.onComplete();
      return false;
    }

    dbg("playFromAnima", "matched state:", targetState.state, "motion:", targetState.motion, "expression:", targetState.expression);

    this.activeState = targetState;
    this.animationScale = options.animationScale;
    this.applyStateTransform();

    const motionEntry = this.motionMap.get(buildNameKey(targetState.motion));
    if (!motionEntry) {
      if (options.playOnce) options.onComplete();
      return false;
    }

    const playToken = ++this.playToken;
    this.clearPlayTimer();
    this.detachMotionFinishHandler();

    const onFinish = () => {
      if (this.playToken !== playToken) return;
      this.clearPlayTimer();
      this.detachMotionFinishHandler();
      options.onComplete();
    };

    this.attachMotionFinishHandler(onFinish);

    const started = await this.startMotion(motionEntry);

    // 表情必须在动作启动之后设置，因为 startMotion 内的 stopAllMotions() 会清除表情状态
    await this.applyExpression(targetState.expression);
    if (!started) {
      if (options.playOnce) onFinish();
      return false;
    }

    if (options.playOnce) {
      const duration = await this.getMotionDurationSeconds(motionEntry.motion);
      const fallback = Math.max(duration * 1000, 800);
      this.playTimer = setTimeout(onFinish, fallback);
    } else {
      // persistent 状态始终循环播放动作（无论 motion.loop 配置如何）
      void this.startLoopMotion(motionEntry);
    }

    return true;
  }

  private initPixiApp(): void {
    if (this.app) return;

    const width = Math.max(this.canvas.clientWidth, 1);
    const height = Math.max(this.canvas.clientHeight, 1);
    const dpr = getRenderDpr();
    dbg("initPixiApp", "canvas clientSize:", width, "x", height, "dpr:", dpr);

    this.app = new window.PIXI.Application({
      view: this.canvas,
      width,
      height,
      backgroundAlpha: 0,
      autoStart: true,
      resolution: dpr,
      autoDensity: true,
      preserveDrawingBuffer: true,
      antialias: isAntialiasEnabled(),
    });

    // 使用 world 容器承载 model + background_layers，保证缩放/居中一致。
    try {
      const PIXI = (window as any).PIXI;
      if (PIXI?.Container && this.app?.stage) {
        this.world = new PIXI.Container();
        this.app.stage.addChild(this.world);
      }
    } catch {
      this.world = null;
    }

    const maxFps = getRenderMaxFps();
    if (maxFps && this.app?.ticker) {
      // app.ticker.maxFPS 只影响当前 Application；
      // 但 pixi-live2d-display 可能挂在 PIXI.Ticker.shared 上，导致绕过该限制。
      this.app.ticker.maxFPS = maxFps;
      const shared = window.PIXI?.Ticker?.shared;
      if (shared) {
        shared.maxFPS = maxFps;
      }
    }

    // 初始化 resize 缓存，避免首轮 ResizeObserver 重复触发无意义 resize
    this.lastResizeWidth = width;
    this.lastResizeHeight = height;
    this.lastResizeDpr = dpr;

    dbg("initPixiApp", "renderer size:", this.app.renderer.width, "x", this.app.renderer.height);

  }

  private bindResize(): void {
    if (!this.app || this.resizeObserver) return;

    const target = this.canvas.parentElement ?? this.canvas;
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.app) return;
      const width = Math.max(target.clientWidth, 1);
      const height = Math.max(target.clientHeight, 1);
      dbg("resize", "parentSize:", width, "x", height);

      const nextDpr = getRenderDpr();

      // ResizeObserver 在布局抖动/动画时可能高频触发。
      // 若尺寸与 DPR 都未变化，则跳过 renderer.resize()，避免无意义的 GPU 缓冲重建。
      if (
        width === this.lastResizeWidth &&
        height === this.lastResizeHeight &&
        nextDpr === this.lastResizeDpr
      ) {
        return;
      }

      this.lastResizeWidth = width;
      this.lastResizeHeight = height;
      this.lastResizeDpr = nextDpr;

      // DPR 可能在系统缩放/显示器切换时变化，resize 时同步更新。
      this.app.renderer.resolution = nextDpr;
      this.app.renderer.resize(width, height);

      this.updateFitScale();
      this.applyCurrentTransform();

    });
    this.resizeObserver.observe(target);
  }

  private bindMouseFollow(): void {
    this.unbindMouseFollow();

    if (!this.featureFlags.mouseFollow) return;

    this.mouseMoveHandler = (e: MouseEvent) => {
      if (!this.model) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.model.focus(x, y);
    };

    this.canvas.addEventListener("mousemove", this.mouseMoveHandler);
  }

  private unbindMouseFollow(): void {
    if (this.mouseMoveHandler) {
      this.canvas.removeEventListener("mousemove", this.mouseMoveHandler);
      this.mouseMoveHandler = null;
    }
  }

  /**
   * 检测模型的鼠标追踪能力：
   * 1. hasMouseParams: 模型是否支持 focus()（有 ParamAngleX/Y 或 ParamEyeBallX/Y）
   * 2. hasCustomMouseXY: 模型是否有 ParamMouseX/Y 自定义参数（需直接写入）
   */
  private detectMouseParams(): void {
    this.hasMouseParams = false;
    this.hasCustomMouseXY = false;
    if (!this.model) return;
    const coreModel = this.model.internalModel?.coreModel;
    if (!coreModel) return;

    const hasParam = (name: string): boolean => {
      const idx = coreModel.getParameterIndex?.(name);
      return typeof idx === "number" && idx >= 0;
    };

    const hasAngle = hasParam("ParamAngleX") && hasParam("ParamAngleY");
    const hasEyeBall = hasParam("ParamEyeBallX") && hasParam("ParamEyeBallY");
    const hasMouse = hasParam("ParamMouseX") && hasParam("ParamMouseY");

    // focus() 需要 angle 或 eyeball 参数
    this.hasMouseParams = hasAngle || hasEyeBall || hasMouse;
    // ParamMouseX/Y 是自定义参数，需要直接通过 coreModel 写入
    this.hasCustomMouseXY = hasMouse;




    // 如果有 ParamMouseX/Y，绑定每帧更新 hook
    if (this.hasCustomMouseXY) {
      this.setupMouseXYHook();
    }
  }

  /**
   * 绑定 beforeModelUpdate hook，每帧将鼠标坐标写入 ParamMouseX/Y。
   * 这些参数在 BongoCat 模型中用作物理引擎输入（驱动衣巾晃动等），
   * pixi-live2d-display 的 focus() 不会写入它们。
   */
  private setupMouseXYHook(): void {
    this.cleanupMouseXYHook();
    if (!this.model) return;
    const internalModel = this.model.internalModel;
    const coreModel = internalModel?.coreModel;
    if (!coreModel) return;

    const idxX = coreModel.getParameterIndex?.("ParamMouseX");
    const idxY = coreModel.getParameterIndex?.("ParamMouseY");
    if (typeof idxX !== "number" || idxX < 0 || typeof idxY !== "number" || idxY < 0) return;

    // 获取参数的 min/max 范围以便归一化
    const minX = coreModel.getParameterMinimumValue?.(idxX) ?? -10;
    const maxX = coreModel.getParameterMaximumValue?.(idxX) ?? 10;
    const minY = coreModel.getParameterMinimumValue?.(idxY) ?? -10;
    const maxY = coreModel.getParameterMaximumValue?.(idxY) ?? 10;
    const defaultX = coreModel.getParameterDefaultValue?.(idxX) ?? 0;
    const defaultY = coreModel.getParameterDefaultValue?.(idxY) ?? 0;




    const handler = () => {
      // latestMouseX/Y 是 -1~1 归一化值，映射到参数范围
      const valX = this.latestMouseX >= 0
        ? defaultX + this.latestMouseX * (maxX - defaultX)
        : defaultX + this.latestMouseX * (defaultX - minX);
      const valY = this.latestMouseY >= 0
        ? defaultY + this.latestMouseY * (maxY - defaultY)
        : defaultY + this.latestMouseY * (defaultY - minY);
      coreModel.setParameterValueByIndex(idxX, valX);
      coreModel.setParameterValueByIndex(idxY, valY);
    };
    internalModel.on("beforeModelUpdate", handler);
    this.mouseXYCleanup = () => {
      internalModel.off("beforeModelUpdate", handler);
    };
  }

  private cleanupMouseXYHook(): void {
    if (this.mouseXYCleanup) {
      this.mouseXYCleanup();
      this.mouseXYCleanup = null;
    }
  }

  /**
   * 全局鼠标追踪：由外部传入窗口本地坐标（CSS 逻辑像素），
   * 即使窗口处于穿透状态也能更新模型参数。
   *
   * 两条路径：
   * 1. model.focus(canvasX, canvasY) → 更新 ParamAngleX/Y + ParamEyeBallX/Y
   * 2. latestMouseX/Y → beforeModelUpdate hook → 直接写 ParamMouseX/Y
   */
  updateGlobalMouseFollow(localX: number, localY: number): void {
    if (!this.model || !this.featureFlags.mouseFollow || !this.hasMouseParams) return;

    // 将窗口坐标转换为 canvas 内坐标
    const rect = this.canvas.getBoundingClientRect();
    const canvasX = localX - rect.left;
    const canvasY = localY - rect.top;

    // 路径 1: focus() 驱动 ParamAngleX/Y + ParamEyeBallX/Y
    this.model.focus(canvasX, canvasY);

    // 路径 2: 将坐标归一化到 -1~1 范围，用于 ParamMouseX/Y
    // 以 canvas 中心为原点，坐标范围映射到 [-1, 1]
    if (this.hasCustomMouseXY && rect.width > 0 && rect.height > 0) {
      this.latestMouseX = Math.max(-1, Math.min(1, (canvasX - rect.width / 2) / (rect.width / 2)));
      this.latestMouseY = Math.max(-1, Math.min(1, (canvasY - rect.height / 2) / (rect.height / 2)));
    }


  }


  private applyFeatureFlags(): void {
    if (!this.model) return;
    this.model.autoInteract = this.featureFlags.autoInteract;
  }

  private getLogicalSize(): { width: number; height: number } {
    if (!this.app) return { width: 1, height: 1 };
    const screen = this.app.renderer.screen || this.app.screen;
    if (screen) return { width: screen.width, height: screen.height };
    const res = this.app.renderer.resolution || 1;
    return {
      width: this.app.renderer.width / res,
      height: this.app.renderer.height / res,
    };
  }

  private updateFitScale(): void {
    if (!this.model || !this.app) return;

    const modelWidth = this.model.width / this.model.scale.x;
    const modelHeight = this.model.height / this.model.scale.y;

    const { width: viewW, height: viewH } = this.getLogicalSize();
    const scaleX = (viewW * 0.9) / modelWidth;
    const scaleY = (viewH * 0.9) / modelHeight;

    this.baseFitScale = Math.min(scaleX, scaleY);
    dbg("updateFitScale", "modelOriginal:", modelWidth.toFixed(0), "x", modelHeight.toFixed(0),
      "logicalView:", viewW.toFixed(0), "x", viewH.toFixed(0),
      "scaleX:", scaleX.toFixed(4), "scaleY:", scaleY.toFixed(4),
      "baseFitScale:", this.baseFitScale.toFixed(4));
  }

  private applyStateTransform(): void {
    if (!this.model || !this.app) return;
    const root = this.world ?? this.app.stage;
    if (!root) return;
    if (!this.activeState) return;

    const stateScale = Number.isFinite(this.activeState.scale)
      ? this.activeState.scale
      : 1;

    const modelScale = Number.isFinite(this.modelScale) && this.modelScale > 0
      ? this.modelScale
      : 1;

    const scale = this.baseFitScale * modelScale * stateScale * this.debugScale;

    root.scale.set(scale);

    const { width: viewW, height: viewH } = this.getLogicalSize();
    root.x = viewW / 2 + this.debugOffsetX;
    root.y = viewH / 2 + this.debugOffsetY;

    this.model.x = (this.activeState.offset_x ?? 0);
    this.model.y = (this.activeState.offset_y ?? 0);

    dbg("applyStateTransform",
      "baseFit:", this.baseFitScale.toFixed(4),
      "stateScale:", stateScale,
      "debugScale:", this.debugScale.toFixed(3),
      "finalScale:", scale.toFixed(4),
      "pos:", this.model.x.toFixed(1), this.model.y.toFixed(1),
      "debugOffset:", this.debugOffsetX.toFixed(0), this.debugOffsetY.toFixed(0),
      "logicalView:", viewW.toFixed(0), "x", viewH.toFixed(0));
  }

  /**
   * 模型加载后、尚未收到状态指令前的初始变换：
   * 缩放适配窗口并居中，避免以原始尺寸显示。
   */
  private applyInitialTransform(): void {
    if (!this.model || !this.app) return;
    const root = this.world ?? this.app.stage;
    if (!root) return;

    const modelScale = Number.isFinite(this.modelScale) && this.modelScale > 0
      ? this.modelScale
      : 1;

    const animScale = Number.isFinite(this.animationScale) && this.animationScale > 0 ? this.animationScale : 1;
    const scale = this.baseFitScale * modelScale * this.debugScale * animScale;
    root.scale.set(scale);

    const { width: viewW, height: viewH } = this.getLogicalSize();
    root.x = viewW / 2 + this.debugOffsetX;
    root.y = viewH / 2 + this.debugOffsetY;

    // 初始状态：模型在 world 中居中
    this.model.x = 0;
    this.model.y = 0;

    dbg("applyInitialTransform", "scale:", scale.toFixed(4),
      "pos:", this.model.x.toFixed(1), this.model.y.toFixed(1));
  }

  private applyCurrentTransform(): void {
    if (this.activeState) this.applyStateTransform();
    else this.applyInitialTransform();
  }

  private buildMotionMap(): void {
    if (!this.model || !this.config) return;

    const motionManager = this.model.internalModel?.motionManager;
    if (!motionManager) return;

    if (!motionManager.definitions) motionManager.definitions = {};
    if (!motionManager.motionGroups) motionManager.motionGroups = {};

    this.config.motions.forEach((motion) => {
      const group = motion.group || "Default";
      if (!motionManager.definitions[group]) motionManager.definitions[group] = [];
      if (!motionManager.motionGroups[group]) motionManager.motionGroups[group] = [];

      const existingIndex = motionManager.definitions[group].findIndex(
        (m: any) => (m.File || m.file) === motion.file,
      );

      const idx =
        existingIndex >= 0
          ? existingIndex
          : motionManager.definitions[group].push({
              File: motion.file,
              FadeInTime: (motion.fade_in_ms ?? 200) / 1000,
              FadeOutTime: (motion.fade_out_ms ?? 200) / 1000,
              Priority: motion.priority,
            }) - 1;

      this.motionMap.set(buildNameKey(motion.name), {
        group,
        index: idx,
        motion,
      });
    });
  }

  private buildExpressionMap(): void {
    if (!this.model || !this.config) return;

    const expressionManager =
      this.model.internalModel?.motionManager?.expressionManager;

    if (!expressionManager) {
      dbg("buildExpressionMap", "no expressionManager available");
      return;
    }

    if (!expressionManager.definitions) expressionManager.definitions = [];
    const definitions = expressionManager.definitions;

    // 先索引已有的表情定义
    definitions.forEach((exp: any, index: number) => {
      const name = exp.Name || exp.name;
      if (name) this.expressionMap.set(buildNameKey(name), index);
    });

    // 将 config 中的表情注入 expressionManager（补充 model3.json 未声明的）
    this.config.expressions.forEach((exp: Live2DExpression) => {
      const key = buildNameKey(exp.name);
      if (this.expressionMap.has(key)) return;

      // 先按文件路径查找已有定义
      const idx = definitions.findIndex(
        (def: any) => (def.File || def.file) === exp.file,
      );
      if (idx >= 0) {
        this.expressionMap.set(key, idx);
        return;
      }

      // 未找到：注入新定义到 expressionManager
      const newIdx = definitions.push({ Name: exp.name, File: exp.file }) - 1;
      this.expressionMap.set(key, newIdx);
      dbg("buildExpressionMap", "injected expression:", exp.name, "at index:", newIdx);
    });

    dbg("buildExpressionMap", "expressionMap keys:", [...this.expressionMap.keys()]);
  }


  /**
   * 应用 Live2D 参数覆写。
   * 在 beforeModelUpdate 事件中持续设置参数/部件透明度，确保 motion/physics 不会覆盖。
   * 支持两种 target 类型：
   * - "Parameter"（默认）：通过 setParameterValueByIndex 设置参数值
   * - "PartOpacity"：通过 setPartOpacityByIndex 设置部件透明度
   */
  applyLive2DParameters(params: Live2DParameterSetting[] | null | undefined): void {
    // 先清理旧的参数覆写监听
    this.cleanupParamOverride();

    if (!params || params.length === 0 || !this.model) return;

    const internalModel = this.model.internalModel;
    const coreModel = internalModel?.coreModel;
    if (!coreModel) return;

    // 预解析参数索引，跳过无效的
    const paramEntries: { idx: number; value: number; id: string }[] = [];
    const partEntries: { idx: number; value: number; id: string }[] = [];

    for (const p of params) {
      if (!p.id) continue;

      const paramIdx = coreModel.getParameterIndex?.(p.id);
      const partIdx = coreModel.getPartIndex?.(p.id);
      const partIds: string[] = coreModel._partIds || [];
      const isParamId = typeof paramIdx === "number" && paramIdx >= 0;
      const isPartId = typeof partIdx === "number" && partIdx >= 0 && partIds.includes(p.id);

      const target =
        p.target === "PartOpacity" || p.target === "Parameter"
          ? p.target
          : isPartId && !isParamId
            ? "PartOpacity"
            : "Parameter";

      if (target === "PartOpacity") {
        if (isPartId) {
          partEntries.push({ idx: partIdx, value: p.value, id: p.id });
        } else {
          dbg("applyLive2DParameters", "part not found:", p.id);
        }
      } else if (isParamId) {
        paramEntries.push({ idx: paramIdx, value: p.value, id: p.id });
      } else {
        dbg("applyLive2DParameters", "parameter not found:", p.id);
      }
    }


    if (paramEntries.length === 0 && partEntries.length === 0) return;

    dbg("applyLive2DParameters", "applying",
      paramEntries.length, "params:", paramEntries.map(e => `${e.id}=${e.value}`),
      partEntries.length, "parts:", partEntries.map(e => `${e.id}=${e.value}`));

    // 立即设置一次
    for (const e of paramEntries) {
      coreModel.setParameterValueByIndex(e.idx, e.value);
    }
    for (const e of partEntries) {
      coreModel.setPartOpacityByIndex(e.idx, e.value);
    }

    // 在每帧 beforeModelUpdate 时持续覆写，防止被 motion/physics 还原
    const handler = () => {
      for (const e of paramEntries) {
        coreModel.setParameterValueByIndex(e.idx, e.value);
      }
      for (const e of partEntries) {
        coreModel.setPartOpacityByIndex(e.idx, e.value);
      }
    };
    internalModel.on("beforeModelUpdate", handler);
    this.paramOverrideCleanup = () => {
      internalModel.off("beforeModelUpdate", handler);
    };
  }

  private cleanupParamOverride(): void {
    if (this.paramOverrideCleanup) {
      this.paramOverrideCleanup();
      this.paramOverrideCleanup = null;
    }
  }

  private async applyExpression(expressionName: string): Promise<void> {
    if (!this.model) return;

    const expressionManager =
      this.model.internalModel?.motionManager?.expressionManager;

    if (!expressionName) {
      expressionManager?.resetExpression?.();
      return;
    }

    const idx = this.expressionMap.get(buildNameKey(expressionName));
    if (typeof idx === "number") {
      this.model.expression(idx);
    }
  }

  private async startMotion(entry: MotionEntry): Promise<boolean> {
    if (!this.model) return false;

    const motionManager = this.model.internalModel?.motionManager;
    const priority = getMotionPriority(entry.motion.priority);
    dbg("startMotion", "group:", entry.group, "index:", entry.index, "priority:", priority, "name:", entry.motion.name);

    if (motionManager?.stopAllMotions) {
      try {
        motionManager.stopAllMotions();
      } catch {
        // ignore
      }
    }

    const started = await this.waitForMotionStart(() => {
      this.model.motion(entry.group, entry.index, priority);
    });

    dbg("startMotion", "started:", started);

    if (!started) {
      this.model.motion(entry.group, entry.index, priority);
    }

    return true;
  }

  private async startLoopMotion(entry: MotionEntry): Promise<void> {
    if (!this.model) return;

    const loopToken = this.playToken;

    const loop = async () => {
      if (this.playToken !== loopToken) return;

      await this.startMotion(entry);
      // 每次循环后重新应用表情，因为 startMotion 内的 stopAllMotions() 会清除表情状态
      if (this.activeState?.expression) {
        await this.applyExpression(this.activeState.expression);
      }
      const duration = await this.getMotionDurationSeconds(entry.motion);
      const delay = Math.max(duration * 1000 - 100, 500);
      this.playTimer = setTimeout(loop, delay);
    };

    loop();
  }

  private waitForMotionStart(startFn: () => void): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const onStart = () => {
        if (done) return;
        done = true;
        this.model?.off?.("motionStart", onStart);
        resolve(true);
      };

      this.model?.on?.("motionStart", onStart);
      startFn();

      setTimeout(() => {
        if (done) return;
        done = true;
        this.model?.off?.("motionStart", onStart);
        resolve(false);
      }, 500);
    });
  }

  private async getMotionDurationSeconds(motion: Live2DMotion): Promise<number> {
    const key = buildNameKey(motion.name);
    const cached = this.motionDurationCache.get(key);
    if (typeof cached === "number") return cached;

    if (!this.config) return 0;

    try {
      const path = joinPath(this.modPath, this.config.model.base_dir, motion.file)
        .replace(/\\/g, "/");
      const url = toAssetUrl(path);
      const res = await fetch(url);
      const json = await res.json();
      const duration = Number(json?.Meta?.Duration || 0);
      this.motionDurationCache.set(key, duration);
      return duration;
    } catch {
      this.motionDurationCache.set(key, 0);
      return 0;
    }
  }

  private clearPlayTimer(): void {
    if (this.playTimer) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
  }

  private attachMotionFinishHandler(handler: () => void): void {
    if (!this.model?.on) return;
    this.motionFinishHandler = handler;
    this.model.on("motionFinish", handler);
  }

  private detachMotionFinishHandler(): void {
    if (this.motionFinishHandler && this.model?.off) {
      this.model.off("motionFinish", this.motionFinishHandler);
    }
    this.motionFinishHandler = null;
  }

  // =========================================================================
  // 贴图优化：Loader middleware + pinned/LRU
  // =========================================================================

  private static installGlobalTextureOptimizer(): void {
    if (Live2DPlayer.texOptInstalled) return;

    const PIXI = (window as any).PIXI;
    const loader = PIXI?.Loader?.shared;

    // 覆盖绕过 Loader 的贴图加载路径
    Live2DPlayer.installBaseTextureFromHook();

    if (!loader?.use) {
      return;
    }

    Live2DPlayer.texOptInstalled = true;

    loader.use((resource: any, next: () => void) => {
      const url = String(resource?.url ?? resource?.name ?? "");
      if (!url) {
        next();
        return;
      }


      let owner: Live2DPlayer | null = null;
      for (const p of Live2DPlayer.texOptPlayers) {
        if (p.shouldOptimizeUrl(url)) {
          owner = p;
          break;
        }
      }

      if (!owner) {
        next();
        return;
      }

      Promise.resolve(owner.optimizeLoadedResourceTexture(url, resource))
        .catch(() => { /* ignore */ })
        .finally(() => next());
    });
  }


  private static installBaseTextureFromHook(): void {
    if (Live2DPlayer.texOptBaseTextureFromInstalled) return;

    const PIXI = (window as any).PIXI;
    const BaseTexture = PIXI?.BaseTexture;
    if (!BaseTexture?.from) {
      return;
    }

    Live2DPlayer.texOptBaseTextureFromInstalled = true;

    const orig = BaseTexture.from.bind(BaseTexture);


    BaseTexture.from = function (source: any, ...args: any[]) {
      // 调用原始逻辑先创建 BaseTexture（同步返回）
      const bt = orig(source, ...args);

      try {
        Live2DPlayer.onBaseTextureFromCreated(source, bt);
      } catch {
        // ignore
      }

      return bt;
    };


  }

  private static onBaseTextureFromCreated(source: any, bt: any): void {
    if (!bt) return;

    // pixi-live2d-display 可能走 BaseTexture.from(HTMLImageElement) 而不是 BaseTexture.from(url)
    const tryGetUrl = (): string => {
      if (typeof source === "string") return source;

      try {
        if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
          return String(source.currentSrc || source.src || "");
        }
      } catch {
        // ignore
      }

      const src = bt?.resource?.source ?? bt?.resource?._source;
      try {
        if (typeof HTMLImageElement !== "undefined" && src instanceof HTMLImageElement) {
          return String(src.currentSrc || src.src || "");
        }
      } catch {
        // ignore
      }

      const urlLike = bt?.resource?.url ?? bt?.resource?._url;
      if (urlLike) return String(urlLike);

      return "";
    };

    const url = tryGetUrl();
    if (!url) return;




    // 找到第一个 owner
    let owner: Live2DPlayer | null = null;
    for (const p of Live2DPlayer.texOptPlayers) {
      if (p.shouldOptimizeUrl(url)) {
        owner = p;
        break;
      }
    }

    if (!owner) {
      // 这里不计入 skippedNoOwner（避免把全局图片都算进来），只作为 fromSeen
      return;
    }


    // 可能已经完成加载
    const run = () => owner!.optimizeBaseTextureInPlace(url, bt, "from");


    if (bt.valid) {
      // 保持异步，避免在创建调用栈里做重活
      setTimeout(run, 0);
      return;
    }

    if (typeof bt.once === "function") {
      bt.once("loaded", () => run());
      bt.once("error", () => { /* ignore */ });
    } else {
      // 没有事件系统就只能尝试异步跑一次
      setTimeout(run, 0);
    }
  }

  private getTextureDecodePolicy(): Live2DTextureDecodePolicy {
    // 开关默认值：动态跟随后端当前 Mod（manifest.enable_texture_downsample）。
    // 允许用户用 localStorage `tb_live2d_tex_opt` 覆盖（例如临时全局关闭）。
    const enabledLocal = readLocalStorageBool("tb_live2d_tex_opt", this.modDownsampleEnabled);

    // 像素封顶/触发阈值：与 manifest.texture_downsample_start_dim 保持一致（后端动态读取）。
    const modStartDim = Math.max(0, Math.floor(Number(this.modDownsampleStartDim) || 0));

    // scale 仍允许通过 localStorage 调整，但默认值为 1。
    const scale = Math.max(
      LIVE2D_TEX_OPT_MIN_SCALE,
      Math.min(1, readLocalStorageNumber("tb_live2d_tex_scale", LIVE2D_TEX_OPT_SCALE_DEFAULT)),
    );

    return {
      enabled: enabledLocal && this.modDownsampleEnabled,
      maxDim: modStartDim,
      scale,
      startDim: modStartDim,
    };
  }

  private async optimizeBaseTextureInPlace(url: string, bt: any, _origin: "from" | "scan" = "from"): Promise<void> {
    const policy = this.getTextureDecodePolicy();
    if (!policy.enabled) return;

    // 避免重复处理
    if ((bt as any).__tb_live2d_texopt_done) return;

    const curW = Number(bt?.realWidth ?? bt?.width ?? 0);
    const curH = Number(bt?.realHeight ?? bt?.height ?? 0);
    if (!curW || !curH) return;

    const target = computeDecodeTarget(curW, curH, policy);
    if (target.scale >= LIVE2D_TEX_OPT_NO_RESIZE_EPS) {
      Live2DTextureLRU.touch(url, curW * curH * 4);
      (bt as any).__tb_live2d_texopt_done = true;
      return;
    }

    const src = bt?.resource?.source ?? bt?.resource?._source;
    if (!src) return;

    const canvas = await downsampleToCanvas(src, target.w, target.h);
    if (!canvas) return;

    // 标记 logical size（用于保持显示逻辑尺寸不变）
    (canvas as any)._logicalW = curW;
    (canvas as any)._logicalH = curH;

    const newBytes = target.w * target.h * 4;

    try {
      // 就地替换 resource source（让已有 Texture 引用仍然生效）
      if (bt?.resource) {
        try { bt.resource.source = canvas; } catch { /* ignore */ }
        try { bt.resource._source = canvas; } catch { /* ignore */ }
      }

      // 尽量更新尺寸信息
      try { bt.setRealSize?.(canvas.width, canvas.height, bt.resolution || 1); } catch { /* ignore */ }
      try { bt.update?.(); } catch { /* ignore */ }

      // 应用放大策略（NEAREST/像素化 或 LINEAR/平滑）
      applyLive2DBaseTextureScaleMode(bt);

      Live2DTextureLRU.touch(url, newBytes);
      (bt as any).__tb_live2d_texopt_done = true;
    } catch {
      // ignore
    }
  }

  private shouldOptimizeUrl(url: string): boolean {
    const policy = this.getTextureDecodePolicy();
    if (!policy.enabled) return false;
    if (!this.assetUrlPrefix) return false;

    // 仅处理当前模型目录（或子目录）下的贴图
    if (!url.startsWith(this.assetUrlPrefix)) return false;

    // 尽量只处理常见图片扩展名（避免误伤 json 等资源）
    const u = url.toLowerCase();
    return u.endsWith(".png") || u.endsWith(".jpg") || u.endsWith(".jpeg") || u.endsWith(".webp");
  }

  private async optimizeLoadedResourceTexture(url: string, resource: any): Promise<void> {
    const policy = this.getTextureDecodePolicy();
    if (!policy.enabled) return;

    // 避免重复处理
    if (resource && resource.__tb_live2d_texopt_done) return;

    const PIXI = (window as any).PIXI;
    if (!PIXI) return;

    const tex = resource?.texture;
    const bt = tex?.baseTexture;
    if (!bt) return;

    const curW = Number(bt?.realWidth ?? bt?.width ?? 0);
    const curH = Number(bt?.realHeight ?? bt?.height ?? 0);
    if (!curW || !curH) return;

    const target = computeDecodeTarget(curW, curH, policy);
    if (target.scale >= LIVE2D_TEX_OPT_NO_RESIZE_EPS) {
      // 仍然纳入 LRU 统计
      Live2DTextureLRU.touch(url, curW * curH * 4);
      if (resource) resource.__tb_live2d_texopt_done = true;
      return;
    }

    const src = bt?.resource?.source ?? bt?.resource?._source ?? resource?.data;
    if (!src) return;

    const canvas = await downsampleToCanvas(src, target.w, target.h);
    if (!canvas) return;

    // 标记 logical size（用于保持显示逻辑尺寸不变）
    (canvas as any)._logicalW = curW;
    (canvas as any)._logicalH = curH;

    // 用降采样后的 canvas 生成新 BaseTexture/Texture，并写回 cache
    const newBase = PIXI.BaseTexture.from(canvas);
    const newTex = new PIXI.Texture(newBase);

    // 应用放大策略（NEAREST/像素化 或 LINEAR/平滑）
    applyLive2DBaseTextureScaleMode(newBase);

    const texCache = PIXI?.utils?.TextureCache ?? PIXI?.TextureCache ?? {};
    const baseCache = PIXI?.utils?.BaseTextureCache ?? PIXI?.BaseTextureCache ?? {};

    const newBytes = target.w * target.h * 4;

    try {
      // 释放旧的 GPU 资源
      try { tex?.destroy?.(true); } catch { /* ignore */ }
      try { bt?.destroy?.(); } catch { /* ignore */ }

      // 更新资源对象
      if (resource) {
        resource.texture = newTex;
        resource.data = canvas;
        resource.__tb_live2d_texopt_done = true;
      }

      // 维护 Pixi 全局缓存（key 通常就是 url）
      baseCache[url] = newBase;
      texCache[url] = newTex;

      // 更新 LRU
      Live2DTextureLRU.touch(url, newBytes);
    } catch {
      // ignore
    }
  }

  private async optimizeCachedModelBaseTextures(): Promise<void> {
    const policy = this.getTextureDecodePolicy();
    if (!policy.enabled) return;
    if (!this.assetUrlPrefix) return;

    const PIXI = (window as any).PIXI;
    const baseCache = PIXI?.utils?.BaseTextureCache ?? PIXI?.BaseTextureCache ?? {};
    const keys = Object.keys(baseCache);

    for (const k of keys) {
      if (!k.startsWith(this.assetUrlPrefix)) continue;
      const kl = k.toLowerCase();
      if (!(kl.endsWith(".png") || kl.endsWith(".jpg") || kl.endsWith(".jpeg") || kl.endsWith(".webp"))) continue;

      const bt = baseCache[k];
      if (!bt) continue;

      if ((bt as any).__tb_live2d_texopt_scan_seen) continue;
      (bt as any).__tb_live2d_texopt_scan_seen = true;

      const run = () => this.optimizeBaseTextureInPlace(k, bt, "scan");

      // 可能尚未完成加载
      if (bt.valid) {
        await run();
      } else if (typeof bt.once === "function") {
        bt.once("loaded", () => { void run(); });
        bt.once("error", () => { /* ignore */ });
      } else {
        setTimeout(() => { void run(); }, 0);
      }
    }
  }

  private refreshPinnedTextures(): void {
    const PIXI = (window as any).PIXI;
    if (!PIXI) return;

    const baseCache = PIXI?.utils?.BaseTextureCache ?? PIXI?.BaseTextureCache ?? {};
    const keys = Object.keys(baseCache);

    const next = new Set<string>();

    // 1) 当前模型目录下的贴图
    if (this.assetUrlPrefix) {
      for (const k of keys) {
        if (!k.startsWith(this.assetUrlPrefix)) continue;
        const kl = k.toLowerCase();
        if (!(kl.endsWith(".png") || kl.endsWith(".jpg") || kl.endsWith(".jpeg") || kl.endsWith(".webp"))) continue;
        next.add(k);

        // 触碰一下 LRU（估算 bytes）
        const bt = baseCache[k];
        const w = Number(bt?.realWidth ?? bt?.width ?? 0);
        const h = Number(bt?.realHeight ?? bt?.height ?? 0);
        if (w > 0 && h > 0) Live2DTextureLRU.touch(k, w * h * 4);
      }
    }

    // 2) 背景/叠加层贴图（只要 sprite 存在就 pin）
    for (const k of this.bgTextureKeys) {
      next.add(k);
    }

    this.updatePinnedTextureKeys(next);

    // 若开启 LRU，尝试裁剪到预算
    Live2DTextureLRU.trim();
  }

  private updatePinnedTextureKeys(next: Set<string>): void {
    // unpin removed
    for (const k of this.pinnedTextureKeys) {
      if (!next.has(k)) Live2DTextureLRU.unpin(k);
    }
    // pin added
    for (const k of next) {
      if (!this.pinnedTextureKeys.has(k)) Live2DTextureLRU.pin(k);
    }
    this.pinnedTextureKeys = next;
  }

  /**
   * 清理 PIXI 全局 TextureCache / BaseTextureCache 中属于当前模型的贴图。
   *
   * PIXI 全局缓存是单例字典，不会随 Application.destroy() 一起清除。
   * 如果不主动清理，切换 Mod 后旧模型的贴图依然驻留在缓存中，
   * 占用 GPU 显存并导致内存持续增长。
   *
   * 策略：遍历 BaseTextureCache，找出以 assetUrlPrefix 开头的贴图资源，
   * 调用 destroy() 释放 GPU 纹理后从缓存中删除。
   * 同时清除 Live2DTextureLRU 中对应的条目。
   */
  private cleanupPixiGlobalCaches(): void {
    const PIXI = (window as any).PIXI;
    if (!PIXI) return;

    const texCache = PIXI?.utils?.TextureCache ?? PIXI?.TextureCache ?? {};
    const baseCache = PIXI?.utils?.BaseTextureCache ?? PIXI?.BaseTextureCache ?? {};

    // 收集需要清理的 key（当前模型目录下的贴图 + 背景层贴图）
    const keysToRemove = new Set<string>();

    if (this.assetUrlPrefix) {
      for (const k of Object.keys(baseCache)) {
        if (k.startsWith(this.assetUrlPrefix)) {
          keysToRemove.add(k);
        }
      }
      for (const k of Object.keys(texCache)) {
        if (k.startsWith(this.assetUrlPrefix)) {
          keysToRemove.add(k);
        }
      }
    }

    // 背景层贴图
    for (const k of this.bgTextureKeys) {
      keysToRemove.add(k);
    }

    // 已 pinned 的贴图也需要清理
    for (const k of this.pinnedTextureKeys) {
      keysToRemove.add(k);
    }

    for (const key of keysToRemove) {
      // 销毁 BaseTexture（释放 GPU 纹理）
      try {
        const bt = baseCache[key];
        bt?.destroy?.();
      } catch { /* ignore */ }

      // 销毁 Texture
      try {
        const tex = texCache[key];
        tex?.destroy?.(true);
      } catch { /* ignore */ }

      // 从缓存中移除
      try {
        if (PIXI?.BaseTexture?.removeFromCache) PIXI.BaseTexture.removeFromCache(key);
        else delete baseCache[key];
      } catch { /* ignore */ }
      try {
        if (PIXI?.Texture?.removeFromCache) PIXI.Texture.removeFromCache(key);
        else delete texCache[key];
      } catch { /* ignore */ }

      // 清除 LRU 条目
      Live2DTextureLRU.unpin(key);
    }
  }

  // =========================================================================
  // 背景/叠加图层
  // =========================================================================

  /**
   * 加载并渲染 background_layers 中定义的图片 Sprite。
   * layer="behind" 的插入到模型之前（stage 的底部），
   * layer="front" 的插入到模型之后（stage 的顶部）。
   * 有 event 字段的默认隐藏，需通过 showBackgroundLayer() 显示。
   */
  private async loadBackgroundLayers(): Promise<void> {
    if (!this.config || !this.app) return;
    const layers = this.config.background_layers;
    if (!layers || layers.length === 0) return;

    this.removeBackgroundLayers();
    this.bgLayerConfigs = layers;

    const PIXI = window.PIXI;
    if (!PIXI?.Sprite || !PIXI?.Texture) return;

    const baseDir = this.config.model.base_dir;

    // 背景层必须与 model 挂在同一个容器里；否则用 stage.getChildIndex(model) 会直接抛错。
    const root = (this.model?.parent as any) ?? this.world ?? this.app.stage;
    const modelIndex = (this.model && this.model.parent === root)
      ? root.getChildIndex(this.model)
      : root.children.length;

    let behindInsertIndex = modelIndex; // 在模型之前插入

    // 记录背景层创建时的模型缩放，用于后续 resize/stateScale 变化时计算相对倍率
    this.bgBaseModelScale = Number((this.model as any)?.scale?.x) || 1;

    for (const lyr of layers) {
      if (!lyr.file) continue;
      try {
        const filePath = joinPath(this.modPath, baseDir, lyr.file).replace(/\\/g, "/");
        const url = toAssetUrl(filePath);

        // 通过 Image 元素异步加载，确保纹理就绪后再创建 Sprite
        const texture = await new Promise<any>((resolve, reject) => {
          const tex = PIXI.Texture.from(url);
          if (tex.baseTexture.valid) {
            resolve(tex);
          } else {
            tex.baseTexture.once("loaded", () => resolve(tex));
            tex.baseTexture.once("error", () => reject(new Error(`Failed to load texture: ${url}`)));
          }
        });

        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5, 0.5);

        // 若启用了降采样：texture 的实际像素尺寸会变小。
        // 为了保持“逻辑尺寸”（原图尺寸）不变，这里按 logical/actual 比例放大回去。
        const src = texture?.baseTexture?.resource?.source;
        const logical = getDrawableLogicalSize(src);
        const actual = getDrawableSize(src);
        const baseScale = Number(lyr.scale || 1) || 1;
        const sx = actual.w > 0 && logical.w > 0 ? (logical.w / actual.w) : 1;
        const sy = actual.h > 0 && logical.h > 0 ? (logical.h / actual.h) : 1;
        sprite.scale.set(baseScale * sx, baseScale * sy);

        // world 会在 applyInitial/applyStateTransform 时统一做居中/缩放，这里只设置相对偏移。
        sprite.x = (lyr.offset_x || 0);
        sprite.y = (lyr.offset_y || 0);



        // 有 events 的默认隐藏
        const hasEvents = Array.isArray(lyr.events) && lyr.events.length > 0;
        if (hasEvents) {
          sprite.visible = false;
        }

        if (lyr.layer === "front") {
          root.addChild(sprite);
          this.bgSpriteFront.push(sprite);
        } else {
          root.addChildAt(sprite, behindInsertIndex);
          behindInsertIndex++;
          this.bgSpriteBehind.push(sprite);
        }

        // 贴图优化：背景贴图在 sprite 存在期间视为 pinned
        this.bgTextureKeys.add(url);

        this.bgSpriteMap.set(lyr.name, sprite);
        dbg("loadBackgroundLayers", "loaded", lyr.name, "layer:", lyr.layer, "events:", lyr.events?.length ? lyr.events.join(",") : "(always)");
      } catch (err) {
        dbg("loadBackgroundLayers", "ERROR loading", lyr.name, err);
      }
    }
  }

  private removeBackgroundLayers(): void {
    const root = this.world ?? this.app?.stage;
    for (const sprite of [...this.bgSpriteBehind, ...this.bgSpriteFront]) {
      try { root?.removeChild(sprite); } catch { /* ignore */ }
      try { this.app?.stage.removeChild(sprite); } catch { /* ignore */ }
      sprite.destroy?.({ children: true, texture: true, baseTexture: true });
    }

    this.bgSpriteBehind = [];
    this.bgSpriteFront = [];
    this.bgSpriteMap.clear();
    this.bgLayerConfigs = [];
    this.bgTextureKeys.clear();
  }

  /**
   * 显示/隐藏指定名称的背景层 Sprite。
   * 用于事件驱动的叠加层（如按键高亮）。
   */
  showBackgroundLayer(name: string, visible: boolean): void {
    const sprite = this.bgSpriteMap.get(name);
    if (sprite) {
      sprite.visible = visible;
    }
  }

  /**
   * 根据事件名显示/隐藏所有关联的背景层。
   * 每个背景层的 events 是一个数组，任意一个匹配即触发。
   * @param eventName 如 "keydown:KeyA"
   * @param visible 是否可见
   */
  setBackgroundLayersByEvent(eventName: string, visible: boolean): void {
    for (const lyr of this.bgLayerConfigs) {
      if (Array.isArray(lyr.events) && lyr.events.includes(eventName)) {
        this.showBackgroundLayer(lyr.name, visible);
      }
    }
  }
}
