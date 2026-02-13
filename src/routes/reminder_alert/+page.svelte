<!--
========================================================================= 
定时提醒提示窗口 (+page.svelte)
=========================================================================
- 展示到点触发的提醒列表
- 通过后端队列 take_pending_reminder_alerts() 获取初始数据
- 监听 reminder-alert-update 事件实时追加
==========================================================================
-->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { t, initI18n, destroyI18n, onLangChange } from "$lib/i18n";

  type ReminderAlertPayload = {
    id: string;
    text: string;
    scheduled_at: number;
    fired_at: number;
  };

  let _langVersion = $state(0);
  let unsubLang: (() => void) | null = null;
  function _(key: string, params?: Record<string, string | number>): string {
    void _langVersion;
    return t(key, params);
  }

  let alerts = $state<ReminderAlertPayload[]>([]);

  function formatTime(ts: number): string {
    try {
      const d = new Date(ts * 1000);
      return d.toLocaleString();
    } catch {
      return String(ts);
    }
  }

  function removeAlert(id: string) {
    alerts = alerts.filter((a) => a.id !== id);
  }

  async function loadInitial() {
    const list = (await invoke("take_pending_reminder_alerts")) as ReminderAlertPayload[];
    alerts = [...alerts, ...(list ?? [])];
  }

  onMount(() => {
    let unlisten: (() => void) | undefined;

    const init = async () => {
      unsubLang = onLangChange(() => {
        _langVersion++;
        getCurrentWindow().setTitle(_("common.reminderAlertTitle"));
      });

      await initI18n();
      _langVersion++;
      getCurrentWindow().setTitle(_("common.reminderAlertTitle"));

      await loadInitial();

      unlisten = await listen<ReminderAlertPayload[]>("reminder-alert-update", (e) => {
        const list = e.payload ?? [];
        // 去重：按 id
        const existing = new Set(alerts.map((a) => a.id));
        const merged = [...alerts];
        for (const a of list) {
          if (!existing.has(a.id)) merged.push(a);
        }
        alerts = merged;
      });
    };

    void init();

    return () => {
      unlisten?.();
      unsubLang?.();
      destroyI18n();
    };
  });

  onDestroy(() => {
    // cleanup done in onMount return
  });
</script>

<main class="container">
  <header class="header">
    <div class="title">
      <h2>{_("reminder.alertTitle")}</h2>
    </div>
  </header>


  {#if alerts.length === 0}
    <div class="empty">{_("reminder.noAlerts")}</div>
  {:else}
    <section class="list">
      {#each alerts as a (a.id)}
        <div class="card">
          <div class="meta">
            <div class="when">
              {_("reminder.scheduledAt")} {formatTime(a.scheduled_at)}
            </div>
            <div class="when">
              {_("reminder.firedAt")} {formatTime(a.fired_at)}
            </div>
          </div>

          <div class="text">{a.text}</div>

          <div class="actions">
            <button class="btn primary" onclick={() => removeAlert(a.id)}>{_("reminder.dismiss")}</button>
          </div>
        </div>
      {/each}
    </section>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: Inter, Avenir, Helvetica, Arial, sans-serif;
    background: radial-gradient(900px 500px at 30% 10%, rgba(59, 130, 246, 0.16), transparent 55%),
      #0b1220;
    color: rgba(226, 232, 240, 0.95);
  }


  .container {
    padding: 12px;
    box-sizing: border-box;
  }

  .header {
    display: flex;
    align-items: baseline;
    justify-content: flex-start;
    gap: 10px;
    margin-bottom: 10px;
  }


  h2 {
    margin: 0;
    font-size: 16px;
    letter-spacing: -0.2px;
  }

  .btn {
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: rgba(2, 6, 23, 0.35);
    color: rgba(226, 232, 240, 0.95);
    border-radius: 10px;
    padding: 6px 10px;
    cursor: pointer;
  }


  .btn.primary {
    background: linear-gradient(135deg, #4f8ef7 0%, #2563eb 100%);
    color: white;
    border-color: rgba(37, 99, 235, 0.65);
  }

  .empty {
    padding: 16px;
    color: rgba(203, 213, 225, 0.65);
    text-align: center;
  }


  .list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .card {
    border-radius: 14px;
    background: linear-gradient(
      180deg,
      rgba(15, 23, 42, 0.92) 0%,
      rgba(17, 24, 39, 0.82) 100%
    );
    border: 1px solid rgba(148, 163, 184, 0.22);
    color: rgba(226, 232, 240, 0.95);
    padding: 10px;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 12px;
    color: rgba(203, 213, 225, 0.75);
    margin-bottom: 8px;
  }

  .text {
    white-space: pre-wrap;
    line-height: 1.45;
    font-size: 14px;
  }

  .actions {
    margin-top: 10px;
    display: flex;
    justify-content: flex-end;
  }
</style>
