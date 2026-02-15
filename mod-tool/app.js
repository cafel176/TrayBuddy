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
// 拖拽排序（通用）
// ============================================================================

const __tbUidMap = new WeakMap();
let __tbUidCounter = 1;

function ensureTbUid(obj) {
  if (!obj || typeof obj !== 'object') return '';

  const existing = __tbUidMap.get(obj);
  if (existing) return existing;

  const uid = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `tbuid_${Date.now()}_${__tbUidCounter++}`;

  __tbUidMap.set(obj, uid);
  return uid;
}


function reorderArrayInPlaceByKeys(arr, orderedKeys, keyFn) {
  if (!Array.isArray(arr)) return;
  const getKey = typeof keyFn === 'function' ? keyFn : ensureTbUid;
  const map = new Map();
  for (const item of arr) {
    map.set(getKey(item), item);
  }

  const used = new Set();
  const next = [];
  for (const k of orderedKeys) {
    const item = map.get(k);
    if (item) {
      next.push(item);
      used.add(k);
    }
  }

  // 兜底：如果有未包含的元素，按旧顺序追加
  for (const item of arr) {
    const k = getKey(item);
    if (!used.has(k)) next.push(item);
  }

  arr.length = 0;
  arr.push(...next);
}

function renderSortHandleHtml() {
  const title = (window?.i18n?.t?.('drag_to_reorder') || '拖拽排序');
  const safeTitle = typeof escapeHtml === 'function' ? escapeHtml(title) : String(title);
  return `<span class="tb-drag-handle" draggable="true" title="${safeTitle}" aria-label="${safeTitle}">⋮⋮</span>`;
}

const __tbSortableInited = new WeakSet();

