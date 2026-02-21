/*
  pngRemix 预览（Web / Milestone 1）
  - decode: window.PngRemixDecoder
  - normalize: window.ModelNormalizer
  - render: Canvas2D 静态渲染（state 切换 + parent 层级 + z_index + 基础 blend/clip/visible）
*/

const $ = (sel) => document.querySelector(sel);
const t = (key, params) => (window.i18n && typeof window.i18n.t === 'function')
  ? window.i18n.t(key, params)
  : key;

const el = {
  dropZone: $('#dropZone'),
  fileInput: $('#fileInput'),
  status: $('#status'),
  loading: $('#loading'),
  loadingText: $('#loadingText'),

  fileInfo: $('#fileInfo'),
  fileName: $('#fileName'),
  version: $('#version'),
  stateCount: $('#stateCount'),
  spriteCount: $('#spriteCount'),

  stateSelect: $('#stateSelect'),
  toggleBg: $('#toggleBg'),
  toggleClip: $('#toggleClip'),
  toggleShowAllAssets: $('#toggleShowAllAssets'),
  toggleSpeaking: $('#toggleSpeaking'),
  toggleScreaming: $('#toggleScreaming'),
  blinkOnceBtn: $('#blinkOnceBtn'),
  toggleAutoBlink: $('#toggleAutoBlink'),
  togglePlay: $('#togglePlay'),

  // Interaction / tuning
  toggleMouseFollow: $('#toggleMouseFollow'),
  toggleClickBounce: $('#toggleClickBounce'),
  clickBounceAmp: $('#clickBounceAmp'),
  clickBounceDuration: $('#clickBounceDuration'),
  blinkSpeedOverride: $('#blinkSpeedOverride'),
  blinkChanceOverride: $('#blinkChanceOverride'),
  blinkHoldOverride: $('#blinkHoldOverride'),
  resetMotionTuningBtn: $('#resetMotionTuningBtn'),

  partsSearch: $('#partsSearch'),
  partsFilter: $('#partsFilter'),
  partsShowDefaultHiddenBtn: $('#partsShowDefaultHiddenBtn'),
  partsHideAllBtn: $('#partsHideAllBtn'),
  partsClearOverridesBtn: $('#partsClearOverridesBtn'),

  hotkeyBar: $('#hotkeyBar'),
  hotkeyClearBtn: $('#hotkeyClearBtn'),
  hotkeySummary: $('#hotkeySummary'),
  hotkeyGroups: $('#hotkeyGroups'),

  partsSummary: $('#partsSummary'),
  partsList: $('#partsList'),

  fitBtn: $('#fitBtn'),
  resetViewBtn: $('#resetViewBtn'),

  sampleSelect: $('#sampleSelect'),
  loadSampleBtn: $('#loadSampleBtn'),

  debug: $('#debug'),

  canvas: $('#canvas'),
};

function applyI18nAttrs() {
  if (el.dropZone) el.dropZone.setAttribute('aria-label', t('pngRemixPreview.dropZone.aria'));
}

// Default tuning
const DEFAULT_CLICK_BOUNCE_AMP = 50;
const DEFAULT_CLICK_BOUNCE_DURATION = 0.5;

/** @typedef {{x:number,y:number}} Vec2 */


/**
 * 2D 仿射矩阵（Canvas transform）
 * 表示：
 * [ a c e ]
 * [ b d f ]
 * [ 0 0 1 ]
 */
class Mat2D {
  constructor(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
    this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
  }
  static identity() { return new Mat2D(); }
  static translate(x, y) { return new Mat2D(1, 0, 0, 1, x, y); }
  static scale(x, y) { return new Mat2D(x, 0, 0, y, 0, 0); }
  static rotate(rad) {
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return new Mat2D(cos, sin, -sin, cos, 0, 0);
  }
  multiply(m) {
    // this * m
    return new Mat2D(
      this.a * m.a + this.c * m.b,
      this.b * m.a + this.d * m.b,
      this.a * m.c + this.c * m.d,
      this.b * m.c + this.d * m.d,
      this.a * m.e + this.c * m.f + this.e,
      this.b * m.e + this.d * m.f + this.f,
    );
  }
  invert() {
    const det = (this.a * this.d - this.b * this.c);
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return Mat2D.identity();
    const idet = 1 / det;

    const a = this.d * idet;
    const b = -this.b * idet;
    const c = -this.c * idet;
    const d = this.a * idet;
    const e = (this.c * this.f - this.d * this.e) * idet;
    const f = (this.b * this.e - this.a * this.f) * idet;
    return new Mat2D(a, b, c, d, e, f);
  }
  applyToPoint(x, y) {
    return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f };
  }
}

function setStatus(msg, type = '') {
  el.status.textContent = msg || '';
  el.status.classList.remove('ok', 'err');
  if (type) el.status.classList.add(type);
}

function setLoading(loading, text) {
  const msg = text || t('pngRemixPreview.loading.default');
  el.loadingText.textContent = msg;
  el.loading.classList.toggle('hidden', !loading);
}

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return x < a ? a : x > b ? b : x;
}

function clearTimer(id) {
  if (id) {
    try { clearInterval(id); } catch (_) {}
    try { clearTimeout(id); } catch (_) {}
  }
}

function toHex(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < u8.length; i++) {
    out += u8[i].toString(16).padStart(2, '0');
  }
  return out;
}

async function sha256HexOfArrayBuffer(arrayBuffer) {
  if (globalThis.crypto?.subtle?.digest) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', arrayBuffer);
    return toHex(new Uint8Array(digest));
  }
  // Fallback: weak but deterministic-ish identifier
  return `len_${arrayBuffer.byteLength}`;
}

function storageKeyForOverrides(fileHash) {
  return `pngRemixPreview.visibilityOverrides.${fileHash}`;
}

function loadVisibilityOverrides(fileHash) {
  try {
    const raw = localStorage.getItem(storageKeyForOverrides(fileHash));
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj;
  } catch (_) {}
  return {};
}

function saveVisibilityOverrides(fileHash, overrides) {
  try {
    localStorage.setItem(storageKeyForOverrides(fileHash), JSON.stringify(overrides || {}));
  } catch (_) {}
}

function getSceneTuning(scene) {
  if (!scene) return {
    enableMouseFollow: true,
    enableClickBounce: true,
    clickBounceAmp: DEFAULT_CLICK_BOUNCE_AMP,
    clickBounceDuration: DEFAULT_CLICK_BOUNCE_DURATION,
    blinkSpeedSecOverride: null,
    blinkChanceOverride: null,
    blinkHoldSecOverride: null,
  };

  if (!scene.tuning || typeof scene.tuning !== 'object') {
    scene.tuning = {
      enableMouseFollow: true,
      enableClickBounce: true,
      clickBounceAmp: DEFAULT_CLICK_BOUNCE_AMP,
      clickBounceDuration: DEFAULT_CLICK_BOUNCE_DURATION,
      blinkSpeedSecOverride: null,
      blinkChanceOverride: null,
      blinkHoldSecOverride: null,
    };
  }
  return scene.tuning;
}


function getBlinkSpeedSeconds(scene) {
  const t = getSceneTuning(scene);
  const o = Number(t?.blinkSpeedSecOverride);
  if (Number.isFinite(o) && o > 0) return o;

  const s = Number(scene?.model?.settings?.blink_speed);
  return Number.isFinite(s) && s > 0 ? s : 1;
}

function getBlinkChance(scene) {
  const t = getSceneTuning(scene);
  const o = Number(t?.blinkChanceOverride);
  if (Number.isFinite(o) && o >= 1) return Math.floor(o);

  const c = Number(scene?.model?.settings?.blink_chance);
  // Godot: randi() % blink_chance == 0
  return Number.isFinite(c) && c >= 1 ? Math.floor(c) : 10;
}

function getBlinkHoldSeconds(scene) {
  const t = getSceneTuning(scene);
  const o = Number(t?.blinkHoldSecOverride);
  if (Number.isFinite(o) && o > 0) return o;

  // reaction_config.gd: %Blink.wait_time = 0.2 * Global.settings_dict.blink_speed
  return 0.2 * getBlinkSpeedSeconds(scene);
}

function stopAutoBlink(scene) {
  if (!scene) return;
  scene.autoBlink = false;
  scene._autoBlinkTimer = clearTimer(scene._autoBlinkTimer);
}

function startAutoBlink(scene) {
  if (!scene) return;
  stopAutoBlink(scene);
  scene.autoBlink = true;
  const intervalMs = Math.max(50, Math.floor(getBlinkSpeedSeconds(scene) * 1000));
  scene._autoBlinkTimer = setInterval(() => {
    if (!currentScene || currentScene !== scene) return;
    const chance = getBlinkChance(scene);
    const hit = (Math.floor(Math.random() * chance) === 0);
    if (hit) triggerBlink(scene);
  }, intervalMs);
}

function triggerBlink(scene) {
  if (!scene) return;

  // restart blink
  scene.blinking = true;
  updateDebug(scene);
  renderPartsPanel(scene);
  renderScene(scene);

  scene._blinkTimeout = clearTimer(scene._blinkTimeout);
  const holdMs = Math.max(30, Math.floor(getBlinkHoldSeconds(scene) * 1000));
  scene._blinkTimeout = setTimeout(() => {
    if (!currentScene || currentScene !== scene) return;
    scene.blinking = false;
    updateDebug(scene);
    renderPartsPanel(scene);
    renderScene(scene);
  }, holdMs);
}


function toRad(deg) {
  return (Number(deg) || 0) * Math.PI / 180;
}

function lerp(a, b, t) {
  const x = Number(a) || 0;
  const y = Number(b) || 0;
  const k = clamp(t, 0, 1);
  return x + (y - x) * k;
}

function wrapAngleRad(a) {
  const twoPi = Math.PI * 2;
  let x = (Number(a) || 0) % twoPi;
  if (x > Math.PI) x -= twoPi;
  if (x < -Math.PI) x += twoPi;
  return x;
}

function lerpAngle(a, b, t) {
  const x = Number(a) || 0;
  const y = Number(b) || 0;
  const d = wrapAngleRad(y - x);
  return x + d * clamp(t, 0, 1);
}

function moveToward(current, target, delta) {
  const c = Number(current) || 0;
  const t0 = Number(target) || 0;
  const d = Number(delta) || 0;
  if (d <= 0) return c;
  if (c < t0) return Math.min(t0, c + d);
  if (c > t0) return Math.max(t0, c - d);
  return c;
}

function getMaxFps(scene) {
  const f = Number(scene?.model?.settings?.max_fps);
  return Number.isFinite(f) && f > 0 ? clamp(Math.floor(f), 1, 240) : 60;
}

// --- Input tracking (mouse / keyboard / gamepad) ---
const input = {
  // Mouse tracking (for follow_to_mouse / animate_to_mouse)
  hasMouse: false,
  mouseCanvas: { x: 0, y: 0 },
  mouseWorld: { x: 0, y: 0 },

  // Keyboard (for follow_type=3..8)
  keysDown: new Set(),

  // Gamepad (best-effort; for follow_type=1/2)
  gamepad: {
    connected: false,
    axisLeft: { x: 0, y: 0 },
    axisRight: { x: 0, y: 0 },
  },
};

function getCameraMatrix(scene) {
  // Keep consistent with renderScene() camera math.
  resizeCanvasToDisplaySize(el.canvas);
  const w = el.canvas.width;
  const h = el.canvas.height;
  const cam = scene.camera;
  return Mat2D.translate(w / 2, h / 2)
    .multiply(Mat2D.translate(cam.pan.x, cam.pan.y))
    .multiply(Mat2D.scale(cam.zoom, cam.zoom));
}

function updateMouseWorld(scene) {
  if (!scene) return;

  // Important: when mouse is not available, keep last mouseWorld to avoid "snapping to origin"
  // which would incorrectly affect follow_type=0 logic.
  if (!input.hasMouse) return;

  const inv = getCameraMatrix(scene).invert();
  const p = inv.applyToPoint(input.mouseCanvas.x, input.mouseCanvas.y);
  input.mouseWorld.x = p.x;
  input.mouseWorld.y = p.y;
}

function updateGlobalBounce(scene, dtSec) {
  if (!scene) return;
  const settings = scene?.model?.settings || {};
  const tuning = getSceneTuning(scene);

  // Base bounce (from file settings)
  const enabled = !!settings.bounce_state;
  const yAmp = enabled ? (Number(settings.yAmp) || 0) : 0;
  const yFrq = enabled ? (Number(settings.yFrq) || 0) : 0;

  // Approx port from SpritesContainer.gd.
  // In Remix, the container bounce affects BOTH:
  // - a global Y translation (visual hop)
  // - `bounceChange` which feeds movement formulas (stretch/rotational_drag when !ignore_bounce)
  const targetY = (yAmp && yFrq) ? (Math.sin((Number(scene.tick) || 0) * yFrq) * yAmp) : 0;
  const smoothing = 1 - Math.pow(1 - 0.08, (dtSec || 0) * 60);
  scene._bouncePosY = lerp(Number(scene._bouncePosY) || 0, targetY, clamp(smoothing, 0, 1));

  // 1) Base bounce contribution
  const baseBounceY = (Number(scene._bouncePosY) || 0);

  // 2) Viewer click jump
  let clickY = 0;
  if (tuning.enableClickBounce !== false && scene._clickBounce && scene._clickBounce.active) {
    const cb = scene._clickBounce;
    cb.t = (Number(cb.t) || 0) + Math.max(0, Number(dtSec) || 0);
    const dur = Math.max(0.05, Number(cb.dur) || DEFAULT_CLICK_BOUNCE_DURATION);

    const amp = Math.max(0, Number(cb.amp) || 0);

    const p = clamp(cb.t / dur, 0, 1);
    // Simple "jump" curve: go up then return to 0.
    clickY = -Math.sin(p * Math.PI) * amp;

    if (p >= 1) cb.active = false;
  }

  // Combine into one "container bounce" so movement reacts to viewer click bounce too.
  const bounceY = baseBounceY + clickY;

  // Visual hop (container translation)
  scene.viewerJumpY = bounceY;

  // Movement coupling: match SpritesContainer.gd semantics roughly:
  // bounceChange = hold - currentY (per-frame delta), used by stretch/rotational_drag when !ignore_bounce.
  const hold = Number(scene._lastBounceY) || 0;
  scene.bounceChange = hold - bounceY;
  scene._lastBounceY = bounceY;
}





let _mouseTrackingSetup = false;
function scheduleStaticInputUpdate(scene) {
  if (!scene || scene.playing) return;
  if (scene._staticInputRafId) return;

  scene._staticInputRafId = requestAnimationFrame(() => {
    scene._staticInputRafId = 0;
    updateGamepadState();
    updateMouseWorld(scene);
    stepSceneRuntime(scene, 1 / 60);
    renderScene(scene);
  });
}

function setupMouseTracking() {
  if (_mouseTrackingSetup) return;
  _mouseTrackingSetup = true;

  const canvas = el.canvas;

  function updateFromClientXY(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    input.hasMouse = true;
    input.mouseCanvas.x = (clientX - rect.left) * dpr;
    input.mouseCanvas.y = (clientY - rect.top) * dpr;

    if (currentScene) {
      updateMouseWorld(currentScene);
      // In static mode, always schedule a refresh so mouse-driven layers can respond.
      scheduleStaticInputUpdate(currentScene);
    }
  }

  canvas.addEventListener('mousemove', (e) => {
    updateFromClientXY(e.clientX, e.clientY);
  });

  // Pointer events cover pen devices (and are consistent with the pan/zoom handlers).
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType && String(e.pointerType) === 'touch') return;
    updateFromClientXY(e.clientX, e.clientY);
  });

  canvas.addEventListener('mouseleave', () => {
    input.hasMouse = false;
    if (currentScene) {
      updateMouseWorld(currentScene);
      scheduleStaticInputUpdate(currentScene);
    }
  });
}


let _keyboardTrackingSetup = false;
function setupKeyboardTracking() {
  if (_keyboardTrackingSetup) return;
  _keyboardTrackingSetup = true;

  window.addEventListener('keydown', (e) => {
    const code = String(e.code || '');
    if (code) input.keysDown.add(code);
  }, { capture: true });

  window.addEventListener('keyup', (e) => {
    const code = String(e.code || '');
    if (code) input.keysDown.delete(code);
  }, { capture: true });

  window.addEventListener('blur', () => {
    input.keysDown.clear();
  });
}

function getAxis2dFromKeys(typeId) {
  const down = (code) => input.keysDown.has(code);

  // Matches `GlobalCalculations.some_keyboard_calc_wasd()`.
  if ([3, 4, 5].includes(typeId)) {
    // W/S -> ws.y/ws.x, A/D -> ad.y/ad.x
    const ws = { x: down('KeyS') ? 1 : 0, y: down('KeyW') ? 1 : 0 };
    const ad = { x: down('KeyD') ? 1 : 0, y: down('KeyA') ? 1 : 0 };

    if (typeId === 3) {
      const v = ws.x - ws.y;
      return { x: v, y: v };
    }
    if (typeId === 4) {
      const v = ad.x - ad.y;
      return { x: v, y: v };
    }
    // 5
    return { x: (ad.x - ad.y), y: (ws.x - ws.y) };
  }

  if ([6, 7, 8].includes(typeId)) {
    const ws = { x: down('ArrowDown') ? 1 : 0, y: down('ArrowUp') ? 1 : 0 };
    const ad = { x: down('ArrowRight') ? 1 : 0, y: down('ArrowLeft') ? 1 : 0 };

    if (typeId === 6) {
      const v = ws.x - ws.y;
      return { x: v, y: v };
    }
    if (typeId === 7) {
      const v = ad.x - ad.y;
      return { x: v, y: v };
    }
    // 8
    return { x: (ad.x - ad.y), y: (ws.x - ws.y) };
  }

  return { x: 0, y: 0 };
}

