import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  VRMLoaderPlugin,
  VRMUtils,
  VRMHumanBoneName,
  VRMHumanBoneParentMap,
} from "@pixiv/three-vrm";
import type { VRM } from "@pixiv/three-vrm";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { buildModAssetUrlFor3D } from "../utils/modAssetUrl";
import type { ThreeDConfig, ThreeDAnimation, ThreeDState } from "$lib/types/asset";

type PlayOptions = {
  playOnce: boolean;
  onComplete: () => void;
};

const DEBUG = false;

/** 循环动画 bake 时，尾部渐进插值回首帧的过渡时长（秒） */
const LOOP_BLEND_DURATION = 0.3;
function dbg(tag: string, ...args: unknown[]) {
  if (DEBUG) console.log(`[ThreeDPlayer][${tag}]`, ...args);
}

function getVrmBoneNode(vrm: VRM, boneName: string): THREE.Object3D | null {
  if (!vrm?.humanoid) return null;
  const h = vrm.humanoid as any;
  if (typeof h.getNormalizedBoneNode === "function") return h.getNormalizedBoneNode(boneName);
  if (typeof h.getRawBoneNode === "function") return h.getRawBoneNode(boneName);
  if (typeof h.getBoneNode === "function") return h.getBoneNode(boneName);
  return null;
}

function getBoneDepth(boneName: string): number {
  let d = 0;
  let cur: string | null = boneName;
  while (cur != null) {
    cur = (VRMHumanBoneParentMap as Record<string, string | undefined>)[cur] ?? null;
    if (cur != null) d++;
    else break;
    if (d > 64) break;
  }
  return d;
}

function sortedHumanoidBones(boneNames: string[]): string[] {
  const list = Array.from(new Set(boneNames)).filter(Boolean);
  list.sort((a, b) => getBoneDepth(a) - getBoneDepth(b));
  return list;
}

/**
 * VRMA 动画重定向烘焙。
 * 将 VRMA 的 humanoid 动画通过 world-delta 方法烘焙到目标 VRM 模型。
 */
