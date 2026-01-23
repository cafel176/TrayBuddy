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
let currentAudioLang = 'jp';

/** 当前编辑的状态索引 (-1 表示 idle，>= 0 表示 states 数组索引) */
let editingStateIndex = -2;

/** 当前编辑的资源类型 ('sequence' 或 'img') */
let editingAssetType = null;

/** 当前编辑的资源索引 */
let editingAssetIndex = -1;

/** 是否有未保存的更改 */
let hasUnsavedChanges = false;

// ============================================================================
// 初始化
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initPreviewUpload();
});

/**
 * 初始化导航
 */
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      if (!currentMod) {
        showToast('请先加载或创建一个 Mod', 'warning');
        return;
      }
      
      const tab = item.dataset.tab;
      switchTab(tab);
      
      // 更新导航状态
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
    });
  });
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
          markUnsaved();
        }
      };
      reader.readAsDataURL(file);
    }
  });
}

/**
 * 切换标签页
 */
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  const targetTab = document.getElementById(`tab-${tab}`);
  if (targetTab) {
    targetTab.classList.add('active');
  }
}

// ============================================================================
// Mod 加载/创建/保存
// ============================================================================

/**
 * 加载 Mod 文件夹
 */
async function loadModFolder() {
  try {
    // 使用 File System Access API
    if (!('showDirectoryPicker' in window)) {
      showToast('您的浏览器不支持文件夹访问，请使用 Chrome/Edge', 'error');
      return;
    }
    
    modFolderHandle = await window.showDirectoryPicker({
      mode: 'readwrite'
    });
    
    showToast('正在加载 Mod...', 'info');
    
    // 读取 manifest.json
    const manifestHandle = await modFolderHandle.getFileHandle('manifest.json');
    const manifestFile = await manifestHandle.getFile();
    const manifestText = await manifestFile.text();
    const manifest = JSON.parse(manifestText);
    
    // 初始化 Mod 数据结构
    currentMod = {
      manifest: manifest,
      assets: {
        sequence: [],
        img: []
      },
      texts: {},
      audio: {},
      previewData: null
    };
    
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
    
    // 读取 text 目录
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
          } catch (e) {}
        }
      }
    } catch (e) {
      console.log('No text directory found');
    }
    
    // 读取 audio 目录
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
          } catch (e) {}
        }
      }
    } catch (e) {
      console.log('No audio directory found');
    }
    
    // 读取预览图
    try {
      const previewHandle = await modFolderHandle.getFileHandle('preview.png');
      const previewFile = await previewHandle.getFile();
      const reader = new FileReader();
      reader.onload = (e) => {
        currentMod.previewData = e.target.result;
        document.getElementById('preview-image').innerHTML = `<img src="${e.target.result}" alt="Preview">`;
      };
      reader.readAsDataURL(previewFile);
    } catch (e) {
      console.log('No preview.png found');
    }
    
    // 更新 UI
    document.getElementById('currentModName').textContent = manifest.id;
    document.getElementById('saveBtn').disabled = false;
    document.getElementById('exportBtn').disabled = false;
    
    // 填充表单
    populateManifestForm();
    renderStates();
    renderTriggers();
    renderAssets();
    renderTexts();
    renderAudio();
    
    // 切换到基本信息页
    switchTab('manifest');
    document.querySelector('.nav-item[data-tab="manifest"]').classList.add('active');
    document.querySelector('.nav-item.active:not([data-tab="manifest"])')?.classList.remove('active');
    document.getElementById('tab-empty').classList.remove('active');
    
    showToast(`成功加载 Mod: ${manifest.id}`, 'success');
    
  } catch (e) {
    console.error('Failed to load mod:', e);
    if (e.name !== 'AbortError') {
      showToast('加载失败: ' + e.message, 'error');
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
    showToast('请输入 Mod ID', 'warning');
    return;
  }
  
  if (!/^[a-zA-Z0-9_]+$/.test(modId)) {
    showToast('Mod ID 只能包含英文、数字和下划线', 'warning');
    return;
  }
  
  // 创建默认 Mod 结构
  currentMod = {
    manifest: {
      id: modId,
      version: '1.0.0',
      author: modAuthor || 'Unknown',
      default_audio_lang_id: 'jp',
      default_text_lang_id: 'zh',
      character: {
        z_offset: 1
      },
      border: {
        anima: '',
        enable: false,
        z_offset: 2
      },
      important_states: {
        idle: createDefaultState('idle', true)
      },
      states: [],
      triggers: [
        { event: 'click', can_trigger_states: [] },
        { event: 'login', can_trigger_states: [] }
      ]
    },
    assets: {
      sequence: [],
      img: []
    },
    texts: {
      zh: {
        info: {
          id: 'zh',
          lang: '简体中文',
          name: modName || modId,
          description: ''
        },
        speech: []
      }
    },
    audio: {
      jp: []
    },
    previewData: null
  };
  
  modFolderHandle = null; // 新建 Mod 暂无文件夹句柄
  
  // 更新 UI
  document.getElementById('currentModName').textContent = modId + ' (新建)';
  document.getElementById('saveBtn').disabled = false;
  document.getElementById('exportBtn').disabled = false;
  
  // 填充表单
  populateManifestForm();
  renderStates();
  renderTriggers();
  renderAssets();
  renderTexts();
  renderAudio();
  
  // 切换到基本信息页
  switchTab('manifest');
  document.querySelector('.nav-item[data-tab="manifest"]').classList.add('active');
  document.getElementById('tab-empty').classList.remove('active');
  
  closeNewModModal();
  showToast(`已创建新 Mod: ${modId}`, 'success');
  markUnsaved();
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
  
  if (!modFolderHandle) {
    // 新建的 Mod，需要选择保存位置
    try {
      modFolderHandle = await window.showDirectoryPicker({
        mode: 'readwrite'
      });
    } catch (e) {
      if (e.name !== 'AbortError') {
        showToast('保存失败: ' + e.message, 'error');
      }
      return;
    }
  }
  
  try {
    showToast('正在保存...', 'info');
    
    // 保存 manifest.json
    const manifestHandle = await modFolderHandle.getFileHandle('manifest.json', { create: true });
    const manifestWritable = await manifestHandle.createWritable();
    await manifestWritable.write(JSON.stringify(currentMod.manifest, null, 2));
    await manifestWritable.close();
    
    // 创建 asset 目录并保存
    const assetDir = await modFolderHandle.getDirectoryHandle('asset', { create: true });
    
    // 保存 sequence.json
    const seqHandle = await assetDir.getFileHandle('sequence.json', { create: true });
    const seqWritable = await seqHandle.createWritable();
    await seqWritable.write(JSON.stringify(currentMod.assets.sequence, null, 2));
    await seqWritable.close();
    
    // 保存 img.json
    const imgHandle = await assetDir.getFileHandle('img.json', { create: true });
    const imgWritable = await imgHandle.createWritable();
    await imgWritable.write(JSON.stringify(currentMod.assets.img, null, 2));
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
        await infoWritable.write(JSON.stringify(data.info, null, 2));
        await infoWritable.close();
      }
      
      const speechHandle = await langDir.getFileHandle('speech.json', { create: true });
      const speechWritable = await speechHandle.createWritable();
      await speechWritable.write(JSON.stringify(data.speech, null, 2));
      await speechWritable.close();
    }
    
    // 保存 audio 目录
    const audioDir = await modFolderHandle.getDirectoryHandle('audio', { create: true });
    for (const [lang, data] of Object.entries(currentMod.audio)) {
      const langDir = await audioDir.getDirectoryHandle(lang, { create: true });
      await langDir.getDirectoryHandle('speech', { create: true });
      
      const speechHandle = await langDir.getFileHandle('speech.json', { create: true });
      const speechWritable = await speechHandle.createWritable();
      await speechWritable.write(JSON.stringify(data, null, 2));
      await speechWritable.close();
    }
    
    // 保存预览图
    if (currentMod.previewData) {
      const previewHandle = await modFolderHandle.getFileHandle('preview.png', { create: true });
      const previewWritable = await previewHandle.createWritable();
      const response = await fetch(currentMod.previewData);
      const blob = await response.blob();
      await previewWritable.write(blob);
      await previewWritable.close();
    }
    
    hasUnsavedChanges = false;
    document.getElementById('currentModName').textContent = currentMod.manifest.id;
    showToast('保存成功！', 'success');
    
  } catch (e) {
    console.error('Failed to save mod:', e);
    showToast('保存失败: ' + e.message, 'error');
  }
}

