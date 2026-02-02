/**
 * ============================================================================
 * TrayBuddy Mod Editor - 主应用脚本
 * ============================================================================
 */

// ============================================================================
// 全局状态
// ============================================================================

/** 当前加载的 Mod 数据 */
let currentMod = null;

/** Mod 文件夹句柄 (File System Access API) */
let modFolderHandle = null;

/** 当前选中的文本语言 */
let currentTextLang = 'zh';

/** 当前选中的音频语言 */
let currentAudioLang = 'zh';

/** 当前编辑的状态索引 (-1 表示重要状态，>= 0 表示 states 数组索引，-2 表示新建) */
let editingStateIndex = -2;

/** 当前编辑的重要状态 key（idle, silence 等） */
let editingImportantStateKey = null;

/** 当前编辑的触发器索引 */
let editingTriggerIndex = -1;

/** 当前编辑的资源类型 ('sequence' 或 'img') */
let editingAssetType = null;

/** 当前编辑的资源索引 */
let editingAssetIndex = -1;

/** 气泡样式配置 */
let bubbleStyle = null;

/** 是否有未保存的更改 */
let hasUnsavedChanges = false;

/** JSZip 实例 */
let zip = null;

/** 支持的预览图格式（按优先级排序） */
const PREVIEW_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

/** 当前预览图的扩展名 */
let currentPreviewExt = 'png';

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 从 data URL 中提取文件扩展名
 * @param {string} dataUrl - data URL 字符串
 * @returns {string|null} 扩展名（如 'png', 'jpg', 'jpeg', 'webp'）或 null
 */
function getExtensionFromDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  
  // data URL 格式: data:image/png;base64,xxxxx
  const match = dataUrl.match(/^data:image\/(\w+);/);
  if (!match) return null;
  
  const mimeExt = match[1].toLowerCase();
  
  // MIME 类型到扩展名的映射
  const mimeToExt = {
    'png': 'png',
    'jpeg': 'jpg',
    'jpg': 'jpg',
    'webp': 'webp'
  };
  
  return mimeToExt[mimeExt] || null;
}

// ============================================================================
// 初始化
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initPreviewUpload();
  initBubbleListeners();
  initLanguageChangeListener();
  initDatePickers();
  initSectionDetailsClickGuards();
  initGlobalScrollActions();
});

/**
 * 初始化日期选择器事件监听
 */
function initDatePickers() {
  // 开始日期月份改变时更新日选项
  document.getElementById('state-date-start-month')?.addEventListener('change', () => {
    updateDayOptions('state-date-start-month', 'state-date-start-day');
  });
  
  // 结束日期月份改变时更新日选项
  document.getElementById('state-date-end-month')?.addEventListener('change', () => {
    updateDayOptions('state-date-end-month', 'state-date-end-day');
  });
}

/**
 * 防止点击可折叠分组（details/summary）里的按钮导致误触折叠
 *
 * 注意：不能在“捕获阶段”对 `.section-actions` 做 stopPropagation，
 * 否则会导致按钮自身的 `onclick` 收不到事件（表现为列表头部按钮失效）。
 */
function initSectionDetailsClickGuards() {
  // 使用冒泡阶段：先让按钮自身的 click handler 正常执行，再取消 summary 的默认 toggle 行为
  document.addEventListener('click', (e) => {
    const summary = e.target.closest('details.section-details > summary');
    if (!summary) return;

    // 如果点击发生在 summary 内的操作按钮区域，阻止 details toggle（但不阻断按钮事件）
    if (e.target.closest('.section-actions')) {
      e.preventDefault();
    }
  });
}

function getContentPanelElement() {
  return document.querySelector('.content-panel');
}

function scrollContentToTop() {
  const el = getContentPanelElement();
  if (!el) return;
  el.scrollTo({ top: 0, behavior: 'smooth' });
}

function scrollContentToBottom() {
  const el = getContentPanelElement();
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
}

function initGlobalScrollActions() {
  const actions = document.getElementById('global-scroll-actions');
  if (!actions) return;
  // 始终显示（按需可在这里增加“根据滚动位置隐藏/禁用”的逻辑）
  actions.style.display = 'flex';
}

/**
 * 初始化语言切换监听
 * 当语言切换时，重新渲染动态生成的内容
 */
function initLanguageChangeListener() {
  window.addEventListener('languageChanged', () => {
    if (!currentMod) return;
    
    // 重新设置 Mod 名称（因为 data-i18n 会覆盖它）
    const isNewMod = !modFolderHandle;
    const modNameEl = document.getElementById('currentModName');
    if (isNewMod) {
      modNameEl.textContent = currentMod.manifest.id + ` (${window.i18n.t('new_label')})`;
    } else {
      modNameEl.textContent = currentMod.manifest.id;
    }
    
    // 重新渲染所有动态内容
    renderStates();
    renderTriggers();
    renderAssets();
    renderTexts();
    renderAudio();
    populateBubbleStyle();
    populateManifestForm();
    
    // 如果状态编辑弹窗打开中，重新渲染弹窗内容
    if (document.getElementById('state-modal').classList.contains('show')) {
      refreshStateModalI18n();
    }
    
    // 如果触发器编辑弹窗打开中，重新渲染弹窗内容
    if (document.getElementById('trigger-modal').classList.contains('show')) {
      refreshTriggerModalI18n();
    }
    
    // 如果资源编辑弹窗打开中，重新渲染弹窗内容
    if (document.getElementById('asset-modal').classList.contains('show')) {
      refreshAssetModalI18n();
    }
  });
}

/**
 * 刷新状态编辑弹窗内的 i18n 内容
 */
function refreshStateModalI18n() {
  // 收集当前弹窗内的数据
  const canTriggerStates = collectCanTriggerStates();
  const branches = collectBranches();
  
  // 重新渲染动态列表（保留数据）
  renderCanTriggerStates(canTriggerStates);
  renderBranches(branches);
}

/**
 * 刷新触发器编辑弹窗内的 i18n 内容
 */
function refreshTriggerModalI18n() {
  // 收集当前弹窗内的数据
  const triggerData = collectTriggerData();
  
  // 重新渲染触发状态组
  renderTriggerGroups(triggerData.can_trigger_states);
}

/**
 * 刷新资源编辑弹窗内的 i18n 内容
 */
function refreshAssetModalI18n() {
  // 资源弹窗的 placeholder 由 data-i18n-placeholder 处理，暂无需额外刷新
}

/**
 * 初始化导航
 */
function initNavigation() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      if (!currentMod) {
        showToast(window.i18n.t('msg_load_mod_first'), 'warning');
        return;
      }
      
      const tabId = tab.dataset.tab;
      switchTab(tabId);
      
      // 更新导航状态
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });
}

/**
 * 初始化气泡样式监听
 */
function initBubbleListeners() {
  const inputs = [
    // bubble
    'bubble-bg', 'bubble-border', 'bubble-radius', 'bubble-padding', 
    'bubble-min-width', 'bubble-max-width', 'bubble-color', 'bubble-font-size',
    'bubble-line-height', 'bubble-font-family', 'bubble-box-shadow', 'bubble-backdrop-filter',
    'bubble-decoration-top', 'bubble-decoration-bottom',
    'bubble-tail-size', 'bubble-tail-color', 'bubble-tail-shadow',
    // branch container
    'branch-container-gap', 'branch-container-margin-top', 'branch-container-padding-top', 'branch-container-border-top',
    // branch button
    'branch-btn-bg', 'branch-btn-color', 'branch-btn-border', 'branch-btn-border-radius',
    'branch-btn-padding', 'branch-btn-min-width', 'branch-btn-font-size', 'branch-btn-box-shadow', 'branch-btn-backdrop-filter',
    // branch hover
    'branch-btn-hover-bg', 'branch-btn-hover-color', 'branch-btn-hover-border-color', 'branch-btn-hover-box-shadow', 'branch-btn-hover-transform',
    // branch active
    'branch-btn-active-bg', 'branch-btn-active-box-shadow', 'branch-btn-active-transform',
    // decoration
    'branch-decoration-left', 'branch-decoration-right'
  ];
  
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        collectBubbleStyle();
        updateBubblePreview();
        markUnsaved();
      });
      el.addEventListener('input', () => {
        // 实时预览（节流）
        clearTimeout(el._previewTimer);
        el._previewTimer = setTimeout(() => {
          collectBubbleStyle();
          updateBubblePreview();
        }, 300);
      });
    }
  });
}

/**
 * 更新气泡预览
 */
function updateBubblePreview() {
  if (!currentMod || !currentMod.bubbleStyle) return;
  const s = currentMod.bubbleStyle;
  
  const bubble = document.getElementById('bubble-preview');
  const tail = document.getElementById('preview-tail');
  const decoTop = document.getElementById('preview-deco-top');
  const decoBottom = document.getElementById('preview-deco-bottom');
  const branches = document.getElementById('preview-branches');
  const btn1 = document.getElementById('preview-branch-1');
  const btn2 = document.getElementById('preview-branch-2');
  const decoLeft = document.getElementById('preview-btn-deco-left');
  const decoRight = document.getElementById('preview-btn-deco-right');
  
  if (!bubble) return;
  
  // 重置样式
  bubble.style.cssText = '';
  tail.style.cssText = '';
  branches.style.cssText = '';
  btn1.style.cssText = '';
  btn2.style.cssText = '';
  
  // --- 气泡主体 ---
  if (s.bubble) {
    if (s.bubble.background) bubble.style.background = s.bubble.background;
    if (s.bubble.border) bubble.style.border = s.bubble.border;
    if (s.bubble.border_radius) bubble.style.borderRadius = s.bubble.border_radius;
    if (s.bubble.padding) bubble.style.padding = s.bubble.padding;
    if (s.bubble.min_width) bubble.style.minWidth = s.bubble.min_width;
    if (s.bubble.max_width) bubble.style.maxWidth = s.bubble.max_width;
    if (s.bubble.color) bubble.style.color = s.bubble.color;
    if (s.bubble.font_size) bubble.style.fontSize = s.bubble.font_size;
    if (s.bubble.line_height) bubble.style.lineHeight = s.bubble.line_height;
    if (s.bubble.font_family) bubble.style.fontFamily = s.bubble.font_family;
    if (s.bubble.box_shadow) bubble.style.boxShadow = s.bubble.box_shadow;
    if (s.bubble.backdrop_filter) bubble.style.backdropFilter = s.bubble.backdrop_filter;
  }
  
  // --- 装饰 ---
  if (s.bubble?.decoration_top?.content) {
    decoTop.textContent = s.bubble.decoration_top.content;
    decoTop.style.display = 'block';
  } else {
    decoTop.style.display = 'none';
  }
  
  if (s.bubble?.decoration_bottom?.content) {
    decoBottom.textContent = s.bubble.decoration_bottom.content;
    decoBottom.style.display = 'block';
  } else {
    decoBottom.style.display = 'none';
  }
  
  // --- 尾巴 ---
  if (s.bubble?.tail) {
    if (s.bubble.tail.size) {
      tail.style.borderWidth = s.bubble.tail.size;
    }
    if (s.bubble.tail.color) {
      tail.style.borderTopColor = s.bubble.tail.color;
    }
    if (s.bubble.tail.shadow) {
      tail.style.filter = `drop-shadow(${s.bubble.tail.shadow})`;
    }
  }
  
  // --- 分支容器 ---
  if (s.branch?.container) {
    if (s.branch.container.gap) branches.style.gap = s.branch.container.gap;
    if (s.branch.container.margin_top) branches.style.marginTop = s.branch.container.margin_top;
    if (s.branch.container.padding_top) branches.style.paddingTop = s.branch.container.padding_top;
    if (s.branch.container.border_top) branches.style.borderTop = s.branch.container.border_top;
  }
  
  // --- 分支按钮 ---
  const applyBtnStyle = (btn) => {
    if (!s.branch?.button) return;
    if (s.branch.button.background) btn.style.background = s.branch.button.background;
    if (s.branch.button.color) btn.style.color = s.branch.button.color;
    if (s.branch.button.border) btn.style.border = s.branch.button.border;
    if (s.branch.button.border_radius) btn.style.borderRadius = s.branch.button.border_radius;
    if (s.branch.button.padding) btn.style.padding = s.branch.button.padding;
    if (s.branch.button.min_width) btn.style.minWidth = s.branch.button.min_width;
    if (s.branch.button.font_size) btn.style.fontSize = s.branch.button.font_size;
    if (s.branch.button.box_shadow) btn.style.boxShadow = s.branch.button.box_shadow;
    if (s.branch.button.backdrop_filter) btn.style.backdropFilter = s.branch.button.backdrop_filter;
  };
  
  applyBtnStyle(btn1);
  applyBtnStyle(btn2);
  
  // --- 装饰文字 ---
  if (s.branch?.decoration_left?.content) {
    decoLeft.textContent = s.branch.decoration_left.content;
    // 同步到第二个按钮
    btn2.querySelector('.deco-left').textContent = s.branch.decoration_left.content;
  } else {
    decoLeft.textContent = '';
    btn2.querySelector('.deco-left').textContent = '';
  }
  
  if (s.branch?.decoration_right?.content) {
    decoRight.textContent = s.branch.decoration_right.content;
    btn2.querySelector('.deco-right').textContent = s.branch.decoration_right.content;
  } else {
    decoRight.textContent = '';
    btn2.querySelector('.deco-right').textContent = '';
  }
}

/**
 * 初始化预览图上传
 */
function initPreviewUpload() {
  const previewImage = document.getElementById('preview-image');
  const previewFile = document.getElementById('preview-file');
  
  previewImage.addEventListener('click', () => previewFile.click());
  
  previewFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        previewImage.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
        if (currentMod) {
          currentMod.previewData = e.target.result;
          // 从上传的文件中获取扩展名
          const ext = getExtensionFromDataUrl(e.target.result);
          if (ext) currentPreviewExt = ext;
          markUnsaved();
        }
      };
      reader.readAsDataURL(file);
    }
  });
  
  // 图标上传
  const iconImage = document.getElementById('icon-image');
  const iconFile = document.getElementById('icon-file');
  
  iconImage.addEventListener('click', () => iconFile.click());
  
  iconFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        iconImage.innerHTML = `<img src="${e.target.result}" alt="Icon">`;
        if (currentMod) {
          currentMod.iconData = e.target.result;
          markUnsaved();
        }
      };
      reader.readAsDataURL(file);
    }
  });
}

/**
 * 切换气泡样式启用状态
 */
function toggleBubbleStyle() {
  const enabled = document.getElementById('bubble-enable').checked;
  const fields = document.getElementById('bubble-style-fields');
  
  if (enabled) {
    fields.classList.remove('bubble-disabled');
    fields.classList.add('bubble-enabled');
  } else {
    fields.classList.remove('bubble-enabled');
    fields.classList.add('bubble-disabled');
  }
  
  if (currentMod) {
    currentMod.bubbleEnabled = enabled;
    markUnsaved();
  }
}

/**
 * 切换对话文本 speech.json 启用状态
 */
function toggleTextSpeech() {
  const enabled = document.getElementById('text-speech-enable')?.checked === true;
  const fields = document.getElementById('text-speech-fields');
  const addBtn = document.getElementById('text-speech-add-btn');

  if (fields) {
    if (enabled) {
      fields.classList.remove('feature-disabled');
      fields.classList.add('feature-enabled');
    } else {
      fields.classList.remove('feature-enabled');
      fields.classList.add('feature-disabled');
    }
  }
  if (addBtn) addBtn.disabled = !enabled;

  if (currentMod) {
    currentMod.textSpeechEnabled = enabled;
    markUnsaved();
  }

  // 立即刷新列表
  if (enabled) {
    renderSpeechTexts();
  } else {
    const list = document.getElementById('speech-text-list');
    if (list) list.innerHTML = '';
  }
}

/**
 * 切换音频 speech.json 启用状态
 */
function toggleAudioSpeech() {
  const enabled = document.getElementById('audio-speech-enable')?.checked === true;
  const fields = document.getElementById('audio-speech-fields');

  if (fields) {
    if (enabled) {
      fields.classList.remove('feature-disabled');
      fields.classList.add('feature-enabled');
    } else {
      fields.classList.remove('feature-enabled');
      fields.classList.add('feature-disabled');
    }
  }

  if (currentMod) {
    currentMod.audioSpeechEnabled = enabled;
    markUnsaved();
  }

  // 立即刷新
  renderAudio();
}

function populateTextSpeechToggle() {
  if (!currentMod) return;
  const enabled = currentMod.textSpeechEnabled === true;
  const checkbox = document.getElementById('text-speech-enable');
  const fields = document.getElementById('text-speech-fields');
  const addBtn = document.getElementById('text-speech-add-btn');

  if (checkbox) checkbox.checked = enabled;
  if (fields) {
    fields.classList.toggle('feature-enabled', enabled);
    fields.classList.toggle('feature-disabled', !enabled);
  }
  if (addBtn) addBtn.disabled = !enabled;
}

function populateAudioSpeechToggle() {
  if (!currentMod) return;
  const enabled = currentMod.audioSpeechEnabled === true;
  const checkbox = document.getElementById('audio-speech-enable');
  const fields = document.getElementById('audio-speech-fields');
  const addBtn = document.getElementById('audio-speech-add-btn');

  if (checkbox) checkbox.checked = enabled;
  if (fields) {
    fields.classList.toggle('feature-enabled', enabled);
    fields.classList.toggle('feature-disabled', !enabled);
  }
  if (addBtn) addBtn.disabled = !enabled;
}

