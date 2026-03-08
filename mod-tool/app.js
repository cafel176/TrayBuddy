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
  detectSbuddyCryptoAvailability();
});

/**
 * 检测外部工具是否存在于同目录下。
 * 如果可用，则显示导出 .sbuddy 按钮。
 */
async function detectSbuddyCryptoAvailability() {

  try {
    const resp = await fetch('./sbuddy-crypto.exe', { method: 'HEAD' });
    if (resp.ok) {
      const btn = document.getElementById('exportSbuddyBtn');
      if (btn) btn.style.display = '';
    }
  } catch (_) {
    // 外部工具不可用，保持按钮隐藏
  }

}

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
    populateAiTools();
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
        previewImage.innerHTML = `<img src="${e.target.result}" alt="${window.i18n.t('preview_alt')}">`;

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
        iconImage.innerHTML = `<img src="${e.target.result}" alt="${window.i18n.t('icon_alt')}">`;

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

    if (tab === 'aitools') {
      populateAiTools();
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
    // 记录当前打开的 tbuddy（用于后续保存/导出时把资源一并带上）
    zip = zipData;

    
    showToast(window.i18n.t('msg_loading_tbuddy'), 'info');
    
    // 寻找根目录（注意：包内可能包含多个 manifest.json，例如 Live2D/3D 资源目录也可能有）
    // 这里优先选择“最像 Mod manifest”的那个（包含 id），否则回退到最浅层的 manifest.json。
    let rootPath = '';

    const allFileNames = Object.keys(zipData.files).filter((f) => !zipData.files[f]?.dir);

    // 注意：某些打包工具会在 zip 内使用 `\\` 作为分隔符；JSZip 会原样保留。
    // 因此这里做：大小写不敏感 + 分隔符不敏感 的文件定位。
    const normalizeZipPath = (p) => String(p).replace(/\\/g, '/');

    const originalByLower = new Map();
    const originalByNormalizedLower = new Map();
    for (const n of allFileNames) {
      originalByLower.set(String(n).toLowerCase(), n);
      originalByNormalizedLower.set(normalizeZipPath(n).toLowerCase(), n);
    }

    function getZipFile(relPath) {
      const exact = zipData.file(relPath);
      if (exact) return exact;

      const s = String(relPath);
      const candidates = [s, normalizeZipPath(s), s.replace(/\//g, '\\')];

      for (const cand of candidates) {
        const lower = cand.toLowerCase();
        const actual = originalByLower.get(lower) || originalByNormalizedLower.get(lower);
        if (actual) {
          const f = zipData.file(actual);
          if (f) return f;
        }
      }

      return null;
    }

    const manifestCandidates = allFileNames
      .map((orig) => ({ orig, norm: normalizeZipPath(orig) }))
      .filter((x) => x.norm.split('/').pop()?.toLowerCase() === 'manifest.json')
      .sort((a, b) => {
        const da = a.norm.split('/').length;
        const db = b.norm.split('/').length;
        return da - db || a.norm.length - b.norm.length;
      })
      .map((x) => x.orig);

    if (manifestCandidates.length === 0) {
      throw new Error(window.i18n.t('msg_manifest_not_found'));
    }


    let manifestFile = null;
    let manifest = null;

    for (const cand of manifestCandidates) {
      try {
        const text = await zipData.file(cand).async('string');
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string' && parsed.id.trim()) {
          manifestFile = cand;
          manifest = parsed;
          break;
        }
      } catch (_) {
        // ignore
      }
    }

    // 回退：选最浅层的 manifest.json
    if (!manifestFile) {
      manifestFile = manifestCandidates[0];
      const text = await zipData.file(manifestFile).async('string');
      manifest = JSON.parse(text);
    }

    // 根目录用路径切片来算，避免大小写/替换失败问题（例如 Manifest.json），也兼容 `\\` 分隔符
    const manifestFileNorm = normalizeZipPath(manifestFile);
    const lastSlash = manifestFileNorm.lastIndexOf('/');
    rootPath = lastSlash >= 0 ? manifestFileNorm.slice(0, lastSlash + 1) : '';


    normalizeManifestForEditor(manifest);

    if (!manifest || typeof manifest !== 'object' || typeof manifest.id !== 'string' || !manifest.id.trim()) {
      throw new Error('未在 .tbuddy 中找到有效的 Mod manifest.json（缺少 id）');
    }

    
    currentMod = {
      manifest: manifest,
      assets: { sequence: [], img: [], live2d: null, pngremix: null, threed: null },
      texts: {},
      audio: {},
      bubbleStyle: null,
      bubbleEnabled: false,
      aiTools: null,
      aiToolsEnabled: false,
      textSpeechEnabled: false,
      audioSpeechEnabled: false,
      previewData: null,
      iconData: null
    };
    
    // 重置预览图扩展名
    currentPreviewExt = 'png';
    
    // 读取其他文件（大小写不敏感）
    const seqFile = getZipFile(`${rootPath}asset/sequence.json`);
    if (seqFile) currentMod.assets.sequence = JSON.parse(await seqFile.async('string'));
    
    const imgFile = getZipFile(`${rootPath}asset/img.json`);
    if (imgFile) currentMod.assets.img = JSON.parse(await imgFile.async('string'));
    
    const live2dFile = getZipFile(`${rootPath}asset/live2d.json`);
    if (live2dFile) currentMod.assets.live2d = JSON.parse(await live2dFile.async('string'));

    const pngremixFile2 = getZipFile(`${rootPath}asset/pngremix.json`);
    if (pngremixFile2) currentMod.assets.pngremix = JSON.parse(await pngremixFile2.async('string'));

    const threedFile = getZipFile(`${rootPath}asset/3d.json`);
    if (threedFile) currentMod.assets.threed = JSON.parse(await threedFile.async('string'));

    const bubbleFile = getZipFile(`${rootPath}bubble_style.json`);
    if (bubbleFile) {
      currentMod.bubbleStyle = JSON.parse(await bubbleFile.async('string'));
      currentMod.bubbleEnabled = true;
    }

    const aiToolsFile = getZipFile(`${rootPath}ai_tools.json`);
    if (aiToolsFile) {
      currentMod.aiTools = JSON.parse(await aiToolsFile.async('string'));
      currentMod.aiToolsEnabled = true;
    }
    
    // 读取 text 和 audio
    let foundTextSpeech = false;
    let foundAudioSpeech = false;
    const rootLower = rootPath.toLowerCase();
    for (const fileName in zipData.files) {
      const fileNameNorm = normalizeZipPath(fileName);
      const lower = fileNameNorm.toLowerCase();

      if (lower.startsWith(`${rootLower}text/`) && lower.endsWith('info.json')) {
        const parts = fileNameNorm.split('/');
        const lang = parts[parts.length - 2];
        if (!currentMod.texts[lang]) currentMod.texts[lang] = { info: null, speech: [] };
        currentMod.texts[lang].info = JSON.parse(await zipData.file(fileName).async('string'));
        
        const speechFile = getZipFile(`${rootPath}text/${lang}/speech.json`);
        if (speechFile) {
          currentMod.texts[lang].speech = JSON.parse(await speechFile.async('string'));
          foundTextSpeech = true;
        }
      }
      
      if (lower.startsWith(`${rootLower}audio/`) && lower.endsWith('speech.json')) {
        const parts = fileNameNorm.split('/');
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
      const previewFile = getZipFile(`${rootPath}preview.${ext}`);
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
    const iconFile = getZipFile(`${rootPath}icon.ico`);
    if (iconFile) {
      const blob = await iconFile.async('blob');
      currentMod.iconData = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.readAsDataURL(blob);
      });
    }

    
    // 记录 zip 根目录，便于后续保存/导出时从 zip 中复制资源
    currentMod._zipRootPath = rootPath;

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
  populateAiTools();
  
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
        live2d: null,
        pngremix: null,
        threed: null
      },
      texts: {},
      audio: {},
      bubbleStyle: null,
      bubbleEnabled: false,
      aiTools: null,
      aiToolsEnabled: false,
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
      console.debug('No sequence.json found');
    }
    
    // 读取 asset/img.json
    try {
      const assetDir = await modFolderHandle.getDirectoryHandle('asset');
      const imgHandle = await assetDir.getFileHandle('img.json');
      const imgFile = await imgHandle.getFile();
      currentMod.assets.img = JSON.parse(await imgFile.text());
    } catch (e) {
      console.debug('No img.json found');
    }

    // 读取 asset/live2d.json
    try {
      const assetDir = await modFolderHandle.getDirectoryHandle('asset');
      const live2dHandle = await assetDir.getFileHandle('live2d.json');
      const live2dFile = await live2dHandle.getFile();
      currentMod.assets.live2d = JSON.parse(await live2dFile.text());
    } catch (e) {
      console.debug('No live2d.json found');
    }

    // 读取 asset/pngremix.json
    try {
      const assetDir = await modFolderHandle.getDirectoryHandle('asset');
      const pngremixHandle = await assetDir.getFileHandle('pngremix.json');
      const pngremixFile = await pngremixHandle.getFile();
      currentMod.assets.pngremix = JSON.parse(await pngremixFile.text());
    } catch (e) {
      console.debug('No pngremix.json found');
    }

    // 读取 asset/3d.json
    try {
      const assetDir = await modFolderHandle.getDirectoryHandle('asset');
      const threedHandle = await assetDir.getFileHandle('3d.json');
      const threedFile = await threedHandle.getFile();
      currentMod.assets.threed = JSON.parse(await threedFile.text());
    } catch (e) {
      console.debug('No 3d.json found');
    }

    // 读取 bubble_style.json
    try {
      const bubbleHandle = await modFolderHandle.getFileHandle('bubble_style.json');
      const bubbleFile = await bubbleHandle.getFile();
      currentMod.bubbleStyle = JSON.parse(await bubbleFile.text());
      currentMod.bubbleEnabled = true;
    } catch (e) {
      console.debug('No bubble_style.json found');
    }

    // 读取 ai_tools.json
    try {
      const aiToolsHandle = await modFolderHandle.getFileHandle('ai_tools.json');
      const aiToolsFile = await aiToolsHandle.getFile();
      currentMod.aiTools = JSON.parse(await aiToolsFile.text());
      currentMod.aiToolsEnabled = true;
    } catch (e) {
      console.debug('No ai_tools.json found');
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
      console.debug('No text directory found');
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
      console.debug('No audio directory found');
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
          document.getElementById('preview-image').innerHTML = `<img src="${e.target.result}" alt="${window.i18n.t('preview_alt')}">`;

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
        document.getElementById('icon-image').innerHTML = `<img src="${e.target.result}" alt="${window.i18n.t('icon_alt')}">`;

      };
      reader.readAsDataURL(iconFile);
    } catch (e) {
      console.debug('No icon.ico found');
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

  // 3.5 读取 ai_tools（可选）
  const aiToolsData = structure.ai_tools
    ? await fetchJsonSafe(`${base}/${structure.ai_tools}`)
    : null;

  // 4. 动态读取 assets
  const assets = { sequence: [], img: [], live2d: null, pngremix: null, threed: null };
  if (structure.assets) {
    const assetPromises = Object.entries(structure.assets).map(async ([key, path]) => {
      const data = await fetchJsonSafe(`${base}/${path}`);
      return [key, data];
    });
    const assetResults = await Promise.all(assetPromises);
    assetResults.forEach(([key, data]) => {
      if (key === 'live2d' || key === 'pngremix' || key === 'threed') {
        assets[key] = (data && typeof data === 'object') ? deepClone(data) : null;
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
    aiTools: (aiToolsData && typeof aiToolsData === 'object') ? deepClone(aiToolsData) : null,
    aiToolsEnabled: !!(aiToolsData && typeof aiToolsData === 'object'),

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

  // live2d_params 应该是 [{id, value, target}] 数组或 null
  if (state.live2d_params) {
    if (Array.isArray(state.live2d_params)) {
      state.live2d_params = state.live2d_params
        .filter((p) => p && typeof p === 'object' && typeof p.id === 'string' && p.id.trim())
        .map((p) => {
          const target = p.target === 'PartOpacity' ? 'PartOpacity' : 'Parameter';
          return { id: p.id.trim(), value: Number(p.value) || 0, target };
        });
      if (state.live2d_params.length === 0) state.live2d_params = null;
    } else {
      state.live2d_params = null;
    }
  }
}

function normalizeManifestForEditor(manifest) {
  if (!manifest || typeof manifest !== 'object') return;

  // mod_type 默认 sequence；主程序使用 '3d'，编辑器内部统一用 'threed'
  if (!manifest.mod_type) manifest.mod_type = 'sequence';
  if (manifest.mod_type === '3d') manifest.mod_type = 'threed';

  // ema 字段补齐
  if (typeof manifest.show_mod_data_panel !== 'boolean') manifest.show_mod_data_panel = false;
  if (!Number.isFinite(Number(manifest.mod_data_default_int))) manifest.mod_data_default_int = 0;
  if (typeof manifest.global_keyboard !== 'boolean') manifest.global_keyboard = false;
  if (typeof manifest.global_mouse !== 'boolean') manifest.global_mouse = false;

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
 * 获取保存用的 manifest 副本
 * 编辑器内部使用 'threed'，保存时映射回主程序使用的 '3d'
 */
function getManifestForSave() {
  const m = deepClone(currentMod.manifest);
  if (m.mod_type === 'threed') m.mod_type = '3d';

  // 确保所有 state 的 live2d_params 都包含 target 字段
  const allStates = [
    ...(m.states || []),
    ...(m.important_states ? Object.values(m.important_states) : [])
  ];
  for (const state of allStates) {
    if (Array.isArray(state.live2d_params)) {
      state.live2d_params = state.live2d_params.map(p => ({
        id: p.id,
        value: p.value ?? 0,
        target: p.target || 'Parameter'
      }));
    }
  }

  return m;
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

function isTypeMismatchError(e) {
  return e && (e.name === 'TypeMismatchError' || String(e.message || '').includes('TypeMismatch'));
}

async function safeGetDirectoryHandle(parentDirHandle, name, options = { create: true, overwriteFile: false }) {
  const create = options?.create === true;
  const overwriteFile = options?.overwriteFile === true;

  try {
    return await parentDirHandle.getDirectoryHandle(name, { create });
  } catch (e) {
    // 目标已存在但不是目录（通常是同名文件）
    if (isTypeMismatchError(e) && create && overwriteFile) {
      try {
        await parentDirHandle.removeEntry(name, { recursive: true });
      } catch (_) {
        // ignore
      }
      return await parentDirHandle.getDirectoryHandle(name, { create });
    }
    throw e;
  }
}

async function safeGetFileHandle(parentDirHandle, name, options = { create: true, overwriteDirectory: false }) {
  try {
    return await parentDirHandle.getFileHandle(name, { create: options?.create !== false });
  } catch (e) {
    // 目标已存在但不是文件（通常是同名目录）
    if (isTypeMismatchError(e) && options?.overwriteDirectory === true) {
      try {
        await parentDirHandle.removeEntry(name, { recursive: true });
      } catch (_) {
        // ignore
      }
      return await parentDirHandle.getFileHandle(name, { create: options?.create !== false });
    }
    throw e;
  }
}

function sanitizeFolderName(name) {
  // Windows 禁止字符: < > : " / \ | ? * 以及控制字符
  const raw = String(name ?? '').trim();
  let cleaned = raw
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\.+$/g, '')
    .trim();

  // 避免空/仅点号
  if (!cleaned || cleaned === '.' || cleaned === '..') cleaned = 'mod';

  // 避免 Windows 保留设备名
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  if (reserved.test(cleaned)) cleaned = `${cleaned}_mod`;

  return cleaned;
}

function sanitizeFileBaseName(name) {
  // 文件名与目录名类似，但 Windows 还禁止末尾为点/空格
  const raw = String(name ?? '').trim();
  let cleaned = raw
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim()
    .replace(/[\.\s]+$/g, '');

  if (!cleaned || cleaned === '.' || cleaned === '..') cleaned = 'mod';

  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  if (reserved.test(cleaned)) cleaned = `${cleaned}_mod`;

  return cleaned;
}

function getSuggestedTbuddyFileName(modId) {
  return `${sanitizeFileBaseName(modId)}.tbuddy`;
}

async function getOrCreateUniqueDirectory(parentDirHandle, desiredName) {
  const base = sanitizeFolderName(desiredName);

  for (let i = 0; i < 100; i++) {
    const name = i === 0 ? base : `${base}_${i}`;

    try {
      // create:true: 存在则直接返回目录句柄
      return await parentDirHandle.getDirectoryHandle(name, { create: true });
    } catch (e) {
      // 同名但类型不对（是文件）→ 尝试下一个名字，不在父目录里做删除
      if (isTypeMismatchError(e)) continue;
      throw e;
    }
  }

  throw new Error('无法创建唯一的导出目录，请选择一个空目录后重试');
}

async function ensureDirectoryForPath(rootDirHandle, relPath) {
  const parts = String(relPath).split('/').filter(Boolean);
  let dir = rootDirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await safeGetDirectoryHandle(dir, parts[i], { create: true, overwriteFile: true });
  }
  return { dir, fileName: parts[parts.length - 1] };
}

async function copyNonJsonFilesBetweenDirectories(sourceDirHandle, targetDirHandle, options = {}) {
  if (!sourceDirHandle || !targetDirHandle) return;

  const skipDirs = options.skipDirs || [];
  const files = await collectNonJsonFilesFromDirectory(sourceDirHandle, '', skipDirs);
  for (const { relPath, file } of files) {
    if (shouldSkipCopiedNonJson(relPath, options)) continue;

    try {
      const { dir, fileName } = await ensureDirectoryForPath(targetDirHandle, relPath);
      const fileHandle = await safeGetFileHandle(dir, fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(file);
      await writable.close();
    } catch (e) {
      // 跳过“同名但类型冲突”的条目，避免一次失败导致整个保存失败
      console.warn('Skip copying file due to error:', relPath, e);
    }
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
      targetRoot = await safeGetDirectoryHandle(targetRoot, part, { create: true, overwriteFile: true });
    }
  }
  for (const { relPath, file } of files) {
    try {
      const { dir, fileName } = await ensureDirectoryForPath(targetRoot, relPath);
      const fileHandle = await safeGetFileHandle(dir, fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(file);
      await writable.close();
    } catch (e) {
      console.warn('Skip copying file due to error:', relPath, e);
    }
  }
}

function normalizeZipEntryPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function normalizeZipRootPath(rootPath) {
  const n = normalizeZipEntryPath(rootPath);
  if (!n) return '';
  return n.endsWith('/') ? n : `${n}/`;
}

function zipRelPathIsUnderSkippedDir(relPath, skipDirs = []) {
  const p = normalizeZipEntryPath(relPath).toLowerCase();
  for (const d of skipDirs || []) {
    const dd = normalizeZipEntryPath(d).replace(/\/+$/, '').toLowerCase();
    if (!dd) continue;
    if (p === dd) return true;
    if (p.startsWith(dd + '/')) return true;
  }
  return false;
}

function* iterZipFilesUnderRoot(zipData, zipRootPath) {
  if (!zipData || !zipData.files) return;

  const root = normalizeZipRootPath(zipRootPath);
  const rootLower = root.toLowerCase();

  for (const origName in zipData.files) {
    const entry = zipData.files[origName];
    if (!entry || entry.dir) continue;

    const norm = normalizeZipEntryPath(origName);
    // 兼容某些 zip 会把目录占位项当作“文件”(例如 "audio/"、"text/")
    // 这种条目不是实际文件，复制会触发类型不匹配。
    if (norm.endsWith('/')) continue;

    const normLower = norm.toLowerCase();

    if (rootLower && !normLower.startsWith(rootLower)) continue;

    const relPath = rootLower ? norm.slice(root.length) : norm;
    if (!relPath) continue;

    yield { origName, relPath };
  }
}

async function copyNonJsonFilesFromLoadedZipToDirectory(zipData, zipRootPath, targetDirHandle, options = {}) {
  if (!zipData || !targetDirHandle) return;

  const skipDirs = options.skipDirs || [];

  for (const { origName, relPath } of iterZipFilesUnderRoot(zipData, zipRootPath)) {
    const relNorm = normalizeZipEntryPath(relPath);
    if (zipRelPathIsUnderSkippedDir(relNorm, skipDirs)) continue;
    if (relNorm.toLowerCase().endsWith('.json')) continue;
    if (shouldSkipCopiedNonJson(relNorm, options)) continue;

    const f = zipData.file(origName);
    if (!f) continue;

    try {
      const buf = await f.async('arraybuffer');
      const { dir, fileName } = await ensureDirectoryForPath(targetDirHandle, relNorm);
      const fileHandle = await safeGetFileHandle(dir, fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(new Blob([buf]));
      await writable.close();
    } catch (e) {
      console.warn('Skip copying zip file due to error:', relNorm, e);
    }
  }
}

async function copyAllFilesFromZipPrefixToDirectory(zipData, zipRootPath, prefix, targetDirHandle, basePathInTarget = '') {
  if (!zipData || !targetDirHandle) return;

  const prefixNorm = normalizeZipEntryPath(prefix).replace(/\/+$/, '');
  const prefixLower = prefixNorm.toLowerCase();
  const destBase = normalizeZipEntryPath(basePathInTarget).replace(/\/+$/, '');

  for (const { origName, relPath } of iterZipFilesUnderRoot(zipData, zipRootPath)) {
    const relNorm = normalizeZipEntryPath(relPath);
    const relLower = relNorm.toLowerCase();

    if (!prefixLower) continue;
    if (!relLower.startsWith(prefixLower + '/')) continue;

    const rest = relNorm.slice(prefixNorm.length + 1);
    if (!rest) continue;

    const outRel = destBase ? `${destBase}/${rest}` : rest;

    const f = zipData.file(origName);
    if (!f) continue;

    try {
      const buf = await f.async('arraybuffer');
      const { dir, fileName } = await ensureDirectoryForPath(targetDirHandle, outRel);
      const fileHandle = await safeGetFileHandle(dir, fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(new Blob([buf]));
      await writable.close();
    } catch (e) {
      console.warn('Skip copying zip file due to error:', outRel, e);
    }
  }
}

async function addNonJsonFilesToZipFromLoadedZip(zipData, zipRootPath, zipRootFolder, options = {}) {
  if (!zipData || !zipRootFolder) return;

  const skipDirs = options.skipDirs || [];

  for (const { origName, relPath } of iterZipFilesUnderRoot(zipData, zipRootPath)) {
    const relNorm = normalizeZipEntryPath(relPath);
    if (zipRelPathIsUnderSkippedDir(relNorm, skipDirs)) continue;
    if (relNorm.toLowerCase().endsWith('.json')) continue;
    if (shouldSkipCopiedNonJson(relNorm, options)) continue;

    const f = zipData.file(origName);
    if (!f) continue;

    const buf = await f.async('arraybuffer');
    zipRootFolder.file(relNorm, buf);
  }
}

async function addAllFilesFromZipPrefixToZip(zipData, zipRootPath, prefix, zipRootFolder, basePathInZip = '') {
  if (!zipData || !zipRootFolder) return;

  const prefixNorm = normalizeZipEntryPath(prefix).replace(/\/+$/, '');
  const prefixLower = prefixNorm.toLowerCase();
  const destBase = normalizeZipEntryPath(basePathInZip).replace(/\/+$/, '');

  for (const { origName, relPath } of iterZipFilesUnderRoot(zipData, zipRootPath)) {
    const relNorm = normalizeZipEntryPath(relPath);
    const relLower = relNorm.toLowerCase();

    if (!prefixLower) continue;
    if (!relLower.startsWith(prefixLower + '/')) continue;

    const rest = relNorm.slice(prefixNorm.length + 1);
    if (!rest) continue;

    const outRel = destBase ? `${destBase}/${rest}` : rest;

    const f = zipData.file(origName);
    if (!f) continue;

    const buf = await f.async('arraybuffer');
    zipRootFolder.file(outRel, buf);
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
  collectAiTools();

  // 如果是从文件夹加载的 Mod，保存/导出时把该目录下的非 json 资源一并带上
  const sourceFolderHandle = modFolderHandle;
  // 如果是从 .tbuddy 打开的 Mod，则从 zip 来源中复制资源
  const sourceZip = zip;
  const sourceZipRootPath = currentMod?._zipRootPath || '';

  
  // 每次保存都弹窗选择目标文件夹
  // 为避免误选“父目录”导致覆盖/冲突，这里会尽量保存到一个独立的 Mod 子目录：
  // - 如果用户选中的目录本身已经包含 manifest.json，则视为 Mod 目录，直接保存到该目录
  // - 否则在该目录下创建一个以 Mod id 命名的子目录进行保存
  let targetFolderHandle = null;
  try {
    targetFolderHandle = await window.showDirectoryPicker({
      mode: 'readwrite'
    });
  } catch (e) {
    if (e.name !== 'AbortError') {
      showToast(window.i18n.t('msg_save_failed', { error: e.message }), 'error');
    }
    return;
  }

  let resolvedTargetFolderHandle = targetFolderHandle;
  try {
    await resolvedTargetFolderHandle.getFileHandle('manifest.json');
  } catch (_) {
    resolvedTargetFolderHandle = await getOrCreateUniqueDirectory(
      resolvedTargetFolderHandle,
      currentMod?.manifest?.id || 'mod'
    );
  }

  modFolderHandle = resolvedTargetFolderHandle;

  
  try {
    showToast(window.i18n.t('msg_saving'), 'info');
    
    // 保存 manifest.json
    const manifestHandle = await safeGetFileHandle(modFolderHandle, 'manifest.json', { create: true, overwriteDirectory: true });
    const manifestWritable = await manifestHandle.createWritable();
    await manifestWritable.write(stringifyForSave(getManifestForSave()));
    await manifestWritable.close();

    // 保存 bubble_style.json (仅当启用时)
    if (currentMod.bubbleEnabled && currentMod.bubbleStyle) {
      const bubbleHandle = await safeGetFileHandle(modFolderHandle, 'bubble_style.json', { create: true, overwriteDirectory: true });
      const bubbleWritable = await bubbleHandle.createWritable();
      await bubbleWritable.write(stringifyForSave(currentMod.bubbleStyle));
      await bubbleWritable.close();
    } else {
      try { await modFolderHandle.removeEntry('bubble_style.json'); } catch (_) {}
    }

    // 保存 ai_tools.json (仅当启用时)
    if (currentMod.aiToolsEnabled && currentMod.aiTools) {
      const aiToolsHandle = await safeGetFileHandle(modFolderHandle, 'ai_tools.json', { create: true, overwriteDirectory: true });
      const aiToolsWritable = await aiToolsHandle.createWritable();
      await aiToolsWritable.write(stringifyForSave(currentMod.aiTools));
      await aiToolsWritable.close();
    } else {
      try { await modFolderHandle.removeEntry('ai_tools.json'); } catch (_) {}
    }
    
    // 创建 asset 目录并保存
    const assetDir = await safeGetDirectoryHandle(modFolderHandle, 'asset', { create: true, overwriteFile: true });
    
    const modType = currentMod.manifest.mod_type || 'sequence';

    if (modType === 'live2d') {
      // 保存 live2d.json
      if (currentMod.assets.live2d) {
        const live2dHandle = await safeGetFileHandle(assetDir, 'live2d.json', { create: true, overwriteDirectory: true });
        const live2dWritable = await live2dHandle.createWritable();
        await live2dWritable.write(stringifyForSave(currentMod.assets.live2d));
        await live2dWritable.close();
      }
    } else if (modType === 'pngremix') {
      // PngRemix 资源由外部 .pngremix 文件管理
      // 如果有 pngremix.json 配置，保存它
      if (currentMod.assets.pngremix) {
        const pngremixHandle = await safeGetFileHandle(assetDir, 'pngremix.json', { create: true, overwriteDirectory: true });
        const pngremixWritable = await pngremixHandle.createWritable();
        await pngremixWritable.write(stringifyForSave(currentMod.assets.pngremix));
        await pngremixWritable.close();
      }
    } else if (modType === 'threed') {
      if (currentMod.assets.threed) {
        const threedHandle = await safeGetFileHandle(assetDir, '3d.json', { create: true, overwriteDirectory: true });
        const threedWritable = await threedHandle.createWritable();
        await threedWritable.write(stringifyForSave(currentMod.assets.threed));
        await threedWritable.close();
      }
    } else {
      // 保存 sequence.json
      const seqHandle = await assetDir.getFileHandle('sequence.json', { create: true });
      const seqWritable = await seqHandle.createWritable();
      await seqWritable.write(stringifyForSave(currentMod.assets.sequence));
      await seqWritable.close();
      
      // 保存 img.json
      const imgHandle = await safeGetFileHandle(assetDir, 'img.json', { create: true, overwriteDirectory: true });
      const imgWritable = await imgHandle.createWritable();
      await imgWritable.write(stringifyForSave(currentMod.assets.img));
      await imgWritable.close();
    }
    
    // 创建 asset 子目录
    if (isSequenceModType(modType)) {
      await safeGetDirectoryHandle(assetDir, 'sequence', { create: true });
      await safeGetDirectoryHandle(assetDir, 'img', { create: true });
    }
    
    // 保存 text 目录
    const textDir = await safeGetDirectoryHandle(modFolderHandle, 'text', { create: true, overwriteFile: true });
    for (const [lang, data] of Object.entries(currentMod.texts)) {
      const langDir = await safeGetDirectoryHandle(textDir, lang, { create: true });
      
      if (data.info) {
        const infoHandle = await safeGetFileHandle(langDir, 'info.json', { create: true, overwriteDirectory: true });
        const infoWritable = await infoHandle.createWritable();
        await infoWritable.write(stringifyForSave(data.info));
        await infoWritable.close();
      }

      // 仅当启用时生成 text/<lang>/speech.json
      if (currentMod.textSpeechEnabled === true) {
        const speechHandle = await safeGetFileHandle(langDir, 'speech.json', { create: true, overwriteDirectory: true });
        const speechWritable = await speechHandle.createWritable();
        await speechWritable.write(stringifyForSave(data.speech));
        await speechWritable.close();
      }
    }

    // 保存 audio 目录（仅当启用时生成 audio/<lang>/speech.json）
    if (currentMod.audioSpeechEnabled === true) {
      const audioDir = await safeGetDirectoryHandle(modFolderHandle, 'audio', { create: true, overwriteFile: true });
      for (const [lang, data] of Object.entries(currentMod.audio)) {
        const langDir = await safeGetDirectoryHandle(audioDir, lang, { create: true });
        await safeGetDirectoryHandle(langDir, 'speech', { create: true });
        
        const speechHandle = await safeGetFileHandle(langDir, 'speech.json', { create: true, overwriteDirectory: true });
        const speechWritable = await speechHandle.createWritable();
        await speechWritable.write(stringifyForSave(data));
        await speechWritable.close();
      }
    }
    
    // 保存预览图（根据实际格式保存）
    if (currentMod.previewData) {
      // 从 data URL 中提取实际的 MIME 类型
      const actualExt = getExtensionFromDataUrl(currentMod.previewData) || currentPreviewExt;
      const previewHandle = await safeGetFileHandle(modFolderHandle, `preview.${actualExt}`, { create: true, overwriteDirectory: true });
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
      const iconHandle = await safeGetFileHandle(modFolderHandle, 'icon.ico', { create: true, overwriteDirectory: true });
      const iconWritable = await iconHandle.createWritable();
      const response = await fetch(currentMod.iconData);
      const blob = await response.blob();
      await iconWritable.write(blob);
      await iconWritable.close();
    }

    // 复制源目录/源 zip 中的资源文件到目标目录
    // 重要：如果当前 Mod 最初来自 .tbuddy，我们希望“每次保存”都能从 zip 兜底补齐资源。
    // 否则第一次保存后 `modFolderHandle` 不再为 null，会转而从上次保存目录复制，导致资源可能逐步缺失。

    // 1) 先从 zip 兜底复制（如果存在）
    if (sourceZip && sourceZipRootPath) {
      if (modType === 'live2d') {
        await copyAllFilesFromZipPrefixToDirectory(sourceZip, sourceZipRootPath, 'asset/live2d', modFolderHandle, 'asset/live2d');
        await copyNonJsonFilesFromLoadedZipToDirectory(sourceZip, sourceZipRootPath, modFolderHandle, { skipDirs: ['asset/live2d'] });
      } else if (modType === 'threed') {
        await copyAllFilesFromZipPrefixToDirectory(sourceZip, sourceZipRootPath, 'asset/3d', modFolderHandle, 'asset/3d');
        await copyNonJsonFilesFromLoadedZipToDirectory(sourceZip, sourceZipRootPath, modFolderHandle, { skipDirs: ['asset/3d'] });
      } else {
        await copyNonJsonFilesFromLoadedZipToDirectory(sourceZip, sourceZipRootPath, modFolderHandle);
      }
    }

    // 2) 再从源文件夹覆盖补充（如果存在）
    if (sourceFolderHandle) {
      if (modType === 'live2d') {
        try {
          const srcAssetDir = await sourceFolderHandle.getDirectoryHandle('asset');
          const srcLive2dDir = await srcAssetDir.getDirectoryHandle('live2d');
          await copyAllFilesBetweenDirectories(srcLive2dDir, modFolderHandle, 'asset/live2d');
        } catch (e) {
          // asset/live2d 目录不存在则跳过
        }
        await copyNonJsonFilesBetweenDirectories(sourceFolderHandle, modFolderHandle, { skipDirs: ['asset/live2d'] });
      } else if (modType === 'pngremix') {
        await copyNonJsonFilesBetweenDirectories(sourceFolderHandle, modFolderHandle);
      } else if (modType === 'threed') {
        try {
          const srcAssetDir = await sourceFolderHandle.getDirectoryHandle('asset');
          const srcThreeDDir = await srcAssetDir.getDirectoryHandle('3d');
          await copyAllFilesBetweenDirectories(srcThreeDDir, modFolderHandle, 'asset/3d');
        } catch (e) {
          // asset/3d 目录不存在则跳过
        }
        await copyNonJsonFilesBetweenDirectories(sourceFolderHandle, modFolderHandle, { skipDirs: ['asset/3d'] });
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
  } finally {
    // 恢复源句柄：从文件夹打开的 Mod 不应被“保存目标目录”覆盖
    if (sourceFolderHandle) {
      modFolderHandle = sourceFolderHandle;
    }
  }
}


/**
 * 导出 Mod (生成 .tbuddy ZIP)
 */
async function exportMod() {
  if (!currentMod) return;
  
  collectManifestData();
  collectBubbleStyle();
  collectAiTools();
  
  try {
    showToast(window.i18n.t('msg_exporting'), 'info');
    const jszip = new JSZip();
    const root = jszip.folder(currentMod.manifest.id);
    
    // 写入基础 JSON
    root.file('manifest.json', stringifyForSave(getManifestForSave()));
    if (currentMod.bubbleEnabled && currentMod.bubbleStyle) {
      root.file('bubble_style.json', stringifyForSave(currentMod.bubbleStyle));
    }
    if (currentMod.aiToolsEnabled && currentMod.aiTools) {
      root.file('ai_tools.json', stringifyForSave(currentMod.aiTools));
    }
    
    const asset = root.folder('asset');
    const exportModType = currentMod.manifest.mod_type || 'sequence';
    if (exportModType === 'live2d') {
      if (currentMod.assets.live2d) {
        asset.file('live2d.json', stringifyForSave(currentMod.assets.live2d));
      }
    } else if (exportModType === 'pngremix') {
      if (currentMod.assets.pngremix) {
        asset.file('pngremix.json', stringifyForSave(currentMod.assets.pngremix));
      }
    } else if (exportModType === 'threed') {
      if (currentMod.assets.threed) {
        asset.file('3d.json', stringifyForSave(currentMod.assets.threed));
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

    // 把当前 Mod 的资源文件打包进去
    if (modFolderHandle) {
      if (exportModType === 'live2d') {
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
      } else if (exportModType === 'threed') {
        // 3D mod：将 asset/3d/ 下所有文件（含 .vrm .vrma）完整打包
        try {
          const assetDirHandle = await modFolderHandle.getDirectoryHandle('asset');
          const threedDirHandle = await assetDirHandle.getDirectoryHandle('3d');
          await addAllFilesToZipFromDirectory(threedDirHandle, root, 'asset/3d');
        } catch (e) {
          // asset/3d 目录不存在则跳过
        }
        await addNonJsonFilesToZipFromDirectory(modFolderHandle, root, { skipDirs: ['asset/3d'] });
      } else {
        await addNonJsonFilesToZipFromDirectory(modFolderHandle, root);
      }
    } else if (zip && currentMod?._zipRootPath) {
      // 从已打开的 tbuddy(zip) 来源中补齐资源（解决“只有 json 没有资源”的问题）
      if (exportModType === 'live2d') {
        await addAllFilesFromZipPrefixToZip(zip, currentMod._zipRootPath, 'asset/live2d', root, 'asset/live2d');
        await addNonJsonFilesToZipFromLoadedZip(zip, currentMod._zipRootPath, root, { skipDirs: ['asset/live2d'] });
      } else if (exportModType === 'threed') {
        await addAllFilesFromZipPrefixToZip(zip, currentMod._zipRootPath, 'asset/3d', root, 'asset/3d');
        await addNonJsonFilesToZipFromLoadedZip(zip, currentMod._zipRootPath, root, { skipDirs: ['asset/3d'] });
      } else {
        await addNonJsonFilesToZipFromLoadedZip(zip, currentMod._zipRootPath, root);
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
 * 导出 Mod 为 .sbuddy 包
 *
 * 由于处理逻辑已移至独立的外部工具，
 * mod-tool（浏览器环境）无法直接调用二进制程序。
 *
 * 流程：先导出为 .tbuddy，然后用同目录下的 to-sbuddy 脚本将其转换为 .sbuddy。
 */
async function exportModSbuddy() {

  if (!currentMod) return;

  collectManifestData();
  collectBubbleStyle();
  collectAiTools();

  try {
    showToast(window.i18n.t('msg_exporting_sbuddy') || window.i18n.t('msg_exporting'), 'info');
    const jszip = new JSZip();
    const root = jszip.folder(currentMod.manifest.id);

    // ---- 与 exportMod 完全相同的打包逻辑 ----
    root.file('manifest.json', stringifyForSave(getManifestForSave()));
    if (currentMod.bubbleEnabled && currentMod.bubbleStyle) {
      root.file('bubble_style.json', stringifyForSave(currentMod.bubbleStyle));
    }
    if (currentMod.aiToolsEnabled && currentMod.aiTools) {
      root.file('ai_tools.json', stringifyForSave(currentMod.aiTools));
    }

    const asset = root.folder('asset');
    const exportModType2 = currentMod.manifest.mod_type || 'sequence';
    if (exportModType2 === 'live2d') {
      if (currentMod.assets.live2d) {
        asset.file('live2d.json', stringifyForSave(currentMod.assets.live2d));
      }
    } else if (exportModType2 === 'pngremix') {
      if (currentMod.assets.pngremix) {
        asset.file('pngremix.json', stringifyForSave(currentMod.assets.pngremix));
      }
    } else if (exportModType2 === 'threed') {
      if (currentMod.assets.threed) {
        asset.file('3d.json', stringifyForSave(currentMod.assets.threed));
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

    if (currentMod.previewData) {
      const actualExt = getExtensionFromDataUrl(currentMod.previewData) || currentPreviewExt;
      const base64Data = currentMod.previewData.split(',')[1];
      root.file(`preview.${actualExt}`, base64Data, { base64: true });
    }

    if (currentMod.iconData) {
      const base64Data = currentMod.iconData.split(',')[1];
      root.file('icon.ico', base64Data, { base64: true });
    }

    if (modFolderHandle) {
      if (exportModType2 === 'live2d') {
        try {
          const assetDirHandle = await modFolderHandle.getDirectoryHandle('asset');
          const live2dDirHandle = await assetDirHandle.getDirectoryHandle('live2d');
          await addAllFilesToZipFromDirectory(live2dDirHandle, root, 'asset/live2d');
        } catch (e) { /* skip */ }
        await addNonJsonFilesToZipFromDirectory(modFolderHandle, root, { skipDirs: ['asset/live2d'] });
      } else if (exportModType2 === 'threed') {
        try {
          const assetDirHandle = await modFolderHandle.getDirectoryHandle('asset');
          const threedDirHandle = await assetDirHandle.getDirectoryHandle('3d');
          await addAllFilesToZipFromDirectory(threedDirHandle, root, 'asset/3d');
        } catch (e) { /* skip */ }
        await addNonJsonFilesToZipFromDirectory(modFolderHandle, root, { skipDirs: ['asset/3d'] });
      } else {
        await addNonJsonFilesToZipFromDirectory(modFolderHandle, root);
      }
    } else if (zip && currentMod?._zipRootPath) {
      // 从已打开的 tbuddy(zip) 来源中补齐资源（与 exportMod 保持一致）
      if (exportModType2 === 'live2d') {
        await addAllFilesFromZipPrefixToZip(zip, currentMod._zipRootPath, 'asset/live2d', root, 'asset/live2d');
        await addNonJsonFilesToZipFromLoadedZip(zip, currentMod._zipRootPath, root, { skipDirs: ['asset/live2d'] });
      } else if (exportModType2 === 'threed') {
        await addAllFilesFromZipPrefixToZip(zip, currentMod._zipRootPath, 'asset/3d', root, 'asset/3d');
        await addNonJsonFilesToZipFromLoadedZip(zip, currentMod._zipRootPath, root, { skipDirs: ['asset/3d'] });
      } else {
        await addNonJsonFilesToZipFromLoadedZip(zip, currentMod._zipRootPath, root);
      }
    }
    // ---- 打包逻辑结束 ----


    // 生成 ZIP 字节并保存为 .tbuddy
    const zipBlob = await jszip.generateAsync({ type: 'blob' });

    const fileHandle = await window.showSaveFilePicker({
      suggestedName: getSuggestedTbuddyFileName(currentMod.manifest.id),
      types: [{ description: 'TrayBuddy Mod', accept: { 'application/octet-stream': ['.tbuddy'] } }]
    });

    const writable = await fileHandle.createWritable();
    await writable.write(zipBlob);
    await writable.close();

    // 提示用户使用外部工具转换

    showToast(
      window.i18n.t('msg_export_sbuddy_tbuddy_saved') ||
      '已保存为 .tbuddy，请使用外部工具将其转换为 .sbuddy',
      'info',
      8000
    );


  } catch (e) {
    if (e.name !== 'AbortError') {
      console.error('Failed to export for .sbuddy:', e);
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

// ============================================================================
// AI 工具配置 (ai_tools.json)
// ============================================================================

/**
 * 切换 AI 工具启用状态
 */
function toggleAiTools() {
  const enabled = document.getElementById('aitools-enable').checked;
  const fields = document.getElementById('aitools-fields');

  if (enabled) {
    fields.classList.remove('bubble-disabled');
    fields.classList.add('bubble-enabled');
  } else {
    fields.classList.remove('bubble-enabled');
    fields.classList.add('bubble-disabled');
  }

  if (currentMod) {
    currentMod.aiToolsEnabled = enabled;
    if (enabled && !currentMod.aiTools) {
      currentMod.aiTools = { ai_tools: [] };
    }
    markUnsaved();
  }
}

/**
 * 填充 AI 工具编辑面板
 */
function populateAiTools() {
  if (!currentMod) return;

  const enabled = currentMod.aiToolsEnabled === true;
  document.getElementById('aitools-enable').checked = enabled;

  const fields = document.getElementById('aitools-fields');
  if (enabled) {
    fields.classList.remove('bubble-disabled');
    fields.classList.add('bubble-enabled');
  } else {
    fields.classList.remove('bubble-enabled');
    fields.classList.add('bubble-disabled');
  }

  const searchEl = document.getElementById('aitools-process-search');
  if (searchEl) searchEl.value = '';

  renderAiToolProcessList();
}

/**
 * 进程搜索过滤
 */
function filterAiToolProcesses() {
  const keyword = (document.getElementById('aitools-process-search')?.value || '').trim().toLowerCase();
  const container = document.getElementById('aitools-process-list');
  if (!container) return;
  container.querySelectorAll('.aitools-process-card').forEach(card => {
    const name = (card.dataset.processName || '').toLowerCase();
    card.style.display = (!keyword || name.includes(keyword)) ? '' : 'none';
  });
}

/**
 * 工具搜索过滤
 */
function filterAiToolTools(pIdx) {
  const input = document.getElementById(`aitools-tool-search-${pIdx}`);
  const keyword = (input?.value || '').trim().toLowerCase();
  const container = document.getElementById(`aitools-tools-${pIdx}`);
  if (!container) return;
  container.querySelectorAll('.aitools-tool-card').forEach(card => {
    const name = (card.dataset.toolName || '').toLowerCase();
    card.style.display = (!keyword || name.includes(keyword)) ? '' : 'none';
  });
}

/**
 * 渲染进程列表
 */
function renderAiToolProcessList() {
  const container = document.getElementById('aitools-process-list');
  if (!container) return;
  container.innerHTML = '';

  const processes = currentMod?.aiTools?.ai_tools;
  if (!Array.isArray(processes) || processes.length === 0) {
    container.innerHTML = `<div class="empty-hint" style="padding:20px;text-align:center;color:#64748b;">${window.i18n?.t('aitools_no_processes') || '暂无进程配置，点击「添加进程」开始'}</div>`;
    return;
  }

  processes.forEach((proc, pIdx) => {
    const procEl = document.createElement('div');
    procEl.className = 'card aitools-process-card tb-sort-item';
    procEl.dataset.sortKey = String(pIdx);
    procEl.dataset.processName = proc.process_name || '';
    procEl.style.cssText = 'margin-bottom:16px;padding:16px;border:1px solid #334155;border-radius:8px;background:#1e293b;';

    procEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        ${renderSortHandleHtml()}
        <label style="white-space:nowrap;font-weight:600;color:#94a3b8;">${window.i18n?.t('aitools_process_name') || '进程名'}:</label>
        <input type="text" class="aitools-process-name" data-pidx="${pIdx}" value="${escapeHtml(proc.process_name || '')}" style="flex:1;" placeholder="example_game.exe">
        <button class="btn btn-sm btn-ghost" onclick="copyAiToolProcess(${pIdx})" title="${window.i18n?.t('btn_copy_to_clipboard') || '复制'}">📋</button>
        <button class="btn btn-sm btn-danger" onclick="removeAiToolProcess(${pIdx})" title="${window.i18n?.t('btn_delete') || '删除'}">🗑️</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
        <h4 style="margin:0;color:#e2e8f0;">${window.i18n?.t('aitools_tool_data') || '工具列表'}</h4>
        <div style="flex:1;"></div>
        <input type="text" id="aitools-tool-search-${pIdx}" placeholder="${window.i18n?.t('aitools_search_tool_hint') || '搜索工具...'}" oninput="filterAiToolTools(${pIdx})" style="width:150px;padding:4px 8px;font-size:12px;">
        <button class="btn btn-sm btn-ghost" onclick="pasteAiToolData(${pIdx})">📋 ${window.i18n?.t('btn_paste_from_clipboard') || '粘贴'}</button>
        <button class="btn btn-sm btn-ghost" onclick="addAiToolData(${pIdx})">➕ ${window.i18n?.t('aitools_add_tool') || '添加工具'}</button>
      </div>
      <div class="aitools-tool-list" id="aitools-tools-${pIdx}"></div>
    `;

    container.appendChild(procEl);

    // 监听进程名变化
    const nameInput = procEl.querySelector('.aitools-process-name');
    nameInput.addEventListener('change', () => {
      procEl.dataset.processName = nameInput.value.trim();
      collectAiTools();
      markUnsaved();
    });

    // 渲染工具列表
    const toolContainer = procEl.querySelector(`#aitools-tools-${pIdx}`);
    if (Array.isArray(proc.tool_data)) {
      proc.tool_data.forEach((tool, tIdx) => {
        toolContainer.appendChild(renderAiToolDataItem(pIdx, tIdx, tool));
      });
    }

    // 初始化工具拖拽排序
    enableTbSortable(toolContainer, {
      itemSelector: '.aitools-tool-card',
      handleSelector: '.tb-drag-handle',
      onSortedKeys(keys) {
        collectAiTools();
        const proc = currentMod?.aiTools?.ai_tools?.[pIdx];
        if (!proc) return;
        const oldTools = [...proc.tool_data];
        proc.tool_data = keys.map(k => oldTools[parseInt(k, 10)]).filter(Boolean);
        renderAiToolProcessList();
        markUnsaved();
      }
    });
  });

  // 初始化进程拖拽排序
  enableTbSortable(container, {
    itemSelector: '.aitools-process-card',
    handleSelector: '.tb-drag-handle',
    onSortedKeys(keys) {
      collectAiTools();
      const oldProcs = [...currentMod.aiTools.ai_tools];
      currentMod.aiTools.ai_tools = keys.map(k => oldProcs[parseInt(k, 10)]).filter(Boolean);
      renderAiToolProcessList();
      markUnsaved();
    }
  });
}

/**
 * 生成 manifest 中已定义的 trigger event 名称的 <option> 列表 HTML
 */
function getManifestTriggerOptions() {
  const triggers = currentMod?.manifest?.triggers || [];
  const placeholder = window.i18n?.t('aitools_trigger_name_hint') || '触发器名称';
  let html = `<option value="" disabled selected>${placeholder}</option>`;
  triggers.forEach(t => {
    const ev = t.event || '';
    if (ev) html += `<option value="${escapeHtml(ev)}">${escapeHtml(ev)}</option>`;
  });
  return html;
}

/**
 * 渲染触发器映射可视化列表
 */
function renderAiToolTriggersList(triggers, pIdx, tIdx) {
  const id = `ait-triggers-list-${pIdx}-${tIdx}`;
  let html = `<div id="${id}" class="tag-list" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">`;
  (triggers || []).forEach((t, i) => {
    html += `<span class="tag-item" style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:#1e3a5f;border-radius:4px;font-size:12px;color:#93c5fd;">
      ${escapeHtml(t.keyword)} → ${escapeHtml(t.trigger)}
      <button type="button" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px;padding:0;line-height:1;" onclick="removeAiToolTrigger(${pIdx},${tIdx},${i})">×</button>
    </span>`;
  });
  html += `</div>`;
  return html;
}

/**
 * 渲染单个 AI 工具条目
 */
function renderAiToolDataItem(pIdx, tIdx, tool) {
  const el = document.createElement('details');
  el.className = 'ai-tool-item aitools-tool-card tb-sort-item';
  el.dataset.sortKey = String(tIdx);
  el.dataset.toolName = tool.name || '';
  el.style.cssText = 'margin-bottom:8px;padding:12px;border:1px solid #475569;border-radius:6px;background:#0f172a;';
  el.open = false;

  const promptsStr = (tool.prompts || []).join('\n');

  el.innerHTML = `
    <summary style="cursor:pointer;display:flex;align-items:center;gap:8px;">
      ${renderSortHandleHtml()}
      <span style="font-weight:600;color:#e2e8f0;">${escapeHtml(tool.name || 'tool_' + tIdx)}</span>
      <span style="color:#64748b;font-size:12px;">[${tool.tool_type || tool.type || 'manual'}]</span>
      <span style="flex:1;"></span>
      <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();copyAiToolData(${pIdx},${tIdx})" title="${window.i18n?.t('btn_copy_to_clipboard') || '复制'}">📋</button>
      <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();removeAiToolData(${pIdx},${tIdx})" title="${window.i18n?.t('btn_delete') || '删除'}">🗑️</button>
    </summary>
    <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;">
      <div class="form-group">
        <label>${window.i18n?.t('aitools_field_name') || '名称'}</label>
        <input type="text" class="ait-name" data-pidx="${pIdx}" data-tidx="${tIdx}" value="${escapeHtml(tool.name || '')}">
      </div>
      <div class="form-group">
        <label>${window.i18n?.t('aitools_field_type') || '类型'}</label>
        <select class="ait-type" data-pidx="${pIdx}" data-tidx="${tIdx}">
          <option value="manual" ${(tool.tool_type || tool.type) === 'manual' ? 'selected' : ''}>manual</option>
          <option value="auto" ${(tool.tool_type || tool.type) === 'auto' ? 'selected' : ''}>auto</option>
        </select>
      </div>
      <div class="form-group">
        <label>${window.i18n?.t('aitools_field_auto_start') || '自动启动'}</label>
        <label class="switch">
          <input type="checkbox" class="ait-auto-start" data-pidx="${pIdx}" data-tidx="${tIdx}" ${tool.auto_start ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
      <div class="form-group" style="grid-column:span 2;">
        <label>
          ${window.i18n?.t('aitools_field_capture_rect') || '截取区域'} (x, y, width, height)
          <button type="button" class="capture-rect-edit-btn" onclick="openCaptureRectEditor(${pIdx},${tIdx})">📐 ${window.i18n?.t('capture_rect_visual_edit') || '可视化编辑'}</button>
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;">
          <input type="number" class="ait-rect-x" data-pidx="${pIdx}" data-tidx="${tIdx}" value="${tool.capture_rect?.x ?? 0}" placeholder="x">
          <input type="number" class="ait-rect-y" data-pidx="${pIdx}" data-tidx="${tIdx}" value="${tool.capture_rect?.y ?? 0}" placeholder="y">
          <input type="number" class="ait-rect-w" data-pidx="${pIdx}" data-tidx="${tIdx}" value="${tool.capture_rect?.width ?? 1920}" placeholder="width">
          <input type="number" class="ait-rect-h" data-pidx="${pIdx}" data-tidx="${tIdx}" value="${tool.capture_rect?.height ?? 1080}" placeholder="height">
        </div>
      </div>
      <div class="form-group" style="grid-column:span 2;">
        <label>${window.i18n?.t('aitools_field_prompts') || '提示词'} <small style="color:#64748b;">(${window.i18n?.t('aitools_field_prompts_hint') || '每行一条'})</small></label>
        <textarea class="ait-prompts" data-pidx="${pIdx}" data-tidx="${tIdx}" rows="3" style="font-size:13px;">${escapeHtml(promptsStr)}</textarea>
      </div>
      <div class="form-group" style="grid-column:span 2;">
        <label>${window.i18n?.t('aitools_field_triggers') || '触发器映射'}</label>
        <div style="display:flex;gap:4px;">
          <input type="text" id="ait-trigger-keyword-input-${pIdx}-${tIdx}" placeholder="${window.i18n?.t('aitools_trigger_keyword_hint') || '关键词'}" style="flex:1;">
          <select id="ait-trigger-name-input-${pIdx}-${tIdx}" style="flex:1;">${getManifestTriggerOptions()}</select>
          <button class="btn btn-sm btn-ghost" onclick="addAiToolTrigger(${pIdx},${tIdx})">➕</button>
        </div>
        ${renderAiToolTriggersList(tool.triggers, pIdx, tIdx)}
      </div>
      <div class="form-group">
        <label>${window.i18n?.t('aitools_field_show_info_window') || '显示信息窗口'}</label>
        <label class="switch">
          <input type="checkbox" class="ait-show-info-window" data-pidx="${pIdx}" data-tidx="${tIdx}" ${tool.show_info_window ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
    </div>
  `;

  // 给所有输入元素添加 change 监听
  setTimeout(() => {
    el.querySelectorAll('input, textarea, select').forEach(inp => {
      // 排除触发器映射的输入框（这些有独立处理）
      if (inp.id && (inp.id.startsWith('ait-trigger-keyword-input-') || inp.id.startsWith('ait-trigger-name-input-'))) return;
      inp.addEventListener('change', () => {
        collectAiTools();
        // 同步工具名到 summary 和 dataset
        if (inp.classList.contains('ait-name')) {
          const summary = el.querySelector('summary span:first-of-type');
          if (summary) summary.textContent = inp.value || 'tool_' + tIdx;
          el.dataset.toolName = inp.value || '';
        }
        markUnsaved();
      });
    });
    // Enter 添加触发器映射
    const triggerKeywordInput = el.querySelector(`#ait-trigger-keyword-input-${pIdx}-${tIdx}`);
    if (triggerKeywordInput) {
      triggerKeywordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addAiToolTrigger(pIdx, tIdx); }
      });
    }
  }, 0);

  return el;
}

/* ---- 触发器映射列表操作 ---- */

function addAiToolTrigger(pIdx, tIdx) {
  const keywordInput = document.getElementById(`ait-trigger-keyword-input-${pIdx}-${tIdx}`);
  const nameInput = document.getElementById(`ait-trigger-name-input-${pIdx}-${tIdx}`);
  if (!keywordInput || !nameInput) return;
  const keyword = keywordInput.value.trim();
  const trigger = nameInput.value.trim();
  if (!keyword || !trigger) return;

  const proc = currentMod?.aiTools?.ai_tools?.[pIdx];
  if (!proc?.tool_data?.[tIdx]) return;
  if (!Array.isArray(proc.tool_data[tIdx].triggers)) proc.tool_data[tIdx].triggers = [];
  proc.tool_data[tIdx].triggers.push({ keyword, trigger });
  keywordInput.value = '';
  nameInput.selectedIndex = 0;

  const listContainer = document.getElementById(`ait-triggers-list-${pIdx}-${tIdx}`);
  if (listContainer) {
    listContainer.outerHTML = renderAiToolTriggersList(proc.tool_data[tIdx].triggers, pIdx, tIdx);
  }
  markUnsaved();
}

function removeAiToolTrigger(pIdx, tIdx, trigIdx) {
  const proc = currentMod?.aiTools?.ai_tools?.[pIdx];
  if (!proc?.tool_data?.[tIdx]?.triggers) return;
  proc.tool_data[tIdx].triggers.splice(trigIdx, 1);

  const listContainer = document.getElementById(`ait-triggers-list-${pIdx}-${tIdx}`);
  if (listContainer) {
    listContainer.outerHTML = renderAiToolTriggersList(proc.tool_data[tIdx].triggers, pIdx, tIdx);
  }
  markUnsaved();
}

/* ---- 复制/粘贴进程 ---- */

async function copyAiToolProcess(pIdx) {
  collectAiTools();
  const proc = currentMod?.aiTools?.ai_tools?.[pIdx];
  if (!proc) { showToast(window.i18n?.t('msg_no_data_to_copy') || 'No data', 'warning'); return; }
  try {
    await navigator.clipboard.writeText(JSON.stringify({ type: 'tbuddy_aitools_process', data: proc }, null, 2));
    showToast(window.i18n?.t('msg_copied_to_clipboard') || 'Copied', 'success');
  } catch (e) {
    showToast(window.i18n?.t('msg_clipboard_read_failed') || 'Failed', 'error');
  }
}

async function pasteAiToolProcess() {
  if (!currentMod) return;
  try {
    const text = await navigator.clipboard.readText();
    const parsed = JSON.parse(text);
    if (parsed.type !== 'tbuddy_aitools_process' || typeof parsed.data !== 'object') {
      showToast(window.i18n?.t('msg_clipboard_empty') || 'Empty', 'warning');
      return;
    }
    if (!currentMod.aiTools) currentMod.aiTools = { ai_tools: [] };
    if (!Array.isArray(currentMod.aiTools.ai_tools)) currentMod.aiTools.ai_tools = [];
    currentMod.aiTools.ai_tools.push(JSON.parse(JSON.stringify(parsed.data)));
    renderAiToolProcessList();
    markUnsaved();
    showToast(window.i18n?.t('msg_pasted_from_clipboard') || 'Pasted', 'success');
  } catch (e) {
    showToast(window.i18n?.t('msg_clipboard_empty') || 'Empty', 'warning');
  }
}

/* ---- 复制/粘贴工具 ---- */

async function copyAiToolData(pIdx, tIdx) {
  collectAiTools();
  const tool = currentMod?.aiTools?.ai_tools?.[pIdx]?.tool_data?.[tIdx];
  if (!tool) { showToast(window.i18n?.t('msg_no_data_to_copy') || 'No data', 'warning'); return; }
  try {
    await navigator.clipboard.writeText(JSON.stringify({ type: 'tbuddy_aitools_tool', data: tool }, null, 2));
    showToast(window.i18n?.t('msg_copied_to_clipboard') || 'Copied', 'success');
  } catch (e) {
    showToast(window.i18n?.t('msg_clipboard_read_failed') || 'Failed', 'error');
  }
}

async function pasteAiToolData(pIdx) {
  if (!currentMod?.aiTools?.ai_tools?.[pIdx]) return;
  try {
    const text = await navigator.clipboard.readText();
    const parsed = JSON.parse(text);
    if (parsed.type !== 'tbuddy_aitools_tool' || typeof parsed.data !== 'object') {
      showToast(window.i18n?.t('msg_clipboard_empty') || 'Empty', 'warning');
      return;
    }
    currentMod.aiTools.ai_tools[pIdx].tool_data.push(JSON.parse(JSON.stringify(parsed.data)));
    renderAiToolProcessList();
    markUnsaved();
    showToast(window.i18n?.t('msg_pasted_from_clipboard') || 'Pasted', 'success');
  } catch (e) {
    showToast(window.i18n?.t('msg_clipboard_empty') || 'Empty', 'warning');
  }
}

/**
 * 添加进程
 */
function addAiToolProcess() {
  if (!currentMod) return;
  if (!currentMod.aiTools) {
    currentMod.aiTools = { ai_tools: [] };
  }
  currentMod.aiTools.ai_tools.push({
    process_name: '',
    tool_data: []
  });
  renderAiToolProcessList();
  markUnsaved();
}

/**
 * 删除进程
 */
function removeAiToolProcess(pIdx) {
  if (!currentMod?.aiTools?.ai_tools) return;
  currentMod.aiTools.ai_tools.splice(pIdx, 1);
  renderAiToolProcessList();
  markUnsaved();
}

/**
 * 添加工具
 */
function addAiToolData(pIdx) {
  if (!currentMod?.aiTools?.ai_tools?.[pIdx]) return;
  currentMod.aiTools.ai_tools[pIdx].tool_data.push({
    name: '',
    auto_start: false,
    type: 'manual',
    capture_rect: { x: 0, y: 0, width: 1920, height: 1080 },
    prompts: [],
    triggers: [],
    show_info_window: false
  });
  renderAiToolProcessList();
  markUnsaved();
}

/**
 * 删除工具
 */
function removeAiToolData(pIdx, tIdx) {
  if (!currentMod?.aiTools?.ai_tools?.[pIdx]?.tool_data) return;
  currentMod.aiTools.ai_tools[pIdx].tool_data.splice(tIdx, 1);
  renderAiToolProcessList();
  markUnsaved();
}

/**
 * 从 DOM 收集 AI 工具数据到 currentMod.aiTools
 */
function collectAiTools() {
  if (!currentMod) return;
  if (!currentMod.aiTools) {
    currentMod.aiTools = { ai_tools: [] };
  }
  if (!Array.isArray(currentMod.aiTools.ai_tools)) {
    currentMod.aiTools.ai_tools = [];
  }

  // 收集每个进程
  document.querySelectorAll('.aitools-process-name').forEach(el => {
    const pIdx = parseInt(el.dataset.pidx, 10);
    if (currentMod.aiTools.ai_tools[pIdx]) {
      currentMod.aiTools.ai_tools[pIdx].process_name = el.value.trim();
    }
  });

  // 收集每个工具（triggers 由独立操作管理，这里只收集其他字段）
  document.querySelectorAll('.ait-name').forEach(el => {
    const pIdx = parseInt(el.dataset.pidx, 10);
    const tIdx = parseInt(el.dataset.tidx, 10);
    const proc = currentMod.aiTools.ai_tools[pIdx];
    if (!proc?.tool_data?.[tIdx]) return;
    const tool = proc.tool_data[tIdx];

    // name
    tool.name = el.value.trim();

    // type
    const typeEl = document.querySelector(`.ait-type[data-pidx="${pIdx}"][data-tidx="${tIdx}"]`);
    if (typeEl) tool.type = typeEl.value;

    // auto_start
    const autoStartEl = document.querySelector(`.ait-auto-start[data-pidx="${pIdx}"][data-tidx="${tIdx}"]`);
    if (autoStartEl) tool.auto_start = autoStartEl.checked;

    // show_info_window
    const showInfoEl = document.querySelector(`.ait-show-info-window[data-pidx="${pIdx}"][data-tidx="${tIdx}"]`);
    if (showInfoEl) tool.show_info_window = showInfoEl.checked;

    // capture_rect
    const rx = document.querySelector(`.ait-rect-x[data-pidx="${pIdx}"][data-tidx="${tIdx}"]`);
    const ry = document.querySelector(`.ait-rect-y[data-pidx="${pIdx}"][data-tidx="${tIdx}"]`);
    const rw = document.querySelector(`.ait-rect-w[data-pidx="${pIdx}"][data-tidx="${tIdx}"]`);
    const rh = document.querySelector(`.ait-rect-h[data-pidx="${pIdx}"][data-tidx="${tIdx}"]`);
    tool.capture_rect = {
      x: parseInt(rx?.value, 10) || 0,
      y: parseInt(ry?.value, 10) || 0,
      width: parseInt(rw?.value, 10) || 1920,
      height: parseInt(rh?.value, 10) || 1080
    };

    // prompts
    const promptsEl = document.querySelector(`.ait-prompts[data-pidx="${pIdx}"][data-tidx="${tIdx}"]`);
    if (promptsEl) {
      tool.prompts = promptsEl.value.split('\n').map(s => s.trim()).filter(Boolean);
    }
  });
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

  // 贴图降采样（3D Mod 不适用）
  const texDownsampleEl = document.getElementById('enable-texture-downsample');
  if (texDownsampleEl) texDownsampleEl.checked = m.enable_texture_downsample === true;

  const texDownsampleStartDimEl = document.getElementById('texture-downsample-start-dim');
  if (texDownsampleStartDimEl) {
    const v = Number(m.texture_downsample_start_dim);
    texDownsampleStartDimEl.value = Number.isFinite(v) && v >= 0 ? String(Math.floor(v)) : '300';
  }

  // 全局键盘
  document.getElementById('global-keyboard').checked = m.global_keyboard === true;

  // 全局鼠标
  document.getElementById('global-mouse').checked = m.global_mouse === true;

  // Mod 类型显示
  const modType = m.mod_type || 'sequence';
  const modTypeDisplay = document.getElementById('mod-type-display');
  if (modTypeDisplay) {
    modTypeDisplay.value = getModTypeDisplayText(modType);
  }

  // 根据类型切换资产编辑区
  toggleAssetSections(modType);

  // 角色配置和边框配置仅用于序列帧
  const isSeqMod = isSequenceModType(modType);
  const charSection = document.getElementById('section-character-config');
  const borderSection = document.getElementById('section-border-config');
  if (charSection) charSection.style.display = isSeqMod ? '' : 'none';
  if (borderSection) borderSection.style.display = isSeqMod ? '' : 'none';
  
  // 更新动画下拉列表
  updateAnimaSelects();
  document.getElementById('border-anima').value = m.border?.anima || '';
  
  // 显示预览图
  if (currentMod.previewData) {
    document.getElementById('preview-image').innerHTML = `<img src="${currentMod.previewData}" alt="${window.i18n.t('preview_alt')}">`;

  } else {
    document.getElementById('preview-image').innerHTML = `<span class="preview-placeholder">${window.i18n.t('preview_placeholder')}</span>`;
  }
  
  // 显示图标
  if (currentMod.iconData) {
    document.getElementById('icon-image').innerHTML = `<img src="${currentMod.iconData}" alt="${window.i18n.t('icon_alt')}">`;

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

  // 贴图降采样（3D Mod 不适用；即使隐藏也保持字段可保存）
  const texDownsampleEl = document.getElementById('enable-texture-downsample');
  if (texDownsampleEl) {
    m.enable_texture_downsample = texDownsampleEl.checked === true;
  } else if (typeof m.enable_texture_downsample !== 'boolean') {
    m.enable_texture_downsample = false;
  }

  const texDownsampleStartDimEl = document.getElementById('texture-downsample-start-dim');
  if (texDownsampleStartDimEl) {
    const n = Math.floor(Number(texDownsampleStartDimEl.value));
    m.texture_downsample_start_dim = Number.isFinite(n) && n > 0 ? n : 0;
  } else if (!Number.isFinite(Number(m.texture_downsample_start_dim))) {
    m.texture_downsample_start_dim = 0;
  }

  // 全局键盘
  m.global_keyboard = document.getElementById('global-keyboard').checked;

  // 全局鼠标
  m.global_mouse = document.getElementById('global-mouse').checked;

  // 收集 Live2D 模型配置
  if (m.mod_type === 'live2d') {
    collectLive2dModelData();
  }
  // 收集 PngRemix 配置
  if (m.mod_type === 'pngremix') {
    collectPngRemixModelData();
  }
  // 收集 3D 配置
  if (m.mod_type === 'threed') {
    collectThreeDModelData();
  }
}

/**
 * 更新动画下拉列表
 */
function updateAnimaSelects() {
  const modType = getModType();
  let allAnimas;
  
  if (modType === 'live2d' && currentMod.assets.live2d) {
    // Live2D: 使用 states 中的 state 名称作为动画名
    const live2d = currentMod.assets.live2d;
    const stateNames = (live2d.states || []).map(s => s.state);
    const motionNames = (live2d.motions || []).map(m => m.name);
    allAnimas = [...new Set([...stateNames, ...motionNames])];
  } else if (modType === 'pngremix') {
    // PngRemix: 使用 pngremix states 的 state 名称
    const pngremix = currentMod.assets.pngremix;
    if (pngremix) {
      const stateNames = (pngremix.states || []).map(s => s.state);
      const exprNames = (pngremix.expressions || []).map(e => e.name);
      allAnimas = [...new Set([...stateNames, ...exprNames])];
    } else {
      allAnimas = [];
    }
  } else if (modType === 'threed') {
    const threed = currentMod.assets.threed;
    if (threed) {
      allAnimas = (threed.animations || []).map(a => a.name).filter(Boolean);
    } else {
      allAnimas = [];
    }
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
    <button class="btn btn-sm btn-danger" onclick="deleteAllStates()">🗑️ <span data-i18n="btn_delete_all">${window.i18n.t('btn_delete_all')}</span></button>
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
 * 渲染核心状态列表（idle / silence / dragging / music）
 */
function renderCoreStates() {
  const container = document.getElementById('core-states-list');
  if (!container) return;
  container.innerHTML = '';

  const coreKeys = ['idle', 'silence', 'dragging', 'music'];
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
  const coreKeys = ['idle', 'silence', 'dragging', 'music'];
  const stateOrder = ['silence_start', 'silence_end', 'drag_start', 'drag_end', 'music_start', 'music_end', 'birthday', 'firstday'];

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
 * 全部删除普通状态
 */
function deleteAllStates() {
  if (!currentMod) return;
  const states = currentMod.manifest.states || [];
  if (states.length === 0) return;
  if (!confirm(window.i18n.t('msg_confirm_delete_all_states'))) return;
  currentMod.manifest.states = [];
  markUnsaved();
  renderStates();
  showToast(window.i18n.t('msg_deleted_all_states'), 'success');
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
  ['state-limits-options', 'state-can-trigger-options', 'state-data-counter-options', 'state-live2d-params-options', 'state-pngremix-params-options', 'state-branch-options'].forEach((id) => {
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
          opt.textContent = `${v} - (${window.i18n.t('custom_option')})`;
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
  
  // Live2D 参数覆写面板可见性
  const modType = getModType();
  const live2dParamsPanel = document.getElementById('state-live2d-params-options');
  if (live2dParamsPanel) {
    live2dParamsPanel.style.display = modType === 'live2d' ? '' : 'none';
  }
  renderLive2DParams(state.live2d_params || []);

  // PngRemix 参数覆写面板可见性
  const pngremixParamsPanel = document.getElementById('state-pngremix-params-options');
  if (pngremixParamsPanel) {
    pngremixParamsPanel.style.display = modType === 'pngremix' ? '' : 'none';
  }
  renderPngRemixParams(state.pngremix_params || []);

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

  const t = window.i18n?.t ? window.i18n.t.bind(window.i18n) : null;
  const targetLabel = t ? t('live2d_param_target_label') : 'Target';
  const targetParameter = t ? t('live2d_param_target_parameter') : 'Parameter';
  const targetPart = t ? t('live2d_param_target_partopacity') : 'PartOpacity';
  const paramIdPlaceholder = t ? t('live2d_param_id_placeholder') : 'ParamAngleX';


  params.forEach((param, index) => {

    const item = document.createElement('div');
    const target = param.target === 'PartOpacity' ? 'PartOpacity' : 'Parameter';
    item.className = 'branch-item';
    item.innerHTML = `
      <input type="text" data-live2d-param-id="${index}" value="${param.id || ''}" placeholder="${paramIdPlaceholder}" style="flex:1;">

      <input type="number" data-live2d-param-value="${index}" value="${param.value ?? 0}" step="0.1" style="width:100px;">
      <select data-live2d-param-target="${index}" title="${targetLabel}" style="width:140px;">
        <option value="Parameter" ${target === 'Parameter' ? 'selected' : ''}>${targetParameter}</option>
        <option value="PartOpacity" ${target === 'PartOpacity' ? 'selected' : ''}>${targetPart}</option>
      </select>
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
  const t = window.i18n?.t ? window.i18n.t.bind(window.i18n) : null;
  const targetLabel = t ? t('live2d_param_target_label') : 'Target';
  const targetParameter = t ? t('live2d_param_target_parameter') : 'Parameter';
  const targetPart = t ? t('live2d_param_target_partopacity') : 'PartOpacity';
  const paramIdPlaceholder = t ? t('live2d_param_id_placeholder') : 'ParamAngleX';


  const item = document.createElement('div');

  item.className = 'branch-item';
  item.innerHTML = `
    <input type="text" data-live2d-param-id="${index}" value="" placeholder="${paramIdPlaceholder}" style="flex:1;">

    <input type="number" data-live2d-param-value="${index}" value="0" step="0.1" style="width:100px;">
    <select data-live2d-param-target="${index}" title="${targetLabel}" style="width:140px;">
      <option value="Parameter" selected>${targetParameter}</option>
      <option value="PartOpacity">${targetPart}</option>
    </select>
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
    const targetEl = list.querySelector(`[data-live2d-param-target="${idx}"]`);
    const value = parseFloat(valEl?.value) || 0;
    const target = targetEl?.value === 'PartOpacity' ? 'PartOpacity' : 'Parameter';
    if (id) {
      params.push({ id, value, target });
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
    pngremix_params: collectPngRemixParams(),
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
    <button class="btn btn-sm btn-danger" onclick="deleteAllTriggers()">🗑️ <span data-i18n="btn_delete_all">${window.i18n.t('btn_delete_all')}</span></button>
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
 * 全部删除触发器
 */
function deleteAllTriggers() {
  if (!currentMod) return;
  const triggers = currentMod.manifest.triggers || [];
  if (triggers.length === 0) return;
  if (!confirm(window.i18n.t('msg_confirm_delete_all_triggers'))) return;
  currentMod.manifest.triggers = [];
  markUnsaved();
  renderTriggers();
  showToast(window.i18n.t('msg_deleted_all_triggers'), 'success');
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
  
  const modType = getModType();
  toggleAssetSections(modType);
  
  if (modType === 'live2d') {
    renderLive2dAssets();
  } else if (modType === 'pngremix') {
    renderPngRemixAssets();
  } else if (modType === 'threed') {
    renderThreeDAssets();
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
 * 获取 Mod 类型的显示文本
 */
function getModTypeDisplayText(modType) {
  const mt = modType || getModType();
  switch (mt) {
    case 'live2d': return 'Live2D';
    case 'pngremix': return window.i18n.t('mod_type_pngremix');
    case 'threed': return window.i18n.t('mod_type_threed');
    default: return window.i18n.t('mod_type_sequence');
  }
}

/**
 * 判断是否为序列帧 Mod（仅序列帧才有 sequence/img 资源和角色/边框配置）
 */
function isSequenceModType(modType) {
  const mt = modType || getModType();
  return mt === 'sequence';
}

/**
 * 切换资产编辑区显示
 */
function toggleAssetSections(modType) {
  const seqSection = document.getElementById('assets-sequence-section');
  const live2dSection = document.getElementById('assets-live2d-section');
  const pngremixSection = document.getElementById('assets-pngremix-section');
  const threedSection = document.getElementById('assets-threed-section');
  const descEl = document.getElementById('assets-desc-text');
  
  if (modType === 'live2d') {
    if (seqSection) seqSection.style.display = 'none';
    if (live2dSection) live2dSection.style.display = '';
    if (pngremixSection) pngremixSection.style.display = 'none';
    if (threedSection) threedSection.style.display = 'none';
    if (descEl) descEl.setAttribute('data-i18n', 'assets_desc_live2d');
    if (descEl) descEl.textContent = window.i18n.t('assets_desc_live2d');
  } else if (modType === 'pngremix') {
    if (seqSection) seqSection.style.display = 'none';
    if (live2dSection) live2dSection.style.display = 'none';
    if (pngremixSection) pngremixSection.style.display = '';
    if (threedSection) threedSection.style.display = 'none';
    if (descEl) descEl.setAttribute('data-i18n', 'assets_desc_pngremix');
    if (descEl) descEl.textContent = window.i18n.t('assets_desc_pngremix');
  } else if (modType === 'threed') {
    if (seqSection) seqSection.style.display = 'none';
    if (live2dSection) live2dSection.style.display = 'none';
    if (pngremixSection) pngremixSection.style.display = 'none';
    if (threedSection) threedSection.style.display = '';
    if (descEl) descEl.setAttribute('data-i18n', 'assets_desc_threed');
    if (descEl) descEl.textContent = window.i18n.t('assets_desc_threed');
  } else {
    if (seqSection) seqSection.style.display = '';
    if (live2dSection) live2dSection.style.display = 'none';
    if (pngremixSection) pngremixSection.style.display = 'none';
    if (threedSection) threedSection.style.display = 'none';
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
        scale: 1,
        eye_blink: true,
        lip_sync: true
      },
      motions: [],
      expressions: [],
      background_layers: [],
      states: []
    };
  }
  // 兼容旧数据：确保 background_layers 字段存在
  if (!Array.isArray(currentMod.assets.live2d.background_layers)) {
    currentMod.assets.live2d.background_layers = [];
  }
  // 兼容旧数据：将旧的 resources 迁移到 background_layers
  if (Array.isArray(currentMod.assets.live2d.resources) && currentMod.assets.live2d.resources.length > 0) {
    const existingBgFiles = new Set(currentMod.assets.live2d.background_layers.map(bg => bg.file));
    for (const res of currentMod.assets.live2d.resources) {
      if (res.file && !existingBgFiles.has(res.file)) {
        const events = Array.isArray(res.events) ? res.events : (res.event ? [res.event] : []);
        currentMod.assets.live2d.background_layers.push({
          name: res.name || '',
          file: res.file,
          layer: 'front',
          scale: 1,
          offset_x: 0,
          offset_y: 0,
          events: events,
          audio: res.audio || '',
          dir: res.dir || '',
        });
      }
    }
    delete currentMod.assets.live2d.resources;
  }
  // 兼容旧数据：将 event (string) 迁移为 events (string[])，确保 audio/dir 字段存在
  for (const lyr of currentMod.assets.live2d.background_layers) {
    if (!Array.isArray(lyr.events)) {
      lyr.events = lyr.event ? [lyr.event] : [];
      delete lyr.event;
    }
    if (typeof lyr.audio !== 'string') {
      lyr.audio = '';
    }
    if (typeof lyr.dir !== 'string') {
      lyr.dir = '';
    }
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
  
  // 渲染背景层列表
  renderLive2dBackgroundLayers(live2d.background_layers || []);
  
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
  document.getElementById('live2d-model-scale').value = model.scale ?? 1;
  document.getElementById('live2d-textures-dir').value = model.textures_dir || '';
  document.getElementById('live2d-motions-dir').value = model.motions_dir || '';
  document.getElementById('live2d-expressions-dir').value = model.expressions_dir || '';
  document.getElementById('live2d-physics-json').value = model.physics_json || '';
  document.getElementById('live2d-pose-json').value = model.pose_json || '';
  document.getElementById('live2d-breath-json').value = model.breath_json || '';
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
  model.scale = parseFloat(document.getElementById('live2d-model-scale').value) || 1;
  model.textures_dir = document.getElementById('live2d-textures-dir').value.trim();
  model.motions_dir = document.getElementById('live2d-motions-dir').value.trim();
  model.expressions_dir = document.getElementById('live2d-expressions-dir').value.trim();
  model.physics_json = document.getElementById('live2d-physics-json').value.trim();
  model.pose_json = document.getElementById('live2d-pose-json').value.trim();
  model.breath_json = document.getElementById('live2d-breath-json').value.trim();
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
 * 导入文件夹到 asset/live2d 目录
 * 让用户选择一个文件夹，将其中所有内容复制到 Mod 的 asset/live2d/ 目录下
 */
async function importLive2dFolder() {
  if (!currentMod) {
    showToast(window.i18n.t('msg_load_mod_first'), 'warning');
    return;
  }
  if (!modFolderHandle) {
    showToast(window.i18n.t('msg_import_live2d_folder_need_folder'), 'warning');
    return;
  }

  if (!('showDirectoryPicker' in window)) {
    showToast(window.i18n.t('msg_browser_not_support'), 'error');
    return;
  }

  let sourceDirHandle;
  try {
    sourceDirHandle = await window.showDirectoryPicker({ mode: 'read' });
  } catch (e) {
    if (e.name === 'AbortError') return; // 用户取消
    showToast(window.i18n.t('msg_import_live2d_folder_failed').replace('{error}', e.message || String(e)), 'error');
    return;
  }

  // 确认操作
  const folderName = sourceDirHandle.name || '';
  if (!confirm(window.i18n.t('msg_import_live2d_folder_confirm').replace('{folder}', folderName))) {
    return;
  }

  try {
    showToast(window.i18n.t('msg_import_live2d_folder_copying'), 'info');

    // 确保 asset/live2d 目录存在
    const assetDir = await safeGetDirectoryHandle(modFolderHandle, 'asset', { create: true, overwriteFile: true });
    const live2dDir = await safeGetDirectoryHandle(assetDir, 'live2d', { create: true, overwriteFile: true });

    // 收集源文件夹中所有文件
    const files = await collectAllFilesFromDirectory(sourceDirHandle);
    if (files.length === 0) {
      showToast(window.i18n.t('msg_import_live2d_folder_empty'), 'warning');
      return;
    }

    // 逐个复制到 asset/live2d/ 目录
    let copiedCount = 0;
    let failedCount = 0;
    for (const { relPath, file } of files) {
      try {
        const { dir, fileName } = await ensureDirectoryForPath(live2dDir, relPath);
        const fileHandle = await safeGetFileHandle(dir, fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(file);
        await writable.close();
        copiedCount++;
      } catch (e) {
        console.warn('[importLive2dFolder] Skip copying file:', relPath, e);
        failedCount++;
      }
    }

    const msg = window.i18n.t('msg_import_live2d_folder_success')
      .replace('{count}', String(copiedCount))
      .replace('{folder}', folderName);
    showToast(msg, 'success');

    if (failedCount > 0) {
      showToast(window.i18n.t('msg_import_live2d_folder_partial_fail').replace('{count}', String(failedCount)), 'warning');
    }
  } catch (err) {
    console.error('importLive2dFolder error:', err);
    showToast(window.i18n.t('msg_import_live2d_folder_failed').replace('{error}', err.message || String(err)), 'error');
  }
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
    const motionFilesSeen = new Set(); // 基于文件路径去重
    const motionNamesSeen = new Set(); // 基于名称去重
    for (const [groupName, motionArr] of Object.entries(rawMotions)) {
      if (!Array.isArray(motionArr)) continue;
      for (const m of motionArr) {
        const file = m.File || m.file || '';
        const normalizedFile = file.replace(/\\/g, '/');
        const baseName = normalizedFile.split('/').pop().replace(/\.motion3\.json$/i, '').replace(/\.json$/i, '');
        if (motionNamesSeen.has(baseName)) continue;
        motionFilesSeen.add(normalizedFile);
        motionNamesSeen.add(baseName);
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
            const baseName = entry.name.replace(/\.motion3\.json$/i, '');
            if (!motionFilesSeen.has(filePath.replace(/\\/g, '/')) && !motionNamesSeen.has(baseName)) {
              newMotions.push({
                name: baseName,
                file: filePath,
                group: 'Default',
                priority: 'Normal',
                fade_in_ms: 200,
                fade_out_ms: 200,
                loop: false
              });
              motionNamesSeen.add(baseName);
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
    const exprNamesSeen = new Set();
    if (Array.isArray(rawExpressions)) {
      for (const e of rawExpressions) {
        const name = e.Name || e.name || '';
        const file = e.File || e.file || '';
        if (exprNamesSeen.has(name)) continue;
        exprFilesSeen.add(file.replace(/\\/g, '/'));
        exprNamesSeen.add(name);
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
            const baseName = entry.name.replace(/\.exp3\.json$/i, '');
            if (!exprFilesSeen.has(filePath.replace(/\\/g, '/')) && !exprNamesSeen.has(baseName)) {
              newExpressions.push({ name: baseName, file: filePath });
              exprNamesSeen.add(baseName);
            }
          }
        }
      } catch (e) {
        // 表情目录不存在或无法访问，跳过
      }
    }

    // --- 扫描图片并生成 background_layers（递归扫描 base_dir 下的子目录中的图片文件） ---
    const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];
    const scannedImages = []; // 临时收集扫描到的图片

    // 保留已有 background_layers 的自定义字段
    const existingBgMap = {};
    if (Array.isArray(live2d.background_layers)) {
      for (const bg of live2d.background_layers) {
        if (bg.file) existingBgMap[bg.file] = bg;
      }
    }

    // 排除已知的非资源目录（纹理目录、动作目录、表情目录）
    const excludeDirs = new Set();
    const texturesDir = (live2d.model.textures_dir || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (texturesDir) excludeDirs.add(texturesDir.split('/')[0]);
    if (motionsDir) excludeDirs.add(motionsDir.replace(/\\/g, '/').split('/')[0]);
    if (expressionsDir) excludeDirs.add(expressionsDir.replace(/\\/g, '/').split('/')[0]);

    // 根据图片文件名推断键盘事件 keydown:KeyCode
    function inferKeyEventFromName(name) {
      // Key+字母: KeyA, KeyB, ... → keydown:KeyA
      const keyLetterMatch = name.match(/^Key([A-Z])$/i);
      if (keyLetterMatch) return `keydown:Key${keyLetterMatch[1].toUpperCase()}`;

      // Num+数字: Num0, Num1, ... → keydown:Digit0
      const numMatch = name.match(/^Num(\d)$/i);
      if (numMatch) return `keydown:Digit${numMatch[1]}`;

      // Digit+数字: Digit0, Digit1, ... → keydown:Digit0
      const digitMatch = name.match(/^Digit(\d)$/i);
      if (digitMatch) return `keydown:Digit${digitMatch[1]}`;

      // F+数字: F1, F2, ... → keydown:F1
      const fKeyMatch = name.match(/^F(\d{1,2})$/i);
      if (fKeyMatch && parseInt(fKeyMatch[1]) >= 1 && parseInt(fKeyMatch[1]) <= 24) return `keydown:F${fKeyMatch[1]}`;

      // Numpad+数字/操作: Numpad0, NumpadAdd, ... → keydown:Numpad0
      const numpadMatch = name.match(/^Numpad(\w+)$/i);
      if (numpadMatch) {
        const suffix = numpadMatch[1];
        const numpadKeys = ['0','1','2','3','4','5','6','7','8','9','Add','Subtract','Multiply','Divide','Decimal','Enter'];
        const found = numpadKeys.find(k => k.toLowerCase() === suffix.toLowerCase());
        if (found) return `keydown:Numpad${found}`;
      }

      // Arrow+方向: ArrowUp, ArrowDown, ... → keydown:ArrowUp
      const arrowMatch = name.match(/^Arrow(Up|Down|Left|Right)$/i);
      if (arrowMatch) {
        const dir = arrowMatch[1].charAt(0).toUpperCase() + arrowMatch[1].slice(1).toLowerCase();
        return `keydown:Arrow${dir}`;
      }

      // 其他已知单一键名的直接匹配
      const DIRECT_MAP = {
        'space': 'Space', 'enter': 'Enter', 'tab': 'Tab',
        'escape': 'Escape', 'esc': 'Escape',
        'backspace': 'Backspace', 'delete': 'Delete', 'insert': 'Insert',
        'pause': 'Pause', 'printscreen': 'PrintScreen',
        'shiftleft': 'ShiftLeft', 'shiftright': 'ShiftRight',
        'shift': 'Shift', 'control': 'Control', 'alt': 'Alt',
        'controlleft': 'ControlLeft', 'controlright': 'ControlRight',
        'altleft': 'AltLeft', 'altright': 'AltRight',
        'metaleft': 'MetaLeft', 'metaright': 'MetaRight',
        'contextmenu': 'ContextMenu',
        'capslock': 'CapsLock', 'numlock': 'NumLock', 'scrolllock': 'ScrollLock',
        'home': 'Home', 'end': 'End', 'pageup': 'PageUp', 'pagedown': 'PageDown',
        'semicolon': 'Semicolon', 'equal': 'Equal', 'comma': 'Comma',
        'minus': 'Minus', 'period': 'Period', 'slash': 'Slash',
        'backquote': 'Backquote', 'bracketleft': 'BracketLeft',
        'backslash': 'Backslash', 'bracketright': 'BracketRight', 'quote': 'Quote',
        'intlbackslash': 'IntlBackslash',
        'audiovolumemute': 'AudioVolumeMute', 'audiovolumedown': 'AudioVolumeDown',
        'audiovolumeup': 'AudioVolumeUp',
        'mediatracknext': 'MediaTrackNext', 'mediatrackprevious': 'MediaTrackPrevious',
        'mediastop': 'MediaStop', 'mediaplaypause': 'MediaPlayPause',
      };
      const directKey = DIRECT_MAP[name.toLowerCase()];
      if (directKey) return `keydown:${directKey}`;

      return null;
    }

    // 递归扫描图片文件
    async function scanImagesRecursive(handle, prefix) {
      for await (const entry of handle.values()) {
        if (entry.kind === 'file') {
          const lower = entry.name.toLowerCase();
          if (IMAGE_EXTS.some(ext => lower.endsWith(ext))) {
            const filePath = prefix ? `${prefix}/${entry.name}` : entry.name;
            const baseName = entry.name.replace(/\.[^.]+$/, '');
            // 跳过 cover（不纳入 background_layers）
            if (baseName.toLowerCase() === 'cover') continue;
            scannedImages.push({ baseName, filePath, prefix: prefix || '' });
          }
        } else if (entry.kind === 'directory') {
          const subPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
          await scanImagesRecursive(entry, subPrefix);
        }
      }
    }

    // 扫描 base_dir 下的子目录（排除纹理/动作/表情和模型数据目录）
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'directory' && !excludeDirs.has(entry.name)) {
        await scanImagesRecursive(entry, entry.name);
      }
    }

    // 覆盖动作和表情
    live2d.motions = newMotions;
    live2d.expressions = newExpressions;

    // --- 生成 background_layers ---
    const scannedFileSet = new Set(scannedImages.map(img => img.filePath));

    const newBgLayers = [];
    // 保留已有的、但不在本次扫描列表中的 background_layers（手动添加的）
    for (const bg of (live2d.background_layers || [])) {
      if (bg.file && !scannedFileSet.has(bg.file)) {
        newBgLayers.push(bg);
      }
    }
    // 遍历扫描到的图片：已有的保留自定义字段，新的自动生成
    for (const img of scannedImages) {
      const existing = existingBgMap[img.filePath];
      if (existing) {
        // 保留已有图层的所有自定义字段
        newBgLayers.push(existing);
      } else {
        // 新图层：background 名称默认 behind 层，其他默认 front 层
        const isBackground = img.baseName.toLowerCase() === 'background';
        // 为非 background 图片自动推断键盘事件
        let events = [];
        if (!isBackground) {
          const inferred = inferKeyEventFromName(img.baseName);
          if (inferred) events = [inferred];
        }
        newBgLayers.push({
          name: img.baseName,
          file: img.filePath,
          layer: isBackground ? 'behind' : 'front',
          scale: 1,
          offset_x: 0,
          offset_y: 0,
          events: events,
          audio: '',
          dir: img.prefix,
        });
      }
    }
    live2d.background_layers = newBgLayers;

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
      .replace('{expressions}', newExpressions.length)
      .replace('{bg_layers}', newBgLayers.length);
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
 * 从 Live2D 模型的 cdi3.json 中识别键盘/鼠标按键相关参数，
 * 自动生成对应的 down/up 触发器和过渡状态。
 *
 * 识别规则：
 * - ParameterGroups 中 Name 包含 "按键"/"键盘"/"key"/"keyboard" 的分组下所有参数
 * - 参数 Id 包含 "MouseLeftDown"/"MouseRightDown" 的鼠标按键参数
 * - 参数 Name 直接是单个按键名称（已知键名映射）
 *
 * 对每个识别到的参数：
 * 1. 创建过渡状态 `key_<keyCode>` (down, value=1) 和 `key_<keyCode>_up` (up, value=0)
 * 2. 创建触发器 `keydown:<KeyCode>` / `keyup:<KeyCode>`（或 global_click / global_click_up 等）
 * 3. CatParamLeftHandDown 映射到 global_keydown / global_keyup
 */
async function generateKeyboardEventsFromFiles() {
  if (!currentMod) {
    showToast(window.i18n.t('msg_load_mod_first'), 'warning');
    return;
  }
  if (currentMod.manifest.mod_type !== 'live2d') {
    showToast(window.i18n.t('msg_gen_keyboard_live2d_only'), 'warning');
    return;
  }
  if (!modFolderHandle) {
    showToast(window.i18n.t('msg_sync_need_folder'), 'warning');
    return;
  }

  // ======== 读取 cdi3.json ========
  try {
    const resolved = await _resolveLive2dBaseDir();
    if (!resolved) return;
    const { dirHandle, modelJson } = resolved;

    // 读取 model3.json 获取 DisplayInfo (cdi3) 路径
    const modelFileHandle = await dirHandle.getFileHandle(modelJson);
    const modelFile = await modelFileHandle.getFile();
    const modelData = JSON.parse(await modelFile.text());
    const fileRefs = modelData.FileReferences || modelData.fileReferences || {};
    const cdiPath = fileRefs.DisplayInfo || fileRefs.displayInfo || '';

    if (!cdiPath) {
      showToast(window.i18n.t('msg_gen_keyboard_no_cdi'), 'warning');
      return;
    }

    // 读取 cdi3.json
    const cdiParts = cdiPath.replace(/\\/g, '/').split('/').filter(Boolean);
    let cdiDirHandle = dirHandle;
    for (let i = 0; i < cdiParts.length - 1; i++) {
      cdiDirHandle = await cdiDirHandle.getDirectoryHandle(cdiParts[i]);
    }
    const cdiFileHandle = await cdiDirHandle.getFileHandle(cdiParts[cdiParts.length - 1]);
    const cdiFile = await cdiFileHandle.getFile();
    const cdiData = JSON.parse(await cdiFile.text());

    const allParams = cdiData.Parameters || [];
    const paramGroups = cdiData.ParameterGroups || [];

    // ======== 识别键盘相关参数分组 ========
    const keyboardGroupIds = new Set();
    for (const g of paramGroups) {
      const gName = (g.Name || '').toLowerCase();
      const gId = g.Id || '';
      if (gName.includes('按键') || gName.includes('键盘') || gName.includes('key') || gName.includes('keyboard')) {
        keyboardGroupIds.add(gId);
      }
    }

    // ======== 参数名到 KeyCode 的映射 ========
    const NAME_TO_KEYCODE = {
      '空格': 'Space', 'space': 'Space',
      'alt': 'Alt', 'ctrl': 'Control', 'control': 'Control',
      'shift': 'Shift', 'enter': 'Enter', 'tab': 'Tab',
      'escape': 'Escape', 'esc': 'Escape',
      'backspace': 'Backspace', 'delete': 'Delete', 'insert': 'Insert',
      'capslock': 'CapsLock', 'pause': 'Pause', 'printscreen': 'PrintScreen',
      'a': 'KeyA', 'b': 'KeyB', 'c': 'KeyC', 'd': 'KeyD',
      'e': 'KeyE', 'f': 'KeyF', 'g': 'KeyG', 'h': 'KeyH',
      'i': 'KeyI', 'j': 'KeyJ', 'k': 'KeyK', 'l': 'KeyL',
      'm': 'KeyM', 'n': 'KeyN', 'o': 'KeyO', 'p': 'KeyP',
      'q': 'KeyQ', 'r': 'KeyR', 's': 'KeyS', 't': 'KeyT',
      'u': 'KeyU', 'v': 'KeyV', 'w': 'KeyW', 'x': 'KeyX',
      'y': 'KeyY', 'z': 'KeyZ',
      '0': 'Digit0', '1': 'Digit1', '2': 'Digit2', '3': 'Digit3',
      '4': 'Digit4', '5': 'Digit5', '6': 'Digit6', '7': 'Digit7',
      '8': 'Digit8', '9': 'Digit9',
      'up': 'ArrowUp', 'down': 'ArrowDown', 'left': 'ArrowLeft', 'right': 'ArrowRight',
      'home': 'Home', 'end': 'End', 'pageup': 'PageUp', 'pagedown': 'PageDown',
      'f1': 'F1', 'f2': 'F2', 'f3': 'F3', 'f4': 'F4',
      'f5': 'F5', 'f6': 'F6', 'f7': 'F7', 'f8': 'F8',
      'f9': 'F9', 'f10': 'F10', 'f11': 'F11', 'f12': 'F12',
      'f13': 'F13', 'f14': 'F14', 'f15': 'F15', 'f16': 'F16',
      'f17': 'F17', 'f18': 'F18', 'f19': 'F19', 'f20': 'F20',
      'f21': 'F21', 'f22': 'F22', 'f23': 'F23', 'f24': 'F24',
      'numlock': 'NumLock', 'scrolllock': 'ScrollLock',
      'numpad0': 'Numpad0', 'numpad1': 'Numpad1', 'numpad2': 'Numpad2',
      'numpad3': 'Numpad3', 'numpad4': 'Numpad4', 'numpad5': 'Numpad5',
      'numpad6': 'Numpad6', 'numpad7': 'Numpad7', 'numpad8': 'Numpad8',
      'numpad9': 'Numpad9',
      'numpadadd': 'NumpadAdd', 'numpadsubtract': 'NumpadSubtract',
      'numpadmultiply': 'NumpadMultiply', 'numpaddivide': 'NumpadDivide',
      'numpaddecimal': 'NumpadDecimal',
      'semicolon': 'Semicolon', 'equal': 'Equal', 'comma': 'Comma',
      'minus': 'Minus', 'period': 'Period', 'slash': 'Slash',
      'backquote': 'Backquote', 'bracketleft': 'BracketLeft',
      'backslash': 'Backslash', 'bracketright': 'BracketRight', 'quote': 'Quote',
      'intlbackslash': 'IntlBackslash',
      'metaleft': 'MetaLeft', 'metaright': 'MetaRight', 'contextmenu': 'ContextMenu',
      'audiovolumemute': 'AudioVolumeMute', 'audiovolumedown': 'AudioVolumeDown',
      'audiovolumeup': 'AudioVolumeUp',
      'mediatracknext': 'MediaTrackNext', 'mediatrackprevious': 'MediaTrackPrevious',
      'mediastop': 'MediaStop', 'mediaplaypause': 'MediaPlayPause',
    };

    // ======== Id 特殊匹配规则 ========
    const MOUSE_ID_MAP = {
      'ParamMouseLeftDown': { event: 'global_click', upEvent: 'global_click_up', stateName: 'key_mouse_left', upStateName: 'key_mouse_left_up' },
      'ParamMouseRightDown': { event: 'global_right_click', upEvent: 'global_right_click_up', stateName: 'key_mouse_right', upStateName: 'key_mouse_right_up' },
    };

    // ======== 通用键盘按下参数（Name 包含"键盘按下"/"keyboard down"等） ========
    const GENERIC_KEYBOARD_NAMES = ['键盘按下', 'keyboard down', 'key down', 'keydown'];
    // CatParamLeftHandDown 映射到 global_keydown / global_keyup
    const GENERIC_KEYBOARD_IDS = ['CatParamLeftHandDown'];

    // ======== 收集需要生成的键盘参数 ========
    const keyParams = [];
    const genericKeyboardParams = []; // 通用键盘按下参数，需附加到所有按键状态
    const seenEvents = new Set();

    for (const p of allParams) {
      const paramId = p.Id || '';
      const paramName = (p.Name || '').trim();
      const groupId = p.GroupId || '';

      // 1. 检查鼠标按键特殊 Id
      if (paramId in MOUSE_ID_MAP) {
        const mapping = MOUSE_ID_MAP[paramId];
        if (mapping && !seenEvents.has(mapping.event)) {
          keyParams.push({
            paramId,
            keyCode: mapping.event,
            eventName: mapping.event,
            stateName: mapping.stateName,
            upEventName: mapping.upEvent,
            upStateName: mapping.upStateName,
          });
          seenEvents.add(mapping.event);
        }
        continue;
      }

      // 跳过鼠标坐标参数（已由 mouseFollow 处理）
      if (paramId === 'ParamMouseX' || paramId === 'ParamMouseY') continue;

      // 2. 检查是否是通用键盘按下参数（如 CatParamLeftHandDown）
      const nameLower = paramName.toLowerCase();
      if (GENERIC_KEYBOARD_IDS.includes(paramId) || GENERIC_KEYBOARD_NAMES.includes(nameLower)) {
        genericKeyboardParams.push(paramId);
        continue;
      }

      // 3. 检查是否在键盘分组中
      const inKeyboardGroup = groupId && keyboardGroupIds.has(groupId);

      // 4. 尝试从参数名映射到 KeyCode
      const keyCode = NAME_TO_KEYCODE[nameLower];

      if (inKeyboardGroup && keyCode) {
        const eventName = `keydown:${keyCode}`;
        const upEventName = `keyup:${keyCode}`;
        if (!seenEvents.has(eventName)) {
          keyParams.push({
            paramId,
            keyCode,
            eventName,
            stateName: `key_${nameLower.replace(/\s+/g, '_')}`,
            upEventName,
            upStateName: `key_${nameLower.replace(/\s+/g, '_')}_up`,
          });
          seenEvents.add(eventName);
        }
      } else if (inKeyboardGroup && !keyCode) {
        console.warn(`[generateKeyboardEvents] Unknown key param in keyboard group: ${paramId} (Name: "${paramName}")`);
      }
    }

    if (keyParams.length === 0) {
      showToast(window.i18n.t('msg_gen_keyboard_no_params'), 'warning');
      return;
    }

    // ======== 确认操作 ========
    const paramLines = [];
    for (const kp of keyParams) {
      paramLines.push(`${kp.paramId} → ${kp.eventName} / ${kp.upEventName}`);
    }
    for (const gp of genericKeyboardParams) {
      paramLines.push(`${gp} → global_keydown / global_keyup`);
    }
    const totalCount = keyParams.length + genericKeyboardParams.length;
    const confirmMsg = window.i18n.t('msg_gen_keyboard_confirm')
      .replace('{count}', totalCount)
      .replace('{params}', paramLines.join('\n'));
    if (!confirm(confirmMsg)) return;

    // ======== 生成状态和触发器 ========
    const manifest = currentMod.manifest;
    const existingStateNames = new Set();
    for (const key of Object.keys(manifest.important_states || {})) {
      existingStateNames.add(key);
    }
    for (const s of (manifest.states || [])) {
      existingStateNames.add(s.name);
    }
    const existingTriggerEvents = new Set();
    for (const t of (manifest.triggers || [])) {
      existingTriggerEvents.add(t.event);
    }

    let addedStates = 0;
    let addedTriggers = 0;

    // 判断哪些是键盘按键状态（非鼠标），用于附加通用键盘参数
    const keyboardStateNames = new Set();

    for (const kp of keyParams) {
      const isKeyboardKey = kp.eventName.startsWith('keydown:');

      // 1. 创建 down 过渡状态（value=1）
      if (!existingStateNames.has(kp.stateName)) {
        const newState = createDefaultState(kp.stateName, false);
        newState.priority = 3;
        newState.next_state = '';
        const params = [{ id: kp.paramId, value: 1 }];
        // 为键盘按键状态附加通用键盘参数
        if (isKeyboardKey) {
          for (const gp of genericKeyboardParams) {
            params.push({ id: gp, value: 1 });
          }
        }
        newState.live2d_params = params;
        manifest.states.push(newState);
        existingStateNames.add(kp.stateName);
        addedStates++;
      } else if (isKeyboardKey && genericKeyboardParams.length > 0) {
        // 已存在的键盘状态也补充通用键盘参数
        const existingState = manifest.states.find(s => s.name === kp.stateName);
        if (existingState) {
          if (!Array.isArray(existingState.live2d_params)) existingState.live2d_params = [];
          const existingIds = new Set(existingState.live2d_params.map(p => p.id));
          for (const gp of genericKeyboardParams) {
            if (!existingIds.has(gp)) {
              existingState.live2d_params.push({ id: gp, value: 1 });
            }
          }
        }
      }

      if (isKeyboardKey) keyboardStateNames.add(kp.stateName);

      // 2. 创建 down 触发器
      if (!existingTriggerEvents.has(kp.eventName)) {
        const newTrigger = {
          event: kp.eventName,
          can_trigger_states: [{
            persistent_state: '',
            states: [{ state: kp.stateName, weight: 1 }],
            allow_repeat: true,
          }],
        };
        manifest.triggers.push(newTrigger);
        existingTriggerEvents.add(kp.eventName);
        addedTriggers++;
      }

      // 3. 创建 up 过渡状态（value=0）
      if (kp.upStateName && !existingStateNames.has(kp.upStateName)) {
        const upState = createDefaultState(kp.upStateName, false);
        upState.priority = 3;
        upState.next_state = '';
        const upParams = [{ id: kp.paramId, value: 0 }];
        // 为键盘按键 up 状态附加通用键盘参数（value=0）
        if (isKeyboardKey) {
          for (const gp of genericKeyboardParams) {
            upParams.push({ id: gp, value: 0 });
          }
        }
        upState.live2d_params = upParams;
        manifest.states.push(upState);
        existingStateNames.add(kp.upStateName);
        addedStates++;
      }

      // 4. 创建 up 触发器
      if (kp.upEventName && !existingTriggerEvents.has(kp.upEventName)) {
        const upTrigger = {
          event: kp.upEventName,
          can_trigger_states: [{
            persistent_state: '',
            states: [{ state: kp.upStateName, weight: 1 }],
            allow_repeat: true,
          }],
        };
        manifest.triggers.push(upTrigger);
        existingTriggerEvents.add(kp.upEventName);
        addedTriggers++;
      }
    }

    // 2.5 为通用键盘按下参数创建 global_keydown / global_keyup 状态和触发器
    if (genericKeyboardParams.length > 0) {
      // global_keydown -> key_any (value=1)
      const globalKeydownState = 'key_any';
      if (!existingStateNames.has(globalKeydownState)) {
        const newState = createDefaultState(globalKeydownState, false);
        newState.priority = 3;
        newState.next_state = '';
        newState.live2d_params = genericKeyboardParams.map(gp => ({ id: gp, value: 1 }));
        manifest.states.push(newState);
        existingStateNames.add(globalKeydownState);
        addedStates++;
      }
      if (!existingTriggerEvents.has('global_keydown')) {
        const newTrigger = {
          event: 'global_keydown',
          can_trigger_states: [{
            persistent_state: '',
            states: [{ state: globalKeydownState, weight: 1 }],
            allow_repeat: true,
          }],
        };
        manifest.triggers.push(newTrigger);
        existingTriggerEvents.add('global_keydown');
        addedTriggers++;
      }

      // global_keyup -> key_any_up (value=0)
      const globalKeyupState = 'key_any_up';
      if (!existingStateNames.has(globalKeyupState)) {
        const upState = createDefaultState(globalKeyupState, false);
        upState.priority = 3;
        upState.next_state = '';
        upState.live2d_params = genericKeyboardParams.map(gp => ({ id: gp, value: 0 }));
        manifest.states.push(upState);
        existingStateNames.add(globalKeyupState);
        addedStates++;
      }
      if (!existingTriggerEvents.has('global_keyup')) {
        const upTrigger = {
          event: 'global_keyup',
          can_trigger_states: [{
            persistent_state: '',
            states: [{ state: globalKeyupState, weight: 1 }],
            allow_repeat: true,
          }],
        };
        manifest.triggers.push(upTrigger);
        existingTriggerEvents.add('global_keyup');
        addedTriggers++;
      }
    }

    // 3. 不再在 idle 状态中设参数为 0（由 up 事件负责重置参数）

    // 4. 同时开启 global_keyboard 和 global_mouse（如有鼠标事件）
    manifest.global_keyboard = true;
    document.getElementById('global-keyboard').checked = true;
    const hasMouseEvents = keyParams.some(kp => kp.eventName === 'global_click' || kp.eventName === 'global_right_click');
    if (hasMouseEvents) {
      manifest.global_mouse = true;
      document.getElementById('global-mouse').checked = true;
    }

    // 刷新 UI
    renderStates();
    renderTriggers();
    markUnsaved();

    const msg = window.i18n.t('msg_gen_keyboard_success')
      .replace('{states}', addedStates)
      .replace('{triggers}', addedTriggers)
      .replace('{params}', keyParams.length + genericKeyboardParams.length);
    showToast(msg, 'success');

  } catch (err) {
    console.error('generateKeyboardEventsFromFiles error:', err);
    const msg = window.i18n.t('msg_sync_failed').replace('{error}', err.message || String(err));
    showToast(msg, 'error');
  }
}

/**
 * 从 cdi3.json 读取并展示 Live2D 模型的所有参数信息
 */
async function loadLive2dParamsBrowser() {
  if (!currentMod) {
    showToast(window.i18n.t('msg_load_mod_first'), 'warning');
    return;
  }
  if (currentMod.manifest.mod_type !== 'live2d') {
    showToast(window.i18n.t('msg_params_live2d_only'), 'warning');
    return;
  }
  if (!modFolderHandle) {
    showToast(window.i18n.t('msg_sync_need_folder'), 'warning');
    return;
  }

  try {
    const resolved = await _resolveLive2dBaseDir();
    if (!resolved) return;
    const { dirHandle, modelJson } = resolved;

    // 读取 model3.json 获取 DisplayInfo (cdi3) 路径
    const modelFileHandle = await dirHandle.getFileHandle(modelJson);
    const modelFile = await modelFileHandle.getFile();
    const modelData = JSON.parse(await modelFile.text());
    const fileRefs = modelData.FileReferences || modelData.fileReferences || {};
    const cdiPath = fileRefs.DisplayInfo || fileRefs.displayInfo || '';

    if (!cdiPath) {
      showToast(window.i18n.t('msg_params_no_display_info'), 'warning');
      return;
    }

    // 读取 cdi3.json
    const cdiParts = cdiPath.replace(/\\/g, '/').split('/').filter(Boolean);
    let cdiDirHandle = dirHandle;
    for (let i = 0; i < cdiParts.length - 1; i++) {
      cdiDirHandle = await cdiDirHandle.getDirectoryHandle(cdiParts[i]);
    }
    const cdiFileHandle = await cdiDirHandle.getFileHandle(cdiParts[cdiParts.length - 1]);
    const cdiFile = await cdiFileHandle.getFile();
    const cdiData = JSON.parse(await cdiFile.text());

    renderLive2dParamsBrowser(cdiData);
    showToast(window.i18n.t('msg_params_loaded', { count: (cdiData.Parameters || []).length }), 'success');
  } catch (err) {
    console.error('loadLive2dParamsBrowser error:', err);
    showToast(window.i18n.t('msg_params_load_failed', { error: err.message || String(err) }), 'error');
  }
}

/**
 * 渲染 Live2D 参数浏览器
 */
function renderLive2dParamsBrowser(cdiData) {
  const container = document.getElementById('live2d-params-browser-content');
  if (!container) return;

  const allParams = cdiData.Parameters || [];
  const paramGroups = cdiData.ParameterGroups || [];
  const parts = cdiData.Parts || [];
  const combinedParams = cdiData.CombinedParameters || [];

  if (allParams.length === 0) {
    container.innerHTML = `<p style="color: var(--text-secondary); font-style: italic; padding: 8px 0;">${escapeHtml(window.i18n.t('msg_params_none_found'))}</p>`;
    return;
  }

  // 构建分组映射
  const groupMap = {};
  for (const g of paramGroups) {
    groupMap[g.Id] = g.Name || g.Id;
  }

  // 按组分类参数
  const grouped = {};
  const ungrouped = [];
  for (const p of allParams) {
    const gid = p.GroupId || '';
    if (gid && groupMap[gid] !== undefined) {
      if (!grouped[gid]) grouped[gid] = [];
      grouped[gid].push(p);
    } else {
      ungrouped.push(p);
    }
  }

  // 构建组合参数映射（用于标注）
  const combinedMap = {};
  for (let ci = 0; ci < combinedParams.length; ci++) {
    const combo = combinedParams[ci];
    if (Array.isArray(combo)) {
      for (const pid of combo) {
        if (!combinedMap[pid]) combinedMap[pid] = [];
        combinedMap[pid].push(combo.filter(id => id !== pid));
      }
    }
  }

  function renderParamRow(p) {
    const comboInfo = combinedMap[p.Id];
    const comboHtml = comboInfo
      ? `<span class="param-combo" title="${escapeHtml(window.i18n.t('params_combined'))}">🔗 ${comboInfo.map(ids => ids.join(', ')).join(' | ')}</span>`
      : '';
    return `
      <div class="param-row">
        <code class="param-id">${escapeHtml(p.Id)}</code>
        <span class="param-name">${escapeHtml(p.Name || '')}</span>
        ${comboHtml}
      </div>`;
  }

  let html = '';

  // 统计信息
  html += `<div class="params-summary" style="margin-bottom: 12px; padding: 8px 12px; background: var(--bg-secondary, #f5f5f5); border-radius: 6px; font-size: 13px;">
    📊 ${window.i18n.t('params_summary', { params: allParams.length, groups: paramGroups.length, parts: parts.length, combined: combinedParams.length })}
  </div>`;

  // 未分组参数
  if (ungrouped.length > 0) {
    html += `
      <details class="param-group-details" open>
        <summary class="param-group-summary">
          <span class="param-group-name">${escapeHtml(window.i18n.t('params_ungrouped'))}</span>
          <span class="param-group-count">${window.i18n.t('params_count', { count: ungrouped.length })}</span>
        </summary>
        <div class="param-group-list">
          ${ungrouped.map(renderParamRow).join('')}
        </div>
      </details>`;
  }

  // 各分组参数
  const groupIds = Object.keys(grouped);
  for (const gid of groupIds) {
    const gParams = grouped[gid];
    const gName = groupMap[gid] || gid;
    html += `
      <details class="param-group-details">
        <summary class="param-group-summary">
          <span class="param-group-name">${escapeHtml(gName)}</span>
          <span class="param-group-id">${escapeHtml(gid)}</span>
          <span class="param-group-count">${window.i18n.t('params_count', { count: gParams.length })}</span>
        </summary>
        <div class="param-group-list">
          ${gParams.map(renderParamRow).join('')}
        </div>
      </details>`;
  }

  // 部件列表
  if (parts.length > 0) {
    html += `
      <details class="param-group-details">
        <summary class="param-group-summary">
          <span class="param-group-name">部件 (Parts)</span>
          <span class="param-group-count">${parts.length} 个部件</span>
        </summary>
        <div class="param-group-list">
          ${parts.map(p => `
            <div class="param-row">
              <code class="param-id">${escapeHtml(p.Id)}</code>
              <span class="param-name">${escapeHtml(p.Name || '')}</span>
            </div>
          `).join('')}
        </div>
      </details>`;
  }

  container.innerHTML = html;
}

// ============================================================================
// PngRemix 资产管理
// ============================================================================

/**
 * 确保 pngremix 数据对象存在
 */
function ensurePngRemixData() {
  if (!currentMod.assets.pngremix) {
    currentMod.assets.pngremix = {
      schema_version: 1,
      model: {
        name: '',
        pngremix_file: 'asset/model.pngRemix',
        default_state_index: 0,
        scale: 1,
        max_fps: 60
      },
      features: {
        mouse_follow: true,
        auto_blink: true,
        click_bounce: true,
        click_bounce_amp: 50,
        click_bounce_duration: 0.5,
        blink_speed: 1.0,
        blink_chance: 10,
        blink_hold_ratio: 0.2
      },
      expressions: [],
      motions: [],
      states: []
    };
  }

  return currentMod.assets.pngremix;
}


/**
 * 从表单收集 PngRemix 模型和特性配置
 */
function collectPngRemixModelData() {
  ensurePngRemixData();
  const p = currentMod.assets.pngremix;

  p.model.name = document.getElementById('pngremix-model-name')?.value?.trim() || '';
  p.model.pngremix_file = document.getElementById('pngremix-model-file')?.value?.trim() || 'asset/model.pngRemix';
  p.model.default_state_index = parseInt(document.getElementById('pngremix-default-state-index')?.value) || 0;
  p.model.scale = parseFloat(document.getElementById('pngremix-model-scale')?.value) || 1;
  p.model.max_fps = parseInt(document.getElementById('pngremix-max-fps')?.value) || 60;

  p.features.mouse_follow = document.getElementById('pngremix-mouse-follow')?.checked ?? true;
  p.features.auto_blink = document.getElementById('pngremix-auto-blink')?.checked ?? true;
  p.features.click_bounce = document.getElementById('pngremix-click-bounce')?.checked ?? true;
  p.features.click_bounce_amp = parseFloat(document.getElementById('pngremix-click-bounce-amp')?.value) || 50;
  p.features.click_bounce_duration = parseFloat(document.getElementById('pngremix-click-bounce-duration')?.value) || 0.5;
  p.features.blink_speed = parseFloat(document.getElementById('pngremix-blink-speed')?.value) || 1.0;
  p.features.blink_chance = parseInt(document.getElementById('pngremix-blink-chance')?.value) || 10;
  p.features.blink_hold_ratio = parseFloat(document.getElementById('pngremix-blink-hold-ratio')?.value) || 0.2;
}

/**
 * 填充 PngRemix 模型和特性表单
 */
function populatePngRemixForm() {
  ensurePngRemixData();
  const p = currentMod.assets.pngremix;

  const el = (id) => document.getElementById(id);
  if (el('pngremix-model-name')) el('pngremix-model-name').value = p.model.name || '';
  if (el('pngremix-model-file')) el('pngremix-model-file').value = p.model.pngremix_file || 'asset/model.pngRemix';
  if (el('pngremix-default-state-index')) el('pngremix-default-state-index').value = p.model.default_state_index ?? 0;
  if (el('pngremix-model-scale')) el('pngremix-model-scale').value = p.model.scale ?? 1;
  if (el('pngremix-max-fps')) el('pngremix-max-fps').value = p.model.max_fps ?? 60;

  if (el('pngremix-mouse-follow')) el('pngremix-mouse-follow').checked = p.features.mouse_follow !== false;
  if (el('pngremix-auto-blink')) el('pngremix-auto-blink').checked = p.features.auto_blink !== false;
  if (el('pngremix-click-bounce')) el('pngremix-click-bounce').checked = p.features.click_bounce !== false;
  if (el('pngremix-click-bounce-amp')) el('pngremix-click-bounce-amp').value = p.features.click_bounce_amp ?? 50;
  if (el('pngremix-click-bounce-duration')) el('pngremix-click-bounce-duration').value = p.features.click_bounce_duration ?? 0.5;
  if (el('pngremix-blink-speed')) el('pngremix-blink-speed').value = p.features.blink_speed ?? 1.0;
  if (el('pngremix-blink-chance')) el('pngremix-blink-chance').value = p.features.blink_chance ?? 10;
  if (el('pngremix-blink-hold-ratio')) el('pngremix-blink-hold-ratio').value = p.features.blink_hold_ratio ?? 0.2;
}

/**
 * 渲染 PngRemix 所有子列表
 */
function renderPngRemixAssets() {
  ensurePngRemixData();
  populatePngRemixForm();
  const p = currentMod.assets.pngremix;
  renderPngRemixExpressions(p.expressions || []);
  renderPngRemixMotions(p.motions || []);
  renderPngRemixStates(p.states || []);
}

// ---- PngRemix：从文件同步 ----

function _normalizePngRemixKeyName(key) {
  const s = String(key || '').trim().toUpperCase();
  if (!s) return '';

  // Accept F1..F12
  const m = /^F(\d{1,2})$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 12) return `F${n}`;
  }

  // Common variants
  if (s.startsWith('KEY_')) return _normalizePngRemixKeyName(s.slice(4));
  return s;
}

function _normalizePngRemixSavedDisappearEvent(ev) {
  if (!ev) return { hotkey: '', label: '' };

  if (typeof ev === 'string') {
    const k = _normalizePngRemixKeyName(ev);
    return { hotkey: k, label: k || ev };
  }

  if (typeof ev === 'number') {
    return { hotkey: '', label: String(ev) };
  }

  if (typeof ev === 'object') {
    const keycode = Number(ev.keycode ?? ev.physical_keycode ?? ev.physicalKeycode ?? NaN);
    if (Number.isFinite(keycode)) {
      // Godot 4: F1..F12 often map around 112..123
      if (keycode >= 112 && keycode <= 123) {
        const k = `F${keycode - 111}`;
        return { hotkey: k, label: k };
      }
    }

    const keyText = ev.key ?? ev.as_text ?? ev.asText ?? ev.text;
    if (typeof keyText === 'string') {
      const k = _normalizePngRemixKeyName(keyText);
      return { hotkey: k, label: k || keyText };
    }

    return { hotkey: '', label: String(ev.type || '') };
  }

  return { hotkey: '', label: String(ev) };
}

function _computePngRemixStateCount(decoded) {
  if (!decoded || typeof decoded !== 'object') return 0;

  const settings = decoded.settings_dict && typeof decoded.settings_dict === 'object' ? decoded.settings_dict : {};
  let stateCount = 0;

  if (Array.isArray(settings.states)) stateCount = settings.states.length;

  if (!stateCount) {
    const sprites = Array.isArray(decoded.sprites_array) ? decoded.sprites_array : [];
    for (const s of sprites) {
      if (s && Array.isArray(s.states)) {
        stateCount = Math.max(stateCount, s.states.length);
      }
    }
  }

  return Math.max(0, Math.floor(stateCount) || 0);
}

function _derivePngRemixStateNames(decoded, stateCount, existingExpressions) {
  const settings = decoded?.settings_dict && typeof decoded.settings_dict === 'object' ? decoded.settings_dict : {};
  const rawStates = Array.isArray(settings.states) ? settings.states : [];

  const existingByIndex = new Map();
  if (Array.isArray(existingExpressions)) {
    for (const e of existingExpressions) {
      const idx = Number(e?.state_index);
      if (Number.isFinite(idx)) existingByIndex.set(Math.floor(idx), String(e?.name || '').trim());
    }
  }

  function pickNameFromEntry(entry) {
    if (!entry) return '';
    if (typeof entry === 'string') return entry.trim();
    if (typeof entry === 'object') {
      const candidates = [entry.name, entry.state_name, entry.stateName, entry.label, entry.title];
      for (const c of candidates) {
        const t = String(c || '').trim();
        if (t) return t;
      }
    }
    return '';
  }

  const used = new Set();
  const out = [];
  for (let i = 0; i < stateCount; i++) {
    let name = pickNameFromEntry(rawStates[i]);

    // fallback to existing
    if (!name) name = String(existingByIndex.get(i) || '').trim();

    // fallback to generated
    if (!name) name = `state_${i}`;

    // ensure uniqueness
    let base = name;
    let suffix = 2;
    while (used.has(name)) {
      name = `${base}_${suffix++}`;
    }

    used.add(name);
    out.push(name);
  }

  return out;
}

async function _resolvePngRemixFileInModFolder() {
  if (!currentMod) {
    showToast(window.i18n.t('msg_load_mod_first'), 'warning');
    return null;
  }
  if (!modFolderHandle) {
    showToast(window.i18n.t('msg_sync_need_folder'), 'warning');
    return null;
  }

  collectPngRemixModelData();
  const pngremix = ensurePngRemixData();

  let relPath = String(pngremix?.model?.pngremix_file || '').trim();
  if (!relPath) {
    relPath = 'asset/model.pngRemix';
    pngremix.model.pngremix_file = relPath;
  }

  async function tryOpenByRelPath(p) {
    const parts = String(p || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length === 0) return null;

    let dirHandle = modFolderHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      dirHandle = await dirHandle.getDirectoryHandle(parts[i]);
    }

    const fileHandle = await dirHandle.getFileHandle(parts[parts.length - 1]);
    return { fileHandle, relPath: parts.join('/') };
  }

  async function scanCandidates() {
    const out = [];

    // root
    for await (const entry of modFolderHandle.values()) {
      if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.pngremix')) {
        out.push(entry.name);
      }
    }

    // asset/
    try {
      const assetDir = await modFolderHandle.getDirectoryHandle('asset');
      for await (const entry of assetDir.values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.pngremix')) {
          out.push(`asset/${entry.name}`);
        }
      }
    } catch (e) {
      // ignore
    }

    // prefer asset/ then stable sort
    out.sort((a, b) => {
      const aa = a.startsWith('asset/') ? 0 : 1;
      const bb = b.startsWith('asset/') ? 0 : 1;
      if (aa !== bb) return aa - bb;
      return a.localeCompare(b);
    });

    return out;
  }

  try {
    const opened = await tryOpenByRelPath(relPath);
    if (opened) return { ...opened, pngremix };
  } catch (e) {
    // path invalid, fall back to scan
  }

  const candidates = await scanCandidates();
  if (candidates.length === 0) {
    showToast(window.i18n.t('msg_sync_no_pngremix_found'), 'warning');
    return null;
  }

  if (candidates.length === 1) {
    relPath = candidates[0];
  } else {
    const choice = prompt(
      window.i18n.t('msg_sync_choose_pngremix').replace('{files}', candidates.join('\n')),
      candidates[0]
    );
    if (!choice) return null;
    relPath = choice.trim();
  }

  // update form value
  pngremix.model.pngremix_file = relPath;
  populatePngRemixForm();

  try {
    const opened = await tryOpenByRelPath(relPath);
    if (opened) return { ...opened, pngremix };
  } catch (e) {
    showToast(window.i18n.t('msg_sync_pngremix_file_not_found'), 'error');
    return null;
  }

  return null;
}

async function _decodePngRemixFileFromModFolder() {
  if (!window.PngRemixDecoder || typeof window.PngRemixDecoder.decode !== 'function') {
    showToast(window.i18n.t('msg_pngremix_decoder_missing'), 'error');
    return null;
  }

  const resolved = await _resolvePngRemixFileInModFolder();
  if (!resolved) return null;

  const { fileHandle } = resolved;
  const file = await fileHandle.getFile();
  const ab = await file.arrayBuffer();
  const decoded = window.PngRemixDecoder.decode(ab);

  return { ...resolved, decoded };
}

/**
 * 导入一个 .pngRemix 文件到 Mod 的 asset 目录
 */
async function importPngRemixFile() {
  if (!currentMod) {
    showToast(window.i18n.t('msg_load_mod_first'), 'warning');
    return;
  }
  if (!modFolderHandle) {
    showToast(window.i18n.t('msg_import_pngremix_need_folder'), 'warning');
    return;
  }

  try {
    const [fileHandle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{
        description: 'PngRemix File',
        accept: { 'application/octet-stream': ['.pngRemix', '.pngremix'] }
      }]
    });
    const file = await fileHandle.getFile();

    const assetDir = await getOrCreateDir(modFolderHandle, ['asset']);
    const fileName = await writeFileToDir(assetDir, file);

    // 自动更新 pngremix_file 字段
    const p = ensurePngRemixData();
    p.model.pngremix_file = `asset/${fileName}`;
    populatePngRemixForm();
    markUnsaved();

    showToast(window.i18n.t('msg_import_pngremix_success').replace('{file}', fileName), 'success');
  } catch (err) {
    if (err?.name === 'AbortError') return;
    console.error('importPngRemixFile error:', err);
    const msg = window.i18n.t('msg_import_pngremix_failed').replace('{error}', err?.message || String(err));
    showToast(msg, 'error');
  }
}

/**
 * 从文件同步 PngRemix 配置
 * - 读取 .pngRemix 文件的 settings_dict 中的部分字段（如 blink_speed/blink_chance）
 */
async function syncPngRemixConfigFromFiles() {
  if (!confirm(window.i18n.t('msg_sync_pngremix_config_confirm'))) return;

  try {
    const resolved = await _decodePngRemixFileFromModFolder();
    if (!resolved) return;

    const { decoded, relPath } = resolved;
    const p = ensurePngRemixData();

    // Fill model name if empty
    if (!String(p.model.name || '').trim()) {
      const base = String(relPath || '').replace(/\\/g, '/').split('/').pop() || '';
      p.model.name = base.replace(/\.[^.]+$/, '');
    }

    // Sync blink tuning from file settings if present
    const settings = decoded?.settings_dict && typeof decoded.settings_dict === 'object' ? decoded.settings_dict : {};

    const blinkSpeed = Number(settings.blink_speed);
    if (Number.isFinite(blinkSpeed) && blinkSpeed > 0) {
      p.features.blink_speed = blinkSpeed;
    }

    const blinkChance = Number(settings.blink_chance);
    if (Number.isFinite(blinkChance) && blinkChance >= 1) {
      p.features.blink_chance = Math.floor(blinkChance);
    }

    // Optional: max_fps
    const maxFps = Number(settings.max_fps ?? settings.max_fps_limit ?? NaN);
    if (Number.isFinite(maxFps) && maxFps >= 0) {
      p.model.max_fps = Math.floor(maxFps);
    }

    populatePngRemixForm();
    markUnsaved();

    showToast(window.i18n.t('msg_sync_pngremix_config_success'), 'success');
  } catch (err) {
    console.error('syncPngRemixConfigFromFiles error:', err);
    const msg = window.i18n.t('msg_sync_failed').replace('{error}', err?.message || String(err));
    showToast(msg, 'error');
  }
}

/**
 * 从文件同步 PngRemix 资产
 * - expressions: 从 stateCount/设置 states 推导
 * - motions: 扫描 sprites_array[*].saved_keys/saved_disappear 推导可用热键
 */
async function syncPngRemixAssetsFromFiles() {
  if (!confirm(window.i18n.t('msg_sync_pngremix_assets_confirm'))) return;

  try {
    const resolved = await _decodePngRemixFileFromModFolder();
    if (!resolved) return;

    const { decoded } = resolved;
    const p = ensurePngRemixData();

    const stateCount = _computePngRemixStateCount(decoded);
    const stateNames = _derivePngRemixStateNames(decoded, stateCount, p.expressions);

    const newExpressions = [];
    for (let i = 0; i < stateCount; i++) {
      newExpressions.push({ name: stateNames[i], state_index: i });
    }

    // Scan hotkeys
    const sprites = Array.isArray(decoded?.sprites_array) ? decoded.sprites_array : [];
    const hotkeys = new Set();

    for (const s of sprites) {
      if (!s || typeof s !== 'object') continue;
      if (s.is_asset !== true) continue;

      const saved = Array.isArray(s.saved_keys) ? s.saved_keys : [];
      for (const k of saved) {
        const nk = _normalizePngRemixKeyName(k);
        if (nk) hotkeys.add(nk);
      }

      const disappear = Array.isArray(s.saved_disappear) ? s.saved_disappear : [];
      for (const ev of disappear) {
        const { hotkey } = _normalizePngRemixSavedDisappearEvent(ev);
        if (hotkey) hotkeys.add(hotkey);
      }
    }

    const keysSorted = Array.from(hotkeys).sort((a, b) => {
      const ma = /^F(\d+)$/.exec(a);
      const mb = /^F(\d+)$/.exec(b);
      if (ma && mb) return Number(ma[1]) - Number(mb[1]);
      if (ma) return -1;
      if (mb) return 1;
      return String(a).localeCompare(String(b));
    });

    const existingByHotkey = new Map();
    for (const m of (p.motions || [])) {
      const hk = _normalizePngRemixKeyName(m?.hotkey);
      if (hk) existingByHotkey.set(hk, m);
    }

    const usedMotionNames = new Set();
    const newMotions = [];
    for (const hk of keysSorted) {
      const prev = existingByHotkey.get(hk);
      const baseName = String(prev?.name || hk).trim() || hk;
      let name = baseName;
      let suffix = 2;
      while (usedMotionNames.has(name)) {
        name = `${baseName}_${suffix++}`;
      }
      usedMotionNames.add(name);

      newMotions.push({
        name,
        hotkey: hk,
        description: String(prev?.description || '').trim(),
      });
    }

    // Apply overrides
    p.expressions = newExpressions;
    p.motions = newMotions;

    // Preserve existing state mappings; ensure we at least have quick mappings for motions/expressions
    const existingStates = Array.isArray(p.states) ? p.states : [];
    const existingStatesMap = {};
    for (const st of existingStates) {
      if (st && st.state) existingStatesMap[String(st.state)] = st;
    }

    const usedStateKeys = new Set();
    const syncedStates = [];

    // 1) Expressions
    for (const e of newExpressions) {
      const k = String(e.name || '').trim();
      if (!k) continue;
      usedStateKeys.add(k);
      if (existingStatesMap[k]) {
        syncedStates.push(existingStatesMap[k]);
      } else {
        syncedStates.push({
          state: k,
          expression: k,
          motion: '',
          scale: 1,
          offset_x: 0,
          offset_y: 0
        });
      }
    }

    // 2) Motions
    for (const m of newMotions) {
      const k = String(m.name || '').trim();
      if (!k) continue;
      if (usedStateKeys.has(k)) continue;
      usedStateKeys.add(k);
      if (existingStatesMap[k]) {
        syncedStates.push(existingStatesMap[k]);
      } else {
        syncedStates.push({
          state: k,
          expression: '',
          motion: k,
          scale: 1,
          offset_x: 0,
          offset_y: 0
        });
      }
    }

    // 3) Append remaining existing mappings (preserve custom mappings like idle/work/etc.)
    for (const st of existingStates) {
      const k = String(st?.state || '').trim();
      if (!k) continue;
      if (usedStateKeys.has(k)) continue;
      syncedStates.push(st);
    }

    p.states = syncedStates;
    normalizePngRemixDataInPlace(p);

    // Refresh UI
    renderPngRemixAssets();
    updateAnimaSelects();
    markUnsaved();

    const msg = window.i18n.t('msg_sync_pngremix_assets_success')
      .replace('{motions}', newMotions.length)
      .replace('{expressions}', newExpressions.length)
      .replace('{states}', p.states.length);
    showToast(msg, 'success');
  } catch (err) {
    console.error('syncPngRemixAssetsFromFiles error:', err);
    const msg = window.i18n.t('msg_sync_failed').replace('{error}', err?.message || String(err));
    showToast(msg, 'error');
  }
}

// ---- PngRemix 下拉选项辅助 ----

function getPngRemixMotionSelectOptions(currentValue = '') {
  const pngremix = currentMod?.assets?.pngremix;
  const motions = pngremix?.motions || [];
  let html = `<option value="">${window.i18n.t('select_motion_placeholder')}</option>`;
  motions.forEach(m => {
    const selected = m.name === currentValue ? ' selected' : '';
    html += `<option value="${escapeHtml(m.name)}"${selected}>${escapeHtml(m.name)}</option>`;
  });
  return html;
}

function getPngRemixExpressionSelectOptions(currentValue = '') {
  const pngremix = currentMod?.assets?.pngremix;
  const expressions = pngremix?.expressions || [];
  let html = `<option value="">${window.i18n.t('select_expression_placeholder')}</option>`;
  expressions.forEach(e => {
    const selected = e.name === currentValue ? ' selected' : '';
    html += `<option value="${escapeHtml(e.name)}"${selected}>${escapeHtml(e.name)}</option>`;
  });
  return html;
}

function normalizePngRemixMouthStateValue(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i === 0 || i === 1 || i === 2) return i;
  return null;
}

function formatPngRemixMouthState(v) {
  const ms = normalizePngRemixMouthStateValue(v);
  if (ms === 0) return window.i18n.t('pngremix_mouth_state_closed');
  if (ms === 1) return window.i18n.t('pngremix_mouth_state_open');
  if (ms === 2) return window.i18n.t('pngremix_mouth_state_screaming');
  return window.i18n.t('pngremix_mouth_state_inherit');
}

function getPngRemixMouthStateSelectOptions(currentValue) {
  const ms = normalizePngRemixMouthStateValue(currentValue);
  const opts = [
    { value: '', label: window.i18n.t('pngremix_mouth_state_inherit') },
    { value: '0', label: window.i18n.t('pngremix_mouth_state_closed') },
    { value: '1', label: window.i18n.t('pngremix_mouth_state_open') },
    { value: '2', label: window.i18n.t('pngremix_mouth_state_screaming') },
  ];
  return opts.map(o => {
    const selected = (o.value === '' ? ms === null : String(ms) === o.value) ? ' selected' : '';
    return `<option value="${o.value}"${selected}>${escapeHtml(o.label)}</option>`;
  }).join('');
}

function normalizePngRemixDataInPlace(pngremix) {
  if (!pngremix || typeof pngremix !== 'object') return;
  if (!Array.isArray(pngremix.states)) return;

  for (const st of pngremix.states) {
    if (!st || typeof st !== 'object') continue;

    // 规范 mouth_state
    const ms = normalizePngRemixMouthStateValue(st.mouth_state);
    if (ms !== null) {
      st.mouth_state = ms;
    } else if (Object.prototype.hasOwnProperty.call(st, 'mouth_state')) {
      delete st.mouth_state;
    }
  }
}


// ---- PngRemix 剪贴板 ----

async function copyPngRemixItem(kind, index) {
  if (!currentMod) return;
  const pngremix = currentMod.assets?.pngremix;
  if (!pngremix) return;
  const map = { motion: 'motions', expression: 'expressions', state: 'states' };
  const arr = pngremix[map[kind]];
  const item = arr?.[index];
  if (!item) {
    showToast(window.i18n.t('msg_no_data_to_copy'), 'warning');
    return;
  }
  try {
    const data = { type: `tbuddy_pngremix_${kind}`, data: item };
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    showToast(window.i18n.t('msg_copied_to_clipboard'), 'success');
  } catch (e) {
    showToast(window.i18n.t('msg_clipboard_read_failed'), 'error');
  }
}

async function pastePngRemixItem(kind) {
  if (!currentMod) return;
  const pngremix = ensurePngRemixData();
  const map = { motion: 'motions', expression: 'expressions', state: 'states' };
  const expectedType = `tbuddy_pngremix_${kind}`;
  try {
    const text = await navigator.clipboard.readText();
    const parsed = JSON.parse(text);
    if (parsed.type !== expectedType || typeof parsed.data !== 'object') {
      showToast(window.i18n.t('msg_clipboard_empty'), 'warning');
      return;
    }
    pngremix[map[kind]].push(parsed.data);
    renderPngRemixAssets();
    updateAnimaSelects();
    markUnsaved();
    showToast(window.i18n.t('msg_pasted_from_clipboard'), 'success');
  } catch (e) {
    showToast(window.i18n.t('msg_clipboard_empty'), 'warning');
  }
}

// ---- PngRemix 表情（card + modal）----

function renderPngRemixExpressions(expressions) {
  const list = document.getElementById('pngremix-expressions-list');
  if (!list) return;
  list.innerHTML = '';

  const nameRaw = (document.getElementById('pngremix-expressions-filter-name')?.value || '').trim();
  const nameNdl = nameRaw.toLowerCase();

  expressions.forEach((expr, index) => {
    const eName = String(expr.name || '');
    if (nameNdl && !eName.toLowerCase().includes(nameNdl)) return;

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
          <button class="btn btn-sm btn-ghost" onclick="copyPngRemixItem('expression', ${index})" title="${window.i18n.t('btn_copy_to_clipboard')}">📋</button>
          <button class="btn btn-sm btn-ghost" onclick="editPngRemixExpression(${index})">✏️</button>
          <button class="btn btn-sm btn-ghost" onclick="deletePngRemixExpression(${index})">🗑️</button>
        </div>
      </div>
      <div class="asset-card-body">
        <div class="asset-field"><span class="label">${window.i18n.t('pngremix_expr_state_index_label')}:</span> ${expr.state_index ?? 0}</div>
      </div>
    `;
    list.appendChild(card);
  });

  const footer = document.createElement('div');
  footer.className = 'section-footer';
  footer.innerHTML = `
    <button class="btn btn-sm btn-ghost" onclick="pastePngRemixItem('expression')">📋 <span>${window.i18n.t('btn_paste_from_clipboard')}</span></button>
    <button class="btn btn-sm btn-primary" onclick="addPngRemixExpression()">➕ <span>${window.i18n.t('btn_add_expression')}</span></button>
  `;
  list.appendChild(footer);

  enableTbSortable(list, {
    canStart: () => {
      const ids = ['pngremix-expressions-filter-name'];
      const hasFilters = ids.some(id => (document.getElementById(id)?.value || '').trim());
      if (hasFilters) {
        showToast(window.i18n.t('msg_clear_filters_to_reorder'), 'warning');
        return false;
      }
      return true;
    },
    onSortedKeys: (orderedKeys) => {
      if (!currentMod) return;
      const pngremix = ensurePngRemixData();
      reorderArrayInPlaceByKeys(pngremix.expressions, orderedKeys, ensureTbUid);
      renderPngRemixAssets();
      updateAnimaSelects();
      markUnsaved();
    }
  });
}

function addPngRemixExpression() {
  openPngRemixExpressionModal(window.i18n.t('btn_add_expression'), {
    name: '',
    state_index: 0
  }, -1);
}

function editPngRemixExpression(index) {
  const pngremix = ensurePngRemixData();
  const expr = pngremix.expressions[index];
  if (!expr) return;
  openPngRemixExpressionModal(window.i18n.t('pngremix_expr_name_label'), expr, index);
}

function deletePngRemixExpression(index) {
  if (!confirm(window.i18n.t('msg_confirm_delete_pngremix_expression'))) return;
  ensurePngRemixData();
  currentMod.assets.pngremix.expressions.splice(index, 1);
  renderPngRemixAssets();
  updateAnimaSelects();
  markUnsaved();
}

function openPngRemixExpressionModal(title, expr, index) {
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
        <label>${window.i18n.t('pngremix_expr_name_label')} <span class="required">*</span></label>
        <input type="text" id="pngremix-edit-expr-name" value="${escapeHtml(expr.name || '')}" placeholder="${window.i18n.t('placeholder_pngremix_expr_name')}">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('pngremix_expr_state_index_label')}</label>
        <input type="number" id="pngremix-edit-expr-state-index" value="${expr.state_index ?? 0}" min="0">
        <small>${window.i18n.t('pngremix_default_state_hint')}</small>
      </div>
    </div>
  `;

  modal._live2dSaveHandler = () => savePngRemixExpression(index);
  modal.classList.add('show');
}

function savePngRemixExpression(index) {
  const name = document.getElementById('pngremix-edit-expr-name').value.trim();
  if (!name) {
    showToast(window.i18n.t('msg_enter_expression_name'), 'warning');
    return;
  }

  const expr = {
    name: name,
    state_index: parseInt(document.getElementById('pngremix-edit-expr-state-index').value) || 0
  };

  const pngremix = ensurePngRemixData();
  if (index === -1) {
    pngremix.expressions.push(expr);
  } else {
    pngremix.expressions[index] = expr;
  }

  closeAssetModal();
  renderPngRemixAssets();
  updateAnimaSelects();
  markUnsaved();
}

// ---- PngRemix 动作（card + modal）----

function renderPngRemixMotions(motions) {
  const list = document.getElementById('pngremix-motions-list');
  if (!list) return;
  list.innerHTML = '';

  const nameRaw = (document.getElementById('pngremix-motions-filter-name')?.value || '').trim();
  const nameNdl = nameRaw.toLowerCase();

  motions.forEach((motion, index) => {
    const mName = String(motion.name || '');
    if (nameNdl && !mName.toLowerCase().includes(nameNdl)) return;

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
          <button class="btn btn-sm btn-ghost" onclick="copyPngRemixItem('motion', ${index})" title="${window.i18n.t('btn_copy_to_clipboard')}">📋</button>
          <button class="btn btn-sm btn-ghost" onclick="editPngRemixMotion(${index})">✏️</button>
          <button class="btn btn-sm btn-ghost" onclick="deletePngRemixMotion(${index})">🗑️</button>
        </div>
      </div>
      <div class="asset-card-body">
        <div class="asset-field"><span class="label">${window.i18n.t('pngremix_motion_hotkey_label')}:</span> ${escapeHtml(motion.hotkey || '')}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('pngremix_motion_desc_label')}:</span> ${escapeHtml(motion.description || '')}</div>
      </div>

    `;
    list.appendChild(card);
  });

  const footer = document.createElement('div');
  footer.className = 'section-footer';
  footer.innerHTML = `
    <button class="btn btn-sm btn-ghost" onclick="pastePngRemixItem('motion')">📋 <span>${window.i18n.t('btn_paste_from_clipboard')}</span></button>
    <button class="btn btn-sm btn-primary" onclick="addPngRemixMotion()">➕ <span>${window.i18n.t('btn_add_motion')}</span></button>
  `;
  list.appendChild(footer);

  enableTbSortable(list, {
    canStart: () => {
      const ids = ['pngremix-motions-filter-name'];
      const hasFilters = ids.some(id => (document.getElementById(id)?.value || '').trim());
      if (hasFilters) {
        showToast(window.i18n.t('msg_clear_filters_to_reorder'), 'warning');
        return false;
      }
      return true;
    },
    onSortedKeys: (orderedKeys) => {
      if (!currentMod) return;
      const pngremix = ensurePngRemixData();
      reorderArrayInPlaceByKeys(pngremix.motions, orderedKeys, ensureTbUid);
      renderPngRemixAssets();
      updateAnimaSelects();
      markUnsaved();
    }
  });
}

function addPngRemixMotion() {
  openPngRemixMotionModal(window.i18n.t('btn_add_motion'), {
    name: '',
    hotkey: 'F1',
    description: ''
  }, -1);
}

function editPngRemixMotion(index) {
  const pngremix = ensurePngRemixData();
  const motion = pngremix.motions[index];
  if (!motion) return;
  openPngRemixMotionModal(window.i18n.t('pngremix_motion_name_label'), motion, index);
}

function deletePngRemixMotion(index) {
  if (!confirm(window.i18n.t('msg_confirm_delete_pngremix_motion'))) return;
  ensurePngRemixData();
  currentMod.assets.pngremix.motions.splice(index, 1);
  renderPngRemixAssets();
  updateAnimaSelects();
  markUnsaved();
}

function openPngRemixMotionModal(title, motion, index) {
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
        <label>${window.i18n.t('pngremix_motion_name_label')} <span class="required">*</span></label>
        <input type="text" id="pngremix-edit-motion-name" value="${escapeHtml(motion.name || '')}" placeholder="${window.i18n.t('placeholder_pngremix_motion_name')}">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('pngremix_motion_hotkey_label')}</label>
        <input type="text" id="pngremix-edit-motion-hotkey" value="${escapeHtml(motion.hotkey || '')}" placeholder="${window.i18n.t('pngremix_enter_hotkey')}">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('pngremix_motion_desc_label')}</label>
        <input type="text" id="pngremix-edit-motion-desc" value="${escapeHtml(motion.description || '')}" placeholder="${window.i18n.t('pngremix_enter_description')}">
      </div>
    </div>
  `;


  modal._live2dSaveHandler = () => savePngRemixMotion(index);
  modal.classList.add('show');
}

function savePngRemixMotion(index) {
  const name = document.getElementById('pngremix-edit-motion-name').value.trim();
  if (!name) {
    showToast(window.i18n.t('msg_enter_motion_name'), 'warning');
    return;
  }

  const hotkey = document.getElementById('pngremix-edit-motion-hotkey').value.trim();
  const motion = {
    name: name,
    hotkey: hotkey,
    description: document.getElementById('pngremix-edit-motion-desc').value.trim()
  };

  const pngremix = ensurePngRemixData();
  if (index === -1) {
    pngremix.motions.push(motion);
  } else {
    pngremix.motions[index] = motion;
  }

  closeAssetModal();
  renderPngRemixAssets();
  updateAnimaSelects();
  markUnsaved();
}

// ---- PngRemix 状态映射（card + modal）----

function renderPngRemixStates(states) {
  const list = document.getElementById('pngremix-states-list');
  if (!list) return;
  list.innerHTML = '';

  const nameRaw = (document.getElementById('pngremix-states-filter-name')?.value || '').trim();
  const motionRaw = (document.getElementById('pngremix-states-filter-motion')?.value || '').trim();
  const exprRaw = (document.getElementById('pngremix-states-filter-expression')?.value || '').trim();
  const nameNdl = nameRaw.toLowerCase();
  const motionNdl = motionRaw.toLowerCase();
  const exprNdl = exprRaw.toLowerCase();

  const existingManifestStateNames = new Set(
    getAllStateNames().map(n => String(n || '').trim()).filter(Boolean)
  );

  states.forEach((st, index) => {
    const sName = String(st.state || '');
    const sMotion = String(st.motion || '');
    const sExpr = String(st.expression || '');
    if (nameNdl && !sName.toLowerCase().includes(nameNdl)) return;
    if (motionNdl && !sMotion.toLowerCase().includes(motionNdl)) return;
    if (exprNdl && !sExpr.toLowerCase().includes(exprNdl)) return;

    const trimmedName = sName.trim();
    const canAddState = !!trimmedName && !existingManifestStateNames.has(trimmedName);
    const addStateBtnHtml = `
      <button class="btn btn-sm btn-ghost" onclick="createStateFromPngRemixMapping(${index})" ${canAddState ? '' : 'disabled'} title="${window.i18n.t('btn_add_same_name_state')}">➕</button>
    `;

    const card = document.createElement('div');
    card.className = 'asset-card tb-sort-item';
    card.dataset.sortKey = ensureTbUid(st);
    card.innerHTML = `
      <div class="asset-card-header">
        <div class="tb-title-with-handle">
          ${renderSortHandleHtml()}
          <span class="asset-card-name">${highlightNeedleHtml(sName, nameRaw)}</span>
        </div>
        <div class="asset-card-actions">
          ${addStateBtnHtml}
          <button class="btn btn-sm btn-ghost" onclick="copyPngRemixItem('state', ${index})" title="${window.i18n.t('btn_copy_to_clipboard')}">📋</button>
          <button class="btn btn-sm btn-ghost" onclick="editPngRemixState(${index})">✏️</button>
          <button class="btn btn-sm btn-ghost" onclick="deletePngRemixState(${index})">🗑️</button>
        </div>
      </div>
      <div class="asset-card-body">
        <div class="asset-field"><span class="label">${window.i18n.t('pngremix_state_motion_label')}:</span> ${highlightNeedleHtml(sMotion, motionRaw)}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('pngremix_state_expression_label')}:</span> ${highlightNeedleHtml(sExpr, exprRaw)}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('pngremix_state_mouth_state_label')}:</span> ${formatPngRemixMouthState(st.mouth_state)}</div>

        <div class="asset-field"><span class="label">${window.i18n.t('pngremix_state_scale_label')}:</span> ${st.scale ?? 1.0}</div>

        <div class="asset-field"><span class="label">${window.i18n.t('pngremix_state_offset_x_label')}/${window.i18n.t('pngremix_state_offset_y_label')}:</span> ${st.offset_x ?? 0}, ${st.offset_y ?? 0}</div>
      </div>

    `;
    list.appendChild(card);
  });

  const footer = document.createElement('div');
  footer.className = 'section-footer';
  footer.innerHTML = `
    <button class="btn btn-sm btn-ghost" onclick="pastePngRemixItem('state')">📋 <span>${window.i18n.t('btn_paste_from_clipboard')}</span></button>
    <button class="btn btn-sm btn-primary" onclick="addPngRemixState()">➕ <span>${window.i18n.t('btn_add_pngremix_state')}</span></button>
  `;
  list.appendChild(footer);

  enableTbSortable(list, {
    canStart: () => {
      const ids = ['pngremix-states-filter-name', 'pngremix-states-filter-motion', 'pngremix-states-filter-expression'];
      const hasFilters = ids.some(id => (document.getElementById(id)?.value || '').trim());
      if (hasFilters) {
        showToast(window.i18n.t('msg_clear_filters_to_reorder'), 'warning');
        return false;
      }
      return true;
    },
    onSortedKeys: (orderedKeys) => {
      if (!currentMod) return;
      const pngremix = ensurePngRemixData();
      reorderArrayInPlaceByKeys(pngremix.states, orderedKeys, ensureTbUid);
      renderPngRemixAssets();
      updateAnimaSelects();
      markUnsaved();
    }
  });
}

function addPngRemixState() {
  openPngRemixStateModal(window.i18n.t('btn_add_pngremix_state'), {
    state: '',
    motion: '',
    expression: '',
    mouth_state: undefined,
    scale: 1.0,
    offset_x: 0,
    offset_y: 0
  }, -1);
}



function editPngRemixState(index) {
  const pngremix = ensurePngRemixData();
  const state = pngremix.states[index];
  if (!state) return;
  openPngRemixStateModal(window.i18n.t('pngremix_state_name_label'), state, index);
}

function deletePngRemixState(index) {
  if (!confirm(window.i18n.t('msg_confirm_delete_pngremix_state'))) return;
  ensurePngRemixData();
  currentMod.assets.pngremix.states.splice(index, 1);
  renderPngRemixAssets();
  updateAnimaSelects();
  markUnsaved();
}

function openPngRemixStateModal(title, state, index) {
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
        <label>${window.i18n.t('pngremix_state_name_label')} <span class="required">*</span></label>
        <input type="text" id="pngremix-edit-state-name" value="${escapeHtml(state.state || '')}" placeholder="${window.i18n.t('placeholder_state_name')}">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('pngremix_state_motion_label')}</label>
        <select id="pngremix-edit-state-motion">
          ${getPngRemixMotionSelectOptions(state.motion)}
        </select>
      </div>
      <div class="form-group">
        <label>${window.i18n.t('pngremix_state_expression_label')}</label>
        <select id="pngremix-edit-state-expression">
          ${getPngRemixExpressionSelectOptions(state.expression)}
        </select>
      </div>
      <div class="form-group">
        <label>${window.i18n.t('pngremix_state_mouth_state_label')}</label>
        <select id="pngremix-edit-state-mouth-state">
          ${getPngRemixMouthStateSelectOptions(state.mouth_state)}
        </select>
      </div>


      <div class="form-group">
        <label>${window.i18n.t('pngremix_state_scale_label')}</label>
        <input type="number" id="pngremix-edit-state-scale" value="${state.scale ?? 1.0}" step="0.1" min="0.1">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('pngremix_state_offset_x_label')}</label>
        <input type="number" id="pngremix-edit-state-offset-x" value="${state.offset_x ?? 0}">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('pngremix_state_offset_y_label')}</label>
        <input type="number" id="pngremix-edit-state-offset-y" value="${state.offset_y ?? 0}">
      </div>
    </div>
  `;


  modal._live2dSaveHandler = () => savePngRemixState(index);
  modal.classList.add('show');
}

function savePngRemixState(index) {
  const stateName = document.getElementById('pngremix-edit-state-name').value.trim();
  if (!stateName) {
    showToast(window.i18n.t('msg_enter_pngremix_state'), 'warning');
    return;
  }

  const mouthStateStr = document.getElementById('pngremix-edit-state-mouth-state').value;
  const mouthState = mouthStateStr === '' ? null : normalizePngRemixMouthStateValue(mouthStateStr);

  const state = {
    state: stateName,
    motion: document.getElementById('pngremix-edit-state-motion').value,
    expression: document.getElementById('pngremix-edit-state-expression').value,
    scale: parseFloat(document.getElementById('pngremix-edit-state-scale').value) || 1.0,
    offset_x: parseInt(document.getElementById('pngremix-edit-state-offset-x').value) || 0,
    offset_y: parseInt(document.getElementById('pngremix-edit-state-offset-y').value) || 0
  };
  if (mouthState !== null) state.mouth_state = mouthState;


  const pngremix = ensurePngRemixData();
  if (index === -1) {
    pngremix.states.push(state);
  } else {
    pngremix.states[index] = state;
  }

  closeAssetModal();
  renderPngRemixAssets();
  updateAnimaSelects();
  markUnsaved();
}

/**
 * 从 PngRemix 状态映射创建同名 manifest 状态
 */
function createStateFromPngRemixMapping(index) {
  ensurePngRemixData();
  const mapping = currentMod.assets.pngremix.states[index];
  if (!mapping) return;

  const stateName = mapping.state;
  const exists = currentMod.manifest.states.some(s => s.name === stateName) ||
                 (currentMod.manifest.important_states && currentMod.manifest.important_states[stateName]);
  if (exists) {
    showToast(window.i18n.t('msg_state_same_name_exists'), 'warning');
    return;
  }

  const newState = createDefaultState(stateName);
  newState.anima = stateName;

  const params = [];
  if (mapping.expression) {
    params.push({ type: 'expression', name: mapping.expression });
  }
  if (mapping.motion) {
    params.push({ type: 'motion', name: mapping.motion });
  }
  if (params.length > 0) {
    newState.pngremix_params = params;
  }

  const textLang = currentTextLang;
  if (currentMod.texts[textLang]?.speech) {
    const matchText = currentMod.texts[textLang].speech.find(t => t.name === stateName);
    if (matchText) newState.text = stateName;
  }
  const audioLang = currentAudioLang;
  if (currentMod.audio[audioLang]) {
    const matchAudio = currentMod.audio[audioLang].find(a => a.name === stateName);
    if (matchAudio) newState.audio = stateName;
  }

  currentMod.manifest.states.push(newState);
  renderStates();
  renderPngRemixAssets();
  markUnsaved();
  showToast(window.i18n.t('msg_state_created_from_pngremix') || '已从 PngRemix 映射创建同名状态', 'success');
}

// ============================================================================
// PngRemix 参数覆写（状态编辑弹窗）
// ============================================================================

/**
 * 渲染 PngRemix 参数列表
 */
function renderPngRemixParams(params) {
  const list = document.getElementById('pngremix-param-list');
  if (!list) return;
  list.innerHTML = '';

  if (!Array.isArray(params)) return;

  // 获取可用的表情和动作名
  const exprNames = currentMod?.assets?.pngremix?.expressions?.map(e => e.name) || [];
  const motionNames = currentMod?.assets?.pngremix?.motions?.map(m => m.name) || [];

  params.forEach((param, index) => {
    const item = document.createElement('div');
    item.className = 'branch-item';

    // 构建类型下拉
    const typeSelect = `<select data-pngremix-param-type="${index}" style="width:120px;">
      <option value="expression" ${param.type === 'expression' ? 'selected' : ''}>${window.i18n.t('pngremix_param_type_expression') || '表情'}</option>
      <option value="motion" ${param.type === 'motion' ? 'selected' : ''}>${window.i18n.t('pngremix_param_type_motion') || '动作'}</option>
    </select>`;

    // 构建名称下拉（根据类型显示对应选项）
    const names = param.type === 'motion' ? motionNames : exprNames;
    let nameOptions = `<option value="">--</option>`;
    names.forEach(n => {
      nameOptions += `<option value="${escapeHtml(n)}" ${n === param.name ? 'selected' : ''}>${escapeHtml(n)}</option>`;
    });
    // 如果当前值不在列表中，也加上
    if (param.name && !names.includes(param.name)) {
      nameOptions += `<option value="${escapeHtml(param.name)}" selected>${escapeHtml(param.name)}</option>`;
    }
    const nameSelect = `<select data-pngremix-param-name="${index}" style="flex:1;">${nameOptions}</select>`;

    item.innerHTML = `
      ${typeSelect}
      ${nameSelect}
      <button class="btn btn-sm btn-ghost" onclick="removePngRemixParam(${index})">🗑️</button>
    `;

    // 当类型改变时，更新名称下拉选项
    item.querySelector(`[data-pngremix-param-type="${index}"]`).addEventListener('change', function() {
      const newType = this.value;
      const nameEl = item.querySelector(`[data-pngremix-param-name="${index}"]`);
      const currentNames = newType === 'motion' ? motionNames : exprNames;
      nameEl.innerHTML = '<option value="">--</option>' + currentNames.map(n => 
        `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`
      ).join('');
    });

    list.appendChild(item);
  });
}

/**
 * 添加 PngRemix 参数项
 */
function addPngRemixParam() {
  const list = document.getElementById('pngremix-param-list');
  if (!list) return;

  const params = collectPngRemixParams() || [];
  params.push({ type: 'expression', name: '' });
  renderPngRemixParams(params);
}

/**
 * 删除 PngRemix 参数项
 */
function removePngRemixParam(index) {
  const params = collectPngRemixParams() || [];
  params.splice(index, 1);
  renderPngRemixParams(params);
}

/**
 * 收集 PngRemix 参数列表
 */
function collectPngRemixParams() {
  const list = document.getElementById('pngremix-param-list');
  if (!list) return null;

  const params = [];
  list.querySelectorAll('[data-pngremix-param-type]').forEach((el) => {
    const type = el.value;
    const idx = el.getAttribute('data-pngremix-param-type');
    const nameEl = list.querySelector(`[data-pngremix-param-name="${idx}"]`);
    const name = nameEl?.value?.trim() || '';
    if (name) {
      params.push({ type, name });
    }
  });

  return params.length > 0 ? params : null;
}

// ============================================================================
// 3D (ThreeD / VRM) 支持
// ============================================================================

/**
 * 确保 threed 数据结构存在
 */
function ensureThreeDData() {
  if (!currentMod.assets.threed) {
    currentMod.assets.threed = {
      schema_version: 1,
      model: {
        name: '',
        type: 'vrm',
        file: 'asset/3d/model.vrm',
        scale: 1,
        offset_x: 0,
        offset_y: 0,
        texture_base_dir: '',
        animation_base_dir: ''
      },
      animations: []
    };
  }
  return currentMod.assets.threed;
}

/**
 * 从表单收集 3D 模型配置
 */
function collectThreeDModelData() {
  ensureThreeDData();
  const t = currentMod.assets.threed;

  t.model.name = document.getElementById('threed-model-name')?.value?.trim() || '';
  t.model.type = document.getElementById('threed-model-type')?.value || 'vrm';
  t.model.file = document.getElementById('threed-model-file')?.value?.trim() || 'asset/3d/model.vrm';
  t.model.scale = parseFloat(document.getElementById('threed-model-scale')?.value) || 1;
  t.model.offset_x = parseFloat(document.getElementById('threed-model-offset-x')?.value) || 0;
  t.model.offset_y = parseFloat(document.getElementById('threed-model-offset-y')?.value) || 0;
  t.model.texture_base_dir = document.getElementById('threed-texture-base-dir')?.value?.trim() || '';
  t.model.animation_base_dir = document.getElementById('threed-animation-base-dir')?.value?.trim() || '';
}

/**
 * 填充 3D 模型表单
 */
function populateThreeDModelForm() {
  ensureThreeDData();
  const t = currentMod.assets.threed;

  const el = (id) => document.getElementById(id);
  if (el('threed-model-name')) el('threed-model-name').value = t.model.name || '';
  if (el('threed-model-type')) el('threed-model-type').value = t.model.type || 'vrm';
  if (el('threed-model-file')) el('threed-model-file').value = t.model.file || 'asset/3d/model.vrm';
  if (el('threed-model-scale')) el('threed-model-scale').value = t.model.scale ?? 1;
  if (el('threed-model-offset-x')) el('threed-model-offset-x').value = t.model.offset_x ?? 0;
  if (el('threed-model-offset-y')) el('threed-model-offset-y').value = t.model.offset_y ?? 0;
  if (el('threed-texture-base-dir')) el('threed-texture-base-dir').value = t.model.texture_base_dir || '';
  if (el('threed-animation-base-dir')) el('threed-animation-base-dir').value = t.model.animation_base_dir || '';
}

/**
 * 导入文件夹到 asset/3d/ 目录
 * 仿照 importLive2dFolder()，让用户选择一个源文件夹，将其内容递归复制到 asset/3d/
 */
async function importThreeDFolder() {
  if (!currentMod) {
    showToast(window.i18n.t('msg_load_mod_first'), 'warning');
    return;
  }
  if (!modFolderHandle) {
    showToast(window.i18n.t('msg_import_threed_folder_need_folder'), 'warning');
    return;
  }

  if (!('showDirectoryPicker' in window)) {
    showToast(window.i18n.t('msg_browser_not_support'), 'error');
    return;
  }

  let sourceDirHandle;
  try {
    sourceDirHandle = await window.showDirectoryPicker({ mode: 'read' });
  } catch (e) {
    if (e.name === 'AbortError') return; // 用户取消
    showToast(window.i18n.t('msg_import_threed_folder_failed').replace('{error}', e.message || String(e)), 'error');
    return;
  }

  // 确认操作
  const folderName = sourceDirHandle.name || '';
  if (!confirm(window.i18n.t('msg_import_threed_folder_confirm').replace('{folder}', folderName))) {
    return;
  }

  try {
    showToast(window.i18n.t('msg_import_threed_folder_copying'), 'info');

    // 确保 asset/3d 目录存在
    const assetDir = await safeGetDirectoryHandle(modFolderHandle, 'asset', { create: true, overwriteFile: true });
    const threeDDir = await safeGetDirectoryHandle(assetDir, '3d', { create: true, overwriteFile: true });

    // 收集源文件夹中所有文件
    const files = await collectAllFilesFromDirectory(sourceDirHandle);
    if (files.length === 0) {
      showToast(window.i18n.t('msg_import_threed_folder_empty'), 'warning');
      return;
    }

    // 逐个复制到 asset/3d/ 目录
    let copiedCount = 0;
    let failedCount = 0;
    for (const { relPath, file } of files) {
      try {
        const { dir, fileName } = await ensureDirectoryForPath(threeDDir, relPath);
        const fileHandle = await safeGetFileHandle(dir, fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(file);
        await writable.close();
        copiedCount++;
      } catch (e) {
        console.warn('[importThreeDFolder] Skip copying file:', relPath, e);
        failedCount++;
      }
    }

    const msg = window.i18n.t('msg_import_threed_folder_success')
      .replace('{count}', String(copiedCount))
      .replace('{folder}', folderName);
    showToast(msg, 'success');

    if (failedCount > 0) {
      showToast(window.i18n.t('msg_import_threed_folder_partial_fail').replace('{count}', String(failedCount)), 'warning');
    }
  } catch (err) {
    console.error('importThreeDFolder error:', err);
    showToast(window.i18n.t('msg_import_threed_folder_failed').replace('{error}', err.message || String(err)), 'error');
  }
}

/**
 * 从文件同步 3D 模型配置
 * 自动扫描 asset/3d/ 目录，推断并填充模型配置、纹理目录、动画目录
 */
async function syncThreeDConfigFromFiles() {
  if (!currentMod) {
    showToast(window.i18n.t('msg_load_mod_first'), 'warning');
    return;
  }
  if (!modFolderHandle) {
    showToast(window.i18n.t('msg_sync_need_folder'), 'warning');
    return;
  }
  if (!confirm(window.i18n.t('msg_sync_threed_config_confirm'))) return;

  try {
    collectThreeDModelData();
    const threed = ensureThreeDData();

    // 导航到 asset/3d/ 目录
    let dirHandle = modFolderHandle;
    for (const part of ['asset', '3d']) {
      dirHandle = await dirHandle.getDirectoryHandle(part);
    }

    // 扫描 .vrm 和 .pmx 文件
    const modelFiles = [];
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && (entry.name.toLowerCase().endsWith('.vrm') || entry.name.toLowerCase().endsWith('.pmx'))) {
        modelFiles.push(entry.name);
      }
    }

    if (modelFiles.length === 0) {
      showToast(window.i18n.t('msg_sync_threed_no_vrm_found'), 'warning');
      return;
    }

    let chosenModel;
    if (modelFiles.length === 1) {
      chosenModel = modelFiles[0];
    } else {
      const choice = prompt(
        window.i18n.t('msg_sync_threed_choose_vrm').replace('{files}', modelFiles.join('\n')),
        modelFiles[0]
      );
      if (!choice) return;
      chosenModel = choice.trim();
    }

    // 填充模型配置
    const isPmx = chosenModel.toLowerCase().endsWith('.pmx');
    const nameFromFile = chosenModel.replace(/\.(vrm|pmx)$/i, '');
    if (!threed.model.name) {
      threed.model.name = nameFromFile;
    }
    threed.model.type = isPmx ? 'pmx' : 'vrm';
    threed.model.file = 'asset/3d/' + chosenModel;

    // 收集根目录和子目录的文件类型信息
    const texExts = ['.png', '.bmp', '.tga', '.jpg', '.jpeg', '.webp'];
    const animExts = ['.vrma', '.vmd'];
    let rootHasTextures = false;
    let rootHasAnims = false;
    const subDirs = [];

    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') {
        const lower = entry.name.toLowerCase();
        if (!rootHasTextures && texExts.some(ext => lower.endsWith(ext))) rootHasTextures = true;
        if (!rootHasAnims && animExts.some(ext => lower.endsWith(ext))) rootHasAnims = true;
      } else if (entry.kind === 'directory') {
        subDirs.push(entry.name);
      }
    }

    // 自动搜索纹理基础目录
    let texDir = '';
    if (rootHasTextures) {
      texDir = 'asset/3d';
    } else {
      for (const subName of subDirs) {
        try {
          const subDir = await dirHandle.getDirectoryHandle(subName);
          for await (const subEntry of subDir.values()) {
            if (subEntry.kind === 'file' && texExts.some(ext => subEntry.name.toLowerCase().endsWith(ext))) {
              texDir = 'asset/3d/' + subName;
              break;
            }
          }
          if (texDir) break;
        } catch { /* ignore */ }
      }
    }
    threed.model.texture_base_dir = texDir;

    // 自动搜索动画基础目录
    let animDir = '';
    if (rootHasAnims) {
      // 动画文件在 asset/3d/ 根目录
      animDir = 'asset/3d';
    } else {
      for (const subName of subDirs) {
        try {
          const subDir = await dirHandle.getDirectoryHandle(subName);
          for await (const subEntry of subDir.values()) {
            if (subEntry.kind === 'file' && animExts.some(ext => subEntry.name.toLowerCase().endsWith(ext))) {
              animDir = 'asset/3d/' + subName;
              break;
            }
          }
          if (animDir) break;
        } catch { /* ignore */ }
      }
    }
    threed.model.animation_base_dir = animDir;

    // 回写模型配置到表单
    populateThreeDModelForm();
    markUnsaved();

    showToast(window.i18n.t('msg_sync_threed_config_success'), 'success');
  } catch (err) {
    console.error('syncThreeDConfigFromFiles error:', err);
    if (err.name === 'NotFoundError' || err.message?.includes('not found')) {
      showToast(window.i18n.t('msg_sync_threed_dir_not_found'), 'error');
    } else {
      const msg = window.i18n.t('msg_sync_failed').replace('{error}', err.message || String(err));
      showToast(msg, 'error');
    }
  }
}

/**
 * 从文件同步 3D 资产（动画）
 * 基于文件扫描：优先从 animation_base_dir 目录搜索，否则从 asset/3d/ 搜索
 * animation_base_dir 非空时 file 存储相对于该目录的文件名，否则存储相对 mod 根目录的完整路径
 */
async function syncThreeDAssetsFromFiles() {
  if (!currentMod) {
    showToast(window.i18n.t('msg_load_mod_first'), 'warning');
    return;
  }
  if (!modFolderHandle) {
    showToast(window.i18n.t('msg_sync_need_folder'), 'warning');
    return;
  }
  if (!confirm(window.i18n.t('msg_sync_threed_assets_confirm'))) return;

  try {
    collectThreeDModelData();
    const threed = ensureThreeDData();

    // 确定搜索目录：优先使用 animation_base_dir，否则使用 asset/3d/
    const animBaseDir = threed.model.animation_base_dir || '';
    const searchParts = animBaseDir ? animBaseDir.split('/').filter(Boolean) : ['asset', '3d'];
    let dirHandle = modFolderHandle;
    for (const part of searchParts) {
      dirHandle = await dirHandle.getDirectoryHandle(part);
    }

    // 扫描 .vrma 和 .vmd 文件
    const animFiles = [];
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && (entry.name.toLowerCase().endsWith('.vrma') || entry.name.toLowerCase().endsWith('.vmd'))) {
        animFiles.push(entry.name);
      }
    }

    if (animFiles.length === 0) {
      showToast(window.i18n.t('msg_sync_threed_no_vrma_found'), 'warning');
      return;
    }

    // 生成动画列表
    // animation_base_dir 非空时 file = 纯文件名；否则 file = 搜索目录前缀 + 文件名
    const newAnimations = [];
    const namesSeen = new Set();
    const filePrefix = animBaseDir ? '' : 'asset/3d/';
    for (const fileName of animFiles) {
      const isVmd = fileName.toLowerCase().endsWith('.vmd');
      const baseName = fileName.replace(/\.(vrma|vmd)$/i, '');
      const animName = baseName.replace(/\s+/g, '_').toLowerCase();
      if (namesSeen.has(animName)) continue;
      namesSeen.add(animName);
      newAnimations.push({
        name: animName,
        type: isVmd ? 'vmd' : 'vrma',
        file: filePrefix + fileName,
        speed: 1.0,
        fps: 60
      });
    }

    threed.animations = newAnimations;

    // 重新渲染
    renderThreeDAssets();
    updateAnimaSelects();
    markUnsaved();

    const msg = window.i18n.t('msg_sync_threed_assets_success')
      .replace('{count}', String(newAnimations.length));
    showToast(msg, 'success');
  } catch (err) {
    console.error('syncThreeDAssetsFromFiles error:', err);
    if (err.name === 'NotFoundError' || err.message?.includes('not found')) {
      showToast(window.i18n.t('msg_sync_threed_dir_not_found'), 'error');
    } else {
      const msg = window.i18n.t('msg_sync_failed').replace('{error}', err.message || String(err));
      showToast(msg, 'error');
    }
  }
}

/**
 * 渲染 3D 所有子列表
 */
function renderThreeDAssets() {
  ensureThreeDData();
  populateThreeDModelForm();
  const t = currentMod.assets.threed;
  renderThreeDAnimations(t.animations || []);
}

/**
 * 获取 3D 动画名称下拉选项
 */
function getThreeDAnimationSelectOptions(selectedValue) {
  const threed = ensureThreeDData();
  const anims = threed.animations || [];
  let html = `<option value="">-- ${window.i18n.t('select_anima_placeholder')} --</option>`;
  anims.forEach(a => {
    const n = a.name || '';
    html += `<option value="${escapeHtml(n)}" ${n === selectedValue ? 'selected' : ''}>${escapeHtml(n)}</option>`;
  });
  if (selectedValue && !anims.some(a => a.name === selectedValue)) {
    html += `<option value="${escapeHtml(selectedValue)}" selected>${escapeHtml(selectedValue)}</option>`;
  }
  return html;
}

/**
 * 渲染 3D 动画列表
 */
function renderThreeDAnimations(animations) {
  const list = document.getElementById('threed-animations-list');
  if (!list) return;
  list.innerHTML = '';

  const nameRaw = (document.getElementById('threed-animations-filter-name')?.value || '').trim();
  const fileRaw = (document.getElementById('threed-animations-filter-file')?.value || '').trim();
  const nameNdl = nameRaw.toLowerCase();
  const fileNdl = fileRaw.toLowerCase();

  const existingManifestStateNames = new Set(
    getAllStateNames().map(n => String(n || '').trim()).filter(Boolean)
  );

  animations.forEach((anim, index) => {
    const aName = String(anim.name || '');
    const aFile = String(anim.file || '');
    if (nameNdl && !aName.toLowerCase().includes(nameNdl)) return;
    if (fileNdl && !aFile.toLowerCase().includes(fileNdl)) return;

    const trimmedName = aName.trim();
    const canAddState = !!trimmedName && !existingManifestStateNames.has(trimmedName);
    const addStateBtnHtml = `
      <button class="btn btn-sm btn-ghost" onclick="addSameNameStateFromThreeDAnimation(${index})" ${canAddState ? '' : 'disabled'} title="${window.i18n.t('btn_add_same_name_state')}">➕</button>
    `;

    const card = document.createElement('div');
    card.className = 'asset-card tb-sort-item';
    card.dataset.sortKey = ensureTbUid(anim);
    card.innerHTML = `
      <div class="asset-card-header">
        <div class="tb-title-with-handle">
          ${renderSortHandleHtml()}
          <span class="asset-card-name">${highlightNeedleHtml(aName, nameRaw)}</span>
        </div>
        <div class="asset-card-actions">
          ${addStateBtnHtml}
          <button class="btn btn-sm btn-ghost" onclick="copyThreeDItem('animation', ${index})" title="${window.i18n.t('btn_copy_to_clipboard')}">📋</button>
          <button class="btn btn-sm btn-ghost" onclick="editThreeDAnimation(${index})">✏️</button>
          <button class="btn btn-sm btn-ghost" onclick="deleteThreeDAnimation(${index})">🗑️</button>
        </div>
      </div>
      <div class="asset-card-body">
        <div class="asset-field"><span class="label">${window.i18n.t('threed_anim_type_label')}:</span> ${escapeHtml(anim.type || 'vrma')}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('threed_anim_file_label')}:</span> ${highlightNeedleHtml(aFile, fileRaw)}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('threed_anim_speed_label')}:</span> ${anim.speed ?? 1.0}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('threed_anim_fps_label')}:</span> ${anim.fps ?? 60}</div>
      </div>
    `;
    list.appendChild(card);
  });

  const footer = document.createElement('div');
  footer.className = 'section-footer';
  footer.innerHTML = `
    <button class="btn btn-sm btn-ghost" onclick="pasteThreeDItem('animation')">📋 <span>${window.i18n.t('btn_paste_from_clipboard')}</span></button>
    <button class="btn btn-sm btn-primary" onclick="addThreeDAnimation()">➕ <span>${window.i18n.t('btn_add_threed_animation')}</span></button>
  `;
  list.appendChild(footer);

  enableTbSortable(list, {
    canStart: () => {
      const ids = ['threed-animations-filter-name', 'threed-animations-filter-file'];
      const hasFilters = ids.some(id => (document.getElementById(id)?.value || '').trim());
      if (hasFilters) {
        showToast(window.i18n.t('msg_clear_filters_to_reorder'), 'warning');
        return false;
      }
      return true;
    },
    onSortedKeys: (orderedKeys) => {
      if (!currentMod) return;
      const threed = ensureThreeDData();
      reorderArrayInPlaceByKeys(threed.animations, orderedKeys, ensureTbUid);
      renderThreeDAssets();
      updateAnimaSelects();
      markUnsaved();
    }
  });
}

function addThreeDAnimation() {
  openThreeDAnimationModal(window.i18n.t('btn_add_threed_animation'), {
    name: '',
    type: 'vrma',
    file: '',
    speed: 1.0,
    fps: 60
  }, -1);
}

function editThreeDAnimation(index) {
  const threed = ensureThreeDData();
  const anim = threed.animations[index];
  if (!anim) return;
  openThreeDAnimationModal(window.i18n.t('threed_anim_name_label'), anim, index);
}

function deleteThreeDAnimation(index) {
  if (!confirm(window.i18n.t('msg_confirm_delete_threed_animation'))) return;
  ensureThreeDData();
  currentMod.assets.threed.animations.splice(index, 1);
  renderThreeDAssets();
  updateAnimaSelects();
  markUnsaved();
}

function openThreeDAnimationModal(title, anim, index) {
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
        <label>${window.i18n.t('threed_anim_name_label')} <span class="required">*</span></label>
        <input type="text" id="threed-edit-anim-name" value="${escapeHtml(anim.name || '')}" placeholder="${window.i18n.t('placeholder_threed_anim_name')}">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('threed_anim_type_label')}</label>
        <select id="threed-edit-anim-type">
          <option value="vrma" ${anim.type === 'vrma' ? 'selected' : ''}>VRMA</option>
          <option value="vmd" ${anim.type === 'vmd' ? 'selected' : ''}>VMD</option>
        </select>
      </div>
      <div class="form-group">
        <label>${window.i18n.t('threed_anim_file_label')} <span class="required">*</span></label>
        <input type="text" id="threed-edit-anim-file" value="${escapeHtml(anim.file || '')}" placeholder="${window.i18n.t('placeholder_threed_anim_file')}">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('threed_anim_speed_label')}</label>
        <input type="number" id="threed-edit-anim-speed" value="${anim.speed ?? 1.0}" step="0.1" min="0.1">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('threed_anim_fps_label')}</label>
        <input type="number" id="threed-edit-anim-fps" value="${anim.fps ?? 60}" min="1" max="120">
      </div>
    </div>
  `;

  modal._live2dSaveHandler = () => saveThreeDAnimation(index);
  modal.classList.add('show');
}

function saveThreeDAnimation(index) {
  const name = document.getElementById('threed-edit-anim-name').value.trim();
  if (!name) {
    showToast(window.i18n.t('msg_enter_threed_anim_name'), 'warning');
    return;
  }

  const anim = {
    name: name,
    type: document.getElementById('threed-edit-anim-type').value || 'vrma',
    file: document.getElementById('threed-edit-anim-file').value.trim(),
    speed: parseFloat(document.getElementById('threed-edit-anim-speed').value) || 1.0,
    fps: parseInt(document.getElementById('threed-edit-anim-fps').value) || 60
  };

  const threed = ensureThreeDData();
  if (index === -1) {
    threed.animations.push(anim);
  } else {
    threed.animations[index] = anim;
  }

  closeAssetModal();
  renderThreeDAssets();
  updateAnimaSelects();
  markUnsaved();
}

/**
 * 从 3D 动画创建同名 manifest 状态
 */
function addSameNameStateFromThreeDAnimation(index) {
  if (!currentMod) return;

  const threed = ensureThreeDData();
  const anim = threed.animations?.[index];
  if (!anim) return;

  const stateName = String(anim.name || '').trim();
  if (!stateName) {
    showToast(window.i18n.t('msg_enter_threed_anim_name') || '请先填写动画名称', 'warning');
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

  if (doesAnySpeechTextExistByName(stateName)) {
    state.text = stateName;
  }
  if (doesAnyAudioEntryExistByName(stateName)) {
    state.audio = stateName;
  }

  currentMod.manifest.states.push(state);

  renderStates();
  renderThreeDAssets();
  markUnsaved();
  showToast(window.i18n.t('msg_state_created_from_threed') || '已从 3D 动画创建同名状态', 'success');
}

/**
 * 复制 3D 项目到剪贴板
 */
function copyThreeDItem(type, index) {
  const threed = ensureThreeDData();
  let item;
  if (type === 'animation') {
    item = threed.animations?.[index];
  }
  if (!item) {
    showToast(window.i18n.t('msg_no_data_to_copy'), 'warning');
    return;
  }
  const data = deepClone(item);
  delete data._tb_uid;
  navigator.clipboard.writeText(JSON.stringify({ _type: `threed_${type}`, data }))
    .then(() => showToast(window.i18n.t('msg_copied_to_clipboard'), 'success'))
    .catch(() => showToast(window.i18n.t('msg_clipboard_read_failed'), 'error'));
}

/**
 * 从剪贴板粘贴 3D 项目
 */
async function pasteThreeDItem(type) {
  try {
    const text = await navigator.clipboard.readText();
    const parsed = JSON.parse(text);
    if (parsed._type !== `threed_${type}` || !parsed.data) {
      showToast(window.i18n.t('msg_clipboard_empty'), 'warning');
      return;
    }
    const threed = ensureThreeDData();
    const newItem = deepClone(parsed.data);
    delete newItem._tb_uid;
    if (type === 'animation') {
      threed.animations.push(newItem);
    }
    renderThreeDAssets();
    updateAnimaSelects();
    markUnsaved();
    showToast(window.i18n.t('msg_pasted_from_clipboard'), 'success');
  } catch (e) {
    showToast(window.i18n.t('msg_clipboard_empty'), 'warning');
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
      <button class="btn btn-sm btn-ghost" onclick="addSameNameStateFromLive2dState(${index})" ${canAddState ? '' : 'disabled'} title="${window.i18n.t('btn_add_same_name_state')}">➕</button>
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

// --- 多事件标签输入器 (Event Tags Input) ---

/**
 * 在指定容器中渲染一个多事件标签输入器。
 * 用户可输入事件名后按 Enter 或点击 + 添加，可点击 × 删除。
 * @param {string} containerId 容器 DOM id
 * @param {string[]} initialEvents 初始事件列表
 * @param {string} placeholder 输入框占位文本
 */
function initEventsTagInput(containerId, initialEvents, placeholder) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container._events = [...(initialEvents || [])];

  function render() {
    const events = container._events;
    container.innerHTML = `
      <div class="events-tags-wrap">
        ${events.map((ev, i) => `
          <span class="event-tag event-tag-removable">
            ${escapeHtml(ev)}
            <button type="button" class="event-tag-remove" data-idx="${i}" title="${window.i18n.t('btn_delete')}">&times;</button>
          </span>
        `).join('')}
        <div class="events-tag-input-row">
          <input type="text" class="events-tag-input" placeholder="${escapeHtml(placeholder)}" />
          <button type="button" class="btn btn-sm btn-ghost events-tag-add" title="${window.i18n.t('btn_add_event')}">+</button>
        </div>
      </div>
    `;

    // 绑定删除
    container.querySelectorAll('.event-tag-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        container._events.splice(idx, 1);
        render();
      });
    });

    // 绑定添加
    const input = container.querySelector('.events-tag-input');
    const addBtn = container.querySelector('.events-tag-add');

    function addEvent() {
      const val = input.value.trim();
      if (!val) return;
      if (!container._events.includes(val)) {
        container._events.push(val);
      }
      input.value = '';
      render();
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addEvent();
      }
    });
    addBtn.addEventListener('click', addEvent);
  }

  render();
}

/**
 * 从容器读取当前事件列表
 * @param {string} containerId 容器 DOM id
 * @returns {string[]}
 */
function getEventsFromTagInput(containerId) {
  const container = document.getElementById(containerId);
  return container?._events || [];
}

// --- Live2D Background Layer CRUD ---

/**
 * 渲染 Live2D 背景/叠加图层列表（支持筛选、高亮、拖拽、复制）
 */
function renderLive2dBackgroundLayers(layers) {
  const list = document.getElementById('live2d-bg-layers-list');
  if (!list) return;
  list.innerHTML = '';

  const nameRaw = (document.getElementById('live2d-bg-layers-filter-name')?.value || '').trim();
  const dirRaw = (document.getElementById('live2d-bg-layers-filter-dir')?.value || '').trim();
  const nameNdl = nameRaw.toLowerCase();
  const dirNdl = dirRaw.toLowerCase();

  layers.forEach((lyr, index) => {
    const lName = String(lyr.name || '');
    const lFile = String(lyr.file || '');
    const lDir = String(lyr.dir || '');
    const lLayer = String(lyr.layer || 'behind');
    const lEvents = Array.isArray(lyr.events) ? lyr.events : [];
    const lAudio = String(lyr.audio || '');
    const lScale = lyr.scale ?? 1;
    const lOffsetX = lyr.offset_x ?? 0;
    const lOffsetY = lyr.offset_y ?? 0;
    if (nameNdl && !lName.toLowerCase().includes(nameNdl)) return;
    if (dirNdl && !lDir.toLowerCase().includes(dirNdl)) return;

    const layerLabel = lLayer === 'front' ? window.i18n.t('bg_layer_front') : window.i18n.t('bg_layer_behind');
    const eventsHtml = lEvents.length
      ? lEvents.map(e => `<span class="event-tag">${escapeHtml(e)}</span>`).join(' ')
      : '-';

    const card = document.createElement('div');
    card.className = 'asset-card tb-sort-item';
    card.dataset.sortKey = ensureTbUid(lyr);
    card.innerHTML = `
      <div class="asset-card-header">
        <div class="tb-title-with-handle">
          ${renderSortHandleHtml()}
          <span class="asset-card-name">${highlightNeedleHtml(lName, nameRaw)}</span>
        </div>
        <div class="asset-card-actions">
          <button class="btn btn-sm btn-ghost" onclick="copyLive2dItem('bg_layer', ${index})" title="${window.i18n.t('btn_copy_to_clipboard')}">📋</button>
          <button class="btn btn-sm btn-ghost" onclick="editLive2dBgLayer(${index})">✏️</button>
          <button class="btn btn-sm btn-ghost" onclick="deleteLive2dBgLayer(${index})">🗑️</button>
        </div>
      </div>
      <div class="asset-card-body">
        <div class="asset-field"><span class="label">${window.i18n.t('bg_layer_file_label')}:</span> ${escapeHtml(lFile)}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('bg_layer_dir_label')}:</span> ${highlightNeedleHtml(lDir || '-', dirRaw)}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('bg_layer_layer_label')}:</span> ${escapeHtml(layerLabel)}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('bg_layer_scale_label')}:</span> ${lScale}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('bg_layer_offset_label')}:</span> ${lOffsetX}, ${lOffsetY}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('bg_layer_audio_label')}:</span> ${escapeHtml(lAudio || '-')}</div>
        <div class="asset-field"><span class="label">${window.i18n.t('bg_layer_events_label')}:</span> ${eventsHtml}</div>
      </div>
    `;
    list.appendChild(card);
  });

  const footer = document.createElement('div');
  footer.className = 'section-footer';
  footer.innerHTML = `
    <button class="btn btn-sm btn-ghost" onclick="pasteLive2dItem('bg_layer')">📋 <span>${window.i18n.t('btn_paste_from_clipboard')}</span></button>
    <button class="btn btn-sm btn-primary" onclick="addLive2dBgLayer()">➕ <span>${window.i18n.t('btn_add_bg_layer')}</span></button>
  `;
  list.appendChild(footer);

  // 拖拽排序
  enableTbSortable(list, {
    canStart: () => {
      const ids = ['live2d-bg-layers-filter-name', 'live2d-bg-layers-filter-dir'];
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
      reorderArrayInPlaceByKeys(live2d.background_layers, orderedKeys, ensureTbUid);
      renderLive2dAssets();
      markUnsaved();
    }
  });
}

function addLive2dBgLayer() {
  openLive2dBgLayerModal(window.i18n.t('btn_add_bg_layer'), {
    name: '',
    file: '',
    layer: 'behind',
    scale: 1,
    offset_x: 0,
    offset_y: 0,
    events: [],
    audio: '',
    dir: ''
  }, -1);
}

function editLive2dBgLayer(index) {
  const live2d = ensureLive2dData();
  const lyr = live2d.background_layers[index];
  if (!lyr) return;
  openLive2dBgLayerModal(window.i18n.t('bg_layer_name_label'), lyr, index);
}

function deleteLive2dBgLayer(index) {
  if (!confirm(window.i18n.t('msg_confirm_delete_bg_layer'))) return;
  const live2d = ensureLive2dData();
  live2d.background_layers.splice(index, 1);
  renderLive2dAssets();
  markUnsaved();
}

function openLive2dBgLayerModal(title, lyr, index) {
  const modal = document.getElementById('asset-modal');
  if (!modal) return;
  document.getElementById('asset-modal-title').textContent = title;

  const body = document.getElementById('asset-modal-body');
  if (!modal._originalBodyHTML) {
    modal._originalBodyHTML = body.innerHTML;
  }

  const behindSel = (lyr.layer || 'behind') === 'behind' ? 'selected' : '';
  const frontSel = (lyr.layer || 'behind') === 'front' ? 'selected' : '';

  body.innerHTML = `
    <div class="form-grid">
      <div class="form-group">
        <label>${window.i18n.t('bg_layer_name_label')} <span class="required">*</span></label>
        <input type="text" id="live2d-edit-bgl-name" value="${escapeHtml(lyr.name || '')}" placeholder="${window.i18n.t('placeholder_bg_layer_name')}">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('bg_layer_file_label')} <span class="required">*</span></label>
        <input type="text" id="live2d-edit-bgl-file" value="${escapeHtml(lyr.file || '')}" placeholder="${window.i18n.t('placeholder_bg_layer_file')}">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('bg_layer_dir_label')}</label>
        <input type="text" id="live2d-edit-bgl-dir" value="${escapeHtml(lyr.dir || '')}" placeholder="${window.i18n.t('placeholder_bg_layer_dir')}">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('bg_layer_layer_label')}</label>
        <select id="live2d-edit-bgl-layer">
          <option value="behind" ${behindSel}>${window.i18n.t('bg_layer_behind')}</option>
          <option value="front" ${frontSel}>${window.i18n.t('bg_layer_front')}</option>
        </select>
        <small>${window.i18n.t('bg_layer_layer_hint')}</small>
      </div>
      <div class="form-group">
        <label>${window.i18n.t('bg_layer_scale_label')}</label>
        <input type="number" id="live2d-edit-bgl-scale" value="${lyr.scale ?? 1}" step="0.01" min="0">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('bg_layer_offset_x_label')}</label>
        <input type="number" id="live2d-edit-bgl-offset-x" value="${lyr.offset_x ?? 0}">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('bg_layer_offset_y_label')}</label>
        <input type="number" id="live2d-edit-bgl-offset-y" value="${lyr.offset_y ?? 0}">
      </div>
      <div class="form-group">
        <label>${window.i18n.t('bg_layer_audio_label')}</label>
        <input type="text" id="live2d-edit-bgl-audio" value="${escapeHtml(lyr.audio || '')}" placeholder="${window.i18n.t('placeholder_bg_layer_audio')}">
        <small>${window.i18n.t('bg_layer_audio_hint')}</small>
      </div>
      <div class="form-group">
        <label>${window.i18n.t('bg_layer_events_label')}</label>
        <div id="live2d-edit-bgl-events-tags"></div>
        <small>${window.i18n.t('bg_layer_events_hint')}</small>
      </div>
    </div>
  `;

  const events = Array.isArray(lyr.events) ? lyr.events : (lyr.event ? [lyr.event] : []);
  initEventsTagInput('live2d-edit-bgl-events-tags', events, window.i18n.t('placeholder_event_name'));

  modal._live2dSaveHandler = () => saveLive2dBgLayer(index);
  modal.classList.add('show');
}

function saveLive2dBgLayer(index) {
  const name = document.getElementById('live2d-edit-bgl-name').value.trim();
  const file = document.getElementById('live2d-edit-bgl-file').value.trim();
  if (!name) {
    showToast(window.i18n.t('msg_enter_bg_layer_name'), 'warning');
    return;
  }
  if (!file) {
    showToast(window.i18n.t('msg_enter_bg_layer_file'), 'warning');
    return;
  }

  const lyr = {
    name,
    file,
    layer: document.getElementById('live2d-edit-bgl-layer').value || 'behind',
    scale: parseFloat(document.getElementById('live2d-edit-bgl-scale').value) || 1,
    offset_x: parseInt(document.getElementById('live2d-edit-bgl-offset-x').value) || 0,
    offset_y: parseInt(document.getElementById('live2d-edit-bgl-offset-y').value) || 0,
    events: getEventsFromTagInput('live2d-edit-bgl-events-tags'),
    audio: document.getElementById('live2d-edit-bgl-audio').value.trim(),
    dir: document.getElementById('live2d-edit-bgl-dir').value.trim(),
  };

  const live2d = ensureLive2dData();
  if (index === -1) {
    live2d.background_layers.push(lyr);
  } else {
    live2d.background_layers[index] = lyr;
  }

  closeAssetModal();
  renderLive2dAssets();
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
 * @param {'motion'|'expression'|'state'|'bg_layer'} kind
 * @param {number} index
 */
async function copyLive2dItem(kind, index) {
  if (!currentMod) return;
  const live2d = currentMod.assets?.live2d;
  if (!live2d) return;
  const map = { motion: 'motions', expression: 'expressions', state: 'states', bg_layer: 'background_layers' };
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
 * @param {'motion'|'expression'|'state'|'bg_layer'} kind
 */
async function pasteLive2dItem(kind) {
  if (!currentMod) return;
  const live2d = ensureLive2dData();
  const map = { motion: 'motions', expression: 'expressions', state: 'states', bg_layer: 'background_layers' };
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

  // 若存在同名的 3D 动画，则自动关联动画
  if (!state.anima) {
    const threedMatch = findThreeDAnimationByName(speechName);
    if (threedMatch) {
      state.anima = speechName;
    }
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
 * 根据名称查找 3D 动画
 */
function findThreeDAnimationByName(name) {
  const threed = currentMod?.assets?.threed;
  if (!threed || !Array.isArray(threed.animations)) return null;
  const target = String(name || '').trim();
  if (!target) return null;
  return threed.animations.find(a => String(a?.name || '').trim() === target) || null;
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

/* ============================================================================
   Capture Rect 可视化编辑器
   ============================================================================ */

const _crEditor = {
  pIdx: -1,
  tIdx: -1,
  img: null,         // 原始 Image 对象
  imgW: 0,           // 原始图片宽
  imgH: 0,           // 原始图片高
  scale: 1,          // canvas 缩放比 = canvas显示尺寸 / 原始图片尺寸
  // 选区（原始图片坐标）
  rect: { x: 0, y: 0, w: 0, h: 0 },
  // 交互状态
  dragging: false,
  dragType: '',      // 'create' | 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
  dragStart: { x: 0, y: 0 },
  rectStart: { x: 0, y: 0, w: 0, h: 0 },
  EDGE_HIT: 8,       // 边线命中像素阈值（canvas坐标）
};

function openCaptureRectEditor(pIdx, tIdx) {
  _crEditor.pIdx = pIdx;
  _crEditor.tIdx = tIdx;
  _crEditor.img = null;

  // 读取当前值
  const rx = document.querySelector(`.ait-rect-x[data-pidx="${pIdx}"][data-tidx="${tIdx}"]`);
  const ry = document.querySelector(`.ait-rect-y[data-pidx="${pIdx}"][data-tidx="${tIdx}"]`);
  const rw = document.querySelector(`.ait-rect-w[data-pidx="${pIdx}"][data-tidx="${tIdx}"]`);
  const rh = document.querySelector(`.ait-rect-h[data-pidx="${pIdx}"][data-tidx="${tIdx}"]`);
  _crEditor.rect = {
    x: parseInt(rx?.value, 10) || 0,
    y: parseInt(ry?.value, 10) || 0,
    w: parseInt(rw?.value, 10) || 0,
    h: parseInt(rh?.value, 10) || 0,
  };

  // 同步到输入框
  _crUpdateValInputs();

  // 清空 canvas
  const canvas = document.getElementById('capture-rect-canvas');
  canvas.width = 0;
  canvas.height = 0;
  document.getElementById('capture-rect-placeholder').style.display = '';
  document.getElementById('capture-rect-img-info').textContent = '';
  document.getElementById('capture-rect-img-input').value = '';

  // 显示弹窗
  document.getElementById('capture-rect-modal').classList.add('show');
}

function closeCaptureRectModal() {
  document.getElementById('capture-rect-modal').classList.remove('show');
  _crCleanupEvents();
}

function confirmCaptureRect() {
  const { pIdx, tIdx, rect } = _crEditor;
  const rx = document.querySelector(`.ait-rect-x[data-pidx="${pIdx}"][data-tidx="${tIdx}"]`);
  const ry = document.querySelector(`.ait-rect-y[data-pidx="${pIdx}"][data-tidx="${tIdx}"]`);
  const rw = document.querySelector(`.ait-rect-w[data-pidx="${pIdx}"][data-tidx="${tIdx}"]`);
  const rh = document.querySelector(`.ait-rect-h[data-pidx="${pIdx}"][data-tidx="${tIdx}"]`);
  if (rx) rx.value = Math.round(rect.x);
  if (ry) ry.value = Math.round(rect.y);
  if (rw) rw.value = Math.round(rect.w);
  if (rh) rh.value = Math.round(rect.h);

  // 触发 change 事件以同步数据
  [rx, ry, rw, rh].forEach(el => {
    if (el) el.dispatchEvent(new Event('change', { bubbles: true }));
  });

  closeCaptureRectModal();
}

function onCaptureRectImageLoaded(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      _crEditor.img = img;
      _crEditor.imgW = img.naturalWidth;
      _crEditor.imgH = img.naturalHeight;
      document.getElementById('capture-rect-img-info').textContent =
        `${img.naturalWidth} × ${img.naturalHeight}`;
      document.getElementById('capture-rect-placeholder').style.display = 'none';

      _crFitCanvas();
      _crBindCanvasEvents();
      _crDraw();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

/** 手动修改数值输入框 → 同步选区并重绘 */
function onCaptureRectValChanged() {
  const vx = parseInt(document.getElementById('capture-rect-val-x').value, 10) || 0;
  const vy = parseInt(document.getElementById('capture-rect-val-y').value, 10) || 0;
  const vw = parseInt(document.getElementById('capture-rect-val-w').value, 10) || 0;
  const vh = parseInt(document.getElementById('capture-rect-val-h').value, 10) || 0;
  _crEditor.rect = { x: vx, y: vy, w: vw, h: vh };
  if (_crEditor.img) _crDraw();
}

/* ---- 内部函数 ---- */

function _crUpdateValInputs() {
  const r = _crEditor.rect;
  document.getElementById('capture-rect-val-x').value = Math.round(r.x);
  document.getElementById('capture-rect-val-y').value = Math.round(r.y);
  document.getElementById('capture-rect-val-w').value = Math.round(r.w);
  document.getElementById('capture-rect-val-h').value = Math.round(r.h);
}

function _crFitCanvas() {
  const wrap = document.getElementById('capture-rect-canvas-wrap');
  const canvas = document.getElementById('capture-rect-canvas');
  const maxW = wrap.clientWidth - 2; // 减去 border
  const ratio = _crEditor.imgW / _crEditor.imgH;
  let cw = Math.min(maxW, _crEditor.imgW);
  let ch = cw / ratio;
  if (ch > 600) { ch = 600; cw = ch * ratio; }
  canvas.width = Math.round(cw);
  canvas.height = Math.round(ch);
  canvas.style.width = Math.round(cw) + 'px';
  canvas.style.height = Math.round(ch) + 'px';
  _crEditor.scale = cw / _crEditor.imgW;
}

function _crDraw() {
  const canvas = document.getElementById('capture-rect-canvas');
  const ctx = canvas.getContext('2d');
  const { img, scale, rect } = _crEditor;

  // 底图
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // 半透明遮罩（选区外部变暗）
  if (rect.w > 0 && rect.h > 0) {
    const sx = rect.x * scale;
    const sy = rect.y * scale;
    const sw = rect.w * scale;
    const sh = rect.h * scale;

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    // 上
    ctx.fillRect(0, 0, canvas.width, sy);
    // 下
    ctx.fillRect(0, sy + sh, canvas.width, canvas.height - sy - sh);
    // 左
    ctx.fillRect(0, sy, sx, sh);
    // 右
    ctx.fillRect(sx + sw, sy, canvas.width - sx - sw, sh);

    // 选区边框
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(sx, sy, sw, sh);

    // 四角手柄
    const hs = 6;
    ctx.fillStyle = '#6366f1';
    const corners = [
      [sx, sy], [sx + sw, sy],
      [sx, sy + sh], [sx + sw, sy + sh],
    ];
    for (const [cx, cy] of corners) {
      ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
    }

    // 尺寸标注
    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const label = `${Math.round(rect.x)}, ${Math.round(rect.y)}  ${Math.round(rect.w)}×${Math.round(rect.h)}`;
    const lx = sx + 4;
    const ly = sy - 4;
    // 背景
    const tm = ctx.measureText(label);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(lx - 2, ly - 14, tm.width + 4, 16);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, lx, ly);
  }
}

/** 将 canvas 上的鼠标坐标转为原始图片坐标 */
function _crCanvasToImg(ex, ey) {
  const canvas = document.getElementById('capture-rect-canvas');
  const br = canvas.getBoundingClientRect();
  const cx = ex - br.left;
  const cy = ey - br.top;
  return {
    cx, cy,
    ix: cx / _crEditor.scale,
    iy: cy / _crEditor.scale,
  };
}

/** 检测鼠标在选区边/角/内部/外部 */
function _crHitTest(cx, cy) {
  const { rect, scale, EDGE_HIT } = _crEditor;
  if (rect.w <= 0 || rect.h <= 0) return 'create';

  const sx = rect.x * scale;
  const sy = rect.y * scale;
  const sw = rect.w * scale;
  const sh = rect.h * scale;

  const nearL = Math.abs(cx - sx) <= EDGE_HIT;
  const nearR = Math.abs(cx - (sx + sw)) <= EDGE_HIT;
  const nearT = Math.abs(cy - sy) <= EDGE_HIT;
  const nearB = Math.abs(cy - (sy + sh)) <= EDGE_HIT;
  const inX = cx >= sx - EDGE_HIT && cx <= sx + sw + EDGE_HIT;
  const inY = cy >= sy - EDGE_HIT && cy <= sy + sh + EDGE_HIT;

  // 四角
  if (nearT && nearL && inX && inY) return 'nw';
  if (nearT && nearR && inX && inY) return 'ne';
  if (nearB && nearL && inX && inY) return 'sw';
  if (nearB && nearR && inX && inY) return 'se';
  // 四边
  if (nearT && inX) return 'n';
  if (nearB && inX) return 'b';
  if (nearL && inY) return 'w';
  if (nearR && inY) return 'e';
  // 内部
  if (cx >= sx && cx <= sx + sw && cy >= sy && cy <= sy + sh) return 'move';
  return 'create';
}

function _crGetCursor(type) {
  const map = {
    'n': 'ns-resize', 'b': 'ns-resize',
    'w': 'ew-resize', 'e': 'ew-resize',
    'nw': 'nwse-resize', 'se': 'nwse-resize',
    'ne': 'nesw-resize', 'sw': 'nesw-resize',
    'move': 'move',
    'create': 'crosshair',
  };
  return map[type] || 'crosshair';
}

function _crClampRect() {
  const r = _crEditor.rect;
  const { imgW, imgH } = _crEditor;
  // 确保 w/h 不为负（交换方向）
  if (r.w < 0) { r.x += r.w; r.w = -r.w; }
  if (r.h < 0) { r.y += r.h; r.h = -r.h; }
  // 限制在图片范围内
  if (r.x < 0) { r.w += r.x; r.x = 0; }
  if (r.y < 0) { r.h += r.y; r.y = 0; }
  if (r.x + r.w > imgW) r.w = imgW - r.x;
  if (r.y + r.h > imgH) r.h = imgH - r.y;
  r.w = Math.max(0, r.w);
  r.h = Math.max(0, r.h);
}

/* ---- Canvas 事件绑定 ---- */

let _crBoundHandler = null;

function _crCleanupEvents() {
  if (_crBoundHandler) {
    document.removeEventListener('mousemove', _crBoundHandler.onMouseMove);
    document.removeEventListener('mouseup', _crBoundHandler.onMouseUp);
    const canvas = document.getElementById('capture-rect-canvas');
    if (canvas) {
      canvas.removeEventListener('mousedown', _crBoundHandler.onMouseDown);
      canvas.removeEventListener('mousemove', _crBoundHandler.onCanvasMove);
    }
    _crBoundHandler = null;
  }
}

function _crBindCanvasEvents() {
  _crCleanupEvents();

  const canvas = document.getElementById('capture-rect-canvas');

  function onMouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const { cx, cy, ix, iy } = _crCanvasToImg(e.clientX, e.clientY);
    const hit = _crHitTest(cx, cy);

    _crEditor.dragging = true;
    _crEditor.dragType = hit;
    _crEditor.dragStart = { x: ix, y: iy };
    _crEditor.rectStart = { ..._crEditor.rect };

    if (hit === 'create') {
      _crEditor.rect = { x: ix, y: iy, w: 0, h: 0 };
    }
  }

  function onMouseMove(e) {
    if (!_crEditor.dragging) return;
    e.preventDefault();
    const { ix, iy } = _crCanvasToImg(e.clientX, e.clientY);
    const dx = ix - _crEditor.dragStart.x;
    const dy = iy - _crEditor.dragStart.y;
    const rs = _crEditor.rectStart;
    const r = _crEditor.rect;

    switch (_crEditor.dragType) {
      case 'create':
        r.x = _crEditor.dragStart.x;
        r.y = _crEditor.dragStart.y;
        r.w = dx;
        r.h = dy;
        break;
      case 'move':
        r.x = rs.x + dx;
        r.y = rs.y + dy;
        r.w = rs.w;
        r.h = rs.h;
        break;
      case 'n':
        r.y = rs.y + dy;
        r.h = rs.h - dy;
        break;
      case 'b':
        r.h = rs.h + dy;
        break;
      case 'w':
        r.x = rs.x + dx;
        r.w = rs.w - dx;
        break;
      case 'e':
        r.w = rs.w + dx;
        break;
      case 'nw':
        r.x = rs.x + dx;
        r.y = rs.y + dy;
        r.w = rs.w - dx;
        r.h = rs.h - dy;
        break;
      case 'ne':
        r.y = rs.y + dy;
        r.w = rs.w + dx;
        r.h = rs.h - dy;
        break;
      case 'sw':
        r.x = rs.x + dx;
        r.w = rs.w - dx;
        r.h = rs.h + dy;
        break;
      case 'se':
        r.w = rs.w + dx;
        r.h = rs.h + dy;
        break;
    }

    _crClampRect();
    _crUpdateValInputs();
    _crDraw();
  }

  function onMouseUp() {
    if (!_crEditor.dragging) return;
    _crEditor.dragging = false;
    _crClampRect();
    _crUpdateValInputs();
    _crDraw();
  }

  function onCanvasMove(e) {
    if (_crEditor.dragging) return;
    const { cx, cy } = _crCanvasToImg(e.clientX, e.clientY);
    const hit = _crHitTest(cx, cy);
    canvas.style.cursor = _crGetCursor(hit);
  }

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onCanvasMove);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  _crBoundHandler = { onMouseDown, onMouseMove, onMouseUp, onCanvasMove };
}
