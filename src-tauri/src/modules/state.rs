//! 状态管理模块
//!
//! 负责管理角色状态的切换和事件通知，包括：
//! - 当前状态和持久状态的管理
//! - 状态优先级和锁定机制
//! - 下一状态（next_state）链式切换
//! - 定时触发功能
//! - 随机状态选择
//!
//! # 架构说明
//!
//! `StateManager` 持有 `ResourceManager` 的 `Arc<Mutex<>>` 引用，
//! 用于在状态切换时查询 next_state 对应的状态信息。
//!
//! # API 设计
//!
//! 状态切换相关方法分为三层：
//!
//! ## 公共 API（外部调用）
//! - `change_state(state)` - 智能切换，自动判断持久/临时
//! - `change_state_ex(state, force)` - 智能切换，支持强制模式
//! - `set_persistent_state(state, force)` - 直接设置持久状态
//! - `set_current_state(state, force)` - 直接设置临时状态
//! - `trigger_random_state(states)` - 从列表随机选择并切换
//!
//! ## 模块内 API（`pub(crate)`，仅 TriggerManager 使用）
//! - `change_state_with_rm(state, rm)` - 外部已持有 ResourceManager 锁时使用
//! - `trigger_random_state_with_rm(states, rm)` - 外部已持有 ResourceManager 锁时使用
//!
//! ## 私有实现（内部复用）
//! - `change_state_internal(state, force, rm)` - 统一的切换实现
//! - `set_current_state_internal(state, force, rm)` - 统一的临时状态设置
//! - `trigger_random_state_internal(states, rm)` - 统一的随机触发实现
//! - `prepare_next_state_with_rm(rm)` - 预设下一状态
//!
//! # 为什么需要 `_with_rm` 变体？
//!
//! 当 `TriggerManager::trigger_event` 同时持有 `ResourceManager` 和 `StateManager`
//! 的锁时，如果内部方法再次尝试获取 `ResourceManager` 锁会导致死锁（Rust Mutex 不可重入）。
//! `_with_rm` 变体允许传入已持有的引用，避免重复加锁。
//!
//! # 性能优化
//! - 使用 `Relaxed` 内存序减少原子操作开销
//! - 定时器线程使用更高效的状态检查
//! - 减少不必要的状态克隆

#![allow(unused)]

use super::resource::{ResourceManager, StateInfo};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

// ========================================================================= //
// 事件结构体
// ========================================================================= //

/// 发送给前端的状态切换事件
#[derive(Debug, Serialize, Clone)]
pub struct StateChangeEvent {
    /// 切换到的状态信息
    pub state: StateInfo,
    /// true: 播放一次后回到持久状态, false: 循环播放
    pub play_once: bool,
}

// ========================================================================= //
// 状态管理器
// ========================================================================= //

/// 状态管理器
///
/// 负责管理角色的状态切换逻辑：
/// - **持久状态**: 默认循环播放的状态（如 idle、music）
/// - **临时状态**: 播放一次后自动回到持久状态（如 morning、login）
/// - **状态锁定**: 临时状态播放期间锁定，防止被打断
/// - **优先级机制**: 高优先级状态可以打断低优先级状态
pub struct StateManager {
    /// 当前正在播放的状态
    current_state: Option<StateInfo>,
    /// 下一个待切换的状态（当前状态播放完毕后切换）
    next_state: Option<StateInfo>,
    /// 持久状态（临时状态播放完毕后回到此状态）
    persistent_state: Option<StateInfo>,
    /// Tauri AppHandle，用于发送事件到前端
    app_handle: Option<AppHandle>,
    /// 状态锁定标志（临时状态播放中时为 true）
    locked: bool,
    /// 定时触发器开关（跨线程共享）
    timer_enabled: Option<Arc<AtomicBool>>,
}

impl StateManager {
    /// 创建新的状态管理器
    pub fn new() -> Self {
        Self {
            current_state: None,
            next_state: None,
            persistent_state: None,
            app_handle: None,
            locked: false,
            timer_enabled: None,
        }
    }

