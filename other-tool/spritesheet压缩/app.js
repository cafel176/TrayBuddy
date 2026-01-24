/**
 * Spritesheet Compressor - Web GUI Tool
 * Compresses sprite sheets to reduce file size and GPU memory usage
 */

class SpritesheetCompressor {
  constructor() {
    this.files = new Map(); // Map<id, FileData>
    this.fileIdCounter = 0;
    
    this.initElements();
    this.initEventListeners();
  }
  
  initElements() {
    // Upload
    this.dropZone = document.getElementById('dropZone');
    this.fileInput = document.getElementById('fileInput');
    
    // Options
    this.outputFormat = document.getElementById('outputFormat');
    this.quality = document.getElementById('quality');
    this.qualityValue = document.getElementById('qualityValue');
    this.scale = document.getElementById('scale');
    this.scaleValue = document.getElementById('scaleValue');
    this.preserveAlpha = document.getElementById('preserveAlpha');
    
    // Files section
    this.filesSection = document.getElementById('filesSection');
    this.filesList = document.getElementById('filesList');
    this.compressAllBtn = document.getElementById('compressAll');
    this.downloadAllBtn = document.getElementById('downloadAll');
    this.clearAllBtn = document.getElementById('clearAll');
    
    // Preview
    this.previewSection = document.getElementById('previewSection');
    this.originalPreview = document.getElementById('originalPreview');
    this.compressedPreview = document.getElementById('compressedPreview');
    this.originalInfo = document.getElementById('originalInfo');
    this.compressedInfo = document.getElementById('compressedInfo');
    
    // Stats
    this.statsSection = document.getElementById('statsSection');
    this.totalOriginal = document.getElementById('totalOriginal');
    this.totalCompressed = document.getElementById('totalCompressed');
    this.totalSaved = document.getElementById('totalSaved');
    this.gpuSaved = document.getElementById('gpuSaved');
  }
  
  initEventListeners() {
    // Drop zone events
    this.dropZone.addEventListener('click', () => this.fileInput.click());
    this.dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
    this.dropZone.addEventListener('dragleave', () => this.dropZone.classList.remove('drag-over'));
    this.dropZone.addEventListener('drop', (e) => this.handleDrop(e));
    this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
    
    // Options events
    this.quality.addEventListener('input', () => {
      this.qualityValue.textContent = this.quality.value;
    });
    this.scale.addEventListener('input', () => {
      this.scaleValue.textContent = this.scale.value;
    });
    
    // Format change - update quality visibility for PNG
    this.outputFormat.addEventListener('change', () => {
      const isPng = this.outputFormat.value === 'png';
      this.quality.disabled = isPng;
      this.qualityValue.textContent = isPng ? 'N/A' : this.quality.value;
    });
    
    // Action buttons
    this.compressAllBtn.addEventListener('click', () => this.compressAll());
    this.downloadAllBtn.addEventListener('click', () => this.downloadAll());
    this.clearAllBtn.addEventListener('click', () => this.clearAll());
  }
  
  handleDragOver(e) {
    e.preventDefault();
    this.dropZone.classList.add('drag-over');
  }
  
  handleDrop(e) {
    e.preventDefault();
    this.dropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    this.addFiles(files);
  }
  
  handleFileSelect(e) {
    const files = Array.from(e.target.files);
    this.addFiles(files);
    e.target.value = ''; // Reset for re-selecting same file
  }
  
  async addFiles(files) {
    for (const file of files) {
      const id = ++this.fileIdCounter;
      const fileData = {
        id,
        file,
        name: file.name,
        originalSize: file.size,
        originalBlob: null,
        compressedBlob: null,
        compressedSize: 0,
        width: 0,
        height: 0,
        newWidth: 0,
        newHeight: 0,
        status: 'pending', // pending, processing, done, error
        error: null
      };
      
      // Load image to get dimensions
      try {
        const img = await this.loadImage(file);
        fileData.width = img.width;
        fileData.height = img.height;
        fileData.originalBlob = await this.fileToBlob(file);
      } catch (err) {
        fileData.status = 'error';
        fileData.error = err.message;
      }
      
      this.files.set(id, fileData);
    }
    
    this.renderFileList();
    this.filesSection.style.display = 'block';
  }
  
  loadImage(source) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image'));
      