async function retargetVrmaToVrmClipBaked(
  vrmaName: string,
  vrmaGltf: GLTF,
  vrm: VRM,
  model: THREE.Object3D,
  opts: { fps?: number; loop?: boolean; loopBlendDuration?: number } = {},
): Promise<THREE.AnimationClip> {
  const parser = vrmaGltf.parser;
  const json = (parser as any).json;
  const ext =
    json?.extensions?.VRMC_vrm_animation ??
    (vrmaGltf.userData as any)?.gltfExtensions?.VRMC_vrm_animation ??
    null;

  if (!ext) throw new Error("VRMA missing VRMC_vrm_animation extension");

  const humanBones = ext?.humanoid?.humanBones;
  if (!humanBones || typeof humanBones !== "object") {
    throw new Error("VRMA missing humanoid.humanBones mapping");
  }

  const srcClip =
    Array.isArray(vrmaGltf.animations) && vrmaGltf.animations[0]
      ? vrmaGltf.animations[0]
      : null;
  if (!srcClip) throw new Error("VRMA contains no animations");

  const srcNodeByBone = new Map<string, THREE.Object3D>();
  const dstNodeByBone = new Map<string, THREE.Object3D>();

  for (const [boneName, def] of Object.entries(humanBones)) {
    const nodeIndex = (def as any)?.node;
    if (!Number.isInteger(nodeIndex)) continue;

    try {
      const srcNode = await parser.getDependency("node", nodeIndex);
      if (srcNode) srcNodeByBone.set(boneName, srcNode);
    } catch { /* skip */ }

    const dstNode = getVrmBoneNode(vrm, boneName);
    if (dstNode) dstNodeByBone.set(boneName, dstNode);
  }

  const bones = sortedHumanoidBones(
    Array.from(srcNodeByBone.keys()).filter((b) => dstNodeByBone.has(b)),
  );

  if (!bones.length) {
    throw new Error("No matching humanoid bones between VRMA and VRM");
  }

  // Cache rest world transforms
  vrmaGltf.scene.updateWorldMatrix(true, true);
  model.updateWorldMatrix(true, true);

  const srcRestWorldQ = new Map<string, THREE.Quaternion>();
  const srcRestWorldP = new Map<string, THREE.Vector3>();
  const dstRestWorldQ = new Map<string, THREE.Quaternion>();
  const dstRestWorldP = new Map<string, THREE.Vector3>();
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();

  for (const b of bones) {
    const s = srcNodeByBone.get(b)!;
    const d = dstNodeByBone.get(b)!;
    srcRestWorldQ.set(b, s.getWorldQuaternion(tmpQ).clone());
    srcRestWorldP.set(b, s.getWorldPosition(tmpV).clone());
    dstRestWorldQ.set(b, d.getWorldQuaternion(tmpQ).clone());
    dstRestWorldP.set(b, d.getWorldPosition(tmpV).clone());
  }

  // Prepare sampling timeline
  const duration = Math.max(0, Number(srcClip.duration) || 0);
  const safeFps = Math.min(120, Math.max(5, Number(opts.fps) || 30));
  const step = 1 / safeFps;
  const frameCount = Math.max(2, Math.ceil(duration * safeFps) + 1);
  const times = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    const t = i * step;
    times[i] = t > duration ? duration : t;
  }

  // Source mixer to evaluate pose
  const srcMixer = new THREE.AnimationMixer(vrmaGltf.scene);
  const srcAction = srcMixer.clipAction(srcClip);
  srcAction.play();

  const rotValuesByBone = new Map<string, Float32Array>();
  let hipsPosValues: Float32Array | null = null;

  for (const b of bones) {
    rotValuesByBone.set(b, new Float32Array(frameCount * 4));
  }

  const hipsName = dstNodeByBone.has(VRMHumanBoneName.Hips)
    ? VRMHumanBoneName.Hips
    : dstNodeByBone.has("hips" as any)
      ? ("hips" as string)
      : null;
  if (hipsName) {
    hipsPosValues = new Float32Array(frameCount * 3);
  }

  // Per-frame retargeting
  const invSrcRestQ = new THREE.Quaternion();
  const deltaWorldQ = new THREE.Quaternion();
  const desiredWorldQ = new THREE.Quaternion();
  const invParentWorldQ = new THREE.Quaternion();
  const localQ = new THREE.Quaternion();

  const desiredWorldQByBone = new Map<string, THREE.Quaternion>();

  const dstParentWorldQStatic = new Map<string, THREE.Quaternion>();
  const dstParentWorldMStatic = new Map<string, THREE.Matrix4>();

  for (const b of bones) {
    const d = dstNodeByBone.get(b)!;
    dstParentWorldQStatic.set(
      b,
      d.parent ? d.parent.getWorldQuaternion(tmpQ).clone() : new THREE.Quaternion(),
    );
    dstParentWorldMStatic.set(
      b,
      d.parent ? d.parent.matrixWorld.clone() : new THREE.Matrix4(),
    );
  }

  for (let fi = 0; fi < frameCount; fi++) {
    const t = times[fi];
    srcMixer.setTime(t);
    vrmaGltf.scene.updateWorldMatrix(true, true);
    desiredWorldQByBone.clear();

    // First pass: compute desired world rotations from world-delta
    for (const b of bones) {
      const s = srcNodeByBone.get(b);
      const d = dstNodeByBone.get(b);
      if (!s || !d) continue;

      const sRest = srcRestWorldQ.get(b);
      const dRest = dstRestWorldQ.get(b);
      if (!sRest || !dRest) continue;

      const sWorld = s.getWorldQuaternion(tmpQ).clone();
      invSrcRestQ.copy(sRest).invert();
      deltaWorldQ.copy(sWorld).multiply(invSrcRestQ).normalize();
      desiredWorldQ.copy(deltaWorldQ).multiply(dRest).normalize();
      desiredWorldQByBone.set(b, desiredWorldQ.clone());
    }

    // Second pass: convert desired world rotations into local rotations
    for (const b of bones) {
      const d = dstNodeByBone.get(b);
      if (!d) continue;

      const worldQ = desiredWorldQByBone.get(b);
      if (!worldQ) continue;

      const parentBone = (VRMHumanBoneParentMap as Record<string, string | undefined>)[b] ?? null;

      let parentWorldQ: THREE.Quaternion | null = null;
      if (parentBone && desiredWorldQByBone.has(parentBone)) {
        parentWorldQ = desiredWorldQByBone.get(parentBone)!;
      }

      if (!parentWorldQ) {
        parentWorldQ = dstParentWorldQStatic.get(b) || new THREE.Quaternion();
      }

      invParentWorldQ.copy(parentWorldQ).invert();
      localQ.copy(worldQ).premultiply(invParentWorldQ).normalize();

      const arr = rotValuesByBone.get(b);
      if (!arr) continue;
      const o = fi * 4;
      arr[o] = localQ.x;
      arr[o + 1] = localQ.y;
      arr[o + 2] = localQ.z;
      arr[o + 3] = localQ.w;
    }

    // Hips translation
    if (hipsPosValues && hipsName) {
      const sHips = srcNodeByBone.get(hipsName);
      const dHips = dstNodeByBone.get(hipsName);
      const sRestP = srcRestWorldP.get(hipsName);
      const dRestP = dstRestWorldP.get(hipsName);

      if (sHips && dHips && sRestP && dRestP) {
        const sWorldP = sHips.getWorldPosition(tmpV).clone();
        const deltaP = sWorldP.sub(sRestP);
        const desiredWorldP = dRestP.clone().add(deltaP);
        const parentM =
          dstParentWorldMStatic.get(hipsName) ||
          (dHips.parent ? dHips.parent.matrixWorld : new THREE.Matrix4());
        const invParentM = parentM.clone().invert();
        const localP = desiredWorldP.applyMatrix4(invParentM);
        const o = fi * 3;
        hipsPosValues[o] = localP.x;
        hipsPosValues[o + 1] = localP.y;
        hipsPosValues[o + 2] = localP.z;
      }
    }
  }

  srcAction.stop();

  // 循环动画：最后 blendFrames 帧渐进插值回第一帧，消除 LoopRepeat 取模跳变
  if (opts.loop && frameCount >= 3) {
    const blendSec = opts.loopBlendDuration ?? LOOP_BLEND_DURATION;
    const blendFrames = Math.max(2, Math.min(Math.round(blendSec * safeFps), Math.floor(frameCount / 2)));
    const startIdx = frameCount - blendFrames; // 开始混合的帧索引

    const qA = new THREE.Quaternion();
    const qB = new THREE.Quaternion();

    for (let i = 0; i < blendFrames; i++) {
      const fi = startIdx + i;
      // t: 0 → 1, 使用 smoothstep 使过渡更平滑
      const raw = (i + 1) / blendFrames;
      const t = raw * raw * (3 - 2 * raw); // smoothstep

      for (const b of bones) {
        const arr = rotValuesByBone.get(b);
        if (!arr) continue;
        const o = fi * 4;
        // 当前帧的旋转
        qA.set(arr[o], arr[o + 1], arr[o + 2], arr[o + 3]);
        // 第一帧的旋转
        qB.set(arr[0], arr[1], arr[2], arr[3]);
        // slerp 插值
        qA.slerp(qB, t);
        arr[o]     = qA.x;
        arr[o + 1] = qA.y;
        arr[o + 2] = qA.z;
        arr[o + 3] = qA.w;
      }

      if (hipsPosValues) {
        const o = fi * 3;
        hipsPosValues[o]     += (hipsPosValues[0]     - hipsPosValues[o])     * t;
        hipsPosValues[o + 1] += (hipsPosValues[1] - hipsPosValues[o + 1]) * t;
        hipsPosValues[o + 2] += (hipsPosValues[2] - hipsPosValues[o + 2]) * t;
      }
    }

    dbg("bake", `loop blend: last ${blendFrames} frames (${blendSec}s) smoothstep-blended to first frame`);
  }

  const tracks: THREE.KeyframeTrack[] = [];
  for (const b of bones) {
    const d = dstNodeByBone.get(b);
    if (!d) continue;
    const arr = rotValuesByBone.get(b);
    if (!arr) continue;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${d.uuid}.quaternion`, times, arr));
  }

  if (hipsPosValues && hipsName) {
    const dHips = dstNodeByBone.get(hipsName);
    if (dHips) {
      tracks.push(new THREE.VectorKeyframeTrack(`${dHips.uuid}.position`, times, hipsPosValues));
    }
  }

  const name = `[VRMA] ${vrmaName}`;
  const clip = new THREE.AnimationClip(name, duration || -1, tracks);
  clip.userData = { baked: true, fps: safeFps, bones: bones.length, frames: frameCount, loop: !!opts.loop };
  return clip;
}

export class ThreeDPlayer {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private timer: THREE.Timer | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private vrm: VRM | null = null;
  private model: THREE.Object3D | null = null;
  private config: ThreeDConfig | null = null;
  private modPath = "";

  private clipCache = new Map<string, THREE.AnimationClip>();
  private gltfLoader: GLTFLoader | null = null;
  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private playToken = 0;
  private playTimer: ReturnType<typeof setTimeout> | null = null;
  private animationScale = 1;

  /** 动画切换过渡时长（秒），由用户设置控制 */
  private transitionDuration = 0.3;

  /** 过渡状态：剩余时间 > 0 表示正在过渡中 */
  private fadeRemaining = 0;
  /** 过渡总时长，用于计算 lerp 进度 */
  private fadeDurationTotal = 0;
  /** 过渡开始时的 model.position.x，用于平滑 lerp */
  private fadeStartModelX = 0;
  /** 过渡中需要在结束时 stop 的旧 action */
  private fadingOutAction: THREE.AnimationAction | null = null;

  /** 当前生效的模型缩放（model.scale * state.scale） */
  private currentModelScale = 1;
  /** 当前生效的偏移（model offset + state offset） */
  private currentOffsetX = 0;
  private currentOffsetY = 0;

  /** T-pose 基准：脚底 Y、模型高度、hips 世界 X */
  private baseFootY = 0;
  private baseModelHeight = 1;
  private baseHipsWorldX = 0;

  /** 非过渡期间使用的 hips X 静态补偿值 */
  private hipsXCompensation = 0;

  private isRendering = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init(): Promise<void> {
    dbg("init", "start");

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      // 必须为 true，否则 readPixels（异步轮询的像素穿透检测）
      // 读到的 buffer 已被清空，alpha 全为 0，导致穿透检测失效
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = null;

    this.camera = new THREE.PerspectiveCamera(20, 1, 0.01, 100);
    this.camera.position.set(0, 0.85, 3);
    this.camera.lookAt(0, 0.85, 0);

    // Lighting
    const hemi = new THREE.HemisphereLight(0xffffff, 0x223355, 1.2);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(3, 5, 2);
    this.scene.add(dir);

    this.timer = new THREE.Timer();
    this.timer.connect(document);

    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.register((parser) => new VRMLoaderPlugin(parser));

    this.handleResize();
    this.bindResize();
    this.startRenderLoop();

    dbg("init", "done");
  }

  destroy(): void {
    dbg("destroy", "start");
    this.stopRenderLoop();
    this.clearPlayTimer();

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.currentAction = null;

    if (this.vrm) {
      try {
        VRMUtils.deepDispose(this.vrm.scene);
      } catch { /* ignore */ }
      this.vrm = null;
    }

    if (this.model && this.scene) {
      this.scene.remove(this.model);
    }
    this.model = null;

    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.timer?.dispose();
    this.timer = null;
    this.gltfLoader = null;
    this.clipCache.clear();
    this.config = null;
    this.currentModelScale = 1;
    this.currentOffsetX = 0;
    this.currentOffsetY = 0;
    this.baseFootY = 0;
    this.baseModelHeight = 1;
    this.baseHipsWorldX = 0;
    this.hipsXCompensation = 0;
    this.fadeDurationTotal = 0;
    this.fadeStartModelX = 0;

    dbg("destroy", "done");
  }

  async load(modPath: string, config: ThreeDConfig): Promise<void> {
    dbg("load", "modPath:", modPath, "model:", config.model.file);
    this.config = config;
    this.modPath = modPath;
    this.clipCache.clear();

    if (!this.renderer || !this.scene || !this.gltfLoader) {
      throw new Error("ThreeDPlayer not initialized");
    }

    // Remove existing model
    if (this.model && this.scene) {
      this.scene.remove(this.model);
      if (this.vrm) {
        try { VRMUtils.deepDispose(this.vrm.scene); } catch { /* ignore */ }
      }
      this.model = null;
      this.vrm = null;
    }

    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.currentAction = null;

    // Load VRM model
    const modelUrl = buildModAssetUrlFor3D(modPath, config.model.file);
    dbg("load", "modelUrl:", modelUrl);

    const gltf = await new Promise<GLTF>((resolve, reject) => {
      this.gltfLoader!.load(
        modelUrl,
        (g) => resolve(g),
        undefined,
        (err) => reject(err),
      );
    });

    const vrm = (gltf.userData as any)?.vrm as VRM | undefined;
    if (!vrm) {
      throw new Error("Failed to load VRM from model file");
    }

    this.vrm = vrm;

    // VRM0 rotation fix
    try { VRMUtils.rotateVRM0(vrm); } catch { /* ignore */ }

    this.model = vrm.scene;

    // Avoid frustum culling issues
    this.model.traverse((o) => {
      if ((o as any).isSkinnedMesh) (o as any).frustumCulled = false;
    });

    this.scene.add(this.model);

    // 记录 T-pose 基准几何信息
    const initBox = new THREE.Box3().setFromObject(this.model);
    this.baseFootY = initBox.min.y;
    this.baseModelHeight = Math.max(initBox.max.y - initBox.min.y, 0.01);

    // 将模型下移使脚底对齐到 Y=0
    this.model.position.y = -this.baseFootY;

    // 记录 T-pose 时 hips 的世界 X 坐标，用于切换动画时对齐
    const hipsNode = getVrmBoneNode(vrm, VRMHumanBoneName.Hips);
    if (hipsNode) {
      this.model.updateWorldMatrix(true, true);
      const tmpV = new THREE.Vector3();
      this.baseHipsWorldX = hipsNode.getWorldPosition(tmpV).x;
    }

    // Apply model-level scale & offset
    this.currentModelScale = config.model.scale || 1;
    this.currentOffsetX = config.model.offset_x || 0;
    this.currentOffsetY = config.model.offset_y || 0;

    // Create mixer
    this.mixer = new THREE.AnimationMixer(this.model);

    // Fit camera to model
    this.fitCameraToModel();

    dbg("load", "model loaded, animations:", config.animations.length);
  }

  /**
   * Play animation matching a state name.
   * Resolution order:
   * 1. Look up ThreeDConfig.states for a matching state → get animation name
   * 2. Fall back: use assetName directly as animation name
   * 3. Find ThreeDAnimation by name and load/play it
   */
  async playFromAnima(
    assetName: string,
    options: PlayOptions,
  ): Promise<boolean> {
    dbg("playFromAnima", "assetName:", assetName, "playOnce:", options.playOnce);
    if (!this.config || !this.model || !this.vrm || !this.mixer) {
      dbg("playFromAnima", "not ready");
      return false;
    }

    const token = ++this.playToken;
    this.clearPlayTimer();

    // Resolve animation name
    let animationName = assetName;
    let stateScale = 1;
    let stateOffsetX = 0;
    let stateOffsetY = 0;
    const stateEntry = this.config.states?.find(
      (s: ThreeDState) => s.state === assetName,
    );
    if (stateEntry) {
      animationName = stateEntry.animation;
      stateScale = stateEntry.scale || 1;
      stateOffsetX = stateEntry.offset_x || 0;
      stateOffsetY = stateEntry.offset_y || 0;
    }

    // Apply state-level scale/offset override (composed with model-level)
    this.currentModelScale = (this.config.model.scale || 1) * stateScale;
    this.currentOffsetX = (this.config.model.offset_x || 0) + stateOffsetX;
    this.currentOffsetY = (this.config.model.offset_y || 0) + stateOffsetY;
    this.fitCameraToModel();

    // Find animation config
    const animConfig = this.config.animations.find(
      (a: ThreeDAnimation) => a.name === animationName,
    );
    if (!animConfig) {
      dbg("playFromAnima", "no animation found for", animationName);
      if (options.playOnce) options.onComplete();
      return false;
    }

    // Load clip (cached); loop clips have loop-snapped last frame
    const isLoop = !options.playOnce;
    const cacheKey = `${animConfig.name}:${isLoop ? "loop" : "once"}`;
    let clip = this.clipCache.get(cacheKey);
    if (!clip) {
      try {
        clip = await this.loadAnimationClip(animConfig, isLoop);
        if (this.playToken !== token) return false;
        this.clipCache.set(cacheKey, clip);
      } catch (err) {
        console.error("[ThreeDPlayer] Failed to load animation:", animConfig.name, err);
        if (options.playOnce) options.onComplete();
        return false;
      }
    }

    if (this.playToken !== token) return false;

    // 如果请求的是同一个动画且非 playOnce，当前 action 已在 LoopRepeat 中，跳过重复播放
    if (
      !options.playOnce &&
      this.currentAction &&
      this.currentAction.getClip() === clip &&
      this.currentAction.isRunning()
    ) {
      dbg("playFromAnima", "same clip already looping, skip:", animConfig.name);
      return true;
    }

    // Play new animation with fadeIn/fadeOut transition
    const action = this.mixer.clipAction(clip);

    if (options.playOnce) {
      action.clampWhenFinished = true;
      action.setLoop(THREE.LoopOnce, 1);
    } else {
      action.clampWhenFinished = false;
      action.setLoop(THREE.LoopRepeat, Infinity);
    }

    // Apply speed
    const speed = animConfig.speed || 1;
    action.timeScale = speed;

    const prevAction = this.currentAction;
    const fadeDuration = this.transitionDuration;

    // 如果之前有正在 fadeOut 的旧 action（上一次过渡未完成），立即 stop 它
    if (this.fadingOutAction && this.fadingOutAction !== prevAction && this.fadingOutAction !== action) {
      this.fadingOutAction.stop();
      this.fadingOutAction = null;
      this.fadeRemaining = 0;
    }

    const sameAction = prevAction === action;

    if (prevAction && !sameAction && fadeDuration > 0) {
      // 标准 fadeOut/fadeIn 过渡
      dbg("playFromAnima", "transition:", prevAction.getClip().name, "→", clip.name, "dur:", fadeDuration);

      // 确保 prevAction 处于运行状态，否则 fadeOut 不会被 mixer 驱动
      if (!prevAction.isRunning()) {
        prevAction.enabled = true;
        prevAction.play();
        prevAction.setEffectiveWeight(1);
      }

      prevAction.fadeOut(fadeDuration);
      action.reset().fadeIn(fadeDuration).play();

      // 启动过渡状态追踪，记录起始 model.x 用于 lerp
      this.fadeRemaining = fadeDuration;
      this.fadeDurationTotal = fadeDuration;
      this.fadeStartModelX = this.model?.position.x ?? 0;
      this.fadingOutAction = prevAction;
    } else {
      // 无过渡 / 首次播放 / 同一个 clip
      dbg("playFromAnima", "direct play:", clip.name);
      if (prevAction) prevAction.stop();
      action.reset().play();
      this.fadeRemaining = 0;
      this.fadingOutAction = null;
      // 立即让 mixer 评估一帧，然后计算静态补偿
      this.mixer.update(0);
      this.computeHipsXCompensation();
    }

    this.currentAction = action;

    // Handle completion for playOnce
    if (options.playOnce) {
      const duration = clip.duration / speed;
      const onFinish = () => {
        if (this.playToken !== token) return;
        this.clearPlayTimer();
        options.onComplete();
      };

      // Use mixer's finished event + timeout fallback
      const handleFinished = (e: any) => {
        if (e.action === action) {
          this.mixer?.removeEventListener("finished", handleFinished);
          onFinish();
        }
      };
      this.mixer.addEventListener("finished", handleFinished);

      // Timeout fallback
      this.playTimer = setTimeout(() => {
        this.mixer?.removeEventListener("finished", handleFinished);
        onFinish();
      }, Math.max(duration * 1000 + 100, 500));
    }

    dbg("playFromAnima", "playing:", animConfig.name, "duration:", clip.duration);
    return true;
  }

  setAnimationScale(scale: number): void {
    this.animationScale = scale;
    // NOTE: animationScale 通过 Rust 端缩放窗口/canvas 物理尺寸实现，
    // 不需要在 3D 渲染层面调整相机。ResizeObserver 会在 canvas 大小变化时
    // 自动触发 handleResize + fitCameraToModel。
  }

  setTransitionDuration(duration: number): void {
    this.transitionDuration = duration;
  }

  setVisible(visible: boolean): void {
    if (this.model) {
      this.model.visible = visible;
    }
  }

  /**
   * Pixel-level opacity check for click-through detection.
   * Reads the alpha channel at the given window coordinate.
   */
  isPixelOpaqueAtScreen(screenX: number, screenY: number, alphaThreshold = 10): boolean {
    if (!this.renderer) return false;

    const gl = this.renderer.getContext();
    if (!gl) return false;

    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.renderer.getPixelRatio();

    // Multi-point sampling with margins
    const MARGINS = [0, 15, 30];
    const pixel = new Uint8Array(4);

    for (const margin of MARGINS) {
      const offsets =
        margin === 0
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

        const px = Math.round(cssX * dpr);
        const py = Math.round((rect.height - cssY) * dpr);

        gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

        if (pixel[3] >= alphaThreshold) {
          return true;
        }
      }
    }

    return false;
  }

  // =========================================================================
  // Private: animation loading
  // =========================================================================

  private async loadAnimationClip(animConfig: ThreeDAnimation, loop: boolean): Promise<THREE.AnimationClip> {
    const url = buildModAssetUrlFor3D(this.modPath, animConfig.file);
    dbg("loadAnimationClip", "type:", animConfig.type, "loop:", loop, "url:", url);

    if (animConfig.type === "vrma") {
      return this.loadVrmaClip(animConfig, url, loop);
    }

    // Future: VMD support would go here
    throw new Error(`Unsupported animation type: ${animConfig.type}`);
  }

  private async loadVrmaClip(animConfig: ThreeDAnimation, url: string, loop: boolean): Promise<THREE.AnimationClip> {
    if (!this.vrm || !this.model) {
      throw new Error("VRM model not loaded");
    }

    // Load VRMA as GLTF (without VRMLoaderPlugin — it's an animation file)
    const plainLoader = new GLTFLoader();
    const vrmaGltf = await new Promise<GLTF>((resolve, reject) => {
      plainLoader.load(url, (g) => resolve(g), undefined, (err) => reject(err));
    });

    // Reset normalized pose before retargeting
    try {
      (this.vrm.humanoid as any)?.resetNormalizedPose?.();
    } catch { /* ignore */ }

    const fps = animConfig.vrma_fps || 30;
    const clip = await retargetVrmaToVrmClipBaked(
      animConfig.name,
      vrmaGltf,
      this.vrm,
      this.model,
      { fps, loop },
    );

    dbg("loadVrmaClip", "baked clip:", clip.name, "duration:", clip.duration, "tracks:", clip.tracks.length, "loop:", loop);
    return clip;
  }

  // =========================================================================
  // Private: rendering
  // =========================================================================

  private startRenderLoop(): void {
    if (this.isRendering) return;
    this.isRendering = true;

    const animate = () => {
      if (!this.isRendering) return;
      this.animationFrameId = requestAnimationFrame(animate);

      this.timer?.update();
      const dt = this.timer?.getDelta() ?? 0;

      // Update VRM (spring bones, lookAt, etc.)
      if (this.vrm?.update) {
        this.vrm.update(dt);
      }

      // Update animation mixer
      if (this.mixer) {
        this.mixer.update(dt);
      }

      // 过渡期间：用 lerp 从起始 model.x 平滑过渡到 align 目标值
      // 过渡结束：stop 旧 action，计算新动画的静态补偿值
      // 非过渡期间：使用静态补偿值，让动画自身 hips 位移自然表达
      if (this.fadeRemaining > 0) {
        this.fadeRemaining -= dt;
        if (this.fadeRemaining <= 0) {
          this.fadeRemaining = 0;
          if (this.fadingOutAction) {
            this.fadingOutAction.stop();
            this.fadingOutAction = null;
          }
          // 过渡结束：计算仅有新动画时的静态补偿值
          this.computeHipsXCompensation();
        } else {
          // 过渡中：计算 align 目标值，然后用 lerp 平滑过渡
          const alignTarget = this.getAlignHipsX();
          if (alignTarget !== null && this.model) {
            // 过渡进度 0→1，使用 smoothstep
            const elapsed = this.fadeDurationTotal - this.fadeRemaining;
            const raw = Math.min(elapsed / this.fadeDurationTotal, 1);
            const t = raw * raw * (3 - 2 * raw); // smoothstep
            this.model.position.x = this.fadeStartModelX + (alignTarget - this.fadeStartModelX) * t;
          }
        }
      }

      // 非过渡期间：应用静态补偿值
      if (this.fadeRemaining <= 0 && this.model) {
        this.model.position.x = this.hipsXCompensation;
      }

      // Render
      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
    };

    animate();
  }

  private stopRenderLoop(): void {
    this.isRendering = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private handleResize(): void {
    if (!this.renderer || !this.camera) return;

    const parent = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(parent.clientWidth, 1);
    const h = Math.max(parent.clientHeight, 1);

    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private bindResize(): void {
    const target = this.canvas.parentElement ?? this.canvas;
    this.resizeObserver = new ResizeObserver(() => {
      this.handleResize();
      this.fitCameraToModel();
    });
    this.resizeObserver.observe(target);
  }

  private fitCameraToModel(): void {
    if (!this.model || !this.camera) return;

    const modelHeight = this.baseModelHeight;
    if (modelHeight <= 0) return;

    // 脚底在 Y=0，视觉中心在半身高
    const centerY = modelHeight / 2;

    const fov = this.camera.fov * (Math.PI / 180);
    const effectiveScale = this.currentModelScale;
    const fitDistance = (modelHeight / 2) / Math.tan(fov / 2) / effectiveScale;

    const offsetX = this.currentOffsetX * modelHeight;
    const offsetY = this.currentOffsetY * modelHeight;

    this.camera.position.set(offsetX, centerY + offsetY, fitDistance);
    this.camera.lookAt(offsetX, centerY + offsetY, 0);
    this.camera.updateProjectionMatrix();
  }

  /**
   * 计算当前 hips 对齐后 model.position.x 应该是什么值（不实际修改 model）。
   * 用于过渡期间 lerp。
   */
  private getAlignHipsX(): number | null {
    if (!this.model || !this.vrm) return null;

    const hipsNode = getVrmBoneNode(this.vrm, VRMHumanBoneName.Hips);
    if (!hipsNode) return null;

    const savedX = this.model.position.x;
    this.model.position.x = 0;
    this.model.updateWorldMatrix(true, true);

    const tmpV = new THREE.Vector3();
    const currentHipsX = hipsNode.getWorldPosition(tmpV).x;
    const targetX = this.baseHipsWorldX - currentHipsX;

    // 恢复原来的 model.x（不实际修改）
    this.model.position.x = savedX;

    return targetX;
  }

  /**
   * 计算当前动画状态下的 hips X 静态补偿值。
   * 在过渡结束或无过渡直接切换时调用一次。
   * 补偿值 = baseHipsWorldX - 当前动画 hips 世界 X，
   * 之后非过渡期间每帧直接使用此固定值，让动画自身 hips 位移自然表达。
   */
  private computeHipsXCompensation(): void {
    if (!this.model || !this.vrm) {
      this.hipsXCompensation = 0;
      return;
    }

    const hipsNode = getVrmBoneNode(this.vrm, VRMHumanBoneName.Hips);
    if (!hipsNode) {
      this.hipsXCompensation = 0;
      return;
    }

    this.model.position.x = 0;
    this.model.updateWorldMatrix(true, true);

    const tmpV = new THREE.Vector3();
    const currentHipsX = hipsNode.getWorldPosition(tmpV).x;

    this.hipsXCompensation = this.baseHipsWorldX - currentHipsX;
    this.model.position.x = this.hipsXCompensation;

    dbg("computeHipsXCompensation", "compensation:", this.hipsXCompensation);
  }

  private clearPlayTimer(): void {
    if (this.playTimer) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
  }
}
