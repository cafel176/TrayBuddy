<!--
========================================================================= 
用户设置组件 (Settings.svelte)
=========================================================================

功能概述:
- 提供用户设置的可视化编辑界面
- 支持用户配置文件编辑 (昵称、生日、语言)
- 支持应用行为设置 (自启动、显示挂件、边框)
- 支持音频设置 (静音、音量)
- 支持免打扰模式设置

数据流:
- 加载: 调用后端 get_settings 获取 UserSettings
- 保存: 调用后端 update_settings 更新设置
- 缩放: 实时调用 set_animation_scale 更新角色大小
=========================================================================
-->

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";

  // ======================================================================= //
  // 类型定义
  // ======================================================================= //

  /**
   * 用户设置接口
   * 对应后端的 UserSettings 结构体
   */
  interface UserSettings {
    /** 用户昵称 */
    nickname: string;
    /** 用户生日 (格式: MM-DD) */
    birthday: string | null;
    /** 界面语言代码 */
    lang: string;
    /** 是否开机自启动 */
    auto_start: boolean;
    /** 是否启用静音模式 */
    no_audio_mode: boolean;
    /** 音量 (0.0 - 1.0) */
    volume: number;
    /** 是否启用免打扰模式 */
    silence_mode: boolean;
    /** 全屏时是否自动进入免打扰 */
    auto_silence_when_fullscreen: boolean;
    /** 是否显示桌面角色 */
    show_character: boolean;
    /** 是否显示边框 */
    show_border: boolean;
    /** 角色缩放比例 */
    animation_scale: number;
  }

  // ======================================================================= //
  // 响应式状态
  // ======================================================================= //

  /** 用户设置数据 */
  let settings = $state<UserSettings | null>(null);
  
  /** 状态消息 */
  let statusMsg = $state("正在加载设置...");
  
  /** 保存操作进行中标记 */
  let saving = $state(false);

  // ======================================================================= //
  // 数据操作函数
  // ======================================================================= //

  /**
   * 从后端加载用户设置
   */
  async function loadSettings() {
    try {
      settings = await invoke("get_settings");
      statusMsg = "设置已加载";
    } catch (e) {
      statusMsg = `加载失败: ${e}`;
    }
  }

  /**
   * 保存当前设置到后端
   */
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

  /**
   * 处理动画缩放滑块变化
   * 实时更新后端缩放值，无需点击保存按钮
   * @param e 输入事件
   */
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

  // ======================================================================= //
  // 生命周期
  // ======================================================================= //

  onMount(loadSettings);
</script>

<!-- ======================================================================= -->
<!-- 组件模板 -->
<!-- ======================================================================= -->

<div class="settings-panel">
  <h3>用户设置</h3>

  {#if settings}
    <!-- ================================================================= -->
    <!-- 用户配置区域 -->
    <!-- ================================================================= -->
    
    <!-- 昵称输入 -->
    <div class="form-group">
      <label for="nickname">昵称</label>
      <input id="nickname" type="text" bind:value={settings.nickname} />
    </div>

    <!-- 生日输入 -->
    <div class="form-group">
      <label for="birthday">生日 (MM-DD)</label>
      <input id="birthday" type="text" placeholder="例如: 01-19" bind:value={settings.birthday} />
    </div>

    <!-- 语言选择 -->
    <div class="form-group">
      <label for="lang">界面语言</label>
      <select id="lang" bind:value={settings.lang}>
        <option value="zh">中文</option>
        <option value="en">English</option>
        <option value="jp">日本語</option>
      </select>
    </div>

    <!-- ================================================================= -->
    <!-- 应用行为设置 -->
    <!-- ================================================================= -->
    
    <div class="divider">应用行为</div>

    <div class="checkbox-group">
      <!-- 开机自启动 -->
      <label>
        <input type="checkbox" bind:checked={settings.auto_start} />
        开机自启动
      </label>
      <!-- 显示桌面挂件 -->
      <label>
        <input type="checkbox" bind:checked={settings.show_character} />
        显示桌面挂件
      </label>
      <!-- 显示边框 (依赖于显示挂件) -->
      <label>
        <input type="checkbox" bind:checked={settings.show_border} disabled={!settings.show_character} />
        显示边框
      </label>
    </div>

    <!-- 角色缩放滑块 -->
    <div class="form-group">
      <label for="animation_scale">角色大小 ({Math.round(settings.animation_scale * 100)}%)</label>
      <input id="animation_scale" type="range" min="0.1" max="2.0" step="0.1" value={settings.animation_scale} oninput={onAnimationScaleChange} />
    </div>

    <!-- ================================================================= -->
    <!-- 音频设置 -->
    <!-- ================================================================= -->
    
    <div class="divider">音频设置</div>

    <div class="checkbox-group">
      <!-- 静音模式 -->
      <label>
        <input type="checkbox" bind:checked={settings.no_audio_mode} />
        静音模式
      </label>
    </div>

    <!-- 音量滑块 (静音时禁用) -->
    <div class="form-group">
      <label for="volume">音量 ({Math.round(settings.volume * 100)}%)</label>
      <input id="volume" type="range" min="0" max="1" step="0.01" bind:value={settings.volume} disabled={settings.no_audio_mode} />
    </div>

    <!-- ================================================================= -->
    <!-- 免打扰设置 -->
    <!-- ================================================================= -->
    
    <div class="divider">免打扰</div>

    <div class="checkbox-group">
      <!-- 免打扰模式 -->
      <label>
        <input type="checkbox" bind:checked={settings.silence_mode} />
        免打扰模式
      </label>
      <!-- 全屏自动免打扰 -->
      <label>
        <input type="checkbox" bind:checked={settings.auto_silence_when_fullscreen} />
        全屏时自动进入免打扰
      </label>
    </div>

    <!-- ================================================================= -->
    <!-- 操作按钮 -->
    <!-- ================================================================= -->
    
    <div class="actions">
      <button class="primary" onclick={saveSettings} disabled={saving}>保存设置</button>
      <!-- <button class="secondary" onclick={loadSettings} disabled={saving}>重置</button> -->
    </div>
  {:else}
    <!-- 加载中状态 -->
    <div class="loading">{statusMsg}</div>
  {/if}

  <!-- 状态消息栏 -->
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