      if (source instanceof Blob || source instanceof File) {
        img.src = URL.createObjectURL(source);
      } else {
        img.src = source;
      }
    });
  }
  
  fileToBlob(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const blob = new Blob([reader.result], { type: file.type });
        resolve(blob);
      };
      reader.readAsArrayBuffer(file);
    });
  }
  
  renderFileList() {
    this.filesList.innerHTML = '';
    
    for (const [id, fileData] of this.files) {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.dataset.id = id;
      
      const thumb = document.createElement('img');
      thumb.className = 'file-thumb';
      thumb.src = URL.createObjectURL(fileData.file);
      
      const info = document.createElement('div');
      info.className = 'file-info';
      
      const name = document.createElement('div');
      name.className = 'file-name';
      name.textContent = fileData.name;
      
      const size = document.createElement('div');
      size.className = 'file-size';
      size.innerHTML = this.formatSize(fileData.originalSize);
      if (fileData.compressedSize > 0) {
        const ratio = ((1 - fileData.compressedSize / fileData.originalSize) * 100).toFixed(1);
        size.innerHTML += ` → ${this.formatSize(fileData.compressedSize)}`;
        size.innerHTML += `<span class="compression-ratio">-${ratio}%</span>`;
      }
      
      const dims = document.createElement('div');
      dims.className = 'file-dimensions';
      dims.textContent = `${fileData.width} × ${fileData.height}`;
      if (fileData.newWidth > 0 && (fileData.newWidth !== fileData.width || fileData.newHeight !== fileData.height)) {
        dims.textContent += ` → ${fileData.newWidth} × ${fileData.newHeight}`;
      }
      
      info.appendChild(name);
      info.appendChild(size);
      info.appendChild(dims);
      
      const status = document.createElement('span');
      status.className = `file-status ${fileData.status}`;
      status.textContent = this.getStatusText(fileData.status);
      
      const actions = document.createElement('div');
      actions.className = 'file-actions';
      
      const previewBtn = document.createElement('button');
      previewBtn.innerHTML = '👁️';
      previewBtn.title = 'Preview';
      previewBtn.onclick = () => this.showPreview(id);
      
      const downloadBtn = document.createElement('button');
      downloadBtn.innerHTML = '⬇️';
      downloadBtn.title = 'Download';
      downloadBtn.disabled = fileData.status !== 'done';
      downloadBtn.onclick = () => this.downloadFile(id);
      
      const removeBtn = document.createElement('button');
      removeBtn.innerHTML = '❌';
      removeBtn.title = 'Remove';
      removeBtn.onclick = () => this.removeFile(id);
      
      actions.appendChild(previewBtn);
      actions.appendChild(downloadBtn);
      actions.appendChild(removeBtn);
      
      item.appendChild(thumb);
      item.appendChild(info);
      item.appendChild(status);
      item.appendChild(actions);
      
      this.filesList.appendChild(item);
    }
    
    this.updateStats();
  }
  
  getStatusText(status) {
    const texts = {
      pending: '待处理',
      processing: '处理中...',
      done: '完成',
      error: '错误'
    };
    return texts[status] || status;
  }
  
  formatSize(bytes) {
    if (bytes >= 1024 * 1024) {
      return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    } else if (bytes >= 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    }
    return bytes + ' B';
  }
  
  async compressAll() {
    this.compressAllBtn.disabled = true;
    
    for (const [id, fileData] of this.files) {
      if (fileData.status === 'done') continue;
      
      fileData.status = 'processing';
      this.renderFileList();
      
      try {
        await this.compressFile(id);
        fileData.status = 'done';
      } catch (err) {
        fileData.status = 'error';
        fileData.error = err.message;
        console.error(`Error compressing ${fileData.name}:`, err);
      }
      
      this.renderFileList();
    }
    
    this.compressAllBtn.disabled = false;
    this.downloadAllBtn.disabled = !this.hasCompressedFiles();
    this.statsSection.style.display = 'block';
  }
  
  async compressFile(id) {
    const fileData = this.files.get(id);
    if (!fileData) return;
    
    const format = this.outputFormat.value;
    const quality = parseInt(this.quality.value) / 100;
    const scale = parseInt(this.scale.value) / 100;
    const preserveAlpha = this.preserveAlpha.checked;
    
    // Load original image
    const img = await this.loadImage(fileData.file);
    
    // Calculate new dimensions
    const newWidth = Math.round(img.width * scale);
    const newHeight = Math.round(img.height * scale);
    fileData.newWidth = newWidth;
    fileData.newHeight = newHeight;
    
    // Create canvas for compression
    const canvas = document.createElement('canvas');
    canvas.width = newWidth;
    canvas.height = newHeight;
    const ctx = canvas.getContext('2d');
    
    // Handle transparency
    if (!preserveAlpha || format === 'jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, newWidth, newHeight);
    }
    
    // Draw image with scaling
    ctx.drawImage(img, 0, 0, newWidth, newHeight);
    
    // Get mime type
    const mimeTypes = {
      webp: 'image/webp',
      png: 'image/png',
      jpeg: 'image/jpeg'
    };
    const mimeType = mimeTypes[format];
    
    // Compress to blob
    const blob = await new Promise((resolve) => {
      if (format === 'png') {
        canvas.toBlob(resolve, mimeType);
      } else {
        canvas.toBlob(resolve, mimeType, quality);
      }
    });
    
    fileData.compressedBlob = blob;
    fileData.compressedSize = blob.size;
    
    // Update file extension in name
    const baseName = fileData.name.replace(/\.[^.]+$/, '');
    fileData.compressedName = `${baseName}.${format}`;
  }
  
  showPreview(id) {
    const fileData = this.files.get(id);
    if (!fileData) return;
    
    this.previewSection.style.display = 'block';
    
    // Original preview
    this.originalPreview.innerHTML = '';
    const origImg = document.createElement('img');
    origImg.src = URL.createObjectURL(fileData.file);
    this.originalPreview.appendChild(origImg);
    
    this.originalInfo.innerHTML = `
      <p>文件: ${fileData.name}</p>
      <p>大小: ${this.formatSize(fileData.originalSize)}</p>
      <p>尺寸: ${fileData.width} × ${fileData.height}</p>
      <p>GPU 内存: ~${this.formatSize(fileData.width * fileData.height * 4)}</p>
    `;
    
    // Compressed preview
    this.compressedPreview.innerHTML = '';
    if (fileData.compressedBlob) {
      const compImg = document.createElement('img');
      compImg.src = URL.createObjectURL(fileData.compressedBlob);
      this.compressedPreview.appendChild(compImg);
      
      const ratio = ((1 - fileData.compressedSize / fileData.originalSize) * 100).toFixed(1);
      const gpuMem = fileData.newWidth * fileData.newHeight * 4;
      const gpuSaved = (fileData.width * fileData.height * 4) - gpuMem;
      
      this.compressedInfo.innerHTML = `
        <p>文件: ${fileData.compressedName}</p>
        <p>大小: ${this.formatSize(fileData.compressedSize)} (-${ratio}%)</p>
        <p>尺寸: ${fileData.newWidth} × ${fileData.newHeight}</p>
        <p>GPU 内存: ~${this.formatSize(gpuMem)} (${gpuSaved > 0 ? '节省 ' + this.formatSize(gpuSaved) : '无变化'})</p>
      `;
    } else {
      this.compressedPreview.innerHTML = '<p style="color: var(--text-muted);">尚未压缩</p>';
      this.compressedInfo.innerHTML = '<p>请先点击"压缩全部"</p>';
    }
    
    // Scroll to preview
    this.previewSection.scrollIntoView({ behavior: 'smooth' });
  }
  
  downloadFile(id) {
    const fileData = this.files.get(id);
    if (!fileData || !fileData.compressedBlob) return;
    
    const url = URL.createObjectURL(fileData.compressedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileData.compressedName;
    a.click();
    URL.revokeObjectURL(url);
  }
  
  async downloadAll() {
    const compressedFiles = Array.from(this.files.values()).filter(f => f.status === 'done');
    if (compressedFiles.length === 0) return;
    
    if (compressedFiles.length === 1) {
      this.downloadFile(compressedFiles[0].id);
      return;
    }
    
    // Use JSZip for multiple files
    const zip = new JSZip();
    
    for (const fileData of compressedFiles) {
      zip.file(fileData.compressedName, fileData.compressedBlob);
    }
    
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'compressed_spritesheets.zip';
    a.click();
    URL.revokeObjectURL(url);
  }
  
  removeFile(id) {
    this.files.delete(id);
    this.renderFileList();
    
    if (this.files.size === 0) {
      this.filesSection.style.display = 'none';
      this.previewSection.style.display = 'none';
      this.statsSection.style.display = 'none';
    }
  }
  
  clearAll() {
    this.files.clear();
    this.filesList.innerHTML = '';
    this.filesSection.style.display = 'none';
    this.previewSection.style.display = 'none';
    this.statsSection.style.display = 'none';
    this.downloadAllBtn.disabled = true;
  }
  
  hasCompressedFiles() {
    for (const fileData of this.files.values()) {
      if (fileData.status === 'done') return true;
    }
    return false;
  }
  
  updateStats() {
    let totalOriginal = 0;
    let totalCompressed = 0;
    let totalGpuOriginal = 0;
    let totalGpuCompressed = 0;
    
    for (const fileData of this.files.values()) {
      totalOriginal += fileData.originalSize;
      totalGpuOriginal += fileData.width * fileData.height * 4;
      
      if (fileData.status === 'done') {
        totalCompressed += fileData.compressedSize;
        totalGpuCompressed += fileData.newWidth * fileData.newHeight * 4;
      } else {
        totalCompressed += fileData.originalSize;
        totalGpuCompressed += fileData.width * fileData.height * 4;
      }
    }
    
    this.totalOriginal.textContent = this.formatSize(totalOriginal);
    this.totalCompressed.textContent = this.formatSize(totalCompressed);
    
    const savedPercent = totalOriginal > 0 ? ((1 - totalCompressed / totalOriginal) * 100).toFixed(1) : 0;
    this.totalSaved.textContent = `${savedPercent}%`;
    
    const gpuSaved = totalGpuOriginal - totalGpuCompressed;
    this.gpuSaved.textContent = gpuSaved > 0 ? this.formatSize(gpuSaved) : '0 MB';
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  new SpritesheetCompressor();
});
