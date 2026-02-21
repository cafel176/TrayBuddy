<!--
========================================================================= 
触发器调试组件 (TriggerDebugger.svelte)
=========================================================================

功能概述:
- 展示和测试应用的触发器系统
- 显示定时触发器的状态和配置
- 列出所有事件触发器及其可触发状态
- 提供手动触发事件的功能

触发器类型:
1. 定时触发器: 基于当前持久状态的 trigger_time 和 trigger_rate 配置
2. 事件触发器: 响应 click、login 等事件
=========================================================================
-->

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen, emit } from "@tauri-apps/api/event";
  import { onMount, onDestroy } from "svelte";
  import { t, onLangChange } from "$lib/i18n";
  import type {
    StateInfo,
    StateChangeEvent,
    TriggerInfo,
    CanTriggerState,
    Live2DParameterSetting,
    PngRemixParameterSetting,
  } from "$lib/types/asset";

  // ======================================================================= //
  // 响应式翻译函数
  // ======================================================================= //

  let _langVersion = $state(0);
  let unsubLang: (() => void) | null = null;

  function _(key: string, params?: Record<string, string | number>): string {
    void _langVersion; // 依赖收集
    return t(key, params);
  }

  /** 检查状态消息是否包含错误信息 */
  function isError(msg: string): boolean {
    return msg.includes(_("common.failed")) || msg.includes("failed");
  }

  const I32_MIN = -2147483648;
  const I32_MAX = 2147483647;

  function formatTriggerCounterRange(start?: number, end?: number): string {
    const s = Number.isFinite(Number(start)) ? Number(start) : I32_MIN;
    const e = Number.isFinite(Number(end)) ? Number(end) : I32_MAX;

    const sText = s <= I32_MIN ? "*" : String(s);
    const eText = e >= I32_MAX ? "*" : String(e);
    return `[${sText}, ${eText}]`;
  }

  function formatTempRange(start?: number, end?: number): string {
    const s = Number.isFinite(Number(start)) ? Number(start) : I32_MIN;
    const e = Number.isFinite(Number(end)) ? Number(end) : I32_MAX;

    const sText = s <= I32_MIN ? "*" : `${s}°C`;
    const eText = e >= I32_MAX ? "*" : `${e}°C`;
    return `[${sText}, ${eText}]`;
  }

  function isTempRangeLimited(state: StateInfo): boolean {
    const s = Number.isFinite(Number(state.trigger_temp_start))
      ? Number(state.trigger_temp_start)
      : I32_MIN;
    const e = Number.isFinite(Number(state.trigger_temp_end))
      ? Number(state.trigger_temp_end)
      : I32_MAX;
    return s > I32_MIN || e < I32_MAX;
  }

  function isTriggerCounterRangeLimited(state: StateInfo): boolean {
    const s = Number.isFinite(Number(state.trigger_counter_start))
      ? Number(state.trigger_counter_start)
      : I32_MIN;
    const e = Number.isFinite(Number(state.trigger_counter_end))
      ? Number(state.trigger_counter_end)
      : I32_MAX;
    return s > I32_MIN || e < I32_MAX;
  }

  function formatWeather(weather?: string[]): string {
    return weather && weather.length > 0 ? weather.join(", ") : "";
  }

  function formatUptimeMinutes(minutes?: number): string {
    return _("state.uptimeMinutes", { minutes: minutes ?? 0 });
  }

  function formatTriggerableStates(states?: CanTriggerState[]): string {
    if (!states || states.length === 0) return "";
    return states
      .map((s) => `${s.state}${(s.weight ?? 1) !== 1 ? `(${s.weight})` : ""}`)
      .join(", ");
  }

  function formatLive2dParams(params?: Live2DParameterSetting[]): string {
    if (!params || params.length === 0) return "";
    return params
      .map((p) => {
        const target = p.target || "Parameter";
        return `${p.id}=${p.value} (${target})`;
      })
      .join(", ");
  }

  function formatPngRemixParams(params?: PngRemixParameterSetting[]): string {
    if (!params || params.length === 0) return "";
    return params.map((p) => `${p.type}:${p.name}`).join(", ");
  }

  // ======================================================================= //
  // 响应式状态
  // ======================================================================= //

  /** 所有触发器列表 */
  let triggers = $state<TriggerInfo[]>([]);

  /** 当前正在播放的状态 */
  let currentState = $state<StateInfo | null>(null);

  /** 当前持久状态 (用于显示定时触发器配置) */
  let persistentState = $state<StateInfo | null>(null);

  /** 队列中的下一个状态 */
  let nextState = $state<StateInfo | null>(null);

  /** 状态是否被锁定 */
  let isLocked = $state(false);

  /** 状态消息 */
  let statusMsg = $state(t("trigger.statusLoading"));

  /** 事件日志记录 */
  let eventLog = $state<string[]>([]);

  /** 状态变化事件的取消监听函数 */
  let unlisten: (() => void) | null = null;

  /** 播放状态事件的取消监听函数 */
  let unlistenPlayback: (() => void) | null = null;

  /** next_state变化事件的取消监听函数 */
  let unlistenNextState: (() => void) | null = null;

  /** 手动触发的自定义事件名输入 */
  let customEvent = $state("");

  // ======================================================================= //
  // 前端播放状态 (来自 animation 窗口)
  // ======================================================================= //

  /** 动画是否完成 */
  let animationComplete = $state(false);
  /** 音频是否完成 */
  let audioComplete = $state(false);
  /** 气泡是否完成 */
  let bubbleComplete = $state(false);
  /** 是否为单次播放模式 */
  let isPlayOnce = $state(false);

  // ======================================================================= //
  // 数据加载函数
  // ======================================================================= //

  /**
   * 从后端加载触发器和状态数据
   */
  async function loadData() {
    try {
      triggers = await invoke("get_all_triggers");
      currentState = await invoke("get_current_state");
      persistentState = await invoke("get_persistent_state");
      nextState = await invoke("get_next_state");
      isLocked = await invoke("is_state_locked");
      statusMsg = _("trigger.statusLoaded", { count: triggers.length });
    } catch (e) {
      statusMsg = _("trigger.statusLoadFailed") + " " + e;
    }
  }

  /**
   * 仅刷新 nextState（用于 next-state-changed 事件）
   */
  async function refreshNextState() {
    try {
      nextState = await invoke("get_next_state");
      addLog(
        _("trigger.logNextUpdate") +
          " " +
          (nextState?.name || _("trigger.none")),
      );
    } catch (e) {
      console.error("Failed to refresh next state:", e);
    }
  }

  // ======================================================================= //
  // 触发函数
  // ======================================================================= //

  /**
   * 触发指定事件
   * @param eventName 事件名称
   */
  async function triggerEvent(eventName: string) {
    try {
      addLog(_("trigger.logTriggerEvent") + " " + eventName);
      const result: boolean = await invoke("trigger_event", { eventName });
      if (result) {
        addLog(_("trigger.logTriggerSuccess", { event: eventName }));
        statusMsg = _("trigger.statusTriggerSuccess") + " " + eventName;
      } else {
        addLog(_("trigger.logTriggerNotFired", { event: eventName }));
        statusMsg = _("trigger.statusNotTriggered") + " " + eventName;
      }
      await loadData();
    } catch (e) {
      addLog(_("trigger.logTriggerError", { event: eventName }) + " " + e);
      statusMsg = _("trigger.statusTriggerFailed") + " " + e;
    }
  }

  /**
   * 触发自定义事件 (从输入框)
   */
  async function triggerCustomEvent() {
    if (!customEvent.trim()) {
      statusMsg = _("trigger.statusInputRequired");
      return;
    }
    await triggerEvent(customEvent.trim());
    customEvent = "";
  }

  // ======================================================================= //
  // 日志函数
  // ======================================================================= //

  /**
   * 添加日志条目
   * @param msg 日志消息
   */
  function addLog(msg: string) {
    const time = new Date().toLocaleTimeString();
    // 保留最近 30 条日志
    eventLog = [`[${time}] ${msg}`, ...eventLog.slice(0, 29)];
  }

  // ======================================================================= //
  // 生命周期
  // ======================================================================= //

  onMount(() => {
    const init = async () => {
      await loadData();

      // 监听语言变化
      unsubLang = onLangChange(() => {
        _langVersion++;
      });

      // 监听后端状态变化事件
      unlisten = await listen<StateChangeEvent>("state-change", (event) => {
        const { state, play_once } = event.payload;
        addLog(
          _("trigger.logStateChange") +
            " " +
            state.name +
            " (play_once: " +
            play_once +
            ")",
        );
        loadData();
      });

      // 监听前端播放状态事件
      unlistenPlayback = await listen<{
        animationComplete: boolean;
        audioComplete: boolean;
        bubbleComplete: boolean;
        isPlayOnce: boolean;
      }>("playback-status", (event) => {
        animationComplete = event.payload.animationComplete;
        audioComplete = event.payload.audioComplete;
        bubbleComplete = event.payload.bubbleComplete;
        isPlayOnce = event.payload.isPlayOnce;
      });

      // 监听 next_state 变化事件（分支选择时触发）
      unlistenNextState = await listen<{ name: string }>(
        "next-state-changed",
        (event) => {
          addLog(_("trigger.logNextStateEvent") + " " + event.payload.name);
          refreshNextState();
        },
      );

      // 请求当前播放状态
      emit("request-playback-status");
    };

    init().catch((e) => console.error("TriggerDebugger init failed:", e));
  });

  onDestroy(() => {
    unlisten?.();
    unlistenPlayback?.();
    unlistenNextState?.();
    unsubLang?.();
  });
