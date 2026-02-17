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

function pickStatePatch(rawSprite, i) {
  const states = Array.isArray(rawSprite?.states) ? rawSprite.states : [];
  const st = states[i];
  return st && typeof st === 'object' ? st : null;
}

function scanOne(ctx, file) {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  const decoded = ctx.PngRemixDecoder.decode(ab);
  const norm = ctx.ModelNormalizer.normalizePngRemixModel(decoded);

  const sprites = Array.isArray(decoded.sprites_array) ? decoded.sprites_array : [];
  const stateCount = Number(norm?.stateCount) || 0;

  const keys = new Set();
  let savedKeySprites = 0;
  let animSprites = 0;
  let wiggleSprites = 0;
  let animateToMouseSprites = 0;
  let followTypeSprites = 0;
  let movementSprites = 0;
  let patchScaleLike = 0;
  let eyeLike = 0;
  const eyeState4 = { visibleTrue: 0, visibleFalse: 0, missing: 0 };

  for (const s of sprites) {
    const name = String(s?.sprite_name || '');
    const sk = s?.saved_keys;
    if (Array.isArray(sk) && sk.length) {
      savedKeySprites += 1;
      for (const k of sk) keys.add(String(k));
    }

    let hasAnim = false;
    let hasWiggle = false;
    let hasAnimateToMouse = false;
    let hasFollowType = false;
    let hasMovement = false;
    let hasScaleLike = false;

    const maxN = Math.max(stateCount, Array.isArray(s?.states) ? s.states.length : 0);
    for (let i = 0; i < maxN; i++) {
      const st = pickStatePatch(s, i);
      if (!st) continue;

      const hf = Math.max(1, Math.floor(Number(st.hframes) || 1));
      const vf = Math.max(1, Math.floor(Number(st.vframes) || 1));
      const total = hf * vf;
      const speed = Number(st.animation_speed || 0) || 0;
      const nonAnim = !!st.non_animated_sheet;
      const advLip = !!st.advanced_lipsync;

      if (!nonAnim && !advLip && total > 1 && speed > 0) hasAnim = true;
      if (st.wiggle || Number(st.wiggle_amp || 0) || Number(st.wiggle_freq || 0)) hasWiggle = true;

      if (!!st.animate_to_mouse && !!st.non_animated_sheet && total > 1) hasAnimateToMouse = true;
      if (Number(st.follow_type ?? 15) !== 15 || Number(st.follow_type2 ?? 15) !== 15 || Number(st.follow_type3 ?? 15) !== 15) hasFollowType = true;

      const moveKeys = ['xAmp', 'xFrq', 'yAmp', 'yFrq', 'dragSpeed', 'stretchAmount', 'rdragStr', 'rot_frq',
        'mo_xAmp', 'mo_xFrq', 'mo_yAmp', 'mo_yFrq', 'mo_dragSpeed', 'mo_stretchAmount', 'mo_rdragStr', 'mo_rot_frq'];
      for (const k of moveKeys) {
        if (Number(st[k] || 0)) { hasMovement = true; break; }
      }

      if (
        Object.prototype.hasOwnProperty.call(st, 'scale') ||
        Object.prototype.hasOwnProperty.call(st, 'hframes') ||
        Object.prototype.hasOwnProperty.call(st, 'vframes')
      ) {
        hasScaleLike = true;
      }
    }

    if (hasAnim) animSprites += 1;
    if (hasWiggle) wiggleSprites += 1;
    if (hasAnimateToMouse) animateToMouseSprites += 1;
    if (hasFollowType) followTypeSprites += 1;
    if (hasMovement) movementSprites += 1;
    if (hasScaleLike) patchScaleLike += 1;

    if (/眼|eye/i.test(name)) {
      eyeLike += 1;
      const st4 = pickStatePatch(s, 4);
      if (!st4) eyeState4.missing += 1;
      else if (st4.visible === false) eyeState4.visibleFalse += 1;
      else if (st4.visible === true) eyeState4.visibleTrue += 1;
    }
  }

  return {
    file: path.basename(file),
    stateCount,
    sprites: sprites.length,
    settingsKeys: Object.keys(norm?.settings || {}).sort(),
    saved_keys: { sprites: savedKeySprites, keys: Array.from(keys).sort() },
    dynamic: { animSprites, wiggleSprites, animateToMouseSprites, followTypeSprites, movementSprites },
    statePatches: { spritesWithScaleOrFramesPatch: patchScaleLike },
    eyeLike: { sprites: eyeLike, state4: eyeState4 },
  };
}

function main() {
  const base = path.resolve(__dirname);
  const decoderPath = path.join(base, 'pngremix-decoder.js');
  const normalizerPath = path.join(base, 'model-normalizer.js');

  const files = process.argv.slice(2).filter(Boolean);
  if (!files.length) {
    console.log('Usage: node scan-summary-node.cjs <file1.pngRemix> [file2.pngRemix] ...');
    process.exit(1);
  }

  const ctx = makeCtx();
  loadUmdIntoVm(ctx, decoderPath, 'pngremix-decoder.js');
  loadUmdIntoVm(ctx, normalizerPath, 'model-normalizer.js');

  const results = [];
  for (const f of files) {
    try {
      results.push(scanOne(ctx, f));
    } catch (e) {
      results.push({ file: path.basename(f), error: String(e && e.message ? e.message : e) });
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

main();