    // ========================================================================= //
    // 基础状态管理 - 公共 API
    // ========================================================================= //

    /// 检查状态是否被锁定
    #[inline]
    pub fn is_locked(&self) -> bool {
        self.locked
    }

    /// 智能切换状态
    ///
    /// 根据状态的 `persistent` 属性自动选择切换方式：
    /// - 持久状态 → 调用 `set_persistent_state`
    /// - 临时状态 → 调用 `set_current_state`
    ///
    /// # 参数
    /// - `state`: 目标状态
    /// - `rm`: ResourceManager 引用，用于查询 next_state（**调用者必须在调用前锁定 ResourceManager**）
    ///
    /// # 返回
    /// - `Ok(true)`: 切换成功
    /// - `Ok(false)`: 切换被跳过（锁定、优先级不足等）
    /// - `Err`: 参数错误
    #[inline]
    pub fn change_state(&mut self, state: StateInfo, rm: &ResourceManager) -> Result<bool, String> {
        self.change_state_internal(state, false, rm)
    }

    /// 智能切换状态（强制模式）
    ///
    /// # 参数
    /// - `state`: 目标状态
    /// - `force`: true 时忽略优先级和锁定检查
    /// - `rm`: ResourceManager 引用（**调用者必须在调用前锁定 ResourceManager**）
    #[inline]
    pub fn change_state_ex(
        &mut self,
        state: StateInfo,
        force: bool,
        rm: &ResourceManager,
    ) -> Result<bool, String> {
        self.change_state_internal(state, force, rm)
    }

    // ========================================================================= //
    // 基础状态管理 - 私有实现
    // ========================================================================= //

    /// 内部状态切换实现（所有 change_state 变体的统一入口）
    fn change_state_internal(
        &mut self,
        state: StateInfo,
        force: bool,
        rm: &ResourceManager,
    ) -> Result<bool, String> {
        #[cfg(debug_assertions)]
        println!(
            "[StateManager] Request change to state: '{}' (Persistent: {}, Force: {})",
            state.name, state.persistent, force
        );

        let is_persistent = state.persistent;
        let result = if is_persistent {
            self.set_persistent_state(state, force, rm)
        } else {
            self.set_current_state_internal(state, force, rm)
        };

        // 状态切换成功时，更新定时触发开关
        if let Ok(true) = result {
            self.set_timer_enabled(is_persistent);
        }

        result
    }

    // ========================================================================= //
    // 持久状态管理
    // ========================================================================= //

    /// 获取当前持久状态的引用
    #[inline]
    pub fn get_persistent_state(&self) -> Option<&StateInfo> {
        self.persistent_state.as_ref()
    }

    /// 设置持久状态
    ///
    /// 切换逻辑：
    /// - 如果当前被锁定（临时状态播放中），只更新持久状态数据，不切换当前状态
    /// - 如果未锁定，同时更新持久状态和当前状态
    ///
    /// # 参数
    /// - `state`: 目标持久状态
    /// - `force`: 是否强制切换（忽略优先级和锁定）
    pub fn set_persistent_state(
        &mut self,
        state: StateInfo,
        force: bool,
        rm: &ResourceManager,
    ) -> Result<bool, String> {
        if !state.persistent {
            return Err(format!("State '{}' is not a persistent state", state.name));
        }

        // 如果当前状态与目标状态相同，跳过
        if self.current_state.as_ref().map(|s| &s.name) == Some(&state.name) {
            return Ok(false);
        }

        // 非强制模式下检查优先级
        if !force {
            let current_priority = self.persistent_state.as_ref().map_or(0, |s| s.priority);
            if state.priority < current_priority {
                #[cfg(debug_assertions)]
                println!(
                    "[StateManager] 状态优先级不够，禁止变更状态 '{}'",
                    state.name
                );
                return Ok(false);
            }
        }

        // 更新持久状态
        self.persistent_state = Some(state.clone());

        // 被锁定时只更新数据，不切换当前状态
        if self.locked && !force {
            #[cfg(debug_assertions)]
            println!(
                "[StateManager] 状态锁定中，仅更新持久状态为 '{}'",
                state.name
            );
            return Ok(false);
        }

        // 强制切换时解除锁定
        if force {
            self.locked = false;
        }

        // 切换当前状态并通知前端
        self.current_state = Some(state.clone());
        self.emit_state_change(&state, false);

        self.clear_next_state();

        #[cfg(debug_assertions)]
        println!(
            "[StateManager] Successfully switched to persistent state: '{}'",
            state.name
        );

        Ok(true)
    }

