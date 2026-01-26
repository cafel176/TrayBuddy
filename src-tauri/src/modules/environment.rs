//! 环境信息模块
//!
//! 提供系统环境信息的获取功能，包括：
//! - 日期时间信息 - 从系统本地时间获取
//! - 地理位置信息 - 通过 IP 地理位置 API 获取
//! - 天气信息 - 通过网络 API 获取（带缓存）
//! - 季节判断 - 根据月份和半球确定
//!
//! # 性能优化
//! - 地理位置使用静态缓存，程序运行期间只请求一次
//! - 天气信息默认缓存 30 分钟
//! - 便捷函数直接调用，避免创建管理器实例
//!
//! ## 示例
//! ```ignore
//! let mut manager = EnvironmentManager::new();
//! let env = manager.get_environment_info();
//! println!("当前时间: {}:{}", env.datetime.hour, env.datetime.minute);
//! ```

#![allow(unused)]

use chrono::{Datelike, Timelike};
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// 全局地理位置缓存（可刷新）
static CACHED_LOCATION: OnceLock<Mutex<Option<GeoLocation>>> = OnceLock::new();

/// 全局天气缓存（启动时获取一次，之后定期刷新）
static CACHED_WEATHER: OnceLock<Mutex<CachedWeather>> = OnceLock::new();

/// 天气缓存结构
struct CachedWeather {
    weather: Option<WeatherInfo>,
    cache_time: u64,
}

// ========================================================================= //

/// 地理位置信息 (通过 IP 地理位置 API 获取)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoLocation {
    /// 纬度
    pub latitude: f64,
    /// 经度
    pub longitude: f64,
    /// 时区名称 (如 "Asia/Shanghai")
    pub timezone: Option<Box<str>>,
    /// 是否为北半球
    pub is_northern_hemisphere: bool,
    /// 城市名称
    pub city: Option<Box<str>>,
    /// 地区/省份名称
    pub region: Option<Box<str>>,
    /// 国家名称
    pub country: Option<Box<str>>,
}

/// IP 地理位置 API 响应 (ip-api.com)
#[derive(Debug, Clone, Deserialize)]
struct IpGeoApiResponse {
    status: Box<str>,
    country: Option<Box<str>>,
    #[serde(rename = "regionName")]
    region_name: Option<Box<str>>,
    city: Option<Box<str>>,
    lat: Option<f64>,
    lon: Option<f64>,
    timezone: Option<Box<str>>,
}

/// 时间日期信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DateTimeInfo {
    /// 年
    pub year: u32,
    /// 月 (1-12)
    pub month: u32,
    /// 日 (1-31)
    pub day: u32,
    /// 时 (0-23)
    pub hour: u32,
    /// 分 (0-59)
    pub minute: u32,
    /// 秒 (0-59)
    pub second: u32,
    /// 星期几 (0=周日, 1=周一, ..., 6=周六)
    pub weekday: u32,
    /// Unix 时间戳 (秒)
    pub timestamp: u64,
}

/// 完整的环境信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvironmentInfo {
    pub location: Option<GeoLocation>,
    pub datetime: DateTimeInfo,
    pub weather: Option<WeatherInfo>,
}

/// 天气信息 (需要联网获取)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeatherInfo {
    /// 天气状况 (如 "晴", "多云", "雨" 等)
    pub condition: Box<str>,
    /// 天气状况代码
    pub condition_code: Box<str>,
    /// 当前气温 (摄氏度)
    pub temperature: f64,
    /// 体感温度 (摄氏度)
    pub feels_like: Option<f64>,
    /// 湿度 (百分比)
    pub humidity: Option<u32>,
    /// 风速 (km/h)
    pub wind_speed: Option<f64>,
}

// ========================================================================= //
use crate::modules::utils::http::http_get;

// ========================================================================= //

/// 环境信息管理器
/// - 时间、日期、地理位置：从系统本地获取
/// - 天气：需要联网获取，使用长缓存减少请求次数
pub struct EnvironmentManager {
    /// 缓存的天气信息 (需要联网获取)
    cached_weather: Option<WeatherInfo>,
    /// 天气缓存时间戳
    weather_cache_time: u64,
    /// 天气缓存有效期 (秒)，默认 30 分钟
    weather_cache_duration: u64,
}

