<script lang="ts">
    import { invoke, convertFileSrc } from "@tauri-apps/api/core";
    import { onMount, onDestroy } from "svelte";
    import { getCurrentWindow } from "@tauri-apps/api/window";
    import { listen } from "@tauri-apps/api/event";
    import { t, initI18n, destroyI18n, onLangChange } from "$lib/i18n";
    import { message } from "@tauri-apps/plugin-dialog";

    // ======================================================================= //
    // i18n
    // ======================================================================= //
    let _langVersion = $state(0);
    let unsubLang: (() => void) | null = null;
    function _(key: string, params?: Record<string, string | number>): string {
        void _langVersion;
        return t(key, params);
    }

    // ======================================================================= //
    // Data Types
    // ======================================================================= //
    interface CharacterInfo {
        name: string;
        lang: string;
        description: string;
    }

    interface ModManifest {
        id: string;
        version: string;
        author: string;
        default_text_lang_id: string;
    }

    interface ModInfo {
        path: string;
        manifest: ModManifest;
        info: Record<string, CharacterInfo>;
    }

    // ======================================================================= //
    // State
    // ======================================================================= //
    let searchPaths: string[] = $state([]);
    let mods: string[] = $state([]);
    let selectedMod = $state("");
    let selectedModInfo = $state<ModInfo | null>(null);
    let loading = $state(false);
    let statusMsg = $state("");
    let previewSrc = $state("");
    let currentModName = $state("");
    let unsubRefresh: (() => void) | null = null;

    // ======================================================================= //
    // Logic
    // ======================================================================= //

    async function loadModList() {
        try {
            searchPaths = await invoke("get_mod_search_paths");
            mods = await invoke("get_available_mods");
            statusMsg = "";
        } catch (e) {
            statusMsg = `${_("modWindow.loadListFailed")} ${e}`;
        }
    }

    async function selectMod(modName: string) {
        selectedMod = modName;
        selectedModInfo = null;
        previewSrc = "";
        statusMsg = _("common.loading");

        try {
            const info = (await invoke("get_mod_details", {
                modName,
            })) as ModInfo;
            selectedModInfo = info;

            // Load preview image
            // Try convertFileSrc on path + /preview.png
            const previewPath = `${info.path}/preview.png`.replace(/\\/g, "/");
            previewSrc = convertFileSrc(previewPath);

            statusMsg = "";
        } catch (e) {
            statusMsg = `Failed to load details: ${e}`;
        }
    }

    async function loadMod() {
        if (!selectedMod) return;
        loading = true;
        try {
            const info = (await invoke("load_mod", {
                modName: selectedMod,
            })) as ModInfo;
            currentModName = info.manifest.id;
            statusMsg = _("resource.statusLoadSuccess") + " " + selectedMod;
        } catch (e) {
            statusMsg = _("resource.statusLoadFailed") + " " + e;
        } finally {
            loading = false;
        }
    }

    async function openModDir() {
        if (!selectedModInfo) {
            statusMsg = _("environment.noModSelected");
            return;
        }
        try {
            await invoke("open_dir", { path: selectedModInfo.path });
            statusMsg = _("modWindow.modDirOpened");
        } catch (e) {
            console.error("Failed to open mod directory:", e);
            statusMsg = _("modWindow.modDirOpenFailed");
        }
    }

    async function importMod() {
        try {
            const modName = (await invoke("import_mod")) as string;
            await message(_("modWindow.importSuccess"), {
                title: "TrayBuddy",
                kind: "info",
            });
            // 此时后台会 emit refresh-mods，由 listener 处理刷新，这里不需要手动 loadModList 了
            if (modName) {
                // 如果后端返回了 modName，可以尝试直接选中
                // 注意：如果 refresh-mods 的 listener 还没执行完，选中可能会失败（mods 还没更新）
                // 所以我们让 listener 负责刷新，如果已经选中了就不管了，或者稍微延迟一下
                setTimeout(() => selectMod(modName), 100);
            }
        } catch (e) {
            if (e === "Canceled") return;

            let errorMsg = e as string;
            if (errorMsg.includes("Invalid .tbuddy file")) {
                errorMsg = _("modWindow.unrecognizedFile");
            }

            await message(`${_("modWindow.importFailed")}: ${errorMsg}`, {
                title: "TrayBuddy",
                kind: "error",
            });
        }
    }

    // ======================================================================= //
    // Lifecycle
    // ======================================================================= //
    onMount(async () => {
        unsubLang = onLangChange(() => {
            _langVersion++;
            getCurrentWindow().setTitle(_("common.modsTitle"));
        });
        await initI18n();
        _langVersion++;
        getCurrentWindow().setTitle(_("common.modsTitle"));
        loadModList();

        unsubRefresh = await listen("refresh-mods", (event) => {
            console.log("Mods refreshed via event:", event.payload);
            loadModList();
        });
    });

    onDestroy(() => {
        unsubLang?.();
        unsubRefresh?.();
        destroyI18n();
    });