function enableTbSortable(container, {
  itemSelector = '.tb-sort-item',
  handleSelector = '.tb-drag-handle',
  canStart = () => true,
  onSortedKeys = () => {}
} = {}) {
  if (!container || __tbSortableInited.has(container)) return;
  __tbSortableInited.add(container);

  let dragItem = null;
  let dragKey = '';

  function cleanup() {
    if (dragItem) dragItem.classList.remove('tb-sort-dragging');
    dragItem = null;
    dragKey = '';

    container.querySelectorAll('.tb-sort-drop-target').forEach(el => {
      el.classList.remove('tb-sort-drop-target');
    });
  }

  container.addEventListener('dragstart', (e) => {
    const handle = e.target?.closest?.(handleSelector);
    if (!handle) return;

    if (!canStart()) {
      e.preventDefault();
      return;
    }

    const item = handle.closest(itemSelector);
    if (!item) return;

    dragItem = item;
    dragKey = String(item.dataset.sortKey || '');

    item.classList.add('tb-sort-dragging');

    // Firefox 需要 setData 才会触发拖拽
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragKey || '');
    } catch (err) {}
  });

  container.addEventListener('dragover', (e) => {
    if (!dragItem) return;

    const overItem = e.target?.closest?.(itemSelector);
    if (!overItem || overItem === dragItem) return;

    // 仅允许同一个容器内拖动
    if (overItem.parentElement !== container) return;

    e.preventDefault();

    const rect = overItem.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;

    // 可视化提示
    container.querySelectorAll('.tb-sort-drop-target').forEach(el => {
      el.classList.remove('tb-sort-drop-target');
    });
    overItem.classList.add('tb-sort-drop-target');

    if (before) {
      container.insertBefore(dragItem, overItem);
    } else {
      container.insertBefore(dragItem, overItem.nextSibling);
    }
  });

  container.addEventListener('drop', (e) => {
    if (!dragItem) return;
    e.preventDefault();

    const orderedKeys = Array.from(container.querySelectorAll(itemSelector))
      .map(el => String(el.dataset.sortKey || ''))
      .filter(Boolean);

    cleanup();
    onSortedKeys(orderedKeys);
  });

  container.addEventListener('dragend', () => {
    cleanup();
  });
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
  const importBtn = document.getElementById('audio-speech-import-btn');
  const importFileBtn = document.getElementById('audio-speech-import-file-btn');

  if (checkbox) checkbox.checked = enabled;
  if (fields) {
    fields.classList.toggle('feature-enabled', enabled);
    fields.classList.toggle('feature-disabled', !enabled);
  }
  if (addBtn) addBtn.disabled = !enabled;
  if (importBtn) importBtn.disabled = !enabled;
  if (importFileBtn) importFileBtn.disabled = !enabled;
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
      assets: { sequence: [], img: [], live2d: null },
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
    
    const live2dFile = zipData.file(`${rootPath}asset/live2d.json`);
    if (live2dFile) currentMod.assets.live2d = JSON.parse(await live2dFile.async('string'));

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
        img: [],
        live2d: null
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

    // 读取 asset/live2d.json
    try {
      const assetDir = await modFolderHandle.getDirectoryHandle('asset');
      const live2dHandle = await assetDir.getFileHandle('live2d.json');
      const live2dFile = await live2dHandle.getFile();
      currentMod.assets.live2d = JSON.parse(await live2dFile.text());
    } catch (e) {
      console.log('No live2d.json found');
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
  const modType = document.querySelector('input[name="new-mod-type"]:checked')?.value || 'sequence';
  
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
  currentMod = await createModFromTemplate(modId, modName, modAuthor, modType);
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

async function createModFromTemplate(modId, modName, modAuthor, modType = 'sequence') {
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
  const assets = { sequence: [], img: [], live2d: null };
  if (structure.assets) {
    const assetPromises = Object.entries(structure.assets).map(async ([key, path]) => {
      const data = await fetchJsonSafe(`${base}/${path}`);
      return [key, data];
    });
    const assetResults = await Promise.all(assetPromises);
    assetResults.forEach(([key, data]) => {
      if (key === 'live2d') {
        assets.live2d = (data && typeof data === 'object') ? deepClone(data) : null;
      } else {
        assets[key] = Array.isArray(data) ? deepClone(data) : [];
      }
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

  // --- 设置 mod_type
  mod.manifest.mod_type = modType;

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

  // 触发计数范围（默认不限制）
  if (!Number.isFinite(Number(state.trigger_counter_start))) state.trigger_counter_start = -2147483648;
  if (!Number.isFinite(Number(state.trigger_counter_end))) state.trigger_counter_end = 2147483647;

  // 气温触发范围（默认不限制）
  if (!Number.isFinite(Number(state.trigger_temp_start))) state.trigger_temp_start = -2147483648;
  if (!Number.isFinite(Number(state.trigger_temp_end))) state.trigger_temp_end = 2147483647;

  // 启动时长触发门槛（分钟；0 表示不限制）
  {
    const n = parseInt(state.trigger_uptime);
    state.trigger_uptime = Number.isFinite(n) && n > 0 ? n : 0;
  }

  // 天气触发条件（默认不限制）

  if (Array.isArray(state.trigger_weather)) {
    state.trigger_weather = state.trigger_weather
      .filter((v) => typeof v === 'string')
      .map((v) => v.trim())
      .filter(Boolean);
  } else if (typeof state.trigger_weather === 'string') {
    const t = state.trigger_weather.trim();
    state.trigger_weather = t ? [t] : [];
  } else {
    state.trigger_weather = [];
  }




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

  // live2d_params 应该是 [{id, value}] 数组或 null
  if (state.live2d_params) {
    if (Array.isArray(state.live2d_params)) {
      state.live2d_params = state.live2d_params
        .filter((p) => p && typeof p === 'object' && typeof p.id === 'string' && p.id.trim())
        .map((p) => ({ id: p.id.trim(), value: Number(p.value) || 0 }));
      if (state.live2d_params.length === 0) state.live2d_params = null;
    } else {
      state.live2d_params = null;
    }
  }
}

function normalizeManifestForEditor(manifest) {
  if (!manifest || typeof manifest !== 'object') return;

  // mod_type 默认 sequence
  if (!manifest.mod_type) manifest.mod_type = 'sequence';

  // ema 字段补齐
  if (typeof manifest.show_mod_data_panel !== 'boolean') manifest.show_mod_data_panel = false;
  if (!Number.isFinite(Number(manifest.mod_data_default_int))) manifest.mod_data_default_int = 0;
  if (typeof manifest.global_keyboard !== 'boolean') manifest.global_keyboard = false;

  manifest.character = manifest.character || { z_offset: 1 };
  if (!Number.isFinite(Number(manifest.character.z_offset))) manifest.character.z_offset = 1;

  // 角色 Canvas 适配偏好（short/long/legacy）
  const validFitPrefs = ['short', 'long', 'legacy'];
  if (!validFitPrefs.includes(manifest.character.canvas_fit_preference)) {
    manifest.character.canvas_fit_preference = 'legacy';
  }


  manifest.border = manifest.border || { anima: '', enable: false, z_offset: 2 };
  if (typeof manifest.border.enable !== 'boolean') manifest.border.enable = false;
  if (!Number.isFinite(Number(manifest.border.z_offset))) manifest.border.z_offset = 2;
  if (typeof manifest.border.anima !== 'string') manifest.border.anima = '';

  manifest.important_states = (manifest.important_states && typeof manifest.important_states === 'object') ? manifest.important_states : {};

  ensureImportantState(manifest, 'idle', { persistent: true, priority: 1, trigger_rate: 0.1, next_state: '' });
  ensureImportantState(manifest, 'silence', { persistent: true, priority: 1, trigger_rate: 0, next_state: '' });
  ensureImportantState(manifest, 'silence_start', { persistent: false, priority: 999, trigger_rate: 0, next_state: 'silence' });
  ensureImportantState(manifest, 'silence_end', { persistent: false, priority: 999, trigger_rate: 0, next_state: 'idle' });

  // 拖拽相关内置状态（触发器事件：drag_start / drag_end）
  ensureImportantState(manifest, 'dragging', { persistent: true, priority: 1, trigger_rate: 0, next_state: '' });
  ensureImportantState(manifest, 'drag_start', { persistent: false, priority: 999, trigger_rate: 0, next_state: 'dragging' });
  ensureImportantState(manifest, 'drag_end', { persistent: false, priority: 999, trigger_rate: 0, next_state: 'idle' });

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

    // 兼容旧 mod：事件名从 animation_drag_* 迁移到 drag_*
    const legacyDragStart = 'animation_' + 'drag_start';
    const legacyDragEnd = 'animation_' + 'drag_end';
    if (t.event === legacyDragStart) t.event = 'drag_start';
    if (t.event === legacyDragEnd) t.event = 'drag_end';

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
      trigger_counter_start: -2147483648,
      trigger_counter_end: 2147483647,
      trigger_temp_start: -2147483648,
      trigger_temp_end: 2147483647,
      trigger_uptime: 0,
      trigger_weather: [],

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
 * 递归遍历目录，获取所有非 .json 文件
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} basePath
 * @returns {Promise<Array<{relPath: string, file: File}>>}
 */
async function collectNonJsonFilesFromDirectory(dirHandle, basePath = '', skipDirs = []) {
  const out = [];
  if (!dirHandle) return out;

  for await (const entry of dirHandle.values()) {
    const name = entry.name;
    const relPath = basePath ? `${basePath}/${name}` : name;

    if (entry.kind === 'directory') {
      // 跳过指定目录
      const normalizedRel = relPath.replace(/\\/g, '/').replace(/\/+$/, '');
      if (skipDirs.some(d => normalizedRel === d.replace(/\/+$/, ''))) continue;
      const nested = await collectNonJsonFilesFromDirectory(entry, relPath, skipDirs);
      out.push(...nested);
      continue;
    }

    if (entry.kind === 'file') {
      if (name.toLowerCase().endsWith('.json')) continue;
      try {
        const file = await entry.getFile();
        out.push({ relPath, file });
      } catch (e) {
        // 忽略无法读取的文件
      }
    }
  }

  return out;
}

/**
 * 递归遍历目录，获取所有文件（包括 .json）
 */
async function collectAllFilesFromDirectory(dirHandle, basePath = '') {
  const out = [];
  if (!dirHandle) return out;

  for await (const entry of dirHandle.values()) {
    const name = entry.name;
    const relPath = basePath ? `${basePath}/${name}` : name;

    if (entry.kind === 'directory') {
      const nested = await collectAllFilesFromDirectory(entry, relPath);
      out.push(...nested);
      continue;
    }

    if (entry.kind === 'file') {
      try {
        const file = await entry.getFile();
        out.push({ relPath, file });
      } catch (e) {
        // 忽略无法读取的文件
      }
    }
  }

  return out;
}

function shouldSkipCopiedNonJson(relPath, { preferPreviewFromEditor = true, preferIconFromEditor = true } = {}) {
  const p = String(relPath || '').replace(/\\/g, '/').toLowerCase();

  // 如果用户在编辑器里选了新的预览图/图标，则不覆盖它
  if (preferPreviewFromEditor && currentMod?.previewData) {
    if (p.startsWith('preview.') && PREVIEW_EXTENSIONS.some(ext => p === `preview.${ext}`)) {
      return true;
    }
  }
  if (preferIconFromEditor && currentMod?.iconData) {
    if (p === 'icon.ico') return true;
  }

  return false;
}

async function ensureDirectoryForPath(rootDirHandle, relPath) {
  const parts = String(relPath).split('/').filter(Boolean);
  let dir = rootDirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true });
  }
  return { dir, fileName: parts[parts.length - 1] };
}

async function copyNonJsonFilesBetweenDirectories(sourceDirHandle, targetDirHandle, options = {}) {
  if (!sourceDirHandle || !targetDirHandle) return;

  const skipDirs = options.skipDirs || [];
  const files = await collectNonJsonFilesFromDirectory(sourceDirHandle, '', skipDirs);
  for (const { relPath, file } of files) {
    if (shouldSkipCopiedNonJson(relPath, options)) continue;

    const { dir, fileName } = await ensureDirectoryForPath(targetDirHandle, relPath);
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(file);
    await writable.close();
  }
}

async function addNonJsonFilesToZipFromDirectory(sourceDirHandle, zipRootFolder, options = {}) {
  if (!sourceDirHandle || !zipRootFolder) return;

  const skipDirs = options.skipDirs || [];
  const files = await collectNonJsonFilesFromDirectory(sourceDirHandle, '', skipDirs);
  for (const { relPath, file } of files) {
    if (shouldSkipCopiedNonJson(relPath, options)) continue;

    try {
      const buf = await file.arrayBuffer();
      zipRootFolder.file(relPath, buf);
    } catch (e) {
      // 忽略无法读取的文件
    }
  }
}

/**
 * 将指定目录下的所有文件（含 .json）添加到 ZIP
 */
async function addAllFilesToZipFromDirectory(sourceDirHandle, zipRootFolder, basePathInZip = '') {
  if (!sourceDirHandle || !zipRootFolder) return;

  const files = await collectAllFilesFromDirectory(sourceDirHandle);
  for (const { relPath, file } of files) {
    try {
      const buf = await file.arrayBuffer();
      const zipPath = basePathInZip ? `${basePathInZip}/${relPath}` : relPath;
      zipRootFolder.file(zipPath, buf);
    } catch (e) {
      // 忽略无法读取的文件
    }
  }
}

/**
 * 将指定目录下的所有文件（含 .json）复制到目标目录
 */
async function copyAllFilesBetweenDirectories(sourceDirHandle, targetDirHandle, basePathInTarget = '') {
  if (!sourceDirHandle || !targetDirHandle) return;

  const files = await collectAllFilesFromDirectory(sourceDirHandle);
  let targetRoot = targetDirHandle;
  if (basePathInTarget) {
    const parts = basePathInTarget.split('/').filter(Boolean);
    for (const part of parts) {
      targetRoot = await targetRoot.getDirectoryHandle(part, { create: true });
    }
  }
  for (const { relPath, file } of files) {
    const { dir, fileName } = await ensureDirectoryForPath(targetRoot, relPath);
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(file);
    await writable.close();
  }
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
    branch: [],
    trigger_counter_start: -2147483648,
    trigger_counter_end: 2147483647,
    trigger_temp_start: -2147483648,
    trigger_temp_end: 2147483647,
    trigger_uptime: 0,
    trigger_weather: [],
    mod_data_counter: null,




    branch_show_bubble: true
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

  // 如果是从文件夹加载的 Mod，保存/导出时把该目录下的非 json 资源一并带上
  const sourceFolderHandle = modFolderHandle;
  
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
    
    const isLive2d = currentMod.manifest.mod_type === 'live2d';

    if (isLive2d) {
      // 保存 live2d.json
      if (currentMod.assets.live2d) {
        const live2dHandle = await assetDir.getFileHandle('live2d.json', { create: true });
        const live2dWritable = await live2dHandle.createWritable();
        await live2dWritable.write(stringifyForSave(currentMod.assets.live2d));
        await live2dWritable.close();
      }
    } else {
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
    }
    
    // 创建 asset 子目录
    if (!isLive2d) {
      await assetDir.getDirectoryHandle('sequence', { create: true });
      await assetDir.getDirectoryHandle('img', { create: true });
    }
    
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

    // 复制源目录中的资源文件到目标目录
    if (sourceFolderHandle) {
      if (isLive2d) {
        // Live2D mod：将 asset/live2d/ 下所有文件（含 .json）完整复制
        try {
          const srcAssetDir = await sourceFolderHandle.getDirectoryHandle('asset');
          const srcLive2dDir = await srcAssetDir.getDirectoryHandle('live2d');
          await copyAllFilesBetweenDirectories(srcLive2dDir, modFolderHandle, 'asset/live2d');
        } catch (e) {
          // asset/live2d 目录不存在则跳过
        }
        // 其余非 json 文件照常复制，但跳过 asset/live2d 目录（已完整处理）
        await copyNonJsonFilesBetweenDirectories(sourceFolderHandle, modFolderHandle, { skipDirs: ['asset/live2d'] });
      } else {
        await copyNonJsonFilesBetweenDirectories(sourceFolderHandle, modFolderHandle);
      }
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
    const isLive2dExport = currentMod.manifest.mod_type === 'live2d';
    if (isLive2dExport) {
      if (currentMod.assets.live2d) {
        asset.file('live2d.json', stringifyForSave(currentMod.assets.live2d));
      }
    } else {
      asset.file('sequence.json', stringifyForSave(currentMod.assets.sequence));
      asset.file('img.json', stringifyForSave(currentMod.assets.img));
      asset.folder('sequence');
      asset.folder('img');
    }
    
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

    // 把当前 Mod 目录下的资产文件打包进去
    if (modFolderHandle) {
      if (isLive2dExport) {
        // Live2D mod：将 asset/live2d/ 下所有文件（含 .json）完整打包
        try {
          const assetDirHandle = await modFolderHandle.getDirectoryHandle('asset');
          const live2dDirHandle = await assetDirHandle.getDirectoryHandle('live2d');
          await addAllFilesToZipFromDirectory(live2dDirHandle, root, 'asset/live2d');
        } catch (e) {
          // asset/live2d 目录不存在则跳过
        }
        // 其余非 json 文件照常打包，但跳过 asset/live2d 目录（已完整处理）
        await addNonJsonFilesToZipFromDirectory(modFolderHandle, root, { skipDirs: ['asset/live2d'] });
      } else {
        await addNonJsonFilesToZipFromDirectory(modFolderHandle, root);
      }
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
  document.getElementById('character-canvas-fit-preference').value = m.character?.canvas_fit_preference || 'legacy';
  document.getElementById('border-enable').checked = m.border?.enable || false;
  document.getElementById('border-z-offset').value = m.border?.z_offset || 2;

  // 数据面板
  document.getElementById('show-mod-data-panel').checked = m.show_mod_data_panel === true;
  document.getElementById('mod-data-default-int').value = Number.isFinite(Number(m.mod_data_default_int)) ? Number(m.mod_data_default_int) : 0;

  // 全局键盘
  document.getElementById('global-keyboard').checked = m.global_keyboard === true;

  // Mod 类型显示
  const modType = m.mod_type || 'sequence';
  const modTypeDisplay = document.getElementById('mod-type-display');
  if (modTypeDisplay) {
    modTypeDisplay.value = modType === 'live2d' ? 'Live2D' : window.i18n.t('mod_type_sequence');
  }

  // 根据类型切换资产编辑区
  toggleAssetSections(modType);
  
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
    z_offset: parseInt(document.getElementById('character-z-offset').value) || 1,
    canvas_fit_preference: document.getElementById('character-canvas-fit-preference').value
  };
  m.border = {
    anima: document.getElementById('border-anima').value,
    enable: document.getElementById('border-enable').checked,
    z_offset: parseInt(document.getElementById('border-z-offset').value) || 2
  };

  // 数据面板
  m.show_mod_data_panel = document.getElementById('show-mod-data-panel').checked;
  m.mod_data_default_int = parseInt(document.getElementById('mod-data-default-int').value) || 0;

  // 全局键盘
  m.global_keyboard = document.getElementById('global-keyboard').checked;

  // 收集 Live2D 模型配置
  if (m.mod_type === 'live2d') {
    collectLive2dModelData();
  }
}

/**
 * 更新动画下拉列表
 */
function updateAnimaSelects() {
  const isLive2d = currentMod?.manifest?.mod_type === 'live2d';
  let allAnimas;
  
  if (isLive2d && currentMod.assets.live2d) {
    // Live2D: 使用 states 中的 state 名称作为动画名
    const live2d = currentMod.assets.live2d;
    const stateNames = (live2d.states || []).map(s => s.state);
    const motionNames = (live2d.motions || []).map(m => m.name);
    allAnimas = [...new Set([...stateNames, ...motionNames])];
  } else {
    allAnimas = [
      ...currentMod.assets.sequence.map(a => a.name),
      ...currentMod.assets.img.map(a => a.name)
    ];
  }
  
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
 * 获取所有持久状态名称
 */
function getPersistentStateNames() {
  const stateNames = new Set();

  // 普通状态
  if (Array.isArray(currentMod.manifest.states)) {
    currentMod.manifest.states.forEach(s => {
      if (s && s.name && s.persistent === true) stateNames.add(s.name);
    });
  }

  // 重要状态
  const importantStates = currentMod.manifest.important_states || {};
  for (const [key, state] of Object.entries(importantStates)) {
    if (state && state.name && state.persistent === true) stateNames.add(state.name);
  }

  return Array.from(stateNames);
}

/**
 * 获取所有非持久状态名称
 */
function getNonPersistentStateNames() {
  const stateNames = new Set();

  // 普通状态
  if (Array.isArray(currentMod.manifest.states)) {
    currentMod.manifest.states.forEach(s => {
      if (s && s.name && s.persistent !== true) stateNames.add(s.name);
    });
  }

  // 重要状态
  const importantStates = currentMod.manifest.important_states || {};
  for (const [key, state] of Object.entries(importantStates)) {
    if (state && state.name && state.persistent !== true) stateNames.add(state.name);
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

/**
 * 生成持久状态下拉选项HTML
 */
function getPersistentStateSelectOptions(currentValue = '') {
  const stateNames = getPersistentStateNames();
  let html = `<option value="">${window.i18n.t('select_state_placeholder')}</option>`;
  stateNames.forEach(name => {
    const selected = name === currentValue ? ' selected' : '';
    html += `<option value="${name}"${selected}>${name}</option>`;
  });
  return html;
}

/**
 * 生成非持久状态下拉选项HTML
 */
function getNonPersistentStateSelectOptions(currentValue = '') {
  const stateNames = getNonPersistentStateNames();
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
    card.className = 'state-card tb-sort-item';
    card.dataset.sortKey = ensureTbUid(state);
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

  // 允许拖拽排序（仅在未开启筛选时）
  enableTbSortable(stateList, {
    canStart: () => {
      if (!currentMod) return false;
      const ids = [
        'states-normal-filter-name',
        'states-normal-filter-anima',
        'states-normal-filter-audio',
        'states-normal-filter-text'
      ];
      const hasFilters = ids.some(id => (document.getElementById(id)?.value || '').trim());
      if (hasFilters) {
        showToast(window.i18n.t('msg_clear_filters_to_reorder') || '请先清空筛选条件再排序', 'warning');
        return false;
      }
      return true;
    },
    onSortedKeys: (orderedKeys) => {
      if (!currentMod) return;
      reorderArrayInPlaceByKeys(currentMod.manifest.states, orderedKeys, ensureTbUid);
      renderStates();
      markUnsaved();
    }
  });

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
  const stateOrder = ['silence', 'silence_start', 'silence_end', 'dragging', 'drag_start', 'drag_end', 'music_start', 'music_end', 'birthday', 'firstday'];

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
      <div class="tb-title-with-handle">
        ${renderSortHandleHtml()}
        <span class="state-card-title">${highlightNeedleHtml(displayName, nameNeedle)}</span>
      </div>
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
  ['state-limits-options', 'state-can-trigger-options', 'state-data-counter-options', 'state-live2d-params-options', 'state-branch-options'].forEach((id) => {
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

  // 触发计数范围
  document.getElementById('state-trigger-counter-start').value = Number.isFinite(Number(state.trigger_counter_start)) ? String(state.trigger_counter_start) : '-2147483648';
  document.getElementById('state-trigger-counter-end').value = Number.isFinite(Number(state.trigger_counter_end)) ? String(state.trigger_counter_end) : '2147483647';

  // 气温触发范围
  document.getElementById('state-trigger-temp-start').value = Number.isFinite(Number(state.trigger_temp_start)) ? String(state.trigger_temp_start) : '-2147483648';
  document.getElementById('state-trigger-temp-end').value = Number.isFinite(Number(state.trigger_temp_end)) ? String(state.trigger_temp_end) : '2147483647';

  // 启动时长触发门槛（分钟）
  document.getElementById('state-trigger-uptime').value = Number.isFinite(Number(state.trigger_uptime)) ? String(Math.max(0, parseInt(state.trigger_uptime))) : '0';

  // 天气触发条件（多选）

  {
    const el = document.getElementById('state-trigger-weather');
    const raw = state.trigger_weather;
    const values = Array.isArray(raw)
      ? raw.filter((v) => typeof v === 'string').map((v) => v.trim()).filter(Boolean)
      : (typeof raw === 'string' && raw.trim() ? [raw.trim()] : []);

    if (el && el.tagName === 'SELECT') {
      // 清理旧的“自定义”选项，避免反复打开弹窗累积
      Array.from(el.options)
        .filter((o) => o && o.dataset && o.dataset.custom === '1')
        .forEach((o) => o.remove());

      // 若现有值不在下拉列表内，动态插入“自定义”选项以避免数据丢失
      for (const v of values) {
        if (!Array.from(el.options).some((o) => o.value === v)) {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = `${v} - (custom)`;
          opt.dataset.custom = '1';
          el.appendChild(opt);
        }
      }

      // 先清空选中
      Array.from(el.options).forEach((o) => {
        o.selected = false;
      });

      // 再逐个选中
      for (const v of values) {
        const opt = Array.from(el.options).find((o) => o.value === v);
        if (opt) opt.selected = true;
      }
    } else if (el) {
      // 兼容旧输入框（单值）
      el.value = values[0] || '';
    }
  }





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
  
  // Live2D 参数覆写（仅 live2d 模式可见）
  const isLive2d = currentMod?.manifest?.mod_type === 'live2d';
  const live2dParamsPanel = document.getElementById('state-live2d-params-options');
  if (live2dParamsPanel) {
    live2dParamsPanel.style.display = isLive2d ? '' : 'none';
  }
  renderLive2DParams(state.live2d_params || []);

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
      <select data-can-trigger-state="${index}">${getNonPersistentStateSelectOptions(stateName)}</select>

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
    <select data-can-trigger-state="${index}">${getNonPersistentStateSelectOptions()}</select>

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
 * 渲染 Live2D 参数列表
 */
function renderLive2DParams(params) {
  const list = document.getElementById('live2d-param-list');
  list.innerHTML = '';

  if (!Array.isArray(params)) return;

  params.forEach((param, index) => {
    const item = document.createElement('div');
    item.className = 'branch-item';
    item.innerHTML = `
      <input type="text" data-live2d-param-id="${index}" value="${param.id || ''}" placeholder="ParamAngleX" style="flex:1;">
      <input type="number" data-live2d-param-value="${index}" value="${param.value ?? 0}" step="0.1" style="width:100px;">
      <button class="btn btn-sm btn-ghost" onclick="removeLive2DParam(${index})">🗑️</button>
    `;
    list.appendChild(item);
  });
}

/**
 * 添加 Live2D 参数项
 */
function addLive2DParam() {
  const list = document.getElementById('live2d-param-list');
  const index = list.children.length;

  const item = document.createElement('div');
  item.className = 'branch-item';
  item.innerHTML = `
    <input type="text" data-live2d-param-id="${index}" value="" placeholder="ParamAngleX" style="flex:1;">
    <input type="number" data-live2d-param-value="${index}" value="0" step="0.1" style="width:100px;">
    <button class="btn btn-sm btn-ghost" onclick="removeLive2DParam(${index})">🗑️</button>
  `;
  list.appendChild(item);
}

/**
 * 删除 Live2D 参数项
 */
function removeLive2DParam(index) {
  const params = collectLive2DParams() || [];
  params.splice(index, 1);
  renderLive2DParams(params);
}

/**
 * 收集 Live2D 参数列表
 */
function collectLive2DParams() {
  const list = document.getElementById('live2d-param-list');
  if (!list) return null;

  const params = [];
  list.querySelectorAll('[data-live2d-param-id]').forEach((el) => {
    const id = el.value.trim();
    const idx = el.getAttribute('data-live2d-param-id');
    const valEl = list.querySelector(`[data-live2d-param-value="${idx}"]`);
    const value = parseFloat(valEl?.value) || 0;
    if (id) {
      params.push({ id, value });
    }
  });

  return params.length > 0 ? params : null;
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

    trigger_counter_start: (() => {
      const n = parseInt(document.getElementById('state-trigger-counter-start').value);
      return Number.isFinite(n) ? n : -2147483648;
    })(),
    trigger_counter_end: (() => {
      const n = parseInt(document.getElementById('state-trigger-counter-end').value);
      return Number.isFinite(n) ? n : 2147483647;
    })(),

    trigger_temp_start: (() => {
      const n = parseInt(document.getElementById('state-trigger-temp-start').value);
      return Number.isFinite(n) ? n : -2147483648;
    })(),
    trigger_temp_end: (() => {
      const n = parseInt(document.getElementById('state-trigger-temp-end').value);
      return Number.isFinite(n) ? n : 2147483647;
    })(),

    trigger_uptime: (() => {
      const n = parseInt(document.getElementById('state-trigger-uptime').value);
      return Number.isFinite(n) ? Math.max(0, n) : 0;
    })(),

    trigger_weather: (() => {

      const el = document.getElementById('state-trigger-weather');
      if (!el) return [];

      // 多选下拉：返回已选项数组
      if (el.tagName === 'SELECT') {
        return Array.from(el.selectedOptions)
          .map((o) => String(o.value || '').trim())
          .filter(Boolean);
      }

      // 兼容旧输入框（单值）
      const t = String(el.value || '').trim();
      return t ? [t] : [];
    })(),


    branch_show_bubble: document.getElementById('state-branch-show-bubble').checked,
    mod_data_counter: collectDataCounter(),
    live2d_params: collectLive2DParams(),
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
      <select data-branch-state="${index}">${getNonPersistentStateSelectOptions(branch.next_state || '')}</select>

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
    <select data-branch-state="${index}">${getNonPersistentStateSelectOptions()}</select>

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
    card.className = 'state-card trigger-card tb-sort-item';
    card.dataset.sortKey = ensureTbUid(trigger);
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

  // 允许拖拽排序（仅在未开启筛选时）
  enableTbSortable(triggerList, {
    canStart: () => {
      if (!currentMod) return false;
      const hasFilter = (document.getElementById('triggers-filter-name')?.value || '').trim();
      if (hasFilter) {
        showToast(window.i18n.t('msg_clear_filters_to_reorder') || '请先清空筛选条件再排序', 'warning');
        return false;
      }
      return true;
    },
    onSortedKeys: (orderedKeys) => {
      if (!currentMod) return;
      reorderArrayInPlaceByKeys(currentMod.manifest.triggers, orderedKeys, ensureTbUid);
      renderTriggers();
      markUnsaved();
    }
  });

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
      <div class="tb-title-with-handle">
        ${renderSortHandleHtml()}
        <span class="state-card-title"><code class="trigger-event-code">${highlightNeedleHtml(eventName, nameNeedle)}</code></span>
      </div>
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
      return { persistent_state: '', states: [{ state: g, weight: 1 }], allow_repeat: true };
    }
    if (g && typeof g === 'object') {
      const persistent_state = typeof g.persistent_state === 'string' ? g.persistent_state : '';
      const allow_repeat = g.allow_repeat !== false; // 默认 true
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

      return { persistent_state, states, allow_repeat };
    }
    return { persistent_state: '', states: [], allow_repeat: true };
  };

  const groups = canTriggerStates.map(normalizeGroup);

  return groups.map(g => {
    const titleParts = [];
    if (g.persistent_state) {
      titleParts.push(`${escapeHtml(window.i18n.t('persistent_state_label'))}: <code>${escapeHtml(g.persistent_state)}</code>`);
    }
    if (!g.allow_repeat) {
      titleParts.push(`<span style="color: var(--warning-color);">🔄❌</span>`);
    }
    const title = titleParts.length > 0
      ? `<div class="trigger-state-group-title">${titleParts.join(' | ')}</div>`
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
    let allowRepeat = true; // 默认 true
    
    if (typeof group === 'string') {
      states = [{ state: group, weight: 1 }];
    } else if (group && typeof group === 'object') {
      persistentState = group.persistent_state || '';
      states = Array.isArray(group.states) ? group.states : [];
      // allow_repeat 默认为 true
      allowRepeat = group.allow_repeat !== false;
    }
    
    const statesHtml = states.map((s, stateIndex) => {
      const stateName = typeof s === 'string' ? s : (s.state || '');
      const weight = (s && typeof s === 'object' && Number.isFinite(s.weight)) ? s.weight : 1;
      return `
        <div class="trigger-state-row" data-group="${groupIndex}" data-state="${stateIndex}">
          <select data-trigger-state-name="${groupIndex}-${stateIndex}">${getNonPersistentStateSelectOptions(stateName)}</select>

          <input type="number" placeholder="${window.i18n.t('weight_label')}" value="${weight}" min="1" data-trigger-state-weight="${groupIndex}-${stateIndex}" style="width: 70px;">
          <button class="btn btn-sm btn-ghost" onclick="removeTriggerState(${groupIndex}, ${stateIndex})">🗑️</button>
        </div>
      `;
    }).join('');
    
    div.innerHTML = `
      <div class="trigger-group-header">
        <div class="form-group" style="flex: 1; margin: 0;">
        <label>${window.i18n.t('persistent_state_label')}</label>
        <select data-trigger-persistent="${groupIndex}">${getPersistentStateSelectOptions(persistentState)}</select>

        </div>
        <div class="form-group" style="margin: 0; margin-left: 12px;">
          <label title="${window.i18n.t('allow_repeat_hint')}" style="cursor: help;">
            <input type="checkbox" data-trigger-allow-repeat="${groupIndex}" ${allowRepeat ? 'checked' : ''}>
            ${window.i18n.t('allow_repeat_label')}
          </label>
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
        <select data-trigger-persistent="${groupIndex}">${getPersistentStateSelectOptions()}</select>
      </div>

      <div class="form-group" style="margin: 0; margin-left: 12px;">
        <label title="${window.i18n.t('allow_repeat_hint')}" style="cursor: help;">
          <input type="checkbox" data-trigger-allow-repeat="${groupIndex}" checked>
          ${window.i18n.t('allow_repeat_label')}
        </label>
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
    <select data-trigger-state-name="${groupIndex}-${stateIndex}">${getNonPersistentStateSelectOptions()}</select>

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
    
    // 重新索引 allow_repeat checkbox
    const allowRepeatCheckbox = groupDiv.querySelector('[data-trigger-allow-repeat]');
    if (allowRepeatCheckbox) {
      allowRepeatCheckbox.dataset.triggerAllowRepeat = groupIndex;
    }
    
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
    const allowRepeatCheckbox = groupDiv.querySelector(`[data-trigger-allow-repeat="${groupIndex}"]`);
    const allowRepeat = allowRepeatCheckbox ? allowRepeatCheckbox.checked : true;
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
        states: states,
        allow_repeat: allowRepeat
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
  
  const isLive2d = currentMod.manifest.mod_type === 'live2d';
  toggleAssetSections(isLive2d ? 'live2d' : 'sequence');
  
  if (isLive2d) {
    renderLive2dAssets();
  } else {
    renderAssetList('sequence', currentMod.assets.sequence);
    renderAssetList('img', currentMod.assets.img);
  }
  updateAnimaSelects();
}

/**
 * 渲染单个资源列表
 */
function renderAssetList(type, assets) {
  if (!currentMod) return;
  const list = document.getElementById(`${type}-list`);
  list.innerHTML = '';

  // “一键导入”按钮：仅当该区域没有任何条目时可用
  const importBtn = document.getElementById(`assets-${type}-import-btn`);
  if (importBtn) {
    importBtn.disabled = Array.isArray(assets) ? assets.length > 0 : true;
  }

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
    card.className = 'asset-card tb-sort-item';
    card.dataset.sortKey = ensureTbUid(asset);
    card.innerHTML = `
      <div class="asset-card-header">
        <div class="tb-title-with-handle">
          ${renderSortHandleHtml()}
          <span class="asset-card-name">${highlightNeedleHtml(assetName, nameNeedleRaw)}</span>
        </div>
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

  // 允许拖拽排序（仅在未开启筛选时）
  enableTbSortable(list, {
    canStart: () => {
      if (!currentMod) return false;
      const ids = [`assets-${type}-filter-name`, `assets-${type}-filter-path`];
      const hasFilters = ids.some(id => (document.getElementById(id)?.value || '').trim());
      if (hasFilters) {
        showToast(window.i18n.t('msg_clear_filters_to_reorder') || '请先清空筛选条件再排序', 'warning');
        return false;
      }
      return true;
    },
    onSortedKeys: (orderedKeys) => {
      if (!currentMod) return;
      reorderArrayInPlaceByKeys(assets, orderedKeys, ensureTbUid);
      renderAssets();
      markUnsaved();
    }
  });

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

function isImageFileName(fileName) {
  const name = String(fileName || '').toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  const ext = name.slice(dot + 1);
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext);
}

async function importSingleAssetEntry(type) {
  if (!currentMod || !currentMod.assets) return;
  if (type !== 'sequence' && type !== 'img') return;

  if (!modFolderHandle) {
    showToast(window.i18n.t('msg_import_assets_need_folder') || '需要从文件夹打开 Mod 才能导入图片资源', 'warning');
    return;
  }

  try {
    const [fileHandle] = await window.showOpenFilePicker({
      multiple: false,
      types: [
        {
          description: 'Image',
          accept: {
            'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']
          }
        }
      ]
    });

    const file = await fileHandle.getFile();
    if (!file || !file.name) return;
    if (!isImageFileName(file.name)) {
      showToast(window.i18n.t('msg_import_assets_failed') || '导入失败：未找到资源目录或无权限', 'error');
      return;
    }

    const targetDir = await getOrCreateDir(modFolderHandle, ['asset', type]);
    const fileName = await writeFileToDir(targetDir, file);

    let frameSizeX = 260;
    let frameSizeY = 298;
    try {
      const size = await getImageSizeFromFile(file);
      if (size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0) {
        frameSizeX = Math.floor(size.width);
        frameSizeY = Math.floor(size.height);
      }
    } catch (e) {
      // ignore
    }

    if (!Array.isArray(currentMod.assets[type])) {
      currentMod.assets[type] = [];
    }

    currentMod.assets[type].push({
      name: stripFileExt(fileName),
      img: `${type}/${fileName}`,
      sequence: type === 'sequence',
      origin_reverse: false,
      need_reverse: false,
      frame_time: 0.1,
      frame_size_x: frameSizeX,
      frame_size_y: frameSizeY,
      frame_num_x: 1,
      frame_num_y: 1,
      offset_x: 0,
      offset_y: 0
    });

    renderAssets();
    markUnsaved();
    showToast((window.i18n.t('msg_import_assets_success') || '已导入 {count} 个图片文件').replace('{count}', '1'), 'success');
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    showToast(window.i18n.t('msg_import_assets_failed') || '导入失败：未找到资源目录或无权限', 'error');
  }
}

async function importAssetEntries(type) {
  if (!currentMod || !currentMod.assets) return;
  if (type !== 'sequence' && type !== 'img') return;

  const existing = currentMod.assets[type] || [];
  if (existing.length > 0) return;

  if (!modFolderHandle) {
    showToast(window.i18n.t('msg_import_assets_need_folder') || '需要从文件夹打开 Mod 才能导入图片资源', 'warning');
    return;
  }


  const dirLabel = `asset/${type}/`;

  try {
    const assetDir = await modFolderHandle.getDirectoryHandle('asset');
    const typeDir = await assetDir.getDirectoryHandle(type);

    const fileHandles = [];
    for await (const entry of typeDir.values()) {
      if (entry.kind !== 'file') continue;
      if (!isImageFileName(entry.name)) continue;
      fileHandles.push(entry);
    }

    fileHandles.sort((a, b) => String(a.name).localeCompare(String(b.name)));

    if (fileHandles.length === 0) {
      const msg = (window.i18n.t('msg_import_assets_no_files') || '未在 {dir} 目录找到任何图片文件').replace('{dir}', dirLabel);
      showToast(msg, 'warning');
      return;
    }

    const defaultFrameSize = { x: 260, y: 298 };

    const imported = [];
    for (const fh of fileHandles) {
      const fileName = fh.name;
      const imgPath = `${type}/${fileName}`;

      let frameSizeX = defaultFrameSize.x;
      let frameSizeY = defaultFrameSize.y;
      try {
        const file = await fh.getFile();
        const size = await getImageSizeFromFile(file);
        if (size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0) {
          frameSizeX = Math.floor(size.width);
          frameSizeY = Math.floor(size.height);
        }
      } catch (e) {
        // ignore
      }

      imported.push({
        name: stripFileExt(fileName),
        img: imgPath,
        sequence: type === 'sequence',
        origin_reverse: false,
        need_reverse: false,
        frame_time: 0.1,
        frame_size_x: frameSizeX,
        frame_size_y: frameSizeY,
        frame_num_x: 1,
        frame_num_y: 1,
        offset_x: 0,
        offset_y: 0
      });
    }

    currentMod.assets[type] = imported;
    renderAssets();
    markUnsaved();

    const msg = (window.i18n.t('msg_import_assets_success') || '已导入 {count} 个图片文件').replace('{count}', String(imported.length));
    showToast(msg, 'success');
  } catch (e) {
    showToast(window.i18n.t('msg_import_assets_failed') || '导入失败：未找到资源目录或无权限', 'error');
  }
}


// ============================================================================
// Live2D 资源管理
// ============================================================================

/**
 * 获取当前 Mod 类型
 */
function getModType() {
  return currentMod?.manifest?.mod_type || 'sequence';
}

/**
 * 切换资产编辑区显示
 */
function toggleAssetSections(modType) {
  const seqSection = document.getElementById('assets-sequence-section');
  const live2dSection = document.getElementById('assets-live2d-section');
  const descEl = document.getElementById('assets-desc-text');
  
  if (modType === 'live2d') {
    if (seqSection) seqSection.style.display = 'none';
    if (live2dSection) live2dSection.style.display = '';
    if (descEl) descEl.setAttribute('data-i18n', 'assets_desc_live2d');
    if (descEl) descEl.textContent = window.i18n.t('assets_desc_live2d');
  } else {
    if (seqSection) seqSection.style.display = '';
    if (live2dSection) live2dSection.style.display = 'none';
    if (descEl) descEl.setAttribute('data-i18n', 'assets_desc');
    if (descEl) descEl.textContent = window.i18n.t('assets_desc');
  }
}

/**
 * 确保 live2d 数据对象存在
 */
function ensureLive2dData() {
  if (!currentMod.assets.live2d) {
    currentMod.assets.live2d = {
      schema_version: 1,
      model: {
        name: '',
        base_dir: 'asset/live2d/',
        model_json: '',
        textures_dir: '',
        motions_dir: '',
        expressions_dir: '',
        physics_json: '',
        pose_json: '',
        eye_blink: true,
        lip_sync: true
      },
      motions: [],
      expressions: [],
      states: []
    };
  }
  return currentMod.assets.live2d;
}

/**
 * 渲染 Live2D 资产编辑区
 */
function renderLive2dAssets() {
  if (!currentMod) return;
  const live2d = ensureLive2dData();
  
  // 填充模型配置表单
  populateLive2dModelForm(live2d.model);
  
  // 渲染动作列表
  renderLive2dMotions(live2d.motions || []);
  
  // 渲染表情列表
  renderLive2dExpressions(live2d.expressions || []);
  
  // 渲染状态映射列表
  renderLive2dStates(live2d.states || []);
}

/**
 * 填充 Live2D 模型配置表单
 */
function populateLive2dModelForm(model) {
  if (!model) return;
  document.getElementById('live2d-model-name').value = model.name || '';
  document.getElementById('live2d-base-dir').value = model.base_dir || '';
  document.getElementById('live2d-model-json').value = model.model_json || '';
  document.getElementById('live2d-textures-dir').value = model.textures_dir || '';
  document.getElementById('live2d-motions-dir').value = model.motions_dir || '';
  document.getElementById('live2d-expressions-dir').value = model.expressions_dir || '';
  document.getElementById('live2d-physics-json').value = model.physics_json || '';
  document.getElementById('live2d-pose-json').value = model.pose_json || '';
  document.getElementById('live2d-eye-blink').checked = model.eye_blink !== false;
  document.getElementById('live2d-lip-sync').checked = model.lip_sync !== false;
  
  // 添加变化监听
  const inputs = document.querySelectorAll('#assets-live2d-section input');
  inputs.forEach(input => {
    input.removeEventListener('change', onLive2dFormChange);
    input.addEventListener('change', onLive2dFormChange);
    input.removeEventListener('input', onLive2dFormChange);
    input.addEventListener('input', onLive2dFormChange);
  });
}

function onLive2dFormChange() {
  markUnsaved();
}

/**
 * 收集 Live2D 模型配置数据
 */
function collectLive2dModelData() {
  if (!currentMod || !currentMod.assets.live2d) return;
  const model = currentMod.assets.live2d.model;
  if (!model) return;
  
  model.name = document.getElementById('live2d-model-name').value.trim();
  model.base_dir = document.getElementById('live2d-base-dir').value.trim();
  model.model_json = document.getElementById('live2d-model-json').value.trim();
  model.textures_dir = document.getElementById('live2d-textures-dir').value.trim();
  model.motions_dir = document.getElementById('live2d-motions-dir').value.trim();
  model.expressions_dir = document.getElementById('live2d-expressions-dir').value.trim();
  model.physics_json = document.getElementById('live2d-physics-json').value.trim();
  model.pose_json = document.getElementById('live2d-pose-json').value.trim();
  model.eye_blink = document.getElementById('live2d-eye-blink').checked;
  model.lip_sync = document.getElementById('live2d-lip-sync').checked;
}

/**
 * 递归扫描 parentDirHandle 下的子目录，找到第一个包含指定扩展名文件的目录
 * 返回相对于 parentDirHandle 的路径（如 "motions"），未找到返回空字符串
 */
async function _findSubdirContainingExt(parentDirHandle, ext, basePath = '') {
  const extLower = ext.toLowerCase();
  try {
    for await (const entry of parentDirHandle.values()) {
      if (entry.kind === 'file' && entry.name.toLowerCase().endsWith(extLower)) {
        // 当前目录就包含目标文件
        return basePath;
      }
    }
    // 当前目录没有，递归子目录
    for await (const entry of parentDirHandle.values()) {
      if (entry.kind === 'directory') {
        const subPath = basePath ? `${basePath}/${entry.name}` : entry.name;
        const result = await _findSubdirContainingExt(entry, ext, subPath);
        if (result !== '') return result;
      }
    }
  } catch (e) {
    // 忽略无法访问的目录
  }
  return '';
}

/**
 * 导航到 Live2D 的 base_dir 并定位 model3.json，返回 { dirHandle, modelJson, live2d } 供后续使用
 * 如果 base_dir 为空则使用默认值；如果 model_json 为空则自动扫描
 */
async function _resolveLive2dBaseDir() {
  if (!currentMod) {
    showToast(window.i18n.t('msg_load_mod_first'), 'warning');
    return null;
  }
  if (!modFolderHandle) {
    showToast(window.i18n.t('msg_sync_need_folder'), 'warning');
    return null;
  }

  collectLive2dModelData();
  const live2d = ensureLive2dData();
  let baseDir = (live2d.model.base_dir || '').trim();
  let modelJson = (live2d.model.model_json || '').trim();

  if (!baseDir) {
    baseDir = 'asset/live2d/';
    live2d.model.base_dir = baseDir;
  }

  const baseParts = baseDir.replace(/\\/g, '/').split('/').filter(Boolean);
  let dirHandle = modFolderHandle;
  for (const part of baseParts) {
    dirHandle = await dirHandle.getDirectoryHandle(part);
  }

  // 如果 model_json 为空，自动扫描 base_dir 下的 .model3.json 文件
  if (!modelJson) {
    const model3Files = [];
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.model3.json')) {
        model3Files.push(entry.name);
      }
    }
    if (model3Files.length === 0) {
      showToast(window.i18n.t('msg_sync_no_model3_found'), 'warning');
      return null;
    }
    if (model3Files.length === 1) {
      modelJson = model3Files[0];
    } else {
      const choice = prompt(
        window.i18n.t('msg_sync_choose_model3').replace('{files}', model3Files.join('\n')),
        model3Files[0]
      );
      if (!choice) return null;
      modelJson = choice.trim();
    }
    live2d.model.model_json = modelJson;
  }

  return { dirHandle, modelJson, live2d };
}

/**
 * 从文件同步 Live2D 模型配置
 * 自动扫描 base_dir 下的 .model3.json，推断并填充模型配置字段
 */
async function syncLive2dConfigFromFiles() {
  if (!confirm(window.i18n.t('msg_sync_config_confirm'))) return;

  try {
    const resolved = await _resolveLive2dBaseDir();
    if (!resolved) return;
    const { dirHandle, modelJson, live2d } = resolved;

    // 读取 model3.json
    const modelFileHandle = await dirHandle.getFileHandle(modelJson);
    const modelFile = await modelFileHandle.getFile();
    const modelText = await modelFile.text();
    const modelData = JSON.parse(modelText);

    const fileRefs = modelData.FileReferences || modelData.fileReferences || {};

    // --- 自动推断模型名称（从 model3.json 文件名推导） ---
    if (!live2d.model.name) {
      live2d.model.name = modelJson.replace(/\.model3\.json$/i, '');
    }

    // --- 解析模型基础信息 ---
    // 物理文件
    live2d.model.physics_json = fileRefs.Physics || fileRefs.physics || '';

    // 姿势文件
    live2d.model.pose_json = fileRefs.Pose || fileRefs.pose || '';

    // 纹理目录（从第一个纹理路径提取目录名）
    const textures = fileRefs.Textures || fileRefs.textures || [];
    if (textures.length > 0) {
      const firstTex = String(textures[0] || '');
      const texDir = firstTex.includes('/') ? firstTex.substring(0, firstTex.lastIndexOf('/')) : '';
      live2d.model.textures_dir = texDir;
    }

    // 动作目录（直接扫描 base_dir 下包含 .motion3.json 文件的子目录）
    live2d.model.motions_dir = await _findSubdirContainingExt(dirHandle, '.motion3.json');

    // 表情目录（直接扫描 base_dir 下包含 .exp3.json 文件的子目录）
    live2d.model.expressions_dir = await _findSubdirContainingExt(dirHandle, '.exp3.json');

    // EyeBlink / LipSync（从 Groups 读取）
    const groups = modelData.Groups || modelData.groups || [];
    let hasEyeBlink = false;
    let hasLipSync = false;
    for (const g of groups) {
      const name = (g.Name || g.name || '').toLowerCase();
      if (name === 'eyeblink') hasEyeBlink = true;
      if (name === 'lipsync') hasLipSync = true;
    }
    live2d.model.eye_blink = hasEyeBlink;
    live2d.model.lip_sync = hasLipSync;

    // 回写模型配置到表单
    populateLive2dModelForm(live2d.model);
    markUnsaved();

    showToast(window.i18n.t('msg_sync_config_success'), 'success');
  } catch (err) {
    console.error('syncLive2dConfigFromFiles error:', err);
    if (err.name === 'NotFoundError' || err.message?.includes('not found')) {
      showToast(window.i18n.t('msg_sync_model_not_found'), 'error');
    } else {
      const msg = window.i18n.t('msg_sync_failed').replace('{error}', err.message || String(err));
      showToast(msg, 'error');
    }
  }
}

/**
 * 从文件同步 Live2D 资产（动作、表情、状态-动画映射）
 * 根据已配置好的模型配置，从 model3.json 中读取动作和表情列表并同步状态映射
 */
async function syncLive2dAssetsFromFiles() {
  if (!confirm(window.i18n.t('msg_sync_assets_confirm'))) return;

  try {
    const resolved = await _resolveLive2dBaseDir();
    if (!resolved) return;
    const { dirHandle, modelJson, live2d } = resolved;

    // 读取 model3.json
    const modelFileHandle = await dirHandle.getFileHandle(modelJson);
    const modelFile = await modelFileHandle.getFile();
    const modelText = await modelFile.text();
    const modelData = JSON.parse(modelText);

    const fileRefs = modelData.FileReferences || modelData.fileReferences || {};
    const rawMotions = fileRefs.Motions || fileRefs.motions || {};
    const rawExpressions = fileRefs.Expressions || fileRefs.expressions || [];

    // --- 解析动作列表（从 model3.json） ---
    const newMotions = [];
    const motionFilesSeen = new Set(); // 用于去重
    for (const [groupName, motionArr] of Object.entries(rawMotions)) {
      if (!Array.isArray(motionArr)) continue;
      for (const m of motionArr) {
        const file = m.File || m.file || '';
        const baseName = file.replace(/\\/g, '/').split('/').pop().replace(/\.motion3\.json$/i, '').replace(/\.json$/i, '');
        motionFilesSeen.add(file.replace(/\\/g, '/'));
        newMotions.push({
          name: baseName,
          file: file,
          group: groupName || 'Default',
          priority: groupName === 'Idle' ? 'Idle' : 'Normal',
          fade_in_ms: m.FadeInTime != null ? Math.round(m.FadeInTime * 1000) : 200,
          fade_out_ms: m.FadeOutTime != null ? Math.round(m.FadeOutTime * 1000) : 200,
          loop: groupName === 'Idle'
        });
      }
    }

    // --- 从动作目录补充（扫描文件系统中的 .motion3.json） ---
    const motionsDir = (live2d.model.motions_dir || '').trim();
    if (motionsDir) {
      try {
        const motionsDirParts = motionsDir.replace(/\\/g, '/').split('/').filter(Boolean);
        let motionsDirHandle = dirHandle;
        for (const part of motionsDirParts) {
          motionsDirHandle = await motionsDirHandle.getDirectoryHandle(part);
        }
        for await (const entry of motionsDirHandle.values()) {
          if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.motion3.json')) {
            const filePath = `${motionsDir}/${entry.name}`;
            if (!motionFilesSeen.has(filePath.replace(/\\/g, '/'))) {
              const baseName = entry.name.replace(/\.motion3\.json$/i, '');
              newMotions.push({
                name: baseName,
                file: filePath,
                group: 'Default',
                priority: 'Normal',
                fade_in_ms: 200,
                fade_out_ms: 200,
                loop: false
              });
            }
          }
        }
      } catch (e) {
        // 动作目录不存在或无法访问，跳过
      }
    }

    // --- 解析表情列表（从 model3.json） ---
    const newExpressions = [];
    const exprFilesSeen = new Set();
    if (Array.isArray(rawExpressions)) {
      for (const e of rawExpressions) {
        const name = e.Name || e.name || '';
        const file = e.File || e.file || '';
        exprFilesSeen.add(file.replace(/\\/g, '/'));
        newExpressions.push({ name, file });
      }
    }

    // --- 从表情目录补充（扫描文件系统中的 .exp3.json） ---
    const expressionsDir = (live2d.model.expressions_dir || '').trim();
    if (expressionsDir) {
      try {
        const exprDirParts = expressionsDir.replace(/\\/g, '/').split('/').filter(Boolean);
        let exprDirHandle = dirHandle;
        for (const part of exprDirParts) {
          exprDirHandle = await exprDirHandle.getDirectoryHandle(part);
        }
        for await (const entry of exprDirHandle.values()) {
          if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.exp3.json')) {
            const filePath = `${expressionsDir}/${entry.name}`;
            if (!exprFilesSeen.has(filePath.replace(/\\/g, '/'))) {
              const baseName = entry.name.replace(/\.exp3\.json$/i, '');
              newExpressions.push({ name: baseName, file: filePath });
            }
          }
        }
      } catch (e) {
        // 表情目录不存在或无法访问，跳过
      }
    }

    // 覆盖动作和表情
    live2d.motions = newMotions;
    live2d.expressions = newExpressions;

    // --- 同步状态-动画映射 (states) ---
    const existingStatesMap = {};
    if (Array.isArray(live2d.states)) {
      for (const s of live2d.states) {
        if (s.state) existingStatesMap[s.state] = s;
      }
    }
    const newStates = [];
    for (const motion of newMotions) {
      if (existingStatesMap[motion.name]) {
        newStates.push(existingStatesMap[motion.name]);
      } else {
        newStates.push({
          state: motion.name,
          motion: motion.name,
          expression: '',
          scale: 1,
          offset_x: 0,
          offset_y: 0
        });
      }
    }
    live2d.states = newStates;

    // 刷新 UI
    renderLive2dAssets();
    updateAnimaSelects();
    markUnsaved();

    const msg = window.i18n.t('msg_sync_assets_success')
      .replace('{motions}', newMotions.length)
      .replace('{expressions}', newExpressions.length);
    showToast(msg, 'success');
  } catch (err) {
    console.error('syncLive2dAssetsFromFiles error:', err);
    if (err.name === 'NotFoundError' || err.message?.includes('not found')) {
      showToast(window.i18n.t('msg_sync_model_not_found'), 'error');
    } else {
      const msg = window.i18n.t('msg_sync_failed').replace('{error}', err.message || String(err));
      showToast(msg, 'error');
    }
  }
}

/**
 * 渲染 Live2D 动作列表（支持筛选、高亮、拖拽、复制）
 */
function renderLive2dMotions(motions) {
  const list = document.getElementById('live2d-motions-list');
  if (!list) return;
  list.innerHTML = '';

  const nameRaw = (document.getElementById('live2d-motions-filter-name')?.value || '').trim();
  const fileRaw = (document.getElementById('live2d-motions-filter-file')?.value || '').trim();
  const nameNdl = nameRaw.toLowerCase();
  const fileNdl = fileRaw.toLowerCase();

  motions.forEach((motion, index) => {
    const mName = String(motion.name || '');
    const mFile = String(motion.file || '');
    if (nameNdl && !mName.toLowerCase().includes(nameNdl)) return;
    if (fileNdl && !mFile.toLowerCase().includes(fileNdl)) return;

    const card = document.createElement('div');
    card.className = 'asset-card tb-sort-item';
    card.dataset.sortKey = ensureTbUid(motion);
    card.innerHTML = `
      <div class="asset-card-header">
        <div class="tb-title-with-handle">
          ${renderSortHandleHtml()}
          <span class="asset-card-name">${highlightNeedleHtml(mName, nameRaw)}</span>
        </div>
        <div class="asset-card-actions">
          <button class="btn btn-sm btn-ghost" onclick="copyLive2dItem('motion', ${index})" title="${window.i18n.t('btn_copy_to_clipboard')}">📋</button>
          <button class="btn btn-sm btn-ghost" onclick="editLive2dMotion(${index})">✏️</button>
          <button class="btn btn-sm btn-ghost" onclick="deleteLive2dMotion(${index})">🗑️</button>
        </div>
      </div>
      <div class="asset-card-body">
        <div class="asset-field"><span class="label">${window.i18n.t('live2d_motion_file_label')}:</span> ${highlightNeedleHtml(mFile, fileRaw)}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('live2d_motion_group_label')}:</span> ${escapeHtml(motion.group || '')}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('live2d_motion_priority_label')}:</span> ${escapeHtml(motion.priority || '')}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('live2d_motion_loop_label')}:</span> ${motion.loop ? window.i18n.t('yes') : window.i18n.t('no')}</div>
      </div>
    `;
    list.appendChild(card);
  });
  
  // 底部按钮
  const footer = document.createElement('div');
  footer.className = 'section-footer';
  footer.innerHTML = `
    <button class="btn btn-sm btn-ghost" onclick="pasteLive2dItem('motion')">📋 <span>${window.i18n.t('btn_paste_from_clipboard')}</span></button>
    <button class="btn btn-sm btn-primary" onclick="addLive2dMotion()">➕ <span>${window.i18n.t('btn_add_motion')}</span></button>
  `;
  list.appendChild(footer);

  // 拖拽排序
  enableTbSortable(list, {
    canStart: () => {
      const ids = ['live2d-motions-filter-name', 'live2d-motions-filter-file'];
      const hasFilters = ids.some(id => (document.getElementById(id)?.value || '').trim());
      if (hasFilters) {
        showToast(window.i18n.t('msg_clear_filters_to_reorder'), 'warning');
        return false;
      }
      return true;
    },
    onSortedKeys: (orderedKeys) => {
      if (!currentMod) return;
      const live2d = ensureLive2dData();
      reorderArrayInPlaceByKeys(live2d.motions, orderedKeys, ensureTbUid);
      renderLive2dAssets();
      updateAnimaSelects();
      markUnsaved();
    }
  });
}

/**
 * 渲染 Live2D 表情列表（支持筛选、高亮、拖拽、复制）
 */
function renderLive2dExpressions(expressions) {
  const list = document.getElementById('live2d-expressions-list');
  if (!list) return;
  list.innerHTML = '';

  const nameRaw = (document.getElementById('live2d-expressions-filter-name')?.value || '').trim();
  const fileRaw = (document.getElementById('live2d-expressions-filter-file')?.value || '').trim();
  const nameNdl = nameRaw.toLowerCase();
  const fileNdl = fileRaw.toLowerCase();

  expressions.forEach((expr, index) => {
    const eName = String(expr.name || '');
    const eFile = String(expr.file || '');
    if (nameNdl && !eName.toLowerCase().includes(nameNdl)) return;
    if (fileNdl && !eFile.toLowerCase().includes(fileNdl)) return;

    const card = document.createElement('div');
    card.className = 'asset-card tb-sort-item';
    card.dataset.sortKey = ensureTbUid(expr);
    card.innerHTML = `
      <div class="asset-card-header">
        <div class="tb-title-with-handle">
          ${renderSortHandleHtml()}
          <span class="asset-card-name">${highlightNeedleHtml(eName, nameRaw)}</span>
        </div>
        <div class="asset-card-actions">
          <button class="btn btn-sm btn-ghost" onclick="copyLive2dItem('expression', ${index})" title="${window.i18n.t('btn_copy_to_clipboard')}">📋</button>
          <button class="btn btn-sm btn-ghost" onclick="editLive2dExpression(${index})">✏️</button>
          <button class="btn btn-sm btn-ghost" onclick="deleteLive2dExpression(${index})">🗑️</button>
        </div>
      </div>
      <div class="asset-card-body">
        <div class="asset-field"><span class="label">${window.i18n.t('live2d_expr_file_label')}:</span> ${highlightNeedleHtml(eFile, fileRaw)}</div>
      </div>
    `;
    list.appendChild(card);
  });
  
  const footer = document.createElement('div');
  footer.className = 'section-footer';
  footer.innerHTML = `
    <button class="btn btn-sm btn-ghost" onclick="pasteLive2dItem('expression')">📋 <span>${window.i18n.t('btn_paste_from_clipboard')}</span></button>
    <button class="btn btn-sm btn-primary" onclick="addLive2dExpression()">➕ <span>${window.i18n.t('btn_add_expression')}</span></button>
  `;
  list.appendChild(footer);

  // 拖拽排序
  enableTbSortable(list, {
    canStart: () => {
      const ids = ['live2d-expressions-filter-name', 'live2d-expressions-filter-file'];
      const hasFilters = ids.some(id => (document.getElementById(id)?.value || '').trim());
      if (hasFilters) {
        showToast(window.i18n.t('msg_clear_filters_to_reorder'), 'warning');
        return false;
      }
      return true;
    },
    onSortedKeys: (orderedKeys) => {
      if (!currentMod) return;
      const live2d = ensureLive2dData();
      reorderArrayInPlaceByKeys(live2d.expressions, orderedKeys, ensureTbUid);
      renderLive2dAssets();
      updateAnimaSelects();
      markUnsaved();
    }
  });
}

/**
 * 渲染 Live2D 状态映射列表（支持筛选、高亮、拖拽、复制）
 */
function renderLive2dStates(states) {
  const list = document.getElementById('live2d-states-list');
  if (!list) return;
  list.innerHTML = '';

  const nameRaw = (document.getElementById('live2d-states-filter-name')?.value || '').trim();
  const motionRaw = (document.getElementById('live2d-states-filter-motion')?.value || '').trim();
  const exprRaw = (document.getElementById('live2d-states-filter-expression')?.value || '').trim();
  const nameNdl = nameRaw.toLowerCase();
  const motionNdl = motionRaw.toLowerCase();
  const exprNdl = exprRaw.toLowerCase();

  // 收集已有 manifest 状态名称集合，用于判断「新增同名状态」按钮是否可用
  const existingManifestStateNames = new Set(
    getAllStateNames().map(n => String(n || '').trim()).filter(Boolean)
  );

  states.forEach((state, index) => {
    const sName = String(state.state || '');
    const sMotion = String(state.motion || '');
    const sExpr = String(state.expression || '');
    if (nameNdl && !sName.toLowerCase().includes(nameNdl)) return;
    if (motionNdl && !sMotion.toLowerCase().includes(motionNdl)) return;
    if (exprNdl && !sExpr.toLowerCase().includes(exprNdl)) return;

    const trimmedName = sName.trim();
    const canAddState = !!trimmedName && !existingManifestStateNames.has(trimmedName);
    const addStateBtnHtml = `
      <button class="btn btn-sm btn-secondary" onclick="addSameNameStateFromLive2dState(${index})" ${canAddState ? '' : 'disabled'}>
        ➕ <span>${window.i18n.t('btn_add_same_name_state')}</span>
      </button>
    `;

    const card = document.createElement('div');
    card.className = 'asset-card tb-sort-item';
    card.dataset.sortKey = ensureTbUid(state);
    card.innerHTML = `
      <div class="asset-card-header">
        <div class="tb-title-with-handle">
          ${renderSortHandleHtml()}
          <span class="asset-card-name">${highlightNeedleHtml(sName, nameRaw)}</span>
        </div>
        <div class="asset-card-actions">
          ${addStateBtnHtml}
          <button class="btn btn-sm btn-ghost" onclick="copyLive2dItem('state', ${index})" title="${window.i18n.t('btn_copy_to_clipboard')}">📋</button>
          <button class="btn btn-sm btn-ghost" onclick="editLive2dState(${index})">✏️</button>
          <button class="btn btn-sm btn-ghost" onclick="deleteLive2dState(${index})">🗑️</button>
        </div>
      </div>
      <div class="asset-card-body">
        <div class="asset-field"><span class="label">${window.i18n.t('live2d_state_motion_label')}:</span> ${highlightNeedleHtml(sMotion, motionRaw)}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('live2d_state_expression_label')}:</span> ${highlightNeedleHtml(sExpr, exprRaw)}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('live2d_state_scale_label')}:</span> ${state.scale ?? 1.0}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('live2d_state_offset_x_label')}/${window.i18n.t('live2d_state_offset_y_label')}:</span> ${state.offset_x ?? 0}, ${state.offset_y ?? 0}</div>
      </div>
    `;
    list.appendChild(card);
  });
  
  const footer = document.createElement('div');
  footer.className = 'section-footer';
  footer.innerHTML = `
    <button class="btn btn-sm btn-ghost" onclick="pasteLive2dItem('state')">📋 <span>${window.i18n.t('btn_paste_from_clipboard')}</span></button>
    <button class="btn btn-sm btn-primary" onclick="addLive2dState()">➕ <span>${window.i18n.t('btn_add_live2d_state')}</span></button>
  `;
  list.appendChild(footer);

  // 拖拽排序
  enableTbSortable(list, {
    canStart: () => {
      const ids = ['live2d-states-filter-name', 'live2d-states-filter-motion', 'live2d-states-filter-expression'];
      const hasFilters = ids.some(id => (document.getElementById(id)?.value || '').trim());
      if (hasFilters) {
        showToast(window.i18n.t('msg_clear_filters_to_reorder'), 'warning');
        return false;
      }
      return true;
    },
    onSortedKeys: (orderedKeys) => {
      if (!currentMod) return;
      const live2d = ensureLive2dData();
      reorderArrayInPlaceByKeys(live2d.states, orderedKeys, ensureTbUid);
      renderLive2dAssets();
      updateAnimaSelects();
      markUnsaved();
    }
  });
}

/**
 * 获取动作名称选项 HTML
 */
function getMotionSelectOptions(currentValue = '') {
  const live2d = currentMod?.assets?.live2d;
  const motions = live2d?.motions || [];
  let html = `<option value="">${window.i18n.t('select_motion_placeholder')}</option>`;
  motions.forEach(m => {
    const selected = m.name === currentValue ? ' selected' : '';
    html += `<option value="${escapeHtml(m.name)}"${selected}>${escapeHtml(m.name)}</option>`;
  });
  return html;
}

/**
 * 获取表情名称选项 HTML
 */
function getExpressionSelectOptions(currentValue = '') {
  const live2d = currentMod?.assets?.live2d;
  const expressions = live2d?.expressions || [];
  let html = `<option value="">${window.i18n.t('select_expression_placeholder')}</option>`;
  expressions.forEach(e => {
    const selected = e.name === currentValue ? ' selected' : '';
    html += `<option value="${escapeHtml(e.name)}"${selected}>${escapeHtml(e.name)}</option>`;
  });
  return html;
}

// --- Live2D Motion CRUD ---

function addLive2dMotion() {
  const live2d = ensureLive2dData();
  openLive2dMotionModal(window.i18n.t('btn_add_motion'), {
    name: '',
    file: '',
    group: 'Default',
    priority: 'Normal',
    fade_in_ms: 200,
    fade_out_ms: 200,
    loop: false
  }, -1);
}

function editLive2dMotion(index) {
  const live2d = ensureLive2dData();
  const motion = live2d.motions[index];
  if (!motion) return;
  openLive2dMotionModal(window.i18n.t('live2d_motion_name_label'), motion, index);
}

function deleteLive2dMotion(index) {
  if (!confirm(window.i18n.t('msg_confirm_delete_motion'))) return;
  const live2d = ensureLive2dData();
  live2d.motions.splice(index, 1);
  renderLive2dAssets();
  updateAnimaSelects();
  markUnsaved();
}

function openLive2dMotionModal(title, motion, index) {
  // 使用简易 prompt 风格 modal（复用 asset-modal 的结构）
  const modal = document.getElementById('asset-modal');
  if (!modal) return;
  document.getElementById('asset-modal-title').textContent = title;
  
  const body = document.getElementById('asset-modal-body');
  // 保存原始内容以便关闭时恢复
  if (!modal._originalBodyHTML) {
    modal._originalBodyHTML = body.innerHTML;
  }
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-group">
        <label>${window.i18n.t('live2d_motion_name_label')} <span class="required">*</span></label>
        <input type="text" id="live2d-edit-motion-name" value="${escapeHtml(motion.name || '')}" placeholder="${window.i18n.t('placeholder_live2d_motion_name')}">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('live2d_motion_file_label')}</label>
        <input type="text" id="live2d-edit-motion-file" value="${escapeHtml(motion.file || '')}" placeholder="${window.i18n.t('placeholder_live2d_motion_file')}">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('live2d_motion_group_label')}</label>
        <select id="live2d-edit-motion-group">
          <option value="Idle"${motion.group === 'Idle' ? ' selected' : ''}>Idle</option>
          <option value="Default"${motion.group === 'Default' || !motion.group ? ' selected' : ''}>Default</option>
          <option value="TapBody"${motion.group === 'TapBody' ? ' selected' : ''}>TapBody</option>
        </select>
      </div>
      <div class="form-group">
        <label>${window.i18n.t('live2d_motion_priority_label')}</label>
        <select id="live2d-edit-motion-priority">
          <option value="Idle"${motion.priority === 'Idle' ? ' selected' : ''}>${window.i18n.t('live2d_priority_idle')}</option>
          <option value="Normal"${motion.priority === 'Normal' || !motion.priority ? ' selected' : ''}>${window.i18n.t('live2d_priority_normal')}</option>
          <option value="Force"${motion.priority === 'Force' ? ' selected' : ''}>${window.i18n.t('live2d_priority_force')}</option>
        </select>
      </div>
      <div class="form-group">
        <label>${window.i18n.t('live2d_motion_fade_in_label')}</label>
        <input type="number" id="live2d-edit-motion-fade-in" value="${motion.fade_in_ms ?? 200}" min="0">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('live2d_motion_fade_out_label')}</label>
        <input type="number" id="live2d-edit-motion-fade-out" value="${motion.fade_out_ms ?? 200}" min="0">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('live2d_motion_loop_label')}</label>
        <label class="switch">
          <input type="checkbox" id="live2d-edit-motion-loop" ${motion.loop ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
    </div>
  `;
  
  // 覆盖保存按钮行为
  modal._live2dSaveHandler = () => saveLive2dMotion(index);
  modal.classList.add('show');
}

function saveLive2dMotion(index) {
  const name = document.getElementById('live2d-edit-motion-name').value.trim();
  if (!name) {
    showToast(window.i18n.t('msg_enter_motion_name'), 'warning');
    return;
  }
  
  const motion = {
    name: name,
    file: document.getElementById('live2d-edit-motion-file').value.trim(),
    group: document.getElementById('live2d-edit-motion-group').value,
    priority: document.getElementById('live2d-edit-motion-priority').value,
    fade_in_ms: parseInt(document.getElementById('live2d-edit-motion-fade-in').value) || 200,
    fade_out_ms: parseInt(document.getElementById('live2d-edit-motion-fade-out').value) || 200,
    loop: document.getElementById('live2d-edit-motion-loop').checked
  };
  
  const live2d = ensureLive2dData();
  if (index === -1) {
    live2d.motions.push(motion);
  } else {
    live2d.motions[index] = motion;
  }
  
  closeAssetModal();
  renderLive2dAssets();
  updateAnimaSelects();
  markUnsaved();
}

// --- Live2D Expression CRUD ---

function addLive2dExpression() {
  openLive2dExpressionModal(window.i18n.t('btn_add_expression'), {
    name: '',
    file: ''
  }, -1);
}

function editLive2dExpression(index) {
  const live2d = ensureLive2dData();
  const expr = live2d.expressions[index];
  if (!expr) return;
  openLive2dExpressionModal(window.i18n.t('live2d_expr_name_label'), expr, index);
}

function deleteLive2dExpression(index) {
  if (!confirm(window.i18n.t('msg_confirm_delete_expression'))) return;
  const live2d = ensureLive2dData();
  live2d.expressions.splice(index, 1);
  renderLive2dAssets();
  updateAnimaSelects();
  markUnsaved();
}

function openLive2dExpressionModal(title, expr, index) {
  const modal = document.getElementById('asset-modal');
  if (!modal) return;
  document.getElementById('asset-modal-title').textContent = title;
  
  const body = document.getElementById('asset-modal-body');
  if (!modal._originalBodyHTML) {
    modal._originalBodyHTML = body.innerHTML;
  }
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-group">
        <label>${window.i18n.t('live2d_expr_name_label')} <span class="required">*</span></label>
        <input type="text" id="live2d-edit-expr-name" value="${escapeHtml(expr.name || '')}" placeholder="${window.i18n.t('placeholder_live2d_expr_name')}">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('live2d_expr_file_label')}</label>
        <input type="text" id="live2d-edit-expr-file" value="${escapeHtml(expr.file || '')}" placeholder="${window.i18n.t('placeholder_live2d_expr_file')}">
      </div>
    </div>
  `;
  
  modal._live2dSaveHandler = () => saveLive2dExpression(index);
  modal.classList.add('show');
}

