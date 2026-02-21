document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const imageInput = document.getElementById('image-input');
    const uploadSection = document.getElementById('upload-section');
    const editorSection = document.getElementById('editor-section');
    const previewCanvas = document.getElementById('preview-canvas');
    const playBtn = document.getElementById('play-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const resetBtn = document.getElementById('reset-btn');
    
    // Direction buttons
    const dirLeftBtn = document.getElementById('dir-left');
    const dirRightBtn = document.getElementById('dir-right');
    
    // Settings inputs
    const speedInput = document.getElementById('speed-input');
    const speedValue = document.getElementById('speed-value');
    const durationInput = document.getElementById('duration-input');
    const durationValue = document.getElementById('duration-value');
    const fpsSelect = document.getElementById('fps-select');
    
    // Info displays
    const imageSizeValue = document.getElementById('image-size-value');
    const totalFramesValue = document.getElementById('total-frames-value');
    const loopTimeValue = document.getElementById('loop-time-value');
    
    // Output elements
    const outputFormat = document.getElementById('output-format');
    const videoQuality = document.getElementById('video-quality');
    const exportBtn = document.getElementById('export-btn');
    
    // Loading elements
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');

    const t = (key, params, fallback) => {
        if (window.i18n?.t) {
            const text = window.i18n.t(key, params);
            if (text && text !== key) return text;
        }
        return fallback ?? key;
    };

    function applyI18nAttrs() {
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            const text = window.i18n?.translations?.[key];
            if (text) {
                el.setAttribute('title', text);
            }
        });
    }


    // State
    let sourceImage = null;
    let imageWidth = 0;
    let imageHeight = 0;
    let direction = 'left'; // 'left' or 'right'
    let isPlaying = false;
    let animationId = null;
    let currentOffset = 0;
    let lastTimestamp = 0;

    // --- Initialization ---
    uploadSection.addEventListener('click', () => imageInput.click());
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

    imageInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });

    function handleFile(file) {
        if (!file.type.startsWith('image/')) {
            alert(t('alert_upload_image'));
            return;
        }


        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                sourceImage = img;
                imageWidth = img.width;
                imageHeight = img.height;
                
                // Setup canvas
                previewCanvas.width = imageWidth;
                previewCanvas.height = imageHeight;
                
                // Update UI
                uploadSection.classList.add('hidden');
                editorSection.classList.remove('hidden');
                
                updateInfoDisplay();
                drawFrame(0);
                
                // Re-create icons
                if (window.lucide) lucide.createIcons();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    // --- Direction Selection ---
    dirLeftBtn.addEventListener('click', () => setDirection('left'));
    dirRightBtn.addEventListener('click', () => setDirection('right'));

    function setDirection(dir) {
        direction = dir;
        dirLeftBtn.classList.toggle('active', dir === 'left');
        dirRightBtn.classList.toggle('active', dir === 'right');
        
        // Reset and redraw
        currentOffset = 0;
        if (!isPlaying) {
            drawFrame(0);
        }
    }

    // --- Settings Updates ---
    speedInput.addEventListener('input', () => {
        speedValue.textContent = speedInput.value;
        updateInfoDisplay();
    });

    durationInput.addEventListener('input', () => {
        durationValue.textContent = durationInput.value;
        updateInfoDisplay();
    });

    fpsSelect.addEventListener('change', () => {
        updateInfoDisplay();
    });

    function updateInfoDisplay() {
        if (!sourceImage) return;
        
        const speed = parseInt(speedInput.value);
        const duration = parseFloat(durationInput.value);
        const fps = parseInt(fpsSelect.value);
        
        // Image size
        imageSizeValue.textContent = `${imageWidth} × ${imageHeight}`;
        
        // Total frames
        const totalFrames = Math.round(duration * fps);
        totalFramesValue.textContent = totalFrames.toString();
        
        // Loop time (time to traverse one full image width)
        const loopTime = imageWidth / speed;
        loopTimeValue.textContent = `${loopTime.toFixed(2)}s`;
    }

    // --- Preview Animation ---
    playBtn.addEventListener('click', startPreview);
    pauseBtn.addEventListener('click', stopPreview);

    function startPreview() {
        if (isPlaying) return;
        isPlaying = true;
        playBtn.classList.add('hidden');
        pauseBtn.classList.remove('hidden');
        lastTimestamp = performance.now();
        animationId = requestAnimationFrame(animatePreview);
    }

    function stopPreview() {
        isPlaying = false;
        playBtn.classList.remove('hidden');
        pauseBtn.classList.add('hidden');
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
    }

    function animatePreview(timestamp) {
        if (!isPlaying) return;
        
        const deltaTime = (timestamp - lastTimestamp) / 1000; // seconds
        lastTimestamp = timestamp;
        
        const speed = parseInt(speedInput.value);
        const moveAmount = speed * deltaTime;
        
        // Update offset based on direction
        // Left direction: offset increases (content moves right visually)
        // Right direction: offset decreases (content moves left visually)
        if (direction === 'left') {
            currentOffset += moveAmount;
        } else {
            currentOffset -= moveAmount;
        }
        
        // Keep offset positive and within bounds
        currentOffset = ((currentOffset % imageWidth) + imageWidth) % imageWidth;
        
        drawFrame(currentOffset);
        
        animationId = requestAnimationFrame(animatePreview);
    }

    function drawFrame(offset) {
        if (!sourceImage) return;
        
        const ctx = previewCanvas.getContext('2d');
        drawFrameToContext(ctx, offset, imageWidth, imageHeight);
    }

    // Shared drawing logic for both preview and export
    function drawFrameToContext(ctx, offset, width, height) {
        ctx.clearRect(0, 0, width, height);
        
        // Normalize offset to be within [0, imageWidth)
        offset = ((offset % imageWidth) + imageWidth) % imageWidth;
        
        // Draw the image for seamless horizontal loop
        // We need to draw two copies side by side
        
        // First copy: shifted left by offset
        ctx.drawImage(sourceImage, -offset, 0);
        
        // Second copy: right after the first one to fill the gap
        ctx.drawImage(sourceImage, imageWidth - offset, 0);
    }

    // --- Reset ---
    resetBtn.addEventListener('click', () => {
        stopPreview();
        sourceImage = null;
        imageWidth = 0;
        imageHeight = 0;
        currentOffset = 0;
        
        uploadSection.classList.remove('hidden');
        editorSection.classList.add('hidden');
        imageInput.value = '';
    });

    // --- Export ---
    exportBtn.addEventListener('click', async () => {
        if (!sourceImage) {
            alert(t('alert_no_image'));
            return;
        }


        const speed = parseInt(speedInput.value);
        const duration = parseFloat(durationInput.value);
        const fps = parseInt(fpsSelect.value);
        const format = outputFormat.value;
        const quality = parseFloat(videoQuality.value);

        loadingOverlay.classList.remove('hidden');
        progressBar.style.width = '0%';
        progressText.textContent = '0%';
        loadingText.textContent = t('generating_frames');


        try {
            // Generate all frames
            const frames = await generateFrames(speed, duration, fps, (progress) => {
                progressBar.style.width = `${progress * 50}%`;
                progressText.textContent = `${Math.round(progress * 50)}%`;
            });

            loadingText.textContent = t('encoding_video');


            // Encode video
            if (format === 'gif') {
                await exportGif(frames, fps, (progress) => {
                    progressBar.style.width = `${50 + progress * 50}%`;
                    progressText.textContent = `${Math.round(50 + progress * 50)}%`;
                });
            } else {
                await encodeVideo(frames, fps, format, quality, (progress) => {
                    progressBar.style.width = `${50 + progress * 50}%`;
                    progressText.textContent = `${Math.round(50 + progress * 50)}%`;
                });
            }

            loadingOverlay.classList.add('hidden');
        } catch (e) {
            console.error(e);
            alert(t('error_processing') + e.message);

            loadingOverlay.classList.add('hidden');
        }
    });

    async function generateFrames(speed, duration, fps, onProgress) {
        const totalFrames = Math.round(duration * fps);
        const frames = [];
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = imageWidth;
        canvas.height = imageHeight;
        
        const pixelsPerFrame = speed / fps;
        
        for (let i = 0; i < totalFrames; i++) {
            // Calculate offset for this frame using continuous formula
            // This ensures smooth transition without jumps
            const totalPixelsMoved = i * pixelsPerFrame;
            
            let offset;
            if (direction === 'left') {
                // Left: offset increases, image shifts left
                offset = totalPixelsMoved % imageWidth;
            } else {
                // Right: offset decreases, image shifts right
                // Use negative offset wrapped to positive
                offset = (imageWidth - (totalPixelsMoved % imageWidth)) % imageWidth;
            }
            
            // Draw frame
            ctx.clearRect(0, 0, imageWidth, imageHeight);
            
            // Draw two copies of the image for seamless loop
            ctx.drawImage(sourceImage, -offset, 0);
            ctx.drawImage(sourceImage, imageWidth - offset, 0);
            
            // Get image data
            const imageData = ctx.getImageData(0, 0, imageWidth, imageHeight);
            frames.push(imageData);
            
            onProgress((i + 1) / totalFrames);
            
            // Yield to UI
            if (i % 10 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        return frames;
    }

    async function encodeVideo(frames, fps, format, quality, onProgress) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = frames[0].width;
        canvas.height = frames[0].height;

        const frameDurationUs = Math.round(1000000 / fps);

        console.log(`Encoding: ${frames.length} frames @ ${fps} FPS`);

        // Try WebCodecs + webm-muxer if available
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
        
        const fileChunks = [];
        
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
                frameRate: fps
            },
            type: 'webm',
            firstTimestampBehavior: 'offset'
        });

        const encoder = new VideoEncoder({
            output: (chunk, metadata) => {
                muxer.addVideoChunk(chunk, metadata);
            },
            error: (e) => {
                throw new Error(t('error_video_encoder', { message: e.message }));

            }
        });

        let codecConfig = {
            codec: 'vp09.00.10.08.01',
            width: width,
            height: height,
            bitrate: Math.round(quality * 8000000),
            framerate: fps
        };

        let support = await VideoEncoder.isConfigSupported(codecConfig);
        if (!support.supported) {
            codecConfig.codec = 'vp09.00.10.08';
            support = await VideoEncoder.isConfigSupported(codecConfig);
        }
        if (!support.supported) {
            codecConfig.codec = 'vp8';
            support = await VideoEncoder.isConfigSupported(codecConfig);
        }
        
        if (!support.supported) {
            throw new Error(t('error_no_supported_codec'));
        }

        
        encoder.configure(codecConfig);

        // Calculate keyframe interval - only first frame is keyframe for smooth looping video
        // Or use longer interval (e.g., every 5 seconds) to minimize potential stutter
        const keyframeInterval = Math.round(fps * 5);

        for (let i = 0; i < frames.length; i++) {
            ctx.putImageData(frames[i], 0, 0);
            
            const timestamp = i * frameDurationUs;
            const videoFrame = new VideoFrame(canvas, {
                timestamp: timestamp,
                duration: frameDurationUs
            });
            
            // Only first frame is keyframe, rest are delta frames for smoothness
            const isKeyFrame = i === 0;
            encoder.encode(videoFrame, { keyFrame: isKeyFrame });
            videoFrame.close();
            
            onProgress((i + 1) / frames.length * 0.95);
            
            if (i % 5 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        await encoder.flush();
        encoder.close();
        
        muxer.finalize();
        
        // Combine chunks
        fileChunks.sort((a, b) => a.position - b.position);
        
        let totalSize = 0;
        for (const chunk of fileChunks) {
            totalSize = Math.max(totalSize, chunk.position + chunk.data.length);
        }
        
        const finalBuffer = new Uint8Array(totalSize);
        for (const chunk of fileChunks) {
            finalBuffer.set(chunk.data, chunk.position);
        }
        
        const blob = new Blob([finalBuffer], { type: 'video/webm' });
        
        console.log(`WebM created: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
        
        downloadBlob(blob, `loop_video_${Date.now()}.webm`);
        onProgress(1);
    }

    async function encodeWithMediaRecorder(frames, fps, format, quality, canvas, ctx, onProgress) {
        let mimeType;
        if (format === 'webm-vp9') {
            mimeType = 'video/webm;codecs=vp9';
        } else {
            mimeType = 'video/webm;codecs=vp8';
        }
        
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm';
        }

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

        const frameDurationMs = 1000 / fps;
        
        recorder.start();
        const recordStartTime = performance.now();
        
        for (let i = 0; i < frames.length; i++) {
            ctx.putImageData(frames[i], 0, 0);
            
            if (videoTrack.requestFrame) {
                videoTrack.requestFrame();
            }
            
            onProgress((i + 1) / frames.length);
            
            const targetNextFrameTime = recordStartTime + (i + 1) * frameDurationMs;
            const now = performance.now();
            const waitTime = targetNextFrameTime - now;
            
            if (waitTime > 4) {
                await new Promise(resolve => setTimeout(resolve, waitTime - 2));
            }
            
            while (performance.now() < targetNextFrameTime) {
                // Busy wait for precision
            }
        }

        await new Promise(resolve => setTimeout(resolve, frameDurationMs));
        recorder.stop();

        const blob = await recordingPromise;
        
        downloadBlob(blob, `loop_video_${Date.now()}.webm`);
    }

    async function exportGif(frames, fps, onProgress) {
        // Simple GIF export using canvas
        // For better quality, would need gif.js library
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = frames[0].width;
        canvas.height = frames[0].height;
        
        // Check if gif.js is available
        if (window.GIF) {
            const gif = new GIF({
                workers: 2,
                quality: 10,
                width: canvas.width,
                height: canvas.height
            });
            
            for (let i = 0; i < frames.length; i++) {
                ctx.putImageData(frames[i], 0, 0);
                gif.addFrame(ctx, { copy: true, delay: 1000 / fps });
                onProgress((i + 1) / frames.length * 0.8);
            }
            
            return new Promise((resolve) => {
                gif.on('finished', (blob) => {
                    downloadBlob(blob, `loop_animation_${Date.now()}.gif`);
                    onProgress(1);
                    resolve();
                });
                gif.render();
            });
        } else {
            // Fallback: export as WebM with note
            alert(t('gif_lib_hint'));

            await encodeWithMediaRecorder(frames, fps, 'webm-vp8', 0.8, canvas, ctx, onProgress);
        }
    }

    const downloadBlob = (blob, filename) => {
        if (typeof window.downloadBlob === 'function') {
            window.downloadBlob(blob, filename, { revokeDelay: 0, appendToBody: false });
            return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };


    // --- Language Change Handler ---
    window.addEventListener('languageChanged', () => {
        applyI18nAttrs();
        updateInfoDisplay();
    });
});
