<!--
========================================================================= 
资源管理调试组件 (ResourceManagerDebugger.svelte)
=========================================================================

功能概述:
- 展示和管理 Mod 资源系统
- 列出可用的 Mod 并支持加载/卸载
- 详细展示当前加载 Mod 的所有资源:
  - Manifest 配置信息
  - 角色信息 (多语言)
  - 静态图片资源
  - 序列动画资源
  - 语音资源
  - 对话文本资源

数据流:
- get_mod_search_paths: 获取 Mod 搜索路径
- get_available_mods: 获取可用 Mod 列表
- get_current_mod: 获取当前已加载的 Mod
- load_mod: 加载指定 Mod
- unload_mod: 卸载当前 Mod
=========================================================================
-->

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";

  // ======================================================================= //
  // 类型定义
  // ======================================================================= //

  /**
   * 资产信息接口
   * 描述图片或序列帧动画资源
   */
  interface AssetInfo {
    /** 资产名称 (唯一标识) */
    name: string;
    /** 图片文件路径 */
    img: string;
    /** 是否为序列帧动画 */
    sequence: boolean;
    /** 是否需要反向播放 */
    need_reverse: boolean;
    /** 每帧时间 (秒) */
    frame_time: number;
    /** 单帧宽度 (像素) */
    frame_size_x: number;
    /** 单帧高度 (像素) */
    frame_size_y: number;
    /** 水平方向帧数 */
    frame_num_x: number;
    /** 垂直方向帧数 */
    frame_num_y: number;
    /** X 轴渲染偏移 */
    offset_x: number;
    /** Y 轴渲染偏移 */
    offset_y: number;
  }

  /**
   * 状态信息接口
   */
  interface StateInfo {
    /** 状态名称 */
    name: string;
    /** 是否为持久状态 */
    persistent: boolean;
    /** 动画资源名 */
    anima: string;
    /** 音频资源名 */
    audio: string;
    /** 文本资源名 */
    text: string;
    /** 优先级 */
    priority: number;
    /** 日期范围开始 */
    date_start: string;
    /** 日期范围结束 */
    date_end: string;
    /** 时间范围开始 */
    time_start: string;
    /** 时间范围结束 */
    time_end: string;
    /** 后续状态名 */
    next_state: string;
    /** 可触发的状态列表 */
    can_trigger_states: string[];
    /** 定时触发间隔 */
    trigger_time: number;
    /** 定时触发概率 */
    trigger_rate: number;
  }

  /**
   * 触发器信息接口
   */
  interface TriggerInfo {
    /** 触发事件名 */
    event: string;
    /** 可触发的状态列表 */
    can_trigger_states: string[];
  }

  /**
   * 角色配置接口
   */
  interface CharacterConfig {
    /** Z 轴偏移 (层级) */
    z_offset: number;
  }

  /**
   * 边框配置接口
   */
  interface BorderConfig {
    /** 边框动画资源名 */
    anima: string;
    /** 是否启用边框 */
    enable: boolean;
    /** Z 轴偏移 (层级) */
    z_offset: number;
  }

  /**
   * Mod 清单接口
   * 对应 manifest.json 的完整结构
   */
  interface ModManifest {
    /** Mod 唯一标识 */
    id: string;
    /** Mod 版本 */
    version: string;
    /** Mod 作者 */
    author: string;
    /** 默认音频语言 */
    default_audio_lang_id: string;
    /** 默认文本语言 */
    default_text_lang_id: string;
    /** 角色配置 */
    character: CharacterConfig;
    /** 边框配置 */
    border: BorderConfig;
    /** 核心状态映射 (如 idle, morning 等) */
    important_states: Record<string, StateInfo>;
    /** 其他状态列表 */
    states: StateInfo[];
    /** 触发器列表 */
    triggers: TriggerInfo[];
  }

  /**
   * Mod 完整信息接口
   * 包含 Mod 的所有资源数据
   */
  interface ModInfo {
    /** Mod 绝对路径 */
    path: string;
    /** Mod 清单 */
    manifest: ModManifest;
    /** 静态图片列表 */
    imgs: AssetInfo[];
    /** 序列动画列表 */
    sequences: AssetInfo[];
    /** 音频资源 (按语言分组) */
    audios: Record<string, { name: string, audio: string }[]>;
    /** 对话文本 (按语言分组) */
    speech: Record<string, { name: string, text: string }[]>;
    /** 角色信息 (按语言分组) */
    info: Record<string, { name: string, lang: string, id: string }>;
  }

  // ======================================================================= //
  // 响应式状态
  // ======================================================================= //

  /** Mod 搜索路径列表 */
  let searchPaths: string[] = $state([]);
  
  /** 可用的 Mod 名称列表 */
  let mods: string[] = $state([]);
  
  /** 当前选中的 Mod 名称 */
  let selectedMod = $state("");

  /** 状态消息 */
  let statusMsg = $state("等待操作...");
  
  /** 当前已加载的 Mod 详细信息 */
  let currentModInfo = $state<ModInfo | null>(null);
  
  /** 加载操作进行中标记 */
  let loading = $state(false);

  // ======================================================================= //
  // 数据操作函数
  // ======================================================================= //

  /**
   * 刷新 Mod 列表
   * 获取搜索路径、可用 Mod 和当前加载的 Mod
   */
  async function refreshMods() {
    try {
      searchPaths = await invoke("get_mod_search_paths");
      mods = await invoke("get_available_mods");
      
      // 检查当前是否已经加载了 mod
      const info = await invoke("get_current_mod") as ModInfo | null;
      if (info) {
        currentModInfo = info;
        selectedMod = info.path.split(/[\\/]/).pop() || "";
        statusMsg = `当前已加载: ${info.manifest.id}`;
      } else {
        statusMsg = `已刷新 Mod 列表，共 ${mods.length} 个`;
        // 默认选中第一个 Mod
        if (mods.length > 0 && !selectedMod) {
          selectedMod = mods[0];
        }
      }

    } catch (e) {
      statusMsg = `刷新失败: ${e}`;
    }
  }

  /**
   * 加载选中的 Mod
   */
  async function loadSelectedMod() {
    if (!selectedMod) {
      statusMsg = "请先选择一个 Mod";
      return;
    }
    loading = true;
    statusMsg = `正在加载 ${selectedMod}...`;
    try {
      const info = await invoke("load_mod", { modName: selectedMod }) as ModInfo;
      currentModInfo = info;
      statusMsg = `加载成功: ${info.manifest.id} (v${info.manifest.version})`;
    } catch (e) {
      statusMsg = `加载失败: ${e}`;
      currentModInfo = null;
    } finally {
      loading = false;
    }
  }

  /**
   * 卸载当前 Mod (预留功能)
   */
  async function unloadMod() {
    try {
      const success = await invoke("unload_mod");
      if (success) {
        statusMsg = "Mod 已卸载";
        currentModInfo = null;
      } else {
        statusMsg = "当前没有加载的 Mod";
      }
    } catch (e) {
      statusMsg = `卸载失败: ${e}`;
    }
  }

  /**
   * 在系统文件管理器中打开资源文件
   * @param relativePath 相对于 Mod 根目录的路径
   */
  async function openAssetFile(relativePath: string) {
    if (!currentModInfo) return;
    try {
      // 构建完整路径并处理 Windows 路径分隔符
      const fullPath = `${currentModInfo.path}/${relativePath}`.replace(/\//g, '\\');
      await invoke("open_path", { path: fullPath });
    } catch (e) {
      statusMsg = `打开文件失败: ${e}`;
    }
  }

  // ======================================================================= //
  // 生命周期
  // ======================================================================= //

  onMount(refreshMods);

</script>

<!-- ======================================================================= -->
<!-- 组件模板 -->
<!-- ======================================================================= -->

<div class="debug-panel">
  <h3>ResourceManager 调试面板</h3>
  
  <!-- ================================================================= -->
  <!-- 搜索路径信息 -->
  <!-- ================================================================= -->
  
  <div class="path-info">
    <strong>搜索路径:</strong>
    {#each searchPaths as path}
      <div class="path-item">{path}</div>
    {/each}
  </div>


  <!-- ================================================================= -->
  <!-- Mod 选择和操作控制区 -->
  <!-- ================================================================= -->
  
  <div class="controls">
    <!-- Mod 选择下拉框 -->
    <div class="section">
      <label for="mod-select">可选 Mod 列表:</label>
      <select id="mod-select" bind:value={selectedMod}>
        {#each mods as mod}
          <option value={mod}>{mod}</option>
        {/each}
      </select>

      <button onclick={refreshMods} disabled={loading}>刷新列表</button>
    </div>

    <!-- 操作按钮 -->
    <div class="actions">
      <button class="primary" onclick={loadSelectedMod} disabled={loading || !selectedMod}>加载 Mod</button>
      <!-- <button class="danger" onclick={unloadMod} disabled={loading}>卸载当前 Mod</button> -->
    </div>

  </div>

  <!-- 状态消息栏 -->
  <div class="status-bar" class:error={statusMsg.includes('失败')}>
    {statusMsg}
  </div>

  <!-- ================================================================= -->
  <!-- Mod 详情面板 (仅在 Mod 加载后显示) -->
  <!-- ================================================================= -->
  
  {#if currentModInfo}
    <div class="info-panel">
      <!-- 面板头部 -->
      <div class="info-header">
        <h4>当前 Mod 详情</h4>
        <div class="path-badge" title={currentModInfo.path}>{currentModInfo.path.split(/[\\/]/).pop()}</div>
      </div>
      
      <!-- 可折叠的资源详情区域 -->
      <div class="tabs">
        
        <!-- ============================================================= -->
        <!-- 基本信息 (Manifest) -->
        <!-- ============================================================= -->
        
        <details open>
          <summary>基本信息 (Manifest)</summary>
          <div class="tab-content">
            <!-- Mod 元信息 -->
            <ul>
              <li><strong>ID:</strong> {currentModInfo.manifest.id}</li>
              <li><strong>作者:</strong> {currentModInfo.manifest.author}</li>
              <li><strong>版本:</strong> {currentModInfo.manifest.version}</li>
              <li><strong>默认语音:</strong> {currentModInfo.manifest.default_audio_lang_id}</li>
              <li><strong>默认文本:</strong> {currentModInfo.manifest.default_text_lang_id}</li>
              <li><strong>角色 z_offset:</strong> {currentModInfo.manifest.character.z_offset}</li>
              <li><strong>边框动画:</strong> {currentModInfo.manifest.border.anima || '(未设置)'}</li>
              <li><strong>边框启用:</strong> {currentModInfo.manifest.border.enable ? '是' : '否'}</li>
              <li><strong>边框 z_offset:</strong> {currentModInfo.manifest.border.z_offset}</li>
            </ul>

            <!-- 核心状态列表 -->
            <h5>核心状态 (Important States):</h5>
            <div class="state-list">
              {#each Object.entries(currentModInfo.manifest.important_states) as [name, state]}
                <div class="state-card" class:persistent={state.persistent}>
                  <div class="state-header">
                    <span class="state-name">{name}</span>
                    {#if state.persistent}
                      <span class="badge persistent">持久</span>
                    {/if}
                  </div>
                  <div class="state-detail">
                    {#if state.anima}<span>动画: {state.anima}</span>{/if}
                    {#if state.audio}<span>音频: {state.audio}</span>{/if}
                    {#if state.next_state}<span>后续: {state.next_state}</span>{/if}
                    {#if state.priority > 0}<span>优先级: {state.priority}</span>{/if}
                  </div>
                </div>
              {/each}
            </div>
            
            <!-- 其他状态列表 -->
            {#if currentModInfo.manifest.states.length > 0}
              <h5>其他状态 (States):</h5>
              <div class="state-list">
                {#each currentModInfo.manifest.states as state}
                  <div class="state-card" class:persistent={state.persistent}>
                    <div class="state-header">
                      <span class="state-name">{state.name}</span>
                      {#if state.persistent}
                        <span class="badge persistent">持久</span>
                      {/if}
                    </div>
                    <div class="state-detail">
                      {#if state.anima}<span>动画: {state.anima}</span>{/if}
                      {#if state.audio}<span>音频: {state.audio}</span>{/if}
                      {#if state.next_state}<span>后续: {state.next_state}</span>{/if}
                      {#if state.priority > 0}<span>优先级: {state.priority}</span>{/if}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
            
            <!-- 触发器列表 -->
            {#if currentModInfo.manifest.triggers.length > 0}
              <h5>触发器 (Triggers):</h5>
              <div class="trigger-list">
                {#each currentModInfo.manifest.triggers as trigger}
                  <div class="trigger-card">
                    <span class="trigger-event">{trigger.event}</span>
                    {#if trigger.can_trigger_states.length > 0}
                      <div class="trigger-states">
                        {#each trigger.can_trigger_states as state}
                          <span class="tag state-tag">{state}</span>
                        {/each}
                      </div>
                    {:else}
                      <span class="no-states">(无可触发状态)</span>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </details>

        <!-- ============================================================= -->
        <!-- 角色信息 (多语言) -->
        <!-- ============================================================= -->
        
        <details>
          <summary>角色信息 ({Object.keys(currentModInfo.info).length})</summary>
          <div class="tab-content">
            {#each Object.entries(currentModInfo.info) as [lang, info]}
              <div class="lang-item">
                <span class="lang-code">{lang}</span>
                <span class="char-name">{info.name} ({info.lang})</span>
              </div>
            {/each}
          </div>
        </details>

        <!-- ============================================================= -->
        <!-- 静态图片资源 -->
        <!-- ============================================================= -->
        
        <details>
          <summary>静态图片 ({currentModInfo.imgs.length})</summary>
          <div class="tab-content grid">
            {#each currentModInfo.imgs as img}
              <div class="asset-card">
                <button class="link-btn asset-name" onclick={() => openAssetFile(`assets/${img.img}`)} title="打开文件">
                  {img.name}
                </button>
                <div class="asset-file">{img.img}</div>
                <div class="asset-dim">{img.frame_size_x}x{img.frame_size_y}</div>
              </div>
            {/each}
          </div>
        </details>

        <!-- ============================================================= -->
        <!-- 序列动画资源 -->
        <!-- ============================================================= -->
        
        <details>
          <summary>序列动画 ({currentModInfo.sequences.length})</summary>
          <div class="tab-content grid">
            {#each currentModInfo.sequences as seq}
              <div class="asset-card sequence">
                <button class="link-btn asset-name" onclick={() => openAssetFile(`assets/${seq.img}`)} title="打开文件">
                  {seq.name}
                </button>
                <div class="asset-file">{seq.img}</div>
                <div class="asset-meta">
                  <span>{seq.frame_num_x}x{seq.frame_num_y} 帧</span>
                  <span>{seq.frame_time}s</span>
                  {#if seq.need_reverse}
                    <span class="badge reverse">反向</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </details>

        <!-- ============================================================= -->
        <!-- 语音资源 (按语言分组) -->
        <!-- ============================================================= -->
        
        <details>
          <summary>语音资源 ({Object.values(currentModInfo.audios).flat().length})</summary>
          <div class="tab-content">
            {#each Object.entries(currentModInfo.audios) as [lang, audios]}
              <div class="lang-section">
                <h6>{lang}</h6>
                <div class="tag-container">
                  {#each audios as audio}
                    <button class="tag audio-tag link-btn" onclick={() => openAssetFile(`audio/${lang}/${audio.audio}`)} title="打开文件">
                      {audio.name}
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </details>

        <!-- ============================================================= -->
        <!-- 对话文本 (按语言分组) -->
        <!-- ============================================================= -->
        
        <details>
          <summary>对话文本 ({Object.values(currentModInfo.speech).flat().length})</summary>
          <div class="tab-content">
            {#each Object.entries(currentModInfo.speech) as [lang, texts]}
              <div class="lang-section">
                <h6>{lang}</h6>
                <div class="text-list">
                  {#each texts as text}
                    <div class="text-item">
                      <span class="text-name">{text.name}:</span>
                      <span class="text-body">{text.text}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </details>
      </div>
    </div>
  {/if}
</div>

<style>
  .debug-panel {
    background: #ffffff;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
    width: 600px;
    margin: 20px auto;
    color: #333;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  }

  h3 {
    margin-top: 0;
    color: #2c3e50;
    border-bottom: 2px solid #eee;
    padding-bottom: 10px;
    margin-bottom: 5px;
  }

  .path-info {
    font-size: 0.75em;
    color: #666;
    background: #f0f0f0;
    padding: 8px;
    border-radius: 4px;
    margin-bottom: 15px;
  }

  .path-item {
    word-break: break-all;
    margin-top: 4px;
    padding: 2px 4px;
    background: rgba(0,0,0,0.05);
    border-radius: 2px;
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 15px;
    margin: 15px 0;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  select {
    padding: 8px;
    border-radius: 6px;
    border: 1px solid #ddd;
    background: #f9f9f9;
  }

  .actions {
    display: flex;
    gap: 10px;
  }

  button {
    flex: 1;
    padding: 10px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    font-weight: 600;
    transition: all 0.2s;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .primary {
    background: #3498db;
    color: white;
  }

  .primary:hover:not(:disabled) {
    background: #2980b9;
  }

  .status-bar {
    background: #f1f2f6;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 0.9em;
    margin-top: 10px;
    border-left: 4px solid #3498db;
  }

  .status-bar.error {
    border-left-color: #e74c3c;
    color: #c0392b;
  }

  .info-panel {
    margin-top: 20px;
    padding: 15px;
    background: #f8f9fa;
    border-radius: 8px;
    font-size: 0.85em;
    max-height: 600px;
    overflow-y: auto;
  }

  .info-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #ddd;
    margin-bottom: 10px;
    padding-bottom: 5px;
  }

  .path-badge {
    font-size: 0.7em;
    background: #e0e0e0;
    padding: 2px 8px;
    border-radius: 10px;
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  h4, h5, h6 {
    margin: 10px 0 5px 0;
    color: #2c3e50;
  }

  details {
    margin-bottom: 10px;
    border: 1px solid #eee;
    border-radius: 4px;
    background: white;
  }

  summary {
    padding: 8px;
    cursor: pointer;
    font-weight: bold;
    background: #f1f1f1;
    border-radius: 4px;
  }

  details[open] summary {
    border-bottom: 1px solid #eee;
    border-radius: 4px 4px 0 0;
  }

  .tab-content {
    padding: 10px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 8px;
  }

  .asset-card {
    background: #f9f9f9;
    border: 1px solid #eee;
    padding: 6px;
    border-radius: 4px;
    font-size: 0.8em;
  }

  .asset-name {
    font-weight: bold;
    color: #2980b9;
    word-break: break-all;
  }

  .link-btn {
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    font-size: inherit;
    display: inline-block;
    transition: all 0.2s;
  }

  button.link-btn:not(.tag) {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
  }

  .link-btn:not(.tag):hover {
    color: #3498db;
    text-decoration: underline;
  }


  .tag.link-btn:hover {
    opacity: 0.8;
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }



  .asset-file {
    color: #7f8c8d;
    font-size: 0.9em;
  }

  .asset-dim, .asset-meta {
    margin-top: 4px;
    color: #95a5a6;
    font-size: 0.85em;
  }

  .sequence {
    border-left: 3px solid #f1c40f;
  }

  .badge {
    display: inline-block;
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 0.75em;
    font-weight: bold;
  }

  .badge.reverse {
    background: #e74c3c;
    color: white;
  }

  .tag-container {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin: 5px 0;
  }

  .tag {
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.8em;
    background: #ecf0f1;
    border: 1px solid #bdc3c7;
  }

  .audio-tag { background: #d6eaf8; border-color: #3498db; }

  .state-list, .trigger-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 8px 0;
  }

  .state-card {
    background: #f9f9f9;
    border: 1px solid #eee;
    border-left: 3px solid #95a5a6;
    padding: 8px;
    border-radius: 4px;
  }

  .state-card.persistent {
    border-left-color: #27ae60;
  }

  .state-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .state-name {
    font-weight: bold;
    color: #2c3e50;
  }

  .state-detail {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 0.85em;
    color: #7f8c8d;
  }

  .badge.persistent {
    background: #27ae60;
    color: white;
  }

  .trigger-card {
    background: #f9f9f9;
    border: 1px solid #eee;
    border-left: 3px solid #9b59b6;
    padding: 8px;
    border-radius: 4px;
  }

  .trigger-event {
    font-weight: bold;
    color: #8e44ad;
    display: block;
    margin-bottom: 4px;
  }

  .trigger-states {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .no-states {
    font-size: 0.85em;
    color: #95a5a6;
    font-style: italic;
  }

  .lang-item {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 5px;
  }

  .lang-code {
    background: #34495e;
    color: white;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 0.8em;
  }

  .lang-section {
    margin-bottom: 15px;
    border-left: 2px solid #3498db;
    padding-left: 10px;
  }

  .text-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .text-item {
    display: flex;
    gap: 5px;
  }

  .text-name { font-weight: bold; color: #7f8c8d; min-width: 60px; }
  .text-body { color: #2c3e50; }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  li {
    margin-bottom: 4px;
  }

  @media (prefers-color-scheme: dark) {
    .debug-panel {
      background: #2c3e50;
      color: #ecf0f1;
    }
    h3, h4, h5, h6 { color: #ecf0f1; }
    h3 { border-bottom-color: #34495e; }
    
    select {
      background: #34495e;
      color: white;
      border-color: #455a64;
    }
    
    .status-bar { background: #34495e; }
    .info-panel { background: #34495e; }
    
    details { background: #2c3e50; border-color: #34495e; }
    summary { background: #3e5871; color: #ecf0f1; }
    .asset-card { background: #3e5871; border-color: #455a64; }
    .asset-name { color: #3498db; }
    .text-body { color: #bdc3c7; }
    .path-badge { background: #455a64; color: #bdc3c7; }
    .tag { background: #455a64; border-color: #546e7a; color: #ecf0f1; }
    
    .state-card, .trigger-card { background: #3e5871; border-color: #455a64; }
    .state-name { color: #ecf0f1; }
    .trigger-event { color: #bb8fce; }
  }
</style>
