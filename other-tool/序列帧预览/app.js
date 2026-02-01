const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const multiFileInput = document.getElementById('multi-file-input');
const appContent = document.getElementById('app-content');
const spriteView = document.getElementById('sprite-view');
const rowsInput = document.getElementById('rows');
const colsInput = document.getElementById('cols');
const frameWInput = document.getElementById('frame-w');
const frameHInput = document.getElementById('frame-h');
const fpsInput = document.getElementById('fps');
const fpsVal = document.getElementById('fps-val');
const frameSizeLabel = document.getElementById('frame-size');
const resetBtn = document.getElementById('reset-btn');
const uploadText = document.getElementById('upload-text');

const forwardBtn = document.getElementById('forward-btn');
const reverseBtn = document.getElementById('reverse-btn');
const pingpongBtn = document.getElementById('pingpong-btn');
const pingpongReverseBtn = document.getElementById('pingpong-reverse-btn');

const gridSettings = document.getElementById('grid-settings');

const frameSettings = document.getElementById('frame-settings');
const tabBtns = document.querySelectorAll('.tab-btn');

let currentMode = 'spritesheet'; // spritesheet, png-series
let img = new Image();
let frameImages = []; // 用于 png-series 模式
let currentFrame = 0;
let animationId = null;
let lastTimestamp = 0;
let playMode = 'forward'; // forward, reverse, pingpong, pingpong-reverse
let pingpongDirection = 1; // 乒乓模式当前方向: 1正向, -1反向

// 模式切换
tabBtns.forEach(btn => {
    btn.onclick = () => {
        const mode = btn.dataset.mode;
        if (mode === currentMode) return;

        currentMode = mode;
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // 重置上传区域
        resetToUpload();
        
        if (currentMode === 'spritesheet') {
            uploadText.textContent = '点击或拖拽 Sprite Sheet 到这里';
            gridSettings.style.display = 'block';
            frameSettings.style.display = 'block';
        } else {
            uploadText.textContent = '点击或拖拽一组 PNG 图片到这里';
            gridSettings.style.display = 'none';
            frameSettings.style.display = 'none';
        }
    };
});

function resetToUpload() {
    if (animationId) cancelAnimationFrame(animationId);
    dropZone.style.display = 'block';
    appContent.style.display = 'none';
    img = new Image();
    frameImages = [];
    currentFrame = 0;
    fileInput.value = '';
    multiFileInput.value = '';
}

// 上传处理
dropZone.onclick = () => {
    if (currentMode === 'spritesheet') {
        fileInput.click();
    } else {
        multiFileInput.click();
    }
};

fileInput.onchange = (e) => handleFile(e.target.files[0]);
multiFileInput.onchange = (e) => handleMultiFiles(e.target.files);

dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.borderColor = '#ff6b6b'; };
dropZone.ondragleave = () => { dropZone.style.borderColor = 'rgba(255, 255, 255, 0.1)'; };
dropZone.ondrop = (e) => {
    e.preventDefault();
    if (currentMode === 'spritesheet') {
        handleFile(e.dataTransfer.files[0]);
    } else {
        handleMultiFiles(e.dataTransfer.files);
    }
};

function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        img.src = e.target.result;
        img.onload = initPreview;
    };
    reader.readAsDataURL(file);
}

async function handleMultiFiles(files) {
    const fileList = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (fileList.length === 0) return;

    // 自然排序
    fileList.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    frameImages = [];
    for (const file of fileList) {
        const url = URL.createObjectURL(file);
        const frameImg = new Image();
        frameImg.src = url;
        await new Promise(resolve => frameImg.onload = resolve);
        frameImages.push({ img: frameImg, url: url });
    }

    initMultiPreview();
}

function initPreview() {
    dropZone.style.display = 'none';
    appContent.style.display = 'grid';
    spriteView.style.backgroundImage = `url(${img.src})`;
    
    // 初始化时根据默认行列计算尺寸并填入输入框
    const initialCols = parseInt(colsInput.value) || 1;
    const initialRows = parseInt(rowsInput.value) || 1;
    frameWInput.value = Math.round(img.width / initialCols);
    frameHInput.value = Math.round(img.height / initialRows);
    
    updatePreviewLayout();
    startAnimation();
}

function initMultiPreview() {
    dropZone.style.display = 'none';
    appContent.style.display = 'grid';
    
    const firstFrame = frameImages[0].img;
    spriteView.style.width = `${firstFrame.width}px`;
    spriteView.style.height = `${firstFrame.height}px`;
    spriteView.style.backgroundImage = `url(${frameImages[0].url})`;
    spriteView.style.backgroundSize = 'contain';
    spriteView.style.backgroundPosition = 'center';
    frameSizeLabel.textContent = `${firstFrame.width} x ${firstFrame.height}`;
    
    startAnimation();
}