/**
 * 切换标签页
 */
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  const targetTab = document.getElementById(`tab-${tab}`);
  if (targetTab) {
    targetTab.classList.add('active');
    
    // 如果是气泡页，填充数据
    if (tab === 'bubble') {
      populateBubbleStyle();
    }

    if (tab === 'texts') {
      populateTextSpeechToggle();
    }

    if (tab === 'audio') {
      populateAudioSpeechToggle();
    }
  }
}

// ============================================================================
// Mod 加载/创建/保存
// ============================================================================

/**
 * 打开 .tbuddy 文件
 */
async function loadModTbuddy() {
  try {
    const [fileHandle] = await window.showOpenFilePicker({
      types: [
        {
          description: 'TrayBuddy Mod',
          accept: { 'application/octet-stream': ['.tbuddy'] }
        }
      ]
    });
    
    const file = await fileHandle.getFile();
    const jszip = new JSZip();
    const zipData = await jszip.loadAsync(file);
    
    showToast(window.i18n.t('msg_loading_tbuddy'), 'info');
    
    // 寻找根目录
    let rootPath = '';
    const manifestFile = Object.keys(zipData.files).find(f => f.endsWith('manifest.json'));
    if (!manifestFile) {
      throw new Error(window.i18n.t('msg_manifest_not_found'));
    }
    rootPath = manifestFile.replace('manifest.json', '');
    
    const manifestText = await zipData.file(manifestFile).async('string');
    const manifest = JSON.parse(manifestText);
    normalizeManifestForEditor(manifest);
    
    currentMod = {
      manifest: manifest,
      assets: { sequence: [], img: [] },
      texts: {},
      audio: {},
      bubbleStyle: null,
      bubbleEnabled: false,
      textSpeechEnabled: false,
      audioSpeechEnabled: false,
      previewData: null,
      iconData: null
    };
    
    // 重置预览图扩展名
    currentPreviewExt = 'png';
    
    // 读取其他文件
    const seqFile = zipData.file(`${rootPath}asset/sequence.json`);
    if (seqFile) currentMod.assets.sequence = JSON.parse(await seqFile.async('string'));
    
    const imgFile = zipData.file(`${rootPath}asset/img.json`);
    if (imgFile) currentMod.assets.img = JSON.parse(await imgFile.async('string'));
    
    const bubbleFile = zipData.file(`${rootPath}bubble_style.json`);
    if (bubbleFile) {
      currentMod.bubbleStyle = JSON.parse(await bubbleFile.async('string'));
      currentMod.bubbleEnabled = true;
    }
    
    // 读取 text 和 audio
    let foundTextSpeech = false;
    let foundAudioSpeech = false;
    for (const fileName in zipData.files) {
      if (fileName.startsWith(`${rootPath}text/`) && fileName.endsWith('info.json')) {
        const parts = fileName.split('/');
        const lang = parts[parts.length - 2];
        if (!currentMod.texts[lang]) currentMod.texts[lang] = { info: null, speech: [] };
        currentMod.texts[lang].info = JSON.parse(await zipData.file(fileName).async('string'));
        
        const speechFile = zipData.file(`${rootPath}text/${lang}/speech.json`);
        if (speechFile) {
          currentMod.texts[lang].speech = JSON.parse(await speechFile.async('string'));
          foundTextSpeech = true;
        }
      }
      
      if (fileName.startsWith(`${rootPath}audio/`) && fileName.endsWith('speech.json')) {
        const parts = fileName.split('/');
        const lang = parts[parts.length - 2];
        currentMod.audio[lang] = JSON.parse(await zipData.file(fileName).async('string'));
        foundAudioSpeech = true;
      }
    }
    currentMod.textSpeechEnabled = foundTextSpeech;
    currentMod.audioSpeechEnabled = foundAudioSpeech;
    
    // 读取预览图（支持多种格式）
    currentPreviewExt = 'png'; // 默认
    for (const ext of PREVIEW_EXTENSIONS) {
      const previewFile = zipData.file(`${rootPath}preview.${ext}`);
      if (previewFile) {
        const blob = await previewFile.async('blob');
        currentMod.previewData = await new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target.result);
          reader.readAsDataURL(blob);
        });
        currentPreviewExt = ext;
        break;
      }
    }
    
    // 读取图标
    const iconFile = zipData.file(`${rootPath}icon.ico`);
    if (iconFile) {
      const blob = await iconFile.async('blob');
      currentMod.iconData = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.readAsDataURL(blob);
      });
    }
    
    modFolderHandle = null; // .tbuddy 加载的不记录文件夹句柄
    finishLoading(manifest);
    
  } catch (e) {
    console.error('Failed to load .tbuddy:', e);
    showToast(window.i18n.t('msg_load_failed', { error: e.message }), 'error');
  }
}

/**
 * 完成加载后的 UI 更新
 */
function finishLoading(manifest) {
  document.getElementById('currentModName').textContent = manifest.id;
  document.getElementById('saveBtn').disabled = false;
  document.getElementById('exportBtn').disabled = false;
  
  populateManifestForm();
  renderStates();
  renderTriggers();
  renderAssets();
  renderTexts();
  renderAudio();
  populateBubbleStyle();
  
  switchTab('manifest');
  document.querySelector('.nav-tab[data-tab="manifest"]').classList.add('active');
  document.querySelector('.nav-tab.active:not([data-tab="manifest"])')?.classList.remove('active');
  document.getElementById('tab-empty').classList.remove('active');
  
  showToast(window.i18n.t('msg_load_success', { id: manifest.id }), 'success');
}

/**
 * 加载 Mod 文件夹
 */
async function loadModFolder() {
  try {
    // 使用 File System Access API
    if (!('showDirectoryPicker' in window)) {
      showToast(window.i18n.t('msg_browser_not_support'), 'error');
      return;
    }
    
    modFolderHandle = await window.showDirectoryPicker({
      mode: 'readwrite'
    });
    
    showToast(window.i18n.t('msg_loading_mod'), 'info');
    
    // 读取 manifest.json
    const manifestHandle = await modFolderHandle.getFileHandle('manifest.json');
    const manifestFile = await manifestHandle.getFile();
    const manifestText = await manifestFile.text();
    const manifest = JSON.parse(manifestText);
    normalizeManifestForEditor(manifest);
    
    // 初始化 Mod 数据结构
    currentMod = {
      manifest: manifest,
      assets: {
        sequence: [],
        img: []
      },
      texts: {},
      audio: {},
      bubbleStyle: null,
      bubbleEnabled: false,
      textSpeechEnabled: false,
      audioSpeechEnabled: false,
      previewData: null,
      iconData: null
    };
    
    // 重置预览图扩展名
    currentPreviewExt = 'png';
    
    // 读取 asset/sequence.json
    try {
      const assetDir = await modFolderHandle.getDirectoryHandle('asset');
      const seqHandle = await assetDir.getFileHandle('sequence.json');
      const seqFile = await seqHandle.getFile();
      currentMod.assets.sequence = JSON.parse(await seqFile.text());
    } catch (e) {
      console.log('No sequence.json found');
    }
    
    // 读取 asset/img.json
    try {
      const assetDir = await modFolderHandle.getDirectoryHandle('asset');
      const imgHandle = await assetDir.getFileHandle('img.json');
      const imgFile = await imgHandle.getFile();
      currentMod.assets.img = JSON.parse(await imgFile.text());
    } catch (e) {
      console.log('No img.json found');
    }

    // 读取 bubble_style.json
    try {
      const bubbleHandle = await modFolderHandle.getFileHandle('bubble_style.json');
      const bubbleFile = await bubbleHandle.getFile();
      currentMod.bubbleStyle = JSON.parse(await bubbleFile.text());
      currentMod.bubbleEnabled = true;
    } catch (e) {
      console.log('No bubble_style.json found');
    }
    
    // 读取 text 目录
    let foundTextSpeech = false;
    try {
      const textDir = await modFolderHandle.getDirectoryHandle('text');
      for await (const entry of textDir.values()) {
        if (entry.kind === 'directory') {
          const langDir = await textDir.getDirectoryHandle(entry.name);
          currentMod.texts[entry.name] = {
            info: null,
            speech: []
          };
          
          // 读取 info.json
          try {
            const infoHandle = await langDir.getFileHandle('info.json');
            const infoFile = await infoHandle.getFile();
            currentMod.texts[entry.name].info = JSON.parse(await infoFile.text());
          } catch (e) {}
          
          // 读取 speech.json
          try {
            const speechHandle = await langDir.getFileHandle('speech.json');
            const speechFile = await speechHandle.getFile();
            currentMod.texts[entry.name].speech = JSON.parse(await speechFile.text());
            foundTextSpeech = true;
          } catch (e) {}
        }
      }
    } catch (e) {
      console.log('No text directory found');
    }
    currentMod.textSpeechEnabled = foundTextSpeech;
    
    // 读取 audio 目录
    let foundAudioSpeech = false;
    try {
      const audioDir = await modFolderHandle.getDirectoryHandle('audio');
      for await (const entry of audioDir.values()) {
        if (entry.kind === 'directory') {
          const langDir = await audioDir.getDirectoryHandle(entry.name);
          currentMod.audio[entry.name] = [];
          
          // 读取 speech.json
          try {
            const speechHandle = await langDir.getFileHandle('speech.json');
            const speechFile = await speechHandle.getFile();
            currentMod.audio[entry.name] = JSON.parse(await speechFile.text());
            foundAudioSpeech = true;
          } catch (e) {}
        }
      }
    } catch (e) {
      console.log('No audio directory found');
    }
    currentMod.audioSpeechEnabled = foundAudioSpeech;
    
    // 读取预览图（支持多种格式）
    currentPreviewExt = 'png'; // 默认
    for (const ext of PREVIEW_EXTENSIONS) {
      try {
        const previewHandle = await modFolderHandle.getFileHandle(`preview.${ext}`);
        const previewFile = await previewHandle.getFile();
        const reader = new FileReader();
        reader.onload = (e) => {
          currentMod.previewData = e.target.result;
          document.getElementById('preview-image').innerHTML = `<img src="${e.target.result}" alt="Preview">`;
        };
        reader.readAsDataURL(previewFile);
        currentPreviewExt = ext;
        break;
      } catch (e) {
        // 尝试下一个格式
      }
    }
    
    // 读取图标
    try {
      const iconHandle = await modFolderHandle.getFileHandle('icon.ico');
      const iconFile = await iconHandle.getFile();
      const reader = new FileReader();
      reader.onload = (e) => {
        currentMod.iconData = e.target.result;
        document.getElementById('icon-image').innerHTML = `<img src="${e.target.result}" alt="Icon">`;
      };
      reader.readAsDataURL(iconFile);
    } catch (e) {
      console.log('No icon.ico found');
    }
    
    finishLoading(manifest);
    
  } catch (e) {
    console.error('Failed to load mod:', e);
    if (e.name !== 'AbortError') {
      showToast(window.i18n.t('msg_load_failed', { error: e.message }), 'error');
    }
  }
}

/**
 * 创建新 Mod
 */
function createNewMod() {
  document.getElementById('new-mod-modal').classList.add('show');
}

/**
 * 关闭新建 Mod 弹窗
 */
function closeNewModModal() {
  document.getElementById('new-mod-modal').classList.remove('show');
}

/**
 * 确认创建新 Mod
 */
async function confirmCreateMod() {
  const modId = document.getElementById('new-mod-id').value.trim();
  const modName = document.getElementById('new-mod-name').value.trim();
  const modAuthor = document.getElementById('new-mod-author').value.trim();
  
  if (!modId) {
    showToast(window.i18n.t('msg_enter_mod_id'), 'warning');
    return;
  }
  
  if (!/^[a-zA-Z0-9_]+$/.test(modId)) {
    showToast(window.i18n.t('msg_mod_id_invalid'), 'warning');
    return;
  }

  showToast(window.i18n.t('msg_creating_mod'), 'info');

  // 基于 ./template 生成初始数据
  currentMod = await createModFromTemplate(modId, modName, modAuthor);
  modFolderHandle = null; // 新建 Mod 暂无文件夹句柄

  // 更新 UI
  document.getElementById('currentModName').textContent = modId + ` (${window.i18n.t('new_label')})`;
  document.getElementById('saveBtn').disabled = false;
  document.getElementById('exportBtn').disabled = false;

  // 填充表单
  populateManifestForm();
  renderStates();
  renderTriggers();
  renderAssets();
  renderTexts();
  renderAudio();
  populateBubbleStyle();

  // 切换到基本信息页
  switchTab('manifest');
  document.querySelector('.nav-tab[data-tab="manifest"]').classList.add('active');
  document.getElementById('tab-empty').classList.remove('active');

  closeNewModModal();
  showToast(window.i18n.t('msg_mod_created', { id: modId }), 'success');
  markUnsaved();
}

async function createModFromTemplate(modId, modName, modAuthor) {
  const base = './template';

  // 1. 先读取结构配置文件
  const structure = await fetchJsonSafe(`${base}/structure.json`);
  if (!structure) {
    throw new Error('Template structure.json not found');
  }

  // 2. 读取 manifest（必须）
  const manifest = await fetchJsonSafe(`${base}/${structure.manifest}`);
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Template manifest.json not found or invalid');
  }

  // 3. 读取 bubble_style（可选）
  const bubbleStyle = structure.bubble_style 
    ? await fetchJsonSafe(`${base}/${structure.bubble_style}`)
    : null;

  // 4. 动态读取 assets
  const assets = { sequence: [], img: [] };
  if (structure.assets) {
    const assetPromises = Object.entries(structure.assets).map(async ([key, path]) => {
      const data = await fetchJsonSafe(`${base}/${path}`);
      return [key, Array.isArray(data) ? data : []];
    });
    const assetResults = await Promise.all(assetPromises);
    assetResults.forEach(([key, data]) => {
      assets[key] = deepClone(data);
    });
  }

  // 5. 动态读取 texts（根据 text_langs 配置）
  const texts = {};
  const textLangs = structure.text_langs || [];
  const textPromises = textLangs.map(async (lang) => {
    const [info, speech] = await Promise.all([
      fetchJsonSafe(`${base}/text/${lang}/info.json`),
      fetchJsonSafe(`${base}/text/${lang}/speech.json`)
    ]);
    return [lang, { info, speech }];
  });
  const textResults = await Promise.all(textPromises);
  textResults.forEach(([lang, data]) => {
    if (data.info && typeof data.info === 'object') {
      texts[lang] = {
        info: deepClone(data.info),
        speech: Array.isArray(data.speech) ? deepClone(data.speech) : []
      };
    }
  });

  // 6. 动态读取 audio（根据 audio_langs 配置）
  const audio = {};
  const audioLangs = structure.audio_langs || [];
  const audioPromises = audioLangs.map(async (lang) => {
    const data = await fetchJsonSafe(`${base}/audio/${lang}/speech.json`);
    return [lang, data];
  });
  const audioResults = await Promise.all(audioPromises);
  audioResults.forEach(([lang, data]) => {
    if (Array.isArray(data)) {
      audio[lang] = deepClone(data);
    }
  });

  // 7. 组装 mod 对象
  const mod = {
    manifest: deepClone(manifest),
    assets,
    texts,
    audio,
    bubbleStyle: (bubbleStyle && typeof bubbleStyle === 'object') ? deepClone(bubbleStyle) : null,
    bubbleEnabled: !!(bubbleStyle && typeof bubbleStyle === 'object'),

    // 与气泡样式类似：新建 Mod 默认关闭，未启用则不生成对应 speech.json
    textSpeechEnabled: false,
    audioSpeechEnabled: false,

    previewData: null,
    iconData: null
  };

  // 重置预览图扩展名
  currentPreviewExt = 'png';

  // --- 仅覆盖 manifest 的必要字段（id, author）
  mod.manifest.id = modId;
  if (modAuthor) {
    mod.manifest.author = modAuthor;
  }

  // --- 覆盖 texts 里的名称（如果用户提供了 modName）
  if (modName) {
    Object.values(mod.texts).forEach((t) => {
      if (t && t.info && typeof t.info === 'object') {
        t.info.name = modName;
      }
    });
  }

  // 规范化，避免模板结构与编辑器不兼容导致弹窗渲染报错
  normalizeManifestForEditor(mod.manifest);

  return mod;
}

function normalizeStateForEditor(state) {
  if (!state || typeof state !== 'object') return;

  if (!Array.isArray(state.can_trigger_states)) state.can_trigger_states = [];
  if (!Array.isArray(state.branch)) state.branch = [];

  // mod_data_counter 应该是 { op, value } 对象或 null
  // 兼容旧格式：ema 等历史版本里是 { op, value } 或数组
  if (state.mod_data_counter) {
    if (Array.isArray(state.mod_data_counter)) {
      // 如果是数组，取第一个元素
      const first = state.mod_data_counter[0];
      if (first && typeof first === 'object') {
        state.mod_data_counter = {
          op: first.op || 'add',
          value: first.val ?? first.value ?? 0
        };
      } else {
        state.mod_data_counter = null;
      }
    } else if (typeof state.mod_data_counter === 'object') {
      // 确保格式正确
      state.mod_data_counter = {
        op: state.mod_data_counter.op || 'add',
        value: state.mod_data_counter.value ?? state.mod_data_counter.val ?? 0
      };
    } else {
      state.mod_data_counter = null;
    }
  }

  if (typeof state.branch_show_bubble !== 'boolean') state.branch_show_bubble = true;
}

