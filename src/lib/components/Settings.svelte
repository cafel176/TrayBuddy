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
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { onMount, onDestroy } from "svelte";
  import type { ModType, ModManifest, ModInfo } from "$lib/types/asset";
  import { isError } from "$lib/utils/statusMessage";
  import {
    t,
    onLangChange,
    setLang,
    getAvailableLangs,
    type LangInfo,
  } from "$lib/i18n";


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
    /** 是否启用主播模式（窗口捕捉兼容：关闭 skip_taskbar） */
    streamer_mode: boolean;
    /** 是否显示桌面角色 */
    show_character: boolean;

    /** 是否显示边框 */
    show_border: boolean;
    /** 角色缩放比例 */
    animation_scale: number;

    /** Live2D 鼠标跟随 */
    live2d_mouse_follow: boolean;
    /** Live2D 自动交互 */
    live2d_auto_interact: boolean;

    /** 3D 动画切换过渡时长（秒） */
    threed_cross_fade_duration: number;

    /** AI API Key */
    ai_api_key: string;
    /** AI 识别 API Base URL */
    ai_chat_base_url: string;
    /** AI 图像识别/理解模型 */
    ai_chat_model: string;
    /** AI 生图 API Base URL */
    ai_image_base_url: string;
    /** AI 图像生成模型 */
    ai_image_model: string;
    /** AI 截图频率（秒） */
    ai_screenshot_interval: number;
    /** 启动 AI 主动工具的快捷键 (F1-F12) */
    ai_tool_hotkey: string;
  }


  // ======================================================================= //
  // 响应式状态
  // ======================================================================= //

  /** 用户设置数据 */
  let settings = $state<UserSettings | null>(null);

  /** 当前 Mod 类型（用于 Live2D 分类展示） */
  let currentModType = $state<ModType | null>(null);

  /** 生日日期输入值 (YYYY-MM-DD 格式，用于日历控件) */
  let birthdayDate = $state<string>("");


  /** 状态消息 */
  let statusMsg = $state(t("settings.statusLoading"));

  /** 可用语言列表 */
  let availableLangs = $state<LangInfo[]>([]);

  /** F1-F12 快捷键选项 */
  const fKeys = Array.from({ length: 12 }, (_, i) => `F${i + 1}`);

  /** i18n 响应式翻译函数 - 使用版本号触发更新 */
  let _langVersion = $state(0);
  let unsubLang: (() => void) | null = null;
  let unlistenSettings: UnlistenFn | null = null;

  /** 响应式翻译函数 */
  function _(key: string, params?: Record<string, string | number>): string {
    // 依赖 _langVersion 使 Svelte 能追踪变化
    void _langVersion;
    return t(key, params);
  }

  // ======================================================================= //
  // 日期格式转换辅助函数
  // ======================================================================= //

  /**
   * 将 MM-DD 格式转换为 YYYY-MM-DD（用于日历控件显示）
   * 使用当前年份作为占位年
   */
  function mmddToDate(mmdd: string | null): string {
    if (!mmdd) return "";
    const currentYear = new Date().getFullYear();
    return `${currentYear}-${mmdd}`;
  }

  /**
   * 将 YYYY-MM-DD 格式转换为 MM-DD（用于存储）
   */
  function dateToMmdd(dateStr: string): string | null {
    if (!dateStr) return null;
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      return `${parts[1]}-${parts[2]}`;
    }
    return null;
  }

  /**
   * 处理生日日期选择变化
   */
  async function onBirthdayChange(e: Event) {
    const target = e.target as HTMLInputElement;
    birthdayDate = target.value;
    if (settings) {
      settings.birthday = dateToMmdd(birthdayDate);
      await saveSettings();
    }
  }

  // ======================================================================= //
  // 数据操作函数
  // ======================================================================= //

  /**
   * 检查当前媒体播放状态
   * @returns true 表示正在播放音乐，false 表示未播放或无法获取状态
   */
  async function checkMediaStatus(): Promise<boolean> {
    try {
      const isPlaying = await invoke<boolean>("get_media_status");
      return isPlaying;
    } catch (err) {
      console.error("Failed to check media status:", err);
      return false;
    }
  }

  /**
   * 打开存储目录
   */
  async function openStorageDir() {
    try {
      await invoke("open_storage_dir");
      statusMsg = _("settings.storageDirOpened");
    } catch (err) {
      console.error("Failed to open storage directory:", err);
      statusMsg = _("settings.storageDirOpenFailed");
    }
  }

  /**
   * 从后端加载用户设置
   */
  async function loadSettings() {
    try {
      settings = await invoke("get_settings");
      // 转换生日格式用于日历控件
      if (settings) {
        birthdayDate = mmddToDate(settings.birthday);
      }
      statusMsg = _("settings.statusLoaded");
    } catch (e) {
      statusMsg = `${_("common.loadFailed")} ${e}`;
    }
  }

  /**
   * 获取当前加载 Mod 类型
   */
  async function loadCurrentModType() {
    try {
      const mod = (await invoke("get_current_mod")) as ModInfo | null;
      currentModType = mod?.manifest?.mod_type ?? null;
    } catch (e) {
      console.warn("Failed to read current mod type:", e);
      currentModType = null;
    }
  }


  /**
   * 保存当前设置到后端
   */
  async function saveSettings() {
    if (!settings) return;
    statusMsg = _("settings.statusSaving");
    try {
      await invoke("update_settings", { settings });
      statusMsg = _("settings.statusSaved");
    } catch (e) {
      statusMsg = `${_("common.saveFailed")} ${e}`;
    }
  }

  /**
   * 处理动画缩放滑块变化
   * 实时更新后端缩放值
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
      await saveSettings();
    } catch (err) {
      console.error("Failed to set animation scale:", err);
    }
  }

  /**
   * 处理音量滑块变化
   * 实时更新后端音量值
   * @param e 输入事件
   */
  async function onVolumeChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const volume = parseFloat(target.value);
    if (settings) {
      settings.volume = volume;
    }
    try {
      await invoke("set_volume", { volume });
      await saveSettings();
    } catch (err) {
      console.error("Failed to set volume:", err);
    }
  }

  /**
   * 处理 3D 动画过渡时长滑块变化
   */
  async function onTransitionDurationChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const duration = parseFloat(target.value);
    if (settings) {
      settings.threed_cross_fade_duration = duration;
    }
    await saveSettings();
  }

  /**
   * 处理 AI 截图频率滑块变化
   */
  async function onAiScreenshotIntervalChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const interval = parseFloat(target.value);
    if (settings) {
      settings.ai_screenshot_interval = interval;
    }
    await saveSettings();
  }

  /**
   * 统一开关处理入口：更新状态、执行副作用并保存
   * @param key 设置项键名
   * @param value 新值
   */
  async function handleToggle(key: keyof UserSettings, value: boolean) {
    if (!settings) return;

    // 1. 更新本地响应式对象 (Svelte 5 $state 直接触发局部刷新)
    (settings as any)[key] = value;

    // 2. 执行副作用
    switch (key) {
      case "no_audio_mode":
        await applyNoAudioEffect(value);
        break;
      case "silence_mode":
        await applySilenceEffect(value);
        break;
      case "streamer_mode":
        await applyStreamerModeEffect(value);
        break;
      // show_character 和 show_border 主要通过设置广播同步，此处可扩展

    }

    // 3. 保存并广播变更 (触发其他窗口同步)
    await saveSettings();
  }

  /**
   * 应用静音副作用
   */
  async function applyNoAudioEffect(mute: boolean) {
    try {
      await invoke("set_mute", { mute });
    } catch (err) {
      console.error("Failed to apply mute effect:", err);
    }
  }

  /**
   * 应用免打扰副作用
   */
  async function applySilenceEffect(isSilence: boolean) {
    // 检查媒体播放状态
    const isPlaying = await checkMediaStatus();
    const targetState = isSilence
      ? "silence_start"
      : isPlaying
        ? "music_start"
        : "silence_end";
    try {
      await invoke("force_change_state", { name: targetState });
      console.debug(
        `[Settings] DND effect applied: force changed state to ${targetState}`,
      );
    } catch (err) {
      console.error(
        `[Settings] Failed to apply DND effect (${targetState}):`,
        err,
      );
    }
  }

  /**
   * 应用主播模式副作用
   *
   * 目前主播模式的核心副作用（切换 animation window 的 skip_taskbar）在后端 `update_settings`
   * 中统一处理，这里保留入口用于未来扩展（例如提示/联动其它选项）。
   */
  async function applyStreamerModeEffect(_enabled: boolean) {
    // no-op
  }


  /**
   * 处理语言切换
   * 保存设置并立即更新 i18n
   */
  async function onLanguageChange() {
    if (settings) {
      // 先更新 i18n 使界面立即刷新
      setLang(settings.lang);
      // 然后保存设置
      await saveSettings();
    }
  }

  // ======================================================================= //
  // 生命周期
  // ======================================================================= //

  onMount(() => {
    availableLangs = getAvailableLangs();
    unsubLang = onLangChange(() => {
      _langVersion++;
    });

    // Async initialization
    const init = async () => {
      // 监听外部设置变更 (如托盘菜单触发) 以同步 UI
      unlistenSettings = await listen<UserSettings>(
        "settings-change",
        (event) => {
          if (settings) {
            // 直接更新响应式对象
            Object.assign(settings, event.payload);
            birthdayDate = mmddToDate(settings.birthday);
          }
        },
      );

      await loadSettings();
      await loadCurrentModType();

    };

    init().catch((e) => console.error("Settings init failed:", e));
  });

  onDestroy(() => {
    unsubLang?.();
    unlistenSettings?.();
  });