function updatePreviewLayout() {
    if (currentMode !== 'spritesheet') return;

    const frameW = parseInt(frameWInput.value) || 1;
    const frameH = parseInt(frameHInput.value) || 1;
    
    spriteView.style.width = `${frameW}px`;
    spriteView.style.height = `${frameH}px`;
    spriteView.style.backgroundSize = `${img.width}px ${img.height}px`;
    frameSizeLabel.textContent = `${frameW} x ${frameH}`;
}

function animate(timestamp) {
    const fps = parseInt(fpsInput.value);
    const interval = 1000 / fps;
    
    let totalFrames = 0;
    let rows = 1;
    let cols = 1;
    let frameW = 0;
    let frameH = 0;

    if (currentMode === 'spritesheet') {
        rows = parseInt(rowsInput.value) || 1;
        cols = parseInt(colsInput.value) || 1;
        frameW = parseInt(frameWInput.value) || (img.width / cols);
        frameH = parseInt(frameHInput.value) || (img.height / rows);
        totalFrames = rows * cols;
    } else {
        totalFrames = frameImages.length;
    }

    if (totalFrames === 0) return;

    if (timestamp - lastTimestamp > interval) {
        if (playMode === 'forward') {
            currentFrame = (currentFrame + 1) % totalFrames;
        } else if (playMode === 'reverse') {
            currentFrame = (currentFrame - 1 + totalFrames) % totalFrames;
        } else if (playMode === 'pingpong') {
            currentFrame += pingpongDirection;
            if (currentFrame >= totalFrames - 1) {
                currentFrame = totalFrames - 1;
                pingpongDirection = -1;
            } else if (currentFrame <= 0) {
                currentFrame = 0;
                pingpongDirection = 1;
            }
        } else if (playMode === 'pingpong-reverse') {
            currentFrame += pingpongDirection;
            if (currentFrame <= 0) {
                currentFrame = 0;
                pingpongDirection = 1;
            } else if (currentFrame >= totalFrames - 1) {
                currentFrame = totalFrames - 1;
                pingpongDirection = -1;
            }
        }
        
        if (currentMode === 'spritesheet') {
            const col = currentFrame % cols;
            const row = Math.floor(currentFrame / cols);
            spriteView.style.backgroundPosition = `-${col * frameW}px -${row * frameH}px`;
        } else {
            spriteView.style.backgroundImage = `url(${frameImages[currentFrame].url})`;
        }
        
        lastTimestamp = timestamp;
    }
    animationId = requestAnimationFrame(animate);
}


function startAnimation() {
    if (animationId) cancelAnimationFrame(animationId);
    lastTimestamp = 0;
    animationId = requestAnimationFrame(animate);
}


// 监听行列变化，自动同步尺寸输入框
[rowsInput, colsInput].forEach(input => {
    input.oninput = () => {
        const rows = parseInt(rowsInput.value) || 1;
        const cols = parseInt(colsInput.value) || 1;
        frameWInput.value = Math.round(img.width / cols);
        frameHInput.value = Math.round(img.height / rows);
        currentFrame = 0;
        updatePreviewLayout();
    };
});

// 监听尺寸手动变化
[frameWInput, frameHInput].forEach(input => {
    input.oninput = () => {
        currentFrame = 0;
        updatePreviewLayout();
    };
});

fpsInput.oninput = () => {
    fpsVal.textContent = fpsInput.value;
};

resetBtn.onclick = () => {
    location.reload();
};

// 播放模式控制
function setPlayMode(mode) {
    playMode = mode;
    [forwardBtn, reverseBtn, pingpongBtn, pingpongReverseBtn].forEach(btn => btn.classList.remove('active'));
    
    if (mode === 'forward') {
        forwardBtn.classList.add('active');
    } else if (mode === 'reverse') {
        reverseBtn.classList.add('active');
    } else if (mode === 'pingpong') {
        pingpongBtn.classList.add('active');
        pingpongDirection = 1; // 正序开始
    } else if (mode === 'pingpong-reverse') {
        pingpongReverseBtn.classList.add('active');
        pingpongDirection = -1; // 倒序开始
    }
}

forwardBtn.onclick = () => setPlayMode('forward');
reverseBtn.onclick = () => setPlayMode('reverse');
pingpongBtn.onclick = () => setPlayMode('pingpong');
pingpongReverseBtn.onclick = () => setPlayMode('pingpong-reverse');
