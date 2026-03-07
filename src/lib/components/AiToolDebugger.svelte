<!--
========================================================================= 
AI 工具管理器调试组件 (AiToolDebugger.svelte)
=========================================================================

功能概述:
- 显示 AI 工具管理器的运行时状态
- 实时监控匹配的进程、工具启用状态、后台任务
- 支持后端推送自动刷新
=========================================================================
-->

<script lang="ts">
    import { invoke } from "@tauri-apps/api/core";
    import { onMount } from "svelte";
    import { listen } from "@tauri-apps/api/event";
    import { t, onLangChange } from "$lib/i18n";
    import { isError } from "$lib/utils/statusMessage";

    // ======================================================================= //
    // i18n 响应式支持
    // ======================================================================= //

    let _langVersion = $state(0);
    let unsubLang: (() => void) | null = null;

    function _(key: string, params?: Record<string, string | number>): string {
        void _langVersion;
        return t(key, params);
    }

    // ======================================================================= //
    // 类型定义
    // ======================================================================= //

    interface AiToolDebugItem {
        name: string;
        enabled: boolean;
        has_task: boolean;
        task_id: string | null;
    }

    interface AiToolDebugInfo {
        matched_process: string | null;
        tools: AiToolDebugItem[];
        active_task_count: number;
        last_update_time: string;
    }

    // ======================================================================= //
    // 响应式状态
    // ======================================================================= //

    let debugInfo = $state<AiToolDebugInfo | null>(null);
    let statusMsg = $state("");

    // ======================================================================= //
    // 数据加载
    // ======================================================================= //

    async function loadDebugInfo() {
        try {
            debugInfo = await invoke("get_ai_tool_debug_info");
            if (debugInfo) {
                statusMsg = `${_("aiToolDebug.statusUpdated")} ${debugInfo.last_update_time}`;
            } else {
                statusMsg = _("aiToolDebug.statusWaiting");
            }
        } catch (e) {
            statusMsg = `${_("common.loadFailed")} ${e}`;
        }
    }

    async function init() {
        statusMsg = _("aiToolDebug.statusReading");
        await loadDebugInfo();

        const unlisten = await listen<AiToolDebugInfo>(
            "ai-tool-debug-update",
            (event) => {
                debugInfo = event.payload;
                statusMsg = `${_("aiToolDebug.statusUpdated")} ${debugInfo.last_update_time}`;
            },
        );

        return unlisten;
    }

    // ======================================================================= //
    // 生命周期
    // ======================================================================= //

    onMount(() => {
        unsubLang = onLangChange(() => {
            _langVersion++;
        });

        let unlisten: (() => void) | undefined;

        init()
            .then((u) => (unlisten = u))
            .catch((err) => {
                console.error("AiToolDebugger init error:", err);
                statusMsg = `${_("common.failed")} ${err}`;
            });

        return () => {
            if (unlisten) unlisten();
            unsubLang?.();
        };
    });
</script>

<!-- ======================================================================= -->
<!-- 组件模板 -->
<!-- ======================================================================= -->

