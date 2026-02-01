const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const frameList = document.getElementById('frameList');
const clearBtn = document.getElementById('clearBtn');
const generateBtn = document.getElementById('generateBtn');
const downloadBtn = document.getElementById('downloadBtn');
const previewContainer = document.getElementById('previewContainer');
const columnsInput = document.getElementById('columns');
const rowsInput = document.getElementById('rows');
const customSizeCheckbox = document.getElementById('customSize');
const sizeInputs = document.getElementById('sizeInputs');
const frameWidthInput = document.getElementById('frameWidth');
const frameHeightInput = document.getElementById('frameHeight');
const reverseOrderCheckbox = document.getElementById('reverseOrder');
const stats = document.getElementById('stats');
const sizeInfo = document.getElementById('sizeInfo');
const baseSize = document.getElementById('baseSize');
const sizeWarning = document.getElementById('sizeWarning');
const compressWebpCheckbox = document.getElementById('compressWebp');
const webpQualityGroup = document.getElementById('webpQualityGroup');
const webpQualityInput = document.getElementById('webpQuality');
const qualityValueText = document.getElementById('qualityValue');

let frames = [];

let generatedCanvas = null;
let baseDimensions = null; // 基准尺寸

// 自然排序
function naturalSort(a, b) {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

// 排序帧列表
function sortFrames() {
    frames.sort((a, b) => {
        const result = naturalSort(a, b);
        return reverseOrderCheckbox.checked ? -result : result;
    });
}

// 拖拽事件
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'image/png');
    addFiles(files);
});

dropZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    addFiles(files);
    fileInput.value = '';
});

// 添加文件
async function addFiles(files) {
    for (const file of files) {
        const img = new Image();
        const url = URL.createObjectURL(file);
        
        await new Promise((resolve) => {
            img.onload = () => {
                frames.push({
                    name: file.name,
                    img: img,
                    url: url,
                    width: img.width,
                    height: img.height
                });
                resolve();
            };
            img.src = url;
        });
    }
    
    frames.sort((a, b) => {
        const result = naturalSort(a, b);
        return reverseOrderCheckbox.checked ? -result : result;
    });
    
    // 设置基准尺寸（以排序后的第一张图为准）
    updateBaseDimensions();
    updateFrameList();
    updateUI();
}

// 更新基准尺寸
function updateBaseDimensions() {
    if (frames.length > 0) {
        baseDimensions = {
            width: frames[0].width,
            height: frames[0].height
        };
        sizeInfo.classList.add('show');
        baseSize.textContent = `${baseDimensions.width} × ${baseDimensions.height} px`;
    } else {
        baseDimensions = null;
        sizeInfo.classList.remove('show');
        baseSize.textContent = '-';
    }
    checkSizeConsistency();
}

// 检查尺寸一致性
function checkSizeConsistency() {
    if (!baseDimensions || frames.length <= 1) {
        sizeWarning.classList.remove('show');
        return;
    }
    
    const hasInvalidFrames = frames.some(frame => 
        frame.width !== baseDimensions.width || frame.height !== baseDimensions.height
    );
    
    if (hasInvalidFrames) {
        sizeWarning.classList.add('show');
    } else {
        sizeWarning.classList.remove('show');
    }
}

// 判断帧是否有效（尺寸一致）
function isFrameValid(frame) {
    if (!baseDimensions) return true;
    return frame.width === baseDimensions.width && frame.height === baseDimensions.height;
}

// 获取有效帧列表
function getValidFrames() {
    return frames.filter(frame => isFrameValid(frame));
}

// 更新帧列表
function updateFrameList() {
    frameList.innerHTML = frames.map((frame, index) => {
        const valid = isFrameValid(frame);
        const invalidClass = valid ? '' : ' invalid';
        const sizeText = `${frame.width}×${frame.height}`;
        return `
            <div class="frame-item${invalidClass}">
                <img src="${frame.url}" alt="${frame.name}">
                <span>${frame.name}</span>
                <span class="size-badge">${sizeText}</span>
                <button class="remove-btn" onclick="removeFrame(${index})">×</button>
            </div>
        `;
    }).join('');
}

// 移除帧
window.removeFrame = function(index) {
    URL.revokeObjectURL(frames[index].url);
    frames.splice(index, 1);
    // 如果删除的是第一张图，需要重新设置基准尺寸
    updateBaseDimensions();
    updateFrameList();
    updateUI();
};

// 清空所有帧
clearBtn.addEventListener('click', () => {
    frames.forEach(f => URL.revokeObjectURL(f.url));
    frames = [];
    baseDimensions = null;
    sizeInfo.classList.remove('show');
    sizeWarning.classList.remove('show');
    baseSize.textContent = '-';
    updateFrameList();
    updateUI();
    previewContainer.innerHTML = `
        <div class="preview-placeholder">
            <div class="icon">🖼️</div>
            <p data-i18n="preview_placeholder">导入图片后生成预览</p>
        </div>
    `;
    if (window.i18n) window.i18n.updateDOM();
    stats.style.display = 'none';
    downloadBtn.style.display = 'none';
});