</script>

<div class="mod-window">
    <!-- Sidebar: List -->
    <div class="sidebar">
        <div class="sidebar-header">
            <h3>{_("modWindow.availableMods")}</h3>
            <button
                class="import-btn"
                onclick={importMod}
                title={_("modWindow.importMod")}
            >
                +
            </button>
        </div>
        <div class="mod-list">
            {#each mods as mod}
                <button
                    class="mod-item"
                    class:active={selectedMod === mod}
                    onclick={() => selectMod(mod)}
                >
                    {mod}
                </button>
            {/each}
        </div>

        <div class="search-paths">
            <h4>{_("modWindow.searchPaths")}</h4>
            {#each searchPaths as path}
                <div class="path-item" title={path}>{path}</div>
            {/each}
        </div>
    </div>

    <!-- Content: Details -->
    <div class="content">
        {#if selectedModInfo}
            <div class="header">
                <h2>{selectedModInfo.manifest.id}</h2>
                <span class="version">v{selectedModInfo.manifest.version}</span>
            </div>

            <div class="preview-area">
                {#if previewSrc}
                    <img
                        src={previewSrc}
                        alt="Preview"
                        class="preview-img"
                        onerror={(e) =>
                            ((e.currentTarget as HTMLElement).style.display =
                                "none")}
                    />
                    <div class="no-preview">{_("modWindow.noPreview")}</div>
                {/if}
            </div>

            <div class="info-card">
                <div class="row">
                    <span class="label">{_("modWindow.author")}:</span>
                    <span class="value">{selectedModInfo.manifest.author}</span>
                </div>

                {#if selectedModInfo.info}
                    {@const defaultLang =
                        selectedModInfo.manifest.default_text_lang_id}
                    {@const charInfo =
                        selectedModInfo.info[defaultLang] ||
                        Object.values(selectedModInfo.info)[0]}
                    {#if charInfo}
                        <div class="row">
                            <span class="label">{_("resource.statTexts")}:</span
                            >
                            <!-- Reusing label or creating new -->
                            <span class="value">{charInfo.name}</span>
                        </div>
                        <div class="desc">
                            {charInfo.description}
                        </div>
                    {/if}
                {/if}
            </div>

            <div class="actions">
                <div class="status">{statusMsg}</div>
                <div class="buttons">
                    <button
                        class="load-btn"
                        class:reloading={selectedModInfo?.manifest.id ===
                            currentModName}
                        disabled={loading}
                        onclick={loadMod}
                    >
                        {#if loading}
                            {_("common.loading")}
                        {:else if selectedModInfo?.manifest.id === currentModName}
                            {_("modWindow.reloadMod")}
                        {:else}
                            {_("modWindow.loadMod")}
                        {/if}
                    </button>
                    {#if selectedModInfo}
                        <button class="secondary-btn" onclick={openModDir}>
                            {_("modWindow.openModDir")}
                        </button>
                    {/if}
                </div>
            </div>
        {:else}
            <div class="empty-state">
                {statusMsg || _("modWindow.selectToView")}
            </div>
        {/if}
    </div>
</div>

<style>
    :global(body) {
        margin: 0;
        font-family:
            system-ui,
            -apple-system,
            sans-serif;
        background: #f0f2f5;
        overflow: hidden; /* App container handles scroll */
    }

    .mod-window {
        display: flex;
        height: 100vh;
    }

    .sidebar {
        width: 250px;
        background: white;
        border-right: 1px solid #e0e0e0;
        display: flex;
        flex-direction: column;
        padding: 15px;
    }

    .sidebar-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
    }

    .import-btn {
        width: 24px;
        height: 24px;
        border-radius: 4px;
        border: 1px solid #e0e0e0;
        background: #f8f9fa;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        color: #666;
        transition: all 0.2s;
    }

    .import-btn:hover {
        background: #e9ecef;
        border-color: #dee2e6;
        color: #1890ff;
    }

    h3,
    h4 {
        margin: 0 0 10px 0;
        font-size: 1em;
        color: #333;
    }

    h4 {
        font-size: 0.9em;
        color: #666;
        margin-top: 20px;
    }

    .mod-list {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 5px;
    }

    .mod-item {
        padding: 10px;
        text-align: left;
        background: none;
        border: 1px solid transparent;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.95em;
        transition: all 0.2s;
    }

    .mod-item:hover {
        background: #f5f5f5;
    }

    .mod-item.active {
        background: #e6f7ff;
        border-color: #1890ff;
        color: #1890ff;
        font-weight: 600;
    }

    .path-item {
        font-size: 0.8em;
        color: #999;
        word-break: break-all;
        padding: 4px 0;
        border-bottom: 1px solid #eee;
    }

    .content {
        flex: 1;
        padding: 20px;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
    }

    .header {
        display: flex;
        align-items: baseline;
        gap: 10px;
        margin-bottom: 20px;
    }

    h2 {
        margin: 0;
        font-size: 1.8em;
        color: #333;
    }

    .version {
        background: #eee;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 0.8em;
        color: #666;
    }

    .preview-area {
        width: 100%;
        height: 300px;
        background: #e0e0e0;
        border-radius: 8px;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 20px;
    }

    .preview-img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
    }

    .no-preview {
        color: #999;
    }

    .info-card {
        background: white;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        margin-bottom: auto; /* Push actions to bottom */
    }

    .row {
        display: flex;
        margin-bottom: 8px;
    }

    .label {
        width: 80px;
        color: #666;
        font-weight: 500;
    }

    .value {
        color: #333;
        font-weight: 600;
    }

    .desc {
        margin-top: 15px;
        line-height: 1.5;
        color: #555;
        border-top: 1px solid #eee;
        padding-top: 15px;
    }

    .actions {
        margin-top: 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
    }

    .buttons {
        display: flex;
        gap: 10px;
        align-items: center;
    }

    .secondary-btn {
        padding: 10px 20px;
        background: #f0f0f5;
        color: #333;
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        font-size: 0.95em;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
    }

    .secondary-btn:hover {
        background: #e9ecef;
        border-color: #ced4da;
    }

    .secondary-btn:active {
        background: #dee2e6;
    }

    .status {
        font-size: 0.9em;
        color: #666;
    }

    .load-btn {
        padding: 12px 30px;
        background: linear-gradient(135deg, #1890ff, #096dd9);
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 1.1em;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s;
        box-shadow: 0 4px 12px rgba(24, 144, 255, 0.3);
    }

    .load-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(24, 144, 255, 0.4);
    }

    .load-btn:disabled {
        background: #ccc;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
    }

    .load-btn.reloading {
        background: linear-gradient(135deg, #faad14, #d48806);
        box-shadow: 0 4px 12px rgba(250, 173, 20, 0.3);
    }

    .load-btn.reloading:hover {
        box-shadow: 0 6px 16px rgba(250, 173, 20, 0.4);
    }

    .empty-state {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #999;
    }

    @media (prefers-color-scheme: dark) {
        :global(body) {
            background: #2f2f2f;
            color: #f6f6f6;
        }
        .sidebar {
            background: #3a3a3a;
            border-color: #444;
        }
        h3,
        h4,
        h2 {
            color: #f6f6f6;
        }
        .mod-item {
            color: #ccc;
        }
        .mod-item:hover {
            background: #444;
        }
        .mod-item.active {
            background: #177ddc;
            color: white;
            border-color: transparent;
        }
        .path-item {
            color: #888;
            border-color: #444;
        }
        .version {
            background: #444;
            color: #ccc;
        }
        .preview-area {
            background: #444;
        }
        .info-card {
            background: #3a3a3a;
            box-shadow: none;
            border: 1px solid #444;
        }
        .label {
            color: #aaa;
        }
        .value {
            color: #fff;
        }
        .desc {
            color: #ccc;
            border-color: #444;
        }
        .status {
            color: #aaa;
        }
        .load-btn:disabled {
            background: #555;
            color: #888;
        }
        .secondary-btn {
            background: #3a3a3a;
            color: #e0e0e0;
            border-color: #455a64;
        }
        .secondary-btn:hover {
            background: #444;
        }
        .import-btn {
            background: #444;
            border-color: #555;
            color: #ccc;
        }
        .import-btn:hover {
            background: #555;
            color: #177ddc;
        }
    }
</style>
