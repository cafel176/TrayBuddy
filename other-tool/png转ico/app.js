const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const filesUl = document.getElementById('filesUl');
const clearBtn = document.getElementById('clearBtn');
const sizesInput = document.getElementById('sizesInput');
const convertBtn = document.getElementById('convertBtn');
const downloadZipBtn = document.getElementById('downloadZipBtn');
const statusEl = document.getElementById('status');

/** @type {File[]} */
let selectedFiles = [];
/** @type {Blob|null} */
let lastZipBlob = null;

function t(key) {
  return window.i18n?.t ? window.i18n.t(key) : key;
}

function setStatus(text, type = '') {
  statusEl.textContent = text || '';
  statusEl.classList.remove('ok', 'err');
  if (type === 'ok') statusEl.classList.add('ok');
  if (type === 'err') statusEl.classList.add('err');
}

function getMode() {
  const el = document.querySelector('input[name="mode"]:checked');
  return el ? el.value : 'multi';
}

function getFitMode() {
  const el = document.querySelector('input[name="fit"]:checked');
  return el ? el.value : 'contain';
}

function parseSizes(text) {
  const raw = String(text || '')
    .split(/[^0-9]+/g)
    .map(s => s.trim())
    .filter(Boolean)
    .map(n => parseInt(n, 10))
    .filter(n => Number.isFinite(n) && n >= 1 && n <= 256);

  const unique = Array.from(new Set(raw));
  unique.sort((a, b) => a - b);
  return unique;
}

function baseName(fileName) {
  const name = String(fileName || 'icon.png');
  return name.replace(/\.[^.]+$/, '');
}

function sanitizeFileName(name) {
  return String(name || 'icon')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'icon';
}

function updateUI() {
  const hasFiles = selectedFiles.length > 0;
  fileList.style.display = hasFiles ? '' : 'none';
  convertBtn.disabled = !hasFiles;
  downloadZipBtn.style.display = lastZipBlob ? '' : 'none';
}

function renderFiles() {
  filesUl.innerHTML = '';
  selectedFiles.forEach((f, i) => {
    const li = document.createElement('li');
    li.textContent = `${i + 1}. ${f.name}`;
    filesUl.appendChild(li);
  });
}

function addFiles(files) {
  const list = Array.from(files || []).filter(f => f && f.type === 'image/png');
  if (list.length === 0) {
    setStatus(t('msg_only_png'), 'err');
    return;
  }

  // merge & de-dup by name+size+lastModified
  const map = new Map(selectedFiles.map(f => [`${f.name}|${f.size}|${f.lastModified}`, f]));
  for (const f of list) {
    map.set(`${f.name}|${f.size}|${f.lastModified}`, f);
  }
  selectedFiles = Array.from(map.values());

  lastZipBlob = null;
  renderFiles();
  updateUI();
  setStatus(t('msg_ready'));
}

function clearAll() {
  selectedFiles = [];
  lastZipBlob = null;
  filesUl.innerHTML = '';
  updateUI();
  setStatus('');
}

// Drag & drop
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
  addFiles(e.dataTransfer?.files);
});

dropZone.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  addFiles(e.target.files);
  fileInput.value = '';
});

clearBtn.addEventListener('click', clearAll);

function downloadBlob(blob, fileName) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function fileToImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('load image failed'));
    });
    return img;
  } finally {
    // Keep URL until draw finishes; callers should revoke after draw.
  }
}

function drawToCanvas(img, size, fitMode) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas not supported');

  ctx.clearRect(0, 0, size, size);

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;

  if (!iw || !ih) return canvas;

  const scale = fitMode === 'cover'
    ? Math.max(size / iw, size / ih)
    : Math.min(size / iw, size / ih);

  const w = Math.round(iw * scale);
  const h = Math.round(ih * scale);
  const x = Math.round((size - w) / 2);
  const y = Math.round((size - h) / 2);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x, y, w, h);

  return canvas;
}

