<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";

  let searchPaths: string[] = $state([]);
  let mods: string[] = $state([]);
  let selectedMod = $state("");

  let statusMsg = $state("等待操作...");
  let currentModInfo = $state<any>(null);
  let loading = $state(false);

  async function refreshMods() {
    try {
      searchPaths = await invoke("get_mod_search_paths");
      mods = await invoke("get_available_mods");
      statusMsg = `已刷新 Mod 列表，共 ${mods.length} 个`;
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
      currentModInfo = await invoke("load_mod", { modName: selectedMod });
      statusMsg = `加载成功: ${currentModInfo.manifest.id} (v${currentModInfo.manifest.version})`;
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
        <option value="">-- 请选择 --</option>
        {#each mods as mod}
          <option value={mod}>{mod}</option>
        {/each}
      </select>
      <button onclick={refreshMods} disabled={loading}>刷新列表</button>
    </div>

    <div class="actions">
      <button class="primary" onclick={loadSelectedMod} disabled={loading || !selectedMod}>加载 Mod</button>
      <button class="danger" onclick={unloadMod} disabled={loading}>卸载当前 Mod</button>
    </div>
  </div>

  <div class="status-bar" class:error={statusMsg.includes('失败')}>
    {statusMsg}
  </div>

  {#if currentModInfo}
    <div class="info-panel">
      <h4>当前 Mod 详情:</h4>
      <ul>
        <li><strong>ID:</strong> {currentModInfo.manifest.id}</li>
        <li><strong>作者:</strong> {currentModInfo.manifest.author}</li>
        <li><strong>版本:</strong> {currentModInfo.manifest.version}</li>
        <li><strong>默认语音:</strong> {currentModInfo.manifest.default_audio_lang_id}</li>
        <li><strong>图片资产:</strong> {currentModInfo.imgs.length}</li>
        <li><strong>序列帧资产:</strong> {currentModInfo.sequences.length}</li>
      </ul>
      <pre>{JSON.stringify(currentModInfo.manifest.important_actions, null, 2)}</pre>
    </div>
  {/if}
</div>

<style>
  .debug-panel {
    background: #ffffff;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
    max-width: 500px;
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
  }

  h4 {
    margin-top: 0;
    margin-bottom: 10px;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  li {
    margin-bottom: 4px;
  }

  pre {
    background: #2c3e50;
    color: #ecf0f1;
    padding: 10px;
    border-radius: 4px;
    overflow-x: auto;
    margin-top: 10px;
  }

  @media (prefers-color-scheme: dark) {
    .debug-panel {
      background: #2c3e50;
      color: #ecf0f1;
    }
    h3 {
      color: #ecf0f1;
      border-bottom-color: #34495e;
    }
    select {
      background: #34495e;
      color: white;
      border-color: #455a64;
    }
    .status-bar {
      background: #34495e;
    }
    .info-panel {
      background: #3e5871;
    }
  }
</style>
