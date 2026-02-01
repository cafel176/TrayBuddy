/* global JSZip */

/**
 * 批量裁切缩放工具 - 核心逻辑
 * 模块化组织：配置、状态、DOM引用、工具函数、核心处理、UI更新、事件绑定
 */

// --- 1. 配置与常量 ---
const CONFIG = {
  MIN_ZOOM: 0.1,
  MAX_ZOOM: 5,
  ZOOM_STEP: 0.25,
  DEFAULT_JPEG_QUALITY: 0.92,
  MIME_TYPES: {
    PNG: 'image/png',
    JPEG: 'image/jpeg'
  }
};

// --- 2. 状态管理 ---
const state = {
  selectedFiles: [],
  fileInfoMap: new Map(), // File -> { w, h, valid, mismatch }
  baseImageInfo: null,    // { w, h } 基准尺寸
  previewImageObj: null,  // 用于预览的 Image 对象
  currentZoom: 1,
  isDragging: false,
  dragState: {
    handle: null,
    startX: 0,
    startY: 0,
    startValue: 0
  }
};

// --- 3. DOM 元素引用 ---
const $ = (sel) => document.querySelector(sel);
const els = {
  // 核心控制
  fileInput: $('#fileInput'),
  dropZone: $('#dropZone'),
  clearBtn: $('#clearBtn'),
  processBtn: $('#processBtn'),
  status: $('#status'),
  tableBody: $('#fileTableBody'),

  // 统计与选项
  imageCount: $('#imageCount'),
  imageSizeInfo: $('#imageSizeInfo'),
  skipMismatch: $('#skipMismatch'),

  // 裁切设置
  cropInputs: {
    top: $('#cropTop'),
    bottom: $('#cropBottom'),
    left: $('#cropLeft'),
    right: $('#cropRight')
  },
  cropSizeLabel: $('#cropSizeLabel'),
  
  // 裁切编辑器
  editor: {
    wrapper: $('#cropEditorWrapper'),
    container: $('#cropEditor'),
    inner: $('#cropEditorInner'),
    preview: $('#previewImage'),
    placeholder: $('#cropPlaceholder'),
    overlays: {
      top: $('#overlayTop'),
      bottom: $('#overlayBottom'),
      left: $('#overlayLeft'),
      right: $('#overlayRight')
    },
    handles: {
      top: $('#handleTop'),
      bottom: $('#handleBottom'),
      left: $('#handleLeft'),
      right: $('#handleRight')
    },
    zoom: {
      in: $('#zoomInBtn'),
      out: $('#zoomOutBtn'),
      fit: $('#zoomFitBtn'),
      label: $('#zoomLabel')
    }
  },

  // 缩放设置
  lockAspect: $('#lockAspect'),
  uniformScaleField: $('#uniformScaleField'),
  separateScaleField: $('#separateScaleField'),
  scaleInputs: {
    percent: $('#scalePercent'),
    width: $('#scaleWidth'),
    height: $('#scaleHeight')
  },
  scaleSizePreview: $('#scaleSizePreview'),
  scalePreviewImg: $('#scalePreviewImage'),
  scalePlaceholder: $('#scalePreviewPlaceholder'),

  // 扩充设置
  expandInputs: {
    left: $('#expandLeft'),
    right: $('#expandRight'),
    top: $('#expandTop'),
    bottom: $('#expandBottom'),
    color: $('#expandColor'),
    alpha: $('#expandAlpha'),
    alphaVal: $('#expandAlphaVal')
  },

  expandSizePreview: $('#expandSizePreview'),

  // 输出设置
  outFormat: $('#outFormat'),
  jpegQualityField: $('#jpegQualityField'),
  jpegQuality: $('#jpegQuality')
};

// --- 4. 工具函数 ---