function normalizeManifestForEditor(manifest) {
  if (!manifest || typeof manifest !== 'object') return;

  // ema 字段补齐
  if (typeof manifest.show_mod_data_panel !== 'boolean') manifest.show_mod_data_panel = false;
  if (!Number.isFinite(Number(manifest.mod_data_default_int))) manifest.mod_data_default_int = 0;

  manifest.character = manifest.character || { z_offset: 1 };
  if (!Number.isFinite(Number(manifest.character.z_offset))) manifest.character.z_offset = 1;

  manifest.border = manifest.border || { anima: '', enable: false, z_offset: 2 };
  if (typeof manifest.border.enable !== 'boolean') manifest.border.enable = false;
  if (!Number.isFinite(Number(manifest.border.z_offset))) manifest.border.z_offset = 2;
  if (typeof manifest.border.anima !== 'string') manifest.border.anima = '';

  manifest.important_states = (manifest.important_states && typeof manifest.important_states === 'object') ? manifest.important_states : {};

  ensureImportantState(manifest, 'idle', { persistent: true, priority: 1, trigger_rate: 0.1, next_state: '' });
  ensureImportantState(manifest, 'silence', { persistent: true, priority: 1, trigger_rate: 0, next_state: '' });
  ensureImportantState(manifest, 'silence_start', { persistent: false, priority: 999, trigger_rate: 0, next_state: 'silence' });
  ensureImportantState(manifest, 'silence_end', { persistent: false, priority: 999, trigger_rate: 0, next_state: 'idle' });
  ensureImportantState(manifest, 'music', { persistent: true, priority: 1, trigger_rate: 0.1, next_state: '' });
  ensureImportantState(manifest, 'music_start', { persistent: false, priority: 2, trigger_rate: 0, next_state: 'music' });
  ensureImportantState(manifest, 'music_end', { persistent: false, priority: 2, trigger_rate: 0, next_state: 'idle' });
  ensureImportantState(manifest, 'birthday', { persistent: false, priority: 2, trigger_rate: 0, next_state: '' });
  ensureImportantState(manifest, 'firstday', { persistent: false, priority: 2, trigger_rate: 0, next_state: '' });

  // states / triggers
  manifest.states = Array.isArray(manifest.states) ? manifest.states : [];
  manifest.triggers = Array.isArray(manifest.triggers) ? manifest.triggers : [];

  // 规范化 states
  Object.values(manifest.important_states).forEach(normalizeStateForEditor);
  manifest.states.forEach(normalizeStateForEditor);

  // 触发器字段补齐（兼容 ema 的复杂结构：这里不强行改结构，只保证数组存在）
  manifest.triggers.forEach((t) => {
    if (!t || typeof t !== 'object') return;
    if (typeof t.event !== 'string') t.event = '';
    if (!Array.isArray(t.can_trigger_states)) t.can_trigger_states = [];
  });
}

function ensureImportantState(manifest, key, defaults) {
  if (!manifest || typeof manifest !== 'object') return;
  manifest.important_states = (manifest.important_states && typeof manifest.important_states === 'object') ? manifest.important_states : {};

  if (!manifest.important_states[key] || typeof manifest.important_states[key] !== 'object') {
    manifest.important_states[key] = {
      name: key,
      persistent: Boolean(defaults?.persistent),
      anima: '',
      audio: '',
      text: '',
      priority: Number.isFinite(Number(defaults?.priority)) ? Number(defaults.priority) : (defaults?.persistent ? 1 : 2),
      date_start: '',
      date_end: '',
      time_start: '',
      time_end: '',
      next_state: typeof defaults?.next_state === 'string' ? defaults.next_state : '',
      can_trigger_states: [],
      trigger_time: 0,
      trigger_rate: Number.isFinite(Number(defaults?.trigger_rate)) ? Number(defaults.trigger_rate) : (defaults?.persistent ? 0.1 : 0),
      branch: [],
      mod_data_counter: [],
      branch_show_bubble: true
    };
  }

  // 确保 name 正确
  if (typeof manifest.important_states[key].name !== 'string' || !manifest.important_states[key].name) {
    manifest.important_states[key].name = key;
  }
}


async function fetchJsonSafe(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

function deepClone(obj) {
  if (obj === null || obj === undefined) return obj;
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 将对象序列化为 JSON 字符串，并防止 \n 被双重转义
 * 这样用户在输入框输入的 \n 在 JSON 文件中会保存为 \n (换行符) 而不是 \\n
 */
function stringifyForSave(obj) {
  return JSON.stringify(obj, null, 2).replace(/\\\\n/g, '\\n');
}


/**
 * 创建默认状态对象
 */
function createDefaultState(name, persistent = false) {
  return {
    name: name,
    persistent: persistent,
    anima: '',
    audio: '',
    text: '',
    priority: persistent ? 1 : 2,
    date_start: '',
    date_end: '',
    time_start: '',
    time_end: '',
    next_state: '',
    can_trigger_states: [],
    trigger_time: 0,
    trigger_rate: persistent ? 0.1 : 0,
    branch: []
  };
}

/**
 * 保存 Mod
 */
async function saveMod() {
  if (!currentMod) return;
  
  // 从表单收集数据
  collectManifestData();
  collectBubbleStyle();
  
  // 每次保存都弹窗选择目标文件夹
  try {
    modFolderHandle = await window.showDirectoryPicker({
      mode: 'readwrite'
    });
  } catch (e) {
    if (e.name !== 'AbortError') {
      showToast(window.i18n.t('msg_save_failed', { error: e.message }), 'error');
    }
    return;
  }
  
  try {
    showToast(window.i18n.t('msg_saving'), 'info');
    
    // 保存 manifest.json
    const manifestHandle = await modFolderHandle.getFileHandle('manifest.json', { create: true });
    const manifestWritable = await manifestHandle.createWritable();
    await manifestWritable.write(stringifyForSave(currentMod.manifest));
    await manifestWritable.close();

    // 保存 bubble_style.json (仅当启用时)
    if (currentMod.bubbleEnabled && currentMod.bubbleStyle) {
      const bubbleHandle = await modFolderHandle.getFileHandle('bubble_style.json', { create: true });
      const bubbleWritable = await bubbleHandle.createWritable();
      await bubbleWritable.write(stringifyForSave(currentMod.bubbleStyle));
      await bubbleWritable.close();
    }
    
    // 创建 asset 目录并保存
    const assetDir = await modFolderHandle.getDirectoryHandle('asset', { create: true });
    
    // 保存 sequence.json
    const seqHandle = await assetDir.getFileHandle('sequence.json', { create: true });
    const seqWritable = await seqHandle.createWritable();
    await seqWritable.write(stringifyForSave(currentMod.assets.sequence));
    await seqWritable.close();
    
    // 保存 img.json
    const imgHandle = await assetDir.getFileHandle('img.json', { create: true });
    const imgWritable = await imgHandle.createWritable();
    await imgWritable.write(stringifyForSave(currentMod.assets.img));
    await imgWritable.close();
    
    // 创建 asset 子目录
    await assetDir.getDirectoryHandle('sequence', { create: true });
    await assetDir.getDirectoryHandle('img', { create: true });
    
    // 保存 text 目录
    const textDir = await modFolderHandle.getDirectoryHandle('text', { create: true });
    for (const [lang, data] of Object.entries(currentMod.texts)) {
      const langDir = await textDir.getDirectoryHandle(lang, { create: true });
      
      if (data.info) {
        const infoHandle = await langDir.getFileHandle('info.json', { create: true });
        const infoWritable = await infoHandle.createWritable();
        await infoWritable.write(stringifyForSave(data.info));
        await infoWritable.close();
      }

      // 仅当启用时生成 text/<lang>/speech.json
      if (currentMod.textSpeechEnabled === true) {
        const speechHandle = await langDir.getFileHandle('speech.json', { create: true });
        const speechWritable = await speechHandle.createWritable();
        await speechWritable.write(stringifyForSave(data.speech));
        await speechWritable.close();
      }
    }

    // 保存 audio 目录（仅当启用时生成 audio/<lang>/speech.json）
    if (currentMod.audioSpeechEnabled === true) {
      const audioDir = await modFolderHandle.getDirectoryHandle('audio', { create: true });
      for (const [lang, data] of Object.entries(currentMod.audio)) {
        const langDir = await audioDir.getDirectoryHandle(lang, { create: true });
        await langDir.getDirectoryHandle('speech', { create: true });
        
        const speechHandle = await langDir.getFileHandle('speech.json', { create: true });
        const speechWritable = await speechHandle.createWritable();
        await speechWritable.write(stringifyForSave(data));
        await speechWritable.close();
      }
    }
    
    // 保存预览图（根据实际格式保存）
    if (currentMod.previewData) {
      // 从 data URL 中提取实际的 MIME 类型
      const actualExt = getExtensionFromDataUrl(currentMod.previewData) || currentPreviewExt;
      const previewHandle = await modFolderHandle.getFileHandle(`preview.${actualExt}`, { create: true });
      const previewWritable = await previewHandle.createWritable();
      const response = await fetch(currentMod.previewData);
      const blob = await response.blob();
      await previewWritable.write(blob);
      await previewWritable.close();
      
      // 删除其他格式的预览图文件（如果存在）
      for (const ext of PREVIEW_EXTENSIONS) {
        if (ext !== actualExt) {
          try {
            await modFolderHandle.removeEntry(`preview.${ext}`);
          } catch (e) {
            // 文件不存在，忽略
          }
        }
      }
    }
    
    // 保存图标
    if (currentMod.iconData) {
      const iconHandle = await modFolderHandle.getFileHandle('icon.ico', { create: true });
      const iconWritable = await iconHandle.createWritable();
      const response = await fetch(currentMod.iconData);
      const blob = await response.blob();
      await iconWritable.write(blob);
      await iconWritable.close();
    }
    
    hasUnsavedChanges = false;
    document.getElementById('currentModName').textContent = currentMod.manifest.id;
    showToast(window.i18n.t('msg_save_success'), 'success');
    
  } catch (e) {
    console.error('Failed to save mod:', e);
    showToast(window.i18n.t('msg_save_failed', { error: e.message }), 'error');
  }
}

/**
 * 导出 Mod (生成 .tbuddy ZIP)
 */
async function exportMod() {
  if (!currentMod) return;
  
  collectManifestData();
  collectBubbleStyle();
  
  try {
    showToast(window.i18n.t('msg_exporting'), 'info');
    const jszip = new JSZip();
    const root = jszip.folder(currentMod.manifest.id);
    
    // 写入基础 JSON
    root.file('manifest.json', stringifyForSave(currentMod.manifest));
    if (currentMod.bubbleEnabled && currentMod.bubbleStyle) {
      root.file('bubble_style.json', stringifyForSave(currentMod.bubbleStyle));
    }
    
    const asset = root.folder('asset');
    asset.file('sequence.json', stringifyForSave(currentMod.assets.sequence));
    asset.file('img.json', stringifyForSave(currentMod.assets.img));
    asset.folder('sequence');
    asset.folder('img');
    
    const text = root.folder('text');
    for (const [lang, data] of Object.entries(currentMod.texts)) {
      const langDir = text.folder(lang);
      if (data.info) langDir.file('info.json', stringifyForSave(data.info));
      if (currentMod.textSpeechEnabled === true) {
        langDir.file('speech.json', stringifyForSave(data.speech));
      }
    }

    if (currentMod.audioSpeechEnabled === true) {
      const audio = root.folder('audio');
      for (const [lang, data] of Object.entries(currentMod.audio)) {
        const langDir = audio.folder(lang);
        langDir.file('speech.json', stringifyForSave(data));
        langDir.folder('speech');
      }
    }
    
    // 预览图（根据实际格式保存）
    if (currentMod.previewData) {
      const actualExt = getExtensionFromDataUrl(currentMod.previewData) || currentPreviewExt;
      const base64Data = currentMod.previewData.split(',')[1];
      root.file(`preview.${actualExt}`, base64Data, { base64: true });
    }
    
    // 图标
    if (currentMod.iconData) {
      const base64Data = currentMod.iconData.split(',')[1];
      root.file('icon.ico', base64Data, { base64: true });
    }
    
    // 生成并保存
    const content = await jszip.generateAsync({ type: 'blob' });
    const fileHandle = await window.showSaveFilePicker({
      suggestedName: `${currentMod.manifest.id}.tbuddy`,
      types: [{ description: 'TrayBuddy Mod', accept: { 'application/octet-stream': ['.tbuddy'] } }]
    });
    
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    
    showToast(window.i18n.t('msg_export_success'), 'success');
    
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.error('Failed to export:', e);
      showToast(window.i18n.t('msg_export_failed', { error: e.message }), 'error');
    }
  }
}

/**
 * 标记未保存状态
 */
function markUnsaved() {
  hasUnsavedChanges = true;
  const modName = document.getElementById('currentModName');
  if (!modName.textContent.endsWith('*')) {
    modName.textContent += ' *';
  }
}

// ============================================================================
// 表单填充与收集
// ============================================================================

/**
 * 填充气泡样式表单
 */
function populateBubbleStyle() {
  if (!currentMod) return;
  
  // 设置开关状态
  const enabled = currentMod.bubbleEnabled === true;
  document.getElementById('bubble-enable').checked = enabled;
  
  const fields = document.getElementById('bubble-style-fields');
  if (enabled) {
    fields.classList.remove('bubble-disabled');
    fields.classList.add('bubble-enabled');
  } else {
    fields.classList.remove('bubble-enabled');
    fields.classList.add('bubble-disabled');
  }
  
  if (!currentMod.bubbleStyle) return;
  const s = currentMod.bubbleStyle;
  
  // --- bubble 主体样式 ---
  document.getElementById('bubble-bg').value = s.bubble?.background || '';
  document.getElementById('bubble-border').value = s.bubble?.border || '';
  document.getElementById('bubble-radius').value = s.bubble?.border_radius || '';
  document.getElementById('bubble-padding').value = s.bubble?.padding || '';
  document.getElementById('bubble-min-width').value = s.bubble?.min_width || '';
  document.getElementById('bubble-max-width').value = s.bubble?.max_width || '';
  document.getElementById('bubble-color').value = s.bubble?.color || '#000000';
  document.getElementById('bubble-font-size').value = s.bubble?.font_size || '';
  document.getElementById('bubble-line-height').value = s.bubble?.line_height || '';
  document.getElementById('bubble-font-family').value = s.bubble?.font_family || '';
  document.getElementById('bubble-box-shadow').value = s.bubble?.box_shadow || '';
  document.getElementById('bubble-backdrop-filter').value = s.bubble?.backdrop_filter || '';
  
  // --- decoration ---
  document.getElementById('bubble-decoration-top').value = s.bubble?.decoration_top?.content || '';
  document.getElementById('bubble-decoration-bottom').value = s.bubble?.decoration_bottom?.content || '';
  
  // --- tail ---
  document.getElementById('bubble-tail-size').value = s.bubble?.tail?.size || '';
  document.getElementById('bubble-tail-color').value = s.bubble?.tail?.color || '#ffffff';
  document.getElementById('bubble-tail-shadow').value = s.bubble?.tail?.shadow || '';
  
  // --- branch.container ---
  document.getElementById('branch-container-gap').value = s.branch?.container?.gap || '';
  document.getElementById('branch-container-margin-top').value = s.branch?.container?.margin_top || '';
  document.getElementById('branch-container-padding-top').value = s.branch?.container?.padding_top || '';
  document.getElementById('branch-container-border-top').value = s.branch?.container?.border_top || '';
  
  // --- branch.button ---
  document.getElementById('branch-btn-bg').value = s.branch?.button?.background || '';
  document.getElementById('branch-btn-color').value = s.branch?.button?.color || '#000000';
  document.getElementById('branch-btn-border').value = s.branch?.button?.border || '';
  document.getElementById('branch-btn-border-radius').value = s.branch?.button?.border_radius || '';
  document.getElementById('branch-btn-padding').value = s.branch?.button?.padding || '';
  document.getElementById('branch-btn-min-width').value = s.branch?.button?.min_width || '';
  document.getElementById('branch-btn-font-size').value = s.branch?.button?.font_size || '';
  document.getElementById('branch-btn-box-shadow').value = s.branch?.button?.box_shadow || '';
  document.getElementById('branch-btn-backdrop-filter').value = s.branch?.button?.backdrop_filter || '';
  
  // --- branch.button_hover ---
  document.getElementById('branch-btn-hover-bg').value = s.branch?.button_hover?.background || '';
  document.getElementById('branch-btn-hover-color').value = s.branch?.button_hover?.color || '';
  document.getElementById('branch-btn-hover-border-color').value = s.branch?.button_hover?.border_color || '';
  document.getElementById('branch-btn-hover-box-shadow').value = s.branch?.button_hover?.box_shadow || '';
  document.getElementById('branch-btn-hover-transform').value = s.branch?.button_hover?.transform || '';
  
  // --- branch.button_active ---
  document.getElementById('branch-btn-active-bg').value = s.branch?.button_active?.background || '';
  document.getElementById('branch-btn-active-box-shadow').value = s.branch?.button_active?.box_shadow || '';
  document.getElementById('branch-btn-active-transform').value = s.branch?.button_active?.transform || '';
  
  // --- branch.decoration ---
  document.getElementById('branch-decoration-left').value = s.branch?.decoration_left?.content || '';
  document.getElementById('branch-decoration-right').value = s.branch?.decoration_right?.content || '';
  
  // 更新预览
  updateBubblePreview();
}

/**
 * 收集气泡样式表单
 * 采用合并策略，只更新有 UI 的字段，保留其他字段
 */
function collectBubbleStyle() {
  if (!currentMod) return;
  
  // 初始化基本结构（如果不存在）
  if (!currentMod.bubbleStyle) {
    currentMod.bubbleStyle = { bubble: {}, branch: {} };
  }
  const s = currentMod.bubbleStyle;
  
  // 确保嵌套对象存在
  s.bubble = s.bubble || {};
  s.bubble.tail = s.bubble.tail || {};
  s.bubble.decoration_top = s.bubble.decoration_top || {};
  s.bubble.decoration_bottom = s.bubble.decoration_bottom || {};
  s.branch = s.branch || {};
  s.branch.container = s.branch.container || {};
  s.branch.button = s.branch.button || {};
  s.branch.button_hover = s.branch.button_hover || {};
  s.branch.button_active = s.branch.button_active || {};
  s.branch.decoration_left = s.branch.decoration_left || {};
  s.branch.decoration_right = s.branch.decoration_right || {};
  
  // --- bubble 主体样式 ---
  const bubbleBg = document.getElementById('bubble-bg').value;
  if (bubbleBg) s.bubble.background = bubbleBg;
  
  const bubbleBorder = document.getElementById('bubble-border').value;
  if (bubbleBorder) s.bubble.border = bubbleBorder;
  
  const bubbleRadius = document.getElementById('bubble-radius').value;
  if (bubbleRadius) s.bubble.border_radius = bubbleRadius;
  
  const bubblePadding = document.getElementById('bubble-padding').value;
  if (bubblePadding) s.bubble.padding = bubblePadding;
  
  const bubbleMinWidth = document.getElementById('bubble-min-width').value;
  if (bubbleMinWidth) s.bubble.min_width = bubbleMinWidth;
  
  const bubbleMaxWidth = document.getElementById('bubble-max-width').value;
  if (bubbleMaxWidth) s.bubble.max_width = bubbleMaxWidth;
  
  const bubbleColor = document.getElementById('bubble-color').value;
  if (bubbleColor) s.bubble.color = bubbleColor;
  
  const bubbleFontSize = document.getElementById('bubble-font-size').value;
  if (bubbleFontSize) s.bubble.font_size = bubbleFontSize;
  
  const bubbleLineHeight = document.getElementById('bubble-line-height').value;
  if (bubbleLineHeight) s.bubble.line_height = bubbleLineHeight;
  
  const bubbleFontFamily = document.getElementById('bubble-font-family').value;
  if (bubbleFontFamily) s.bubble.font_family = bubbleFontFamily;
  
  const bubbleBoxShadow = document.getElementById('bubble-box-shadow').value;
  if (bubbleBoxShadow) s.bubble.box_shadow = bubbleBoxShadow;
  
  const bubbleBackdropFilter = document.getElementById('bubble-backdrop-filter').value;
  if (bubbleBackdropFilter) s.bubble.backdrop_filter = bubbleBackdropFilter;
  
  // --- bubble.decoration_top ---
  const decoTopContent = document.getElementById('bubble-decoration-top').value;
  if (decoTopContent) {
    s.bubble.decoration_top.content = decoTopContent;
  } else {
    delete s.bubble.decoration_top;
  }
  
  // --- bubble.decoration_bottom ---
  const decoBottomContent = document.getElementById('bubble-decoration-bottom').value;
  if (decoBottomContent) {
    s.bubble.decoration_bottom.content = decoBottomContent;
  } else {
    delete s.bubble.decoration_bottom;
  }
  
  // --- bubble.tail ---
  const tailSize = document.getElementById('bubble-tail-size').value;
  if (tailSize) s.bubble.tail.size = tailSize;
  
  const tailColor = document.getElementById('bubble-tail-color').value;
  if (tailColor) s.bubble.tail.color = tailColor;
  
  const tailShadow = document.getElementById('bubble-tail-shadow').value;
  if (tailShadow) s.bubble.tail.shadow = tailShadow;
  
  // --- branch.container ---
  const containerGap = document.getElementById('branch-container-gap').value;
  if (containerGap) s.branch.container.gap = containerGap;
  
  const containerMarginTop = document.getElementById('branch-container-margin-top').value;
  if (containerMarginTop) s.branch.container.margin_top = containerMarginTop;
  
  const containerPaddingTop = document.getElementById('branch-container-padding-top').value;
  if (containerPaddingTop) s.branch.container.padding_top = containerPaddingTop;
  
  const containerBorderTop = document.getElementById('branch-container-border-top').value;
  if (containerBorderTop) s.branch.container.border_top = containerBorderTop;
  
  // --- branch.button ---
  const btnBg = document.getElementById('branch-btn-bg').value;
  if (btnBg) s.branch.button.background = btnBg;
  
  const btnColor = document.getElementById('branch-btn-color').value;
  if (btnColor) s.branch.button.color = btnColor;
  
  const btnBorder = document.getElementById('branch-btn-border').value;
  if (btnBorder) s.branch.button.border = btnBorder;
  
  const btnBorderRadius = document.getElementById('branch-btn-border-radius').value;
  if (btnBorderRadius) s.branch.button.border_radius = btnBorderRadius;
  
  const btnPadding = document.getElementById('branch-btn-padding').value;
  if (btnPadding) s.branch.button.padding = btnPadding;
  
  const btnMinWidth = document.getElementById('branch-btn-min-width').value;
  if (btnMinWidth) s.branch.button.min_width = btnMinWidth;
  
  const btnFontSize = document.getElementById('branch-btn-font-size').value;
  if (btnFontSize) s.branch.button.font_size = btnFontSize;
  
  const btnBoxShadow = document.getElementById('branch-btn-box-shadow').value;
  if (btnBoxShadow) s.branch.button.box_shadow = btnBoxShadow;
  
  const btnBackdropFilter = document.getElementById('branch-btn-backdrop-filter').value;
  if (btnBackdropFilter) s.branch.button.backdrop_filter = btnBackdropFilter;
  
  // --- branch.button_hover ---
  const btnHoverBg = document.getElementById('branch-btn-hover-bg').value;
  if (btnHoverBg) s.branch.button_hover.background = btnHoverBg;
  
  const btnHoverColor = document.getElementById('branch-btn-hover-color').value;
  if (btnHoverColor) s.branch.button_hover.color = btnHoverColor;
  
  const btnHoverBorderColor = document.getElementById('branch-btn-hover-border-color').value;
  if (btnHoverBorderColor) s.branch.button_hover.border_color = btnHoverBorderColor;
  
  const btnHoverBoxShadow = document.getElementById('branch-btn-hover-box-shadow').value;
  if (btnHoverBoxShadow) s.branch.button_hover.box_shadow = btnHoverBoxShadow;
  
  const btnHoverTransform = document.getElementById('branch-btn-hover-transform').value;
  if (btnHoverTransform) s.branch.button_hover.transform = btnHoverTransform;
  
  // --- branch.button_active ---
  const btnActiveBg = document.getElementById('branch-btn-active-bg').value;
  if (btnActiveBg) {
    s.branch.button_active.background = btnActiveBg;
  }
  
  const btnActiveBoxShadow = document.getElementById('branch-btn-active-box-shadow').value;
  if (btnActiveBoxShadow) s.branch.button_active.box_shadow = btnActiveBoxShadow;
  
  const btnActiveTransform = document.getElementById('branch-btn-active-transform').value;
  if (btnActiveTransform) s.branch.button_active.transform = btnActiveTransform;
  
  // --- branch.decoration_left ---
  const decoLeftContent = document.getElementById('branch-decoration-left').value;
  if (decoLeftContent) {
    s.branch.decoration_left.content = decoLeftContent;
  } else {
    delete s.branch.decoration_left;
  }
  
  // --- branch.decoration_right ---
  const decoRightContent = document.getElementById('branch-decoration-right').value;
  if (decoRightContent) {
    s.branch.decoration_right.content = decoRightContent;
  } else {
    delete s.branch.decoration_right;
  }
  
  // 清理空对象
  if (Object.keys(s.branch.button_active).length === 0) delete s.branch.button_active;
}

/**
 * 填充 Manifest 表单

 */
function populateManifestForm() {
  const m = currentMod.manifest;
  
  document.getElementById('mod-id').value = m.id || '';
  document.getElementById('mod-version').value = m.version || '1.0.0';
  document.getElementById('mod-author').value = m.author || '';
  document.getElementById('default-audio-lang').value = m.default_audio_lang_id || '';
  document.getElementById('default-text-lang').value = m.default_text_lang_id || '';
  document.getElementById('character-z-offset').value = m.character?.z_offset || 1;
  document.getElementById('border-enable').checked = m.border?.enable || false;
  document.getElementById('border-z-offset').value = m.border?.z_offset || 2;

  // 数据面板
  document.getElementById('show-mod-data-panel').checked = m.show_mod_data_panel === true;
  document.getElementById('mod-data-default-int').value = Number.isFinite(Number(m.mod_data_default_int)) ? Number(m.mod_data_default_int) : 0;
  
  // 更新动画下拉列表
  updateAnimaSelects();
  document.getElementById('border-anima').value = m.border?.anima || '';
  
  // 显示预览图
  if (currentMod.previewData) {
    document.getElementById('preview-image').innerHTML = `<img src="${currentMod.previewData}" alt="Preview">`;
  } else {
    document.getElementById('preview-image').innerHTML = `<span class="preview-placeholder">${window.i18n.t('preview_placeholder')}</span>`;
  }
  
  // 显示图标
  if (currentMod.iconData) {
    document.getElementById('icon-image').innerHTML = `<img src="${currentMod.iconData}" alt="Icon">`;
  } else {
    document.getElementById('icon-image').innerHTML = `<span class="preview-placeholder">${window.i18n.t('icon_placeholder')}</span>`;
  }
  
  // 添加表单变化监听
  addFormListeners();
}

/**
 * 添加表单变化监听
 */
function addFormListeners() {
  const inputs = document.querySelectorAll('#tab-manifest input, #tab-manifest select');
  inputs.forEach(input => {
    input.addEventListener('change', markUnsaved);
  });
}

/**
 * 收集 Manifest 表单数据
 */
function collectManifestData() {
  const m = currentMod.manifest;
  
  m.id = document.getElementById('mod-id').value.trim();
  m.version = document.getElementById('mod-version').value.trim();
  m.author = document.getElementById('mod-author').value.trim();
  m.default_audio_lang_id = document.getElementById('default-audio-lang').value.trim();
  m.default_text_lang_id = document.getElementById('default-text-lang').value.trim();
  m.character = {
    z_offset: parseInt(document.getElementById('character-z-offset').value) || 1
  };
  m.border = {
    anima: document.getElementById('border-anima').value,
    enable: document.getElementById('border-enable').checked,
    z_offset: parseInt(document.getElementById('border-z-offset').value) || 2
  };

  // 数据面板
  m.show_mod_data_panel = document.getElementById('show-mod-data-panel').checked;
  m.mod_data_default_int = parseInt(document.getElementById('mod-data-default-int').value) || 0;
}

/**
 * 更新动画下拉列表
 */
function updateAnimaSelects() {
  const allAnimas = [
    ...currentMod.assets.sequence.map(a => a.name),
    ...currentMod.assets.img.map(a => a.name)
  ];
  
  const selects = ['border-anima', 'state-anima'];
  selects.forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    
    const currentValue = select.value;
    select.innerHTML = `<option value="">${window.i18n.t('select_anima_placeholder')}</option>`;
    allAnimas.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
    select.value = currentValue;
  });
}

