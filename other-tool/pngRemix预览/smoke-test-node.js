/**
 * Node smoke test for `.pngRemix` decoding + normalization.
 *
 * Note: this repo uses ESM (`package.json#type=module`), so this script is ESM.
 *
 * Usage:
 *   node smoke-test-node.js "<file.pngRemix>"
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

// Make browser-ish globals available for UMD-style scripts.
ctx.window = ctx;
ctx.globalThis = ctx;

loadScriptIntoContext(ctx, path.join(__dirname, 'pngremix-decoder.js'));
loadScriptIntoContext(ctx, path.join(__dirname, 'model-normalizer.js'));

const buf = fs.readFileSync(inputPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const decoded = ctx.PngRemixDecoder.decode(ab);
const normalized = ctx.ModelNormalizer.normalizePngRemixModel(decoded);

console.log('version:', normalized.version);
console.log('stateCount:', normalized.stateCount);
console.log('sprites:', normalized.sprites.length);
console.log('image_manager_data:', Array.isArray(decoded.image_manager_data) ? decoded.image_manager_data.length : 0);
console.log('defaultKeys:', Object.keys(ctx.ModelNormalizer.STATE_DEFAULTS).length);

const sample = normalized.sprites.find(s => s.imgBytes && s.imgBytes.length > 8);
if (sample) {
  console.log('sample sprite:', { id: sample.spriteId, name: sample.spriteName, imgBytes: sample.imgBytes.length });
} else {
  console.log('no sprite with resolved image bytes found');
}