impl EnvironmentManager {
    pub fn new() -> Self {
        use crate::modules::constants::WEATHER_CACHE_DURATION_SECS;
        Self {
            cached_weather: None,
            weather_cache_time: 0,
            weather_cache_duration: WEATHER_CACHE_DURATION_SECS,
        }
    }

    // ========================================================================= //

    /// 获取当前日期时间信息 (从系统本地获取)
    pub fn get_datetime(&self) -> DateTimeInfo {
        get_current_datetime_impl()
    }

    // ========================================================================= //

    /// 获取地理位置信息 (通过 IP 地理位置 API 获取)
    ///
    /// 使用全局缓存，首次调用时获取
    #[inline]
    pub fn get_location(&mut self) -> Option<GeoLocation> {
        let cache = CACHED_LOCATION.get_or_init(|| Mutex::new(None));
        let mut guard = cache.lock().ok()?;

        if guard.is_none() {
            *guard = Some(Self::fetch_location_from_api());
        }
        guard.clone()
    }

    /// 强制刷新地理位置缓存
    pub fn refresh_location(&mut self) -> Option<GeoLocation> {
        let cache = CACHED_LOCATION.get_or_init(|| Mutex::new(None));
        if let Ok(mut guard) = cache.lock() {
            let new_location = Self::fetch_location_from_api();
            *guard = Some(new_location.clone());
            return Some(new_location);
        }
        None
    }

    /// 通过 IP 地理位置 API 获取位置信息
    fn fetch_location_from_api() -> GeoLocation {
        // 尝试从 API 获取位置信息
        if let Ok(geo) = Self::fetch_ip_geolocation() {
            return geo;
        }

        // API 失败时回退到本地时区推断
        Self::fallback_location_from_timezone()
    }

    /// 通过 ip-api.com 获取 IP 地理位置（免费，无需 API Key）
    fn fetch_ip_geolocation() -> Result<GeoLocation, String> {
        use crate::modules::constants::LOCATION_API_TIMEOUT_SECS;

        let url = "http://ip-api.com/json/?fields=status,country,regionName,city,lat,lon,timezone&lang=zh-CN";
        let body = http_get(url, LOCATION_API_TIMEOUT_SECS, Some("\"status\""))?;
        Self::parse_ip_geo_response(&body)
    }

    /// 解析 ip-api.com 响应
    fn parse_ip_geo_response(body: &str) -> Result<GeoLocation, String> {
        let response: IpGeoApiResponse =
            serde_json::from_str(body).map_err(|e| format!("Failed to parse JSON: {}", e))?;

        if response.status.as_ref() != "success" {
            return Err("API returned error status".to_string());
        }

        let latitude = response.lat.unwrap_or(40.0);
        let longitude = response.lon.unwrap_or(116.0);
        let is_northern = latitude >= 0.0;

        Ok(GeoLocation {
            latitude,
            longitude,
            timezone: response.timezone,
            is_northern_hemisphere: is_northern,
            city: response.city,
            region: response.region_name,
            country: response.country,
        })
    }

    /// 本地时区回退方案（当 API 不可用时）
    fn fallback_location_from_timezone() -> GeoLocation {
        #[cfg(windows)]
        {
            use chrono::Local;
            let now = Local::now();
            let offset_secs = now.offset().local_minus_utc();
            let offset_hours = offset_secs as f64 / 3600.0;
            let longitude = offset_hours * 15.0;

            let timezone_name = now.offset().to_string();

            // 更稳健的半球推断：正偏移通常在东半球，但纬度无法仅从时区推断。
            // 保持原有的启发式判断，但改用 chrono
            let is_southern = timezone_name.contains("Australia")
                || timezone_name.contains("New Zealand")
                || timezone_name.contains("South Africa")
                || timezone_name.contains("Argentina")
                || timezone_name.contains("Brazil")
                || timezone_name.contains("Chile");

            let latitude = if is_southern { -35.0 } else { 40.0 };

            return GeoLocation {
                latitude,
                longitude,
                timezone: Some(timezone_name.into()),
                is_northern_hemisphere: !is_southern,
                city: None,
                region: None,
                country: None,
            };
        }

        #[cfg(not(windows))]
        {
            let tz = std::env::var("TZ").unwrap_or_else(|_| "UTC".to_string());

            GeoLocation {
                latitude: 40.0,
                longitude: 0.0,
                timezone: Some(tz),
                is_northern_hemisphere: true,
                city: None,
                region: None,
                country: None,
            }
        }
    }

