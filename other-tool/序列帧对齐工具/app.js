// 元素引用
const file1Input = document.getElementById('file1');
const file2Input = document.getElementById('file2');
const dropZone1 = document.getElementById('dropZone1');
const dropZone2 = document.getElementById('dropZone2');
const fileName1 = document.getElementById('fileName1');
const fileName2 = document.getElementById('fileName2');
const opacity1Slider = document.getElementById('opacity1');
const opacity2Slider = document.getElementById('opacity2');
const scale2Slider = document.getElementById('scale2');
const opacity1Value = document.getElementById('opacity1Value');
const opacity2Value = document.getElementById('opacity2Value');
const scale2Value = document.getElementById('scale2Value');
const image1 = document.getElementById('image1');
const image2 = document.getElementById('image2');
const previewArea = document.getElementById('previewArea');
const previewViewport = document.getElementById('previewViewport');
const placeholder = document.getElementById('placeholder');
const offsetXInput = document.getElementById('offsetXInput');
const offsetYInput = document.getElementById('offsetYInput');
const scaleInput = document.getElementById('scaleInput');
const viewZoomInfo = document.getElementById('viewZoomInfo');
const resetBtn = document.getElementById('resetBtn');
const resetViewBtn = document.getElementById('resetViewBtn');
const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');
const zoomFitBtn = document.getElementById('zoomFit');

// 状态
let offsetX = 0;
let offsetY = 0;
let scale = 1;
let isDragging = false;
let startX, startY;
let image2Loaded = false;

// 预览区域整体缩放和平移状态
let viewZoom = 1;
let viewPanX = 0;
let viewPanY = 0;
let isPanning = false;
let panStartX, panStartY;

// 通用的加载图片函数
function loadImage1(file) {
    if (file && file.type.startsWith('image/')) {
        fileName1.textContent = file.name;
        const reader = new FileReader();
        reader.onload = (e) => {
            image1.src = e.target.result;
            image1.style.display = 'block';
            updatePlaceholder();
        };
        reader.readAsDataURL(file);
    }
}

function loadImage2(file) {
    if (file && file.type.startsWith('image/')) {
        fileName2.textContent = file.name;
        const reader = new FileReader();
        reader.onload = (e) => {
            image2.src = e.target.result;
            image2.style.display = 'block';
            image2Loaded = true;
            resetPosition();
            updatePlaceholder();
        };
        reader.readAsDataURL(file);
    }
}

// 拖拽区域设置
function setupDropZone(dropZone, fileInput, loadFn) {
    // 点击触发文件选择
    dropZone.addEventListener('click', () => fileInput.click());

    // 拖拽事件
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        loadFn(file);
    });

    // 文件选择事件
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        loadFn(file);
    });
}

setupDropZone(dropZone1, file1Input, loadImage1);
setupDropZone(dropZone2, file2Input, loadImage2);

// 阻止页面默认拖拽行为
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

// 透明度控制
opacity1Slider.addEventListener('input', (e) => {
    const value = e.target.value;
    opacity1Value.textContent = value + '%';
    image1.style.opacity = value / 100;
});

opacity2Slider.addEventListener('input', (e) => {
    const value = e.target.value;
    opacity2Value.textContent = value + '%';
    image2.style.opacity = value / 100;
});

// 缩放控制
scale2Slider.addEventListener('input', (e) => {
    scale = e.target.value / 100;
    scale2Value.textContent = e.target.value + '%';
    updateImage2Transform();
    updateInfo();
});

// 输入框控制
offsetXInput.addEventListener('change', (e) => {
    offsetX = parseInt(e.target.value) || 0;
    updateImage2Transform();
});

// 输入框控制
offsetYInput.addEventListener('change', (e) => {
    offsetY = parseInt(e.target.value) || 0;
    updateImage2Transform();
});

scaleInput.addEventListener('change', (e) => {
    let val = parseInt(e.target.value) || 100;
    val = Math.max(10, Math.min(300, val));
    scale = val / 100;
    scaleInput.value = val;
    scale2Slider.value = val;
    scale2Value.textContent = val + '%';
    updateImage2Transform();
});

// 拖拽功能
image2.addEventListener('mousedown', (e) => {
    if (!image2Loaded || e.button !== 0) return;
    isDragging = true;
    startX = e.clientX - offsetX;
    startY = e.clientY - offsetY;
    image2.style.cursor = 'grabbing';
    e.preventDefault();
});

document.addEventListener('mouseup', (e) => {
    if (e.button === 1) {
        isPanning = false;
        previewArea.style.cursor = 'crosshair';
    }
    isDragging = false;
    image2.style.cursor = 'move';
});

