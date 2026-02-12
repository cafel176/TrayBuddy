const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const extractBtn = document.getElementById('extractBtn');
const downloadBtn = document.getElementById('downloadBtn');
const stepInput = document.getElementById('stepInput');
const includeDelay = document.getElementById('includeDelay');
const statusEl = document.getElementById('status');
const fileInfo = document.getElementById('fileInfo');
const fileNameEl = document.getElementById('fileName');
const fileSizeEl = document.getElementById('fileSize');
const frameCountEl = document.getElementById('frameCount');
const totalDurationEl = document.getElementById('totalDuration');
const loadingEl = document.getElementById('loading');
const loadingText = document.getElementById('loadingText');
const previewCard = document.getElementById('previewCard');
const previewCanvas = document.getElementById('previewCanvas');
const previewInfo = document.getElementById('previewInfo');

let gifFile = null;
/** @type {Blob|null} */
let zipBlob = null;

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

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(2)} ${units[unit]}`;
}

function formatDuration(ms) {
  const totalSec = ms / 1000;
  const mins = Math.floor(totalSec / 60);
  const secs = (totalSec % 60).toFixed(2).padStart(5, '0');
  return `${mins}:${secs}`;
}

function handleFile(file) {
  if (!file || file.type !== 'image/gif') {
    setStatus(t('msg_only_gif'), 'err');
    return;
  }

  gifFile = file;
  zipBlob = null;

  extractBtn.disabled = false;
  downloadBtn.disabled = true;

  setStatus(t('msg_ready'));

  fileInfo.style.display = '';
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);
  frameCountEl.textContent = '-';
  totalDurationEl.textContent = '-';

  previewCard.style.display = 'none';
}

// Drag & drop
['dragenter', 'dragover'].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
});
['dragleave', 'drop'].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
  });
});

dropZone.addEventListener('drop', (e) => {
  handleFile(e.dataTransfer?.files?.[0]);
});

dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  handleFile(e.target.files?.[0]);
  fileInput.value = '';
});

function msFromVideoFrameDuration(durationUs) {
  // WebCodecs uses microseconds
  if (!Number.isFinite(durationUs) || durationUs <= 0) return 0;
  return Math.round(durationUs / 1000);
}

async function extractFrames() {
  if (!gifFile) return;

  setLoading(true, t('processing'));
  setStatus('');

  try {
    if (typeof window.JSZip !== 'function') {
      throw new Error('JSZip 未加载：请确认已加载本地脚本 vendor/jszip.min.js');
    }

    if (typeof window.ImageDecoder !== 'function') {
      throw new Error('当前浏览器不支持 ImageDecoder（GIF 分帧解码）。请使用最新版 Edge/Chrome。');
    }

    const buffer = await gifFile.arrayBuffer();

    const decoder = new ImageDecoder({
      data: buffer,
      type: 'image/gif'
    });

    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;

    const frameCount = track?.frameCount || 0;
    if (!frameCount) {
      throw new Error('无法读取 GIF 帧数：该文件可能已损坏或不受支持');
    }

    const step = Math.max(1, parseInt(stepInput.value, 10) || 1);

    // First pass: decode metadata duration (best-effort)
    let totalDurationMs = 0;
    for (let i = 0; i < frameCount; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      totalDurationMs += msFromVideoFrameDuration(image?.duration);
      image?.close?.();
      if (i % 10 === 0) loadingText.textContent = (t('processing_frame') || '正在处理第 {n} 帧...').replace('{n}', String(i + 1));
    }

    // Reset decoder by recreating (some browsers keep internal state)
    decoder.close();

    const decoder2 = new ImageDecoder({ data: buffer, type: 'image/gif' });
    await decoder2.tracks.ready;
    const track2 = decoder2.tracks.selectedTrack;
    const frameCount2 = track2?.frameCount || frameCount;

    // Decode frames and export
    const zip = new JSZip();

    let width = 0;
    let height = 0;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 不可用');

    const previewCtx = previewCanvas.getContext('2d');

    let exportedCount = 0;

    for (let i = 0; i < frameCount2; i++) {
      const { image } = await decoder2.decode({ frameIndex: i });

      if (!width || !height) {
        width = image.displayWidth || image.codedWidth || 0;
        height = image.displayHeight || image.codedHeight || 0;
        if (!width || !height) {
          image.close();
          throw new Error('无法获取 GIF 尺寸');
        }
        canvas.width = width;
        canvas.height = height;
        previewCanvas.width = width;
        previewCanvas.height = height;
      }

      // Always render current frame (for correct image content)
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0);

      const delayMs = msFromVideoFrameDuration(image.duration);

      if (i % step === 0) {
        const nameSuffix = includeDelay.checked ? `_d${delayMs}ms` : '';
        const fileName = `frame_${String(exportedCount).padStart(4, '0')}${nameSuffix}.png`;

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (blob) {
          zip.file(fileName, blob);
          exportedCount += 1;

          if (exportedCount === 1 && previewCtx) {
            previewCtx.clearRect(0, 0, width, height);
            previewCtx.drawImage(canvas, 0, 0);
            previewInfo.textContent = (t('preview_info') || '预览第 {n} 帧').replace('{n}', String(i + 1));
            previewCard.style.display = '';
          }
        }
      }

      image.close();

      loadingText.textContent = (t('processing_frame') || '正在处理第 {n} 帧...').replace('{n}', String(i + 1));
    }

    decoder2.close();

    frameCountEl.textContent = String(frameCount2);
    totalDurationEl.textContent = formatDuration(totalDurationMs);

    zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBtn.disabled = false;
    setStatus(t('msg_done'), 'ok');
  } catch (err) {
    console.error(err);
    setStatus(t('msg_failed') + ' ' + (err?.message || err), 'err');
  } finally {
    setLoading(false);
  }
}

extractBtn.addEventListener('click', extractFrames);

downloadBtn.addEventListener('click', () => {
  if (!zipBlob) return;
  const a = document.createElement('a');
  const url = URL.createObjectURL(zipBlob);
  a.href = url;
  a.download = `gif_frames_${Date.now()}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

window.addEventListener('languageChanged', () => {
  if (gifFile) setStatus(t('msg_ready'));
});