</script>

<!-- ======================================================================= -->
<!-- 组件模板 -->
<!-- ======================================================================= -->

<div class="settings-panel">
  <h3>{_("settings.title")}</h3>

  {#if settings}
    <!-- ================================================================= -->
    <!-- 用户配置区域 -->
    <!-- ================================================================= -->

    <!-- 昵称输入 -->
    <div class="form-group">
      <label for="nickname">{_("settings.nickname")}</label>
      <input
        id="nickname"
        type="text"
        bind:value={settings.nickname}
        onchange={saveSettings}
      />
    </div>

    <!-- 生日输入 (日历模式) -->
    <div class="form-group">
      <label for="birthday">{_("settings.birthday")}</label>
      <input
        id="birthday"
        type="date"
        value={birthdayDate}
        onchange={onBirthdayChange}
      />
    </div>

    <!-- 语言选择 -->
    <div class="form-group">
      <label for="lang">{_("settings.language")}</label>
      <select id="lang" bind:value={settings.lang} onchange={onLanguageChange}>
        {#each availableLangs as lang}
          <option value={lang.code}>{lang.name}</option>
        {/each}
      </select>
    </div>

    <!-- ================================================================= -->
    <!-- 应用行为设置 -->
    <!-- ================================================================= -->

    <div class="divider">{_("settings.appBehavior")}</div>

    <div class="checkbox-group">
      <!-- 开机自启动 -->
      <label>
        <input
          type="checkbox"
          checked={settings.auto_start}
          onchange={(e) => handleToggle("auto_start", e.currentTarget.checked)}
        />
        {_("settings.autoStart")}
      </label>
      <!-- 显示桌面挂件 -->
      <label>
        <input
          type="checkbox"
          checked={settings.show_character}
          onchange={(e) =>
            handleToggle("show_character", e.currentTarget.checked)}
        />
        {_("settings.showCharacter")}
      </label>
      <!-- 显示边框 (依赖于显示挂件) -->
      <label>
        <input
          type="checkbox"
          checked={settings.show_border}
          disabled={!settings.show_character}
          onchange={(e) => handleToggle("show_border", e.currentTarget.checked)}
        />
        {_("settings.showBorder")}
      </label>
    </div>

    <!-- 角色缩放滑块 -->
    <div class="form-group">
      <label for="animation_scale"
        >{_("settings.characterSize")} ({Math.round(
          settings.animation_scale * 100,
        )}%)</label
      >
      <input
        id="animation_scale"
        type="range"
        min="0.1"
        max="2.0"
        step="0.1"
        value={settings.animation_scale}
        oninput={onAnimationScaleChange}
      />
    </div>

    <!-- ================================================================= -->
    <!-- 音频设置 -->
    <!-- ================================================================= -->

    <div class="divider">{_("settings.audioSettings")}</div>

    <div class="checkbox-group">
      <!-- 静音模式 (实时生效) -->
      <label>
        <input
          type="checkbox"
          checked={settings.no_audio_mode}
          onchange={(e) =>
            handleToggle("no_audio_mode", e.currentTarget.checked)}
        />
        {_("settings.muteMode")}
      </label>
    </div>

    <!-- 音量滑块 (实时生效，静音时禁用) -->
    <div class="form-group">
      <label for="volume"
        >{_("settings.volume")} ({Math.round(settings.volume * 100)}%)</label
      >
      <input
        id="volume"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={settings.volume}
        oninput={onVolumeChange}
        disabled={settings.no_audio_mode}
      />
    </div>

    <!-- ================================================================= -->
    <!-- 免打扰设置 -->
    <!-- ================================================================= -->

    <div class="divider">{_("settings.dnd")}</div>

    <div class="checkbox-group">
      <!-- 免打扰模式 -->
      <label>
        <input
          type="checkbox"
          checked={settings.silence_mode}
          onchange={(e) =>
            handleToggle("silence_mode", e.currentTarget.checked)}
        />
        {_("settings.dndMode")}
      </label>
      <!-- 全屏自动免打扰 -->
      <label>
        <input
          type="checkbox"
          checked={settings.auto_silence_when_fullscreen}
          onchange={(e) =>
            handleToggle(
              "auto_silence_when_fullscreen",
              e.currentTarget.checked,
            )}
        />
        {_("settings.dndFullscreen")}
      </label>
    </div>

    <!-- ================================================================= -->
    <!-- 主播模式 -->
    <!-- ================================================================= -->

    <div class="divider">{_("settings.streamerMode")}</div>

    <div class="checkbox-group">
      <label>
        <input
          type="checkbox"
          checked={settings.streamer_mode}
          onchange={(e) =>
            handleToggle("streamer_mode", e.currentTarget.checked)}
        />
        {_("settings.streamerMode")}
      </label>
    </div>

    <!-- ================================================================= -->
    <!-- Live2D 设置 -->
    <!-- ================================================================= -->

    {#if currentModType === "live2d"}
      <div class="divider">{_("settings.live2d")}</div>

      <div class="checkbox-group">
        <label>
          <input
            type="checkbox"
            checked={settings.live2d_mouse_follow}
            onchange={(e) =>
              handleToggle("live2d_mouse_follow", e.currentTarget.checked)}
          />
          {_("settings.live2dMouseFollow")}
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.live2d_auto_interact}
            onchange={(e) =>
              handleToggle("live2d_auto_interact", e.currentTarget.checked)}
          />
          {_("settings.live2dAutoInteract")}
        </label>
      </div>
    {/if}

    <!-- ================================================================= -->
    <!-- 3D 设置 -->
    <!-- ================================================================= -->

    {#if currentModType === "3d"}
      <div class="divider">{_("settings.threed")}</div>

      <div class="form-group">
        <label for="threed_cross_fade_duration"
          >{_("settings.threedCrossFade")} ({settings.threed_cross_fade_duration.toFixed(1)}s)</label
        >
        <input
          id="threed_cross_fade_duration"
          type="range"
          min="0"
          max="5.0"
          step="0.1"
          value={settings.threed_cross_fade_duration}
          oninput={onTransitionDurationChange}
        />
      </div>
    {/if}

    <!-- ================================================================= -->
    <!-- AI 设置 -->
    <!-- ================================================================= -->

    <div class="divider">{_("settings.ai")}</div>

    <!-- AI API Key -->
    <div class="form-group">
      <label for="ai_api_key">{_("settings.aiApiKey")}</label>
      <input
        id="ai_api_key"
        type="password"
        bind:value={settings.ai_api_key}
        onchange={saveSettings}
        placeholder={_("settings.aiApiKeyPlaceholder")}
      />
    </div>

    <!-- AI Chat Base URL -->
    <div class="form-group">
      <label for="ai_chat_base_url">{_("settings.aiChatBaseUrl")}</label>
      <input
        id="ai_chat_base_url"
        type="text"
        bind:value={settings.ai_chat_base_url}
        onchange={saveSettings}
        placeholder="https://api.siliconflow.cn/v1"
      />
    </div>

    <!-- AI Chat Model -->
    <div class="form-group">
      <label for="ai_chat_model">{_("settings.aiChatModel")}</label>
      <input
        id="ai_chat_model"
        type="text"
        bind:value={settings.ai_chat_model}
        onchange={saveSettings}
        placeholder="Qwen/Qwen2.5-VL-7B-Instruct"
      />
    </div>

    <!-- AI Image Base URL -->
    <div class="form-group">
      <label for="ai_image_base_url">{_("settings.aiImageBaseUrl")}</label>
      <input
        id="ai_image_base_url"
        type="text"
        bind:value={settings.ai_image_base_url}
        onchange={saveSettings}
        placeholder="https://api.siliconflow.cn/v1"
      />
    </div>

    <!-- AI Image Model -->
    <div class="form-group">
      <label for="ai_image_model">{_("settings.aiImageModel")}</label>
      <input
        id="ai_image_model"
        type="text"
        bind:value={settings.ai_image_model}
        onchange={saveSettings}
        placeholder="black-forest-labs/FLUX.1-schnell"
      />
    </div>

    <!-- AI 截图频率 -->
    <div class="form-group">
      <label for="ai_screenshot_interval"
        >{_("settings.aiScreenshotInterval")} ({settings.ai_screenshot_interval.toFixed(1)}s)</label
      >
      <input
        id="ai_screenshot_interval"
        type="range"
        min="0.1"
        max="10.0"
        step="0.1"
        value={settings.ai_screenshot_interval}
        oninput={onAiScreenshotIntervalChange}
      />
    </div>

    <!-- AI 主动工具快捷键 -->
    <div class="form-group">
      <label for="ai_tool_hotkey">{_("settings.aiToolHotkey")}</label>
      <select id="ai_tool_hotkey" bind:value={settings.ai_tool_hotkey} onchange={saveSettings}>
        {#each fKeys as fk}
          <option value={fk}>{fk}</option>
        {/each}
      </select>
    </div>

    <!-- ================================================================= -->
    <!-- 高级选项 -->
    <!-- ================================================================= -->


    <div class="divider">{_("settings.advancedOptions")}</div>


    <button type="button" class="secondary-button" onclick={openStorageDir}>
      {_("settings.openStorageDir")}
    </button>
  {:else}
    <!-- 加载中状态 -->
    <div class="loading">{statusMsg}</div>
  {/if}

  <!-- 状态消息栏 -->
  <div class="status-bar" class:error={isError(statusMsg)}>
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
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
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

  input[type="text"],
  input[type="password"],
  select {
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 1em;
    outline: none;
    transition: border-color 0.2s;
  }

  input[type="text"]:focus,
  input[type="password"]:focus,
  select:focus {
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

  .secondary-button {
    background: #f8f9fa;
    border: 1px solid #dee2e6;
    color: #495057;
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9em;
    transition: all 0.2s;
    margin-bottom: 15px;
  }

  .secondary-button:hover {
    background: #e9ecef;
    border-color: #ced4da;
  }

  .secondary-button:active {
    background: #dee2e6;
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
    label {
      color: #bdc3c7;
    }
    input[type="text"],
    input[type="password"],
    select {
      background: #34495e;
      border-color: #455a64;
      color: white;
    }
    .divider::after {
      background: #34495e;
    }
  }
</style>
