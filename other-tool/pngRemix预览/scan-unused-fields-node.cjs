/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadUmdIntoVm(ctx, filePath, filename) {
  const code = fs.readFileSync(filePath, 'utf8');
  vm.runInContext(code, ctx, { filename });
}

function makeCtx() {
  const ctx = vm.createContext({
    console,
    TextDecoder: global.TextDecoder,
    Uint8Array,
    ArrayBuffer,
    DataView,
    Buffer,
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
  });
  ctx.window = ctx;
  ctx.globalThis = ctx;
  return ctx;
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.prototype.toString.call(v) === '[object Object]';
}


const USED_STATE_KEYS = new Set([
  // Visibility / layering
  'visible', 'z_index',
  // Blend
  'blend_mode',
  // Colors
  'colored', 'tint',
  // Transform
  'position', 'rotation', 'scale', 'offset',
  // Sprite2D options
  'folder', 'flip_sprite_h', 'flip_sprite_v',
  // Animation
  'hframes', 'vframes', 'frame', 'animation_speed', 'one_shot',
  'non_animated_sheet',
  // Lipsync / blink
  'should_talk', 'open_mouth',
  'should_blink', 'open_eyes',
  'advanced_lipsync',
  // Clip / fade (viewer uses a subset)
  'clip', 'fade', 'fade_asset', 'fade_speed', 'fade_speed_asset',
  // Wiggle
  'wiggle', 'wiggle_amp', 'wiggle_freq', 'wiggle_physics', 'wiggle_rot_offset', 'follow_parent_effects',
  // Follow / mouse
  'animate_to_mouse', 'animate_to_mouse_speed', 'animate_to_mouse_track_pos',
  'follow_type', 'follow_type2', 'follow_type3',
  'mouse_delay',
  'look_at_mouse_pos', 'look_at_mouse_pos_y',
  'mouse_rotation', 'mouse_rotation_min', 'mouse_rotation_max',
  'mouse_scale_x', 'mouse_scale_y',
  'pos_x_min', 'pos_x_max', 'pos_y_min', 'pos_y_max',
  'rot_min', 'rot_max',
  'scale_x_min', 'scale_x_max', 'scale_y_min', 'scale_y_max',
  'pos_swap_x', 'pos_swap_y', 'scale_swap_x', 'scale_swap_y',
  'pos_invert_x', 'pos_invert_y',
  // Movements
  'xAmp', 'xFrq', 'yAmp', 'yFrq', 'dragSpeed', 'stretchAmount', 'rdragStr', 'rot_frq',
  'rLimitMin', 'rLimitMax',
  'pause_movement', 'shared_movement',
  'follow_mouse_velocity',
  'should_rotate', 'should_rot_speed',
  'physics',
  'ignore_bounce',
  // Effects / animation reset
  'rainbow', 'rainbow_self', 'rainbow_speed',
  'should_reset', 'should_reset_state',

  // Some configs we might use later but list here so it doesn't appear as "unused"
  'is_cycle', 'cycle',
]);

const USED_SPRITE_KEYS = new Set([
  'sprite_id', 'parent_id', 'sprite_type', 'sprite_name',
  'states',
  // Images
  'img', 'image_id', 'normal_id',
  // Asset toggles / shortcuts
  'is_asset', 'was_active_before', 'saved_disappear', 'saved_keys', 'saved_event',
  'should_disappear', 'show_only', 'hold_to_show',
  // Misc
  'is_collapsed', 'is_premultiplied', 'layer_color',
  // Compatibility flags
  'updated_follow_movement',
]);

function unionKeysFromStates(states) {
  const keys = new Set();
  if (!Array.isArray(states)) return keys;
  for (const st of states) {
    if (!isPlainObject(st)) continue;
    for (const k of Object.keys(st)) keys.add(k);
  }
  return keys;
}

function scanOne(ctx, file) {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  const decoded = ctx.PngRemixDecoder.decode(ab);
  const sprites = Array.isArray(decoded?.sprites_array) ? decoded.sprites_array : [];

  // State keys are taken from RAW data (before applying ModelNormalizer defaults),
  // so we can see what the file actually stores.
  const stateKeys = new Set();
  const spriteKeys = new Set();

  for (const s of sprites) {
    if (isPlainObject(s)) {
      for (const k of Object.keys(s)) spriteKeys.add(k);
    }

    const sk = unionKeysFromStates(s?.states);
    for (const k of sk) stateKeys.add(k);
  }

  // Run normalizer so we can use DEFAULT keys set.
  const norm = ctx.ModelNormalizer.normalizePngRemixModel(decoded);
  const defaultStateKeys = new Set(Object.keys(ctx.ModelNormalizer.STATE_DEFAULTS || {}));

  const unknownStateKeys = [...stateKeys].filter(k => !defaultStateKeys.has(k)).sort();

  // Present-in-file but not used by the current web viewer runtime.
  // (Heuristic list; good for spotting legacy keys.)
  const unusedStateKeys = [...stateKeys].filter(k => !USED_STATE_KEYS.has(k)).sort();

  const unknownSpriteKeys = [...spriteKeys].filter(k => !USED_SPRITE_KEYS.has(k)).sort();

  // Some quick detects for known legacy patterns
  const hasUpdatedFollowFlag = [...spriteKeys].includes('updated_follow_movement');
  const hasGlobalPosition = [...stateKeys].includes('global_position');

  return {
    file: path.basename(file),
    version: String(norm?.version || ''),
    spriteCount: sprites.length,
    stateKeyCount: stateKeys.size,
    spriteKeyCount: spriteKeys.size,
    legacySignals: {
      updated_follow_movement: hasUpdatedFollowFlag,
      global_position: hasGlobalPosition,
    },
    unknownSpriteKeys,
    unknownStateKeys,
    unusedStateKeys,
  };
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Usage: node scan-unused-fields-node.cjs <a.pngRemix> <b.pngRemix> ...');
    process.exit(2);
  }

  const ctx = makeCtx();
  const baseDir = __dirname;
  loadUmdIntoVm(ctx, path.join(baseDir, 'pngremix-decoder.js'), 'pngremix-decoder.js');
  loadUmdIntoVm(ctx, path.join(baseDir, 'model-normalizer.js'), 'model-normalizer.js');

  const out = [];
  for (const f of args) {
    out.push(scanOne(ctx, f));
  }

  console.log(JSON.stringify(out, null, 2));
}

main();
