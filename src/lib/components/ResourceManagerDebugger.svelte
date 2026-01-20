<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";

  interface AssetInfo {
    name: string;
    img: string;
    sequence: boolean;
    frame_time: number;
    frame_size_x: number;
    frame_size_y: number;
    frame_num_x: number;
    frame_num_y: number;
  }


  interface ActionInfo {
    anima: string;
  }

  interface ModManifest {
    id: string;
    version: string;
    author: string;
    default_audio_lang_id: string;
    default_text_lang_id: string;
    important_actions: Record<string, ActionInfo>;
    actions: Record<string, ActionInfo>;
  }


  interface ModInfo {
    path: string;
    manifest: ModManifest;
    imgs: AssetInfo[];
    sequences: AssetInfo[];
    audios: Record<string, { name: string, audio: string }[]>;
    speech: Record<string, { name: string, text: string }[]>;
    info: Record<string, { name: string, lang: string, id: string }>;
  }

  let searchPaths: string[] = $state([]);
  let mods: string[] = $state([]);
  let selectedMod = $state("");

  let statusMsg = $state("等待操作...");
  let currentModInfo = $state<ModInfo | null>(null);
  let loading = $state(false);


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
        if (mods.length > 0 && !selectedMod) {
          selectedMod = mods[0];
        }
      }

    } catch (e) {
      statusMsg = `刷新失败: ${e}`;
    }
  }


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

  async function openAssetFile(relativePath: string) {
    if (!currentModInfo) return;
    try {
      // 这里的 path 是绝对路径，直接拼接相对路径
      // 注意在 Windows 上路径分隔符的处理
      const fullPath = `${currentModInfo.path}/${relativePath}`.replace(/\//g, '\\');
      await invoke("open_path", { path: fullPath });
    } catch (e) {
      statusMsg = `打开文件失败: ${e}`;
    }
  }

  onMount(refreshMods);

</script>

<div class="debug-panel">
  <h3>ResourceManager 调试面板</h3>
  <div class="path-info">
    <strong>搜索路径:</strong>
    {#each searchPaths as path}
      <div class="path-item">{path}</div>
    {/each}
  </div>


  
  <div class="controls">
    <div class="section">
      <label for="mod-select">可选 Mod 列表:</label>
      <select id="mod-select" bind:value={selectedMod}>
        {#each mods as mod}
          <option value={mod}>{mod}</option>
        {/each}
      </select>

      <button onclick={refreshMods} disabled={loading}>刷新列表</button>
    </div>

    <div class="actions">
      <button class="primary" onclick={loadSelectedMod} disabled={loading || !selectedMod}>加载 Mod</button>
      <!-- <button class="danger" onclick={unloadMod} disabled={loading}>卸载当前 Mod</button> -->
    </div>

  </div>

  <div class="status-bar" class:error={statusMsg.includes('失败')}>
    {statusMsg}
  </div>

  {#if currentModInfo}
    <div class="info-panel">
      <div class="info-header">
        <h4>当前 Mod 详情</h4>
        <div class="path-badge" title={currentModInfo.path}>{currentModInfo.path.split(/[\\/]/).pop()}</div>
      </div>
      
      <div class="tabs">
        <details open>
          <summary>基本信息 (Manifest)</summary>
          <div class="tab-content">
            <ul>
              <li><strong>ID:</strong> {currentModInfo.manifest.id}</li>
              <li><strong>作者:</strong> {currentModInfo.manifest.author}</li>
              <li><strong>版本:</strong> {currentModInfo.manifest.version}</li>
              <li><strong>默认语音:</strong> {currentModInfo.manifest.default_audio_lang_id}</li>
              <li><strong>默认文本:</strong> {currentModInfo.manifest.default_text_lang_id}</li>
            </ul>

            <h5>核心动作 (Important Actions):</h5>
            <div class="tag-container">
              {#each Object.entries(currentModInfo.manifest.important_actions) as [name, action]}
                <span class="tag action-tag" title="动画: {action.anima}">{name}</span>
              {/each}
            </div>
            {#if Object.keys(currentModInfo.manifest.actions).length > 0}
              <h5>其他动作 (Actions):</h5>
              <div class="tag-container">
                {#each Object.entries(currentModInfo.manifest.actions) as [name, action]}
                  <span class="tag action-tag" title="动画: {action.anima}">{name}</span>
                {/each}
              </div>
            {/if}
          </div>
        </details>

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
                </div>
              </div>
            {/each}
          </div>
        </details>

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

  .danger {
    background: #e74c3c;
    color: white;
  }

  .danger:hover:not(:disabled) {
    background: #c0392b;
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

  .action-tag { background: #d5f5e3; border-color: #2ecc71; }
  .audio-tag { background: #d6eaf8; border-color: #3498db; }

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
  }
</style>
