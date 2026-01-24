<!--
========================================================================= 
调试主页面 (+page.svelte)
=========================================================================

功能概述:
- 应用的主调试页面，提供 Tab 导航界面
- 集成多个调试组件：资源管理、状态管理、触发器、环境信息、媒体监听、用户设置、运行状态
- 使用 Svelte 5 的 $state 响应式状态管理 Tab 切换

组件结构:
├── ResourceManagerDebugger - 资源管理调试器
├── StateDebugger          - 状态管理调试器
├── TriggerDebugger        - 触发器调试器
├── EnvironmentDebugger    - 环境信息调试器
├── MediaDebugger          - 媒体监听调试器
├── Settings               - 用户设置面板
└── InfoDebugger           - 运行状态信息
=========================================================================
-->

<script lang="ts">
  // ======================================================================= //
  // 组件导入
  // ======================================================================= //

  import { onMount, onDestroy } from "svelte";
  import ResourceManagerDebugger from "$lib/components/ResourceManagerDebugger.svelte";
  import StateDebugger from "$lib/components/StateDebugger.svelte";
  import TriggerDebugger from "$lib/components/TriggerDebugger.svelte";
  import EnvironmentDebugger from "$lib/components/EnvironmentDebugger.svelte";
  import MediaDebugger from "$lib/components/MediaDebugger.svelte";
  import SystemDebugger from "$lib/components/SystemDebugger.svelte";
  import Settings from "$lib/components/Settings.svelte";
  import InfoDebugger from "$lib/components/InfoDebugger.svelte";
  import { t, initI18n, destroyI18n, onLangChange } from "$lib/i18n";

  // ======================================================================= //
  // 响应式状态
  // ======================================================================= //

  /** 当前激活的 Tab 页签标识 */
  let activeTab = $state("resource");

  /** i18n 响应式翻译函数 - 使用版本号触发更新 */
  let _langVersion = $state(0);
  let unsubLang: (() => void) | null = null;

  /** 响应式翻译函数 */
  function _(key: string, params?: Record<string, string | number>): string {
    // 依赖 _langVersion 使 Svelte 能追踪变化
    void _langVersion;
    return t(key, params);
  }

  // ======================================================================= //
  // 生命周期
  // ======================================================================= //

  onMount(async () => {
    unsubLang = onLangChange(() => {
      _langVersion++;
    });
    await initI18n();
    // 初始化完成后强制触发一次更新，确保标签页文本使用保存的语言
    _langVersion++;
  });

  onDestroy(() => {
    unsubLang?.();
    destroyI18n();
  });
</script>

<!-- ======================================================================= -->
<!-- 主容器布局 -->
<!-- ======================================================================= -->

<main class="container">
  <!-- Tab 导航栏 -->
  <div class="tabs-nav">
    <button
      class:active={activeTab === "resource"}
      onclick={() => (activeTab = "resource")}>{_("tabs.resource")}</button
    >
    <button
      class:active={activeTab === "state"}
      onclick={() => (activeTab = "state")}>{_("tabs.state")}</button
    >
    <button
      class:active={activeTab === "trigger"}
      onclick={() => (activeTab = "trigger")}>{_("tabs.trigger")}</button
    >
    <button
      class:active={activeTab === "environment"}
      onclick={() => (activeTab = "environment")}
      >{_("tabs.environment")}</button
    >
    <button
      class:active={activeTab === "media"}
      onclick={() => (activeTab = "media")}>{_("tabs.media")}</button
    >
    <button
      class:active={activeTab === "system"}
      onclick={() => (activeTab = "system")}>{_("tabs.system")}</button
    >
    <button
      class:active={activeTab === "settings"}
      onclick={() => (activeTab = "settings")}>{_("tabs.settings")}</button
    >
    <button
      class:active={activeTab === "info"}
      onclick={() => (activeTab = "info")}>{_("tabs.runtime")}</button
    >
  </div>

  <!-- Tab 内容区域 - 根据 activeTab 动态渲染对应组件 -->
  <div class="tab-content">
    {#if activeTab === "resource"}
      <ResourceManagerDebugger />
    {:else if activeTab === "state"}
      <StateDebugger />
    {:else if activeTab === "trigger"}
      <TriggerDebugger />
    {:else if activeTab === "environment"}
      <EnvironmentDebugger />
    {:else if activeTab === "media"}
      <MediaDebugger />
    {:else if activeTab === "system"}
      <SystemDebugger />
    {:else if activeTab === "settings"}
      <Settings />
    {:else if activeTab === "info"}
      <InfoDebugger />
    {/if}
  </div>
</main>

<!-- ======================================================================= -->
<!-- 样式定义 -->
<!-- ======================================================================= -->

<style>
  /* ----------------------------------------------------------------------- */
  /* Tab 导航栏样式 */
  /* ----------------------------------------------------------------------- */

  .tabs-nav {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin-bottom: 20px;
  }

  .tabs-nav button {
    box-shadow: none;
    background: #eee;
    color: #666;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
  }

  /* 激活状态的 Tab 按钮 */
  .tabs-nav button.active {
    background: #3498db;
    color: white;
  }

  /* ----------------------------------------------------------------------- */
  /* 全局根样式 */
  /* ----------------------------------------------------------------------- */

  :root {
    font-family: Inter, Avenir, Helvetica, Arial, sans-serif;
    font-size: 16px;
    line-height: 24px;
    font-weight: 400;

    color: #0f0f0f;
    background-color: #f6f6f6;

    /* 字体渲染优化 */
    font-synthesis: none;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    -webkit-text-size-adjust: 100%;
  }

  /* ----------------------------------------------------------------------- */
  /* 容器布局 */
  /* ----------------------------------------------------------------------- */

  .container {
    margin: 0;
    padding-top: 10vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    text-align: center;
  }

  /* ----------------------------------------------------------------------- */
  /* 深色模式适配 */
  /* ----------------------------------------------------------------------- */

  @media (prefers-color-scheme: dark) {
    :root {
      color: #f6f6f6;
      background-color: #2f2f2f;
    }
  }
</style>
