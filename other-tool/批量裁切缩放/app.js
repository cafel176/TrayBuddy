/* global JSZip */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const els = {
  fileInput: $('#fileInput'),
  clearBtn: $('#clearBtn'),
  processBtn: $('#processBtn'),
  status: $('#status'),
  tableBody: $('#fileTableBody'),

  imageCount: $('#imageCount'),
  imageSizeInfo: $('#imageSizeInfo'),

  cropTop: $('#cropTop'),
  cropBottom: $('#cropBottom'),
  cropLeft: $('#cropLeft'),
  cropRight: $('#cropRight'),
  cropSizeLabel: $('#cropSizeLabel'),
  
  // 裁切编辑器元素
  cropEditorWrapper: $('#cropEditorWrapper'),
  cropEditor: $('#cropEditor'),
  cropEditorInner: $('#cropEditorInner'),
  previewImage: $('#previewImage'),
  cropPlaceholder: $('#cropPlaceholder'),
  overlayTop: $('#overlayTop'),
  overlayBottom: $('#overlayBottom'),
  overlayLeft: $('#overlayLeft'),
  overlayRight: $('#overlayRight'),
  handleTop: $('#handleTop'),
  handleBottom: $('#handleBottom'),
  handleLeft: $('#handleLeft'),
  handleRight: $('#handleRight'),
  zoomInBtn: $('#zoomInBtn'),
  zoomOutBtn: $('#zoomOutBtn'),
  zoomFitBtn: $('#zoomFitBtn'),
  zoomLabel: $('#zoomLabel'),

  lockAspect: $('#lockAspect'),
  uniformScaleField: $('#uniformScaleField'),
  separateScaleField: $('#separateScaleField'),
  scalePercent: $('#scalePercent'),
  scaleWidth: $('#scaleWidth'),
  scaleHeight: $('#scaleHeight'),
  scaleSizePreview: $('#scaleSizePreview'),
  scalePreviewImage: $('#scalePreviewImage'),
  scalePreviewPlaceholder: $('#scalePreviewPlaceholder'),

  expandLeft: $('#expandLeft'),
  expandRight: $('#expandRight'),
  expandTop: $('#expandTop'),
  expandBottom: $('#expandBottom'),
  expandSizePreview: $('#expandSizePreview'),

  outFormat: $('#outFormat'),
  jpegQualityField: $('#jpegQualityField'),
  jpegQuality: $('#jpegQuality'),
};

let selectedFiles = [];
let firstImageInfo = null; // {w, h}
let firstImageElement = null; // 保存第一张图片的 Image 对象用于预览
let fileInfoMap = new Map(); // file -> {w, h, valid}  记录每个文件的尺寸和是否有效

// 缩放相关状态
let currentZoom = 1;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

// 拖拽相关状态
let isDragging = false;
let dragHandle = null;
let dragStartY = 0;
let dragStartX = 0;
let dragStartValue = 0;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function setStatus(text) {
  els.status.textContent = text;
}

function fmtSize(w, h) {
  if (!w || !h) return '-';
  return `${w} × ${h}`;
}

function mimeToExt(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  return 'png';
}

function baseName(name) {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(0, idx) : name;
}

function safeInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function safeNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(file);
      return { bmp, w: bmp.width, h: bmp.height };
    } catch (_) {
      // fallback below
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    return { img, w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function getCropValues() {
  return {
    top: Math.max(0, safeInt(els.cropTop.value, 0)),
    bottom: Math.max(0, safeInt(els.cropBottom.value, 0)),
    left: Math.max(0, safeInt(els.cropLeft.value, 0)),
    right: Math.max(0, safeInt(els.cropRight.value, 0)),
  };
}

function getCroppedSize(origW, origH) {
  const crop = getCropValues();
  const w = Math.max(1, origW - crop.left - crop.right);
  const h = Math.max(1, origH - crop.top - crop.bottom);
  return { w, h, crop };
}

function getScaleValues() {
  const lockAspect = els.lockAspect.checked;
  if (lockAspect) {
    const p = safeNum(els.scalePercent.value, 100);
    return { scaleW: p / 100, scaleH: p / 100 };
  } else {
    const sw = safeNum(els.scaleWidth.value, 100);
    const sh = safeNum(els.scaleHeight.value, 100);
    return { scaleW: sw / 100, scaleH: sh / 100 };
  }
}

function getScaledSize(croppedW, croppedH) {
  const { scaleW, scaleH } = getScaleValues();
  const w = Math.max(1, Math.round(croppedW * scaleW));
  const h = Math.max(1, Math.round(croppedH * scaleH));
  return { w, h };
}

function getExpandValues() {
  return {
    left: Math.max(0, safeInt(els.expandLeft.value, 0)),
    right: Math.max(0, safeInt(els.expandRight.value, 0)),
    top: Math.max(0, safeInt(els.expandTop.value, 0)),
    bottom: Math.max(0, safeInt(els.expandBottom.value, 0)),
  };
}

function getExpandedSize(scaledW, scaledH) {
  const expand = getExpandValues();
  const w = scaledW + expand.left + expand.right;
  const h = scaledH + expand.top + expand.bottom;
  return { w, h, expand };
}

function updateCropPreview() {
  if (!firstImageInfo || !firstImageElement) {
    els.cropSizeLabel.textContent = '裁切后：- × -';
    els.previewImage.style.display = 'none';
    els.cropPlaceholder.style.display = 'block';
    hideOverlaysAndHandles();
    return;
  }

  const { w: origW, h: origH } = firstImageInfo;
  const { w: croppedW, h: croppedH, crop } = getCroppedSize(origW, origH);

  // 验证裁切是否有效
  if (crop.left + crop.right >= origW || crop.top + crop.bottom >= origH) {
    els.cropSizeLabel.textContent = '裁切无效！';
    return;
  }

  els.cropSizeLabel.textContent = `裁切后：${croppedW} × ${croppedH}`;

  // 更新遮罩层和基准线位置
  updateOverlaysAndHandles();
}

function hideOverlaysAndHandles() {
  els.overlayTop.style.display = 'none';
  els.overlayBottom.style.display = 'none';
  els.overlayLeft.style.display = 'none';
  els.overlayRight.style.display = 'none';
  els.handleTop.style.display = 'none';
  els.handleBottom.style.display = 'none';
  els.handleLeft.style.display = 'none';
  els.handleRight.style.display = 'none';
}

function showOverlaysAndHandles() {
  els.overlayTop.style.display = 'block';
  els.overlayBottom.style.display = 'block';
  els.overlayLeft.style.display = 'block';
  els.overlayRight.style.display = 'block';
  els.handleTop.style.display = 'block';
  els.handleBottom.style.display = 'block';
  els.handleLeft.style.display = 'block';
  els.handleRight.style.display = 'block';
}

function updateOverlaysAndHandles() {
  if (!firstImageInfo) return;

  const { w: origW, h: origH } = firstImageInfo;
  const crop = getCropValues();
  
  // 计算缩放后的像素位置
  const scaledW = origW * currentZoom;
  const scaledH = origH * currentZoom;
  const cropTopPx = crop.top * currentZoom;
  const cropBottomPx = crop.bottom * currentZoom;
  const cropLeftPx = crop.left * currentZoom;
  const cropRightPx = crop.right * currentZoom;

  // 更新遮罩层
  // 上遮罩
  els.overlayTop.style.top = '0';
  els.overlayTop.style.left = '0';
  els.overlayTop.style.width = `${scaledW}px`;
  els.overlayTop.style.height = `${cropTopPx}px`;

  // 下遮罩
  els.overlayBottom.style.bottom = '0';
  els.overlayBottom.style.left = '0';
  els.overlayBottom.style.width = `${scaledW}px`;
  els.overlayBottom.style.height = `${cropBottomPx}px`;

  // 左遮罩（在上下遮罩之间）
  els.overlayLeft.style.top = `${cropTopPx}px`;
  els.overlayLeft.style.left = '0';
  els.overlayLeft.style.width = `${cropLeftPx}px`;
  els.overlayLeft.style.height = `${scaledH - cropTopPx - cropBottomPx}px`;

  // 右遮罩（在上下遮罩之间）
  els.overlayRight.style.top = `${cropTopPx}px`;
  els.overlayRight.style.right = '0';
  els.overlayRight.style.width = `${cropRightPx}px`;
  els.overlayRight.style.height = `${scaledH - cropTopPx - cropBottomPx}px`;

  // 更新基准线位置
  // 上基准线
  els.handleTop.style.top = `${cropTopPx}px`;
  els.handleTop.style.left = `${cropLeftPx}px`;
  els.handleTop.style.width = `${scaledW - cropLeftPx - cropRightPx}px`;

  // 下基准线
  els.handleBottom.style.top = `${scaledH - cropBottomPx}px`;
  els.handleBottom.style.left = `${cropLeftPx}px`;
  els.handleBottom.style.width = `${scaledW - cropLeftPx - cropRightPx}px`;

  // 左基准线
  els.handleLeft.style.left = `${cropLeftPx}px`;
  els.handleLeft.style.top = `${cropTopPx}px`;
  els.handleLeft.style.height = `${scaledH - cropTopPx - cropBottomPx}px`;

  // 右基准线
  els.handleRight.style.left = `${scaledW - cropRightPx}px`;
  els.handleRight.style.top = `${cropTopPx}px`;
  els.handleRight.style.height = `${scaledH - cropTopPx - cropBottomPx}px`;

  showOverlaysAndHandles();
}

// 缩放相关函数
function setZoom(zoom) {
  currentZoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  els.zoomLabel.textContent = `${Math.round(currentZoom * 100)}%`;
  
  if (firstImageElement && firstImageInfo) {
    const scaledW = firstImageInfo.w * currentZoom;
    const scaledH = firstImageInfo.h * currentZoom;
    
    // 设置图片和内层容器尺寸
    els.previewImage.style.width = `${scaledW}px`;
    els.previewImage.style.height = `${scaledH}px`;
    els.cropEditorInner.style.width = `${scaledW}px`;
    els.cropEditorInner.style.height = `${scaledH}px`;
    
    // 判断是否需要居中（当图片小于容器时）
    const wrapperRect = els.cropEditorWrapper.getBoundingClientRect();
    const needCenter = scaledW <= wrapperRect.width && scaledH <= wrapperRect.height;
    
    if (needCenter) {
      els.cropEditor.classList.add('centered');
    } else {
      els.cropEditor.classList.remove('centered');
    }
    
    updateOverlaysAndHandles();
  }
}

function zoomIn() {
  setZoom(currentZoom + ZOOM_STEP);
}

function zoomOut() {
  setZoom(currentZoom - ZOOM_STEP);
}

function zoomFit() {
  if (!firstImageInfo) return;
  
  const wrapperRect = els.cropEditorWrapper.getBoundingClientRect();
  const padding = 20;
  const availableW = wrapperRect.width - padding * 2;
  const availableH = wrapperRect.height - padding * 2;
  
  const scaleX = availableW / firstImageInfo.w;
  const scaleY = availableH / firstImageInfo.h;
  const fitZoom = Math.min(scaleX, scaleY, 1);
  
  setZoom(fitZoom);
}

// 拖拽相关函数
function startDrag(e, handle) {
  e.preventDefault();
  isDragging = true;
  dragHandle = handle;
  
  const clientX = e.clientX || (e.touches && e.touches[0].clientX);
  const clientY = e.clientY || (e.touches && e.touches[0].clientY);
  
  dragStartX = clientX;
  dragStartY = clientY;
  
  if (handle === 'top') {
    dragStartValue = parseInt(els.cropTop.value) || 0;
  } else if (handle === 'bottom') {
    dragStartValue = parseInt(els.cropBottom.value) || 0;
  } else if (handle === 'left') {
    dragStartValue = parseInt(els.cropLeft.value) || 0;
  } else if (handle === 'right') {
    dragStartValue = parseInt(els.cropRight.value) || 0;
  }
  
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', stopDrag);
  document.addEventListener('touchmove', onDrag);
  document.addEventListener('touchend', stopDrag);
}

function onDrag(e) {
  if (!isDragging || !firstImageInfo) return;
  
  const clientX = e.clientX || (e.touches && e.touches[0].clientX);
  const clientY = e.clientY || (e.touches && e.touches[0].clientY);
  
  const { w: origW, h: origH } = firstImageInfo;
  
  if (dragHandle === 'top') {
    const deltaY = clientY - dragStartY;
    const deltaPx = Math.round(deltaY / currentZoom);
    const newValue = clamp(dragStartValue + deltaPx, 0, origH - parseInt(els.cropBottom.value || 0) - 1);
    els.cropTop.value = newValue;
  } else if (dragHandle === 'bottom') {
    const deltaY = dragStartY - clientY;
    const deltaPx = Math.round(deltaY / currentZoom);
    const newValue = clamp(dragStartValue + deltaPx, 0, origH - parseInt(els.cropTop.value || 0) - 1);
    els.cropBottom.value = newValue;
  } else if (dragHandle === 'left') {
    const deltaX = clientX - dragStartX;
    const deltaPx = Math.round(deltaX / currentZoom);
    const newValue = clamp(dragStartValue + deltaPx, 0, origW - parseInt(els.cropRight.value || 0) - 1);
    els.cropLeft.value = newValue;
  } else if (dragHandle === 'right') {
    const deltaX = dragStartX - clientX;
    const deltaPx = Math.round(deltaX / currentZoom);
    const newValue = clamp(dragStartValue + deltaPx, 0, origW - parseInt(els.cropLeft.value || 0) - 1);
    els.cropRight.value = newValue;
  }
  
  updateAllPreviews();
}

function stopDrag() {
  isDragging = false;
  dragHandle = null;
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
  document.removeEventListener('touchmove', onDrag);
  document.removeEventListener('touchend', stopDrag);
}

// 滚轮缩放
function onWheelZoom(e) {
  if (!firstImageInfo) return;
  e.preventDefault();
  
  const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
  setZoom(currentZoom + delta);
}

function updateScalePreview() {
  const lockAspect = els.lockAspect.checked;

  if (!firstImageInfo) {
    els.scaleSizePreview.textContent = '-';
    els.expandSizePreview.textContent = '-';
    hideScalePreviewImage();
    return;
  }

  const { w: origW, h: origH } = firstImageInfo;
  const { w: croppedW, h: croppedH, crop } = getCroppedSize(origW, origH);

  // 验证裁切是否有效
  if (crop.left + crop.right >= origW || crop.top + crop.bottom >= origH) {
    els.scaleSizePreview.textContent = '裁切无效，无法计算缩放';
    els.expandSizePreview.textContent = '-';
    hideScalePreviewImage();
    return;
  }

  const { w: scaledW, h: scaledH } = getScaledSize(croppedW, croppedH);
  const { w: finalW, h: finalH, expand } = getExpandedSize(scaledW, scaledH);
  const { scaleW, scaleH } = getScaleValues();

  if (lockAspect) {
    els.scaleSizePreview.textContent = `${croppedW} × ${croppedH} → ${scaledW} × ${scaledH}（缩放 ${Math.round(scaleW * 100)}%）`;
  } else {
    els.scaleSizePreview.textContent = `${croppedW} × ${croppedH} → ${scaledW} × ${scaledH}（宽 ${Math.round(scaleW * 100)}%，高 ${Math.round(scaleH * 100)}%）`;
    // 生成缩放后的预览图
    updateScalePreviewImage(croppedW, croppedH, scaledW, scaledH, crop);
  }

  // 显示最终尺寸预览（包含扩充）
  if (expand.left + expand.right + expand.top + expand.bottom === 0) {
    els.expandSizePreview.textContent = `${scaledW} × ${scaledH}`;
  } else {
    els.expandSizePreview.textContent = `${scaledW} × ${scaledH} → ${finalW} × ${finalH}`;
  }
}

function hideScalePreviewImage() {
  els.scalePreviewImage.style.display = 'none';
  els.scalePreviewPlaceholder.style.display = 'block';
}

function updateScalePreviewImage(croppedW, croppedH, scaledW, scaledH, crop) {
  if (!firstImageElement) {
    hideScalePreviewImage();
    return;
  }

  // 先裁切
  const croppedCanvas = document.createElement('canvas');
  croppedCanvas.width = croppedW;
  croppedCanvas.height = croppedH;
  const cctx = croppedCanvas.getContext('2d');
  cctx.drawImage(
    firstImageElement,
    crop.left, crop.top, croppedW, croppedH,
    0, 0, croppedW, croppedH
  );

  // 再缩放（不等比例）
  const scaledCanvas = document.createElement('canvas');
  scaledCanvas.width = scaledW;
  scaledCanvas.height = scaledH;
  const sctx = scaledCanvas.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(croppedCanvas, 0, 0, croppedW, croppedH, 0, 0, scaledW, scaledH);

  // 显示预览
  els.scalePreviewImage.src = scaledCanvas.toDataURL('image/png');
  els.scalePreviewImage.style.display = 'block';
  els.scalePreviewPlaceholder.style.display = 'none';
}

function updateAllPreviews() {
  updateCropPreview();
  updateScalePreview();
}

function updateScaleFieldsUI() {
  const lockAspect = els.lockAspect.checked;
  els.uniformScaleField.hidden = !lockAspect;
  els.separateScaleField.hidden = lockAspect;
}

function updateJpegUI() {
  const isJpeg = els.outFormat.value === 'image/jpeg';
  els.jpegQualityField.hidden = !isJpeg;
}

function renderTable(rows) {
  if (!rows.length) {
    els.tableBody.innerHTML = '<tr><td colspan="6" class="empty">未选择图片</td></tr>';
    return;
  }

  els.tableBody.innerHTML = rows
    .map((r) => {
      const statusClass = r.statusType === 'bad' ? 'bad' : r.statusType === 'ok' ? 'ok' : '';
      return `
        <tr>
          <td>${escapeHtml(r.name)}</td>
          <td>${fmtSize(r.origW, r.origH)}</td>
          <td>${fmtSize(r.croppedW, r.croppedH)}</td>
          <td>${fmtSize(r.scaledW, r.scaledH)}</td>
          <td>${fmtSize(r.finalW, r.finalH)}</td>
          <td class="${statusClass}">${escapeHtml(r.statusText || '')}</td>
        </tr>
      `;
    })
    .join('');
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function refreshSelection() {
  const files = Array.from(els.fileInput.files || []);
  selectedFiles = files;
  firstImageInfo = null;
  firstImageElement = null;
  fileInfoMap.clear();

  if (!files.length) {
    els.imageCount.textContent = '未选择';
    els.imageSizeInfo.textContent = '';
    renderTable([]);
    updateAllPreviews();
    return;
  }

  setStatus(`已选择 ${files.length} 张图片，解析尺寸中…`);
  els.imageCount.textContent = `${files.length} 张`;

  // 解析所有图片的尺寸
  const rows = [];
  let mismatchCount = 0;
  
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    try {
      const decoded = await decodeImage(f);
      const w = decoded.w;
      const h = decoded.h;

      // 第一张图作为基准，并保存用于预览
      if (i === 0) {
        firstImageInfo = { w, h };
        els.imageSizeInfo.textContent = `基准尺寸：${w} × ${h}`;
        
        // 加载第一张图片用于预览
        const url = URL.createObjectURL(f);
        const img = new Image();
        img.src = url;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });
        firstImageElement = img;
        // 注意：保持 URL 有效，不在这里 revoke
      }

      if (decoded.bmp && decoded.bmp.close) decoded.bmp.close();

      // 检查是否与第一张图尺寸一致
      const isValid = (w === firstImageInfo.w && h === firstImageInfo.h);
      fileInfoMap.set(f, { w, h, valid: isValid });

      let statusText = '待处理';
      let statusType = 'info';
      if (!isValid) {
        mismatchCount++;
        statusText = `尺寸不一致（${w}×${h}），将跳过`;
        statusType = 'bad';
      }

      rows.push({
        name: f.name,
        origW: w,
        origH: h,
        croppedW: null,
        croppedH: null,
        scaledW: null,
        scaledH: null,
        finalW: null,
        finalH: null,
        statusText,
        statusType,
      });
    } catch (_) {
      fileInfoMap.set(f, { w: 0, h: 0, valid: false });
      mismatchCount++;
      rows.push({
        name: f.name,
        origW: null,
        origH: null,
        croppedW: null,
        croppedH: null,
        scaledW: null,
        scaledH: null,
        finalW: null,
        finalH: null,
        statusText: '无法读取，将跳过',
        statusType: 'bad',
      });
    }
  }

  renderTable(rows);
  updateAllPreviews();
  
  // 初始化裁切编辑器
  if (firstImageElement) {
    els.previewImage.src = firstImageElement.src;
    els.previewImage.style.display = 'block';
    els.cropPlaceholder.style.display = 'none';
    zoomFit();
  }

  // 显示统计信息
  const validCount = files.length - mismatchCount;
  if (mismatchCount > 0) {
    if (validCount === 0) {
      setStatus(`已选择 ${files.length} 张图片，所有图片尺寸不一致，将以第一张图（${firstImageInfo.w}×${firstImageInfo.h}）为基准处理`);
      // 如果所有图片都不一致，则第一张图设为有效
      const firstFile = files[0];
      const info = fileInfoMap.get(firstFile);
      if (info) {
        info.valid = true;
        fileInfoMap.set(firstFile, info);
        rows[0].statusText = '待处理（基准图）';
        rows[0].statusType = 'info';
        renderTable(rows);
      }
    } else {
      setStatus(`已选择 ${files.length} 张图片，${mismatchCount} 张尺寸不一致将被跳过，${validCount} 张待处理`);
    }
  } else {
    setStatus(`已选择 ${files.length} 张图片，尺寸一致（${firstImageInfo.w}×${firstImageInfo.h}）`);
  }
}

