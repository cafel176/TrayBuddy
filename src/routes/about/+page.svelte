<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { getVersion } from "@tauri-apps/api/app";
  import { t, initI18n, destroyI18n, onLangChange } from "$lib/i18n";

  // ======================================================================= //
  // i18n
  // ======================================================================= //
  let _langVersion = $state(0);
  let unsubLang: (() => void) | null = null;
  let appVersion = $state("...");
  const window = getCurrentWindow();

  function _(key: string, params?: Record<string, string | number>): string {
    void _langVersion;
    return t(key, params);
  }

  // ======================================================================= //
  // Lifecycle
  // ======================================================================= //
  onMount(() => {
    const init = async () => {
      unsubLang = onLangChange(() => {
        _langVersion++;
        window.setTitle(_("about.title"));
      });
      await initI18n();
      _langVersion++;
      window.setTitle(_("about.title"));

      // 获取真实版本号
      try {
        appVersion = await getVersion();
      } catch (e) {
        console.error("Failed to get version:", e);
        appVersion = "0.1.0";
      }
    };
    init().catch(console.error);
  });

  onDestroy(() => {
    unsubLang?.();
    destroyI18n();
  });
</script>

<div class="about-container">
  <div class="about-card">
    <div class="header">
      <div class="logo">TB</div>
      <div class="app-info">
        <h1 class="app-name">{_("about.appName")}</h1>
        <div class="app-version">{_("about.appVersion", { version: appVersion })}</div>
      </div>
    </div>

    <div class="divider"></div>

    <div class="content">
      <p class="description">{_("about.description")}</p>

      <div class="section">
        <h2 class="section-title">{_("about.featuresTitle")}</h2>
        <div class="feature-list">
          <div class="feature-item">{_("about.featureWidget")}</div>
          <div class="feature-item">{_("about.featureEngine")}</div>
          <div class="feature-item">{_("about.featureMedia")}</div>
          <div class="feature-item">{_("about.featureEnv")}</div>
          <div class="feature-item">{_("about.featureMod")}</div>
          <div class="feature-item">{_("about.featureStats")}</div>
        </div>
      </div>

      <div class="section footer-info">
        <div class="author-row">
          <span class="label">{_("about.authorLabel")}:</span>
          <span class="value author-name">{_("about.authorName")}</span>
        </div>

        <div class="contact-section">
          <div class="label contact-header">{_("about.contactLabel")}</div>
          <div class="contact-grid">
            <div class="contact-item">{_("about.qqGroup")}</div>
            <div class="contact-item">{_("about.bilibili")}</div>
            <div class="contact-item">{_("about.heyBox")}</div>
            <div class="contact-item">{_("about.xiaohongshu")}</div>
            <div class="contact-item">{_("about.weibo")}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    font-family:
      "Inter",
      "Segoe UI",
      -apple-system,
      BlinkMacSystemFont,
      sans-serif;
  }

  .about-container {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100vw;
    height: 100vh;
    background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
    padding: 16px;
    box-sizing: border-box;
  }

  .about-card {
    background: rgba(255, 255, 255, 0.9);
    backdrop-filter: blur(10px);
    border-radius: 24px;
    padding: 32px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.1);
    width: 100%;
    max-width: 480px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    border: 1px solid rgba(255, 255, 255, 0.5);
    overflow-y: auto;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 24px;
  }

  .logo {
    width: 64px;
    height: 64px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 16px;
    display: flex;
    justify-content: center;
    align-items: center;
    color: white;
    font-size: 24px;
    font-weight: 800;
    box-shadow: 0 8px 16px rgba(102, 126, 234, 0.3);
  }

  .app-name {
    margin: 0;
    font-size: 28px;
    font-weight: 800;
    color: #2d3436;
    letter-spacing: -0.5px;
  }

  .app-version {
    font-size: 14px;
    color: #636e72;
    font-weight: 500;
  }

  .divider {
    height: 1px;
    background: linear-gradient(to right, transparent, rgba(0, 0, 0, 0.1), transparent);
    margin-bottom: 24px;
  }

  .content {
    flex: 1;
  }

  .description {
    font-size: 15px;
    line-height: 1.6;
    color: #4b4b4b;
    margin: 0 0 24px 0;
  }

  .section {
    margin-bottom: 24px;
  }

  .section-title {
    font-size: 16px;
    font-weight: 700;
    color: #2d3436;
    margin: 0 0 12px 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .feature-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .feature-item {
    font-size: 14px;
    color: #5d6778;
    background: rgba(102, 126, 234, 0.05);
    padding: 8px 12px;
    border-radius: 8px;
    border-left: 3px solid #667eea;
  }

  .footer-info {
    background: rgba(0, 0, 0, 0.03);
    padding: 16px;
    border-radius: 16px;
    margin-bottom: 0;
  }

  .author-row {
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .label {
    font-size: 13px;
    color: #636e72;
    font-weight: 600;
  }

  .value {
    font-size: 14px;
    color: #2d3436;
    font-weight: 700;
  }

  .author-name {
    color: #667eea;
  }

  .contact-header {
    margin-bottom: 8px;
  }

  .contact-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .contact-item {
    font-size: 13px;
    color: #5d6778;
    background: white;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid rgba(0, 0, 0, 0.05);
  }

  @media (prefers-color-scheme: dark) {
    .about-container {
      background: linear-gradient(135deg, #1a1a1a 0%, #2d3436 100%);
    }

    .about-card {
      background: rgba(45, 52, 54, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .app-name {
      color: #dfe6e9;
    }

    .app-version {
      color: #b2bec3;
    }

    .description {
      color: #b2bec3;
    }

    .section-title {
      color: #dfe6e9;
    }

    .feature-item {
      background: rgba(255, 255, 255, 0.05);
      color: #dfe6e9;
      border-left-color: #74b9ff;
    }

    .footer-info {
      background: rgba(255, 255, 255, 0.05);
    }

    .label {
      color: #b2bec3;
    }

    .value {
      color: #dfe6e9;
    }

    .contact-item {
      background: rgba(0, 0, 0, 0.2);
      border-color: rgba(255, 255, 255, 0.05);
      color: #b2bec3;
    }
  }
</style>
