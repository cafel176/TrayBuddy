document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const videoInput = document.getElementById('video-input');
    const uploadSection = document.getElementById('upload-section');
    const editorSection = document.getElementById('editor-section');
    const videoPlayer = document.getElementById('video-player');
    const rangeSlider = document.getElementById('range-slider');
    const rangeFill = document.getElementById('range-fill');
    const handleStart = document.getElementById('handle-start');
    const handleEnd = document.getElementById('handle-end');
    const startTimeLabel = document.getElementById('start-time-label');
    const endTimeLabel = document.getElementById('end-time-label');
    const fpsInput = document.getElementById('fps-input');
    const totalFramesEstimate = document.getElementById('total-frames-estimate');
    const setStartBtn = document.getElementById('set-start-btn');
    const setEndBtn = document.getElementById('set-end-btn');
    const extractBtn = document.getElementById('extract-btn');
    const framesGrid = document.getElementById('frames-grid');
    const resultsCard = document.getElementById('results-card');
    const frameCountSpan = document.getElementById('frame-count');
    const selectAllBtn = document.getElementById('select-all');
    const deselectAllBtn = document.getElementById('deselect-all');
    const colorPreview = document.getElementById('color-preview');
    const colorHex = document.getElementById('color-hex');
    const openPickerBtn = document.getElementById('open-picker-btn');
    const toleranceInput = document.getElementById('tolerance-input');
    const featherInput = document.getElementById('feather-input');
    const spillInput = document.getElementById('spill-input');
    const applyChromaBtn = document.getElementById('apply-chroma');
    const resetBgBtn = document.getElementById('reset-bg');
    const exportBtn = document.getElementById('export-btn');
    const previewCard = document.getElementById('preview-card');
    const previewCanvas = document.getElementById('preview-canvas');
    const previewProgressBar = document.getElementById('preview-progress-bar');
    const previewInfo = document.getElementById('preview-info');
    const playModeSelect = document.getElementById('play-mode');
    const previewFpsInput = document.getElementById('preview-fps');
    const togglePlayBtn = document.getElementById('toggle-play');
    const resetBtn = document.getElementById('reset-btn');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    let videoFile = null;
    let duration = 0;
    let startTime = 0;
    let endTime = 0;
    let extractedFrames = []; // { originalData, processedData, selected: true }
    let previewInterval = null;
    let previewIndex = 0;
    let previewDirection = 1;

    const t = (key, params, fallback) => {
        if (window.i18n?.t) {
            const text = window.i18n.t(key, params);
            if (text && text !== key) return text;
        }
        return fallback ?? key;
    };

    function updatePreviewInfoText(current, total) {
        previewInfo.textContent = t('preview_info', { current, total });

        previewInfo.setAttribute('data-i18n-current', String(current));
        previewInfo.setAttribute('data-i18n-total', String(total));
    }


    // --- Initialization ---
    uploadSection.addEventListener('click', () => videoInput.click());
    uploadSection.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadSection.style.borderColor = 'var(--primary)';
    });
    uploadSection.addEventListener('dragleave', () => {
        uploadSection.style.borderColor = 'var(--border)';
    });
    uploadSection.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadSection.style.borderColor = 'var(--border)';
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });

    videoInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });

    function handleFile(file) {
        if (!file.type.startsWith('video/')) {
            alert(t('alert_upload_video'));
            return;
        }

        videoFile = file;
        const url = URL.createObjectURL(file);
        videoPlayer.src = url;
        
        videoPlayer.onloadedmetadata = () => {
            duration = videoPlayer.duration;
            endTime = duration;
            updateSliderUI();
            uploadSection.classList.add('hidden');
            editorSection.classList.remove('hidden');
            resetBtn.classList.remove('hidden');
        };
    }

    resetBtn.addEventListener('click', () => {
        location.reload();
    });

    // --- Range Slider Logic ---
    let activeHandle = null;

    function updateSliderUI() {
        const startPct = (startTime / duration) * 100;
        const endPct = (endTime / duration) * 100;
        
        handleStart.style.left = `${startPct}%`;
        handleEnd.style.left = `${endPct}%`;
        rangeFill.style.left = `${startPct}%`;
        rangeFill.style.width = `${endPct - startPct}%`;
        
        const startT = formatTime(startTime);
        const endT = formatTime(endTime);
        startTimeLabel.textContent = startT;
        endTimeLabel.textContent = endT;
        handleStart.setAttribute('data-time', startT);
        handleEnd.setAttribute('data-time', endT);
        updateFrameEstimate();
    }

    function updateFrameEstimate() {
        const fps = parseInt(fpsInput.value) || 0;
        const totalFrames = Math.floor((endTime - startTime) * fps);
        totalFramesEstimate.textContent = t('estimate_frames', { n: Math.max(0, totalFrames) });

    }

    fpsInput.addEventListener('input', updateFrameEstimate);

    setStartBtn.addEventListener('click', () => {
        startTime = videoPlayer.currentTime;
        if (startTime >= endTime) endTime = Math.min(duration, startTime + 0.1);
        updateSliderUI();
    });

    setEndBtn.addEventListener('click', () => {
        endTime = videoPlayer.currentTime;
        if (endTime <= startTime) startTime = Math.max(0, endTime - 0.1);
        updateSliderUI();
    });

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 100);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    }

    function handleMouseMove(e) {
        if (!activeHandle) return;
        const rect = rangeSlider.getBoundingClientRect();
        let pct = (e.clientX - rect.left) / rect.width;
        pct = Math.max(0, Math.min(1, pct));
        const time = pct * duration;

        if (activeHandle === handleStart) {
            startTime = Math.min(time, endTime - 0.1);
        } else {
            endTime = Math.max(time, startTime + 0.1);
        }
        updateSliderUI();
    }

    handleStart.addEventListener('mousedown', () => activeHandle = handleStart);
    handleEnd.addEventListener('mousedown', () => activeHandle = handleEnd);
    window.addEventListener('mouseup', () => activeHandle = null);
    window.addEventListener('mousemove', handleMouseMove);

    // --- Frame Extraction ---
    extractBtn.addEventListener('click', async () => {
        const fps = parseInt(fpsInput.value);
        const interval = 1 / fps;
        const totalFrames = Math.floor((endTime - startTime) / interval);
        
        if (totalFrames > 500) {
            const confirmMsg = t('confirm_many_frames', { n: totalFrames });
            if (!confirm(confirmMsg)) return;
        }


        loadingOverlay.classList.remove('hidden');
        extractedFrames = [];
        framesGrid.innerHTML = '';
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = videoPlayer.videoWidth;
        canvas.height = videoPlayer.videoHeight;




        for (let time = startTime; time <= endTime; time += interval) {
            loadingText.textContent = t('extracting', { n: Math.round(((time - startTime) / (endTime - startTime)) * 100) });

            videoPlayer.currentTime = time;
            await new Promise(resolve => {
                videoPlayer.onseeked = resolve;
            });
            ctx.drawImage(videoPlayer, 0, 0);
            const dataUrl = canvas.toDataURL('image/png');
            extractedFrames.push({
                originalData: dataUrl,
                processedData: dataUrl,
                selected: true
            });
        }

        renderFrames();
        loadingOverlay.classList.add('hidden');
        resultsCard.classList.remove('hidden');
        previewCard.classList.remove('hidden');
        initPreview();
    });

    function renderFrames() {
        framesGrid.innerHTML = '';
        const videoRatio = videoPlayer.videoWidth / videoPlayer.videoHeight;
        
        extractedFrames.forEach((frame, index) => {
            const div = document.createElement('div');
            div.className = `frame-item ${frame.selected ? 'selected' : ''}`;
            // 动态设置 aspect-ratio 确保容器比例与视频一致
            div.style.aspectRatio = videoRatio;

            div.innerHTML = `
                <img src="${frame.processedData}">
                <button class="frame-preview-btn" title="${t('view_high_res')}">


                    <i data-lucide="maximize-2" style="width:14px;height:14px;"></i>
                </button>
                <input type="checkbox" class="frame-checkbox" ${frame.selected ? 'checked' : ''}>
            `;



            // High Res Preview logic
            div.querySelector('.frame-preview-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                showHighRes(frame.processedData);
            });

            div.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT' && !e.target.closest('.frame-preview-btn')) {
                    frame.selected = !frame.selected;
                    renderFrames();
                    updatePreview();
                }
            });
            const checkbox = div.querySelector('input');
            checkbox.addEventListener('change', () => {
                frame.selected = checkbox.checked;
                div.classList.toggle('selected', frame.selected);
                updatePreview();
            });
            framesGrid.appendChild(div);
        });
        lucide.createIcons(); // Refresh icons
        frameCountSpan.textContent = extractedFrames.length;
    }

    function showHighRes(dataUrl) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-close" aria-label="${t('close')}">×</div>
            <img src="${dataUrl}">
        `;

        modal.onclick = () => modal.remove();
        document.body.appendChild(modal);

    }

    selectAllBtn.addEventListener('click', () => {
        extractedFrames.forEach(f => f.selected = true);
        renderFrames();
        updatePreview();
    });

    deselectAllBtn.addEventListener('click', () => {
        extractedFrames.forEach(f => f.selected = !f.selected);
        renderFrames();
        updatePreview();
    });

    // --- Color Picker Logic ---
    openPickerBtn.addEventListener('click', () => {
        if (extractedFrames.length === 0) return;
        showColorPicker(extractedFrames[0].originalData);
    });

    function showColorPicker(dataUrl) {
        const overlay = document.createElement('div');
        overlay.className = 'color-picker-overlay';
        overlay.innerHTML = `
            <h3 style="margin-bottom: 1rem;" data-i18n="picker_title">${t('picker_title')}</h3>

            <div class="picker-canvas-container">
                <canvas id="picker-canvas"></canvas>
            </div>
            <div class="picker-toolbar">
                <div id="picker-preview" style="width: 40px; height: 40px; border: 2px solid white; border-radius: 4px;"></div>
                <span id="picker-hex" style="font-family: monospace; font-size: 1.2rem;">#000000</span>
                <button id="picker-confirm" data-i18n="picker_confirm">${t('picker_confirm')}</button>
                <button id="picker-cancel" class="secondary" data-i18n="picker_cancel">${t('picker_cancel')}</button>
            </div>

        `;
        document.body.appendChild(overlay);
        if (window.i18n?.updateDOM) window.i18n.updateDOM();

        const canvas = document.getElementById('picker-canvas');

        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.src = dataUrl;
        img.onload = () => {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            ctx.drawImage(img, 0, 0);
        };

        let selectedHex = '#000000';

        canvas.addEventListener('mousedown', (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = Math.floor(((e.clientX - rect.left) / rect.width) * canvas.width);
            const y = Math.floor(((e.clientY - rect.top) / rect.height) * canvas.height);
            const pixel = ctx.getImageData(x, y, 1, 1).data;
            selectedHex = rgbToHex(pixel[0], pixel[1], pixel[2]);
            document.getElementById('picker-preview').style.background = selectedHex;
            document.getElementById('picker-hex').textContent = selectedHex;
        });

        document.getElementById('picker-confirm').onclick = () => {
            colorHex.value = selectedHex;
            colorPreview.style.background = selectedHex;
            overlay.remove();
        };
        document.getElementById('picker-cancel').onclick = () => overlay.remove();
    }

    // --- Chroma Keying ---
    // Remove old mousedown picker
    // (We'll just leave it or replace it if needed, but the new one is better)


    function rgbToHex(r, g, b) {
        return "#" + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    }

    function hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    function rgbToHsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, v = max;
        const d = max - min;
        s = max === 0 ? 0 : d / max;
        if (max === min) {
            h = 0;
        } else {
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return { h, s, v };
    }

    applyChromaBtn.addEventListener('click', () => {
        const targetHex = colorHex.value;
        const targetRgb = hexToRgb(targetHex);
        if (!targetRgb) {
            alert(t('alert_no_color'));

            return;
        }

        
        const targetHsv = rgbToHsv(targetRgb.r, targetRgb.g, targetRgb.b);
        const tolerance = (parseInt(toleranceInput.value) || 0) / 100;
        const feather = (parseInt(featherInput.value) || 0) / 100;
        const spill = (parseInt(spillInput.value) || 0) / 100;

        loadingOverlay.classList.remove('hidden');
        loadingText.textContent = t('processing_bg');




        const videoWidth = videoPlayer.videoWidth;
        const videoHeight = videoPlayer.videoHeight;
        let processedCount = 0;

        // 使用 Promise.all 确保所有异步处理完成
        const processPromises = extractedFrames.map((frame, index) => {
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    canvas.width = videoWidth;
                    canvas.height = videoHeight;
                    ctx.drawImage(img, 0, 0);
                    
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const data = imageData.data;
                    
                    for (let i = 0; i < data.length; i += 4) {
                        const r = data[i], g = data[i+1], b = data[i+2];
                        const hsv = rgbToHsv(r, g, b);
                        
                        let dh = Math.abs(hsv.h - targetHsv.h);
                        if (dh > 0.5) dh = 1 - dh;
                        const ds = Math.abs(hsv.s - targetHsv.s);
                        const dv = Math.abs(hsv.v - targetHsv.v);
                        
                        const distance = Math.sqrt(Math.pow(dh * 2.0, 2) + Math.pow(ds * 0.5, 2) + Math.pow(dv * 0.2, 2));
                        
                        if (distance < tolerance) {
                            const innerBoundary = tolerance * (1 - feather);
                            if (distance > innerBoundary && feather > 0) {
                                const alpha = (distance - innerBoundary) / (tolerance - innerBoundary);
                                data[i+3] = Math.floor(255 * alpha);
                            } else {
                                data[i+3] = 0;
                            }
                        }

                        if (data[i+3] > 0 && distance < tolerance * 1.5 && spill > 0) {
                            const spillFactor = Math.max(0, 1 - (distance / (tolerance * 1.5))) * spill;
                            const gray = (r + g + b) / 3;
                            data[i] = r * (1 - spillFactor) + gray * spillFactor;
                            data[i+1] = g * (1 - spillFactor) + gray * spillFactor;
                            data[i+2] = b * (1 - spillFactor) + gray * spillFactor;
                        }
                    }
                    
                    ctx.putImageData(imageData, 0, 0);
                    frame.processedData = canvas.toDataURL('image/png');
                    resolve();
                };
                img.onerror = resolve; // 防止单张失败导致卡死
                img.src = frame.originalData;
            });
        });

        Promise.all(processPromises).then(() => {
            renderFrames();
            updatePreview();
            loadingOverlay.classList.add('hidden');
            console.log(t('processing_bg_done_log'));

        });

    });






    resetBgBtn.addEventListener('click', () => {
        extractedFrames.forEach(f => f.processedData = f.originalData);
        renderFrames();
        updatePreview();
    });

    // --- Preview Carousel ---
    let isDraggingProgress = false;

    function initPreview() {
        previewCanvas.width = videoPlayer.videoWidth;
        previewCanvas.height = videoPlayer.videoHeight;
        startPreview();
    }

    const progressContainer = document.querySelector('.preview-progress-container');
    progressContainer.addEventListener('mousedown', (e) => {
        isDraggingProgress = true;
        handleProgressClick(e);
    });

    window.addEventListener('mousemove', (e) => {
        if (isDraggingProgress) handleProgressClick(e);
    });

    window.addEventListener('mouseup', () => {
        isDraggingProgress = false;
    });

    function handleProgressClick(e) {
        const selectedFrames = extractedFrames.filter(f => f.selected);
        if (selectedFrames.length === 0) return;

        const rect = progressContainer.getBoundingClientRect();
        let pct = (e.clientX - rect.left) / rect.width;
        pct = Math.max(0, Math.min(1, pct));
        
        previewIndex = Math.min(selectedFrames.length - 1, Math.floor(pct * selectedFrames.length));
        
        // If not playing, update frame once
        if (!previewInterval) {
            const ctx = previewCanvas.getContext('2d');
            const img = new Image();
            img.src = selectedFrames[previewIndex].processedData;
            img.onload = () => {
                ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
                ctx.drawImage(img, 0, 0);
                updatePreviewInfoText(previewIndex + 1, selectedFrames.length);

                previewProgressBar.style.width = `${((previewIndex + 1) / selectedFrames.length) * 100}%`;
            };
        }
    }


    function startPreview() {
        if (previewInterval) clearInterval(previewInterval);
        const fps = parseInt(previewFpsInput.value);
        previewInterval = setInterval(tickPreview, 1000 / fps);
    }

    function tickPreview() {
        const selectedFrames = extractedFrames.filter(f => f.selected);
        if (selectedFrames.length === 0) {
            updatePreviewInfoText(0, 0);
            previewProgressBar.style.width = `0%`;
            return;
        }


        const ctx = previewCanvas.getContext('2d');
        const img = new Image();
        img.src = selectedFrames[previewIndex].processedData;
        img.onload = () => {
            ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
            ctx.drawImage(img, 0, 0);
        };

        // Update progress UI
        updatePreviewInfoText(previewIndex + 1, selectedFrames.length);
        previewProgressBar.style.width = `${((previewIndex + 1) / selectedFrames.length) * 100}%`;


        const mode = playModeSelect.value;
        if (mode === 'forward') {
            previewIndex = (previewIndex + 1) % selectedFrames.length;
        } else if (mode === 'backward') {
            previewIndex = (previewIndex - 1 + selectedFrames.length) % selectedFrames.length;
        } else if (mode === 'pingpong') {
            previewIndex += previewDirection;
            if (previewIndex >= selectedFrames.length - 1 || previewIndex <= 0) {
                previewDirection *= -1;
            }
        }
    }

    function updatePreview() {
        previewIndex = 0;
        previewDirection = 1;
    }

    togglePlayBtn.addEventListener('click', () => {
        if (previewInterval) {
            clearInterval(previewInterval);
            previewInterval = null;
            togglePlayBtn.textContent = t('play');
        } else {
            startPreview();
            togglePlayBtn.textContent = t('pause');
        }


    });

    previewFpsInput.addEventListener('change', startPreview);

    // --- Export ---
    exportBtn.addEventListener('click', async () => {
        const selectedFrames = extractedFrames.filter(f => f.selected);
        if (selectedFrames.length === 0) {
            alert(t('alert_no_frames'));
            return;
        }

        loadingOverlay.classList.remove('hidden');
        loadingText.textContent = t('packing');



        const zip = new JSZip();
        selectedFrames.forEach((frame, index) => {
            const base64Data = frame.processedData.split(',')[1];
            zip.file(`frame_${index.toString().padStart(4, '0')}.png`, base64Data, {base64: true});
        });

        const content = await zip.generateAsync({type: 'blob'});
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sequence_${Date.now()}.zip`;
        a.click();
        
        loadingOverlay.classList.add('hidden');
    });

    window.addEventListener('languageChanged', () => {
        updateFrameEstimate();
        // If results card is visible, refresh it
        if (!resultsCard.classList.contains('hidden')) {
            renderFrames();
        }
        
        // Update preview info text if it's visible
        if (!previewCard.classList.contains('hidden')) {
            const selectedFrames = extractedFrames.filter(f => f.selected);
            const current = selectedFrames.length > 0 ? previewIndex + 1 : 0;
            updatePreviewInfoText(current, selectedFrames.length);
        }

        // Update play/pause button text
        if (previewInterval) {
            togglePlayBtn.textContent = t('pause');
        } else {
            togglePlayBtn.textContent = t('play');
        }


    });
});
