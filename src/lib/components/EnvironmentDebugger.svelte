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
  import { DEBUG_TIMER_INTERVAL_MS } from "$lib/constants";

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
  let statusMsg = $state("正在加载...");
  
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
    const names = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return names[weekday] || "未知";
  }

  /** 获取季节中文名 */
  function getSeasonName(s: string): string {
    const map: Record<string, string> = {
      spring: "春季 🌸",
      summer: "夏季 ☀️",
      autumn: "秋季 🍂",
      winter: "冬季 ❄️",
    };
    return map[s] || s;
  }

  /** 获取时间段中文名 */
  function getTimePeriodName(p: string): string {
    const map: Record<string, string> = {
      morning: "早晨 🌅",
      noon: "下午 🌞",
      evening: "傍晚 🌇",
      night: "夜间 🌙",
    };
    return map[p] || p;
  }

  /** 格式化时间 */
  function formatTime(dt: DateTimeInfo): string {
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(dt.hour)}:${pad(dt.minute)}:${pad(dt.second)}`;
  }

  /** 格式化日期 */
  function formatDate(dt: DateTimeInfo): string {
    return `${dt.year}年${dt.month}月${dt.day}日`;
  }

  // ======================================================================= //
  // 数据加载函数
  // ======================================================================= //

  /** 加载环境信息（不含天气） */
  async function loadBasicInfo() {
    try {
      const datetime: DateTimeInfo = await invoke("get_datetime_info");
      const location: GeoLocation | null = await invoke("get_location_info");
      const weather: WeatherInfo | null = await invoke("get_weather_info");
      season = await invoke("get_season_info");
      timePeriod = await invoke("get_time_period_info");
      
      envInfo = {
        datetime,
        location,
        weather: weather || envInfo?.weather || null,
      };
      statusMsg = "环境信息已加载";
    } catch (e) {
      statusMsg = `加载失败: ${e}`;
    }
  }

  /** 刷新地理位置（强制重新获取） */
  async function refreshLocation() {
    loadingLocation = true;
    statusMsg = "正在刷新地理位置...";
    try {
      const location: GeoLocation | null = await invoke("refresh_location_info");
      if (envInfo) {
        envInfo = { ...envInfo, location };
      }
      statusMsg = location ? "地理位置已刷新" : "无法获取地理位置";
    } catch (e) {
      statusMsg = `刷新失败: ${e}`;
    } finally {
      loadingLocation = false;
    }
  }

  /** 加载天气信息（需要联网） */
  async function loadWeather() {
    loadingWeather = true;
    statusMsg = "正在获取天气信息...";
    try {
      const weather: WeatherInfo | null = await invoke("get_weather_info");
      if (envInfo) {
        envInfo = { ...envInfo, weather };
      }
      statusMsg = weather ? "天气信息已更新" : "无法获取天气信息";
    } catch (e) {
      statusMsg = `获取天气失败: ${e}`;
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

  onMount(async () => {
    await loadBasicInfo();
    
    // 每秒更新时间
    timerInterval = setInterval(loadBasicInfo, DEBUG_TIMER_INTERVAL_MS);

    // 监听环境信息更新事件（启动时后台获取完成后推送）
    unlistenEnvUpdate = await listen<EnvironmentUpdateEvent>("environment-updated", (event) => {
      console.log("[EnvironmentDebugger] Received environment update:", event.payload);
      const { location, weather } = event.payload;
      if (envInfo) {
        envInfo = {
          ...envInfo,
          location: location || envInfo.location,
          weather: weather || envInfo.weather,
        };
      }
      statusMsg = "环境信息已从后台更新";
    });
  });

  onDestroy(() => {
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
  <h3>Environment 调试面板</h3>

  {#if envInfo}
    <!-- ================================================================= -->
    <!-- 日期时间区域 -->
    <!-- ================================================================= -->
    
    <div class="section datetime-section">
      <h4>📅 日期时间</h4>
      <div class="datetime-display">
        <div class="time-large">{formatTime(envInfo.datetime)}</div>
        <div class="date-info">
          <span class="date">{formatDate(envInfo.datetime)}</span>
          <span class="weekday">{getWeekdayName(envInfo.datetime.weekday)}</span>
        </div>
      </div>
      <div class="datetime-meta">
        <div class="meta-item">
          <span class="label">季节:</span>
          <span class="value">{getSeasonName(season)}</span>
        </div>
        <div class="meta-item">
          <span class="label">时段:</span>
          <span class="value">{getTimePeriodName(timePeriod)}</span>
        </div>
        <div class="meta-item">
          <span class="label">时间戳:</span>
          <span class="value mono">{envInfo.datetime.timestamp}</span>
        </div>
      </div>
    </div>

    <!-- ================================================================= -->
    <!-- 地理位置区域 -->
    <!-- ================================================================= -->
    
    <div class="section location-section">
      <div class="section-header">
        <h4>🌍 地理位置 (IP API)</h4>
        <button class="btn-small" onclick={refreshLocation} disabled={loadingLocation}>
          {loadingLocation ? "刷新中..." : "刷新"}
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
              <span class="region">{envInfo.location.region}, {envInfo.location.country}</span>
            {:else if envInfo.location.country}
              <span class="region">{envInfo.location.country}</span>
            {/if}
          </div>
        {/if}
        
        <div class="location-info">
          <div class="info-row">
            <span class="label">时区:</span>
            <span class="value">{envInfo.location.timezone || "未知"}</span>
          </div>
          <div class="info-row">
            <span class="label">经度:</span>
            <span class="value">{envInfo.location.longitude.toFixed(4)}°</span>
          </div>
          <div class="info-row">
            <span class="label">纬度:</span>
            <span class="value">{envInfo.location.latitude.toFixed(4)}°</span>
          </div>
          <div class="info-row">
            <span class="label">半球:</span>
            <span class="value badge" class:northern={envInfo.location.is_northern_hemisphere}>
              {envInfo.location.is_northern_hemisphere ? "北半球" : "南半球"}
            </span>
          </div>
        </div>
      {:else}
        <div class="empty">无法获取位置信息</div>
      {/if}
    </div>

    <!-- ================================================================= -->
    <!-- 天气区域 -->
    <!-- ================================================================= -->
    
    <div class="section weather-section">
      <div class="section-header">
        <h4>🌤️ 天气信息</h4>
        <button class="btn-small" onclick={loadWeather} disabled={loadingWeather}>
          {loadingWeather ? "加载中..." : "获取天气"}
        </button>
      </div>
      {#if envInfo.weather}
        <div class="weather-display">
          <div class="weather-main">
            <span class="temp">{envInfo.weather.temperature.toFixed(1)}°C</span>
            <span class="condition">{envInfo.weather.condition}</span>
          </div>
          <div class="weather-details">
            {#if envInfo.weather.feels_like !== null}
              <div class="detail-item">
                <span class="label">体感:</span>
                <span class="value">{envInfo.weather.feels_like.toFixed(1)}°C</span>
              </div>
            {/if}
            {#if envInfo.weather.humidity !== null}
              <div class="detail-item">
                <span class="label">湿度:</span>
                <span class="value">{envInfo.weather.humidity}%</span>
              </div>
            {/if}
            {#if envInfo.weather.wind_speed !== null}
              <div class="detail-item">
                <span class="label">风速:</span>
                <span class="value">{envInfo.weather.wind_speed.toFixed(1)} km/h</span>
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <div class="empty">
          点击"获取天气"按钮加载天气信息
          <br><small>(需要联网)</small>
        </div>
      {/if}
    </div>

    <!-- ================================================================= -->
    <!-- API 信息区域 -->
    <!-- ================================================================= -->
    
    <div class="section api-section">
      <h4>🔗 API 信息</h4>
      
      <!-- IP 地理位置 API -->
      <div class="api-group">
        <div class="api-group-title">📍 IP 地理位置 API</div>
        <div class="api-info">
          <div class="api-item">
            <span class="label">服务商:</span>
            <span class="value">ip-api.com</span>
          </div>
          <div class="api-item">
            <span class="label">端点:</span>
            <span class="value mono">http://ip-api.com/json/</span>
          </div>
          <div class="api-item">
            <span class="label">参数:</span>
            <span class="value mono">fields=status,country,regionName,city,lat,lon,timezone&lang=zh-CN</span>
          </div>
          <div class="api-item">
            <span class="label">缓存:</span>
            <span class="value">程序运行期间 (静态缓存)</span>
          </div>
          <div class="api-item">
            <span class="label">费用:</span>
            <span class="value highlight">免费 / 无需 API Key</span>
          </div>
          <div class="api-item">
            <span class="label">限制:</span>
            <span class="value">45 请求/分钟</span>
          </div>
        </div>
        <div class="api-links">
          <a href="http://ip-api.com/docs/api:json" target="_blank" rel="noopener">API 文档</a>
          <span class="separator">|</span>
          <a href="http://ip-api.com/json/?fields=status,country,regionName,city,lat,lon,timezone&lang=zh-CN" target="_blank" rel="noopener">测试请求</a>
        </div>
      </div>

      <!-- 天气 API -->
      <div class="api-group">
        <div class="api-group-title">🌤️ 天气 API</div>
        <div class="api-info">
          <div class="api-item">
            <span class="label">服务商:</span>
            <span class="value">wttr.in</span>
          </div>
          <div class="api-item">
            <span class="label">端点:</span>
            <span class="value mono">https://wttr.in/{"{city}"}?format=j1</span>
          </div>
          <div class="api-item">
            <span class="label">响应:</span>
            <span class="value">JSON (含中文天气描述 lang_zh)</span>
          </div>
          <div class="api-item">
            <span class="label">缓存:</span>
            <span class="value">30 分钟</span>
          </div>
          <div class="api-item">
            <span class="label">费用:</span>
            <span class="value highlight">免费 / 无需 API Key</span>
          </div>
        </div>
        <div class="api-links">
          <a href="https://wttr.in/:help" target="_blank" rel="noopener">帮助文档</a>
          <span class="separator">|</span>
          <a href="https://wttr.in/Beijing?format=j1" target="_blank" rel="noopener">示例请求</a>
          <span class="separator">|</span>
          <a href="https://github.com/chubin/wttr.in" target="_blank" rel="noopener">GitHub</a>
        </div>
      </div>
    </div>
  {:else}
    <div class="loading">加载中...</div>
  {/if}

  <!-- ================================================================= -->
  <!-- 操作按钮 -->
  <!-- ================================================================= -->
  
  <div class="actions">
    <button class="refresh" onclick={refresh}>刷新数据</button>
  </div>

  <!-- 状态消息栏 -->
  <div class="status-bar" class:error={statusMsg.includes('失败')}>
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
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
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
    font-family: 'Consolas', monospace;
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
    font-family: 'Consolas', monospace;
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
    font-family: 'Consolas', monospace;
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