    // ========================================================================= //
    // 当前状态管理（临时状态）
    // ========================================================================= //

    /// 获取当前状态的引用
    #[inline]
    pub fn get_current_state(&self) -> Option<&StateInfo> {
        self.current_state.as_ref()
    }

    /// 设置临时状态
    ///
    /// 临时状态播放完毕后会自动回到持久状态。
    /// 切换时会锁定状态，防止被低优先级状态打断。
    ///
    /// # 参数
    /// - `state`: 目标临时状态（`persistent` 必须为 `false`）
    /// - `force`: true 时忽略优先级和锁定检查
    /// - `rm`: ResourceManager 引用（**调用者必须在调用前锁定 ResourceManager**）
    pub fn set_current_state(
        &mut self,
        state: StateInfo,
        force: bool,
        rm: &ResourceManager,
    ) -> Result<bool, String> {
        self.set_current_state_internal(state, force, rm)
    }

    /// 内部临时状态设置实现（所有临时状态切换的统一入口）
    fn set_current_state_internal(
        &mut self,
        state: StateInfo,
        force: bool,
        rm: &ResourceManager,
    ) -> Result<bool, String> {
        if state.persistent {
            return Err(format!(
                "State '{}' is a persistent state, use set_persistent_state",
                state.name
            ));
        }

        // 非强制模式下的检查
        if !force {
            if self.locked {
                #[cfg(debug_assertions)]
                println!("[StateManager] 状态锁定中，禁止变更状态 '{}'", state.name);
                return Ok(false);
            }

            let current_priority = self.current_state.as_ref().map_or(0, |s| s.priority);
            if state.priority < current_priority {
                #[cfg(debug_assertions)]
                println!(
                    "[StateManager] 状态优先级不够，禁止变更状态 '{}'",
                    state.name
                );
                return Ok(false);
            }
        }

        // 切换到临时状态并锁定
        self.current_state = Some(state.clone());
        self.emit_state_change(&state, true);
        self.locked = true;

        // 预设下一个状态
        self.clear_next_state();
        self.prepare_next_state(rm);

        #[cfg(debug_assertions)]
        println!(
            "[StateManager] Successfully switched to temporary state: '{}'",
            state.name
        );

        Ok(true)
    }

    // ========================================================================= //
    // 下一状态管理
    // ========================================================================= //

    /// 根据当前状态的 next_state 字段预设下一个状态
    ///
    /// 从 ResourceManager 获取状态信息并设置为下一个待切换状态
    ///
    /// # 参数
    /// - `rm`: ResourceManager 引用（**调用者必须在调用前锁定 ResourceManager**）
    fn prepare_next_state(&mut self, rm: &ResourceManager) {
        // 检查当前状态是否定义了 next_state（避免不必要的 clone）
        let next_state_name = match &self.current_state {
            Some(s) if !s.next_state.is_empty() => s.next_state.as_str(),
            _ => return,
        };

        // 使用传入的引用
        if let Some(next_info) = rm.get_state_by_name(next_state_name) {
            self.next_state = Some(next_info.clone());
        }
    }

    /// 获取下一个待切换状态的引用
    #[inline]
    pub fn get_next_state(&self) -> Option<&StateInfo> {
        self.next_state.as_ref()
    }