const utils = {
  clamp: (n, min, max) => Math.max(min, Math.min(max, n)),
  
  fmtSize: (w, h) => (w && h ? `${w} × ${h}` : '-'),
  
  mimeToExt: (mime) => (mime === CONFIG.MIME_TYPES.JPEG ? 'jpg' : 'png'),
  
  baseName: (name) => {
    const idx = name.lastIndexOf('.');
    return idx >= 0 ? name.slice(0, idx) : name;
  },
  
  safeInt: (v, fallback = 0) => {
    const n = parseInt(v);
    return isNaN(n) ? fallback : n;
  },
  
  safeNum: (v, fallback = 100) => {
    const n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  },

  escapeHtml: (s) => String(s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;'),

  async decodeImage(file) {
    if ('createImageBitmap' in window) {
      try {
        const bmp = await createImageBitmap(file);
        return { bmp, w: bmp.width, h: bmp.height };
      } catch (e) { /* fallback */ }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ img, w: img.naturalWidth, h: img.naturalHeight });
      };
      img.onerror = reject;
      img.src = url;
    });
  }
};

// --- 5. 核心计算逻辑 ---

const calculator = {
  getCropValues: () => ({
    top: Math.max(0, utils.safeInt(els.cropInputs.top.value)),
    bottom: Math.max(0, utils.safeInt(els.cropInputs.bottom.value)),
    left: Math.max(0, utils.safeInt(els.cropInputs.left.value)),
    right: Math.max(0, utils.safeInt(els.cropInputs.right.value))
  }),

  getCroppedSize(origW, origH) {
    const crop = this.getCropValues();
    return {
      w: Math.max(1, origW - crop.left - crop.right),
      h: Math.max(1, origH - crop.top - crop.bottom),
      crop
    };
  },

  getScaleValues: () => {
    if (els.lockAspect.checked) {
      const p = utils.safeNum(els.scaleInputs.percent.value) / 100;
      return { sw: p, sh: p };
    }
    return {
      sw: utils.safeNum(els.scaleInputs.width.value) / 100,
      sh: utils.safeNum(els.scaleInputs.height.value) / 100
    };
  },

  getScaledSize(croppedW, croppedH) {
    const { sw, sh } = this.getScaleValues();
    return {
      w: Math.max(1, Math.round(croppedW * sw)),
      h: Math.max(1, Math.round(croppedH * sh))
    };
  },

  getExpandValues: () => ({
    left: Math.max(0, utils.safeInt(els.expandInputs.left.value)),
    right: Math.max(0, utils.safeInt(els.expandInputs.right.value)),
    top: Math.max(0, utils.safeInt(els.expandInputs.top.value)),
    bottom: Math.max(0, utils.safeInt(els.expandInputs.bottom.value)),
    color: els.expandInputs.color.value,
    alpha: utils.safeInt(els.expandInputs.alpha.value) / 100
  }),


  getFinalSize(scaledW, scaledH) {
    const exp = this.getExpandValues();
    return {
      w: scaledW + exp.left + exp.right,
      h: scaledH + exp.top + exp.bottom,
      exp
    };
  }
};

// --- 6. UI 更新函数 ---

