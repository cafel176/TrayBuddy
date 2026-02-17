const fs = require('fs');
const vm = require('vm');
const path = require('path');

function loadUmd(p) {
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
  vm.runInContext(fs.readFileSync(p, 'utf8'), ctx);
  return ctx;
}

function normKey(k) {
  const s = String(k || '').trim().toUpperCase();
  return /^F\d+$/.test(s) ? s : '';
}

function getOverrideValue(raw) {
  if (raw && typeof raw === 'object') return { value: raw.visible, source: String(raw.source || 'manual') };
  if (typeof raw === 'boolean') return { value: raw, source: 'manual' }; // legacy
  return { value: undefined, source: 'manual' };
}

function main() {
  const file = process.argv[2];
  const key = normKey(process.argv[3] || 'F5');
  const speaking = String(process.argv[4] || '0') === '1';
  const nameRegexRaw = String(process.argv[5] || '').trim();

  if (!file) {
    console.error('Usage: node simulate-hotkey-visibility-node.cjs <file.pngRemix> [F5] [speaking:0|1] [nameRegex]');
    process.exit(1);
  }

  let nameRegex = null;
  if (nameRegexRaw) {
    try {
      nameRegex = new RegExp(nameRegexRaw);
    } catch (e) {
      console.error('Invalid nameRegex:', nameRegexRaw);
      process.exit(2);
    }
  }

  const ctx = loadUmd(path.join(__dirname, 'pngremix-decoder.js'));
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'model-normalizer.js'), 'utf8'), ctx);

  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const dec = ctx.PngRemixDecoder.decode(ab);
  const model = ctx.ModelNormalizer.normalizePngRemixModel(dec);

  const nodes = model.sprites.map((s) => ({
    spriteId: s.spriteId,
    parentId: s.parentId,
    name: s.spriteName,
    raw: s.raw,
    children: [],
    key: '',
  }));
  const byId = new Map(nodes.map((n) => [n.spriteId, n]));
  const roots = [];
  for (const n of nodes) {
    const p = byId.get(n.parentId);
    if (p) p.children.push(n);
    else roots.push(n);
  }

  function idPart(n) {
    return n.spriteId !== null && n.spriteId !== undefined ? `id${n.spriteId}` : 'id?';
  }

  function assignKeys(n, parentKey) {
    n.key = parentKey ? `${parentKey}/${idPart(n)}` : idPart(n);
    for (const c of n.children) assignKeys(c, n.key);
  }
  for (const r of roots) assignKeys(r, '');

  // Hotkey overrides (match updated web behavior)
  const available = new Set();
  const hotkeyNodes = [];
  for (const n of nodes) {
    const raw = n.raw || {};
    if (!raw.is_asset) continue;
    const saved = Array.isArray(raw.saved_keys) ? raw.saved_keys : [];
    const keys = saved.map(normKey).filter(Boolean);
    if (!keys.length) continue;
    hotkeyNodes.push({ node: n, keys: new Set(keys) });
    for (const k of keys) available.add(k);
  }

  const overrides = {};
  if (available.has(key)) {
    for (const x of hotkeyNodes) {
      overrides[x.node.key] = { visible: x.keys.has(key) ? false : true, source: 'hotkey', hotkey: key };
    }
  }

  const showAllAssets = false;
  const stateId = 0;

  function isVisible(n, parentVisible) {
    if (!parentVisible) return false;
    const st = (n.raw && Array.isArray(n.raw.states) ? n.raw.states[stateId] : null) || null;
    if (!st) return false;

    const ov = getOverrideValue(overrides[n.key]);
    if (ov.value === false) return false;

    let visible = st.visible !== false;

    if (!showAllAssets && n.raw && n.raw.is_asset && ov.value !== true) {
      visible = visible && !!n.raw.was_active_before;
    }

    if (st.should_talk) {
      const openMouth = !!st.open_mouth;
      visible = visible && (speaking ? openMouth : !openMouth);
    }

    // Manual force-show can bypass mouth/eye gating; hotkey should not.
    if (ov.value === true && ov.source !== 'hotkey') visible = (st.visible !== false);

    return !!visible;
  }

  const visibleHits = [];
  function walk(n, parentVisible) {
    const v = isVisible(n, parentVisible);
    if (!v) return;

    const hasHotkeyOverride = Object.prototype.hasOwnProperty.call(overrides, n.key);
    const nameMatched = nameRegex ? !!nameRegex.test(String(n.name || '')) : false;

    // Default: report nodes whose visibility is impacted by the selected hotkey.
    // Optional: additionally filter/report by nameRegex.
    if (hasHotkeyOverride || nameMatched) {
      visibleHits.push({
        spriteId: n.spriteId,
        name: n.name,
        key: n.key,
        override: overrides[n.key] || null,
      });
    }

    for (const c of n.children) walk(c, v);
  }
  for (const r of roots) walk(r, true);

  console.log('key=', key, 'speaking=', speaking, 'nameRegex=', nameRegexRaw || '-', 'visible hits=', visibleHits.length);
  for (const x of visibleHits) console.log(`- [${x.spriteId}] ${x.name} ov=${x.override ? JSON.stringify(x.override) : '-'}`);
}

main();
