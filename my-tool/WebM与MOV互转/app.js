document.addEventListener('DOMContentLoaded', () => {
    // --- DOM ---
    const videoInput = document.getElementById('video-input');
    const uploadSection = document.getElementById('upload-section');
    const uploadTitle = document.getElementById('upload-title');
    const uploadHint = document.getElementById('upload-hint');

    const editorSection = document.getElementById('editor-section');
    const videoPlayer = document.getElementById('video-player');
    const previewCanvas = document.getElementById('preview-canvas');
    const alphaCanvas = document.getElementById('alpha-canvas');

    const resetBtn = document.getElementById('reset-btn');
    const playBtn = document.getElementById('play-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const videoInfoText = document.getElementById('video-info-text');

    const modeWebm2MovBtn = document.getElementById('mode-webm2mov');
    const modeMov2WebmBtn = document.getElementById('mode-mov2webm');

    const outputFps = document.getElementById('output-fps');

    const groupMovCodec = document.getElementById('group-mov-codec');
    const outputMovCodec = document.getElementById('output-mov-codec');

    const groupWebmFormat = document.getElementById('group-webm-format');
    const outputWebmFormat = document.getElementById('output-webm-format');

    const groupWebmQuality = document.getElementById('group-webm-quality');
    const outputWebmQuality = document.getElementById('output-webm-quality');

    const infoWebm2Mov = document.getElementById('info-webm2mov');
    const infoMov2Webm = document.getElementById('info-mov2webm');

    const convertBtn = document.getElementById('convert-btn');

    const alphaCard = document.getElementById('alpha-card');
    const statTransparent = document.getElementById('stat-transparent');
    const statSemi = document.getElementById('stat-semi');
    const statOpaque = document.getElementById('stat-opaque');

    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');

    // --- State ---
    let mode = 'webm2mov'; // 'webm2mov' | 'mov2webm'

    let videoFile = null;
    let objectUrl = '';

    let detectedFps = 30;
    let videoWidth = 0;
    let videoHeight = 0;
    let duration = 0;

    let isExtracting = false;

    let videoDecodable = true;
    let movFallback = null; // parsed PNG-in-MOV / RAW-in-MOV
    let movFallbackPromise = null;

    // Debug is ON by default so logs are always available.
    // You can disable with: ?debug=0 or localStorage.setItem('tool-debug','0')
    const DEBUG = (() => {
        try {
            const sp = new URLSearchParams(window.location.search);
            const q = sp.get('debug');
            if (q === '0') return false;
            if (q === '1') return true;

            const ls = localStorage.getItem('tool-debug');
            if (ls === '0') return false;
            if (ls === '1') return true;

            return true;
        } catch (e) {
            return true;
        }
    })();

    // Panel is OFF by default to avoid UI blocking.
    // Enable with: ?panel=1 or localStorage.setItem('tool-debug-panel','1')
    const DEBUG_PANEL = (() => {
        try {
            const sp = new URLSearchParams(window.location.search);
            const q = sp.get('panel');
            if (q === '0') return false;
            if (q === '1') return true;

            const ls = localStorage.getItem('tool-debug-panel');
            if (ls === '0') return false;
            if (ls === '1') return true;

            return false;
        } catch (e) {
            return false;
        }
    })();


    const debugLogs = [];
    let debugPanelEl = null;
    let debugLogEl = null;

    function dbg(...args) {
        const ts = new Date().toISOString();
        const msg = args.map(a => {
            if (typeof a === 'string') return a;
            try { return JSON.stringify(a); } catch (e) { return String(a); }
        }).join(' ');


        const line = `[${ts}] ${msg}`;
        debugLogs.push(line);
        window.TB_DEBUG_LOGS = debugLogs;

        if (DEBUG) {
            console.log('[TB]', ...args);
        }
        if (DEBUG_PANEL && debugLogEl) {
            debugLogEl.value += line + "\n";
            debugLogEl.scrollTop = debugLogEl.scrollHeight;
        }

    }

    function dbgError(...args) {
        dbg('[ERROR]', ...args);
        if (DEBUG) console.error('[TB]', ...args);
    }

    function initDebugPanel() {
        if (!DEBUG_PANEL) return;
        if (debugPanelEl) return;


        debugPanelEl = document.createElement('div');
        debugPanelEl.style.cssText = [
            'position:fixed',
            'left:12px',
            'right:12px',
            'bottom:12px',
            // Keep it above the page, but avoid becoming an invisible full-page blocker
            'z-index:10000',
            'background:rgba(10,10,11,0.95)',
            'border:1px solid #2a2a2e',
            'border-radius:12px',
            'padding:10px',
            'backdrop-filter: blur(6px)',
            'max-height:35vh',
            'overflow:hidden'
        ].join(';');

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;';

        const title = document.createElement('div');
        title.textContent = '调试日志 (debug=1)';
        title.style.cssText = 'font-weight:700;font-size:13px;';

        let collapsed = true;

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.textContent = '展开';
        toggleBtn.className = 'secondary';
        toggleBtn.style.cssText = 'padding:6px 10px;border-radius:8px;';

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:8px;align-items:center;';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.textContent = '复制';
        copyBtn.className = 'secondary';
        copyBtn.style.cssText = 'padding:6px 10px;border-radius:8px;';

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = '清空';
        clearBtn.className = 'secondary';
        clearBtn.style.cssText = 'padding:6px 10px;border-radius:8px;';

        const hideBtn = document.createElement('button');
        hideBtn.type = 'button';
        hideBtn.textContent = '隐藏';
        hideBtn.className = 'secondary';
        hideBtn.style.cssText = 'padding:6px 10px;border-radius:8px;';

        actions.append(toggleBtn, copyBtn, clearBtn, hideBtn);
        header.append(title, actions);

        debugLogEl = document.createElement('textarea');
        debugLogEl.readOnly = true;
        debugLogEl.spellcheck = false;
        debugLogEl.style.cssText = [
            'width:100%',
            'height:160px',
            'resize:none',
            'border-radius:10px',
            'border:1px solid #2a2a2e',
            'background:#0f0f12',
            'color:#e5e7eb',
            'padding:10px',
            'font-size:12px',
            'line-height:1.35',
            'font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace'
        ].join(';');

        debugPanelEl.append(header, debugLogEl);
        // Default collapsed to avoid blocking UI
        debugLogEl.style.display = 'none';
        document.body.appendChild(debugPanelEl);

        toggleBtn.addEventListener('click', () => {
            collapsed = !collapsed;
            debugLogEl.style.display = collapsed ? 'none' : 'block';
            toggleBtn.textContent = collapsed ? '展开' : '收起';
        });


        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(debugLogEl.value);
                dbg('copied logs to clipboard');
            } catch (e) {
                dbgError('copy failed', e && e.message ? e.message : e);
            }
        });

        clearBtn.addEventListener('click', () => {
            debugLogs.length = 0;
            debugLogEl.value = '';
            dbg('cleared logs');
        });

        hideBtn.addEventListener('click', () => {
            debugPanelEl.remove();
            debugPanelEl = null;
            debugLogEl = null;
        });

        dbg('debug panel initialized');
    }

    initDebugPanel();

    async function probeVideoDurationSeconds(blob) {
        // Best-effort: load blob into <video> and read duration.
        return await new Promise((resolve) => {
            try {
                const v = document.createElement('video');
                v.muted = true;
                v.playsInline = true;
                const url = URL.createObjectURL(blob);

                const cleanup = () => {
                    try { URL.revokeObjectURL(url); } catch (e) {}
                    try { v.removeAttribute('src'); v.load(); } catch (e) {}

                };

                const timer = setTimeout(() => {
                    cleanup();
                    resolve(null);
                }, 2500);

                v.addEventListener('loadedmetadata', () => {
                    clearTimeout(timer);
                    const d = Number.isFinite(v.duration) ? v.duration : null;
                    cleanup();
                    resolve(d);
                }, { once: true });

                v.addEventListener('error', () => {
                    clearTimeout(timer);
                    cleanup();
                    resolve(null);
                }, { once: true });

                v.src = url;
            } catch (e) {
                resolve(null);
            }
        });
    }

    // --- Helpers ---
    function t(key, fallback) {
        const v = window.i18n && typeof window.i18n.t === 'function' ? window.i18n.t(key) : null;
        if (!v || v === key) return fallback ?? key;
        return v;
    }


    function setI18nKey(el, key) {
        if (!el) return;
        el.setAttribute('data-i18n', key);
        if (window.i18n && typeof window.i18n.updateDOM === 'function') {
            window.i18n.updateDOM();
        }
    }

    function isWebmFile(file) {
        if (!file) return false;
        const nameOk = /\.webm$/i.test(file.name);
        const typeOk = (file.type || '').includes('webm');
        return nameOk || typeOk;
    }

    function isMovFile(file) {
        if (!file) return false;
        const nameOk = /\.mov$/i.test(file.name);
        const typeOk = (file.type || '').includes('quicktime');
        return nameOk || typeOk;
    }

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 100);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    }

    function updateVideoInfo() {
        const fpsStr = Number.isInteger(detectedFps) ? detectedFps.toString() : detectedFps.toFixed(2);
        const durationStr = formatTime(duration || 0);
        videoInfoText.textContent = `${videoWidth}×${videoHeight} | ${fpsStr} FPS | ${durationStr}`;
    }

    function setLoading(progress01, text) {
        const pct = Math.max(0, Math.min(1, progress01)) * 100;
        progressBar.style.width = `${pct}%`;
        progressText.textContent = `${Math.round(pct)}%`;
        if (typeof text === 'string') loadingText.textContent = text;
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 500);
    }

    function resetStateToUpload() {
        try {
            videoPlayer.pause();
        } catch (e) {}

        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = '';
        }

        videoFile = null;
        duration = 0;
        videoWidth = 0;
        videoHeight = 0;
        detectedFps = 30;

        videoDecodable = true;
        movFallback = null;
        movFallbackPromise = null;

        videoPlayer.removeAttribute('src');
        videoPlayer.load();

        uploadSection.classList.remove('hidden');
        editorSection.classList.add('hidden');
        resetBtn.classList.add('hidden');
        pauseBtn.classList.add('hidden');
        playBtn.classList.remove('hidden');
        videoInfoText.textContent = '--';
        videoInput.value = '';
    }

    function applyModeUI() {
        const isWebm2Mov = mode === 'webm2mov';

        modeWebm2MovBtn.classList.toggle('active', isWebm2Mov);
        modeMov2WebmBtn.classList.toggle('active', !isWebm2Mov);

        groupMovCodec.classList.toggle('hidden', !isWebm2Mov);
        infoWebm2Mov.classList.toggle('hidden', !isWebm2Mov);
        alphaCard.classList.toggle('hidden', !isWebm2Mov);

        groupWebmFormat.classList.toggle('hidden', isWebm2Mov);
        groupWebmQuality.classList.toggle('hidden', isWebm2Mov);
        infoMov2Webm.classList.toggle('hidden', isWebm2Mov);

        setI18nKey(uploadTitle, isWebm2Mov ? 'upload_title_webm2mov' : 'upload_title_mov2webm');
        setI18nKey(uploadHint, isWebm2Mov ? 'upload_hint_webm2mov' : 'upload_hint_mov2webm');
        setI18nKey(convertBtn, isWebm2Mov ? 'convert_btn_webm2mov' : 'convert_btn_mov2webm');

        // Accept: both are listed for convenience, but we validate by mode.
        videoInput.accept = '.webm,.mov,video/webm,video/quicktime';
    }

    function setMode(nextMode) {
        dbg('setMode click', { from: mode, to: nextMode });
        if (nextMode !== 'webm2mov' && nextMode !== 'mov2webm') return;
        if (mode === nextMode) return;

        mode = nextMode;
        applyModeUI();
        resetStateToUpload();


        // Re-create icons (header buttons include text but keep consistent)
        if (window.lucide) lucide.createIcons();
    }

    // --- Upload UI ---
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

    modeWebm2MovBtn.addEventListener('click', () => setMode('webm2mov'));
    modeMov2WebmBtn.addEventListener('click', () => setMode('mov2webm'));

    resetBtn.addEventListener('click', () => {
        resetStateToUpload();
    });

    // Keep mode UI in sync with language switching
    window.addEventListener('languageChanged', () => {
        applyModeUI();
    });

    // Initial UI
    applyModeUI();

    // Keep preview updated (avoid extra work while extracting frames)
    videoPlayer.addEventListener('timeupdate', () => {
        if (isExtracting) return;
        if (!videoPlayer.paused) updatePreview();
    });

    videoPlayer.addEventListener('seeked', () => {
        if (isExtracting) return;
        updatePreview();
    });




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

            previewCanvas.width = videoWidth || 1;
            previewCanvas.height = videoHeight || 1;
            alphaCanvas.width = videoWidth || 1;
            alphaCanvas.height = videoHeight || 1;

            updateVideoInfo();

            // Show editor even when <video> fails
            uploadSection.classList.add('hidden');
            editorSection.classList.remove('hidden');
            resetBtn.classList.remove('hidden');

            // Draw first frame for preview
            if (parsed.samples && parsed.samples.length > 0) {
                const first = await decodeMovSampleToImageData(parsed, parsed.samples[0]);
                const ctx = previewCanvas.getContext('2d', { willReadFrequently: true });
                ctx.putImageData(first, 0, 0);
            }
        } catch (e) {
            console.warn('MOV fallback parse failed:', e && e.message ? e.message : e);
            return null;
        }

        return movFallback;
    }

    function handleFile(file) {
        const ok = mode === 'webm2mov' ? isWebmFile(file) : isMovFile(file);
        if (!ok) {
            alert(mode === 'webm2mov'
                ? t('alert_webm_only', '请上传 WebM 格式的视频文件')
                : t('alert_mov_only', '请上传 MOV 格式的视频文件'));
            return;
        }

        videoFile = file;
        videoDecodable = true;
        movFallback = null;
        movFallbackPromise = null;


        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = '';
        }

        objectUrl = URL.createObjectURL(file);
        videoPlayer.src = objectUrl;

        // For MOV -> WebM: try parsing PNG-in-MOV (e.g. from "视频去背景" tool)
        if (mode === 'mov2webm') {
            movFallbackPromise = initMovFallbackIfPossible(file);
        }


        // Robust error handling (some MOV not decodable in browser)
        const onError = () => {
            videoDecodable = false;
            playBtn.classList.add('hidden');
            pauseBtn.classList.add('hidden');

            // In MOV->WebM mode, try fallback parsing first (async), don't fail fast.
            if (mode === 'mov2webm') {
                (async () => {
                    try {
                        if (!movFallback && movFallbackPromise) {
                            await movFallbackPromise;
                        }
                        if (!movFallback) {
                            // One more try (in case error fired before we started)
                            movFallbackPromise = initMovFallbackIfPossible(file);
                            await movFallbackPromise;
                        }

                        if (movFallback) {
                            updateVideoInfo();
                            videoInfoText.textContent += ` | ${t('mov_preview_unavailable', '该 MOV 浏览器无法预览，但仍可转换')}`;
                            return;
                        }

                        alert(t('alert_decode_failed', '浏览器无法解码该视频文件，建议换一个编码更通用的文件（如 H.264 MOV），或用 ffmpeg/专业软件先转码。'));
                        resetStateToUpload();
                    } catch (e) {
                        alert(t('alert_decode_failed', '浏览器无法解码该视频文件，建议换一个编码更通用的文件（如 H.264 MOV），或用 ffmpeg/专业软件先转码。'));
                        resetStateToUpload();
                    }
                })();
                return;
            }

            // Non MOV->WebM: fail normally
            alert(t('alert_decode_failed', '浏览器无法解码该视频文件，建议换一个编码更通用的文件（如 H.264 MOV），或用 ffmpeg/专业软件先转码。'));
            resetStateToUpload();
        };
        videoPlayer.addEventListener('error', onError, { once: true });

        videoPlayer.addEventListener('loadedmetadata', async () => {
            videoDecodable = true;

            duration = videoPlayer.duration || duration || 0;
            videoWidth = videoPlayer.videoWidth || videoWidth || 0;
            videoHeight = videoPlayer.videoHeight || videoHeight || 0;

            if (!videoWidth || !videoHeight || !duration) {
                console.warn('Loaded metadata but size/duration is empty', { videoWidth, videoHeight, duration });
            }

            previewCanvas.width = videoWidth || 1;
            previewCanvas.height = videoHeight || 1;
            alphaCanvas.width = videoWidth || 1;
            alphaCanvas.height = videoHeight || 1;

            try {
                detectedFps = await detectVideoFps(videoPlayer.src);
            } catch (e) {
                detectedFps = detectedFps || 30;
            }

            updateVideoInfo();

            uploadSection.classList.add('hidden');
            editorSection.classList.remove('hidden');
            resetBtn.classList.remove('hidden');

            try {
                await seekTo(0);
                updatePreview();
            } catch (e) {
                // ignore
            }
        }, { once: true });

        if (window.lucide) lucide.createIcons();
    }


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
            throw new Error(`帧数过多（${sampleCount}），请降低 FPS 或缩短视频时长再试。`);
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

        return { codecFourCC, width, height, timeScale, durationSeconds, fps, samples };
    }

    async function decodeMovSampleToImageData(parsed, sampleBytes) {
        if (parsed.codecFourCC === 'raw ') {
            const expected = parsed.width * parsed.height * 4;
            if (sampleBytes.byteLength < expected) {
                throw new Error(`RAW 帧数据长度不正确：${sampleBytes.byteLength} < ${expected}`);
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

        throw new Error(`暂不支持的 MOV codec: ${parsed.codecFourCC}`);
    }

    async function extractFramesFromMovFallback(parsed, onProgress) {
        const frames = [];
        const total = parsed.samples.length;
        for (let i = 0; i < total; i++) {
            const imageData = await decodeMovSampleToImageData(parsed, parsed.samples[i]);
            frames.push(imageData);
            onProgress((i + 1) / total);
            if (i % 3 === 0) await new Promise(r => setTimeout(r, 0));
        }
        return frames;
    }

    async function detectVideoFps(src) {
        return new Promise((resolve) => {
            if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return resolve(30);


            const testVideo = document.createElement('video');
            testVideo.src = src;
            testVideo.muted = true;
            testVideo.playsInline = true;

            let frameCount = 0;
            let startMediaTime = 0;
            let resolved = false;

            const cleanup = () => {
                try { testVideo.pause(); } catch (e) {}
                testVideo.src = '';
                try { testVideo.remove(); } catch (e) {}
            };

            const countFrames = (_now, metadata) => {
                if (resolved) return;

                frameCount++;
                if (frameCount === 1) {
                    startMediaTime = metadata.mediaTime;
                } else if (frameCount >= 31) {
                    const timeDiff = metadata.mediaTime - startMediaTime;
                    if (timeDiff > 0) {
                        const fps = (frameCount - 1) / timeDiff;
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
                        const finalFps = (minDiff / closestFps < 0.01) ? closestFps : Math.round(fps * 100) / 100;
                        resolved = true;
                        cleanup();
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
                    cleanup();
                    resolve(30);
                }
            });

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve(30);
                }
            }, 2000);
        });
    }

    function updatePreview() {
        const ctx = previewCanvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        ctx.drawImage(videoPlayer, 0, 0);

        if (mode !== 'webm2mov') return;

        // Analyze alpha in WebM->MOV mode
        const imageData = ctx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
        analyzeAlpha(imageData);
        renderAlphaVisualization(imageData);
    }

    function analyzeAlpha(imageData) {
        const data = imageData.data;
        const totalPixels = imageData.width * imageData.height;
        let transparent = 0;
        let semi = 0;
        let opaque = 0;

        for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha === 0) {
                transparent++;
            } else if (alpha === 255) {
                opaque++;
            } else {
                semi++;
            }
        }

        const formatPercent = (count) => {
            const pct = (count / totalPixels * 100).toFixed(1);
            return `${pct}%`;
        };

        statTransparent.textContent = formatPercent(transparent);
        statSemi.textContent = formatPercent(semi);
        statOpaque.textContent = formatPercent(opaque);
    }

    function renderAlphaVisualization(imageData) {
        const ctx = alphaCanvas.getContext('2d');
        const alphaData = ctx.createImageData(imageData.width, imageData.height);

        for (let i = 0; i < imageData.data.length; i += 4) {
            const alpha = imageData.data[i + 3];
            alphaData.data[i] = alpha;
            alphaData.data[i + 1] = alpha;
            alphaData.data[i + 2] = alpha;
            alphaData.data[i + 3] = 255;
        }

        ctx.putImageData(alphaData, 0, 0);
    }

    // --- Video Controls ---
    playBtn.addEventListener('click', () => {
        if (!videoDecodable) return;
        videoPlayer.play();
        playBtn.classList.add('hidden');
        pauseBtn.classList.remove('hidden');
    });

    pauseBtn.addEventListener('click', () => {
        if (!videoDecodable) return;
        videoPlayer.pause();
        pauseBtn.classList.add('hidden');
        playBtn.classList.remove('hidden');
    });

    videoPlayer.addEventListener('ended', () => {
        pauseBtn.classList.add('hidden');
        playBtn.classList.remove('hidden');
    });

    // --- Conversion ---
    convertBtn.addEventListener('click', async () => {
        if (!videoFile) return;

        const fpsOption = outputFps.value;
        const fps = fpsOption === 'auto' ? detectedFps : parseInt(fpsOption);

        loadingOverlay.classList.remove('hidden');
        setLoading(0, t('extracting_frames', '正在提取帧...'));

        try {
            dbg('convert clicked', {
                mode,
                fileName: videoFile && videoFile.name,
                fileSize: videoFile && videoFile.size,
                fpsOption,
                fps
            });

            let frames;

            if (mode === 'mov2webm' && (!videoDecodable || duration === 0)) {
                if (!movFallback && movFallbackPromise) {
                    await movFallbackPromise;
                }
                if (!movFallback) {
                    movFallbackPromise = initMovFallbackIfPossible(videoFile);
                    await movFallbackPromise;
                }
                if (!movFallback) {
                    throw new Error(t('alert_decode_failed', '浏览器无法解码该视频文件，建议换一个编码更通用的文件（如 H.264 MOV），或用 ffmpeg/专业软件先转码。'));
                }

                dbg('extract frames via movFallback', {
                    codec: movFallback && movFallback.codecFourCC,
                    width: movFallback && movFallback.width,
                    height: movFallback && movFallback.height,
                    sampleCount: movFallback && movFallback.samples ? movFallback.samples.length : 0,
                    fpsFromMov: movFallback && movFallback.fps
                });

                frames = await extractFramesFromMovFallback(movFallback, (p) => {
                    setLoading(p * 0.5, t('extracting_frames', '正在提取帧...'));
                });

                dbg('movFallback frames extracted', { frames: frames.length });
            } else {
                dbg('extract frames via <video>', { fps, duration, expectedFrames: Math.round(Math.max(0, duration || 0) * fps) });

                frames = await extractFrames(fps, (p) => {
                    setLoading(p * 0.5, t('extracting_frames', '正在提取帧...'));
                });

                dbg('video frames extracted', { frames: frames.length });
            }


            if (mode === 'webm2mov') {
                setLoading(0.5, t('encoding_mov', '正在编码 MOV...'));
                const codec = outputMovCodec.value;

                const movData = await buildMovFile(frames, fps, codec, (p) => {
                    setLoading(0.5 + p * 0.5, t('encoding_mov', '正在编码 MOV...'));
                });

                const blob = new Blob([movData], { type: 'video/quicktime' });
                const baseName = videoFile.name.replace(/\.webm$/i, '');
                downloadBlob(blob, `${baseName}_alpha.mov`);

                loadingOverlay.classList.add('hidden');
                return;
            }

            // MOV -> WebM
            setLoading(0.5, t('encoding_webm', '正在编码 WebM...'));

            const format = outputWebmFormat.value;
            const quality = parseFloat(outputWebmQuality.value);

            const blob = await encodeWebmFromFrames(frames, fps, format, quality, (p) => {
                setLoading(0.5 + p * 0.5, t('encoding_webm', '正在编码 WebM...'));
            });

            const expectedDuration = frames.length / Math.max(1, fps || 30);
            const probedDuration = await probeVideoDurationSeconds(blob);
            dbg('webm export done', {
                format,
                quality,
                blobBytes: blob.size,
                expectedFrames: frames.length,
                expectedDuration,
                probedDuration
            });

            const baseName = videoFile.name.replace(/\.mov$/i, '');
            downloadBlob(blob, `${baseName}.webm`);

            loadingOverlay.classList.add('hidden');
        } catch (e) {
            console.error(e);
            alert(t('error_processing', '处理出错：') + (e && e.message ? e.message : String(e)));
            loadingOverlay.classList.add('hidden');
        }
    });

    function seekTo(time) {
        return new Promise((resolve, reject) => {
            const onSeeked = () => {
                cleanup();
                resolve();
            };
            const onError = () => {
                cleanup();
                reject(new Error(t('alert_decode_failed', '浏览器无法解码该视频文件，建议换一个编码更通用的文件（如 H.264 MOV），或用 ffmpeg/专业软件先转码。')));
            };
            const cleanup = () => {
                videoPlayer.removeEventListener('seeked', onSeeked);
                videoPlayer.removeEventListener('error', onError);
            };

            videoPlayer.addEventListener('seeked', onSeeked, { once: true });
            videoPlayer.addEventListener('error', onError, { once: true });

            try {
                videoPlayer.currentTime = Math.max(0, Math.min(time, duration || time));
            } catch (e) {
                cleanup();
                reject(e);
            }
        });
    }

    async function extractFrames(fps, onProgress) {
        const frames = [];
        const safeDuration = Math.max(0, duration || 0);
        const totalFrames = Math.max(1, Math.round(safeDuration * fps));
        const interval = totalFrames > 0 ? safeDuration / totalFrames : 0;

        // Basic safety limit to avoid huge memory usage
        if (totalFrames > 12000) {
            throw new Error(`帧数过多（${totalFrames}），请降低 FPS 或缩短视频时长再试。`);
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        canvas.width = videoWidth || 1;
        canvas.height = videoHeight || 1;

        isExtracting = true;
        try {
            for (let i = 0; i < totalFrames; i++) {
                const time = i * interval;
                await seekTo(time);

                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(videoPlayer, 0, 0);

                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                frames.push(imageData);

                onProgress((i + 1) / totalFrames);

                if (i % 5 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            return frames;
        } finally {
            isExtracting = false;
        }
    }

    async function buildMovFile(frames, fps, codec, onProgress) {
        const width = frames[0].width;
        const height = frames[0].height;
        const frameCount = frames.length;
        const timeScale = Math.round(fps * 1000);
        const frameDuration = Math.round(timeScale / fps);
        const totalDuration = frameCount * frameDuration;

        const frameDataArray = [];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = width;
        canvas.height = height;

        for (let i = 0; i < frameCount; i++) {
            ctx.clearRect(0, 0, width, height);
            ctx.putImageData(frames[i], 0, 0);

            let frameData;
            if (codec === 'png') {
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                frameData = new Uint8Array(await blob.arrayBuffer());
            } else {
                frameData = new Uint8Array(frames[i].data.buffer.slice(0));
            }

            frameDataArray.push(frameData);
            onProgress((i + 1) / frameCount * 0.9);

            if (i % 5 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        const movData = createMovStructure(width, height, timeScale, frameDuration, totalDuration, frameCount, frameDataArray, codec);
        onProgress(1);
        return movData;
    }

    // MOV builder (same idea as original tool)
    function createMovStructure(width, height, timeScale, frameDuration, totalDuration, frameCount, frameDataArray, codec) {
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

        const ftyp = makeAtom('ftyp', concatArrays(
            new TextEncoder().encode('qt  '),
            writeUint32BE(0x00000200),
            new TextEncoder().encode('qt  ')
        ));

        const creationTime = Math.floor(Date.now() / 1000) + 2082844800;

        const mvhd = makeAtom('mvhd', concatArrays(
            new Uint8Array([0, 0, 0, 0]),
            writeUint32BE(creationTime),
            writeUint32BE(creationTime),
            writeUint32BE(timeScale),
            writeUint32BE(totalDuration),
            writeFixedPoint16_16(1.0),
            writeFixedPoint8_8(1.0),
            new Uint8Array(10),
            writeFixedPoint16_16(1.0), writeFixedPoint16_16(0), writeFixedPoint16_16(0),
            writeFixedPoint16_16(0), writeFixedPoint16_16(1.0), writeFixedPoint16_16(0),
            writeFixedPoint16_16(0), writeFixedPoint16_16(0), new Uint8Array([0x40, 0x00, 0x00, 0x00]),
            writeUint32BE(0), writeUint32BE(0), writeUint32BE(0),
            writeUint32BE(0), writeUint32BE(0), writeUint32BE(0),
            writeUint32BE(2)
        ));

        const tkhd = makeAtom('tkhd', concatArrays(
            new Uint8Array([0, 0, 0, 0x0F]),
            writeUint32BE(creationTime),
            writeUint32BE(creationTime),
            writeUint32BE(1),
            writeUint32BE(0),
            writeUint32BE(totalDuration),
            new Uint8Array(8),
            writeUint16BE(0),
            writeUint16BE(0),
            writeFixedPoint8_8(1.0),
            writeUint16BE(0),
            writeFixedPoint16_16(1.0), writeFixedPoint16_16(0), writeFixedPoint16_16(0),
            writeFixedPoint16_16(0), writeFixedPoint16_16(1.0), writeFixedPoint16_16(0),
            writeFixedPoint16_16(0), writeFixedPoint16_16(0), new Uint8Array([0x40, 0x00, 0x00, 0x00]),
            writeFixedPoint16_16(width),
            writeFixedPoint16_16(height)
        ));

        const mdhd = makeAtom('mdhd', concatArrays(
            new Uint8Array([0, 0, 0, 0]),
            writeUint32BE(creationTime),
            writeUint32BE(creationTime),
            writeUint32BE(timeScale),
            writeUint32BE(totalDuration),
            writeUint16BE(0),
            writeUint16BE(0)
        ));

        const hdlr = makeAtom('hdlr', concatArrays(
            new Uint8Array([0, 0, 0, 0]),
            new TextEncoder().encode('mhlr'),
            new TextEncoder().encode('vide'),
            writeUint32BE(0),
            writeUint32BE(0),
            writeUint32BE(0),
            new TextEncoder().encode('VideoHandler\0')
        ));

        const vmhd = makeAtom('vmhd', concatArrays(
            new Uint8Array([0, 0, 0, 1]),
            writeUint16BE(0),
            writeUint16BE(0x8000),
            writeUint16BE(0x8000),
            writeUint16BE(0x8000)
        ));

        let codecType, depth;
        if (codec === 'png') {
            codecType = 'png ';
            depth = 32;
        } else {
            codecType = 'raw ';
            depth = 32;
        }

        const sampleDescEntry = concatArrays(
            writeUint32BE(86),
            new TextEncoder().encode(codecType),
            new Uint8Array(6),
            writeUint16BE(1),
            writeUint16BE(0),
            writeUint16BE(0),
            new TextEncoder().encode('appl'),
            writeUint32BE(0),
            writeUint32BE(512),
            writeUint16BE(width),
            writeUint16BE(height),
            writeFixedPoint16_16(72),
            writeFixedPoint16_16(72),
            writeUint32BE(0),
            writeUint16BE(1),
            new Uint8Array([3]),
            new TextEncoder().encode(codec === 'png' ? 'PNG' : 'RAW'),
            new Uint8Array(28),
            writeUint16BE(depth),
            writeUint16BE(-1 & 0xFFFF)
        );

        const stsd = makeAtom('stsd', concatArrays(
            new Uint8Array([0, 0, 0, 0]),
            writeUint32BE(1),
            sampleDescEntry
        ));

        const stts = makeAtom('stts', concatArrays(
            new Uint8Array([0, 0, 0, 0]),
            writeUint32BE(1),
            writeUint32BE(frameCount),
            writeUint32BE(frameDuration)
        ));

        const stsc = makeAtom('stsc', concatArrays(
            new Uint8Array([0, 0, 0, 0]),
            writeUint32BE(1),
            writeUint32BE(1),
            writeUint32BE(frameCount),
            writeUint32BE(1)
        ));

        const sampleSizes = frameDataArray.map(f => f.length);
        const stszData = [
            new Uint8Array([0, 0, 0, 0]),
            writeUint32BE(0),
            writeUint32BE(frameCount)
        ];
        for (const size of sampleSizes) {
            stszData.push(writeUint32BE(size));
        }
        const stsz = makeAtom('stsz', concatArrays(...stszData));

        const mdatHeaderSize = 8;

        const dref = makeAtom('dref', concatArrays(
            new Uint8Array([0, 0, 0, 0]),
            writeUint32BE(1),
            makeAtom('url ', new Uint8Array([0, 0, 0, 1]))
        ));
        const dinf = makeAtom('dinf', dref);

        const stco_placeholder = makeAtom('stco', concatArrays(
            new Uint8Array([0, 0, 0, 0]),
            writeUint32BE(1),
            writeUint32BE(0)
        ));

        const stbl_temp = makeAtom('stbl', concatArrays(stsd, stts, stsc, stsz, stco_placeholder));
        const minf_temp = makeAtom('minf', concatArrays(vmhd, dinf, stbl_temp));
        const mdia_temp = makeAtom('mdia', concatArrays(mdhd, hdlr, minf_temp));
        const trak_temp = makeAtom('trak', concatArrays(tkhd, mdia_temp));
        const moov_temp = makeAtom('moov', concatArrays(mvhd, trak_temp));

        const mdatOffset = ftyp.length + moov_temp.length + mdatHeaderSize;

        const stco = makeAtom('stco', concatArrays(
            new Uint8Array([0, 0, 0, 0]),
            writeUint32BE(1),
            writeUint32BE(mdatOffset)
        ));

        const stbl = makeAtom('stbl', concatArrays(stsd, stts, stsc, stsz, stco));
        const minf = makeAtom('minf', concatArrays(vmhd, dinf, stbl));
        const mdia = makeAtom('mdia', concatArrays(mdhd, hdlr, minf));
        const trak = makeAtom('trak', concatArrays(tkhd, mdia));
        const moov = makeAtom('moov', concatArrays(mvhd, trak));

        const mdatDataSize = frameDataArray.reduce((sum, f) => sum + f.length, 0);
        const mdatSize = mdatHeaderSize + mdatDataSize;
        const mdatHeader = concatArrays(writeUint32BE(mdatSize), new TextEncoder().encode('mdat'));
        const allFrameData = concatArrays(...frameDataArray);

        return concatArrays(ftyp, moov, mdatHeader, allFrameData);
    }

    // --- WebM encoding (borrowed from existing tools) ---
    async function encodeWebmFromFrames(frames, fps, format, quality, onProgress) {
        const width = frames[0].width;
        const height = frames[0].height;

        dbg('encodeWebmFromFrames', {
            frames: frames.length,
            fps,
            format,
            quality,
            size: `${width}x${height}`,
            hasVideoEncoder: typeof VideoEncoder !== 'undefined',
            hasWebMMuxer: !!window.WebMMuxer
        });

        // Prefer WebCodecs + webm-muxer for deterministic frame timing
        if (typeof VideoEncoder !== 'undefined' && window.WebMMuxer) {
            try {
                dbg('webm path: WebCodecs+Muxer');
                const blob = await encodeWithWebCodecsMuxer(frames, fps, format, quality, onProgress);
                dbg('webm path done: WebCodecs+Muxer', { blobBytes: blob.size });
                return blob;
            } catch (e) {
                dbgError('WebCodecs+Muxer failed, falling back to MediaRecorder', e && e.message ? e.message : e);
            }
        }

        dbg('webm path: MediaRecorder');
        const blob = await encodeWithMediaRecorder(frames, fps, format, quality, onProgress);
        dbg('webm path done: MediaRecorder', { blobBytes: blob.size });
        return blob;
    }

    async function encodeWithWebCodecsMuxer(frames, fps, format, quality, onProgress) {
        const width = frames[0].width;
        const height = frames[0].height;
        const frameDurationUs = Math.round(1000000 / fps);

        dbg('encodeWithWebCodecsMuxer start', {
            frames: frames.length,
            fps,
            frameDurationUs,
            format,
            size: `${width}x${height}`
        });

        // webm-muxer v4 prefers built-in Targets (e.g. ArrayBufferTarget / StreamTarget).
        // Some environments reject plain objects and throw "Invalid target".
        const fileChunks = [];
        let muxTarget = null;
        let muxTargetKind = 'unknown';

        if (window.WebMMuxer && typeof WebMMuxer.ArrayBufferTarget === 'function') {
            muxTarget = new WebMMuxer.ArrayBufferTarget();
            muxTargetKind = 'ArrayBufferTarget';
        } else if (window.WebMMuxer && typeof WebMMuxer.StreamTarget === 'function') {
            muxTarget = new WebMMuxer.StreamTarget({
                onData: (data, position) => {
                    // Data may be non-contiguous; position matters.
                    fileChunks.push({ data: new Uint8Array(data), position });
                }
            });
            muxTargetKind = 'StreamTarget';
        } else {
            // Very old builds might accept a custom target with write/close.
            muxTarget = {
                write: (data, position) => {
                    fileChunks.push({ data: new Uint8Array(data), position });
                },
                close: () => {}
            };
            muxTargetKind = 'custom';
        }

        dbg('WebMMuxer target selected', { kind: muxTargetKind });


        const muxer = new WebMMuxer.Muxer({
            target: muxTarget,
            video: {
                codec: format === 'webm-vp8' ? 'V_VP8' : 'V_VP9',
                width,
                height,
                frameRate: fps,
                alpha: true
            },
            type: 'webm',
            firstTimestampBehavior: 'offset'
        });


        const encoder = new VideoEncoder({
            output: (chunk, metadata) => {
                muxer.addVideoChunk(chunk, metadata);
            },
            error: (e) => {
                throw new Error('VideoEncoder error: ' + e.message);
            }
        });

        let codecConfig;
        if (format === 'webm-vp8') {
            codecConfig = {
                codec: 'vp8',
                width,
                height,
                bitrate: Math.round(quality * 8000000),
                framerate: fps
            };
        } else {
            // VP9 (try alpha-friendly profiles first)
            codecConfig = {
                codec: 'vp09.00.10.08.01',
                width,
                height,
                bitrate: Math.round(quality * 8000000),
                framerate: fps
            };

            let support = await VideoEncoder.isConfigSupported(codecConfig);
            if (!support.supported) {
                codecConfig.codec = 'vp09.00.10.08';
                support = await VideoEncoder.isConfigSupported(codecConfig);
            }
            if (!support.supported) {
                codecConfig.codec = 'vp09.00.10.08.00';
                support = await VideoEncoder.isConfigSupported(codecConfig);
            }
            if (!support.supported) {
                codecConfig.codec = 'vp9';
                support = await VideoEncoder.isConfigSupported(codecConfig);
            }
            if (!support.supported) {
                // last resort
                codecConfig.codec = 'vp8';
                codecConfig.bitrate = Math.round(quality * 6000000);
            }
        }

        const supported = await VideoEncoder.isConfigSupported(codecConfig);
        if (!supported.supported) {
            throw new Error('No supported video codec found');
        }

        dbg('VideoEncoder configure', codecConfig);
        encoder.configure(codecConfig);


        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = width;
        canvas.height = height;

        const t0 = performance.now();
        for (let i = 0; i < frames.length; i++) {
            ctx.putImageData(frames[i], 0, 0);

            const timestamp = i * frameDurationUs;
            const videoFrame = new VideoFrame(canvas, {
                timestamp,
                duration: frameDurationUs
            });

            encoder.encode(videoFrame, { keyFrame: i === 0 });
            videoFrame.close();

            if (i === 0 || (i + 1) % 30 === 0 || i === frames.length - 1) {
                const elapsed = Math.round(performance.now() - t0);
                dbg('WebCodecs encode progress', { i: i + 1, total: frames.length, elapsedMs: elapsed, tsUs: timestamp });
            }

            onProgress((i + 1) / frames.length * 0.95);
            if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
        }


        dbg('WebCodecs flushing...');
        await encoder.flush();
        encoder.close();
        muxer.finalize();

        let finalU8 = null;

        // Preferred: ArrayBufferTarget provides a contiguous buffer.
        const finalizedTarget = muxer && muxer.target ? muxer.target : null;
        if (finalizedTarget && finalizedTarget.buffer) {
            const buf = finalizedTarget.buffer;
            if (buf instanceof ArrayBuffer) {
                finalU8 = new Uint8Array(buf);
            } else if (ArrayBuffer.isView(buf) && buf.buffer instanceof ArrayBuffer) {
                finalU8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
            }
        }


        if (!finalU8) {
            dbg('WebCodecs finalized (custom target)', { chunks: fileChunks.length });

            // Combine chunks
            fileChunks.sort((a, b) => a.position - b.position);

            let totalSize = 0;
            for (const chunk of fileChunks) {
                totalSize = Math.max(totalSize, chunk.position + chunk.data.length);
            }

            const combined = new Uint8Array(totalSize);
            for (const chunk of fileChunks) {
                combined.set(chunk.data, chunk.position);
            }

            finalU8 = combined;
        } else {
            dbg('WebCodecs finalized (ArrayBufferTarget)', { bytes: finalU8.byteLength });
        }

        onProgress(1);
        return new Blob([finalU8], { type: 'video/webm' });

    }

    async function encodeWithMediaRecorder(frames, fps, format, quality, onProgress) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = frames[0].width;
        canvas.height = frames[0].height;

        let mimeType = format === 'webm-vp8' ? 'video/webm;codecs=vp8' : 'video/webm;codecs=vp9';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';

        // IMPORTANT:
        // - Use captureStream(fps) so the browser has a target rate.
        // - Never busy-wait on the main thread; it blocks rendering and causes dropped frames.
        const safeFps = Math.max(1, Math.min(120, Math.round(fps || 30)));
        const stream = canvas.captureStream(safeFps);
        const videoTrack = stream.getVideoTracks()[0];

        dbg('MediaRecorder start', {
            safeFps,
            mimeType,
            hasRequestFrame: !!(videoTrack && typeof videoTrack.requestFrame === 'function'),
            frames: frames.length
        });

        const recorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: Math.round(quality * 10000000)
        });

        const chunks = [];
        let dataEventCount = 0;
        let dataBytes = 0;

        recorder.onstart = () => dbg('MediaRecorder onstart', { state: recorder.state });
        recorder.ondataavailable = (e) => {
            dataEventCount++;
            const sz = e && e.data ? e.data.size : 0;
            dataBytes += sz;
            if (e.data && sz > 0) chunks.push(e.data);
            if (dataEventCount === 1 || dataEventCount % 10 === 0) {
                dbg('MediaRecorder dataavailable', { count: dataEventCount, chunkBytes: sz, totalBytes: dataBytes });
            }
        };
        recorder.onerror = (e) => dbgError('MediaRecorder error', e && e.message ? e.message : e);

        const recordingPromise = new Promise((resolve, reject) => {
            recorder.onstop = () => {
                dbg('MediaRecorder onstop', { state: recorder.state, chunks: chunks.length, dataEventCount, dataBytes });
                resolve(new Blob(chunks, { type: mimeType }));
            };
            recorder.onerror = reject;
        });

        const frameDurationMs = 1000 / safeFps;
        // Use timeslice so we can observe dataavailable cadence in logs
        recorder.start(250);


        const t0 = performance.now();
        for (let i = 0; i < frames.length; i++) {
            ctx.putImageData(frames[i], 0, 0);

            if (videoTrack && typeof videoTrack.requestFrame === 'function') {
                videoTrack.requestFrame();
            }

            // Yield so the browser can paint / commit the frame into the capture stream
            await new Promise(r => requestAnimationFrame(r));

            if (i === 0 || (i + 1) % 30 === 0 || i === frames.length - 1) {
                const elapsed = Math.round(performance.now() - t0);
                dbg('MediaRecorder frame submitted', { i: i + 1, total: frames.length, elapsedMs: elapsed });
            }

            onProgress((i + 1) / frames.length);

            // Keep a soft cadence without blocking the main thread
            await new Promise(r => setTimeout(r, frameDurationMs));
        }


        // Give encoder a short tail time
        await new Promise(r => setTimeout(r, Math.max(50, frameDurationMs)));
        dbg('MediaRecorder stopping...');
        recorder.stop();

        const blob = await recordingPromise;
        const probed = await probeVideoDurationSeconds(blob);
        dbg('MediaRecorder blob ready', { blobBytes: blob.size, probedDuration: probed, expectedDuration: frames.length / safeFps });
        return blob;
    }

    // Reinitialize icons
    if (window.lucide) {
        lucide.createIcons();
    }
});
