const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const clearBtn = document.getElementById('clearBtn');
const splitBtn = document.getElementById('splitBtn');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const previewContainer = document.getElementById('previewContainer');
const columnsInput = document.getElementById('columns');
const rowsInput = document.getElementById('rows');
const filePrefixInput = document.getElementById('filePrefix');
const reverseOrderCheckbox = document.getElementById('reverseOrder');
const stats = document.getElementById('stats');
const imageInfo = document.getElementById('imageInfo');
const imageSize = document.getElementById('imageSize');
const calcInfo = document.getElementById('calcInfo');
const calcValue = document.getElementById('calcValue');
const resultGrid = document.getElementById('resultGrid');

let sourceImage = null;
let splitFrames = [];

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
    const files = Array.from(e.dataTransfer.files).filter(f => 
        f.type === 'image/png' || f.type === 'image/jpeg' || f.type === 'image/webp'
    );
    if (files.length > 0) {
        loadImage(files[0]);
    }
});

dropZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
        loadImage(files[0]);
    }
    fileInput.value = '';
});

// 加载图片
function loadImage(file) {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
        if (sourceImage) {
            URL.revokeObjectURL(sourceImage.url);
        }
        sourceImage = {
            img: img,
            url: url,
            width: img.width,
            height: img.height,
            name: file.name
        };
        
        updateImageInfo();
        updatePreview();
        updateUI();
    };
    img.src = url;
}

// 更新图片信息
function updateImageInfo() {
    if (sourceImage) {
        imageInfo.classList.add('show');
        imageSize.textContent = `${sourceImage.width} × ${sourceImage.height} px`;
        updateCalcInfo();
    } else {
        imageInfo.classList.remove('show');
        imageSize.textContent = '-';
    }
}

// 更新计算信息
function updateCalcInfo() {
    if (!sourceImage) {
        calcInfo.classList.remove('show');
        return;
    }
    
    const cols = parseInt(columnsInput.value) || 1;
    const rows = parseInt(rowsInput.value) || 1;
    const frameWidth = Math.floor(sourceImage.width / cols);
    const frameHeight = Math.floor(sourceImage.height / rows);
    const totalFrames = cols * rows;
    
    calcInfo.classList.add('show');
    
    if (window.i18n) {
        calcValue.textContent = window.i18n.t('calc_value_template')
            .replace('{w}', frameWidth)
            .replace('{h}', frameHeight)
            .replace('{total}', totalFrames);
    } else {
        calcValue.textContent = `每帧 ${frameWidth} × ${frameHeight} px，共 ${totalFrames} 帧`;
    }
}

// 更新预览
function updatePreview() {
    if (!sourceImage) return;
    
    const cols = parseInt(columnsInput.value) || 1;
    const rows = parseInt(rowsInput.value) || 1;
    
    previewContainer.innerHTML = '';
    previewContainer.classList.add('with-grid');
    
    const wrapper = document.createElement('div');
    wrapper.className = 'preview-wrapper';
    
    const previewImg = document.createElement('img');
    previewImg.src = sourceImage.url;
    previewImg.id = 'previewImg';
    wrapper.appendChild(previewImg);
    
    // 等图片加载完成后绘制网格
    previewImg.onload = () => {
        const displayWidth = previewImg.offsetWidth;
        const displayHeight = previewImg.offsetHeight;
        
        // 创建网格覆盖层
        const gridCanvas = document.createElement('canvas');
        gridCanvas.className = 'grid-overlay';
        gridCanvas.width = displayWidth;
        gridCanvas.height = displayHeight;
        gridCanvas.style.width = displayWidth + 'px';
        gridCanvas.style.height = displayHeight + 'px';
        
        const ctx = gridCanvas.getContext('2d');
        ctx.strokeStyle = 'rgba(255, 107, 107, 0.8)';
        ctx.lineWidth = 1;
        
        const cellWidth = displayWidth / cols;
        const cellHeight = displayHeight / rows;
        
        // 绘制垂直线
        for (let i = 1; i < cols; i++) {
            ctx.beginPath();
            ctx.moveTo(i * cellWidth, 0);
            ctx.lineTo(i * cellWidth, displayHeight);
            ctx.stroke();
        }
        
        // 绘制水平线
        for (let i = 1; i < rows; i++) {
            ctx.beginPath();
            ctx.moveTo(0, i * cellHeight);
            ctx.lineTo(displayWidth, i * cellHeight);
            ctx.stroke();
        }
        
        wrapper.appendChild(gridCanvas);
    };
    
    previewContainer.appendChild(wrapper);
}

// 清除图片
clearBtn.addEventListener('click', () => {
    if (sourceImage) {
        URL.revokeObjectURL(sourceImage.url);
        sourceImage = null;
    }
    splitFrames = [];
    imageInfo.classList.remove('show');
    calcInfo.classList.remove('show');
    previewContainer.innerHTML = `
        <div class="preview-placeholder">
            <div class="icon">🖼️</div>
            <p data-i18n="preview_placeholder">导入Sprite Sheet后预览</p>
        </div>
    `;
    if (window.i18n) window.i18n.updateDOM();
    previewContainer.classList.remove('with-grid');
    stats.style.display = 'none';
    resultGrid.style.display = 'none';
    downloadAllBtn.style.display = 'none';
    updateUI();
});

