/**
 * Live2D Preview Tool
 * Uses pixi-live2d-display for rendering Live2D Cubism 3/4 models
 */

document.addEventListener('DOMContentLoaded', () => {
    // === Library Checks ===
    console.log('DOM loaded, checking libraries...');
    
    if (typeof PIXI === 'undefined') {
        console.error('PIXI.js not loaded');
        showToast('PIXI.js 加载失败', 'error');
        return;
    }
    console.log('PIXI.js loaded:', PIXI.VERSION);
    
    if (typeof Live2DCubismCore === 'undefined') {
        console.error('Live2DCubismCore not loaded');
        showToast('Live2D Cubism Core SDK 加载失败', 'error');
        return;
    }
    console.log('Live2DCubismCore loaded');
    
    if (!PIXI.live2d || !PIXI.live2d.Live2DModel) {
        console.error('pixi-live2d-display not loaded properly');
        showToast('pixi-live2d-display 加载失败', 'error');
        return;
    }
    console.log('Live2DModel class available');

    // === DOM Elements ===
    const dropZone = document.getElementById('dropZone');
    const folderInput = document.getElementById('folderInput');
    const modelInfo = document.getElementById('modelInfo');
    const modelName = document.getElementById('modelName');
    const modelVersion = document.getElementById('modelVersion');
    const modelFileCount = document.getElementById('modelFileCount');
    const expressionSection = document.getElementById('expressionSection');
    const expressionList = document.getElementById('expressionList');
    const motionSection = document.getElementById('motionSection');
    const motionList = document.getElementById('motionList');
    const parameterSection = document.getElementById('parameterSection');
    const parameterList = document.getElementById('parameterList');
    const bgColorInput = document.getElementById('bgColor');
    const transparentBgBtn = document.getElementById('transparentBg');
    const scaleSlider = document.getElementById('scaleSlider');
    const scaleValue = document.getElementById('scaleValue');
    const mouseLookAt = document.getElementById('mouseLookAt');
    const resetBtn = document.getElementById('resetBtn');
    const canvasContainer = document.getElementById('canvasContainer');
    const placeholder = document.getElementById('placeholder');
    const live2dCanvas = document.getElementById('live2dCanvas');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const playIcon = document.getElementById('playIcon');
    const screenshotBtn = document.getElementById('screenshotBtn');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const toast = document.getElementById('toast');

    // === State ===
    let app = null;
    let model = null;
    let modelFiles = {};
    let modelJsonData = null;
    let isPlaying = true;
    let isTransparentBg = false;
    
    // Pause state - store original update function
    let originalModelUpdate = null;
    
    // Dragging state
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let modelStartX = 0;
    let modelStartY = 0;
    let modelOffsetX = 0;
    let modelOffsetY = 0;
    
    // Scale
    let baseFitScale = 1;
    
    // File data cache
    let cachedFileData = {};
    const fakeBaseUrl = 'https://local-live2d-model/';
    
    // Store original functions for interception
    const originalFetch = window.fetch;
    const OriginalXHR = window.XMLHttpRequest;
    
    // Get Live2DModel class
    const Live2DModel = PIXI.live2d.Live2DModel;

    // === Toast Notification ===
    function showToast(message, type = 'info') {
        toast.textContent = message;
        toast.className = 'toast ' + type;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // === File Cache Helpers ===
    function findFileInCache(url) {
        if (!url) return null;
        const fileName = decodeURIComponent(url.split('/').pop().split('?')[0]);
        
        for (const [path, data] of Object.entries(cachedFileData)) {
            const pathFileName = path.split('/').pop();
            if (path === url || pathFileName === fileName || path.endsWith(fileName) ||
                decodeURIComponent(path) === url || path === decodeURIComponent(url)) {
                return { path, data };
            }
        }
        return null;
    }
    
    function getFileType(path) {
        const lower = path.toLowerCase();
        if (lower.endsWith('.json')) return 'json';
        if (lower.endsWith('.moc3')) return 'arraybuffer';
        if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image';
        return 'text';
    }

    // === Network Interception ===
    window.fetch = async function(url, options) {
        const urlStr = typeof url === 'string' ? url : url.url;
        
        if (!urlStr.startsWith(fakeBaseUrl)) {
            return originalFetch.call(this, url, options);
        }
        
        console.log('Fetch intercepted:', urlStr);
        const relativePath = urlStr.substring(fakeBaseUrl.length);
        const found = findFileInCache(relativePath) || findFileInCache(urlStr);
        
        if (found) {
            console.log('Returning cached:', relativePath);
            const fileType = getFileType(found.path);
            const contentType = fileType === 'image' ? 'image/png' : 
                               fileType === 'arraybuffer' ? 'application/octet-stream' : 
                               'application/json';
            return new Response(found.data, { status: 200, headers: { 'Content-Type': contentType } });
        }
        
        console.warn('File not in cache:', relativePath);
        return originalFetch.call(this, url, options);
    };
    
    window.XMLHttpRequest = function() {
        const xhr = new OriginalXHR();
        const originalOpen = xhr.open.bind(xhr);
        const originalSend = xhr.send.bind(xhr);
        
        let interceptedUrl = null;
        let interceptedData = null;
        let _responseType = '';
        
        Object.defineProperty(xhr, 'responseType', {
            get: () => _responseType,
            set: (v) => { _responseType = v; }
        });
        
        xhr.open = function(method, url, ...args) {
            if (typeof url === 'string' && url.startsWith(fakeBaseUrl)) {
                const relativePath = url.substring(fakeBaseUrl.length);
                const found = findFileInCache(relativePath) || findFileInCache(url);
                if (found) {
                    interceptedUrl = url;
                    interceptedData = found;
                    console.log('XHR intercepted:', relativePath);
                    return;
                }
            }
            return originalOpen(method, url, ...args);
        };
        
        xhr.send = function(body) {
            if (interceptedData) {
                setTimeout(() => {
                    const data = interceptedData.data;
                    const fileType = getFileType(interceptedData.path);
                    
                    let response, responseText = '';
                    if (data instanceof ArrayBuffer) {
                        response = data;
                    } else if (_responseType === 'json' || fileType === 'json') {
                        try {
                            response = JSON.parse(data);
                            responseText = data;
                        } catch (e) {
                            response = data;
                            responseText = data;
                        }
                    } else {
                        response = responseText = data;
                    }
                    
                    Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
                    Object.defineProperty(xhr, 'statusText', { value: 'OK', configurable: true });
                    Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
                    Object.defineProperty(xhr, 'response', { value: response, configurable: true });
                    Object.defineProperty(xhr, 'responseText', { value: responseText, configurable: true });
                    Object.defineProperty(xhr, 'responseURL', { value: interceptedUrl, configurable: true });
                    
                    if (xhr.onreadystatechange) xhr.onreadystatechange();
                    if (xhr.onload) xhr.onload({ target: xhr });
                    try { xhr.dispatchEvent(new Event('load')); } catch (e) {}
                }, 0);
                return;
            }
            return originalSend(body);
        };
        
        return xhr;
    };

    // === PIXI Application ===
    function initPixiApp() {
        if (app) {
            app.destroy(true, { children: true });
        }

        const width = canvasContainer.clientWidth;
        const height = canvasContainer.clientHeight;

        app = new PIXI.Application({
            view: live2dCanvas,
            width,
            height,
            backgroundColor: isTransparentBg ? 0x000000 : parseInt(bgColorInput.value.slice(1), 16),
            backgroundAlpha: isTransparentBg ? 0 : 1,
            autoStart: true,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true,
            preserveDrawingBuffer: true,  // Required for screenshot functionality
        });

        live2dCanvas.classList.add('show');
        placeholder.style.display = 'none';
    }

    // === Model Positioning ===
    function centerModel(resetOffset = false) {
        if (!model || !app) return;
        
        if (resetOffset) {
            modelOffsetX = 0;
            modelOffsetY = 0;
        }
        
        const canvasWidth = app.renderer.width;
        const canvasHeight = app.renderer.height;
        const modelWidth = model.width / model.scale.x;
        const modelHeight = model.height / model.scale.y;
        
        const padding = 0.9;
        const scaleX = (canvasWidth * padding) / modelWidth;
        const scaleY = (canvasHeight * padding) / modelHeight;
        baseFitScale = Math.min(scaleX, scaleY);
        
        const userScale = parseFloat(scaleSlider.value);
        model.scale.set(baseFitScale * userScale);
        
        model.x = canvasWidth / 2 + modelOffsetX;
        model.y = canvasHeight / 2 + modelOffsetY;
    }
    
    function updateModelPosition() {
        if (!model || !app) return;
        model.x = app.renderer.width / 2 + modelOffsetX;
        model.y = app.renderer.height / 2 + modelOffsetY;
    }

    // === Canvas Interaction ===
    live2dCanvas.addEventListener('mousedown', (e) => {
        if (!model || e.button !== 0) return;
        e.preventDefault();
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        modelStartX = modelOffsetX;
        modelStartY = modelOffsetY;
    });
    
    live2dCanvas.addEventListener('mousemove', (e) => {
        if (isDragging) {
            modelOffsetX = modelStartX + (e.clientX - dragStartX);
            modelOffsetY = modelStartY + (e.clientY - dragStartY);
            updateModelPosition();
        } else if (model && mouseLookAt.checked) {
            const rect = live2dCanvas.getBoundingClientRect();
            model.focus(e.clientX - rect.left, e.clientY - rect.top);
        }
    });
    
    live2dCanvas.addEventListener('mouseup', () => { isDragging = false; });
    live2dCanvas.addEventListener('mouseleave', () => { isDragging = false; });
    
    live2dCanvas.addEventListener('wheel', (e) => {
        if (!model) return;
        e.preventDefault();
        
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        let newValue = Math.max(0.1, Math.min(3, parseFloat(scaleSlider.value) + delta));
        
        scaleSlider.value = newValue;
        scaleValue.textContent = newValue.toFixed(1) + 'x';
        centerModel();
    }, { passive: false });
    
    live2dCanvas.addEventListener('dblclick', () => {
        if (!model) return;
        scaleSlider.value = 1;
        scaleValue.textContent = '1.0x';
        centerModel(true);
        showToast('视图已重置', 'info');
    });

    // === File Drop & Select ===
    dropZone.addEventListener('click', () => folderInput.click());
    
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        
        const items = e.dataTransfer.items;
        if (items) {
            for (let i = 0; i < items.length; i++) {
                const entry = items[i].webkitGetAsEntry();
                if (entry?.isDirectory) {
                    await processDirectory(entry);
                    break;
                }
            }
        }
    });

    folderInput.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
            await processFiles(e.target.files);
        }
    });

    // === Directory Processing ===
    async function processDirectory(directoryEntry) {
        showLoading();
        modelFiles = {};
        
        const files = await readDirectoryRecursively(directoryEntry);
        for (const file of files) {
            const relativePath = file.fullPath.replace('/' + directoryEntry.name + '/', '');
            modelFiles[relativePath] = file;
        }
        
        await loadModel();
    }

    function readDirectoryRecursively(directoryEntry) {
        return new Promise((resolve) => {
            const files = [];
            const reader = directoryEntry.createReader();
            
            function readEntries() {
                reader.readEntries(async (entries) => {
                    if (entries.length === 0) {
                        resolve(files);
                        return;
                    }
                    
                    for (const entry of entries) {
                        if (entry.isFile) {
                            const file = await new Promise((res) => entry.file(res));
                            file.fullPath = entry.fullPath;
                            files.push(file);
                        } else if (entry.isDirectory) {
                            files.push(...await readDirectoryRecursively(entry));
                        }
                    }
                    readEntries();
                });
            }
            readEntries();
        });
    }

    async function processFiles(files) {
        showLoading();
        modelFiles = {};
        
        const basePath = files[0].webkitRelativePath.split('/')[0] + '/';
        for (const file of files) {
            modelFiles[file.webkitRelativePath.replace(basePath, '')] = file;
        }
        
        await loadModel();
    }

    // === Model Loading ===
    async function loadModel() {
        try {
            const modelJsonFile = Object.keys(modelFiles).find(f => f.endsWith('.model3.json'));
            
            if (!modelJsonFile) {
                hideLoading();
                showToast('未找到 .model3.json 文件', 'error');
                return;
            }

            console.log('Found model:', modelJsonFile);

            // Cache all files
            cachedFileData = {};
            for (const [path, file] of Object.entries(modelFiles)) {
                const lower = path.toLowerCase();
                if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.moc3')) {
                    cachedFileData[path] = await readFileAsArrayBuffer(file);
                } else {
                    cachedFileData[path] = await readFileAsText(file);
                }
            }

            modelJsonData = JSON.parse(cachedFileData[modelJsonFile]);
            
            if (!app) initPixiApp();

            // Remove existing model
            if (model) {
                app.stage.removeChild(model);
                model.destroy();
                model = null;
            }

            // Create blob URLs for textures
            const imageUrls = {};
            for (const [path, data] of Object.entries(cachedFileData)) {
                const lower = path.toLowerCase();
                if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
                    const mimeType = lower.endsWith('.png') ? 'image/png' : 'image/jpeg';
                    imageUrls[path] = URL.createObjectURL(new Blob([data], { type: mimeType }));
                }
            }

            // Patch texture loading
            const originalTextureFrom = PIXI.Texture.from;
            const originalBaseTextureFrom = PIXI.BaseTexture.from;
            
            PIXI.Texture.from = function(source, options) {
                if (typeof source === 'string') {
                    const fileName = source.split('/').pop().split('?')[0];
                    for (const [path, url] of Object.entries(imageUrls)) {
                        if (path.endsWith(fileName)) {
                            return originalTextureFrom.call(this, url, options);
                        }
                    }
                }
                return originalTextureFrom.call(this, source, options);
            };
            
            PIXI.BaseTexture.from = function(source, options) {
                if (typeof source === 'string') {
                    const fileName = source.split('/').pop().split('?')[0];
                    for (const [path, url] of Object.entries(imageUrls)) {
                        if (path.endsWith(fileName)) {
                            return originalBaseTextureFrom.call(this, url, options);
                        }
                    }
                }
                return originalBaseTextureFrom.call(this, source, options);
            };

            // Load model
            model = await Live2DModel.from(fakeBaseUrl + modelJsonFile, {
                autoInteract: mouseLookAt.checked,
                autoUpdate: true,
            });
            
            // Restore texture functions
            PIXI.Texture.from = originalTextureFrom;
            PIXI.BaseTexture.from = originalBaseTextureFrom;

            model.anchor.set(0.5, 0.5);
            app.stage.addChild(model);
            centerModel(true);

            model.on('hit', (areas) => console.log('Hit:', areas));

            // Setup time correction for pause/resume
            setupModelTimeCorrection();

            // Update UI
            updateModelInfo(modelJsonData, modelJsonFile);
            updateExpressions();
            updateMotions();
            updateParameters();

            hideLoading();
            showToast('模型加载成功', 'success');

        } catch (error) {
            console.error('Error loading model:', error);
            hideLoading();
            showToast('加载失败: ' + error.message, 'error');
        }
    }

    // === File Readers ===
    function readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    // === UI Updates ===
    function updateModelInfo(modelJson, fileName) {
        modelInfo.classList.add('show');
        modelName.textContent = fileName.replace('.model3.json', '');
        modelVersion.textContent = 'Cubism ' + (modelJson.Version || '3');
        modelFileCount.textContent = Object.keys(modelFiles).length + ' 个文件';
    }

    function updateExpressions() {
        expressionList.innerHTML = '';
        
        if (!model?.internalModel) {
            expressionSection.style.display = 'none';
            return;
        }
        
        const expressionManager = model.internalModel.motionManager?.expressionManager;
        let definitions = expressionManager?.definitions || [];
        
        if (definitions.length === 0 && modelJsonData?.FileReferences?.Expressions) {
            definitions = modelJsonData.FileReferences.Expressions;
        }
        
        if (definitions.length === 0) {
            expressionSection.style.display = 'none';
            return;
        }
        
        expressionSection.style.display = 'block';
        
        // Reset button
        const resetBtn = document.createElement('button');
        resetBtn.className = 'expression-btn';
        resetBtn.textContent = '🔄 重置';
        resetBtn.addEventListener('click', () => {
            expressionManager?.resetExpression();
            setActiveBtn(expressionList, resetBtn);
        });
        expressionList.appendChild(resetBtn);
        
        definitions.forEach((exp, index) => {
            const btn = document.createElement('button');
            btn.className = 'expression-btn';
            btn.textContent = exp.Name || exp.name || `表情 ${index + 1}`;
            btn.addEventListener('click', () => {
                model.expression(index);
                setActiveBtn(expressionList, btn);
            });
            expressionList.appendChild(btn);
        });
    }

    function updateMotions() {
        motionList.innerHTML = '';
        
        if (!model?.internalModel) {
            motionSection.style.display = 'none';
            return;
        }
        
        const motionManager = model.internalModel.motionManager;
        let definitions = motionManager?.definitions || {};
        let groups = Object.keys(definitions);
        
        if (groups.length === 0 && modelJsonData?.FileReferences?.Motions) {
            definitions = modelJsonData.FileReferences.Motions;
            groups = Object.keys(definitions);
        }
        
        const motionFiles = Object.keys(modelFiles).filter(f => f.endsWith('.motion3.json'));
        
        if (groups.length === 0 && motionFiles.length === 0) {
            motionSection.style.display = 'none';
            return;
        }
        
        motionSection.style.display = 'block';
        
        // Add defined motions
        groups.forEach(group => {
            const motions = definitions[group];
            if (!Array.isArray(motions)) return;
            
            motions.forEach((motion, index) => {
                const btn = document.createElement('button');
                btn.className = 'motion-btn';
                
                // Generate button text with proper fallbacks
                let btnText = motion.Name || motion.name;
                if (!btnText && motion.File) {
                    // Extract filename from path
                    btnText = motion.File.replace('.motion3.json', '').split('/').pop();
                }
                if (!btnText) {
                    // Use group name if available, otherwise use generic name
                    const groupName = group || 'Motion';
                    btnText = `${groupName} ${index + 1}`;
                }
                btn.textContent = btnText;
                btn.title = `${group || '(默认)'} #${index + 1}${motion.File ? ': ' + motion.File : ''}`;
                
                btn.addEventListener('click', () => {
                    model.motion(group, index);
                    highlightBtn(btn);
                });
                motionList.appendChild(btn);
            });
        });
        
        // Add standalone motions from files not in definitions
        motionFiles.forEach(file => {
            // Check if motion is already in definitions
            let isDefined = false;
            for (const group of groups) {
                if (Array.isArray(definitions[group]) && 
                    definitions[group].some(m => {
                        const motionFile = m.File || m.file || '';
                        return motionFile === file || motionFile.endsWith(file) || file.endsWith(motionFile);
                    })) {
                    isDefined = true;
                    break;
                }
            }
            
            if (!isDefined) {
                const btn = document.createElement('button');
                btn.className = 'motion-btn';
                btn.textContent = '📁 ' + file.replace('.motion3.json', '').split('/').pop();
                btn.title = file;
                btn.addEventListener('click', async () => {
                    highlightBtn(btn);
                    try {
                        // Load and play motion directly using the motion file data
                        const motionData = cachedFileData[file];
                        if (!motionData) {
                            showToast('动作文件未找到', 'error');
                            return;
                        }
                        
                        const motionMgr = model.internalModel.motionManager;
                        
                        // Initialize Standalone group with proper structure
                        if (!motionMgr.definitions['Standalone']) {
                            motionMgr.definitions['Standalone'] = [];
                        }
                        
                        // Also ensure the motion group exists
                        if (!motionMgr.motionGroups['Standalone']) {
                            motionMgr.motionGroups['Standalone'] = [];
                        }
                        
                        // Check if already registered
                        let idx = motionMgr.definitions['Standalone'].findIndex(m => 
                            (m.File || m.file) === file
                        );
                        
                        if (idx === -1) {
                            // Add new motion definition
                            motionMgr.definitions['Standalone'].push({ 
                                File: file,
                                FadeInTime: 0.5,
                                FadeOutTime: 0.5
                            });
                            idx = motionMgr.definitions['Standalone'].length - 1;
                            
                            // Initialize the motion group array slot
                            motionMgr.motionGroups['Standalone'][idx] = null;
                        }
                        
                        console.log('Playing standalone motion:', file, 'index:', idx);
                        await model.motion('Standalone', idx);
                        
                    } catch (e) {
                        console.error('Motion error:', e);
                        showToast('动作播放失败: ' + e.message, 'error');
                    }
                });
                motionList.appendChild(btn);
            }
        });
    }

    function updateParameters() {
        parameterList.innerHTML = '';
        
        if (!model?.internalModel?.coreModel?._model) {
            parameterSection.style.display = 'none';
            return;
        }
        
        const coreModel = model.internalModel.coreModel;
        const paramCount = coreModel.getParameterCount();
        
        if (paramCount === 0) {
            parameterSection.style.display = 'none';
            return;
        }
        
        parameterSection.style.display = 'block';
        
        const maxParams = Math.min(paramCount, 20);
        const paramIds = coreModel._parameterIds || [];
        
        for (let i = 0; i < maxParams; i++) {
            const paramId = paramIds[i] || `Param ${i}`;
            const minVal = coreModel.getParameterMinimumValue(i);
            const maxVal = coreModel.getParameterMaximumValue(i);
            const curVal = coreModel.getParameterValueByIndex(i);
            
            const item = document.createElement('div');
            item.className = 'parameter-item';
            
            const label = document.createElement('label');
            label.innerHTML = `${paramId} <span>${curVal.toFixed(2)}</span>`;
            
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = minVal;
            slider.max = maxVal;
            slider.step = (maxVal - minVal) / 100;
            slider.value = curVal;
            
            const idx = i;
            slider.addEventListener('input', () => {
                const val = parseFloat(slider.value);
                coreModel.setParameterValueByIndex(idx, val);
                label.querySelector('span').textContent = val.toFixed(2);
            });
            
            item.appendChild(label);
            item.appendChild(slider);
            parameterList.appendChild(item);
        }
        
        if (paramCount > maxParams) {
            const note = document.createElement('div');
            note.style.cssText = 'text-align:center;color:#666;font-size:0.75rem;margin-top:8px;';
            note.textContent = `还有 ${paramCount - maxParams} 个参数...`;
            parameterList.appendChild(note);
        }
    }

    function setActiveBtn(container, activeBtn) {
        container.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        activeBtn.classList.add('active');
    }

    function highlightBtn(btn) {
        btn.classList.add('active');
        setTimeout(() => btn.classList.remove('active'), 1500);
    }

    // === Settings Handlers ===
    bgColorInput.addEventListener('input', () => {
        if (app && !isTransparentBg) {
            app.renderer.background.color = parseInt(bgColorInput.value.slice(1), 16);
        }
    });

    transparentBgBtn.addEventListener('click', () => {
        isTransparentBg = !isTransparentBg;
        transparentBgBtn.classList.toggle('active', isTransparentBg);
        
        if (app) {
            app.renderer.background.alpha = isTransparentBg ? 0 : 1;
            if (!isTransparentBg) {
                app.renderer.background.color = parseInt(bgColorInput.value.slice(1), 16);
            }
        }
    });

    scaleSlider.addEventListener('input', () => {
        const scale = parseFloat(scaleSlider.value);
        scaleValue.textContent = scale.toFixed(1) + 'x';
        if (model) centerModel();
    });

    mouseLookAt.addEventListener('change', () => {
        if (model) model.autoInteract = mouseLookAt.checked;
    });

    resetBtn.addEventListener('click', () => {
        scaleSlider.value = 1;
        scaleValue.textContent = '1.0x';
        if (model) centerModel(true);
        showToast('视图已重置', 'info');
    });

    // === Preview Controls ===
    playPauseBtn.addEventListener('click', () => {
        if (!app || !model) return;
        
        isPlaying = !isPlaying;
        
        if (isPlaying) {
            // Resume: Restore the original update function
            if (originalModelUpdate) {
                model.update = originalModelUpdate;
            }
            playIcon.textContent = '⏸️';
        } else {
            // Pause: Replace update with empty function to freeze animation
            if (!originalModelUpdate) {
                originalModelUpdate = model.update.bind(model);
            }
            model.update = function() {}; // Do nothing - freeze animation
            playIcon.textContent = '▶️';
        }
    });

    // Setup pause control for newly loaded model
    function setupModelTimeCorrection() {
        // Reset play state when loading new model
        isPlaying = true;
        originalModelUpdate = null;
        playIcon.textContent = '⏸️';
    }

    screenshotBtn.addEventListener('click', () => {
        if (!app) return;
        
        const link = document.createElement('a');
        link.download = `live2d_${Date.now()}.png`;
        link.href = app.view.toDataURL('image/png');
        link.click();
        
        showToast('截图已保存', 'success');
    });

    fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            canvasContainer.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    });

    // Handle fullscreen change to fix layout issues
    document.addEventListener('fullscreenchange', () => {
        // Use setTimeout to wait for DOM to update after fullscreen change
        setTimeout(() => {
            if (app) {
                const width = canvasContainer.clientWidth;
                const height = canvasContainer.clientHeight;
                app.renderer.resize(width, height);
                if (model) centerModel();
            }
        }, 100);
    });

    // === Helper Functions ===
    function showLoading() {
        loadingOverlay.classList.add('show');
    }

    function hideLoading() {
        loadingOverlay.classList.remove('show');
    }

    // === Resize Observer ===
    const resizeObserver = new ResizeObserver(() => {
        if (app) {
            app.renderer.resize(canvasContainer.clientWidth, canvasContainer.clientHeight);
            if (model) centerModel();
        }
    });
    resizeObserver.observe(canvasContainer);

    // === Window Resize ===
    window.addEventListener('resize', () => {
        if (app && model) {
            app.renderer.resize(canvasContainer.clientWidth, canvasContainer.clientHeight);
            centerModel();
        }
    });

    // ========================================
    // Export Frame Sequence Feature
    // ========================================
    
    // Export DOM Elements
    const exportFramesBtn = document.getElementById('exportFramesBtn');
    const exportModal = document.getElementById('exportModal');
    const exportModalClose = document.getElementById('exportModalClose');
    const exportExpressionList = document.getElementById('exportExpressionList');
    const exportMotionList = document.getElementById('exportMotionList');
    const exportFps = document.getElementById('exportFps');
    const exportDuration = document.getElementById('exportDuration');
    const exportWidth = document.getElementById('exportWidth');
    const exportHeight = document.getElementById('exportHeight');
    const exportTotalFrames = document.getElementById('exportTotalFrames');
    const exportCancel = document.getElementById('exportCancel');
    const exportPreviewBtn = document.getElementById('exportPreviewBtn');
    
    // Preview Modal Elements
    const previewModal = document.getElementById('previewModal');
    const previewModalClose = document.getElementById('previewModalClose');
    const previewCanvasContainer = document.getElementById('previewCanvasContainer');
    const previewCanvas = document.getElementById('previewCanvas');
    const previewInfoText = document.getElementById('previewInfoText');
    const previewBackBtn = document.getElementById('previewBackBtn');
    const previewConfirmBtn = document.getElementById('previewConfirmBtn');
    
    // Progress Modal Elements
    const exportProgressModal = document.getElementById('exportProgressModal');
    const exportProgressText = document.getElementById('exportProgressText');
    const exportProgressBar = document.getElementById('exportProgressBar');
    const exportProgressDetail = document.getElementById('exportProgressDetail');
    const exportCancelProgress = document.getElementById('exportCancelProgress');
    
    // Size preset buttons
    const size256 = document.getElementById('size256');
    const size512 = document.getElementById('size512');
    const size1024 = document.getElementById('size1024');
    
    // Export State
    let selectedExportExpression = null;
    let selectedExportMotionGroup = null;
    let selectedExportMotionIndex = null;
    let selectedExportMotionFile = null; // For standalone motions
    let exportCancelled = false;
    
    // Preview State
    let previewApp = null;
    let previewModel = null;
    let previewAnimationId = null;
    let previewMotionLoopTimer = null;
    
    // Helper
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    
    function updateProgress(percent, detail) {
        exportProgressText.textContent = percent + '%';
        exportProgressBar.style.width = percent + '%';
        if (detail) exportProgressDetail.textContent = detail;
    }
    
    // Update export preview info
    function updateExportPreview() {
        const fps = parseInt(exportFps.value) || 30;
        const duration = parseFloat(exportDuration.value) || 3;
        const totalFrames = Math.ceil(fps * duration);
        exportTotalFrames.textContent = totalFrames;
    }
    
    exportFps.addEventListener('input', updateExportPreview);
    exportDuration.addEventListener('input', updateExportPreview);
    
    // Size presets
    size256.addEventListener('click', () => { exportWidth.value = 256; exportHeight.value = 256; });
    size512.addEventListener('click', () => { exportWidth.value = 512; exportHeight.value = 512; });
    size1024.addEventListener('click', () => { exportWidth.value = 1024; exportHeight.value = 1024; });
    
    // Populate expression list in export modal
    function populateExportExpressions() {
        exportExpressionList.innerHTML = '';
        
        // Add "no expression" option
        const noneBtn = document.createElement('button');
        noneBtn.className = 'export-select-btn selected';
        noneBtn.textContent = window.i18n?.t('export_no_expression') || '无表情';
        noneBtn.addEventListener('click', () => {
            selectedExportExpression = null;
            exportExpressionList.querySelectorAll('.export-select-btn').forEach(b => b.classList.remove('selected'));
            noneBtn.classList.add('selected');
        });
        exportExpressionList.appendChild(noneBtn);
        
        if (!model?.internalModel) return;
        
        const expressionManager = model.internalModel.motionManager?.expressionManager;
        let definitions = expressionManager?.definitions || [];
        
        if (definitions.length === 0 && modelJsonData?.FileReferences?.Expressions) {
            definitions = modelJsonData.FileReferences.Expressions;
        }
        
        definitions.forEach((exp, index) => {
            const btn = document.createElement('button');
            btn.className = 'export-select-btn';
            btn.textContent = exp.Name || exp.name || `表情 ${index + 1}`;
            btn.addEventListener('click', () => {
                selectedExportExpression = index;
                exportExpressionList.querySelectorAll('.export-select-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
            exportExpressionList.appendChild(btn);
        });
    }
    
    // Populate motion list in export modal
    function populateExportMotions() {
        exportMotionList.innerHTML = '';
        
        // Add "idle" option
        const noneBtn = document.createElement('button');
        noneBtn.className = 'export-select-btn selected';
        noneBtn.textContent = window.i18n?.t('export_no_motion') || '静止';
        noneBtn.addEventListener('click', () => {
            selectedExportMotionGroup = null;
            selectedExportMotionIndex = null;
            selectedExportMotionFile = null;
            exportMotionList.querySelectorAll('.export-select-btn').forEach(b => b.classList.remove('selected'));
            noneBtn.classList.add('selected');
        });
        exportMotionList.appendChild(noneBtn);
        
        if (!model?.internalModel) return;
        
        const motionManager = model.internalModel.motionManager;
        let definitions = motionManager?.definitions || {};
        let groups = Object.keys(definitions);
        
        if (groups.length === 0 && modelJsonData?.FileReferences?.Motions) {
            definitions = modelJsonData.FileReferences.Motions;
            groups = Object.keys(definitions);
        }
        
        // Add defined motions
        groups.forEach(group => {
            const motions = definitions[group];
            if (!Array.isArray(motions)) return;
            
            motions.forEach((motion, index) => {
                const btn = document.createElement('button');
                btn.className = 'export-select-btn';
                
                let btnText = motion.Name || motion.name;
                if (!btnText && motion.File) {
                    btnText = motion.File.replace('.motion3.json', '').split('/').pop();
                }
                if (!btnText) {
                    btnText = `${group} ${index + 1}`;
                }
                btn.textContent = btnText;
                
                btn.addEventListener('click', () => {
                    selectedExportMotionGroup = group;
                    selectedExportMotionIndex = index;
                    selectedExportMotionFile = null; // Clear standalone file
                    exportMotionList.querySelectorAll('.export-select-btn').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    
                    // Update duration based on motion
                    const duration = getMotionDuration(group, index);
                    console.log('Motion duration for', group, index, ':', duration);
                    exportDuration.value = duration.toFixed(1);
                    updateExportPreview();
                });
                exportMotionList.appendChild(btn);
            });
        });
        
        // Add standalone motion files
        const motionFiles = Object.keys(modelFiles).filter(f => f.endsWith('.motion3.json'));
        motionFiles.forEach((file) => {
            let isDefined = false;
            for (const group of groups) {
                if (Array.isArray(definitions[group]) && 
                    definitions[group].some(m => {
                        const motionFile = m.File || m.file || '';
                        return motionFile === file || motionFile.endsWith(file) || file.endsWith(motionFile);
                    })) {
                    isDefined = true;
                    break;
                }
            }
            
            if (!isDefined) {
                const btn = document.createElement('button');
                btn.className = 'export-select-btn';
                btn.textContent = '📁 ' + file.replace('.motion3.json', '').split('/').pop();
                btn.addEventListener('click', () => {
                    selectedExportMotionGroup = 'Standalone';
                    selectedExportMotionIndex = null;
                    selectedExportMotionFile = file; // Store the file path
                    exportMotionList.querySelectorAll('.export-select-btn').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    
                    // Get duration from motion file
                    let duration = 3; // Default
                    try {
                        const motionData = JSON.parse(cachedFileData[file]);
                        if (motionData.Meta?.Duration) {
                            duration = motionData.Meta.Duration;
                        }
                    } catch (e) {}
                    console.log('Standalone motion duration:', duration);
                    exportDuration.value = duration.toFixed(1);
                    updateExportPreview();
                });
                exportMotionList.appendChild(btn);
            }
        });
    }
    
    // Get motion duration
    function getMotionDuration(group, index) {
        if (!model?.internalModel?.motionManager) return 0;
        
        const motionManager = model.internalModel.motionManager;
        const definitions = motionManager.definitions || {};
        
        if (definitions[group] && definitions[group][index]) {
            const motionDef = definitions[group][index];
            const motionFile = motionDef.File || motionDef.file;
            if (motionFile) {
                // Try exact match first
                if (cachedFileData[motionFile]) {
                    try {
                        const motionData = JSON.parse(cachedFileData[motionFile]);
                        if (motionData.Meta?.Duration) {
                            return motionData.Meta.Duration;
                        }
                    } catch (e) {}
                }
                
                // Try to find matching file in cache
                const matchingKey = Object.keys(cachedFileData).find(key => 
                    key === motionFile || 
                    key.endsWith(motionFile) || 
                    motionFile.endsWith(key) ||
                    key.endsWith('/' + motionFile.split('/').pop())
                );
                
                if (matchingKey && cachedFileData[matchingKey]) {
                    try {
                        const motionData = JSON.parse(cachedFileData[matchingKey]);
                        if (motionData.Meta?.Duration) {
                            return motionData.Meta.Duration;
                        }
                    } catch (e) {}
                }
            }
        }
        
        return 3; // Default 3 seconds
    }
    
    // Open export modal
    exportFramesBtn.addEventListener('click', () => {
        if (!model) {
            showToast(window.i18n?.t('export_load_model_first') || '请先加载模型', 'error');
            return;
        }
        
        // Reset selections
        selectedExportExpression = null;
        selectedExportMotionGroup = null;
        selectedExportMotionIndex = null;
        selectedExportMotionFile = null;
        
        // Populate lists
        populateExportExpressions();
        populateExportMotions();
        
        updateExportPreview();
        exportModal.classList.add('show');
    });
    
    // Close export modal
    exportModalClose.addEventListener('click', () => exportModal.classList.remove('show'));
    exportCancel.addEventListener('click', () => exportModal.classList.remove('show'));
    
    // Cancel export progress
    exportCancelProgress.addEventListener('click', () => {
        exportCancelled = true;
    });
    
    // ========================================
    // Preview Window - Use Main Model Directly
    // ========================================
    
    // Store preview state for restoration
    let previewSavedState = null;
    let previewImageUrls = {};
    
    // Destroy preview resources and restore main model state
    function destroyPreview() {
        // Clear motion loop timer
        if (previewMotionLoopTimer) {
            clearTimeout(previewMotionLoopTimer);
            previewMotionLoopTimer = null;
        }
        if (previewAnimationId) {
            cancelAnimationFrame(previewAnimationId);
            previewAnimationId = null;
        }
        
        // Restore main model state if saved
        if (previewSavedState && model && app) {
            // Restore model position and scale
            model.scale.set(previewSavedState.scale);
            model.x = previewSavedState.x;
            model.y = previewSavedState.y;
            
            // Resize renderer back to container size
            app.renderer.resize(canvasContainer.clientWidth, canvasContainer.clientHeight);
            centerModel();
            
            // Reset expression if needed
            if (previewSavedState.expression === null) {
                const expressionManager = model.internalModel?.motionManager?.expressionManager;
                expressionManager?.resetExpression();
            }
            
            previewSavedState = null;
        }
        
        previewModel = null;
        previewApp = null;
        
        // Revoke preview image URLs
        for (const url of Object.values(previewImageUrls)) {
            try {
                URL.revokeObjectURL(url);
            } catch (e) {}
        }
        previewImageUrls = {};
    }
    
    // Create preview using the main model and renderer
    async function createPreview() {
        destroyPreview();
        
        if (!model || !app) {
            throw new Error('No model loaded');
        }
        
        const width = parseInt(exportWidth.value) || 512;
        const height = parseInt(exportHeight.value) || 512;
        
        // Save current state
        previewSavedState = {
            scale: model.scale.x,
            x: model.x,
            y: model.y,
            expression: null // Will track if we need to reset
        };
        
        // Set up preview canvas size info (not actually used for rendering)
        previewCanvas.width = width;
        previewCanvas.height = height;
        
        // Use main app and model for preview
        previewApp = app;
        previewModel = model;
        
        // Resize main renderer to preview size
        app.renderer.resize(width, height);
        
        // Scale model to fit preview size
        const modelWidth = previewModel.width / previewModel.scale.x;
        const modelHeight = previewModel.height / previewModel.scale.y;
        const padding = 0.9;
        const scaleX = (width * padding) / modelWidth;
        const scaleY = (height * padding) / modelHeight;
        const previewScale = Math.min(scaleX, scaleY);
        
        previewModel.scale.set(previewScale);
        previewModel.x = width / 2;
        previewModel.y = height / 2;
        
        // Apply expression if selected
        if (selectedExportExpression !== null) {
            previewModel.expression(selectedExportExpression);
            previewSavedState.expression = selectedExportExpression;
        } else {
            // Reset expression
            const expressionManager = previewModel.internalModel?.motionManager?.expressionManager;
            expressionManager?.resetExpression();
        }
        
        // Play motion in loop if selected
        const hasMotionSelected = (selectedExportMotionGroup !== null && selectedExportMotionGroup !== undefined) && 
                                  (selectedExportMotionIndex !== null || selectedExportMotionFile);
        if (hasMotionSelected) {
            console.log('Will play motion:', selectedExportMotionGroup, selectedExportMotionIndex, selectedExportMotionFile);
            // For Standalone motions, need to register them first
            if (selectedExportMotionGroup === 'Standalone' && selectedExportMotionFile) {
                await registerStandaloneMotion(previewModel);
            }
            // Start motion loop with a small delay to ensure model is ready
            setTimeout(() => {
                console.log('Starting motion loop now');
                playMotionLoop();
            }, 200);
        } else {
            console.log('No motion selected:', selectedExportMotionGroup, selectedExportMotionIndex, selectedExportMotionFile);
        }
        
        // Update info text
        const fps = parseInt(exportFps.value) || 30;
        const duration = parseFloat(exportDuration.value) || 3;
        const totalFrames = Math.ceil(fps * duration);
        previewInfoText.textContent = `${width}×${height} | ${fps} FPS | ${duration}s | ${totalFrames} ${window.i18n?.t('export_frames_unit') || '帧'}`;
        
        // Copy frame to preview canvas for display
        const copyToPreviewCanvas = () => {
            if (!previewApp || !previewModel) return;
            
            const ctx = previewCanvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, width, height);
                ctx.drawImage(live2dCanvas, 0, 0, width, height);
            }
            
            previewAnimationId = requestAnimationFrame(copyToPreviewCanvas);
        };
        
        copyToPreviewCanvas();
    }
    
    // Register standalone motion to a model
    async function registerStandaloneMotion(targetModel) {
        if (!selectedExportMotionFile) return;
        
        const file = selectedExportMotionFile;
        const motionMgr = targetModel.internalModel.motionManager;
        
        // Initialize Standalone group
        if (!motionMgr.definitions['Standalone']) {
            motionMgr.definitions['Standalone'] = [];
        }
        if (!motionMgr.motionGroups['Standalone']) {
            motionMgr.motionGroups['Standalone'] = [];
        }
        
        // Check if already registered
        let idx = motionMgr.definitions['Standalone'].findIndex(m => 
            (m.File || m.file) === file
        );
        
        if (idx === -1) {
            motionMgr.definitions['Standalone'].push({ 
                File: file,
                FadeInTime: 0.5,
                FadeOutTime: 0.5
            });
            idx = motionMgr.definitions['Standalone'].length - 1;
            motionMgr.motionGroups['Standalone'][idx] = null;
        }
        
        // Update the selectedExportMotionIndex to the actual index in Standalone group
        selectedExportMotionIndex = idx;
        console.log('Registered standalone motion:', file, 'at index:', idx);
    }
    
    // Play motion in loop
    function playMotionLoop() {
        if (!previewModel || (selectedExportMotionGroup === null || selectedExportMotionGroup === undefined)) {
            console.log('playMotionLoop: No model or motion group', previewModel, selectedExportMotionGroup);
            return;
        }
        
        // Clear any existing timer
        if (previewMotionLoopTimer) {
            clearTimeout(previewMotionLoopTimer);
            previewMotionLoopTimer = null;
        }
        
        const playOnce = async () => {
            if (!previewModel) return;
            
            try {
                console.log('Playing motion:', selectedExportMotionGroup, selectedExportMotionIndex, selectedExportMotionFile);
                
                // Get motion duration for proper loop timing
                let duration = 3000; // default 3 seconds
                
                if (selectedExportMotionGroup === 'Standalone' && selectedExportMotionFile) {
                    try {
                        const motionData = JSON.parse(cachedFileData[selectedExportMotionFile]);
                        if (motionData.Meta?.Duration) {
                            duration = motionData.Meta.Duration * 1000;
                        }
                    } catch (e) {}
                } else {
                    const d = getMotionDuration(selectedExportMotionGroup, selectedExportMotionIndex);
                    if (d > 0) duration = d * 1000;
                }
                
                console.log('Motion duration:', duration);
                
                // Start motion with priority 3 (highest) to ensure it plays
                const motionResult = await previewModel.motion(selectedExportMotionGroup, selectedExportMotionIndex, 3);
                console.log('Motion started:', motionResult);
                
                // Schedule next play slightly before motion ends to ensure smooth loop
                if (previewModel) {
                    previewMotionLoopTimer = setTimeout(playOnce, Math.max(duration - 100, 500));
                }
            } catch (e) {
                console.warn('Motion play error:', e);
                // Retry after a delay
                if (previewModel) {
                    previewMotionLoopTimer = setTimeout(playOnce, 1000);
                }
            }
        };
        
        playOnce();
    }
    
    // Preview button click
    exportPreviewBtn.addEventListener('click', async () => {
        if (!model) {
            showToast(window.i18n?.t('export_load_model_first') || '请先加载模型', 'error');
            return;
        }
        
        exportModal.classList.remove('show');
        
        try {
            await createPreview();
            previewModal.classList.add('show');
        } catch (error) {
            console.error('Preview error:', error);
            showToast((window.i18n?.t('export_error') || '预览失败:') + ' ' + error.message, 'error');
        }
    });
    
    // Preview modal close
    previewModalClose.addEventListener('click', () => {
        destroyPreview();
        previewModal.classList.remove('show');
    });
    
    // Back to settings
    previewBackBtn.addEventListener('click', () => {
        destroyPreview();
        previewModal.classList.remove('show');
        exportModal.classList.add('show');
    });
    
    // Confirm export
    previewConfirmBtn.addEventListener('click', async () => {
        destroyPreview();
        previewModal.classList.remove('show');
        exportProgressModal.classList.add('show');
        exportCancelled = false;
        
        try {
            await exportFrameSequence();
        } catch (error) {
            console.error('Export error:', error);
            showToast((window.i18n?.t('export_error') || '导出失败:') + ' ' + error.message, 'error');
        }
        
        exportProgressModal.classList.remove('show');
    });
    
    // ========================================
    // Export Frame Sequence - Use Main Model
    // ========================================
    
    async function exportFrameSequence() {
        const fps = parseInt(exportFps.value) || 30;
        const duration = parseFloat(exportDuration.value) || 3;
        const width = parseInt(exportWidth.value) || 512;
        const height = parseInt(exportHeight.value) || 512;
        const totalFrames = Math.ceil(fps * duration);
        
        if (!model || !app) {
            showToast('No model loaded', 'error');
            return;
        }
        
        // Save current state
        const savedState = {
            scale: model.scale.x,
            x: model.x,
            y: model.y,
            rendererWidth: app.renderer.width,
            rendererHeight: app.renderer.height,
            isPlaying: isPlaying
        };
        
        // Pause main animation
        if (isPlaying && originalModelUpdate) {
            model.update = function() {};
        }
        
        // Set up export dimensions
        app.renderer.resize(width, height);
        
        // Scale model to fit export size
        const modelWidth = model.width / model.scale.x;
        const modelHeight = model.height / model.scale.y;
        const padding = 0.9;
        const scaleX = (width * padding) / modelWidth;
        const scaleY = (height * padding) / modelHeight;
        const exportScale = Math.min(scaleX, scaleY);
        
        model.scale.set(exportScale);
        model.x = width / 2;
        model.y = height / 2;
        
        // Apply expression if selected
        if (selectedExportExpression !== null) {
            model.expression(selectedExportExpression);
        } else {
            const expressionManager = model.internalModel?.motionManager?.expressionManager;
            expressionManager?.resetExpression();
        }
        
        // Start motion if selected
        const hasMotion = (selectedExportMotionGroup !== null && selectedExportMotionGroup !== undefined) && 
                          (selectedExportMotionIndex !== null || selectedExportMotionFile);
        
        console.log('=== Export Debug ===');
        console.log('hasMotion:', hasMotion);
        console.log('selectedExportMotionGroup:', JSON.stringify(selectedExportMotionGroup));
        console.log('selectedExportMotionIndex:', selectedExportMotionIndex);
        console.log('selectedExportMotionFile:', selectedExportMotionFile);
        
        if (hasMotion) {
            if (selectedExportMotionGroup === 'Standalone' && selectedExportMotionFile) {
                await registerStandaloneMotion(model);
            }
            
            updateProgress(0, window.i18n?.t('export_preparing') || '准备中，重置动作...');
            
            const motionManager = model.internalModel?.motionManager;
            console.log('MotionManager:', motionManager);
            
            // Explore the motionManager structure
            if (motionManager) {
                console.log('MotionManager keys:', Object.keys(motionManager));
                console.log('MotionManager.state:', motionManager.state);
                if (motionManager.state) {
                    console.log('State keys:', Object.keys(motionManager.state));
                }
                
                // Try to find and reset the current motion
                console.log('motionManager.currentGroup:', motionManager.currentGroup);
                console.log('motionManager.currentIndex:', motionManager.currentIndex);
                console.log('motionManager._currentMotion:', motionManager._currentMotion);
                
                // Look for queueManager
                if (motionManager.queueManager) {
                    console.log('queueManager:', motionManager.queueManager);
                    console.log('queueManager keys:', Object.keys(motionManager.queueManager));
                }
                
                // Try to access the actual motion being played
                const groups = motionManager.motionGroups;
                if (groups && groups[selectedExportMotionGroup]) {
                    const motionArray = groups[selectedExportMotionGroup];
                    console.log('Motion group array:', motionArray);
                    if (motionArray[selectedExportMotionIndex]) {
                        const currentMotion = motionArray[selectedExportMotionIndex];
                        console.log('Current motion object:', currentMotion);
                        console.log('Current motion keys:', Object.keys(currentMotion || {}));
                        if (currentMotion) {
                            // Try to find time-related properties
                            for (const key of Object.keys(currentMotion)) {
                                if (key.toLowerCase().includes('time') || key.includes('_t')) {
                                    console.log(`  ${key}:`, currentMotion[key]);
                                }
                            }
                        }
                    }
                }
            }
            
            // Strategy: Reset by stopping all motions first, then starting fresh
            // Try to call stopAllMotions if available
            if (motionManager?.stopAllMotions) {
                console.log('Calling stopAllMotions');
                motionManager.stopAllMotions();
                await sleep(100);
            }
            
            // Alternative: Try to reset via expressionManager approach - reset to idle first
            // Then start the motion
            console.log('Starting fresh motion...');
            
            // Wait for motion to start from beginning using event
            let motionStartFired = false;
            await new Promise((resolve) => {
                const onMotionStart = (group, index) => {
                    console.log('motionStart event fired! group:', group, 'index:', index);
                    motionStartFired = true;
                    model.off('motionStart', onMotionStart);
                    resolve();
                };
                
                model.on('motionStart', onMotionStart);
                
                console.log('Calling model.motion with:', selectedExportMotionGroup, selectedExportMotionIndex);
                
                // Start the motion with force flag by using priority 3
                model.motion(selectedExportMotionGroup, selectedExportMotionIndex, 3);
                
                // Timeout fallback
                setTimeout(() => {
                    console.log('Timeout reached, motionStartFired:', motionStartFired);
                    if (!motionStartFired) {
                        model.off('motionStart', onMotionStart);
                    }
                    resolve();
                }, 500);
            });
            
            console.log('After motion call, motionStartFired:', motionStartFired);
            
            // If motion didn't restart, we need to manually reset the motion time
            if (!motionStartFired && motionManager) {
                console.log('Motion did not restart, trying manual reset...');
                
                const groups = motionManager.motionGroups;
                if (groups && groups[selectedExportMotionGroup]) {
                    const motionObj = groups[selectedExportMotionGroup][selectedExportMotionIndex];
                    if (motionObj) {
                        console.log('Resetting motion object time properties...');
                        // Reset all time-related properties we can find
                        if (motionObj._time !== undefined) {
                            console.log('Resetting _time from', motionObj._time, 'to 0');
                            motionObj._time = 0;
                        }
                        if (motionObj._globalTime !== undefined) {
                            console.log('Resetting _globalTime from', motionObj._globalTime, 'to 0');
                            motionObj._globalTime = 0;
                        }
                        if (motionObj._currentTime !== undefined) {
                            console.log('Resetting _currentTime from', motionObj._currentTime, 'to 0');
                            motionObj._currentTime = 0;
                        }
                        // Check for _motionData
                        if (motionObj._motionData) {
                            console.log('_motionData:', motionObj._motionData);
                        }
                    }
                }
                
                // Also check state object
                if (motionManager.state) {
                    for (const key of Object.keys(motionManager.state)) {
                        if (key.toLowerCase().includes('time')) {
                            console.log(`State.${key}:`, motionManager.state[key]);
                            if (typeof motionManager.state[key] === 'number') {
                                console.log(`Resetting state.${key} to 0`);
                                motionManager.state[key] = 0;
                            }
                        }
                    }
                }
            }
            
            await sleep(50);
        }
        
        updateProgress(0, window.i18n?.t('export_preparing') || '准备中...');
        
        const frames = [];
        const canvas = app.view;
        
        console.log('Starting capture, totalFrames:', totalFrames, 'duration:', duration, 'fps:', fps);
        
        // Use real-time capture with requestAnimationFrame
        const captureStartTime = performance.now();
        const totalDurationMs = duration * 1000;
        
        await new Promise((resolve) => {
            let framesCaptured = 0;
            const frameIntervalMs = (1 / fps) * 1000;
            
            const captureFrame = () => {
                if (exportCancelled) {
                    showToast(window.i18n?.t('export_cancelled') || '已取消导出', 'info');
                    resolve();
                    return;
                }
                
                const elapsed = performance.now() - captureStartTime;
                
                // Check if we should capture a frame at this time
                const expectedFrame = Math.floor(elapsed / frameIntervalMs);
                
                if (expectedFrame > framesCaptured && framesCaptured < totalFrames) {
                    // Render and capture
                    app.renderer.render(app.stage);
                    const dataUrl = canvas.toDataURL('image/png');
                    frames.push(dataUrl);
                    framesCaptured++;
                    
                    const progress = Math.round((framesCaptured / totalFrames) * 100);
                    updateProgress(progress, (window.i18n?.t('export_capturing') || '正在捕获帧...') + ` (${framesCaptured}/${totalFrames})`);
                }
                
                // Continue or finish
                if (framesCaptured >= totalFrames || elapsed >= totalDurationMs + 100) {
                    resolve();
                } else {
                    requestAnimationFrame(captureFrame);
                }
            };
            
            // Capture first frame immediately
            app.renderer.render(app.stage);
            frames.push(canvas.toDataURL('image/png'));
            framesCaptured = 1;
            updateProgress(1, (window.i18n?.t('export_capturing') || '正在捕获帧...') + ` (1/${totalFrames})`);
            
            if (totalFrames > 1) {
                requestAnimationFrame(captureFrame);
            } else {
                resolve();
            }
        });
        
        // Restore state
        app.renderer.resize(savedState.rendererWidth, savedState.rendererHeight);
        model.scale.set(savedState.scale);
        model.x = savedState.x;
        model.y = savedState.y;
        
        // Restore animation state
        if (savedState.isPlaying && originalModelUpdate) {
            model.update = originalModelUpdate;
        }
        
        // Resize to fit container
        app.renderer.resize(canvasContainer.clientWidth, canvasContainer.clientHeight);
        centerModel();
        
        if (exportCancelled) {
            return;
        }
        
        // Package into ZIP
        updateProgress(100, window.i18n?.t('export_packing') || '正在打包下载...');
        await sleep(100);
        
        const zip = new JSZip();
        const padLength = String(frames.length).length;
        
        for (let i = 0; i < frames.length; i++) {
            const frameNum = String(i + 1).padStart(padLength, '0');
            const base64Data = frames[i].split(',')[1];
            zip.file(`frame_${frameNum}.png`, base64Data, { base64: true });
        }
        
        const blob = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `live2d_frames_${Date.now()}.zip`;
        link.click();
        URL.revokeObjectURL(link.href);
        
        showToast((window.i18n?.t('export_success') || '成功导出') + ` ${frames.length} ${window.i18n?.t('export_frames_unit') || '帧'}`, 'success');
    }
});
