<!--
========================================================================= 
环境信息调试组件 (EnvironmentDebugger.svelte)
=========================================================================

功能概述:
- 显示系统日期时间信息
- 显示地理位置信息（通过 IP API 获取）
- 显示天气信息（需要联网）
- 显示当前季节和时间段
- 显示所有使用的 API 信息
=========================================================================
-->

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { onMount, onDestroy } from "svelte";
  import {
    DEBUG_CLOCK_UPDATE_INTERVAL_MS,
  } from "$lib/constants";
  import { t, onLangChange, tArray } from "$lib/i18n";

  // ======================================================================= //
  // i18n 响应式支持
  // ======================================================================= //

  let _langVersion = $state(0);
  let unsubLang: (() => void) | null = null;

  function _(key: string, params?: Record<string, string | number>): string {
    void _langVersion;
    return t(key, params);
  }

  function _arr(key: string): string[] {
    void _langVersion;
    return tArray(key);
  }

  // ======================================================================= //
  // 类型定义
  // ======================================================================= //

  /** 日期时间信息 */
  interface DateTimeInfo {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    weekday: number;
    timestamp: number;
  }

  /** 地理位置信息 */
  interface GeoLocation {
    latitude: number;
    longitude: number;
    timezone: string | null;
    is_northern_hemisphere: boolean;
    city: string | null;
    region: string | null;
    country: string | null;
  }

  /** 天气信息 */
  interface WeatherInfo {
    condition: string;
    condition_code: string;
    temperature: number;
    feels_like: number | null;
    humidity: number | null;
    wind_speed: number | null;
  }

  /** 完整环境信息 */
  interface EnvironmentInfo {
    location: GeoLocation | null;
    datetime: DateTimeInfo;
    weather: WeatherInfo | null;
  }

  /** 环境更新事件数据 */
  interface EnvironmentUpdateEvent {
    location: GeoLocation | null;
    weather: WeatherInfo | null;
  }

  // ======================================================================= //
  // 响应式状态
  // ======================================================================= //

  /** 环境信息 */
  let envInfo = $state<EnvironmentInfo | null>(null);

  /** 当前季节 */
  let season = $state<string>("");

  /** 当前时间段 */
  let timePeriod = $state<string>("");

  /** 状态消息 */
  let statusMsg = $state("");

  /** 是否正在加载天气 */
  let loadingWeather = $state(false);

  /** 是否正在刷新地理位置 */
  let loadingLocation = $state(false);

  /** 定时器ID */
  let timerInterval: ReturnType<typeof setInterval> | null = null;

  /** 事件监听器取消函数 */
  let unlistenEnvUpdate: UnlistenFn | null = null;

  // ======================================================================= //
  // 辅助函数
  // ======================================================================= //

  /** 获取星期几名称 */
  function getWeekdayName(weekday: number): string {
    const names = _arr("environment.weekdays");
    return names[weekday] || _("common.unknown");
  }

  /** 获取季节中文名 */
  function getSeasonName(s: string): string {
    return _(`environment.seasons.${s}`) || s;
  }

  /** 获取时间段中文名 */
  function getTimePeriodName(p: string): string {
    return _(`environment.timePeriods.${p}`) || p;
  }

  /** 格式化时间 */
  function formatTime(dt: DateTimeInfo): string {
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(dt.hour)}:${pad(dt.minute)}:${pad(dt.second)}`;
  }

  /** 格式化日期 */
  function formatDate(dt: DateTimeInfo): string {
    return _("environment.dateFormat", {
      year: dt.year,
      month: dt.month,
      day: dt.day,
    });
  }

  // ======================================================================= //
  // 数据加载函数
  // ======================================================================= //

  /** 更新时间（本地 JS 实现，零 IPC） */
  function updateTime() {
    if (!envInfo) return;

    const now = new Date();
    envInfo.datetime = {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      hour: now.getHours(),
      minute: now.getMinutes(),
      second: now.getSeconds(),
      weekday: now.getDay(), // 0-6 matches backend (0=Sun)
      timestamp: Math.floor(now.getTime() / 1000),
    };
  }

  /** 加载完整环境信息 */
  async function loadBasicInfo() {
    try {
      // 并行请求数据以加快加载速度
      const [datetime, location, weather, seasonRes, timePeriodRes] =
        await Promise.all([
          invoke<DateTimeInfo>("get_datetime_info"),
          invoke<GeoLocation | null>("get_location_info").catch((e) => {
            console.warn("Failed to get location:", e);
            return null;
          }),
          invoke<WeatherInfo | null>("get_weather_info").catch((e) => {
            console.warn("Failed to get weather:", e);
            return null;
          }),
          invoke<string>("get_season_info"),
          invoke<string>("get_time_period_info"),
        ]);

      season = seasonRes;
      timePeriod = timePeriodRes;

      envInfo = {
        datetime,
        location,
        weather: weather || envInfo?.weather || null,
      };
      statusMsg = _("environment.statusLoaded");
    } catch (e) {
      statusMsg = `${_("common.loadFailed")} ${e}`;
      console.error("loadBasicInfo failed:", e);
    }
  }

  /** 刷新地理位置（强制重新获取） */
  async function refreshLocation() {
    loadingLocation = true;
    statusMsg = _("environment.statusRefreshingLocation");
    try {
      const location: GeoLocation | null = await invoke(
        "refresh_location_info",
      );
      if (envInfo) {
        envInfo = { ...envInfo, location };
      }
      statusMsg = location
        ? _("environment.statusLocationRefreshed")
        : _("environment.statusLocationFailed");
    } catch (e) {
      statusMsg = `${_("environment.statusRefreshFailed")} ${e}`;
    } finally {
      loadingLocation = false;
    }
  }

  /** 加载天气信息（需要联网） */
  async function loadWeather() {
    loadingWeather = true;
    statusMsg = _("environment.statusFetchingWeather");
    try {
      const weather: WeatherInfo | null = await invoke("get_weather_info");
      if (envInfo) {
        envInfo = { ...envInfo, weather };
      }
      statusMsg = weather
        ? _("environment.statusWeatherUpdated")
        : _("environment.statusWeatherFailed");
    } catch (e) {
      statusMsg = `${_("environment.statusWeatherError")} ${e}`;
    } finally {
      loadingWeather = false;
    }
  }

  /** 完整刷新 */
  async function refresh() {
    await loadBasicInfo();
  }

  // ======================================================================= //
  // 生命周期
  // ======================================================================= //

  onMount(() => {
    unsubLang = onLangChange(() => {
      _langVersion++;
    });
    statusMsg = _("common.loading");

    // 异步加载数据，不阻塞组件挂载
    loadBasicInfo();

    // 每秒只更新时间，不重新请求所有数据
    timerInterval = setInterval(updateTime, DEBUG_CLOCK_UPDATE_INTERVAL_MS);

    // 监听环境信息更新事件（启动时后台获取完成后推送）
    let unlistenReceived: UnlistenFn | undefined;

    listen<EnvironmentUpdateEvent>("environment-updated", (event) => {
      console.log(
        "[EnvironmentDebugger] Received environment update:",
        event.payload,
      );
      const { location, weather } = event.payload;
      if (envInfo) {
        envInfo = {
          ...envInfo,
          location: location || envInfo.location,
          weather: weather || envInfo.weather,
        };
      }
      statusMsg = _("environment.statusBackgroundUpdate");
    })
      .then((u) => (unlistenReceived = u))
      .catch((e) => console.error("Failed to listen environment-updated:", e));

    unlistenEnvUpdate = () => {
      if (unlistenReceived) unlistenReceived();
    };
  });

  onDestroy(() => {
    unsubLang?.();
    if (timerInterval) {
      clearInterval(timerInterval);
    }
    if (unlistenEnvUpdate) {
      unlistenEnvUpdate();
    }
  });
</script>

<!-- ======================================================================= -->
<!-- 组件模板 -->
<!-- ======================================================================= -->

<div class="env-debugger">
  <h3>{_("environment.title")}</h3>

  {#if envInfo}
    <!-- ================================================================= -->
    <!-- 日期时间区域 -->
    <!-- ================================================================= -->

    <div class="section datetime-section">
      <h4>📅 {_("environment.datetime")}</h4>
      <div class="datetime-display">
        <div class="time-large">{formatTime(envInfo.datetime)}</div>
        <div class="date-info">
          <span class="date">{formatDate(envInfo.datetime)}</span>
          <span class="weekday">{getWeekdayName(envInfo.datetime.weekday)}</span
          >
        </div>
      </div>
      <div class="datetime-meta">
        <div class="meta-item">
          <span class="label">{_("environment.season")}</span>
          <span class="value">{getSeasonName(season)}</span>
        </div>
        <div class="meta-item">
          <span class="label">{_("environment.timePeriod")}</span>
          <span class="value">{getTimePeriodName(timePeriod)}</span>
        </div>
        <div class="meta-item">
          <span class="label">{_("environment.timestamp")}</span>
          <span class="value mono">{envInfo.datetime.timestamp}</span>
        </div>
      </div>
    </div>

    <!-- ================================================================= -->
    <!-- 地理位置区域 -->
    <!-- ================================================================= -->

    <div class="section location-section">
      <div class="section-header">
        <h4>🌍 {_("environment.location")}</h4>
        <button
          class="btn-small"
          onclick={refreshLocation}
          disabled={loadingLocation}
        >
          {loadingLocation ? _("common.refreshing") : _("common.refresh")}
        </button>
      </div>
      {#if envInfo.location}
        <!-- 城市和地区信息（突出显示） -->
        {#if envInfo.location.city || envInfo.location.region}
          <div class="location-highlight">
            {#if envInfo.location.city}
              <span class="city">{envInfo.location.city}</span>
            {/if}
            {#if envInfo.location.region && envInfo.location.country}
              <span class="region"
                >{envInfo.location.region}, {envInfo.location.country}</span
              >
            {:else if envInfo.location.country}
              <span class="region">{envInfo.location.country}</span>
            {/if}
          </div>
        {/if}

        <div class="location-info">
          <div class="info-row">
            <span class="label">{_("environment.timezone")}</span>
            <span class="value"
              >{envInfo.location.timezone || _("common.unknown")}</span
            >
          </div>
          <div class="info-row">
            <span class="label">{_("environment.longitude")}</span>
            <span class="value">{envInfo.location.longitude.toFixed(4)}°</span>
          </div>
          <div class="info-row">
            <span class="label">{_("environment.latitude")}</span>
            <span class="value">{envInfo.location.latitude.toFixed(4)}°</span>
          </div>
          <div class="info-row">
            <span class="label">{_("environment.hemisphere")}</span>
            <span
              class="value badge"
              class:northern={envInfo.location.is_northern_hemisphere}
            >
              {envInfo.location.is_northern_hemisphere
                ? _("environment.hemisphereNorth")
                : _("environment.hemisphereSouth")}
            </span>
          </div>
        </div>
      {:else}
        <div class="empty">{_("environment.locationUnavailable")}</div>
      {/if}
    </div>

    <!-- ================================================================= -->
    <!-- 天气区域 -->
    <!-- ================================================================= -->

    <div class="section weather-section">
      <div class="section-header">
        <h4>🌤️ {_("environment.weather")}</h4>
        <button
          class="btn-small"
          onclick={loadWeather}
          disabled={loadingWeather}
        >
          {loadingWeather ? _("common.loading") : _("environment.getWeather")}
        </button>
      </div>
      {#if envInfo.weather}
        <div class="weather-display">
          <div class="weather-main">
            <span class="temp">{envInfo.weather.temperature.toFixed(1)}°C</span>
            <span class="condition">{envInfo.weather.condition}</span>
          </div>
          <div class="weather-details">
            {#if envInfo.weather.condition_code}
              <div class="detail-item">
                <span class="label">{_("environment.conditionCode")}</span>
                <span class="value">{envInfo.weather.condition_code}</span>
              </div>
            {/if}
            {#if envInfo.weather.feels_like !== null}

              <div class="detail-item">
                <span class="label">{_("environment.feelsLike")}</span>
                <span class="value"
                  >{envInfo.weather.feels_like.toFixed(1)}°C</span
                >
              </div>
            {/if}
            {#if envInfo.weather.humidity !== null}
              <div class="detail-item">
                <span class="label">{_("environment.humidity")}</span>
                <span class="value">{envInfo.weather.humidity}%</span>
              </div>
            {/if}
            {#if envInfo.weather.wind_speed !== null}
              <div class="detail-item">
                <span class="label">{_("environment.windSpeed")}</span>
                <span class="value"
                  >{envInfo.weather.wind_speed.toFixed(1)} km/h</span
                >
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <div class="empty">
          {_("environment.weatherHint")}
          <br /><small>{_("environment.weatherHintOnline")}</small>
        </div>
      {/if}
    </div>

    <!-- ================================================================= -->
    <!-- API 信息区域 -->
    <!-- ================================================================= -->

    <div class="section api-section">
      <h4>🔗 {_("environment.apiInfo")}</h4>

      <!-- IP 地理位置 API -->
      <div class="api-group">
        <div class="api-group-title">📍 {_("environment.ipLocationApi")}</div>
        <div class="api-info">
          <div class="api-item">
            <span class="label">{_("environment.provider")}</span>
            <span class="value">ip-api.com</span>
          </div>
          <div class="api-item">
            <span class="label">{_("environment.endpoint")}</span>
            <span class="value mono">http://ip-api.com/json/</span>
          </div>
          <div class="api-item">
            <span class="label">{_("environment.params")}</span>
            <span class="value mono"
              >fields=status,country,regionName,city,lat,lon,timezone&lang=zh-CN</span
            >
          </div>
          <div class="api-item">
            <span class="label">{_("environment.cache")}</span>
            <span class="value">{_("environment.cacheRuntime")}</span>
          </div>
          <div class="api-item">
            <span class="label">{_("environment.cost")}</span>
            <span class="value highlight">{_("environment.costFree")}</span>
          </div>
          <div class="api-item">
            <span class="label">{_("environment.limit")}</span>
            <span class="value"
              >45 {_("environment.response")}/{_("environment.minutes")}</span
            >
          </div>
        </div>
        <div class="api-links">
          <a
            href="http://ip-api.com/docs/api:json"
            target="_blank"
            rel="noopener">{_("environment.apiDocs")}</a
          >
          <span class="separator">|</span>
          <a
            href="http://ip-api.com/json/?fields=status,country,regionName,city,lat,lon,timezone&lang=zh-CN"
            target="_blank"
            rel="noopener">{_("environment.testRequest")}</a
          >
        </div>
      </div>

      <!-- 天气 API -->
      <div class="api-group">
        <div class="api-group-title">🌤️ {_("environment.weatherApi")}</div>
        <div class="api-info">
          <div class="api-item">
            <span class="label">{_("environment.provider")}</span>
            <span class="value">wttr.in</span>
          </div>
          <div class="api-item">
            <span class="label">{_("environment.endpoint")}</span>
            <span class="value mono">https://wttr.in/{"{city}"}?format=j1</span>
          </div>
          <div class="api-item">
            <span class="label">{_("environment.response")}</span>
            <span class="value">JSON (lang_zh)</span>
          </div>
          <div class="api-item">
            <span class="label">{_("environment.cache")}</span>
            <span class="value">30 {_("environment.minutes")}</span>
          </div>
          <div class="api-item">
            <span class="label">{_("environment.cost")}</span>
            <span class="value highlight">{_("environment.costFree")}</span>
          </div>
        </div>
        <div class="api-links">
          <a href="https://wttr.in/:help" target="_blank" rel="noopener"
            >{_("environment.helpDocs")}</a
          >
          <span class="separator">|</span>
          <a
            href="https://wttr.in/Beijing?format=j1"
            target="_blank"
            rel="noopener">{_("environment.exampleRequest")}</a
          >
          <span class="separator">|</span>
          <a
            href="https://github.com/chubin/wttr.in"
            target="_blank"
            rel="noopener">GitHub</a
          >
        </div>
      </div>
    </div>
  {:else}
    <div class="loading">{_("common.loading")}</div>
  {/if}

  <!-- ================================================================= -->
  <!-- 操作按钮 -->
  <!-- ================================================================= -->

  <div class="actions">
    <button class="refresh" onclick={refresh}
      >{_("environment.refreshData")}</button
    >
  </div>

  <!-- 状态消息栏 -->
  <div
    class="status-bar"
    class:error={statusMsg.includes(_("environment.failed")) ||
      statusMsg.includes("failed")}
  >
    {statusMsg}
  </div>
</div>

<style>
  .env-debugger {
    background: #ffffff;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
    max-width: 700px;
    margin: 20px auto;
    color: #333;
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    text-align: left;
  }

  h3 {
    margin-top: 0;
    color: #2c3e50;
    border-bottom: 2px solid #eee;
    padding-bottom: 10px;
    margin-bottom: 20px;
    text-align: center;
  }

  h4 {
    margin: 0 0 10px 0;
    color: #34495e;
    font-size: 0.95em;
  }

  .section {
    margin-bottom: 20px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }

  .section-header h4 {
    margin: 0;
  }

  /* ================================================================= */
  /* 日期时间区域 */
  /* ================================================================= */

  .datetime-section {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 8px;
    padding: 15px;
    color: white;
  }

  .datetime-section h4 {
    color: rgba(255, 255, 255, 0.9);
  }

  .datetime-display {
    text-align: center;
    margin-bottom: 15px;
  }

  .time-large {
    font-size: 2.5em;
    font-weight: bold;
    font-family: "Consolas", monospace;
    letter-spacing: 2px;
  }

  .date-info {
    font-size: 1.1em;
    margin-top: 5px;
  }

  .date {
    margin-right: 10px;
  }

  .weekday {
    opacity: 0.9;
  }

  .datetime-meta {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.2);
  }

  .datetime-meta .meta-item {
    text-align: center;
  }

  .datetime-meta .label {
    display: block;
    font-size: 0.75em;
    opacity: 0.8;
  }

  .datetime-meta .value {
    font-weight: 600;
  }

  .datetime-meta .value.mono {
    font-family: "Consolas", monospace;
    font-size: 0.85em;
  }

  /* ================================================================= */
  /* 地理位置区域 */
  /* ================================================================= */

  .location-section {
    background: #f8f9fa;
    border-radius: 8px;
    padding: 15px;
    border-left: 4px solid #3498db;
  }

  .location-highlight {
    text-align: center;
    padding: 12px;
    margin-bottom: 12px;
    background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
    border-radius: 6px;
    color: white;
  }

  .location-highlight .city {
    display: block;
    font-size: 1.5em;
    font-weight: bold;
    margin-bottom: 4px;
  }

  .location-highlight .region {
    display: block;
    font-size: 0.95em;
    opacity: 0.9;
  }

  .location-info {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 5px 0;
  }

  .info-row .label {
    color: #7f8c8d;
    font-size: 0.9em;
  }

  .info-row .value {
    font-weight: 500;
    color: #2c3e50;
  }

  .info-row .value.badge {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.85em;
    background: #bdc3c7;
    color: white;
  }

  .info-row .value.badge.northern {
    background: #3498db;
  }

  /* ================================================================= */
  /* 天气区域 */
  /* ================================================================= */

  .weather-section {
    background: #f8f9fa;
    border-radius: 8px;
    padding: 15px;
    border-left: 4px solid #f39c12;
  }

  .weather-display {
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .weather-main {
    text-align: center;
    min-width: 120px;
  }

  .weather-main .temp {
    display: block;
    font-size: 2em;
    font-weight: bold;
    color: #e74c3c;
  }

  .weather-main .condition {
    display: block;
    font-size: 1em;
    color: #7f8c8d;
    margin-top: 5px;
  }

  .weather-details {
    flex: 1;
    display: grid;
    gap: 8px;
  }

  .weather-details .detail-item {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
    border-bottom: 1px dashed #eee;
  }

  .weather-details .label {
    color: #7f8c8d;
    font-size: 0.9em;
  }

  .weather-details .value {
    font-weight: 500;
    color: #2c3e50;
  }

  /* ================================================================= */
  /* API 信息区域 */
  /* ================================================================= */

  .api-section {
    background: #f0f4f8;
    border-radius: 8px;
    padding: 15px;
    border-left: 4px solid #9b59b6;
  }

  .api-group {
    margin-bottom: 15px;
    padding-bottom: 15px;
    border-bottom: 1px solid #e0e0e0;
  }

  .api-group:last-child {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: none;
  }

  .api-group-title {
    font-weight: 600;
    color: #34495e;
    margin-bottom: 10px;
    font-size: 0.9em;
  }

  .api-info {
    display: grid;
    gap: 6px;
  }

  .api-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 3px 0;
  }

  .api-item .label {
    color: #7f8c8d;
    font-size: 0.85em;
    min-width: 55px;
    flex-shrink: 0;
  }

  .api-item .value {
    font-weight: 500;
    color: #2c3e50;
    font-size: 0.9em;
  }

  .api-item .value.mono {
    font-family: "Consolas", monospace;
    font-size: 0.8em;
    background: #e8e8e8;
    padding: 2px 6px;
    border-radius: 3px;
    word-break: break-all;
  }

  .api-item .value.highlight {
    color: #27ae60;
    font-weight: 600;
  }

  .api-links {
    margin-top: 8px;
    font-size: 0.8em;
  }

  .api-links a {
    color: #3498db;
    text-decoration: none;
  }

  .api-links a:hover {
    text-decoration: underline;
  }

  .api-links .separator {
    color: #bdc3c7;
    margin: 0 6px;
  }

  /* ================================================================= */
  /* 通用 */
  /* ================================================================= */

  .empty {
    color: #bdc3c7;
    font-style: italic;
    text-align: center;
    padding: 15px;
  }

  .empty small {
    color: #95a5a6;
  }

  .loading {
    text-align: center;
    padding: 40px;
    color: #7f8c8d;
  }

  .btn-small {
    padding: 5px 12px;
    font-size: 0.8em;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: #f39c12;
    color: white;
    transition: all 0.2s;
  }

  .btn-small:hover:not(:disabled) {
    background: #e67e22;
  }

  .btn-small:disabled {
    background: #bdc3c7;
    cursor: not-allowed;
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

  /* ================================================================= */
  /* 暗色主题 */
  /* ================================================================= */

  @media (prefers-color-scheme: dark) {
    .env-debugger {
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

    .location-section,
    .weather-section,
    .api-section {
      background: #34495e;
    }

    .api-item .value.mono {
      background: #3d566e;
      color: #ecf0f1;
    }

    .api-group {
      border-bottom-color: #455a64;
    }

    .api-group-title {
      color: #bdc3c7;
    }

    .api-links a {
      color: #5dade2;
    }

    .info-row .label,
    .weather-details .label,
    .api-item .label {
      color: #95a5a6;
    }

    .info-row .value,
    .weather-details .value,
    .api-item .value {
      color: #ecf0f1;
    }

    .weather-details .detail-item {
      border-bottom-color: #3d566e;
    }

    .weather-main .condition {
      color: #95a5a6;
    }

    .status-bar {
      background: #34495e;
      color: #bdc3c7;
    }

    .status-bar.error {
      background: #5a3e3e;
    }

    .empty {
      color: #7f8c8d;
    }
  }
</style>