function saveLive2dExpression(index) {
  const name = document.getElementById('live2d-edit-expr-name').value.trim();
  if (!name) {
    showToast(window.i18n.t('msg_enter_expression_name'), 'warning');
    return;
  }
  
  const expr = {
    name: name,
    file: document.getElementById('live2d-edit-expr-file').value.trim()
  };
  
  const live2d = ensureLive2dData();
  if (index === -1) {
    live2d.expressions.push(expr);
  } else {
    live2d.expressions[index] = expr;
  }
  
  closeAssetModal();
  renderLive2dAssets();
  updateAnimaSelects();
  markUnsaved();
}

// --- Live2D State Mapping CRUD ---

function addLive2dState() {
  openLive2dStateModal(window.i18n.t('btn_add_live2d_state'), {
    state: '',
    motion: '',
    expression: '',
    scale: 1.0,
    offset_x: 0,
    offset_y: 0
  }, -1);
}

function editLive2dState(index) {
  const live2d = ensureLive2dData();
  const state = live2d.states[index];
  if (!state) return;
  openLive2dStateModal(window.i18n.t('live2d_state_name_label'), state, index);
}

function deleteLive2dState(index) {
  if (!confirm(window.i18n.t('msg_confirm_delete_live2d_state'))) return;
  const live2d = ensureLive2dData();
  live2d.states.splice(index, 1);
  renderLive2dAssets();
  updateAnimaSelects();
  markUnsaved();
}

