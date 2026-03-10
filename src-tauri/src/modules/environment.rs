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
//! - 初始化和运行中更新数据时创建管理器实例完成相关操作
//! - 外部调用时可以通过便捷函数直接调用，避免创建管理器实例
//!
//! ## 示例
//! ```text

//! let mut manager = EnvironmentManager::new();
//! let env = manager.get_environment_info();
//! println!("当前时间: {}:{}", env.datetime.hour, env.datetime.minute);
//! ```

#![allow(unused)]

use super::event_manager::{emit, events};
use chrono::{Datelike, Timelike};
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use crate::modules::utils::http::http_get;
use crate::modules::constants::{
    WEATHER_CACHE_DURATION_SECS, WEATHER_API_TIMEOUT_SECS, LOCATION_API_TIMEOUT_SECS
};
use crate::modules::utils::http::http_get_async;
use chrono::Local;

// ========================================================================= //
// 时间段常量
// ========================================================================= //

/// 早晨开始时间（小时）
pub const MORNING_HOUR_START: u32 = 6;

/// 早晨结束时间（小时）
pub const MORNING_HOUR_END: u32 = 12;

/// 下午结束时间（小时）
pub const AFTERNOON_HOUR_END: u32 = 18;

/// 傍晚结束时间（小时）
pub const EVENING_HOUR_END: u32 = 22;

// ========================================================================= //
// 地理位置回退常量
// ========================================================================= //

/// 回退纬度（北半球）
///
/// **用途**: API 不可用时使用的默认北半球纬度。
pub const FALLBACK_LATITUDE_NORTHERN: f64 = 40.0;

/// 回退经度（中国）
///
/// **用途**: API 不可用时使用的默认经度。
pub const FALLBACK_LONGITUDE_CHINA: f64 = 116.0;

/// 回退纬度（南半球）
///
/// **用途**: API 不可用时使用的默认南半球纬度。
pub const FALLBACK_LATITUDE_SOUTHERN: f64 = -35.0;

/// 每小时偏移对应的经度
///
/// **用途**: 从时区偏移推断经度时的系数（每小时15度）。
pub const LONGITUDE_PER_HOUR_OFFSET: f64 = 15.0;

// ========================================================================= //
// 字符串常量
// ========================================================================= //

// 季节名称常量
const SEASON_NAME_SPRING_EN: &str = "spring";
const SEASON_NAME_SUMMER_EN: &str = "summer";
const SEASON_NAME_AUTUMN_EN: &str = "autumn";
const SEASON_NAME_WINTER_EN: &str = "winter";
const SEASON_NAME_SPRING_ZH: &str = "春";
const SEASON_NAME_SUMMER_ZH: &str = "夏";
const SEASON_NAME_AUTUMN_ZH: &str = "秋";
const SEASON_NAME_WINTER_ZH: &str = "冬";

// 时间段名称常量
const TIME_PERIOD_MORNING: &str = "morning";
const TIME_PERIOD_AFTERNOON: &str = "afternoon";
const TIME_PERIOD_EVENING: &str = "evening";
const TIME_PERIOD_NIGHT: &str = "night";

// ========================================================================= //

/// 全局地理位置缓存（可刷新）
static CACHED_LOCATION: OnceLock<Mutex<Option<GeoLocation>>> = OnceLock::new();

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

// ========================================================================= //

/// 全局天气缓存（启动时获取一次，之后定期刷新）
static CACHED_WEATHER: OnceLock<Mutex<CachedWeather>> = OnceLock::new();

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

/// 天气缓存结构
struct CachedWeather {
    weather: Option<WeatherInfo>,
    cache_time: u64,
}

// ========================================================================= //

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
    /// 地理位置（可能不可用）
    pub location: Option<GeoLocation>,
    /// 本地日期/时间信息
    pub datetime: DateTimeInfo,
    /// 天气信息（可能不可用）
    pub weather: Option<WeatherInfo>,
}


// ========================================================================= //

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

// ========================================================================= //

/// 环境信息管理器
/// - 时间、日期、地理位置：从系统本地获取
/// - 天气：需要联网获取，使用全局缓存减少请求次数
pub struct EnvironmentManager {
    /// 天气缓存有效期 (秒)，默认 30 分钟
    weather_cache_duration: u64,
}