/**
 * 导出 Mod (生成 ZIP)
 */
async function exportMod() {
  if (!currentMod) return;
  
  collectManifestData();
  
  showToast('导出功能需要额外的 ZIP 库支持，请使用保存功能', 'info');
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
  
  // 更新动画下拉列表
  updateAnimaSelects();
  document.getElementById('border-anima').value = m.border?.anima || '';
  
  // 显示预览图
  if (currentMod.previewData) {
    document.getElementById('preview-image').innerHTML = `<img src="${currentMod.previewData}" alt="Preview">`;
  } else {
    document.getElementById('preview-image').innerHTML = '<span class="preview-placeholder">点击上传预览图</span>';
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
    select.innerHTML = '<option value="">-- 选择动画 --</option>';
    allAnimas.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
    select.value = currentValue;
  });
}

// ============================================================================
// 状态管理
// ============================================================================

/**
 * 渲染状态列表
 */
function renderStates() {
  // 渲染 Idle 状态
  const idleCard = document.getElementById('idle-state-card');
  const idleState = currentMod.manifest.important_states.idle;
  idleCard.innerHTML = renderStateCard(idleState, -1);
  
  // 渲染状态列表
  const stateList = document.getElementById('state-list');
  stateList.innerHTML = '';
  
  currentMod.manifest.states.forEach((state, index) => {
    const item = document.createElement('div');
    item.className = 'state-item';
    item.innerHTML = `
      <div class="state-item-info">
        <span class="state-item-name">${state.name}</span>
        <div class="state-item-meta">
          ${state.persistent ? '<span class="state-item-tag persistent">持久</span>' : ''}
          ${state.anima ? `<span class="state-item-tag">动画: ${state.anima}</span>` : ''}
          ${state.text ? `<span class="state-item-tag">文本: ${state.text}</span>` : ''}
          ${state.branch?.length ? `<span class="state-item-tag">分支: ${state.branch.length}</span>` : ''}
        </div>
      </div>
      <div class="state-item-actions">
        <button class="btn btn-sm btn-ghost" onclick="editState(${index})">✏️ 编辑</button>
        <button class="btn btn-sm btn-ghost" onclick="deleteState(${index})">🗑️ 删除</button>
      </div>
    `;
    stateList.appendChild(item);
  });
}

