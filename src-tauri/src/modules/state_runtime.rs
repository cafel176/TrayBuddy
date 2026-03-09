// StateManager 运行时方法（依赖 tauri::AppHandle / async_runtime / AppState，无法单元测试）
// 通过 include!() 包含在 state.rs 中
//
// 包含：
// - `StateLimitsContext::prefetch()` - 从 AppState 预取状态限制数据
// - `start_timer_loop()` - 定时触发器线程
// - `set_app_handle()` - 设置 AppHandle
// - `emit_state_change()` - 发送状态切换事件到前端
// - `get_current_mod_data_value()` - 通过 AppHandle 读取 ModData
// - `get_session_uptime_minutes_now()` - 通过 AppHandle 读取会话启动时长
// - `apply_mod_data_counter_async()` - 异步更新 ModData 计数器
// - `is_state_allowed_by_limits()` - 通过 AppHandle 判断状态限制（实例方法）

impl StateLimitsContext {
    /// 从 `AppState` 中预取状态限制数据（获取并立即释放 `storage` 锁）
    ///
    /// 必须在获取 `resource_manager` / `state_manager` 锁之前调用。
    pub fn prefetch(app_state: &AppState) -> Self {
        let (mod_data_value, session_uptime_minutes) = {
            let storage = app_state.storage.lock().unwrap();
            let mod_id = storage.data.info.current_mod.to_string();
            let value = storage
                .data
                .info
                .mod_data
                .get(&mod_id)
                .map(|m| m.value)
                .unwrap_or(0);
            let secs = storage.get_session_uptime_seconds_now();
            let mins = i32::try_from(secs / 60).unwrap_or(i32::MAX);
            (value, mins)
        };
        // storage 锁已释放

        let current_weather = get_cached_weather();

        Self {
            mod_data_value,
            session_uptime_minutes,
            current_weather,
        }
    }
}

impl StateManager {
    /// 启动定时触发器线程
    pub fn start_timer_loop(&mut self, app_handle: tauri::AppHandle) {
        let timer_enabled = Arc::new(AtomicBool::new(false));
        self.timer_enabled = Some(timer_enabled.clone());

        let should_enable = match self.current_state.as_ref() {
            Some(s) => s.persistent,
            None => self.persistent_state.is_some(),
        };
        self.set_timer_enabled(should_enable);

        tauri::async_runtime::spawn(async move {
            #[cfg(debug_assertions)]
            println!("[StateManager] 定时触发器线程启动");

            let mut last_trigger_time = SystemTime::now();
            let mut ticker = tokio::time::interval(Duration::from_secs(
                crate::modules::constants::TIMER_TRIGGER_CHECK_INTERVAL_SECS,
            ));

            loop {
                ticker.tick().await;

                if !timer_enabled.load(Ordering::Relaxed) {
                    last_trigger_time = SystemTime::now();
                    continue;
                }

                let app_state: tauri::State<crate::AppState> = app_handle.state();

                let (trigger_time, trigger_rate, state_candidates) = {
                    let sm = app_state.state_manager.lock().unwrap();
                    match sm.persistent_state.as_ref() {
                        Some(s) => (s.trigger_time, s.trigger_rate, s.can_trigger_states.clone()),
                        None => continue,
                    }
                };

                if trigger_time <= 0.0 {
                    continue;
                }

                let elapsed = last_trigger_time.elapsed().unwrap_or_default();
                if elapsed.as_secs_f32() < trigger_time {
                    continue;
                }

                last_trigger_time = SystemTime::now();

                if trigger_rate <= 0.0 || state_candidates.is_empty() {
                    continue;
                }

                let random_value = Self::random_float();
                if random_value > trigger_rate {
                    continue;
                }

                let (mod_data_value, session_uptime_minutes) = {
                    let storage = app_state.storage.lock().unwrap();
                    let mod_id = storage.data.info.current_mod.to_string();

                    let mod_data_value = storage
                        .data
                        .info
                        .mod_data
                        .get(&mod_id)
                        .map(|m| m.value)
                        .unwrap_or(0);

                    let secs = storage.get_session_uptime_seconds_now();
                    let mins = secs / 60;
                    let session_uptime_minutes = i32::try_from(mins).unwrap_or(i32::MAX);

                    (mod_data_value, session_uptime_minutes)
                };

                let current_weather = get_cached_weather();
                let current_temp = current_weather.as_ref().map(|w| w.temperature);

                let rm = app_state.resource_manager.lock().unwrap();

                let candidate_names: Vec<(&str, u64)> = state_candidates
                    .iter()
                    .filter_map(|c| {
                        if c.weight == 0 {
                            return None;
                        }
                        rm.get_state_by_name(c.state.as_ref())
                            .and_then(|s| {
                                if s.is_enable()
                                    && Self::is_state_allowed_by_limits_static(
                                        s,
                                        mod_data_value,
                                        session_uptime_minutes,
                                        current_temp,
                                        current_weather.as_ref(),
                                    )
                                {
                                    Some((c.state.as_ref(), c.weight as u64))
                                } else {
                                    None
                                }
                            })
                    })
                    .collect();

                if candidate_names.is_empty() {
                    drop(rm);
                    continue;
                }

                let total_weight: u64 = candidate_names.iter().map(|(_, w)| *w).sum();
                let mut pick = Self::random_u64(total_weight);
                let mut selected_name = None;
                for (name, weight) in candidate_names {
                    if pick < weight {
                        selected_name = Some(name);
                        break;
                    }
                    pick -= weight;
                }

                let Some(name) = selected_name else {
                    drop(rm);
                    continue;
                };

                let Some(selected) = rm.get_state_by_name(name).cloned() else {
                    drop(rm);
                    continue;
                };

                let mut sm = app_state.state_manager.lock().unwrap();
                let _ = sm.change_state(selected, &rm);

                drop(sm);
                drop(rm);
            }
        });
    }

