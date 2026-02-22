<!--
==========================================================================
设置页面 (+page.svelte)
==========================================================================

功能概述:
- 展示并编辑用户设置（音量、语言、动画等）
- 与后端设置存储联动
==========================================================================
-->

<script lang="ts">

    import { onMount, onDestroy } from "svelte";
    import Settings from "$lib/components/Settings.svelte";
    import { getCurrentWindow } from "@tauri-apps/api/window";
    import { t, setupI18nWithUpdate } from "$lib/i18n";

    let _langVersion = $state(0);
    let cleanupI18n: (() => void) | null = null;
    function _(key: string, params?: Record<string, string | number>): string {
        void _langVersion;
        return t(key, params);
    }

    onMount(() => {
        const init = async () => {
            cleanupI18n = await setupI18nWithUpdate(() => {
                _langVersion++;
                getCurrentWindow().setTitle(_("common.settingsTitle"));
            });
        };
        init().catch(console.error);
    });

    onDestroy(() => {
        cleanupI18n?.();
    });

</script>

<div class="settings-page">
    <Settings />
</div>

<style>
    :global(body) {
        margin: 0;
        font-family:
            system-ui,
            -apple-system,
            sans-serif;
        background: #f6f6f6;
    }

    .settings-page {
        padding: 20px;
        max-width: 800px;
        margin: 0 auto;
    }

    @media (prefers-color-scheme: dark) {
        :global(body) {
            background: #2f2f2f;
            color: #f6f6f6;
        }
    }
</style>