function drawToCanvas(source, srcW, srcH, dstW, dstH) {
  const canvas = document.createElement('canvas');
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: false });

  ctx.clearRect(0, 0, dstW, dstH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, srcW, srcH, 0, 0, dstW, dstH);
  return canvas;
}

async function canvasToBlob(canvas, mime) {
  const isJpeg = mime === 'image/jpeg';
  const q = isJpeg ? clamp(Number(els.jpegQuality.value) || 0.92, 0.6, 1) : undefined;
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      mime,
      q
    );
  });
}

async function processOne(file) {
  const decoded = await decodeImage(file);
  const source = decoded.bmp || decoded.img;
  const origW = decoded.w;
  const origH = decoded.h;

  const crop = getCropValues();

  // 验证裁切
  if (crop.left + crop.right >= origW) {
    const msg = `左右裁切总和 ${crop.left + crop.right}px >= 图片宽度 ${origW}px`;
    if (decoded.bmp && decoded.bmp.close) decoded.bmp.close();
    return { ok: false, reason: msg, origW, origH };
  }
  if (crop.top + crop.bottom >= origH) {
    const msg = `上下裁切总和 ${crop.top + crop.bottom}px >= 图片高度 ${origH}px`;
    if (decoded.bmp && decoded.bmp.close) decoded.bmp.close();
    return { ok: false, reason: msg, origW, origH };
  }

  const croppedW = origW - crop.left - crop.right;
  const croppedH = origH - crop.top - crop.bottom;

  // Step 1: 裁切
  const croppedCanvas = document.createElement('canvas');
  croppedCanvas.width = croppedW;
  croppedCanvas.height = croppedH;
  const cctx = croppedCanvas.getContext('2d', { alpha: true });
  cctx.clearRect(0, 0, croppedW, croppedH);
  cctx.drawImage(source, crop.left, crop.top, croppedW, croppedH, 0, 0, croppedW, croppedH);

  // Step 2: 缩放
  const { w: scaledW, h: scaledH } = getScaledSize(croppedW, croppedH);
  const scaledCanvas = drawToCanvas(croppedCanvas, croppedW, croppedH, scaledW, scaledH);

  // Step 3: 扩充透明像素
  const expand = getExpandValues();
  const { w: finalW, h: finalH } = getExpandedSize(scaledW, scaledH);
  let finalCanvas = scaledCanvas;

  if (expand.left + expand.right + expand.top + expand.bottom > 0) {
    finalCanvas = document.createElement('canvas');
    finalCanvas.width = finalW;
    finalCanvas.height = finalH;
    const fctx = finalCanvas.getContext('2d', { alpha: true });

    // 不需要填充背景，canvas 默认为透明
    // 直接绘制缩放后的图片到指定位置
    fctx.drawImage(scaledCanvas, expand.left, expand.top);
  }

  const mime = els.outFormat.value;
  const blob = await canvasToBlob(finalCanvas, mime);

  // cleanup
  if (decoded.bmp && decoded.bmp.close) decoded.bmp.close();

  return {
    ok: true,
    blob,
    origW,
    origH,
    croppedW,
    croppedH,
    scaledW,
    scaledH,
    finalW,
    finalH,
  };
}