/**
 * 获取所有音频名称
 */
function getAllAudioNames() {
  const audioNames = new Set();
  for (const [lang, audios] of Object.entries(currentMod.audio || {})) {
    if (Array.isArray(audios)) {
      audios.forEach(a => {
        if (a && a.name) audioNames.add(a.name);
      });
    }
  }
  return Array.from(audioNames);
}

/**
 * 获取所有文本名称
 */
function getAllTextNames() {
  const textNames = new Set();
  for (const [lang, data] of Object.entries(currentMod.texts || {})) {
    if (data && Array.isArray(data.speech)) {
      data.speech.forEach(s => {
        if (s && s.name) textNames.add(s.name);
      });
    }
  }
  return Array.from(textNames);
}

/**
 * 获取所有状态名称
 */
function getAllStateNames() {
  const stateNames = new Set();
  
  // 普通状态
  if (Array.isArray(currentMod.manifest.states)) {
    currentMod.manifest.states.forEach(s => {
      if (s && s.name) stateNames.add(s.name);
    });
  }
  
  // 重要状态
  const importantStates = currentMod.manifest.important_states || {};
  for (const [key, state] of Object.entries(importantStates)) {
    if (state && state.name) stateNames.add(state.name);
  }
  
  return Array.from(stateNames);
}

/**
 * 更新音频下拉列表
 */
function updateAudioSelect(selectElement, currentValue = '') {
  if (!selectElement) return;
  
  const audioNames = getAllAudioNames();
  selectElement.innerHTML = `<option value="">${window.i18n.t('select_audio_placeholder')}</option>`;
  audioNames.forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    selectElement.appendChild(option);
  });
  selectElement.value = currentValue;
}

/**
 * 更新文本下拉列表
 */
function updateTextSelect(selectElement, currentValue = '') {
  if (!selectElement) return;
  
  const textNames = getAllTextNames();
  selectElement.innerHTML = `<option value="">${window.i18n.t('select_text_placeholder')}</option>`;
  textNames.forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    selectElement.appendChild(option);
  });
  selectElement.value = currentValue;
}

/**
 * 更新状态下拉列表
 */
function updateStateSelect(selectElement, currentValue = '', excludeState = '') {
  if (!selectElement) return;
  
  const stateNames = getAllStateNames().filter(n => n !== excludeState);
  selectElement.innerHTML = `<option value="">${window.i18n.t('select_state_placeholder')}</option>`;
  stateNames.forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    selectElement.appendChild(option);
  });
  selectElement.value = currentValue;
}

/**
 * 生成音频下拉选项HTML
 */
function getAudioSelectOptions(currentValue = '') {
  const audioNames = getAllAudioNames();
  let html = `<option value="">${window.i18n.t('select_audio_placeholder')}</option>`;
  audioNames.forEach(name => {
    const selected = name === currentValue ? ' selected' : '';
    html += `<option value="${name}"${selected}>${name}</option>`;
  });
  return html;
}

/**
 * 生成文本下拉选项HTML
 */
function getTextSelectOptions(currentValue = '') {
  const textNames = getAllTextNames();
  let html = `<option value="">${window.i18n.t('select_text_placeholder')}</option>`;
  textNames.forEach(name => {
    const selected = name === currentValue ? ' selected' : '';
    html += `<option value="${name}"${selected}>${name}</option>`;
  });
  return html;
}

/**
 * 生成状态下拉选项HTML
 */
function getStateSelectOptions(currentValue = '', excludeState = '') {
  const stateNames = getAllStateNames().filter(n => n !== excludeState);
  let html = `<option value="">${window.i18n.t('select_state_placeholder')}</option>`;
  stateNames.forEach(name => {
    const selected = name === currentValue ? ' selected' : '';
    html += `<option value="${name}"${selected}>${name}</option>`;
  });
  return html;
}

// ============================================================================
// 状态管理
// ============================================================================

/**
 * 渲染状态列表
 */
function renderStates() {
  if (!currentMod) return;

  // 渲染核心状态列表
  renderCoreStates();

  // 渲染重要状态列表
  renderImportantStates();

  // 渲染普通状态列表（卡片网格）
  const stateList = document.getElementById('state-list');
  stateList.innerHTML = '';

  const filters = {
    name: (document.getElementById('states-normal-filter-name')?.value || '').trim(),
    anima: (document.getElementById('states-normal-filter-anima')?.value || '').trim(),
    audio: (document.getElementById('states-normal-filter-audio')?.value || '').trim(),
    text: (document.getElementById('states-normal-filter-text')?.value || '').trim()
  };

  const nameNeedle = filters.name.toLowerCase();
  const animaNeedle = filters.anima.toLowerCase();
  const audioNeedle = filters.audio.toLowerCase();
  const textNeedle = filters.text.toLowerCase();

  currentMod.manifest.states.forEach((state, index) => {
    const stateName = String(state?.name || '');
    const stateAnima = String(state?.anima || '');
    const stateAudio = String(state?.audio || '');
    const stateText = String(state?.text || '');

    const matchName = !nameNeedle || stateName.toLowerCase().includes(nameNeedle);
    const matchAnima = !animaNeedle || stateAnima.toLowerCase().includes(animaNeedle);
    const matchAudio = !audioNeedle || stateAudio.toLowerCase().includes(audioNeedle);
    const matchText = !textNeedle || stateText.toLowerCase().includes(textNeedle);
    if (!matchName || !matchAnima || !matchAudio || !matchText) return;

    const card = document.createElement('div');
    card.className = 'state-card';
    card.innerHTML = renderNormalStateCard(state, index, filters);
    stateList.appendChild(card);
  });

  // 底部添加按钮
  const footer = document.createElement('div');
  footer.className = 'section-footer';
  footer.innerHTML = `
    <button class="btn btn-sm btn-ghost" onclick="pasteStateFromClipboard()">📋 <span data-i18n="btn_paste_from_clipboard">${window.i18n.t('btn_paste_from_clipboard')}</span></button>
    <button class="btn btn-sm btn-primary" onclick="addState()">➕ <span data-i18n="btn_add_state">${window.i18n.t('btn_add_state')}</span></button>
  `;
  stateList.appendChild(footer);
}

/**
 * 渲染核心状态列表（idle / music）
 */
function renderCoreStates() {
  const container = document.getElementById('core-states-list');
  if (!container) return;
  container.innerHTML = '';

  const coreKeys = ['idle', 'music'];
  const importantStates = currentMod.manifest.important_states || {};

  coreKeys.forEach(key => {
    const state = importantStates[key];
    if (!state) return;

    const card = document.createElement('div');
    card.className = 'state-card';
    card.innerHTML = renderImportantStateCard(state, key, {});
    container.appendChild(card);
  });
}

/**
 * 渲染重要状态列表
 */