function updateGamepadState() {
  const pads = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : null;
  const p = pads && pads.length ? pads[0] : null;
  if (!p) {
    input.gamepad.connected = false;
    input.gamepad.axisLeft.x = 0;
    input.gamepad.axisLeft.y = 0;
    input.gamepad.axisRight.x = 0;
    input.gamepad.axisRight.y = 0;
    return;
  }

  const ax = Array.isArray(p.axes) ? p.axes : [];
  const clampAxis = (v) => clamp(Number(v) || 0, -1, 1);

  // Standard mapping: left stick (0,1), right stick (2,3).
  input.gamepad.connected = true;
  input.gamepad.axisLeft.x = clampAxis(ax[0]);
  input.gamepad.axisLeft.y = clampAxis(ax[1]);
  input.gamepad.axisRight.x = clampAxis(ax[2]);
  input.gamepad.axisRight.y = clampAxis(ax[3]);
}


function sceneHasDynamicContent(scene) {
  if (!scene) return false;
  if (scene.hasAnimatedTextures) return true;

  // Global bounce (file settings) is also dynamic.
  const settings = scene?.model?.settings || {};
  if (!!settings.bounce_state && (Number(settings.yAmp) || 0) && (Number(settings.yFrq) || 0)) return true;

  const stId = scene.stateId ?? 0;



  for (const n of scene.nodes || []) {
    const st = n.getState(stId);
    if (!st) continue;

    // Wiggle / wobble / drag / stretch / rotational_drag
    if (st.wiggle) return true;
    if (Number(st.xAmp || 0) || Number(st.yAmp || 0) || Number(st.xFrq || 0) || Number(st.yFrq || 0)) return true;
    if (Number(st.dragSpeed || 0) || Number(st.stretchAmount || 0) || Number(st.rdragStr || 0) || Number(st.rot_frq || 0)) return true;

    // Follow-to-mouse transform channels
    if (Number(st.follow_type ?? 15) !== 15) return true;
    if (Number(st.follow_type2 ?? 15) !== 15) return true;
    if (Number(st.follow_type3 ?? 15) !== 15) return true;

    // Animate sprite sheet to mouse (Godot: frame_coords)
    const hf = Math.max(1, Math.floor(Number(st.hframes) || 1));
    const vf = Math.max(1, Math.floor(Number(st.vframes) || 1));
    const total = hf * vf;
    if (!!st.animate_to_mouse && !!st.non_animated_sheet && total > 1) return true;

    // Sprite sheet animation
    if (!st.non_animated_sheet && total > 1 && Number(st.animation_speed || 0) > 0) return true;
  }

  return false;
}

function computeSceneBaseWorldPositions(scene) {
  if (!scene) return;

  function visit(node, parentMat) {
    const st = node.getState(scene.stateId);
    if (!st) return;

    const pos = st.position || { x: 0, y: 0 };
    const offset = st.offset || { x: 0, y: 0 };
    const scale = st.scale || { x: 1, y: 1 };
    const rotation = (Number(st.rotation) || 0);

    let baseMat = parentMat
      .multiply(Mat2D.translate(Number(pos.x) || 0, Number(pos.y) || 0))
      .multiply(Mat2D.rotate(rotation))
      .multiply(Mat2D.scale(Number(scale.x) || 1, Number(scale.y) || 1));

    let spriteMat = baseMat.multiply(Mat2D.translate(Number(offset.x) || 0, Number(offset.y) || 0));

    const flipX = !!st.flip_sprite_h;
    const flipY = !!st.flip_sprite_v;
    if (flipX || flipY) spriteMat = spriteMat.multiply(Mat2D.scale(flipX ? -1 : 1, flipY ? -1 : 1));

    const p = spriteMat.applyToPoint(0, 0);
    node.baseWorldPos.x = p.x;
    node.baseWorldPos.y = p.y;

    if (node.children && node.children.length) {
      for (const c of node.children) visit(c, spriteMat);
    }
  }

  for (const r of scene.roots) visit(r, Mat2D.identity());
}

function getMouthKeyForState(scene, st, baseKey) {
  if (!st || !baseKey) return baseKey;

  // Remix: if shared_movement=true, always use the "closed" param set.
  if (st.shared_movement) return baseKey;

  // Web viewer: mimic Mouth enum { Closed=0, Open=1, Screaming=2 }.
  const mouth = Math.floor(Number(scene?.mouthState ?? 0));
  const prefix = mouth === 1 ? 'mo_' : mouth === 2 ? 'scream_' : '';

  // Compatibility: some fields (e.g. follow_type) are not mouth-prefixed even when shared_movement=false.
  // Prefer the prefixed key only if it exists in the state dict.
  if (prefix) {
    const k = `${prefix}${baseKey}`;
    if (k in st) return k;
  }

  return baseKey;
}


function getMouthNumber(scene, st, baseKey, fallback = 0) {
  const k = getMouthKeyForState(scene, st, baseKey);
  const n = Number(st?.[k]);
  return Number.isFinite(n) ? n : fallback;
}

function getMouthBool(scene, st, baseKey, fallback = false) {
  const k = getMouthKeyForState(scene, st, baseKey);
  const v = st?.[k];
  if (typeof v === 'boolean') return v;
  if (v === 0 || v === 1) return !!v;
  return fallback;
}

