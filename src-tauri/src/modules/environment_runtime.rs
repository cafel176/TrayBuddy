// EnvironmentManager 运行时方法（依赖 async / 网络 / tauri::AppHandle，无法单元测试）
// 通过 include!() 包含在 environment.rs 中
//
// 包含：
// - async 网络请求函数（get_location, refresh_location, get_weather 等）
// - init_environment（依赖 AppHandle + tauri::async_runtime）

impl EnvironmentManager {
    /// 获取地理位置信息 (通过 IP 地理位置 API 获取)
    ///
    /// 使用全局缓存，首次调用时获取
    #[inline]
    pub async fn get_location(&mut self) -> Option<GeoLocation> {
        // --- 1. 检查缓存 (快门) ---
        let cache = CACHED_LOCATION.get_or_init(|| Mutex::new(None));
        {
            let guard = cache.lock().ok()?;
            if let Some(ref loc) = *guard {
                return Some(loc.clone());
            }
        } // 锁在此释放，接下来的网络请求是非阻塞的

        // --- 2. 异步请求数据 ---
        let new_location = Self::fetch_location_from_api().await;

        // --- 3. 更新缓存 (写锁) ---
        if let Ok(mut guard) = cache.lock() {
            *guard = Some(new_location.clone());
        }

        Some(new_location)
    }

    /// 强制刷新地理位置缓存
    pub async fn refresh_location(&mut self) -> Option<GeoLocation> {
        let new_location = Self::fetch_location_from_api().await;

        let cache = CACHED_LOCATION.get_or_init(|| Mutex::new(None));
        if let Ok(mut guard) = cache.lock() {
            *guard = Some(new_location.clone());
            return Some(new_location);
        }
        None
    }

    /// 通过 IP 地理位置 API 获取位置信息
    async fn fetch_location_from_api() -> GeoLocation {
        // 尝试从 API 获取位置信息
        if let Ok(geo) = Self::fetch_ip_geolocation().await {
            return geo;
        }

        // API 失败时回退到本地时区推断
        Self::fallback_location_from_timezone()
    }

    /// 通过 ip-api.com 获取 IP 地理位置（免费，无需 API Key）
    async fn fetch_ip_geolocation() -> Result<GeoLocation, String> {
        let url = "http://ip-api.com/json/?fields=status,country,regionName,city,lat,lon,timezone&lang=zh-CN".to_string();
        let body = http_get_async(
            url,
            LOCATION_API_TIMEOUT_SECS,
            Some("\"status\"".to_string()),
        )
        .await?;
        Self::parse_ip_geo_response(&body)
    }

    // ========================================================================= //
    // 天气功能 (需要联网)
    // ========================================================================= //

    /// 获取天气信息 (使用全局缓存)
    /// 全局缓存在程序启动时初始化，过期后重新获取
    pub async fn get_weather(&mut self) -> Option<WeatherInfo> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // 检查全局缓存是否有效
        if let Some(cache) = CACHED_WEATHER.get() {
            if let Ok(guard) = cache.lock() {
                if guard.weather.is_some() && now - guard.cache_time < self.weather_cache_duration {
                    return guard.weather.clone();
                }
            }
        }

        // 从网络获取天气
        if let Some(weather) = self.fetch_weather_from_network().await {
            // 更新全局缓存
            if let Some(cache) = CACHED_WEATHER.get() {
                if let Ok(mut guard) = cache.lock() {
                    guard.weather = Some(weather.clone());
                    guard.cache_time = now;
                }
            }
            Some(weather)
        } else {
            None
        }
    }

    /// 从网络获取天气（不使用缓存，内部方法）
    async fn fetch_weather_from_network(&mut self) -> Option<WeatherInfo> {
        // 获取位置用于天气查询
        let location = self.get_location().await?;
        // 优先使用城市名，其次使用经纬度坐标
        let query = if let Some(ref city) = location.city {
            city.to_string()
        } else {
            // 使用经纬度作为备选（wttr.in 支持坐标查询）
            format!("{},{}", location.latitude, location.longitude)
        };

        self.fetch_weather_async(&query).await.ok()
    }

    /// 异步获取天气信息 (使用 wttr.in API)
    async fn fetch_weather_async(&self, query: &str) -> Result<WeatherInfo, String> {
        // 对查询参数进行 URL 编码处理
        let query_encoded = query.replace(' ', "%20");
        let url = format!("https://wttr.in/{}?format=j1", query_encoded);

        let body = http_get_async(
            url,
            WEATHER_API_TIMEOUT_SECS,
            Some("current_condition".to_string()),
        )
        .await?;
        self.parse_wttr_response(&body)
    }

    // ========================================================================= //

    /// 获取完整的环境信息
    pub async fn get_environment_info(&mut self) -> EnvironmentInfo {
        let datetime = self.get_datetime();
        let location = self.get_location().await;
        let weather = self.get_weather().await;

        EnvironmentInfo {
            location,
            datetime,
            weather,
        }
    }
}

// ========================================================================= //

/// 程序启动时初始化环境信息（在后台线程调用，避免阻塞启动）
///
/// 预先获取地理位置和天气信息，后续调用直接返回缓存
/// 获取完成后通过 app_handle 发送事件通知前端
pub fn init_environment(app_handle: Option<tauri::AppHandle>) {
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

    // 在后台异步任务中执行初始化逻辑，避免阻塞当前线程
    tauri::async_runtime::spawn(async move {
        let mut location_result: Option<GeoLocation> = None;
        let mut weather_result: Option<WeatherInfo> = None;

        // 获取地理位置
        let mut manager = EnvironmentManager::new();
        if let Some(location) = manager.get_location().await {
            #[cfg(debug_assertions)]
            println!(
                "[Environment] Location: {:?}, {:?}, {:?}",
                location.city, location.region, location.country
            );
            location_result = Some(location.clone());

            // 获取天气（会自动缓存到全局）
            if let Some(weather) = manager.get_weather().await {
                #[cfg(debug_assertions)]
                println!(
                    "[Environment] Weather: {}°C, {}",
                    weather.temperature, weather.condition
                );
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
            let _ = emit(&handle, events::ENVIRONMENT_UPDATED, event_data);
            #[cfg(debug_assertions)]
            println!("[Environment] Event emitted to frontend");
        }

        #[cfg(debug_assertions)]
        println!("[Environment] Initialization complete");
    });

}