<div class="ai-tool-debugger">
    <div class="header">
        <h4>{_("aiToolDebug.title")}</h4>
        <div class="controls">
            <button class="refresh-btn" onclick={loadDebugInfo}
                >{_("common.refresh")}</button
            >
            <span class="auto-refresh-badge">{_("aiToolDebug.autoUpdate")}</span>
        </div>
    </div>

    {#if debugInfo}
        <!-- 基础状态 -->
        <section class="section">
            <h5>{_("aiToolDebug.managerStatus")}</h5>
            <div class="info-grid">
                <div class="info-item">
                    <span class="label">{_("aiToolDebug.matchedProcess")}</span>
                    <span class="value mono">
                        {debugInfo.matched_process || _("aiToolDebug.noMatch")}
                    </span>
                </div>
                <div class="info-item">
                    <span class="label">{_("aiToolDebug.activeTaskCount")}</span>
                    <span class="value" class:running={debugInfo.active_task_count > 0}>
                        {debugInfo.active_task_count}
                    </span>
                </div>
                <div class="info-item">
                    <span class="label">{_("aiToolDebug.toolCount")}</span>
                    <span class="value">
                        {debugInfo.tools.length}
                    </span>
                </div>
                <div class="info-item">
                    <span class="label">{_("aiToolDebug.lastUpdate")}</span>
                    <span class="value">{debugInfo.last_update_time}</span>
                </div>
            </div>
        </section>

        <!-- 工具列表 -->
        <section class="section">
            <h5>{_("aiToolDebug.toolList")}</h5>
            {#if debugInfo.tools.length > 0}
                <div class="tool-table">
                    <div class="tool-row tool-header">
                        <span class="tool-cell name-cell">{_("aiToolDebug.toolName")}</span>
                        <span class="tool-cell">{_("aiToolDebug.enabled")}</span>
                        <span class="tool-cell">{_("aiToolDebug.hasTask")}</span>
                        <span class="tool-cell">{_("aiToolDebug.taskId")}</span>
                    </div>
                    {#each debugInfo.tools as tool}
                        <div class="tool-row">
                            <span class="tool-cell name-cell mono">{tool.name}</span>
                            <span class="tool-cell">
                                <span class="badge" class:on={tool.enabled} class:off={!tool.enabled}>
                                    {tool.enabled ? _("common.on") : _("common.off")}
                                </span>
                            </span>
                            <span class="tool-cell">
                                <span class="badge" class:on={tool.has_task} class:off={!tool.has_task}>
                                    {tool.has_task ? _("common.running") : _("common.stopped")}
                                </span>
                            </span>
                            <span class="tool-cell mono">
                                {tool.task_id || "-"}
                            </span>
                        </div>
                    {/each}
                </div>
            {:else}
                <div class="empty-hint">{_("aiToolDebug.noTools")}</div>
            {/if}
        </section>

        <!-- 状态卡片 -->
        <section class="section">
            <h5>{_("aiToolDebug.overview")}</h5>
            <div class="status-cards">
                <div class="status-card" class:active={!!debugInfo.matched_process}>
                    <div class="card-icon">
                        {debugInfo.matched_process ? "🎯" : "❌"}
                    </div>
                    <div class="card-info">
                        <div class="card-title">{_("aiToolDebug.processMatch")}</div>
                        <div class="card-value mono">
                            {debugInfo.matched_process || _("aiToolDebug.noMatch")}
                        </div>
                    </div>
                </div>

                <div class="status-card" class:active={debugInfo.active_task_count > 0}>
                    <div class="card-icon">
                        {debugInfo.active_task_count > 0 ? "⚙️" : "💤"}
                    </div>
                    <div class="card-info">
                        <div class="card-title">{_("aiToolDebug.taskStatus")}</div>
                        <div class="card-value">
                            {debugInfo.active_task_count > 0
                                ? _("aiToolDebug.tasksRunning", { count: debugInfo.active_task_count })
                                : _("aiToolDebug.noTasks")}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    {:else}
        <div class="loading">{statusMsg}</div>
    {/if}

    <div class="mini-status" class:error={isError(statusMsg)}>
        {statusMsg}
    </div>
</div>

<style>
    .ai-tool-debugger {
        background: #f8f9fa;
        border: 1px solid #dee2e6;
        border-radius: 8px;
        padding: 15px;
        margin: 10px auto;
        max-width: 600px;
        font-size: 0.9em;
    }

    .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
    }

    h4 {
        margin: 0;
        color: #495057;
        border-left: 4px solid #9b59b6;
        padding-left: 10px;
    }

    h5 {
        margin: 0 0 10px 0;
        color: #6c757d;
        font-size: 0.95em;
    }

    .controls {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .refresh-btn {
        padding: 5px 12px;
        background: #9b59b6;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.85em;
    }

    .refresh-btn:hover {
        background: #8e44ad;
    }

    .auto-refresh-badge {
        font-size: 0.85em;
        color: #27ae60;
        background: #e8f8f5;
        padding: 2px 8px;
        border-radius: 12px;
        border: 1px solid #27ae60;
    }

    .section {
        background: white;
        border-radius: 6px;
        padding: 12px;
        margin-bottom: 12px;
        border: 1px solid #e9ecef;
    }

    .info-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 8px;
    }

    .info-item {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .info-item .label {
        font-size: 0.8em;
        color: #868e96;
    }

    .info-item .value {
        font-weight: 600;
        color: #495057;
    }

    .info-item .value.mono,
    .card-value.mono,
    .name-cell.mono {
        font-family: "Consolas", "Monaco", "Courier New", monospace;
        font-size: 0.85em;
        word-break: break-all;
    }

    .info-item .value.running {
        color: #2ecc71;
    }

    /* 工具表格 */
    .tool-table {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .tool-row {
        display: grid;
        grid-template-columns: 1fr 80px 80px 80px;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 4px;
        align-items: center;
    }

    .tool-row:nth-child(even) {
        background: #f8f9fa;
    }

    .tool-header {
        font-weight: 600;
        font-size: 0.8em;
        color: #868e96;
        border-bottom: 1px solid #e9ecef;
        padding-bottom: 6px;
    }

    .tool-cell {
        text-align: center;
    }

    .tool-cell.name-cell {
        text-align: left;
    }

    .badge {
        display: inline-block;
        padding: 1px 8px;
        border-radius: 10px;
        font-size: 0.8em;
        font-weight: 600;
    }

    .badge.on {
        background: #e8f5e9;
        color: #2e7d32;
        border: 1px solid #a5d6a7;
    }

    .badge.off {
        background: #fce4ec;
        color: #c62828;
        border: 1px solid #ef9a9a;
    }

    .empty-hint {
        text-align: center;
        padding: 20px;
        color: #adb5bd;
        font-size: 0.9em;
    }

    /* 状态卡片 */
    .status-cards {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
    }

    .status-card {
        flex: 1;
        min-width: 140px;
        background: #f8f9fa;
        border: 1px solid #dee2e6;
        border-radius: 6px;
        padding: 10px;
        display: flex;
        align-items: center;
        gap: 10px;
        transition: all 0.3s ease;
    }

    .status-card.active {
        background: #f3e5f5;
        border-color: #ce93d8;
    }

    .card-icon {
        font-size: 1.5em;
    }

    .card-info {
        display: flex;
        flex-direction: column;
    }

    .card-title {
        font-size: 0.75em;
        color: #868e96;
    }

    .card-value {
        font-weight: 600;
        color: #495057;
        font-size: 0.9em;
    }

    .loading {
        text-align: center;
        padding: 40px;
        color: #6c757d;
    }

    .mini-status {
        margin-top: 10px;
        font-size: 0.8em;
        text-align: right;
        color: #2ecc71;
    }

    .mini-status.error {
        color: #e74c3c;
    }

    @media (prefers-color-scheme: dark) {
        .ai-tool-debugger {
            background: #34495e;
            border-color: #455a64;
        }

        h4,
        h5 {
            color: #ecf0f1;
        }

        .section {
            background: #2c3e50;
            border-color: #455a64;
        }

        .info-item .label {
            color: #95a5a6;
        }
        .info-item .value {
            color: #ecf0f1;
        }

        .tool-row:nth-child(even) {
            background: #3d5a6c;
        }

        .tool-header {
            color: #95a5a6;
            border-color: #455a64;
        }

        .badge.on {
            background: #1e4620;
            color: #81c784;
            border-color: #2e7d32;
        }

        .badge.off {
            background: #4a1c1c;
            color: #ef9a9a;
            border-color: #c62828;
        }

        .empty-hint {
            color: #7f8c8d;
        }

        .status-card {
            background: #3d5a6c;
            border-color: #455a64;
        }

        .status-card.active {
            background: #4a1e5e;
            border-color: #8e44ad;
        }

        .card-title {
            color: #95a5a6;
        }
        .card-value {
            color: #ecf0f1;
        }

        .loading {
            color: #7f8c8d;
        }
    }
</style>