function stepNodeRuntime(scene, node, dtSec) {
  if (!scene || !node) return;
  const st = node.getState(scene.stateId);
  if (!st) return;

  const tuning = getSceneTuning(scene);
  const enableMouseFollow = tuning.enableMouseFollow !== false;

  const shouldDelta = scene?.model?.settings?.should_delta !== false;
  const smoothing = 1 - Math.pow(1 - 0.05, dtSec * 60);

  // --- Sprite sheet animation ---
  const hf = Math.max(1, Math.floor(Number(st.hframes) || 1));
  const vf = Math.max(1, Math.floor(Number(st.vframes) || 1));
  const total = hf * vf;

  if (st.non_animated_sheet || total <= 1 || st.advanced_lipsync) {
    node.runtimeFrame = null;
    node._frameAcc = 0;
  } else {
    const speed = Math.max(0, Number(st.animation_speed) || 0);
    if (node.runtimeFrame === null || node.runtimeFrame === undefined) node.runtimeFrame = Math.floor(Number(st.frame) || 0);

    if (speed > 0) {
      node._frameAcc = (Number(node._frameAcc) || 0) + dtSec * speed;
      const steps = Math.floor(node._frameAcc);
      if (steps > 0) {
        node._frameAcc -= steps;
        const cur = Math.floor(Number(node.runtimeFrame) || 0);
        if (st.one_shot) node.runtimeFrame = Math.min(total - 1, cur + steps);
        else node.runtimeFrame = ((cur + steps) % total + total) % total;
      }
    }
  }

  // --- animate_to_mouse (frame_coords) ---
  node.runtimeFrameOverride = null;
  if (enableMouseFollow && st.non_animated_sheet && !!st.animate_to_mouse && total > 1) {
    // Align with follow_component.gd:update_sprite_animation(dir, dist)
    const base = node.baseWorldPos || { x: 0, y: 0 };
    const mw = input.mouseWorld || { x: 0, y: 0 };
    const mx = (mw.x - base.x);
    const my = (mw.y - base.y);

    const dist = Math.hypot(mx, my);
    const dirx = dist > 1e-6 ? (mx / dist) : 0;
    const diry = dist > 1e-6 ? (my / dist) : 0;

    const rangeX = Math.max(0, getMouthNumber(scene, st, 'look_at_mouse_pos', 0));
    const rangeY = Math.max(0, getMouthNumber(scene, st, 'look_at_mouse_pos_y', 0));

    if (rangeX > 1e-6 && rangeY > 1e-6) {
      const distX = dirx * Math.min(dist, rangeX);
      const distY = diry * Math.min(dist, rangeY);

      const normX = (distX / (2.0 * rangeX)) + 0.5;
      const normY = (distY / (2.0 * rangeY)) + 0.5;

      const frameX = clamp(Math.floor(normX * hf), 0, hf - 1);
      const frameY = clamp(Math.floor(normY * vf), 0, vf - 1);

      // Godot: move_toward(frame_h, frame_x, animate_to_mouse_speed) (per physics frame)
      const shouldDelta = scene?.model?.settings?.should_delta !== false;
      const speed = Math.max(0, Number(st.animate_to_mouse_speed) || 0);
      const step = speed * (shouldDelta ? (dtSec * 60) : 1);

      node._follow.frameH = moveToward(node._follow.frameH, frameX, step);
      node._follow.frameV = moveToward(node._follow.frameV, frameY, step);

      node.runtimeFrameOverride = (Math.floor(node._follow.frameV) * hf) + Math.floor(node._follow.frameH);
    }
  }

  // --- Wiggle (approx) ---
  if (st.wiggle) {
    const freq = Number(st.wiggle_freq) || 0;
    const amp = Number(st.wiggle_amp) || 0;
    const target = Math.sin((Number(scene.tick) || 0) * freq) * toRad(amp);
    node.runtimeWiggleRotation = lerp(node.runtimeWiggleRotation, target, smoothing);
  } else {
    node.runtimeWiggleRotation = lerp(node.runtimeWiggleRotation, 0, smoothing);
  }

  // follow_parent_effects: inherit parent wiggle if requested
  if (st.follow_parent_effects) {
    const parent = scene.nodeBySpriteId.get(node.parentId);
    if (parent) node.runtimeWiggleRotation = parent.runtimeWiggleRotation || 0;
  }

  // --- Rainbow effect (Movements.gd: rainbow/rainbow_self/rainbow_speed) ---
  if (st.rainbow) {
    const base = st.tint || { r: 1, g: 1, b: 1, a: 1 };
    if (!Number.isFinite(node._rainbowHue)) {
      const hsv = rgbToHsv(base.r ?? 1, base.g ?? 1, base.b ?? 1);
      node._rainbowHue = hsv.h;
    }
    const sp = Number(st.rainbow_speed);
    const step = (Number.isFinite(sp) ? sp : 0) * Math.max(0, dtSec);
    node._rainbowHue = wrap01((Number(node._rainbowHue) || 0) + step);
  } else {
    node._rainbowHue = Number.NaN;
  }


  // --- follow_type / follow_type2 / follow_type3 (align with follow_component.gd) ---
  // NOTE: follow_position uses `mouse_delay` directly (no dt), but rotation/scale use `mouse_delay * delta * 60`.
  const followType = Math.floor(getMouthNumber(scene, st, 'follow_type', 15));
  const followType2 = Math.floor(getMouthNumber(scene, st, 'follow_type2', 15));
  const followType3 = Math.floor(getMouthNumber(scene, st, 'follow_type3', 15));

  const mouseDelayRaw = clamp(getMouthNumber(scene, st, 'mouse_delay', 0.1), 0, 1);
  const tPos = mouseDelayRaw;
  const tRs = clamp(mouseDelayRaw * (shouldDelta ? dtSec * 60 : 1), 0, 1);

  // Helper: follow_position_calculations (ported)
  function followPositionCalculations(dir, mDist /* {x,y} or null */) {
    const posXMin = getMouthNumber(scene, st, 'pos_x_min', 0);
    const posXMax = getMouthNumber(scene, st, 'pos_x_max', 0);
    const posYMin = getMouthNumber(scene, st, 'pos_y_min', 0);
    const posYMax = getMouthNumber(scene, st, 'pos_y_max', 0);

    if (mDist && (mDist.x !== 0 || mDist.y !== 0)) {
      // mDist branch: clamp(dir * dist)
      const snap = !!st.snap_pos;
      const tx = clamp((Number(dir.x) || 0) * (Number(mDist.x) || 0), posXMin, posXMax);
      const ty = clamp((Number(dir.y) || 0) * (Number(mDist.y) || 0), posYMin, posYMax);

      if (snap) {
        if ((Number(dir.x) || 0) !== 0) {
          node._follow.targetPos.x = lerp(node._follow.targetPos.x, tx, tPos);
          node._follow.currentDir.x = dir.x;
        }
        if ((Number(dir.y) || 0) !== 0) {
          node._follow.targetPos.y = lerp(node._follow.targetPos.y, ty, tPos);
          node._follow.currentDir.y = dir.y;
        }
      } else {
        node._follow.targetPos.x = lerp(node._follow.targetPos.x, tx, tPos);
        node._follow.targetPos.y = lerp(node._follow.targetPos.y, ty, tPos);
        node._follow.currentDir.x = dir.x;
        node._follow.currentDir.y = dir.y;
      }

      node._follow.currentDist = Math.hypot(node._follow.targetPos.x, node._follow.targetPos.y);
      return;
    }

    // axis branch: map [-1,1] -> [min,max]
    const posNormX = clamp(Number(dir.x) || 0, -1, 1);
    const posNormY = clamp(Number(dir.y) || 0, -1, 1);

    const fx = Math.max(0.001, (posNormX * 0.5) + 0.5);
    const fy = Math.max(0.001, (posNormY * 0.5) + 0.5);

    const targetFinalX = lerp(posXMin, posXMax, fx);
    const targetFinalY = lerp(posYMin, posYMax, fy);

    const snap = !!st.snap_pos;
    if (snap) {
      if ((Number(dir.x) || 0) !== 0) {
        node._follow.targetPos.x = lerp(node._follow.targetPos.x, targetFinalX, tPos);
        node._follow.currentDir.x = dir.x;
      }
      if ((Number(dir.y) || 0) !== 0) {
        node._follow.targetPos.y = lerp(node._follow.targetPos.y, targetFinalY, tPos);
        node._follow.currentDir.y = dir.y;
      }
    } else {
      node._follow.targetPos.x = lerp(node._follow.targetPos.x, targetFinalX, tPos);
      node._follow.targetPos.y = lerp(node._follow.targetPos.y, targetFinalY, tPos);
      node._follow.currentDir.x = dir.x;
      node._follow.currentDir.y = dir.y;
    }

    node._follow.currentDist = Math.hypot(node._follow.targetPos.x, node._follow.targetPos.y);
  }

  // Default outputs (keep previous values unless we explicitly drive them)
  if (!node._follow.targetPos) node._follow.targetPos = { x: 0, y: 0 };
  if (!node._follow.currentDir) node._follow.currentDir = { x: 0, y: 0 };
  if (!Number.isFinite(node._follow.currentDist)) node._follow.currentDist = 0;

  // Compute mouse local coords (relative to this node's base position)
  const base = node.baseWorldPos || { x: 0, y: 0 };
  const mw = input.mouseWorld || { x: 0, y: 0 };

  // If mouse-follow is disabled (or mouse is not in canvas), treat mouse input as neutral.
  const mouseCoords = (enableMouseFollow && input.hasMouse)
    ? { x: (mw.x - base.x), y: (mw.y - base.y) }
    : { x: 0, y: 0 };

  const mouseDist = Math.hypot(mouseCoords.x, mouseCoords.y);
  const mouseDir = mouseDist > 1e-6 ? { x: mouseCoords.x / mouseDist, y: mouseCoords.y / mouseDist } : { x: 0, y: 0 };

  // follow_mouse_velocity: update lastDist + dirVelAnim (ported from follow_component.gd)
  if (enableMouseFollow && input.hasMouse && !!getMouthBool(scene, st, 'follow_mouse_velocity', false)) {
    const last = node._follow.lastMouseCoords || { x: 0, y: 0 };
    const mouseDelta = { x: (Number(last.x) || 0) - mouseCoords.x, y: (Number(last.y) || 0) - mouseCoords.y };
    const distV = { x: Math.tanh(mouseDelta.x), y: Math.tanh(mouseDelta.y) };
    if (!Number.isFinite(distV.x) || !Number.isFinite(distV.y)) {
      distV.x = 0;
      distV.y = 0;
    }

    if (Math.abs(mouseDelta.x) > 1e-6 || Math.abs(mouseDelta.y) > 1e-6) {
      node._follow.lastMouseCoords = { x: mouseCoords.x, y: mouseCoords.y };
    }

    const dirVelX = -Math.sign(mouseDelta.x);
    const dirVelY = -Math.sign(mouseDelta.y);
    const lenV = Math.hypot(distV.x, distV.y);

    const lookX = getMouthNumber(scene, st, 'look_at_mouse_pos', 0);
    const lookY = getMouthNumber(scene, st, 'look_at_mouse_pos_y', 0);

    node._follow.lastDist.x = lerp(node._follow.lastDist.x, dirVelX * (lenV * lookX), 0.5);
    node._follow.lastDist.y = lerp(node._follow.lastDist.y, dirVelY * (lenV * lookY), 0.5);

    node._follow.dirVelAnimX = mouseDelta.x;
    node._follow.dirVelAnimY = mouseDelta.y;
  }

  // --- position ---
  if (followType === 15) {
    node._follow.targetPos.x = 0;
    node._follow.targetPos.y = 0;
    node.runtimeFollowPos.x = lerp(node.runtimeFollowPos.x, 0, tPos);
    node.runtimeFollowPos.y = lerp(node.runtimeFollowPos.y, 0, tPos);
  } else {
    if (followType === 0) {
      if (enableMouseFollow && input.hasMouse) {
        if (!!getMouthBool(scene, st, 'follow_mouse_velocity', false)) {
          followPositionCalculations(mouseDir, node._follow.lastDist);
        } else {
          followPositionCalculations(mouseDir, { x: mouseDist, y: mouseDist });
        }
      } else {
        // No mouse input: ease back to neutral.
        node._follow.targetPos.x = lerp(node._follow.targetPos.x, 0, tPos);
        node._follow.targetPos.y = lerp(node._follow.targetPos.y, 0, tPos);
        node._follow.currentDir.x = 0;
        node._follow.currentDir.y = 0;
        node._follow.currentDist = 0;
      }
    } else if ([1, 2].includes(followType)) {
      const axis = (followType === 1) ? input.gamepad.axisLeft : input.gamepad.axisRight;
      followPositionCalculations(axis, null);
    } else if ([3, 4, 5, 6, 7, 8].includes(followType)) {
      const axis = getAxis2dFromKeys(followType);
      followPositionCalculations(axis, null);
    }

    // animate_to_mouse_track_pos=false: keep frame follow, but position should lerp back to zero.
    if (st.animate_to_mouse && st.non_animated_sheet && !st.animate_to_mouse_track_pos) {
      node.runtimeFollowPos.x = lerp(node.runtimeFollowPos.x, 0, tPos);
      node.runtimeFollowPos.y = lerp(node.runtimeFollowPos.y, 0, tPos);
    } else {
      const invertX = !!getMouthBool(scene, st, 'pos_invert_x', false);
      const invertY = !!getMouthBool(scene, st, 'pos_invert_y', false);
      const finalX = invertX ? -node._follow.targetPos.x : node._follow.targetPos.x;
      const finalY = invertY ? -node._follow.targetPos.y : node._follow.targetPos.y;
      node.runtimeFollowPos.x = lerp(node.runtimeFollowPos.x, finalX, tPos);
      node.runtimeFollowPos.y = lerp(node.runtimeFollowPos.y, finalY, tPos);
    }
  }

  // --- rotation ---
  if (followType2 === 15) {
    node.runtimeFollowRot = lerpAngle(node.runtimeFollowRot, 0, tRs);
  } else {
    const toRadMaybe = (v) => {
      const n = Number(v) || 0;
      return Math.abs(n) > 6.5 ? toRad(n) : n;
    };

    function followControllerRotation(axis) {
      const normalized = clamp(Number(axis?.x) || 0, -1, 1);
      const safeMin = clamp(getMouthNumber(scene, st, 'rLimitMin', -180), -360, 360);
      const safeMax = clamp(getMouthNumber(scene, st, 'rLimitMax', 180), -360, 360);
      const rotMin = toRadMaybe(getMouthNumber(scene, st, 'rot_min', 0));
      const rotMax = toRadMaybe(getMouthNumber(scene, st, 'rot_max', 0));
      const factor = lerp(rotMin, rotMax, Math.max((normalized + 1) / 2, 0.001));
      return clamp(factor, toRad(safeMin), toRad(safeMax));
    }

    let targetRot = 0;
    if ([3, 4, 5, 6, 7, 8].includes(followType2)) {
      const axis = getAxis2dFromKeys(followType2);
      if (!!st.snap_rot && (Math.abs(axis.x) > 1e-6 || Math.abs(axis.y) > 1e-6)) {
        targetRot = lerp(targetRot, followControllerRotation(axis), 0.15);
      } else {
        targetRot = followControllerRotation(axis);
      }
    } else if (followType2 === 0) {
      if (!enableMouseFollow || !input.hasMouse) {
        targetRot = 0;
      } else if (!!getMouthBool(scene, st, 'follow_mouse_velocity', false)) {
        // follow_component.gd: follow_mouse_vel_rotation()
        const vx = Number(node._follow.dirVelAnimX) || 0;
        const normX = Math.abs(vx) > 1e-6 ? (vx / Math.abs(vx)) : 0;
        let normalizedMouse = clamp(normX / 2, -1, 1);
        const rotMin = toRadMaybe(getMouthNumber(scene, st, 'rot_min', 0));
        const rotMax = toRadMaybe(getMouthNumber(scene, st, 'rot_max', 0));
        const rotationFactor = lerp(rotMin, rotMax, Math.max(0.01, (normalizedMouse * 0.5)));
        const safeMin = clamp(getMouthNumber(scene, st, 'rLimitMin', -180), -360, 360);
        const safeMax = clamp(getMouthNumber(scene, st, 'rLimitMax', 180), -360, 360);
        targetRot = clamp(normalizedMouse * rotationFactor * toRad(90), toRad(safeMin), toRad(safeMax));
      } else {
        // Web approximation (Godot uses screen width); use mouseDir.x as normalized axis.
        targetRot = followControllerRotation({ x: mouseDir.x, y: 0 });
      }
    } else if (followType2 === 1) targetRot = followControllerRotation(input.gamepad.axisLeft);
    else if (followType2 === 2) targetRot = followControllerRotation(input.gamepad.axisRight);

    node.runtimeFollowRot = lerpAngle(node.runtimeFollowRot, targetRot, tRs);
  }

  // --- scale ---
  if (followType3 === 15) {
    node.runtimeFollowScale.x = lerp(node.runtimeFollowScale.x, 1, tRs);
    node.runtimeFollowScale.y = lerp(node.runtimeFollowScale.y, 1, tRs);
  } else {
    const sMinX = getMouthNumber(scene, st, 'scale_x_min', 0);
    const sMaxX = getMouthNumber(scene, st, 'scale_x_max', 0);
    const sMinY = getMouthNumber(scene, st, 'scale_y_min', 0);
    const sMaxY = getMouthNumber(scene, st, 'scale_y_max', 0);

    const invertX = !!getMouthBool(scene, st, 'scale_invert_x', false);
    const invertY = !!getMouthBool(scene, st, 'scale_invert_y', false);

    let xVal = 0;
    let yVal = 0;

    if (followType3 === 0) {
      if (!enableMouseFollow || !input.hasMouse) {
        xVal = 0;
        yVal = 0;
      } else if (!!getMouthBool(scene, st, 'follow_mouse_velocity', false)) {
        // follow_mouse_vel_scale()
        const vx = Number(node._follow.dirVelAnimX) || 0;
        const normX = Math.abs(vx) > 1e-6 ? (vx / Math.abs(vx)) : 0;
        const normalizedMouse = clamp(normX / 2, -1, 1);
        const sclX = lerp(sMinX, sMaxX, Math.max(0.01, (normalizedMouse) / 2));
        const sclY = lerp(sMinY, sMaxY, Math.max(0.01, (normalizedMouse) / 2));
        xVal = sclX;
        yVal = sclY;
      } else {
        xVal = clamp(mouseDir.x, sMinX, sMaxX);
        yVal = clamp(mouseDir.y, sMinY, sMaxY);
      }
    } else if (followType3 === 1) {
      xVal = clamp(input.gamepad.axisLeft.x, sMinX, sMaxX);
      yVal = clamp(input.gamepad.axisLeft.y, sMinY, sMaxY);
    } else if (followType3 === 2) {
      xVal = clamp(input.gamepad.axisRight.x, sMinX, sMaxX);
      yVal = clamp(input.gamepad.axisRight.y, sMinY, sMaxY);
    } else if ([3, 4, 5, 6, 7, 8].includes(followType3)) {
      const axis = getAxis2dFromKeys(followType3);
      if (!!st.snap_scale && (Math.abs(axis.x) > 1e-6 || Math.abs(axis.y) > 1e-6)) {
        node._follow.scaleAxis = node._follow.scaleAxis || { x: 0, y: 0 };
        node._follow.scaleAxis.x = lerp(node._follow.scaleAxis.x, axis.x, 0.15);
        node._follow.scaleAxis.y = lerp(node._follow.scaleAxis.y, axis.y, 0.15);
      } else {
        node._follow.scaleAxis = { x: axis.x, y: axis.y };
      }
      xVal = clamp(node._follow.scaleAxis.x, sMinX, sMaxX);
      yVal = clamp(node._follow.scaleAxis.y, sMinY, sMaxY);
    }

    if (invertX) xVal *= -1;
    if (invertY) yVal *= -1;

    const targetSX = 1.0 - clamp(xVal, sMinX, sMaxX);
    const targetSY = 1.0 - clamp(yVal, sMinY, sMaxY);

    node.runtimeFollowScale.x = lerp(node.runtimeFollowScale.x, targetSX, tRs);
    node.runtimeFollowScale.y = lerp(node.runtimeFollowScale.y, targetSY, tRs);
  }

  // --- movements (wobble/drag/stretch/rotational_drag) approx (but formula-aligned) ---
  const xAmp = getMouthNumber(scene, st, 'xAmp', 0);
  const xFrq = getMouthNumber(scene, st, 'xFrq', 0);
  const yAmp = getMouthNumber(scene, st, 'yAmp', 0);
  const yFrq = getMouthNumber(scene, st, 'yFrq', 0);
  const dragSpeed = getMouthNumber(scene, st, 'dragSpeed', 0);
  const stretchAmount = getMouthNumber(scene, st, 'stretchAmount', 0);
  const rdragStr = getMouthNumber(scene, st, 'rdragStr', 0);
  const rotFrq = getMouthNumber(scene, st, 'rot_frq', 0);
  const rLimitMin = getMouthNumber(scene, st, 'rLimitMin', -180);
  const rLimitMax = getMouthNumber(scene, st, 'rLimitMax', 180);

  // drag_snap: if base position jumps too far, reset drag shadow to avoid long catch-up.
  const dragSnap = getMouthNumber(scene, st, 'drag_snap', 999999.0);
  if (Number.isFinite(dragSnap) && dragSnap !== 999999.0) {
    const last = node._move.lastBaseWorldPos;
    if (node._move.hasLastBaseWorldPos) {
      const dd = Math.hypot((base.x - last.x), (base.y - last.y));
      if (dd > dragSnap) {
        node._move.shadow.x = 0;
        node._move.shadow.y = 0;
        node._move.prevShadow.x = 0;
        node._move.prevShadow.y = 0;
      }
    }
    node._move.lastBaseWorldPos.x = base.x;
    node._move.lastBaseWorldPos.y = base.y;
    node._move.hasLastBaseWorldPos = true;
  }

  const paused = !!st.pause_movement;
  if (paused) {
    const useDelta = shouldDelta ? dtSec : (1 / 60);
    node._move.pausedWobble.x += useDelta;
    node._move.pausedWobble.y += useDelta;
    node._move.pausedRot += useDelta;
  }

  const wobbleX = (xAmp && xFrq) ? (Math.sin(((Number(scene.tick) || 0) - node._move.pausedWobble.x) * xFrq) * xAmp) : 0;
  const wobbleY = (yAmp && yFrq) ? (Math.sin(((Number(scene.tick) || 0) - node._move.pausedWobble.y) * yFrq) * yAmp) : 0;

  // Auto rotation (Movements.gd)
  node.runtimeAutoRot = 0;
  if (getMouthBool(scene, st, 'should_rotate', false)) {
    const speed = getMouthNumber(scene, st, 'should_rot_speed', 0) || 0;
    const step = speed * (shouldDelta ? dtSec * 60 : 1);
    node._move.shouldRot = (Number(node._move.shouldRot) || 0) + step;
    node.runtimeAutoRot = node._move.shouldRot;
  } else {
    node._move.shouldRot = 0;
  }

  const targetPos = { x: (node.runtimeFollowPos.x || 0) + wobbleX, y: (node.runtimeFollowPos.y || 0) + wobbleY };

  const prevShadow = { x: node._move.shadow.x, y: node._move.shadow.y };
  node._move.prevShadow.x = prevShadow.x;
  node._move.prevShadow.y = prevShadow.y;

  // drag (Movements.gd)
  if (dragSpeed > 0) {
    const tt = clamp(1 / dragSpeed, 0, 1);
    node._move.shadow.x = lerp(node._move.shadow.x, targetPos.x, tt);
    node._move.shadow.y = lerp(node._move.shadow.y, targetPos.y, tt);
  } else {
    node._move.shadow.x = lerp(node._move.shadow.x, targetPos.x, 0.85);
    node._move.shadow.y = lerp(node._move.shadow.y, targetPos.y, 0.85);
  }

  node.runtimeMovePos.x = node._move.shadow.x;
  node.runtimeMovePos.y = node._move.shadow.y;

  const lx = prevShadow.x - node._move.shadow.x;
  const ly = prevShadow.y - node._move.shadow.y;
  let length = (lx - ly);

  // physics: inherit parent's movement influence (approx)
  if (st.physics !== false) {
    const parent = scene.nodeBySpriteId.get(node.parentId);
    if (parent && parent._move && parent._move.prevShadow) {
      const plx = (Number(parent._move.prevShadow.x) || 0) - (Number(parent._move.shadow.x) || 0);
      const ply = (Number(parent._move.prevShadow.y) || 0) - (Number(parent._move.shadow.y) || 0);
      length += (plx + ply);
    }
  }

  // ignore_bounce: subtract global bounce contribution (SpritesContainer.gd)
  if (!st.ignore_bounce) {
    length -= (Number(scene.bounceChange) || 0);
  }

  // stretch
  if (stretchAmount) {
    const yvel = (length * stretchAmount * 0.01) * 0.5;
    const targetScale = { x: 1.0 - yvel, y: 1.0 + yvel };
    node._move.scale.x = lerp(node._move.scale.x, targetScale.x, 0.15);
    node._move.scale.y = lerp(node._move.scale.y, targetScale.y, 0.15);
  } else {
    node._move.scale.x = lerp(node._move.scale.x, 1.0, 0.15);
    node._move.scale.y = lerp(node._move.scale.y, 1.0, 0.15);
  }

  node.runtimeMoveScale.x = node._move.scale.x;
  node.runtimeMoveScale.y = node._move.scale.y;

  // rotational_drag
  let rot = 0;
  if (rotFrq && rdragStr) {
    rot = Math.sin(((Number(scene.tick) || 0) - node._move.pausedRot) * rotFrq) * toRad(rdragStr);
  }

  node._move.rot = lerpAngle(node._move.rot, rot, 0.15);

  if (rdragStr) {
    let yvel2 = (length * rdragStr) * 0.5;
    yvel2 = clamp(yvel2, Math.min(rLimitMin, rLimitMax), Math.max(rLimitMin, rLimitMax));
    node._move.rot = lerpAngle(node._move.rot, toRad(yvel2), 0.15);
  }

  node.runtimeMoveRot = node._move.rot;
}

function stepSceneRuntime(scene, dtSec) {
  if (!scene) return;
  computeSceneBaseWorldPositions(scene);

  function walk(n) {
    stepNodeRuntime(scene, n, dtSec);
    if (n && n.children && n.children.length) {
      for (const c of n.children) walk(c);
    }
  }

  for (const r of scene.roots || []) walk(r);
}

function stopPlayback(scene) {
  if (!scene) return;
  scene.playing = false;
  if (scene._rafId) {
    try { cancelAnimationFrame(scene._rafId); } catch (_) {}
  }
  scene._rafId = 0;
  scene._lastTs = 0;
}

function startPlayback(scene) {
  if (!scene) return;
  stopPlayback(scene);
  scene.playing = true;

  const maxFps = getMaxFps(scene);
  const minDeltaMs = 1000 / Math.max(1, maxFps);

  function frame(ts) {
    if (!currentScene || currentScene !== scene) {
      stopPlayback(scene);
      return;
    }
    if (!scene.playing) return;

    const last = Number(scene._lastTs) || 0;
    if (last && ts - last < minDeltaMs) {
      scene._rafId = requestAnimationFrame(frame);
      return;
    }

    const dtSec = last ? clamp((ts - last) / 1000, 0, 0.1) : (1 / maxFps);
    scene._lastTs = ts;

    // Align with Remix: Global.tick increments each physics frame.
    const shouldDelta = scene?.model?.settings?.should_delta !== false;
    scene.tick = (Number(scene.tick) || 0) + (shouldDelta ? dtSec * 60 : 1);

    updateGamepadState();
    updateGlobalBounce(scene, dtSec);
    updateMouseWorld(scene);
    stepSceneRuntime(scene, dtSec);
    renderScene(scene);

    // Update fps/debug at low frequency to avoid heavy UI work.
    scene._fpsAcc += dtSec;
    scene._fpsFrames += 1;
    if (scene._fpsAcc >= 0.5) {
      scene.fps = Math.round(scene._fpsFrames / scene._fpsAcc);
      scene._fpsAcc = 0;
      scene._fpsFrames = 0;
      updateDebug(scene);
    }

    scene._rafId = requestAnimationFrame(frame);
  }

  scene._rafId = requestAnimationFrame(frame);
}

function setPlayback(scene, enabled) {
  if (!scene) return;
  if (enabled) startPlayback(scene);
  else stopPlayback(scene);
}

function resetMouseFollowRuntime(scene) {
  if (!scene) return;
  for (const n of scene.nodes || []) {
    if (n.runtimeFollowPos) {
      n.runtimeFollowPos.x = 0;
      n.runtimeFollowPos.y = 0;
    }
    n.runtimeFollowRot = 0;
    if (n.runtimeFollowScale) {
      n.runtimeFollowScale.x = 1;
      n.runtimeFollowScale.y = 1;
    }
    n.runtimeFrameOverride = null;

    if (n._follow) {
      if (n._follow.targetPos) {
        n._follow.targetPos.x = 0;
        n._follow.targetPos.y = 0;
      }
      if (n._follow.currentDir) {
        n._follow.currentDir.x = 0;
        n._follow.currentDir.y = 0;
      }
      n._follow.currentDist = 0;
      n._follow.frameH = 0;
      n._follow.frameV = 0;
      if (n._follow.lastMouseCoords) {
        n._follow.lastMouseCoords.x = 0;
        n._follow.lastMouseCoords.y = 0;
      }
      if (n._follow.lastDist) {
        n._follow.lastDist.x = 0;
        n._follow.lastDist.y = 0;
      }
      n._follow.dirVelAnimX = 0;
      n._follow.dirVelAnimY = 0;
    }
  }
}

