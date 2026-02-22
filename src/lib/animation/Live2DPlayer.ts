import { convertFileSrc } from "@tauri-apps/api/core";
import {
  buildModAssetUrlForLive2D,
  decodeFileSrcUrl,
  joinPath,
  normalizePath,
  parseArchiveVirtualPath,
} from "../utils/modAssetUrl";

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
}

/**
 * 将 motion priority 映射为数值级别，便于排序与比较。
 * 约定：idle < normal < high < force
 */
function getMotionPriority(priority?: string): number {

  const map: Record<string, number> = {
    idle: 1,
    normal: 2,
    high: 3,
    force: 4,
  };
  const key = String(priority || "").toLowerCase();
  return map[key] ?? 2;
}

/**
 * 将名称归一化为可用于 Map 键的形式。
 */
function buildNameKey(name: string): string {

  return String(name || "").trim().toLowerCase();
}

const DEBUG = false;
function dbg(tag: string, ...args: any[]) {
  if (DEBUG) console.log(`[Live2DPlayer][${tag}]`, ...args);
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
  private model: any | null = null;
  private config: Live2DConfig | null = null;
  private modPath = "";
  private featureFlags: Live2DFeatureFlags;
  private motionMap = new Map<string, MotionEntry>();
  private expressionMap = new Map<string, number>();
  private motionDurationCache = new Map<string, number>();
  private resizeObserver: ResizeObserver | null = null;
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
    this.initPixiApp();
    this.bindResize();
    this.bindMouseFollow();
    dbg("init", "done");
  }

  /**
   * 销毁渲染资源与事件监听。
   */
  destroy(): void {

    this.clearPlayTimer();
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

    this.app?.destroy(true, { children: true });
    this.app = null;
    this.config = null;
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

    // Live2D 窗口缩放：历史上并不使用 WindowCore 的 animationScale。
    // 为了避免用户已有的 animation_scale=1 等配置引入 2.5x 放大，这里保持只由 mod 的 scale / state.scale / debug 影响。
    return {
      scale: this.debugScale,
      offsetX: this.debugOffsetX,
      offsetY: this.debugOffsetY,
      baseFitScale: this.baseFitScale,
      finalScale: this.baseFitScale * modelScale * stateScale * this.debugScale,
    };
  }

  /**
   * 加载 Live2D 模型与资源映射，并应用基础缩放/叠加层。
   */
  async load(modPath: string, config: Live2DConfig): Promise<void> {

    dbg("load", "modPath:", modPath, "model:", config.model.model_json);
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
      this.app.stage.removeChild(this.model);
      this.model.destroy();
      this.model = null;
    }

    const baseDir = config.model.base_dir;
    const modelJson = config.model.model_json;
    const modelPath = joinPath(modPath, baseDir, modelJson).replace(/\\/g, "/");
    const modelUrl = toAssetUrl(modelPath);
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

    this.app?.stage.addChild(this.model);

    this.buildMotionMap();
    this.buildExpressionMap();
    this.detectMouseParams();
    this.updateFitScale();
    this.applyFeatureFlags();
    this.applyInitialTransform();

    // 加载背景/叠加图层
    await this.loadBackgroundLayers();

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
    dbg("initPixiApp", "canvas clientSize:", width, "x", height, "dpr:", window.devicePixelRatio);

    this.app = new window.PIXI.Application({
      view: this.canvas,
      width,
      height,
      backgroundAlpha: 0,
      autoStart: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      preserveDrawingBuffer: true,
    });

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

    console.log(`[Live2DPlayer] detectMouseParams: hasMouseParams=${this.hasMouseParams} (angle=${hasAngle} eyeBall=${hasEyeBall} mouseXY=${hasMouse})`);

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

    console.log(`[Live2DPlayer] setupMouseXYHook: idxX=${idxX}(${minX}~${maxX},def=${defaultX}) idxY=${idxY}(${minY}~${maxY},def=${defaultY})`);

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

    // DEBUG: 每5秒打印一次
    if (!this._lastMouseLog || Date.now() - this._lastMouseLog > 5000) {
      this._lastMouseLog = Date.now();
      const fc = (this.model as any).internalModel?.focusController;
      console.log(
        `[Live2DPlayer][DEBUG] mouseFollow: window=(${localX.toFixed(1)},${localY.toFixed(1)}) canvas=(${canvasX.toFixed(1)},${canvasY.toFixed(1)})`,
        `rect=${rect.width.toFixed(0)}x${rect.height.toFixed(0)}`,
        `mouseXY=(${this.latestMouseX.toFixed(3)},${this.latestMouseY.toFixed(3)})`,
        `focusCtrl=(${fc?.x?.toFixed(3)},${fc?.y?.toFixed(3)})`
      );
    }
  }
  private _lastMouseLog: number = 0;

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
    if (!this.model || !this.app || !this.activeState) return;

    const stateScale = Number.isFinite(this.activeState.scale)
      ? this.activeState.scale
      : 1;

    const modelScale = Number.isFinite(this.modelScale) && this.modelScale > 0
      ? this.modelScale
      : 1;

    const scale = this.baseFitScale * modelScale * stateScale * this.debugScale;

    this.model.scale.set(scale);

    const { width: viewW, height: viewH } = this.getLogicalSize();
    this.model.x = viewW / 2 + (this.activeState.offset_x ?? 0) + this.debugOffsetX;
    this.model.y = viewH / 2 + (this.activeState.offset_y ?? 0) + this.debugOffsetY;

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

    const modelScale = Number.isFinite(this.modelScale) && this.modelScale > 0
      ? this.modelScale
      : 1;

    const scale = this.baseFitScale * modelScale * this.debugScale;
    this.model.scale.set(scale);

    const { width: viewW, height: viewH } = this.getLogicalSize();
    this.model.x = viewW / 2 + this.debugOffsetX;
    this.model.y = viewH / 2 + this.debugOffsetY;

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
    const modelIndex = this.model ? this.app.stage.getChildIndex(this.model) : 0;

    let behindInsertIndex = modelIndex; // 在模型之前插入

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
        sprite.scale.set(lyr.scale || 1);
        sprite.x = (this.app.renderer.width / (window.devicePixelRatio || 1)) / 2 + (lyr.offset_x || 0);
        sprite.y = (this.app.renderer.height / (window.devicePixelRatio || 1)) / 2 + (lyr.offset_y || 0);

        // 有 events 的默认隐藏
        const hasEvents = Array.isArray(lyr.events) && lyr.events.length > 0;
        if (hasEvents) {
          sprite.visible = false;
        }

        if (lyr.layer === "front") {
          this.app.stage.addChild(sprite);
          this.bgSpriteFront.push(sprite);
        } else {
          this.app.stage.addChildAt(sprite, behindInsertIndex);
          behindInsertIndex++;
          this.bgSpriteBehind.push(sprite);
        }

        this.bgSpriteMap.set(lyr.name, sprite);
        dbg("loadBackgroundLayers", "loaded", lyr.name, "layer:", lyr.layer, "events:", lyr.events?.length ? lyr.events.join(",") : "(always)");
      } catch (err) {
        dbg("loadBackgroundLayers", "ERROR loading", lyr.name, err);
      }
    }
  }

  private removeBackgroundLayers(): void {
    for (const sprite of [...this.bgSpriteBehind, ...this.bgSpriteFront]) {
      this.app?.stage.removeChild(sprite);
      sprite.destroy?.({ children: true, texture: true, baseTexture: true });
    }

    this.bgSpriteBehind = [];
    this.bgSpriteFront = [];
    this.bgSpriteMap.clear();
    this.bgLayerConfigs = [];
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
