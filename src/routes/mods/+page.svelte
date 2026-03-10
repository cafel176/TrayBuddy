<!--
==========================================================================
模组管理页面 (+page.svelte)
==========================================================================

功能概述:
- 浏览与切换已安装的 Mod
- 支持导入 tbuddy 包/打开源文件路径
- 展示 Mod 元信息与预览图

说明:
- i18n 文本通过 setupI18nWithUpdate 统一初始化
- 资源路径使用 modAssetUrl 工具统一解析
==========================================================================
-->

<script lang="ts">

    import { invoke } from "@tauri-apps/api/core";
    import { onMount, onDestroy } from "svelte";
    import { getCurrentWindow } from "@tauri-apps/api/window";
    import { listen } from "@tauri-apps/api/event";
    import {
        buildModAssetUrl,
        getArchiveModId,
        isArchiveMod,
    } from "$lib/utils/modAssetUrl";

    import {
        t,
        setupI18nWithUpdate,
        currentLang,
    } from "$lib/i18n";
    import type { ModInfo, ModType } from "$lib/types/asset";
    import {
        tokenizeLinks,
        toErrorMessage,
        needsHydrateSbuddy as needsHydrateSbuddyPure,
        resolveCharInfo,
        type DescToken,
    } from "$lib/animation/animation_utils";

    import { message } from "@tauri-apps/plugin-dialog";

    // ======================================================================= //
    // i18n
    // ======================================================================= //
    let _langVersion = $state(0);
    let cleanupI18n: (() => void) | null = null;
    function _(key: string, params?: Record<string, string | number>): string {
        void _langVersion;
        return t(key, params);
    }


    // ======================================================================= //
    // Data Types
    // ======================================================================= //

    interface ModTbuddyPick {
        filePath: string;
        id: string;
        version: string;
    }

    interface ImportModResult {
        id: string;
        extractedPath: string;
    }




    // ======================================================================= //
    // State
    // ======================================================================= //
    let searchPaths: string[] = $state([]);
    let mods: ModInfo[] = $state([]);
    let selectedMod = $state("");
    let selectedModInfo = $state<ModInfo | null>(null);
    let loading = $state(false);
    let statusMsg = $state("");
    let previewSrc = $state("");
    let imageLoadError = $state(false);
    let currentModName = $state("");
    let currentModPath = $state("");
    let currentModVersion = $state("");
    // 当前已加载 Mod 的完整信息（用于避免后台 hydrate 重复解密当前 mod）
    let currentModInfoFull = $state<ModInfo | null>(null);

    let unsubRefresh: (() => void) | null = null;
    let unsubOpenArchive: (() => void) | null = null;

    // 导入冲突弹窗（同 id 已加载）
    let conflictOpen = $state(false);
    let conflictModId = $state("");
    let conflictLoadedVersion = $state("");
    let conflictIncomingVersion = $state("");
    let pendingImportPath = $state<string | null>(null);

    // 导出为 .sbuddy 相关
    let exporting = $state(false);


    /** 当前语言下的角色信息 (响应式) */
    let activeCharInfo = $derived.by(() => {
        if (!selectedModInfo || !selectedModInfo.info) return null;
        // 显式引用 _langVersion 以建立 Svelte 响应式依赖
        void _langVersion;

        return resolveCharInfo(
            selectedModInfo.info,
            currentLang(),
            selectedModInfo.manifest.default_text_lang_id,
        );
    });



    // ======================================================================= //
    // UI Helpers
    // ======================================================================= //

    function formatModType(modType?: ModType | string): string {
        const t = (modType || "unknown").toLowerCase();
        if (t === "sequence") return _("modWindow.modTypeSequence");
        if (t === "live2d") return _("modWindow.modTypeLive2D");
        if (t === "pngremix") return _("modWindow.modTypePngRemix");
        if (t === "3d" || t === "threed") return _("modWindow.modType3D");
        if (t === "unknown") return _("common.unknown");
        return modType || _("common.unknown");
    }

    async function openExternal(url: string) {
        try {
            const { openUrl } = await import("@tauri-apps/plugin-opener");
            await openUrl(url);
        } catch (e) {
            // web/测试环境兜底
            try {
                window.open(url, "_blank", "noopener,noreferrer");
            } catch {
                // ignore
            }
        }
    }

    /** 当前描述文本的 token（把 URL 变成可点击链接） */
    let activeDescTokens = $derived.by(() => {
        if (!activeCharInfo?.description) return [] as DescToken[];
        return tokenizeLinks(activeCharInfo.description);
    });



    // ======================================================================= //
    // Logic
    // ======================================================================= //

    // 后台逐个解密/读取 .sbuddy 的摘要（进入 Mods 页后自动执行）
    let hydrateSeq = 0;
    let hydratingSbuddy = $state(false);
    let hydrateDone = $state(0);
    let hydrateTotal = $state(0);

    function needsHydrateSbuddy(m: ModInfo): boolean {
        return needsHydrateSbuddyPure(
            isArchiveMod(m.path),
            m.manifest?.version,
        );
    }

    function startHydrateSbuddyInBackground() {
        void hydrateSbuddyInBackground();
    }

    async function hydrateSbuddyInBackground() {
        const run = ++hydrateSeq;

        // 后台 hydrate 只处理“占位的 `.sbuddy`”，并且跳过当前正在运行的 mod（数据可直接拿到）。
        const candidates = mods
            .filter(needsHydrateSbuddy)
            .filter((m) => !currentModName || m.manifest.id !== currentModName);

        hydrateDone = 0;
        hydrateTotal = candidates.length;

        if (hydrateTotal === 0) return;

        hydratingSbuddy = true;
        try {
            for (const m of candidates) {
                if (run !== hydrateSeq) return;

                // 可能已被用户选中/后台更新过，实时检查一次
                const cur = mods.find((x) => x.manifest.id === m.manifest.id);
                if (!cur || !needsHydrateSbuddy(cur)) {
                    hydrateDone++;
                    continue;
                }

                try {
                    const requestedId = m.manifest.id;
                    const info = (await invoke("get_mod_details", { modId: requestedId })) as ModInfo | null;
                    if (run !== hydrateSeq) return;
                    if (info && info.manifest?.id) {
                        const actualId = info.manifest.id;

                        // 回填列表：用“请求时的占位 id”命中并替换，允许替换后 id 发生变化
                        mods = mods.map((x) => (x.manifest.id === requestedId ? (info as ModInfo) : x));

                        // 如果解密后发现真实 id 与占位 id 不一致：同步修正选中态
                        if (selectedMod === requestedId) {
                            selectedMod = actualId;
                        }
                        if (selectedModInfo && selectedModInfo.manifest?.id === requestedId) {
                            selectedModInfo = info;
                        }

                        // 如果当前正选中的是该 mod，且右侧详情之前还是占位，则同步刷新右侧信息与预览
                        if (
                            selectedMod === actualId &&
                            selectedModInfo &&
                            (!selectedModInfo.manifest?.version || selectedModInfo.manifest.version.trim().length === 0)
                        ) {
                            selectedModInfo = info;
                            await loadPreview(info);
                        }
                    }
                } catch {
                    // 单个 sbuddy 失败不影响后续队列
                } finally {
                    hydrateDone++;
                }


                // 让出事件循环，保证 UI 不被长任务“卡住”
                await new Promise((r) => setTimeout(r, 0));
            }
        } finally {
            if (run === hydrateSeq) {
                hydratingSbuddy = false;
            }
        }
    }


    async function loadModList() {

        try {
            searchPaths = await invoke("get_mod_search_paths");

            // 启动时加载“快速摘要”（不解密 .sbuddy），用于列表展示版本/类型等基础信息。
            // 选中某个 Mod 时，如果摘要缺少 info/version，再按需 get_mod_details() 补全。
            try {
                const quick = (await invoke("get_mod_summaries_fast")) as unknown;
                if (!Array.isArray(quick)) {
                    throw new Error(_("modWindow.invalidFastSummaries"));
                }
                mods = quick as ModInfo[];
            } catch {

                // 兼容旧后端：没有快速摘要接口时，退化为仅拿 ID 列表
                const modIdsRaw = (await invoke("get_available_mods")) as unknown;
                const modIds = Array.isArray(modIdsRaw) ? (modIdsRaw as string[]) : [];
                mods = modIds.map((id) => ({

                    path: "",
                    manifest: {
                        id,
                        version: "",
                        author: "",
                        default_text_lang_id: "zh",
                        mod_type: "unknown" as string,
                    },
                    info: {},
                    icon_path: null,
                    preview_path: null,
                }) as unknown as ModInfo);
            }



            statusMsg = "";

            // 如果当前 Mod 已经在运行（启动时一定加载过），优先用 get_current_mod 的结果回填列表，
            // 避免后续后台 hydrate 重复解密当前 mod。
            if (currentModInfoFull && currentModName) {
                mods = mods.map((m) => (m.manifest.id === currentModName ? currentModInfoFull! : m));
            }

            // 加载完成后，如果有当前选中的 mod 且在列表中，则自动选中
            if (currentModName && mods.some((m) => m.manifest.id === currentModName)) {
                await selectMod(currentModName);
            }

            // 进入 Mods 页后：后台逐个解密/读取所有 `.sbuddy` 的信息，逐条回填到列表 UI。
            // 注意：这是异步队列，不阻塞首屏。
            startHydrateSbuddyInBackground();


        } catch (e) {
            statusMsg = `${_("modWindow.loadListFailed")} ${e}`;
        }
    }

    // 获取当前加载的 mod（统一使用 manifest.id 作为唯一标识）
    async function loadCurrentMod() {
        try {
            const raw = (await invoke("get_current_mod")) as unknown;
            const modInfo = raw && typeof raw === "object" ? (raw as ModInfo) : null;
            if (modInfo && modInfo.manifest?.id) {
                currentModInfoFull = modInfo;
                currentModPath = modInfo.path;
                currentModName = modInfo.manifest.id;
                currentModVersion = modInfo.manifest.version;
            } else {
                currentModInfoFull = null;
                currentModPath = "";
                currentModName = "";
                currentModVersion = "";
            }
        } catch (e) {
            console.error("Failed to load current mod:", e);
        }
    }


    let selectSeq = 0;

    async function loadPreview(info: ModInfo) {
        previewSrc = "";
        imageLoadError = false;

        // 尝试加载预览图，失败则尝试其他格式
        const previewExtensions = ["png", "jpg", "jpeg", "webp"];

        for (const ext of previewExtensions) {
            const testSrc = buildModAssetUrl(info.path, `preview.${ext}`);

            // 测试图片是否可以加载
            const success = await new Promise<boolean>((resolve) => {
                const testImg = new Image();
                testImg.onload = () => {
                    testImg.onload = null;
                    testImg.onerror = null;
                    resolve(true);
                };
                testImg.onerror = () => {
                    testImg.onload = null;
                    testImg.onerror = null;
                    testImg.src = "data:,";
                    resolve(false);
                };
                testImg.src = testSrc;
            });

            if (success) {
                previewSrc = testSrc;
                break;
            }
        }
    }

    async function selectMod(modName: string) {
        const req = ++selectSeq;

        selectedMod = modName;
        statusMsg = "";

        // 先用列表里已有的缓存信息（如果有）直接展示，避免界面闪白
        const cached = mods.find((m) => m.manifest.id === modName) || null;
        selectedModInfo = cached;

        const cachedHasDetails =
            !!cached &&
            !!cached.manifest?.version &&
            cached.manifest.version.trim().length > 0 &&
            cached.info &&
            Object.keys(cached.info).length > 0;

        if (cachedHasDetails) {
            await loadPreview(cached as ModInfo);
            return;
        }

        // 缺少版本/信息时：按需解密加载（.sbuddy 会在这里触发解密）
        previewSrc = "";
        imageLoadError = false;
        statusMsg = _("common.loading");

        try {
            const requestedId = modName;
            const info = (await invoke("get_mod_details", { modId: requestedId })) as ModInfo | null;
            if (req !== selectSeq) return;
            if (!info || !info.manifest?.id) {
                throw new Error(_("modWindow.invalidModSummary"));
            }

            const actualId = info.manifest.id;

            // 缓存回列表：下次选中同一个 mod 直接显示，不再重复解密
            // 注意：`.sbuddy` 场景下 requestedId 可能只是文件名推断的占位 id，解密后需更新为真实 id
            mods = mods.map((m) => (m.manifest.id === requestedId ? (info as ModInfo) : m));

            // 同步修正选中 id（避免右侧按钮继续使用旧占位 id）
            selectedMod = actualId;
            selectedModInfo = info;

            await loadPreview(info);
            statusMsg = "";
        } catch (e) {

            if (req !== selectSeq) return;
            statusMsg = `${_("modWindow.loadDetailsFailed")} ${e}`;
        }
    }


    async function loadMod() {
        if (!selectedMod) return;
        loading = true;
        try {
            const info = (await invoke("load_mod", {
                modId: selectedMod,
            })) as ModInfo;
            // 更新当前 mod 信息（统一使用 manifest.id）
            currentModInfoFull = info;
            currentModPath = info.path;
            currentModName = info.manifest.id;
            currentModVersion = info.manifest.version;
            // 加载成功后更新按钮状态
            selectedModInfo = info;

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
            // tbuddy 包形式的 mod：打开 .tbuddy 文件所在目录并选中该文件
            if (isArchiveMod(selectedModInfo.path)) {
                // archive mod：以 path 中的 archive id 为准（与 tbuddy-asset 协议一致）
                const modId = getArchiveModId(selectedModInfo.path);
                const sourcePath: string | null = await invoke("get_tbuddy_source_path", { modId });

                if (sourcePath) {
                    await invoke("open_path", { path: sourcePath });
                    statusMsg = _("modWindow.modDirOpened");
                    return;
                }
            }

            await invoke("open_dir", { path: selectedModInfo.path });
            statusMsg = _("modWindow.modDirOpened");
        } catch (e) {
            console.error("Failed to open mod directory:", e);
            statusMsg = _("modWindow.modDirOpenFailed");
        }
    }

    async function exportAsSbuddy() {
        if (!selectedModInfo) return;
        exporting = true;
        statusMsg = _("modWindow.exporting");
        try {
            await invoke("export_mod_as_sbuddy", { modId: selectedModInfo.manifest.id });
            statusMsg = _("modWindow.exportSuccess");
        } catch (e) {
            const errMsg = toErrorMessage(e);
            if (errMsg === "Canceled" || String(e).includes("Canceled")) return;
            if (errMsg.includes("sbuddy tool not found") || errMsg.includes("sbuddy not supported")) {

                await message(
                    _("modWindow.sbuddyNotSupported"),
                    { title: _("common.appName"), kind: "error" }
                );
            } else {
                statusMsg = `${_("modWindow.exportFailed")}: ${errMsg}`;
            }
        } finally {
            exporting = false;
        }
    }

    /**
     * 导入 Mod 文件（通用版本，带成功提示和自动选中）
     */
    async function doImportFromPath(filePath: string): Promise<ImportModResult> {
        const result = (await invoke("import_mod_from_path_detailed", {
            filePath,
        })) as ImportModResult;

        await message(_("modWindow.importSuccess"), {
            title: _("common.appName"),
            kind: "info",
        });

        // 此时后台会 emit refresh-mods，由 listener 处理刷新，这里不需要手动 loadModList 了
        if (result?.id) {
            // 注意：如果 refresh-mods 的 listener 还没执行完，选中可能会失败（mods 还没更新）
            // 所以稍微延迟一下
            setTimeout(() => selectMod(result.id), 100);
        }

        return result;
    }

    /**
     * 静默导入 Mod 文件（用于更新覆盖场景，不显示弹窗，不自动选中）
     */
    async function doImportSilent(filePath: string): Promise<ImportModResult> {
        return (await invoke("import_mod_from_path_detailed", {
            filePath,
        })) as ImportModResult;
    }


    function closeConflictDialog() {
        conflictOpen = false;
        conflictModId = "";
        conflictLoadedVersion = "";
        conflictIncomingVersion = "";
        pendingImportPath = null;
    }

    async function keepLoadedAndExit() {
        // 用户选择保留已加载的：流程直接结束
        closeConflictDialog();
    }

    async function showImportError(e: unknown) {
        let errorMsg = toErrorMessage(e);
        if (errorMsg.includes("sbuddy tool not found") || errorMsg.includes("sbuddy not supported")) {

            errorMsg = _("modWindow.sbuddyNotSupported");
        } else if (errorMsg.includes("Invalid .tbuddy file")) {
            errorMsg = _("modWindow.unrecognizedFile");
        }

        await message(`${_("modWindow.importFailed")}: ${errorMsg}`, {
            title: _("common.appName"),
            kind: "error",
        });
    }

    /**
     * 覆盖并继续导入逻辑
     * 
     * 这是 Mod 管理器中最复杂的交互分支：
     * 1. **场景判定**：用户正在导入一个 ID 已存在的 Mod。
     * 2. **自动加载决策**：
     *    - 如果冲突的 Mod 正是当前屏幕上正在运行的那个，导入后必须执行“热重载”。
     *    - 否则，仅执行磁盘覆盖并刷新列表。
     * 3. **热重载流程 (isCurrentMod)**:
     *    - 调用 `doImportSilent` 执行解压和文件替换。
     *    - 调用 `load_mod_from_path` 触发后端的全套重载逻辑（销毁窗口、刷新索引、重建渲染）。
     */
    async function keepIncomingAndContinue() {
        const filePath = pendingImportPath;
        // 记录冲突的 mod id，用于后续判断是否需要自动加载
        const conflictId = conflictModId;
        // 记录是否为当前正在加载的 mod
        const isCurrentMod = conflictId === currentModName;
        closeConflictDialog();
        if (!filePath) return;

        try {
            // 如果旧版本是当前已加载的 mod，使用静默导入并立即加载
            if (isCurrentMod) {
                // 静默导入，不显示成功消息
                const imported = await doImportSilent(filePath);
                
                if (imported?.extractedPath) {
                    // 调用后端加载流程：关闭窗口→加载资源→重置状态→重建窗口→触发登录
                    const info = (await invoke("load_mod_from_path", {
                        modPath: imported.extractedPath,
                    })) as ModInfo;

                    // 立即刷新当前 mod 状态
                    currentModInfoFull = info;
                    currentModPath = info.path;
                    currentModName = info.manifest.id;
                    currentModVersion = info.manifest.version;


                    // 手动刷新 mod 列表（因为导入后目录可能改变）
                    await loadModList();

                    // 尝试让列表选中该 mod
                    setTimeout(() => selectMod(info.manifest.id), 100);

                    // 显示加载成功消息
                    await message(_("modWindow.importAndLoadSuccess") || _("resource.statusLoadSuccess"), {
                        title: _("common.appName"),
                        kind: "info",
                    });

                } else {
                    // 如果没有 extractedPath，回退到普通导入流程
                    await doImportFromPath(filePath);
                }
            } else {
                // 普通导入（非当前 mod），使用带提示的版本
                await doImportFromPath(filePath);
            }
        } catch (e) {
            await showImportError(e);
        }
    }


    async function importFromExternalPath(filePath: string) {
        try {
            const picked = (await invoke("inspect_mod_tbuddy", { filePath })) as {
                id: string;
                version: string;
            };

            // 如果选择了 .sbuddy 文件，先检查外部工具是否可用
            if (filePath.toLowerCase().endsWith(".sbuddy")) {
                const supported = (await invoke("is_sbuddy_supported")) as boolean;
                if (!supported) {
                    await message(_("modWindow.sbuddyNotSupported"), {
                        title: _("common.appName"),
                        kind: "error",
                    });
                    return;
                }
            }

            const existing = mods.find((m) => m.manifest?.id === picked.id) || null;
            if ((currentModName && picked.id === currentModName) || existing) {
                conflictOpen = true;
                conflictModId = picked.id;

                const existingVer = (existing?.manifest?.version || "").trim();
                const loadedVer = (currentModVersion || "").trim();
                conflictLoadedVersion = existingVer || loadedVer || _("common.unknown");

                conflictIncomingVersion = (picked.version || "").trim() || _("common.unknown");
                pendingImportPath = filePath;
                return;
            }

            await doImportFromPath(filePath);
        } catch (e) {
            await showImportError(e);
        }
    }

    async function consumePendingOpenArchives() {
        try {
            const pending = (await invoke("take_pending_open_mod_archives")) as string[];
            if (!pending || pending.length === 0) return;

            // 实际使用场景一般一次只会打开一个文件；这里先处理第一个。
            await importFromExternalPath(pending[0]);
        } catch (e) {
            // 兜底：不阻塞 Mods 页初始化
            console.error("consumePendingOpenArchives failed:", e);
        }
    }

    async function importMod() {
        try {
            const picked = (await invoke("pick_mod_tbuddy")) as ModTbuddyPick;
            if (!picked?.filePath) {
                return;
            }


            // 如果选择了 .sbuddy 文件，先检查外部工具是否可用

            if (picked.filePath.toLowerCase().endsWith(".sbuddy")) {
                const supported = await invoke("is_sbuddy_supported") as boolean;
                if (!supported) {
                    await message(
                        _("modWindow.sbuddyNotSupported"),
                        { title: _("common.appName"), kind: "error" }
                    );
                    return;
                }
            }

            // 如果发现本地已存在同 id 的 mod，则弹窗提示并询问保留哪个
            // 注意：这里的“已存在”不一定是当前正在运行的 mod；
            // 若冲突的是当前 mod，后续会走热重载分支（keepIncomingAndContinue 内判定）。
            const existing = mods.find((m) => m.manifest?.id === picked.id) || null;
            if ((currentModName && picked.id === currentModName) || existing) {
                conflictOpen = true;
                conflictModId = picked.id;

                const existingVer = (existing?.manifest?.version || "").trim();
                const loadedVer = (currentModVersion || "").trim();
                conflictLoadedVersion = existingVer || loadedVer || _("common.unknown");

                conflictIncomingVersion = (picked.version || "").trim() || _("common.unknown");
                pendingImportPath = picked.filePath;
                return;
            }


            await doImportFromPath(picked.filePath);
        } catch (e) {
            // 将错误转为字符串进行匹配（兼容 Tauri v2 各种错误格式）
            const errStr = String(e);
            const errMsg = toErrorMessage(e);
            if (errMsg === "Canceled" || errStr.includes("Canceled")) {
                return;
            }
            if (errMsg.includes("sbuddy tool not found") || errMsg.includes("sbuddy not supported")
                || errStr.includes("sbuddy tool not found") || errStr.includes("sbuddy not supported")) {

                await message(
                    _("modWindow.sbuddyNotSupported"),
                    { title: _("common.appName"), kind: "error" }
                );
                return;
            }
            await showImportError(e);
        }
    }




    // ======================================================================= //
    // Lifecycle
    // ======================================================================= //
    onMount(() => {
        const init = async () => {
            cleanupI18n = await setupI18nWithUpdate(() => {
                _langVersion++;
                getCurrentWindow().setTitle(_("common.modsTitle"));
            });

            // 先获取当前加载的 mod，再加载 mod 列表
            await loadCurrentMod();
            await loadModList();

            unsubRefresh = await listen("refresh-mods", (event) => {
                console.log("Mods refreshed via event:", event.payload);
                loadModList();
            });

            // 监听后端的 open-with 事件：双击 .tbuddy/.sbuddy → 直接导入
            unsubOpenArchive = await listen("open-mod-archive", async (event) => {
                const payload = event.payload as unknown;
                const filePath =
                    typeof payload === "string"
                        ? payload
                        : (payload as any)?.filePath || (payload as any)?.file_path;

                if (typeof filePath === "string" && filePath.trim()) {
                    await importFromExternalPath(filePath);
                }
            });

            // 冷启动兜底：如果事件 emit 过早被错过，从队列里取出再导入
            await consumePendingOpenArchives();
        };
        init().catch(console.error);
    });

    onDestroy(() => {
        // 取消后台 hydrate 队列，避免离开页面后还在解密
        hydrateSeq++;
        cleanupI18n?.();
        unsubRefresh?.();
        unsubOpenArchive?.();
    });


