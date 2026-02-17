const fs = require('fs');
const vm = require('vm');

function loadDecoder(decoderPath) {
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
  vm.runInContext(fs.readFileSync(decoderPath, 'utf8'), ctx);
  if (!ctx.PngRemixDecoder) throw new Error('PngRemixDecoder not found');
  return ctx.PngRemixDecoder;
}

function normKey(k) {
  const s = String(k || '').trim().toUpperCase();
  return /^F\d+$/.test(s) ? s : '';
}

function get(obj, k) {
  return obj && Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : undefined;
}

function getId(s) {
  return get(s, 'id') ?? get(s, 'sprite_id') ?? get(s, 'uid') ?? undefined;
}

function getName(s) {
  return String(get(s, 'name') || get(s, 'sprite_name') || get(s, 'path') || get(s, 'file_path') || '').trim();
}


function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node inspect-hotkeys-node.cjs <file.pngRemix>');
    process.exit(1);
  }

  const decoder = loadDecoder(require('path').join(__dirname, 'pngremix-decoder.js'));
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const dec = decoder.decode(ab);

  const sprites = dec.sprites_array || [];
  const byParent = new Map();
  const byKey = new Map();

  for (const s of sprites) {
    if (!s || typeof s !== 'object') continue;
    if (!get(s, 'is_asset')) continue;

    const saved = Array.isArray(get(s, 'saved_keys')) ? get(s, 'saved_keys') : [];
    const keys = saved.map(normKey).filter(Boolean);
    if (!keys.length) continue;

    const id = getId(s);
    const pid = get(s, 'parent_id') ?? null;
    const name = getName(s);

    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push({ id, pid, name, keys });

    for (const k of keys) {
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push({ id, pid, name });
    }
  }

  const keysSorted = Array.from(byKey.keys()).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  console.log('Detected hotkeys:', keysSorted.join(' '));
  for (const k of keysSorted) {
    const n = byKey.get(k) || [];
    console.log(`${k}: ${n.length}`);
  }

  const groupsSummary = [];
  for (const [pid, items] of byParent.entries()) {
    const ks = new Set();
    for (const it of items) for (const kk of it.keys) ks.add(kk);
    groupsSummary.push({ pid, count: items.length, keys: Array.from(ks).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))) });
  }
  groupsSummary.sort((a, b) => (b.count - a.count));
  console.log(`\nHotkey groups by parent: ${groupsSummary.length}`);
  for (const g of groupsSummary.slice(0, 30)) {
    console.log(`- parent ${g.pid}: ${g.count} assets, keys=${g.keys.join(',')}`);
  }


  const focus = normKey(process.argv[3] || 'F5') || 'F5';
  const nameRegexRaw = String(process.argv[4] || '').trim();
  let nameRegex = null;
  if (nameRegexRaw) {
    try { nameRegex = new RegExp(nameRegexRaw, 'i'); }
    catch (_) {
      console.error('Invalid nameRegex:', nameRegexRaw);
      process.exit(2);
    }
  }

  const list = byKey.get(focus) || [];
  console.log(`\n--- ${focus} assignments (${list.length}) ---`);
  for (const x of list) console.log(`- [${x.id}] p=${x.pid} ${x.name}`);

  const parentIds = Array.from(new Set(list.map(x => x.pid)));
  console.log(`\n--- parents touched by ${focus} (${parentIds.length}) ---`);
  for (const pid of parentIds) {
    const g = (byParent.get(pid) || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-CN'));
    console.log(`parent ${pid}: ${g.length} assets`);
    for (const it of g) {
      console.log(`  - [${it.id}] ${it.name}  keys=${it.keys.join(',')}`);
    }
  }

  if (nameRegex) {
    const matchedHotkeyed = [];
    for (const [, items] of byParent) {
      for (const it of items) {
        if (nameRegex.test(String(it.name || ''))) matchedHotkeyed.push(it);
      }
    }
    console.log(`\n--- nameRegex matched among hotkeyed (${matchedHotkeyed.length}) ---`);
    for (const it of matchedHotkeyed.slice(0, 120)) {
      console.log(`- [${it.id}] p=${it.pid} ${it.name}  keys=${it.keys.join(',')}`);
    }

    // Also scan ALL sprites by name, to catch non-asset parts.
    const matchedAll = [];
    for (const s of sprites) {
      const name = getName(s);
      if (!nameRegex.test(String(name || ''))) continue;
      const saved = Array.isArray(get(s, 'saved_keys')) ? get(s, 'saved_keys') : [];
      const keys = saved.map(normKey).filter(Boolean);
      matchedAll.push({
        id: getId(s),
        pid: get(s, 'parent_id') ?? null,
        asset: !!get(s, 'is_asset'),
        name,
        keys,
        visible: get(s, 'visible'),
        wasActiveBefore: get(s, 'was_active_before'),
      });
    }
    matchedAll.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-CN'));
    console.log(`\n--- ALL nameRegex matched sprites (${matchedAll.length}) ---`);
    for (const it of matchedAll.slice(0, 200)) {
      console.log(`- [${it.id}] p=${it.pid} asset=${it.asset} ${it.name}  keys=${it.keys.join(',') || '-'}  visible=${it.visible} was_active_before=${it.wasActiveBefore}`);
    }
  }

  if (!nameRegexRaw) {
    console.log('\nTip: provide optional args: node inspect-hotkeys-node.cjs <file.pngRemix> [focusKey=F5] [nameRegex]');
  }
}


main();
