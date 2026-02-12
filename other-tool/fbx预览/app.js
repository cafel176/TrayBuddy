import * as THREE from './vendor/three/build/three.module.js';
import { OrbitControls } from './vendor/three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from './vendor/three/examples/jsm/loaders/FBXLoader.js';

// Surface module load failures in UI
window.addEventListener('error', (e) => {
  try {
    const msg = e?.message || 'Unknown error';
    const src = e?.filename ? `${e.filename}:${e.lineno || 0}` : '';
    const el = document.getElementById('status');
    if (el) {
      el.textContent = `脚本错误：${msg}${src ? ' @ ' + src : ''}`;
      el.classList.remove('ok');
      el.classList.add('err');
    }
  } catch {}
});
window.addEventListener('unhandledrejection', (e) => {
  try {
    const msg = e?.reason?.message || String(e?.reason || 'Unknown rejection');
    const el = document.getElementById('status');
    if (el) {
      el.textContent = `脚本异常：${msg}`;
      el.classList.remove('ok');
      el.classList.add('err');
    }
  } catch {}
});

console.log('[fbx预览] app.js loaded');

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const resetBtn = document.getElementById('resetBtn');

const fileInfo = document.getElementById('fileInfo');
const modelNameEl = document.getElementById('modelName');
const animCountEl = document.getElementById('animCount');
const statusEl = document.getElementById('status');

const animSelect = document.getElementById('animSelect');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const speed = document.getElementById('speed');
const speedValue = document.getElementById('speedValue');
const loop = document.getElementById('loop');
const timeline = document.getElementById('timeline');
const timeNow = document.getElementById('timeNow');
const timeTotal = document.getElementById('timeTotal');

const loadingEl = document.getElementById('loading');
const loadingText = document.getElementById('loadingText');

const canvas = document.getElementById('canvas');

function t(key) {
  return window.i18n?.t ? window.i18n.t(key) : key;
}

function setStatus(text, type = '') {
  statusEl.textContent = text || '';
  statusEl.classList.remove('ok', 'err');
  if (type === 'ok') statusEl.classList.add('ok');
  if (type === 'err') statusEl.classList.add('err');
}

function setLoading(show, text) {
  if (text) loadingText.textContent = text;
  loadingEl.classList.toggle('hidden', !show);
}

/** @type {Map<string, string>} */
const objectUrlByName = new Map();
/** @type {THREE.Object3D|null} */
let model = null;
/** @type {THREE.AnimationMixer|null} */
let mixer = null;
/** @type {THREE.AnimationAction|null} */
let action = null;
/** @type {THREE.AnimationClip[]} */
let clips = [];