function renderImportantStates() {
  const container = document.getElementById('important-states-list');
  container.innerHTML = '';


  const filters = {
    name: (document.getElementById('states-important-filter-name')?.value || '').trim(),
    anima: (document.getElementById('states-important-filter-anima')?.value || '').trim(),
    audio: (document.getElementById('states-important-filter-audio')?.value || '').trim(),
    text: (document.getElementById('states-important-filter-text')?.value || '').trim()
  };

  const nameNeedle = filters.name.toLowerCase();
  const animaNeedle = filters.anima.toLowerCase();
  const audioNeedle = filters.audio.toLowerCase();
  const textNeedle = filters.text.toLowerCase();

  const importantStates = currentMod.manifest.important_states || {};
  const coreKeys = ['idle', 'music'];
  const stateOrder = ['silence', 'silence_start', 'silence_end', 'music_start', 'music_end', 'birthday', 'firstday'];

  const shouldRender = (key, state) => {
    const displayName = String(state?.name || key);
    const stateAnima = String(state?.anima || '');
    const stateAudio = String(state?.audio || '');
    const stateText = String(state?.text || '');

    const matchName = !nameNeedle || displayName.toLowerCase().includes(nameNeedle);
    const matchAnima = !animaNeedle || stateAnima.toLowerCase().includes(animaNeedle);
    const matchAudio = !audioNeedle || stateAudio.toLowerCase().includes(audioNeedle);
    const matchText = !textNeedle || stateText.toLowerCase().includes(textNeedle);
    return matchName && matchAnima && matchAudio && matchText;
  };

  stateOrder.forEach(key => {
    const state = importantStates[key];
    if (!state) return;
    if (!shouldRender(key, state)) return;

    const card = document.createElement('div');
    card.className = 'state-card';
    card.innerHTML = renderImportantStateCard(state, key, filters);
    container.appendChild(card);
  });

  // 添加其他自定义重要状态
  Object.keys(importantStates).forEach(key => {
    if (stateOrder.includes(key)) return;
    if (coreKeys.includes(key)) return;
    const state = importantStates[key];
    if (!shouldRender(key, state)) return;


    const card = document.createElement('div');
    card.className = 'state-card';
    card.innerHTML = renderImportantStateCard(state, key, filters);
    container.appendChild(card);
  });
}

/**
 * 渲染重要状态卡片 HTML
 */
function renderImportantStateCard(state, key, filters = {}) {
  const canTriggerCount = (state.can_trigger_states || []).length;
  const branchCount = (state.branch || []).length;

  const nameNeedle = String(filters.name || '');
  const animaNeedle = String(filters.anima || '');
  const audioNeedle = String(filters.audio || '');
  const textNeedle = String(filters.text || '');

  const displayName = String(state?.name || key);
  const animaValue = state?.anima ? String(state.anima) : '-';
  const audioValue = state?.audio ? String(state.audio) : '-';
  const textValue = state?.text ? String(state.text) : '-';

  return `
    <div class="state-card-header">
      <span class="state-card-title">${highlightNeedleHtml(displayName, nameNeedle)}</span>
      <div class="state-card-actions">
        <button class="btn btn-sm btn-ghost" onclick="copyImportantStateToClipboard('${key}')" title="${window.i18n.t('btn_copy_to_clipboard')}">📋</button>
        <button class="btn btn-sm btn-ghost" onclick="pasteImportantStateFromClipboard('${key}')" title="${window.i18n.t('btn_paste_from_clipboard')}">📥</button>
        <button class="btn btn-sm btn-ghost" onclick="editImportantState('${key}')">✏️ <span data-i18n="btn_edit">${window.i18n.t('btn_edit')}</span></button>
      </div>
    </div>
    <div class="state-card-body">
      <div class="state-card-field">
        <span class="label">${window.i18n.t('persistent_label')}: </span>
        <span class="value">${state.persistent ? window.i18n.t('yes') : window.i18n.t('no')}</span>
      </div>
      <div class="state-card-field">
        <span class="label">${window.i18n.t('priority_label')}: </span>
        <span class="value">${escapeHtml(state.priority)}</span>
      </div>
      <div class="state-card-field">
        <span class="label">${window.i18n.t('anima_label')}: </span>
        <span class="value">${highlightNeedleHtml(animaValue, animaNeedle)}</span>
      </div>
      <div class="state-card-field">
        <span class="label">${window.i18n.t('audio_label')}: </span>
        <span class="value">${highlightNeedleHtml(audioValue, audioNeedle)}</span>
      </div>
      <div class="state-card-field">
        <span class="label">${window.i18n.t('text_label')}: </span>
        <span class="value">${highlightNeedleHtml(textValue, textNeedle)}</span>
      </div>
      <div class="state-card-field">
        <span class="label">${window.i18n.t('next_state_label')}: </span>
        <span class="value">${escapeHtml(state.next_state || '-')}</span>
      </div>
      ${canTriggerCount > 0 ? `<div class="state-card-field">
        <span class="label">${window.i18n.t('can_trigger_states_label')}: </span>
        <span class="value">${escapeHtml(`${canTriggerCount} ${window.i18n.t('count_unit')}`)}</span>
      </div>` : ''}
      ${branchCount > 0 ? `<div class="state-card-field">
        <span class="label">${window.i18n.t('section_branches')}: </span>
        <span class="value">${escapeHtml(`${branchCount} ${window.i18n.t('count_unit')}`)}</span>
      </div>` : ''}
    </div>
  `;
}

/**
 * 渲染普通状态卡片 HTML
 */
function renderNormalStateCard(state, index, filters = {}) {
  const canTriggerCount = (state.can_trigger_states || []).length;
  const branchCount = (state.branch || []).length;

  const nameNeedle = String(filters.name || '');
  const animaNeedle = String(filters.anima || '');
  const audioNeedle = String(filters.audio || '');
  const textNeedle = String(filters.text || '');

  const displayName = String(state?.name || '');
  const animaValue = state?.anima ? String(state.anima) : '-';
  const audioValue = state?.audio ? String(state.audio) : '-';
  const textValue = state?.text ? String(state.text) : '-';

  return `
    <div class="state-card-header">
      <span class="state-card-title">${highlightNeedleHtml(displayName, nameNeedle)}</span>
      <div class="state-card-actions">
        <button class="btn btn-sm btn-ghost" onclick="copyStateToClipboard(${index})" title="${window.i18n.t('btn_copy_to_clipboard')}">📋</button>
        <button class="btn btn-sm btn-ghost" onclick="editState(${index})">✏️ <span data-i18n="btn_edit">${window.i18n.t('btn_edit')}</span></button>
        <button class="btn btn-sm btn-ghost" onclick="deleteState(${index})">🗑️ <span data-i18n="btn_delete">${window.i18n.t('btn_delete')}</span></button>
      </div>
    </div>
    <div class="state-card-body">
      <div class="state-card-field">
        <span class="label">${window.i18n.t('persistent_label')}: </span>
        <span class="value">${state.persistent ? window.i18n.t('yes') : window.i18n.t('no')}</span>
      </div>
      <div class="state-card-field">
        <span class="label">${window.i18n.t('priority_label')}: </span>
        <span class="value">${escapeHtml(Number.isFinite(state.priority) ? state.priority : 2)}</span>
      </div>
      <div class="state-card-field">
        <span class="label">${window.i18n.t('anima_label')}: </span>
        <span class="value">${highlightNeedleHtml(animaValue, animaNeedle)}</span>
      </div>
      <div class="state-card-field">
        <span class="label">${window.i18n.t('audio_label')}: </span>
        <span class="value">${highlightNeedleHtml(audioValue, audioNeedle)}</span>
      </div>
      <div class="state-card-field">
        <span class="label">${window.i18n.t('text_label')}: </span>
        <span class="value">${highlightNeedleHtml(textValue, textNeedle)}</span>
      </div>
      <div class="state-card-field">
        <span class="label">${window.i18n.t('next_state_label')}: </span>
        <span class="value">${escapeHtml(state.next_state || '-')}</span>
      </div>
      ${canTriggerCount > 0 ? `<div class="state-card-field">
        <span class="label">${window.i18n.t('can_trigger_states_label')}: </span>
        <span class="value">${escapeHtml(`${canTriggerCount} ${window.i18n.t('count_unit')}`)}</span>
      </div>` : ''}
      ${branchCount > 0 ? `<div class="state-card-field">
        <span class="label">${window.i18n.t('section_branches')}: </span>
        <span class="value">${escapeHtml(`${branchCount} ${window.i18n.t('count_unit')}`)}</span>
      </div>` : ''}
    </div>
  `;
}

/**
 * 渲染状态卡片 HTML（旧版兼容）
 */
function renderStateCard(state, index) {
  return renderNormalStateCard(state, index);
}

/**
 * 添加新状态
 */
function addState() {
  editingStateIndex = -2; // -2 表示新建状态
  editingImportantStateKey = null;
  openStateModal(window.i18n.t('modal_add_state'), createDefaultState('new_state'));
}

/**
 * 编辑状态
 */
function editState(index) {
  editingStateIndex = index;
  editingImportantStateKey = null;
  const state = currentMod.manifest.states[index];
  openStateModal(window.i18n.t('modal_edit_state'), state);
}

/**
 * 编辑重要状态
 */
function editImportantState(key) {
  editingStateIndex = -1;
  editingImportantStateKey = key;
  const state = currentMod.manifest.important_states[key];
  openStateModal(window.i18n.t('modal_edit_state') + ` (${key})`, state);
}

/**
 * 打开状态编辑弹窗
 */
function openStateModal(title, state) {
  document.getElementById('state-modal-title').textContent = title;

  // 默认折叠各折叠签
  ['state-limits-options', 'state-can-trigger-options', 'state-data-counter-options', 'state-branch-options'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.tagName === 'DETAILS') {
      el.open = false;
    }
  });
  
  document.getElementById('state-name').value = state.name || '';
  document.getElementById('state-persistent').checked = state.persistent || false;
  document.getElementById('state-priority').value = state.priority || 2;

  
  // 设置日期选择器
  setDatePicker('state-date-start', state.date_start || '');
  setDatePicker('state-date-end', state.date_end || '');
  
  // 设置时间选择器
  document.getElementById('state-time-start').value = state.time_start || '';
  document.getElementById('state-time-end').value = state.time_end || '';
  
  document.getElementById('state-trigger-time').value = state.trigger_time || 0;

  // UI 使用百分比(0-100)，底层仍存 0-1
  const rawRate01 = Number(state.trigger_rate);
  const rate01 = Number.isFinite(rawRate01) ? rawRate01 : 0;
  document.getElementById('state-trigger-rate').value = String(rate01 * 100);

  document.getElementById('state-branch-show-bubble').checked = state.branch_show_bubble !== false;
  
  // 更新动画下拉列表
  updateAnimaSelects();
  document.getElementById('state-anima').value = state.anima || '';
  
  // 更新音频下拉列表
  updateAudioSelect(document.getElementById('state-audio'), state.audio || '');
  
  // 更新文本下拉列表
  updateTextSelect(document.getElementById('state-text'), state.text || '');
  
  // 更新下一状态下拉列表（排除当前状态自身）
  updateStateSelect(document.getElementById('state-next-state'), state.next_state || '', state.name || '');
  
  // 渲染可触发子状态
  renderCanTriggerStates(state.can_trigger_states || []);
  
  // 填充计数器
  const counter = state.mod_data_counter;
  if (counter && typeof counter === 'object' && counter.op) {
    document.getElementById('state-counter-op').value = counter.op;
    document.getElementById('state-counter-value').value = counter.value || 0;
  } else {
    document.getElementById('state-counter-op').value = '';
    document.getElementById('state-counter-value').value = 0;
  }
  
  // 渲染分支
  renderBranches(state.branch || []);
  
  document.getElementById('state-modal').classList.add('show');
}

/**
 * 获取指定月份的天数
 */
function getDaysInMonth(month) {
  const daysMap = {
    '01': 31, '02': 29, '03': 31, '04': 30,
    '05': 31, '06': 30, '07': 31, '08': 31,
    '09': 30, '10': 31, '11': 30, '12': 31
  };
  return daysMap[month] || 31;
}

/**
 * 更新日期选择器的日选项
 */
function updateDayOptions(monthSelectId, daySelectId) {
  const monthSelect = document.getElementById(monthSelectId);
  const daySelect = document.getElementById(daySelectId);
  if (!monthSelect || !daySelect) return;
  
  const month = monthSelect.value;
  const currentDay = daySelect.value;
  const days = month ? getDaysInMonth(month) : 31;
  
  // 保存当前选中的日
  daySelect.innerHTML = '<option value="">--</option>';
  for (let i = 1; i <= days; i++) {
    const val = i.toString().padStart(2, '0');
    const option = document.createElement('option');
    option.value = val;
    option.textContent = val;
    daySelect.appendChild(option);
  }
  
  // 恢复之前的选择（如果仍有效）
  if (currentDay && parseInt(currentDay) <= days) {
    daySelect.value = currentDay;
  }
}

/**
 * 设置日期选择器的值
 */
function setDatePicker(baseName, value) {
  const monthSelect = document.getElementById(baseName + '-month');
  const daySelect = document.getElementById(baseName + '-day');
  if (!monthSelect || !daySelect) return;
  
  if (value && value.includes('-')) {
    const [month, day] = value.split('-');
    monthSelect.value = month;
    updateDayOptions(baseName + '-month', baseName + '-day');
    daySelect.value = day;
  } else {
    monthSelect.value = '';
    updateDayOptions(baseName + '-month', baseName + '-day');
    daySelect.value = '';
  }
}

/**
 * 获取日期选择器的值
 */
function getDatePickerValue(baseName) {
  const monthSelect = document.getElementById(baseName + '-month');
  const daySelect = document.getElementById(baseName + '-day');
  if (!monthSelect || !daySelect) return '';
  
  const month = monthSelect.value;
  const day = daySelect.value;
  
  if (month && day) {
    return `${month}-${day}`;
  }
  return '';
}

/**
 * 渲染可触发子状态列表
 */
function renderCanTriggerStates(canTriggerStates) {
  const list = document.getElementById('can-trigger-list');
  list.innerHTML = '';
  
  canTriggerStates.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'can-trigger-item';
    
    // 兼容旧格式（字符串）和新格式（对象 { state, weight }）
    let stateName = '';
    let weight = 1;
    if (typeof item === 'string') {
      stateName = item;
    } else if (item && typeof item === 'object') {
      stateName = item.state || '';
      weight = Number.isFinite(item.weight) ? item.weight : 1;
    }
    
    div.innerHTML = `
      <select data-can-trigger-state="${index}">${getStateSelectOptions(stateName)}</select>
      <input type="number" placeholder="${window.i18n.t('weight_label')}" value="${weight}" min="1" data-can-trigger-weight="${index}" style="width: 80px;">
      <button class="btn btn-sm btn-ghost" onclick="removeCanTriggerState(${index})">🗑️</button>
    `;
    list.appendChild(div);
  });
}

/**
 * 添加可触发子状态
 */
function addCanTriggerState() {
  const list = document.getElementById('can-trigger-list');
  const index = list.children.length;
  
  const div = document.createElement('div');
  div.className = 'can-trigger-item';
  div.innerHTML = `
    <select data-can-trigger-state="${index}">${getStateSelectOptions()}</select>
    <input type="number" placeholder="${window.i18n.t('weight_label')}" value="1" min="1" data-can-trigger-weight="${index}" style="width: 80px;">
    <button class="btn btn-sm btn-ghost" onclick="removeCanTriggerState(${index})">🗑️</button>
  `;
  list.appendChild(div);
}

/**
 * 移除可触发子状态
 */
function removeCanTriggerState(index) {
  const list = document.getElementById('can-trigger-list');
  list.children[index]?.remove();
  
  // 重新索引
  Array.from(list.children).forEach((item, i) => {
    item.querySelector('[data-can-trigger-state]').dataset.canTriggerState = i;
    item.querySelector('[data-can-trigger-weight]').dataset.canTriggerWeight = i;
    item.querySelector('button').onclick = () => removeCanTriggerState(i);
  });
}


/**
 * 收集可触发子状态数据
 */
function collectCanTriggerStates() {
  const states = [];
  const list = document.getElementById('can-trigger-list');
  
  Array.from(list.children).forEach(item => {
    const state = item.querySelector('[data-can-trigger-state]').value.trim();
    const weight = parseInt(item.querySelector('[data-can-trigger-weight]').value) || 1;
    if (state) {
      states.push({ state, weight });
    }
  });
  
  return states;
}

/**
 * 收集计数器数据
 */
function collectDataCounter() {
  const op = document.getElementById('state-counter-op').value;
  const value = parseInt(document.getElementById('state-counter-value').value) || 0;
  
  if (!op) {
    return null; // 无操作
  }
  
  return { op, value };
}

/**
 * 关闭状态编辑弹窗
 */
function closeStateModal() {
  document.getElementById('state-modal').classList.remove('show');
}

/**
 * 保存状态
 */
function saveState() {
  const state = {
    name: document.getElementById('state-name').value.trim(),
    persistent: document.getElementById('state-persistent').checked,
    anima: document.getElementById('state-anima').value,
    audio: document.getElementById('state-audio').value.trim(),
    text: document.getElementById('state-text').value.trim(),
    priority: parseInt(document.getElementById('state-priority').value) || 2,
    date_start: getDatePickerValue('state-date-start'),
    date_end: getDatePickerValue('state-date-end'),
    time_start: document.getElementById('state-time-start').value.trim(),
    time_end: document.getElementById('state-time-end').value.trim(),
    next_state: document.getElementById('state-next-state').value.trim(),
    can_trigger_states: collectCanTriggerStates(),
    trigger_time: parseInt(document.getElementById('state-trigger-time').value) || 0,

    // UI 输入为百分比(0-100)，保存为 0-1
    trigger_rate: (() => {
      const percent = parseFloat(document.getElementById('state-trigger-rate').value);
      const p = Number.isFinite(percent) ? percent : 0;
      const r = p / 100;
      return Math.max(0, Math.min(1, r));
    })(),

    branch_show_bubble: document.getElementById('state-branch-show-bubble').checked,
    mod_data_counter: collectDataCounter(),
    branch: collectBranches()
  };
  
  if (!state.name) {
    showToast(window.i18n.t('msg_enter_state_name'), 'warning');
    return;
  }
  
  if (editingStateIndex === -2) {
    // 新建状态
    currentMod.manifest.states.push(state);
  } else if (editingStateIndex === -1 && editingImportantStateKey) {
    // 编辑重要状态
    currentMod.manifest.important_states[editingImportantStateKey] = state;
  } else if (editingStateIndex >= 0) {
    // 编辑普通状态
    currentMod.manifest.states[editingStateIndex] = state;
  }
  
  closeStateModal();
  renderStates();
  markUnsaved();
  showToast(window.i18n.t('msg_state_saved'), 'success');
}