    /// 设置下一个待切换状态
    ///
    /// 当前状态播放完毕后会自动切换到此状态
    #[inline]
    pub fn set_next_state(&mut self, state: StateInfo) {
        self.next_state = Some(state);
    }

    /// 清除下一个待切换状态
    #[inline]
    pub fn clear_next_state(&mut self) {
        self.next_state = None;
    }

    // ========================================================================= //
    // 状态完成处理
    // ========================================================================= //

    /// 状态播放完毕回调
    ///
    /// 解锁状态并按优先级切换：
    /// 1. 如果有 next_state，切换到 next_state
    /// 2. 否则回到 persistent_state
    ///
    /// # 参数
    /// - `rm`: ResourceManager 引用（**调用者必须在调用前锁定 ResourceManager**）
    pub fn on_state_complete(&mut self, rm: &ResourceManager) {
        self.locked = false;

        // 优先切换到 next_state（使用 take 避免额外 clone）
        if let Some(next) = self.next_state.take() {
            let _ = self.change_state(next, rm);
            return;
        }

        // 否则回到持久状态（需要 clone 因为持久状态需保留）
        if let Some(persistent) = self.persistent_state.clone() {
            let _ = self.change_state(persistent, rm);
        }
    }

    // ========================================================================= //
    // 随机状态触发 - 公共 API
    // ========================================================================= //

    /// 从状态列表中随机选择一个可用状态并切换
    ///
    /// 常用于定时触发器和事件触发器。
    ///
    /// # 流程
    /// 1. 筛选出所有通过 `is_enable()` 检查的状态
    /// 2. 随机选择一个
    /// 3. 执行切换（遵循优先级和锁定规则）
    ///
    /// # 参数
    /// - `states`: 候选状态列表
    /// - `rm`: ResourceManager 引用（**调用者必须在调用前锁定 ResourceManager**）
    ///
    /// # 返回
    /// - `Ok(true)`: 成功触发
    /// - `Ok(false)`: 无可用状态或切换被跳过
    pub fn trigger_random_state(
        &mut self,
        states: &[StateInfo],
        rm: &ResourceManager,
    ) -> Result<bool, String> {
        if states.is_empty() {
            return Ok(false);
        }

        // 筛选可用状态（使用引用避免克隆）
        let enabled_states: Vec<&StateInfo> = states.iter().filter(|s| s.is_enable()).collect();

        if enabled_states.is_empty() {
            #[cfg(debug_assertions)]
            println!("[StateManager] 没有可用的状态");
            return Ok(false);
        }

        // 随机选择（只在需要切换时才克隆）
        let idx = if enabled_states.len() == 1 {
            0
        } else {
            Self::random_index(enabled_states.len())
        };
        let selected = enabled_states[idx].clone();

        #[cfg(debug_assertions)]
        println!("[StateManager] 随机选择状态: '{}'", selected.name);
        self.change_state(selected, rm)
    }

    /// 基于时间戳的简单随机索引生成
    #[inline]
    /// 生成 0 到 max-1 之间的真随机索引（使用系统 CSPRNG）
    fn random_index(max: usize) -> usize {
        let mut buf = [0u8; 8];
        getrandom::getrandom(&mut buf).unwrap_or_else(|_| {
            // 回退到时间戳（极少发生）
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .subsec_nanos();
            buf = nanos.to_le_bytes().repeat(2).try_into().unwrap_or([0; 8]);
        });
        usize::from_le_bytes(buf) % max
    }

    /// 生成 0.0 到 1.0 之间的真随机数（使用系统 CSPRNG）
    #[inline]
    fn random_float() -> f32 {
        let mut buf = [0u8; 4];
        getrandom::getrandom(&mut buf).unwrap_or_else(|_| {
            // 回退到时间戳
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .subsec_nanos();
            buf = nanos.to_le_bytes();
        });
        let n = u32::from_le_bytes(buf);
        (n % 10000) as f32 / 10000.0
    }