/**
 * 渲染状态卡片 HTML
 */
function renderStateCard(state, index) {
  return `
    <div class="state-card-header">
      <span class="state-card-title">${state.name}</span>
      <div class="state-card-actions">
        <button class="btn btn-sm btn-ghost" onclick="editState(${index})">✏️ 编辑</button>
      </div>
    </div>
    <div class="state-card-body">
      <div class="state-card-field">
        <span class="label">动画: </span>
        <span class="value">${state.anima || '-'}</span>
      </div>
      <div class="state-card-field">
        <span class="label">持久: </span>
        <span class="value">${state.persistent ? '是' : '否'}</span>
      </div>
      <div class="state-card-field">
        <span class="label">优先级: </span>
        <span class="value">${state.priority}</span>
      </div>
      <div class="state-card-field">
        <span class="label">触发率: </span>
        <span class="value">${state.trigger_rate}</span>
      </div>
    </div>
  `;
}

/**
 * 添加新状态
 */
function addState() {
  editingStateIndex = -2; // -2 表示新建状态
  openStateModal('添加状态', createDefaultState('new_state'));
}

/**
 * 编辑状态
 */
function editState(index) {
  editingStateIndex = index;
  const state = index === -1 
    ? currentMod.manifest.important_states.idle 
    : currentMod.manifest.states[index];
  openStateModal('编辑状态', state);
}