</script>

<!-- ======================================================================= -->
<!-- 组件模板 -->
<!-- ======================================================================= -->

<div class="trigger-debugger">
  <h3>{_("trigger.title")}</h3>

  <!-- ================================================================= -->
  <!-- 状态卡片区域 - 展示三个核心状态 -->
  <!-- ================================================================= -->

  <div class="state-cards">
    <!-- 当前状态卡片 -->
    <div class="state-card current">
      <div class="card-header">{_("state.currentState")}</div>
      {#if currentState}
        <div class="state-name">{currentState.name}</div>
        <div class="state-meta">
          <span class="badge" class:persistent={currentState.persistent}>
            {currentState.persistent
              ? _("state.persistentTag")
              : _("state.temporaryTag")}
          </span>
          <span class="priority"
            >{_("state.priorityLabel")} {currentState.priority}</span
          >
          {#if isLocked}
            <span class="badge locked">{_("state.lockedTag")}</span>
          {/if}
        </div>
        <div class="state-detail">
          {#if currentState.anima}<div class="detail-row">
              <span class="label">{_("state.animationLabel")}</span>
              {currentState.anima}
            </div>{/if}
          {#if currentState.audio}<div class="detail-row">
              <span class="label">{_("state.audioLabel")}</span>
              {currentState.audio}
            </div>{/if}
          {#if currentState.text}<div class="detail-row">
              <span class="label">{_("state.textLabel")}</span>
              {currentState.text}
            </div>{/if}
          {#if currentState.next_state}<div class="detail-row">
              <span class="label">{_("state.nextStateLabel")}</span>
              <span class="next-state-value">{currentState.next_state}</span>
            </div>{/if}
          {#if (currentState.trigger_time ?? 0) > 0 && (currentState.trigger_rate ?? 0) > 0}<div class="detail-row">
              <span class="label">{_("state.timerLabel")}</span>
              {_("state.timerDesc", {
                interval: currentState.trigger_time ?? 0,
                chance: ((currentState.trigger_rate ?? 0) * 100).toFixed(0),
              })}
            </div>{/if}
          {#if currentState.mod_data_counter}<div class="detail-row">
              <span class="label">{_("state.modDataCounterLabel")}</span>
              <span class="counter-value">{currentState.mod_data_counter.op} {currentState.mod_data_counter.value}</span>
            </div>{/if}
          {#if isTriggerCounterRangeLimited(currentState)}<div class="detail-row">
              <span class="label">{_("state.triggerCounterRangeLabel")}</span>
              <span class="counter-value">{formatTriggerCounterRange(currentState.trigger_counter_start, currentState.trigger_counter_end)}</span>
            </div>{/if}
          {#if isTempRangeLimited(currentState)}<div class="detail-row">
              <span class="label">{_("state.triggerTempRangeLabel")}</span>
              {formatTempRange(currentState.trigger_temp_start, currentState.trigger_temp_end)}
            </div>{/if}
          {#if (currentState.trigger_uptime ?? 0) > 0}<div class="detail-row">
              <span class="label">{_("state.triggerUptimeLabel")}</span>
              {formatUptimeMinutes(currentState.trigger_uptime)}
            </div>{/if}
          {#if currentState.trigger_weather && currentState.trigger_weather.length > 0}<div class="detail-row">
              <span class="label">{_("state.triggerWeatherLabel")}</span>
              {formatWeather(currentState.trigger_weather)}
            </div>{/if}
          {#if currentState.date_start || currentState.date_end}<div class="detail-row">
              <span class="label">{_("state.dateRangeLabel")}</span>
              {currentState.date_start || "*"} ~ {currentState.date_end || "*"}
            </div>{/if}
          {#if currentState.time_start || currentState.time_end}<div class="detail-row">
              <span class="label">{_("state.timeRangeLabel")}</span>
              {currentState.time_start || "*"} ~ {currentState.time_end || "*"}
            </div>{/if}
          {#if currentState.can_trigger_states && currentState.can_trigger_states.length > 0}<div class="detail-row">
              <span class="label">{_("state.triggerableLabel")}</span>
              {formatTriggerableStates(currentState.can_trigger_states)}
            </div>{/if}
          {#if currentState.live2d_params && currentState.live2d_params.length > 0}<div class="detail-row">
              <span class="label">{_("state.live2dParamsLabel")}</span>
              {formatLive2dParams(currentState.live2d_params)}
            </div>{/if}
          {#if currentState.pngremix_params && currentState.pngremix_params.length > 0}<div class="detail-row">
              <span class="label">{_("state.pngremixParamsLabel")}</span>
              {formatPngRemixParams(currentState.pngremix_params)}
            </div>{/if}
          {#if currentState.branch_show_bubble === false}<div class="detail-row">
              <span class="label">{_("state.branchShowBubbleLabel")}</span>
              <span class="bubble-value">{_("common.no")}</span>
            </div>{/if}
        </div>

        <!-- 对话分支信息 (如果有) -->
        {#if currentState.branch && currentState.branch.length > 0}
          <div class="branch-info">
            <span class="label">{_("state.branchOptionsLabel")}</span>
            {#each currentState.branch as b}
              <span class="branch-item">{b.text} → {b.next_state}</span>
            {/each}
          </div>
        {/if}
      {:else}
        <div class="empty">{_("common.none")}</div>
      {/if}
    </div>

    <!-- 持久状态卡片 -->
    <div class="state-card persistent">
      <div class="card-header">{_("state.persistentState")}</div>
      {#if persistentState}
        <div class="state-name">{persistentState.name}</div>
        <div class="state-meta">
          <span class="anima"
            >{_("state.animationLabel")} {persistentState.anima}</span
          >
        </div>
      {:else}
        <div class="empty">{_("common.none")}</div>
      {/if}
    </div>

    <!-- 下一状态卡片 (队列中的状态) -->
    <div class="state-card next">
      <div class="card-header">{_("state.queuedState")}</div>
      <div class="card-hint">{_("state.queuedHint")}</div>
      {#if nextState}
        <div class="state-name">{nextState.name}</div>
        <div class="state-meta">
          <span class="badge" class:persistent={nextState.persistent}>
            {nextState.persistent
              ? _("state.persistentTag")
              : _("state.temporaryTag")}
          </span>
        </div>
      {:else}
        <div class="empty">{_("state.noNext")}</div>
      {/if}
    </div>
  </div>

  <!-- ================================================================= -->
  <!-- 前端播放状态区域 -->
  <!-- ================================================================= -->

  <div class="section">
    <h4>{_("state.frontendStatus")}</h4>
    <div class="playback-status">
      <div class="status-item" class:complete={animationComplete}>
        <span class="status-label">{_("state.animationStatus")}</span>
        <span class="status-value"
          >{animationComplete
            ? _("common.complete")
            : _("common.playing")}</span
        >
      </div>
      <div class="status-item" class:complete={audioComplete}>
        <span class="status-label">{_("state.audioStatus")}</span>
        <span class="status-value"
          >{audioComplete ? _("common.complete") : _("common.playing")}</span
        >
      </div>
      <div class="status-item" class:complete={bubbleComplete}>
        <span class="status-label">{_("state.bubbleStatus")}</span>
        <span class="status-value"
          >{bubbleComplete ? _("common.complete") : _("common.showing")}</span
        >
      </div>
      <div class="status-item mode">
        <span class="status-label">{_("state.modeStatus")}</span>
        <span class="status-value"
          >{isPlayOnce ? _("state.playOnce") : _("state.loopPlay")}</span
        >
      </div>
    </div>
  </div>

  <!-- ================================================================= -->
  <!-- 定时触发器状态区域 -->
  <!-- ================================================================= -->

  <div class="section timer-section">
    <h4>{_("trigger.timerStatus")}</h4>
    {#if persistentState}
      <div class="timer-info">
        <!-- 当前持久状态名称 -->
        <div class="info-row">
          <span class="label">{_("trigger.currentPersistent")}</span>
          <span class="value state-name">{persistentState.name}</span>
        </div>
        <!-- 触发间隔 -->
        <div class="info-row">
          <span class="label">{_("trigger.interval")}</span>
          <span class="value">
            {#if (persistentState.trigger_time ?? 0) > 0}
              {persistentState.trigger_time} {_("trigger.seconds")}
            {:else}
              <span class="disabled">{_("trigger.timerNotEnabled")}</span>
            {/if}
          </span>
        </div>
        <!-- 触发概率 -->
        <div class="info-row">
          <span class="label">{_("trigger.chance")}</span>
          <span class="value">
            {#if (persistentState.trigger_rate ?? 0) > 0}
              {((persistentState.trigger_rate ?? 0) * 100).toFixed(0)}%
            {:else}
              <span class="disabled">{_("trigger.timerNotEnabled")}</span>
            {/if}
          </span>
        </div>
        {#if persistentState.mod_data_counter}
          <div class="info-row">
            <span class="label">{_("state.modDataCounterLabel")}</span>
            <span class="value">
              {persistentState.mod_data_counter.op} {persistentState.mod_data_counter.value}
            </span>
          </div>
        {/if}
        {#if isTriggerCounterRangeLimited(persistentState)}
          <div class="info-row">
            <span class="label">{_("state.triggerCounterRangeLabel")}</span>
            <span class="value">
              {formatTriggerCounterRange(persistentState.trigger_counter_start, persistentState.trigger_counter_end)}
            </span>
          </div>
        {/if}
        {#if isTempRangeLimited(persistentState)}
          <div class="info-row">
            <span class="label">{_("state.triggerTempRangeLabel")}</span>
            <span class="value">
              {formatTempRange(persistentState.trigger_temp_start, persistentState.trigger_temp_end)}
            </span>
          </div>
        {/if}
        {#if (persistentState.trigger_uptime ?? 0) > 0}
          <div class="info-row">
            <span class="label">{_("state.triggerUptimeLabel")}</span>
            <span class="value">
              {formatUptimeMinutes(persistentState.trigger_uptime)}
            </span>
          </div>
        {/if}
        {#if persistentState.trigger_weather && persistentState.trigger_weather.length > 0}
          <div class="info-row">
            <span class="label">{_("state.triggerWeatherLabel")}</span>
            <span class="value">
              {formatWeather(persistentState.trigger_weather)}
            </span>
          </div>
        {/if}
        {#if persistentState.live2d_params && persistentState.live2d_params.length > 0}
          <div class="info-row">
            <span class="label">{_("state.live2dParamsLabel")}</span>
            <span class="value">
              {formatLive2dParams(persistentState.live2d_params)}
            </span>
          </div>
        {/if}
        {#if persistentState.pngremix_params && persistentState.pngremix_params.length > 0}
          <div class="info-row">
            <span class="label">{_("state.pngremixParamsLabel")}</span>
            <span class="value">
              {formatPngRemixParams(persistentState.pngremix_params)}
            </span>
          </div>
        {/if}
        <!-- 可触发的状态列表 -->
        <div class="info-row">
          <span class="label">{_("trigger.triggerableStates")}</span>
          <div class="state-tags">
            {#if persistentState.can_trigger_states && persistentState.can_trigger_states.length > 0}
              {#each persistentState.can_trigger_states as s}
                <span class="tag state-tag">{s.state}{(s.weight ?? 1) !== 1 ? `(${s.weight})` : ""}</span>
              {/each}
            {:else}
              <span class="disabled">{_("trigger.none")}</span>
            {/if}
          </div>
        </div>
        <!-- 定时触发器启用状态 -->
        <div class="timer-status">
          {#if (persistentState.trigger_time ?? 0) > 0 && (persistentState.trigger_rate ?? 0) > 0 && (persistentState.can_trigger_states?.length ?? 0) > 0}
            <span class="badge active">{_("trigger.timerEnabled")}</span>
          {:else}
            <span class="badge inactive">{_("trigger.timerDisabled")}</span>
          {/if}
        </div>
      </div>
    {:else}
      <div class="empty">{_("trigger.noPersistent")}</div>
    {/if}
  </div>

  <!-- ================================================================= -->
  <!-- 事件触发器列表 -->
  <!-- ================================================================= -->

  <div class="section">
    <h4>{_("trigger.eventTriggers")}</h4>
    {#if triggers.length > 0}
      <div class="trigger-list">
        {#each triggers as trigger}
          <div class="trigger-card">
            <div class="trigger-header">
              <span class="trigger-event">{trigger.event}</span>
              <button
                class="btn-trigger"
                onclick={() => triggerEvent(trigger.event)}
              >
                {_("trigger.triggerBtn")}
              </button>
            </div>
            <div class="trigger-groups">
              {#if trigger.can_trigger_states.length > 0}
                {#each trigger.can_trigger_states as group}
                  <div class="trigger-group">
                    <span class="group-condition">
                      {#if group.persistent_state}
                        {_("trigger.whenCondition", {
                          state: group.persistent_state,
                        })}
                      {:else}
                        {_("trigger.anyPersistent")}
                      {/if}
                    </span>
                    {#if group.allow_repeat === false}
                      <span class="tag state-tag">{_("trigger.noRepeat")}</span>
                    {/if}
                    <div class="group-states">

                      {#each group.states as s}
                        <span class="tag state-tag">{s.state}{(s.weight ?? 1) !== 1 ? `(${s.weight})` : ""}</span>
                      {/each}
                    </div>
                  </div>
                {/each}
              {:else}
                <span class="no-states">{_("trigger.noTriggerableStates")}</span
                >
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty">{_("trigger.noTriggers")}</div>
    {/if}
  </div>

  <!-- ================================================================= -->
  <!-- 手动触发区域 -->
  <!-- ================================================================= -->

  <div class="section">
    <h4>{_("trigger.manualTrigger")}</h4>
    <!-- 自定义事件输入 -->
    <div class="manual-trigger">
      <input
        type="text"
        placeholder={_("trigger.inputPlaceholder")}
        bind:value={customEvent}
        onkeydown={(e) => e.key === "Enter" && triggerCustomEvent()}
      />
      <button class="btn-primary" onclick={triggerCustomEvent}
        >{_("trigger.triggerBtn")}</button
      >
    </div>
    <!-- 快捷触发按钮 -->
    <div class="quick-triggers">
      <button class="btn-quick" onclick={() => triggerEvent("click")}
        >{_("trigger.quickClick")}</button
      >
      <button class="btn-quick" onclick={() => triggerEvent("click_up")}
        >{_("trigger.quickClickUp")}</button
      >
      <button class="btn-quick" onclick={() => triggerEvent("right_click")}
        >{_("trigger.quickRightClick")}</button
      >
      <button class="btn-quick" onclick={() => triggerEvent("right_click_up")}
        >{_("trigger.quickRightClickUp")}</button
      >
      <button class="btn-quick" onclick={() => triggerEvent("global_click")}
        >{_("trigger.quickGlobalClick")}</button
      >
      <button class="btn-quick" onclick={() => triggerEvent("global_click_up")}
        >{_("trigger.quickGlobalClickUp")}</button
      >
      <button class="btn-quick" onclick={() => triggerEvent("global_right_click")}
        >{_("trigger.quickGlobalRightClick")}</button
      >
      <button class="btn-quick" onclick={() => triggerEvent("global_right_click_up")}
        >{_("trigger.quickGlobalRightClickUp")}</button
      >
      <button class="btn-quick" onclick={() => triggerEvent("global_keydown")}
        >{_("trigger.quickGlobalKeydown")}</button
      >
      <button class="btn-quick" onclick={() => triggerEvent("global_keyup")}
        >{_("trigger.quickGlobalKeyup")}</button
      >
      <button class="btn-quick" onclick={() => triggerEvent("keydown:Space")}
        >{_("trigger.quickKeydownSpace")}</button
      >
      <button class="btn-quick" onclick={() => triggerEvent("keyup:Space")}
        >{_("trigger.quickKeyupSpace")}</button
      >
      <button class="btn-quick" onclick={() => triggerEvent("login")}
        >{_("trigger.quickLogin")}</button
      >
    </div>

  </div>

  <!-- ================================================================= -->
  <!-- 事件日志区域 -->
  <!-- ================================================================= -->

  <div class="section">
    <div class="section-header">
      <h4>{_("trigger.eventLog")}</h4>
      <button class="btn-tiny" onclick={() => (eventLog = [])}
        >{_("trigger.clear")}</button
      >
    </div>
    <div class="event-log">
      {#each eventLog as log}
        <div class="log-item">{log}</div>
      {:else}
        <div class="log-empty">{_("trigger.noEvents")}</div>
      {/each}
    </div>
  </div>

  <!-- ================================================================= -->
  <!-- 操作按钮 -->
  <!-- ================================================================= -->

  <div class="actions">
    <button class="refresh" onclick={loadData}
      >{_("trigger.refreshData")}</button
    >
  </div>

  <!-- 状态消息栏 -->
  <div class="status-bar" class:error={isError(statusMsg)}>
    {statusMsg}
  </div>
</div>

<style>
  .trigger-debugger {
    background: #ffffff;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
    max-width: 600px;
    margin: 20px auto;
    color: #333;
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
  }

  h3 {
    margin-top: 0;
    color: #2c3e50;
    border-bottom: 2px solid #eee;
    padding-bottom: 10px;
    margin-bottom: 20px;
  }

  h4 {
    margin: 0 0 10px 0;
    color: #34495e;
    font-size: 0.95em;
  }

  /* ================================================================= */
  /* 状态卡片区域 */
  /* ================================================================= */

  .state-cards {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 15px;
    margin-bottom: 20px;
  }

  .state-card {
    background: #f8f9fa;
    border-radius: 8px;
    padding: 12px;
    border-left: 4px solid #bdc3c7;
  }

  .state-card.current {
    border-left-color: #3498db;
  }

  .state-card.persistent {
    border-left-color: #27ae60;
  }

  .state-card.next {
    border-left-color: #9b59b6;
  }

  .card-header {
    font-size: 0.75em;
    color: #7f8c8d;
    text-transform: uppercase;
    margin-bottom: 5px;
  }

  .card-hint {
    font-size: 0.65em;
    color: #95a5a6;
    margin-bottom: 8px;
  }

  .state-name {
    font-size: 1.2em;
    font-weight: bold;
    color: #2c3e50;
  }

  .state-meta {
    display: flex;
    gap: 10px;
    margin-top: 5px;
    font-size: 0.8em;
  }

  .state-detail {
    margin-top: 8px;
    font-size: 0.75em;
    color: #7f8c8d;
  }

  .detail-row {
    margin-bottom: 2px;
  }

  .detail-row .label {
    color: #95a5a6;
  }

  .next-state-value {
    color: #9b59b6;
    font-weight: bold;
  }

  .counter-value {
    color: #e67e22;
    font-weight: bold;
  }

  .bubble-value {
    color: #e74c3c;
    font-weight: bold;
  }


  .branch-info {
    margin-top: 8px;
    font-size: 0.75em;
    color: #7f8c8d;
  }

  .branch-info .label {
    display: block;
    margin-bottom: 3px;
  }

  .branch-item {
    display: inline-block;
    background: #ecf0f1;
    padding: 2px 6px;
    border-radius: 3px;
    margin: 2px 4px 2px 0;
    color: #2c3e50;
  }

  .priority,
  .anima {
    color: #7f8c8d;
  }

  /* ================================================================= */
  /* 前端播放状态区域 */
  /* ================================================================= */

  .playback-status {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }

  .status-item {
    background: #fee2e2;
    border-radius: 6px;
    padding: 10px;
    text-align: center;
    border: 2px solid #fca5a5;
    transition: all 0.3s;
  }

  .status-item.complete {
    background: #d1fae5;
    border-color: #6ee7b7;
  }

  .status-item.mode {
    background: #e0e7ff;
    border-color: #a5b4fc;
  }

  .status-label {
    display: block;
    font-size: 0.75em;
    color: #6b7280;
    margin-bottom: 4px;
  }

  .status-value {
    display: block;
    font-weight: bold;
    font-size: 0.9em;
    color: #374151;
  }

  /* ================================================================= */
  /* 通用区域 */
  /* ================================================================= */

  .section {
    margin-bottom: 20px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .timer-section {
    background: #f8f9fa;
    border-radius: 8px;
    padding: 15px;
    border-left: 4px solid #9b59b6;
  }

  .timer-info {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .info-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .label {
    font-weight: 500;
    color: #7f8c8d;
    min-width: 100px;
  }

  .value {
    color: #2c3e50;
  }

  .timer-section .state-name {
    font-size: 1em;
    color: #8e44ad;
  }

  .disabled {
    color: #bdc3c7;
    font-style: italic;
  }

  .timer-status {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #eee;
  }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.75em;
    font-weight: bold;
    background: #e74c3c;
    color: white;
  }

  .badge.persistent {
    background: #27ae60;
  }

  .badge.locked {
    background: #e74c3c;
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.6;
    }
  }

  .badge.active {
    background: #27ae60;
    color: white;
  }

  .badge.inactive {
    background: #bdc3c7;
    color: #7f8c8d;
  }

  /* ================================================================= */
  /* 触发器列表 */
  /* ================================================================= */

  .trigger-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .trigger-card {
    background: #f8f9fa;
    border: 1px solid #eee;
    border-left: 3px solid #9b59b6;
    padding: 10px;
    border-radius: 4px;
  }

  .trigger-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .trigger-event {
    font-weight: bold;
    color: #8e44ad;
    font-size: 1em;
  }

  .trigger-groups {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .trigger-group {
    background: #f8f9fa;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 8px;
  }

  .group-condition {
    font-size: 0.8em;
    color: #7f8c8d;
    margin-bottom: 5px;
    display: block;
  }

  .group-condition {
    font-size: 0.8em;
    color: #7f8c8d;
    margin-bottom: 5px;
    display: block;
  }

  .group-states {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .state-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .tag {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.8em;
  }

  .state-tag {
    background: #fdebd0;
    border: 1px solid #f39c12;
    color: #d35400;
  }

  .no-states {
    font-size: 0.85em;
    color: #95a5a6;
    font-style: italic;
  }

  .empty {
    color: #bdc3c7;
    font-style: italic;
    text-align: center;
    padding: 15px;
  }

  .manual-trigger {
    display: flex;
    gap: 10px;
    margin-bottom: 10px;
  }

  .manual-trigger input {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 0.9em;
  }

  .quick-triggers {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .btn-trigger {
    padding: 4px 10px;
    font-size: 0.8em;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: #9b59b6;
    color: white;
    transition: all 0.2s;
  }

  .btn-trigger:hover {
    background: #8e44ad;
  }

  .btn-primary {
    padding: 8px 16px;
    font-size: 0.9em;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    background: #3498db;
    color: white;
    font-weight: 600;
    transition: all 0.2s;
  }

  .btn-primary:hover {
    background: #2980b9;
  }

  .btn-quick {
    padding: 5px 12px;
    font-size: 0.8em;
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
    background: #fff;
    color: #666;
    transition: all 0.2s;
  }

  .btn-quick:hover {
    border-color: #9b59b6;
    color: #9b59b6;
  }

  .btn-tiny {
    padding: 2px 6px;
    font-size: 0.7em;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    background: #bdc3c7;
    color: #2c3e50;
  }

  .btn-tiny:hover {
    background: #95a5a6;
  }

  .event-log {
    background: #2c3e50;
    border-radius: 6px;
    padding: 10px;
    max-height: 150px;
    overflow-y: auto;
    font-family: "Consolas", monospace;
    font-size: 0.75em;
  }

  .log-item {
    color: #1abc9c;
    margin-bottom: 3px;
  }

  .log-empty {
    color: #7f8c8d;
    font-style: italic;
  }

  .actions {
    display: flex;
    gap: 10px;
  }

  .refresh {
    flex: 1;
    padding: 10px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    background: #9b59b6;
    color: white;
    font-weight: 600;
    transition: all 0.2s;
  }

  .refresh:hover {
    background: #8e44ad;
  }

  .status-bar {
    margin-top: 15px;
    font-size: 0.85em;
    color: #7f8c8d;
    text-align: center;
    padding: 5px;
    background: #f8f9fa;
    border-radius: 4px;
  }

  .status-bar.error {
    color: #e74c3c;
    background: #fdf2f2;
  }

  @media (prefers-color-scheme: dark) {
    .trigger-debugger {
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

    .state-card {
      background: #34495e;
    }

    .state-name {
      color: #ecf0f1;
    }

    .card-hint {
      color: #7f8c8d;
    }

    .state-detail {
      color: #95a5a6;
    }

    .next-state-value {
      color: #bb8fce;
    }

    .branch-item {
      background: #3d566e;
      color: #ecf0f1;
    }

    .timer-section {
      background: #34495e;
    }

    .timer-section .state-name {
      color: #bb8fce;
    }

    .trigger-card {
      background: #34495e;
      border-color: #455a64;
    }

    .trigger-group {
      background: #3d566e;
      border-color: #455a64;
    }

    .manual-trigger input {
      background: #34495e;
      border-color: #455a64;
      color: #ecf0f1;
    }

    .btn-quick {
      background: #34495e;
      border-color: #455a64;
      color: #bdc3c7;
    }

    .status-bar {
      background: #34495e;
      color: #bdc3c7;
    }

    .status-bar.error {
      background: #5a3e3e;
    }

    .label {
      color: #95a5a6;
    }

    .empty {
      color: #7f8c8d;
    }

    .status-item {
      background: #5a3e3e;
      border-color: #7f5a5a;
    }

    .status-item.complete {
      background: #2d5a4a;
      border-color: #4a8a6a;
    }

    .status-item.mode {
      background: #3d4a6a;
      border-color: #5a6a8a;
    }

    .status-label {
      color: #9ca3af;
    }

    .status-value {
      color: #ecf0f1;
    }
  }
</style>