</script>

<div class="mod-window">
    <!-- Sidebar: List -->
    <div class="sidebar">
        <div class="sidebar-header">
            <h3>
                {_("modWindow.availableMods")}
                {#if hydratingSbuddy}
                    <span class="hydrate-hint">({hydrateDone}/{hydrateTotal})</span>
                {/if}
            </h3>

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
                    class:active={selectedMod === mod.manifest.id}
                    onclick={() => selectMod(mod.manifest.id)}
                    title={mod.path || mod.manifest.id}
                >
                    <div class="mod-item-row">
                        <span class="mod-id">{mod.manifest.id}</span>
                        <span
                            class="mod-type-tag"
                            data-type={needsHydrateSbuddy(mod) ? "unknown" : mod.manifest.mod_type}
                        >
                            {formatModType(needsHydrateSbuddy(mod) ? "unknown" : mod.manifest.mod_type)}
                        </span>

                    </div>
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
                <span class="mod-type-tag large" data-type={selectedModInfo.manifest.mod_type}>
                    {formatModType(selectedModInfo.manifest.mod_type)}
                </span>
            </div>

            <div class="preview-area">
                {#if previewSrc && !imageLoadError}
                    <img
                        src={previewSrc}
                        alt={_("modWindow.preview")}
                        class="preview-img"
                        onerror={() => (imageLoadError = true)}
                    />
                {:else}
                    <div class="no-preview">{_("modWindow.noPreview")}</div>
                {/if}
            </div>

            <div class="info-card">
                <div class="row">
                    <span class="label">{_("modWindow.author")}:</span>
                    <span class="value">{selectedModInfo.manifest.author}</span>
                </div>

                <div class="row">
                    <span class="label">{_("modWindow.modType")}:</span>
                    <span class="value">{formatModType(selectedModInfo.manifest.mod_type)}</span>
                </div>

                {#if activeCharInfo}
                    <div class="row">
                        <span class="label">{_("modWindow.modName")}:</span>
                        <span class="value">{activeCharInfo.name}</span>
                    </div>
                    <div class="desc">
                        {#each activeDescTokens as token}
                            {#if token.kind === "link"}
                                <a
                                    class="external-link"
                                    href={token.href}
                                    target="_blank"
                                    rel="noreferrer"
                                    onclick={(e) => {
                                        e.preventDefault();
                                        openExternal(token.href);
                                    }}
                                >
                                    {token.text}
                                </a>
                            {:else}
                                {token.value}
                            {/if}
                        {/each}
                    </div>
                {/if}
            </div>

            <div class="actions">
                <div class="status">{statusMsg}</div>
                <div class="buttons">
                    <button
                        class="load-btn"
                        class:reloading={selectedModInfo?.path ===
                            currentModPath}
                        disabled={loading}
                        onclick={loadMod}
                    >
                        {#if loading}
                            {_("common.loading")}
                        {:else if selectedModInfo?.path === currentModPath}
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
                    {#if selectedModInfo}
                        <button
                            class="secondary-btn export-sbuddy-btn"
                            disabled={exporting}
                            onclick={exportAsSbuddy}
                        >
                            {exporting ? _("modWindow.exporting") : _("modWindow.exportSbuddy")}
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

{#if conflictOpen}
    <div
        class="modal-backdrop"
        role="button"
        tabindex="0"
        aria-label={_("common.close")}

        onclick={(e) => {
            if (e.currentTarget === e.target) keepLoadedAndExit();
        }}
        onkeydown={(e) => {
            if (e.key === "Escape") keepLoadedAndExit();
        }}
    >
        <div class="modal" role="dialog" aria-modal="true">
            <h3>{_("modWindow.conflictTitle")}</h3>
            <div class="modal-body">
                <div class="line">
                    <span class="label">{_("modWindow.conflictId")}:</span>
                    <span class="value">{conflictModId}</span>
                </div>
                <div class="line">
                    <span class="label">{_("modWindow.conflictLoaded")}:</span>
                    <span class="value">v{conflictLoadedVersion}</span>
                </div>
                <div class="line">
                    <span class="label">{_("modWindow.conflictImported")}:</span>
                    <span class="value">v{conflictIncomingVersion}</span>
                </div>
            </div>
            <div class="modal-actions">
                <button type="button" class="secondary-btn" onclick={keepLoadedAndExit}>
                    {_("modWindow.keepLoaded")}
                </button>
                <button type="button" class="load-btn" onclick={keepIncomingAndContinue}>
                    {_("modWindow.keepImported")}
                </button>
            </div>
        </div>
    </div>
{/if}

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

    .mod-item-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: 100%;
    }

    .mod-id {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
    }

    .mod-type-tag {
        flex-shrink: 0;
        font-size: 0.72em;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid #e0e0e0;
        background: #f6f7f9;
        color: #555;
        line-height: 1.2;
        user-select: none;
    }

    .mod-type-tag.large {
        font-size: 0.8em;
        padding: 3px 10px;
    }

    /* 轻微区分不同类型（保持低干扰风格） */
    .mod-type-tag[data-type="live2d"] {
        border-color: rgba(88, 80, 236, 0.35);
        background: rgba(88, 80, 236, 0.08);
        color: #3b36b4;
    }

    .mod-type-tag[data-type="pngremix"] {
        border-color: rgba(250, 173, 20, 0.35);
        background: rgba(250, 173, 20, 0.10);
        color: #b78103;
    }

    .mod-type-tag[data-type="3d"],
    .mod-type-tag[data-type="threed"] {
        border-color: rgba(82, 196, 26, 0.35);
        background: rgba(82, 196, 26, 0.10);
        color: #2d7a0d;
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
        justify-content: space-between;
        align-items: baseline;
        gap: 15px;
        margin-bottom: 10px;
    }

    .label {
        color: #666;
        font-weight: 500;
        flex-shrink: 0;
    }

    .value {
        color: #333;
        font-weight: 600;
        text-align: right;
        word-break: break-all;
    }

    .desc {
        margin-top: 15px;
        line-height: 1.5;
        color: #555;
        border-top: 1px solid #eee;
        padding-top: 15px;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .external-link {
        color: #1890ff;
        text-decoration: underline;
        text-underline-offset: 2px;
    }

    .external-link:hover {
        color: #096dd9;
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

    .modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.35);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;

        cursor: pointer;
    }

    .modal {
        width: 420px;
        max-width: calc(100vw - 40px);
        background: #fff;
        border-radius: 10px;
        padding: 18px;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.25);
        border: 1px solid rgba(0, 0, 0, 0.08);
        cursor: default;
    }

    .modal h3 {
        margin: 0 0 12px 0;
        font-size: 1.05em;
        color: #333;
    }

    .modal-body {
        background: #f8f9fa;
        border: 1px solid #eee;
        border-radius: 8px;
        padding: 12px;
    }

    .modal-body .line {
        display: flex;
        gap: 10px;
        align-items: baseline;
        margin-bottom: 8px;
    }

    .modal-body .line:last-child {
        margin-bottom: 0;
    }

    .modal-actions {
        margin-top: 16px;
        display: flex;
        justify-content: flex-end;
        gap: 10px;
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

        .mod-type-tag {
            border-color: #555;
            background: #444;
            color: #ccc;
        }

        .mod-type-tag[data-type="live2d"] {
            border-color: rgba(88, 80, 236, 0.45);
            background: rgba(88, 80, 236, 0.16);
            color: #c7c5ff;
        }

        .mod-type-tag[data-type="pngremix"] {
            border-color: rgba(250, 173, 20, 0.45);
            background: rgba(250, 173, 20, 0.18);
            color: #ffe7b3;
        }

        .mod-type-tag[data-type="3d"],
        .mod-type-tag[data-type="threed"] {
            border-color: rgba(82, 196, 26, 0.45);
            background: rgba(82, 196, 26, 0.18);
            color: #d8ffbf;
        }

        .external-link {
            color: #69c0ff;
        }

        .external-link:hover {
            color: #91d5ff;
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
        .modal {
            background: #3a3a3a;
            border-color: #444;
        }
        .modal h3 {
            color: #f6f6f6;
        }
        .modal-body {
            background: #2f2f2f;
            border-color: #444;
        }
    }
</style>