// 更新UI状态
function updateUI() {
    splitBtn.disabled = !sourceImage;
    clearBtn.style.display = sourceImage ? 'block' : 'none';
}

// 切分图片
splitBtn.addEventListener('click', splitImage);

function splitImage() {
    if (!sourceImage) return;
    
    const cols = parseInt(columnsInput.value) || 1;
    const rows = parseInt(rowsInput.value) || 1;
    const frameWidth = Math.floor(sourceImage.width / cols);
    const frameHeight = Math.floor(sourceImage.height / rows);
    
    splitFrames = [];
    
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const canvas = document.createElement('canvas');
            canvas.width = frameWidth;
            canvas.height = frameHeight;
            const ctx = canvas.getContext('2d');
            
            ctx.drawImage(
                sourceImage.img,
                col * frameWidth,
                row * frameHeight,
                frameWidth,
                frameHeight,
                0,
                0,
                frameWidth,
                frameHeight
            );
            
            splitFrames.push({
                canvas: canvas,
                index: row * cols + col
            });
        }
    }
    
    // 更新统计
    stats.style.display = 'grid';
    document.getElementById('statFrames').textContent = splitFrames.length;
    document.getElementById('statFrameSize').textContent = `${frameWidth}x${frameHeight}`;
    document.getElementById('statLayout').textContent = `${cols}x${rows}`;
    
    // 显示结果
    displayResults();
    downloadAllBtn.style.display = 'block';
}

// 显示切分结果
function displayResults() {
    resultGrid.style.display = 'grid';
    resultGrid.innerHTML = '';
    
    const isReversed = reverseOrderCheckbox.checked;
    const totalFrames = splitFrames.length;
    
    splitFrames.forEach((frame, index) => {
        const item = document.createElement('div');
        item.className = 'result-item';
        
        const img = document.createElement('img');
        img.src = frame.canvas.toDataURL('image/png');
        item.appendChild(img);
        
        // 计算显示和导出的编号
        const displayIndex = isReversed ? (totalFrames - 1 - index) : index;
        
        const number = document.createElement('span');
        number.className = 'frame-number';
        number.textContent = displayIndex;
        item.appendChild(number);
        
        // 点击单独下载
        item.style.cursor = 'pointer';
        item.title = window.i18n ? window.i18n.t('download_frame_tip') : '点击下载此帧';
        item.addEventListener('click', () => {
            downloadSingleFrame(frame, displayIndex);
        });
        
        resultGrid.appendChild(item);
    });
}

// 下载单个帧
function downloadSingleFrame(frame, index) {
    const prefix = filePrefixInput.value || 'frame_';
    const paddedIndex = String(index).padStart(4, '0');
    const filename = `${prefix}${paddedIndex}.png`;
    
    const link = document.createElement('a');
    link.download = filename;
    link.href = frame.canvas.toDataURL('image/png');
    link.click();
}

// 打包下载所有帧
downloadAllBtn.addEventListener('click', async () => {
    if (splitFrames.length === 0) return;
    
    downloadAllBtn.disabled = true;
    downloadAllBtn.textContent = window.i18n ? window.i18n.t('zipping_text') : '⏳ 打包中...';
    
    try {
        const zip = new JSZip();
        const prefix = filePrefixInput.value || 'frame_';
        const isReversed = reverseOrderCheckbox.checked;
        const totalFrames = splitFrames.length;
        
        for (let i = 0; i < splitFrames.length; i++) {
            const frame = splitFrames[i];
            // 计算导出的编号
            const exportIndex = isReversed ? (totalFrames - 1 - i) : i;
            const paddedIndex = String(exportIndex).padStart(4, '0');
            const filename = `${prefix}${paddedIndex}.png`;
            
            // 将canvas转换为blob
            const blob = await new Promise(resolve => {
                frame.canvas.toBlob(resolve, 'image/png');
            });
            
            zip.file(filename, blob);
        }
        
        // 生成zip文件
        const content = await zip.generateAsync({ type: 'blob' });
        
        // 下载
        const link = document.createElement('a');
        link.download = 'sprite_frames.zip';
        link.href = URL.createObjectURL(content);
        link.click();
        URL.revokeObjectURL(link.href);
    } catch (error) {
        console.error('打包失败:', error);
        alert(window.i18n ? window.i18n.t('zip_failed_text') : '打包失败，请重试');
    } finally {
        downloadAllBtn.disabled = false;
        downloadAllBtn.textContent = window.i18n ? window.i18n.t('download_all_btn') : '📦 打包下载 (ZIP)';
    }
});

// 输入变化时更新预览
[columnsInput, rowsInput].forEach(input => {
    input.addEventListener('input', () => {
        updateCalcInfo();
        if (sourceImage) {
            updatePreview();
        }
    });
});

// 反向排序选项变化时刷新结果显示
reverseOrderCheckbox.addEventListener('change', () => {
    if (splitFrames.length > 0) {
        displayResults();
    }
});

// 初始化 i18n
document.addEventListener('DOMContentLoaded', () => {
    if (window.i18n) {
        window.i18n.init();
    }
});

window.addEventListener('languageChanged', () => {
    updateCalcInfo();
    if (splitFrames.length > 0) {
        displayResults();
    }
});