impl EnvironmentManager {
    /// 创建环境管理器（初始化天气缓存策略）。
    pub fn new() -> Self {

        Self {
            weather_cache_duration: WEATHER_CACHE_DURATION_SECS,
        }
    }

    // ========================================================================= //

    /// 获取当前日期时间信息 (从系统本地获取)
    pub fn get_datetime(&self) -> DateTimeInfo {
        get_current_datetime()
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
            let now = Local::now();
            let offset_secs = now.offset().local_minus_utc();
            let offset_hours = offset_secs as f64 / 3600.0;
            let longitude = offset_hours * LONGITUDE_PER_HOUR_OFFSET;

            let timezone_name = now.offset().to_string();

            // 更稳健的半球推断：正偏移通常在东半球，但纬度无法仅从时区推断。
            // 保持原有的启发式判断，但改用 chrono
            let is_southern = timezone_name.contains("Australia")
                || timezone_name.contains("New Zealand")
                || timezone_name.contains("South Africa")
                || timezone_name.contains("Argentina")
                || timezone_name.contains("Brazil")
                || timezone_name.contains("Chile");

            let latitude = if is_southern { FALLBACK_LATITUDE_SOUTHERN } else { FALLBACK_LATITUDE_NORTHERN };

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

        /// macOS/Linux: 使用 $TZ 环境变量推断时区。
        /// TODO(cross-platform): macOS — 使用 NSTimeZone.localTimeZone 获取更精确的时区信息；
        ///                        Linux — 读取 /etc/timezone 或 timedatectl。
        #[cfg(not(windows))]
        {
            let tz = std::env::var("TZ").unwrap_or_else(|_| "UTC".to_string());

            GeoLocation {
                latitude: FALLBACK_LATITUDE_NORTHERN,
                longitude: FALLBACK_LONGITUDE_CHINA,
                timezone: Some(tz),
                is_northern_hemisphere: true,
                city: None,
                region: None,
                country: None,
            }
        }
    }

    // ========================================================================= //
    // 天气功能
    // ========================================================================= //