function openLive2dStateModal(title, state, index) {
  const modal = document.getElementById('asset-modal');
  if (!modal) return;
  document.getElementById('asset-modal-title').textContent = title;
  
  const body = document.getElementById('asset-modal-body');
  if (!modal._originalBodyHTML) {
    modal._originalBodyHTML = body.innerHTML;
  }
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-group">
        <label>${window.i18n.t('live2d_state_name_label')} <span class="required">*</span></label>
        <input type="text" id="live2d-edit-state-name" value="${escapeHtml(state.state || '')}" placeholder="${window.i18n.t('placeholder_state_name')}">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('live2d_state_motion_label')}</label>
        <select id="live2d-edit-state-motion">
          ${getMotionSelectOptions(state.motion)}
        </select>
      </div>
      <div class="form-group">
        <label>${window.i18n.t('live2d_state_expression_label')}</label>
        <select id="live2d-edit-state-expression">
          ${getExpressionSelectOptions(state.expression)}
        </select>
      </div>
      <div class="form-group">
        <label>${window.i18n.t('live2d_state_scale_label')}</label>
        <input type="number" id="live2d-edit-state-scale" value="${state.scale ?? 1.0}" step="0.1" min="0.1">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('live2d_state_offset_x_label')}</label>
        <input type="number" id="live2d-edit-state-offset-x" value="${state.offset_x ?? 0}">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('live2d_state_offset_y_label')}</label>
        <input type="number" id="live2d-edit-state-offset-y" value="${state.offset_y ?? 0}">
      </div>
    </div>
  `;
  
  modal._live2dSaveHandler = () => saveLive2dState(index);
  modal.classList.add('show');
}

function saveLive2dState(index) {
  const stateName = document.getElementById('live2d-edit-state-name').value.trim();
  if (!stateName) {
    showToast(window.i18n.t('msg_enter_live2d_state'), 'warning');
    return;
  }
  
  const state = {
    state: stateName,
    motion: document.getElementById('live2d-edit-state-motion').value,
    expression: document.getElementById('live2d-edit-state-expression').value,
    scale: parseFloat(document.getElementById('live2d-edit-state-scale').value) || 1.0,
    offset_x: parseInt(document.getElementById('live2d-edit-state-offset-x').value) || 0,
    offset_y: parseInt(document.getElementById('live2d-edit-state-offset-y').value) || 0
  };
  
  const live2d = ensureLive2dData();
  if (index === -1) {
    live2d.states.push(state);
  } else {
    live2d.states[index] = state;
  }
  
  closeAssetModal();
  renderLive2dAssets();
  updateAnimaSelects();
  markUnsaved();
}

// --- Live2D Copy / Paste ---

/**
 * 复制 Live2D 条目到剪贴板
 * @param {'motion'|'expression'|'state'} kind
 * @param {number} index
 */
async function copyLive2dItem(kind, index) {
  if (!currentMod) return;
  const live2d = currentMod.assets?.live2d;
  if (!live2d) return;
  const map = { motion: 'motions', expression: 'expressions', state: 'states' };
  const arr = live2d[map[kind]];
  const item = arr?.[index];
  if (!item) {
    showToast(window.i18n.t('msg_no_data_to_copy'), 'warning');
    return;
  }
  try {
    const data = { type: `tbuddy_live2d_${kind}`, data: item };
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    showToast(window.i18n.t('msg_copied_to_clipboard'), 'success');
  } catch (e) {
    showToast(window.i18n.t('msg_clipboard_read_failed'), 'error');
  }
}

/**
 * 从剪贴板粘贴 Live2D 条目
 * @param {'motion'|'expression'|'state'} kind
 */
async function pasteLive2dItem(kind) {
  if (!currentMod) return;
  const live2d = ensureLive2dData();
  const map = { motion: 'motions', expression: 'expressions', state: 'states' };
  const expectedType = `tbuddy_live2d_${kind}`;
  try {
    const text = await navigator.clipboard.readText();
    const parsed = JSON.parse(text);
    if (parsed.type !== expectedType || typeof parsed.data !== 'object') {
      showToast(window.i18n.t('msg_clipboard_empty'), 'warning');
      return;
    }
    live2d[map[kind]].push(parsed.data);
    renderLive2dAssets();
    updateAnimaSelects();
    markUnsaved();
    showToast(window.i18n.t('msg_pasted_from_clipboard'), 'success');
  } catch (e) {
    showToast(window.i18n.t('msg_clipboard_empty'), 'warning');
  }
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

  bindAssetAutoCalcEvents();
  
  document.getElementById('asset-modal').classList.add('show');
}

/**
 * 关闭资源编辑弹窗
 */
function closeAssetModal() {
  const modal = document.getElementById('asset-modal');
  modal.classList.remove('show');
  // 清除 Live2D 保存回调
  if (modal._live2dSaveHandler) {
    delete modal._live2dSaveHandler;
  }
  // 恢复原始 modal body（Live2D 弹窗会替换内容）
  if (modal._originalBodyHTML) {
    document.getElementById('asset-modal-body').innerHTML = modal._originalBodyHTML;
    delete modal._originalBodyHTML;
  }
}

let assetAutoCalcTimer = null;

async function getImageSizeFromFile(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      URL.revokeObjectURL(url);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        resolve({ width, height });
      } else {
        resolve(null);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

async function tryGetAssetImageFile(imgPath) {
  if (!modFolderHandle) return null;
  const raw = String(imgPath || '').trim();
  if (!raw) return null;

  let rel = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!rel) return null;
  if (!rel.toLowerCase().startsWith('asset/')) {
    rel = `asset/${rel}`;
  }

  const parts = rel.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  try {
    let dir = modFolderHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]);
    }
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
    return await fileHandle.getFile();
  } catch (e) {
    return null;
  }
}

async function autoCalcAssetFrameSize() {
  if (!currentMod) return;

  const imgPath = document.getElementById('asset-img')?.value?.trim() || '';
  const numX = parseInt(document.getElementById('asset-frame-num-x')?.value || '', 10);
  const numY = parseInt(document.getElementById('asset-frame-num-y')?.value || '', 10);

  if (!imgPath || !Number.isFinite(numX) || !Number.isFinite(numY) || numX <= 0 || numY <= 0) return;

  const file = await tryGetAssetImageFile(imgPath);
  if (!file) return;

  const size = await getImageSizeFromFile(file);
  if (!size) return;

  const frameW = size.width / numX;
  const frameH = size.height / numY;
  if (!Number.isFinite(frameW) || !Number.isFinite(frameH)) return;
  if (!Number.isInteger(frameW) || !Number.isInteger(frameH)) return;
  if (frameW <= 0 || frameH <= 0) return;

  const frameSizeX = document.getElementById('asset-frame-size-x');
  const frameSizeY = document.getElementById('asset-frame-size-y');
  if (!frameSizeX || !frameSizeY) return;

  frameSizeX.value = String(frameW);
  frameSizeY.value = String(frameH);
}

function scheduleAutoCalcAssetFrameSize() {
  if (assetAutoCalcTimer) {
    clearTimeout(assetAutoCalcTimer);
  }
  assetAutoCalcTimer = setTimeout(() => {
    autoCalcAssetFrameSize();
  }, 150);
}

function bindAssetAutoCalcEvents() {
  const imgInput = document.getElementById('asset-img');
  const numXInput = document.getElementById('asset-frame-num-x');
  const numYInput = document.getElementById('asset-frame-num-y');

  if (!imgInput || !numXInput || !numYInput) return;
  if (imgInput.dataset.autoCalcBound === '1') return;

  const handler = () => scheduleAutoCalcAssetFrameSize();
  imgInput.addEventListener('input', handler);
  numXInput.addEventListener('input', handler);
  numYInput.addEventListener('input', handler);

  imgInput.dataset.autoCalcBound = '1';
  numXInput.dataset.autoCalcBound = '1';
  numYInput.dataset.autoCalcBound = '1';
}

/**
 * 保存资源
 */
function saveAsset() {
  // Live2D 弹窗复用：如果存在 _live2dSaveHandler 则走 Live2D 保存逻辑
  const modal = document.getElementById('asset-modal');
  if (typeof modal._live2dSaveHandler === 'function') {
    modal._live2dSaveHandler();
    return;
  }

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

  // “新增同名状态”按钮启用条件：该名称的状态不存在
  const existingStateNamesSet = new Set(
    getAllStateNames()
      .map(n => String(n || '').trim())
      .filter(Boolean)
  );


  speeches.forEach((speech, index) => {
    const speechName = String(speech?.name || '');
    const speechText = String(speech?.text || '');
    const rawDuration = speech?.duration;
    const speechDuration = Number.isFinite(Number(rawDuration)) ? Number(rawDuration) : 3;


    const nameHay = speechName.toLowerCase();
    const textHay = speechText.toLowerCase();
    const matchName = !nameNeedle || nameHay.includes(nameNeedle);
    const matchContains = !containsNeedle || textHay.includes(containsNeedle);
    if (!matchName || !matchContains) return;

    const item = document.createElement('div');
    item.className = 'speech-item tb-sort-item';
    item.dataset.sortKey = ensureTbUid(speech);

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

    const durationFieldHtml = `
      <div class="speech-item-duration">
        <label>${window.i18n.t('text_duration_label')}</label>
        <input type="number" min="0" step="0.1" value="${escapeHtml(String(speechDuration))}"
          placeholder="${window.i18n.t('text_duration_placeholder')}"
          onchange="updateSpeechText(${index}, 'duration', this.value)">
      </div>
    `;


    const trimmedSpeechName = speechName.trim();
    const canAddSameNameState = !!trimmedSpeechName && !existingStateNamesSet.has(trimmedSpeechName);
    const addSameNameStateBtnHtml = `
      <button class="btn btn-sm btn-secondary" onclick="addSameNameStateFromSpeechText(${index})" ${canAddSameNameState ? '' : 'disabled'}>
        ➕ <span>${window.i18n.t('btn_add_same_name_state')}</span>
      </button>
    `;

    item.innerHTML = `
      <div class="speech-item-header">
        <div class="tb-title-with-handle">
          ${renderSortHandleHtml()}
          ${nameFieldHtml}
        </div>
        <div class="speech-item-actions">
          ${addSameNameStateBtnHtml}
          <button class="btn btn-sm btn-ghost" onclick="deleteSpeechText(${index})">🗑️</button>
        </div>
      </div>
      ${textFieldHtml}
      ${durationFieldHtml}
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

  // 允许拖拽排序（仅在未开启筛选时）
  enableTbSortable(list, {
    canStart: () => {
      if (!currentMod || currentMod.textSpeechEnabled !== true) return false;
      const hasFilters = ['speech-filter-name', 'speech-filter-contains']
        .some(id => (document.getElementById(id)?.value || '').trim());
      if (hasFilters) {
        showToast(window.i18n.t('msg_clear_filters_to_reorder') || '请先清空筛选条件再排序', 'warning');
        return false;
      }
      return true;
    },
    onSortedKeys: (orderedKeys) => {
      if (!currentMod || currentMod.textSpeechEnabled !== true) return;
      const arr = currentMod.texts[currentTextLang]?.speech;
      if (!Array.isArray(arr)) return;
      reorderArrayInPlaceByKeys(arr, orderedKeys, ensureTbUid);
      renderSpeechTexts();
      markUnsaved();
    }
  });
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
  currentMod.texts[currentTextLang].speech.push({ name: '', text: '', duration: 3 });

  renderSpeechTexts();
  markUnsaved();
}