let isPlaying = false;
let isScrubbing = false;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
camera.position.set(2, 2, 4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

const hemi = new THREE.HemisphereLight(0xffffff, 0x223355, 1.0);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(3, 5, 2);
scene.add(dir);

const grid = new THREE.GridHelper(10, 20, 0x334155, 0x1f2937);
grid.material.transparent = true;
grid.material.opacity = 0.5;
scene.add(grid);

const clock = new THREE.Clock();

function resize() {
  const parent = canvas.parentElement;
  const w = parent?.clientWidth || 800;
  const h = parent?.clientHeight || 500;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function disposeModel() {
  if (!model) return;
  scene.remove(model);
  model.traverse((obj) => {
    if (obj.isMesh) {
      obj.geometry?.dispose?.();
      const mat = obj.material;
      if (Array.isArray(mat)) {
        mat.forEach(m => m?.dispose?.());
      } else {
        mat?.dispose?.();
      }
    }
  });
  model = null;
}

function clearObjectUrls() {
  for (const url of objectUrlByName.values()) {
    try { URL.revokeObjectURL(url); } catch {}
  }
  objectUrlByName.clear();
}

function setUiEnabled(enabled) {
  resetBtn.disabled = !enabled;
  animSelect.disabled = !enabled;
  playBtn.disabled = !enabled;
  pauseBtn.disabled = !enabled;
  speed.disabled = !enabled;
  loop.disabled = !enabled;
  timeline.disabled = !enabled;
}

function updateTimeUi() {
  if (!action) {
    timeNow.textContent = '0.00';
    timeTotal.textContent = '0.00';
    timeline.value = '0';
    return;
  }
  const d = action.getClip().duration || 0;
  const now = action.time || 0;
  timeNow.textContent = now.toFixed(2);
  timeTotal.textContent = d.toFixed(2);
  if (!isScrubbing && d > 0) {
    timeline.value = String(Math.min(1, Math.max(0, now / d)));
  }
}

function applyLoopMode() {
  if (!action) return;
  action.setLoop(loop.checked ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  action.clampWhenFinished = true;
}

function setSpeedValue(v) {
  const s = Math.max(0.1, Math.min(2, v));
  speed.value = String(s);
  speedValue.textContent = `${s.toFixed(1)}×`;
  if (mixer) mixer.timeScale = s;
}

function fitCameraToObject(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z);
  const dist = maxDim === 0 ? 3 : maxDim * 1.5;

  controls.target.copy(center);

  camera.position.copy(center).add(new THREE.Vector3(dist, dist * 0.8, dist));
  camera.near = Math.max(0.01, maxDim / 100);
  camera.far = Math.max(1000, maxDim * 100);
  camera.updateProjectionMatrix();
  controls.update();
}

function populateAnimations() {
  animSelect.innerHTML = '';
  clips.forEach((c, idx) => {
    const opt = document.createElement('option');
    opt.value = String(idx);
    opt.textContent = c.name || `Animation ${idx + 1}`;
    animSelect.appendChild(opt);
  });
  animSelect.disabled = clips.length === 0;
}

function playSelectedAnimation(restart = true) {
  if (!mixer || clips.length === 0) return;

  const idx = Number(animSelect.value || 0);
  const clip = clips[idx] || clips[0];

  if (action) {
    action.stop();
    mixer.uncacheAction(action.getClip(), model);
  }

  action = mixer.clipAction(clip, model);
  applyLoopMode();

  if (restart) action.reset();
  action.play();

  isPlaying = true;
  playBtn.disabled = true;
  pauseBtn.disabled = false;

  updateTimeUi();
}

function pauseAnimation() {
  if (!action) return;
  isPlaying = false;
  // Mixer 通过 timeScale 控制速度；暂停可把 timeScale 设为 0，但要保留 UI speed
  if (mixer) mixer.timeScale = 0;
  playBtn.disabled = false;
  pauseBtn.disabled = true;
}

function resumeAnimation() {
  if (!action) return;
  isPlaying = true;
  setSpeedValue(Number(speed.value || 1));
  playBtn.disabled = true;
  pauseBtn.disabled = false;
}

function buildFileMap(files) {
  clearObjectUrls();
  const list = Array.from(files || []);

  for (const f of list) {
    const name = (f.name || '').replace(/\\/g, '/');
    const base = name.split('/').pop() || name;
    const key = base.toLowerCase();
    objectUrlByName.set(key, URL.createObjectURL(f));
  }
}

function urlModifier(url) {
  // FBX 里请求的贴图路径可能带目录；我们用 basename 匹配用户上传的贴图文件
  const cleaned = String(url || '').split('?')[0].replace(/\\/g, '/');
  const base = cleaned.split('/').pop() || cleaned;
  const hit = objectUrlByName.get(base.toLowerCase());
  if (hit) return hit;
  return url;
}

async function loadFbxFromFiles(files) {
  const list = Array.from(files || []);
  const fbx = list.find(f => (f.name || '').toLowerCase().endsWith('.fbx'));
  if (!fbx) {
    setStatus(t('msg_need_fbx') || '请提供 .fbx 文件', 'err');
    return;
  }

  setLoading(true, t('loading') || '正在加载...');
  setStatus('');
  setUiEnabled(false);

  try {
    buildFileMap(list);

    const fbxUrl = URL.createObjectURL(fbx);

    const manager = new THREE.LoadingManager();
    manager.setURLModifier(urlModifier);

    const loader = new FBXLoader(manager);

    const obj = await new Promise((resolve, reject) => {
      loader.load(
        fbxUrl,
        (o) => resolve(o),
        (ev) => {
          if (ev?.total) {
            const p = Math.round((ev.loaded / ev.total) * 100);
            loadingText.textContent = (t('loading_progress') || '正在加载... {p}%').replace('{p}', String(p));
          }
        },
        (err) => reject(err)
      );
    });

    URL.revokeObjectURL(fbxUrl);

    // Replace model
    disposeModel();
    model = obj;

    // If materials look too dark, enable basic correct lights (already set)
    scene.add(model);

    fitCameraToObject(model);

    // Animations
    clips = Array.isArray(model.animations) ? model.animations : [];

    mixer = null;
    action = null;

    modelNameEl.textContent = fbx.name;
    animCountEl.textContent = String(clips.length);
    fileInfo.style.display = '';

    populateAnimations();

    if (clips.length > 0) {
      mixer = new THREE.AnimationMixer(model);
      setSpeedValue(1);
      setUiEnabled(true);
      playSelectedAnimation(true);
      setStatus((t('msg_loaded') || '已加载') + ` (${clips.length} anim)`, 'ok');
    } else {
      setUiEnabled(true);
      // 仅禁用播放相关
      animSelect.disabled = true;
      playBtn.disabled = true;
      pauseBtn.disabled = true;
      timeline.disabled = true;
      setStatus(t('msg_no_anim') || '模型已加载，但未发现动画', 'ok');
    }
  } catch (e) {
    console.error(e);
    setStatus((t('msg_failed') || '加载失败：') + ' ' + String(e?.message || e), 'err');
  } finally {
    setLoading(false);
  }
}

// UI events
['dragenter', 'dragover'].forEach(evt => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
});
['dragleave', 'drop'].forEach(evt => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
  });
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  loadFbxFromFiles(e.dataTransfer?.files);
});

dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  loadFbxFromFiles(e.target.files);
  fileInput.value = '';
});

resetBtn.addEventListener('click', () => {
  if (model) fitCameraToObject(model);
});

animSelect.addEventListener('change', () => {
  if (!mixer) return;
  playSelectedAnimation(true);
});

playBtn.addEventListener('click', () => {
  if (!action) return;
  // If previously paused by setting timeScale=0, resume
  if (!isPlaying) {
    resumeAnimation();
  } else {
    playSelectedAnimation(false);
  }
});

pauseBtn.addEventListener('click', () => {
  pauseAnimation();
});

speed.addEventListener('input', () => {
  setSpeedValue(Number(speed.value));
});

loop.addEventListener('change', () => {
  applyLoopMode();
});

timeline.addEventListener('input', () => {
  if (!action) return;
  isScrubbing = true;
  const d = action.getClip().duration || 0;
  const p = Number(timeline.value || 0);
  const target = d * p;
  action.time = target;
  if (mixer) mixer.setTime(target);
  updateTimeUi();
});

timeline.addEventListener('change', () => {
  isScrubbing = false;
});

// Render loop
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  if (mixer && isPlaying && !isScrubbing) {
    // timeScale 已由 speed 控制
    mixer.update(dt);
  }

  controls.update();
  renderer.render(scene, camera);
  updateTimeUi();
}
animate();

// default UI state
setUiEnabled(false);
setSpeedValue(1);
