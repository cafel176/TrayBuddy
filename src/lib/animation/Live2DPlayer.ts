import { convertFileSrc } from "@tauri-apps/api/core";
import type {
  Live2DConfig,
  Live2DExpression,
  Live2DMotion,
  Live2DState,
} from "$lib/types/asset";

export type Live2DFeatureFlags = {
  mouseFollow: boolean;
  autoInteract: boolean;
};

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
};

declare global {
  interface Window {
    PIXI?: any;
    Live2DCubismCore?: any;
  }
}

let live2dLibPromise: Promise<void> | null = null;

function normalizePath(path: string): string {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/\/+/, "/")
    .replace(/^\/+/, "")
    .replace(/^\.\//, "");
}

function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}

/**
 * 将本地文件路径转换为 Tauri asset URL，保留路径层级结构。
 *
 * `convertFileSrc` 会对整个路径做 encodeURIComponent，导致 `/` 被编码为 `%2F`，
 * 使得浏览器将整个路径视为一个 URL 段。pixi-live2d-display 使用 url.resolve
 * 解析模型内的相对路径时需要正确的目录层级，因此必须将 `%2F` 还原为 `/`，
 * 同时将 `%3A` 还原为 `:`（Windows 盘符）。
 */
function toAssetUrl(filePath: string): string {
  const raw = convertFileSrc(filePath.replace(/\\/g, "/"));
  return raw.replace(/%2F/gi, "/").replace(/%3A/gi, ":");
}

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

function buildNameKey(name: string): string {
  return String(name || "").trim().toLowerCase();
}

const DEBUG = false;
function dbg(tag: string, ...args: any[]) {
  if (DEBUG) console.log(`[Live2DPlayer][${tag}]`, ...args);
}

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
  private baseFitScale = 1;

  // Debug 视角控制
  private debugMode = false;
  private debugScale = 1;
  private debugOffsetX = 0;
  private debugOffsetY = 0;

  constructor(canvas: HTMLCanvasElement, options?: Live2DPlayerOptions) {
    this.canvas = canvas;
    this.featureFlags = {
      mouseFollow: true,
      autoInteract: true,
      ...options?.featureFlags,
    };
  }

  async init(): Promise<void> {
    dbg("init", "start, canvas:", this.canvas.clientWidth, "x", this.canvas.clientHeight);
    await ensureLive2DLibs();
    dbg("init", "libs loaded, PIXI:", !!window.PIXI, "CubismCore:", !!window.Live2DCubismCore);
    this.initPixiApp();
    this.bindResize();
    this.bindMouseFollow();
    dbg("init", "done");
  }

  destroy(): void {
    this.clearPlayTimer();
    this.unbindMouseFollow();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    if (this.model && this.app) {
      this.app.stage.removeChild(this.model);
      this.model.destroy();
    }
    this.model = null;

    this.app?.destroy(true, { children: true });
    this.app = null;
    this.config = null;
  }

  setFeatureFlags(flags: Live2DFeatureFlags): void {
    this.featureFlags = { ...flags };
    this.applyFeatureFlags();
    this.bindMouseFollow();
  }

  setVisible(visible: boolean): void {
    if (this.model) {
      this.model.visible = visible;
    }
  }

  setAnimationScale(scale: number): void {
    this.animationScale = scale;
    this.applyStateTransform();
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
    const stateScale = this.activeState ? (Number.isFinite(this.activeState.scale) ? this.activeState.scale : 1) : 1;
    return {
      scale: this.debugScale,
      offsetX: this.debugOffsetX,
      offsetY: this.debugOffsetY,
      baseFitScale: this.baseFitScale,
      finalScale: this.baseFitScale * stateScale * this.debugScale,
    };
  }

  async load(modPath: string, config: Live2DConfig): Promise<void> {
    dbg("load", "modPath:", modPath, "model:", config.model.model_json);
    this.config = config;
    this.modPath = modPath;
    this.motionMap.clear();
    this.expressionMap.clear();

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
    this.updateFitScale();
    this.applyFeatureFlags();
    this.applyInitialTransform();

    dbg("load", "complete. motionMap keys:", [...this.motionMap.keys()],
      "expressionMap keys:", [...this.expressionMap.keys()],
      "baseFitScale:", this.baseFitScale,
      "renderer:", this.app?.renderer?.width, "x", this.app?.renderer?.height);
  }

  async playFromAnima(assetName: string, options: PlayOptions): Promise<boolean> {
    dbg("playFromAnima", "assetName:", assetName, "playOnce:", options.playOnce, "scale:", options.animationScale);
    if (!this.model || !this.config) {
      dbg("playFromAnima", "SKIP: model=", !!this.model, "config=", !!this.config);
      return false;
    }

    const targetState = this.config.states.find(
      (state) => state.state === assetName,
    );
    if (!targetState) {
      dbg("playFromAnima", "SKIP: no matching state for", assetName, "available:", this.config.states.map(s => s.state));
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
    } else if (motionEntry.motion.loop) {
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
      this.applyStateTransform();
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
    const scale = this.baseFitScale * stateScale * this.debugScale;

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

    const scale = this.baseFitScale * this.debugScale;
    this.model.scale.set(scale);

    const { width: viewW, height: viewH } = this.getLogicalSize();
    this.model.x = viewW / 2 + this.debugOffsetX;
    this.model.y = viewH / 2 + this.debugOffsetY;

    dbg("applyInitialTransform", "scale:", scale.toFixed(4),
      "pos:", this.model.x.toFixed(1), this.model.y.toFixed(1));
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
}