/**
 * 打开状态编辑弹窗
 */
function openStateModal(title, state) {
  document.getElementById('state-modal-title').textContent = title;
  
  document.getElementById('state-name').value = state.name || '';
  document.getElementById('state-persistent').checked = state.persistent || false;
  document.getElementById('state-audio').value = state.audio || '';
  document.getElementById('state-text').value = state.text || '';
  document.getElementById('state-priority').value = state.priority || 2;
  document.getElementById('state-date-start').value = state.date_start || '';
  document.getElementById('state-date-end').value = state.date_end || '';
  document.getElementById('state-time-start').value = state.time_start || '';
  document.getElementById('state-time-end').value = state.time_end || '';
  document.getElementById('state-next-state').value = state.next_state || '';
  document.getElementById('state-trigger-time').value = state.trigger_time || 0;
  document.getElementById('state-trigger-rate').value = state.trigger_rate || 0;
  document.getElementById('state-can-trigger').value = (state.can_trigger_states || []).join(', ');
  
  // 更新动画下拉列表
  updateAnimaSelects();
  document.getElementById('state-anima').value = state.anima || '';
  
  // 渲染分支
  renderBranches(state.branch || []);
  
  document.getElementById('state-modal').classList.add('show');
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
    date_start: document.getElementById('state-date-start').value.trim(),
    date_end: document.getElementById('state-date-end').value.trim(),
    time_start: document.getElementById('state-time-start').value.trim(),
    time_end: document.getElementById('state-time-end').value.trim(),
    next_state: document.getElementById('state-next-state').value.trim(),
    can_trigger_states: document.getElementById('state-can-trigger').value
      .split(',')
      .map(s => s.trim())
      .filter(s => s),
    trigger_time: parseInt(document.getElementById('state-trigger-time').value) || 0,
    trigger_rate: parseFloat(document.getElementById('state-trigger-rate').value) || 0,
    branch: collectBranches()
  };
  
  if (!state.name) {
    showToast('请输入状态名称', 'warning');
    return;
  }
  
  if (editingStateIndex === -2) {
    // 新建状态
    currentMod.manifest.states.push(state);
  } else if (editingStateIndex === -1) {
    // 编辑 idle 状态
    currentMod.manifest.important_states.idle = state;
  } else {
    // 编辑普通状态
    currentMod.manifest.states[editingStateIndex] = state;
  }
  
  closeStateModal();
  renderStates();
  markUnsaved();
  showToast('状态已保存', 'success');
}

/**
 * 删除状态
 */