    // ========================================================================= //

    /// 获取完整的环境信息
    pub fn get_environment_info(&mut self) -> EnvironmentInfo {
        let datetime = self.get_datetime();
        let location = self.get_location();
        let weather = self.get_weather();

        EnvironmentInfo {
            location,
            datetime,
            weather,
        }
    }

    /// 清除天气缓存
    ///
    /// 注意：地理位置缓存是全局静态的，无法清除
    pub fn clear_cache(&mut self) {
        self.cached_weather = None;
        self.weather_cache_time = 0;
    }

    /// 设置天气缓存有效期 (秒)
    pub fn set_weather_cache_duration(&mut self, duration: u64) {
        self.weather_cache_duration = duration;
    }

    // ========================================================================= //
    // 天气功能 (需要联网)
    // ========================================================================= //

    /// 获取天气信息 (优先使用全局缓存)
    /// 全局缓存在程序启动时初始化，30 分钟后过期会重新获取
    pub fn get_weather(&mut self) -> Option<WeatherInfo> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // 优先检查全局缓存
        if let Some(cache) = CACHED_WEATHER.get() {
            if let Ok(guard) = cache.lock() {
                if guard.weather.is_some() && now - guard.cache_time < self.weather_cache_duration {
                    return guard.weather.clone();
                }
            }
        }

        // 检查实例缓存是否有效
        if let Some(ref weather) = self.cached_weather {
            if now - self.weather_cache_time < self.weather_cache_duration {
                return Some(weather.clone());
            }
        }

        // 获取位置用于天气查询
        let location = self.get_location()?;
        // 优先使用城市名，其次使用经纬度坐标
        let query = if let Some(ref city) = location.city {
            city.to_string()
        } else {
            // 使用经纬度作为备选（wttr.in 支持坐标查询）
            format!("{},{}", location.latitude, location.longitude)
        };

        // 从网络获取天气
        match self.fetch_weather_sync(&query) {
            Ok(weather) => {
                // 更新实例缓存
                self.cached_weather = Some(weather.clone());
                self.weather_cache_time = now;
                // 同时更新全局缓存
                if let Some(cache) = CACHED_WEATHER.get() {
                    if let Ok(mut guard) = cache.lock() {
                        guard.weather = Some(weather.clone());
                        guard.cache_time = now;
                    }
                }
                Some(weather)
            }
            Err(e) => self.cached_weather.as_ref().map(|w| w.clone()),
        }
    }

    /// 初始化时获取天气（内部使用，不更新实例缓存）
    fn fetch_weather_for_init(&mut self) -> Option<WeatherInfo> {
        let location = self.get_location()?;
        let query = if let Some(ref city) = location.city {
            city.to_string()
        } else {
            format!("{},{}", location.latitude, location.longitude)
        };

        self.fetch_weather_sync(&query).ok()
    }

    /// 同步获取天气信息 (使用 wttr.in API)
    fn fetch_weather_sync(&self, query: &str) -> Result<WeatherInfo, String> {
        use crate::modules::constants::WEATHER_API_TIMEOUT_SECS;

        // 对查询参数进行 URL 编码处理
        let query_encoded = query.replace(' ', "%20");
        let url = format!("https://wttr.in/{}?format=j1", query_encoded);

        let body = http_get(&url, WEATHER_API_TIMEOUT_SECS, Some("current_condition"))?;
        self.parse_wttr_response(&body)
    }

    /// 解析 wttr.in API 响应
    fn parse_wttr_response(&self, body: &str) -> Result<WeatherInfo, String> {
        let json: serde_json::Value =
            serde_json::from_str(body).map_err(|e| format!("Failed to parse JSON: {}", e))?;

        let current = &json["current_condition"][0];

        let temp_c = current["temp_C"]
            .as_str()
            .and_then(|s| s.parse::<f64>().ok())
            .ok_or("Missing temperature")?;

        let feels_like = current["FeelsLikeC"]
            .as_str()
            .and_then(|s| s.parse::<f64>().ok());

        let humidity = current["humidity"]
            .as_str()
            .and_then(|s| s.parse::<u32>().ok());

        let wind_speed = current["windspeedKmph"]
            .as_str()
            .and_then(|s| s.parse::<f64>().ok());

        // 获取中文天气描述
        let condition: Box<str> = current["lang_zh"][0]["value"]
            .as_str()
            .or_else(|| current["weatherDesc"][0]["value"].as_str())
            .unwrap_or("未知")
            .into();

        let condition_code: Box<str> = current["weatherCode"].as_str().unwrap_or("0").into();

        Ok(WeatherInfo {
            condition,
            condition_code,
            temperature: temp_c,
            feels_like,
            humidity,
            wind_speed,
        })
    }
}

