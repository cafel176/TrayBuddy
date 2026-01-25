<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { t, initI18n, destroyI18n, onLangChange } from "$lib/i18n";

  // ======================================================================= //
  // i18n
  // ======================================================================= //
  let _langVersion = $state(0);
  let unsubLang: (() => void) | null = null;
  const window = getCurrentWindow();

  function _(key: string, params?: Record<string, string | number>): string {
    void _langVersion;
    return t(key, params);
  }

  // ======================================================================= //
  // Lifecycle
  // ======================================================================= //
  onMount(async () => {
    unsubLang = onLangChange(() => {
      _langVersion++;
      window.setTitle(_("about.title"));
    });
    await initI18n();
    _langVersion++;
    window.setTitle(_("about.title"));
    // 禁止窗口大小调整
    window.setResizable(false);
  });

  onDestroy(() => {
    unsubLang?.();
    destroyI18n();
  });
</script>

<div class="about-container">
  <div class="about-content">
    <h1>{_("about.title")}</h1>

    <div class="app-info">
      <div class="app-name">{_("about.appName")}</div>
      <div class="app-description">{_("about.appDescription")}</div>
      <div class="app-version">{_("about.appVersion")}</div>
    </div>

    <div class="features">
      <div class="feature-item">{_("about.featureCuteCharacter")}</div>
      <div class="feature-item">{_("about.featureMediaInteraction")}</div>
      <div class="feature-item">{_("about.featureRichState")}</div>
      <div class="feature-item">{_("about.featureCustomizable")}</div>
    </div>

    <button class="close-btn" onclick={() => window.close()}>
      {_("about.close")}
    </button>
  </div>
</div>

<style>
  .about-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: 20px;
  }

  .about-content {
    background: white;
    border-radius: 20px;
    padding: 40px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
    text-align: center;
    max-width: 350px;
  }

  h1 {
    margin: 0 0 30px 0;
    color: #667eea;
    font-size: 28px;
    font-weight: 600;
  }

  .app-info {
    margin-bottom: 30px;
  }

  .app-name {
    font-size: 32px;
    font-weight: 700;
    color: #333;
    margin-bottom: 10px;
  }

  .app-description {
    font-size: 16px;
    color: #666;
    margin-bottom: 8px;
  }

  .app-version {
    font-size: 14px;
    color: #999;
  }

  .features {
    text-align: left;
    margin-bottom: 30px;
  }

  .feature-item {
    padding: 8px 0;
    font-size: 15px;
    color: #555;
  }

  .close-btn {
    background: #667eea;
    color: white;
    border: none;
    padding: 12px 30px;
    border-radius: 8px;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s;
    font-weight: 500;
  }

  .close-btn:hover {
    background: #5568d3;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  }

  .close-btn:active {
    transform: translateY(0);
  }

  @media (prefers-color-scheme: dark) {
    .about-content {
      background: #2c3e50;
    }

    h1 {
      color: #a8b4c9;
    }

    .app-name {
      color: #ecf0f1;
    }

    .app-description {
      color: #bdc3c7;
    }

    .app-version {
      color: #95a5a6;
    }

    .feature-item {
      color: #bdc3c7;
    }

    .close-btn {
      background: #3498db;
    }

    .close-btn:hover {
      background: #2980b9;
    }
  }
</style>
