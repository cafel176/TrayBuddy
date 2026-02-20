<!--
========================================================================= 
渲染窗口布局监视器 (LayoutDebugger.svelte)
=========================================================================

功能概述:
- 监视当前活跃渲染窗口（Sequence / Live2D / PngRemix / 3D）的布局信息
- 显示当前窗口类型和画布元素的尺寸、层级等详细数据
- 提供跨窗口控制，实现可视化调试边框切换
- 与渲染窗口通过 Tauri 事件进行实时数据同步
=========================================================================
-->

<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { listen, emit } from "@tauri-apps/api/event";
    import { t, onLangChange } from "$lib/i18n";

    /** 画布布局信息接口 */
    interface CanvasLayoutInfo {
        name: string;
        width: number;
        height: number;
        displayWidth: number;
        displayHeight: number;
        zIndex: string;
        visibility: string;
        opacity: string;
    }

    /** 布局信息事件载荷（含窗口类型） */
    interface LayoutInfoPayload {
        windowType: string;
        canvases: CanvasLayoutInfo[];
    }

    type WindowType = "sequence" | "live2d" | "pngremix" | "3d";

    // ======================================================================= //
    // 响应式状态
    // ======================================================================= //

    /** 调试边框状态 */
    let debugBorders = $state(false);

    /** 当前检测到的渲染窗口类型 */
    let currentWindowType = $state<WindowType | null>(null);

    /** 当前捕获到的画布信息 */
    let canvases = $state<CanvasLayoutInfo[]>([]);

    /** 是否处于加载状态 */
    let loading = $state(false);

    // i18n 响应式版本号
    let _langVersion = $state(0);
    let unsubLang: (() => void) | null = null;

    // 响应式翻译函数
    function _(key: string, params?: Record<string, string | number>): string {
        void _langVersion;
        return t(key, params);
    }

    // ======================================================================= //
    // 窗口类型相关工具函数
    // ======================================================================= //

    /** 获取窗口类型的显示文本 */
    function getWindowTypeLabel(wt: WindowType): string {
        switch (wt) {
            case "sequence": return _("layout.windowTypeSequence");
            case "live2d": return _("layout.windowTypeLive2D");
            case "pngremix": return _("layout.windowTypePngRemix");
            case "3d": return _("layout.windowType3D");
            default: return wt;
        }
    }

    /** 获取窗口类型对应的 badge 颜色 */
    function getWindowTypeBadgeClass(wt: WindowType): string {
        switch (wt) {
            case "sequence": return "badge-sequence";
            case "live2d": return "badge-live2d";
            case "pngremix": return "badge-pngremix";
            case "3d": return "badge-3d";
            default: return "";
        }
    }

    /** 获取画布名称的显示文本（根据窗口类型映射） */
    function getCanvasLabel(name: string): string {
        switch (name) {
            case "character": {
                // 根据窗口类型显示更具体的名称
                switch (currentWindowType) {
                    case "live2d": return _("layout.canvasLive2D");
                    case "pngremix": return _("layout.canvasPngRemix");
                    case "3d": return _("layout.canvas3D");
                    default: return _("layout.characterCanvas");
                }
            }
            case "border": return _("layout.borderCanvas");
            case "bubbleArea": return _("layout.bubbleArea");
            case "bubbleCanvas": return _("layout.bubbleCanvas");
            default: return name;
        }
    }

    /** 获取画布名称对应的图标 */
    function getCanvasIcon(name: string): string {
        switch (name) {
            case "character": {
                switch (currentWindowType) {
                    case "live2d": return "🎭";
                    case "pngremix": return "🧩";
                    case "3d": return "🎮";
                    default: return "🎬";
                }
            }
            case "border": return "🖼️";
            case "bubbleArea": return "☁️";
            case "bubbleCanvas": return "💬";
            default: return "📦";
        }
    }

    // ======================================================================= //
    // 功能函数
    // ======================================================================= //

    /**
     * 刷新布局信息
     * 向渲染窗口请求最新的 DOM/Canvas 数据
     */
    async function refreshLayout() {
        loading = true;
        canvases = [];
        currentWindowType = null;
        // 发送请求给渲染窗口
        await emit("request-layout-info");

        // 1秒后如果还没响应则结束加载状态
        setTimeout(() => {
            loading = false;
        }, 1000);
    }

    /**
     * 切换调试边框显示
     */
    async function toggleBorders() {
        debugBorders = !debugBorders;
        await emit("toggle-debug-borders", debugBorders);
    }

    // ======================================================================= //
    // 生命周期
    // ======================================================================= //

    onMount(() => {
        unsubLang = onLangChange(() => {
            _langVersion++;
        });

        let unlistenInfo: (() => void) | null = null;

        // 异步初始化
        const init = async () => {
            // 监听渲染窗口传回的布局数据（新格式：含 windowType）
            unlistenInfo = await listen<LayoutInfoPayload | CanvasLayoutInfo[]>(
                "layout-info",
                (event) => {
                    const payload = event.payload;
                    // 兼容旧格式（纯数组）和新格式（含 windowType）
                    if (Array.isArray(payload)) {
                        canvases = payload;
                        currentWindowType = null;
                    } else {
                        canvases = payload.canvases;
                        currentWindowType = (payload.windowType as WindowType) || null;
                    }
                    loading = false;
                },
            );

            // 初始加载
            refreshLayout();

            // 通知渲染窗口：布局调试页签已激活
            await emit("layout-debugger-status", true);
        };

        init();

        return () => {
            unlistenInfo?.();
            unsubLang?.();
            // 通知渲染窗口：布局调试页签已关闭
            emit("layout-debugger-status", false);
        };
    });
