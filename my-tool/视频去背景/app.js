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
    const setStartBtn = document.getElementById('set-start-btn');
    const setEndBtn = document.getElementById('set-end-btn');
    const resetBtn = document.getElementById('reset-btn');
    
    // Video info display elements
    const videoFpsDisplay = document.getElementById('video-fps-display');
    const videoDurationDisplay = document.getElementById('video-duration-display');
    const videoResolutionDisplay = document.getElementById('video-resolution-display');
    
    // Mode selector elements
    const modeChromaBtn = document.getElementById('mode-chroma');
    const modeWandBtn = document.getElementById('mode-wand');
    const chromaSettings = document.getElementById('chroma-settings');
    const wandSettings = document.getElementById('wand-settings');
    const previewLeftTitle = document.getElementById('preview-left-title');
    
    // Color picker elements (Chroma mode)
    const colorPreview = document.getElementById('color-preview');
    const colorHex = document.getElementById('color-hex');
    const toleranceInput = document.getElementById('tolerance-input');
    const toleranceValue = document.getElementById('tolerance-value');
    const featherInput = document.getElementById('feather-input');
    const featherValue = document.getElementById('feather-value');
    const spillInput = document.getElementById('spill-input');
    const spillValue = document.getElementById('spill-value');
    
    // Wand mode elements
    const wandToleranceInput = document.getElementById('wand-tolerance-input');
    const wandToleranceValue = document.getElementById('wand-tolerance-value');
    const wandFeatherInput = document.getElementById('wand-feather-input');
    const wandFeatherValue = document.getElementById('wand-feather-value');
    const wandContiguous = document.getElementById('wand-contiguous');
    const wandClearBtn = document.getElementById('wand-clear-btn');
    const wandSelectionCount = document.getElementById('wand-selection-count');
    
    // Per-frame wand mode elements
    const modePerframeBtn = document.getElementById('mode-perframe');
    const perframeSettings = document.getElementById('perframe-settings');
    const perframeFirstBtn = document.getElementById('perframe-first-btn');
    const perframePrevBtn = document.getElementById('perframe-prev-btn');
    const perframeNextBtn = document.getElementById('perframe-next-btn');
    const perframeLastBtn = document.getElementById('perframe-last-btn');
    const perframeCurrentInput = document.getElementById('perframe-current');
    const perframeTotalSpan = document.getElementById('perframe-total');
    const timelineTrack = document.getElementById('timeline-track');
    const perframeToleranceInput = document.getElementById('perframe-tolerance-input');
    const perframeToleranceValue = document.getElementById('perframe-tolerance-value');
    const perframeFeatherInput = document.getElementById('perframe-feather-input');
    const perframeFeatherValue = document.getElementById('perframe-feather-value');
    const perframeContiguous = document.getElementById('perframe-contiguous');
    const perframeClearBtn = document.getElementById('perframe-clear-btn');
    const perframeSelectionCount = document.getElementById('perframe-selection-count');
    const perframeCopyToAllBtn = document.getElementById('perframe-copy-to-all-btn');
    const perframeCopyToRangeBtn = document.getElementById('perframe-copy-to-range-btn');
    const perframeClearAllBtn = document.getElementById('perframe-clear-all-btn');
    const copyRangePanel = document.getElementById('copy-range-panel');
    const copyRangeStart = document.getElementById('copy-range-start');
    const copyRangeEnd = document.getElementById('copy-range-end');
    const copyRangeConfirmBtn = document.getElementById('copy-range-confirm-btn');
    const copyRangeCancelBtn = document.getElementById('copy-range-cancel-btn');
    const perframeExtractProgress = document.getElementById('perframe-extract-progress');
    const perframeExtractText = document.getElementById('perframe-extract-text');
    const perframeExtractPercent = document.getElementById('perframe-extract-percent');
    const perframeExtractBar = document.getElementById('perframe-extract-bar');
    
    // Preview canvases
    const firstFrameCanvas = document.getElementById('first-frame-canvas');
    const previewCanvas = document.getElementById('preview-canvas');
    
    // Output elements
    const outputFormat = document.getElementById('output-format');
    const videoQuality = document.getElementById('video-quality');
    const processBtn = document.getElementById('process-btn');
    
    // Loading elements
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');

    let videoFile = null;
    let duration = 0;
    let startTime = 0;
    let endTime = 0;
    let firstFrameImageData = null;
    let previewDebounceTimer = null;
    
    // Video metadata
    let detectedFps = 30; // Default fallback
    let videoWidth = 0;
    let videoHeight = 0;
    
    // Current mode: 'chroma' or 'wand' or 'perframe'
    let currentMode = 'chroma';
    
    // Wand mode state
    let wandMask = null; // Uint8Array storing alpha mask (0 = remove, 255 = keep)
    let wandSelectionPoints = []; // Array of {x, y} click points
    
    // Per-frame wand mode state
    let perframeData = {
        frames: [],           // Array of ImageData for each frame
        frameCount: 0,        // Total number of frames
        currentFrameIndex: 0, // Current frame being edited (0-indexed)
        selectionsByFrame: {},// Map: frameIndex -> [{x, y}, ...] selection points
        extractionDone: false // Whether frames have been extracted
    };

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
            alert(window.i18n?.t('alert_upload_video') || '请上传视频文件');
            return;
        }
        videoFile = file;
        const url = URL.createObjectURL(file);
        videoPlayer.src = url;
        
        videoPlayer.onloadedmetadata = () => {
            duration = videoPlayer.duration;
            endTime = duration;
            videoWidth = videoPlayer.videoWidth;
            videoHeight = videoPlayer.videoHeight;
            
            // Detect FPS using requestVideoFrameCallback if available
            detectVideoFps().then(fps => {
                detectedFps = fps;
                updateVideoInfoDisplay();
            });
            
            updateSliderUI();
            uploadSection.classList.add('hidden');
            editorSection.classList.remove('hidden');
            resetBtn.classList.remove('hidden');
            
            // Capture first frame after video is ready
            videoPlayer.currentTime = 0;
        };

        videoPlayer.onseeked = () => {
            if (!firstFrameImageData) {
                captureFirstFrame();
            }
        };
    }

    // Detect video FPS using requestVideoFrameCallback
    async function detectVideoFps() {
        return new Promise((resolve) => {
            // Method 1: Try using requestVideoFrameCallback (most accurate for actual playback FPS)
            if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
                const testVideo = document.createElement('video');
                testVideo.src = videoPlayer.src;
                testVideo.muted = true;
                testVideo.playsInline = true;
                
                let frameCount = 0;
                let startMediaTime = 0;
                let resolved = false;
                
                const countFrames = (now, metadata) => {
                    if (resolved) return;
                    
                    frameCount++;
                    if (frameCount === 1) {
                        startMediaTime = metadata.mediaTime;
                    } else if (frameCount >= 61) { // Sample more frames for accuracy
                        const timeDiff = metadata.mediaTime - startMediaTime;
                        if (timeDiff > 0) {
                            const fps = (frameCount - 1) / timeDiff;
                            // Round to common frame rates
                            const commonFps = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
                            let closestFps = fps;
                            let minDiff = Infinity;
                            for (const cf of commonFps) {
                                const diff = Math.abs(fps - cf);
                                if (diff < minDiff) {
                                    minDiff = diff;
                                    closestFps = cf;
                                }
                            }
                            // Use closest common FPS if within 1% tolerance
                            const finalFps = (minDiff / closestFps < 0.01) ? closestFps : Math.round(fps * 100) / 100;
                            
                            resolved = true;
                            testVideo.pause();
                            testVideo.src = '';
                            testVideo.remove();
                            console.log(`Detected FPS: ${finalFps} (raw: ${fps.toFixed(3)})`);
                            resolve(Math.min(Math.max(finalFps, 1), 120));
                        }
                        return;
                    }
                    testVideo.requestVideoFrameCallback(countFrames);
                };
                
                testVideo.requestVideoFrameCallback(countFrames);
                testVideo.play().catch(() => {
                    if (!resolved) {
                        resolved = true;
                        testVideo.src = '';
                        testVideo.remove();
                        resolve(30);
                    }
                });
                
                // Timeout fallback
                setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        // Calculate from what we have
                        if (frameCount > 1) {
                            const fps = Math.round(frameCount / 2); // Rough estimate from 2 seconds
                            resolve(Math.min(Math.max(fps, 1), 120));
                        } else {
                            resolve(30);
                        }
                        testVideo.pause();
                        testVideo.src = '';
                        testVideo.remove();
                    }
                }, 3000);
            } else {
                // Fallback: Common FPS values
                resolve(30);
            }
        });
    }

    function updateVideoInfoDisplay() {
        // Format FPS nicely (show decimal for non-integer frame rates)
        const fpsStr = Number.isInteger(detectedFps) ? detectedFps.toString() : detectedFps.toFixed(2);
        videoFpsDisplay.textContent = fpsStr;
        videoDurationDisplay.textContent = formatTime(duration);
        videoResolutionDisplay.textContent = `${videoWidth}×${videoHeight}`;
    }

    function captureFirstFrame() {
        const canvas = firstFrameCanvas;
        const ctx = canvas.getContext('2d');
        canvas.width = videoPlayer.videoWidth;
        canvas.height = videoPlayer.videoHeight;
        ctx.drawImage(videoPlayer, 0, 0);
        firstFrameImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        // Initialize wand mask
        wandMask = new Uint8Array(canvas.width * canvas.height).fill(255);
        
        // Also init preview canvas
        previewCanvas.width = videoPlayer.videoWidth;
        previewCanvas.height = videoPlayer.videoHeight;
        updatePreview();
    }

    resetBtn.addEventListener('click', () => {
        location.reload();
    });

    // --- Mode Selection ---
    modeChromaBtn.addEventListener('click', () => switchMode('chroma'));
    modeWandBtn.addEventListener('click', () => switchMode('wand'));
    modePerframeBtn.addEventListener('click', () => switchMode('perframe'));

    function switchMode(mode) {
        currentMode = mode;
        
        // Update button states
        modeChromaBtn.classList.toggle('active', mode === 'chroma');
        modeWandBtn.classList.toggle('active', mode === 'wand');
        modePerframeBtn.classList.toggle('active', mode === 'perframe');
        
        // Show/hide settings
        chromaSettings.classList.toggle('hidden', mode !== 'chroma');
        wandSettings.classList.toggle('hidden', mode !== 'wand');
        perframeSettings.classList.toggle('hidden', mode !== 'perframe');
        
        // Update preview title
        if (mode === 'chroma') {
            previewLeftTitle.setAttribute('data-i18n', 'preview_first_frame');
            previewLeftTitle.textContent = window.i18n?.t('preview_first_frame') || '首帧预览 (点击拾取颜色)';
        } else if (mode === 'wand') {
            previewLeftTitle.setAttribute('data-i18n', 'preview_wand_frame');
            previewLeftTitle.textContent = window.i18n?.t('preview_wand_frame') || '首帧预览 (点击选择区域)';
        } else {
            previewLeftTitle.setAttribute('data-i18n', 'preview_perframe');
            previewLeftTitle.textContent = window.i18n?.t('preview_perframe') || '当前帧预览 (点击选择区域)';
        }
        
        // Re-render icons
        if (window.lucide) lucide.createIcons();
        
        // If switching to perframe mode, initialize it
        if (mode === 'perframe' && !perframeData.extractionDone && videoFile) {
            initPerframeMode();
        }
        
        updatePreview();
    }

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
    }

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

    // --- Canvas Click Logic ---
    firstFrameCanvas.addEventListener('click', (e) => {
        if (!firstFrameImageData && currentMode !== 'perframe') return;
        if (currentMode === 'perframe' && !perframeData.extractionDone) return;
        
        const rect = firstFrameCanvas.getBoundingClientRect();
        const scaleX = firstFrameCanvas.width / rect.width;
        const scaleY = firstFrameCanvas.height / rect.height;
        const x = Math.floor((e.clientX - rect.left) * scaleX);
        const y = Math.floor((e.clientY - rect.top) * scaleY);
        
        if (currentMode === 'chroma') {
            // Chroma mode: pick color
            const ctx = firstFrameCanvas.getContext('2d');
            const pixel = ctx.getImageData(x, y, 1, 1).data;
            const hex = rgbToHex(pixel[0], pixel[1], pixel[2]);
            
            colorHex.value = hex;
            colorPreview.style.background = hex;
            updatePreview();
        } else if (currentMode === 'wand') {
            // Wand mode: flood fill selection
            addWandSelection(x, y);
        } else if (currentMode === 'perframe') {
            // Per-frame mode: add selection to current frame
            addPerframeSelection(x, y);
        }
    });

    colorHex.addEventListener('input', () => {
        const hex = colorHex.value;
        if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
            colorPreview.style.background = hex;
            debouncedUpdatePreview();
        }
    });

    // Slider value displays - Chroma mode
    toleranceInput.addEventListener('input', () => {
        toleranceValue.textContent = toleranceInput.value;
        debouncedUpdatePreview();
    });

    featherInput.addEventListener('input', () => {
        featherValue.textContent = featherInput.value;
        debouncedUpdatePreview();
    });

    spillInput.addEventListener('input', () => {
        spillValue.textContent = spillInput.value;
        debouncedUpdatePreview();
    });

    // Slider value displays - Wand mode
    wandToleranceInput.addEventListener('input', () => {
        wandToleranceValue.textContent = wandToleranceInput.value;
        // Recalculate wand mask with new tolerance
        recalculateWandMask();
    });

    wandFeatherInput.addEventListener('input', () => {
        wandFeatherValue.textContent = wandFeatherInput.value;
        debouncedUpdatePreview();
    });

    wandContiguous.addEventListener('change', () => {
        recalculateWandMask();
    });

    wandClearBtn.addEventListener('click', () => {
        clearWandSelection();
    });

    function debouncedUpdatePreview() {
        clearTimeout(previewDebounceTimer);
        previewDebounceTimer = setTimeout(updatePreview, 100);
    }

    // --- Color Conversion Functions ---
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

    // --- Magic Wand Algorithm ---
    function addWandSelection(x, y) {
        if (!firstFrameImageData || !wandMask) return;
        
        wandSelectionPoints.push({ x, y });
        
        const tolerance = parseInt(wandToleranceInput.value);
        const contiguous = wandContiguous.checked;
        const width = firstFrameImageData.width;
        const height = firstFrameImageData.height;
        const data = firstFrameImageData.data;
        
        // Get seed color
        const seedIdx = (y * width + x) * 4;
        const seedR = data[seedIdx];
        const seedG = data[seedIdx + 1];
        const seedB = data[seedIdx + 2];
        
        if (contiguous) {
            // Flood fill algorithm (similar to PS magic wand with contiguous)
            floodFillSelection(x, y, seedR, seedG, seedB, tolerance);
        } else {
            // Select all similar colors globally
            globalColorSelection(seedR, seedG, seedB, tolerance);
        }
        
        updateSelectionCount();
        updatePreview();
    }

    function floodFillSelection(startX, startY, seedR, seedG, seedB, tolerance) {
        const width = firstFrameImageData.width;
        const height = firstFrameImageData.height;
        const data = firstFrameImageData.data;
        
        const visited = new Uint8Array(width * height);
        const stack = [[startX, startY]];
        const toleranceSq = tolerance * tolerance;
        
        while (stack.length > 0) {
            const [x, y] = stack.pop();
            
            if (x < 0 || x >= width || y < 0 || y >= height) continue;
            
            const idx = y * width + x;
            if (visited[idx]) continue;
            visited[idx] = 1;
            
            const pixelIdx = idx * 4;
            const r = data[pixelIdx];
            const g = data[pixelIdx + 1];
            const b = data[pixelIdx + 2];
            
            // Calculate color distance
            const dr = r - seedR;
            const dg = g - seedG;
            const db = b - seedB;
            const distSq = dr * dr + dg * dg + db * db;
            
            if (distSq <= toleranceSq * 3) { // *3 because we have 3 color channels
                wandMask[idx] = 0; // Mark for removal
                
                // Add neighbors (4-connected)
                stack.push([x + 1, y]);
                stack.push([x - 1, y]);
                stack.push([x, y + 1]);
                stack.push([x, y - 1]);
            }
        }
    }

    function globalColorSelection(seedR, seedG, seedB, tolerance) {
        const width = firstFrameImageData.width;
        const height = firstFrameImageData.height;
        const data = firstFrameImageData.data;
        const toleranceSq = tolerance * tolerance;
        
        for (let i = 0; i < width * height; i++) {
            const pixelIdx = i * 4;
            const r = data[pixelIdx];
            const g = data[pixelIdx + 1];
            const b = data[pixelIdx + 2];
            
            const dr = r - seedR;
            const dg = g - seedG;
            const db = b - seedB;
            const distSq = dr * dr + dg * dg + db * db;
            
            if (distSq <= toleranceSq * 3) {
                wandMask[i] = 0;
            }
        }
    }

    function recalculateWandMask() {
        if (!firstFrameImageData || wandSelectionPoints.length === 0) return;
        
        // Reset mask
        wandMask.fill(255);
        
        const tolerance = parseInt(wandToleranceInput.value);
        const contiguous = wandContiguous.checked;
        const width = firstFrameImageData.width;
        const data = firstFrameImageData.data;
        
        // Reapply all selection points
        for (const point of wandSelectionPoints) {
            const seedIdx = (point.y * width + point.x) * 4;
            const seedR = data[seedIdx];
            const seedG = data[seedIdx + 1];
            const seedB = data[seedIdx + 2];
            
            if (contiguous) {
                floodFillSelection(point.x, point.y, seedR, seedG, seedB, tolerance);
            } else {
                globalColorSelection(seedR, seedG, seedB, tolerance);
            }
        }
        
        updatePreview();
    }
    
    // --- Per-Frame Wand Selection ---
    function addPerframeSelection(x, y) {
        if (!perframeData.extractionDone) return;
        
        const frameIndex = perframeData.currentFrameIndex;
        
        // Initialize selections array for this frame if needed
        if (!perframeData.selectionsByFrame[frameIndex]) {
            perframeData.selectionsByFrame[frameIndex] = [];
        }
        
        perframeData.selectionsByFrame[frameIndex].push({ x, y });
        
        updatePerframeSelectionCount();
        updateTimelineHighlight();
        updatePreview();
    }
    
    function calculatePerframeMask(frameData, frameIndex) {
        const width = frameData.width;
        const height = frameData.height;
        const data = frameData.data;
        const mask = new Uint8Array(width * height).fill(255);
        
        const selections = perframeData.selectionsByFrame[frameIndex] || [];
        if (selections.length === 0) return mask;
        
        const tolerance = parseInt(perframeToleranceInput.value);
        const contiguous = perframeContiguous.checked;
        const toleranceSq = tolerance * tolerance;
        
        for (const point of selections) {
            const seedIdx = (point.y * width + point.x) * 4;
            const seedR = data[seedIdx];
            const seedG = data[seedIdx + 1];
            const seedB = data[seedIdx + 2];
            
            if (contiguous) {
                // Flood fill
                const visited = new Uint8Array(width * height);
                const stack = [[point.x, point.y]];
                
                while (stack.length > 0) {
                    const [px, py] = stack.pop();
                    
                    if (px < 0 || px >= width || py < 0 || py >= height) continue;
                    
                    const idx = py * width + px;
                    if (visited[idx]) continue;
                    visited[idx] = 1;
                    
                    const pixelIdx = idx * 4;
                    const r = data[pixelIdx];
                    const g = data[pixelIdx + 1];
                    const b = data[pixelIdx + 2];
                    
                    const dr = r - seedR;
                    const dg = g - seedG;
                    const db = b - seedB;
                    const distSq = dr * dr + dg * dg + db * db;
                    
                    if (distSq <= toleranceSq * 3) {
                        mask[idx] = 0;
                        stack.push([px + 1, py]);
                        stack.push([px - 1, py]);
                        stack.push([px, py + 1]);
                        stack.push([px, py - 1]);
                    }
                }
            } else {
                // Global selection
                for (let j = 0; j < width * height; j++) {
                    const pixelIdx = j * 4;
                    const r = data[pixelIdx];
                    const g = data[pixelIdx + 1];
                    const b = data[pixelIdx + 2];
                    
                    const dr = r - seedR;
                    const dg = g - seedG;
                    const db = b - seedB;
                    const distSq = dr * dr + dg * dg + db * db;
                    
                    if (distSq <= toleranceSq * 3) {
                        mask[j] = 0;
                    }
                }
            }
        }
        
        return mask;
    }

    function clearWandSelection() {
        if (wandMask) {
            wandMask.fill(255);
        }
        wandSelectionPoints = [];
        updateSelectionCount();
        updatePreview();
    }

    function updateSelectionCount() {
        const count = wandSelectionPoints.length;
        const template = window.i18n?.t('wand_selection_count') || '已选择 {n} 个区域';
        wandSelectionCount.textContent = template.replace('{n}', count);
    }

    // --- Per-Frame Mode Functions ---
    async function initPerframeMode() {
        if (perframeData.extractionDone) return;
        
        // Show extraction progress
        perframeExtractProgress.classList.remove('hidden');
        perframeExtractBar.style.width = '0%';
        perframeExtractPercent.textContent = '0%';
        
        const fps = detectedFps;
        const segmentDuration = endTime - startTime;
        const totalFrames = Math.max(1, Math.round(segmentDuration * fps));
        const interval = segmentDuration / totalFrames;
        
        console.log(`Extracting ${totalFrames} frames for per-frame editing`);
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = videoPlayer.videoWidth;
        canvas.height = videoPlayer.videoHeight;
        
        perframeData.frames = [];
        perframeData.frameCount = totalFrames;
        perframeData.selectionsByFrame = {};
        
        for (let i = 0; i < totalFrames; i++) {
            const time = startTime + (i * interval);
            videoPlayer.currentTime = time;
            await new Promise(resolve => {
                videoPlayer.onseeked = resolve;
            });
            
            ctx.drawImage(videoPlayer, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            perframeData.frames.push(imageData);
            
            const progress = (i + 1) / totalFrames;
            perframeExtractBar.style.width = `${progress * 100}%`;
            perframeExtractPercent.textContent = `${Math.round(progress * 100)}%`;
            
            // Yield to UI
            if (i % 5 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        perframeData.extractionDone = true;
        perframeData.currentFrameIndex = 0;
        
        // Hide progress
        perframeExtractProgress.classList.add('hidden');
        
        // Update UI
        perframeTotalSpan.textContent = totalFrames;
        perframeCurrentInput.value = 1;
        perframeCurrentInput.max = totalFrames;
        copyRangeEnd.max = totalFrames;
        copyRangeEnd.value = totalFrames;
        
        // Build timeline
        buildFrameTimeline();
        
        // Show first frame
        goToFrame(0);
        
        console.log(`Per-frame extraction complete: ${perframeData.frames.length} frames`);
    }
    
    function buildFrameTimeline() {
        timelineTrack.innerHTML = '';
        
        const maxThumbnails = Math.min(perframeData.frameCount, 100); // Limit thumbnails for performance
        const step = Math.max(1, Math.floor(perframeData.frameCount / maxThumbnails));
        
        const thumbCanvas = document.createElement('canvas');
        const thumbCtx = thumbCanvas.getContext('2d');
        thumbCanvas.width = 40;
        thumbCanvas.height = 30;
        
        for (let i = 0; i < perframeData.frameCount; i += step) {
            const frame = perframeData.frames[i];
            
            // Create thumbnail
            thumbCtx.drawImage(
                createImageBitmap ? null : null, // We'll use direct scaling
                0, 0, thumbCanvas.width, thumbCanvas.height
            );
            
            // Scale down the frame
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = frame.width;
            tempCanvas.height = frame.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.putImageData(frame, 0, 0);
            
            thumbCtx.drawImage(tempCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
            
            const div = document.createElement('div');
            div.className = 'timeline-frame';
            div.dataset.frameIndex = i;
            div.style.backgroundImage = `url(${thumbCanvas.toDataURL('image/jpeg', 0.5)})`;
            
            // Check if this frame has selections
            if (perframeData.selectionsByFrame[i] && perframeData.selectionsByFrame[i].length > 0) {
                div.classList.add('has-selection');
            }
            
            div.addEventListener('click', () => {
                goToFrame(parseInt(div.dataset.frameIndex));
            });
            
            timelineTrack.appendChild(div);
        }
        
        updateTimelineHighlight();
    }
    
    function updateTimelineHighlight() {
        const frames = timelineTrack.querySelectorAll('.timeline-frame');
        frames.forEach(frame => {
            const idx = parseInt(frame.dataset.frameIndex);
            frame.classList.toggle('active', idx === perframeData.currentFrameIndex);
            
            // Update selection indicator
            const hasSelection = perframeData.selectionsByFrame[idx] && 
                                 perframeData.selectionsByFrame[idx].length > 0;
            frame.classList.toggle('has-selection', hasSelection);
        });
        
        // Scroll active frame into view
        const activeFrame = timelineTrack.querySelector('.timeline-frame.active');
        if (activeFrame) {
            activeFrame.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }
    
    function goToFrame(index) {
        if (!perframeData.extractionDone || perframeData.frames.length === 0) return;
        
        index = Math.max(0, Math.min(perframeData.frameCount - 1, index));
        perframeData.currentFrameIndex = index;
        
        // Update input
        perframeCurrentInput.value = index + 1;
        
        // Update canvas with current frame
        const ctx = firstFrameCanvas.getContext('2d');
        firstFrameCanvas.width = perframeData.frames[index].width;
        firstFrameCanvas.height = perframeData.frames[index].height;
        ctx.putImageData(perframeData.frames[index], 0, 0);
        
        // Update selection count
        updatePerframeSelectionCount();
        
        // Update timeline
        updateTimelineHighlight();
        
        // Update preview
        updatePreview();
    }
    
    function updatePerframeSelectionCount() {
        const selections = perframeData.selectionsByFrame[perframeData.currentFrameIndex] || [];
        const count = selections.length;
        const template = window.i18n?.t('perframe_selection_count') || '当前帧: {n} 个选区';
        perframeSelectionCount.textContent = template.replace('{n}', count);
    }
    
    // Per-frame navigation event listeners
    perframeFirstBtn.addEventListener('click', () => goToFrame(0));
    perframePrevBtn.addEventListener('click', () => goToFrame(perframeData.currentFrameIndex - 1));
    perframeNextBtn.addEventListener('click', () => goToFrame(perframeData.currentFrameIndex + 1));
    perframeLastBtn.addEventListener('click', () => goToFrame(perframeData.frameCount - 1));
    
    perframeCurrentInput.addEventListener('change', () => {
        const value = parseInt(perframeCurrentInput.value) - 1; // Convert to 0-indexed
        goToFrame(value);
    });
    
    // Per-frame tolerance/feather event listeners
    perframeToleranceInput.addEventListener('input', () => {
        perframeToleranceValue.textContent = perframeToleranceInput.value;
        debouncedUpdatePreview();
    });
    
    perframeFeatherInput.addEventListener('input', () => {
        perframeFeatherValue.textContent = perframeFeatherInput.value;
        debouncedUpdatePreview();
    });
    
    perframeContiguous.addEventListener('change', () => {
        debouncedUpdatePreview();
    });
    
    // Per-frame action buttons
    perframeClearBtn.addEventListener('click', () => {
        perframeData.selectionsByFrame[perframeData.currentFrameIndex] = [];
        updatePerframeSelectionCount();
        updateTimelineHighlight();
        updatePreview();
    });
    
    perframeCopyToAllBtn.addEventListener('click', () => {
        const currentSelections = perframeData.selectionsByFrame[perframeData.currentFrameIndex] || [];
        if (currentSelections.length === 0) {
            alert(window.i18n?.t('alert_no_perframe_selection') || '当前帧没有选区');
            return;
        }
        
        // Copy to all frames
        for (let i = 0; i < perframeData.frameCount; i++) {
            perframeData.selectionsByFrame[i] = JSON.parse(JSON.stringify(currentSelections));
        }
        
        updateTimelineHighlight();
        alert(window.i18n?.t('perframe_copied_to_all') || `已复制到所有 ${perframeData.frameCount} 帧`);
    });
    
    perframeCopyToRangeBtn.addEventListener('click', () => {
        const currentSelections = perframeData.selectionsByFrame[perframeData.currentFrameIndex] || [];
        if (currentSelections.length === 0) {
            alert(window.i18n?.t('alert_no_perframe_selection') || '当前帧没有选区');
            return;
        }
        
        // Show range panel
        copyRangePanel.classList.remove('hidden');
        copyRangeStart.value = 1;
        copyRangeEnd.value = perframeData.frameCount;
    });
    
    copyRangeConfirmBtn.addEventListener('click', () => {
        const start = parseInt(copyRangeStart.value) - 1; // 0-indexed
        const end = parseInt(copyRangeEnd.value) - 1;
        
        if (start > end || start < 0 || end >= perframeData.frameCount) {
            alert(window.i18n?.t('alert_invalid_range') || '无效的帧范围');
            return;
        }
        
        const currentSelections = perframeData.selectionsByFrame[perframeData.currentFrameIndex] || [];
        
        for (let i = start; i <= end; i++) {
            perframeData.selectionsByFrame[i] = JSON.parse(JSON.stringify(currentSelections));
        }
        
        copyRangePanel.classList.add('hidden');
        updateTimelineHighlight();
        
        const count = end - start + 1;
        alert(window.i18n?.t('perframe_copied_to_range') || `已复制到 ${count} 帧`);
    });
    
    copyRangeCancelBtn.addEventListener('click', () => {
        copyRangePanel.classList.add('hidden');
    });
    
    perframeClearAllBtn.addEventListener('click', () => {
        if (!confirm(window.i18n?.t('confirm_clear_all') || '确定要清除所有帧的选区吗？')) {
            return;
        }
        
        perframeData.selectionsByFrame = {};
        updatePerframeSelectionCount();
        updateTimelineHighlight();
        updatePreview();
    });

    // --- Preview Update ---
    function updatePreview() {
        if (currentMode === 'perframe') {
            updatePerframePreview();
            return;
        }
        
        if (!firstFrameImageData) return;
        
        const ctx = previewCanvas.getContext('2d');
        const imageData = new ImageData(
            new Uint8ClampedArray(firstFrameImageData.data),
            firstFrameImageData.width,
            firstFrameImageData.height
        );
        
        if (currentMode === 'chroma') {
            const targetHex = colorHex.value;
            const targetRgb = hexToRgb(targetHex);
            if (!targetRgb) return;
            
            const targetHsv = rgbToHsv(targetRgb.r, targetRgb.g, targetRgb.b);
            const tolerance = parseInt(toleranceInput.value) / 100;
            const feather = parseInt(featherInput.value) / 100;
            const spill = parseInt(spillInput.value) / 100;

            processChromaKey(imageData.data, targetHsv, tolerance, feather, spill);
        } else {
            // Wand mode
            const feather = parseInt(wandFeatherInput.value);
            processWandMask(imageData.data, feather);
        }
        
        ctx.putImageData(imageData, 0, 0);
    }
    
    function updatePerframePreview() {
        if (!perframeData.extractionDone || perframeData.frames.length === 0) return;
        
        const frameIndex = perframeData.currentFrameIndex;
        const frame = perframeData.frames[frameIndex];
        
        const ctx = previewCanvas.getContext('2d');
        previewCanvas.width = frame.width;
        previewCanvas.height = frame.height;
        
        const imageData = new ImageData(
            new Uint8ClampedArray(frame.data),
            frame.width,
            frame.height
        );
        
        // Calculate mask for this frame
        const mask = calculatePerframeMask(frame, frameIndex);
        
        // Apply feathering
        const featherRadius = parseInt(perframeFeatherInput.value);
        let finalMask = mask;
        if (featherRadius > 0) {
            finalMask = applyFeatherToMask(mask, frame.width, frame.height, featherRadius);
        }
        
        // Apply mask to image
        for (let i = 0; i < finalMask.length; i++) {
            imageData.data[i * 4 + 3] = finalMask[i];
        }
        
        ctx.putImageData(imageData, 0, 0);
    }

    function processChromaKey(data, targetHsv, tolerance, feather, spill) {
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

            // Spill suppression
            if (data[i+3] > 0 && distance < tolerance * 1.5 && spill > 0) {
                const spillFactor = Math.max(0, 1 - (distance / (tolerance * 1.5))) * spill;
                const gray = (r + g + b) / 3;
                data[i] = r * (1 - spillFactor) + gray * spillFactor;
                data[i+1] = g * (1 - spillFactor) + gray * spillFactor;
                data[i+2] = b * (1 - spillFactor) + gray * spillFactor;
            }
        }
    }

    function processWandMask(data, featherRadius) {
        if (!wandMask) return;
        
        const width = firstFrameImageData.width;
        const height = firstFrameImageData.height;
        
        // Apply feathering if needed
        let finalMask = wandMask;
        if (featherRadius > 0) {
            finalMask = applyFeatherToMask(wandMask, width, height, featherRadius);
        }
        
        // Apply mask to image data
        for (let i = 0; i < finalMask.length; i++) {
            data[i * 4 + 3] = finalMask[i];
        }
    }

    function applyFeatherToMask(mask, width, height, radius) {
        // Simple box blur for feathering
        const result = new Uint8Array(mask.length);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                let count = 0;
                
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            sum += mask[ny * width + nx];
                            count++;
                        }
                    }
                }
                
                result[y * width + x] = Math.round(sum / count);
            }
        }
        
        return result;
    }

    // --- Video Processing ---
    processBtn.addEventListener('click', async () => {
        if (currentMode === 'chroma') {
            const targetHex = colorHex.value;
            const targetRgb = hexToRgb(targetHex);
            if (!targetRgb) {
                alert(window.i18n?.t('alert_no_color') || '请先选择背景颜色');
                return;
            }
        } else if (currentMode === 'wand') {
            if (wandSelectionPoints.length === 0) {
                alert(window.i18n?.t('alert_no_wand_selection') || '请先点击图片选择要删除的区域');
                return;
            }
        } else if (currentMode === 'perframe') {
            // Check if any frame has selections
            const hasAnySelection = Object.values(perframeData.selectionsByFrame).some(arr => arr && arr.length > 0);
            if (!hasAnySelection) {
                alert(window.i18n?.t('alert_no_perframe_selection') || '请先在帧上添加选区');
                return;
            }
        }

        const fps = detectedFps; // Use detected FPS to match input video
        const format = outputFormat.value;
        const quality = parseFloat(videoQuality.value);

        loadingOverlay.classList.remove('hidden');
        progressBar.style.width = '0%';
        progressText.textContent = '0%';
        loadingText.textContent = window.i18n?.t('extracting_frames') || '正在提取帧...';

        try {
            let frames;
            
            if (currentMode === 'perframe' && perframeData.extractionDone) {
                // Use already extracted frames
                frames = perframeData.frames;
                progressBar.style.width = '50%';
                progressText.textContent = '50%';
            } else {
                // Step 1: Extract frames at original FPS
                frames = await extractFrames(fps, (progress) => {
                    progressBar.style.width = `${progress * 50}%`;
                    progressText.textContent = `${Math.round(progress * 50)}%`;
                });
            }

            loadingText.textContent = window.i18n?.t('processing_bg') || '正在去除背景...';

            // Step 2: Process frames based on mode
            let processedFrames;
            if (currentMode === 'chroma') {
                const targetRgb = hexToRgb(colorHex.value);
                const targetHsv = rgbToHsv(targetRgb.r, targetRgb.g, targetRgb.b);
                const tolerance = parseInt(toleranceInput.value) / 100;
                const feather = parseInt(featherInput.value) / 100;
                const spill = parseInt(spillInput.value) / 100;
                
                processedFrames = await processFramesChroma(frames, targetHsv, tolerance, feather, spill, (progress) => {
                    progressBar.style.width = `${50 + progress * 30}%`;
                    progressText.textContent = `${Math.round(50 + progress * 30)}%`;
                });
            } else if (currentMode === 'wand') {
                const featherRadius = parseInt(wandFeatherInput.value);
                processedFrames = await processFramesWand(frames, featherRadius, (progress) => {
                    progressBar.style.width = `${50 + progress * 30}%`;
                    progressText.textContent = `${Math.round(50 + progress * 30)}%`;
                });
            } else {
                // Per-frame mode
                const featherRadius = parseInt(perframeFeatherInput.value);
                processedFrames = await processFramesPerframe(frames, featherRadius, (progress) => {
                    progressBar.style.width = `${50 + progress * 30}%`;
                    progressText.textContent = `${Math.round(50 + progress * 30)}%`;
                });
            }

            loadingText.textContent = window.i18n?.t('encoding_video') || '正在编码视频...';

            // Step 3: Encode based on format
            if (format === 'png-sequence') {
                await exportPngSequence(processedFrames, (progress) => {
                    progressBar.style.width = `${80 + progress * 20}%`;
                    progressText.textContent = `${Math.round(80 + progress * 20)}%`;
                });
            } else if (format === 'gif') {
                await exportGif(processedFrames, fps, (progress) => {
                    progressBar.style.width = `${80 + progress * 20}%`;
                    progressText.textContent = `${Math.round(80 + progress * 20)}%`;
                });
            } else {
                // WebM VP8/VP9
                await encodeVideo(processedFrames, fps, format, quality, (progress) => {
                    progressBar.style.width = `${80 + progress * 20}%`;
                    progressText.textContent = `${Math.round(80 + progress * 20)}%`;
                });
            }

            loadingOverlay.classList.add('hidden');
        } catch (e) {
            console.error(e);
            alert((window.i18n?.t('error_processing') || '处理出错：') + e.message);
            loadingOverlay.classList.add('hidden');
        }
    });

    async function extractFrames(fps, onProgress) {
        const frames = [];
        const segmentDuration = endTime - startTime;
        // Calculate exact frame count based on duration and fps
        const totalFrames = Math.round(segmentDuration * fps);
        const interval = segmentDuration / totalFrames;
        
        console.log(`Extracting ${totalFrames} frames from ${startTime.toFixed(3)}s to ${endTime.toFixed(3)}s (${segmentDuration.toFixed(3)}s @ ${fps} FPS)`);
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = videoPlayer.videoWidth;
        canvas.height = videoPlayer.videoHeight;

        for (let i = 0; i < totalFrames; i++) {
            // Calculate exact time for this frame
            const time = startTime + (i * interval);
            
            videoPlayer.currentTime = time;
            await new Promise(resolve => {
                videoPlayer.onseeked = resolve;
            });
            
            ctx.drawImage(videoPlayer, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            frames.push(imageData);
            
            onProgress((i + 1) / totalFrames);
        }

        console.log(`Extracted ${frames.length} frames`);
        return frames;
    }

    async function processFramesChroma(frames, targetHsv, tolerance, feather, spill, onProgress) {
        const processedFrames = [];
        
        for (let i = 0; i < frames.length; i++) {
            const imageData = new ImageData(
                new Uint8ClampedArray(frames[i].data),
                frames[i].width,
                frames[i].height
            );
            
            processChromaKey(imageData.data, targetHsv, tolerance, feather, spill);
            processedFrames.push(imageData);
            
            onProgress((i + 1) / frames.length);
            
            if (i % 10 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        return processedFrames;
    }

    async function processFramesWand(frames, featherRadius, onProgress) {
        const processedFrames = [];
        const width = frames[0].width;
        const height = frames[0].height;
        const tolerance = parseInt(wandToleranceInput.value);
        const contiguous = wandContiguous.checked;
        
        // Pre-compute feathered mask if needed
        let featheredMask = wandMask;
        if (featherRadius > 0) {
            featheredMask = applyFeatherToMask(wandMask, width, height, featherRadius);
        }
        
        for (let i = 0; i < frames.length; i++) {
            const imageData = new ImageData(
                new Uint8ClampedArray(frames[i].data),
                frames[i].width,
                frames[i].height
            );
            
            // For each frame, we need to recalculate the wand mask based on the same seed points
            // but using the current frame's pixel colors
            const frameMask = calculateFrameWandMask(imageData.data, width, height, tolerance, contiguous);
            
            // Apply feathering
            let finalMask = frameMask;
            if (featherRadius > 0) {
                finalMask = applyFeatherToMask(frameMask, width, height, featherRadius);
            }
            
            // Apply mask
            for (let j = 0; j < finalMask.length; j++) {
                imageData.data[j * 4 + 3] = finalMask[j];
            }
            
            processedFrames.push(imageData);
            
            onProgress((i + 1) / frames.length);
            
            if (i % 10 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        return processedFrames;
    }

    async function processFramesPerframe(frames, featherRadius, onProgress) {
        const processedFrames = [];
        const width = frames[0].width;
        const height = frames[0].height;
        
        for (let i = 0; i < frames.length; i++) {
            const imageData = new ImageData(
                new Uint8ClampedArray(frames[i].data),
                frames[i].width,
                frames[i].height
            );
            
            // Calculate mask for this specific frame using its selections
            const frameMask = calculatePerframeMask(frames[i], i);
            
            // Apply feathering
            let finalMask = frameMask;
            if (featherRadius > 0) {
                finalMask = applyFeatherToMask(frameMask, width, height, featherRadius);
            }
            
            // Apply mask
            for (let j = 0; j < finalMask.length; j++) {
                imageData.data[j * 4 + 3] = finalMask[j];
            }
            
            processedFrames.push(imageData);
            
            onProgress((i + 1) / frames.length);
            
            if (i % 10 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        return processedFrames;
    }

    function calculateFrameWandMask(data, width, height, tolerance, contiguous) {
        const mask = new Uint8Array(width * height).fill(255);
        const toleranceSq = tolerance * tolerance;
        
        for (const point of wandSelectionPoints) {
            const seedIdx = (point.y * width + point.x) * 4;
            const seedR = data[seedIdx];
            const seedG = data[seedIdx + 1];
            const seedB = data[seedIdx + 2];
            
            if (contiguous) {
                // Flood fill for this frame
                const visited = new Uint8Array(width * height);
                const stack = [[point.x, point.y]];
                
                while (stack.length > 0) {
                    const [x, y] = stack.pop();
                    
                    if (x < 0 || x >= width || y < 0 || y >= height) continue;
                    
                    const idx = y * width + x;
                    if (visited[idx]) continue;
                    visited[idx] = 1;
                    
                    const pixelIdx = idx * 4;
                    const r = data[pixelIdx];
                    const g = data[pixelIdx + 1];
                    const b = data[pixelIdx + 2];
                    
                    const dr = r - seedR;
                    const dg = g - seedG;
                    const db = b - seedB;
                    const distSq = dr * dr + dg * dg + db * db;
                    
                    if (distSq <= toleranceSq * 3) {
                        mask[idx] = 0;
                        stack.push([x + 1, y]);
                        stack.push([x - 1, y]);
                        stack.push([x, y + 1]);
                        stack.push([x, y - 1]);
                    }
                }
            } else {
                // Global selection
                for (let j = 0; j < width * height; j++) {
                    const pixelIdx = j * 4;
                    const r = data[pixelIdx];
                    const g = data[pixelIdx + 1];
                    const b = data[pixelIdx + 2];
                    
                    const dr = r - seedR;
                    const dg = g - seedG;
                    const db = b - seedB;
                    const distSq = dr * dr + dg * dg + db * db;
                    
                    if (distSq <= toleranceSq * 3) {
                        mask[j] = 0;
                    }
                }
            }
        }
        
        return mask;
    }

    async function encodeVideo(frames, fps, format, quality, onProgress) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = frames[0].width;
        canvas.height = frames[0].height;

        // Calculate timing info
        const frameDurationUs = Math.round(1000000 / fps); // microseconds per frame
        const targetDurationSec = frames.length / fps;
        
        console.log(`Encoding: ${frames.length} frames @ ${fps} FPS = ${targetDurationSec.toFixed(3)}s`);

        // Try WebCodecs + webm-muxer (most accurate) if available
        if (typeof VideoEncoder !== 'undefined' && window.WebMMuxer) {
            try {
                await encodeWithWebCodecsMuxer(frames, fps, quality, canvas, ctx, onProgress);
                return;
            } catch (e) {
                console.warn('WebCodecs+Muxer encoding failed:', e.message);
                console.log('Falling back to MediaRecorder...');
            }
        }

        // Fallback to MediaRecorder
        await encodeWithMediaRecorder(frames, fps, format, quality, canvas, ctx, onProgress);
    }

    async function encodeWithWebCodecsMuxer(frames, fps, quality, canvas, ctx, onProgress) {
        const width = frames[0].width;
        const height = frames[0].height;
        const frameDurationUs = Math.round(1000000 / fps);
        
        // Collect all encoded chunks
        const fileChunks = [];
        
        // Create WebM muxer with precise timing
        const muxer = new WebMMuxer.Muxer({
            target: {
                write: (data, position) => {
                    fileChunks.push({ data: new Uint8Array(data), position });
                },
                close: () => {}
            },
            video: {
                codec: 'V_VP9',
                width: width,
                height: height,
                frameRate: fps,
                alpha: true // Enable alpha channel support
            },
            type: 'webm',
            firstTimestampBehavior: 'offset'
        });

        // Configure video encoder
        const encoder = new VideoEncoder({
            output: (chunk, metadata) => {
                muxer.addVideoChunk(chunk, metadata);
            },
            error: (e) => {
                throw new Error('VideoEncoder error: ' + e.message);
            }
        });

        // Try VP9 with alpha first
        let codecConfig = {
            codec: 'vp09.00.10.08.01', // VP9 profile 0, level 1
            width: width,
            height: height,
            bitrate: Math.round(quality * 8000000),
            framerate: fps
        };

        // Check codec support
        let support = await VideoEncoder.isConfigSupported(codecConfig);
        if (!support.supported) {
            // Try simpler VP9 config
            codecConfig.codec = 'vp09.00.10.08';
            support = await VideoEncoder.isConfigSupported(codecConfig);
        }
        if (!support.supported) {
            // Try VP8 as last resort
            codecConfig.codec = 'vp8';
            support = await VideoEncoder.isConfigSupported(codecConfig);
        }
        
        if (!support.supported) {
            throw new Error('No supported video codec found');
        }
        
        encoder.configure(codecConfig);

        // Encode each frame with precise timestamps
        for (let i = 0; i < frames.length; i++) {
            ctx.putImageData(frames[i], 0, 0);
            
            // Create VideoFrame with exact timestamp
            const timestamp = i * frameDurationUs;
            const videoFrame = new VideoFrame(canvas, {
                timestamp: timestamp,
                duration: frameDurationUs
            });
            
            // Encode (keyframe every ~2 seconds)
            const isKeyFrame = i === 0 || (i % Math.round(fps * 2)) === 0;
            encoder.encode(videoFrame, { keyFrame: isKeyFrame });
            videoFrame.close();
            
            onProgress((i + 1) / frames.length * 0.95);
            
            // Yield to UI periodically
            if (i % 5 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        // Wait for encoder to finish
        await encoder.flush();
        encoder.close();
        
        // Finalize muxer
        muxer.finalize();
        
        // Combine all chunks into final file
        // Sort by position and concatenate
        fileChunks.sort((a, b) => a.position - b.position);
        
        let totalSize = 0;
        for (const chunk of fileChunks) {
            totalSize = Math.max(totalSize, chunk.position + chunk.data.length);
        }
        
        const finalBuffer = new Uint8Array(totalSize);
        for (const chunk of fileChunks) {
            finalBuffer.set(chunk.data, chunk.position);
        }
        
        // Create blob and download
        const blob = new Blob([finalBuffer], { type: 'video/webm' });
        
        console.log(`WebM created: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `video_bg_removed_${frames.length}f_${fps}fps_${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        
        onProgress(1);
    }

    async function encodeWithMediaRecorder(frames, fps, format, quality, canvas, ctx, onProgress) {
        // Determine codec based on format
        let mimeType;
        if (format === 'webm-vp9') {
            mimeType = 'video/webm;codecs=vp9';
        } else {
            mimeType = 'video/webm;codecs=vp8';
        }
        
        // Fallback if codec not supported
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm';
        }

        // Create stream with manual frame control
        const stream = canvas.captureStream(0);
        const videoTrack = stream.getVideoTracks()[0];
        
        const recorder = new MediaRecorder(stream, {
            mimeType: mimeType,
            videoBitsPerSecond: Math.round(quality * 10000000)
        });

        const chunks = [];
        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                chunks.push(e.data);
            }
        };

        const recordingPromise = new Promise((resolve, reject) => {
            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: mimeType });
                resolve(blob);
            };
            recorder.onerror = reject;
        });

        // Calculate precise frame timing
        const frameDurationMs = 1000 / fps;
        const targetTotalMs = frames.length * frameDurationMs;
        
        recorder.start();
        const recordStartTime = performance.now();
        
        // Render each frame with precise timing
        for (let i = 0; i < frames.length; i++) {
            const frameStartTime = performance.now();
            
            // Draw frame
            ctx.putImageData(frames[i], 0, 0);
            
            // Request frame capture
            if (videoTrack.requestFrame) {
                videoTrack.requestFrame();
            }
            
            onProgress((i + 1) / frames.length);
            
            // Wait until the correct time for next frame
            const targetNextFrameTime = recordStartTime + (i + 1) * frameDurationMs;
            const now = performance.now();
            const waitTime = targetNextFrameTime - now;
            
            if (waitTime > 4) {
                // Use setTimeout for longer waits
                await new Promise(resolve => setTimeout(resolve, waitTime - 2));
            }
            
            // Spin-wait for remaining time (more precise)
            while (performance.now() < targetNextFrameTime) {
                // Busy wait
            }
        }

        // Hold last frame for one more frame duration
        await new Promise(resolve => setTimeout(resolve, frameDurationMs));
        recorder.stop();

        const blob = await recordingPromise;
        const recordDuration = performance.now() - recordStartTime;
        
        console.log(`MediaRecorder: target=${targetTotalMs.toFixed(1)}ms, actual=${recordDuration.toFixed(1)}ms`);
        console.log(`Note: MediaRecorder timing may not be precise. Use a browser that supports WebCodecs for exact timing.`);
        
        // Download the video
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `video_bg_removed_${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
    }

    async function exportPngSequence(frames, onProgress) {
        // Use JSZip if available, otherwise download individually
        const JSZip = window.JSZip;
        
        if (JSZip) {
            const zip = new JSZip();
            const folder = zip.folder('frames');
            
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = frames[0].width;
            canvas.height = frames[0].height;
            
            for (let i = 0; i < frames.length; i++) {
                ctx.putImageData(frames[i], 0, 0);
                const dataUrl = canvas.toDataURL('image/png');
                const base64 = dataUrl.split(',')[1];
                const paddedIndex = String(i + 1).padStart(5, '0');
                folder.file(`frame_${paddedIndex}.png`, base64, { base64: true });
                
                onProgress((i + 1) / frames.length);
                
                if (i % 5 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
            
            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `frames_${Date.now()}.zip`;
            a.click();
            URL.revokeObjectURL(url);
        } else {
            // Download first frame as sample
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = frames[0].width;
            canvas.height = frames[0].height;
            ctx.putImageData(frames[0], 0, 0);
            
            canvas.toBlob((blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `frame_00001.png`;
                a.click();
                URL.revokeObjectURL(url);
            }, 'image/png');
            
            alert(window.i18n?.t('png_zip_hint') || '请添加 JSZip 库以支持批量导出 PNG 序列。当前仅导出了第一帧。');
            onProgress(1);
        }
    }

    async function exportGif(frames, fps, onProgress) {
        // Simple GIF encoder using canvas
        // For proper GIF with transparency, we'd need a library like gif.js
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = frames[0].width;
        canvas.height = frames[0].height;
        
        // Try to use gif.js if available
        if (window.GIF) {
            const gif = new GIF({
                workers: 2,
                quality: 10,
                width: canvas.width,
                height: canvas.height,
                transparent: 0x00FF00
            });
            
            for (let i = 0; i < frames.length; i++) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.putImageData(frames[i], 0, 0);
                gif.addFrame(ctx, { copy: true, delay: 1000 / fps });
                onProgress((i + 1) / frames.length * 0.8);
            }
            
            gif.on('finished', (blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `animation_${Date.now()}.gif`;
                a.click();
                URL.revokeObjectURL(url);
                onProgress(1);
            });
            
            gif.render();
        } else {
            // Fallback: Export as WebM with note about GIF
            alert(window.i18n?.t('gif_lib_hint') || 'GIF 库未加载，将导出为 WebM 格式。如需 GIF，请添加 gif.js 库。');
            await encodeVideo(frames, fps, 'webm-vp8', 0.8, onProgress);
        }
    }

    // --- Language Change Handler ---
    window.addEventListener('languageChanged', () => {
        updateSelectionCount();
        updatePerframeSelectionCount();
        // Update mode-specific titles
        if (currentMode === 'chroma') {
            previewLeftTitle.textContent = window.i18n?.t('preview_first_frame') || '首帧预览 (点击拾取颜色)';
        } else if (currentMode === 'wand') {
            previewLeftTitle.textContent = window.i18n?.t('preview_wand_frame') || '首帧预览 (点击选择区域)';
        } else {
            previewLeftTitle.textContent = window.i18n?.t('preview_perframe') || '当前帧预览 (点击选择区域)';
        }
    });
});