function deleteState(index) {
  if (confirm('确定要删除这个状态吗？')) {
    currentMod.manifest.states.splice(index, 1);
    renderStates();
    markUnsaved();
    showToast('状态已删除', 'success');
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
      <input type="text" placeholder="选项文本" value="${branch.text || ''}" data-branch-text="${index}">
      <input type="text" placeholder="跳转状态" value="${branch.next_state || ''}" data-branch-state="${index}">
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
    <input type="text" placeholder="选项文本" data-branch-text="${index}">
    <input type="text" placeholder="跳转状态" data-branch-state="${index}">
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
  const triggerList = document.getElementById('trigger-list');
  triggerList.innerHTML = '';
  
  currentMod.manifest.triggers.forEach((trigger, index) => {
    const item = document.createElement('div');
    item.className = 'trigger-item';
    item.innerHTML = `
      <div class="trigger-item-header">
        <div class="trigger-event">
          <code>${trigger.event}</code>
        </div>
        <div class="trigger-actions">
          <button class="btn btn-sm btn-ghost" onclick="editTrigger(${index})">✏️ 编辑</button>
          <button class="btn btn-sm btn-ghost" onclick="deleteTrigger(${index})">🗑️ 删除</button>
        </div>
      </div>
      <div class="trigger-states">
        ${(trigger.can_trigger_states || []).map(s => `<span class="trigger-state-tag">${s}</span>`).join('')}
        ${(trigger.can_trigger_states || []).length === 0 ? '<span class="trigger-state-tag">无触发状态</span>' : ''}
      </div>
    `;
    triggerList.appendChild(item);
  });
}

/**
 * 添加触发器
 */
function addTrigger() {
  const event = prompt('请输入事件名称 (如: click, login, music_start)');
  if (event) {
    currentMod.manifest.triggers.push({
      event: event.trim(),
      can_trigger_states: []
    });
    renderTriggers();
    markUnsaved();
    showToast('触发器已添加', 'success');
  }
}

/**
 * 编辑触发器
 */
function editTrigger(index) {
  const trigger = currentMod.manifest.triggers[index];
  const states = prompt(
    '请输入可触发的状态列表 (逗号分隔)',
    (trigger.can_trigger_states || []).join(', ')
  );
  
  if (states !== null) {
    trigger.can_trigger_states = states
      .split(',')
      .map(s => s.trim())
      .filter(s => s);
    renderTriggers();
    markUnsaved();
    showToast('触发器已更新', 'success');
  }
}

/**
 * 删除触发器
 */
function deleteTrigger(index) {
  if (confirm('确定要删除这个触发器吗？')) {
    currentMod.manifest.triggers.splice(index, 1);
    renderTriggers();
    markUnsaved();
    showToast('触发器已删除', 'success');
  }
}

// ============================================================================
// 资源管理
// ============================================================================

/**
 * 渲染资源列表
 */
function renderAssets() {
  renderAssetList('sequence', currentMod.assets.sequence);
  renderAssetList('img', currentMod.assets.img);
  updateAnimaSelects();
}

/**
 * 渲染单个资源列表
 */
function renderAssetList(type, assets) {
  const list = document.getElementById(`${type}-list`);
  list.innerHTML = '';
  
  assets.forEach((asset, index) => {
    const card = document.createElement('div');
    card.className = 'asset-card';
    card.innerHTML = `
      <div class="asset-card-header">
        <span class="asset-card-name">${asset.name}</span>
        <div class="asset-card-actions">
          <button class="btn btn-sm btn-ghost" onclick="editAsset('${type}', ${index})">✏️</button>
          <button class="btn btn-sm btn-ghost" onclick="deleteAsset('${type}', ${index})">🗑️</button>
        </div>
      </div>
      <div class="asset-card-body">
        <div class="asset-field"><span class="label">路径:</span> ${asset.img}</div>
        <div class="asset-field"><span class="label">帧:</span> ${asset.frame_num_x}×${asset.frame_num_y}</div>
        <div class="asset-field"><span class="label">尺寸:</span> ${asset.frame_size_x}×${asset.frame_size_y}</div>
        <div class="asset-field"><span class="label">帧时:</span> ${asset.frame_time}s</div>
      </div>
    `;
    list.appendChild(card);
  });
}

/**
 * 添加资源
 */
function addAsset(type) {
  editingAssetType = type;
  editingAssetIndex = -1;
  openAssetModal('添加动画资源', {
    name: '',
    img: type === 'sequence' ? 'sequence/' : 'img/',
    sequence: true,
    origin_reverse: false,
    need_reverse: true,
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
  openAssetModal('编辑动画资源', asset);
}

/**
 * 打开资源编辑弹窗
 */
function openAssetModal(title, asset) {
  document.getElementById('asset-modal-title').textContent = title;
  
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
    showToast('请输入资源名称', 'warning');
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
  showToast('资源已保存', 'success');
}

/**
 * 删除资源
 */
function deleteAsset(type, index) {
  if (confirm('确定要删除这个资源吗？')) {
    currentMod.assets[type].splice(index, 1);
    renderAssets();
    markUnsaved();
    showToast('资源已删除', 'success');
  }
}

// ============================================================================
// 文本管理
// ============================================================================

/**
 * 渲染文本管理
 */
function renderTexts() {
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
    tab.textContent = currentMod.texts[lang]?.info?.lang || lang;
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
  
  // 渲染对话文本列表
  renderSpeechTexts();
}

/**
 * 渲染对话文本列表
 */
function renderSpeechTexts() {
  const list = document.getElementById('speech-text-list');
  list.innerHTML = '';
  
  const speeches = currentMod.texts[currentTextLang]?.speech || [];
  
  speeches.forEach((speech, index) => {
    const item = document.createElement('div');
    item.className = 'speech-item';
    item.innerHTML = `
      <div class="speech-item-header">
        <input type="text" class="speech-item-name" value="${speech.name || ''}" 
          placeholder="文本名称" onchange="updateSpeechText(${index}, 'name', this.value)">
        <div class="speech-item-actions">
          <button class="btn btn-sm btn-ghost" onclick="deleteSpeechText(${index})">🗑️</button>
        </div>
      </div>
      <textarea class="speech-item-text" rows="3" placeholder="对话内容（支持 Markdown）"
        onchange="updateSpeechText(${index}, 'text', this.value)">${speech.text || ''}</textarea>
    `;
    list.appendChild(item);
  });
}

/**
 * 添加语言
 */
function addLanguage() {
  const langId = prompt('请输入语言ID (如: en, jp, zh)');
  if (langId && !currentMod.texts[langId]) {
    currentMod.texts[langId] = {
      info: { id: langId, lang: langId, name: '', description: '' },
      speech: []
    };
    currentTextLang = langId;
    renderTexts();
    markUnsaved();
    showToast('语言已添加', 'success');
  }
}

/**
 * 添加对话文本
 */
function addSpeechText() {
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
  currentMod.texts[currentTextLang].speech[index][field] = value;
  markUnsaved();
}

/**
 * 删除对话文本
 */
function deleteSpeechText(index) {
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
    tab.textContent = lang;
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
  const list = document.getElementById('audio-list');
  list.innerHTML = '';
  
  const audios = currentMod.audio[currentAudioLang] || [];
  
  audios.forEach((audio, index) => {
    const item = document.createElement('div');
    item.className = 'audio-item';
    item.innerHTML = `
      <div class="audio-item-info">
        <input type="text" class="audio-item-name" value="${audio.name || ''}" 
          placeholder="音频名称" onchange="updateAudioEntry(${index}, 'name', this.value)">
        <input type="text" class="audio-item-path" value="${audio.audio || ''}" 
          placeholder="文件路径 (如: jp/speech/morning.wav)" onchange="updateAudioEntry(${index}, 'audio', this.value)">
      </div>
      <div class="audio-item-actions">
        <button class="btn btn-sm btn-ghost" onclick="deleteAudioEntry(${index})">🗑️</button>
      </div>
    `;
    list.appendChild(item);
  });
}

/**
 * 添加音频语言
 */
function addAudioLanguage() {
  const langId = prompt('请输入语言ID (如: en, jp, zh)');
  if (langId && !currentMod.audio[langId]) {
    currentMod.audio[langId] = [];
    currentAudioLang = langId;
    renderAudio();
    markUnsaved();
    showToast('语言已添加', 'success');
  }
}

/**
 * 添加音频条目
 */
function addAudioEntry() {
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
  currentMod.audio[currentAudioLang][index][field] = value;
  markUnsaved();
}

/**
 * 删除音频条目
 */
function deleteAudioEntry(index) {
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