/**
 * 删除状态
 */
function deleteState(index) {
  if (confirm(window.i18n.t('msg_confirm_delete_state'))) {
    currentMod.manifest.states.splice(index, 1);
    renderStates();
    markUnsaved();
    showToast(window.i18n.t('msg_state_deleted'), 'success');
  }
}

/**
 * 渲染分支列表
 */
function renderBranches(branches) {
  const branchList = document.getElementById('branch-list');
  branchList.innerHTML = '';
  
  branches.forEach((branch, index) => {
    const item = document.createElement('div');
    item.className = 'branch-item';
    item.innerHTML = `
      <select data-branch-text="${index}">${getTextSelectOptions(branch.text || '')}</select>
      <select data-branch-state="${index}">${getStateSelectOptions(branch.next_state || '')}</select>
      <button class="btn btn-sm btn-ghost" onclick="removeBranch(${index})">🗑️</button>
    `;
    branchList.appendChild(item);
  });
}

/**
 * 添加分支
 */
function addBranch() {
  const branchList = document.getElementById('branch-list');
  const index = branchList.children.length;
  
  const item = document.createElement('div');
  item.className = 'branch-item';
  item.innerHTML = `
    <select data-branch-text="${index}">${getTextSelectOptions()}</select>
    <select data-branch-state="${index}">${getStateSelectOptions()}</select>
    <button class="btn btn-sm btn-ghost" onclick="removeBranch(${index})">🗑️</button>
  `;
  branchList.appendChild(item);
}

/**
 * 移除分支
 */
function removeBranch(index) {
  const branchList = document.getElementById('branch-list');
  branchList.children[index]?.remove();
  
  // 重新索引
  Array.from(branchList.children).forEach((item, i) => {
    item.querySelector('[data-branch-text]').dataset.branchText = i;
    item.querySelector('[data-branch-state]').dataset.branchState = i;
    item.querySelector('button').onclick = () => removeBranch(i);
  });
}

/**
 * 收集分支数据
 */
function collectBranches() {
  const branches = [];
  const branchList = document.getElementById('branch-list');
  
  Array.from(branchList.children).forEach(item => {
    const text = item.querySelector('[data-branch-text]').value.trim();
    const nextState = item.querySelector('[data-branch-state]').value.trim();
    if (text || nextState) {
      branches.push({ text, next_state: nextState });
    }
  });
  
  return branches;
}

// ============================================================================
// 触发器管理
// ============================================================================

/**
 * 渲染触发器列表
 */
function renderTriggers() {
  if (!currentMod) return;

  const triggerList = document.getElementById('trigger-list');
  triggerList.innerHTML = '';

  const triggerNameNeedle = (document.getElementById('triggers-filter-name')?.value || '').trim().toLowerCase();

  currentMod.manifest.triggers.forEach((trigger, index) => {
    const eventName = String(trigger?.event || '');
    const matchName = !triggerNameNeedle || eventName.toLowerCase().includes(triggerNameNeedle);
    if (!matchName) return;

    const card = document.createElement('div');
    card.className = 'state-card trigger-card';
    card.innerHTML = renderTriggerCard(trigger, index);
    triggerList.appendChild(card);
  });

  // 底部添加按钮
  const footer = document.createElement('div');
  footer.className = 'section-footer';
  footer.innerHTML = `
    <button class="btn btn-sm btn-ghost" onclick="pasteTriggerFromClipboard()">📋 <span data-i18n="btn_paste_from_clipboard">${window.i18n.t('btn_paste_from_clipboard')}</span></button>
    <button class="btn btn-sm btn-primary" onclick="addTrigger()">➕ <span data-i18n="btn_add_trigger">${window.i18n.t('btn_add_trigger')}</span></button>
  `;
  triggerList.appendChild(footer);
}

/**
 * 渲染触发器卡片 HTML
 */
function renderTriggerCard(trigger, index) {
  const statesSummary = renderTriggerStatesSummary(trigger.can_trigger_states || []);
  const nameNeedle = (document.getElementById('triggers-filter-name')?.value || '').trim();
  const eventName = String(trigger?.event || '');

  return `
    <div class="state-card-header">
      <span class="state-card-title"><code class="trigger-event-code">${highlightNeedleHtml(eventName, nameNeedle)}</code></span>
      <div class="state-card-actions">
        <button class="btn btn-sm btn-ghost" onclick="copyTriggerToClipboard(${index})" title="${window.i18n.t('btn_copy_to_clipboard')}">📋</button>
        <button class="btn btn-sm btn-ghost" onclick="editTriggerFull(${index})">✏️ <span data-i18n="btn_edit">${window.i18n.t('btn_edit')}</span></button>
        <button class="btn btn-sm btn-ghost" onclick="deleteTrigger(${index})">🗑️ <span data-i18n="btn_delete">${window.i18n.t('btn_delete')}</span></button>
      </div>
    </div>
    <div class="state-card-body">
      <div class="state-card-field full-width">
        <span class="label">${window.i18n.t('can_trigger_states_label')}: </span>
        <div class="trigger-states">${statesSummary}</div>
      </div>
    </div>
  `;
}

/**
 * 渲染触发状态摘要
 */
function renderTriggerStatesSummary(canTriggerStates) {
  if (!canTriggerStates || canTriggerStates.length === 0) {
    return `<span class="trigger-state-tag">${window.i18n.t('no_trigger_states')}</span>`;
  }

  const normalizeGroup = (g) => {
    if (typeof g === 'string') {
      return { persistent_state: '', states: [{ state: g, weight: 1 }] };
    }
    if (g && typeof g === 'object') {
      const persistent_state = typeof g.persistent_state === 'string' ? g.persistent_state : '';
      const rawStates = Array.isArray(g.states) ? g.states : [];
      const states = rawStates
        .map(x => {
          if (typeof x === 'string') return { state: x, weight: 1 };
          if (x && typeof x === 'object' && typeof x.state === 'string') {
            const w = Number.isFinite(x.weight) ? x.weight : 1;
            return { state: x.state, weight: w };
          }
          return null;
        })
        .filter(Boolean);

      return { persistent_state, states };
    }
    return { persistent_state: '', states: [] };
  };

  const groups = canTriggerStates.map(normalizeGroup);

  return groups.map(g => {
    const title = g.persistent_state
      ? `<div class="trigger-state-group-title">${escapeHtml(window.i18n.t('persistent_state_label'))}: <code>${escapeHtml(g.persistent_state)}</code></div>`
      : '';

    const chips = (g.states.length ? g.states : [{ state: '-', weight: 1 }]).map(s => {
      const name = escapeHtml(s.state);
      const weight = Number.isFinite(s.weight) ? s.weight : 1;
      return `
        <span class="trigger-state-chip">
          <span class="trigger-state-name">${name}</span>
          <span class="trigger-state-weight">×${escapeHtml(weight)}</span>
        </span>
      `;
    }).join('');

    return `
      <div class="trigger-state-group">
        ${title}
        <div class="trigger-state-chips">${chips}</div>
      </div>
    `;
  }).join('');
}

/**
 * 添加触发器
 */
function addTrigger() {
  editingTriggerIndex = -1;
  openTriggerModal(window.i18n.t('modal_add_trigger') || '添加触发器', {
    event: '',
    can_trigger_states: []
  });
}

/**
 * 完整编辑触发器
 */
function editTriggerFull(index) {
  editingTriggerIndex = index;
  const trigger = currentMod.manifest.triggers[index];
  openTriggerModal(window.i18n.t('modal_edit_trigger') || '编辑触发器', trigger);
}

/**
 * 打开触发器编辑弹窗
 */
function openTriggerModal(title, trigger) {
  document.getElementById('trigger-modal-title').textContent = title;
  document.getElementById('trigger-event').value = trigger.event || '';
  
  // 渲染触发状态组
  renderTriggerGroups(trigger.can_trigger_states || []);
  
  document.getElementById('trigger-modal').classList.add('show');
}

/**
 * 关闭触发器编辑弹窗
 */
function closeTriggerModal() {
  document.getElementById('trigger-modal').classList.remove('show');
}

/**
 * 渲染触发状态组
 */
function renderTriggerGroups(canTriggerStates) {
  const list = document.getElementById('trigger-groups-list');
  list.innerHTML = '';
  
  canTriggerStates.forEach((group, groupIndex) => {
    const div = document.createElement('div');
    div.className = 'trigger-group-item';
    
    // 兼容简单格式（字符串）和复杂格式（对象）
    let persistentState = '';
    let states = [];
    
    if (typeof group === 'string') {
      states = [{ state: group, weight: 1 }];
    } else if (group && typeof group === 'object') {
      persistentState = group.persistent_state || '';
      states = Array.isArray(group.states) ? group.states : [];
    }
    
    const statesHtml = states.map((s, stateIndex) => {
      const stateName = typeof s === 'string' ? s : (s.state || '');
      const weight = (s && typeof s === 'object' && Number.isFinite(s.weight)) ? s.weight : 1;
      return `
        <div class="trigger-state-row" data-group="${groupIndex}" data-state="${stateIndex}">
          <select data-trigger-state-name="${groupIndex}-${stateIndex}">${getStateSelectOptions(stateName)}</select>
          <input type="number" placeholder="${window.i18n.t('weight_label')}" value="${weight}" min="1" data-trigger-state-weight="${groupIndex}-${stateIndex}" style="width: 70px;">
          <button class="btn btn-sm btn-ghost" onclick="removeTriggerState(${groupIndex}, ${stateIndex})">🗑️</button>
        </div>
      `;
    }).join('');
    
    div.innerHTML = `
      <div class="trigger-group-header">
        <div class="form-group" style="flex: 1; margin: 0;">
          <label>${window.i18n.t('persistent_state_label')}</label>
          <select data-trigger-persistent="${groupIndex}">${getStateSelectOptions(persistentState)}</select>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="removeTriggerGroup(${groupIndex})">🗑️ <span data-i18n="btn_delete_group">${window.i18n.t('btn_delete_group')}</span></button>
      </div>
      <div class="trigger-states-list" data-trigger-group="${groupIndex}">
        ${statesHtml}
      </div>
      <button class="btn btn-sm btn-secondary" onclick="addTriggerStateToGroup(${groupIndex})" style="margin-top: 8px;">➕ <span data-i18n="btn_add_state">${window.i18n.t('btn_add_state')}</span></button>
    `;
    
    list.appendChild(div);
  });
}

/**
 * 添加触发状态组
 */
function addTriggerGroup() {
  const list = document.getElementById('trigger-groups-list');
  const groupIndex = list.children.length;
  
  const div = document.createElement('div');
  div.className = 'trigger-group-item';
  div.innerHTML = `
    <div class="trigger-group-header">
      <div class="form-group" style="flex: 1; margin: 0;">
        <label>${window.i18n.t('persistent_state_label')}</label>
        <select data-trigger-persistent="${groupIndex}">${getStateSelectOptions()}</select>
      </div>
      <button class="btn btn-sm btn-ghost" onclick="removeTriggerGroup(${groupIndex})">🗑️ <span data-i18n="btn_delete_group">${window.i18n.t('btn_delete_group')}</span></button>
    </div>
    <div class="trigger-states-list" data-trigger-group="${groupIndex}">
    </div>
    <button class="btn btn-sm btn-secondary" onclick="addTriggerStateToGroup(${groupIndex})" style="margin-top: 8px;">➕ <span data-i18n="btn_add_state">${window.i18n.t('btn_add_state')}</span></button>
  `;
  
  list.appendChild(div);
}

/**
 * 移除触发状态组
 */
function removeTriggerGroup(groupIndex) {
  const list = document.getElementById('trigger-groups-list');
  list.children[groupIndex]?.remove();
  reindexTriggerGroups();
}

/**
 * 添加状态到组
 */
function addTriggerStateToGroup(groupIndex) {
  const list = document.getElementById('trigger-groups-list');
  const groupDiv = list.children[groupIndex];
  if (!groupDiv) return;
  
  const statesList = groupDiv.querySelector(`[data-trigger-group="${groupIndex}"]`);
  const stateIndex = statesList.children.length;
  
  const row = document.createElement('div');
  row.className = 'trigger-state-row';
  row.dataset.group = groupIndex;
  row.dataset.state = stateIndex;
  row.innerHTML = `
    <select data-trigger-state-name="${groupIndex}-${stateIndex}">${getStateSelectOptions()}</select>
    <input type="number" placeholder="${window.i18n.t('weight_label')}" value="1" min="1" data-trigger-state-weight="${groupIndex}-${stateIndex}" style="width: 70px;">
    <button class="btn btn-sm btn-ghost" onclick="removeTriggerState(${groupIndex}, ${stateIndex})">🗑️</button>
  `;
  
  statesList.appendChild(row);
}

/**
 * 移除触发状态
 */
function removeTriggerState(groupIndex, stateIndex) {
  const list = document.getElementById('trigger-groups-list');
  const groupDiv = list.children[groupIndex];
  if (!groupDiv) return;
  
  const statesList = groupDiv.querySelector(`[data-trigger-group="${groupIndex}"]`);
  statesList.children[stateIndex]?.remove();
  
  // 重新索引组内状态
  Array.from(statesList.children).forEach((row, i) => {
    row.dataset.state = i;
    row.querySelector('[data-trigger-state-name]').dataset.triggerStateName = `${groupIndex}-${i}`;
    row.querySelector('[data-trigger-state-weight]').dataset.triggerStateWeight = `${groupIndex}-${i}`;
    row.querySelector('button').onclick = () => removeTriggerState(groupIndex, i);
  });
}

/**
 * 重新索引触发状态组
 */
function reindexTriggerGroups() {
  const list = document.getElementById('trigger-groups-list');
  
  Array.from(list.children).forEach((groupDiv, groupIndex) => {
    groupDiv.querySelector('[data-trigger-persistent]').dataset.triggerPersistent = groupIndex;
    
    const statesList = groupDiv.querySelector('[data-trigger-group]');
    statesList.dataset.triggerGroup = groupIndex;
    
    Array.from(statesList.children).forEach((row, stateIndex) => {
      row.dataset.group = groupIndex;
      row.dataset.state = stateIndex;
      row.querySelector('[data-trigger-state-name]').dataset.triggerStateName = `${groupIndex}-${stateIndex}`;
      row.querySelector('[data-trigger-state-weight]').dataset.triggerStateWeight = `${groupIndex}-${stateIndex}`;
      row.querySelector('button').onclick = () => removeTriggerState(groupIndex, stateIndex);
    });
    
    // 更新删除组按钮
    groupDiv.querySelector('.trigger-group-header button').onclick = () => removeTriggerGroup(groupIndex);
    
    // 更新添加状态按钮
    groupDiv.querySelector('.trigger-group-item > button:last-child').onclick = () => addTriggerStateToGroup(groupIndex);
  });
}

/**
 * 收集触发器数据
 */
function collectTriggerData() {
  const event = document.getElementById('trigger-event').value.trim();
  const canTriggerStates = [];
  
  const list = document.getElementById('trigger-groups-list');
  
  Array.from(list.children).forEach((groupDiv, groupIndex) => {
    const persistentState = groupDiv.querySelector(`[data-trigger-persistent="${groupIndex}"]`)?.value.trim() || '';
    const statesList = groupDiv.querySelector(`[data-trigger-group="${groupIndex}"]`);
    const states = [];
    
    Array.from(statesList.children).forEach((row, stateIndex) => {
      const stateName = row.querySelector(`[data-trigger-state-name="${groupIndex}-${stateIndex}"]`)?.value.trim() || '';
      const weight = parseInt(row.querySelector(`[data-trigger-state-weight="${groupIndex}-${stateIndex}"]`)?.value) || 1;
      if (stateName) {
        states.push({ state: stateName, weight });
      }
    });
    
    if (states.length > 0) {
      canTriggerStates.push({
        persistent_state: persistentState,
        states: states
      });
    }
  });
  
  return { event, can_trigger_states: canTriggerStates };
}

/**
 * 保存触发器
 */
function saveTrigger() {
  const triggerData = collectTriggerData();
  
  if (!triggerData.event) {
    showToast(window.i18n.t('msg_enter_event_name'), 'warning');
    return;
  }
  
  if (editingTriggerIndex === -1) {
    // 新建触发器
    currentMod.manifest.triggers.push(triggerData);
  } else {
    // 编辑现有触发器
    currentMod.manifest.triggers[editingTriggerIndex] = triggerData;
  }
  
  closeTriggerModal();
  renderTriggers();
  markUnsaved();
  showToast(window.i18n.t('msg_trigger_saved'), 'success');
}

/**
 * 编辑触发器（简单模式，保留兼容）
 */
function editTrigger(index) {
  editTriggerFull(index);
}

/**
 * 删除触发器
 */
