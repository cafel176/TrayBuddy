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
  - 静态图片资源（带缩略图预览和放大功能）
  - 序列动画资源（带缩略图预览）
  - 语音资源（带播放功能）
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
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { onMount, onDestroy } from "svelte";
  import { loadBubbleStyle } from "$lib/bubble/bubbleStyle";
  import { t, onLangChange } from "$lib/i18n";

  // ======================================================================= //
  // 类型定义
  // ======================================================================= //

  interface AssetInfo {
    name: string;
    img: string;
    sequence: boolean;
    origin_reverse: boolean;
    need_reverse: boolean;
    frame_time: number;
    frame_size_x: number;
    frame_size_y: number;
    frame_num_x: number;
    frame_num_y: number;
    offset_x: number;
    offset_y: number;
  }

  interface StateInfo {
    name: string;
    persistent: boolean;
    anima: string;
    audio: string;
    text: string;
    priority: number;
    date_start: string;
    date_end: string;
    time_start: string;
    time_end: string;
    next_state: string;
    can_trigger_states: string[];
    trigger_time: number;
    trigger_rate: number;
    branch: { text: string; next_state: string }[];
  }

  interface TriggerStateGroup {
    persistent_state: string;
    states: string[];
  }

  interface TriggerInfo {
    event: string;
    can_trigger_states: TriggerStateGroup[];
  }

  interface CharacterConfig {
    z_offset: number;
  }

  interface BorderConfig {
    anima: string;
    enable: boolean;
    z_offset: number;
  }

  interface ModManifest {
    id: string;
    version: string;
    author: string;
    default_audio_lang_id: string;
    default_text_lang_id: string;
    character: CharacterConfig;
    border: BorderConfig;
    important_states: Record<string, StateInfo>;
    states: StateInfo[];
    triggers: TriggerInfo[];
  }

  interface AudioInfo {
    name: string;
    audio: string;
  }

  interface TextInfo {
    name: string;
    text: string;
    duration: number;
  }

  interface CharacterInfo {
    name: string;
    lang: string;
    id: string;
    description: string;
  }

  interface ModInfo {
    path: string;
    manifest: ModManifest;
    imgs: AssetInfo[];
    sequences: AssetInfo[];
    audios: Record<string, AudioInfo[]>;
    texts: Record<string, TextInfo[]>;
    info: Record<string, CharacterInfo>;
  }

  // ======================================================================= //
  // 响应式状态
  // ======================================================================= //

  let searchPaths: string[] = $state([]);
  let mods: string[] = $state([]);
  let selectedMod = $state("");
  let statusMsg = $state(t("resource.statusWaiting"));
  let currentModInfo = $state<ModInfo | null>(null);
  let loading = $state(false);

  // i18n 响应式版本号
  let _langVersion = $state(0);
  let unsubLang: (() => void) | null = null;

  // 响应式翻译函数
  function _(key: string, params?: Record<string, string | number>): string {
    void _langVersion;
    return t(key, params);
  }

  /** 检查状态消息是否包含错误信息 */
  function isError(msg: string): boolean {
    return msg.includes(_("common.failed")) || msg.includes("failed") || msg.includes("失败");
  }

  // 图片查看器状态
  let viewerVisible = $state(false);
  let viewerImageSrc = $state("");
  let viewerImageTitle = $state("");

  // 音频播放状态
  let currentAudio: HTMLAudioElement | null = null;
  let playingAudioName = $state<string | null>(null);

  // ======================================================================= //
  // 数据操作函数
  // ======================================================================= //

  async function refreshMods() {
    try {
      searchPaths = await invoke("get_mod_search_paths");
      mods = await invoke("get_available_mods");
      
      const info = await invoke("get_current_mod") as ModInfo | null;
      if (info) {
        currentModInfo = info;
        selectedMod = info.path.split(/[\\/]/).pop() || "";
        statusMsg = _("resource.statusCurrentLoaded") + " " + info.manifest.id;
      } else {
        statusMsg = _("resource.statusRefreshed", { count: mods.length });
        if (mods.length > 0 && !selectedMod) {
          selectedMod = mods[0];
        }
      }
    } catch (e) {
      statusMsg = _("resource.statusRefreshFailed") + " " + e;
    }
  }

  async function loadSelectedMod() {
    if (!selectedMod) {
      statusMsg = _("resource.statusSelectMod");
      return;
    }
    loading = true;
    statusMsg = _("resource.statusLoading");
    try {
      const info = await invoke("load_mod", { modName: selectedMod }) as ModInfo;
      currentModInfo = info;
      statusMsg = _("resource.statusLoadSuccess") + " " + info.manifest.id + " (v" + info.manifest.version + ")";
      // 重新加载气泡样式
      await loadBubbleStyle();
    } catch (e) {
      statusMsg = _("resource.statusLoadFailed") + " " + e;
      currentModInfo = null;
    } finally {
      loading = false;
    }
  }

  async function unloadMod() {
    try {
      const success = await invoke("unload_mod");
      if (success) {
        statusMsg = _("resource.statusUnloaded");
        currentModInfo = null;
      } else {
        statusMsg = _("resource.statusNoMod");
      }
    } catch (e) {
      statusMsg = _("resource.statusUnloadFailed") + " " + e;
    }
  }

  async function openAssetFile(relativePath: string) {
    if (!currentModInfo) return;
    try {
      const fullPath = `${currentModInfo.path}/${relativePath}`.replace(/\//g, '\\');
      await invoke("open_path", { path: fullPath });
    } catch (e) {
      statusMsg = _("resource.statusOpenFailed") + " " + e;
    }
  }

  // ======================================================================= //
  // 图片查看器
  // ======================================================================= //

  function getAssetSrc(relativePath: string): string {
    if (!currentModInfo) return "";
    const fullPath = `${currentModInfo.path}/${relativePath}`;
    return convertFileSrc(fullPath);
  }

  function openImageViewer(src: string, title: string) {
    viewerImageSrc = src;
    viewerImageTitle = title;
    viewerVisible = true;
  }

  function closeImageViewer() {
    viewerVisible = false;
  }

  // ======================================================================= //
  // 音频播放
  // ======================================================================= //

  function playAudio(audioPath: string, audioName: string) {
    // 停止当前播放
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    // 如果点击的是当前正在播放的，停止播放
    if (playingAudioName === audioName) {
      playingAudioName = null;
      return;
    }

    if (!currentModInfo) return;

    const fullPath = `${currentModInfo.path}/audio/${audioPath}`;
    const src = convertFileSrc(fullPath);
    
    currentAudio = new Audio(src);
    playingAudioName = audioName;
    
    currentAudio.onended = () => {
      playingAudioName = null;
      currentAudio = null;
    };
    
    currentAudio.onerror = () => {
      statusMsg = _("resource.statusPlayFailed") + " " + audioName;
      playingAudioName = null;
      currentAudio = null;
    };
    
    currentAudio.play();
  }

  function stopAudio() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
      playingAudioName = null;
    }
  }

  // ======================================================================= //
  // 统计
  // ======================================================================= //

  function getTotalStates(): number {
    if (!currentModInfo) return 0;
    return Object.keys(currentModInfo.manifest.important_states).length + 
           currentModInfo.manifest.states.length;
  }

  function getTotalAudios(): number {
    if (!currentModInfo) return 0;
    return Object.values(currentModInfo.audios).flat().length;
  }

  function getTotalTexts(): number {
    if (!currentModInfo) return 0;
    return Object.values(currentModInfo.texts).flat().length;
  }

  // 分类状态为持久和非持久
  function getImportantStatesByPersistence(): { persistent: [string, StateInfo][]; nonPersistent: [string, StateInfo][] } {
    if (!currentModInfo) return { persistent: [], nonPersistent: [] };
    const entries = Object.entries(currentModInfo.manifest.important_states);
    return {
      persistent: entries.filter(([_, s]) => s.persistent),
      nonPersistent: entries.filter(([_, s]) => !s.persistent)
    };
  }

  function getOtherStatesByPersistence(): { persistent: StateInfo[]; nonPersistent: StateInfo[] } {
    if (!currentModInfo) return { persistent: [], nonPersistent: [] };
    return {
      persistent: currentModInfo.manifest.states.filter(s => s.persistent),
      nonPersistent: currentModInfo.manifest.states.filter(s => !s.persistent)
    };
  }

  // ======================================================================= //
  // 生命周期
  // ======================================================================= //

  onMount(() => {
    refreshMods();
    unsubLang = onLangChange(() => { _langVersion++; });
  });

  onDestroy(() => {
    stopAudio();
    unsubLang?.();
  });
