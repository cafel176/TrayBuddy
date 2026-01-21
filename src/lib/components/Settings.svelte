<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";

  interface UserSettings {
    nickname: string;
    birthday: string | null;
    lang: string;
    auto_start: boolean;
    no_audio_mode: boolean;
    volume: number;
    silence_mode: boolean;
    auto_silence_when_fullscreen: boolean;
    show_character: boolean;
    show_border: boolean;
    animation_scale: number;
  }

  let settings = $state<UserSettings | null>(null);
  let statusMsg = $state("正在加载设置...");
  let saving = $state(false);

  async function loadSettings() {
    try {
      settings = await invoke("get_settings");
      statusMsg = "设置已加载";
    } catch (e) {
      statusMsg = `加载失败: ${e}`;
    }
  }

  async function saveSettings() {
    if (!settings) return;
    saving = true;
    statusMsg = "正在保存...";
    try {
      await invoke("update_settings", { settings });
      statusMsg = "设置已保存";
    } catch (e) {
      statusMsg = `保存失败: ${e}`;
    } finally {
      saving = false;
    }
  }

  async function onAnimationScaleChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const scale = parseFloat(target.value);
    if (settings) {
      settings.animation_scale = scale;
    }
    try {
      await invoke("set_animation_scale", { scale });
    } catch (err) {
      console.error("Failed to set animation scale:", err);
    }
  }

  onMount(loadSettings);
</script>

<div class="settings-panel">
  <h3>用户设置</h3>

  {#if settings}
    <div class="form-group">
      <label for="nickname">昵称</label>
      <input id="nickname" type="text" bind:value={settings.nickname} />
    </div>

    <div class="form-group">
      <label for="birthday">生日 (MM-DD)</label>
      <input id="birthday" type="text" placeholder="例如: 01-19" bind:value={settings.birthday} />
    </div>

    <div class="form-group">
      <label for="lang">界面语言</label>
      <select id="lang" bind:value={settings.lang}>
        <option value="zh">中文</option>
        <option value="en">English</option>
        <option value="jp">日本語</option>
      </select>
    </div>

    <div class="divider">应用行为</div>

    <div class="checkbox-group">
      <label>
        <input type="checkbox" bind:checked={settings.auto_start} />
        开机自启动
      </label>
      <label>
        <input type="checkbox" bind:checked={settings.show_character} />
        显示桌面挂件
      </label>
      <label>
        <input type="checkbox" bind:checked={settings.show_border} disabled={!settings.show_character} />
        显示边框
      </label>
    </div>

    <div class="form-group">
      <label for="animation_scale">角色大小 ({Math.round(settings.animation_scale * 100)}%)</label>
      <input id="animation_scale" type="range" min="0.1" max="2.0" step="0.1" value={settings.animation_scale} oninput={onAnimationScaleChange} />
    </div>

    <div class="divider">音频设置</div>

    <div class="checkbox-group">
      <label>
        <input type="checkbox" bind:checked={settings.no_audio_mode} />
        静音模式
      </label>
    </div>

    <div class="form-group">
      <label for="volume">音量 ({Math.round(settings.volume * 100)}%)</label>
      <input id="volume" type="range" min="0" max="1" step="0.01" bind:value={settings.volume} disabled={settings.no_audio_mode} />
    </div>

    <div class="divider">免打扰</div>

    <div class="checkbox-group">
      <label>
        <input type="checkbox" bind:checked={settings.silence_mode} />
        免打扰模式
      </label>
      <label>
        <input type="checkbox" bind:checked={settings.auto_silence_when_fullscreen} />
        全屏时自动进入免打扰
      </label>
    </div>

    <div class="actions">
      <button class="primary" onclick={saveSettings} disabled={saving}>保存设置</button>
      <!-- <button class="secondary" onclick={loadSettings} disabled={saving}>重置</button> -->
    </div>
  {:else}
    <div class="loading">{statusMsg}</div>
  {/if}

  <div class="status-bar" class:error={statusMsg.includes('失败')}>
    {statusMsg}
  </div>
</div>

<style>
  .settings-panel {
    background: #ffffff;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
    max-width: 450px;
    margin: 20px auto;
    color: #333;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  }

  h3 {
    margin-top: 0;
    color: #2c3e50;
    border-bottom: 2px solid #eee;
    padding-bottom: 10px;
    margin-bottom: 20px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 15px;
  }

  label {
    font-size: 0.9em;
    font-weight: 600;
    color: #666;
  }

  input[type="text"], select {
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 1em;
    outline: none;
    transition: border-color 0.2s;
  }

  input[type="text"]:focus, select:focus {
    border-color: #3498db;
  }

  .divider {
    font-size: 0.8em;
    font-weight: bold;
    color: #95a5a6;
    text-transform: uppercase;
    margin: 20px 0 10px 0;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background: #eee;
  }

  .checkbox-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 15px;
  }

  .checkbox-group label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: normal;
    cursor: pointer;
  }

  input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
  }

  input[type="range"] {
    width: 100%;
    cursor: pointer;
  }

  .hint {
    font-size: 0.75em;
    color: #95a5a6;
    font-style: italic;
  }

  .actions {
    display: flex;
    gap: 10px;
    margin-top: 25px;
  }

  button {
    flex: 1;
    padding: 12px;
    border-radius: 8px;
    border: none;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .primary {
    background: #3498db;
    color: white;
  }

  .primary:hover:not(:disabled) {
    background: #2980b9;
  }

  .secondary {
    background: #ecf0f1;
    color: #7f8c8d;
  }

  .secondary:hover:not(:disabled) {
    background: #bdc3c7;
    color: #2c3e50;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .status-bar {
    margin-top: 15px;
    font-size: 0.85em;
    color: #7f8c8d;
    text-align: center;
    padding: 5px;
  }

  .status-bar.error {
    color: #e74c3c;
  }

  @media (prefers-color-scheme: dark) {
    .settings-panel {
      background: #2c3e50;
      color: #ecf0f1;
    }
    h3 {
      color: #ecf0f1;
      border-bottom-color: #34495e;
    }
    label { color: #bdc3c7; }
    input[type="text"], select {
      background: #34495e;
      border-color: #455a64;
      color: white;
    }
    .divider::after { background: #34495e; }
    .secondary {
      background: #34495e;
      color: #bdc3c7;
    }
  }
</style>