impl Default for EnvironmentManager {
    fn default() -> Self {
        Self::new()
    }
}

// ========================================================================= //
// 内部实现函数
// ========================================================================= //

/// 获取当前日期时间的内部实现
fn get_current_datetime_impl() -> DateTimeInfo {
    let dt = chrono::Local::now();
    let timestamp = dt.timestamp() as u64;

    DateTimeInfo {
        year: dt.year() as u32,
        month: dt.month() as u32,
        day: dt.day() as u32,
        hour: dt.hour() as u32,
        minute: dt.minute() as u32,
        second: dt.second() as u32,
        weekday: dt.weekday().num_days_from_sunday(),
        timestamp,
    }
}

// ========================================================================= //
// 便捷函数
// ========================================================================= //

/// 便捷函数：获取当前日期时间
#[inline]
pub fn get_current_datetime() -> DateTimeInfo {
    get_current_datetime_impl()
}

/// 便捷函数：判断当前是否是早晨 (6:00 - 12:00)
pub fn is_morning() -> bool {
    let dt = get_current_datetime();
    dt.hour >= 6 && dt.hour < 12
}

/// 便捷函数：判断当前是否是下午 (12:00 - 18:00)
pub fn is_noon() -> bool {
    let dt = get_current_datetime();
    dt.hour >= 12 && dt.hour < 18
}

/// 便捷函数：判断当前是否是晚上 (18:00 - 22:00)
pub fn is_evening() -> bool {
    let dt = get_current_datetime();
    dt.hour >= 18 && dt.hour < 22
}

/// 便捷函数：判断当前是否是夜间 (22:00 - 6:00)
pub fn is_night() -> bool {
    let dt = get_current_datetime();
    dt.hour >= 22 || dt.hour < 6
}

/// 便捷函数：获取当前时间段名称
pub fn get_time_period() -> &'static str {
    let dt = get_current_datetime();
    match dt.hour {
        6..=11 => "morning",
        12..=17 => "noon",
        18..=21 => "evening",
        _ => "night",
    }
}

// ========================================================================= //

/// 季节枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Season {
    Spring,
    Summer,
    Autumn,
    Winter,
}

impl Season {
    /// 获取季节名称 (英文)
    pub fn name(&self) -> &'static str {
        match self {
            Season::Spring => "spring",
            Season::Summer => "summer",
            Season::Autumn => "autumn",
            Season::Winter => "winter",
        }
    }

    /// 获取季节名称 (中文)
    pub fn name_zh(&self) -> &'static str {
        match self {
            Season::Spring => "春",
            Season::Summer => "夏",
            Season::Autumn => "秋",
            Season::Winter => "冬",
        }
    }
}

/// 便捷函数：根据当前日期和地理位置获取季节
/// - latitude: 纬度，正数为北半球，负数为南半球
/// - 北半球: 3-5月春, 6-8月夏, 9-11月秋, 12-2月冬
/// - 南半球: 季节相反
pub fn get_season_by_location(latitude: f64) -> Season {
    let dt = get_current_datetime();
    get_season_by_month_and_latitude(dt.month, latitude)
}

