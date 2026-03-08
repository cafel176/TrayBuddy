<!--
=========================================================================
AI 工具面板组件 (AiToolPanel.svelte)
=========================================================================

功能概述:
- 在角色挂件上方显示一个浮窗，列出当前匹配进程的所有 AI 工具
- 每个工具显示 checkbox、name、type
- checkbox 控制工具的开启/关闭
- auto_start 工具默认勾选
- 支持 show_info_window 的工具显示信息窗口控制 checkbox

使用方式:
  <AiToolPanel
    visible={showAiToolPanel}
    tools={aiToolList}
    onToggle={(name, enabled) => ...}
    onToggleInfoWindow={(name, visible) => ...}
  />
=========================================================================
-->

<script lang="ts">
  import { onMount } from "svelte";
  import { t, onLangChange } from "$lib/i18n";

  /** 面板中的单个工具项 */
  export interface AiToolItem {
    name: string;
    type: string;
    enabled: boolean;
    showInfoWindow: boolean;
    infoWindowVisible: boolean;
  }

  /** i18n 响应式支持 */
  let _langVersion = $state(0);
  let unsubLang: (() => void) | null = null;

  function _(key: string, params?: Record<string, string | number>): string {
    void _langVersion;
    return t(key, params);
  }

  /** 面板是否可见 */
  let { visible = false, tools = [], onToggle, onToggleInfoWindow }: {
    visible: boolean;
    tools: AiToolItem[];
    onToggle?: (name: string, enabled: boolean) => void;
    onToggleInfoWindow?: (name: string, visible: boolean) => void;
  } = $props();

  function handleCheckboxChange(toolName: string, e: Event) {
    const target = e.target as HTMLInputElement;
    onToggle?.(toolName, target.checked);
  }

  function handleInfoWindowChange(toolName: string, e: Event) {
    const target = e.target as HTMLInputElement;
    onToggleInfoWindow?.(toolName, target.checked);
  }

  onMount(() => {
    unsubLang = onLangChange(() => { _langVersion++; });
    return () => { unsubLang?.(); };
  });
</script>

{#if visible && tools.length > 0}
  <div class="ai-tool-panel">
    <div class="ai-tool-header">{_("aiTool.panelHeader")}</div>
    <div class="ai-tool-list">
      {#each tools as tool (tool.name)}
        <div class="ai-tool-item-group">
          <div class="ai-tool-row">
            <label class="ai-tool-item">
              <input
                type="checkbox"
                checked={tool.enabled}
                onchange={(e) => handleCheckboxChange(tool.name, e)}
              />
              <span class="ai-tool-name">{tool.name}</span>
              <span class="ai-tool-type">{tool.type}</span>
            </label>
            {#if tool.showInfoWindow && tool.enabled}
              <label class="ai-tool-info-toggle" title={_("aiTool.toggleInfoWindow")}>
                <input
                  type="checkbox"
                  checked={tool.infoWindowVisible}
                  onchange={(e) => handleInfoWindowChange(tool.name, e)}
                />
                <span class="ai-tool-info-label">📋</span>
              </label>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .ai-tool-panel {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 350;
    pointer-events: auto;

    min-width: 180px;
    max-width: 320px;
    width: max-content;
    padding: 6px 8px;
    border-radius: 8px;

    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.18);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);

    color: rgba(255, 255, 255, 0.92);
    font-size: 11px;
    line-height: 1.3;
  }

  .ai-tool-header {
    font-weight: 700;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.55);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
    padding-bottom: 3px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  }

  .ai-tool-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ai-tool-item-group {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .ai-tool-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .ai-tool-item {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 2px 0;
    cursor: pointer;
    user-select: none;
    border-radius: 4px;
    transition: background 0.15s;
    flex: 1;
    min-width: 0;
  }

  .ai-tool-item:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .ai-tool-item input[type="checkbox"] {
    width: 13px;
    height: 13px;
    margin: 0;
    cursor: pointer;
    accent-color: #4fc3f7;
    flex-shrink: 0;
  }

  .ai-tool-name {
    flex: 1;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.92);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ai-tool-type {
    font-size: 9px;
    padding: 1px 4px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.6);
    flex-shrink: 0;
  }

  .ai-tool-info-toggle {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 2px 4px;
    cursor: pointer;
    user-select: none;
    border-radius: 4px;
    transition: background 0.15s;
    flex-shrink: 0;
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    padding-left: 6px;
  }

  .ai-tool-info-toggle:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .ai-tool-info-toggle input[type="checkbox"] {
    width: 11px;
    height: 11px;
    margin: 0;
    cursor: pointer;
    accent-color: #81c784;
    flex-shrink: 0;
  }

  .ai-tool-info-label {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.55);
    line-height: 1;
  }
</style>
