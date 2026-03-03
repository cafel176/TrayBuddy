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
import { getRenderDpr, getRenderMaxFps, isAntialiasEnabled, IdleThrottle } from "./render_tuning";
import { computeTexDownsampleTarget, type ThreeDTexturePolicy } from "./animation_utils";
// @ts-ignore — vendored JS module without TS declarations
import { MMDLoader } from "./mmd/MMDLoader.js";

type PlayOptions = {
  playOnce: boolean;
  onComplete: () => void;
};

const DEBUG = false;

/** 循环动画 bake 时，尾部渐进插值回首帧的过渡时长（秒） */
const LOOP_BLEND_DURATION = 0.3;

/** 动画剪辑缓存最大容量（避免长期驻留过多动画数据） */
const CLIP_CACHE_MAX_SIZE = 4;

// ============================================================================
// 纹理优化常量
// ============================================================================

/** 纹理降采样最小缩放比 */
const TEX_OPT_MIN_SCALE = 0.05;
/** 纹理降采样精度接近1时跳过 */
const TEX_OPT_NO_RESIZE_EPS = 0.999;
/** 降采样画布品质 */
const TEX_OPT_RESIZE_QUALITY: ImageSmoothingQuality = "high";

// computeTexDownsampleTarget, ThreeDTexturePolicy 已提取到 animation_utils.ts


function dbg(tag: string, ...args: unknown[]) {
  if (DEBUG) console.log(`[ThreeDPlayer][${tag}]`, ...args);
}

// ============================================================================
// 纹理优化工具函数
// ============================================================================

// computeTexDownsampleTarget 已提取到 animation_utils.ts

/**
 * 将图片/画布降采样到指定尺寸，返回新 canvas。
 * 与 Live2D 一致：在 canvas 上挂载 _logicalW/_logicalH 记录原始逻辑尺寸。
 *
 * 注意：THREE.js 3D 模型使用归一化 UV (0~1) 映射纹理，降采样不会影响映射关系，
 * 只是降低精度/清晰度。_logicalW/_logicalH 主要用于诊断和未来可能的 2D 叠加层。
 */
function downsampleToCanvas(src: CanvasImageSource, origW: number, origH: number, tw: number, th: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = tw;
  c.height = th;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = TEX_OPT_RESIZE_QUALITY;
  ctx.drawImage(src, 0, 0, tw, th);
  // 记录原始逻辑尺寸（与 Live2D 的 _logicalW/_logicalH 对齐）
  (c as any)._logicalW = origW;
  (c as any)._logicalH = origH;
  return c;
}

/**
 * 计算简单的像素数据指纹（用于纹理去重）。
 * 使用 FNV-1a 采样：缩小到 32x32 后做全像素哈希，避免创建全尺寸临时 Canvas。
 */
function computeTextureFingerprint(tex: THREE.Texture): string | null {
  const image = tex.image;
  if (!image) return null;

  let w = 0, h = 0;

  if (image instanceof HTMLCanvasElement) {
    w = image.width; h = image.height;
  } else if (image instanceof HTMLImageElement || image instanceof ImageBitmap) {
    w = (image as any).naturalWidth || (image as any).width || 0;
    h = (image as any).naturalHeight || (image as any).height || 0;
  } else {
    return null;
  }
  if (w <= 0 || h <= 0) return null;

  // 缩小到 32x32 做指纹采样（避免全尺寸临时 Canvas 的内存开销）
  const sampleSize = 32;
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = sampleSize;
  sampleCanvas.height = sampleSize;
  const ctx = sampleCanvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(image as CanvasImageSource, 0, 0, sampleSize, sampleSize);

  const data = ctx.getImageData(0, 0, sampleSize, sampleSize).data;

  let hash = 0x811c9dc5;  // FNV offset basis
  for (let i = 0; i < data.length; i += 4) {
    hash ^= data[i]; hash = Math.imul(hash, 0x01000193);
    hash ^= data[i + 1]; hash = Math.imul(hash, 0x01000193);
    hash ^= data[i + 2]; hash = Math.imul(hash, 0x01000193);
    hash ^= data[i + 3]; hash = Math.imul(hash, 0x01000193);
  }

  // 释放采样 Canvas
  sampleCanvas.width = 0;
  sampleCanvas.height = 0;

  return `${w}x${h}:${(hash >>> 0).toString(16)}`;
}

/**
 * 遍历 Object3D 收集所有纹理引用（去重）。
 */