</script>

<!-- ======================================================================= -->
<!-- 组件模板 -->
<!-- ======================================================================= -->

<div class="debug-panel">
  <h3>{_("resource.title")}</h3>
  
  <!-- 搜索路径信息 -->
  <div class="path-info">
    <strong>{_("resource.searchPaths")}</strong>
    {#each searchPaths as path}
      <div class="path-item">{path}</div>
    {/each}
  </div>

  <!-- Mod 选择和操作控制区 -->
  <div class="controls">
    <div class="section">
      <label for="mod-select">{_("resource.availableMods")}</label>
      <select id="mod-select" bind:value={selectedMod}>
        {#each mods as mod}
          <option value={mod}>{mod}</option>
        {/each}
      </select>
      <button onclick={refreshMods} disabled={loading}>{_("common.refresh")}</button>
    </div>

    <div class="actions">
      <button class="primary" onclick={loadSelectedMod} disabled={loading || !selectedMod}>{_("resource.loadMod")}</button>
    </div>
  </div>

  <div class="status-bar" class:error={isError(statusMsg)}>
    {statusMsg}
  </div>

  <!-- Mod 详情面板 -->
  {#if currentModInfo}
    <div class="info-panel">
      <div class="info-header">
        <h4>当前 Mod 详情</h4>
        <div class="path-badge" title={currentModInfo.path}>{currentModInfo.path.split(/[\\/]/).pop()}</div>
      </div>

      <!-- 统计概览 -->
      <div class="stats-bar">
        <div class="stat-item">
          <span class="stat-value">{getTotalStates()}</span>
          <span class="stat-label">{_("resource.statStates")}</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{currentModInfo.manifest.triggers.length}</span>
          <span class="stat-label">{_("resource.statTriggers")}</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{currentModInfo.imgs.length}</span>
          <span class="stat-label">{_("resource.statImages")}</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{currentModInfo.sequences.length}</span>
          <span class="stat-label">{_("resource.statAnimations")}</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{getTotalAudios()}</span>
          <span class="stat-label">{_("resource.statAudios")}</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{getTotalTexts()}</span>
          <span class="stat-label">{_("resource.statTexts")}</span>
        </div>
      </div>
      
      <div class="tabs">
        
        <!-- 基本信息 (Manifest) -->
        <details open>
          <summary>{_("resource.basicInfo")}</summary>
          <div class="tab-content">
            <div class="info-grid">
              <div class="info-row">
                <span class="info-label">{_("resource.id")}</span>
                <span class="info-value">{currentModInfo.manifest.id}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{_("resource.version")}</span>
                <span class="info-value">{currentModInfo.manifest.version}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{_("resource.author")}</span>
                <span class="info-value">{currentModInfo.manifest.author}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{_("resource.defaultAudio")}</span>
                <span class="info-value">{currentModInfo.manifest.default_audio_lang_id}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{_("resource.defaultText")}</span>
                <span class="info-value">{currentModInfo.manifest.default_text_lang_id}</span>
              </div>
            </div>

            <h5>{_("resource.characterConfig")}</h5>
            <div class="info-grid compact">
              <div class="info-row">
                <span class="info-label">z_offset</span>
                <span class="info-value">{currentModInfo.manifest.character.z_offset}</span>
              </div>
            </div>

            <h5>{_("resource.borderConfig")}</h5>
            <div class="info-grid compact">
              <div class="info-row">
                <span class="info-label">{_("resource.enable")}</span>
                <span class="info-value">{currentModInfo.manifest.border.enable ? _("common.yes") : _("common.no")}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{_("resource.animation")}</span>
                <span class="info-value">{currentModInfo.manifest.border.anima || _("resource.notSet")}</span>
              </div>
              <div class="info-row">
                <span class="info-label">z_offset</span>
                <span class="info-value">{currentModInfo.manifest.border.z_offset}</span>
              </div>
            </div>
          </div>
        </details>

        <!-- 角色信息 (多语言) -->
        <details>
          <summary>{_("resource.characterInfo", { lang: Object.keys(currentModInfo.info).length })}</summary>
          <div class="tab-content">
            <div class="lang-cards">
              {#each Object.entries(currentModInfo.info) as [lang, info]}
                <div class="lang-card">
                  <span class="lang-code">{lang}</span>
                  <div class="lang-info">
                    <div class="char-name">{info.name}</div>
                    <div class="char-meta">
                      <span>{_("resource.langLabel")} {info.lang}</span>
                      <span>ID: {info.id}</span>
                    </div>
                    {#if info.description}
                      <div class="char-desc">{info.description}</div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </details>

        <!-- 核心状态 -->
        <details>
          <summary>{_("resource.coreStates")} ({Object.keys(currentModInfo.manifest.important_states).length})</summary>
          <div class="tab-content">
            {#if getImportantStatesByPersistence().persistent.length > 0}
              <details class="state-category" open>
                <summary class="category-summary persistent-cat">
                  {_("resource.persistentStates")} ({getImportantStatesByPersistence().persistent.length})
                </summary>
                <div class="state-list">
                  {#each getImportantStatesByPersistence().persistent as [name, state]}
                    <div class="state-card persistent">
                      <div class="state-header">
                        <span class="state-name">{name}</span>
                        <span class="badge persistent">{_("resource.persistent")}</span>
                        {#if state.priority > 0}
                          <span class="badge priority">{_("resource.priority")} {state.priority}</span>
                        {/if}
                      </div>
                      <div class="state-detail">
                        {#if state.anima}<div class="detail-item"><span class="detail-label">{_("resource.animationLabel")}</span> {state.anima}</div>{/if}
                        {#if state.audio}<div class="detail-item"><span class="detail-label">{_("resource.audioLabel")}</span> {state.audio}</div>{/if}
                        {#if state.text}<div class="detail-item"><span class="detail-label">{_("resource.textLabel")}</span> {state.text}</div>{/if}
                        {#if state.next_state}<div class="detail-item"><span class="detail-label">{_("resource.nextLabel")}</span> {state.next_state}</div>{/if}
                        {#if state.date_start || state.date_end}
                          <div class="detail-item"><span class="detail-label">{_("resource.dateLabel")}</span> {state.date_start || '*'} ~ {state.date_end || '*'}</div>
                        {/if}
                        {#if state.time_start || state.time_end}
                          <div class="detail-item"><span class="detail-label">{_("resource.timeLabel")}</span> {state.time_start || '*'} ~ {state.time_end || '*'}</div>
                        {/if}
                        {#if state.trigger_time > 0}
                          <div class="detail-item"><span class="detail-label">{_("resource.timerLabel")}</span> {_("resource.timerDesc", { interval: state.trigger_time, chance: (state.trigger_rate * 100).toFixed(0) })}</div>
                        {/if}
                        {#if state.can_trigger_states && state.can_trigger_states.length > 0}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.triggerable")}</span>
                            <div class="tag-list">
                              {#each state.can_trigger_states as s}
                                <span class="tag state-tag">{s}</span>
                              {/each}
                            </div>
                          </div>
                        {/if}
                        {#if state.branch && state.branch.length > 0}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.branchLabel")}</span>
                            <div class="branch-list">
                              {#each state.branch as b}
                                <div class="branch-item">
                                  <span class="branch-text">{b.text}</span>
                                  <span class="branch-arrow">→</span>
                                  <span class="branch-next">{b.next_state}</span>
                                </div>
                              {/each}
                            </div>
                          </div>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              </details>
            {/if}
            {#if getImportantStatesByPersistence().nonPersistent.length > 0}
              <details class="state-category" open>
                <summary class="category-summary non-persistent-cat">
                  {_("resource.nonPersistentStates")} ({getImportantStatesByPersistence().nonPersistent.length})
                </summary>
                <div class="state-list">
                  {#each getImportantStatesByPersistence().nonPersistent as [name, state]}
                    <div class="state-card">
                      <div class="state-header">
                        <span class="state-name">{name}</span>
                        {#if state.priority > 0}
                          <span class="badge priority">{_("resource.priority")} {state.priority}</span>
                        {/if}
                      </div>
                      <div class="state-detail">
                        {#if state.anima}<div class="detail-item"><span class="detail-label">{_("resource.animationLabel")}</span> {state.anima}</div>{/if}
                        {#if state.audio}<div class="detail-item"><span class="detail-label">{_("resource.audioLabel")}</span> {state.audio}</div>{/if}
                        {#if state.text}<div class="detail-item"><span class="detail-label">{_("resource.textLabel")}</span> {state.text}</div>{/if}
                        {#if state.next_state}<div class="detail-item"><span class="detail-label">{_("resource.nextLabel")}</span> {state.next_state}</div>{/if}
                        {#if state.date_start || state.date_end}
                          <div class="detail-item"><span class="detail-label">{_("resource.dateLabel")}</span> {state.date_start || '*'} ~ {state.date_end || '*'}</div>
                        {/if}
                        {#if state.time_start || state.time_end}
                          <div class="detail-item"><span class="detail-label">{_("resource.timeLabel")}</span> {state.time_start || '*'} ~ {state.time_end || '*'}</div>
                        {/if}
                        {#if state.trigger_time > 0}
                          <div class="detail-item"><span class="detail-label">{_("resource.timerLabel")}</span> {_("resource.timerDesc", { interval: state.trigger_time, chance: (state.trigger_rate * 100).toFixed(0) })}</div>
                        {/if}
                        {#if state.can_trigger_states && state.can_trigger_states.length > 0}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.triggerable")}</span>
                            <div class="tag-list">
                              {#each state.can_trigger_states as s}
                                <span class="tag state-tag">{s}</span>
                              {/each}
                            </div>
                          </div>
                        {/if}
                        {#if state.branch && state.branch.length > 0}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.branchLabel")}</span>
                            <div class="branch-list">
                              {#each state.branch as b}
                                <div class="branch-item">
                                  <span class="branch-text">{b.text}</span>
                                  <span class="branch-arrow">→</span>
                                  <span class="branch-next">{b.next_state}</span>
                                </div>
                              {/each}
                            </div>
                          </div>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              </details>
            {/if}
          </div>
        </details>

        <!-- 其他状态 -->
        {#if currentModInfo.manifest.states.length > 0}
          <details>
            <summary>{_("resource.otherStates")} ({currentModInfo.manifest.states.length})</summary>
            <div class="tab-content">
              {#if getOtherStatesByPersistence().persistent.length > 0}
                <details class="state-category" open>
                  <summary class="category-summary persistent-cat">
                    {_("resource.persistentStates")} ({getOtherStatesByPersistence().persistent.length})
                  </summary>
                  <div class="state-list">
                    {#each getOtherStatesByPersistence().persistent as state}
                      <div class="state-card persistent">
                        <div class="state-header">
                          <span class="state-name">{state.name}</span>
                          <span class="badge persistent">{_("resource.persistent")}</span>
                          {#if state.priority > 0}
                            <span class="badge priority">{_("resource.priority")} {state.priority}</span>
                          {/if}
                        </div>
                        <div class="state-detail">
                          {#if state.anima}<div class="detail-item"><span class="detail-label">{_("resource.animationLabel")}</span> {state.anima}</div>{/if}
                          {#if state.audio}<div class="detail-item"><span class="detail-label">{_("resource.audioLabel")}</span> {state.audio}</div>{/if}
                          {#if state.text}<div class="detail-item"><span class="detail-label">{_("resource.textLabel")}</span> {state.text}</div>{/if}
                          {#if state.next_state}<div class="detail-item"><span class="detail-label">{_("resource.nextLabel")}</span> {state.next_state}</div>{/if}
                          {#if state.date_start || state.date_end}
                            <div class="detail-item"><span class="detail-label">{_("resource.dateLabel")}</span> {state.date_start || '*'} ~ {state.date_end || '*'}</div>
                          {/if}
                          {#if state.time_start || state.time_end}
                            <div class="detail-item"><span class="detail-label">{_("resource.timeLabel")}</span> {state.time_start || '*'} ~ {state.time_end || '*'}</div>
                          {/if}
                          {#if state.trigger_time > 0}
                            <div class="detail-item"><span class="detail-label">{_("resource.timerLabel")}</span> {_("resource.timerDesc", { interval: state.trigger_time, chance: (state.trigger_rate * 100).toFixed(0) })}</div>
                          {/if}
                          {#if state.can_trigger_states && state.can_trigger_states.length > 0}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.triggerable")}</span>
                              <div class="tag-list">
                                {#each state.can_trigger_states as s}
                                  <span class="tag state-tag">{s}</span>
                                {/each}
                              </div>
                            </div>
                          {/if}
                          {#if state.branch && state.branch.length > 0}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.branchLabel")}</span>
                              <div class="branch-list">
                                {#each state.branch as b}
                                  <div class="branch-item">
                                    <span class="branch-text">{b.text}</span>
                                    <span class="branch-arrow">→</span>
                                    <span class="branch-next">{b.next_state}</span>
                                  </div>
                                {/each}
                              </div>
                            </div>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                </details>
              {/if}
              {#if getOtherStatesByPersistence().nonPersistent.length > 0}
                <details class="state-category" open>
                  <summary class="category-summary non-persistent-cat">
                    {_("resource.nonPersistentStates")} ({getOtherStatesByPersistence().nonPersistent.length})
                  </summary>
                  <div class="state-list">
                    {#each getOtherStatesByPersistence().nonPersistent as state}
                      <div class="state-card">
                        <div class="state-header">
                          <span class="state-name">{state.name}</span>
                          {#if state.priority > 0}
                            <span class="badge priority">{_("resource.priority")} {state.priority}</span>
                          {/if}
                        </div>
                        <div class="state-detail">
                          {#if state.anima}<div class="detail-item"><span class="detail-label">{_("resource.animationLabel")}</span> {state.anima}</div>{/if}
                          {#if state.audio}<div class="detail-item"><span class="detail-label">{_("resource.audioLabel")}</span> {state.audio}</div>{/if}
                          {#if state.text}<div class="detail-item"><span class="detail-label">{_("resource.textLabel")}</span> {state.text}</div>{/if}
                          {#if state.next_state}<div class="detail-item"><span class="detail-label">{_("resource.nextLabel")}</span> {state.next_state}</div>{/if}
                          {#if state.date_start || state.date_end}
                            <div class="detail-item"><span class="detail-label">{_("resource.dateLabel")}</span> {state.date_start || '*'} ~ {state.date_end || '*'}</div>
                          {/if}
                          {#if state.time_start || state.time_end}
                            <div class="detail-item"><span class="detail-label">{_("resource.timeLabel")}</span> {state.time_start || '*'} ~ {state.time_end || '*'}</div>
                          {/if}
                          {#if state.trigger_time > 0}
                            <div class="detail-item"><span class="detail-label">{_("resource.timerLabel")}</span> {_("resource.timerDesc", { interval: state.trigger_time, chance: (state.trigger_rate * 100).toFixed(0) })}</div>
                          {/if}
                          {#if state.can_trigger_states && state.can_trigger_states.length > 0}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.triggerable")}</span>
                              <div class="tag-list">
                                {#each state.can_trigger_states as s}
                                  <span class="tag state-tag">{s}</span>
                                {/each}
                              </div>
                            </div>
                          {/if}
                          {#if state.branch && state.branch.length > 0}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.branchLabel")}</span>
                              <div class="branch-list">
                                {#each state.branch as b}
                                  <div class="branch-item">
                                    <span class="branch-text">{b.text}</span>
                                    <span class="branch-arrow">→</span>
                                    <span class="branch-next">{b.next_state}</span>
                                  </div>
                                {/each}
                              </div>
                            </div>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                </details>
              {/if}
            </div>
          </details>
        {/if}

        <!-- 触发器 -->
        {#if currentModInfo.manifest.triggers.length > 0}
          <details>
            <summary>{_("resource.triggers")} ({currentModInfo.manifest.triggers.length})</summary>
            <div class="tab-content">
              <div class="trigger-list">
                {#each currentModInfo.manifest.triggers as trigger}
                  <div class="trigger-card">
                    <span class="trigger-event">{trigger.event}</span>
                    {#if trigger.can_trigger_states.length > 0}
                      <div class="trigger-groups">
                        {#each trigger.can_trigger_states as group, idx}
                          <div class="trigger-group">
                            <div class="group-header">
                              <span class="group-label">{_("resource.group", { num: idx + 1 })}</span>
                              {#if group.persistent_state}
                                <span class="persistent-badge">{_("resource.persistentLabel")} {group.persistent_state}</span>
                              {:else}
                                <span class="persistent-badge any">{_("resource.anyPersistent")}</span>
                              {/if}
                            </div>
                            {#if group.states.length > 0}
                              <div class="trigger-states">
                                {#each group.states as state}
                                  <span class="tag state-tag">{state}</span>
                                {/each}
                              </div>
                            {:else}
                              <span class="no-states">{_("resource.noTriggerableStates")}</span>
                            {/if}
                          </div>
                        {/each}
                      </div>
                    {:else}
                      <span class="no-states">{_("resource.noStateGroup")}</span>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          </details>
        {/if}

        <!-- 静态图片资源 -->
        <details>
          <summary>{_("resource.staticImages")} ({currentModInfo.imgs.length})</summary>
          <div class="tab-content">
            <div class="asset-grid">
              {#each currentModInfo.imgs as img}
                {@const totalFrames = img.frame_num_x * img.frame_num_y}
                {@const isAnimated = img.sequence || totalFrames > 1}
                <div class="asset-card-with-thumb" class:animated={isAnimated}>
                  <div class="thumb-container">
                    <button 
                      class="thumbnail-btn"
                      onclick={() => openImageViewer(getAssetSrc(`asset/${img.img}`), img.name)}
                      title={_("resource.clickToEnlarge")}
                    >
                      <img 
                        src={getAssetSrc(`asset/${img.img}`)} 
                        alt={img.name}
                        class="thumbnail"
                      />
                    </button>
                    <button 
                      class="thumb-open-btn"
                      onclick={() => openAssetFile(`asset/${img.img}`)}
                      title={_("resource.openFile")}
                    >
                      📂
                    </button>
                  </div>
                  <div class="asset-info">
                    <div class="asset-name">{img.name}</div>
                    <div class="asset-file">{img.img}</div>
                    <div class="asset-meta">
                      <span title="{_("resource.frameSize")}">{img.frame_size_x}×{img.frame_size_y}px</span>
                      {#if totalFrames > 1}
                        <span title="{_("resource.frameLayout")}">{img.frame_num_x}×{img.frame_num_y} = {totalFrames}{_("resource.frames")}</span>
                      {/if}
                    </div>
                    {#if isAnimated}
                      <div class="asset-meta">
                        <span title="{_("resource.frameInterval")}">{img.frame_time}s{_("resource.perFrame")}</span>
                      </div>
                    {/if}
                    <div class="asset-flags">
                      {#if img.sequence}
                        <span class="badge sequence-flag">{_("resource.sequence")}</span>
                      {/if}
                      {#if img.origin_reverse}
                        <span class="badge reverse">{_("resource.reversePlay")}</span>
                      {/if}
                      {#if img.need_reverse}
                        <span class="badge pingpong">{_("resource.pingPongMode")}</span>
                      {/if}
                      {#if img.offset_x !== 0 || img.offset_y !== 0}
                        <span class="badge offset">{_("resource.offset")} {img.offset_x},{img.offset_y}</span>
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </details>

        <!-- 序列动画资源 -->
        <details>
          <summary>{_("resource.sequenceAnimations")} ({currentModInfo.sequences.length})</summary>
          <div class="tab-content">
            <div class="asset-grid">
              {#each currentModInfo.sequences as seq}
                {@const totalFrames = seq.frame_num_x * seq.frame_num_y}
                {@const totalDuration = (totalFrames * seq.frame_time).toFixed(2)}
                <div class="asset-card-with-thumb sequence">
                  <div class="thumb-container">
                    <button 
                      class="thumbnail-btn"
                      onclick={() => openImageViewer(getAssetSrc(`asset/${seq.img}`), seq.name)}
                      title={_("resource.clickToEnlarge")}
                    >
                      <img 
                        src={getAssetSrc(`asset/${seq.img}`)} 
                        alt={seq.name}
                        class="thumbnail sequence-thumb"
                      />
                    </button>
                    <button 
                      class="thumb-open-btn"
                      onclick={() => openAssetFile(`asset/${seq.img}`)}
                      title={_("resource.openFile")}
                    >
                      📂
                    </button>
                  </div>
                  <div class="asset-info">
                    <div class="asset-name">{seq.name}</div>
                    <div class="asset-file">{seq.img}</div>
                    <div class="asset-meta">
                      <span title="{_("resource.frameLayout")}">{seq.frame_num_x}×{seq.frame_num_y} = {totalFrames}{_("resource.frames")}</span>
                      <span title="{_("resource.frameSize")}">{seq.frame_size_x}×{seq.frame_size_y}px</span>
                    </div>
                    <div class="asset-meta">
                      <span title="{_("resource.frameInterval")}">{seq.frame_time}s{_("resource.perFrame")}</span>
                      <span title="{_("resource.totalDuration")}">≈{totalDuration}s</span>
                    </div>
                    <div class="asset-flags">
                      {#if seq.origin_reverse}
                        <span class="badge reverse">{_("resource.reversePlay")}</span>
                      {/if}
                      {#if seq.need_reverse}
                        <span class="badge pingpong">{_("resource.pingPongMode")}</span>
                      {/if}
                      {#if seq.offset_x !== 0 || seq.offset_y !== 0}
                        <span class="badge offset">{_("resource.offset")} {seq.offset_x},{seq.offset_y}</span>
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </details>

        <!-- 语音资源 -->
        <details>
          <summary>{_("resource.audioResources")} ({getTotalAudios()})</summary>
          <div class="tab-content">
            {#each Object.entries(currentModInfo.audios) as [lang, audios]}
              <details class="lang-details" open>
                <summary class="lang-summary">{lang} ({audios.length})</summary>
                <div class="audio-grid">
                  {#each audios as audio}
                    <div class="audio-card" class:playing={playingAudioName === `${lang}/${audio.name}`}>
                      <button 
                        class="play-btn"
                        onclick={() => playAudio(audio.audio, `${lang}/${audio.name}`)}
                        title={playingAudioName === `${lang}/${audio.name}` ? _("common.stop") : _("common.play")}
                      >
                        {#if playingAudioName === `${lang}/${audio.name}`}
                          <span class="icon">⏹</span>
                        {:else}
                          <span class="icon">▶</span>
                        {/if}
                      </button>
                      <div class="audio-info">
                        <div class="audio-name">{audio.name}</div>
                        <div class="audio-file">{audio.audio}</div>
                      </div>
                      <button 
                        class="open-btn"
                        onclick={() => openAssetFile(`audio/${audio.audio}`)}
                        title={_("resource.openFile")}
                      >
                        📂
                      </button>
                    </div>
                  {/each}
                </div>
              </details>
            {/each}
          </div>
        </details>

        <!-- 对话文本 -->
        <details>
          <summary>{_("resource.dialogTexts")} ({getTotalTexts()})</summary>
          <div class="tab-content">
            {#each Object.entries(currentModInfo.texts) as [lang, texts]}
              <details class="lang-details" open>
                <summary class="lang-summary">{lang} ({texts.length})</summary>
                <div class="text-list">
                  {#each texts as text}
                    <div class="text-card">
                      <div class="text-header">
                        <span class="text-name">{text.name}</span>
                        <span class="text-duration">{text.duration}s</span>
                      </div>
                      <div class="text-body">{text.text}</div>
                    </div>
                  {/each}
                </div>
              </details>
            {/each}
          </div>
        </details>
      </div>
    </div>
  {/if}
</div>

<!-- 图片查看器弹窗 -->
{#if viewerVisible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="image-viewer-overlay" onclick={closeImageViewer}>
    <div class="image-viewer-content" onclick={(e) => e.stopPropagation()}>
      <div class="viewer-header">
        <span class="viewer-title">{viewerImageTitle}</span>
        <button class="viewer-close" onclick={closeImageViewer}>✕</button>
      </div>
      <div class="viewer-body">
        <img src={viewerImageSrc} alt={viewerImageTitle} class="viewer-image" />
      </div>
    </div>
  </div>
{/if}

<style>
  .debug-panel {
    background: #ffffff;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
    width: 700px;
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

  h5 {
    margin: 12px 0 6px 0;
    color: #2c3e50;
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
    padding: 8px 12px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    font-weight: 600;
    transition: all 0.2s;
    background: #ecf0f1;
  }

  button:hover:not(:disabled) {
    background: #ddd;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .primary {
    background: #3498db;
    color: white;
    flex: 1;
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
    max-height: 650px;
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

  .info-header h4 {
    margin: 0;
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

  /* 统计概览 */
  .stats-bar {
    display: flex;
    gap: 8px;
    margin-bottom: 15px;
    flex-wrap: wrap;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    background: white;
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid #eee;
    min-width: 60px;
  }

  .stat-value {
    font-size: 1.4em;
    font-weight: bold;
    color: #3498db;
  }

  .stat-label {
    font-size: 0.75em;
    color: #7f8c8d;
  }

  /* 详情折叠 */
  details {
    margin-bottom: 8px;
    border: 1px solid #eee;
    border-radius: 6px;
    background: white;
  }

  summary {
    padding: 10px 12px;
    cursor: pointer;
    font-weight: bold;
    background: #f5f6f7;
    border-radius: 6px;
    user-select: none;
  }

  details[open] summary {
    border-bottom: 1px solid #eee;
    border-radius: 6px 6px 0 0;
  }

  .tab-content {
    padding: 12px;
  }

  /* 信息网格 */
  .info-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .info-grid.compact {
    grid-template-columns: repeat(3, 1fr);
  }

  .info-row {
    display: flex;
    flex-direction: column;
    background: #f9f9f9;
    padding: 6px 10px;
    border-radius: 4px;
  }

  .info-label {
    font-size: 0.75em;
    color: #7f8c8d;
    margin-bottom: 2px;
  }

  .info-value {
    font-weight: 500;
  }

  /* 语言卡片 */
  .lang-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 10px;
  }

  .lang-card {
    display: flex;
    align-items: center;
    gap: 10px;
    background: #f9f9f9;
    padding: 10px;
    border-radius: 6px;
    border: 1px solid #eee;
  }

  .lang-code {
    background: #34495e;
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.8em;
    font-weight: bold;
  }

  .lang-info {
    flex: 1;
  }

  .char-name {
    font-weight: bold;
    color: #2c3e50;
  }

  .char-meta {
    font-size: 0.8em;
    color: #7f8c8d;
    display: flex;
    gap: 10px;
  }

  .char-desc {
    font-size: 0.8em;
    color: #555;
    margin-top: 4px;
    font-style: italic;
  }

  /* 状态列表 */
  .state-list, .trigger-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .state-card {
    background: #f9f9f9;
    border: 1px solid #eee;
    border-left: 4px solid #95a5a6;
    padding: 10px;
    border-radius: 6px;
  }

  .state-card.persistent {
    border-left-color: #27ae60;
  }

  .state-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .state-name {
    font-weight: bold;
    color: #2c3e50;
  }

  .badge {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.7em;
    font-weight: bold;
  }

  .badge.persistent { background: #27ae60; color: white; }
  .badge.priority { background: #f39c12; color: white; }
  .badge.reverse { background: #e74c3c; color: white; }
  .badge.pingpong { background: #9b59b6; color: white; }
  .badge.offset { background: #3498db; color: white; }
  .badge.sequence-flag { background: #f1c40f; color: #2c3e50; }

  .state-detail {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.9em;
  }

  .detail-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }

  .detail-label {
    color: #7f8c8d;
    min-width: 50px;
  }

  .tag-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .tag {
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.8em;
    background: #ecf0f1;
    border: 1px solid #bdc3c7;
  }

  .tag.state-tag { background: #e8f6f3; border-color: #1abc9c; color: #16a085; }

  /* 状态分类折叠 */
  .state-category {
    margin-bottom: 10px;
    border: none;
    background: transparent;
  }

  .category-summary {
    padding: 8px 12px;
    font-weight: bold;
    border-radius: 6px;
    font-size: 0.9em;
  }

  .category-summary.persistent-cat {
    background: #d5f5e3;
    border-left: 4px solid #27ae60;
  }

  .category-summary.non-persistent-cat {
    background: #eaecee;
    border-left: 4px solid #95a5a6;
  }

  .state-category[open] .category-summary {
    border-radius: 6px 6px 0 0;
    margin-bottom: 8px;
  }

  /* 语言折叠 */
  .lang-details {
    margin-bottom: 10px;
    border: none;
    background: transparent;
    border-left: 3px solid #3498db;
    padding-left: 8px;
  }

  .lang-summary {
    padding: 6px 10px;
    font-weight: bold;
    font-size: 0.9em;
    background: #ebf5fb;
    border-radius: 4px;
    cursor: pointer;
  }

  .lang-details[open] .lang-summary {
    margin-bottom: 8px;
  }

  /* 分支列表 */
  .branch-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .branch-item {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #fef5e7;
    border: 1px solid #f39c12;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 0.9em;
  }

  .branch-text {
    color: #d68910;
    font-weight: 500;
  }

  .branch-arrow {
    color: #95a5a6;
  }

  .branch-next {
    color: #16a085;
    font-weight: 600;
  }

  /* 触发器 */
  .trigger-card {
    background: #f9f9f9;
    border: 1px solid #eee;
    border-left: 4px solid #9b59b6;
    padding: 10px;
    border-radius: 6px;
  }

  .trigger-event {
    font-weight: bold;
    color: #8e44ad;
    display: block;
    margin-bottom: 6px;
  }

  .trigger-states {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .trigger-groups {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
  }

  .trigger-group {
    background: rgba(0, 0, 0, 0.03);
    border-radius: 6px;
    padding: 8px;
    border: 1px solid #e0e0e0;
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .group-label {
    font-size: 0.75em;
    font-weight: bold;
    color: #7f8c8d;
  }

  .persistent-badge {
    font-size: 0.75em;
    background: #27ae60;
    color: white;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .persistent-badge.any {
    background: #95a5a6;
  }

  .no-states {
    font-size: 0.85em;
    color: #95a5a6;
    font-style: italic;
  }

  /* 资源网格 */
  .asset-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
  }

  .asset-card-with-thumb {
    background: #f9f9f9;
    border: 1px solid #eee;
    border-radius: 8px;
    overflow: hidden;
  }

  .asset-card-with-thumb.sequence {
    border-left: 4px solid #f1c40f;
  }

  .asset-card-with-thumb.animated {
    border-left: 4px solid #e67e22;
  }

  .thumb-container {
    position: relative;
  }

  .thumbnail-btn {
    width: 100%;
    padding: 0;
    background: #e8e8e8;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100px;
    overflow: hidden;
  }

  .thumbnail-btn:hover {
    background: #ddd;
  }

  .thumb-open-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 24px;
    height: 24px;
    padding: 0;
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.7;
    transition: opacity 0.2s;
  }

  .thumb-open-btn:hover {
    opacity: 1;
    background: white;
  }

  .thumbnail {
    max-width: 100%;
    max-height: 100px;
    object-fit: contain;
  }

  .sequence-thumb {
    max-width: 150%;
    object-fit: cover;
    object-position: left top;
  }

  .asset-info {
    padding: 8px;
  }

  .asset-name {
    font-weight: bold;
    color: #2980b9;
    word-break: break-all;
    margin-bottom: 2px;
  }

  .asset-file {
    color: #7f8c8d;
    font-size: 0.8em;
    word-break: break-all;
  }

  .asset-meta {
    margin-top: 4px;
    color: #95a5a6;
    font-size: 0.75em;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .asset-flags {
    margin-top: 4px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  /* 音频网格 */
  .audio-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 8px;
  }

  .audio-card {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #f9f9f9;
    border: 1px solid #eee;
    border-radius: 6px;
    padding: 8px;
    transition: all 0.2s;
  }

  .audio-card.playing {
    background: #e8f6f3;
    border-color: #1abc9c;
  }

  .play-btn {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: #3498db;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 0;
  }

  .play-btn:hover {
    background: #2980b9;
  }

  .audio-card.playing .play-btn {
    background: #e74c3c;
  }

  .audio-card.playing .play-btn:hover {
    background: #c0392b;
  }

  .icon {
    font-size: 14px;
  }

  .audio-info {
    flex: 1;
    min-width: 0;
  }

  .audio-name {
    font-weight: bold;
    color: #2c3e50;
    word-break: break-all;
  }

  .audio-file {
    font-size: 0.75em;
    color: #7f8c8d;
    word-break: break-all;
  }

  .open-btn {
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    border: 1px solid #ddd;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .open-btn:hover {
    background: #eee;
  }

  /* 文本列表 */
  .text-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .text-card {
    background: #f9f9f9;
    border: 1px solid #eee;
    border-radius: 6px;
    padding: 10px;
  }

  .text-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }

  .text-name {
    font-weight: bold;
    color: #2c3e50;
  }

  .text-duration {
    font-size: 0.75em;
    color: #7f8c8d;
    background: #eee;
    padding: 2px 6px;
    border-radius: 3px;
  }

  .text-body {
    color: #555;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  /* 图片查看器 */
  .image-viewer-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  }

  .image-viewer-content {
    background: white;
    border-radius: 12px;
    max-width: 90vw;
    max-height: 90vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .viewer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid #eee;
    background: #f8f9fa;
  }

  .viewer-title {
    font-weight: bold;
    color: #2c3e50;
  }

  .viewer-close {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: #e74c3c;
    color: white;
    font-size: 16px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .viewer-close:hover {
    background: #c0392b;
  }

  .viewer-body {
    padding: 20px;
    overflow: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f0f0f0;
  }

  .viewer-image {
    max-width: 100%;
    max-height: 75vh;
    object-fit: contain;
  }

  /* 暗色主题 */
  @media (prefers-color-scheme: dark) {
    .debug-panel {
      background: #2c3e50;
      color: #ecf0f1;
    }
    h3, h4, h5 { color: #ecf0f1; }
    h3 { border-bottom-color: #34495e; }
    
    select {
      background: #34495e;
      color: white;
      border-color: #455a64;
    }
    
    .status-bar { background: #34495e; }
    .info-panel { background: #34495e; }
    .path-info { background: #34495e; color: #bdc3c7; }
    
    details { background: #2c3e50; border-color: #455a64; }
    summary { background: #3e5871; color: #ecf0f1; }
    
    .stat-item { background: #3e5871; border-color: #455a64; }
    .info-row { background: #3e5871; }
    .lang-card { background: #3e5871; border-color: #455a64; }
    .char-name { color: #ecf0f1; }
    .char-desc { color: #95a5a6; }
    
    .state-card, .trigger-card { background: #3e5871; border-color: #455a64; }
    .state-name { color: #ecf0f1; }
    .trigger-event { color: #bb8fce; }
    
    .asset-card-with-thumb { background: #3e5871; border-color: #455a64; }
    .thumbnail-btn { background: #2c3e50; }
    .thumbnail-btn:hover { background: #34495e; }
    .asset-name { color: #5dade2; }
    
    .audio-card { background: #3e5871; border-color: #455a64; }
    .audio-card.playing { background: #1e4d3d; border-color: #1abc9c; }
    .audio-name { color: #ecf0f1; }
    
    .text-card { background: #3e5871; border-color: #455a64; }
    .text-name { color: #ecf0f1; }
    .text-body { color: #bdc3c7; }
    .text-duration { background: #2c3e50; }
    
    .path-badge { background: #455a64; color: #bdc3c7; }
    .tag { background: #455a64; border-color: #546e7a; color: #ecf0f1; }
    
    .trigger-group { background: rgba(255, 255, 255, 0.05); border-color: #455a64; }
    .branch-item { background: #4a3d1e; border-color: #d68910; }
    .branch-text { color: #f1c40f; }
    .branch-next { color: #2ecc71; }
    
    .category-summary.persistent-cat { background: #1e4d3d; }
    .category-summary.non-persistent-cat { background: #3e5871; }
    .lang-summary { background: #2e4a62; }
    .lang-details { border-left-color: #5dade2; }
    
    .thumb-open-btn { background: rgba(60, 60, 60, 0.9); border-color: #555; color: white; }
    .thumb-open-btn:hover { background: #444; }
    
    .image-viewer-content { background: #2c3e50; }
    .viewer-header { background: #34495e; border-bottom-color: #455a64; }
    .viewer-title { color: #ecf0f1; }
    .viewer-body { background: #1a252f; }
  }
</style>
