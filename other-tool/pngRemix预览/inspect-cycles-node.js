/**
 * Inspect `.pngRemix` cycle and visibility-related fields.
 * Usage:
 *   node inspect-cycles-node.js "<file.pngRemix>"
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadScriptIntoContext(ctx, filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  vm.runInContext(code, ctx, { filename: filePath });
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Missing input file path.');
  process.exit(1);
}

const ctx = vm.createContext({
  console,
  TextDecoder: globalThis.TextDecoder,
  Uint8Array,
  ArrayBuffer,
  DataView,
  Buffer,
  atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
});
ctx.window = ctx;
ctx.globalThis = ctx;

loadScriptIntoContext(ctx, path.join(__dirname, 'pngremix-decoder.js'));
loadScriptIntoContext(ctx, path.join(__dirname, 'model-normalizer.js'));

const buf = fs.readFileSync(inputPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const decoded = ctx.PngRemixDecoder.decode(ab);

// NOTE: Keep this script output compact; it is mainly for diagnostics.
const spritesArray = Array.isArray(decoded.sprites_array) ? decoded.sprites_array : [];
const settings = decoded.settings_dict && typeof decoded.settings_dict === 'object' ? decoded.settings_dict : {};
const stateCount = Array.isArray(settings.states) ? settings.states.length : (spritesArray.reduce((m, s) => Math.max(m, Array.isArray(s?.states) ? s.states.length : 0), 0) || 0);

function decodeMaybeBase64ToUint8Array(v) {
  if (!v) return null;
  if (v instanceof Uint8Array) return v;
  if (typeof v === 'string') {
    try {
      return new Uint8Array(Buffer.from(v, 'base64'));
    } catch (_) {
      return null;
    }
  }
  return null;
}

function buildImageByIdIndex(imageManagerData) {
  const byId = new Map();
  const arr = Array.isArray(imageManagerData) ? imageManagerData : [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const id = entry.id;
    if (id === undefined || id === null) continue;
    byId.set(id, entry);
  }
  return byId;
}

function resolveSpriteImageBytes(rawSprite, imagesById) {
  if (!rawSprite) return null;

  if (rawSprite.image_id !== undefined && rawSprite.image_id !== null) {
    const imgEntry = imagesById.get(rawSprite.image_id);
    const bytes = imgEntry && imgEntry.runtime_texture;
    const u8 = decodeMaybeBase64ToUint8Array(bytes);
    if (u8 && u8.length) return u8;
  }

  const img = rawSprite.img;
  const u8 = decodeMaybeBase64ToUint8Array(img);
  if (u8 && u8.length) return u8;

  return null;
}

function parsePngSize(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24) return null;
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4E || bytes[3] !== 0x47) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = dv.getUint32(16, false);
  const h = dv.getUint32(20, false);
  if (!w || !h) return null;
  return { w, h };
}

function pickState(s, i) {
  if (!s || typeof s !== 'object') return null;
  const states = Array.isArray(s.states) ? s.states : [];
  const st = states[i];
  return (st && typeof st === 'object') ? st : null;
}

function approxFrameSize(imgSize, st) {
  if (!imgSize || !st) return null;
  const hf = Math.max(1, Math.floor(Number(st.hframes) || 1));
  const vf = Math.max(1, Math.floor(Number(st.vframes) || 1));
  const sx = Math.abs(Number(st.scale?.x ?? 1) || 1);
  const sy = Math.abs(Number(st.scale?.y ?? 1) || 1);
  return { w: (imgSize.w / hf) * sx, h: (imgSize.h / vf) * sy, hf, vf, sx, sy };
}

console.log('stateCount:', stateCount);
console.log('sprites:', spritesArray.length);
console.log('image_manager_data:', Array.isArray(decoded.image_manager_data) ? decoded.image_manager_data.length : 0);

const imagesById = buildImageByIdIndex(decoded.image_manager_data);

// --- Find sprites with size-related variation across states ---
const variants = [];
for (const s of spritesArray) {
  const name = String(s?.sprite_name || '');
  const id = s?.sprite_id;
  const parent = s?.parent_id;

  const bytes = resolveSpriteImageBytes(s, imagesById);
  const imgSize = parsePngSize(bytes);
  if (!imgSize) continue;

  const per = [];
  for (let i = 0; i < stateCount; i++) {
    const st = pickState(s, i);
    if (!st) {
      per.push(null);
      continue;
    }
    per.push({
      visible: st.visible !== false,
      size: approxFrameSize(imgSize, st),
    });
  }

  const sizes = per.map(x => x?.size).filter(Boolean);
  if (!sizes.length) continue;

  const minW = Math.min(...sizes.map(x => x.w));
  const maxW = Math.max(...sizes.map(x => x.w));
  const minH = Math.min(...sizes.map(x => x.h));
  const maxH = Math.max(...sizes.map(x => x.h));

  const dw = maxW - minW;
  const dh = maxH - minH;

  // Ignore tiny floating noise; we only care about visible size differences.
  if (dw > 0.5 || dh > 0.5) {
    variants.push({ name, id, parent, img: imgSize, dw, dh, per });
  }
}

variants.sort((a, b) => (b.dw + b.dh) - (a.dw + a.dh));
console.log('sprites with state-dependent size (approx):', variants.length);
console.log(variants.slice(0, 20).map(v => ({
  name: v.name,
  id: v.id,
  parent: v.parent,
  img: v.img,
  delta: { w: Math.round(v.dw * 100) / 100, h: Math.round(v.dh * 100) / 100 },
  states: v.per.map((x, idx) => x?.size ? {
    i: idx,
    vis: x.visible,
    w: Math.round(x.size.w * 100) / 100,
    h: Math.round(x.size.h * 100) / 100,
    hf: x.size.hf,
    vf: x.size.vf,
    sx: x.size.sx,
    sy: x.size.sy,
  } : null).filter(Boolean),
})));

// --- Hotkey groups (saved_keys) summary ---
const withSavedKeysSummary = [];
for (const s of spritesArray) {
  const savedKeys = s?.saved_keys;
  if (Array.isArray(savedKeys) && savedKeys.length) {
    withSavedKeysSummary.push({ name: s.sprite_name, id: s.sprite_id, parent: s.parent_id, saved_keys: savedKeys });
  }
}
console.log('sprites with saved_keys:', withSavedKeysSummary.length);
console.log(withSavedKeysSummary.slice(0, 40));

// Keep the old cycle scan / deep scan below for rare cases.
const norm = ctx.ModelNormalizer.normalizePngRemixModel(decoded);

const cycles = Array.isArray(norm.settings?.cycles) ? norm.settings.cycles : [];
const inputArray = Array.isArray(decoded.input_array) ? decoded.input_array : [];

console.log('settings keys:', Object.keys(norm.settings || {}).sort());
console.log('input_array:', inputArray.length);
console.log('settings.cycles:', cycles.length);




function scanHotkeyLikeInfo(obj) {
  const matches = [];
  const seen = new Set();

  const keyRe = /^(f[1-9]|keybind|hotkey|shortcut|cycle|cycles|toggle|toggles|saved_inputs|input_array)$/i;
  const strRe = /\bF[1-9]\b/i;

  function isBinaryBlob(v) {
    return v instanceof Uint8Array || v instanceof Int32Array || v instanceof Float32Array || v instanceof Float64Array;
  }

  function walk(v, p) {
    if (v === null || v === undefined) return;

    // Skip image bytes / binary blobs to avoid false positives.
    if (isBinaryBlob(v)) return;

    if (typeof v === 'object') {
      if (seen.has(v)) return;
      seen.add(v);

      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) walk(v[i], `${p}[${i}]`);
        return;
      }

      for (const [k, val] of Object.entries(v)) {
        const np = p ? `${p}.${k}` : k;
        if (keyRe.test(k)) {
          matches.push({ path: np, kind: 'key', sampleType: Array.isArray(val) ? 'array' : typeof val });
        }
        // Skip obvious image fields
        if (k === 'img' || k === 'runtime_texture') continue;
        walk(val, np);
      }
      return;
    }

    if (typeof v === 'string') {
      if (strRe.test(v)) matches.push({ path: p, kind: 'string', sample: v });
    }
  }

  walk(obj, 'decoded');
  return matches;
}

// Print cycles summary
cycles.forEach((c, i) => {
  const sprites = Array.isArray(c?.sprites) ? c.sprites : [];
  console.log(`cycle[${i}] active=${!!c?.active} pos=${c?.pos ?? null} last_sprite=${c?.last_sprite ?? null} sprites=${sprites.length}`);
});

const hotMatches = scanHotkeyLikeInfo(decoded);
console.log('hotkey-like matches:', hotMatches.length);
console.log(hotMatches.slice(0, 80));


// Find sprites with cycle flags (check all states)
const flagged = [];
const withSavedKeys = [];

for (const s of norm.sprites) {
  const states = Array.isArray(s.raw?.states) ? s.raw.states : [];
  let anyIsCycle = false;
  let maxCycle = 0;
  let anyHiddenItem = false;

  for (const st of states) {
    if (!st || typeof st !== 'object') continue;
    if (st.is_cycle) anyIsCycle = true;
    const cyc = Number(st.cycle || 0);
    if (Number.isFinite(cyc)) maxCycle = Math.max(maxCycle, cyc);
    if (st.hidden_item) anyHiddenItem = true;
  }

  const savedKeys = s.raw?.saved_keys;
  if (Array.isArray(savedKeys) && savedKeys.length) {
    withSavedKeys.push({
      name: s.spriteName,
      id: s.spriteId,
      parent: s.parentId,
      is_asset: !!s.raw?.is_asset,
      was_active_before: !!s.raw?.was_active_before,
      saved_keys: savedKeys,
    });
  }

  if (anyIsCycle || maxCycle > 0 || anyHiddenItem) {
    flagged.push({
      name: s.spriteName,
      id: s.spriteId,
      parent: s.parentId,
      is_cycle: anyIsCycle,
      max_cycle: maxCycle,
      hidden_item: anyHiddenItem,
    });
  }
}

flagged.sort((a, b) => (a.max_cycle - b.max_cycle) || String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
console.log('cycle-related sprites:', flagged.length);
console.log(flagged.slice(0, 120));

console.log('sprites with saved_keys:', withSavedKeys.length);
console.log(withSavedKeys.slice(0, 120));