const ui = {
  setStatus: (msg) => { els.status.textContent = msg; },

  updateScaleUI() {
    const lock = els.lockAspect.checked;
    els.uniformScaleField.hidden = !lock;
    els.separateScaleField.hidden = lock;
  },

  updateOutputUI() {
    els.jpegQualityField.hidden = els.outFormat.value !== CONFIG.MIME_TYPES.JPEG;
  },

  renderTable(rows) {
    if (!rows.length) {
      els.tableBody.innerHTML = `<tr><td colspan="6" class="empty" data-i18n="waiting_upload">${window.i18n?.t('waiting_upload') || '等待上传图片...'}</td></tr>`;
      return;
    }
    els.tableBody.innerHTML = rows.map(r => `
      <tr>
        <td>${utils.escapeHtml(r.name)}</td>
        <td>${utils.fmtSize(r.origW, r.origH)}</td>
        <td>${utils.fmtSize(r.croppedW, r.croppedH)}</td>
        <td>${utils.fmtSize(r.scaledW, r.scaledH)}</td>
        <td>${utils.fmtSize(r.finalW, r.finalH)}</td>
        <td class="${r.statusType || ''}">${utils.escapeHtml(r.statusText || '')}</td>
      </tr>
    `).join('');
  },

  updateAllPreviews() {
    this.updateCropEditor();
    this.updateScalePreview();
  },

  updateCropEditor() {
    if (!state.baseImageInfo || !state.previewImageObj) {
      const label = window.i18n?.t('crop_size_label') || '裁切后：';
      els.cropSizeLabel.innerHTML = `<span data-i18n="crop_size_label">${label}</span>- × -`;
      els.editor.preview.style.display = 'none';
      els.editor.placeholder.style.display = 'block';
      this.toggleEditorControls(false);
      return;
    }

    const { w, h } = state.baseImageInfo;
    const { w: cw, h: ch, crop } = calculator.getCroppedSize(w, h);
    
    const label = window.i18n?.t('crop_size_label') || '裁切后：';
    if (crop.left + crop.right >= w || crop.top + crop.bottom >= h) {
      els.cropSizeLabel.textContent = window.i18n?.t('crop_invalid') || '裁切区域超出图片范围！';
      els.cropSizeLabel.style.color = 'var(--danger)';
    } else {
      els.cropSizeLabel.innerHTML = `<span data-i18n="crop_size_label">${label}</span>${cw} × ${ch}`;
      els.cropSizeLabel.style.color = '';
    }

    this.refreshEditorCanvas();
  },

  toggleEditorControls(show) {
    const display = show ? 'block' : 'none';
    Object.values(els.editor.overlays).forEach(el => el.style.display = display);
    Object.values(els.editor.handles).forEach(el => el.style.display = display);
  },

  refreshEditorCanvas() {
    if (!state.baseImageInfo) return;
    const { w, h } = state.baseImageInfo;
    const crop = calculator.getCropValues();
    const z = state.currentZoom;

    // 容器与预览图缩放
    const sw = w * z, sh = h * z;
    els.editor.preview.style.width = `${sw}px`;
    els.editor.preview.style.height = `${sh}px`;
    els.editor.inner.style.width = `${sw}px`;
    els.editor.inner.style.height = `${sh}px`;

    // 居中判断
    const wrap = els.editor.wrapper.getBoundingClientRect();
    els.editor.container.classList.toggle('centered', sw <= wrap.width && sh <= wrap.height);

    // 遮罩与手柄位置计算
    const { overlays, handles } = els.editor;
    const ct = crop.top * z, cb = crop.bottom * z, cl = crop.left * z, cr = crop.right * z;

    overlays.top.style.cssText = `top:0;left:0;width:${sw}px;height:${ct}px`;
    overlays.bottom.style.cssText = `bottom:0;left:0;width:${sw}px;height:${cb}px`;
    overlays.left.style.cssText = `top:${ct}px;left:0;width:${cl}px;height:${sh - ct - cb}px`;
    overlays.right.style.cssText = `top:${ct}px;right:0;width:${cr}px;height:${sh - ct - cb}px`;

    handles.top.style.cssText = `top:${ct}px;left:${cl}px;width:${sw - cl - cr}px`;
    handles.bottom.style.cssText = `top:${sh - cb}px;left:${cl}px;width:${sw - cl - cr}px`;
    handles.left.style.cssText = `left:${cl}px;top:${ct}px;height:${sh - ct - cb}px`;
    handles.right.style.cssText = `left:${sw - cr}px;top:${ct}px;height:${sh - ct - cb}px`;

    this.toggleEditorControls(true);
  },

  updateScalePreview() {
    if (!state.baseImageInfo) {
      els.scaleSizePreview.textContent = '-';
      els.expandSizePreview.textContent = '-';
      els.scalePreviewImg.style.display = 'none';
      els.scalePlaceholder.style.display = 'block';
      return;
    }

    const { w, h } = state.baseImageInfo;
    const { w: cw, h: ch, crop } = calculator.getCroppedSize(w, h);
    
    if (cw <= 0 || ch <= 0) {
      els.scaleSizePreview.textContent = window.i18n?.t('crop_invalid') || '裁切区域无效';
      return;
    }

    const { w: sw, h: sh } = calculator.getScaledSize(cw, ch);
    const { w: fw, h: fh, exp } = calculator.getFinalSize(sw, sh);
    const { sw: scaleW, sh: scaleH } = calculator.getScaleValues();

    const labelW = window.i18n?.t('table_width') || '宽';
    const labelH = window.i18n?.t('table_height') || '高';

    els.scaleSizePreview.textContent = els.lockAspect.checked
      ? `${cw}×${ch} → ${sw}×${sh} (${Math.round(scaleW * 100)}%)`
      : `${cw}×${ch} → ${sw}×${sh} (${labelW}${Math.round(scaleW * 100)}% ${labelH}${Math.round(scaleH * 100)}%)`;

    els.expandSizePreview.textContent = (exp.left + exp.right + exp.top + exp.bottom === 0)
      ? `${sw}×${sh}`
      : `${sw}×${sh} → ${fw}×${fh}`;

    this.drawFinalPreview(cw, ch, sw, sh, crop, exp);
  },

  drawFinalPreview(cw, ch, sw, sh, crop, exp) {
    if (!state.previewImageObj) return;
    
    const { w: fw, h: fh } = calculator.getFinalSize(sw, sh);
    const canvas = document.createElement('canvas');
    canvas.width = fw; canvas.height = fh;
    const ctx = canvas.getContext('2d');
    
    // 只填充扩充出来的区域
    if (exp.alpha > 0) {
      const r = parseInt(exp.color.slice(1, 3), 16);
      const g = parseInt(exp.color.slice(3, 5), 16);
      const b = parseInt(exp.color.slice(5, 7), 16);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${exp.alpha})`;
      
      // 上
      if (exp.top > 0) ctx.fillRect(0, 0, fw, exp.top);
      // 下
      if (exp.bottom > 0) ctx.fillRect(0, fh - exp.bottom, fw, exp.bottom);
      // 左
      if (exp.left > 0) ctx.fillRect(0, exp.top, exp.left, sh);
      // 右
      if (exp.right > 0) ctx.fillRect(fw - exp.right, exp.top, exp.right, sh);
    }

    // 绘制图片
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(state.previewImageObj, crop.left, crop.top, cw, ch, exp.left, exp.top, sw, sh);

    
    els.scalePreviewImg.src = canvas.toDataURL('image/png');
    els.scalePreviewImg.style.display = 'block';
    els.scalePlaceholder.style.display = 'none';
  }

};

// --- 7. 核心处理逻辑 ---

const processor = {
  async handleFiles(files) {
    state.selectedFiles = Array.from(files);
    state.fileInfoMap.clear();
    state.baseImageInfo = null;

    if (!state.selectedFiles.length) {
      ui.renderTable([]);
      ui.updateAllPreviews();
      return;
    }

    ui.setStatus(window.i18n?.t('status_parsing') || '解析图片中...');
    
    const infos = [];
    for (const file of state.selectedFiles) {
      try {
        const decoded = await utils.decodeImage(file);
        infos.push({ file, w: decoded.w, h: decoded.h });
        if (decoded.bmp?.close) decoded.bmp.close();
      } catch (e) {
        state.fileInfoMap.set(file, { valid: false });
      }
    }

    if (!infos.length) {
      ui.setStatus(window.i18n?.t('status_error_read') || '无法读取所选图片');
      return;
    }


    // 计算基准尺寸
    const skip = els.skipMismatch.checked;
    const baseW = skip ? infos[0].w : Math.min(...infos.map(i => i.w));
    const baseH = skip ? infos[0].h : Math.min(...infos.map(i => i.h));
    state.baseImageInfo = { w: baseW, h: baseH };

    // 更新状态图
    infos.forEach(info => {
      const isMismatch = info.w !== baseW || info.h !== baseH;
      state.fileInfoMap.set(info.file, {
        w: info.w, h: info.h,
        valid: !skip || !isMismatch,
        mismatch: isMismatch
      });
    });

    // 加载第一张图作为预览
    const firstValid = infos.find(i => i.file === state.selectedFiles[0]);
    if (firstValid) {
      const reader = new FileReader();
      reader.onload = (e) => {
        state.previewImageObj = new Image();
        state.previewImageObj.onload = () => {
          els.editor.preview.src = e.target.result;
          this.initEditor();
        };
        state.previewImageObj.src = e.target.result;
      };
      reader.readAsDataURL(firstValid.file);
    }

    this.refreshUIStatus(infos.length, baseW, baseH);
  },

  initEditor() {
    els.editor.preview.style.display = 'block';
    els.editor.placeholder.style.display = 'none';
    this.zoomFit();
    ui.updateAllPreviews();
  },

  refreshUIStatus(count, bw, bh) {
    els.imageCount.textContent = `${count} ${window.i18n?.t('unit_pcs') || '张'}`;
    els.imageSizeInfo.textContent = `${window.i18n?.t('base_size') || '基准尺寸'}：${bw}×${bh}`;
    
    const rows = state.selectedFiles.map(f => {
      const info = state.fileInfoMap.get(f);
      if (!info) return { name: f.name, statusText: window.i18n?.t('status_error_unknown') || '未知错误', statusType: 'bad' };
      if (!info.valid) return { name: f.name, origW: info.w, origH: info.h, statusText: window.i18n?.t('status_skipped') || '已跳过', statusType: 'bad' };
      
      return {
        name: f.name, origW: info.w, origH: info.h,
        statusText: info.mismatch ? (window.i18n?.t('status_auto_crop') || '将自动裁切后处理') : (window.i18n?.t('status_pending') || '待处理'),
        statusType: info.mismatch ? 'info' : ''
      };
    });
    ui.renderTable(rows);
    ui.setStatus(window.i18n?.t('status_ready') || '准备就绪');
  },

  zoomFit() {
    if (!state.baseImageInfo) return;
    const wrap = els.editor.wrapper.getBoundingClientRect();
    const pad = 40;
    const z = Math.min((wrap.width - pad) / state.baseImageInfo.w, (wrap.height - pad) / state.baseImageInfo.h, 1);
    this.setZoom(z);
  },

  setZoom(z) {
    state.currentZoom = utils.clamp(z, CONFIG.MIN_ZOOM, CONFIG.MAX_ZOOM);
    els.editor.zoom.label.textContent = `${Math.round(state.currentZoom * 100)}%`;
    ui.refreshEditorCanvas();
  },

  async processAll() {
    const validFiles = state.selectedFiles.filter(f => state.fileInfoMap.get(f)?.valid);
    if (!validFiles.length) return alert(window.i18n?.t('alert_no_images') || '没有可处理的图片');

    els.processBtn.disabled = true;
    ui.setStatus(window.i18n?.t('status_processing') || '处理中...');

    const zip = window.JSZip ? new JSZip() : null;
    const format = els.outFormat.value;
    const ext = utils.mimeToExt(format);

    const rows = [...els.tableBody.rows].map((row, idx) => {
        const file = state.selectedFiles[idx];
        const info = state.fileInfoMap.get(file);
        return { 
            name: file.name, 
            origW: info.w, 
            origH: info.h, 
            statusText: info.valid ? (window.i18n?.t('status_queuing') || '排队中') : (window.i18n?.t('status_skipped') || '已跳过'),
            statusType: info.valid ? '' : 'bad'
        };
    });

    let success = 0;
    for (let i = 0; i < state.selectedFiles.length; i++) {
      const file = state.selectedFiles[i];
      if (!state.fileInfoMap.get(file)?.valid) continue;

      rows[i].statusText = window.i18n?.t('status_ongoing') || '进行中...';
      ui.renderTable(rows);

      try {
        const result = await this.processOne(file);
        Object.assign(rows[i], result, { statusText: window.i18n?.t('status_done') || '完成', statusType: 'ok' });
        success++;

        const outName = `${utils.baseName(file.name)}_result.${ext}`;
        if (zip) zip.file(outName, result.blob);
        else this.downloadBlob(result.blob, outName);
      } catch (e) {
        rows[i].statusText = `${window.i18n?.t('status_failed') || '失败'}: ${e.message}`;
        rows[i].statusType = 'bad';
      }
      ui.renderTable(rows);
    }

    if (zip && success > 0) {
      ui.setStatus(window.i18n?.t('status_zipping') || '正在生成压缩包...');
      const content = await zip.generateAsync({ type: 'blob' });
      this.downloadBlob(content, `batch_process_${Date.now()}.zip`);
    }

    const endMsg = (window.i18n?.t('status_finished') || '处理结束：成功 {n} 张').replace('{n}', success);
    ui.setStatus(endMsg);
    els.processBtn.disabled = false;
  },

  async processOne(file) {
    const { bmp, img, w: ow, h: oh } = await utils.decodeImage(file);
    const source = bmp || img;
    const base = state.baseImageInfo;

    // 自动对齐基准尺寸（若不跳过不匹配）
    let cl = 0, ct = 0, cr = 0, cb = 0;
    if (!els.skipMismatch.checked && (ow !== base.w || oh !== base.h)) {
        cl = Math.floor(Math.max(0, ow - base.w) / 2);
        cr = ow - base.w - cl;
        ct = Math.floor(Math.max(0, oh - base.h) / 2);
        cb = oh - base.h - ct;
    } else {
        const crop = calculator.getCropValues();
        cl = crop.left; cr = crop.right; ct = crop.top; cb = crop.bottom;
    }

    const cw = ow - cl - cr, ch = oh - ct - cb;
    if (cw <= 0 || ch <= 0) throw new Error(window.i18n?.t('crop_invalid') || '裁切区域无效');


    // 1. 裁切
    const cCanvas = document.createElement('canvas');
    cCanvas.width = cw; cCanvas.height = ch;
    cCanvas.getContext('2d').drawImage(source, cl, ct, cw, ch, 0, 0, cw, ch);

    // 2. 缩放
    const { w: sw, h: sh } = calculator.getScaledSize(cw, ch);
    const sCanvas = document.createElement('canvas');
    sCanvas.width = sw; sCanvas.height = sh;
    const sCtx = sCanvas.getContext('2d');
    sCtx.imageSmoothingEnabled = true;
    sCtx.imageSmoothingQuality = 'high';
    sCtx.drawImage(cCanvas, 0, 0, cw, ch, 0, 0, sw, sh);

    // 3. 扩充
    const { w: fw, h: fh, exp } = calculator.getFinalSize(sw, sh);
    const fCanvas = document.createElement('canvas');
    fCanvas.width = fw; fCanvas.height = fh;
    const fCtx = fCanvas.getContext('2d');

    // 只填充扩充出来的区域
    if (exp.alpha > 0) {
        const r = parseInt(exp.color.slice(1, 3), 16);
        const g = parseInt(exp.color.slice(3, 5), 16);
        const b = parseInt(exp.color.slice(5, 7), 16);
        fCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${exp.alpha})`;
        
        // 分块填充以避开中心图像区域
        if (exp.top > 0) fCtx.fillRect(0, 0, fw, exp.top);
        if (exp.bottom > 0) fCtx.fillRect(0, fh - exp.bottom, fw, exp.bottom);
        if (exp.left > 0) fCtx.fillRect(0, exp.top, exp.left, sh);
        if (exp.right > 0) fCtx.fillRect(fw - exp.right, exp.top, exp.right, sh);
    }

    fCtx.drawImage(sCanvas, exp.left, exp.top);



    const blob = await new Promise(res => fCanvas.toBlob(res, els.outFormat.value, utils.safeNum(els.jpegQuality.value)));
    if (bmp?.close) bmp.close();

    return { blob, croppedW: cw, croppedH: ch, scaledW: sw, scaledH: sh, finalW: fw, finalH: fh };
  },

  downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
};

