<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import Settings from "$lib/components/Settings.svelte";
    import { getCurrentWindow } from "@tauri-apps/api/window";
    import { t, initI18n, destroyI18n, onLangChange } from "$lib/i18n";

    let _langVersion = $state(0);
    let unsubLang: (() => void) | null = null;
    function _(key: string, params?: Record<string, string | number>): string {
        void _langVersion;
        return t(key, params);
    }

    onMount(() => {
        const init = async () => {
            unsubLang = onLangChange(() => {
                _langVersion++;
                getCurrentWindow().setTitle(_("common.settingsTitle"));
            });
            await initI18n();
            _langVersion++;
            getCurrentWindow().setTitle(_("common.settingsTitle"));
        };
        init().catch(console.error);
    });

    onDestroy(() => {
        unsubLang?.();
        destroyI18n();
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
