<!--
========================================================================= 
定时提醒管理窗口 (+page.svelte)
=========================================================================
- 支持三种模式：指定日期时间 / 每周指定星期与时间 / 从现在起延时
- 支持多个提醒，启用/停用，删除
- 修改后立刻保存（轻量防抖）
==========================================================================
-->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { t, tArray, initI18n, destroyI18n, onLangChange } from "$lib/i18n";

  type ReminderSchedule =
    | { kind: "absolute"; timestamp: number }
    | { kind: "after"; seconds: number; created_at?: number | null }
    | { kind: "weekly"; days: number[]; hour: number; minute: number };


  type ReminderItem = {
    id: string;
    text: string;
    enabled: boolean;
    schedule: ReminderSchedule;
    next_trigger_at: number;
    last_trigger_at?: number | null;
  };

  let _langVersion = $state(0);
  let unsubLang: (() => void) | null = null;
  function _(key: string, params?: Record<string, string | number>): string {
    void _langVersion;
    return t(key, params);
  }

  let reminders = $state<ReminderItem[]>([]);
  let status = $state("");
  let saving = $state(false);

  // 新建提醒
  type NewType = "absolute" | "weekly" | "after";
  let newType = $state<NewType>("after");
  let newText = $state("");

  // absolute
  let newDatetimeLocal = $state("");

  // weekly
  function labelForWeekday(n: number): string {
    // 复用 environment.weekdays 的翻译（顺序为 Sun..Sat）
    const arr = tArray("environment.weekdays");
    if (!arr || arr.length < 7) return String(n);
    if (n === 7) return arr[0] ?? "Sun";
    return arr[n] ?? String(n);
  }

  // 注意：ReminderSchedule::Weekly 的 days 使用 1..=7 (Mon..Sun)
  // 这里通过 _langVersion 建立依赖，使语言切换后星期显示能实时刷新。
  let WEEKDAYS = $derived.by(() => {
    void _langVersion;
    return [
      { n: 1, label: labelForWeekday(1) },
      { n: 2, label: labelForWeekday(2) },
      { n: 3, label: labelForWeekday(3) },
      { n: 4, label: labelForWeekday(4) },
      { n: 5, label: labelForWeekday(5) },
      { n: 6, label: labelForWeekday(6) },
      { n: 7, label: labelForWeekday(7) },
    ];
  });

  let newWeeklyDays = $state<Record<number, boolean>>({ 1: true });
  let newWeeklyTime = $state("09:00");


  // after
  let newAfterValue = $state<number>(10);
  let newAfterUnit = $state<"seconds" | "minutes" | "hours">("minutes");

  function formatTime(ts: number): string {
    if (!ts) return "-";
    try {
      const d = new Date(ts * 1000);
      return d.toLocaleString();
    } catch {
      return String(ts);
    }
  }

  function toDatetimeLocal(ts: number): string {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    const offMs = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offMs).toISOString().slice(0, 16);
  }


  function parseTimeHHMM(v: string): { hour: number; minute: number } {
    const m = /^\s*(\d{1,2}):(\d{1,2})\s*$/.exec(v || "");
    if (!m) return { hour: 9, minute: 0 };
    const hour = Math.max(0, Math.min(23, Number(m[1])));
    const minute = Math.max(0, Math.min(59, Number(m[2])));
    return { hour, minute };
  }

  function secondsFromAfter(value: number, unit: string): number {
    const v = Math.max(1, Math.floor(Number(value) || 0));
    if (unit === "hours") return v * 3600;
    if (unit === "minutes") return v * 60;
    return v;
  }

  async function load() {
    status = _("reminder.loading");
    try {
      const data = (await invoke("get_reminders")) as ReminderItem[];
      reminders = (data ?? []).map((r) => ({
        ...r,
        enabled: r.enabled ?? true,
        text: r.text ?? "",
      }));
      status = "";
    } catch (e) {
      status = `${_("common.loadFailed")} ${e}`;
    }
  }

  let saveTimer: number | null = null;
  function scheduleSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveTimer = window.setTimeout(() => {
      void persist();
    }, 250);
  }

  async function persist() {
    saving = true;
    try {
      await invoke("set_reminders", { reminders });
      status = _("reminder.saved");
    } catch (e) {
      status = `${_("common.saveFailed")} ${e}`;
    } finally {
      saving = false;
    }
  }

  function createScheduleFromNew(): ReminderSchedule | null {
    if (newType === "absolute") {
      const v = (newDatetimeLocal || "").trim();
      if (!v) return null;
      const ts = Math.floor(new Date(v).getTime() / 1000);
      if (!Number.isFinite(ts) || ts <= 0) return null;
      return { kind: "absolute", timestamp: ts };
    }

    if (newType === "weekly") {
      const { hour, minute } = parseTimeHHMM(newWeeklyTime);
      const days = WEEKDAYS.filter((d) => newWeeklyDays[d.n]).map((d) => d.n);
      if (days.length === 0) return null;
      return { kind: "weekly", days, hour, minute };
    }

    // after
    const seconds = secondsFromAfter(newAfterValue, newAfterUnit);
    return { kind: "after", seconds, created_at: null };
  }

  function addReminder() {
    const text = (newText || "").trim();
    if (!text.length) return;

    const schedule = createScheduleFromNew();
    if (!schedule) return;

    reminders = [
      ...reminders,
      {
        id: crypto.randomUUID(),
        text,
        enabled: true,
        schedule,
        next_trigger_at: 0,
        last_trigger_at: null,
      },
    ];

    newText = "";
    scheduleSave();
  }

  function deleteReminder(id: string) {
    reminders = reminders.filter((r) => r.id !== id);
    scheduleSave();
  }

  function updateReminder(id: string, patch: Partial<ReminderItem>) {
    reminders = reminders.map((r) => (r.id === id ? { ...r, ...patch } : r));
    scheduleSave();
  }

  function updateSchedule(id: string, schedule: ReminderSchedule) {
    reminders = reminders.map((r) => (r.id === id ? { ...r, schedule, next_trigger_at: 0 } : r));
    scheduleSave();
  }

  function scheduleSummary(s: ReminderSchedule): string {
    if (s.kind === "absolute") return _("reminder.typeAbsolute");
    if (s.kind === "weekly") return _("reminder.typeWeekly");
    return _("reminder.typeAfter");
  }



  onMount(() => {
    const init = async () => {
      unsubLang = onLangChange(() => {
        _langVersion++;
        getCurrentWindow().setTitle(_("common.reminderTitle"));
      });

      await initI18n();
      _langVersion++;
      getCurrentWindow().setTitle(_("common.reminderTitle"));

      await load();
    };

    void init();

    return () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
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
      <h2>{_("reminder.title")}</h2>
      <div class="sub" class:saving={saving}>{status}</div>
    </div>
  </header>

  <section class="panel">
    <div class="row">
      <div class="label">{_("reminder.type")}</div>
      <select class="select" bind:value={newType}>
        <option value="absolute">{_("reminder.typeAbsolute")}</option>
        <option value="weekly">{_("reminder.typeWeekly")}</option>
        <option value="after">{_("reminder.typeAfter")}</option>
      </select>
    </div>

    {#if newType === "absolute"}
      <div class="row">
        <div class="label">{_("reminder.datetime")}</div>
        <input class="input" type="datetime-local" bind:value={newDatetimeLocal} />
      </div>
    {:else if newType === "weekly"}
      <div class="row">
        <div class="label">{_("reminder.timeOfDay")}</div>
        <input class="input" type="time" bind:value={newWeeklyTime} />
      </div>
      <div class="row">
        <div class="label">{_("reminder.weekdays")}</div>
        <div class="weekdays">
          {#each WEEKDAYS as d}
            <div class="chip">
              <input
                type="checkbox"
                checked={!!newWeeklyDays[d.n]}
                onchange={(e) => (newWeeklyDays[d.n] = (e.currentTarget as HTMLInputElement).checked)}
              />
              <span>{d.label}</span>
            </div>
          {/each}
        </div>
      </div>
    {:else}
      <div class="row">
        <div class="label">{_("reminder.after")}</div>
        <div class="after">
          <input class="input" type="number" min="1" bind:value={newAfterValue} />
          <select class="select" bind:value={newAfterUnit}>
            <option value="seconds">{_("reminder.afterUnitSeconds")}</option>
            <option value="minutes">{_("reminder.afterUnitMinutes")}</option>
            <option value="hours">{_("reminder.afterUnitHours")}</option>
          </select>
        </div>
      </div>
    {/if}

    <div class="row">
      <div class="label">{_("reminder.title")}</div>
      <textarea class="textarea" rows="2" bind:value={newText} placeholder={_("reminder.textPlaceholder")}></textarea>
    </div>

    <div class="row actions">
      <button class="btn primary" onclick={addReminder} disabled={!newText.trim().length}>
        {_("reminder.add")}
      </button>
    </div>
  </section>

  <section class="list">
    {#each reminders as r (r.id)}
      <div class="card" class:disabled={!r.enabled}>
        <div class="card-head">
          <div class="left">
            <div class="switch">
              <input
                type="checkbox"
                checked={!!r.enabled}
                onchange={(e) => updateReminder(r.id, { enabled: (e.currentTarget as HTMLInputElement).checked })}
              />
              <span>{r.enabled ? _("reminder.enabled") : _("reminder.disabled")}</span>
            </div>
            <div class="meta">
              <span class="tag">{scheduleSummary(r.schedule)}</span>
              <span class="next">{_("reminder.nextTrigger")} {formatTime(r.next_trigger_at)}</span>

            </div>
          </div>
          <button class="btn danger" onclick={() => deleteReminder(r.id)}>{_("reminder.delete")}</button>
        </div>

        <div class="card-body">
          <div class="row compact">
            <div class="label">{_("reminder.type")}</div>
            <select
              class="select"
              value={r.schedule.kind}
              onchange={(e) => {
                const v = (e.currentTarget as HTMLSelectElement).value as NewType;
                if (v === "absolute") updateSchedule(r.id, { kind: "absolute", timestamp: Math.floor(Date.now() / 1000) + 60 });
                else if (v === "weekly") updateSchedule(r.id, { kind: "weekly", days: [1], hour: 9, minute: 0 });
                else updateSchedule(r.id, { kind: "after", seconds: 600, created_at: null });
              }}
            >
              <option value="absolute">{_("reminder.typeAbsolute")}</option>
              <option value="weekly">{_("reminder.typeWeekly")}</option>
              <option value="after">{_("reminder.typeAfter")}</option>
            </select>
          </div>

          {#if r.schedule.kind === "absolute"}
            <div class="row compact">
              <div class="label">{_("reminder.datetime")}</div>
              <input
                class="input"
                type="datetime-local"
                value={toDatetimeLocal((r.schedule as any).timestamp)}
                oninput={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value;
                  const ts = Math.floor(new Date(v).getTime() / 1000);
                  if (Number.isFinite(ts) && ts > 0) updateSchedule(r.id, { kind: "absolute", timestamp: ts });
                }}
              />
            </div>
          {:else if r.schedule.kind === "weekly"}
            <div class="row compact">
              <div class="label">{_("reminder.timeOfDay")}</div>
              <input
                class="input"
                type="time"
                value={`${String((r.schedule as any).hour).padStart(2, "0")}:${String((r.schedule as any).minute).padStart(2, "0")}`}
                oninput={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value;
                  const { hour, minute } = parseTimeHHMM(v);
                  const s = r.schedule as any;
                  updateSchedule(r.id, { kind: "weekly", days: s.days ?? [1], hour, minute });
                }}
              />
            </div>
            <div class="row compact">
              <div class="label">{_("reminder.weekdays")}</div>
              <div class="weekdays">
                {#each WEEKDAYS as d}
                  <div class="chip">
                    <input
                      type="checkbox"
                      checked={(r.schedule as any).days?.includes(d.n)}
                      onchange={(e) => {
                        const checked = (e.currentTarget as HTMLInputElement).checked;
                        const s = r.schedule as any;
                        const set = new Set<number>((s.days ?? []) as number[]);
                        if (checked) set.add(d.n);
                        else set.delete(d.n);
                        const days = Array.from(set);
                        updateSchedule(r.id, { kind: "weekly", days: days.length ? days : [d.n], hour: s.hour ?? 9, minute: s.minute ?? 0 });
                      }}
                    />
                    <span>{d.label}</span>
                  </div>
                {/each}
              </div>
            </div>
          {:else}
            <div class="row compact">
              <div class="label">{_("reminder.after")}</div>
              <div class="after">
                <input
                  class="input"
                  type="number"
                  min="1"
                  value={Math.max(1, Math.round(((r.schedule as any).seconds ?? 60) / 60))}
                  oninput={(e) => {
                    const v = Math.max(1, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || 1));
                    updateSchedule(r.id, { kind: "after", seconds: v * 60, created_at: null });
                  }}
                />
                <span class="hint">{_("reminder.afterUnitMinutes")}</span>
              </div>
              <div class="hint">{_("reminder.afterResetHint")}</div>

            </div>
          {/if}

          <textarea
            class="textarea"
            rows="2"
            value={r.text}
            oninput={(e) => updateReminder(r.id, { text: (e.currentTarget as HTMLTextAreaElement).value })}
          ></textarea>
        </div>
      </div>
    {/each}

    {#if reminders.length === 0}
      <div class="empty">{_("reminder.noAlerts")}</div>
    {/if}
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: Inter, Avenir, Helvetica, Arial, sans-serif;
    background: radial-gradient(1200px 600px at 30% 10%, rgba(59, 130, 246, 0.18), transparent 55%),
      radial-gradient(900px 500px at 80% 20%, rgba(16, 185, 129, 0.12), transparent 60%),
      #0b1220;
    color: rgba(226, 232, 240, 0.95);
  }

  .container {
    padding: 12px;
    max-width: 900px;
    margin: 0 auto;
    box-sizing: border-box;
  }


  .header {
    margin-bottom: 10px;
  }

  .title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }

  h2 {
    margin: 0;
    font-size: 16px;
  }

  .sub {
    font-size: 12px;
    color: rgba(203, 213, 225, 0.75);
  }


  .sub.saving {
    color: #b45309;
  }

  .panel {
    border-radius: 16px;
    background: linear-gradient(
      180deg,
      rgba(15, 23, 42, 0.92) 0%,
      rgba(17, 24, 39, 0.82) 100%
    );
    border: 1px solid rgba(148, 163, 184, 0.22);
    color: rgba(226, 232, 240, 0.95);
    padding: 10px;
    margin-bottom: 12px;
  }

  .row {
    display: grid;
    grid-template-columns: 110px 1fr;
    gap: 10px;
    align-items: center;
    margin-bottom: 8px;
  }

  .row.compact {
    grid-template-columns: 110px 1fr;
    margin-bottom: 6px;
  }

  .row.actions {
    grid-template-columns: 1fr;
    justify-items: end;
    margin-bottom: 0;
  }

  .label {
    font-size: 12px;
    color: rgba(203, 213, 225, 0.75);
  }

  .input,
  .select,
  .textarea {
    width: 100%;
    border-radius: 10px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: rgba(2, 6, 23, 0.35);
    color: rgba(226, 232, 240, 0.95);
    padding: 6px 8px;
    box-sizing: border-box;
    font-size: 13px;
  }

  .textarea {
    resize: vertical;
    line-height: 1.35;
  }

  .weekdays {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    padding: 4px 8px;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(15, 23, 42, 0.45);
    font-size: 12px;
  }

  .after {
    display: grid;
    grid-template-columns: 1fr 120px;
    gap: 8px;
    align-items: center;
  }

  .btn {
    border-radius: 10px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: rgba(255, 255, 255, 0.12);
    color: rgba(226, 232, 240, 0.95);
    padding: 6px 10px;
    cursor: pointer;
    font-size: 13px;
  }

  .btn.primary {
    background: linear-gradient(135deg, #4f8ef7 0%, #2563eb 100%);
    border-color: rgba(37, 99, 235, 0.65);
    color: white;
  }

  .btn.danger {
    background: rgba(127, 29, 29, 0.35);
    border-color: rgba(248, 113, 113, 0.25);
    color: #fecaca;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .card {
    border-radius: 16px;
    background: rgba(15, 23, 42, 0.92);
    border: 1px solid rgba(148, 163, 184, 0.22);
    color: rgba(226, 232, 240, 0.95);
    padding: 10px;
  }

  .card.disabled {
    opacity: 0.72;
  }

  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }

  .left {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .switch {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    font-size: 13px;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 12px;
    color: rgba(203, 213, 225, 0.75);
  }

  .tag {
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(2, 6, 23, 0.3);
  }

  .next {
    opacity: 0.9;
  }

  .card-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .hint {
    color: rgba(203, 213, 225, 0.65);
    font-size: 12px;
  }

  .empty {
    padding: 14px;
    text-align: center;
    color: rgba(203, 213, 225, 0.65);
  }

</style>