function deleteTrigger(index) {
  if (confirm(window.i18n.t('msg_confirm_delete'))) {
    currentMod.manifest.triggers.splice(index, 1);
    renderTriggers();
    markUnsaved();
    showToast(window.i18n.t('msg_trigger_deleted'), 'success');
  }
}

// ============================================================================
// 资源管理
// ============================================================================

/**
 * HTML 转义（用于 innerHTML 拼接）
 */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 将 needle 在 text 中高亮（大小写不敏感）
 * 返回可直接塞进 innerHTML 的字符串
 */
function highlightNeedleHtml(text, needle) {
  const rawText = String(text ?? '');
  const rawNeedle = String(needle ?? '').trim();
  if (!rawNeedle) return escapeHtml(rawText);

  const hay = rawText.toLowerCase();
  const ndl = rawNeedle.toLowerCase();

  let out = '';
  let i = 0;
  while (i <= rawText.length) {
    const idx = hay.indexOf(ndl, i);
    if (idx === -1) break;
    out += escapeHtml(rawText.slice(i, idx));
    out += `<mark class="filter-highlight">${escapeHtml(rawText.slice(idx, idx + ndl.length))}</mark>`;
    i = idx + ndl.length;
  }
  out += escapeHtml(rawText.slice(i));
  return out;
}

/**
 * 同步高亮输入框（单行 input 覆盖层）
 */
function syncHighlightInput(inputEl) {
  const wrap = inputEl?.closest?.('.hl-input-wrap');
  const layer = wrap?.querySelector?.('.hl-layer');
  if (!wrap || !layer) return;
  const needle = wrap.dataset?.hlNeedle || '';

  // input value 改变时更新高亮层内容
  layer.innerHTML = highlightNeedleHtml(inputEl.value, needle) || '&nbsp;';

  // 同步横向滚动
  layer.scrollLeft = inputEl.scrollLeft || 0;
}

function syncHighlightInputScroll(inputEl) {
  const wrap = inputEl?.closest?.('.hl-input-wrap');
  const layer = wrap?.querySelector?.('.hl-layer');
  if (!wrap || !layer) return;
  layer.scrollLeft = inputEl.scrollLeft || 0;
}

/**
 * 同步高亮多行编辑框（textarea 覆盖层）
 */
function syncHighlightTextarea(textareaEl) {
  const wrap = textareaEl?.closest?.('.hl-textarea-wrap');
  const layer = wrap?.querySelector?.('.hl-layer');
  if (!wrap || !layer) return;

  const needle = wrap.dataset?.hlNeedle || '';
  const value = String(textareaEl.value ?? '');
  let html = highlightNeedleHtml(value, needle);
  if (!value) {
    html = '&nbsp;';
  } else if (value.endsWith('\n')) {
    html += '<br>';
  }
  layer.innerHTML = html;

  // 同步滚动
  layer.scrollTop = textareaEl.scrollTop || 0;
  layer.scrollLeft = textareaEl.scrollLeft || 0;
}

function syncHighlightTextareaScroll(textareaEl) {
  const wrap = textareaEl?.closest?.('.hl-textarea-wrap');
  const layer = wrap?.querySelector?.('.hl-layer');
  if (!wrap || !layer) return;
  layer.scrollTop = textareaEl.scrollTop || 0;
  layer.scrollLeft = textareaEl.scrollLeft || 0;
}

/**
 * 渲染资源列表
 */
function renderAssets() {
  if (!currentMod) return;
  renderAssetList('sequence', currentMod.assets.sequence);
  renderAssetList('img', currentMod.assets.img);
  updateAnimaSelects();
}

/**
 * 渲染单个资源列表
 */
function renderAssetList(type, assets) {
  if (!currentMod) return;
  const list = document.getElementById(`${type}-list`);
  list.innerHTML = '';

  const nameNeedleRaw = (document.getElementById(`assets-${type}-filter-name`)?.value || '').trim();
  const pathNeedleRaw = (document.getElementById(`assets-${type}-filter-path`)?.value || '').trim();
  const nameNeedle = nameNeedleRaw.toLowerCase();
  const pathNeedle = pathNeedleRaw.toLowerCase();

  assets.forEach((asset, index) => {
    const assetName = String(asset?.name || '');
    const assetImg = String(asset?.img || '');

    const nameHay = assetName.toLowerCase();
    const pathHay = assetImg.toLowerCase();
    const matchName = !nameNeedle || nameHay.includes(nameNeedle);
    const matchPath = !pathNeedle || pathHay.includes(pathNeedle);
    if (!matchName || !matchPath) return;

    const card = document.createElement('div');
    card.className = 'asset-card';
    card.innerHTML = `
      <div class="asset-card-header">
        <span class="asset-card-name">${highlightNeedleHtml(assetName, nameNeedleRaw)}</span>
        <div class="asset-card-actions">
          <button class="btn btn-sm btn-ghost" onclick="copyAssetToClipboard('${type}', ${index})" title="${window.i18n.t('btn_copy_to_clipboard')}">📋</button>
          <button class="btn btn-sm btn-ghost" onclick="editAsset('${type}', ${index})">✏️</button>
          <button class="btn btn-sm btn-ghost" onclick="deleteAsset('${type}', ${index})">🗑️</button>
        </div>
      </div>
      <div class="asset-card-body">
        <div class="asset-field"><span class="label">${window.i18n.t('asset_path_label')}:</span> ${highlightNeedleHtml(assetImg, pathNeedleRaw)}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('origin_reverse_label')}:</span> ${asset.origin_reverse ? window.i18n.t('yes') : window.i18n.t('no')}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('asset_frames_label')}:</span> ${escapeHtml(`${asset.frame_num_x}×${asset.frame_num_y}`)}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('asset_size_label')}:</span> ${escapeHtml(`${asset.frame_size_x}×${asset.frame_size_y}`)}</div>
      </div>
    `;
    list.appendChild(card);
  });

  // 底部添加按钮
  const footer = document.createElement('div');
  footer.className = 'section-footer';
  const btnLabel = type === 'sequence' ? window.i18n.t('btn_add_animation') : window.i18n.t('btn_add_img');
  footer.innerHTML = `
    <button class="btn btn-sm btn-ghost" onclick="pasteAssetFromClipboard('${type}')">📋 <span data-i18n="btn_paste_from_clipboard">${window.i18n.t('btn_paste_from_clipboard')}</span></button>
    <button class="btn btn-sm btn-primary" onclick="addAsset('${type}')">➕ <span>${btnLabel}</span></button>
  `;
  list.appendChild(footer);
}

/**
 * 添加资源
 */
function addAsset(type) {
  editingAssetType = type;
  editingAssetIndex = -1;
  openAssetModal(window.i18n.t('modal_add_asset'), {
    name: '',
    img: type === 'sequence' ? 'sequence/' : 'img/',
    sequence: true,
    origin_reverse: false,
    need_reverse: false,
    frame_time: 0.1,
    frame_size_x: 260,
    frame_size_y: 298,
    frame_num_x: 1,
    frame_num_y: 1,
    offset_x: 0,
    offset_y: 0
  });
}

/**
 * 编辑资源
 */
function editAsset(type, index) {
  editingAssetType = type;
  editingAssetIndex = index;
  const asset = currentMod.assets[type][index];
  openAssetModal(window.i18n.t('modal_edit_asset'), asset);
}

/**
 * 打开资源编辑弹窗
 */
function openAssetModal(title, asset) {
  document.getElementById('asset-modal-title').textContent = title;

  // 默认折叠高级选项
  const advanced = document.getElementById('asset-advanced-options');
  if (advanced && advanced.tagName === 'DETAILS') {
    advanced.open = false;
  }
  
  document.getElementById('asset-name').value = asset.name || '';
  document.getElementById('asset-img').value = asset.img || '';
  document.getElementById('asset-sequence').checked = asset.sequence !== false;
  document.getElementById('asset-origin-reverse').checked = asset.origin_reverse || false;
  document.getElementById('asset-need-reverse').checked = asset.need_reverse !== false;
  document.getElementById('asset-frame-time').value = asset.frame_time || 0.1;
  document.getElementById('asset-frame-size-x').value = asset.frame_size_x || 260;
  document.getElementById('asset-frame-size-y').value = asset.frame_size_y || 298;
  document.getElementById('asset-frame-num-x').value = asset.frame_num_x || 1;
  document.getElementById('asset-frame-num-y').value = asset.frame_num_y || 1;
  document.getElementById('asset-offset-x').value = asset.offset_x || 0;
  document.getElementById('asset-offset-y').value = asset.offset_y || 0;
  
  document.getElementById('asset-modal').classList.add('show');
}

/**
 * 关闭资源编辑弹窗
 */
function closeAssetModal() {
  document.getElementById('asset-modal').classList.remove('show');
}

/**
 * 保存资源
 */
function saveAsset() {
  const asset = {
    name: document.getElementById('asset-name').value.trim(),
    img: document.getElementById('asset-img').value.trim(),
    sequence: document.getElementById('asset-sequence').checked,
    origin_reverse: document.getElementById('asset-origin-reverse').checked,
    need_reverse: document.getElementById('asset-need-reverse').checked,
    frame_time: parseFloat(document.getElementById('asset-frame-time').value) || 0.1,
    frame_size_x: parseInt(document.getElementById('asset-frame-size-x').value) || 260,
    frame_size_y: parseInt(document.getElementById('asset-frame-size-y').value) || 298,
    frame_num_x: parseInt(document.getElementById('asset-frame-num-x').value) || 1,
    frame_num_y: parseInt(document.getElementById('asset-frame-num-y').value) || 1,
    offset_x: parseInt(document.getElementById('asset-offset-x').value) || 0,
    offset_y: parseInt(document.getElementById('asset-offset-y').value) || 0
  };
  
  if (!asset.name) {
    showToast(window.i18n.t('msg_enter_asset_name'), 'warning');
    return;
  }
  
  if (editingAssetIndex === -1) {
    currentMod.assets[editingAssetType].push(asset);
  } else {
    currentMod.assets[editingAssetType][editingAssetIndex] = asset;
  }
  
  closeAssetModal();
  renderAssets();
  markUnsaved();
  showToast(window.i18n.t('msg_asset_saved'), 'success');
}

/**
 * 删除资源
 */
function deleteAsset(type, index) {
  if (confirm(window.i18n.t('msg_confirm_delete_asset'))) {
    currentMod.assets[type].splice(index, 1);
    renderAssets();
    markUnsaved();
    showToast(window.i18n.t('msg_asset_deleted'), 'success');
  }
}

// ============================================================================
// 剪切板功能
// ============================================================================

/**
 * 复制单个资源到剪切板
 */
async function copyAssetToClipboard(type, index) {
  if (!currentMod) return;
  const asset = currentMod.assets[type][index];
  if (!asset) {
    showToast(window.i18n.t('msg_no_data_to_copy'), 'warning');
    return;
  }
  try {
    const data = {
      type: 'tbuddy_asset',
      data: asset
    };
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    showToast(window.i18n.t('msg_copied_to_clipboard'), 'success');
  } catch (e) {
    showToast(window.i18n.t('msg_clipboard_read_failed'), 'error');
  }
}

/**
 * 从剪切板粘贴资源（添加到列表末尾）
 */
async function pasteAssetFromClipboard(type) {
  if (!currentMod) return;
  try {
    const text = await navigator.clipboard.readText();
    const parsed = JSON.parse(text);
    if (parsed.type !== 'tbuddy_asset' || typeof parsed.data !== 'object') {
      showToast(window.i18n.t('msg_clipboard_empty'), 'warning');
      return;
    }
    currentMod.assets[type].push(parsed.data);
    renderAssets();
    markUnsaved();
    showToast(window.i18n.t('msg_pasted_from_clipboard'), 'success');
  } catch (e) {
    showToast(window.i18n.t('msg_clipboard_empty'), 'warning');
  }
}

/**
 * 复制单个重要状态到剪切板
 */
async function copyImportantStateToClipboard(key) {
  if (!currentMod || !currentMod.manifest.important_states) return;
  const state = currentMod.manifest.important_states[key];
  if (!state) {
    showToast(window.i18n.t('msg_no_data_to_copy'), 'warning');
    return;
  }
  try {
    const data = {
      type: 'tbuddy_important_state',
      data: state
    };
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    showToast(window.i18n.t('msg_copied_to_clipboard'), 'success');
  } catch (e) {
    showToast(window.i18n.t('msg_clipboard_read_failed'), 'error');
  }
}

/**
 * 从剪切板粘贴到指定重要状态
 */
async function pasteImportantStateFromClipboard(key) {
  if (!currentMod) return;
  try {
    const text = await navigator.clipboard.readText();
    const parsed = JSON.parse(text);
    if (parsed.type !== 'tbuddy_important_state' || typeof parsed.data !== 'object') {
      showToast(window.i18n.t('msg_clipboard_empty'), 'warning');
      return;
    }
    // 保留原有的 name 为 key
    parsed.data.name = key;
    currentMod.manifest.important_states[key] = parsed.data;
    renderStates();
    markUnsaved();
    showToast(window.i18n.t('msg_pasted_from_clipboard'), 'success');
  } catch (e) {
    showToast(window.i18n.t('msg_clipboard_empty'), 'warning');
  }
}

/**
 * 复制单个普通状态到剪切板
 */
async function copyStateToClipboard(index) {
  if (!currentMod) return;
  const state = currentMod.manifest.states[index];
  if (!state) {
    showToast(window.i18n.t('msg_no_data_to_copy'), 'warning');
    return;
  }
  try {
    const data = {
      type: 'tbuddy_state',
      data: state
    };
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    showToast(window.i18n.t('msg_copied_to_clipboard'), 'success');
  } catch (e) {
    showToast(window.i18n.t('msg_clipboard_read_failed'), 'error');
  }
}

/**
 * 从剪切板粘贴普通状态（添加到列表末尾）
 */
async function pasteStateFromClipboard() {
  if (!currentMod) return;
  try {
    const text = await navigator.clipboard.readText();
    const parsed = JSON.parse(text);
    if (parsed.type !== 'tbuddy_state' || typeof parsed.data !== 'object') {
      showToast(window.i18n.t('msg_clipboard_empty'), 'warning');
      return;
    }
    currentMod.manifest.states.push(parsed.data);
    renderStates();
    markUnsaved();
    showToast(window.i18n.t('msg_pasted_from_clipboard'), 'success');
  } catch (e) {
    showToast(window.i18n.t('msg_clipboard_empty'), 'warning');
  }
}

/**
 * 复制单个触发器到剪切板
 */
async function copyTriggerToClipboard(index) {
  if (!currentMod) return;
  const trigger = currentMod.manifest.triggers[index];
  if (!trigger) {
    showToast(window.i18n.t('msg_no_data_to_copy'), 'warning');
    return;
  }
  try {
    const data = {
      type: 'tbuddy_trigger',
      data: trigger
    };
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    showToast(window.i18n.t('msg_copied_to_clipboard'), 'success');
  } catch (e) {
    showToast(window.i18n.t('msg_clipboard_read_failed'), 'error');
  }
}

/**
 * 从剪切板粘贴触发器（添加到列表末尾）
 */
async function pasteTriggerFromClipboard() {
  if (!currentMod) return;
  try {
    const text = await navigator.clipboard.readText();
    const parsed = JSON.parse(text);
    if (parsed.type !== 'tbuddy_trigger' || typeof parsed.data !== 'object') {
      showToast(window.i18n.t('msg_clipboard_empty'), 'warning');
      return;
    }
    currentMod.manifest.triggers.push(parsed.data);
    renderTriggers();
    markUnsaved();
    showToast(window.i18n.t('msg_pasted_from_clipboard'), 'success');
  } catch (e) {
    showToast(window.i18n.t('msg_clipboard_empty'), 'warning');
  }
}

// ============================================================================
// 文本管理
// ============================================================================

/**
 * 渲染文本管理
 */
function renderTexts() {
  populateTextSpeechToggle();

  // 渲染语言标签
  const langTabs = document.getElementById('text-lang-tabs');
  langTabs.innerHTML = '';
  
  const langs = Object.keys(currentMod.texts);
  if (langs.length === 0) {
    langs.push('zh');
    currentMod.texts['zh'] = { info: { id: 'zh', lang: '简体中文', name: '', description: '' }, speech: [] };
  }
  
  if (!langs.includes(currentTextLang)) {
    currentTextLang = langs[0];
  }
  
  langs.forEach(lang => {
    const tab = document.createElement('div');
    tab.className = `lang-tab ${lang === currentTextLang ? 'active' : ''}`;
    tab.innerHTML = `
      <span class="lang-tab-name">${currentMod.texts[lang]?.info?.lang || lang}</span>
      <button class="lang-tab-delete" onclick="event.stopPropagation(); deleteTextLanguage('${lang}')" title="${window.i18n.t('btn_delete_lang')}">×</button>
    `;
    tab.onclick = () => {
      currentTextLang = lang;
      renderTexts();
    };
    langTabs.appendChild(tab);
  });
  
  // 渲染角色信息表单
  const info = currentMod.texts[currentTextLang]?.info || {};
  document.getElementById('text-lang-id').value = info.id || currentTextLang;
  document.getElementById('text-lang-name').value = info.lang || '';
  document.getElementById('text-char-name').value = info.name || '';
  document.getElementById('text-char-desc').value = info.description || '';
  
  // 添加监听
  ['text-lang-id', 'text-lang-name', 'text-char-name', 'text-char-desc'].forEach(id => {
    const el = document.getElementById(id);
    el.onchange = () => {
      if (!currentMod.texts[currentTextLang]) {
        currentMod.texts[currentTextLang] = { info: {}, speech: [] };
      }
      currentMod.texts[currentTextLang].info = {
        id: document.getElementById('text-lang-id').value.trim(),
        lang: document.getElementById('text-lang-name').value.trim(),
        name: document.getElementById('text-char-name').value.trim(),
        description: document.getElementById('text-char-desc').value.trim()
      };
      markUnsaved();
    };
  });
  
  // 渲染对话文本列表（仅当启用 speech.json 时）
  if (currentMod.textSpeechEnabled === true) {
    renderSpeechTexts();
  } else {
    const list = document.getElementById('speech-text-list');
    if (list) list.innerHTML = '';
  }
}