function startOneShotPlayback(scene, durationSec) {
  if (!scene) return;
  if (scene.playing) return; // normal playback already drives animation

  const untilMs = (performance.now ? performance.now() : Date.now()) + Math.max(0.05, Number(durationSec) || 0.3) * 1000;
  scene._oneShotUntilMs = untilMs;
  if (scene._oneShotRafId) return;

  let lastTs = 0;
  function frame(ts) {
    if (!currentScene || currentScene !== scene) {
      scene._oneShotRafId = 0;
      return;
    }
    if (ts > (scene._oneShotUntilMs || 0)) {
      scene._oneShotRafId = 0;
      return;
    }

    const dtSec = lastTs ? clamp((ts - lastTs) / 1000, 0, 0.1) : (1 / 60);
    lastTs = ts;

    const shouldDelta = scene?.model?.settings?.should_delta !== false;
    scene.tick = (Number(scene.tick) || 0) + (shouldDelta ? dtSec * 60 : 1);

    updateGamepadState();
    updateGlobalBounce(scene, dtSec);
    updateMouseWorld(scene);
    stepSceneRuntime(scene, dtSec);
    renderScene(scene);

    scene._oneShotRafId = requestAnimationFrame(frame);
  }

  scene._oneShotRafId = requestAnimationFrame(frame);
}

function triggerClickBounce(scene) {
  if (!scene) return;
  const tuning = getSceneTuning(scene);
  if (tuning.enableClickBounce === false) return;

  const amp = clamp(Number(tuning.clickBounceAmp) || 0, 0, 300);
  const dur = clamp(Number(tuning.clickBounceDuration) || DEFAULT_CLICK_BOUNCE_DURATION, 0.05, 3);


  if (!scene._clickBounce) scene._clickBounce = { active: false, t: 0, dur, amp };
  scene._clickBounce.active = true;
  scene._clickBounce.t = 0;
  scene._clickBounce.dur = dur;
  scene._clickBounce.amp = amp;

  // If not in "dynamic preview", run a short one-shot animation so the jump is visible.
  startOneShotPlayback(scene, dur + 0.12);

  updateDebug(scene);
  renderScene(scene);
}


function colorToCss(c, fallback = 'rgba(0,0,0,1)') {
  if (!c || typeof c !== 'object') return fallback;
  const r = clamp(c.r ?? 0, 0, 1);
  const g = clamp(c.g ?? 0, 0, 1);
  const b = clamp(c.b ?? 0, 0, 1);
  const a = clamp(c.a ?? 1, 0, 1);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
}

function mulColor(a, b) {
  const ar = clamp(a?.r ?? 1, 0, 1);
  const ag = clamp(a?.g ?? 1, 0, 1);
  const ab = clamp(a?.b ?? 1, 0, 1);
  const aa = clamp(a?.a ?? 1, 0, 1);

  const br = clamp(b?.r ?? 1, 0, 1);
  const bg = clamp(b?.g ?? 1, 0, 1);
  const bb = clamp(b?.b ?? 1, 0, 1);
  const ba = clamp(b?.a ?? 1, 0, 1);

  return { r: ar * br, g: ag * bg, b: ab * bb, a: aa * ba };
}

function wrap01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  const t = n % 1;
  return t < 0 ? t + 1 : t;
}

function quantize01(x, steps) {
  const n = clamp(x, 0, 1);
  const s = Math.max(1, Math.floor(Number(steps) || 1));
  return Math.round(n * s) / s;
}

// RGB<->HSV helpers (for rainbow effect)
function rgbToHsv(r, g, b) {
  const rr = clamp(r, 0, 1);
  const gg = clamp(g, 0, 1);
  const bb = clamp(b, 0, 1);
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;

  let h = 0;
  if (d > 1e-12) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h /= 6;
    h = wrap01(h);
  }

  const s = max <= 1e-12 ? 0 : (d / max);
  const v = max;
  return { h, s, v };
}

function hsvToRgb(h, s, v) {
  const hh = wrap01(h);
  const ss = clamp(s, 0, 1);
  const vv = clamp(v, 0, 1);

  const i = Math.floor(hh * 6);
  const f = hh * 6 - i;
  const p = vv * (1 - ss);
  const q = vv * (1 - f * ss);
  const t = vv * (1 - (1 - f) * ss);

  switch (i % 6) {
    case 0: return { r: vv, g: t, b: p };
    case 1: return { r: q, g: vv, b: p };
    case 2: return { r: p, g: vv, b: t };
    case 3: return { r: p, g: q, b: vv };
    case 4: return { r: t, g: p, b: vv };
    case 5: return { r: vv, g: p, b: q };
    default: return { r: vv, g: t, b: p };
  }
}

function isWhiteRgb(c) {
  const r = Number(c?.r ?? 1);
  const g = Number(c?.g ?? 1);
  const b = Number(c?.b ?? 1);
  return Math.abs(r - 1) < 1e-6 && Math.abs(g - 1) < 1e-6 && Math.abs(b - 1) < 1e-6;
}

// Cache tinted canvases: drawable -> ("r,g,b" -> canvas)
const _tintCache = new WeakMap();

