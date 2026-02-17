/**
 * model-normalizer
 *
 * Normalize the decoded `.pngRemix` save_dict into a predictable shape.
 *
 * This file includes a full port of PNGTuber Remix 1.4.1 `SpriteObjectClass.DEFAULT_DATA`
 * (plus `sprite_object.gd#get_default_object_data()` overrides) as state defaults.
 */

(function initModelNormalizer(global) {
  'use strict';

  // Global.gd: enum Mouth { Closed, Open, Screaming }
  const MOUTH = Object.freeze({
    Closed: 0,
    Open: 1,
    Screaming: 2,
  });

  const COLOR_WHITE = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });
  const COLOR_BLACK = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });

  const VEC2_ZERO = Object.freeze({ x: 0, y: 0 });
  const VEC2_ONE = Object.freeze({ x: 1, y: 1 });
  const VEC2_HALF = Object.freeze({ x: 0.5, y: 0.5 });

  // --- Full defaults port ---
  // Source: `PNGTuber-Remix-1.4.1/Scripts/Objects/SpriteObjectClass.gd` const DEFAULT_DATA
  // Merge override: `PNGTuber-Remix-1.4.1/Scripts/Objects/sprite_object.gd` get_default_object_data()
  const STATE_DEFAULTS = {
    // Use mouth closed movement for all mouth states?
    shared_movement: true,
    editing_for: MOUTH.Closed,

    // Movement when mouth closed
    xAmp: 0,
    xFrq: 0,
    yAmp: 0,
    yFrq: 0,
    dragSpeed: 0,
    stretchAmount: 0,
    rdragStr: 0,
    rot_frq: 0.0,
    rLimitMin: -180,
    rLimitMax: 180,
    should_rot_speed: 0.01,
    should_rotate: false,
    mouse_delay: 0.1,
    look_at_mouse_pos: 0,
    look_at_mouse_pos_y: 0,
    mouse_rotation: 0.0,
    mouse_rotation_max: 0.0,
    mouse_scale_x: 0.0,
    mouse_scale_y: 0.0,
    drag_snap: 0.0,
    index_change: 0,
    index_change_y: 0,

    pos_x_min: 0,
    pos_x_max: 0,
    pos_y_min: 0,
    pos_y_max: 0,

    rot_min: 0,
    rot_max: 0,

    scale_x_min: 0,
    scale_x_max: 0,
    scale_y_min: 0,
    scale_y_max: 0,

    pos_swap_x: false,
    pos_swap_y: false,
    scale_swap_x: false,
    scale_swap_y: false,

    pos_invert_x: false,
    pos_invert_y: false,
    scale_invert_x: false,
    scale_invert_y: false,

    // Movement when mouth open
    mo_xAmp: 0,
    mo_xFrq: 0,
    mo_yAmp: 0,
    mo_yFrq: 0,
    mo_dragSpeed: 0,
    mo_stretchAmount: 0,
    mo_rdragStr: 0,
    mo_rot_frq: 0.0,
    mo_rLimitMin: -180,
    mo_rLimitMax: 180,
    mo_should_rot_speed: 0.01,
    mo_should_rotate: false,
    mo_mouse_delay: 0.1,
    mo_look_at_mouse_pos: 0,
    mo_look_at_mouse_pos_y: 0,
    mo_mouse_rotation: 0.0,
    mo_mouse_rotation_max: 0.0,
    mo_mouse_scale_x: 0.0,
    mo_mouse_scale_y: 0.0,
    mo_drag_snap: 0.0,
    mo_index_change: 0,
    mo_index_change_y: 0,

    mo_pos_x_min: 0,
    mo_pos_x_max: 0,
    mo_pos_y_min: 0,
    mo_pos_y_max: 0,

    mo_rot_min: 0,
    mo_rot_max: 0,

    mo_scale_x_min: 0,
    mo_scale_x_max: 0,
    mo_scale_y_min: 0,
    mo_scale_y_max: 0,

    mo_pos_swap_x: false,
    mo_pos_swap_y: false,
    mo_scale_swap_x: false,
    mo_scale_swap_y: false,

    mo_pos_invert_x: false,
    mo_pos_invert_y: false,
    mo_scale_invert_x: false,
    mo_scale_invert_y: false,

    // Movement when screaming
    scream_xAmp: 0,
    scream_xFrq: 0,
    scream_yAmp: 0,
    scream_yFrq: 0,
    scream_dragSpeed: 0,
    scream_stretchAmount: 0,
    scream_rdragStr: 0,
    scream_rot_frq: 0.0,
    scream_rLimitMin: -180,
    scream_rLimitMax: 180,
    scream_should_rot_speed: 0.01,
    scream_should_rotate: false,
    scream_mouse_delay: 0.1,
    scream_look_at_mouse_pos: 0,
    scream_look_at_mouse_pos_y: 0,
    scream_mouse_rotation: 0.0,
    scream_mouse_rotation_max: 0.0,
    scream_mouse_scale_x: 0.0,
    scream_mouse_scale_y: 0.0,
    scream_drag_snap: 0.0,
    scream_index_change: 0,
    scream_index_change_y: 0,

    scream_mouse_pos_min: 0,
    scream_mouse_pos_max: 0,
    scream_mouse_pos_y_min: 0,
    scream_mouse_pos_y_max: 0,

    scream_pos_x_min: 0,
    scream_pos_x_max: 0,
    scream_pos_y_min: 0,
    scream_pos_y_max: 0,

    scream_rot_min: 0,
    scream_rot_max: 0,

    scream_scale_x_min: 0,
    scream_scale_x_max: 0,
    scream_scale_y_min: 0,
    scream_scale_y_max: 0,

    scream_pos_swap_x: false,
    scream_pos_swap_y: false,
    scream_scale_swap_x: false,
    scream_scale_swap_y: false,

    scream_pos_invert_x: false,
    scream_pos_invert_y: false,
    scream_scale_invert_x: false,
    scream_scale_invert_y: false,

    // Other stuff idk
    blend_mode: 'Normal',
    visible: true,
    colored: COLOR_WHITE,
    tint: COLOR_WHITE,
    z_index: 0,
    open_eyes: true,
    open_mouth: false,
    should_blink: false,
    should_talk: false,
    animation_speed: 1,
    hframes: 1,
    scale: VEC2_ONE,
    folder: false,
    position: VEC2_ZERO,
    rotation: 0.0,
    offset: VEC2_ZERO,
    ignore_bounce: false,
    clip: 0,
    fade: false,
    fade_asset: false,
    fade_speed: 1.0,
    fade_speed_asset: 1.0,
    physics: true,
    advanced_lipsync: false,
    should_reset: false,
    should_reset_state: false,
    one_shot: false,
    rainbow: false,
    rainbow_self: false,
    rainbow_speed: 0.01,
    follow_wa_tip: false,
    tip_point: 0,
    follow_wa_mini: -180,
    follow_wa_max: 180,
    follow_mouse_velocity: false,
    static_obj: false,
    is_cycle: false,
    cycle: 0,
    pause_movement: false,
    follow_type: 15,
    follow_type2: 15,
    follow_type3: 15,
    snap_pos: false,
    snap_rot: false,
    snap_scale: false,

    follow_range: true,
    follow_strength: 0.155,
    rotation_threshold: 0.01,
    hidden_item: false,

    follow_eye: 0,
    gaze_eye: 0,
    style_eye: 0,

    udp_pos: 0,
    udp_rot: 0,
    udp_scale: 0,
    follow_mouth: 0,

    chain_softness: 5,
    chain_rot_min: -3.14,
    chain_rot_max: 3.14,

    mesh_phys_x: 75,
    mesh_phys_y: 75,

    use_object_pos: true,

    // --- sprite_object.gd overrides ---
    vframes: 1,
    wiggle: false,
    wiggle_amp: 0,
    wiggle_freq: 0,
    wiggle_physics: false,
    wiggle_rot_offset: VEC2_HALF,
    follow_parent_effects: false,
    flip_sprite_h: false,
    flip_sprite_v: false,
    non_animated_sheet: false,
    animate_to_mouse: false,
    animate_to_mouse_speed: 10,
    animate_to_mouse_track_pos: true,
    frame: 0,
  };

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && (v.constructor === Object || Object.getPrototypeOf(v) === null);
  }

  function isUint8Array(v) {
    return v instanceof Uint8Array;
  }

  function clamp01(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return 0;
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  function normalizeColor(v, fallback = COLOR_WHITE) {
    if (!v) return { ...fallback };
    if (typeof v === 'object' && 'r' in v && 'g' in v && 'b' in v) {
      return {
        r: clamp01(v.r),
        g: clamp01(v.g),
        b: clamp01(v.b),
        a: clamp01('a' in v ? v.a : 1),
      };
    }
    return { ...fallback };
  }

  function normalizeVec2(v, fallback = VEC2_ZERO) {
    if (!v) return { ...fallback };
    if (typeof v === 'object' && 'x' in v && 'y' in v) {
      const x = Number(v.x);
      const y = Number(v.y);
      return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
    }
    return { ...fallback };
  }

  function cloneDefaultValue(val) {
    if (isUint8Array(val)) return val;
    if (val instanceof Int32Array) return new Int32Array(val);
    if (val instanceof Float32Array) return new Float32Array(val);
    if (val instanceof Float64Array) return new Float64Array(val);
    if (Array.isArray(val)) return val.map(cloneDefaultValue);
    if (isPlainObject(val)) {
      const out = {};
      for (const k of Object.keys(val)) out[k] = cloneDefaultValue(val[k]);
      return out;
    }
    return val;
  }

  function applyStateDefaults(state) {
    if (!isPlainObject(state)) state = {};

    for (const k of Object.keys(STATE_DEFAULTS)) {
      if (state[k] === undefined) state[k] = cloneDefaultValue(STATE_DEFAULTS[k]);
    }

    // Normalize key composite types used heavily in animation code.
    state.position = normalizeVec2(state.position, STATE_DEFAULTS.position);
    state.offset = normalizeVec2(state.offset, STATE_DEFAULTS.offset);
    state.scale = normalizeVec2(state.scale, STATE_DEFAULTS.scale);
    state.wiggle_rot_offset = normalizeVec2(state.wiggle_rot_offset, STATE_DEFAULTS.wiggle_rot_offset);

    state.colored = normalizeColor(state.colored, STATE_DEFAULTS.colored);
    state.tint = normalizeColor(state.tint, STATE_DEFAULTS.tint);

    return state;
  }

  function applyLegacyStateFixups(spriteRaw, state) {
    if (!isPlainObject(state)) return state;

    // --- Legacy state key: global_position -> position ---
    // Old projects sometimes stored world-space position; we keep a best-effort mapping.
    if (state.global_position && isPlainObject(state.global_position)) {
      const gp = normalizeVec2(state.global_position, null);
      if (gp) state.position = gp;
      try { delete state.global_position; } catch (_) {}
    }

    // --- Legacy follow movement mapping ---
    // SaveAndLoad.gd: updated_follow_check()
    if (spriteRaw && !spriteRaw.updated_follow_movement) {
      const shared = !!state.shared_movement;
      const prefixes = shared ? [''] : ['', 'mo_', 'scream_'];

      for (const prefix of prefixes) {
        const getN = (k, fb = 0) => {
          const n = Number(state[`${prefix}${k}`]);
          return Number.isFinite(n) ? n : fb;
        };

        const lookX = getN('look_at_mouse_pos', 0);
        const lookY = getN('look_at_mouse_pos_y', 0);
        const mouseRot = getN('mouse_rotation', 0);
        const mouseRotMin = getN('mouse_rotation_min', Number.NaN);
        const mouseRotMax = getN('mouse_rotation_max', 0);
        const mouseScaleX = getN('mouse_scale_x', 0);
        const mouseScaleY = getN('mouse_scale_y', 0);

        state[`${prefix}pos_x_min`] = -Math.abs(lookX);
        state[`${prefix}pos_x_max`] = Math.abs(lookX);
        state[`${prefix}pos_y_min`] = -Math.abs(lookY);
        state[`${prefix}pos_y_max`] = Math.abs(lookY);

        state[`${prefix}rot_min`] = Number.isFinite(mouseRotMin) ? mouseRotMin : mouseRot;
        state[`${prefix}rot_max`] = mouseRotMax;

        state[`${prefix}scale_x_min`] = -Math.abs(mouseScaleX);
        state[`${prefix}scale_x_max`] = Math.abs(mouseScaleX);
        state[`${prefix}scale_y_min`] = -Math.abs(mouseScaleY);
        state[`${prefix}scale_y_max`] = Math.abs(mouseScaleY);

        if (lookX < 0) state[`${prefix}pos_invert_x`] = true;
        if (lookY < 0) state[`${prefix}pos_invert_y`] = true;

        // Auto-enable follow_type (Mouse=0) for legacy files that only stored look/rotation/scale ranges.
        // Mirrors PNGTuber Remix SaveAndLoad.gd: updated_follow_check().
        if ((lookX !== 0 || lookY !== 0) && (state.follow_type === undefined || state.follow_type === 15)) {
          state.follow_type = 0;
        }
        if ((mouseRot !== 0 || mouseRotMax !== 0) && (state.follow_type2 === undefined || state.follow_type2 === 15)) {
          state.follow_type2 = 0;
        }
        if ((mouseScaleX !== 0 || mouseScaleY !== 0) && (state.follow_type3 === undefined || state.follow_type3 === 15)) {
          state.follow_type3 = 0;
        }
      }

    }

    return state;
  }


  function decodeBase64ToUint8Array(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function buildImageByIdIndex(imageManagerData) {
    const byId = new Map();
    if (!Array.isArray(imageManagerData)) return byId;
    for (const entry of imageManagerData) {
      if (!entry) continue;
      const id = entry.id;
      if (id === undefined || id === null) continue;
      byId.set(id, entry);
    }
    return byId;
  }

  function decodeMaybeBytes(v) {
    if (isUint8Array(v) && v.length > 0) return v;
    if (typeof v === 'string' && v.length > 0) {
      try {
        return decodeBase64ToUint8Array(v);
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  function resolveSpriteImageBytes(rawSprite, imagesById) {
    if (!rawSprite) return null;

    // New format: sprite.image_id -> image_manager_data[].(anim_texture|runtime_texture)
    if (rawSprite.image_id !== undefined && rawSprite.image_id !== null) {
      const imgEntry = imagesById.get(rawSprite.image_id);
      if (imgEntry) {
        // Prefer original animated bytes if present; runtime_texture is the (first-frame) PNG.
        if (imgEntry.img_animated || imgEntry.is_apng) {
          const anim = decodeMaybeBytes(imgEntry.anim_texture);
          if (anim) return anim;
        }
        const rt = decodeMaybeBytes(imgEntry.runtime_texture);
        if (rt) return rt;
      }
    }

    // Old format: inline sprite.img
    const img = decodeMaybeBytes(rawSprite.img);
    if (img) return img;

    // Legacy key (seen in older exports): sprite.image_data
    const imageData = decodeMaybeBytes(rawSprite.image_data);
    if (imageData) return imageData;

    return null;
  }

  function resolveSpriteNormalBytes(rawSprite, imagesById) {
    if (!rawSprite) return null;

    // New format: sprite.normal_id -> image_manager_data[].(anim_texture|runtime_texture)
    if (rawSprite.normal_id !== undefined && rawSprite.normal_id !== null) {
      const imgEntry = imagesById.get(rawSprite.normal_id);
      if (imgEntry) {
        if (imgEntry.img_animated || imgEntry.is_apng) {
          const anim = decodeMaybeBytes(imgEntry.anim_texture);
          if (anim) return anim;
        }
        const rt = decodeMaybeBytes(imgEntry.runtime_texture);
        if (rt) return rt;
      }
    }

    // Old format: inline sprite.normal
    const normal = decodeMaybeBytes(rawSprite.normal);
    if (normal) return normal;

    // Legacy keys (best effort)
    const normalData = decodeMaybeBytes(rawSprite.normal_data);
    if (normalData) return normalData;

    return null;
  }


  function normalizePngRemixModel(raw) {
    if (!raw || typeof raw !== 'object') {
      throw new Error('normalizePngRemixModel: expected decoded top-level Dictionary');
    }

    const spritesArray = Array.isArray(raw.sprites_array) ? raw.sprites_array : [];
    const settings = raw.settings_dict && typeof raw.settings_dict === 'object' ? raw.settings_dict : {};

    // Determine state count
    let stateCount = 0;
    if (Array.isArray(settings.states)) stateCount = settings.states.length;
    if (!stateCount) {
      for (const s of spritesArray) {
        if (s && Array.isArray(s.states)) stateCount = Math.max(stateCount, s.states.length);
      }
    }

    const imagesById = buildImageByIdIndex(raw.image_manager_data);

    const sprites = spritesArray.map((s, index) => {
      const spriteId = s?.sprite_id ?? null;
      const parentId = s?.parent_id ?? null;
      const spriteType = s?.sprite_type || 'Sprite2D';
      const spriteName = s?.sprite_name || `sprite_${index}`;

      const statesIn = Array.isArray(s?.states) ? s.states : [];
      const outLen = stateCount || statesIn.length || 0;
      const statesOut = new Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const st = applyStateDefaults(statesIn[i]);
        statesOut[i] = applyLegacyStateFixups(s, st);
      }
      if (s) s.states = statesOut;

      const imgBytes = resolveSpriteImageBytes(s, imagesById);
      const normalBytes = resolveSpriteNormalBytes(s, imagesById);

      if (s && !isUint8Array(s.img) && isUint8Array(imgBytes)) {
        // Keep legacy renderers working.
        s.img = imgBytes;
      }
      if (s && !isUint8Array(s.normal) && isUint8Array(normalBytes)) {
        // Keep legacy renderers working.
        s.normal = normalBytes;
      }

      return {
        index,
        spriteId,
        parentId,
        spriteType,
        spriteName,
        imgBytes,
        normalBytes,
        raw: s,
      };

    });

    const spritesById = new Map();
    for (const s of sprites) {
      if (s.spriteId !== null && s.spriteId !== undefined) spritesById.set(s.spriteId, s);
    }

    return {
      version: raw.version || '',
      stateCount,
      settings,
      imagesById,
      sprites,
      spritesById,
      raw,
      constants: { MOUTH, COLOR_WHITE, COLOR_BLACK },
    };
  }

  global.ModelNormalizer = {
    STATE_DEFAULTS,
    normalizePngRemixModel,
    _internals: {
      applyStateDefaults,
      resolveSpriteImageBytes,
      normalizeVec2,
      normalizeColor,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.ModelNormalizer;
  }
})(typeof window !== 'undefined' ? window : globalThis);