    /// 设置 AppHandle，用于发送事件到前端
    pub fn set_app_handle(&mut self, app_handle: AppHandle) {
        self.app_handle = Some(app_handle);
    }

    /// 发送状态切换事件到前端
    fn emit_state_change(&self, state: &Arc<StateInfo>, play_once: bool) {
        if let Some(ref app_handle) = self.app_handle {
            let event = StateChangeEvent {
                state: Arc::clone(state),
                play_once,
            };
            let _ = emit(&app_handle, events::STATE_CHANGE, event);
        }
    }

    /// 获取当前 ModData 的数值（若不存在则返回 0）
    pub(crate) fn get_current_mod_data_value(&self) -> i32 {
        let Some(app_handle) = &self.app_handle else {
            return 0;
        };
        let Some(app_state) = app_handle.try_state::<AppState>() else {
            return 0;
        };
        let storage = match app_state.storage.lock() {
            Ok(s) => s,
            Err(_) => return 0,
        };
        let mod_id = storage.data.info.current_mod.to_string();
        storage
            .data
            .info
            .mod_data
            .get(&mod_id)
            .map(|m| m.value)
            .unwrap_or(0)
    }

    /// 获取"本次程序启动已运行分钟数"（若取不到则返回 0）
    pub(crate) fn get_session_uptime_minutes_now(&self) -> i32 {
        let Some(app_handle) = &self.app_handle else {
            return 0;
        };
        let Some(app_state) = app_handle.try_state::<AppState>() else {
            return 0;
        };
        let storage = match app_state.storage.lock() {
            Ok(s) => s,
            Err(_) => return 0,
        };

        let secs = storage.get_session_uptime_seconds_now();
        let mins = secs / 60;
        i32::try_from(mins).unwrap_or(i32::MAX)
    }

    /// 进入状态时，按配置异步更新当前 Mod 的数据计数器，并立即落盘
    fn apply_mod_data_counter_async(&self, state: &Arc<StateInfo>) {
        let Some(cfg) = state.mod_data_counter.clone() else {
            return;
        };

        match cfg.op {
            ModDataCounterOp::Add | ModDataCounterOp::Sub if cfg.value == 0 => return,
            ModDataCounterOp::Mul | ModDataCounterOp::Div if cfg.value == 1 => return,
            _ => {}
        }

        let Some(app_handle) = self.app_handle.clone() else {
            return;
        };

        let _ = std::thread::Builder::new()
            .name("traybuddy-mod-data".to_string())
            .spawn(move || {
                let Some(app_state) = app_handle.try_state::<AppState>() else {
                    return;
                };

            let mut storage = app_state.storage.lock().unwrap();
            let mod_id = storage.data.info.current_mod.to_string();

            let current = storage
                .data
                .info
                .mod_data
                .get(&mod_id)
                .map(|m| m.value)
                .unwrap_or(0);

            let next_opt = match cfg.op {
                ModDataCounterOp::Add => current.checked_add(cfg.value),
                ModDataCounterOp::Sub => current.checked_sub(cfg.value),
                ModDataCounterOp::Mul => current.checked_mul(cfg.value),
                ModDataCounterOp::Div => {
                    if cfg.value == 0 {
                        None
                    } else {
                        current.checked_div(cfg.value)
                    }
                }
                ModDataCounterOp::Set => Some(cfg.value),
            };

            let Some(next) = next_opt else {
                #[cfg(debug_assertions)]
                eprintln!(
                    "[StateManager] mod_data_counter overflow/div0: mod='{}' current={} op={:?} value={}",
                    mod_id, current, cfg.op, cfg.value
                );
                return;
            };

            if next == current {
                return;
            }

            {
                let entry = storage.data.info.mod_data.entry(mod_id.clone()).or_insert(ModData {
                    mod_id: mod_id.clone(),
                    value: current,
                });
                entry.value = next;
            }

            if storage.save().is_err() {
                return;
            }

            let data = storage
                .data
                .info
                .mod_data
                .get(&mod_id)
                .cloned()
                .unwrap_or(ModData {
                    mod_id,
                    value: next,
                });
            drop(storage);
            let _ = emit(&app_handle, events::MOD_DATA_CHANGED, data);

        });
    }

    /// 判断状态是否满足触发限制（实例方法，依赖 AppHandle 获取实时数据）
    ///
    /// ⚠️ **死锁风险说明**：此方法内部会获取 `storage` 锁来读取 mod_data_value 和 session_uptime。
    /// 如果调用者已持有 `state_manager`（sm）锁，就会形成 `sm → storage` 的锁序。
    /// 为避免死锁，**在同时持有 rm 和 sm 锁的上下文中**（如 `trigger_event`、`trigger_random_state`），
    /// 应使用 `is_state_allowed_by_limits_static()` 替代，并在获取 rm/sm 锁之前预先读取 storage 数据。
    ///
    /// 此方法仅适用于**调用者未持有其他锁**的安全场景。
    #[inline]
    pub(crate) fn is_state_allowed_by_limits(&self, state: &StateInfo) -> bool {
        let value = self.get_current_mod_data_value();
        let uptime_minutes = self.get_session_uptime_minutes_now();
        let current_weather = get_cached_weather();
        let current_temp = current_weather.as_ref().map(|w| w.temperature);
        Self::is_state_allowed_by_limits_static(
            state,
            value,
            uptime_minutes,
            current_temp,
            current_weather.as_ref(),
        )
    }
}
