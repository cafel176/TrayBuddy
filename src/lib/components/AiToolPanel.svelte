<!--
=========================================================================
AI 工具面板组件 (AiToolPanel.svelte)
=========================================================================

功能概述:
- 在角色挂件上方显示一个浮窗，列出当前匹配进程的所有 AI 工具
- 每个工具显示 checkbox、name、type
- checkbox 控制工具的开启/关闭
- auto_start 工具默认勾选

使用方式:
  <AiToolPanel
    visible={showAiToolPanel}
    tools={aiToolList}
    on:toggle={(e) => handleToggle(e.detail)}
  />
=========================================================================
-->

<script lang="ts">
  /** 面板中的单个工具项 */
  export interface AiToolItem {
    name: string;
    type: string;
    enabled: boolean;
  }

  /** 面板是否可见 */
  let { visible = false, tools = [], onToggle }: {
    visible: boolean;
    tools: AiToolItem[];
    onToggle?: (name: string, enabled: boolean) => void;
  } = $props();

  function handleCheckboxChange(toolName: string, e: Event) {
    const target = e.target as HTMLInputElement;
    onToggle?.(toolName, target.checked);
  }
</script>

{#if visible && tools.length > 0}
  <div class="ai-tool-panel">
    <div class="ai-tool-header">AI Tools</div>
    <div class="ai-tool-list">
      {#each tools as tool (tool.name)}
        <label class="ai-tool-item">
          <input
            type="checkbox"
            checked={tool.enabled}
            onchange={(e) => handleCheckboxChange(tool.name, e)}
          />
          <span class="ai-tool-name">{tool.name}</span>
          <span class="ai-tool-type">{tool.type}</span>
        </label>
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

    min-width: 140px;
    max-width: 220px;
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

  .ai-tool-item {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 2px 0;
    cursor: pointer;
    user-select: none;
    border-radius: 4px;
    transition: background 0.15s;
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
</style>