function getTintedDrawable(drawable, color) {
  if (!drawable) return drawable;
  // NOTE: tint cache would freeze animated GIF/APNG; disable tinting for those drawables.
  if (drawable && drawable._isAnimated) return drawable;
  if (!color || isWhiteRgb(color)) return drawable;


  const { w, h } = getImageSize(drawable);
  if (!w || !h) return drawable;

  const key = `${Math.round(clamp(color.r, 0, 1) * 255)},${Math.round(clamp(color.g, 0, 1) * 255)},${Math.round(clamp(color.b, 0, 1) * 255)}`;

  let byColor = _tintCache.get(drawable);
  if (!byColor) {
    byColor = new Map();
    _tintCache.set(drawable, byColor);
  }

  const cached = byColor.get(key);
  if (cached) return cached;

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return drawable;

  // 1) draw original
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.drawImage(drawable, 0, 0);

  // 2) multiply by color (keep alpha)
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgb(${key})`;
  ctx.fillRect(0, 0, w, h);

  // 3) restore original alpha (defensive)
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(drawable, 0, 0);

  byColor.set(key, c);
  return c;
}

function compositeForBlendMode(mode) {
  switch (String(mode || 'Normal')) {
    case 'Normal': return 'source-over';
    case 'Add': return 'lighter';
    case 'Multiply': return 'multiply';
    case 'Subtract': return 'difference';
    case 'Burn': return 'multiply';
    case 'HardMix': return 'source-over';
    case 'Cursed': return 'source-over';
    default: return 'source-over';
  }
}

function isUsableImageBitmap(v) {
  return typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap;
}

function isGifBytes(bytes) {
  return bytes instanceof Uint8Array
    && bytes.length >= 6
    && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 // GIF
    && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61; // 87a / 89a
}

function isPngBytes(bytes) {
  return bytes instanceof Uint8Array
    && bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47
    && bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A;
}

function pngHasChunk(bytes, chunkType4) {
  if (!isPngBytes(bytes)) return false;
  if (typeof chunkType4 !== 'string' || chunkType4.length !== 4) return false;

  // PNG chunks: len(4) type(4) data(len) crc(4)
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8;
  while (off + 12 <= bytes.length) {
    const len = dv.getUint32(off, false);
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    if (type === chunkType4) return true;
    off += 12 + len;
    if (len < 0 || off > bytes.length) break;
  }
  return false;
}

function isApngBytes(bytes) {
  // APNG is a PNG with an `acTL` chunk.
  return isPngBytes(bytes) && pngHasChunk(bytes, 'acTL');
}

async function decodePngBytesToDrawable(bytes, nameForDebug = '') {
  if (!(bytes instanceof Uint8Array) || bytes.length < 6) return null;

  const isGif = isGifBytes(bytes);
  const isPng = isPngBytes(bytes);
  const isApng = isPng && isApngBytes(bytes);
  const isAnimated = isGif || isApng;

  const mime = isGif ? 'image/gif' : (isPng ? 'image/png' : 'application/octet-stream');
  const blob = new Blob([bytes], { type: mime });

  // Prefer ImageBitmap for static PNG (fast draw). For GIF/APNG we must keep an animating image.
  if (!isAnimated && mime === 'image/png' && typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch (e) {
      // fall through
      console.warn('[pngRemix] createImageBitmap failed', nameForDebug, e);
    }
  }

  // Fallback to HTMLImageElement (also used for GIF/APNG to preserve animation)
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    if (isAnimated) img._isAnimated = true;
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}


function getImageSize(drawable) {
  if (!drawable) return { w: 0, h: 0 };
  // ImageBitmap
  if (isUsableImageBitmap(drawable)) return { w: drawable.width, h: drawable.height };
  // HTMLImageElement
  if (drawable instanceof HTMLImageElement) return { w: drawable.naturalWidth || drawable.width, h: drawable.naturalHeight || drawable.height };
  // Canvas
  if (drawable instanceof HTMLCanvasElement) return { w: drawable.width, h: drawable.height };
  // OffscreenCanvas
  if (typeof OffscreenCanvas !== 'undefined' && drawable instanceof OffscreenCanvas) return { w: drawable.width, h: drawable.height };
  return { w: 0, h: 0 };
}

function applySpriteTextureTransforms(drawable, spriteRaw) {
  if (!drawable || !spriteRaw) return drawable;
  // Animated GIF/APNG must not be pre-rendered to a Canvas, otherwise it freezes to the first frame.
  if (drawable && drawable._isAnimated) return drawable;


  const flipH = !!spriteRaw.flipped_h;
  const flipV = !!spriteRaw.flipped_v;
  let rot = Math.floor(Number(spriteRaw.rotated) || 0);
  if (!Number.isFinite(rot)) rot = 0;
  rot = ((rot % 4) + 4) % 4;

  if (!flipH && !flipV && rot === 0) return drawable;

  const { w, h } = getImageSize(drawable);
  if (!w || !h) return drawable;

  const out = document.createElement('canvas');
  out.width = (rot % 2 === 1) ? h : w;
  out.height = (rot % 2 === 1) ? w : h;

  const ctx = out.getContext('2d');
  if (!ctx) return drawable;

  // Mirror PNGTuber Remix: check_flips() does flip first, then rotate_90 CLOCKWISE `rotated` times.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(rot * Math.PI / 2);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);

  ctx.drawImage(drawable, -w / 2, -h / 2);
  return out;
}


function drawImageFrame(ctx, drawable, hframes, vframes, frameIndex) {
  const { w, h } = getImageSize(drawable);
  if (!w || !h) return;
  const hf = Math.max(1, Math.floor(Number(hframes) || 1));
  const vf = Math.max(1, Math.floor(Number(vframes) || 1));
  const total = hf * vf;
  const f = total > 0 ? ((Math.floor(Number(frameIndex) || 0) % total) + total) % total : 0;
  const fw = w / hf;
  const fh = h / vf;
  const fx = (f % hf) * fw;
  const fy = Math.floor(f / hf) * fh;

  // Godot Sprite2D 默认 centered=true，因此以帧中心为原点。
  ctx.drawImage(drawable, fx, fy, fw, fh, -fw / 2, -fh / 2, fw, fh);
}

class Camera2D {
  constructor() {
    this.pan = { x: 0, y: 0 };
    this.zoom = 1;
  }
  reset() {
    this.pan.x = 0;
    this.pan.y = 0;
    this.zoom = 1;
  }
}

/** Runtime scene (Milestone 1) */
class RuntimeScene {
  /**
   * @param {any} model normalizedModel
   */
  constructor(model) {
    this.model = model;
    this.stateId = 0;
    this.drawBg = true;
    this.enableClip = true;
    this.showAllAssets = false;

    // Viewer-only global render offset (used by click bounce)
    this.viewerJumpY = 0;

    // Throttle static-mode updates on mouse move
    this._staticInputRafId = 0;


    // File-scoped id (for localStorage)
    this.fileHash = '';

    // Per-node visibility overrides: { [nodeKey: string]: boolean }
    this.visibilityOverrides = {};

    // Parts panel UI state
    this.partsUi = { search: '', filter: 'all' };

    // Hotkey groups (from Remix save: sprite.saved_keys like ['F2','F3',...])
    this.hotkeyGroups = [];
    this.availableHotkeys = new Set();

    // Runtime toggles (simulate Remix viewer behavior)
    // Mouth enum (align with Global.gd): 0=Closed, 1=Open, 2=Screaming
    this.mouthState = 0;
    this.speaking = false; // legacy UI flag (kept for compatibility)
    this.blinking = false;
    this.autoBlink = false;
    this._autoBlinkTimer = null;
    this._blinkTimeout = null;

    // Dynamic playback (Milestone 2)
    this.playing = false;
    this.tick = 0;
    this.fps = 0;
    this._rafId = 0;
    this._lastTs = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;

    // Global bounce (SpritesContainer.gd) — used by ignore_bounce in movements.
    this.bounceChange = 0;
    this._bouncePosY = 0;
    this._lastBounceY = 0;


    this.camera = new Camera2D();

    /** @type {Map<number, any>} */
    this.spriteDrawableByIndex = new Map();

    /** @type {Array<RuntimeNode>} */
    this.nodes = [];
    /** @type {Map<any, RuntimeNode>} */
    this.nodeBySpriteId = new Map();
    /** @type {Array<RuntimeNode>} */
    this.roots = [];
  }
}

class RuntimeNode {
  constructor(sprite, index) {
    this.index = index;
    this.spriteId = sprite.spriteId;
    this.parentId = sprite.parentId;
    this.name = sprite.spriteName;
    this.type = sprite.spriteType;
    this.raw = sprite.raw;

    // --- State machine (align with Remix runtime inheritance) ---
    // `savedStatePatches[i]` is a sparse patch (may be null).
    // `materializedStates[i]` is a cached fully materialized snapshot.
    this.savedStatePatches = [];
    this.materializedStates = [];
    this.runtimeState = null;

    // Runtime animation (Milestone 2)
    this.runtimeFrame = null;
    this.runtimeFrameOverride = null;
    this._frameAcc = 0;
    this.runtimeWiggleRotation = 0;

    // Rainbow effect runtime (movements.gd)
    this._rainbowHue = Number.NaN;

    // Visibility edge tracking (for should_reset / one_shot)
    this._visiblePrev = false;
    this._visibleNow = false;


    // Runtime follow-to-mouse / movements (Milestone 2)
    this.baseWorldPos = { x: 0, y: 0 };

    this.runtimeFollowPos = { x: 0, y: 0 };
    this.runtimeFollowRot = 0;
    this.runtimeFollowScale = { x: 1, y: 1 };

    this.runtimeMovePos = { x: 0, y: 0 };
    this.runtimeMoveRot = 0;
    this.runtimeMoveScale = { x: 1, y: 1 };

    // Auto rotation (Movements.gd: should_rotate/should_rot_speed)
    this.runtimeAutoRot = 0;

    // Internal accumulators (approx ports from Godot follow/movements components)
    this._follow = {
      // follow_component.gd accumulators
      targetPos: { x: 0, y: 0 },
      currentDir: { x: 0, y: 0 },
      currentDist: 0,

      frameH: 0,
      frameV: 0,

      // follow_mouse_velocity support (ported)
      lastMouseCoords: { x: 0, y: 0 },
      lastDist: { x: 0, y: 0 },
      dirVelAnimX: 0,
      dirVelAnimY: 0,

      // scale snap smoothing
      scaleAxis: { x: 0, y: 0 },
    };
    this._move = {
      shadow: { x: 0, y: 0 },
      prevShadow: { x: 0, y: 0 },
      rot: 0,
      scale: { x: 1, y: 1 },
      pausedWobble: { x: 0, y: 0 },
      pausedRot: 0,
      shouldRot: 0,

      // drag_snap support: track base world pos to detect large jumps
      lastBaseWorldPos: { x: 0, y: 0 },
      hasLastBaseWorldPos: false,
    };


    // Stable identity for UI/overrides
    this.key = '';
    this.path = '';
    this.pathIds = '';


    /** @type {Array<RuntimeNode>} */
    this.children = [];

    /** @type {number} */
    this.accZ = 0;
  }

  getState(_stateId) {
    const s = this.runtimeState;
    return s && typeof s === 'object' ? s : null;
  }
}

function idPartForNode(node) {
  const sid = node?.spriteId;
  if (sid !== null && sid !== undefined) return `id${sid}`;
  return `i${node?.index ?? 0}`;
}

function assignNodePaths(scene) {
  function walk(node, parent) {
    const idPart = idPartForNode(node);
    const namePart = String(node?.name || idPart);
    node.pathIds = parent ? `${parent.pathIds}/${idPart}` : idPart;
    node.path = parent ? `${parent.path}/${namePart}` : namePart;
    node.key = node.pathIds;
    if (node.children && node.children.length) {
      for (const c of node.children) walk(c, node);
    }
  }

  for (const r of scene.roots) walk(r, null);
}

function deepClone(v) {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(deepClone);
  if (v instanceof Uint8Array) return new Uint8Array(v);
  if (v instanceof Int32Array) return new Int32Array(v);
  if (v instanceof Float32Array) return new Float32Array(v);
  if (v instanceof Float64Array) return new Float64Array(v);
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = deepClone(v[k]);
    return out;
  }
  return v;
}

function cloneStateDefaults() {
  const d = globalThis.ModelNormalizer?.STATE_DEFAULTS;
  // STATE_DEFAULTS contains plain objects/arrays; deepClone is enough.
  return deepClone(d || {});
}

function applyStatePatchInPlace(state, patch) {
  if (!state || typeof state !== 'object' || !patch || typeof patch !== 'object') return state;
  for (const k of Object.keys(patch)) state[k] = deepClone(patch[k]);
  return state;
}

function materializeNodeState(node, targetStateId) {
  if (!node) return;
  const id = Math.max(0, Math.floor(Number(targetStateId) || 0));

  if (node.materializedStates && node.materializedStates[id]) {
    node.runtimeState = node.materializedStates[id];
    return;
  }

  const patch = node.savedStatePatches ? node.savedStatePatches[id] : null;

  // Remix behavior: switching state merges the state's dict into current sprite_data.
  // We mimic that by inheriting from current runtimeState.
  const next = deepClone(node.runtimeState || cloneStateDefaults());
  if (patch && typeof patch === 'object') applyStatePatchInPlace(next, patch);

  if (!node.materializedStates) node.materializedStates = [];
  node.materializedStates[id] = next;
  node.runtimeState = next;
}

function materializeSceneState(scene, targetStateId) {
  if (!scene) return;
  const count = Math.max(1, Math.floor(Number(scene.model?.stateCount) || 1));
  const id = clamp(Math.floor(Number(targetStateId) || 0), 0, count - 1);

  for (const n of scene.nodes || []) materializeNodeState(n, id);
  scene.stateId = id;

  // Reset on state change (SpriteObjectClass.gd: should_reset_state)
  for (const n of scene.nodes || []) {
    const st = n.getState(scene.stateId);
    if (st && st.should_reset_state) resetNodeAnimation(n, st);
  }
}

function initNodeStateMachine(scene) {
  if (!scene) return;
  const count = Math.max(1, Math.floor(Number(scene.model?.stateCount) || 1));

  for (const n of scene.nodes || []) {
    n.savedStatePatches = Array.isArray(n.raw?.states) ? n.raw.states : new Array(count).fill(null);
    n.materializedStates = new Array(count).fill(null);
    n.runtimeState = cloneStateDefaults();
  }

  materializeSceneState(scene, 0);
}

async function buildRuntimeScene(normalizedModel) {
  const scene = new RuntimeScene(normalizedModel);

  // Build nodes
  scene.nodes = normalizedModel.sprites.map((s) => new RuntimeNode(s, s.index));
  for (const n of scene.nodes) {
    if (n.spriteId !== null && n.spriteId !== undefined) scene.nodeBySpriteId.set(n.spriteId, n);
  }

  // Build hierarchy
  scene.roots = [];
  for (const n of scene.nodes) n.children = [];
  for (const n of scene.nodes) {
    const pid = n.parentId;
    const parent = scene.nodeBySpriteId.get(pid);
    if (parent && pid !== null && pid !== undefined) parent.children.push(n);
    else scene.roots.push(n);
  }

  assignNodePaths(scene);

  // Initialize state machine (required since states are sparse patches).
  initNodeStateMachine(scene);

  // Load images (static PNG + animated GIF/APNG)
  setLoading(true, t('pngRemixPreview.loading.decodeTextures'));

  scene.hasAnimatedTextures = false;

  const loadJobs = scene.nodes.map(async (n) => {
    const bytes = normalizedModel.sprites[n.index]?.imgBytes;
    if (!(bytes instanceof Uint8Array) || bytes.length < 6) return;

    let drawable = await decodePngBytesToDrawable(bytes, n.name);
    if (!drawable) return;

    // Track animated textures so playback defaults can enable.
    if (drawable._isAnimated) scene.hasAnimatedTextures = true;

    // For animated images, we cannot bake texture transforms to a canvas (it would freeze the animation).
    const flipH = !!n.raw?.flipped_h;
    const flipV = !!n.raw?.flipped_v;
    let rot = Math.floor(Number(n.raw?.rotated) || 0);
    if (!Number.isFinite(rot)) rot = 0;
    rot = ((rot % 4) + 4) % 4;

    n._texXform = (drawable._isAnimated && (flipH || flipV || rot !== 0)) ? { flipH, flipV, rot } : null;

    if (!drawable._isAnimated) {
      drawable = applySpriteTextureTransforms(drawable, n.raw);
    }

    scene.spriteDrawableByIndex.set(n.index, drawable);
  });

  await Promise.all(loadJobs);


  return scene;
}

function resizeCanvasToDisplaySize(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    return true;
  }
  return false;
}

function sortDrawItems(list) {
  // 稳定排序：z（小的先画） -> treeOrder（先遍历的先画）
  list.sort((a, b) => {
    const dz = a.z - b.z;
    if (dz !== 0) return dz;
    return a.order - b.order;
  });
}

function resetNodeAnimation(node, st) {
  if (!node) return;
  const hf = Math.max(1, Math.floor(Number(st?.hframes) || 1));
  const vf = Math.max(1, Math.floor(Number(st?.vframes) || 1));
  const total = hf * vf;
  if (total <= 1) {
    node.runtimeFrame = null;
    node.runtimeFrameOverride = null;
    node._frameAcc = 0;
    return;
  }

  node.runtimeFrame = 0;
  node.runtimeFrameOverride = null;
  node._frameAcc = 0;
}

function buildDrawList(scene, rootSpriteMat) {
  /** @type {Array<{order:number,z:number,mat:Mat2D,clip:Array<any>,alpha:number,blend:string,drawable:any,hf:any,vf:any,frame:any}>} */
  const items = [];

  // Reset per-frame visibility flags.
  for (const n of scene.nodes || []) n._visibleNow = false;

  const orderCounter = { v: 0 };
  const clipStack = [];

  function visit(node, parentSpriteMat, parentZ, inheritedRainbowHue) {
    const st = node.getState(scene.stateId);
    if (!st) return;

    // Visibility
    const overrideRaw = scene?.visibilityOverrides ? scene.visibilityOverrides[node.key] : undefined;
    const override = (overrideRaw && typeof overrideRaw === 'object') ? overrideRaw : null;
    const overrideValue = override ? override.visible : overrideRaw;


    if (overrideValue === false) {
      // 强制隐藏：按 Godot 规则，父节点隐藏也会隐藏子节点。
      return;
    }

    let visible = st.visible !== false;

    // Remix: Sprite2D self_modulate uses both `colored` and `tint`.
    const baseModulate = mulColor(st?.colored, st?.tint);

    // Rainbow effect (movements.gd): hue cycling.
    // - rainbow_self=true  => apply to this node only
    // - rainbow_self=false => apply to this node + children
    let rainbowHueForSelf = null;
    let rainbowHueForChildren = inheritedRainbowHue ?? null;

    if (st.rainbow && Number.isFinite(node._rainbowHue)) {
      const hq = quantize01(node._rainbowHue, 60); // cap cache size
      rainbowHueForSelf = hq;
      if (!st.rainbow_self) rainbowHueForChildren = hq;
    } else if (Number.isFinite(inheritedRainbowHue)) {
      rainbowHueForSelf = inheritedRainbowHue;
    }

    let modulate = baseModulate;
    if (Number.isFinite(rainbowHueForSelf ?? Number.NaN)) {
      const hsv = rgbToHsv(baseModulate.r ?? 1, baseModulate.g ?? 1, baseModulate.b ?? 1);
      const rgb = hsvToRgb(rainbowHueForSelf, 1, hsv.v);
      modulate = { r: rgb.r, g: rgb.g, b: rgb.b, a: baseModulate.a };
    }

    const alpha = clamp(modulate.a ?? 1, 0, 1);


    // Remix "Asset" 逻辑：如果该对象被标记为 asset，则初始显示由 `was_active_before` 控制。
    // 否则在 Web 静态渲染里会把所有可切换部件（多只手/多表情等）一起画出来。
    // NOTE: 当用户显式“强制显示”(override=true)时，我们允许绕过 `was_active_before`，
    // 但仍然会尊重 `state.visible=false`（避免把作者明确隐藏的部件硬拉出来）。
    if (!scene.showAllAssets && node.raw && node.raw.is_asset && overrideValue !== true) {
      visible = visible && !!node.raw.was_active_before;
    }

    // Remix 口型逻辑（viewer mode）：
    // - should_talk=true + open_mouth=true  => 仅在 mouth open（speaking/screaming）时显示
    // - should_talk=true + open_mouth=false => 仅在 mouth closed 时显示
    if (st.should_talk) {
      const openMouth = !!st.open_mouth;
      const mouthOpenNow = Math.floor(Number(scene?.mouthState ?? 0)) !== 0;
      visible = visible && (mouthOpenNow ? openMouth : !openMouth);
    }

    // Remix 眨眼逻辑（viewer mode）：
    // - should_blink=true + open_eyes=true  => 仅在 not blinking 时显示
    // - should_blink=true + open_eyes=false => 仅在 blinking 时显示
    if (st.should_blink) {
      const openEyes = !!st.open_eyes;
      visible = visible && (scene.blinking ? !openEyes : openEyes);
    }

    // 强制显示：允许绕过 Asset 默认隐藏/口型/眨眼互斥等规则。
    // 但仍尊重 `state.visible=false`（否则快捷键切换/手动覆写可能把应隐藏的部件显示出来）。
    // NOTE: `overrideValue===true` only bypasses Asset default hidden (`was_active_before`).
    // We still respect mouth/eye gating (should_talk/should_blink) to avoid breaking expression logic.
    // (If you want a true "force draw", we'd need a separate override mode.)

    if (!visible || alpha <= 0.001) {
      // In Godot, invisible parent hides children; follow that.
      return;
    }

    // Visibility edge: reset animation when a node becomes visible.
    node._visibleNow = true;
    if (!node._visiblePrev && (st.should_reset || st.one_shot)) {
      resetNodeAnimation(node, st);
    }



    const localZ = Number(st?.z_index ?? 0) || 0;
    const z = parentZ + localZ;

    const pos = st.position || { x: 0, y: 0 };
    const offset = st.offset || { x: 0, y: 0 };

    const followPos = node.runtimeFollowPos || { x: 0, y: 0 };
    const movePos = node.runtimeMovePos || { x: 0, y: 0 };
    const posX = (Number(pos.x) || 0) + (Number(followPos.x) || 0) + (Number(movePos.x) || 0);
    const posY = (Number(pos.y) || 0) + (Number(followPos.y) || 0) + (Number(movePos.y) || 0);

    const baseScale = st.scale || { x: 1, y: 1 };
    const followScale = node.runtimeFollowScale || { x: 1, y: 1 };
    const moveScale = node.runtimeMoveScale || { x: 1, y: 1 };
    const scale = {
      x: (Number(baseScale.x) || 1) * (Number(followScale.x) || 1) * (Number(moveScale.x) || 1),
      y: (Number(baseScale.y) || 1) * (Number(followScale.y) || 1) * (Number(moveScale.y) || 1),
    };

    const rotation = (Number(st.rotation) || 0)
      + (Number(node.runtimeWiggleRotation) || 0)
      + (Number(node.runtimeFollowRot) || 0)
      + (Number(node.runtimeMoveRot) || 0)
      + (Number(node.runtimeAutoRot) || 0);



    // Base: under parent Sprite2D
    let baseMat = parentSpriteMat
      .multiply(Mat2D.translate(posX, posY))
      .multiply(Mat2D.rotate(rotation))
      .multiply(Mat2D.scale(Number(scale.x) || 1, Number(scale.y) || 1));

    // Sprite2D local position (offset)
    let spriteMat = baseMat.multiply(Mat2D.translate(Number(offset.x) || 0, Number(offset.y) || 0));

    // flip_sprite_h/v affects children too (child is attached under Sprite2D)
    const flipX = !!st.flip_sprite_h;
    const flipY = !!st.flip_sprite_v;
    if (flipX || flipY) {
      spriteMat = spriteMat.multiply(Mat2D.scale(flipX ? -1 : 1, flipY ? -1 : 1));
    }

    const drawable = scene.spriteDrawableByIndex.get(node.index);
    const tintedDrawable = getTintedDrawable(drawable, modulate);

    // Record self draw command
    items.push({
      order: orderCounter.v++,
      z,
      mat: spriteMat,
      clip: clipStack.slice(),
      alpha,
      blend: compositeForBlendMode(st.blend_mode),
      drawable: tintedDrawable,
      texXform: node._texXform || null,
      hf: st.hframes ?? 1,
      vf: st.vframes ?? 1,
      frame: (node.runtimeFrameOverride ?? node.runtimeFrame ?? st.frame ?? 0),
    });


    // Push clip for children (Godot: clip children mode is on Sprite2D)
    const shouldClipChildren = scene.enableClip && Number(st.clip || 0) !== 0;
    if (shouldClipChildren && drawable) {
      const { w, h } = getImageSize(drawable);
      const hf = Math.max(1, Math.floor(Number(st.hframes) || 1));
      const vf = Math.max(1, Math.floor(Number(st.vframes) || 1));
      const fw = w / hf;
      const fh = h / vf;
      // centered rect in sprite local coords
      clipStack.push({ mat: spriteMat, x: -fw / 2, y: -fh / 2, w: fw, h: fh });
    }

    // children (keep original tree order; tie-breaker uses traversal order)
    if (node.children && node.children.length) {
      for (const c of node.children) visit(c, spriteMat, z, rainbowHueForChildren);
    }

    if (shouldClipChildren && drawable) clipStack.pop();
  }

  for (const r of scene.roots) visit(r, rootSpriteMat, 0, null);

  // Persist visibility flags for next frame.
  for (const n of scene.nodes || []) n._visiblePrev = !!n._visibleNow;

  return items;
}

function drawItem(ctx, item) {
  if (!item.drawable) return;

  // Apply clip stack (intersection)
  const hadClip = item.clip.length > 0;
  if (hadClip) {
    ctx.save();
    for (const clip of item.clip) {
      ctx.setTransform(clip.mat.a, clip.mat.b, clip.mat.c, clip.mat.d, clip.mat.e, clip.mat.f);
      ctx.beginPath();
      ctx.rect(clip.x, clip.y, clip.w, clip.h);
      ctx.clip();
    }
  }

  ctx.globalCompositeOperation = item.blend;
  ctx.globalAlpha = item.alpha;

  ctx.setTransform(item.mat.a, item.mat.b, item.mat.c, item.mat.d, item.mat.e, item.mat.f);

  // Apply per-texture transforms (for animated GIF/APNG we cannot bake transforms at load time).
  const tx = item.texXform;
  if (tx && (tx.flipH || tx.flipV || tx.rot)) {
    ctx.save();
    ctx.rotate((Number(tx.rot) || 0) * Math.PI / 2);
    ctx.scale(tx.flipH ? -1 : 1, tx.flipV ? -1 : 1);
    drawImageFrame(ctx, item.drawable, item.hf, item.vf, item.frame);
    ctx.restore();
  } else {
    drawImageFrame(ctx, item.drawable, item.hf, item.vf, item.frame);
  }


  if (hadClip) ctx.restore();
}

function renderScene(scene) {
  const canvas = el.canvas;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  resizeCanvasToDisplaySize(canvas);

  const w = canvas.width;
  const h = canvas.height;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // Background
  if (scene.drawBg) {
    const bg = scene.model?.settings?.bg_color;
    ctx.fillStyle = colorToCss(bg, 'rgba(40,45,60,1)');
    ctx.fillRect(0, 0, w, h);
  }

  // Camera
  const cam = scene.camera;
  const center = Mat2D.translate(w / 2, h / 2)
    .multiply(Mat2D.translate(cam.pan.x, cam.pan.y))
    .multiply(Mat2D.scale(cam.zoom, cam.zoom));

  // Viewer-only jump (click bounce): apply as a world-space translation at the root.
  const jumpY = Number(scene.viewerJumpY) || 0;
  const rootMat = Math.abs(jumpY) > 1e-6 ? center.multiply(Mat2D.translate(0, jumpY)) : center;

  // Build draw list and sort globally by z
  const items = buildDrawList(scene, rootMat);

  sortDrawItems(items);

  ctx.imageSmoothingEnabled = true;
  for (const it of items) drawItem(ctx, it);

  // Reset context state
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function computeNodeSelfVisibility(scene, node) {
  const st = node.getState(scene.stateId);
  if (!st) return { visible: false, reasons: [t('pngRemixPreview.parts.reason.missingState')] };

  const overrideRaw = scene?.visibilityOverrides ? scene.visibilityOverrides[node.key] : undefined;
  const override = (overrideRaw && typeof overrideRaw === 'object') ? overrideRaw : null;
  const overrideValue = override ? override.visible : overrideRaw;
  const overrideSource = override ? String(override.source || 'manual') : 'manual';

  if (overrideValue === false) return { visible: false, reasons: [t('pngRemixPreview.parts.reason.forceHidden')] };

  let visible = st.visible !== false;
  const modulate = mulColor(st?.colored, st?.tint);
  const alpha = clamp(modulate.a ?? 1, 0, 1);


  if (!scene.showAllAssets && node.raw && node.raw.is_asset && overrideValue !== true) {
    if (!node.raw.was_active_before) {
      visible = false;
    }
  }

  if (st.should_talk) {
    const openMouth = !!st.open_mouth;
    const mouthOpenNow = Math.floor(Number(scene?.mouthState ?? 0)) !== 0;
    const ok = mouthOpenNow ? openMouth : !openMouth;
    if (!ok) visible = false;
  }

  if (st.should_blink) {
    const openEyes = !!st.open_eyes;
    const ok = scene.blinking ? !openEyes : openEyes;
    if (!ok) visible = false;
  }

  // NOTE: `overrideValue===true` only bypasses Asset default hidden (`was_active_before`).
  // We still respect mouth/eye gating (should_talk/should_blink) to avoid breaking expression logic.
  // (If you want a true "force draw", we'd need a separate override mode.)

  if (alpha <= 0.001) visible = false;

  const reasons = [];
  if (overrideValue === true) reasons.push(overrideSource === 'hotkey'
    ? t('pngRemixPreview.parts.reason.hotkeyShow')
    : t('pngRemixPreview.parts.reason.forceShow'));
  if (overrideValue === false) reasons.push(overrideSource === 'hotkey'
    ? t('pngRemixPreview.parts.reason.hotkeyHide')
    : t('pngRemixPreview.parts.reason.forceHidden'));
  if (st.visible === false) reasons.push(t('pngRemixPreview.parts.reason.stateVisibleFalse'));
  if (alpha <= 0.001) reasons.push(t('pngRemixPreview.parts.reason.alphaZero'));
  if (!isWhiteRgb(modulate)) reasons.push(t('pngRemixPreview.parts.reason.tintColored'));
  if (!scene.showAllAssets && node.raw && node.raw.is_asset && !node.raw.was_active_before) reasons.push(t('pngRemixPreview.parts.reason.assetDefaultHidden'));
  if (st.should_talk) reasons.push(t('pngRemixPreview.parts.reason.mouth', {
    state: st.open_mouth ? t('pngRemixPreview.parts.reason.mouthOpen') : t('pngRemixPreview.parts.reason.mouthClosed')
  }));
  if (st.should_blink) reasons.push(t('pngRemixPreview.parts.reason.blink', {
    state: st.open_eyes ? t('pngRemixPreview.parts.reason.eyesOpen') : t('pngRemixPreview.parts.reason.eyesClosed')
  }));

  return { visible, reasons };
}

function computeNodeFinalVisibility(scene, node) {
  // Godot 规则：父节点不可见 => 子节点不可见。
  // 这里从当前节点一路向上找第一个隐藏源，作为“当前隐藏原因”。
  let cur = node;
  while (cur) {
    const res = computeNodeSelfVisibility(scene, cur);
    if (!res.visible) {
      const who = cur === node
        ? t('pngRemixPreview.parts.reason.self')
        : t('pngRemixPreview.parts.reason.parent', { name: cur.name });
      const reasonText = res.reasons.join(t('pngRemixPreview.common.listSeparator')) || t('pngRemixPreview.parts.reason.invisible');
      return { visible: false, reasons: [t('pngRemixPreview.parts.reason.hiddenReason', { who, reason: reasonText })] };
    }
    const pid = cur.parentId;
    cur = scene.nodeBySpriteId.get(pid);
  }
  return { visible: true, reasons: [] };
}

const PARTS_GROUP_ORDER = ['assetHidden', 'assetShown', 'talk', 'blink', 'other'];
const getGroupLabel = (key) => t(`pngRemixPreview.parts.group.${key}`);

function buildPartsEntries(scene) {
  const out = [];

  for (const n of scene.nodes) {
    const st = n.getState(scene.stateId);
    const hasDrawable = scene.spriteDrawableByIndex.has(n.index);

    const isAsset = !!n.raw?.is_asset;
    const wasActive = !!n.raw?.was_active_before;
    const defaultHidden = isAsset && !wasActive;

    const shouldTalk = !!st?.should_talk;
    const openMouth = !!st?.open_mouth;
    const shouldBlink = !!st?.should_blink;
    const openEyes = !!st?.open_eyes;

    // 只列出“有意义的部件”：
    // - 有贴图
    // - 或者是 Asset（可切换部件）
    // - 或者参与口型/眨眼互斥
    if (!(hasDrawable || isAsset || shouldTalk || shouldBlink)) continue;

    const override = scene?.visibilityOverrides ? scene.visibilityOverrides[n.key] : undefined;
    const vis = computeNodeFinalVisibility(scene, n);

    let group = 'other';
    if (defaultHidden) group = 'assetHidden';
    else if (isAsset) group = 'assetShown';
    else if (shouldTalk) group = 'talk';
    else if (shouldBlink) group = 'blink';

    out.push({
      key: n.key,
      node: n,
      group,
      title: String(n.name || '(unnamed)'),
      subtitle: `${n.path} · ${idPartForNode(n)}${n.type ? ` · ${n.type}` : ''}`,
      isAsset,
      wasActive,
      defaultHidden,
      hasDrawable,
      flags: { shouldTalk, openMouth, shouldBlink, openEyes },
      override,
      visibleNow: vis.visible,
      hiddenReasons: vis.reasons,
    });
  }

  out.sort((a, b) => {
    if (a.group !== b.group) {
      const ia = PARTS_GROUP_ORDER.indexOf(a.group);
      const ib = PARTS_GROUP_ORDER.indexOf(b.group);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return getGroupLabel(a.group).localeCompare(getGroupLabel(b.group), 'zh-CN');
    }
    return a.subtitle.localeCompare(b.subtitle, 'zh-CN');
  });

  return out;
}

function updatePartsSummary(entries, filtered) {
  const total = entries.length;
  const shown = filtered.length;
  const hiddenNow = filtered.filter(e => !e.visibleNow).length;
  const overridden = entries.filter(e => e.override === true || e.override === false).length;
  const defaultHidden = entries.filter(e => e.defaultHidden).length;

  el.partsSummary.textContent = t('pngRemixPreview.parts.summary', {
    total,
    defaultHidden,
    overridden,
    shown,
    hiddenNow,
  });
}

function renderPartsPanel(scene) {
  if (!scene) return;

  const entries = buildPartsEntries(scene);

  const search = String(scene.partsUi?.search || '').trim().toLowerCase();
  const filter = String(scene.partsUi?.filter || 'all');

  let filtered = entries;

  if (search) {
    filtered = filtered.filter(e => {
      const hay = `${e.title} ${e.subtitle} ${e.key}`.toLowerCase();
      return hay.includes(search);
    });
  }

  switch (filter) {
    case 'hidden_now':
      filtered = filtered.filter(e => !e.visibleNow);
      break;
    case 'default_hidden':
      filtered = filtered.filter(e => e.defaultHidden);
      break;
    case 'assets':
      filtered = filtered.filter(e => e.isAsset);
      break;
    case 'talk':
      filtered = filtered.filter(e => e.flags.shouldTalk);
      break;
    case 'blink':
      filtered = filtered.filter(e => e.flags.shouldBlink);
      break;
    case 'overridden':
      filtered = filtered.filter(e => e.override === true || e.override === false);
      break;
    default:
      break;
  }

  updatePartsSummary(entries, filtered);

  // Group
  const groups = new Map();
  for (const e of filtered) {
    if (!groups.has(e.group)) groups.set(e.group, []);
    groups.get(e.group).push(e);
  }

  const groupOrder = PARTS_GROUP_ORDER;

  el.partsList.innerHTML = '';
  const frag = document.createDocumentFragment();

  const groupNames = Array.from(groups.keys()).sort((a, b) => {
    const ia = groupOrder.indexOf(a);
    const ib = groupOrder.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return getGroupLabel(a).localeCompare(getGroupLabel(b), 'zh-CN');
  });

  for (const g of groupNames) {
    const list = groups.get(g) || [];

    const details = document.createElement('details');
    details.className = 'parts-group';
    details.open = (g === 'assetHidden' || g === 'talk' || g === 'blink');

    const summary = document.createElement('summary');
    summary.textContent = t('pngRemixPreview.parts.groupSummary', { name: getGroupLabel(g), count: list.length });
    details.appendChild(summary);

    for (const e of list) {
      const row = document.createElement('div');
      row.className = 'parts-row';

      const left = document.createElement('div');
      left.className = 'parts-name';

      const title = document.createElement('div');
      title.className = 'parts-title';
      title.textContent = e.title;

      const sub = document.createElement('div');
      sub.className = 'parts-sub';
      sub.textContent = e.subtitle;

      const tags = document.createElement('div');
      tags.className = 'parts-tags';

      function addPill(text, kind) {
        const p = document.createElement('span');
        p.className = `pill ${kind || ''}`.trim();
        p.textContent = text;
        tags.appendChild(p);
      }

      if (e.defaultHidden) addPill(t('pngRemixPreview.parts.pill.defaultHidden'), 'bad');
      else if (e.isAsset) addPill(t('pngRemixPreview.parts.pill.asset'), 'info');

      if (e.override === true) addPill(t('pngRemixPreview.parts.pill.forceShow'), 'info');
      else if (e.override === false) addPill(t('pngRemixPreview.parts.pill.forceHide'), 'info');

      addPill(e.visibleNow ? t('pngRemixPreview.parts.pill.visible') : t('pngRemixPreview.parts.pill.hidden'), e.visibleNow ? 'good' : 'bad');

      if (e.flags.shouldTalk) addPill(t('pngRemixPreview.parts.pill.mouth', {
        state: e.flags.openMouth ? t('pngRemixPreview.parts.pill.mouthOpen') : t('pngRemixPreview.parts.pill.mouthClosed')
      }), 'info');
      if (e.flags.shouldBlink) addPill(t('pngRemixPreview.parts.pill.blink', {
        state: e.flags.openEyes ? t('pngRemixPreview.parts.pill.eyesOpen') : t('pngRemixPreview.parts.pill.eyesClosed')
      }), 'info');

      if (!e.visibleNow && e.hiddenReasons && e.hiddenReasons.length) {
        addPill(e.hiddenReasons[0], 'bad');
      }

      left.appendChild(title);
      left.appendChild(sub);
      left.appendChild(tags);

      const sel = document.createElement('select');
      sel.className = 'parts-select';
      sel.dataset.key = e.key;

      const optDefault = document.createElement('option');
      optDefault.value = 'default';
      optDefault.textContent = t('pngRemixPreview.parts.override.default');
      const optShow = document.createElement('option');
      optShow.value = 'show';
      optShow.textContent = t('pngRemixPreview.parts.override.show');
      const optHide = document.createElement('option');
      optHide.value = 'hide';
      optHide.textContent = t('pngRemixPreview.parts.override.hide');

      sel.appendChild(optDefault);
      sel.appendChild(optShow);
      sel.appendChild(optHide);

      const ov = e.override;
      const ovVal = (ov && typeof ov === 'object') ? ov.visible : ov;
      const ovSource = (ov && typeof ov === 'object') ? String(ov.source || 'manual') : 'manual';
      // Hotkey overrides are not user manual overrides; keep UI as "默认" to avoid confusion.
      sel.value = (ovSource === 'hotkey') ? 'default' : (ovVal === true) ? 'show' : (ovVal === false) ? 'hide' : 'default';

      row.appendChild(left);
      row.appendChild(sel);
      details.appendChild(row);
    }

    frag.appendChild(details);
  }

  if (!groupNames.length) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.style.padding = '10px';
    empty.textContent = t('pngRemixPreview.parts.empty');
    frag.appendChild(empty);
  }

  el.partsList.appendChild(frag);
}

function normalizeKeyName(k) {
  const s = String(k || '').trim().toUpperCase();
  if (/^F\d+$/.test(s)) return s;
  return '';
}

function normalizeSavedDisappearEvent(ev) {
  // saved_disappear is stored as InputEventKey (Godot) objects; we best-effort map to F-keys.
  if (!ev) return { hotkey: '', label: '' };

  // Some projects may store strings here too.
  if (typeof ev === 'string') {
    const k = normalizeKeyName(ev);
    return { hotkey: k, label: k || String(ev) };
  }

  if (typeof ev !== 'object') return { hotkey: '', label: String(ev) };

  // GodotVariantParser returns objects as: { _type:'Object', className, props }
  const props = (ev._type === 'Object' && ev.props && typeof ev.props === 'object') ? ev.props : ev;

  const keycodeRaw = props.keycode ?? props.physical_keycode ?? props.physicalKeycode;
  const keycode = Number(keycodeRaw);
  const keyText = props.as_text ?? props.asText ?? props.text ?? props.key_string ?? props.keyString;

  // Heuristic: some ecosystems use JS-style keycodes (F1..F12 => 112..123).
  let hotkey = '';
  if (Number.isFinite(keycode) && keycode >= 112 && keycode <= 123) {
    hotkey = `F${keycode - 111}`;
  }

  if (!hotkey && typeof keyText === 'string') hotkey = normalizeKeyName(keyText);

  let label = '';
  if (hotkey) label = hotkey;
  else if (typeof keyText === 'string' && keyText.trim()) label = String(keyText).trim();
  else if (Number.isFinite(keycode)) label = t('pngRemixPreview.hotkeys.label.keycode', { code: keycode });
  else label = t('pngRemixPreview.hotkeys.label.unknown');


  return { hotkey, label };
}


function buildHotkeyGroups(scene) {
  const groupsByParent = new Map();
  const available = new Set();

  let disappearTotal = 0;
  let disappearMapped = 0;
  let disappearUnmapped = 0;

  for (const n of scene.nodes) {
    const raw = n.raw || {};
    if (!raw.is_asset) continue;

    const saved = Array.isArray(raw.saved_keys) ? raw.saved_keys : [];
    const keysFromSavedKeys = saved.map(normalizeKeyName).filter(Boolean);

    const disappear = Array.isArray(raw.saved_disappear) ? raw.saved_disappear : [];
    const disappearLabels = [];
    const keysFromDisappear = [];

    for (const ev of disappear) {
      disappearTotal += 1;
      const { hotkey, label } = normalizeSavedDisappearEvent(ev);
      if (label) disappearLabels.push(label);
      if (hotkey) {
        keysFromDisappear.push(hotkey);
        disappearMapped += 1;
      } else {
        disappearUnmapped += 1;
      }
    }

    const keys = Array.from(new Set([...keysFromSavedKeys, ...keysFromDisappear]));
    if (!keys.length && !disappearLabels.length) continue;

    const pid = n.parentId ?? null;
    if (!groupsByParent.has(pid)) {
      const parent = scene.nodeBySpriteId.get(pid);
      const title = parent ? parent.name : (pid === null ? 'Root' : `parent:${pid}`);
      groupsByParent.set(pid, { parentId: pid, title, nodes: [], extraKeys: new Set() });
    }

    const g = groupsByParent.get(pid);
    g.nodes.push({ node: n, savedKeys: new Set(keys), disappearLabels });

    for (const k of keys) available.add(k);
    for (const lb of disappearLabels) {
      if (!normalizeKeyName(lb)) g.extraKeys.add(lb);
    }
  }

  const groups = Array.from(groupsByParent.values());
  // Stable ordering: title then size
  groups.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-CN') || (b.nodes.length - a.nodes.length));

  scene.hotkeyGroups = groups;
  scene.availableHotkeys = available;
  scene.savedDisappearInfo = { total: disappearTotal, mapped: disappearMapped, unmapped: disappearUnmapped };
}


function renderHotkeyPanel(scene) {
  if (!scene) return;
  if (!Array.isArray(scene.hotkeyGroups) || !scene.hotkeyGroups.length) {
    if (el.hotkeySummary) el.hotkeySummary.textContent = t('pngRemixPreview.hotkeys.noGroups');
    if (el.hotkeyGroups) el.hotkeyGroups.innerHTML = '';
    setHotkeyUiEnabled(true);
    return;
  }


  const keys = Array.from(scene.availableHotkeys || []).sort((a, b) => {
    const na = Number(a.slice(1));
    const nb = Number(b.slice(1));
    return na - nb;
  });

  const di = scene.savedDisappearInfo || null;
  const extra = di && (di.total > 0)
    ? t('pngRemixPreview.hotkeys.extra', { total: di.total, mapped: di.mapped, unmapped: di.unmapped })
    : '';
  if (el.hotkeySummary) {
    const keysText = keys.join(t('pngRemixPreview.common.keySeparator')) || t('pngRemixPreview.hotkeys.none');
    el.hotkeySummary.textContent = t('pngRemixPreview.hotkeys.summary', {
      count: scene.hotkeyGroups.length,
      keys: keysText,
      extra,
    });
  }


  if (el.hotkeyGroups) {
    el.hotkeyGroups.innerHTML = '';
    const frag = document.createDocumentFragment();

    for (const g of scene.hotkeyGroups) {
      const box = document.createElement('div');
      box.className = 'hotkey-group';

      const title = document.createElement('div');
      title.className = 'hotkey-group-title';
      title.textContent = t('pngRemixPreview.hotkeys.groupTitle', { title: g.title, count: g.nodes.length });
      box.appendChild(title);

      const items = document.createElement('div');
      items.className = 'hotkey-group-items';

      // For each key, show which sprites will be forced visible.
      for (const k of keys) {
        const shown = g.nodes.filter(x => !x.savedKeys.has(k)).map(x => x.node.name);
        if (!shown.length) continue;

        const pill = document.createElement('span');
        pill.className = 'hotkey-k';
        pill.textContent = t('pngRemixPreview.hotkeys.item', {
          key: k,
          names: shown.join(t('pngRemixPreview.common.listSeparator')),
        });
        items.appendChild(pill);
      }

      box.appendChild(items);

      // Show extra / unmapped disappear keys (best-effort display).
      const extras = Array.from(g.extraKeys || []).slice(0, 18);
      if (extras.length) {
        const extraLine = document.createElement('div');
        extraLine.className = 'hint';
        extraLine.style.marginTop = '6px';
        const extraSuffix = (g.extraKeys && g.extraKeys.size > extras.length)
          ? t('pngRemixPreview.hotkeys.more')
          : '';
        extraLine.textContent = t('pngRemixPreview.hotkeys.extraKeys', {
          keys: extras.join(t('pngRemixPreview.common.keySeparator')),
          suffix: extraSuffix,
        });
        box.appendChild(extraLine);
      }

      frag.appendChild(box);
    }


    el.hotkeyGroups.appendChild(frag);
  }

  setHotkeyUiEnabled(true);
}

function applyHotkey(scene, key) {
  const k = normalizeKeyName(key);
  if (!k) return;
  if (!scene.availableHotkeys || !scene.availableHotkeys.has(k)) return;

  for (const g of scene.hotkeyGroups || []) {
    for (const x of g.nodes || []) {
      // Mimic Remix 'disappear on key' logic, but keep semantics:
      // - hotkey should switch assets' saved on/off
      // - but should NOT bypass mouth/eye gating (should_talk/should_blink)
      scene.visibilityOverrides[x.node.key] = {
        visible: x.savedKeys.has(k) ? false : true,
        source: 'hotkey',
        hotkey: k,
      };
    }
  }

  if (scene.fileHash) saveVisibilityOverrides(scene.fileHash, scene.visibilityOverrides);

  updateDebug(scene);
  renderPartsPanel(scene);
  renderHotkeyPanel(scene);
  renderScene(scene);
}

function clearHotkeyOverrides(scene) {
  if (!scene) return;
  // Only clear overrides created by hotkeys; keep user manual overrides.
  const keysToClear = new Set();
  for (const g of scene.hotkeyGroups || []) {
    for (const x of g.nodes || []) keysToClear.add(x.node.key);
  }

  for (const k of keysToClear) {
    const v = scene.visibilityOverrides ? scene.visibilityOverrides[k] : undefined;
    if (v && typeof v === 'object' && String(v.source || '') === 'hotkey') {
      delete scene.visibilityOverrides[k];
    }
  }

  if (scene.fileHash) saveVisibilityOverrides(scene.fileHash, scene.visibilityOverrides);
  updateDebug(scene);
  renderPartsPanel(scene);
  renderHotkeyPanel(scene);
  renderScene(scene);
}

function setHotkeyUiEnabled(enabled) {
  // Enable/disable the 9 buttons based on detected keys.
  const btns = el.hotkeyBar ? el.hotkeyBar.querySelectorAll('button.hotkey-btn') : [];
  for (const b of btns) {
    const k = String(b.dataset.key || '');
    const available = !!enabled && !!currentScene && currentScene.availableHotkeys && currentScene.availableHotkeys.has(k);
    b.disabled = !available;
  }
  el.hotkeyClearBtn.disabled = !enabled;

  if (!enabled) {
    if (el.hotkeySummary) el.hotkeySummary.textContent = '';
    if (el.hotkeyGroups) el.hotkeyGroups.innerHTML = '';
  }
}


function setPartsUiEnabled(enabled) {
  el.partsSearch.disabled = !enabled;
  el.partsFilter.disabled = !enabled;
  el.partsShowDefaultHiddenBtn.disabled = !enabled;
  el.partsHideAllBtn.disabled = !enabled;
  el.partsClearOverridesBtn.disabled = !enabled;

  // Control panel toggles live outside parts card, but we enable/disable them together.
  if (el.togglePlay) el.togglePlay.disabled = !enabled;

  if (el.toggleMouseFollow) el.toggleMouseFollow.disabled = !enabled;
  if (el.toggleClickBounce) el.toggleClickBounce.disabled = !enabled;
  if (el.clickBounceAmp) el.clickBounceAmp.disabled = !enabled;
  if (el.clickBounceDuration) el.clickBounceDuration.disabled = !enabled;

  if (el.blinkSpeedOverride) el.blinkSpeedOverride.disabled = !enabled;
  if (el.blinkChanceOverride) el.blinkChanceOverride.disabled = !enabled;
  if (el.blinkHoldOverride) el.blinkHoldOverride.disabled = !enabled;
  if (el.resetMotionTuningBtn) el.resetMotionTuningBtn.disabled = !enabled;

  setHotkeyUiEnabled(enabled);

  if (!enabled) {
    el.partsSearch.value = '';
    el.partsFilter.value = 'all';
    el.partsSummary.textContent = '';
    el.partsList.innerHTML = '';

    if (el.togglePlay) el.togglePlay.checked = false;

    if (el.toggleMouseFollow) el.toggleMouseFollow.checked = true;
    if (el.toggleClickBounce) el.toggleClickBounce.checked = true;

    if (el.clickBounceAmp) el.clickBounceAmp.value = '';
    if (el.clickBounceDuration) el.clickBounceDuration.value = '';
    if (el.blinkSpeedOverride) el.blinkSpeedOverride.value = '';
    if (el.blinkChanceOverride) el.blinkChanceOverride.value = '';
    if (el.blinkHoldOverride) el.blinkHoldOverride.value = '';
  }
}

function populateStateSelect(stateCount) {
  el.stateSelect.innerHTML = '';
  const count = Math.max(1, Number(stateCount) || 1);
  for (let i = 0; i < count; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = t('pngRemixPreview.state.option', { index: i });
    el.stateSelect.appendChild(opt);
  }
}

function populateSampleSelect() {
  // Generic sample loader: no file-name special casing.
  // Provide samples via either:
  // - `window.PNG_REMIX_PREVIEW_SAMPLES = [{ label, url }, ...]`
  // - URL query: `?sample=<url>` or `?samples=<label|url,label|url,...>`

  function inferLabelFromUrl(u) {
    try {
      const url = new URL(String(u));
      const last = url.pathname.split('/').filter(Boolean).pop() || '';
      return decodeURIComponent(last || t('pngRemixPreview.sample.defaultName'));
    } catch (_) {
      const s = String(u || '');
      return s.split('/').pop() || t('pngRemixPreview.sample.defaultName');
    }
  }

  const samples = [];

  // 1) Injected by host page / dev-server
  const injected = (typeof window !== 'undefined' && Array.isArray(window.PNG_REMIX_PREVIEW_SAMPLES))
    ? window.PNG_REMIX_PREVIEW_SAMPLES
    : null;
  if (injected) {
    for (const it of injected) {
      const url = it && typeof it === 'object' ? String(it.url || '') : '';
      if (!url) continue;
      const label = (it && typeof it === 'object' && it.label) ? String(it.label) : inferLabelFromUrl(url);
      samples.push({ label, url });
    }
  }

  // 2) Query params
  try {
    const sp = new URLSearchParams(location.search);
    const one = sp.get('sample');
    if (one) samples.push({ label: inferLabelFromUrl(one), url: one });

    const many = sp.get('samples');
    if (many) {
      for (const rawItem of String(many).split(',')) {
        const item = String(rawItem || '').trim();
        if (!item) continue;
        const parts = item.split('|');
        const url = parts.length >= 2 ? parts.slice(1).join('|') : item;
        const label = parts.length >= 2 ? parts[0] : inferLabelFromUrl(url);
        if (!url) continue;
        samples.push({ label, url });
      }
    }
  } catch (_) {}

  if (!samples.length) {
    el.sampleSelect.innerHTML = `<option value="">${t('pngRemixPreview.sample.none')}</option>`;
    el.sampleSelect.disabled = true;
    el.loadSampleBtn.disabled = true;
    return;
  }

  el.sampleSelect.innerHTML = `<option value="">${t('pngRemixPreview.sample.fromUrl')}</option>`;
  for (const s of samples) {
    const opt = document.createElement('option');
    opt.value = s.url;
    opt.textContent = s.label;
    el.sampleSelect.appendChild(opt);
  }

  el.sampleSelect.disabled = false;
  el.loadSampleBtn.disabled = false;
}

let currentScene = null;

async function loadFromArrayBuffer(arrayBuffer, displayName = t('pngRemixPreview.sample.unnamed')) {
  if (!window.PngRemixDecoder || !window.ModelNormalizer) {
    setStatus(t('pngRemixPreview.error.missingDecoder'), 'err');
    return;
  }

  setLoading(true, t('pngRemixPreview.loading.decodeFile'));

  try {
    // Stop previous scene playback/timers
    if (currentScene) {
      stopPlayback(currentScene);
      stopAutoBlink(currentScene);
    }

    const decoded = window.PngRemixDecoder.decode(arrayBuffer);
    const normalized = window.ModelNormalizer.normalizePngRemixModel(decoded);


    const fullHash = await sha256HexOfArrayBuffer(arrayBuffer);
    const fileHash = String(fullHash || '').slice(0, 12) || `len_${arrayBuffer.byteLength}`;

    // Build runtime
    const scene = await buildRuntimeScene(normalized);
    scene.fileHash = fileHash;
    scene.visibilityOverrides = loadVisibilityOverrides(fileHash);

    scene.stateId = 0;
    scene.drawBg = true;
    scene.enableClip = true;
    scene.showAllAssets = false;
    scene.mouthState = 0;
    scene.speaking = false;
    scene.blinking = false;
    stopAutoBlink(scene);

    // Viewer runtime tuning (per load; does not modify file content)
    scene.tuning = {
      enableMouseFollow: true,
      enableClickBounce: true,
      clickBounceAmp: DEFAULT_CLICK_BOUNCE_AMP,
      clickBounceDuration: DEFAULT_CLICK_BOUNCE_DURATION,
      blinkSpeedSecOverride: null,
      blinkChanceOverride: null,
      blinkHoldSecOverride: null,
    };
    scene._clickBounce = { active: false, t: 0, dur: scene.tuning.clickBounceDuration, amp: scene.tuning.clickBounceAmp };


    // Parts UI init
    scene.partsUi = { search: '', filter: 'all' };

    // Hotkey groups init (based on sprite.saved_keys)
    buildHotkeyGroups(scene);

    currentScene = scene;

    // Expose runtime for quick tuning in DevTools
    try {
      globalThis.pngRemixPreview = { scene, tuning: scene.tuning };
    } catch (_) {}

    // Update UI
    el.fileInfo.style.display = '';
    el.fileName.textContent = displayName;
    el.version.textContent = String(normalized.version || '-');
    el.stateCount.textContent = String(normalized.stateCount || 0);
    el.spriteCount.textContent = String(normalized.sprites.length);

    populateStateSelect(normalized.stateCount || 1);

    el.stateSelect.disabled = false;
    el.toggleBg.disabled = false;
    el.toggleClip.disabled = false;
    el.toggleShowAllAssets.disabled = false;
    el.toggleSpeaking.disabled = false;
    if (el.toggleScreaming) el.toggleScreaming.disabled = false;
    el.blinkOnceBtn.disabled = false;
    el.toggleAutoBlink.disabled = false;
    if (el.togglePlay) el.togglePlay.disabled = false;
    el.fitBtn.disabled = false;



    el.resetViewBtn.disabled = false;

    setPartsUiEnabled(true);
    el.partsSearch.value = '';
    el.partsFilter.value = 'all';

    el.toggleBg.checked = true;
    el.toggleClip.checked = true;
    el.toggleShowAllAssets.checked = false;
    el.toggleSpeaking.checked = false;
    if (el.toggleScreaming) el.toggleScreaming.checked = false;
    el.toggleAutoBlink.checked = false;

    // Interaction / tuning UI
    if (el.toggleMouseFollow) el.toggleMouseFollow.checked = true;
    if (el.toggleClickBounce) el.toggleClickBounce.checked = true;
    if (el.clickBounceAmp) el.clickBounceAmp.value = String(scene.tuning.clickBounceAmp);
    if (el.clickBounceDuration) el.clickBounceDuration.value = String(scene.tuning.clickBounceDuration);

    // Motion overrides: keep empty (means "use file settings"), but show the defaults as placeholders.
    const fileBlinkSpeed = Number(scene?.model?.settings?.blink_speed);
    const fileBlinkChance = Number(scene?.model?.settings?.blink_chance);
    if (el.blinkSpeedOverride) {
      el.blinkSpeedOverride.value = '';
      el.blinkSpeedOverride.placeholder = Number.isFinite(fileBlinkSpeed) && fileBlinkSpeed > 0 ? String(fileBlinkSpeed) : '1';
    }
    if (el.blinkChanceOverride) {
      el.blinkChanceOverride.value = '';
      el.blinkChanceOverride.placeholder = Number.isFinite(fileBlinkChance) && fileBlinkChance >= 1 ? String(Math.floor(fileBlinkChance)) : '10';
    }
    if (el.blinkHoldOverride) {
      el.blinkHoldOverride.value = '';
      el.blinkHoldOverride.placeholder = String(Math.round(getBlinkHoldSeconds(scene) * 1000) / 1000);
    }

    // Dynamic playback default: enable only if this file contains animated content.
    if (el.togglePlay) {
      el.togglePlay.checked = sceneHasDynamicContent(scene);
      setPlayback(scene, !!el.togglePlay.checked);
    }




    // initial fit (rough)
    fitViewToContent(scene);

    setStatus(t('pngRemixPreview.status.loadSuccess'), 'ok');

    updateDebug(scene);
    renderHotkeyPanel(scene);
    renderPartsPanel(scene);
    renderScene(scene);
  } catch (e) {
    console.error(e);
    setStatus(String(e && e.stack ? e.stack : e), 'err');
  } finally {
    setLoading(false);
  }
}

function updateDebug(scene) {
  const missing = scene.nodes.filter(n => !scene.spriteDrawableByIndex.get(n.index)).length;
  const withImg = scene.spriteDrawableByIndex.size;

  const totalAssets = scene.nodes.filter(n => !!n.raw?.is_asset).length;
  const hiddenAssets = scene.nodes.filter(n => !!n.raw?.is_asset && !n.raw?.was_active_before).length;

  const stId = scene.stateId;
  const talkLayers = scene.nodes.filter(n => !!n.getState(stId)?.should_talk).length;
  const mouthOpenLayers = scene.nodes.filter(n => !!n.getState(stId)?.should_talk && !!n.getState(stId)?.open_mouth).length;
  const blinkLayers = scene.nodes.filter(n => !!n.getState(stId)?.should_blink).length;
  const openEyeLayers = scene.nodes.filter(n => !!n.getState(stId)?.should_blink && !!n.getState(stId)?.open_eyes).length;

  // Optional, user-configurable visibility diagnostics.
  // - `?debugTargets=name1,name2,...` to pin specific node names.
  // - otherwise show up to a few nodes that currently have overrides.
  const debugTargets = (() => {
    try {
      const raw = new URLSearchParams(location.search).get('debugTargets') || '';
      const fromQuery = raw.split(',').map(s => String(s || '').trim()).filter(Boolean);
      if (fromQuery.length) return fromQuery.slice(0, 12);
    } catch (_) {}

    const keys = Object.keys(scene.visibilityOverrides || {}).slice(0, 8);
    const names = [];
    for (const k of keys) {
      const n = scene.nodes.find(x => x && x.key === k);
      if (n && n.name) names.push(n.name);
    }
    return names;
  })();

  const targets = {};
  for (const name of debugTargets) {
    const n = scene.nodes.find(x => x && x.name === name);
    if (!n) continue;
    const st = n.getState(scene.stateId);
    const vis = computeNodeFinalVisibility(scene, n);
    const ov = scene.visibilityOverrides ? scene.visibilityOverrides[n.key] : undefined;
    targets[name] = {
      key: n.key,
      spriteId: n.spriteId,
      override: ov,
      visible: vis.visible,
      reasons: vis.reasons,
      state: st ? {
        visible: st.visible,
        should_talk: st.should_talk,
        open_mouth: st.open_mouth,
        should_blink: st.should_blink,
        open_eyes: st.open_eyes,
      } : null,
      raw: n.raw ? { is_asset: !!n.raw.is_asset, was_active_before: !!n.raw.was_active_before, saved_keys: n.raw.saved_keys || [] } : null,
    };
  }

  const info = {
    version: scene.model.version,
    fileHash: scene.fileHash || '',
    visibilityOverrides: { count: Object.keys(scene.visibilityOverrides || {}).length },
    stateId: scene.stateId,
    stateCount: scene.model.stateCount,
    sprites: scene.nodes.length,
    imagesDecoded: withImg,
    imagesMissing: missing,
    assets: { total: totalAssets, hiddenBySave: hiddenAssets, showAllAssets: !!scene.showAllAssets },
    expression: {
      mouthState: Math.floor(Number(scene.mouthState ?? 0)),
      speaking: !!scene.speaking,
      blinking: !!scene.blinking,
      autoBlink: !!scene.autoBlink,
      blinkSpeed: getBlinkSpeedSeconds(scene),
      blinkChance: getBlinkChance(scene),
      blinkHold: getBlinkHoldSeconds(scene),
      talkLayers,
      mouthOpenLayers,
      blinkLayers,
      openEyeLayers,
    },
    follow: {
      mouseWorld: { x: Math.round((input?.mouseWorld?.x || 0) * 100) / 100, y: Math.round((input?.mouseWorld?.y || 0) * 100) / 100 },
      keyboardDown: Array.from(input.keysDown || []).slice(0, 20),
      gamepad: { connected: !!input.gamepad.connected, axisLeft: input.gamepad.axisLeft, axisRight: input.gamepad.axisRight },
      animateToMouseLayers: scene.nodes.filter(n => !!n.getState(scene.stateId)?.animate_to_mouse && !!n.getState(scene.stateId)?.non_animated_sheet).length,
      followTypeLayers: scene.nodes.filter(n => Number(n.getState(scene.stateId)?.follow_type ?? 15) !== 15 || Number(n.getState(scene.stateId)?.follow_type2 ?? 15) !== 15 || Number(n.getState(scene.stateId)?.follow_type3 ?? 15) !== 15).length,
      followMouseVelocityLayers: scene.nodes.filter(n => !!n.getState(scene.stateId)?.follow_mouse_velocity).length,
      autoRotateLayers: scene.nodes.filter(n => !!n.getState(scene.stateId)?.should_rotate && Number(n.getState(scene.stateId)?.should_rot_speed || 0) !== 0).length,
      movementLayers: scene.nodes.filter(n => {
        const st = n.getState(scene.stateId);
        if (!st) return false;
        return !!(Number(st.xAmp || 0) || Number(st.yAmp || 0) || Number(st.xFrq || 0) || Number(st.yFrq || 0) || Number(st.dragSpeed || 0) || Number(st.stretchAmount || 0) || Number(st.rdragStr || 0) || Number(st.rot_frq || 0));
      }).length,
    },
    tuning: {
      enableMouseFollow: getSceneTuning(scene).enableMouseFollow !== false,
      enableClickBounce: getSceneTuning(scene).enableClickBounce !== false,
      clickBounceAmp: Number(getSceneTuning(scene).clickBounceAmp) || 0,
      clickBounceDuration: Number(getSceneTuning(scene).clickBounceDuration) || 0,
      blinkSpeedSecOverride: getSceneTuning(scene).blinkSpeedSecOverride,
      blinkChanceOverride: getSceneTuning(scene).blinkChanceOverride,
      blinkHoldSecOverride: getSceneTuning(scene).blinkHoldSecOverride,
    },
    // Quick per-layer visibility diagnostics
    targets,

    playback: {
      playing: !!scene.playing,
      fps: scene.fps || 0,
      tick: Math.round((Number(scene.tick) || 0) * 100) / 100,
      maxFps: getMaxFps(scene),
    },
    notes: [
      t('pngRemixPreview.debug.notes.milestone2Frames'),
      t('pngRemixPreview.debug.notes.milestone2Follow'),
      t('pngRemixPreview.debug.notes.milestone2Wobble'),
      t('pngRemixPreview.debug.notes.milestone3Tint'),
      t('pngRemixPreview.debug.notes.assetVisibility'),
      t('pngRemixPreview.debug.notes.expressionEyes'),
    ],
  };
  el.debug.textContent = JSON.stringify(info, null, 2);
}

function fitViewToContent(scene) {
  // 粗略 fit：用所有 sprite 的 position 做包围盒（忽略旋转/尺寸）
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;

  for (const n of scene.nodes) {
    const st = n.getState(scene.stateId);
    if (!st) continue;
    if (st.visible === false) continue;
    const p = st.position || { x: 0, y: 0 };
    const x = Number(p.x) || 0;
    const y = Number(p.y) || 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    count++;
  }

  if (!count || !Number.isFinite(minX)) {
    scene.camera.reset();
    return;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // 适当缩放（给一点边距）
  const contentW = Math.max(1, (maxX - minX));
  const contentH = Math.max(1, (maxY - minY));

  // Camera pan 是以画布 device pixel 为单位的；因此这里用 canvas.width/height 计算。
  resizeCanvasToDisplaySize(el.canvas);
  const targetW = Math.max(1, el.canvas.width);
  const targetH = Math.max(1, el.canvas.height);

  const s = Math.min(targetW / contentW, targetH / contentH) * 0.65;
  scene.camera.zoom = clamp(s, 0.05, 6);

  // 将内容中心对齐到画布中心：pan（像素）= -contentCenter（世界）* zoom
  scene.camera.pan.x = -cx * scene.camera.zoom;
  scene.camera.pan.y = -cy * scene.camera.zoom;
}

// --- UI wiring ---

function setupDnD() {
  const dz = el.dropZone;

  dz.addEventListener('click', () => el.fileInput.click());

  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('dragover');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', async (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    await loadFromArrayBuffer(await file.arrayBuffer(), file.name);
  });

  el.fileInput.addEventListener('change', async () => {
    const file = el.fileInput.files?.[0];
    if (!file) return;
    await loadFromArrayBuffer(await file.arrayBuffer(), file.name);
    el.fileInput.value = '';
  });
}

function setupControls() {
  setupMouseTracking();
  setupKeyboardTracking();

  el.stateSelect.addEventListener('change', () => {
    if (!currentScene) return;
    materializeSceneState(currentScene, Number(el.stateSelect.value) || 0);
    // Keep camera stable on state switch; use “适配视图”按钮 when needed.
    updateDebug(currentScene);
    renderPartsPanel(currentScene);
    renderScene(currentScene);
  });

  el.toggleBg.addEventListener('change', () => {
    if (!currentScene) return;
    currentScene.drawBg = el.toggleBg.checked;
    renderScene(currentScene);
  });

  el.toggleClip.addEventListener('change', () => {
    if (!currentScene) return;
    currentScene.enableClip = el.toggleClip.checked;
    renderScene(currentScene);
  });

  el.toggleShowAllAssets.addEventListener('change', () => {
    if (!currentScene) return;
    currentScene.showAllAssets = el.toggleShowAllAssets.checked;
    updateDebug(currentScene);
    renderPartsPanel(currentScene);
    renderScene(currentScene);
  });

  // --- Interaction / tuning ---
  if (el.toggleMouseFollow) {
    el.toggleMouseFollow.addEventListener('change', () => {
      if (!currentScene) return;
      const t = getSceneTuning(currentScene);
      t.enableMouseFollow = !!el.toggleMouseFollow.checked;
      if (!t.enableMouseFollow) resetMouseFollowRuntime(currentScene);

      updateDebug(currentScene);
      renderPartsPanel(currentScene);
      renderScene(currentScene);
    });
  }

  if (el.toggleClickBounce) {
    el.toggleClickBounce.addEventListener('change', () => {
      if (!currentScene) return;
      const t = getSceneTuning(currentScene);
      t.enableClickBounce = !!el.toggleClickBounce.checked;
      updateDebug(currentScene);
    });
  }

  if (el.clickBounceAmp) {
    el.clickBounceAmp.addEventListener('input', () => {
      if (!currentScene) return;
      const vRaw = String(el.clickBounceAmp.value || '').trim();
      const v = vRaw === '' ? DEFAULT_CLICK_BOUNCE_AMP : Number(vRaw);

      const t = getSceneTuning(currentScene);
      t.clickBounceAmp = clamp(v, 0, 300);
      updateDebug(currentScene);
    });
  }

  if (el.clickBounceDuration) {
    el.clickBounceDuration.addEventListener('input', () => {
      if (!currentScene) return;
      const vRaw = String(el.clickBounceDuration.value || '').trim();
      const v = vRaw === '' ? DEFAULT_CLICK_BOUNCE_DURATION : Number(vRaw);

      const t = getSceneTuning(currentScene);
      t.clickBounceDuration = clamp(v, 0.05, 3);
      updateDebug(currentScene);
    });
  }

  function setOverrideNumber(scene, key, rawValue) {
    const t = getSceneTuning(scene);
    const s = String(rawValue ?? '').trim();
    if (!s) {
      t[key] = null;
      return;
    }
    const n = Number(s);
    t[key] = Number.isFinite(n) ? n : null;
  }

  function onMotionOverrideChanged() {
    if (!currentScene) return;
    setOverrideNumber(currentScene, 'blinkSpeedSecOverride', el.blinkSpeedOverride ? el.blinkSpeedOverride.value : '');
    setOverrideNumber(currentScene, 'blinkChanceOverride', el.blinkChanceOverride ? el.blinkChanceOverride.value : '');
    setOverrideNumber(currentScene, 'blinkHoldSecOverride', el.blinkHoldOverride ? el.blinkHoldOverride.value : '');

    // If auto blink is running, restart so new interval is applied.
    if (currentScene.autoBlink) startAutoBlink(currentScene);

    updateDebug(currentScene);
    renderPartsPanel(currentScene);
  }

  if (el.blinkSpeedOverride) el.blinkSpeedOverride.addEventListener('input', onMotionOverrideChanged);
  if (el.blinkChanceOverride) el.blinkChanceOverride.addEventListener('input', onMotionOverrideChanged);
  if (el.blinkHoldOverride) el.blinkHoldOverride.addEventListener('input', onMotionOverrideChanged);

  if (el.resetMotionTuningBtn) {
    el.resetMotionTuningBtn.addEventListener('click', () => {
      if (!currentScene) return;
      const t = getSceneTuning(currentScene);
      t.blinkSpeedSecOverride = null;
      t.blinkChanceOverride = null;
      t.blinkHoldSecOverride = null;

      if (el.blinkSpeedOverride) el.blinkSpeedOverride.value = '';
      if (el.blinkChanceOverride) el.blinkChanceOverride.value = '';
      if (el.blinkHoldOverride) el.blinkHoldOverride.value = '';

      if (currentScene.autoBlink) startAutoBlink(currentScene);

      updateDebug(currentScene);
      renderPartsPanel(currentScene);
      renderScene(currentScene);
    });
  }

  function syncMouthStateFromUi() {
    if (!currentScene) return;
    const screaming = !!(el.toggleScreaming && el.toggleScreaming.checked);
    const speaking = !!el.toggleSpeaking.checked;

    // 0=Closed, 1=Open, 2=Screaming
    currentScene.mouthState = screaming ? 2 : (speaking ? 1 : 0);
    currentScene.speaking = speaking; // keep for older UI/debug notes

    updateDebug(currentScene);
    renderPartsPanel(currentScene);
    renderScene(currentScene);
  }

  el.toggleSpeaking.addEventListener('change', () => {
    if (!currentScene) return;
    // If user disables speaking, also disable screaming to keep states consistent.
    if (!el.toggleSpeaking.checked && el.toggleScreaming) el.toggleScreaming.checked = false;
    syncMouthStateFromUi();
  });

  if (el.toggleScreaming) {
    el.toggleScreaming.addEventListener('change', () => {
      if (!currentScene) return;
      // Screaming implies mouth open.
      if (el.toggleScreaming.checked) el.toggleSpeaking.checked = true;
      syncMouthStateFromUi();
    });
  }

  el.blinkOnceBtn.addEventListener('click', () => {
    if (!currentScene) return;
    triggerBlink(currentScene);
    updateDebug(currentScene);
    renderPartsPanel(currentScene);
  });

  el.toggleAutoBlink.addEventListener('change', () => {
    if (!currentScene) return;
    if (el.toggleAutoBlink.checked) startAutoBlink(currentScene);
    else stopAutoBlink(currentScene);
    updateDebug(currentScene);
    renderPartsPanel(currentScene);
  });

  if (el.togglePlay) {
    el.togglePlay.addEventListener('change', () => {
      if (!currentScene) return;
      setPlayback(currentScene, !!el.togglePlay.checked);
      updateDebug(currentScene);
      // Make sure follow/mouse-driven transforms get a first update in static mode.
      if (!currentScene.playing && sceneHasDynamicContent(currentScene)) {
        updateGamepadState();
        updateMouseWorld(currentScene);
        stepSceneRuntime(currentScene, 1 / 60);
        renderScene(currentScene);
      }
    });
  }


  el.fitBtn.addEventListener('click', () => {
    if (!currentScene) return;
    fitViewToContent(currentScene);
    renderScene(currentScene);
  });

  el.resetViewBtn.addEventListener('click', () => {
    if (!currentScene) return;
    currentScene.camera.reset();
    renderScene(currentScene);
  });

  el.loadSampleBtn.addEventListener('click', async () => {
    const url = el.sampleSelect.value;
    if (!url) {
      setStatus(t('pngRemixPreview.error.selectSample'));
      return;
    }
    setLoading(true, t('pngRemixPreview.loading.loadingSample'));
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(t('pngRemixPreview.error.loadSampleHttp', { status: res.status }));
      const ab = await res.arrayBuffer();
      const name = el.sampleSelect.options[el.sampleSelect.selectedIndex]?.textContent || t('pngRemixPreview.sample.defaultName');
      await loadFromArrayBuffer(ab, name);
    } catch (e) {
      console.error(e);
      setStatus(String(e && e.stack ? e.stack : e), 'err');
    } finally {
      setLoading(false);
    }
  });
}

function setupPartsManager() {
  // Search / filter
  el.partsSearch.addEventListener('input', () => {
    if (!currentScene) return;
    currentScene.partsUi.search = String(el.partsSearch.value || '');
    renderPartsPanel(currentScene);
  });

  el.partsFilter.addEventListener('change', () => {
    if (!currentScene) return;
    currentScene.partsUi.filter = String(el.partsFilter.value || 'all');
    renderPartsPanel(currentScene);
  });

  // Per-row override
  el.partsList.addEventListener('change', (e) => {
    if (!currentScene) return;
    const target = e.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (!target.classList.contains('parts-select')) return;

    const key = String(target.dataset.key || '');
    if (!key) return;

    const val = String(target.value || 'default');
    if (val === 'default') delete currentScene.visibilityOverrides[key];
    else if (val === 'show') currentScene.visibilityOverrides[key] = { visible: true, source: 'manual' };
    else if (val === 'hide') currentScene.visibilityOverrides[key] = { visible: false, source: 'manual' };

    if (currentScene.fileHash) saveVisibilityOverrides(currentScene.fileHash, currentScene.visibilityOverrides);

    updateDebug(currentScene);
    renderPartsPanel(currentScene);
    renderScene(currentScene);
  });

  // Bulk
  el.partsShowDefaultHiddenBtn.addEventListener('click', () => {
    if (!currentScene) return;
    const entries = buildPartsEntries(currentScene);
    for (const e of entries) {
      if (e.defaultHidden) currentScene.visibilityOverrides[e.key] = { visible: true, source: 'manual' };
    }
    if (currentScene.fileHash) saveVisibilityOverrides(currentScene.fileHash, currentScene.visibilityOverrides);
    updateDebug(currentScene);
    renderPartsPanel(currentScene);
    renderScene(currentScene);
  });

  el.partsHideAllBtn.addEventListener('click', () => {
    if (!currentScene) return;
    const entries = buildPartsEntries(currentScene);
    for (const e of entries) {
      if (e.hasDrawable) currentScene.visibilityOverrides[e.key] = { visible: false, source: 'manual' };
    }
    if (currentScene.fileHash) saveVisibilityOverrides(currentScene.fileHash, currentScene.visibilityOverrides);
    updateDebug(currentScene);
    renderPartsPanel(currentScene);
    renderScene(currentScene);
  });

  el.partsClearOverridesBtn.addEventListener('click', () => {
    if (!currentScene) return;
    currentScene.visibilityOverrides = {};
    if (currentScene.fileHash) saveVisibilityOverrides(currentScene.fileHash, currentScene.visibilityOverrides);
    updateDebug(currentScene);
    renderPartsPanel(currentScene);
    renderScene(currentScene);
  });

  // Hotkeys (from saved_keys)
  if (el.hotkeyBar) {
    el.hotkeyBar.addEventListener('click', (e) => {
      if (!currentScene) return;
      const t = e.target;
      if (!(t instanceof HTMLButtonElement)) return;
      if (!t.classList.contains('hotkey-btn')) return;
      const key = String(t.dataset.key || '');
      if (!key) return;
      applyHotkey(currentScene, key);
    });
  }

  el.hotkeyClearBtn.addEventListener('click', () => {
    if (!currentScene) return;
    clearHotkeyOverrides(currentScene);
  });

  window.addEventListener('keydown', (e) => {
    if (!currentScene) return;
    const k = String(e.code || e.key || '');
    // Use e.code if available (F1..F12); fallback to e.key.
    const keyName = normalizeKeyName(k.startsWith('F') ? k : e.key);
    if (!keyName) return;
    const n = Number(keyName.slice(1));
    if (!Number.isFinite(n) || n < 1 || n > 9) return;

    // Avoid browser default help on F1.
    e.preventDefault();
    applyHotkey(currentScene, keyName);
  }, { capture: true });
}


function setupCanvasInteraction() {
  const canvas = el.canvas;
  let isPanning = false;
  let last = { x: 0, y: 0 };
  let down = { x: 0, y: 0, ts: 0 };
  let moved = false;

  canvas.addEventListener('pointerdown', (e) => {
    if (!currentScene) return;
    isPanning = true;
    moved = false;
    down.x = e.clientX;
    down.y = e.clientY;
    down.ts = performance.now ? performance.now() : Date.now();

    canvas.setPointerCapture(e.pointerId);
    last.x = e.clientX;
    last.y = e.clientY;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!currentScene || !isPanning) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    last.x = e.clientX;
    last.y = e.clientY;

    if (!moved) {
      const total = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (total >= 4) moved = true;
    }

    // Drag to pan only after we consider it a drag.
    if (moved) {
      // Convert to device pixels
      const dpr = window.devicePixelRatio || 1;
      currentScene.camera.pan.x += dx * dpr;
      currentScene.camera.pan.y += dy * dpr;
      renderScene(currentScene);
    }
  });

  function endPan(e) {
    if (!isPanning) return;
    isPanning = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}

    // Click (no drag) triggers "jump" if enabled.
    const total = Math.hypot((e.clientX - down.x), (e.clientY - down.y));

    // Treat as click as long as user didn't drag; allow long-press too.
    const isClick = !moved && total < 4;
    if (isClick && currentScene) triggerClickBounce(currentScene);

  }
  canvas.addEventListener('pointerup', endPan);
  canvas.addEventListener('pointercancel', endPan);

  canvas.addEventListener('wheel', (e) => {
    if (!currentScene) return;
    e.preventDefault();

    const dpr = window.devicePixelRatio || 1;
    const delta = Math.sign(e.deltaY);
    const factor = delta > 0 ? 0.92 : 1.08;
    const newZoom = clamp(currentScene.camera.zoom * factor, 0.05, 10);

    // Zoom around cursor: adjust pan so the point under cursor stays fixed
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * dpr;
    const cy = (e.clientY - rect.top) * dpr;

    const oldZoom = currentScene.camera.zoom;
    const pan = currentScene.camera.pan;

    // Convert screen->world under current camera
    const worldX = (cx - canvas.width / 2 - pan.x) / oldZoom;
    const worldY = (cy - canvas.height / 2 - pan.y) / oldZoom;

    currentScene.camera.zoom = newZoom;
    currentScene.camera.pan.x = cx - canvas.width / 2 - worldX * newZoom;
    currentScene.camera.pan.y = cy - canvas.height / 2 - worldY * newZoom;

    renderScene(currentScene);
  }, { passive: false });

  window.addEventListener('resize', () => {
    if (!currentScene) return;
    renderScene(currentScene);
  });
}

function sanityCheckGlobals() {
  if (!window.PngRemixDecoder) {
    setStatus(t('pngRemixPreview.error.noDecoder'), 'err');
    return false;
  }
  if (!window.ModelNormalizer) {
    setStatus(t('pngRemixPreview.error.noNormalizer'), 'err');
    return false;
  }
  return true;
}

function main() {
  setupDnD();
  setupControls();
  setupPartsManager();
  setupCanvasInteraction();

  setPartsUiEnabled(false);

  applyI18nAttrs();
  populateSampleSelect();

  window.addEventListener('languageChanged', () => {
    applyI18nAttrs();
    populateSampleSelect();

    if (currentScene) {
      const selectedState = String(el.stateSelect.value || '');
      populateStateSelect(currentScene.model.stateCount || 1);
      if (selectedState) el.stateSelect.value = selectedState;
      renderPartsPanel(currentScene);
      renderHotkeyPanel(currentScene);
      updateDebug(currentScene);
    }
  });

  if (sanityCheckGlobals()) {
    setStatus(t('pngRemixPreview.status.ready'));
  }
}

main();
