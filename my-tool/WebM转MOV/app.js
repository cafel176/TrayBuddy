document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const videoInput = document.getElementById('video-input');
    const uploadSection = document.getElementById('upload-section');
    const editorSection = document.getElementById('editor-section');
    const videoPlayer = document.getElementById('video-player');
    const previewCanvas = document.getElementById('preview-canvas');
    const alphaCanvas = document.getElementById('alpha-canvas');
    const resetBtn = document.getElementById('reset-btn');
    const playBtn = document.getElementById('play-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const videoInfoText = document.getElementById('video-info-text');
    const outputFps = document.getElementById('output-fps');
    const outputCodec = document.getElementById('output-codec');
    const convertBtn = document.getElementById('convert-btn');
    
    // Stats elements
    const statTransparent = document.getElementById('stat-transparent');
    const statSemi = document.getElementById('stat-semi');
    const statOpaque = document.getElementById('stat-opaque');
    
    // Loading elements
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');

    let videoFile = null;
    let detectedFps = 30;
    let videoWidth = 0;
    let videoHeight = 0;
    let duration = 0;

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
        if (!file.type.includes('webm') && !file.name.endsWith('.webm')) {
            alert(window.i18n?.t('alert_webm_only') || '请上传 WebM 格式的视频文件');
            return;
        }
        videoFile = file;
        const url = URL.createObjectURL(file);
        videoPlayer.src = url;
        
        videoPlayer.onloadedmetadata = () => {
            duration = videoPlayer.duration;
            videoWidth = videoPlayer.videoWidth;
            videoHeight = videoPlayer.videoHeight;
            
            // Setup canvases
            previewCanvas.width = videoWidth;
            previewCanvas.height = videoHeight;
            alphaCanvas.width = videoWidth;
            alphaCanvas.height = videoHeight;
            
            // Detect FPS
            detectVideoFps().then(fps => {
                detectedFps = fps;
                updateVideoInfo();
            });
            
            uploadSection.classList.add('hidden');
            editorSection.classList.remove('hidden');
            resetBtn.classList.remove('hidden');
            
            // Capture first frame
            videoPlayer.currentTime = 0;
        };

        videoPlayer.onseeked = () => {
            updatePreview();
        };
        
        videoPlayer.ontimeupdate = () => {
            if (!videoPlayer.paused) {
                updatePreview();
            }
        };
    }

    // Detect video FPS
    async function detectVideoFps() {
        return new Promise((resolve) => {
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
                            testVideo.pause();
                            testVideo.src = '';
                            testVideo.remove();
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
                
                setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        testVideo.pause();
                        testVideo.src = '';
                        testVideo.remove();
                        resolve(30);
                    }
                }, 2000);
            } else {
                resolve(30);
            }
        });
    }

    function updateVideoInfo() {
        const fpsStr = Number.isInteger(detectedFps) ? detectedFps.toString() : detectedFps.toFixed(2);
        const durationStr = formatTime(duration);
        videoInfoText.textContent = `${videoWidth}×${videoHeight} | ${fpsStr} FPS | ${durationStr}`;
    }

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 100);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    }

    function updatePreview() {
        const ctx = previewCanvas.getContext('2d');
        ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        ctx.drawImage(videoPlayer, 0, 0);
        
        // Get image data and analyze alpha
        const imageData = ctx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
        analyzeAlpha(imageData);
        
        // Render alpha visualization
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
            // Show alpha as grayscale (white = opaque, black = transparent)
            alphaData.data[i] = alpha;
            alphaData.data[i + 1] = alpha;
            alphaData.data[i + 2] = alpha;
            alphaData.data[i + 3] = 255;
        }
        
        ctx.putImageData(alphaData, 0, 0);
    }

    // --- Video Controls ---
    playBtn.addEventListener('click', () => {
        videoPlayer.play();
        playBtn.classList.add('hidden');
        pauseBtn.classList.remove('hidden');
    });

    pauseBtn.addEventListener('click', () => {
        videoPlayer.pause();
        pauseBtn.classList.add('hidden');
        playBtn.classList.remove('hidden');
    });

    videoPlayer.onended = () => {
        pauseBtn.classList.add('hidden');
        playBtn.classList.remove('hidden');
    };

    resetBtn.addEventListener('click', () => {
        location.reload();
    });

    // --- Conversion ---
    convertBtn.addEventListener('click', async () => {
        const fpsOption = outputFps.value;
        const fps = fpsOption === 'auto' ? detectedFps : parseInt(fpsOption);
        const codec = outputCodec.value;
        
        loadingOverlay.classList.remove('hidden');
        progressBar.style.width = '0%';
        progressText.textContent = '0%';
        loadingText.textContent = window.i18n?.t('extracting_frames') || '正在提取帧...';

        try {
            // Step 1: Extract all frames with alpha
            const frames = await extractFramesWithAlpha(fps, (progress) => {
                progressBar.style.width = `${progress * 50}%`;
                progressText.textContent = `${Math.round(progress * 50)}%`;
            });

            loadingText.textContent = window.i18n?.t('encoding_mov') || '正在编码 MOV...';

            // Step 2: Build MOV file
            const movData = await buildMovFile(frames, fps, codec, (progress) => {
                progressBar.style.width = `${50 + progress * 50}%`;
                progressText.textContent = `${Math.round(50 + progress * 50)}%`;
            });

            // Step 3: Download
            const blob = new Blob([movData], { type: 'video/quicktime' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const baseName = videoFile.name.replace(/\.webm$/i, '');
            a.download = `${baseName}_alpha.mov`;
            a.click();
            URL.revokeObjectURL(url);

            console.log(`MOV created: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
            loadingOverlay.classList.add('hidden');
            
        } catch (e) {
            console.error(e);
            alert((window.i18n?.t('error_processing') || '处理出错：') + e.message);
            loadingOverlay.classList.add('hidden');
        }
    });

    async function extractFramesWithAlpha(fps, onProgress) {
        const frames = [];
        const totalFrames = Math.round(duration * fps);
        const interval = duration / totalFrames;
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        canvas.width = videoWidth;
        canvas.height = videoHeight;

        console.log(`Extracting ${totalFrames} frames with alpha channel...`);

        for (let i = 0; i < totalFrames; i++) {
            const time = i * interval;
            videoPlayer.currentTime = time;
            
            await new Promise(resolve => {
                videoPlayer.onseeked = resolve;
            });
            
            // Clear with transparent background
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(videoPlayer, 0, 0);
            
            // Get image data with alpha preserved
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            frames.push(imageData);
            
            onProgress((i + 1) / totalFrames);
            
            // Yield to UI
            if (i % 5 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        console.log(`Extracted ${frames.length} frames`);
        return frames;
    }

    async function buildMovFile(frames, fps, codec, onProgress) {
        const width = frames[0].width;
        const height = frames[0].height;
        const frameCount = frames.length;
        const timeScale = Math.round(fps * 1000);
        const frameDuration = Math.round(timeScale / fps);
        const totalDuration = frameCount * frameDuration;
        
        console.log(`Building MOV: ${width}x${height}, ${frameCount} frames @ ${fps} FPS`);
        
        // Encode frames
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
                // PNG codec - lossless with alpha
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                frameData = new Uint8Array(await blob.arrayBuffer());
            } else {
                // RGBA raw - uncompressed
                frameData = new Uint8Array(frames[i].data.buffer.slice(0));
            }
            
            frameDataArray.push(frameData);
            onProgress((i + 1) / frameCount * 0.9);
            
            if (i % 5 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        // Build MOV structure
        const movData = createMovStructure(width, height, timeScale, frameDuration, totalDuration, frameCount, frameDataArray, codec);
        
        onProgress(1);
        return movData;
    }

    function createMovStructure(width, height, timeScale, frameDuration, totalDuration, frameCount, frameDataArray, codec) {
        // Helper functions
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
        
        // ftyp - file type
        const ftyp = makeAtom('ftyp', concatArrays(
            new TextEncoder().encode('qt  '),
            writeUint32BE(0x00000200),
            new TextEncoder().encode('qt  ')
        ));
        
        const creationTime = Math.floor(Date.now() / 1000) + 2082844800;
        
        // mvhd - movie header
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
        
        // tkhd - track header
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
        
        // mdhd - media header
        const mdhd = makeAtom('mdhd', concatArrays(
            new Uint8Array([0, 0, 0, 0]),
            writeUint32BE(creationTime),
            writeUint32BE(creationTime),
            writeUint32BE(timeScale),
            writeUint32BE(totalDuration),
            writeUint16BE(0),
            writeUint16BE(0)
        ));
        
        // hdlr - handler reference
        const hdlr = makeAtom('hdlr', concatArrays(
            new Uint8Array([0, 0, 0, 0]),
            new TextEncoder().encode('mhlr'),
            new TextEncoder().encode('vide'),
            writeUint32BE(0),
            writeUint32BE(0),
            writeUint32BE(0),
            new TextEncoder().encode('VideoHandler\0')
        ));
        
        // vmhd - video media header
        const vmhd = makeAtom('vmhd', concatArrays(
            new Uint8Array([0, 0, 0, 1]),
            writeUint16BE(0),
            writeUint16BE(0x8000),
            writeUint16BE(0x8000),
            writeUint16BE(0x8000)
        ));
        
        // stsd - sample description
        let codecType, depth;
        if (codec === 'png') {
            codecType = 'png ';
            depth = 32; // RGBA
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
        
        // stts - time to sample
        const stts = makeAtom('stts', concatArrays(
            new Uint8Array([0, 0, 0, 0]),
            writeUint32BE(1),
            writeUint32BE(frameCount),
            writeUint32BE(frameDuration)
        ));
        
        // stsc - sample to chunk
        const stsc = makeAtom('stsc', concatArrays(
            new Uint8Array([0, 0, 0, 0]),
            writeUint32BE(1),
            writeUint32BE(1),
            writeUint32BE(frameCount),
            writeUint32BE(1)
        ));
        
        // stsz - sample sizes
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
        
        // Calculate mdat offset for stco
        const mdatHeaderSize = 8;
        
        // Build atoms to calculate sizes
        const dref = makeAtom('dref', concatArrays(
            new Uint8Array([0, 0, 0, 0]),
            writeUint32BE(1),
            makeAtom('url ', new Uint8Array([0, 0, 0, 1]))
        ));
        const dinf = makeAtom('dinf', dref);
        
        // Placeholder stco
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
        
        // Rebuild with correct stco
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
        
        // mdat
        const mdatDataSize = frameDataArray.reduce((sum, f) => sum + f.length, 0);
        const mdatSize = mdatHeaderSize + mdatDataSize;
        const mdatHeader = concatArrays(writeUint32BE(mdatSize), new TextEncoder().encode('mdat'));
        const allFrameData = concatArrays(...frameDataArray);
        
        return concatArrays(ftyp, moov, mdatHeader, allFrameData);
    }

    // Reinitialize icons after dynamic content
    if (window.lucide) {
        lucide.createIcons();
    }
});