/**
 * 更新对话文本
 */
function updateSpeechText(index, field, value) {
  if (!currentMod || currentMod.textSpeechEnabled !== true) return;
  if (field === 'duration') {
    const parsed = Number(value);
    currentMod.texts[currentTextLang].speech[index][field] = Number.isFinite(parsed) ? parsed : 3;
    markUnsaved();
    return;
  }
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

function doesAnyAudioEntryExistByName(name) {
  if (!currentMod) return false;
  const target = String(name || '').trim();
  if (!target) return false;

  const audioObj = currentMod.audio || {};
  for (const arr of Object.values(audioObj)) {
    if (!Array.isArray(arr)) continue;
    if (arr.some(a => String(a?.name || '').trim() === target)) {
      return true;
    }
  }

  return false;
}

function addSameNameStateFromSpeechText(index) {
  if (!currentMod || currentMod.textSpeechEnabled !== true) return;

  const speech = currentMod.texts[currentTextLang]?.speech?.[index];
  const speechName = String(speech?.name || '').trim();

  if (!speechName) {
    showToast(window.i18n.t('msg_enter_text_name') || '请先填写文本名称', 'warning');
    return;
  }

  const exists = getAllStateNames().some(n => String(n || '').trim() === speechName);
  if (exists) {
    showToast(window.i18n.t('msg_state_same_name_exists') || '已存在同名状态', 'warning');
    return;
  }

  if (!currentMod.manifest.states) {
    currentMod.manifest.states = [];
  }

  const state = createDefaultState(speechName, false);
  state.text = speechName;

  // 若存在同名的 Live2D 状态-动画映射，则自动关联动画
  const l2dMatch = findLive2dStateByName(speechName);
  if (l2dMatch) {
    state.anima = speechName;
  }

  // 若任意语言音频存在同名条目，则自动关联该音频
  if (doesAnyAudioEntryExistByName(speechName)) {
    state.audio = speechName;
  }

  currentMod.manifest.states.push(state);

  renderStates();
  renderSpeechTexts();
  markUnsaved();
  showToast(window.i18n.t('msg_state_created_from_text') || '已创建同名状态', 'success');
}

/**
 * 检查任意语言的对话文本中是否存在同名条目
 */
function doesAnySpeechTextExistByName(name) {
  if (!currentMod) return false;
  const target = String(name || '').trim();
  if (!target) return false;

  const textsObj = currentMod.texts || {};
  for (const langData of Object.values(textsObj)) {
    const speeches = langData?.speech;
    if (!Array.isArray(speeches)) continue;
    if (speeches.some(s => String(s?.name || '').trim() === target)) {
      return true;
    }
  }
  return false;
}

/**
 * 根据名称查找 Live2D 状态-动画映射
 */
function findLive2dStateByName(name) {
  const live2d = currentMod?.assets?.live2d;
  if (!live2d || !Array.isArray(live2d.states)) return null;
  const target = String(name || '').trim();
  if (!target) return null;
  return live2d.states.find(s => String(s?.state || '').trim() === target) || null;
}

/**
 * 从 Live2D 状态-动画映射创建同名 manifest 状态
 * 自动关联动画映射名称、同名文本和同名音频
 */
function addSameNameStateFromLive2dState(index) {
  if (!currentMod) return;

  const live2d = ensureLive2dData();
  const l2dState = live2d.states?.[index];
  if (!l2dState) return;

  const stateName = String(l2dState.state || '').trim();
  if (!stateName) {
    showToast(window.i18n.t('msg_enter_live2d_state') || '请先填写状态名称', 'warning');
    return;
  }

  const exists = getAllStateNames().some(n => String(n || '').trim() === stateName);
  if (exists) {
    showToast(window.i18n.t('msg_state_same_name_exists') || '已存在同名状态', 'warning');
    return;
  }

  if (!currentMod.manifest.states) {
    currentMod.manifest.states = [];
  }

  const state = createDefaultState(stateName, false);
  state.anima = stateName;

  // 若有同名对话文本，则自动关联
  if (doesAnySpeechTextExistByName(stateName)) {
    state.text = stateName;
  }

  // 若有同名音频，则自动关联
  if (doesAnyAudioEntryExistByName(stateName)) {
    state.audio = stateName;
  }

  currentMod.manifest.states.push(state);

  renderStates();
  renderLive2dAssets();
  markUnsaved();
  showToast(window.i18n.t('msg_state_created_from_live2d') || '已从动画映射创建同名状态', 'success');
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
    for (const defaultLang of ['en', 'zh', 'jp']) {
      langs.push(defaultLang);
      currentMod.audio[defaultLang] = [];
    }
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


  const rawAudios = currentMod.audio[currentAudioLang] || [];

  // “一键导入”按钮：仅当该语言下没有任何条目时可用
  const importBtn = document.getElementById('audio-speech-import-btn');
  if (importBtn) {
    importBtn.disabled = rawAudios.length > 0;
  }

  const audios = rawAudios;
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
    item.className = 'audio-item tb-sort-item';
    item.dataset.sortKey = ensureTbUid(audio);

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
        ${renderSortHandleHtml()}
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

  // 允许拖拽排序（仅在未开启筛选时）
  enableTbSortable(list, {
    canStart: () => {
      if (!currentMod || currentMod.audioSpeechEnabled !== true) return false;
      const hasFilters = ['audio-filter-name', 'audio-filter-path']
        .some(id => (document.getElementById(id)?.value || '').trim());
      if (hasFilters) {
        showToast(window.i18n.t('msg_clear_filters_to_reorder') || '请先清空筛选条件再排序', 'warning');
        return false;
      }
      return true;
    },
    onSortedKeys: (orderedKeys) => {
      if (!currentMod || currentMod.audioSpeechEnabled !== true) return;
      const arr = currentMod.audio[currentAudioLang];
      if (!Array.isArray(arr)) return;
      reorderArrayInPlaceByKeys(arr, orderedKeys, ensureTbUid);
      renderAudioList();
      markUnsaved();
    }
  });
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

function stripFileExt(filename) {
  const name = String(filename || '');
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return name;
  return name.slice(0, idx);
}

async function getOrCreateDir(baseHandle, parts) {
  let dir = baseHandle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}

async function writeFileToDir(dirHandle, file) {
  const fileName = String(file?.name || '').trim();
  if (!fileName) throw new Error('invalid file name');
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(file);
  await writable.close();
  return fileName;
}

function isAudioFileName(fileName) {
  const name = String(fileName || '').toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  const ext = name.slice(dot + 1);
  return ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'].includes(ext);
}

async function importSingleAudioEntry() {
  if (!currentMod || currentMod.audioSpeechEnabled !== true) return;

  if (!modFolderHandle) {
    showToast(window.i18n.t('msg_import_audio_need_folder') || '需要从文件夹打开 Mod 才能导入音频文件', 'warning');
    return;
  }

  try {
    const [fileHandle] = await window.showOpenFilePicker({
      multiple: false,
      types: [
        {
          description: 'Audio',
          accept: {
            'audio/*': ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus']
          }
        }
      ]
    });

    const file = await fileHandle.getFile();
    if (!file || !file.name) return;
    if (!isAudioFileName(file.name)) {
      showToast(window.i18n.t('msg_import_audio_failed') || '导入失败：未找到音频目录或无权限', 'error');
      return;
    }

    const speechDir = await getOrCreateDir(modFolderHandle, ['audio', currentAudioLang, 'speech']);
    const fileName = await writeFileToDir(speechDir, file);

    if (!currentMod.audio[currentAudioLang]) {
      currentMod.audio[currentAudioLang] = [];
    }

    currentMod.audio[currentAudioLang].push({
      name: stripFileExt(fileName),
      audio: `${currentAudioLang}/speech/${fileName}`
    });

    renderAudioList();
    markUnsaved();
    showToast((window.i18n.t('msg_import_audio_success') || '已导入 {count} 个音频文件').replace('{count}', '1'), 'success');
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    showToast(window.i18n.t('msg_import_audio_failed') || '导入失败：未找到音频目录或无权限', 'error');
  }
}

async function importAudioEntries() {
  if (!currentMod || currentMod.audioSpeechEnabled !== true) return;

  // 仅允许在没有任何条目时导入
  const existing = currentMod.audio[currentAudioLang] || [];
  if (existing.length > 0) return;

  if (!modFolderHandle) {
    showToast(window.i18n.t('msg_import_audio_need_folder') || '需要从文件夹打开 Mod 才能导入音频文件', 'warning');
    return;
  }


  try {
    const audioDir = await modFolderHandle.getDirectoryHandle('audio');
    const langDir = await audioDir.getDirectoryHandle(currentAudioLang);
    const speechDir = await langDir.getDirectoryHandle('speech');

    const entries = [];
    for await (const entry of speechDir.values()) {
      if (entry.kind !== 'file') continue;
      const fileName = entry.name;
      if (!fileName) continue;
      entries.push(fileName);
    }

    entries.sort((a, b) => a.localeCompare(b));

    if (entries.length === 0) {
      showToast(window.i18n.t('msg_import_audio_no_files') || `未在 audio/${currentAudioLang}/speech/ 目录找到任何音频文件`, 'warning');
      return;
    }

    currentMod.audio[currentAudioLang] = entries.map(fileName => ({
      name: stripFileExt(fileName),
      audio: `${currentAudioLang}/speech/${fileName}`
    }));

    renderAudioList();
    markUnsaved();
    showToast((window.i18n.t('msg_import_audio_success') || '已导入 {count} 个音频文件').replace('{count}', String(entries.length)), 'success');
  } catch (e) {
    showToast(window.i18n.t('msg_import_audio_failed') || '导入失败：未找到音频目录或无权限', 'error');
  }
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