async function processAll() {
  if (!selectedFiles.length) {
    alert('请先选择图片');
    return;
  }

  // 筛选有效文件
  const validFiles = selectedFiles.filter(f => {
    const info = fileInfoMap.get(f);
    return info && info.valid;
  });

  if (!validFiles.length) {
    alert('没有可处理的图片（所有图片尺寸不一致或无法读取）');
    return;
  }

  const canZip = !!window.JSZip;
  const zip = canZip ? new JSZip() : null;
  const outExt = mimeToExt(els.outFormat.value);

  els.processBtn.disabled = true;
  els.clearBtn.disabled = true;
  els.fileInput.disabled = true;

  setStatus(canZip ? '处理中…' : '处理中…（JSZip 未加载，将逐个下载）');

  // 构建行数据，保留原有状态
  const rows = selectedFiles.map((f) => {
    const info = fileInfoMap.get(f);
    const isValid = info && info.valid;
    return {
      name: f.name,
      origW: info?.w || null,
      origH: info?.h || null,
      croppedW: null,
      croppedH: null,
      scaledW: null,
      scaledH: null,
      finalW: null,
      finalH: null,
      statusText: isValid ? '排队中…' : (info?.w ? `尺寸不一致，已跳过` : '无法读取，已跳过'),
      statusType: isValid ? 'info' : 'bad',
    };
  });
  renderTable(rows);

  let okCount = 0;
  let processedCount = 0;
  
  for (let i = 0; i < selectedFiles.length; i++) {
    const f = selectedFiles[i];
    const info = fileInfoMap.get(f);
    
    // 跳过无效文件
    if (!info || !info.valid) {
      continue;
    }

    rows[i].statusText = '处理中…';
    renderTable(rows);

    try {
      const r = await processOne(f);
      rows[i].origW = r.origW;
      rows[i].origH = r.origH;
      rows[i].croppedW = r.croppedW;
      rows[i].croppedH = r.croppedH;
      rows[i].scaledW = r.scaledW;
      rows[i].scaledH = r.scaledH;
      rows[i].finalW = r.finalW;
      rows[i].finalH = r.finalH;

      if (!r.ok) {
        rows[i].statusText = `失败：${r.reason}`;
        rows[i].statusType = 'bad';
        renderTable(rows);
        processedCount++;
        continue;
      }

      const outName = `${baseName(f.name)}_crop_${r.croppedW}x${r.croppedH}_scale_${r.scaledW}x${r.scaledH}_expand_${r.finalW}x${r.finalH}.${outExt}`;

      if (canZip) {
        zip.file(outName, r.blob);
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(r.blob);
        a.download = outName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        await new Promise((res) => setTimeout(res, 80));
      }

      rows[i].statusText = '完成';
      rows[i].statusType = 'ok';
      okCount++;
      processedCount++;
      renderTable(rows);
    } catch (e) {
      rows[i].statusText = `失败：${e?.message || e}`;
      rows[i].statusType = 'bad';
      processedCount++;
      renderTable(rows);
    }

    setStatus(`处理中… ${processedCount}/${validFiles.length}（成功 ${okCount}）`);
  }

  if (!okCount) {
    setStatus('全部失败（请检查裁切/缩放设置）');
    els.processBtn.disabled = false;
    els.clearBtn.disabled = false;
    els.fileInput.disabled = false;
    return;
  }

  if (canZip) {
    setStatus('打包 ZIP…');
    const zipBlob = await zip.generateAsync({ type: 'blob' });

    const ts = new Date();
    const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}_${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}${String(ts.getSeconds()).padStart(2, '0')}`;
    const zipName = `cropped_scaled_${stamp}.zip`;

    const a = document.createElement('a');
    a.href = URL.createObjectURL(zipBlob);
    a.download = zipName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);

    const skippedCount = selectedFiles.length - validFiles.length;
    const skippedText = skippedCount > 0 ? `，跳过 ${skippedCount} 张` : '';
    setStatus(`完成：成功 ${okCount}/${validFiles.length}${skippedText}，已下载 ${zipName}`);
  } else {
    const skippedCount = selectedFiles.length - validFiles.length;
    const skippedText = skippedCount > 0 ? `，跳过 ${skippedCount} 张` : '';
    setStatus(`完成：成功 ${okCount}/${validFiles.length}${skippedText}（已逐个下载）`);
  }

  els.processBtn.disabled = false;
  els.clearBtn.disabled = false;
  els.fileInput.disabled = false;
}

function clearAll() {
  els.fileInput.value = '';
  selectedFiles = [];
  firstImageInfo = null;
  firstImageElement = null;
  fileInfoMap.clear();
  els.imageCount.textContent = '未选择';
  els.imageSizeInfo.textContent = '';
  els.previewImage.style.display = 'none';
  els.cropPlaceholder.style.display = 'block';
  els.cropPlaceholder.textContent = '请先选择图片';
  hideOverlaysAndHandles();
  currentZoom = 1;
  els.zoomLabel.textContent = '100%';
  renderTable([]);
  updateAllPreviews();
  setStatus('未开始');
}

// 事件绑定
els.fileInput.addEventListener('change', refreshSelection);
els.clearBtn.addEventListener('click', clearAll);
els.processBtn.addEventListener('click', processAll);

// 裁切输入变化
els.cropTop.addEventListener('input', updateAllPreviews);
els.cropBottom.addEventListener('input', updateAllPreviews);
els.cropLeft.addEventListener('input', updateAllPreviews);
els.cropRight.addEventListener('input', updateAllPreviews);

// 缩放按钮
els.zoomInBtn.addEventListener('click', zoomIn);
els.zoomOutBtn.addEventListener('click', zoomOut);
els.zoomFitBtn.addEventListener('click', zoomFit);

// 滚轮缩放
els.cropEditorWrapper.addEventListener('wheel', onWheelZoom, { passive: false });

// 拖拽基准线
els.handleTop.addEventListener('mousedown', (e) => startDrag(e, 'top'));
els.handleBottom.addEventListener('mousedown', (e) => startDrag(e, 'bottom'));
els.handleLeft.addEventListener('mousedown', (e) => startDrag(e, 'left'));
els.handleRight.addEventListener('mousedown', (e) => startDrag(e, 'right'));

els.handleTop.addEventListener('touchstart', (e) => startDrag(e, 'top'));
els.handleBottom.addEventListener('touchstart', (e) => startDrag(e, 'bottom'));
els.handleLeft.addEventListener('touchstart', (e) => startDrag(e, 'left'));
els.handleRight.addEventListener('touchstart', (e) => startDrag(e, 'right'));

// 缩放输入变化
els.lockAspect.addEventListener('change', () => {
  updateScaleFieldsUI();
  updateScalePreview();
});
els.scalePercent.addEventListener('input', updateScalePreview);
els.scaleWidth.addEventListener('input', updateScalePreview);
els.scaleHeight.addEventListener('input', updateScalePreview);

// 扩充透明像素输入变化
els.expandLeft.addEventListener('input', updateScalePreview);
els.expandRight.addEventListener('input', updateScalePreview);
els.expandTop.addEventListener('input', updateScalePreview);
els.expandBottom.addEventListener('input', updateScalePreview);

// 输出格式
els.outFormat.addEventListener('change', updateJpegUI);

// 初始化
updateScaleFieldsUI();
updateJpegUI();
updateAllPreviews();
renderTable([]);
setStatus('未开始');
hideOverlaysAndHandles();