function collectAllTextures(root: THREE.Object3D): Map<THREE.Texture, { materials: any[]; propNames: string[] }> {
  const texMap = new Map<THREE.Texture, { materials: any[]; propNames: string[] }>();

  const texProps = [
    "map", "alphaMap", "aoMap", "emissiveMap", "bumpMap",
    "normalMap", "displacementMap", "roughnessMap", "metalnessMap",
    "specularMap", "lightMap", "envMap",
  ];

  root.traverse((child: any) => {
    const mat = child.material;
    if (!mat) return;
    const mats = Array.isArray(mat) ? mat : [mat];
    for (const m of mats) {
      for (const prop of texProps) {
        const tex = m[prop] as THREE.Texture | undefined;
        if (!tex || !tex.image) continue;
        let entry = texMap.get(tex);
        if (!entry) {
          entry = { materials: [], propNames: [] };
          texMap.set(tex, entry);
        }
        entry.materials.push(m);
        entry.propNames.push(prop);
      }
    }
  });

  return texMap;
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
 *
 * 将 VRMA 的 humanoid 动画通过 world-delta 方法烘焙到目标 VRM 模型：
 * - 采样源动画帧并计算 world-space delta
 * - 将 delta 映射到目标骨骼并生成新的 AnimationClip
 * - 可选 loop/loopBlend 以平滑首尾过渡
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
  srcMixer.uncacheClip(srcClip);
  srcMixer.uncacheRoot(vrmaGltf.scene);

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

// =========================================================================
// MMD Runtime: IK Solver, Grant Solver, bone backup/restore
// Ported from other-tool/模型预览/app.js
// =========================================================================

interface MmdIkLink {
  index: number;
  enabled?: boolean;
  limitation?: THREE.Vector3;
  rotationMin?: THREE.Vector3;
  rotationMax?: THREE.Vector3;
}

interface MmdIkParam {
  target: number;
  effector: number;
  iteration: number;
  maxAngle?: number;
  minAngle?: number;
  links: MmdIkLink[];
}

interface MmdGrantParam {
  index: number;
  parentIndex: number;
  ratio: number;
  isLocal?: boolean;
  affectRotation?: boolean;
  affectPosition?: boolean;
  transformationClass?: number;
}

interface MmdIkSolver {
  mesh: THREE.SkinnedMesh;
  iks: MmdIkParam[];
  update(): void;
}

interface MmdGrantSolver {
  mesh: THREE.SkinnedMesh;
  grants: MmdGrantParam[];
  update(): void;
}

interface MmdRuntime {
  mesh: THREE.SkinnedMesh;
  ikSolver: MmdIkSolver | null;
  grantSolver: MmdGrantSolver | null;
  backupBones: Float32Array | null;
}

function createMmdIkSolver(mesh: THREE.SkinnedMesh, iks: MmdIkParam[] = []): MmdIkSolver {
  const _q = new THREE.Quaternion();
  const _targetPos = new THREE.Vector3();
  const _targetVec = new THREE.Vector3();
  const _effectorPos = new THREE.Vector3();
  const _effectorVec = new THREE.Vector3();
  const _linkPos = new THREE.Vector3();
  const _invLinkQ = new THREE.Quaternion();
  const _linkScale = new THREE.Vector3();
  const _axis = new THREE.Vector3();
  const _vector = new THREE.Vector3();

  const solver: MmdIkSolver = {
    mesh,
    iks,
    update() {
      for (let i = 0; i < (this.iks?.length || 0); i++) {
        updateOne(this.iks[i]);
      }
    },
  };

  function updateOne(ik: MmdIkParam) {
    const bones = solver.mesh?.skeleton?.bones;
    if (!bones || !ik) return;

    const effector = bones[ik.effector];
    const target = bones[ik.target];
    if (!effector || !target) return;

    _targetPos.setFromMatrixPosition(target.matrixWorld);

    const links = ik.links || [];
    const iteration = ik.iteration !== undefined ? ik.iteration : 1;

    for (let i = 0; i < iteration; i++) {
      let rotated = false;

      for (let j = 0; j < links.length; j++) {
        const linkBone = bones[links[j].index];
        if (!linkBone) continue;

        if (links[j].enabled === false) break;

        const limitation = links[j].limitation;
        const rotationMin = links[j].rotationMin;
        const rotationMax = links[j].rotationMax;

        linkBone.matrixWorld.decompose(_linkPos, _invLinkQ, _linkScale);
        _invLinkQ.invert();
        _effectorPos.setFromMatrixPosition(effector.matrixWorld);

        _effectorVec.subVectors(_effectorPos, _linkPos);
        _effectorVec.applyQuaternion(_invLinkQ);
        _effectorVec.normalize();

        _targetVec.subVectors(_targetPos, _linkPos);
        _targetVec.applyQuaternion(_invLinkQ);
        _targetVec.normalize();

        let angle = _targetVec.dot(_effectorVec);
        angle = Math.min(1, Math.max(-1, angle));
        angle = Math.acos(angle);

        if (angle < 1e-5) continue;

        if (ik.minAngle !== undefined && angle < ik.minAngle) angle = ik.minAngle;
        if (ik.maxAngle !== undefined && angle > ik.maxAngle) angle = ik.maxAngle;

        _axis.crossVectors(_effectorVec, _targetVec);
        _axis.normalize();

        _q.setFromAxisAngle(_axis, angle);
        linkBone.quaternion.multiply(_q);

        if (limitation !== undefined) {
          let c = linkBone.quaternion.w;
          c = Math.min(1, Math.max(-1, c));
          const c2 = Math.sqrt(Math.max(0, 1 - c * c));
          linkBone.quaternion.set(limitation.x * c2, limitation.y * c2, limitation.z * c2, c);
        }

        if (rotationMin !== undefined) {
          linkBone.rotation.setFromVector3(_vector.setFromEuler(linkBone.rotation).max(rotationMin));
        }

        if (rotationMax !== undefined) {
          linkBone.rotation.setFromVector3(_vector.setFromEuler(linkBone.rotation).min(rotationMax));
        }

        linkBone.updateMatrixWorld(true);
        rotated = true;
      }

      if (!rotated) break;
    }
  }

  return solver;
}

function createMmdGrantSolver(mesh: THREE.SkinnedMesh, grants: MmdGrantParam[] = []): MmdGrantSolver {
  const _q = new THREE.Quaternion();

  const solver: MmdGrantSolver = {
    mesh,
    grants,
    update() {
      for (let i = 0; i < (this.grants?.length || 0); i++) {
        updateOne(this.grants[i]);
      }
    },
  };

  function updateOne(grant: MmdGrantParam) {
    const bones = solver.mesh?.skeleton?.bones;
    if (!bones || !grant) return;

    const bone = bones[grant.index];
    const parentBone = bones[grant.parentIndex];
    if (!bone || !parentBone) return;

    if (grant.affectRotation) {
      _q.set(0, 0, 0, 1);
      _q.slerp(parentBone.quaternion, grant.ratio ?? 1);
      bone.quaternion.multiply(_q);
    }

    if (grant.affectPosition) {
      bone.position.addScaledVector(parentBone.position, grant.ratio ?? 1);
    }
  }

  return solver;
}

function ensureMmdRuntime(mesh: THREE.SkinnedMesh): MmdRuntime | null {
  const mmd = (mesh?.geometry as any)?.userData?.MMD;
  if (!mesh?.skeleton || !mmd) return null;

  const ikSolver = (Array.isArray(mmd.iks) && mmd.iks.length) ? createMmdIkSolver(mesh, mmd.iks) : null;
  const grantSolver = (Array.isArray(mmd.grants) && mmd.grants.length) ? createMmdGrantSolver(mesh, mmd.grants) : null;

  return { mesh, ikSolver, grantSolver, backupBones: null };
}

function mmdRestoreBones(mmdState: MmdRuntime) {
  const bones = mmdState?.mesh?.skeleton?.bones;
  const backup = mmdState?.backupBones;
  if (!bones || !backup) return;

  for (let i = 0; i < bones.length; i++) {
    bones[i].position.fromArray(backup as any, i * 7);
    bones[i].quaternion.fromArray(backup as any, i * 7 + 3);
  }
}

function mmdSaveBones(mmdState: MmdRuntime) {
  const bones = mmdState?.mesh?.skeleton?.bones;
  if (!bones) return;

  if (!mmdState.backupBones || mmdState.backupBones.length !== bones.length * 7) {
    mmdState.backupBones = new Float32Array(bones.length * 7);
  }

  const backup = mmdState.backupBones;
  for (let i = 0; i < bones.length; i++) {
    bones[i].position.toArray(backup, i * 7);
    bones[i].quaternion.toArray(backup, i * 7 + 3);
  }
}

/**
 * ThreeDPlayer
 *
 * 负责 3D 模型（VRM/VRMA/MMD）的加载、动画播放与资源释放：
 * - 动画剪辑缓存与 LRU 淘汰
 * - VRMA → VRM 动画重定向烘焙
 * - three.js 场景/材质/纹理的生命周期管理
 */
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

  // 纹理优化
  private texPolicy: ThreeDTexturePolicy = { enabled: false, startDim: 0, maxDim: 0, scale: 1 };

  private clipCache = new Map<string, THREE.AnimationClip>();

  /**
   * 从剪辑缓存中取出动画并刷新 LRU 顺序。
   */
  private getClipFromCache(key: string): THREE.AnimationClip | null {

    const cached = this.clipCache.get(key);
    if (!cached) return null;
    // 刷新 LRU 顺序：移到末尾
    this.clipCache.delete(key);
    this.clipCache.set(key, cached);
    return cached;
  }

  /**
   * 写入剪辑缓存并在超出上限时淘汰最久未使用项。
   */
  private putClipToCache(key: string, clip: THREE.AnimationClip): void {

    if (this.clipCache.has(key)) {
      this.clipCache.delete(key);
    }

    if (this.clipCache.size >= CLIP_CACHE_MAX_SIZE) {
      const oldestKey = this.clipCache.keys().next().value;
      if (oldestKey !== undefined) {
        const evicted = this.clipCache.get(oldestKey);
        this.clipCache.delete(oldestKey);
        // 释放淘汰 clip 的 track 内存
        if (evicted) this.disposeClipTrackData(evicted);
      }
    }

    this.clipCache.set(key, clip);
  }

  /**
   * 释放 AnimationClip 内部 track 的 Float32Array 数据，帮助 GC 回收。
   */
  private disposeClipTrackData(clip: THREE.AnimationClip): void {
    // 从 mixer 中移除缓存引用
    if (this.mixer) {
      try { this.mixer.uncacheClip(clip); } catch { /* ignore */ }
    }
    for (const track of clip.tracks) {
      (track as any).times = new Float32Array(0);
      (track as any).values = new Float32Array(0);
    }
  }

  /**
   * 深度释放 Object3D 上绑定的几何体/纹理/材质资源，避免显存泄漏。
   */
  private disposeObject3DResources(target: THREE.Object3D | null): void {

    if (!target) return;
    const disposedTextures = new Set<THREE.Texture>();

    const disposeTexture = (tex?: THREE.Texture) => {
      if (!tex || disposedTextures.has(tex)) return;
      disposedTextures.add(tex);
      tex.dispose?.();
    };

    const disposeMaterial = (mat: any) => {
      if (!mat) return;
      disposeTexture(mat.map);
      disposeTexture(mat.alphaMap);
      disposeTexture(mat.aoMap);
      disposeTexture(mat.emissiveMap);
      disposeTexture(mat.bumpMap);
      disposeTexture(mat.normalMap);
      disposeTexture(mat.displacementMap);
      disposeTexture(mat.roughnessMap);
      disposeTexture(mat.metalnessMap);
      disposeTexture(mat.specularMap);
      disposeTexture(mat.lightMap);
      disposeTexture(mat.envMap);
      mat.dispose?.();
    };

    target.traverse((child: any) => {
      if (child.geometry?.dispose) {
        child.geometry.dispose();
      }
      const mat = child.material;
      if (Array.isArray(mat)) {
        mat.forEach(disposeMaterial);
      } else {
        disposeMaterial(mat);
      }
    });
  }

  /**
   * 模型加载后的纹理优化：降采样 + 去重。
   *
   * 降采样：超过 startDim 的贴图按比例缩小，降低 GPU 显存占用。
   * 去重：相同内容的贴图只保留一份 GPU 纹理，其他材质引用同一份。
   */
  private optimizeModelTextures(): void {
    if (!this.model) return;

    const texMap = collectAllTextures(this.model);
    if (texMap.size === 0) return;

    // --- Pass 1: 降采样 ---
    if (this.texPolicy.enabled) {
      for (const [tex] of texMap) {
        const image = tex.image;
        if (!image) continue;

        const w0 = (image as any).naturalWidth || (image as any).width || 0;
        const h0 = (image as any).naturalHeight || (image as any).height || 0;
        if (w0 <= 0 || h0 <= 0) continue;

        const target = computeTexDownsampleTarget(w0, h0, this.texPolicy);
        if (target.scale >= TEX_OPT_NO_RESIZE_EPS) continue;

        // 降采样到目标尺寸（保留原始逻辑尺寸）
        const smallCanvas = downsampleToCanvas(image as CanvasImageSource, w0, h0, target.w, target.h);

        // 释放旧的 GPU 纹理（dispose 会删除 WebGL 纹理对象）
        tex.dispose();

        tex.image = smallCanvas;
        tex.needsUpdate = true;

        // 释放原始图片内存
        if (image instanceof ImageBitmap) {
          image.close();
        } else if (image instanceof HTMLImageElement) {
          image.src = "";  // 释放解码后的位图内存
        }
      }
    }

    // --- Pass 2: 纹理去重 ---
    const fingerToTex = new Map<string, THREE.Texture>();

    for (const [tex, info] of texMap) {
      const fp = computeTextureFingerprint(tex);
      if (!fp) continue;

      const existing = fingerToTex.get(fp);
      if (existing && existing !== tex) {
        // 找到相同内容的纹理，替换引用
        for (let i = 0; i < info.materials.length; i++) {
          const mat = info.materials[i];
          const prop = info.propNames[i];
          if (mat[prop] === tex) {
            mat[prop] = existing;
            mat.needsUpdate = true;
          }
        }
        // 释放多余的纹理
        tex.dispose();
      } else {
        fingerToTex.set(fp, tex);
      }
    }

    // morph targets 裁剪（VRM 模型）
    if (this.vrm) {
      this.pruneUnusedMorphTargets();
    }
  }

  /**
   * 裁剪 VRM 模型中未被使用的 morph targets，大幅释放内存。
   *
   * VRM 的 morph targets（BlendShape/Expression）通常有大量表情变体，
   * 但当前只用骨骼动画（VRMA），不驱动任何 morph，因此可以安全裁剪。
   *
   * 策略：收集所有 animation clip 中被 morphTargetInfluences track 引用的 morph index，
   * 只保留这些 + VRM expressionManager 绑定的 morph（为未来表情支持预留），
   * 其余全部移除。
   */
  private pruneUnusedMorphTargets(): void {
    if (!this.model) return;

    // --- Step 1: 收集被动画 track 引用的 morph indices ---
    // 格式: mesh.uuid -> Set<morphIndex>
    const usedMorphIndices = new Map<string, Set<number>>();

    // 扫描 clipCache 中所有 clip
    for (const clip of this.clipCache.values()) {
      for (const track of clip.tracks) {
        // morphTargetInfluences track 的路径格式：
        // ".morphTargetInfluences[N]" 或 "meshUUID.morphTargetInfluences[N]"
        const match = track.name.match(/morphTargetInfluences\[(\d+)\]/);
        if (match) {
          const idx = parseInt(match[1], 10);
          // 尝试从 track.name 中提取 mesh 引用
          const dotPos = track.name.indexOf(".");
          const meshRef = dotPos > 0 ? track.name.substring(0, dotPos) : "__root__";
          if (!usedMorphIndices.has(meshRef)) usedMorphIndices.set(meshRef, new Set());
          usedMorphIndices.get(meshRef)!.add(idx);
        }
      }
    }

    // --- Step 2: 当前不使用表情动画，跳过 VRM expressionManager 保留逻辑 ---
    // 如果未来需要表情支持，可在此收集 expressionManager 绑定的 morph indices
    const vrmUsedMorphs = new Map<THREE.Mesh, Set<number>>();

    // --- Step 3: 遍历所有 mesh，裁剪未使用的 morph targets ---
    let totalRemoved = 0;
    let totalKept = 0;

    this.model.traverse((child: any) => {
      if (!child.isMesh && !child.isSkinnedMesh) return;
      const mesh = child as THREE.Mesh;
      const geo = mesh.geometry as THREE.BufferGeometry;
      if (!geo?.morphAttributes) return;

      // 收集此 mesh 需要保留的 morph indices
      const keepIndices = new Set<number>();

      // 从 animation track 引用中查找
      for (const [ref, indices] of usedMorphIndices) {
        if (ref === "__root__" || ref === mesh.uuid || ref === mesh.name) {
          for (const idx of indices) keepIndices.add(idx);
        }
      }

      // 从 VRM expressionManager 绑定中查找
      const vrmIndices = vrmUsedMorphs.get(mesh);
      if (vrmIndices) {
        for (const idx of vrmIndices) keepIndices.add(idx);
      }

      // 统计当前 morph 总数
      const morphKeys = Object.keys(geo.morphAttributes);
      if (morphKeys.length === 0) return;

      // 获取 morph target 数量（取任一属性数组的长度）
      const firstKey = morphKeys[0];
      const morphCount = ((geo.morphAttributes as any)[firstKey] as THREE.BufferAttribute[])?.length ?? 0;
      if (morphCount === 0) return;

      // 如果全部被引用，跳过
      if (keepIndices.size >= morphCount) {
        totalKept += morphCount;
        return;
      }

      // 执行裁剪
      const removedCount = morphCount - keepIndices.size;
      totalRemoved += removedCount;
      totalKept += keepIndices.size;

      if (keepIndices.size === 0) {
        // 全部不需要 → 清空所有 morph attributes
        for (const key of morphKeys) {
          delete (geo.morphAttributes as any)[key];
        }

        // 清空 mesh 上的 morphTargetInfluences 和 morphTargetDictionary
        if (mesh.morphTargetInfluences) {
          mesh.morphTargetInfluences.length = 0;
        }
        if (mesh.morphTargetDictionary) {
          for (const k of Object.keys(mesh.morphTargetDictionary)) {
            delete mesh.morphTargetDictionary[k];
          }
        }

        // 更新 geometry morph 相关标志
        (geo as any).morphTargetsRelative = false;
      } else {
        // 部分保留 → 重建 morph arrays，只保留 keepIndices
        const sortedKeep = Array.from(keepIndices).sort((a, b) => a - b);

        // 重建 morphTargetDictionary 的 name->newIndex 映射
        const oldDict = mesh.morphTargetDictionary ?? {};
        const oldNameByIndex = new Map<number, string>();
        for (const [name, idx] of Object.entries(oldDict)) {
          oldNameByIndex.set(idx, name);
        }

        const newDict: Record<string, number> = {};
        for (let newIdx = 0; newIdx < sortedKeep.length; newIdx++) {
          const oldIdx = sortedKeep[newIdx];
          const name = oldNameByIndex.get(oldIdx) ?? `morph_${oldIdx}`;
          newDict[name] = newIdx;
        }

        for (const key of morphKeys) {
          const morphArr = (geo.morphAttributes as any)[key] as THREE.BufferAttribute[];
          if (!Array.isArray(morphArr)) continue;

          const newArr: THREE.BufferAttribute[] = [];
          for (let i = 0; i < morphArr.length; i++) {
            if (keepIndices.has(i)) {
              newArr.push(morphArr[i]);
            }
          }
          (geo.morphAttributes as any)[key] = newArr;
        }

        // 更新 morphTargetInfluences
        if (mesh.morphTargetInfluences) {
          const newInfluences = sortedKeep.map(i => mesh.morphTargetInfluences![i] ?? 0);
          mesh.morphTargetInfluences.length = 0;
          for (const v of newInfluences) mesh.morphTargetInfluences.push(v);
        }

        mesh.morphTargetDictionary = newDict;
      }
    });

    // morph 全部清除后，剥离 VRM 表情/眼球追踪相关对象（减少对象图 + 每帧 update 开销）
    if (this.vrm && totalKept === 0) {
      try { (this.vrm as any).expressionManager = null; } catch { /* ignore */ }
      try { (this.vrm as any).lookAt = null; } catch { /* ignore */ }
    }
  }

  /**
   * 首帧渲染后释放所有材质纹理的 CPU 侧 image 数据。
   * 纹理已上传至 GPU，CPU 侧副本不再需要。
   */
  private releaseTextureImages(): void {
    if (!this.model) return;
    const seen = new Set<THREE.Texture>();

    this.model.traverse((child: any) => {
      const mat = child.material;
      const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const m of mats) {
        for (const prop of ["map", "alphaMap", "aoMap", "emissiveMap", "bumpMap",
          "normalMap", "roughnessMap", "metalnessMap", "specularMap", "lightMap", "envMap"]) {
          const tex = (m as any)?.[prop] as THREE.Texture | undefined;
          if (!tex || seen.has(tex)) continue;
          seen.add(tex);
          if (tex.image) tex.image = null;
        }
      }
    });
  }

  /**
   * 清理 GLTF 对象内部的 parser 缓存，释放原始 ArrayBuffer 和解码对象。
   * GLTFParser.cache 可持有文件大小级别的数据（30-100MB+）。
   */
  private cleanupGltfParser(gltf: GLTF): void {
    const parser = (gltf as any).parser;
    if (!parser) return;

    // 清理缓存
    if (parser.cache) {
      const cacheMap = parser.cache;
      try { if (typeof cacheMap.clear === "function") cacheMap.clear(); } catch { /* ignore */ }
      try { if (typeof cacheMap.removeAll === "function") cacheMap.removeAll(); } catch { /* ignore */ }
    }

    // 清理 parser.json（GLTF JSON 结构）
    if (parser.json) {
      parser.json = null;
    }

    // 清理 parser 的 extensions
    if (parser.extensions) {
      try { parser.extensions = {}; } catch { /* ignore */ }
    }

    // 清理 parser 的 associations
    if (parser.associations) {
      try { parser.associations = new Map(); } catch { /* ignore */ }
    }

    // 断开 gltf 对 parser 的引用
    try { (gltf as any).parser = null; } catch { /* ignore */ }
  }

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

  // Idle throttle — 无交互时自动降低渲染帧率
  private idleThrottle = new IdleThrottle();

  /** PMX/MMD 专用运行时（IK、Grant、骨骼备份/恢复） */
  private mmdRuntime: MmdRuntime | null = null;
  /** PMX 模型的 SkinnedMesh 引用（用于 MMDLoader.loadAnimation） */
  private pmxMesh: THREE.SkinnedMesh | null = null;
  /** 缓存的 MMDLoader 实例（避免重复创建解析器） */
  private mmdLoader: any = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /**
   * 初始化 3D 渲染器、场景与相机。
   */
  async init(): Promise<void> {

    dbg("init", "start");

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: isAntialiasEnabled(),
      alpha: true,
      // 必须为 true，否则 readPixels（异步轮询的像素穿透检测）
      // 读到的 buffer 已被清空，alpha 全为 0，导致穿透检测失效
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(getRenderDpr());
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

    // 防御性：确保 THREE.js 全局文件缓存关闭
    THREE.Cache.enabled = false;

    this.handleResize();
    this.bindResize();
    this.startRenderLoop();

    dbg("init", "done");
  }

  /**
   * 清理渲染资源与模型缓存。
   */
  destroy(): void {

    dbg("destroy", "start");
    this.stopRenderLoop();
    this.clearPlayTimer();

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    // 清除过渡中残留的 fadingOutAction
    if (this.fadingOutAction) {
      try { this.fadingOutAction.stop(); } catch { /* ignore */ }
      this.fadingOutAction = null;
    }

    if (this.mixer) {
      this.mixer.stopAllAction();
      // 从 mixer 中移除所有缓存的 clip 引用，避免 mixer 内部持有 clip → track 数据
      for (const clip of this.clipCache.values()) {
        try { this.mixer.uncacheClip(clip); } catch { /* ignore */ }
      }
      try { if (this.model) this.mixer.uncacheRoot(this.model); } catch { /* ignore */ }
      this.mixer = null;
    }
    this.currentAction = null;

    // 释放 clipCache 中所有 clip 的 track 内存
    for (const clip of this.clipCache.values()) {
      for (const track of clip.tracks) {
        (track as any).times = new Float32Array(0);
        (track as any).values = new Float32Array(0);
      }
    }

    if (this.vrm) {
      try {
        VRMUtils.deepDispose(this.vrm.scene);
      } catch { /* ignore */ }
      this.vrm = null;
    }

    if (this.pmxMesh) {
      this.disposeObject3DResources(this.pmxMesh);
      this.pmxMesh = null;
    } else if (this.model && !this.vrm) {
      this.disposeObject3DResources(this.model);
    }

    if (this.model && this.scene) {
      this.scene.remove(this.model);
    }
    this.model = null;

    // 显式释放 WebGL 上下文，确保 GPU 资源立即回收
    if (this.renderer) {
      this.renderer.dispose();
      try {
        const gl = this.renderer.getContext();
        const ext = gl?.getExtension("WEBGL_lose_context");
        ext?.loseContext();
      } catch { /* ignore */ }
      // 清零 canvas 缓冲区，协助浏览器回收显存
      try {
        this.canvas.width = 0;
        this.canvas.height = 0;
      } catch { /* ignore */ }
    }
    this.renderer = null;

    // 清理 THREE.js 全局缓存
    try { THREE.Cache.clear(); } catch { /* ignore */ }

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
    this.fadeRemaining = 0;
    this.fadeStartModelX = 0;
    this.mmdRuntime = null;
    this.pmxMesh = null;
    this.mmdLoader = null;
    this.texPolicy = { enabled: false, startDim: 0, maxDim: 0, scale: 1 };

    dbg("destroy", "done");
  }

  /**
   * 加载 3D 模型与动画配置（VRM/PMX）。
   */
  async load(modPath: string, config: ThreeDConfig, manifest?: ThreeDTextureManifest): Promise<void> {

    dbg("load", "modPath:", modPath, "model:", config.model.file, "type:", config.model.type);
    this.config = config;
    this.modPath = modPath;
    this.clipCache.clear();

    // 解析纹理优化策略
    const downsampleEnabled = manifest?.enable_texture_downsample === true;
    const startDim = Math.max(0, Math.floor(Number(manifest?.texture_downsample_start_dim) || 0));
    this.texPolicy = {
      enabled: downsampleEnabled,
      startDim,
      maxDim: startDim,
      scale: 1,
    };

    if (!this.renderer || !this.scene || !this.gltfLoader) {
      throw new Error("ThreeDPlayer not initialized");
    }

    // Remove existing model
    if (this.model && this.scene) {
      this.scene.remove(this.model);
      if (this.vrm) {
        try { VRMUtils.deepDispose(this.vrm.scene); } catch { /* ignore */ }
      } else if (this.pmxMesh) {
        this.disposeObject3DResources(this.pmxMesh);
      } else {
        this.disposeObject3DResources(this.model);
      }
      this.model = null;
      this.vrm = null;
      this.pmxMesh = null;
    }


    if (this.mixer) {
      this.mixer.stopAllAction();
      try { if (this.model) this.mixer.uncacheRoot(this.model); } catch { /* ignore */ }
      this.mixer = null;
    }
    this.currentAction = null;
    this.mmdRuntime = null;
    this.pmxMesh = null;

    const modelUrl = buildModAssetUrlFor3D(modPath, config.model.file);
    dbg("load", "modelUrl:", modelUrl);

    if (config.model.type === "pmx") {
      await this.loadPmxModel(modelUrl, config);
    } else {
      await this.loadVrmModel(modelUrl, config);
    }

    // Apply model-level scale & offset
    this.currentModelScale = config.model.scale || 1;
    this.currentOffsetX = config.model.offset_x || 0;
    this.currentOffsetY = config.model.offset_y || 0;

    // Create mixer
    // PMX: mixer 必须基于 SkinnedMesh 创建，因为 VMD track 使用 .bones[xxx] 路径
    // 需要 PropertyBinding 能在 root 上找到 skeleton.bones
    // VRM: mixer 基于 model (vrm.scene) 创建，baked clip 使用 uuid 路径
    this.mixer = new THREE.AnimationMixer(this.pmxMesh ?? this.model!);

    // 纹理优化：降采样 + 去重 + morph 裁剪（模型加载完成后执行）
    this.optimizeModelTextures();

    // Fit camera to model
    this.fitCameraToModel();

    dbg("load", "model loaded, animations:", config.animations.length);
  }

  private async loadVrmModel(modelUrl: string, config: ThreeDConfig): Promise<void> {
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

    // 合并多个 SkinnedMesh 的 Skeleton 为共享 Skeleton，剔除未使用的 bone
    // 6 个独立 Skeleton → 1 个共享，减少冗余 boneMatrices/boneTexture 副本
    try { VRMUtils.combineSkeletons(vrm.scene); } catch { /* ignore */ }

    // 移除未被 index buffer 引用的顶点数据，缩小 geometry + morph attributes
    try { VRMUtils.removeUnnecessaryVertices(vrm.scene); } catch { /* ignore */ }

    this.model = vrm.scene;

    // 释放 GLTFParser 内部缓存（原始 ArrayBuffer + 解码的中间对象）
    // parser.cache 可持有 VRM 文件大小级别的数据（30-100MB）
    try { this.cleanupGltfParser(gltf); } catch { /* ignore */ }

    // 断开 gltf 对 scenes/animations 等的引用
    try {
      (gltf as any).scenes = null;
      (gltf as any).animations = null;
      (gltf as any).cameras = null;
      (gltf as any).asset = null;
    } catch { /* ignore */ }

    // Avoid frustum culling issues
    this.model.traverse((o) => {
      if ((o as any).isSkinnedMesh) (o as any).frustumCulled = false;
    });

    this.scene!.add(this.model);

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
  }

  private async loadPmxModel(modelUrl: string, config: ThreeDConfig): Promise<void> {
    // 构建 texture base URL（MMDLoader 的 resourcePath）
    const textureBaseDir = config.model.texture_base_dir || "";
    const resourcePath = textureBaseDir
      ? buildModAssetUrlFor3D(this.modPath, textureBaseDir.replace(/\/?$/, "/"))
      : buildModAssetUrlFor3D(this.modPath, "");

    dbg("loadPmxModel", "resourcePath:", resourcePath);

    // 创建或复用 MMDLoader
    if (!this.mmdLoader) {
      this.mmdLoader = new MMDLoader();
    }
    this.mmdLoader.setResourcePath(resourcePath);

    const mesh = await new Promise<THREE.SkinnedMesh>((resolve, reject) => {
      this.mmdLoader.load(
        modelUrl,
        (m: THREE.SkinnedMesh) => resolve(m),
        undefined,
        (err: any) => reject(err),
      );
    });

    this.pmxMesh = mesh;

    // 创建一个容器 Group 作为 model（与 VRM 路径保持一致）
    const container = new THREE.Group();
    container.add(mesh);
    this.model = container;

    // Avoid frustum culling issues
    this.model.traverse((o) => {
      if ((o as any).isSkinnedMesh) (o as any).frustumCulled = false;
    });

    this.scene!.add(this.model);

    // 初始化 MMD 运行时（IK、Grant）
    this.mmdRuntime = ensureMmdRuntime(mesh);
    if (this.mmdRuntime) {
      // 初始保存骨骼状态
      mmdSaveBones(this.mmdRuntime);
    }

    // 记录基准几何信息
    const initBox = new THREE.Box3().setFromObject(this.model);
    this.baseFootY = initBox.min.y;
    this.baseModelHeight = Math.max(initBox.max.y - initBox.min.y, 0.01);

    // 将模型下移使脚底对齐到 Y=0
    this.model.position.y = -this.baseFootY;

    // PMX 模型没有 humanoid hips 概念，baseHipsWorldX 保持 0
    this.baseHipsWorldX = 0;
  }

  /**
   * Play animation matching a state name.
   * Resolution order:
   * 1. Look up ThreeDConfig.states for a matching state → get animation name
   * 2. Fall back: use assetName directly as animation name
   * 3. Find ThreeDAnimation by name and load/play it
   *
   * 说明：playToken 用于并发切换保护，过渡期还会计算 hips 对齐补偿。
   */
  async playFromAnima(

    assetName: string,
    options: PlayOptions,
  ): Promise<boolean> {
    this.idleThrottle.poke();
    dbg("playFromAnima", "assetName:", assetName, "playOnce:", options.playOnce);
    if (!this.config || !this.model || !this.mixer) {
      dbg("playFromAnima", "not ready");
      return false;
    }
    // VRM 需要 this.vrm，PMX 需要 this.pmxMesh
    if (!this.vrm && !this.pmxMesh) {
      dbg("playFromAnima", "no model backend (vrm/pmx) ready");
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
    let clip = this.getClipFromCache(cacheKey);
    if (!clip) {
      try {
        clip = await this.loadAnimationClip(animConfig, isLoop);
        if (this.playToken !== token) return false;
        this.putClipToCache(cacheKey, clip);
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
      // 对于 PMX：初次播放后保存骨骼状态
      if (this.mmdRuntime) {
        mmdSaveBones(this.mmdRuntime);
        if (this.mmdRuntime.ikSolver) {
          this.mmdRuntime.mesh.updateMatrixWorld(true);
          this.mmdRuntime.ikSolver.update();
        }
        if (this.mmdRuntime.grantSolver) {
          this.mmdRuntime.grantSolver.update();
        }
      }
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
    // animation_base_dir 非空时，file 为相对于该目录的路径；否则 file 为相对 mod 根目录的完整路径
    const animBaseDir = this.config?.model?.animation_base_dir;
    const resolvedFile = animBaseDir
      ? animBaseDir.replace(/\/?$/, "/") + animConfig.file
      : animConfig.file;
    const url = buildModAssetUrlFor3D(this.modPath, resolvedFile);
    dbg("loadAnimationClip", "type:", animConfig.type, "loop:", loop, "url:", url);

    if (animConfig.type === "vrma") {
      return this.loadVrmaClip(animConfig, url, loop);
    }

    if (animConfig.type === "vmd") {
      return this.loadVmdClip(animConfig, url, loop);
    }

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

    const fps = animConfig.fps || 60;
    const clip = await retargetVrmaToVrmClipBaked(
      animConfig.name,
      vrmaGltf,
      this.vrm,
      this.model,
      { fps, loop },
    );

    // 释放 VRMA 临时 scene 的资源（避免内存泄漏）
    try { this.disposeObject3DResources(vrmaGltf.scene); } catch { /* ignore */ }
    // 释放 VRMA 的 GLTFParser 内部缓存
    try { this.cleanupGltfParser(vrmaGltf); } catch { /* ignore */ }

    // 断开 vrmaGltf 对象的所有引用，协助 GC
    try {
      (vrmaGltf as any).scene = null;
      (vrmaGltf as any).scenes = null;
      (vrmaGltf as any).animations = null;
      (vrmaGltf as any).cameras = null;
      (vrmaGltf as any).asset = null;
      (vrmaGltf as any).userData = null;
    } catch { /* ignore */ }

    dbg("loadVrmaClip", "baked clip:", clip.name, "duration:", clip.duration, "tracks:", clip.tracks.length, "loop:", loop);
    return clip;
  }

  private async loadVmdClip(animConfig: ThreeDAnimation, url: string, _loop: boolean): Promise<THREE.AnimationClip> {
    if (!this.pmxMesh) {
      throw new Error("PMX model not loaded — VMD animations require a PMX mesh");
    }

    if (!this.mmdLoader) {
      this.mmdLoader = new MMDLoader();
    }

    const clip = await new Promise<THREE.AnimationClip>((resolve, reject) => {
      this.mmdLoader.loadAnimation(
        url,
        this.pmxMesh,
        (anim: THREE.AnimationClip) => resolve(anim),
        undefined,
        (err: any) => reject(err),
      );
    });

    clip.name = `[VMD] ${animConfig.name}`;
    dbg("loadVmdClip", "clip:", clip.name, "duration:", clip.duration, "tracks:", clip.tracks.length);
    return clip;
  }

  // =========================================================================
  // Private: rendering
  // =========================================================================

  /**
   * 启动渲染循环：更新动画、MMD 解算与 hips 对齐过渡，再进行渲染。
   *
   * PMX 路径：restore → mixer.update → save → IK → Grant。
   */
  private startRenderLoop(): void {

    if (this.isRendering) return;
    this.isRendering = true;

    const maxFps = getRenderMaxFps();
    const minDeltaMs = maxFps ? 1000 / Math.max(1, maxFps) : 0;
    let lastTs = 0;
    let firstRenderDone = false;

    const animate = (ts: number) => {
      if (!this.isRendering) return;
      this.animationFrameId = requestAnimationFrame(animate);

      // idle 降频：无交互时大幅降低渲染频率以节省 GPU
      if (this.idleThrottle.shouldSkipFrame(ts)) {
        return;
      }

      if (minDeltaMs > 0 && lastTs > 0 && ts - lastTs < minDeltaMs) {
        return;
      }
      lastTs = ts;

      this.timer?.update();
      const dt = this.timer?.getDelta() ?? 0;

      // Update model and animation
      if (this.mmdRuntime && this.mixer) {
        // PMX path: restore → mixer.update → save → IK → Grant
        mmdRestoreBones(this.mmdRuntime);
        this.mixer.update(dt);
        mmdSaveBones(this.mmdRuntime);
        if (this.mmdRuntime.ikSolver) {
          this.mmdRuntime.mesh.updateMatrixWorld(true);
          this.mmdRuntime.ikSolver.update();
        }
        if (this.mmdRuntime.grantSolver) {
          this.mmdRuntime.grantSolver.update();
        }
      } else {
        // VRM path
        if (this.vrm?.update) {
          this.vrm.update(dt);
        }
        if (this.mixer) {
          this.mixer.update(dt);
        }
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

        // 首帧渲染后纹理已上传至 GPU，释放 CPU 侧 image 数据
        if (!firstRenderDone && this.model) {
          firstRenderDone = true;
          this.releaseTextureImages();
        }
      }
    };


    this.animationFrameId = requestAnimationFrame(animate);
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

    // DPR 可能在系统缩放/显示器切换时变化，resize 时同步更新。
    this.renderer.setPixelRatio(getRenderDpr());
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