// --- 8. 事件处理 ---

const handlers = {
  onDragStart(e, handle) {
    e.preventDefault();
    state.isDragging = true;
    state.dragState = {
      handle,
      startX: e.clientX || e.touches?.[0].clientX,
      startY: e.clientY || e.touches?.[0].clientY,
      startValue: utils.safeInt(els.cropInputs[handle].value)
    };
    document.addEventListener('mousemove', this.onDragging);
    document.addEventListener('mouseup', this.onDragEnd);
    document.addEventListener('touchmove', this.onDragging);
    document.addEventListener('touchend', this.onDragEnd);
  },

  onDragging: (e) => {
    if (!state.isDragging || !state.baseImageInfo) return;
    const cx = e.clientX || e.touches?.[0].clientX;
    const cy = e.clientY || e.touches?.[0].clientY;
    const { handle, startX, startY, startValue } = state.dragState;
    const { w, h } = state.baseImageInfo;
    const z = state.currentZoom;

    let newVal;
    if (handle === 'top') {
        newVal = utils.clamp(startValue + Math.round((cy - startY) / z), 0, h - utils.safeInt(els.cropInputs.bottom.value) - 1);
    } else if (handle === 'bottom') {
        newVal = utils.clamp(startValue - Math.round((cy - startY) / z), 0, h - utils.safeInt(els.cropInputs.top.value) - 1);
    } else if (handle === 'left') {
        newVal = utils.clamp(startValue + Math.round((cx - startX) / z), 0, w - utils.safeInt(els.cropInputs.right.value) - 1);
    } else if (handle === 'right') {
        newVal = utils.clamp(startValue - Math.round((cx - startX) / z), 0, w - utils.safeInt(els.cropInputs.left.value) - 1);
    }
    
    els.cropInputs[handle].value = newVal;
    ui.updateAllPreviews();
  },

  onDragEnd: () => {
    state.isDragging = false;
    document.removeEventListener('mousemove', handlers.onDragging);
    document.removeEventListener('mouseup', handlers.onDragEnd);
    document.removeEventListener('touchmove', handlers.onDragging);
    document.removeEventListener('touchend', handlers.onDragEnd);
  }
};

