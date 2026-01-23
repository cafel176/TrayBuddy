//! 环境信息模块
//!
//! 提供系统环境信息的获取功能，包括：
//! - 日期时间信息 - 从系统本地时间获取
//! - 地理位置信息 - 从系统时区推断大致位置
//! - 天气信息 - 通过网络 API 获取（带缓存）
//! - 季节判断 - 根据月份和半球确定
//!
//! # 性能优化
//! - 地理位置使用静态缓存，程序运行期间只计算一次
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

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// 全局地理位置缓存（程序运行期间只计算一次）
static CACHED_LOCATION: OnceLock<GeoLocation> = OnceLock::new();

// ========================================================================= //

/// 地理位置信息 (从系统时区推断)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoLocation {
    /// 纬度 (根据时区推断的近似值)
    pub latitude: f64,
    /// 经度 (根据时区推断的近似值)
    pub longitude: f64,
    /// 时区名称
    pub timezone: Option<String>,
    /// 是否为北半球
    pub is_northern_hemisphere: bool,
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
    pub condition: String,
    /// 天气状况代码
    pub condition_code: String,
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
        Self {
            cached_weather: None,
            weather_cache_time: 0,
            weather_cache_duration: 1800, // 30 分钟缓存，减少联网请求
        }
    }

    // ========================================================================= //

    /// 获取当前日期时间信息 (从系统本地获取)
    pub fn get_datetime(&self) -> DateTimeInfo {
        get_current_datetime_impl()
    }

    // ========================================================================= //

    /// 获取地理位置信息 (从系统时区推断)
    /// 
    /// 使用全局静态缓存，程序运行期间只计算一次
    #[inline]
    pub fn get_location(&mut self) -> Option<GeoLocation> {
        Some(CACHED_LOCATION.get_or_init(Self::infer_location_from_timezone).clone())
    }

    /// 从系统时区推断地理位置（静态方法，用于全局缓存初始化）
    fn infer_location_from_timezone() -> GeoLocation {
        #[cfg(windows)]
        {
            use std::mem::MaybeUninit;

            #[repr(C)]
            struct TIME_ZONE_INFORMATION {
                bias: i32,
                standard_name: [u16; 32],
                standard_date: [u16; 8],
                standard_bias: i32,
                daylight_name: [u16; 32],
                daylight_date: [u16; 8],
                daylight_bias: i32,
            }

            extern "system" {
                fn GetTimeZoneInformation(lp_time_zone_information: *mut TIME_ZONE_INFORMATION) -> u32;
            }

            let mut tzi = MaybeUninit::<TIME_ZONE_INFORMATION>::uninit();
            unsafe {
                GetTimeZoneInformation(tzi.as_mut_ptr());
                let tzi = tzi.assume_init();
                
                // bias 是 UTC 与本地时间的差值 (分钟)，UTC = 本地时间 + bias
                // 所以本地时间 = UTC - bias
                // 经度近似值: 每小时对应 15 度
                let offset_hours = -(tzi.bias as f64) / 60.0;
                let longitude = offset_hours * 15.0;
                
                // 从时区名称推断半球 (简化处理，默认北半球)
                // 中国、日本、欧洲、北美等主要时区都在北半球
                let timezone_name = String::from_utf16_lossy(&tzi.standard_name)
                    .trim_end_matches('\0')
                    .to_string();
                
                // 南半球主要国家: 澳大利亚、新西兰、南美部分、南非等
                let is_southern = timezone_name.contains("Australia")
                    || timezone_name.contains("New Zealand")
                    || timezone_name.contains("South Africa")
                    || timezone_name.contains("Argentina")
                    || timezone_name.contains("Brazil")
                    || timezone_name.contains("Chile");
                
                // 根据时区偏移推断大致纬度
                // 北半球主要城市纬度范围: 20-60
                // 南半球主要城市纬度范围: -20 到 -50
                let latitude = if is_southern { -35.0 } else { 40.0 };
                
                return GeoLocation {
                    latitude,
                    longitude,
                    timezone: Some(timezone_name),
                    is_northern_hemisphere: !is_southern,
                };
            }
        }

        #[cfg(not(windows))]
        {
            // 非 Windows 平台，使用 TZ 环境变量或默认值
            let tz = std::env::var("TZ").unwrap_or_else(|_| "UTC".to_string());
            
            GeoLocation {
                latitude: 40.0,  // 默认北半球
                longitude: 0.0,
                timezone: Some(tz),
                is_northern_hemisphere: true,
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

    /// 获取天气信息 (需要联网，使用长缓存)
    /// 默认缓存 30 分钟，减少联网请求次数
    pub fn get_weather(&mut self) -> Option<WeatherInfo> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // 检查缓存是否有效
        if let Some(ref weather) = self.cached_weather {
            if now - self.weather_cache_time < self.weather_cache_duration {
                return Some(weather.clone());
            }
        }

        // 获取位置用于天气查询
        let location = self.get_location()?;
        let city = location.timezone.as_deref().unwrap_or("Beijing");

        // 从网络获取天气
        match self.fetch_weather_sync(city) {
            Ok(weather) => {
                self.cached_weather = Some(weather.clone());
                self.weather_cache_time = now;
                Some(weather)
            }
            Err(e) => {
                eprintln!("[EnvironmentManager] Failed to get weather: {}", e);
                // 如果有旧缓存，即使过期也返回旧数据
                self.cached_weather.clone()
            }
        }
    }

    /// 同步获取天气信息 (使用 wttr.in API)
    fn fetch_weather_sync(&self, city: &str) -> Result<WeatherInfo, String> {
        // 对城市名进行 URL 编码处理
        let city_encoded = city.replace(' ', "%20");
        let url = format!("https://wttr.in/{}?format=j1", city_encoded);

        #[cfg(windows)]
        {
            use std::process::Command;
            
            let output = Command::new("powershell")
                .args([
                    "-Command",
                    &format!(
                        "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (Invoke-WebRequest -Uri '{}' -UseBasicParsing -TimeoutSec 10).Content",
                        url
                    )
                ])
                .output()
                .map_err(|e| format!("Failed to execute request: {}", e))?;

            if !output.status.success() {
                return Err("HTTP request failed".to_string());
            }

            let body = String::from_utf8_lossy(&output.stdout);
            self.parse_wttr_response(&body)
        }

        #[cfg(not(windows))]
        {
            use std::process::Command;
            
            let output = Command::new("curl")
                .args(["-s", "--max-time", "10", &url])
                .output()
                .map_err(|e| format!("Failed to execute request: {}", e))?;

            if !output.status.success() {
                return Err("HTTP request failed".to_string());
            }

            let body = String::from_utf8_lossy(&output.stdout);
            self.parse_wttr_response(&body)
        }
    }

    /// 解析 wttr.in API 响应
    fn parse_wttr_response(&self, body: &str) -> Result<WeatherInfo, String> {
        let json: serde_json::Value = serde_json::from_str(body)
            .map_err(|e| format!("Failed to parse JSON: {}", e))?;

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
        let condition = current["lang_zh"][0]["value"]
            .as_str()
            .or_else(|| current["weatherDesc"][0]["value"].as_str())
            .unwrap_or("未知")
            .to_string();

        let condition_code = current["weatherCode"]
            .as_str()
            .unwrap_or("0")
            .to_string();

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
    let now = SystemTime::now();
    let timestamp = now
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // 使用 Windows API 获取本地时间
    #[cfg(windows)]
    {
        use std::mem::MaybeUninit;
        
        #[repr(C)]
        struct SYSTEMTIME {
            w_year: u16,
            w_month: u16,
            w_day_of_week: u16,
            w_day: u16,
            w_hour: u16,
            w_minute: u16,
            w_second: u16,
            w_milliseconds: u16,
        }

        extern "system" {
            fn GetLocalTime(lp_system_time: *mut SYSTEMTIME);
        }

        let mut st = MaybeUninit::<SYSTEMTIME>::uninit();
        unsafe {
            GetLocalTime(st.as_mut_ptr());
            let st = st.assume_init();
            
            return DateTimeInfo {
                year: st.w_year as u32,
                month: st.w_month as u32,
                day: st.w_day as u32,
                hour: st.w_hour as u32,
                minute: st.w_minute as u32,
                second: st.w_second as u32,
                weekday: st.w_day_of_week as u32,
                timestamp,
            };
        }
    }

    #[cfg(not(windows))]
    {
        // 非 Windows 平台的简单实现（UTC 时间）
        let secs = timestamp;
        let days = secs / 86400;
        let time_of_day = secs % 86400;
        
        let hour = (time_of_day / 3600) as u32;
        let minute = ((time_of_day % 3600) / 60) as u32;
        let second = (time_of_day % 60) as u32;
        let weekday = ((days + 4) % 7) as u32; // 1970-01-01 是周四
        
        DateTimeInfo {
            year: 1970 + (days / 365) as u32,
            month: 1,
            day: 1,
            hour,
            minute,
            second,
            weekday,
            timestamp,
        }
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