// 键盘方向键微调
document.addEventListener('keydown', (e) => {
    if (!image2Loaded) return;
    
    // Shift加速：10像素，普通：1像素
    const step = e.shiftKey ? 10 : 1;
    
    switch (e.key) {
        case 'ArrowUp':
            e.preventDefault();
            offsetY -= step;
            break;
        case 'ArrowDown':
            e.preventDefault();
            offsetY += step;
            break;
        case 'ArrowLeft':
            e.preventDefault();
            offsetX -= step;
            break;
        case 'ArrowRight':
            e.preventDefault();
            offsetX += step;
            break;
        default:
            return;
    }
    
    updateImage2Transform();
    updateInfo();
});

// 滚轮缩放
previewArea.addEventListener('wheel', (e) => {
    e.preventDefault();
    
    // Ctrl+滚轮：缩放整体预览
    if (e.ctrlKey) {
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        viewZoom = Math.max(0.25, Math.min(5, viewZoom + delta));
        updateViewportTransform();
        return;
    }
    
    // 普通滚轮：缩放图片2
    if (!image2Loaded) return;
    
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    scale = Math.max(0.1, Math.min(3, scale + delta));
    
    const sliderValue = Math.round(scale * 100);
    scale2Slider.value = sliderValue;
    scale2Value.textContent = sliderValue + '%';
    
    updateImage2Transform();
    updateInfo();
});

// 中键拖拽平移预览区域
previewArea.addEventListener('mousedown', (e) => {
    if (e.button === 1) { // 中键
        e.preventDefault();
        isPanning = true;
        panStartX = e.clientX - viewPanX;
        panStartY = e.clientY - viewPanY;
        previewArea.style.cursor = 'grabbing';
    }
});

document.addEventListener('mousemove', (e) => {
    if (isPanning) {
        viewPanX = e.clientX - panStartX;
        viewPanY = e.clientY - panStartY;
        updateViewportTransform();
    }
    if (!isDragging) return;
    offsetX = e.clientX - startX;
    offsetY = e.clientY - startY;
    updateImage2Transform();
    updateInfo();
});

document.addEventListener('mouseup', (e) => {
    if (e.button === 1) {
        isPanning = false;
        previewArea.style.cursor = 'crosshair';
    }
    isDragging = false;
    image2.style.cursor = 'move';
});

// 更新视口变换
function updateViewportTransform() {
    previewViewport.style.transform = `translate(${viewPanX}px, ${viewPanY}px) scale(${viewZoom})`;
    viewZoomInfo.textContent = Math.round(viewZoom * 100) + '%';
}

// 缩放按钮
zoomInBtn.addEventListener('click', () => {
    viewZoom = Math.min(5, viewZoom + 0.25);
    updateViewportTransform();
});

zoomOutBtn.addEventListener('click', () => {
    viewZoom = Math.max(0.25, viewZoom - 0.25);
    updateViewportTransform();
});

zoomFitBtn.addEventListener('click', () => {
    viewZoom = 1;
    viewPanX = 0;
    viewPanY = 0;
    updateViewportTransform();
});

resetViewBtn.addEventListener('click', () => {
    viewZoom = 1;
    viewPanX = 0;
    viewPanY = 0;
    updateViewportTransform();
});

// 更新图片2变换
function updateImage2Transform() {
    image2.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px)) scale(${scale})`;
}

// 更新信息显示
function updateInfo() {
    offsetXInput.value = Math.round(offsetX);
    offsetYInput.value = Math.round(offsetY);
    scaleInput.value = Math.round(scale * 100);
}

// 重置位置
function resetPosition() {
    offsetX = 0;
    offsetY = 0;
    scale = 1;
    scale2Slider.value = 100;
    scale2Value.textContent = '100%';
    updateImage2Transform();
    updateInfo();
}

resetBtn.addEventListener('click', resetPosition);

// 更新占位符显示
function updatePlaceholder() {
    if (image1.style.display === 'block' || image2.style.display === 'block') {
        placeholder.style.display = 'none';
    } else {
        placeholder.style.display = 'block';
    }
}

        // 初始化透明度
        image2.style.opacity = 0.5;

        // 初始化 i18n
        if (window.i18n) {
            window.i18n.init();
        }

        window.addEventListener('languageChanged', () => {
            // 更新一些可能需要手动更新的动态部分
        });


window.addEventListener('languageChanged', () => {
    // If there are any dynamic labels that need manual update, do it here.
    // In this case, most are handled by data-i18n.
});