// --- 9. 初始化与绑定 ---

function init() {
  // 文件上传
  els.fileInput.onchange = (e) => processor.handleFiles(e.target.files);
  els.dropZone.onclick = () => els.fileInput.click();
  els.dropZone.ondragover = (e) => { e.preventDefault(); els.dropZone.classList.add('dragover'); };
  els.dropZone.ondragleave = () => els.dropZone.classList.remove('dragover');
  els.dropZone.ondrop = (e) => {
    e.preventDefault();
    els.dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) processor.handleFiles(e.dataTransfer.files);
  };

  // 按钮
  els.clearBtn.onclick = () => window.location.reload();
  els.processBtn.onclick = () => processor.processAll();

  // 裁切手柄
  Object.entries(els.editor.handles).forEach(([k, el]) => {
    el.onmousedown = (e) => handlers.onDragStart(e, k);
    el.ontouchstart = (e) => handlers.onDragStart(e, k);
  });

  // 预览缩放
  els.editor.zoom.in.onclick = () => processor.setZoom(state.currentZoom + CONFIG.ZOOM_STEP);
  els.editor.zoom.out.onclick = () => processor.setZoom(state.currentZoom - CONFIG.ZOOM_STEP);
  els.editor.zoom.fit.onclick = () => processor.zoomFit();
  els.editor.wrapper.onwheel = (e) => {
    if (!state.baseImageInfo) return;
    e.preventDefault();
    processor.setZoom(state.currentZoom + (e.deltaY > 0 ? -CONFIG.ZOOM_STEP : CONFIG.ZOOM_STEP));
  };

  // 选项联动
  els.lockAspect.onchange = () => { ui.updateScaleUI(); ui.updateScalePreview(); };
  els.outFormat.onchange = () => ui.updateOutputUI();
  els.skipMismatch.onchange = () => processor.handleFiles(els.fileInput.files);

  // 输入实时预览
  [...Object.values(els.cropInputs), ...Object.values(els.scaleInputs), ...Object.values(els.expandInputs), els.jpegQuality].forEach(el => {
    el.oninput = () => {
      if (el === els.expandInputs.alpha) {
        els.expandInputs.alphaVal.textContent = el.value;
      }
      ui.updateAllPreviews();
    };
  });


  // 初始状态
  ui.updateScaleUI();
  ui.updateOutputUI();
  ui.renderTable([]);

  window.addEventListener('languageChanged', () => {
    ui.updateAllPreviews();
    processor.refreshUIStatus(state.selectedFiles.length, state.baseImageInfo?.w || 0, state.baseImageInfo?.h || 0);
  });
}

init();
