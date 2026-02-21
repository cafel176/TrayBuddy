document.addEventListener('DOMContentLoaded', () => {
    const t = (key, params) => (window.i18n && typeof window.i18n.t === 'function')
        ? window.i18n.t(key, params)
        : key;

    const setI18nCount = (el, key, n) => {
        if (!el) return;
        el.setAttribute('data-i18n', key);
        el.setAttribute('data-i18n-n', String(n));
        el.textContent = t(key, { n });
    };


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
    
    // Multi-color chroma elements
    const chromaColorList = document.getElementById('chroma-color-list');
    const chromaColorCount = document.getElementById('chroma-color-count');
    const chromaAddColorBtn = document.getElementById('chroma-add-color-btn');
    const chromaClearAllBtn = document.getElementById('chroma-clear-all-btn');
    
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
    
    // Hybrid mode elements
    const modeHybridBtn = document.getElementById('mode-hybrid');
    const hybridSettings = document.getElementById('hybrid-settings');
    const hybridOperationList = document.getElementById('hybrid-operation-list');
    const hybridOperationCount = document.getElementById('hybrid-operation-count');
    const hybridAddChromaBtn = document.getElementById('hybrid-add-chroma-btn');
    const hybridAddWandBtn = document.getElementById('hybrid-add-wand-btn');
    const hybridClearAllBtn = document.getElementById('hybrid-clear-all-btn');
    
    // Hybrid chroma panel elements
    const hybridChromaPanel = document.getElementById('hybrid-chroma-panel');
    const hybridColorPreview = document.getElementById('hybrid-color-preview');
    const hybridColorHex = document.getElementById('hybrid-color-hex');
    const hybridToleranceInput = document.getElementById('hybrid-tolerance-input');
    const hybridToleranceValue = document.getElementById('hybrid-tolerance-value');
    const hybridFeatherInput = document.getElementById('hybrid-feather-input');
    const hybridFeatherValue = document.getElementById('hybrid-feather-value');
    const hybridSpillInput = document.getElementById('hybrid-spill-input');
    const hybridSpillValue = document.getElementById('hybrid-spill-value');
    const hybridChromaCancelBtn = document.getElementById('hybrid-chroma-cancel-btn');
    const hybridChromaConfirmBtn = document.getElementById('hybrid-chroma-confirm-btn');
    
    // Hybrid wand panel elements
    const hybridWandPanel = document.getElementById('hybrid-wand-panel');
    const hybridWandToleranceInput = document.getElementById('hybrid-wand-tolerance-input');
    const hybridWandToleranceValue = document.getElementById('hybrid-wand-tolerance-value');
    const hybridWandFeatherInput = document.getElementById('hybrid-wand-feather-input');
    const hybridWandFeatherValue = document.getElementById('hybrid-wand-feather-value');
    const hybridWandContiguous = document.getElementById('hybrid-wand-contiguous');
    const hybridWandSelectionCount = document.getElementById('hybrid-wand-selection-count');
    const hybridWandClearBtn = document.getElementById('hybrid-wand-clear-btn');
    const hybridWandCancelBtn = document.getElementById('hybrid-wand-cancel-btn');
    const hybridWandConfirmBtn = document.getElementById('hybrid-wand-confirm-btn');
    
    // Preview canvases
    const firstFrameCanvas = document.getElementById('first-frame-canvas');
    const previewCanvas = document.getElementById('preview-canvas');
    
    // Output elements
    const outputFormat = document.getElementById('output-format');
    const videoQuality = document.getElementById('video-quality');
    const keepAudioCheckbox = document.getElementById('keep-audio');
    const keepAudioHint = document.getElementById('keep-audio-hint');
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
    
    // MOV fallback support (for PNG-in-MOV files from WebM->MOV conversion)
    let movFallback = null; // Parsed MOV data
    let movFallbackPromise = null;
    let videoDecodable = true; // Whether browser can decode the video
    
    // Current mode: 'chroma' or 'wand' or 'perframe' or 'hybrid'
    let currentMode = 'chroma';
    
    // Multi-color chroma key state
    let chromaColors = []; // Array of {hex, tolerance, feather, spill}
    let selectedChromaIndex = -1; // Currently selected color for editing (-1 = none/new)
    
    // Wand mode state
    let wandMask = null; // Uint8Array storing alpha mask (0 = remove, 255 = keep)
    let wandSelectionPoints = []; // Array of {x, y} click points
    
    // Hybrid mode state
    let hybridOperations = []; // Array of {type: 'chroma'|'wand', params: {...}}
    let hybridEditMode = null; // 'chroma' or 'wand' when adding new operation
    let hybridTempWandPoints = []; // Temporary wand points while editing
    let hybridTempWandMask = null; // Temporary mask while editing
    
    // Per-frame wand mode state
    let perframeData = {
        frames: [],           // Array of ImageData for each frame
        frameCount: 0,        // Total number of frames
        currentFrameIndex: 0, // Current frame being edited (0-indexed)
        selectionsByFrame: {},// Map: frameIndex -> [{x, y}, ...] selection points
        extractionDone: false // Whether frames have been extracted
    };

    // Audio state
    let audioBuffer = null; // AudioBuffer from original video

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

    // --- MOV Parsing Functions (for PNG-in-MOV files from WebM->MOV conversion) ---
    function readFourCC(view, offset) {
        return String.fromCharCode(
            view.getUint8(offset),
            view.getUint8(offset + 1),
            view.getUint8(offset + 2),
            view.getUint8(offset + 3)
        );
    }

    function parseAtoms(view, start, end) {
        const atoms = [];
        let off = start;
        while (off + 8 <= end) {
            const size = view.getUint32(off);
            const type = readFourCC(view, off + 4);
            let atomSize = size;
            if (atomSize === 0) atomSize = end - off;
            if (atomSize < 8) break;
            const atomEnd = Math.min(end, off + atomSize);
            atoms.push({
                type,
                start: off,
                size: atomSize,
                headerSize: 8,
                dataStart: off + 8,
                end: atomEnd
            });
            off = off + atomSize;
        }
        return atoms;
    }

    function findChildAtom(view, parentAtom, type) {
        const children = parseAtoms(view, parentAtom.dataStart, parentAtom.end);
        return children.find(a => a.type === type) || null;
    }

    function findChildAtoms(view, parentAtom, type) {
        const children = parseAtoms(view, parentAtom.dataStart, parentAtom.end);
        return children.filter(a => a.type === type);
    }

    function parsePngMov(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        const top = parseAtoms(view, 0, view.byteLength);
        const moov = top.find(a => a.type === 'moov');
        if (!moov) return null;

        const traks = findChildAtoms(view, moov, 'trak');
        if (!traks.length) return null;

        // pick the first track
        const trak = traks[0];
        const mdia = findChildAtom(view, trak, 'mdia');
        if (!mdia) return null;

        const mdhd = findChildAtom(view, mdia, 'mdhd');
        if (!mdhd) return null;

        // mdhd: version/flags(4) + creation(4) + modification(4) + timescale(4) + duration(4)
        const timeScale = view.getUint32(mdhd.dataStart + 12);
        const mdDuration = view.getUint32(mdhd.dataStart + 16);
        const durationSeconds = timeScale ? mdDuration / timeScale : 0;

        const minf = findChildAtom(view, mdia, 'minf');
        if (!minf) return null;

        const stbl = findChildAtom(view, minf, 'stbl');
        if (!stbl) return null;

        const stsd = findChildAtom(view, stbl, 'stsd');
        const stsz = findChildAtom(view, stbl, 'stsz');
        const stco = findChildAtom(view, stbl, 'stco');
        const stts = findChildAtom(view, stbl, 'stts');
        if (!stsd || !stsz || !stco || !stts) return null;

        // stsd: version/flags(4) + entryCount(4) + sampleEntry
        const entryCount = view.getUint32(stsd.dataStart + 4);
        if (entryCount < 1) return null;
        const entryStart = stsd.dataStart + 8;
        const codecFourCC = readFourCC(view, entryStart + 4);
        const width = view.getUint16(entryStart + 32);
        const height = view.getUint16(entryStart + 34);

        // stts: version/flags(4) + entryCount(4) + (sampleCount(4), sampleDelta(4))...
        const sttsEntryCount = view.getUint32(stts.dataStart + 4);
        if (sttsEntryCount < 1) return null;
        const sampleDelta = view.getUint32(stts.dataStart + 12);
        const fps = (timeScale && sampleDelta) ? (timeScale / sampleDelta) : 30;

        // stsz: version/flags(4) + sampleSize(4) + sampleCount(4) + sizes...
        const sampleSize = view.getUint32(stsz.dataStart + 4);
        const sampleCount = view.getUint32(stsz.dataStart + 8);
        if (sampleCount <= 0) return null;

        // stco: version/flags(4) + entryCount(4) + offsets...
        const stcoCount = view.getUint32(stco.dataStart + 4);
        if (stcoCount < 1) return null;
        const chunkOffset = view.getUint32(stco.dataStart + 8);

        if (sampleCount > 12000) {
            throw new Error(t('error_frames_too_many', { count: sampleCount }));
        }

        const samples = [];
        if (sampleSize !== 0) {
            // fixed size samples
            let pos = chunkOffset;
            for (let i = 0; i < sampleCount; i++) {
                samples.push(new Uint8Array(arrayBuffer, pos, sampleSize));
                pos += sampleSize;
            }
        } else {
            // per-sample sizes
            let pos = chunkOffset;
            let tablePos = stsz.dataStart + 12;
            for (let i = 0; i < sampleCount; i++) {
                const sz = view.getUint32(tablePos + i * 4);
                samples.push(new Uint8Array(arrayBuffer, pos, sz));
                pos += sz;
            }
        }

        return { codecFourCC, width, height, timeScale, durationSeconds, fps, samples, arrayBuffer };
    }

    async function decodeMovSampleToImageData(parsed, sampleBytes) {
        if (parsed.codecFourCC === 'raw ') {
            const expected = parsed.width * parsed.height * 4;
            if (sampleBytes.byteLength < expected) {
                throw new Error(t('error_raw_frame_invalid', { actual: sampleBytes.byteLength, expected }));
            }
            const src = new Uint8ClampedArray(sampleBytes.buffer, sampleBytes.byteOffset, expected);
            const copy = new Uint8ClampedArray(src);
            return new ImageData(copy, parsed.width, parsed.height);
        }

        if (parsed.codecFourCC === 'png ') {
            const blob = new Blob([sampleBytes], { type: 'image/png' });
            const bitmap = await createImageBitmap(blob);
            const canvas = document.createElement('canvas');
            canvas.width = parsed.width;
            canvas.height = parsed.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(bitmap, 0, 0);
            if (bitmap.close) bitmap.close();
            return ctx.getImageData(0, 0, canvas.width, canvas.height);
        }

        throw new Error(t('error_mov_codec_unsupported', { codec: parsed.codecFourCC }));
    }

    async function extractFramesFromMovFallback(parsed, startIdx, endIdx, onProgress) {
        const frames = [];
        const total = endIdx - startIdx;
        for (let i = startIdx; i < endIdx; i++) {
            const imageData = await decodeMovSampleToImageData(parsed, parsed.samples[i]);
            frames.push(imageData);
            onProgress((i - startIdx + 1) / total);
            if ((i - startIdx) % 3 === 0) await new Promise(r => setTimeout(r, 0));
        }
        return frames;
    }

    async function initMovFallbackIfPossible(file) {
        try {
            // Skip extremely large MOV to avoid heavy memory use
            if (file.size > 1024 * 1024 * 1024) return null;

            const buf = await file.arrayBuffer();
            const parsed = parsePngMov(buf);
            if (!parsed) return null;

            movFallback = parsed;

            // Fill basic metadata for UI (even if <video> cannot decode)
            videoWidth = parsed.width;
            videoHeight = parsed.height;
            duration = parsed.durationSeconds;
            detectedFps = parsed.fps;
            endTime = duration;

            console.log(`MOV fallback: ${parsed.width}x${parsed.height}, ${parsed.durationSeconds}s, ${parsed.fps} FPS, codec: ${parsed.codecFourCC}`);

            return movFallback;
        } catch (e) {
            console.warn('MOV fallback parse failed:', e && e.message ? e.message : e);
            return null;
        }
    }

    function isMovFile(file) {
        const name = (file.name || '').toLowerCase();
        return name.endsWith('.mov') || file.type === 'video/quicktime';
    }

    // Probe video duration for files that report Infinity (common with some WebM files)
    // This works by seeking to a very large time, which forces the browser to determine the actual duration
    async function probeVideoDuration(video) {
        return new Promise((resolve) => {
            const originalTime = video.currentTime;
            let resolved = false;
            
            const onTimeUpdate = () => {
                if (resolved) return;
                // After seeking to a huge value, currentTime will be clamped to actual duration
                if (Number.isFinite(video.currentTime) && video.currentTime > 0) {
                    const probedDuration = video.currentTime;
                    resolved = true;
                    video.removeEventListener('timeupdate', onTimeUpdate);
                    // Seek back to original position
                    video.currentTime = originalTime;
                    resolve(probedDuration);
                }
            };
            
            const onSeeked = () => {
                if (resolved) return;
                if (Number.isFinite(video.duration) && video.duration > 0) {
                    resolved = true;
                    video.removeEventListener('seeked', onSeeked);
                    video.removeEventListener('timeupdate', onTimeUpdate);
                    video.currentTime = originalTime;
                    resolve(video.duration);
                } else if (Number.isFinite(video.currentTime) && video.currentTime > 0) {
                    resolved = true;
                    video.removeEventListener('seeked', onSeeked);
                    video.removeEventListener('timeupdate', onTimeUpdate);
                    const probedDuration = video.currentTime;
                    video.currentTime = originalTime;
                    resolve(probedDuration);
                }
            };
            
            video.addEventListener('timeupdate', onTimeUpdate);
            video.addEventListener('seeked', onSeeked);
            
            // Seek to a very large time - browser will clamp to actual duration
            video.currentTime = Number.MAX_SAFE_INTEGER;
            
            // Timeout fallback - if we can't determine duration, use a default
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    video.removeEventListener('timeupdate', onTimeUpdate);
                    video.removeEventListener('seeked', onSeeked);
                    video.currentTime = originalTime;
                    // Return 0 to indicate unknown duration - UI will show '--:--'
                    resolve(0);
                }
            }, 3000);
        });
    }

    function handleFile(file) {
        // Check if it's a video file (also accept MOV files which may have empty or different MIME types)
        const isVideo = file.type.startsWith('video/') || isMovFile(file);
        if (!isVideo) {
            alert(t('alert_upload_video'));
            return;
        }
        videoFile = file;
        videoDecodable = true;
        movFallback = null;
        movFallbackPromise = null;
        
        const url = URL.createObjectURL(file);
        videoPlayer.src = url;
        
        // For MOV files: try parsing PNG-in-MOV (e.g. from "WebM与MOV互转" tool)
        // Start parsing in parallel with browser loading
        if (isMovFile(file)) {
            console.log('Detected MOV file, attempting to parse in parallel...');
            movFallbackPromise = initMovFallbackIfPossible(file);
        }
        
        // Error handler for undecodable videos
        const onError = () => {
            videoDecodable = false;
            console.log('Video decode error, trying MOV fallback...');
            
            // Try MOV fallback parsing first
            (async () => {
                try {
                    if (!movFallback && movFallbackPromise) {
                        await movFallbackPromise;
                    }
                    if (!movFallback && isMovFile(file)) {
                        // One more try
                        console.log('Retrying MOV fallback parse...');
                        movFallbackPromise = initMovFallbackIfPossible(file);
                        await movFallbackPromise;
                    }
                    
                    if (movFallback) {
                        // Success - show editor with MOV fallback
                        console.log('Using MOV fallback mode (browser cannot decode, but we can parse PNG/RAW frames)');
                        console.log('MOV info:', { 
                            codec: movFallback.codecFourCC, 
                            width: videoWidth, 
                            height: videoHeight, 
                            duration, 
                            fps: detectedFps,
                            samples: movFallback.samples?.length 
                        });
                        
                        // Set canvas sizes before drawing
                        firstFrameCanvas.width = videoWidth;
                        firstFrameCanvas.height = videoHeight;
                        previewCanvas.width = videoWidth;
                        previewCanvas.height = videoHeight;
                        
                        updateSliderUI();
                        uploadSection.classList.add('hidden');
                        editorSection.classList.remove('hidden');
                        resetBtn.classList.remove('hidden');
                        updateVideoInfoDisplay();
                        
                        // Draw first frame for preview from MOV fallback
                        if (movFallback.samples && movFallback.samples.length > 0) {
                            const first = await decodeMovSampleToImageData(movFallback, movFallback.samples[0]);
                            firstFrameImageData = first;
                            
                            // Draw first frame with transparency visualization
                            const ctx = firstFrameCanvas.getContext('2d', { willReadFrequently: true });
                            drawCheckerboard(ctx, videoWidth, videoHeight);
                            const tempCanvas = document.createElement('canvas');
                            tempCanvas.width = first.width;
                            tempCanvas.height = first.height;
                            const tempCtx = tempCanvas.getContext('2d');
                            tempCtx.putImageData(first, 0, 0);
                            ctx.drawImage(tempCanvas, 0, 0);
                            
                            // Also update preview canvas with transparency visualization
                            updatePreviewWithAlpha(first);
                            
                            // Initialize wand mask
                            wandMask = new Uint8Array(videoWidth * videoHeight).fill(255);
                            
                            // Hide video player in MOV fallback mode (browser can't play it)
                            videoPlayer.style.display = 'none';
                        }
                        return;
                    }
                    
                    alert(t('alert_decode_failed'));
                } catch (e) {
                    console.error('MOV fallback failed:', e);
                    alert(t('alert_decode_failed'));
                }
            })();
        };
        videoPlayer.addEventListener('error', onError, { once: true });
        
        videoPlayer.onloadedmetadata = async () => {
            // Browser successfully loaded metadata
            // But for MOV files, we should still wait for fallback parsing to complete
            // because browser may not be able to render the actual frames
            
            let browserDuration = videoPlayer.duration;
            let browserWidth = videoPlayer.videoWidth;
            let browserHeight = videoPlayer.videoHeight;
            
            // Handle WebM files with missing duration metadata (Infinity duration)
            if (!Number.isFinite(browserDuration) || browserDuration <= 0) {
                console.log('Duration is Infinity or invalid, attempting to probe real duration...');
                browserDuration = await probeVideoDuration(videoPlayer);
                console.log('Probed duration:', browserDuration);
            }
            
            // For MOV files: wait for fallback parsing and use its data if available
            if (isMovFile(file) && movFallbackPromise) {
                console.log('Waiting for MOV fallback parsing to complete...');
                await movFallbackPromise;
                
                if (movFallback) {
                    console.log('MOV fallback available, using parsed data for frame extraction');
                    // Use MOV fallback data (which is more accurate for PNG-in-MOV)
                    // But browser's metadata may still be useful as fallback
                    duration = movFallback.durationSeconds || browserDuration;
                    videoWidth = movFallback.width || browserWidth;
                    videoHeight = movFallback.height || browserHeight;
                    detectedFps = movFallback.fps || 30;
                    endTime = duration;
                    
                    // Mark as not decodable by browser (use fallback for frame extraction)
                    videoDecodable = false;
                    
                    // Set canvas sizes
                    firstFrameCanvas.width = videoWidth;
                    firstFrameCanvas.height = videoHeight;
                    previewCanvas.width = videoWidth;
                    previewCanvas.height = videoHeight;
                    
                    updateSliderUI();
                    uploadSection.classList.add('hidden');
                    editorSection.classList.remove('hidden');
                    resetBtn.classList.remove('hidden');
                    updateVideoInfoDisplay();
                    
                    // Draw first frame from MOV fallback
                    if (movFallback.samples && movFallback.samples.length > 0) {
                        const first = await decodeMovSampleToImageData(movFallback, movFallback.samples[0]);
                        firstFrameImageData = first;
                        
                        // Draw first frame with transparency visualization
                        const ctx = firstFrameCanvas.getContext('2d', { willReadFrequently: true });
                        drawCheckerboard(ctx, videoWidth, videoHeight);
                        const tempCanvas = document.createElement('canvas');
                        tempCanvas.width = first.width;
                        tempCanvas.height = first.height;
                        const tempCtx = tempCanvas.getContext('2d');
                        tempCtx.putImageData(first, 0, 0);
                        ctx.drawImage(tempCanvas, 0, 0);
                        
                        // Update preview with transparency visualization
                        updatePreviewWithAlpha(first);
                        
                        wandMask = new Uint8Array(videoWidth * videoHeight).fill(255);
                        
                        // Hide video player in MOV fallback mode (browser can't play it)
                        videoPlayer.style.display = 'none';
                    }
                    
                    console.log('MOV fallback mode initialized:', {
                        codec: movFallback.codecFourCC,
                        width: videoWidth,
                        height: videoHeight,
                        duration,
                        fps: detectedFps,
                        samples: movFallback.samples?.length
                    });
                    return;
                }
            }
            
            // Normal video loading (browser can decode)
            videoDecodable = true;
            duration = browserDuration;
            videoWidth = browserWidth;
            videoHeight = browserHeight;
            endTime = duration;
            
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
            if (!firstFrameImageData && videoDecodable) {
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
        // For MOV fallback mode, firstFrameImageData is already set in handleFile
        if (movFallback && !videoDecodable && firstFrameImageData) {
            const canvas = firstFrameCanvas;
            const ctx = canvas.getContext('2d');
            canvas.width = videoWidth;
            canvas.height = videoHeight;
            ctx.putImageData(firstFrameImageData, 0, 0);
            
            // Initialize wand mask
            wandMask = new Uint8Array(canvas.width * canvas.height).fill(255);
            
            // Also init preview canvas
            previewCanvas.width = videoWidth;
            previewCanvas.height = videoHeight;
            updatePreview();
            return;
        }
        
        const canvas = firstFrameCanvas;
        const ctx = canvas.getContext('2d');
        canvas.width = videoPlayer.videoWidth || videoWidth;
        canvas.height = videoPlayer.videoHeight || videoHeight;
        ctx.drawImage(videoPlayer, 0, 0);
        firstFrameImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        // Initialize wand mask
        wandMask = new Uint8Array(canvas.width * canvas.height).fill(255);
        
        // Also init preview canvas
        previewCanvas.width = videoPlayer.videoWidth || videoWidth;
        previewCanvas.height = videoPlayer.videoHeight || videoHeight;
        updatePreview();
    }

    resetBtn.addEventListener('click', () => {
        location.reload();
    });

    // --- Output Format Change Handler ---
    outputFormat.addEventListener('change', () => {
        updateAudioHint();
    });

    function updateAudioHint() {
        const format = outputFormat.value;
        const supportsAudio = format === 'webm-vp9' || format === 'webm-vp8';
        keepAudioCheckbox.disabled = !supportsAudio;
        keepAudioHint.textContent = supportsAudio 
            ? t('keep_audio_hint')
            : t('keep_audio_not_supported');
        if (!supportsAudio) {
            keepAudioCheckbox.checked = false;
        }
    }

    // Initialize audio hint
    updateAudioHint();
    applyI18nAttrs();
    updatePreviewTitle();

    // --- Mode Selection ---
    modeChromaBtn.addEventListener('click', () => switchMode('chroma'));
    modeWandBtn.addEventListener('click', () => switchMode('wand'));
    modePerframeBtn.addEventListener('click', () => switchMode('perframe'));
    modeHybridBtn.addEventListener('click', () => switchMode('hybrid'));

    function updatePreviewTitle() {
        if (currentMode === 'chroma') {
            previewLeftTitle.setAttribute('data-i18n', 'preview_first_frame');
            previewLeftTitle.textContent = t('preview_first_frame');
        } else if (currentMode === 'wand') {
            previewLeftTitle.setAttribute('data-i18n', 'preview_wand_frame');
            previewLeftTitle.textContent = t('preview_wand_frame');
        } else if (currentMode === 'perframe') {
            previewLeftTitle.setAttribute('data-i18n', 'preview_perframe');
            previewLeftTitle.textContent = t('preview_perframe');
        } else if (currentMode === 'hybrid') {
            if (hybridEditMode === 'chroma') {
                previewLeftTitle.setAttribute('data-i18n', 'preview_hybrid_chroma');
                previewLeftTitle.textContent = t('preview_hybrid_chroma');
            } else if (hybridEditMode === 'wand') {
                previewLeftTitle.setAttribute('data-i18n', 'preview_hybrid_wand');
                previewLeftTitle.textContent = t('preview_hybrid_wand');
            } else {
                previewLeftTitle.setAttribute('data-i18n', 'preview_hybrid');
                previewLeftTitle.textContent = t('preview_hybrid');
            }
        }
    }

    function applyI18nAttrs() {
        document.querySelectorAll('[data-i18n-title]').forEach((el) => {
            const key = el.getAttribute('data-i18n-title');
            if (!key) return;
            el.setAttribute('title', t(key));
        });
    }

    function switchMode(mode) {
        currentMode = mode;
        
        // Reset hybrid edit mode when switching
        hybridEditMode = null;
        hybridChromaPanel.classList.add('hidden');
        hybridWandPanel.classList.add('hidden');
        
        // Update button states
        modeChromaBtn.classList.toggle('active', mode === 'chroma');
        modeWandBtn.classList.toggle('active', mode === 'wand');
        modePerframeBtn.classList.toggle('active', mode === 'perframe');
        modeHybridBtn.classList.toggle('active', mode === 'hybrid');
        
        // Show/hide settings
        chromaSettings.classList.toggle('hidden', mode !== 'chroma');
        wandSettings.classList.toggle('hidden', mode !== 'wand');
        perframeSettings.classList.toggle('hidden', mode !== 'perframe');
        hybridSettings.classList.toggle('hidden', mode !== 'hybrid');
        
        // Update preview title
        updatePreviewTitle();
        
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
        // Handle invalid duration (0, Infinity, NaN)
        const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 1;
        const startPct = (startTime / safeDuration) * 100;
        const endPct = (endTime / safeDuration) * 100;
        
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
        // Handle Infinity or NaN (common with some WebM files that lack duration metadata)
        if (!Number.isFinite(seconds) || seconds < 0) {
            return '--:--';
        }
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
        const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 1;
        const time = pct * safeDuration;

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
            // Chroma mode: pick color and add to list
            // Get pixel from firstFrameImageData directly (not from canvas which may have checkerboard)
            const pixelIndex = (y * firstFrameImageData.width + x) * 4;
            const r = firstFrameImageData.data[pixelIndex];
            const g = firstFrameImageData.data[pixelIndex + 1];
            const b = firstFrameImageData.data[pixelIndex + 2];
            const hex = rgbToHex(r, g, b);
            
            // Update the color input for preview
            colorHex.value = hex;
            colorPreview.style.background = hex;
            
            // Automatically add the color to the list with current settings
            addChromaColor(hex);
        } else if (currentMode === 'wand') {
            // Wand mode: flood fill selection
            addWandSelection(x, y);
        } else if (currentMode === 'perframe') {
            // Per-frame mode: add selection to current frame
            addPerframeSelection(x, y);
        } else if (currentMode === 'hybrid') {
            // Hybrid mode: depends on current edit mode
            handleHybridCanvasClick(x, y);
        }
    });

    colorHex.addEventListener('input', () => {
        const hex = colorHex.value;
        if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
            colorPreview.style.background = hex;
            updateSelectedChromaColor();
        }
    });

    // Slider value displays - Chroma mode
    toleranceInput.addEventListener('input', () => {
        toleranceValue.textContent = toleranceInput.value;
        updateSelectedChromaColor();
    });

    featherInput.addEventListener('input', () => {
        featherValue.textContent = featherInput.value;
        updateSelectedChromaColor();
    });

    spillInput.addEventListener('input', () => {
        spillValue.textContent = spillInput.value;
        updateSelectedChromaColor();
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

    // --- Multi-Color Chroma Key Management ---
    function addChromaColor(hex) {
        const tolerance = parseInt(toleranceInput.value);
        const feather = parseInt(featherInput.value);
        const spill = parseInt(spillInput.value);
        
        // Check if this color already exists (within a small tolerance)
        const existingIndex = chromaColors.findIndex(c => {
            const existing = hexToRgb(c.hex);
            const newColor = hexToRgb(hex);
            if (!existing || !newColor) return false;
            const dist = Math.sqrt(
                Math.pow(existing.r - newColor.r, 2) +
                Math.pow(existing.g - newColor.g, 2) +
                Math.pow(existing.b - newColor.b, 2)
            );
            return dist < 10; // Colors within 10 units are considered the same
        });
        
        if (existingIndex >= 0) {
            // Update existing color's parameters
            chromaColors[existingIndex] = { hex, tolerance, feather, spill };
            selectedChromaIndex = existingIndex;
        } else {
            // Add new color
            chromaColors.push({ hex, tolerance, feather, spill });
            selectedChromaIndex = chromaColors.length - 1;
        }
        
        renderChromaColorList();
        updatePreview();
    }
    
    function removeChromaColor(index) {
        if (index >= 0 && index < chromaColors.length) {
            chromaColors.splice(index, 1);
            if (selectedChromaIndex >= chromaColors.length) {
                selectedChromaIndex = chromaColors.length - 1;
            }
            renderChromaColorList();
            updatePreview();
        }
    }
    
    function selectChromaColor(index) {
        if (index >= 0 && index < chromaColors.length) {
            selectedChromaIndex = index;
            const color = chromaColors[index];
            
            // Update input fields with selected color's parameters
            colorHex.value = color.hex;
            colorPreview.style.background = color.hex;
            toleranceInput.value = color.tolerance;
            toleranceValue.textContent = color.tolerance;
            featherInput.value = color.feather;
            featherValue.textContent = color.feather;
            spillInput.value = color.spill;
            spillValue.textContent = color.spill;
            
            renderChromaColorList();
        }
    }
    
    function updateSelectedChromaColor() {
        if (selectedChromaIndex >= 0 && selectedChromaIndex < chromaColors.length) {
            chromaColors[selectedChromaIndex] = {
                hex: colorHex.value,
                tolerance: parseInt(toleranceInput.value),
                feather: parseInt(featherInput.value),
                spill: parseInt(spillInput.value)
            };
            renderChromaColorList();
            debouncedUpdatePreview();
        }
    }
    
    function clearAllChromaColors() {
        chromaColors = [];
        selectedChromaIndex = -1;
        renderChromaColorList();
        updatePreview();
    }
    
    function renderChromaColorList() {
        chromaColorCount.textContent = t('chroma_color_count', { n: chromaColors.length });
        
        if (chromaColors.length === 0) {
            chromaColorList.innerHTML = `<div class="chroma-color-empty" data-i18n="chroma_color_empty">${t('chroma_color_empty')}</div>`;
            return;
        }
        
        chromaColorList.innerHTML = chromaColors.map((color, index) => `
            <div class="chroma-color-item ${index === selectedChromaIndex ? 'active' : ''}" data-index="${index}">
                <div class="chroma-color-swatch" style="background: ${color.hex};"></div>
                <div class="chroma-color-info">
                    <span class="chroma-color-hex">${color.hex.toUpperCase()}</span>
                    <span class="chroma-color-params">${t('chroma_color_params', {
                        tolerance: color.tolerance,
                        feather: color.feather,
                        spill: color.spill,
                    })}</span>
                </div>
                <div class="chroma-color-actions">
                    <button class="edit-btn" title="${t('action_edit')}" data-action="edit" data-index="${index}">
                        <i data-lucide="pencil"></i>
                    </button>
                    <button class="delete-btn" title="${t('action_delete')}" data-action="delete" data-index="${index}">
                        <i data-lucide="x"></i>
                    </button>
                </div>
            </div>
        `).join('');
        
        // Re-render icons
        if (window.lucide) lucide.createIcons();
        
        // Add event listeners
        chromaColorList.querySelectorAll('.chroma-color-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const index = parseInt(item.dataset.index);
                const action = e.target.closest('button')?.dataset.action;
                
                if (action === 'delete') {
                    e.stopPropagation();
                    removeChromaColor(index);
                } else if (action === 'edit' || !action) {
                    selectChromaColor(index);
                }
            });
        });
    }
    
    // Chroma button event listeners
    chromaAddColorBtn.addEventListener('click', () => {
        const hex = colorHex.value;
        if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
            addChromaColor(hex);
        } else {
            alert(t('alert_invalid_color'));
        }
    });
    
    chromaClearAllBtn.addEventListener('click', () => {
        if (chromaColors.length === 0) return;
        if (confirm(t('confirm_clear_all_colors'))) {
            clearAllChromaColors();
        }
    });

    // --- Hybrid Mode Functions ---
    function handleHybridCanvasClick(x, y) {
        if (!firstFrameImageData) return;
        
        if (hybridEditMode === 'chroma') {
            // Pick color for chroma panel from firstFrameImageData directly
            const pixelIndex = (y * firstFrameImageData.width + x) * 4;
            const r = firstFrameImageData.data[pixelIndex];
            const g = firstFrameImageData.data[pixelIndex + 1];
            const b = firstFrameImageData.data[pixelIndex + 2];
            const hex = rgbToHex(r, g, b);
            
            hybridColorHex.value = hex;
            hybridColorPreview.style.background = hex;
            updateHybridPreview();
        } else if (hybridEditMode === 'wand') {
            // Add wand selection point
            addHybridWandSelection(x, y);
        }
    }
    
    function addHybridWandSelection(x, y) {
        if (!firstFrameImageData) return;
        
        hybridTempWandPoints.push({ x, y });
        
        // Initialize temp mask if needed
        if (!hybridTempWandMask) {
            hybridTempWandMask = new Uint8Array(firstFrameImageData.width * firstFrameImageData.height).fill(255);
        }
        
        const tolerance = parseInt(hybridWandToleranceInput.value);
        const contiguous = hybridWandContiguous.checked;
        const width = firstFrameImageData.width;
        const height = firstFrameImageData.height;
        const data = firstFrameImageData.data;
        
        // Get seed color
        const seedIdx = (y * width + x) * 4;
        const seedR = data[seedIdx];
        const seedG = data[seedIdx + 1];
        const seedB = data[seedIdx + 2];
        
        if (contiguous) {
            hybridFloodFillSelection(x, y, seedR, seedG, seedB, tolerance, hybridTempWandMask);
        } else {
            hybridGlobalColorSelection(seedR, seedG, seedB, tolerance, hybridTempWandMask);
        }
        
        updateHybridWandSelectionCount();
        updateHybridPreview();
    }
    
    function hybridFloodFillSelection(startX, startY, seedR, seedG, seedB, tolerance, mask) {
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
    }
    
    function hybridGlobalColorSelection(seedR, seedG, seedB, tolerance, mask) {
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
                mask[i] = 0;
            }
        }
    }
    
    function recalculateHybridWandMask() {
        if (!firstFrameImageData || hybridTempWandPoints.length === 0) return;
        
        hybridTempWandMask = new Uint8Array(firstFrameImageData.width * firstFrameImageData.height).fill(255);
        
        const tolerance = parseInt(hybridWandToleranceInput.value);
        const contiguous = hybridWandContiguous.checked;
        const width = firstFrameImageData.width;
        const data = firstFrameImageData.data;
        
        for (const point of hybridTempWandPoints) {
            const seedIdx = (point.y * width + point.x) * 4;
            const seedR = data[seedIdx];
            const seedG = data[seedIdx + 1];
            const seedB = data[seedIdx + 2];
            
            if (contiguous) {
                hybridFloodFillSelection(point.x, point.y, seedR, seedG, seedB, tolerance, hybridTempWandMask);
            } else {
                hybridGlobalColorSelection(seedR, seedG, seedB, tolerance, hybridTempWandMask);
            }
        }
        
        updateHybridPreview();
    }
    
    function clearHybridWandSelection() {
        hybridTempWandPoints = [];
        hybridTempWandMask = null;
        updateHybridWandSelectionCount();
        updateHybridPreview();
    }
    
    function updateHybridWandSelectionCount() {
        const count = hybridTempWandPoints.length;
        setI18nCount(hybridWandSelectionCount, 'wand_selection_count', count);

    }
    
    // Add hybrid operation
    function addHybridChromaOperation() {
        const hex = hybridColorHex.value;
        if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) {
            alert(t('alert_invalid_color'));
            return;
        }
        
        hybridOperations.push({
            type: 'chroma',
            params: {
                hex: hex,
                tolerance: parseInt(hybridToleranceInput.value),
                feather: parseInt(hybridFeatherInput.value),
                spill: parseInt(hybridSpillInput.value)
            }
        });
        
        // Reset panel
        hybridEditMode = null;
        hybridChromaPanel.classList.add('hidden');
        
        renderHybridOperationList();
        updatePreview();
    }
    
    function addHybridWandOperation() {
        if (hybridTempWandPoints.length === 0) {
            alert(t('alert_no_wand_selection'));
            return;
        }
        
        hybridOperations.push({
            type: 'wand',
            params: {
                points: JSON.parse(JSON.stringify(hybridTempWandPoints)),
                tolerance: parseInt(hybridWandToleranceInput.value),
                feather: parseInt(hybridWandFeatherInput.value),
                contiguous: hybridWandContiguous.checked
            }
        });
        
        // Reset panel
        hybridEditMode = null;
        hybridWandPanel.classList.add('hidden');
        clearHybridWandSelection();
        
        renderHybridOperationList();
        updatePreview();
    }
    
    function removeHybridOperation(index) {
        if (index >= 0 && index < hybridOperations.length) {
            hybridOperations.splice(index, 1);
            renderHybridOperationList();
            updatePreview();
        }
    }
    
    function moveHybridOperation(index, direction) {
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= hybridOperations.length) return;
        
        const temp = hybridOperations[index];
        hybridOperations[index] = hybridOperations[newIndex];
        hybridOperations[newIndex] = temp;
        
        renderHybridOperationList();
        updatePreview();
    }
    
    function clearAllHybridOperations() {
        hybridOperations = [];
        renderHybridOperationList();
        updatePreview();
    }
    
    function renderHybridOperationList() {
        setI18nCount(hybridOperationCount, 'hybrid_operation_count', hybridOperations.length);

        
        if (hybridOperations.length === 0) {
            hybridOperationList.innerHTML = `<div class="hybrid-operation-empty" data-i18n="hybrid_operation_empty">${t('hybrid_operation_empty')}</div>`;
            return;
        }
        
        hybridOperationList.innerHTML = hybridOperations.map((op, index) => {
            const isChroma = op.type === 'chroma';
            const iconClass = isChroma ? 'chroma' : 'wand';
            const iconName = isChroma ? 'palette' : 'wand-2';
            const typeText = isChroma ? t('mode_chroma') : t('mode_wand');
            
            let detail;
            if (isChroma) {
                detail = t('hybrid_detail_chroma', {
                    hex: op.params.hex.toUpperCase(),
                    tolerance: op.params.tolerance,
                    feather: op.params.feather,
                });
            } else {
                detail = t('hybrid_detail_wand', {
                    count: op.params.points.length,
                    tolerance: op.params.tolerance,
                    feather: op.params.feather,
                });
            }
            
            return `
                <div class="hybrid-operation-item" data-index="${index}">
                    <div class="hybrid-operation-order">${index + 1}</div>
                    <div class="hybrid-operation-icon ${iconClass}">
                        <i data-lucide="${iconName}"></i>
                    </div>
                    ${isChroma ? `<div class="chroma-color-swatch" style="background: ${op.params.hex};"></div>` : ''}
                    <div class="hybrid-operation-info">
                        <span class="hybrid-operation-type">${typeText}</span>
                        <span class="hybrid-operation-detail">${detail}</span>
                    </div>
                    <div class="hybrid-operation-actions">
                        ${index > 0 ? `<button class="move-btn" title="${t('action_move_up')}" data-action="up" data-index="${index}"><i data-lucide="chevron-up"></i></button>` : ''}
                        ${index < hybridOperations.length - 1 ? `<button class="move-btn" title="${t('action_move_down')}" data-action="down" data-index="${index}"><i data-lucide="chevron-down"></i></button>` : ''}
                        <button class="delete-btn" title="${t('action_delete')}" data-action="delete" data-index="${index}">
                            <i data-lucide="x"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        
        // Re-render icons
        if (window.lucide) lucide.createIcons();
        
        // Add event listeners
        hybridOperationList.querySelectorAll('.hybrid-operation-item').forEach(item => {
            const buttons = item.querySelectorAll('button');
            buttons.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    const index = parseInt(btn.dataset.index);
                    
                    if (action === 'delete') {
                        removeHybridOperation(index);
                    } else if (action === 'up') {
                        moveHybridOperation(index, -1);
                    } else if (action === 'down') {
                        moveHybridOperation(index, 1);
                    }
                });
            });
        });
    }
    
    function updateHybridPreview() {
        if (!firstFrameImageData) return;
        
        const ctx = previewCanvas.getContext('2d');
        const imageData = new ImageData(
            new Uint8ClampedArray(firstFrameImageData.data),
            firstFrameImageData.width,
            firstFrameImageData.height
        );
        
        // First apply all existing operations
        processHybridOperations(imageData.data, hybridOperations);
        
        // Then apply current editing operation preview
        if (hybridEditMode === 'chroma') {
            const hex = hybridColorHex.value;
            if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
                processMultiChromaKey(imageData.data, [{
                    hex: hex,
                    tolerance: parseInt(hybridToleranceInput.value),
                    feather: parseInt(hybridFeatherInput.value),
                    spill: parseInt(hybridSpillInput.value)
                }]);
            }
        } else if (hybridEditMode === 'wand' && hybridTempWandMask) {
            const feather = parseInt(hybridWandFeatherInput.value);
            const width = firstFrameImageData.width;
            const height = firstFrameImageData.height;
            
            let finalMask = hybridTempWandMask;
            if (feather > 0) {
                finalMask = applyFeatherToMask(hybridTempWandMask, width, height, feather);
            }
            
            // Apply mask (blend with existing alpha)
            for (let i = 0; i < finalMask.length; i++) {
                imageData.data[i * 4 + 3] = Math.min(imageData.data[i * 4 + 3], finalMask[i]);
            }
        }
        
        // Draw with transparency visualization (checkerboard background)
        drawCheckerboard(ctx, imageData.width, imageData.height);
        
        // Use temp canvas for proper alpha compositing
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = imageData.width;
        tempCanvas.height = imageData.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.putImageData(imageData, 0, 0);
        ctx.drawImage(tempCanvas, 0, 0);
    }
    
    // Process all hybrid operations in order
    function processHybridOperations(data, operations) {
        const width = firstFrameImageData.width;
        const height = firstFrameImageData.height;
        
        for (const op of operations) {
            if (op.type === 'chroma') {
                // Apply chroma key
                processMultiChromaKey(data, [op.params]);
            } else if (op.type === 'wand') {
                // Calculate and apply wand mask
                const mask = calculateHybridWandMask(op.params, width, height, data);
                let finalMask = mask;
                
                if (op.params.feather > 0) {
                    finalMask = applyFeatherToMask(mask, width, height, op.params.feather);
                }
                
                // Apply mask (blend with existing alpha - take minimum)
                for (let i = 0; i < finalMask.length; i++) {
                    data[i * 4 + 3] = Math.min(data[i * 4 + 3], finalMask[i]);
                }
            }
        }
    }
    
    // Calculate wand mask for hybrid operation
    function calculateHybridWandMask(params, width, height, data) {
        const mask = new Uint8Array(width * height).fill(255);
        const tolerance = params.tolerance;
        const toleranceSq = tolerance * tolerance;
        
        for (const point of params.points) {
            const seedIdx = (point.y * width + point.x) * 4;
            const seedR = data[seedIdx];
            const seedG = data[seedIdx + 1];
            const seedB = data[seedIdx + 2];
            
            if (params.contiguous) {
                // Flood fill
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
    
    // Hybrid mode event listeners
    hybridAddChromaBtn.addEventListener('click', () => {
        hybridEditMode = 'chroma';
        hybridChromaPanel.classList.remove('hidden');
        hybridWandPanel.classList.add('hidden');
        
        // Update preview title
        updatePreviewTitle();
        
        if (window.lucide) lucide.createIcons();
    });
    
    hybridAddWandBtn.addEventListener('click', () => {
        hybridEditMode = 'wand';
        hybridWandPanel.classList.remove('hidden');
        hybridChromaPanel.classList.add('hidden');
        clearHybridWandSelection();
        
        // Update preview title
        updatePreviewTitle();
        
        if (window.lucide) lucide.createIcons();
    });
    
    hybridChromaCancelBtn.addEventListener('click', () => {
        hybridEditMode = null;
        hybridChromaPanel.classList.add('hidden');
        updatePreviewTitle();
        updatePreview();
    });
    
    hybridWandCancelBtn.addEventListener('click', () => {
        hybridEditMode = null;
        hybridWandPanel.classList.add('hidden');
        clearHybridWandSelection();
        updatePreviewTitle();
        updatePreview();
    });
    
    hybridChromaConfirmBtn.addEventListener('click', () => {
        addHybridChromaOperation();
    });
    
    hybridWandConfirmBtn.addEventListener('click', () => {
        addHybridWandOperation();
    });
    
    hybridClearAllBtn.addEventListener('click', () => {
        if (hybridOperations.length === 0) return;
        if (confirm(t('confirm_clear_all_hybrid'))) {
            clearAllHybridOperations();
        }
    });
    
    hybridWandClearBtn.addEventListener('click', () => {
        clearHybridWandSelection();
    });
    
    // Hybrid panel slider event listeners
    hybridToleranceInput.addEventListener('input', () => {
        hybridToleranceValue.textContent = hybridToleranceInput.value;
        if (hybridEditMode === 'chroma') updateHybridPreview();
    });
    
    hybridFeatherInput.addEventListener('input', () => {
        hybridFeatherValue.textContent = hybridFeatherInput.value;
        if (hybridEditMode === 'chroma') updateHybridPreview();
    });
    
    hybridSpillInput.addEventListener('input', () => {
        hybridSpillValue.textContent = hybridSpillInput.value;
        if (hybridEditMode === 'chroma') updateHybridPreview();
    });
    
    hybridColorHex.addEventListener('input', () => {
        const hex = hybridColorHex.value;
        if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
            hybridColorPreview.style.background = hex;
            if (hybridEditMode === 'chroma') updateHybridPreview();
        }
    });
    
    hybridWandToleranceInput.addEventListener('input', () => {
        hybridWandToleranceValue.textContent = hybridWandToleranceInput.value;
        recalculateHybridWandMask();
    });
    
    hybridWandFeatherInput.addEventListener('input', () => {
        hybridWandFeatherValue.textContent = hybridWandFeatherInput.value;
        if (hybridEditMode === 'wand') updateHybridPreview();
    });
    
    hybridWandContiguous.addEventListener('change', () => {
        recalculateHybridWandMask();
    });

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
        setI18nCount(wandSelectionCount, 'wand_selection_count', count);

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
        
        perframeData.frames = [];
        perframeData.frameCount = totalFrames;
        perframeData.selectionsByFrame = {};
        
        // Check if we should use MOV fallback
        if (movFallback && !videoDecodable) {
            console.log('Using MOV fallback for per-frame extraction');
            
            // Calculate frame indices for the selected time range
            const movFps = movFallback.fps || fps;
            const startFrameIdx = Math.floor(startTime * movFps);
            const endFrameIdx = Math.min(
                Math.ceil(endTime * movFps),
                movFallback.samples.length
            );
            
            const movTotalFrames = endFrameIdx - startFrameIdx;
            
            for (let i = startFrameIdx; i < endFrameIdx; i++) {
                const imageData = await decodeMovSampleToImageData(movFallback, movFallback.samples[i]);
                perframeData.frames.push(imageData);
                
                const progress = (i - startFrameIdx + 1) / movTotalFrames;
                perframeExtractBar.style.width = `${progress * 100}%`;
                perframeExtractPercent.textContent = `${Math.round(progress * 100)}%`;
                
                // Yield to UI
                if ((i - startFrameIdx) % 5 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
            
            perframeData.frameCount = perframeData.frames.length;
        } else {
            // Normal extraction from video element
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = videoPlayer.videoWidth || videoWidth;
            canvas.height = videoPlayer.videoHeight || videoHeight;
            
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
        }
        
        perframeData.extractionDone = true;
        perframeData.currentFrameIndex = 0;
        
        // Hide progress
        perframeExtractProgress.classList.add('hidden');
        
        // Update UI
        const actualFrameCount = perframeData.frames.length;
        perframeTotalSpan.textContent = actualFrameCount;
        perframeCurrentInput.value = 1;
        perframeCurrentInput.max = actualFrameCount;
        copyRangeEnd.max = actualFrameCount;
        copyRangeEnd.value = actualFrameCount;
        
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
        perframeSelectionCount.textContent = t('perframe_selection_count', { n: count });
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
            alert(t('alert_no_perframe_selection'));
            return;
        }
        
        // Copy to all frames
        for (let i = 0; i < perframeData.frameCount; i++) {
            perframeData.selectionsByFrame[i] = JSON.parse(JSON.stringify(currentSelections));
        }
        
        updateTimelineHighlight();
        alert(t('perframe_copied_to_all', { n: perframeData.frameCount }));
    });
    
    perframeCopyToRangeBtn.addEventListener('click', () => {
        const currentSelections = perframeData.selectionsByFrame[perframeData.currentFrameIndex] || [];
        if (currentSelections.length === 0) {
            alert(t('alert_no_perframe_selection'));
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
            alert(t('alert_invalid_range'));
            return;
        }
        
        const currentSelections = perframeData.selectionsByFrame[perframeData.currentFrameIndex] || [];
        
        for (let i = start; i <= end; i++) {
            perframeData.selectionsByFrame[i] = JSON.parse(JSON.stringify(currentSelections));
        }
        
        copyRangePanel.classList.add('hidden');
        updateTimelineHighlight();
        
        const count = end - start + 1;
        alert(t('perframe_copied_to_range', { n: count }));
    });
    
    copyRangeCancelBtn.addEventListener('click', () => {
        copyRangePanel.classList.add('hidden');
    });
    
    perframeClearAllBtn.addEventListener('click', () => {
        if (!confirm(t('confirm_clear_all'))) {
            return;
        }
        
        perframeData.selectionsByFrame = {};
        updatePerframeSelectionCount();
        updateTimelineHighlight();
        updatePreview();
    });

    // --- Preview Update ---
    
    // Update preview with transparency visualization (checkerboard pattern for transparent areas)
    async function updatePreviewWithAlpha(imageData) {
        const ctx = previewCanvas.getContext('2d');
        const w = imageData.width;
        const h = imageData.height;
        
        // First draw checkerboard pattern for transparency
        drawCheckerboard(ctx, w, h);
        
        // Convert ImageData to ImageBitmap for proper alpha compositing
        // putImageData doesn't do alpha blending, it replaces pixels directly
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w;
        tempCanvas.height = h;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.putImageData(imageData, 0, 0);
        
        // Draw with alpha compositing
        ctx.drawImage(tempCanvas, 0, 0);
    }
    
    // Draw checkerboard pattern (standard transparency visualization)
    function drawCheckerboard(ctx, width, height, squareSize = 8) {
        const colors = ['#ffffff', '#cccccc'];
        for (let y = 0; y < height; y += squareSize) {
            for (let x = 0; x < width; x += squareSize) {
                const colorIndex = ((Math.floor(x / squareSize) + Math.floor(y / squareSize)) % 2);
                ctx.fillStyle = colors[colorIndex];
                ctx.fillRect(x, y, squareSize, squareSize);
            }
        }
    }
    
    function updatePreview() {
        if (currentMode === 'perframe') {
            updatePerframePreview();
            return;
        }
        
        if (currentMode === 'hybrid') {
            updateHybridPreview();
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
            // Process all chroma colors
            if (chromaColors.length > 0) {
                processMultiChromaKey(imageData.data, chromaColors);
            }
        } else {
            // Wand mode
            const feather = parseInt(wandFeatherInput.value);
            processWandMask(imageData.data, feather);
        }
        
        // Draw with transparency visualization (checkerboard background)
        drawCheckerboard(ctx, previewCanvas.width, previewCanvas.height);
        
        // Use temp canvas for proper alpha compositing
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = imageData.width;
        tempCanvas.height = imageData.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.putImageData(imageData, 0, 0);
        ctx.drawImage(tempCanvas, 0, 0);
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
        
        // Apply mask to image - preserve original transparency (take minimum)
        for (let i = 0; i < finalMask.length; i++) {
            imageData.data[i * 4 + 3] = Math.min(imageData.data[i * 4 + 3], finalMask[i]);
        }
        
        // Draw with transparency visualization (checkerboard background)
        drawCheckerboard(ctx, frame.width, frame.height);
        
        // Use temp canvas for proper alpha compositing
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = imageData.width;
        tempCanvas.height = imageData.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.putImageData(imageData, 0, 0);
        ctx.drawImage(tempCanvas, 0, 0);
    }

    function processChromaKey(data, targetHsv, tolerance, feather, spill) {
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i+1], b = data[i+2];
            const originalAlpha = data[i+3];
            const hsv = rgbToHsv(r, g, b);
            
            let dh = Math.abs(hsv.h - targetHsv.h);
            if (dh > 0.5) dh = 1 - dh;
            const ds = Math.abs(hsv.s - targetHsv.s);
            const dv = Math.abs(hsv.v - targetHsv.v);
            
            const distance = Math.sqrt(Math.pow(dh * 2.0, 2) + Math.pow(ds * 0.5, 2) + Math.pow(dv * 0.2, 2));
            
            if (distance < tolerance) {
                const innerBoundary = tolerance * (1 - feather);
                let computedAlpha;
                if (distance > innerBoundary && feather > 0) {
                    const alpha = (distance - innerBoundary) / (tolerance - innerBoundary);
                    computedAlpha = Math.floor(255 * alpha);
                } else {
                    computedAlpha = 0;
                }
                // Preserve original transparency (take minimum)
                data[i+3] = Math.min(originalAlpha, computedAlpha);
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

    // Multi-color chroma key processing
    function processMultiChromaKey(data, colors) {
        // Process all colors - for each pixel, find the minimum alpha across all color keys
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i+1], b = data[i+2];
            const hsv = rgbToHsv(r, g, b);
            
            let minAlpha = 255;
            let totalSpillFactor = 0;
            
            for (const colorConfig of colors) {
                const targetRgb = hexToRgb(colorConfig.hex);
                if (!targetRgb) continue;
                
                const targetHsv = rgbToHsv(targetRgb.r, targetRgb.g, targetRgb.b);
                const tolerance = colorConfig.tolerance / 100;
                const feather = colorConfig.feather / 100;
                const spill = colorConfig.spill / 100;
                
                let dh = Math.abs(hsv.h - targetHsv.h);
                if (dh > 0.5) dh = 1 - dh;
                const ds = Math.abs(hsv.s - targetHsv.s);
                const dv = Math.abs(hsv.v - targetHsv.v);
                
                const distance = Math.sqrt(Math.pow(dh * 2.0, 2) + Math.pow(ds * 0.5, 2) + Math.pow(dv * 0.2, 2));
                
                if (distance < tolerance) {
                    const innerBoundary = tolerance * (1 - feather);
                    let alpha;
                    if (distance > innerBoundary && feather > 0) {
                        alpha = Math.floor(255 * (distance - innerBoundary) / (tolerance - innerBoundary));
                    } else {
                        alpha = 0;
                    }
                    minAlpha = Math.min(minAlpha, alpha);
                }
                
                // Accumulate spill suppression
                if (distance < tolerance * 1.5 && spill > 0) {
                    const spillAmount = Math.max(0, 1 - (distance / (tolerance * 1.5))) * spill;
                    totalSpillFactor = Math.max(totalSpillFactor, spillAmount);
                }
            }
            
            // Apply the minimum alpha (most transparent wins)
            // Preserve original transparency - take the minimum of computed alpha and original alpha
            data[i+3] = Math.min(data[i+3], minAlpha);
            
            // Apply combined spill suppression
            if (minAlpha > 0 && totalSpillFactor > 0) {
                const gray = (r + g + b) / 3;
                data[i] = r * (1 - totalSpillFactor) + gray * totalSpillFactor;
                data[i+1] = g * (1 - totalSpillFactor) + gray * totalSpillFactor;
                data[i+2] = b * (1 - totalSpillFactor) + gray * totalSpillFactor;
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
        
        // Apply mask to image data - preserve original transparency (take minimum)
        for (let i = 0; i < finalMask.length; i++) {
            data[i * 4 + 3] = Math.min(data[i * 4 + 3], finalMask[i]);
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
            if (chromaColors.length === 0) {
                alert(t('alert_no_color'));
                return;
            }
        } else if (currentMode === 'wand') {
            if (wandSelectionPoints.length === 0) {
                alert(t('alert_no_wand_selection'));
                return;
            }
        } else if (currentMode === 'perframe') {
            // Check if any frame has selections
            const hasAnySelection = Object.values(perframeData.selectionsByFrame).some(arr => arr && arr.length > 0);
            if (!hasAnySelection) {
                alert(t('alert_no_perframe_selection'));
                return;
            }
        } else if (currentMode === 'hybrid') {
            if (hybridOperations.length === 0) {
                alert(t('alert_no_hybrid_operation'));
                return;
            }
        }

        const fps = detectedFps; // Use detected FPS to match input video
        const format = outputFormat.value;
        const quality = parseFloat(videoQuality.value);
        const keepAudio = keepAudioCheckbox.checked && (format === 'webm-vp9' || format === 'webm-vp8');

        loadingOverlay.classList.remove('hidden');
        progressBar.style.width = '0%';
        progressText.textContent = '0%';
        
        // Extract audio first if needed
        let audioData = null;
        if (keepAudio) {
            loadingText.textContent = t('extracting_audio');
            audioData = await extractAudio();
        }
        
        loadingText.textContent = t('extracting_frames');

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

            loadingText.textContent = t('processing_bg');

            // Step 2: Process frames based on mode
            let processedFrames;
            if (currentMode === 'chroma') {
                // Use multi-color processing
                processedFrames = await processFramesMultiChroma(frames, chromaColors, (progress) => {
                    progressBar.style.width = `${50 + progress * 30}%`;
                    progressText.textContent = `${Math.round(50 + progress * 30)}%`;
                });
            } else if (currentMode === 'wand') {
                const featherRadius = parseInt(wandFeatherInput.value);
                processedFrames = await processFramesWand(frames, featherRadius, (progress) => {
                    progressBar.style.width = `${50 + progress * 30}%`;
                    progressText.textContent = `${Math.round(50 + progress * 30)}%`;
                });
            } else if (currentMode === 'perframe') {
                // Per-frame mode
                const featherRadius = parseInt(perframeFeatherInput.value);
                processedFrames = await processFramesPerframe(frames, featherRadius, (progress) => {
                    progressBar.style.width = `${50 + progress * 30}%`;
                    progressText.textContent = `${Math.round(50 + progress * 30)}%`;
                });
            } else if (currentMode === 'hybrid') {
                // Hybrid mode
                processedFrames = await processFramesHybrid(frames, hybridOperations, (progress) => {
                    progressBar.style.width = `${50 + progress * 30}%`;
                    progressText.textContent = `${Math.round(50 + progress * 30)}%`;
                });
            }

            loadingText.textContent = t('encoding_video');

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
            } else if (format === 'mov') {
                await exportMov(processedFrames, fps, quality, (progress) => {
                    progressBar.style.width = `${80 + progress * 20}%`;
                    progressText.textContent = `${Math.round(80 + progress * 20)}%`;
                });
            } else {
                // WebM VP8/VP9
                await encodeVideo(processedFrames, fps, format, quality, audioData, (progress) => {
                    progressBar.style.width = `${80 + progress * 20}%`;
                    progressText.textContent = `${Math.round(80 + progress * 20)}%`;
                });
            }

            loadingOverlay.classList.add('hidden');
        } catch (e) {
            console.error(e);
            alert(t('error_processing') + e.message);
            loadingOverlay.classList.add('hidden');
        }
    });

    // Extract audio from video file
    async function extractAudio() {
        if (!videoFile) return null;
        
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const arrayBuffer = await videoFile.arrayBuffer();
            const audioData = await audioContext.decodeAudioData(arrayBuffer);
            
            // Calculate the audio segment corresponding to the selected time range
            const sampleRate = audioData.sampleRate;
            const startSample = Math.floor(startTime * sampleRate);
            const endSample = Math.floor(endTime * sampleRate);
            const duration = endSample - startSample;
            
            // Create a new AudioBuffer for the segment
            const segmentBuffer = audioContext.createBuffer(
                audioData.numberOfChannels,
                duration,
                sampleRate
            );
            
            // Copy the relevant portion of each channel
            for (let channel = 0; channel < audioData.numberOfChannels; channel++) {
                const channelData = audioData.getChannelData(channel);
                const segmentData = segmentBuffer.getChannelData(channel);
                for (let i = 0; i < duration; i++) {
                    segmentData[i] = channelData[startSample + i];
                }
            }
            
            await audioContext.close();
            return segmentBuffer;
        } catch (e) {
            console.warn('Failed to extract audio:', e.message);
            return null;
        }
    }

    async function extractFrames(fps, onProgress) {
        // If using MOV fallback (browser can't decode the video), extract from parsed MOV data
        if (movFallback && !videoDecodable) {
            console.log('Using MOV fallback for frame extraction');
            const segmentDuration = endTime - startTime;
            const totalFrames = Math.round(segmentDuration * fps);
            
            // Calculate frame indices for the selected time range
            const movFps = movFallback.fps || fps;
            const startFrameIdx = Math.floor(startTime * movFps);
            const endFrameIdx = Math.min(
                Math.ceil(endTime * movFps),
                movFallback.samples.length
            );
            
            console.log(`Extracting frames ${startFrameIdx} to ${endFrameIdx} from MOV fallback (${movFallback.samples.length} total samples)`);
            
            const frames = await extractFramesFromMovFallback(movFallback, startFrameIdx, endFrameIdx, onProgress);
            console.log(`Extracted ${frames.length} frames from MOV fallback`);
            return frames;
        }
        
        // Normal extraction from video element
        const frames = [];
        const segmentDuration = endTime - startTime;
        // Calculate exact frame count based on duration and fps
        const totalFrames = Math.round(segmentDuration * fps);
        const interval = segmentDuration / totalFrames;
        
        console.log(`Extracting ${totalFrames} frames from ${startTime.toFixed(3)}s to ${endTime.toFixed(3)}s (${segmentDuration.toFixed(3)}s @ ${fps} FPS)`);
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = videoPlayer.videoWidth || videoWidth;
        canvas.height = videoPlayer.videoHeight || videoHeight;

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

    async function processFramesMultiChroma(frames, colors, onProgress) {
        const processedFrames = [];
        
        for (let i = 0; i < frames.length; i++) {
            const imageData = new ImageData(
                new Uint8ClampedArray(frames[i].data),
                frames[i].width,
                frames[i].height
            );
            
            processMultiChromaKey(imageData.data, colors);
            processedFrames.push(imageData);
            
            onProgress((i + 1) / frames.length);
            
            if (i % 10 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        return processedFrames;
    }

    async function processFramesHybrid(frames, operations, onProgress) {
        const processedFrames = [];
        
        for (let i = 0; i < frames.length; i++) {
            const imageData = new ImageData(
                new Uint8ClampedArray(frames[i].data),
                frames[i].width,
                frames[i].height
            );
            
            // Apply all hybrid operations in order
            processHybridOperationsForFrame(imageData.data, operations, frames[i].width, frames[i].height);
            processedFrames.push(imageData);
            
            onProgress((i + 1) / frames.length);
            
            if (i % 10 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        return processedFrames;
    }

    // Process hybrid operations for a single frame (used during export)
    function processHybridOperationsForFrame(data, operations, width, height) {
        for (const op of operations) {
            if (op.type === 'chroma') {
                // Apply chroma key
                processMultiChromaKey(data, [op.params]);
            } else if (op.type === 'wand') {
                // Calculate mask based on current frame's pixel data
                const mask = calculateHybridWandMaskForFrame(op.params, width, height, data);
                let finalMask = mask;
                
                if (op.params.feather > 0) {
                    finalMask = applyFeatherToMask(mask, width, height, op.params.feather);
                }
                
                // Apply mask (blend with existing alpha - take minimum)
                for (let i = 0; i < finalMask.length; i++) {
                    data[i * 4 + 3] = Math.min(data[i * 4 + 3], finalMask[i]);
                }
            }
        }
    }

    // Calculate wand mask for a frame during export
    function calculateHybridWandMaskForFrame(params, width, height, data) {
        const mask = new Uint8Array(width * height).fill(255);
        const tolerance = params.tolerance;
        const toleranceSq = tolerance * tolerance;
        
        for (const point of params.points) {
            // Ensure point is within bounds
            if (point.x < 0 || point.x >= width || point.y < 0 || point.y >= height) continue;
            
            const seedIdx = (point.y * width + point.x) * 4;
            const seedR = data[seedIdx];
            const seedG = data[seedIdx + 1];
            const seedB = data[seedIdx + 2];
            
            if (params.contiguous) {
                // Flood fill
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
            
            // Apply mask - preserve original transparency (take minimum)
            for (let j = 0; j < finalMask.length; j++) {
                imageData.data[j * 4 + 3] = Math.min(imageData.data[j * 4 + 3], finalMask[j]);
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
            
            // Apply mask - preserve original transparency (take minimum)
            for (let j = 0; j < finalMask.length; j++) {
                imageData.data[j * 4 + 3] = Math.min(imageData.data[j * 4 + 3], finalMask[j]);
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

    async function encodeVideo(frames, fps, format, quality, audioBuffer, onProgress) {
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
                await encodeWithWebCodecsMuxer(frames, fps, quality, audioBuffer, canvas, ctx, onProgress);
                return;
            } catch (e) {
                console.warn('WebCodecs+Muxer encoding failed:', e.message);
                console.log('Falling back to MediaRecorder...');
            }
        }

        // Fallback to MediaRecorder (no audio support)
        await encodeWithMediaRecorder(frames, fps, format, quality, canvas, ctx, onProgress);
    }

    async function encodeWithWebCodecsMuxer(frames, fps, quality, audioBuffer, canvas, ctx, onProgress) {
        const width = frames[0].width;
        const height = frames[0].height;
        const frameDurationUs = Math.round(1000000 / fps);
        
        // Collect all encoded chunks
        const fileChunks = [];
        
        // Muxer configuration
        const muxerConfig = {
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
        };
        
        // Add audio configuration if we have audio
        if (audioBuffer) {
            muxerConfig.audio = {
                codec: 'A_OPUS',
                numberOfChannels: audioBuffer.numberOfChannels,
                sampleRate: audioBuffer.sampleRate
            };
        }
        
        // Create WebM muxer with precise timing
        const muxer = new WebMMuxer.Muxer(muxerConfig);

        // Configure video encoder
        const videoEncoder = new VideoEncoder({
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
            throw new Error(t('error_no_supported_codec'));
        }
        
        videoEncoder.configure(codecConfig);
        
        // Configure audio encoder if we have audio
        let audioEncoder = null;
        if (audioBuffer && typeof AudioEncoder !== 'undefined') {
            try {
                audioEncoder = new AudioEncoder({
                    output: (chunk, metadata) => {
                        muxer.addAudioChunk(chunk, metadata);
                    },
                    error: (e) => {
                        console.warn('AudioEncoder error:', e.message);
                    }
                });
                
                const audioConfig = {
                    codec: 'opus',
                    numberOfChannels: audioBuffer.numberOfChannels,
                    sampleRate: audioBuffer.sampleRate,
                    bitrate: 128000
                };
                
                const audioSupport = await AudioEncoder.isConfigSupported(audioConfig);
                if (audioSupport.supported) {
                    audioEncoder.configure(audioConfig);
                } else {
                    console.warn('Opus audio codec not supported');
                    audioEncoder = null;
                }
            } catch (e) {
                console.warn('Failed to setup audio encoder:', e.message);
                audioEncoder = null;
            }
        }

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
            videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
            videoFrame.close();
            
            onProgress((i + 1) / frames.length * 0.90);
            
            // Yield to UI periodically
            if (i % 5 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        // Encode audio if we have an encoder
        if (audioEncoder && audioBuffer) {
            const numberOfChannels = audioBuffer.numberOfChannels;
            const sampleRate = audioBuffer.sampleRate;
            const length = audioBuffer.length;
            
            // Encode audio in chunks to avoid memory issues
            const chunkSize = sampleRate; // 1 second chunks
            for (let offset = 0; offset < length; offset += chunkSize) {
                const chunkLength = Math.min(chunkSize, length - offset);
                
                // For f32-planar format, data should be arranged by channel (not interleaved)
                // [ch0_sample0, ch0_sample1, ..., ch1_sample0, ch1_sample1, ...]
                const chunkData = new Float32Array(chunkLength * numberOfChannels);
                
                for (let ch = 0; ch < numberOfChannels; ch++) {
                    const channelData = audioBuffer.getChannelData(ch);
                    const channelOffset = ch * chunkLength;
                    for (let i = 0; i < chunkLength; i++) {
                        chunkData[channelOffset + i] = channelData[offset + i];
                    }
                }
                
                const audioData = new AudioData({
                    format: 'f32-planar',
                    sampleRate: sampleRate,
                    numberOfFrames: chunkLength,
                    numberOfChannels: numberOfChannels,
                    timestamp: Math.round(offset / sampleRate * 1000000), // microseconds
                    data: chunkData
                });
                
                audioEncoder.encode(audioData);
                audioData.close();
            }
            
            await audioEncoder.flush();
            audioEncoder.close();
        }

        // Wait for video encoder to finish
        await videoEncoder.flush();
        videoEncoder.close();
        
        // Finalize muxer
        muxer.finalize();
        
        onProgress(0.95);
        
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
        
        console.log(`WebM created: ${(blob.size / 1024 / 1024).toFixed(2)} MB, audio: ${audioBuffer ? 'yes' : 'no'}`);
        
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

        // Hold last frame for half a frame duration (reduced from full frame)
        await new Promise(resolve => setTimeout(resolve, frameDurationMs * 0.5));
        recorder.stop();

        const blob = await recordingPromise;
        const recordDuration = performance.now() - recordStartTime;
        
        console.log(`MediaRecorder: target=${targetTotalMs.toFixed(1)}ms, actual=${recordDuration.toFixed(1)}ms`);
        
        // Fix WebM duration metadata (MediaRecorder often doesn't write it correctly)
        const fixedBlob = await fixWebmDuration(blob, targetTotalMs);
        
        // Download the video
        const url = URL.createObjectURL(fixedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `video_bg_removed_${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // Fix WebM duration metadata in EBML header
    // MediaRecorder-generated WebM files often have Infinity duration
    async function fixWebmDuration(blob, durationMs) {
        try {
            const buffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            
            // WebM/EBML Duration element ID: 0x4489
            // We need to find the Duration element in the Segment > Info section
            // and update its value
            const durationElementId = [0x44, 0x89];
            
            for (let i = 0; i < bytes.length - 12; i++) {
                if (bytes[i] === durationElementId[0] && bytes[i + 1] === durationElementId[1]) {
                    // Found Duration element ID
                    // Next byte(s) indicate the size
                    const sizeIndicator = bytes[i + 2];
                    
                    // Check if it's an 8-byte float (0x88 = size 8)
                    if (sizeIndicator === 0x88) {
                        // Write duration as float64 (big-endian)
                        const dataView = new DataView(new ArrayBuffer(8));
                        dataView.setFloat64(0, durationMs, false); // false = big-endian
                        const durationBytes = new Uint8Array(dataView.buffer);
                        
                        // Patch the duration value
                        for (let j = 0; j < 8; j++) {
                            bytes[i + 3 + j] = durationBytes[j];
                        }
                        
                        console.log(`Fixed WebM duration metadata: ${durationMs}ms at position ${i}`);
                        return new Blob([bytes], { type: blob.type });
                    }
                }
            }
            
            console.log('Duration element not found in WebM, returning original blob');
            return blob;
        } catch (e) {
            console.error('Failed to fix WebM duration:', e);
            return blob;
        }
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
            
            alert(t('png_zip_hint'));
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
            alert(t('gif_lib_hint'));
            await encodeVideo(frames, fps, 'webm-vp8', 0.8, null, onProgress);
        }
    }

    // --- MOV Export (QuickTime Animation codec with transparency) ---
    async function exportMov(frames, fps, quality, onProgress) {
        const width = frames[0].width;
        const height = frames[0].height;
        const frameCount = frames.length;
        const timeScale = Math.round(fps * 1000); // Use higher timescale for precision
        const frameDuration = Math.round(timeScale / fps);
        const totalDuration = frameCount * frameDuration;
        
        console.log(`Creating MOV: ${width}x${height}, ${frameCount} frames @ ${fps} FPS`);
        
        // Encode frames as PNG (QuickTime Animation codec - 'png ')
        const frameDataArray = [];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = width;
        canvas.height = height;
        
        for (let i = 0; i < frameCount; i++) {
            ctx.clearRect(0, 0, width, height);
            ctx.putImageData(frames[i], 0, 0);
            
            // Convert to PNG blob
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            const arrayBuffer = await blob.arrayBuffer();
            frameDataArray.push(new Uint8Array(arrayBuffer));
            
            onProgress((i + 1) / frameCount * 0.7);
            
            if (i % 5 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        // Calculate total mdat size
        let mdatDataSize = 0;
        for (const frame of frameDataArray) {
            mdatDataSize += frame.length;
        }
        
        // Build sample table entries
        const sampleSizes = frameDataArray.map(f => f.length);
        
        // Build MOV file structure
        const movData = buildMovFile(width, height, timeScale, frameDuration, totalDuration, frameCount, sampleSizes, frameDataArray);
        
        onProgress(0.9);
        
        // Create and download blob
        const blob = new Blob([movData], { type: 'video/quicktime' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `video_bg_removed_${frameCount}f_${fps}fps_${Date.now()}.mov`;
        a.click();
        URL.revokeObjectURL(url);
        
        console.log(`MOV created: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
        onProgress(1);
    }
    
    function buildMovFile(width, height, timeScale, frameDuration, totalDuration, frameCount, sampleSizes, frameDataArray) {
        // Helper functions for writing atoms
        function writeUint32BE(value) {
            return new Uint8Array([
                (value >> 24) & 0xFF,
                (value >> 16) & 0xFF,
                (value >> 8) & 0xFF,
                value & 0xFF
            ]);
        }
        
        function writeUint16BE(value) {
            return new Uint8Array([
                (value >> 8) & 0xFF,
                value & 0xFF
            ]);
        }
        
        function writeFixedPoint16_16(value) {
            const intPart = Math.floor(value);
            const fracPart = Math.round((value - intPart) * 65536);
            return new Uint8Array([
                (intPart >> 8) & 0xFF,
                intPart & 0xFF,
                (fracPart >> 8) & 0xFF,
                fracPart & 0xFF
            ]);
        }
        
        function writeFixedPoint8_8(value) {
            const intPart = Math.floor(value);
            const fracPart = Math.round((value - intPart) * 256);
            return new Uint8Array([intPart & 0xFF, fracPart & 0xFF]);
        }
        
        function makeAtom(type, content) {
            const typeBytes = new TextEncoder().encode(type);
            const size = 8 + content.length;
            const sizeBytes = writeUint32BE(size);
            const result = new Uint8Array(size);
            result.set(sizeBytes, 0);
            result.set(typeBytes, 4);
            result.set(content, 8);
            return result;
        }
        
        function concatArrays(...arrays) {
            const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
            const result = new Uint8Array(totalLength);
            let offset = 0;
            for (const arr of arrays) {
                result.set(arr, offset);
                offset += arr.length;
            }
            return result;
        }
        
        // Build atoms from inside out
        
        // ftyp - file type
        const ftyp = makeAtom('ftyp', concatArrays(
            new TextEncoder().encode('qt  '), // major brand: QuickTime
            writeUint32BE(0x00000200),         // minor version
            new TextEncoder().encode('qt  ')  // compatible brand
        ));
        
        // mdat header (we'll write actual size after calculating)
        // mdat contains all frame data
        const mdatDataSize = frameDataArray.reduce((sum, f) => sum + f.length, 0);
        const mdatHeaderSize = 8;
        
        // mvhd - movie header
        const creationTime = Math.floor(Date.now() / 1000) + 2082844800; // Mac epoch
        const mvhd = makeAtom('mvhd', concatArrays(
            new Uint8Array([0, 0, 0, 0]),      // version + flags
            writeUint32BE(creationTime),       // creation time
            writeUint32BE(creationTime),       // modification time
            writeUint32BE(timeScale),          // time scale
            writeUint32BE(totalDuration),      // duration
            writeFixedPoint16_16(1.0),         // preferred rate
            writeFixedPoint8_8(1.0),           // preferred volume
            new Uint8Array(10),                // reserved
            // Matrix (identity)
            writeFixedPoint16_16(1.0), writeFixedPoint16_16(0), writeFixedPoint16_16(0),
            writeFixedPoint16_16(0), writeFixedPoint16_16(1.0), writeFixedPoint16_16(0),
            writeFixedPoint16_16(0), writeFixedPoint16_16(0), new Uint8Array([0x40, 0x00, 0x00, 0x00]),
            writeUint32BE(0),                  // preview time
            writeUint32BE(0),                  // preview duration
            writeUint32BE(0),                  // poster time
            writeUint32BE(0),                  // selection time
            writeUint32BE(0),                  // selection duration
            writeUint32BE(0),                  // current time
            writeUint32BE(2)                   // next track ID
        ));
        
        // tkhd - track header
        const tkhd = makeAtom('tkhd', concatArrays(
            new Uint8Array([0, 0, 0, 0x0F]),   // version + flags (track enabled, in movie, in preview)
            writeUint32BE(creationTime),
            writeUint32BE(creationTime),
            writeUint32BE(1),                  // track ID
            writeUint32BE(0),                  // reserved
            writeUint32BE(totalDuration),      // duration
            new Uint8Array(8),                 // reserved
            writeUint16BE(0),                  // layer
            writeUint16BE(0),                  // alternate group
            writeFixedPoint8_8(1.0),           // volume (for audio)
            writeUint16BE(0),                  // reserved
            // Matrix (identity)
            writeFixedPoint16_16(1.0), writeFixedPoint16_16(0), writeFixedPoint16_16(0),
            writeFixedPoint16_16(0), writeFixedPoint16_16(1.0), writeFixedPoint16_16(0),
            writeFixedPoint16_16(0), writeFixedPoint16_16(0), new Uint8Array([0x40, 0x00, 0x00, 0x00]),
            writeFixedPoint16_16(width),       // width
            writeFixedPoint16_16(height)       // height
        ));
        
        // mdhd - media header
        const mdhd = makeAtom('mdhd', concatArrays(
            new Uint8Array([0, 0, 0, 0]),      // version + flags
            writeUint32BE(creationTime),
            writeUint32BE(creationTime),
            writeUint32BE(timeScale),
            writeUint32BE(totalDuration),
            writeUint16BE(0),                  // language (undetermined)
            writeUint16BE(0)                   // quality
        ));
        
        // hdlr - handler reference (video)
        const hdlr = makeAtom('hdlr', concatArrays(
            new Uint8Array([0, 0, 0, 0]),      // version + flags
            new TextEncoder().encode('mhlr'), // component type
            new TextEncoder().encode('vide'), // component subtype (video)
            writeUint32BE(0),                  // component manufacturer
            writeUint32BE(0),                  // component flags
            writeUint32BE(0),                  // component flags mask
            new TextEncoder().encode('VideoHandler\0') // component name
        ));
        
        // vmhd - video media header
        const vmhd = makeAtom('vmhd', concatArrays(
            new Uint8Array([0, 0, 0, 1]),      // version + flags
            writeUint16BE(0),                  // graphics mode
            writeUint16BE(0x8000),             // opcolor R
            writeUint16BE(0x8000),             // opcolor G
            writeUint16BE(0x8000)              // opcolor B
        ));
        
        // stsd - sample description (PNG codec)
        const sampleDescEntry = concatArrays(
            writeUint32BE(86),                 // entry size
            new TextEncoder().encode('png '), // codec type (PNG)
            new Uint8Array(6),                 // reserved
            writeUint16BE(1),                  // data reference index
            writeUint16BE(0),                  // version
            writeUint16BE(0),                  // revision level
            new TextEncoder().encode('appl'), // vendor
            writeUint32BE(0),                  // temporal quality
            writeUint32BE(512),                // spatial quality (high)
            writeUint16BE(width),              // width
            writeUint16BE(height),             // height
            writeFixedPoint16_16(72),          // horizontal resolution
            writeFixedPoint16_16(72),          // vertical resolution
            writeUint32BE(0),                  // data size
            writeUint16BE(1),                  // frame count
            // Compressor name (32 bytes, pascal string)
            new Uint8Array([3]),               // length
            new TextEncoder().encode('PNG'),
            new Uint8Array(28),                // padding
            writeUint16BE(24),                 // depth
            writeUint16BE(-1)                  // color table ID (-1 = default)
        );
        
        const stsd = makeAtom('stsd', concatArrays(
            new Uint8Array([0, 0, 0, 0]),      // version + flags
            writeUint32BE(1),                  // entry count
            sampleDescEntry
        ));
        
        // stts - time to sample (all frames same duration)
        const stts = makeAtom('stts', concatArrays(
            new Uint8Array([0, 0, 0, 0]),      // version + flags
            writeUint32BE(1),                  // entry count
            writeUint32BE(frameCount),         // sample count
            writeUint32BE(frameDuration)       // sample delta
        ));
        
        // stsc - sample to chunk (all samples in one chunk)
        const stsc = makeAtom('stsc', concatArrays(
            new Uint8Array([0, 0, 0, 0]),      // version + flags
            writeUint32BE(1),                  // entry count
            writeUint32BE(1),                  // first chunk
            writeUint32BE(frameCount),         // samples per chunk
            writeUint32BE(1)                   // sample description ID
        ));
        
        // stsz - sample sizes
        const stszData = [
            new Uint8Array([0, 0, 0, 0]),      // version + flags
            writeUint32BE(0),                  // sample size (0 = variable)
            writeUint32BE(frameCount)          // sample count
        ];
        for (const size of sampleSizes) {
            stszData.push(writeUint32BE(size));
        }
        const stsz = makeAtom('stsz', concatArrays(...stszData));
        
        // stco - chunk offset (single chunk at mdat data start)
        // We need to calculate this after we know all sizes
        // For now, placeholder
        const stco_placeholder = makeAtom('stco', concatArrays(
            new Uint8Array([0, 0, 0, 0]),      // version + flags
            writeUint32BE(1),                  // entry count
            writeUint32BE(0)                   // chunk offset (will be patched)
        ));
        
        // stbl - sample table
        const stbl = makeAtom('stbl', concatArrays(stsd, stts, stsc, stsz, stco_placeholder));
        
        // dinf - data information
        const dref = makeAtom('dref', concatArrays(
            new Uint8Array([0, 0, 0, 0]),      // version + flags
            writeUint32BE(1),                  // entry count
            makeAtom('url ', new Uint8Array([0, 0, 0, 1])) // self-contained
        ));
        const dinf = makeAtom('dinf', dref);
        
        // minf - media information
        const minf = makeAtom('minf', concatArrays(vmhd, dinf, stbl));
        
        // mdia - media
        const mdia = makeAtom('mdia', concatArrays(mdhd, hdlr, minf));
        
        // trak - track
        const trak = makeAtom('trak', concatArrays(tkhd, mdia));
        
        // moov - movie
        const moov = makeAtom('moov', concatArrays(mvhd, trak));
        
        // Calculate mdat offset (ftyp + moov + mdat header)
        const mdatOffset = ftyp.length + moov.length + mdatHeaderSize;
        
        // Patch stco with correct offset
        // Find stco in moov and patch it
        const moovData = new Uint8Array(moov);
        // stco is at a known offset within the structure
        // We need to find and patch the chunk offset value
        // The offset value is the last 4 bytes of stco
        
        // Build mdat
        const mdatSize = mdatHeaderSize + mdatDataSize;
        const mdatHeader = concatArrays(writeUint32BE(mdatSize), new TextEncoder().encode('mdat'));
        
        // Combine all frame data
        const allFrameData = concatArrays(...frameDataArray);
        
        // Build final MOV - but we need to patch stco first
        // Let's rebuild with correct offset
        
        // Rebuild stco with correct offset
        const stco = makeAtom('stco', concatArrays(
            new Uint8Array([0, 0, 0, 0]),
            writeUint32BE(1),
            writeUint32BE(mdatOffset)
        ));
        
        // Rebuild stbl with correct stco
        const stbl_final = makeAtom('stbl', concatArrays(stsd, stts, stsc, stsz, stco));
        const minf_final = makeAtom('minf', concatArrays(vmhd, dinf, stbl_final));
        const mdia_final = makeAtom('mdia', concatArrays(mdhd, hdlr, minf_final));
        const trak_final = makeAtom('trak', concatArrays(tkhd, mdia_final));
        const moov_final = makeAtom('moov', concatArrays(mvhd, trak_final));
        
        // Final MOV file
        return concatArrays(ftyp, moov_final, mdatHeader, allFrameData);
    }

    // --- Language Change Handler ---
    window.addEventListener('languageChanged', () => {
        updateSelectionCount();
        updatePerframeSelectionCount();
        renderChromaColorList();
        renderHybridOperationList();
        updateAudioHint();
        applyI18nAttrs();
        updatePreviewTitle();
    });
});