/// 根据月份和纬度获取季节
pub fn get_season_by_month_and_latitude(month: u32, latitude: f64) -> Season {
    let northern_season = match month {
        3..=5 => Season::Spring,
        6..=8 => Season::Summer,
        9..=11 => Season::Autumn,
        _ => Season::Winter, // 12, 1, 2
    };

    // 南半球季节相反
    if latitude < 0.0 {
        match northern_season {
            Season::Spring => Season::Autumn,
            Season::Summer => Season::Winter,
            Season::Autumn => Season::Spring,
            Season::Winter => Season::Summer,
        }
    } else {
        northern_season
    }
}

/// 便捷函数：获取当前季节 (从系统时区推断半球)
pub fn get_current_season() -> Season {
    let mut manager = EnvironmentManager::new();
    if let Some(location) = manager.get_location() {
        get_season_by_location(location.latitude)
    } else {
        // 默认北半球
        get_season_by_location(40.0)
    }
}

// ========================================================================= //
// 启动初始化
// ========================================================================= //

/// 环境信息更新事件数据
#[derive(Debug, Clone, Serialize)]
pub struct EnvironmentUpdateEvent {
    pub location: Option<GeoLocation>,
    pub weather: Option<WeatherInfo>,
}

/// 程序启动时初始化环境信息（在后台线程调用，避免阻塞启动）
///
/// 预先获取地理位置和天气信息，后续调用直接返回缓存
/// 获取完成后通过 app_handle 发送事件通知前端
pub fn init_environment<R: tauri::Runtime>(app_handle: Option<tauri::AppHandle<R>>) {
    use tauri::Emitter;

    #[cfg(debug_assertions)]
    println!("[Environment] Initializing environment info...");

    // 初始化缓存结构
    CACHED_LOCATION.get_or_init(|| Mutex::new(None));
    CACHED_WEATHER.get_or_init(|| {
        Mutex::new(CachedWeather {
            weather: None,
            cache_time: 0,
        })
    });

    let mut location_result: Option<GeoLocation> = None;
    let mut weather_result: Option<WeatherInfo> = None;

    // 获取地理位置
    let mut manager = EnvironmentManager::new();
    if let Some(location) = manager.get_location() {
        #[cfg(debug_assertions)]
        println!(
            "[Environment] Location: {:?}, {:?}, {:?}",
            location.city, location.region, location.country
        );
        location_result = Some(location.clone());

        // 获取天气并缓存到全局
        if let Some(weather) = manager.fetch_weather_for_init() {
            #[cfg(debug_assertions)]
            println!(
                "[Environment] Weather: {}°C, {}",
                weather.temperature, weather.condition
            );

            if let Some(cache) = CACHED_WEATHER.get() {
                if let Ok(mut guard) = cache.lock() {
                    guard.weather = Some(weather.clone());
                    guard.cache_time = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs();
                }
            }
            weather_result = Some(weather);
        }
    } else {
        #[cfg(debug_assertions)]
        println!("[Environment] Failed to get location");
    }

    // 发送事件通知前端
    if let Some(handle) = app_handle {
        let event_data = EnvironmentUpdateEvent {
            location: location_result,
            weather: weather_result,
        };
        let _ = handle.emit("environment-updated", event_data);
        #[cfg(debug_assertions)]
        println!("[Environment] Event emitted to frontend");
    }

    #[cfg(debug_assertions)]
    println!("[Environment] Initialization complete");
}

/// 获取缓存的地理位置（无需创建 EnvironmentManager）
pub fn get_cached_location() -> Option<GeoLocation> {
    CACHED_LOCATION
        .get()
        .and_then(|cache| cache.lock().ok())
        .and_then(|guard| guard.clone())
}

/// 获取缓存的天气（无需创建 EnvironmentManager）
pub fn get_cached_weather() -> Option<WeatherInfo> {
    CACHED_WEATHER
        .get()
        .and_then(|cache| cache.lock().ok())
        .and_then(|guard| guard.weather.clone())
}

// ========================================================================= //
