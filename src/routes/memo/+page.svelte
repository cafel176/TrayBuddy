<!--
========================================================================= 
备忘录窗口 (+page.svelte)
=========================================================================

功能概述:
- 展示/编辑用户备忘录（存储于 UserInfo.memos）
- 支持分类、按类别折叠、添加/删除、调整顺序、置顶
- 修改后立即保存（带轻量防抖，避免每个按键都落盘）
=========================================================================
-->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { t, initI18n, destroyI18n, onLangChange } from "$lib/i18n";

  type MemoItem = {
    id: string;
    category: string;
    content: string;
    pinned: boolean;
    order: number;
  };

  let _langVersion = $state(0);
  let unsubLang: (() => void) | null = null;

  function _(key: string, params?: Record<string, string | number>): string {
    void _langVersion;
    return t(key, params);
  }

  let memos = $state<MemoItem[]>([]);
  let statusMsg = $state("");
  let saving = $state(false);

  // UI 状态
  let collapsed = $state<Record<string, boolean>>({});
  let newMemoContent = $state("");
  let newMemoCategory = $state("");

  const DEFAULT_CATEGORY = "默认";

  function normalizeCategory(cat: string): string {
    const c = (cat ?? "").trim();
    return c.length ? c : DEFAULT_CATEGORY;
  }

  function getCategories(): string[] {
    const set = new Set<string>();
    for (const m of memos) set.add(normalizeCategory(m.category));
    if (set.size === 0) set.add(DEFAULT_CATEGORY);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  function getMemosByCategory(cat: string): MemoItem[] {
    const c = normalizeCategory(cat);
    const list = memos
      .filter((m) => normalizeCategory(m.category) === c)
      // pinned 优先，再按 order
      .slice()
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return (a.order ?? 0) - (b.order ?? 0);
      });
    return list;
  }

  function ensureCollapsedKeys() {
    for (const cat of getCategories()) {
      if (collapsed[cat] === undefined) collapsed[cat] = false;
    }
  }

  function nextOrderForCategory(cat: string): number {
    const list = memos.filter(
      (m) => normalizeCategory(m.category) === normalizeCategory(cat),
    );
    const max = list.reduce((acc, m) => Math.max(acc, m.order ?? 0), 0);
    return max + 1;
  }

  async function load() {
    statusMsg = _("memo.loading");
    try {
      const data = (await invoke("get_memos")) as MemoItem[];
      memos = (data ?? []).map((m) => ({
        ...m,
        category: normalizeCategory(m.category),
      }));
      ensureCollapsedKeys();
      statusMsg = _("memo.loaded");
    } catch (e) {
      statusMsg = `${_("common.loadFailed")} ${e}`;
    }
  }

  let saveTimer: number | null = null;
  function scheduleSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    // “立刻保存”但避免每次按键都落盘：做一个很短的防抖
    saveTimer = window.setTimeout(() => {
      void persist();
    }, 250);
  }

  async function persist() {
    saving = true;
    try {
      // 重排 order：按当前渲染逻辑给每个分类重新编号，保证稳定
      const rebuilt: MemoItem[] = [];
      for (const cat of getCategories()) {
        const list = getMemosByCategory(cat);
        let idx = 0;
        for (const m of list) {
          rebuilt.push({
            ...m,
            category: normalizeCategory(m.category),
            order: idx++,
          });
        }
      }

      memos = rebuilt;

      await invoke("set_memos", { memos });
      statusMsg = _("memo.saved");
    } catch (e) {
      statusMsg = `${_("common.saveFailed")} ${e}`;
    } finally {
      saving = false;
    }
  }

  function toggleCollapse(cat: string) {
    const c = normalizeCategory(cat);
    collapsed[c] = !collapsed[c];
  }

  function createMemo(category: string, content: string) {
    const cat = normalizeCategory(category);
    const text = (content ?? "").trim();
    if (!text.length) return;

    const id = crypto.randomUUID();
    const order = nextOrderForCategory(cat);
    memos = [
      ...memos,
      {
        id,
        category: cat,
        content: text,
        pinned: false,
        order,
      },
    ];

    ensureCollapsedKeys();
    scheduleSave();
  }

  function addFromTopBar() {
    createMemo(newMemoCategory, newMemoContent);
    newMemoContent = "";
  }

  function deleteMemo(id: string) {
    memos = memos.filter((m) => m.id !== id);
    scheduleSave();
  }

  function updateMemo(id: string, patch: Partial<MemoItem>) {
    memos = memos.map((m) => (m.id === id ? { ...m, ...patch } : m));
    scheduleSave();
  }

  function moveMemo(cat: string, id: string, dir: -1 | 1) {
    const c = normalizeCategory(cat);
    const list = getMemosByCategory(c);
    const idx = list.findIndex((m) => m.id === id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= list.length) return;

    const a = list[idx];
    const b = list[target];

    // 交换 order（简单且可预期）
    updateMemo(a.id, { order: b.order });
    updateMemo(b.id, { order: a.order });
  }

  function togglePinned(_cat: string, id: string) {
    const m = memos.find((x) => x.id === id);
    if (!m) return;
    updateMemo(id, { pinned: !m.pinned });
  }

  onMount(() => {
    const init = async () => {
      unsubLang = onLangChange(() => {
        _langVersion++;
        getCurrentWindow().setTitle(_("common.memoTitle"));
      });

      await initI18n();
      _langVersion++;
      getCurrentWindow().setTitle(_("common.memoTitle"));

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
      <h2>{_("memo.title")}</h2>
      <div class="sub" class:saving={saving}>{statusMsg}</div>
    </div>

    <div class="toolbar">
      <input
        class="category"
        placeholder={_("memo.categoryPlaceholder")}
        bind:value={newMemoCategory}
      />
      <textarea
        class="content"
        rows="2"
        placeholder={_("memo.contentPlaceholder")}
        bind:value={newMemoContent}
      ></textarea>
      <button
        class="btn primary"
        onclick={addFromTopBar}
        disabled={!newMemoContent.trim().length}
        >{_("memo.add")}</button
      >
    </div>
  </header>

  <section class="list">
    {#each getCategories() as cat}
      <div class="category-block">
        <div class="category-header">
          <button class="collapse" onclick={() => toggleCollapse(cat)}>
            {#if collapsed[normalizeCategory(cat)]}
              ▶
            {:else}
              ▼
            {/if}
          </button>
          <div class="cat-name">{cat}</div>
          <div class="cat-actions">
            <button
              class="btn"
              onclick={() => createMemo(cat, _("memo.quickAddDefault"))}
              >{_("memo.quickAdd")}</button
            >
          </div>
        </div>

        {#if !collapsed[normalizeCategory(cat)]}
          <div class="items">
            {#each getMemosByCategory(cat) as m (m.id)}
              <div class="item" class:pinned={m.pinned}>
                <div class="item-head">
                  <button class="pin" onclick={() => togglePinned(cat, m.id)}>
                    {m.pinned ? "📌" : "📍"}
                  </button>
                  <div class="actions">
                    <button class="btn" onclick={() => moveMemo(cat, m.id, -1)}>↑</button>
                    <button class="btn" onclick={() => moveMemo(cat, m.id, 1)}>↓</button>
                    <button class="btn danger" onclick={() => deleteMemo(m.id)}
                      >{_("memo.delete")}</button
                    >
                  </div>
                </div>

                <textarea
                  class="memo-text"
                  rows="2"
                  value={m.content}
                  oninput={(e) =>
                    updateMemo(m.id, {
                      content: (e.currentTarget as HTMLTextAreaElement).value,
                    })}
                ></textarea>
              </div>
            {/each}


            {#if getMemosByCategory(cat).length === 0}
              <div class="empty">{_("memo.empty")}</div>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: Inter, Avenir, Helvetica, Arial, sans-serif;
    background: #f8fafc;
    color: #1f2937;
  }


  .container {
    padding: 12px;
    max-width: 1100px;
    margin: 0 auto;
    min-height: 100vh;
    box-sizing: border-box;
  }

  .header {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
  }


  .title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  h2 {
    margin: 0;
    letter-spacing: -0.2px;
  }

  .sub {
    font-size: 0.9em;
    color: rgba(55, 65, 81, 0.8);
  }

  .sub.saving {
    color: #b45309;
  }

  .toolbar {
    display: grid;
    grid-template-columns: 160px 1fr 96px;
    gap: 8px;
    align-items: start;
  }


  .category,
  .content,
  .memo-text {
    width: 100%;
    border: 1px solid rgba(255, 255, 255, 0.55);
    border-radius: 10px;
    padding: 6px 8px;
    font-size: 13px;
    line-height: 1.35;
    background: rgba(255, 255, 255, 0.72);
    box-sizing: border-box;
    box-shadow: 0 6px 14px rgba(0, 0, 0, 0.06);
    backdrop-filter: blur(10px);
  }


  .category:focus,
  .content:focus,
  .memo-text:focus {
    outline: none;
    border-color: rgba(59, 130, 246, 0.55);
    box-shadow:
      0 10px 24px rgba(0, 0, 0, 0.08),
      0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .content {
    resize: vertical;
  }

  .btn {
    border: 1px solid rgba(255, 255, 255, 0.55);
    background: rgba(255, 255, 255, 0.7);
    border-radius: 10px;
    padding: 6px 8px;
    font-size: 13px;
    cursor: pointer;
    box-shadow: 0 6px 14px rgba(0, 0, 0, 0.06);
    backdrop-filter: blur(10px);
  }


  .btn:hover {
    background: rgba(255, 255, 255, 0.82);
  }

  .btn.primary {
    background: linear-gradient(135deg, #4f8ef7 0%, #2563eb 100%);
    color: white;
    border-color: rgba(37, 99, 235, 0.65);
  }

  .btn.primary:hover {
    background: linear-gradient(135deg, #5b97f8 0%, #2d6bf0 100%);
  }

  .btn.primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn.danger {
    background: rgba(254, 242, 242, 0.8);
    border-color: rgba(248, 113, 113, 0.35);
    color: #b91c1c;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }


  .category-block {
    border-radius: 16px;
    overflow: hidden;
    /* 分类块本体：暗色面板，提高与亮色窗口背景的对比度 */
    background: linear-gradient(
      180deg,
      rgba(15, 23, 42, 0.92) 0%,
      rgba(17, 24, 39, 0.82) 100%
    );
    border: 1px solid rgba(148, 163, 184, 0.22);
    box-shadow:
      0 18px 46px rgba(0, 0, 0, 0.18),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
    backdrop-filter: blur(12px);
  }



  .category-header {
    display: grid;
    grid-template-columns: 36px 1fr auto;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    /* 折叠签：暗色顶栏，与分类块本体有一点层次差 */
    background: linear-gradient(
      180deg,
      rgba(2, 6, 23, 0.55) 0%,
      rgba(15, 23, 42, 0.45) 100%
    );
    border-bottom: 1px solid rgba(148, 163, 184, 0.16);
    box-shadow:
      inset 0 -1px 0 rgba(0, 0, 0, 0.35),
      inset 0 1px 0 rgba(255, 255, 255, 0.04);
    position: relative;
  }


  .category-header::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: linear-gradient(180deg, rgba(37, 99, 235, 0.85), rgba(59, 130, 246, 0.35));
    opacity: 0.9;
  }



  .collapse {
    width: 30px;
    height: 30px;
    border-radius: 10px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: rgba(15, 23, 42, 0.55);
    color: rgba(226, 232, 240, 0.92);
    cursor: pointer;
  }



  .cat-name {
    font-weight: 750;
    color: rgba(226, 232, 240, 0.95);
  }


  .items {
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }


  .item {
    border-radius: 16px;
    padding: 8px;
    background: rgba(15, 23, 42, 0.45);
    border: 1px solid rgba(148, 163, 184, 0.16);
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.16);
    backdrop-filter: blur(12px);
  }



  .item.pinned {
    border-color: rgba(245, 158, 11, 0.45);
    background: rgba(120, 53, 15, 0.22);
  }


  .item-head {
    display: grid;
    grid-template-columns: 34px 1fr;
    gap: 8px;
    align-items: center;
    margin-bottom: 6px;
  }


  .pin {
    width: 30px;
    height: 30px;
    border-radius: 10px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: rgba(15, 23, 42, 0.55);
    color: rgba(226, 232, 240, 0.92);
    cursor: pointer;
  }





  .actions {
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: flex-end;
  }


  .memo-text {
    resize: vertical;
    /* 分类面板为暗色时，条目编辑区也采用暗色输入风格 */
    background: rgba(2, 6, 23, 0.35);
    border-color: rgba(148, 163, 184, 0.18);
    color: rgba(226, 232, 240, 0.95);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
  }




  .empty {
    color: rgba(226, 232, 240, 0.65);
    font-style: italic;
    text-align: center;
    padding: 12px;
  }



</style>