async function canvasToPngBytes(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('toBlob failed');
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

function buildIco(entries) {
  // entries: [{ size:number, pngBytes:Uint8Array }]
  const count = entries.length;
  const headerSize = 6;
  const dirSize = 16 * count;

  let offset = headerSize + dirSize;
  const totalSize = offset + entries.reduce((sum, e) => sum + e.pngBytes.length, 0);

  const out = new Uint8Array(totalSize);
  const dv = new DataView(out.buffer);

  // ICONDIR
  dv.setUint16(0, 0, true);      // reserved
  dv.setUint16(2, 1, true);      // type (1 = icon)
  dv.setUint16(4, count, true);  // count

  // ICONDIRENTRYs
  let dirOff = headerSize;
  for (const e of entries) {
    const s = e.size;
    const w = s === 256 ? 0 : s;
    const h = s === 256 ? 0 : s;

    out[dirOff + 0] = w & 0xff;
    out[dirOff + 1] = h & 0xff;
    out[dirOff + 2] = 0; // color count
    out[dirOff + 3] = 0; // reserved
    dv.setUint16(dirOff + 4, 1, true);   // planes
    dv.setUint16(dirOff + 6, 32, true);  // bit count
    dv.setUint32(dirOff + 8, e.pngBytes.length, true);
    dv.setUint32(dirOff + 12, offset, true);

    out.set(e.pngBytes, offset);
    offset += e.pngBytes.length;
    dirOff += 16;
  }

  return new Blob([out], { type: 'image/x-icon' });
}

async function convertAllToZip() {
  const sizes = parseSizes(sizesInput.value);
  if (sizes.length === 0) {
    setStatus(t('msg_invalid_sizes'), 'err');
    return null;
  }

  const mode = getMode();
  const fitMode = getFitMode();

  const zip = new JSZip();
  const total = selectedFiles.length;

  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];
    setStatus(t('msg_processing_file')
      .replace('{i}', String(i + 1))
      .replace('{total}', String(total))
      .replace('{name}', file.name));

    const url = URL.createObjectURL(file);
    let img;
    try {
      img = new Image();
      img.decoding = 'async';
      img.src = url;
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('load image failed'));
      });

      const bn = sanitizeFileName(baseName(file.name));

      if (mode === 'single') {
        for (const s of sizes) {
          const canvas = drawToCanvas(img, s, fitMode);
          const pngBytes = await canvasToPngBytes(canvas);
          const icoBlob = buildIco([{ size: s, pngBytes }]);
          const ab = await icoBlob.arrayBuffer();
          zip.file(`${bn}_${s}.ico`, ab);
        }
      } else {
        const entries = [];
        for (const s of sizes) {
          const canvas = drawToCanvas(img, s, fitMode);
          const pngBytes = await canvasToPngBytes(canvas);
          entries.push({ size: s, pngBytes });
        }
        const icoBlob = buildIco(entries);
        const ab = await icoBlob.arrayBuffer();
        zip.file(`${bn}.ico`, ab);
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  setStatus(t('msg_zipping'));
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  return zipBlob;
}

convertBtn.addEventListener('click', async () => {
  try {
    lastZipBlob = null;
    downloadZipBtn.style.display = 'none';

    const zipBlob = await convertAllToZip();
    if (!zipBlob) return;

    lastZipBlob = zipBlob;
    updateUI();

    // Auto download
    downloadBlob(zipBlob, 'png_to_ico.zip');
    setStatus(t('msg_done'), 'ok');
  } catch (e) {
    console.error(e);
    setStatus(t('msg_failed') + ' ' + String(e && e.message ? e.message : e), 'err');
  }
});

downloadZipBtn.addEventListener('click', () => {
  if (!lastZipBlob) return;
  downloadBlob(lastZipBlob, 'png_to_ico.zip');
});

window.addEventListener('languageChanged', () => {
  // refresh status text if it was a fixed key
});