// 更新UI状态
function updateUI() {
    const validFrames = getValidFrames();
    const hasValidFrames = validFrames.length > 0;
    generateBtn.disabled = !hasValidFrames;
    clearBtn.style.display = frames.length > 0 ? 'block' : 'none';
}

// 自定义尺寸复选框
customSizeCheckbox.addEventListener('change', () => {
    sizeInputs.style.display = customSizeCheckbox.checked ? 'grid' : 'none';
});

// WebP 压缩选项
compressWebpCheckbox.addEventListener('change', () => {
    webpQualityGroup.style.display = compressWebpCheckbox.checked ? 'block' : 'none';
    updateDownloadBtnText();
});

function updateDownloadBtnText() {
    if (window.i18n) {
        downloadBtn.setAttribute('data-i18n', compressWebpCheckbox.checked ? 'download_webp_btn' : 'download_png_btn');
        window.i18n.updateDOM();
    } else {
        downloadBtn.textContent = compressWebpCheckbox.checked ? '💾 下载 WebP' : '💾 下载 PNG';
    }
}

webpQualityInput.addEventListener('input', () => {
    const qualityValueLabel = document.querySelector('[data-i18n="webp_quality_label"]');
    if (qualityValueLabel) {
        qualityValueLabel.setAttribute('data-i18n-n', webpQualityInput.value);
        if (window.i18n) window.i18n.updateDOM();
    } else {
        qualityValueText.textContent = webpQualityInput.value;
    }
});

// 生成Sprite Sheet
generateBtn.addEventListener('click', generateSpriteSheet);

function generateSpriteSheet() {
    const validFrames = getValidFrames();
    if (validFrames.length === 0) return;

    const columns = parseInt(columnsInput.value) || 4;
    let rows = parseInt(rowsInput.value) || 0;
    
    // 计算行数
    if (rows === 0) {
        rows = Math.ceil(validFrames.length / columns);
    }

    // 计算帧尺寸
    let frameWidth, frameHeight;
    if (customSizeCheckbox.checked) {
        frameWidth = parseInt(frameWidthInput.value) || 64;
        frameHeight = parseInt(frameHeightInput.value) || 64;
    } else {
        frameWidth = Math.max(...validFrames.map(f => f.width));
        frameHeight = Math.max(...validFrames.map(f => f.height));
    }

    // 创建Canvas
    const canvas = document.createElement('canvas');
    canvas.width = columns * frameWidth;
    canvas.height = rows * frameHeight;
    const ctx = canvas.getContext('2d');

    // 清空画布（透明背景）
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 绘制每一帧（只绘制有效帧）
    validFrames.forEach((frame, index) => {
        if (index >= columns * rows) return;
        
        const col = index % columns;
        const row = Math.floor(index / columns);
        
        const x = col * frameWidth;
        const y = row * frameHeight;
        
        // 居中绘制
        const offsetX = (frameWidth - frame.width) / 2;
        const offsetY = (frameHeight - frame.height) / 2;
        
        ctx.drawImage(frame.img, x + offsetX, y + offsetY);
    });

    generatedCanvas = canvas;

    // 显示预览
    previewContainer.innerHTML = '';
    const previewImg = document.createElement('img');
    previewImg.src = canvas.toDataURL('image/png');
    previewContainer.appendChild(previewImg);

    // 更新统计
    stats.style.display = 'grid';
    document.getElementById('statFrames').textContent = validFrames.length;
    document.getElementById('statSize').textContent = `${canvas.width}x${canvas.height}`;
    document.getElementById('statLayout').textContent = `${columns}x${rows}`;

    updateDownloadBtnText();
    downloadBtn.style.display = 'block';
}


// 下载
downloadBtn.addEventListener('click', async () => {
    if (!generatedCanvas) return;
    
    if (compressWebpCheckbox.checked) {
        const quality = parseInt(webpQualityInput.value) / 100;
        generatedCanvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = 'spritesheet.webp';
            link.href = url;
            link.click();
            URL.revokeObjectURL(url);
        }, 'image/webp', quality);
    } else {
        const link = document.createElement('a');
        link.download = 'spritesheet.png';
        link.href = generatedCanvas.toDataURL('image/png');
        link.click();
    }
});


// 输入变化时自动重新生成
[columnsInput, rowsInput, frameWidthInput, frameHeightInput].forEach(input => {
    input.addEventListener('change', () => {
        if (frames.length > 0 && generatedCanvas) {
            generateSpriteSheet();
        }
    });
});

customSizeCheckbox.addEventListener('change', () => {
    if (frames.length > 0 && generatedCanvas) {
        generateSpriteSheet();
    }
});

// 倒序开关变化时重新排序并生成
reverseOrderCheckbox.addEventListener('change', () => {
    if (frames.length > 0) {
        sortFrames();
        // 重新排序后需要更新基准尺寸（第一张图可能变了）
        updateBaseDimensions();
        updateFrameList();
        if (generatedCanvas) {
            generateSpriteSheet();
        }
    }
});

// 初始化 i18n
document.addEventListener('DOMContentLoaded', () => {
    if (window.i18n) {
        window.i18n.init();
    }
});

window.addEventListener('languageChanged', () => {
    // 处理动态内容更新
});
