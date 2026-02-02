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

use super::constants::{
    STATE_IDLE, STATE_MUSIC, STATE_MUSIC_END, STATE_MUSIC_START, STATE_SILENCE, STATE_SILENCE_END,
    STATE_SILENCE_START,
};
use super::event_manager::{emit, events};
use super::media_observer::{get_cached_media_state, MediaPlaybackStatus};
use super::resource::{ModDataCounterOp, ResourceManager, StateInfo};
use super::storage::ModData;
use crate::AppState;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

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
/// 它是整个应用角色的“大脑”，负责决定在任意时刻角色应该展现何种姿态。
/// 
/// # 核心机制：持久状态 vs 临时状态
/// - **持久状态 (Persistent State)**: 
///   如 `idle`（待机）、`music`（听歌）。它们通常是循环播放的基准状态。
///   当没有任何外部事件或临时动作时，角色始终处于某个持久状态中。
/// - **临时状态 (Current/Temporary State)**: 
///   如 `morning`（早安）、`click`（被点击）。它们通常只播放一次（`play_once`）。
///   播放完成后，管理器会自动引导角色回到当前的“持久状态”。
/// 
/// # 锁定与优先级
/// - **锁定 (Locked)**: 当一个高优先级的临时状态正在播放时，系统会进入锁定模式，
///   防止被低优先级的触发器频繁打断动画表现。
/// - **优先级 (Priority)**: 用于解决状态冲突。例如，用户手动点击触发的状态通常比
///   定时随机触发的状态具有更高的优先级。
pub struct StateManager {
    /// 当前正在播放的状态（决定前端 Canvas 渲染哪个资产）
    current_state: Option<StateInfo>,
    /// 下一个待切换的状态（当前动画帧序列播放完毕后的衔接状态）
    next_state: Option<StateInfo>,
    /// 当前记录的基准持久状态（作为临时状态结束后的回退目标）
    persistent_state: Option<StateInfo>,
    /// Tauri 应用句柄：用于通过 IPC 向前端发送 `state_change` 指令
    app_handle: Option<AppHandle>,
    /// 状态锁定标记：为 true 时，除非使用 `force` 模式，否则不接受新的切换请求
    locked: bool,
    /// 定时触发器控制：原子布尔值，用于控制后台随机动作触发线程的启停
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

        // 如果当前是music或music_start或music_end，不再重复进入和music_start
        if self.current_state.as_ref().map(|s| s.name.as_ref()) == Some(STATE_MUSIC) ||
        self.current_state.as_ref().map(|s| s.name.as_ref()) == Some(STATE_MUSIC_END) {
            if state.name.as_ref() == STATE_MUSIC_START {
                return Ok(false);
            }
        }

        if self.current_state.as_ref().map(|s| s.name.as_ref()) == Some(STATE_SILENCE) ||
        self.current_state.as_ref().map(|s| s.name.as_ref()) == Some(STATE_SILENCE_END) {
            if state.name.as_ref() == STATE_SILENCE_START {
                return Ok(false);
            }
        }

        // 提前获取媒体状态，减少锁持有时间，避免死锁风险
        let media_state = get_cached_media_state();

        // 保存原始状态名称，用于后续判断
        let original_state_name = state.name.clone();

        // 如果目标是 idle 状态且检测到媒体正在播放，切换到 music_start 状态
        let final_state = if state.name.as_ref() == STATE_IDLE && !force {
            match media_state {
                Some(ref ms) if ms.status == MediaPlaybackStatus::Playing => {
                    // 获取 music_start 状态
                    match rm.get_state_by_name(STATE_MUSIC_START) {
                        Some(music_start_state) => music_start_state.clone(),
                        None => state,
                    }
                }
                _ => state,
            }
        } else if state.name.as_ref() == STATE_MUSIC && !force {
            match media_state {
                Some(ref ms) if ms.status != MediaPlaybackStatus::Playing => {
                    // 获取 music_end 状态
                    match rm.get_state_by_name(STATE_MUSIC_END) {
                        Some(music_end_state) => music_end_state.clone(),
                        None => state,
                    }
                }
                _ => state,
            }
        } else {
            state
        };

        // 如果状态被修改为 music_start 或 music_end，强制执行切换
        let final_force = force
            || (original_state_name.as_ref() == STATE_IDLE && final_state.name.as_ref() == STATE_MUSIC_START)
            || (original_state_name.as_ref() == STATE_MUSIC && final_state.name.as_ref() == STATE_MUSIC_END);