    // ========================================================================= //
    // 定时触发功能
    // ========================================================================= //

    /// 设置定时触发开关
    fn set_timer_enabled(&self, enabled: bool) {
        if let Some(ref timer) = self.timer_enabled {
            #[cfg(debug_assertions)]
            if enabled {
                println!("[StateManager] 启用定时触发");
            } else {
                println!("[StateManager] 禁用定时触发");
            }
            timer.store(enabled, Ordering::Relaxed);
        }
    }

    /// 启动定时触发器线程
    ///
    /// 在独立线程中运行，定期检查持久状态的 `trigger_time` 和 `trigger_rate`，
    /// 按配置的概率触发 `can_trigger_states` 中的随机状态。
    ///
    /// # 性能说明
    /// - 使用短暂的锁获取，避免长时间持有锁
    /// - 先检查轻量条件（开关、时间间隔）再获取锁
    pub fn start_timer_loop(&mut self, app_handle: tauri::AppHandle) {
        let timer_enabled = Arc::new(AtomicBool::new(false));
        self.timer_enabled = Some(timer_enabled.clone());

        std::thread::spawn(move || {
            #[cfg(debug_assertions)]
            println!("[StateManager] 定时触发器线程启动");

            let mut last_trigger_time = SystemTime::now();

            loop {
                // 定期检查
                std::thread::sleep(Duration::from_secs(
                    crate::modules::constants::TIMER_TRIGGER_CHECK_INTERVAL_SECS,
                ));

                // 快速检查开关（无锁操作）
                if !timer_enabled.load(Ordering::Relaxed) {
                    last_trigger_time = SystemTime::now();
                    continue;
                }

                // 获取持久状态信息（短暂持有锁）
                use tauri::Manager;
                let app_state: tauri::State<crate::AppState> = app_handle.state();

                // 从 state_manager 获取必要信息后立即释放锁
                let (trigger_time, trigger_rate, state_names) = {
                    let sm = app_state.state_manager.lock().unwrap();
                    match sm.get_persistent_state() {
                        Some(s) => (s.trigger_time, s.trigger_rate, s.can_trigger_states.clone()),
                        None => continue,
                    }
                };

                // 检查触发间隔（无锁操作）
                if trigger_time <= 0.0 {
                    continue;
                }

                let elapsed = last_trigger_time.elapsed().unwrap_or_default();
                if elapsed.as_secs_f32() < trigger_time {
                    continue;
                }

                // 重置计时器
                last_trigger_time = SystemTime::now();

                // 检查触发概率（无锁操作）
                if trigger_rate <= 0.0 || state_names.is_empty() {
                    continue;
                }

                let random_value = Self::random_float();
                if random_value > trigger_rate {
                    continue;
                }

                // 执行触发（需要获取锁）
                let rm = app_state.resource_manager.lock().unwrap();
                let mut sm = app_state.state_manager.lock().unwrap();

                // 从 ResourceManager 获取状态信息并触发
                let states: Vec<StateInfo> = state_names
                    .iter()
                    .filter_map(|name| rm.get_state_by_name(name).cloned())
                    .collect();

                let _ = sm.trigger_random_state(&states, &rm);
            }
        });
    }

    // ========================================================================= //
    // 初始化和事件
    // ========================================================================= //

    /// 设置 AppHandle，用于发送事件到前端
    pub fn set_app_handle(&mut self, app_handle: AppHandle) {
        self.app_handle = Some(app_handle);
    }

    /// 发送状态切换事件到前端
    fn emit_state_change(&self, state: &StateInfo, play_once: bool) {
        if let Some(ref app_handle) = self.app_handle {
            let event = StateChangeEvent {
                state: state.clone(),
                play_once,
            };

            if let Err(e) = app_handle.emit("state-change", event) {
                eprintln!("[StateManager] 发送状态切换事件失败: {}", e);
            }
        }
    }
}