    /// 设置天气缓存有效期 (秒)
    pub fn set_weather_cache_duration(&mut self, duration: u64) {
        self.weather_cache_duration = duration;
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

// 运行时方法（依赖 async / 网络 / AppHandle，不可单元测试）拆分到独立文件以便排除覆盖率统计
include!("environment_runtime.rs");

impl Default for EnvironmentManager {
    fn default() -> Self {
        Self::new()
    }
}

// ========================================================================= //
// 便捷函数
// ========================================================================= //

/// 便捷函数：获取当前日期时间
#[inline]
pub fn get_current_datetime() -> DateTimeInfo {
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

/// 便捷函数：判断当前是否是早晨
pub fn is_morning() -> bool {
    let dt = get_current_datetime();
    dt.hour >= MORNING_HOUR_START && dt.hour < MORNING_HOUR_END
}

/// 便捷函数：判断当前是否是中午/下午
pub fn is_afternoon() -> bool {
    let dt = get_current_datetime();
    dt.hour >= MORNING_HOUR_END && dt.hour < AFTERNOON_HOUR_END
}

/// 便捷函数：判断当前是否是晚上
pub fn is_evening() -> bool {
    let dt = get_current_datetime();
    dt.hour >= AFTERNOON_HOUR_END && dt.hour < EVENING_HOUR_END
}

/// 便捷函数：判断当前是否是夜间
pub fn is_night() -> bool {
    let dt = get_current_datetime();
    dt.hour >= EVENING_HOUR_END || dt.hour < MORNING_HOUR_START
}

/// 获取当前时间段
pub fn get_time_period() -> &'static str {
    if is_morning() {
        TIME_PERIOD_MORNING
    } else if is_afternoon() {
        TIME_PERIOD_AFTERNOON
    } else if is_evening() {
        TIME_PERIOD_EVENING
    } else {
        TIME_PERIOD_NIGHT
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
            Season::Spring => SEASON_NAME_SPRING_EN,
            Season::Summer => SEASON_NAME_SUMMER_EN,
            Season::Autumn => SEASON_NAME_AUTUMN_EN,
            Season::Winter => SEASON_NAME_WINTER_EN,
        }
    }

    /// 获取季节名称 (中文)
    pub fn name_zh(&self) -> &'static str {
        match self {
            Season::Spring => SEASON_NAME_SPRING_ZH,
            Season::Summer => SEASON_NAME_SUMMER_ZH,
            Season::Autumn => SEASON_NAME_AUTUMN_ZH,
            Season::Winter => SEASON_NAME_WINTER_ZH,
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
    if let Some(location) = get_cached_location() {
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
    /// 最新位置（可能为空）
    pub location: Option<GeoLocation>,
    /// 最新天气（可能为空）
    pub weather: Option<WeatherInfo>,
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

#[cfg(test)]
mod tests {
    use super::*;

    // ========================================================================= //
    // parse_ip_geo_response
    // ========================================================================= //

    #[test]
    fn parse_ip_geo_response_success() {
        let body = r#"{
            "status": "success",
            "country": "China",
            "regionName": "Beijing",
            "city": "Beijing",
            "lat": 39.9,
            "lon": 116.4,
            "timezone": "Asia/Shanghai"
        }"#;
        let geo = EnvironmentManager::parse_ip_geo_response(body).unwrap();
        assert_eq!(geo.latitude, 39.9);
        assert_eq!(geo.longitude, 116.4);
        assert!(geo.is_northern_hemisphere);
        assert_eq!(geo.city.as_deref(), Some("Beijing"));
        assert_eq!(geo.region.as_deref(), Some("Beijing"));
        assert_eq!(geo.country.as_deref(), Some("China"));
        assert_eq!(geo.timezone.as_deref(), Some("Asia/Shanghai"));
    }

    #[test]
    fn parse_ip_geo_response_failure_status() {
        let body = r#"{ "status": "fail" }"#;
        let err = EnvironmentManager::parse_ip_geo_response(body).unwrap_err();
        assert!(err.contains("error status"));
    }

    #[test]
    fn parse_ip_geo_response_invalid_json() {
        let err = EnvironmentManager::parse_ip_geo_response("not json").unwrap_err();
        assert!(err.contains("Failed to parse JSON"));
    }

    #[test]
    fn parse_ip_geo_response_missing_lat_lon_defaults() {
        let body = r#"{ "status": "success" }"#;
        let geo = EnvironmentManager::parse_ip_geo_response(body).unwrap();
        assert_eq!(geo.latitude, 40.0);
        assert_eq!(geo.longitude, 116.0);
        assert!(geo.is_northern_hemisphere);
        assert!(geo.city.is_none());
        assert!(geo.region.is_none());
        assert!(geo.country.is_none());
        assert!(geo.timezone.is_none());
    }

    #[test]
    fn parse_ip_geo_response_southern_hemisphere() {
        let body = r#"{
            "status": "success",
            "lat": -33.8,
            "lon": 151.2,
            "city": "Sydney",
            "country": "Australia"
        }"#;
        let geo = EnvironmentManager::parse_ip_geo_response(body).unwrap();
        assert_eq!(geo.latitude, -33.8);
        assert!(!geo.is_northern_hemisphere);
    }

    #[test]
    fn parse_ip_geo_response_zero_latitude_is_northern() {
        let body = r#"{ "status": "success", "lat": 0.0, "lon": 0.0 }"#;
        let geo = EnvironmentManager::parse_ip_geo_response(body).unwrap();
        assert!(geo.is_northern_hemisphere);
    }

    // ========================================================================= //
    // parse_wttr_response
    // ========================================================================= //

    #[test]
    fn parse_wttr_response_success() {
        let body = r#"{
            "current_condition": [{
                "temp_C": "23",
                "FeelsLikeC": "21",
                "humidity": "55",
                "windspeedKmph": "10",
                "lang_zh": [{ "value": "多云" }],
                "weatherDesc": [{ "value": "Cloudy" }],
                "weatherCode": "116"
            }]
        }"#;
        let manager = EnvironmentManager::new();
        let weather = manager.parse_wttr_response(body).unwrap();
        assert_eq!(weather.temperature, 23.0);
        assert_eq!(weather.feels_like, Some(21.0));
        assert_eq!(weather.humidity, Some(55));
        assert_eq!(weather.wind_speed, Some(10.0));
        assert_eq!(weather.condition.as_ref(), "多云");
        assert_eq!(weather.condition_code.as_ref(), "116");
    }

    #[test]
    fn parse_wttr_response_missing_temp_c_fails() {
        let body = r#"{ "current_condition": [{ "humidity": "50" }] }"#;
        let manager = EnvironmentManager::new();
        let err = manager.parse_wttr_response(body).unwrap_err();
        assert!(err.contains("Missing temperature"));
    }

    #[test]
    fn parse_wttr_response_missing_optional_fields() {
        let body = r#"{ "current_condition": [{ "temp_C": "15" }] }"#;
        let manager = EnvironmentManager::new();
        let weather = manager.parse_wttr_response(body).unwrap();
        assert_eq!(weather.temperature, 15.0);
        assert!(weather.feels_like.is_none());
        assert!(weather.humidity.is_none());
        assert!(weather.wind_speed.is_none());
        assert_eq!(weather.condition.as_ref(), "未知");
        assert_eq!(weather.condition_code.as_ref(), "0");
    }

    #[test]
    fn parse_wttr_response_invalid_json() {
        let manager = EnvironmentManager::new();
        let err = manager.parse_wttr_response("not json").unwrap_err();
        assert!(err.contains("Failed to parse JSON"));
    }

    #[test]
    fn parse_wttr_response_fallback_to_weather_desc() {
        let body = r#"{ "current_condition": [{
            "temp_C": "20",
            "weatherDesc": [{ "value": "Sunny" }],
            "weatherCode": "113"
        }] }"#;
        let manager = EnvironmentManager::new();
        let weather = manager.parse_wttr_response(body).unwrap();
        assert_eq!(weather.condition.as_ref(), "Sunny");
    }

    #[test]
    fn parse_wttr_response_negative_temperature() {
        let body = r#"{ "current_condition": [{
            "temp_C": "-5",
            "FeelsLikeC": "-10",
            "weatherCode": "338"
        }] }"#;
        let manager = EnvironmentManager::new();
        let weather = manager.parse_wttr_response(body).unwrap();
        assert_eq!(weather.temperature, -5.0);
        assert_eq!(weather.feels_like, Some(-10.0));
    }

    // ========================================================================= //
    // Season
    // ========================================================================= //

    #[test]
    fn season_name_en_all() {
        assert_eq!(Season::Spring.name(), "spring");
        assert_eq!(Season::Summer.name(), "summer");
        assert_eq!(Season::Autumn.name(), "autumn");
        assert_eq!(Season::Winter.name(), "winter");
    }

    #[test]
    fn season_name_zh_all() {
        assert_eq!(Season::Spring.name_zh(), "春");
        assert_eq!(Season::Summer.name_zh(), "夏");
        assert_eq!(Season::Autumn.name_zh(), "秋");
        assert_eq!(Season::Winter.name_zh(), "冬");
    }

    #[test]
    fn season_by_month_northern_hemisphere() {
        // Spring: 3-5
        for m in 3..=5 {
            assert_eq!(get_season_by_month_and_latitude(m, 40.0), Season::Spring, "month {}", m);
        }
        // Summer: 6-8
        for m in 6..=8 {
            assert_eq!(get_season_by_month_and_latitude(m, 40.0), Season::Summer, "month {}", m);
        }
        // Autumn: 9-11
        for m in 9..=11 {
            assert_eq!(get_season_by_month_and_latitude(m, 40.0), Season::Autumn, "month {}", m);
        }
        // Winter: 12, 1, 2
        for m in [12, 1, 2] {
            assert_eq!(get_season_by_month_and_latitude(m, 40.0), Season::Winter, "month {}", m);
        }
    }

    #[test]
    fn season_by_month_southern_hemisphere() {
        // Southern hemisphere reverses: Spring<->Autumn, Summer<->Winter
        assert_eq!(get_season_by_month_and_latitude(4, -30.0), Season::Autumn);
        assert_eq!(get_season_by_month_and_latitude(7, -30.0), Season::Winter);
        assert_eq!(get_season_by_month_and_latitude(10, -30.0), Season::Spring);
        assert_eq!(get_season_by_month_and_latitude(1, -30.0), Season::Summer);
        assert_eq!(get_season_by_month_and_latitude(12, -30.0), Season::Summer);
    }

    #[test]
    fn season_equator_is_northern() {
        // latitude 0 is treated as northern
        assert_eq!(get_season_by_month_and_latitude(6, 0.0), Season::Summer);
    }

    #[test]
    fn season_boundary_month_0_is_winter() {
        // month 0 and out-of-range fall to default (Winter)
        assert_eq!(get_season_by_month_and_latitude(0, 40.0), Season::Winter);
        assert_eq!(get_season_by_month_and_latitude(13, 40.0), Season::Winter);
    }

    // ========================================================================= //
    // get_current_datetime
    // ========================================================================= //

    #[test]
    fn get_current_datetime_returns_reasonable_values() {
        let dt = get_current_datetime();
        assert!(dt.year >= 2024);
        assert!(dt.month >= 1 && dt.month <= 12);
        assert!(dt.day >= 1 && dt.day <= 31);
        assert!(dt.hour <= 23);
        assert!(dt.minute <= 59);
        assert!(dt.second <= 59);
        assert!(dt.weekday <= 6);
        assert!(dt.timestamp > 0);
    }

    // ========================================================================= //
    // Time period functions
    // ========================================================================= //

    #[test]
    fn time_period_constants_consistent() {
        assert_eq!(MORNING_HOUR_START, 6);
        assert_eq!(MORNING_HOUR_END, 12);
        assert_eq!(AFTERNOON_HOUR_END, 18);
        assert_eq!(EVENING_HOUR_END, 22);
    }

    #[test]
    fn get_time_period_returns_valid_string() {
        let period = get_time_period();
        assert!(["morning", "afternoon", "evening", "night"].contains(&period));
    }

    #[test]
    fn time_periods_are_mutually_exclusive() {
        // Exactly one of the time period functions should return true
        let checks = [is_morning(), is_afternoon(), is_evening(), is_night()];
        let true_count = checks.iter().filter(|&&x| x).count();
        assert_eq!(true_count, 1, "Exactly one time period should be active, got {:?}", checks);
    }

    // ========================================================================= //
    // EnvironmentManager
    // ========================================================================= //

    #[test]
    fn environment_manager_new_default_cache_duration() {
        let manager = EnvironmentManager::new();
        assert_eq!(manager.weather_cache_duration, WEATHER_CACHE_DURATION_SECS);
    }

    #[test]
    fn environment_manager_default_equals_new() {
        let a = EnvironmentManager::new();
        let b = EnvironmentManager::default();
        assert_eq!(a.weather_cache_duration, b.weather_cache_duration);
    }

    #[test]
    fn set_weather_cache_duration_changes_value() {
        let mut manager = EnvironmentManager::new();
        manager.set_weather_cache_duration(60);
        assert_eq!(manager.weather_cache_duration, 60);
    }

    #[test]
    fn get_datetime_returns_same_as_convenience_fn() {
        let manager = EnvironmentManager::new();
        let dt1 = manager.get_datetime();
        let dt2 = get_current_datetime();
        // They may differ by up to 1 second
        assert!(dt1.year == dt2.year);
        assert!(dt1.month == dt2.month);
        assert!(dt1.day == dt2.day);
    }

    // ========================================================================= //
    // GeoLocation serde roundtrip
    // ========================================================================= //

    #[test]
    fn geo_location_serde_roundtrip() {
        let geo = GeoLocation {
            latitude: 39.9,
            longitude: 116.4,
            timezone: Some("Asia/Shanghai".into()),
            is_northern_hemisphere: true,
            city: Some("Beijing".into()),
            region: Some("Beijing".into()),
            country: Some("China".into()),
        };
        let json = serde_json::to_string(&geo).unwrap();
        let parsed: GeoLocation = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.latitude, 39.9);
        assert_eq!(parsed.city.as_deref(), Some("Beijing"));
    }

    // ========================================================================= //
    // WeatherInfo serde roundtrip
    // ========================================================================= //

    #[test]
    fn weather_info_serde_roundtrip() {
        let weather = WeatherInfo {
            condition: "晴".into(),
            condition_code: "113".into(),
            temperature: 25.0,
            feels_like: Some(23.0),
            humidity: Some(60),
            wind_speed: Some(5.0),
        };
        let json = serde_json::to_string(&weather).unwrap();
        let parsed: WeatherInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.temperature, 25.0);
        assert_eq!(parsed.condition.as_ref(), "晴");
    }

    // ========================================================================= //
    // DateTimeInfo serde roundtrip
    // ========================================================================= //

    #[test]
    fn datetime_info_serde_roundtrip() {
        let dt = DateTimeInfo {
            year: 2026, month: 3, day: 3,
            hour: 14, minute: 30, second: 0,
            weekday: 2, timestamp: 1772600000,
        };
        let json = serde_json::to_string(&dt).unwrap();
        let parsed: DateTimeInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.year, 2026);
        assert_eq!(parsed.weekday, 2);
    }

    // ========================================================================= //
    // EnvironmentInfo serde roundtrip
    // ========================================================================= //

    #[test]
    fn environment_info_serde_roundtrip() {
        let env = EnvironmentInfo {
            location: None,
            datetime: get_current_datetime(),
            weather: None,
        };
        let json = serde_json::to_string(&env).unwrap();
        let parsed: EnvironmentInfo = serde_json::from_str(&json).unwrap();
        assert!(parsed.location.is_none());
        assert!(parsed.weather.is_none());
    }

    // ========================================================================= //
    // Fallback constants
    // ========================================================================= //

    #[test]
    fn fallback_constants_have_expected_values() {
        assert_eq!(FALLBACK_LATITUDE_NORTHERN, 40.0);
        assert_eq!(FALLBACK_LONGITUDE_CHINA, 116.0);
        assert_eq!(FALLBACK_LATITUDE_SOUTHERN, -35.0);
        assert_eq!(LONGITUDE_PER_HOUR_OFFSET, 15.0);
    }

    // ========================================================================= //
    // EnvironmentUpdateEvent
    // ========================================================================= //

    #[test]
    fn environment_update_event_serializes() {
        let event = EnvironmentUpdateEvent {
            location: None,
            weather: Some(WeatherInfo {
                condition: "晴".into(),
                condition_code: "113".into(),
                temperature: 20.0,
                feels_like: None,
                humidity: None,
                wind_speed: None,
            }),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"temperature\":20.0"));
        assert!(json.contains("\"location\":null"));
    }

    // ========================================================================= //
    // fallback_location_from_timezone
    // ========================================================================= //

    #[test]
    fn fallback_location_returns_valid_geo() {
        let loc = EnvironmentManager::fallback_location_from_timezone();
        assert!(loc.latitude >= -90.0 && loc.latitude <= 90.0);
        assert!(loc.longitude >= -180.0 && loc.longitude <= 180.0);
        assert!(loc.timezone.is_some());
    }

    #[test]
    fn fallback_location_hemisphere_is_consistent() {
        let loc = EnvironmentManager::fallback_location_from_timezone();
        if loc.latitude >= 0.0 {
            assert!(loc.is_northern_hemisphere);
        } else {
            assert!(!loc.is_northern_hemisphere);
        }
    }

    // ========================================================================= //
    // get_cached_location / get_cached_weather
    // ========================================================================= //

    // ========================================================================= //
    // get_current_season / get_season_by_location
    // ========================================================================= //

    #[test]
    fn get_current_season_returns_valid_season() {
        let season = get_current_season();
        let valid_en = [SEASON_NAME_SPRING_EN, SEASON_NAME_SUMMER_EN, SEASON_NAME_AUTUMN_EN, SEASON_NAME_WINTER_EN];
        let valid_zh = [SEASON_NAME_SPRING_ZH, SEASON_NAME_SUMMER_ZH, SEASON_NAME_AUTUMN_ZH, SEASON_NAME_WINTER_ZH];
        assert!(valid_en.contains(&season.name()));
        assert!(valid_zh.contains(&season.name_zh()));
    }

    #[test]
    fn get_season_by_location_returns_valid() {
        let _ = get_season_by_location(40.0).name();
        let _ = get_season_by_location(-35.0).name();
    }

}