        let is_persistent = final_state.persistent;
        let result = if is_persistent {
            self.set_persistent_state(final_state, final_force, rm)
        } else {
            self.set_current_state(final_state, final_force, rm)
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
            if !force {
                return Ok(false);
            }
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
        self.apply_mod_data_counter_async(&state);

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
        if state.persistent {
            return Err(format!(
                "State '{}' is a persistent state, use set_persistent_state",
                state.name
            ));
        }

        // 如果当前状态与目标状态相同，跳过
        if self.current_state.as_ref().map(|s| &s.name) == Some(&state.name) {
            if !force {
                return Ok(false);
            }
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
        self.apply_mod_data_counter_async(&state);
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
            Some(s) if !s.next_state.is_empty() => s.next_state.as_ref(),
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

    /// 生成 0 到 max-1 之间的真随机 u64（使用系统 CSPRNG）
    ///
    /// `max` 必须 > 0。
    #[inline]
    fn random_u64(max: u64) -> u64 {
        let mut buf = [0u8; 8];
        getrandom::getrandom(&mut buf).unwrap_or_else(|_| {
            // 回退到时间戳（极少发生）
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .subsec_nanos();
            buf = nanos.to_le_bytes().repeat(2).try_into().unwrap_or([0; 8]);
        });
        u64::from_le_bytes(buf) % max
    }

    /// 按权重从候选状态中选出一个状态
    ///
    /// 概率：\(P_i = w_i / \sum w\)
    pub(crate) fn pick_weighted_state(candidates: Vec<(StateInfo, u64)>) -> Option<StateInfo> {
        let mut items: Vec<(StateInfo, u64)> = candidates
            .into_iter()
            .filter(|(s, w)| *w > 0 && !s.name.as_ref().is_empty())
            .collect();

        if items.is_empty() {
            return None;
        }
        if items.len() == 1 {
            return Some(items.remove(0).0);
        }

        let total: u64 = items.iter().map(|(_, w)| *w).sum();
        if total == 0 {
            return None;
        }

        let pick = Self::random_u64(total);
        let mut acc: u64 = 0;
        for (s, w) in items.into_iter() {
            acc += w;
            if pick < acc {
                return Some(s);
            }
        }

        None
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

        // 启动线程前：同步一次当前状态对应的启停开关。
        // 否则会出现“启动阶段已进入 idle（持久状态）但 timer_enabled 尚未初始化”，
        // 导致后续一直处于禁用状态，无法按 trigger_time 定时触发子状态。
        let should_enable = match self.current_state.as_ref() {
            Some(s) => s.persistent,
            None => self.persistent_state.is_some(),
        };
        self.set_timer_enabled(should_enable);

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
                let (trigger_time, trigger_rate, state_candidates) = {
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
                if trigger_rate <= 0.0 || state_candidates.is_empty() {
                    continue;
                }

                let random_value = Self::random_float();
                if random_value > trigger_rate {
                    continue;
                }

                // 执行触发（分步获取锁，减少死锁风险）
                // 关键：保持锁顺序一致性：ResourceManager → StateManager
                // 这与 trigger_login_events、get_force_change_handler 等处的锁顺序一致
                
                // 第一步：获取 ResourceManager 锁
                // - 筛选可用状态的名称和权重（避免克隆完整的 StateInfo 列表）
                let rm = app_state.resource_manager.lock().unwrap();
                
                let candidate_names: Vec<(&str, u64)> = state_candidates
                    .iter()
                    .filter_map(|c| {
                        if c.weight == 0 {
                            return None;
                        }
                        // 检查状态是否存在且当前可用
                        rm.get_state_by_name(c.state.as_ref())
                            .and_then(|s| {
                                if s.is_enable() {
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

                // 随机选择一个名称
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

                // 只克隆最终选中的那一个状态
                let Some(selected) = rm.get_state_by_name(name).cloned() else {
                    drop(rm);
                    continue;
                };

                // 第二步：获取 StateManager 锁（在持有 rm 的情况下）
                let mut sm = app_state.state_manager.lock().unwrap();
                let _ = sm.change_state(selected, &rm);
                
                // 显式释放锁
                drop(sm);
                drop(rm);
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

            // 发送状态切换事件
            let _ = emit(&app_handle, events::STATE_CHANGE, event);
        }
    }

    /// 进入状态时，按配置异步更新当前 Mod 的数据计数器，并立即落盘
    ///
    /// 设计目标：
    /// - 该方法不应阻塞状态切换主流程
    /// - 不应持有 ResourceManager 锁（避免锁顺序死锁）
    fn apply_mod_data_counter_async(&self, state: &StateInfo) {
        let Some(cfg) = state.mod_data_counter.clone() else {
            return;
        };

        // 过滤“无效操作”，避免频繁触发保存/广播：
        // - +0 / -0 / *1 / /1 这些不会改变值
        match cfg.op {
            ModDataCounterOp::Add | ModDataCounterOp::Sub if cfg.value == 0 => return,
            ModDataCounterOp::Mul | ModDataCounterOp::Div if cfg.value == 1 => return,
            _ => {}
        }

        let Some(app_handle) = self.app_handle.clone() else {
            return;
        };

        std::thread::spawn(move || {
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
                    "[StateManager] mod_data_counter 计算失败（可能溢出/除 0），已跳过：mod='{}' current={} op={:?} value={} ",
                    mod_id, current, cfg.op, cfg.value
                );
                return;
            };

            if next == current {
                return;
            }

            // 写入并立即落盘
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

            // 广播更新事件（供前端 HUD 同步）
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
            let _ = emit(&app_handle, events::MOD_DATA_CHANGED, data);
        });
    }
}

