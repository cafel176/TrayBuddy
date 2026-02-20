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
  opts: { fps?: number } = {},
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
  clip.userData = { baked: true, fps: safeFps, bones: bones.length, frames: frameCount };
  return clip;
}

export class ThreeDPlayer {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private clock: THREE.Clock | null = null;
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

  /** 当前生效的模型缩放（model.scale * state.scale） */
  private currentModelScale = 1;
  /** 当前生效的偏移（model offset + state offset） */
  private currentOffsetX = 0;
  private currentOffsetY = 0;

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
      preserveDrawingBuffer: false,
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

    this.clock = new THREE.Clock();

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
    this.clock = null;
    this.gltfLoader = null;
    this.clipCache.clear();
    this.config = null;
    this.currentModelScale = 1;
    this.currentOffsetX = 0;
    this.currentOffsetY = 0;

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

    // Load clip (cached)
    let clip = this.clipCache.get(animConfig.name);
    if (!clip) {
      try {
        clip = await this.loadAnimationClip(animConfig);
        if (this.playToken !== token) return false;
        this.clipCache.set(animConfig.name, clip);
      } catch (err) {
        console.error("[ThreeDPlayer] Failed to load animation:", animConfig.name, err);
        if (options.playOnce) options.onComplete();
        return false;
      }
    }

    if (this.playToken !== token) return false;

    // Stop current animation
    if (this.currentAction) {
      this.currentAction.stop();
    }

    // Play new animation
    const action = this.mixer.clipAction(clip);
    action.clampWhenFinished = true;

    if (options.playOnce) {
      action.setLoop(THREE.LoopOnce, 1);
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
    }

    // Apply speed
    const speed = animConfig.speed || 1;
    action.timeScale = speed;

    action.reset().play();
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

  private async loadAnimationClip(animConfig: ThreeDAnimation): Promise<THREE.AnimationClip> {
    const url = buildModAssetUrlFor3D(this.modPath, animConfig.file);
    dbg("loadAnimationClip", "type:", animConfig.type, "url:", url);

    if (animConfig.type === "vrma") {
      return this.loadVrmaClip(animConfig, url);
    }

    // Future: VMD support would go here
    throw new Error(`Unsupported animation type: ${animConfig.type}`);
  }

  private async loadVrmaClip(animConfig: ThreeDAnimation, url: string): Promise<THREE.AnimationClip> {
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
      { fps },
    );

    dbg("loadVrmaClip", "baked clip:", clip.name, "duration:", clip.duration, "tracks:", clip.tracks.length);
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

      const dt = this.clock?.getDelta() ?? 0;

      // Update VRM (spring bones, lookAt, etc.)
      if (this.vrm?.update) {
        this.vrm.update(dt);
      }

      // Update animation mixer
      if (this.mixer) {
        this.mixer.update(dt);
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

    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    if (size.y <= 0) return;

    // Calculate camera distance to fit the model height in view
    const fov = this.camera.fov * (Math.PI / 180);
    const modelHeight = size.y;
    // NOTE: animationScale 已由 Rust 端通过缩放窗口/canvas 物理尺寸实现，
    // 这里不再用 animationScale 调整相机距离，否则会导致"双重缩放"。
    // 只使用 config 中的 model.scale（用户控制模型在窗口内的相对大小）。
    const effectiveScale = this.currentModelScale;
    // 相机距离：让模型尽量填满 canvas 高度
    const fitDistance = (modelHeight / 2) / Math.tan(fov / 2) / effectiveScale;

    // Apply offset (in model-space units)
    const offsetX = this.currentOffsetX * modelHeight;
    const offsetY = this.currentOffsetY * modelHeight;

    // Look at model center with offset
    this.camera.position.set(center.x + offsetX, center.y + offsetY, fitDistance);
    this.camera.lookAt(center.x + offsetX, center.y + offsetY, center.z);
    this.camera.updateProjectionMatrix();
  }

  private clearPlayTimer(): void {
    if (this.playTimer) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
  }
}
