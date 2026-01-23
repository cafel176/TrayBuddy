const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
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

let img = new Image();
let currentFrame = 0;
let animationId = null;
let lastTimestamp = 0;
let playMode = 'forward'; // forward, reverse, pingpong, pingpong-reverse
let pingpongDirection = 1; // 乒乓模式当前方向: 1正向, -1反向

const forwardBtn = document.getElementById('forward-btn');
const reverseBtn = document.getElementById('reverse-btn');
const pingpongBtn = document.getElementById('pingpong-btn');
const pingpongReverseBtn = document.getElementById('pingpong-reverse-btn');

// 上传处理
dropZone.onclick = () => fileInput.click();
fileInput.onchange = (e) => handleFile(e.target.files[0]);

dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.borderColor = '#ff6b6b'; };
dropZone.ondragleave = () => { dropZone.style.borderColor = 'rgba(255, 255, 255, 0.1)'; };
dropZone.ondrop = (e) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files[0]);
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

function updatePreviewLayout() {
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
    const rows = parseInt(rowsInput.value) || 1;
    const cols = parseInt(colsInput.value) || 1;
    const frameW = parseInt(frameWInput.value) || (img.width / cols);
    const frameH = parseInt(frameHInput.value) || (img.height / rows);
    const totalFrames = rows * cols;

    if (timestamp - lastTimestamp > interval) {
        if (playMode === 'forward') {
            currentFrame = (currentFrame + 1) % totalFrames;
        } else if (playMode === 'reverse') {
            currentFrame = (currentFrame - 1 + totalFrames) % totalFrames;
        } else if (playMode === 'pingpong') {
            // 乒乓模式：正序开始
            currentFrame += pingpongDirection;
            if (currentFrame >= totalFrames - 1) {
                currentFrame = totalFrames - 1;
                pingpongDirection = -1;
            } else if (currentFrame <= 0) {
                currentFrame = 0;
                pingpongDirection = 1;
            }
        } else if (playMode === 'pingpong-reverse') {
            // 乒乓倒序模式：倒序开始
            currentFrame += pingpongDirection;
            if (currentFrame <= 0) {
                currentFrame = 0;
                pingpongDirection = 1;
            } else if (currentFrame >= totalFrames - 1) {
                currentFrame = totalFrames - 1;
                pingpongDirection = -1;
            }
        }
        
        const col = currentFrame % cols;
        const row = Math.floor(currentFrame / cols);
        
        spriteView.style.backgroundPosition = `-${col * frameW}px -${row * frameH}px`;
        lastTimestamp = timestamp;
    }
    animationId = requestAnimationFrame(animate);
}

function startAnimation() {
    if (animationId) cancelAnimationFrame(animationId);
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