</script>

<div class="layout-debugger">
    <h3>{_("layout.title")}</h3>

    <!-- 当前窗口类型指示器 -->
    {#if currentWindowType}
        <div class="window-type-indicator">
            <span class="wt-label">{_("layout.currentWindowType")}</span>
            <span class="wt-badge {getWindowTypeBadgeClass(currentWindowType)}">
                {getWindowTypeLabel(currentWindowType)}
            </span>
        </div>
    {/if}

    <!-- 可视化控制区域 -->
    <div class="section controls">
        <h4>{_("layout.debugBorders")}</h4>
        <div class="control-card">
            <div class="control-info">
                <span class="label">{_("layout.enableBorders")}</span>
                <p class="hint">{_("layout.enableBordersHint")}</p>
            </div>
            <button
                class="toggle-btn"
                class:active={debugBorders}
                onclick={toggleBorders}
            >
                {debugBorders ? _("common.on") : _("common.off")}
            </button>
        </div>
    </div>

    <!-- 画布信息展示区域 -->
    <div class="section canvas-sec">
        <div class="section-header">
            <h4>{_("layout.canvasInfo")}</h4>
            <button class="btn-tiny" onclick={refreshLayout} disabled={loading}>
                {loading ? "..." : _("layout.refreshInfo")}
            </button>
        </div>

        {#if canvases.length > 0}
            <div class="canvas-grid">
                {#each canvases as canvas}
                    <div class="canvas-card">
                        <div class="card-title">
                            <span class="icon">
                                {getCanvasIcon(canvas.name)}
                            </span>
                            {getCanvasLabel(canvas.name)}
                        </div>
                        <div class="info-rows">
                            <div class="row">
                                <span class="k">{_("layout.canvasSize")}</span>
                                <span class="v"
                                    >{canvas.width} × {canvas.height}</span
                                >
                            </div>
                            <div class="row">
                                <span class="k"
                                    >{_("layout.canvasDisplay")}</span
                                >
                                <span class="v"
                                    >{canvas.displayWidth} × {canvas.displayHeight}</span
                                >
                            </div>
                            <div class="row">
                                <span class="k">{_("layout.canvasZIndex")}</span
                                >
                                <span class="v badge">{canvas.zIndex}</span>
                            </div>
                            <div class="row">
                                <span class="k">{_("layout.style")}</span>
                                <span class="v small"
                                    >{canvas.visibility} / {_("layout.opacity")}: {canvas.opacity}</span
                                >
                            </div>
                        </div>
                    </div>
                {/each}
            </div>
        {:else if loading}
            <div class="empty-state">
                <div class="loader"></div>
                <p>{_("layout.waitingInfo")}</p>
            </div>
        {:else}
            <div class="empty-state">
                <p>{_("layout.noRenderWindow")}</p>
            </div>
        {/if}
    </div>
</div>

<style>
    .layout-debugger {
        background: #ffffff;
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
        max-width: 600px;
        margin: 20px auto;
        color: #333;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        text-align: left;
    }

    h3 {
        margin-top: 0;
        color: #2c3e50;
        border-bottom: 2px solid #eee;
        padding-bottom: 10px;
        margin-bottom: 20px;
    }

    h4 {
        margin: 0 0 12px 0;
        color: #34495e;
        font-size: 0.95em;
    }

    .section {
        margin-bottom: 25px;
    }

    .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
    }

    /* ----------------------------------------------------------------------- */
    /* 窗口类型指示器 */
    /* ----------------------------------------------------------------------- */

    .window-type-indicator {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 20px;
        padding: 12px 16px;
        background: #f8f9fa;
        border-radius: 10px;
        border: 1px solid #e9ecef;
    }

    .wt-label {
        font-size: 0.85em;
        color: #95a5a6;
        font-weight: 500;
    }

    .wt-badge {
        padding: 4px 14px;
        border-radius: 20px;
        font-weight: 700;
        font-size: 0.85em;
        letter-spacing: 0.5px;
    }

    .badge-sequence {
        background: #e8f5e9;
        color: #2e7d32;
    }

    .badge-live2d {
        background: #e3f2fd;
        color: #1565c0;
    }

    .badge-pngremix {
        background: #fce4ec;
        color: #c62828;
    }

    .badge-3d {
        background: #f3e5f5;
        color: #7b1fa2;
    }

    /* ----------------------------------------------------------------------- */
    /* 控制卡片 */
    /* ----------------------------------------------------------------------- */

    .control-card {
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: #f8f9fa;
        padding: 15px;
        border-radius: 10px;
        border: 1px solid #e9ecef;
    }

    .control-info .label {
        display: block;
        font-weight: 600;
        font-size: 0.95em;
        margin-bottom: 4px;
        color: #2c3e50;
    }

    .control-info .hint {
        margin: 0;
        font-size: 0.75em;
        color: #95a5a6;
    }

    .toggle-btn {
        width: 60px;
        height: 32px;
        border-radius: 16px;
        border: none;
        background: #bdc3c7;
        color: white;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.3s;
    }

    .toggle-btn.active {
        background: #27ae60;
        box-shadow: 0 0 10px rgba(39, 174, 96, 0.4);
    }

    /* ----------------------------------------------------------------------- */
    /* 画布卡片 */
    /* ----------------------------------------------------------------------- */

    .canvas-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 15px;
    }

    .canvas-card {
        background: #ffffff;
        border: 1px solid #eee;
        border-radius: 8px;
        padding: 12px;
        transition: transform 0.2s;
    }

    .canvas-card:hover {
        border-color: #3498db;
        transform: translateY(-2px);
    }

    .card-title {
        font-weight: bold;
        font-size: 0.9em;
        color: #2980b9;
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        gap: 5px;
    }

    .info-rows {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .row {
        display: flex;
        justify-content: space-between;
        font-size: 0.75em;
        align-items: center;
    }

    .row .k {
        color: #95a5a6;
    }

    .row .v {
        color: #34495e;
        font-weight: 500;
    }

    .row .v.badge {
        background: #e1f5fe;
        color: #039be5;
        padding: 1px 6px;
        border-radius: 4px;
        font-weight: bold;
    }

    .row .v.small {
        font-size: 0.85em;
        color: #bdc3c7;
    }

    /* ----------------------------------------------------------------------- */
    /* 空状态和加载 */
    /* ----------------------------------------------------------------------- */

    .empty-state {
        text-align: center;
        padding: 40px 20px;
        background: #f8f9fa;
        border-radius: 10px;
        color: #bdc3c7;
    }

    .loader {
        width: 24px;
        height: 24px;
        border: 3px solid #eee;
        border-top: 3px solid #3498db;
        border-radius: 50%;
        margin: 0 auto 10px;
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .btn-tiny {
        padding: 4px 12px;
        font-size: 0.75em;
        background: #eee;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        color: #666;
    }

    .btn-tiny:hover:not(:disabled) {
        background: #3498db;
        color: white;
    }

    /* ----------------------------------------------------------------------- */
    /* 暗色模式适配 */
    /* ----------------------------------------------------------------------- */

    @media (prefers-color-scheme: dark) {
        .layout-debugger {
            background: #2c3e50;
            color: #ecf0f1;
        }

        h3 {
            color: #ecf0f1;
            border-bottom-color: #34495e;
        }

        h4 {
            color: #bdc3c7;
        }

        .window-type-indicator {
            background: #34495e;
            border-color: #455a64;
        }

        .wt-label {
            color: #95a5a6;
        }

        .badge-sequence {
            background: #1b5e20;
            color: #a5d6a7;
        }

        .badge-live2d {
            background: #0d47a1;
            color: #90caf9;
        }

        .badge-pngremix {
            background: #880e4f;
            color: #f48fb1;
        }

        .badge-3d {
            background: #4a148c;
            color: #ce93d8;
        }

        .control-card {
            background: #34495e;
            border-color: #455a64;
        }

        .control-info .label {
            color: #ecf0f1;
        }

        .canvas-card {
            background: #34495e;
            border-color: #455a64;
        }

        .row .v {
            color: #ecf0f1;
        }
        .row .v.badge {
            background: #2e4a62;
            color: #5dade2;
        }

        .empty-state {
            background: #34495e;
        }
    }
</style>
