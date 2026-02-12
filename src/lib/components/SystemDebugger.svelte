<!--
========================================================================= 
系统观察器调试组件 (SystemDebugger.svelte)
=========================================================================

功能概述:
- 显示系统观察器的详细状态信息
- 实时监控全屏/繁忙状态检测结果
- 显示自动免打扰逻辑的触发状态
=========================================================================
-->

<script lang="ts">
    import { invoke } from "@tauri-apps/api/core";
    import { onMount, onDestroy } from "svelte";
    import { listen } from "@tauri-apps/api/event";
    import { t, onLangChange } from "$lib/i18n";

    // ======================================================================= //
    // i18n 响应式支持
    // ======================================================================= //

    let _langVersion = $state(0);
    let unsubLang: (() => void) | null = null;

    function _(key: string, params?: Record<string, string | number>): string {
        void _langVersion;
        return t(key, params);
    }

    /** 检查状态消息是否包含错误信息 */
    function isError(msg: string): boolean {
        return msg.includes(_("common.failed")) || msg.includes("failed");
    }

    // ======================================================================= //
    // 类型定义
    // ======================================================================= //

    interface SystemDebugInfo {
        observer_running: boolean;
        last_check_time: string;
        is_fullscreen_busy: boolean;
        auto_dnd_enabled: boolean;
        is_auto_dnd_active: boolean;
        current_silence_mode: boolean;
        session_locked: boolean;
    }


    // ======================================================================= //
    // 响应式状态
    // ======================================================================= //

    let debugInfo = $state<SystemDebugInfo | null>(null);
    let statusMsg = $state("");

    // ======================================================================= //
    // 数据加载
    // ======================================================================= //

    async function loadDebugInfo() {
        try {
            debugInfo = await invoke("get_system_debug_info");
            if (debugInfo) {
                statusMsg = `${_("system.statusUpdated")} ${debugInfo.last_check_time}`;
            } else {
                statusMsg = _("system.statusWaiting");
            }
        } catch (e) {
            statusMsg = `${_("common.loadFailed")} ${e}`;
        }
    }

    async function init() {
        statusMsg = _("system.statusReading");
        await loadDebugInfo();

        // 监听后端推送的更新事件
        const unlisten = await listen<SystemDebugInfo>(
            "system-debug-update",
            (event) => {
                debugInfo = event.payload;
                statusMsg = `${_("system.statusUpdated")} ${debugInfo.last_check_time}`;
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
                console.error("SystemDebugger init error:", err);
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

<div class="system-debugger">
    <div class="header">
        <h4>{_("system.title")}</h4>
        <div class="controls">
            <button class="refresh-btn" onclick={loadDebugInfo}
                >{_("common.refresh")}</button
            >
            <span class="auto-refresh-badge">{_("system.autoUpdate")}</span>
        </div>
    </div>

    {#if debugInfo}
        <!-- 基础状态 -->
        <section class="section">
            <h5>{_("system.observerStatus")}</h5>
            <div class="info-grid">
                <div class="info-item">
                    <span class="label">{_("system.runningStatus")}</span>
                    <span
                        class="value"
                        class:running={debugInfo.observer_running}
                    >
                        {debugInfo.observer_running
                            ? _("common.running")
                            : _("common.stopped")}
                    </span>
                </div>
                <div class="info-item">
                    <span class="label">{_("system.lastCheck")}</span>
                    <span class="value">{debugInfo.last_check_time}</span>
                </div>
                <div class="info-item">
                    <span class="label">{_("system.autoDndSetting")}</span>
                    <span
                        class="value"
                        class:enabled={debugInfo.auto_dnd_enabled}
                    >
                        {debugInfo.auto_dnd_enabled
                            ? _("common.enabled")
                            : _("common.disabled")}
                    </span>
                </div>
                <div class="info-item">
                    <span class="label">{_("system.sessionLocked")}</span>
                    <span class="value">
                        {debugInfo.session_locked ? _("common.on") : _("common.off")}
                    </span>
                </div>

            </div>
        </section>

        <!-- 检测结果 -->
        <section class="section">
            <h5>{_("system.detectionResult")}</h5>
            <div class="status-cards">
                <div
                    class="status-card"
                    class:active={debugInfo.is_fullscreen_busy}
                >
                    <div class="card-icon">
                        {debugInfo.is_fullscreen_busy ? "🎮" : "🖥️"}
                    </div>
                    <div class="card-info">
                        <div class="card-title">
                            {_("system.fullscreenState")}
                        </div>
                        <div class="card-value">
                            {debugInfo.is_fullscreen_busy
                                ? _("system.fullscreenDetected")
                                : _("system.normalMode")}
                        </div>
                    </div>
                </div>

                <div
                    class="status-card"
                    class:active={debugInfo.is_auto_dnd_active}
                >
                    <div class="card-icon">
                        {debugInfo.is_auto_dnd_active ? "🤖" : "👤"}
                    </div>
                    <div class="card-info">
                        <div class="card-title">{_("system.autoTrigger")}</div>
                        <div class="card-value">
                            {debugInfo.is_auto_dnd_active
                                ? _("system.active")
                                : _("system.inactive")}
                        </div>
                    </div>
                </div>

                <div
                    class="status-card"
                    class:active={debugInfo.current_silence_mode}
                >
                    <div class="card-icon">
                        {debugInfo.current_silence_mode ? "🔇" : "🔊"}
                    </div>
                    <div class="card-info">
                        <div class="card-title">{_("system.currentDnd")}</div>
                        <div class="card-value">
                            {debugInfo.current_silence_mode
                                ? _("system.dndOn")
                                : _("system.dndOff")}
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
    .system-debugger {
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
        border-left: 4px solid #3498db;
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
        background: #3498db;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.85em;
    }

    .refresh-btn:hover {
        background: #2980b9;
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

    .info-item .value.running {
        color: #2ecc71;
    }

    .info-item .value.enabled {
        color: #3498db;
    }

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
        background: #e8f5e9;
        border-color: #a5d6a7;
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
        .system-debugger {
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

        .status-card {
            background: #3d5a6c;
            border-color: #455a64;
        }

        .status-card.active {
            background: #1e4620;
            border-color: #2e7d32;
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