/**
 * 渲染对话文本列表
 */
function renderSpeechTexts() {
  if (!currentMod) return;
  if (currentMod.textSpeechEnabled !== true) return;
  const list = document.getElementById('speech-text-list');
  list.innerHTML = '';


  const speeches = currentMod.texts[currentTextLang]?.speech || [];
  const nameNeedleRaw = (document.getElementById('speech-filter-name')?.value || '').trim();
  const containsNeedleRaw = (document.getElementById('speech-filter-contains')?.value || '').trim();
  const nameNeedle = nameNeedleRaw.toLowerCase();
  const containsNeedle = containsNeedleRaw.toLowerCase();

  speeches.forEach((speech, index) => {
    const speechName = String(speech?.name || '');
    const speechText = String(speech?.text || '');

    const nameHay = speechName.toLowerCase();
    const textHay = speechText.toLowerCase();
    const matchName = !nameNeedle || nameHay.includes(nameNeedle);
    const matchContains = !containsNeedle || textHay.includes(containsNeedle);
    if (!matchName || !matchContains) return;

    const item = document.createElement('div');
    item.className = 'speech-item';

    const nameFieldHtml = nameNeedleRaw
      ? `
        <div class="hl-wrap hl-input-wrap speech-item-name-wrap" data-hl-needle="${escapeHtml(nameNeedleRaw)}">
          <div class="speech-item-name hl-layer">${highlightNeedleHtml(speechName, nameNeedleRaw) || '&nbsp;'}</div>
          <input type="text" class="speech-item-name hl-input" value="${escapeHtml(speechName)}"
            placeholder="${window.i18n.t('text_name_placeholder')}" onchange="updateSpeechText(${index}, 'name', this.value)" oninput="syncHighlightInput(this)" onscroll="syncHighlightInputScroll(this)">
        </div>
      `
      : `
        <input type="text" class="speech-item-name" value="${escapeHtml(speechName)}" 
          placeholder="${window.i18n.t('text_name_placeholder')}" onchange="updateSpeechText(${index}, 'name', this.value)">
      `;

    const textFieldHtml = containsNeedleRaw
      ? `
        <div class="hl-wrap hl-textarea-wrap speech-item-text-wrap" data-hl-needle="${escapeHtml(containsNeedleRaw)}">
          <div class="speech-item-text hl-layer hl-textarea-highlight">${highlightNeedleHtml(speechText, containsNeedleRaw) || '&nbsp;'}</div>
          <textarea class="speech-item-text hl-textarea" rows="3" placeholder="${window.i18n.t('text_content_placeholder')}"
            onchange="updateSpeechText(${index}, 'text', this.value)" oninput="syncHighlightTextarea(this)" onscroll="syncHighlightTextareaScroll(this)">${escapeHtml(speechText)}</textarea>
        </div>
      `
      : `
        <textarea class="speech-item-text" rows="3" placeholder="${window.i18n.t('text_content_placeholder')}"
          onchange="updateSpeechText(${index}, 'text', this.value)">${escapeHtml(speechText)}</textarea>
      `;

    item.innerHTML = `
      <div class="speech-item-header">
        ${nameFieldHtml}
        <div class="speech-item-actions">
          <button class="btn btn-sm btn-ghost" onclick="deleteSpeechText(${index})">🗑️</button>
        </div>
      </div>
      ${textFieldHtml}
    `;
    list.appendChild(item);
  });

  // 底部添加按钮
  const footer = document.createElement('div');
  footer.className = 'section-footer';
  footer.innerHTML = `
    <button class="btn btn-sm btn-primary" onclick="addSpeechText()">➕ <span data-i18n="btn_add_text">${window.i18n.t('btn_add_text')}</span></button>
  `;
  list.appendChild(footer);
}

/**
 * 添加语言
 */
function addLanguage() {
  const langId = prompt(window.i18n.t('msg_enter_lang_id'));
  if (langId && !currentMod.texts[langId]) {
    currentMod.texts[langId] = {
      info: { id: langId, lang: langId, name: '', description: '' },
      speech: []
    };
    currentTextLang = langId;
    renderTexts();
    markUnsaved();
    showToast(window.i18n.t('msg_lang_added'), 'success');
  }
}

/**
 * 删除文本语言
 */
function deleteTextLanguage(langId) {
  const langs = Object.keys(currentMod.texts);
  if (langs.length <= 1) {
    showToast(window.i18n.t('msg_cannot_delete_last_lang'), 'error');
    return;
  }
  
  if (!confirm(window.i18n.t('msg_confirm_delete_lang').replace('{lang}', langId))) {
    return;
  }
  
  delete currentMod.texts[langId];
  
  // 如果删除的是当前选中的语言，切换到第一个语言
  if (currentTextLang === langId) {
    currentTextLang = Object.keys(currentMod.texts)[0];
  }
  
  renderTexts();
  markUnsaved();
  showToast(window.i18n.t('msg_lang_deleted'), 'success');
}

/**
 * 复制文本语言到剪切板
 */
function copyTextLanguage() {
  if (!currentMod) return;
  const langData = currentMod.texts[currentTextLang];
  if (!langData) {
    showToast(window.i18n.t('msg_no_data_to_copy'), 'error');
    return;
  }
  
  const copyData = {
    type: 'traybuddy_text_lang',
    langId: currentTextLang,
    data: JSON.parse(JSON.stringify(langData))
  };
  
  navigator.clipboard.writeText(JSON.stringify(copyData, null, 2))
    .then(() => {
      showToast(window.i18n.t('msg_lang_copied').replace('{lang}', currentTextLang), 'success');
    })
    .catch(() => {
      showToast(window.i18n.t('msg_clipboard_read_failed'), 'error');
    });
}

/**
 * 从剪切板粘贴文本语言
 */
async function pasteTextLanguage() {
  try {
    const text = await navigator.clipboard.readText();
    const parsed = JSON.parse(text);
    
    if (parsed.type !== 'traybuddy_text_lang' || !parsed.data) {
      showToast(window.i18n.t('msg_clipboard_empty'), 'error');
      return;
    }
    
    // 询问新语言ID
    let newLangId = prompt(window.i18n.t('msg_enter_new_lang_id'), parsed.langId || '');
    if (!newLangId) return;
    
    // 检查是否已存在
    if (currentMod.texts[newLangId]) {
      if (!confirm(window.i18n.t('msg_lang_exists_overwrite').replace('{lang}', newLangId))) {
        return;
      }
    }
    
    // 复制数据并更新语言ID
    const newData = JSON.parse(JSON.stringify(parsed.data));
    if (newData.info) {
      newData.info.id = newLangId;
    }
    
    currentMod.texts[newLangId] = newData;
    currentTextLang = newLangId;
    renderTexts();
    markUnsaved();
    showToast(window.i18n.t('msg_lang_pasted').replace('{lang}', newLangId), 'success');
  } catch (e) {
    showToast(window.i18n.t('msg_clipboard_empty'), 'error');
  }
}

/**
 * 添加对话文本
 */
function addSpeechText() {
  if (!currentMod || currentMod.textSpeechEnabled !== true) return;
  if (!currentMod.texts[currentTextLang]) {
    currentMod.texts[currentTextLang] = { info: {}, speech: [] };
  }
  currentMod.texts[currentTextLang].speech.push({ name: '', text: '' });
  renderSpeechTexts();
  markUnsaved();
}

/**
 * 更新对话文本
 */
function updateSpeechText(index, field, value) {
  if (!currentMod || currentMod.textSpeechEnabled !== true) return;
  currentMod.texts[currentTextLang].speech[index][field] = value;
  markUnsaved();
}

/**
 * 删除对话文本
 */
function deleteSpeechText(index) {
  if (!currentMod || currentMod.textSpeechEnabled !== true) return;
  currentMod.texts[currentTextLang].speech.splice(index, 1);
  renderSpeechTexts();
  markUnsaved();
}

// ============================================================================
// 音频管理
// ============================================================================

/**
 * 渲染音频管理
 */
function renderAudio() {
  populateAudioSpeechToggle();
  if (!currentMod || currentMod.audioSpeechEnabled !== true) {
    const langTabs = document.getElementById('audio-lang-tabs');
    if (langTabs) langTabs.innerHTML = '';
    const list = document.getElementById('audio-list');
    if (list) list.innerHTML = '';
    return;
  }

  // 渲染语言标签
  const langTabs = document.getElementById('audio-lang-tabs');
  langTabs.innerHTML = '';
  
  const langs = Object.keys(currentMod.audio);
  if (langs.length === 0) {
    langs.push('jp');
    currentMod.audio['jp'] = [];
  }
  
  if (!langs.includes(currentAudioLang)) {
    currentAudioLang = langs[0];
  }
  
  langs.forEach(lang => {
    const tab = document.createElement('div');
    tab.className = `lang-tab ${lang === currentAudioLang ? 'active' : ''}`;
    tab.innerHTML = `
      <span class="lang-tab-name">${lang}</span>
      <button class="lang-tab-delete" onclick="event.stopPropagation(); deleteAudioLanguage('${lang}')" title="${window.i18n.t('btn_delete_lang')}">×</button>
    `;
    tab.onclick = () => {
      currentAudioLang = lang;
      renderAudio();
    };
    langTabs.appendChild(tab);
  });
  
  // 渲染音频列表
  renderAudioList();
}

/**
 * 渲染音频列表
 */
function renderAudioList() {
  if (!currentMod) return;
  if (currentMod.audioSpeechEnabled !== true) return;
  const list = document.getElementById('audio-list');
  list.innerHTML = '';


  const audios = currentMod.audio[currentAudioLang] || [];
  const nameNeedleRaw = (document.getElementById('audio-filter-name')?.value || '').trim();
  const pathNeedleRaw = (document.getElementById('audio-filter-path')?.value || '').trim();
  const nameNeedle = nameNeedleRaw.toLowerCase();
  const pathNeedle = pathNeedleRaw.toLowerCase();

  audios.forEach((audio, index) => {
    const audioName = String(audio?.name || '');
    const audioPath = String(audio?.audio || '');

    const nameHay = audioName.toLowerCase();
    const pathHay = audioPath.toLowerCase();
    const matchName = !nameNeedle || nameHay.includes(nameNeedle);
    const matchPath = !pathNeedle || pathHay.includes(pathNeedle);
    if (!matchName || !matchPath) return;

    const item = document.createElement('div');
    item.className = 'audio-item';

    const nameFieldHtml = nameNeedleRaw
      ? `
        <div class="hl-wrap hl-input-wrap audio-item-name-wrap" data-hl-needle="${escapeHtml(nameNeedleRaw)}">
          <div class="audio-item-name hl-layer">${highlightNeedleHtml(audioName, nameNeedleRaw) || '&nbsp;'}</div>
          <input type="text" class="audio-item-name hl-input" value="${escapeHtml(audioName)}" 
            placeholder="${window.i18n.t('audio_name_placeholder')}" onchange="updateAudioEntry(${index}, 'name', this.value)" oninput="syncHighlightInput(this)" onscroll="syncHighlightInputScroll(this)">
        </div>
      `
      : `
        <input type="text" class="audio-item-name" value="${escapeHtml(audioName)}" 
          placeholder="${window.i18n.t('audio_name_placeholder')}" onchange="updateAudioEntry(${index}, 'name', this.value)">
      `;

    const pathFieldHtml = pathNeedleRaw
      ? `
        <div class="hl-wrap hl-input-wrap audio-item-path-wrap" data-hl-needle="${escapeHtml(pathNeedleRaw)}">
          <div class="audio-item-path hl-layer">${highlightNeedleHtml(audioPath, pathNeedleRaw) || '&nbsp;'}</div>
          <input type="text" class="audio-item-path hl-input" value="${escapeHtml(audioPath)}" 
            placeholder="${window.i18n.t('audio_path_placeholder')}" onchange="updateAudioEntry(${index}, 'audio', this.value)" oninput="syncHighlightInput(this)" onscroll="syncHighlightInputScroll(this)">
        </div>
      `
      : `
        <input type="text" class="audio-item-path" value="${escapeHtml(audioPath)}" 
          placeholder="${window.i18n.t('audio_path_placeholder')}" onchange="updateAudioEntry(${index}, 'audio', this.value)">
      `;

    item.innerHTML = `
      <div class="audio-item-info">
        ${nameFieldHtml}
        ${pathFieldHtml}
      </div>
      <div class="audio-item-actions">
        <button class="btn btn-sm btn-ghost" onclick="deleteAudioEntry(${index})">🗑️</button>
      </div>
    `;
    list.appendChild(item);
  });

  // 底部添加按钮
  const footer = document.createElement('div');
  footer.className = 'section-footer';
  footer.innerHTML = `
    <button class="btn btn-sm btn-primary" onclick="addAudioEntry()">➕ <span data-i18n="btn_add_audio">${window.i18n.t('btn_add_audio')}</span></button>
  `;
  list.appendChild(footer);
}

/**
 * 添加音频语言
 */
function addAudioLanguage() {
  if (!currentMod || currentMod.audioSpeechEnabled !== true) return;
  const langId = prompt(window.i18n.t('msg_enter_lang_id'));
  if (langId && !currentMod.audio[langId]) {
    currentMod.audio[langId] = [];
    currentAudioLang = langId;
    renderAudio();
    markUnsaved();
    showToast(window.i18n.t('msg_lang_added'), 'success');
  }
}

/**
 * 删除音频语言
 */
function deleteAudioLanguage(langId) {
  if (!currentMod || currentMod.audioSpeechEnabled !== true) return;
  const langs = Object.keys(currentMod.audio);
  if (langs.length <= 1) {
    showToast(window.i18n.t('msg_cannot_delete_last_lang'), 'error');
    return;
  }
  
  if (!confirm(window.i18n.t('msg_confirm_delete_lang').replace('{lang}', langId))) {
    return;
  }
  
  delete currentMod.audio[langId];
  
  // 如果删除的是当前选中的语言，切换到第一个语言
  if (currentAudioLang === langId) {
    currentAudioLang = Object.keys(currentMod.audio)[0];
  }
  
  renderAudio();
  markUnsaved();
  showToast(window.i18n.t('msg_lang_deleted'), 'success');
}

/**
 * 复制音频语言到剪切板
 */
function copyAudioLanguage() {
  if (!currentMod || currentMod.audioSpeechEnabled !== true) return;
  const langData = currentMod.audio[currentAudioLang];
  if (!langData) {
    showToast(window.i18n.t('msg_no_data_to_copy'), 'error');
    return;
  }
  
  const copyData = {
    type: 'traybuddy_audio_lang',
    langId: currentAudioLang,
    data: JSON.parse(JSON.stringify(langData))
  };
  
  navigator.clipboard.writeText(JSON.stringify(copyData, null, 2))
    .then(() => {
      showToast(window.i18n.t('msg_lang_copied').replace('{lang}', currentAudioLang), 'success');
    })
    .catch(() => {
      showToast(window.i18n.t('msg_clipboard_read_failed'), 'error');
    });
}

/**
 * 从剪切板粘贴音频语言
 */
async function pasteAudioLanguage() {
  if (!currentMod || currentMod.audioSpeechEnabled !== true) return;
  try {
    const text = await navigator.clipboard.readText();
    const parsed = JSON.parse(text);
    
    if (parsed.type !== 'traybuddy_audio_lang' || !parsed.data) {
      showToast(window.i18n.t('msg_clipboard_empty'), 'error');
      return;
    }
    
    // 询问新语言ID
    let newLangId = prompt(window.i18n.t('msg_enter_new_lang_id'), parsed.langId || '');
    if (!newLangId) return;
    
    // 检查是否已存在
    if (currentMod.audio[newLangId]) {
      if (!confirm(window.i18n.t('msg_lang_exists_overwrite').replace('{lang}', newLangId))) {
        return;
      }
    }
    
    // 复制数据
    currentMod.audio[newLangId] = JSON.parse(JSON.stringify(parsed.data));
    currentAudioLang = newLangId;
    renderAudio();
    markUnsaved();
    showToast(window.i18n.t('msg_lang_pasted').replace('{lang}', newLangId), 'success');
  } catch (e) {
    showToast(window.i18n.t('msg_clipboard_empty'), 'error');
  }
}

/**
 * 添加音频条目
 */
function addAudioEntry() {
  if (!currentMod || currentMod.audioSpeechEnabled !== true) return;
  if (!currentMod.audio[currentAudioLang]) {
    currentMod.audio[currentAudioLang] = [];
  }
  currentMod.audio[currentAudioLang].push({
    name: '',
    audio: `${currentAudioLang}/speech/`
  });
  renderAudioList();
  markUnsaved();
}

/**
 * 更新音频条目
 */
function updateAudioEntry(index, field, value) {
  if (!currentMod || currentMod.audioSpeechEnabled !== true) return;
  currentMod.audio[currentAudioLang][index][field] = value;
  markUnsaved();
}

/**
 * 删除音频条目
 */
function deleteAudioEntry(index) {
  if (!currentMod || currentMod.audioSpeechEnabled !== true) return;
  currentMod.audio[currentAudioLang].splice(index, 1);
  renderAudioList();
  markUnsaved();
}

// ============================================================================
// Toast 通知
// ============================================================================

/**
 * 显示 Toast 通知
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icons = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    error: '❌'
  };
  
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'toast-in 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
