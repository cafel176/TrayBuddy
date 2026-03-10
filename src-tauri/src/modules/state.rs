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
    STATE_SILENCE_START, STATE_DRAGGING, STATE_DRAG_END, STATE_DRAG_START,
};
use super::event_manager::{emit, events};
use super::media_observer::{get_cached_media_state, MediaPlaybackStatus};
use super::environment::{get_cached_weather, WeatherInfo};
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
    pub state: Arc<StateInfo>,
    /// true: 播放一次后回到持久状态, false: 循环播放
    pub play_once: bool,
}

/// 状态限制判断的预取上下文
///
/// 封装了判断状态触发限制所需的数据（mod_data_value、session_uptime 等）。
/// 设计目的：在获取 `resource_manager` / `state_manager` 锁**之前**先从 `storage` 读取数据，
/// 避免在持有 rm/sm 锁时再获取 storage 锁，从而消除 `rm → sm → storage` 的嵌套死锁风险。
///
/// # 锁序规范
///
/// 全项目的锁获取顺序必须为：
/// ```text
/// storage → resource_manager → state_manager
/// ```
/// 各全局静态 Mutex（CACHED_MEDIA_STATE、CACHED_WEATHER 等）互不嵌套，可独立获取。
pub struct StateLimitsContext {
    pub mod_data_value: i32,
    pub session_uptime_minutes: i32,
    pub current_weather: Option<WeatherInfo>,
}

impl StateLimitsContext {
    /// 创建不受限的默认上下文（所有限制条件都通过）
    ///
    /// 适用于测试或不需要限制判断的场景。
    pub fn default_unlimited() -> Self {
        Self {
            mod_data_value: 0,
            session_uptime_minutes: 0,
            current_weather: None,
        }
    }

    // prefetch() 已移至 state_runtime.rs（依赖 AppState）

    /// 获取当前温度
    #[inline]
    pub fn current_temp(&self) -> Option<f64> {
        self.current_weather.as_ref().map(|w| w.temperature)
    }

    /// 使用预取数据判断状态是否满足触发限制
    #[inline]
    pub fn is_allowed(&self, state: &StateInfo) -> bool {
        StateManager::is_state_allowed_by_limits_static(
            state,
            self.mod_data_value,
            self.session_uptime_minutes,
            self.current_temp(),
            self.current_weather.as_ref(),
        )
    }
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
    current_state: Option<Arc<StateInfo>>,
    /// 下一个待切换的状态（当前动画帧序列播放完毕后的衔接状态）
    next_state: Option<Arc<StateInfo>>,
    /// 当前记录的基准持久状态（作为临时状态结束后的回退目标）
    persistent_state: Option<Arc<StateInfo>>,
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

        if self.current_state.as_ref().map(|s| s.name.as_ref()) == Some(STATE_DRAGGING) ||
        self.current_state.as_ref().map(|s| s.name.as_ref()) == Some(STATE_DRAG_END) {
            if state.name.as_ref() == STATE_DRAG_START {
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
        self.persistent_state.as_deref()
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
        let state = Arc::new(state);
        self.persistent_state = Some(Arc::clone(&state));

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
            crate::get_state_unlock_notify().notify_waiters();
        }


        // 切换当前状态并通知前端
        self.current_state = Some(Arc::clone(&state));
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
        self.current_state.as_deref()
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
                // 没有动画/语音/文本的状态可以无视锁定
                let has_no_media = state.anima.is_empty() && state.text.is_empty();
                if !has_no_media {
                    #[cfg(debug_assertions)]
                    println!("[StateManager] 状态锁定中，禁止变更状态 '{}'", state.name);
                    return Ok(false);
                }
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
        let state = Arc::new(state);
        self.current_state = Some(Arc::clone(&state));
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
            self.next_state = Some(Arc::new(next_info.clone()));
        }
    }

    /// 获取下一个待切换状态的引用
    #[inline]
    pub fn get_next_state(&self) -> Option<&StateInfo> {
        self.next_state.as_deref()
    }

    /// 设置下一个待切换状态
    ///
    /// 当前状态播放完毕后会自动切换到此状态
    #[inline]
    pub fn set_next_state(&mut self, state: StateInfo) {
        self.next_state = Some(Arc::new(state));
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
        crate::get_state_unlock_notify().notify_waiters();

        // 优先切换到 next_state（使用 take 避免额外 clone）

        if let Some(next) = self.next_state.take() {
            // take 后为唯一持有者，try_unwrap 可避免 clone；失败时回退到 clone
            let next_state = Arc::try_unwrap(next).unwrap_or_else(|arc| (*arc).clone());
            let _ = self.change_state(next_state, rm);
            return;
        }

        // 否则回到持久状态（需要 clone，因为 persistent_state 需保留）
        if let Some(persistent) = self.persistent_state.as_ref().map(|a| (**a).clone()) {
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
    /// - `limits_ctx`: 预取的状态限制上下文（调用者必须在获取 rm/sm 锁之前构造）
    ///
    /// # 返回
    /// - `Ok(true)`: 成功触发
    /// - `Ok(false)`: 无可用状态或切换被跳过
    pub fn trigger_random_state(
        &mut self,
        states: &[StateInfo],
        rm: &ResourceManager,
        limits_ctx: &StateLimitsContext,
    ) -> Result<bool, String> {
        if states.is_empty() {
            return Ok(false);
        }

        // 使用预取的上下文进行限制判断，不再在持有 sm 锁时获取 storage 锁
        let enabled_states: Vec<&StateInfo> = states
            .iter()
            .filter(|s| s.is_enable() && limits_ctx.is_allowed(s))
            .collect();


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

    // start_timer_loop, set_app_handle, emit_state_change,
    // get_current_mod_data_value, get_session_uptime_minutes_now
    // -> state_runtime.rs



    /// 根据气温范围限制判断状态是否允许触发。
    #[inline]
    fn is_state_allowed_by_temp_range(state: &StateInfo, current_temp: Option<f64>) -> bool {

        // 默认不限制
        if state.trigger_temp_start == i32::MIN && state.trigger_temp_end == i32::MAX {
            return true;
        }

        // 有限制但没有拿到天气/温度 -> 不允许触发
        let Some(temp) = current_temp else {
            return false;
        };

        // 非法区间：起点 > 终点
        if state.trigger_temp_start > state.trigger_temp_end {
            return false;
        }

        let start = state.trigger_temp_start as f64;
        let end = state.trigger_temp_end as f64;
        temp >= start && temp <= end
    }

    /// 根据本次启动运行分钟数判断状态是否允许触发。
    #[inline]
    fn is_state_allowed_by_uptime_min(state: &StateInfo, session_uptime_minutes: i32) -> bool {

        // 0 或负数：不限制
        if state.trigger_uptime <= 0 {
            return true;
        }
        session_uptime_minutes >= state.trigger_uptime
    }

    /// 根据天气条件列表判断状态是否允许触发（支持天气码/条件文本）。
    #[inline]
    fn is_state_allowed_by_weather_any(state: &StateInfo, current_weather: Option<&WeatherInfo>) -> bool {


        let mut has_rule = false;

        for want_raw in state.trigger_weather.iter() {
            let want_raw = want_raw.as_ref().trim();
            if want_raw.is_empty() {
                continue;
            }

            has_rule = true;

            // 有限制但没有拿到天气 -> 不允许触发
            let Some(weather) = current_weather else {
                return false;
            };

            // 若填纯数字，则视为 weatherCode
            if want_raw.chars().all(|c| c.is_ascii_digit()) {
                if weather.condition_code.as_ref() == want_raw {
                    return true;
                }
                continue;
            }

            // 否则按 condition 文本精确匹配（忽略首尾空白、忽略大小写）
            let want = want_raw.to_lowercase();
            let got = weather.condition.as_ref().trim().to_lowercase();
            if got == want {
                return true;
            }
        }

        // 数组为空（或全为空白）时，不限制
        if !has_rule {
            return true;
        }

        false
    }


    /// 静态限制聚合判断：计数器范围 + 启动时长 + 气温 + 天气。
    ///
    /// 此方法不访问任何锁，所有数据通过参数传入，适合在已持有其他锁的上下文中调用。
    #[inline]
    pub(crate) fn is_state_allowed_by_limits_static(

        state: &StateInfo,
        mod_data_value: i32,
        session_uptime_minutes: i32,
        current_temp: Option<f64>,
        current_weather: Option<&WeatherInfo>,
    ) -> bool {
        (mod_data_value >= state.trigger_counter_start
            && mod_data_value <= state.trigger_counter_end)
            && Self::is_state_allowed_by_uptime_min(state, session_uptime_minutes)
            && Self::is_state_allowed_by_temp_range(state, current_temp)
            && Self::is_state_allowed_by_weather_any(state, current_weather)
    }



    // is_state_allowed_by_limits() 已移至 state_runtime.rs（依赖 AppHandle）


    // apply_mod_data_counter_async -> state_runtime.rs
}

// 运行时方法（依赖 AppHandle，不可单元测试）拆分到独立文件以便排除覆盖率统计
include!("state_runtime.rs");

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::environment::WeatherInfo;

    fn weather(code: &str, condition: &str) -> WeatherInfo {
        WeatherInfo {
            condition: condition.into(),
            condition_code: code.into(),
            temperature: 20.0,
            feels_like: None,
            humidity: None,
            wind_speed: None,
        }
    }

    #[test]
    fn temp_range_allows_when_unrestricted_or_in_range() {
        let mut state = StateInfo::default();
        assert!(StateManager::is_state_allowed_by_temp_range(&state, None));

        state.trigger_temp_start = 0;
        state.trigger_temp_end = 10;
        assert!(StateManager::is_state_allowed_by_temp_range(&state, Some(5.0)));
        assert!(!StateManager::is_state_allowed_by_temp_range(&state, Some(15.0)));
        assert!(!StateManager::is_state_allowed_by_temp_range(&state, None));
    }

    #[test]
    fn uptime_minimum_is_enforced() {
        let mut state = StateInfo::default();
        state.trigger_uptime = 10;
        assert!(!StateManager::is_state_allowed_by_uptime_min(&state, 5));
        assert!(StateManager::is_state_allowed_by_uptime_min(&state, 10));
    }

    #[test]
    fn weather_matching_supports_code_and_text() {
        let mut state = StateInfo::default();
        assert!(StateManager::is_state_allowed_by_weather_any(&state, None));

        state.trigger_weather = vec!["100".into(), "多云".into()];
        assert!(StateManager::is_state_allowed_by_weather_any(&state, Some(&weather("100", "晴"))));
        assert!(StateManager::is_state_allowed_by_weather_any(&state, Some(&weather("101", "多云"))));
        assert!(!StateManager::is_state_allowed_by_weather_any(&state, Some(&weather("101", "小雨"))));
        assert!(!StateManager::is_state_allowed_by_weather_any(&state, None));
    }

    #[test]
    fn limits_static_combines_all_checks() {
        let mut state = StateInfo::default();
        state.trigger_counter_start = 1;
        state.trigger_counter_end = 2;
        state.trigger_uptime = 5;
        state.trigger_temp_start = 0;
        state.trigger_temp_end = 30;
        state.trigger_weather = vec!["100".into()];

        let ok = StateManager::is_state_allowed_by_limits_static(
            &state,
            2,
            10,
            Some(25.0),
            Some(&weather("100", "晴")),
        );
        assert!(ok);

        let bad_counter = StateManager::is_state_allowed_by_limits_static(
            &state,
            3,
            10,
            Some(25.0),
            Some(&weather("100", "晴")),
        );
        assert!(!bad_counter);
    }

    // ================================================================
    // StateManager 基本操作测试
    // ================================================================

    #[test]
    fn new_state_manager_is_empty() {
        let sm = StateManager::new();
        assert!(sm.get_current_state().is_none());
        assert!(sm.get_persistent_state().is_none());
        assert!(sm.get_next_state().is_none());
        assert!(!sm.is_locked());
    }

    #[test]
    fn set_next_state_and_clear() {
        let mut sm = StateManager::new();
        let mut s = StateInfo::default();
        s.name = "wait".into();
        sm.set_next_state(s);
        assert!(sm.get_next_state().is_some());
        assert_eq!(sm.get_next_state().unwrap().name.as_ref(), "wait");

        sm.clear_next_state();
        assert!(sm.get_next_state().is_none());
    }

    // ================================================================
    // StateLimitsContext 测试
    // ================================================================

    #[test]
    fn state_limits_context_default_unlimited() {
        let ctx = StateLimitsContext::default_unlimited();
        assert_eq!(ctx.mod_data_value, 0);
        assert_eq!(ctx.session_uptime_minutes, 0);
        assert!(ctx.current_weather.is_none());
        assert!(ctx.current_temp().is_none());
    }

    #[test]
    fn state_limits_context_is_allowed_no_restrictions() {
        let ctx = StateLimitsContext::default_unlimited();
        let s = StateInfo::default();
        assert!(ctx.is_allowed(&s));
    }

    #[test]
    fn state_limits_context_current_temp() {
        let ctx = StateLimitsContext {
            mod_data_value: 0,
            session_uptime_minutes: 0,
            current_weather: Some(weather("100", "晴")),
        };
        assert_eq!(ctx.current_temp(), Some(20.0));
    }

    // ================================================================
    // set_persistent_state 测试
    // ================================================================

    #[test]
    fn set_persistent_state_rejects_non_persistent() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);
        let mut s = StateInfo::default();
        s.name = "temp".into();
        s.persistent = false;
        let result = sm.set_persistent_state(s, false, &rm);
        assert!(result.is_err());
    }

    #[test]
    fn set_persistent_state_succeeds() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);
        let mut s = StateInfo::default();
        s.name = "idle".into();
        s.persistent = true;
        let result = sm.set_persistent_state(s, true, &rm);
        assert!(result.unwrap());
        assert_eq!(sm.get_persistent_state().unwrap().name.as_ref(), "idle");
        assert_eq!(sm.get_current_state().unwrap().name.as_ref(), "idle");
    }

    #[test]
    fn set_persistent_state_skips_same_state() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);
        let mut s = StateInfo::default();
        s.name = "idle".into();
        s.persistent = true;
        sm.set_persistent_state(s.clone(), true, &rm).unwrap();

        // same state, non-force -> skip
        let result = sm.set_persistent_state(s, false, &rm);
        assert!(!result.unwrap());
    }

    #[test]
    fn set_persistent_state_respects_priority() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);

        let mut s1 = StateInfo::default();
        s1.name = "high".into();
        s1.persistent = true;
        s1.priority = 10;
        sm.set_persistent_state(s1, true, &rm).unwrap();

        let mut s2 = StateInfo::default();
        s2.name = "low".into();
        s2.persistent = true;
        s2.priority = 1;
        let result = sm.set_persistent_state(s2, false, &rm);
        assert!(!result.unwrap());
        assert_eq!(sm.get_persistent_state().unwrap().name.as_ref(), "high");
    }

    #[test]
    fn set_persistent_state_when_locked_only_updates_data() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);

        // set initial persistent
        let mut idle = StateInfo::default();
        idle.name = "idle".into();
        idle.persistent = true;
        sm.set_persistent_state(idle, true, &rm).unwrap();

        // lock by setting a temp state
        let mut tmp = StateInfo::default();
        tmp.name = "click".into();
        tmp.persistent = false;
        sm.set_current_state(tmp, true, &rm).unwrap();
        assert!(sm.is_locked());

        // set new persistent while locked
        let mut idle2 = StateInfo::default();
        idle2.name = "music".into();
        idle2.persistent = true;
        let result = sm.set_persistent_state(idle2, false, &rm);
        // should return false (not switched current) but persistent data updated
        assert!(!result.unwrap());
        assert_eq!(sm.get_persistent_state().unwrap().name.as_ref(), "music");
        // current should still be the temp state
        assert_eq!(sm.get_current_state().unwrap().name.as_ref(), "click");
    }

    // ================================================================
    // set_current_state 测试
    // ================================================================

    #[test]
    fn set_current_state_rejects_persistent() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);
        let mut s = StateInfo::default();
        s.name = "idle".into();
        s.persistent = true;
        let result = sm.set_current_state(s, false, &rm);
        assert!(result.is_err());
    }

    #[test]
    fn set_current_state_succeeds_and_locks() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);
        let mut s = StateInfo::default();
        s.name = "click".into();
        s.persistent = false;
        let result = sm.set_current_state(s, true, &rm);
        assert!(result.unwrap());
        assert_eq!(sm.get_current_state().unwrap().name.as_ref(), "click");
        assert!(sm.is_locked());
    }

    #[test]
    fn set_current_state_skips_when_locked() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);

        let mut s1 = StateInfo::default();
        s1.name = "first".into();
        s1.persistent = false;
        sm.set_current_state(s1, true, &rm).unwrap();
        assert!(sm.is_locked());

        let mut s2 = StateInfo::default();
        s2.name = "second".into();
        s2.persistent = false;
        s2.anima = "some_anim".into(); // has media, so lock should block it
        let result = sm.set_current_state(s2, false, &rm);
        assert!(!result.unwrap());
    }

    #[test]
    fn set_current_state_force_overrides_lock() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);

        let mut s1 = StateInfo::default();
        s1.name = "first".into();
        s1.persistent = false;
        sm.set_current_state(s1, true, &rm).unwrap();

        let mut s2 = StateInfo::default();
        s2.name = "forced".into();
        s2.persistent = false;
        let result = sm.set_current_state(s2, true, &rm);
        assert!(result.unwrap());
        assert_eq!(sm.get_current_state().unwrap().name.as_ref(), "forced");
    }

    #[test]
    fn set_current_state_respects_priority() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);

        let mut s1 = StateInfo::default();
        s1.name = "high".into();
        s1.persistent = false;
        s1.priority = 10;
        sm.set_current_state(s1, true, &rm).unwrap();

        // unlock to test priority (lock would block first)
        sm.locked = false;

        let mut s2 = StateInfo::default();
        s2.name = "low".into();
        s2.persistent = false;
        s2.priority = 1;
        let result = sm.set_current_state(s2, false, &rm);
        assert!(!result.unwrap());
    }

    #[test]
    fn set_current_state_skips_same_non_force() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);

        let mut s = StateInfo::default();
        s.name = "anim".into();
        s.persistent = false;
        sm.set_current_state(s.clone(), true, &rm).unwrap();

        sm.locked = false;
        let result = sm.set_current_state(s, false, &rm);
        assert!(!result.unwrap());
    }

    // ================================================================
    // prepare_next_state 测试
    // ================================================================

    #[test]
    fn prepare_next_state_sets_from_current() {
        let mut sm = StateManager::new();
        let dir = std::env::temp_dir().join("tbuddy_test_prepare_next");
        let _ = std::fs::remove_dir_all(&dir);
        let mod_dir = dir.join("pnmod");
        std::fs::create_dir_all(mod_dir.join("asset")).unwrap();
        std::fs::write(
            mod_dir.join("manifest.json"),
            r#"{"id":"pnmod","version":"1","mod_type":"sequence","important_states":{},"states":[{"name":"a","persistent":false,"next_state":"b","can_trigger_states":[]},{"name":"b","persistent":false,"can_trigger_states":[]}],"triggers":[]}"#,
        ).unwrap();

        let mut rm = ResourceManager::new_with_search_paths(vec![dir.clone()]);
        let _ = rm.load_mod("pnmod");

        // Manually set current with next_state
        let mut s = StateInfo::default();
        s.name = "a".into();
        s.next_state = "b".into();
        sm.current_state = Some(Arc::new(s));

        sm.prepare_next_state(&rm);
        assert!(sm.get_next_state().is_some());
        assert_eq!(sm.get_next_state().unwrap().name.as_ref(), "b");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn prepare_next_state_noop_when_no_next() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);

        let s = StateInfo::default();
        sm.current_state = Some(Arc::new(s));
        sm.prepare_next_state(&rm);
        assert!(sm.get_next_state().is_none());
    }

    // ================================================================
    // on_state_complete 测试
    // ================================================================

    #[test]
    fn on_state_complete_unlocks_and_goes_to_next() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);

        // Set initial persistent state
        let mut idle = StateInfo::default();
        idle.name = "idle".into();
        idle.persistent = true;
        sm.set_persistent_state(idle, true, &rm).unwrap();

        // Set a temp state and lock
        let mut tmp = StateInfo::default();
        tmp.name = "click".into();
        tmp.persistent = false;
        sm.set_current_state(tmp, true, &rm).unwrap();
        assert!(sm.is_locked());

        // Set next state as persistent so on_state_complete won't re-lock
        let mut next = StateInfo::default();
        next.name = "react_idle".into();
        next.persistent = true;
        sm.set_next_state(next);

        sm.on_state_complete(&rm);
        // on_state_complete unlocks, then change_state routes persistent -> no re-lock
        assert!(!sm.is_locked());
        assert_eq!(sm.get_current_state().unwrap().name.as_ref(), "react_idle");
    }

    #[test]
    fn on_state_complete_returns_to_persistent() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);

        let mut idle = StateInfo::default();
        idle.name = "idle".into();
        idle.persistent = true;
        sm.set_persistent_state(idle, true, &rm).unwrap();

        let mut tmp = StateInfo::default();
        tmp.name = "click".into();
        tmp.persistent = false;
        sm.set_current_state(tmp, true, &rm).unwrap();

        // No next state set
        sm.on_state_complete(&rm);
        assert!(!sm.is_locked());
        // Should return to persistent "idle"
        assert_eq!(sm.get_current_state().unwrap().name.as_ref(), "idle");
    }

    // ================================================================
    // change_state / change_state_ex 测试
    // ================================================================

    #[test]
    fn change_state_auto_routes_persistent() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);

        let mut s = StateInfo::default();
        s.name = "idle".into();
        s.persistent = true;
        let result = sm.change_state(s, &rm);
        assert!(result.unwrap());
        assert_eq!(sm.get_persistent_state().unwrap().name.as_ref(), "idle");
    }

    #[test]
    fn change_state_auto_routes_temporary() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);

        let mut s = StateInfo::default();
        s.name = "click".into();
        s.persistent = false;
        let result = sm.change_state(s, &rm);
        assert!(result.unwrap());
        assert_eq!(sm.get_current_state().unwrap().name.as_ref(), "click");
        assert!(sm.is_locked());
    }

    #[test]
    fn change_state_ex_force() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);

        let mut s1 = StateInfo::default();
        s1.name = "high".into();
        s1.persistent = false;
        s1.priority = 99;
        sm.change_state(s1, &rm).unwrap();

        let mut s2 = StateInfo::default();
        s2.name = "low".into();
        s2.persistent = false;
        s2.priority = 0;
        // force=true should override
        let result = sm.change_state_ex(s2, true, &rm);
        assert!(result.unwrap());
        assert_eq!(sm.get_current_state().unwrap().name.as_ref(), "low");
    }

    #[test]
    fn change_state_blocks_transition_start_during_active_or_ending() {
        // Tests that *_start transitions are blocked during matching *_active or *_end states
        let pairs: &[(&str, &str)] = &[
            // (persistent/current state, blocked transition)
            (STATE_MUSIC, STATE_MUSIC_START),
            (STATE_SILENCE, STATE_SILENCE_START),
            (STATE_DRAGGING, STATE_DRAG_START),
        ];
        for &(active_name, start_name) in pairs {
            let mut sm = StateManager::new();
            let rm = ResourceManager::new_with_search_paths(vec![]);

            let mut active = StateInfo::default();
            active.name = active_name.into();
            active.persistent = true;
            sm.set_persistent_state(active, true, &rm).unwrap();

            let mut start = StateInfo::default();
            start.name = start_name.into();
            start.persistent = false;
            let result = sm.change_state(start, &rm);
            assert!(!result.unwrap(), "should block {} during {}", start_name, active_name);
        }

        // Also test blocking during *_end states
        let end_pairs: &[(&str, &str)] = &[
            (STATE_MUSIC_END, STATE_MUSIC_START),
            (STATE_SILENCE_END, STATE_SILENCE_START),
            (STATE_DRAG_END, STATE_DRAG_START),
        ];
        for &(end_name, start_name) in end_pairs {
            let mut sm = StateManager::new();
            let rm = ResourceManager::new_with_search_paths(vec![]);

            let mut end_state = StateInfo::default();
            end_state.name = end_name.into();
            end_state.persistent = false;
            sm.set_current_state(end_state, true, &rm).unwrap();

            let mut start = StateInfo::default();
            start.name = start_name.into();
            start.persistent = false;
            sm.locked = false; // unlock to test the guard
            let result = sm.change_state(start, &rm);
            assert!(!result.unwrap(), "should block {} during {}", start_name, end_name);
        }
    }

    // ================================================================
    // set_timer_enabled 测试
    // ================================================================

    #[test]
    fn set_timer_enabled_with_no_timer() {
        let sm = StateManager::new();
        // should not panic
        sm.set_timer_enabled(true);
        sm.set_timer_enabled(false);
    }

    #[test]
    fn set_timer_enabled_with_timer() {
        let mut sm = StateManager::new();
        let flag = Arc::new(AtomicBool::new(false));
        sm.timer_enabled = Some(flag.clone());

        sm.set_timer_enabled(true);
        assert!(flag.load(Ordering::Relaxed));

        sm.set_timer_enabled(false);
        assert!(!flag.load(Ordering::Relaxed));
    }

    // ================================================================
    // 温度范围测试（补充）
    // ================================================================

    #[test]
    fn temp_range_invalid_interval() {
        let mut state = StateInfo::default();
        state.trigger_temp_start = 30;
        state.trigger_temp_end = 10; // start > end
        assert!(!StateManager::is_state_allowed_by_temp_range(&state, Some(20.0)));
    }

    #[test]
    fn temp_range_boundary_values() {
        let mut state = StateInfo::default();
        state.trigger_temp_start = 10;
        state.trigger_temp_end = 20;
        assert!(StateManager::is_state_allowed_by_temp_range(&state, Some(10.0)));
        assert!(StateManager::is_state_allowed_by_temp_range(&state, Some(20.0)));
        assert!(!StateManager::is_state_allowed_by_temp_range(&state, Some(9.99)));
        assert!(!StateManager::is_state_allowed_by_temp_range(&state, Some(20.01)));
    }

    // ================================================================
    // uptime 测试（补充）
    // ================================================================

    #[test]
    fn uptime_zero_means_no_restriction() {
        let mut state = StateInfo::default();
        state.trigger_uptime = 0;
        assert!(StateManager::is_state_allowed_by_uptime_min(&state, 0));
        assert!(StateManager::is_state_allowed_by_uptime_min(&state, 100));
    }

    #[test]
    fn uptime_negative_means_no_restriction() {
        let mut state = StateInfo::default();
        state.trigger_uptime = -5;
        assert!(StateManager::is_state_allowed_by_uptime_min(&state, 0));
    }

    // ================================================================
    // 天气测试（补充）
    // ================================================================

    // (weather_empty_array_allows_any → covered by weather_matching_supports_code_and_text)

    #[test]
    fn weather_whitespace_only_items_ignored() {
        let mut state = StateInfo::default();
        state.trigger_weather = vec!["  ".into(), "".into()];
        assert!(StateManager::is_state_allowed_by_weather_any(&state, None));
    }

    // (weather_code_match_returns_true → covered by weather_matching_supports_code_and_text)

    #[test]
    fn weather_text_case_insensitive() {
        let mut state = StateInfo::default();
        state.trigger_weather = vec!["sunny".into()];
        let w = WeatherInfo {
            condition: "Sunny".into(),
            condition_code: "100".into(),
            temperature: 25.0,
            feels_like: None,
            humidity: None,
            wind_speed: None,
        };
        assert!(StateManager::is_state_allowed_by_weather_any(&state, Some(&w)));
    }

    // ================================================================
    // is_state_allowed_by_limits_static 组合测试
    // ================================================================

    #[test]
    fn limits_static_counter_range() {
        let mut state = StateInfo::default();
        state.trigger_counter_start = 5;
        state.trigger_counter_end = 10;

        assert!(StateManager::is_state_allowed_by_limits_static(&state, 5, 0, None, None));
        assert!(StateManager::is_state_allowed_by_limits_static(&state, 10, 0, None, None));
        assert!(!StateManager::is_state_allowed_by_limits_static(&state, 4, 0, None, None));
        assert!(!StateManager::is_state_allowed_by_limits_static(&state, 11, 0, None, None));
    }

    // (limits_static_all_default_passes → covered by state_limits_context_is_allowed_no_restrictions)

    #[test]
    fn limits_static_fails_on_any_check() {
        let mut state = StateInfo::default();
        state.trigger_uptime = 100;
        // uptime too low
        assert!(!StateManager::is_state_allowed_by_limits_static(&state, 0, 50, None, None));
        // uptime ok
        assert!(StateManager::is_state_allowed_by_limits_static(&state, 0, 100, None, None));
    }

    // ================================================================
    // trigger_random_state 测试
    // ================================================================

    #[test]
    fn trigger_random_state_empty_list() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);
        let ctx = StateLimitsContext::default_unlimited();
        let result = sm.trigger_random_state(&[], &rm, &ctx);
        assert!(!result.unwrap());
    }

    #[test]
    fn trigger_random_state_single_candidate() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);
        let ctx = StateLimitsContext::default_unlimited();

        let mut s = StateInfo::default();
        s.name = "react".into();
        s.persistent = false;
        let result = sm.trigger_random_state(&[s], &rm, &ctx);
        assert!(result.unwrap());
        assert_eq!(sm.get_current_state().unwrap().name.as_ref(), "react");
    }

    #[test]
    fn trigger_random_state_filters_by_limits() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);
        let ctx = StateLimitsContext {
            mod_data_value: 100,
            session_uptime_minutes: 0,
            current_weather: None,
        };

        let mut s = StateInfo::default();
        s.name = "limited".into();
        s.persistent = false;
        s.trigger_counter_start = 0;
        s.trigger_counter_end = 10;
        // mod_data_value=100 is outside [0,10]

        let result = sm.trigger_random_state(&[s], &rm, &ctx);
        assert!(!result.unwrap());
    }

    #[test]
    fn trigger_random_state_multiple_candidates() {
        let rm = ResourceManager::new_with_search_paths(vec![]);
        let ctx = StateLimitsContext::default_unlimited();

        let mut s1 = StateInfo::default();
        s1.name = "a".into();
        s1.persistent = false;
        let mut s2 = StateInfo::default();
        s2.name = "b".into();
        s2.persistent = false;
        let mut s3 = StateInfo::default();
        s3.name = "c".into();
        s3.persistent = false;

        // Run multiple times to exercise the random_index branch (len > 1)
        for _ in 0..10 {
            let mut sm = StateManager::new();
            let result = sm.trigger_random_state(&[s1.clone(), s2.clone(), s3.clone()], &rm, &ctx);
            assert!(result.unwrap());
            let name = sm.get_current_state().unwrap().name.to_string();
            assert!(name == "a" || name == "b" || name == "c");
        }
    }

    // ================================================================
    // pick_weighted_state 测试
    // ================================================================

    #[test]
    fn pick_weighted_state_empty() {
        let result = StateManager::pick_weighted_state(vec![]);
        assert!(result.is_none());
    }

    #[test]
    fn pick_weighted_state_single() {
        let mut s = StateInfo::default();
        s.name = "only".into();
        let result = StateManager::pick_weighted_state(vec![(s, 5)]);
        assert_eq!(result.unwrap().name.as_ref(), "only");
    }

    #[test]
    fn pick_weighted_state_filters_zero_weight() {
        let mut s1 = StateInfo::default();
        s1.name = "zero".into();
        let mut s2 = StateInfo::default();
        s2.name = "ok".into();
        let result = StateManager::pick_weighted_state(vec![(s1, 0), (s2, 1)]);
        assert_eq!(result.unwrap().name.as_ref(), "ok");
    }

    #[test]
    fn pick_weighted_state_filters_empty_name() {
        let mut s = StateInfo::default();
        s.name = "".into();
        let result = StateManager::pick_weighted_state(vec![(s, 5)]);
        assert!(result.is_none());
    }

    #[test]
    fn pick_weighted_state_multiple_returns_one() {
        let mut s1 = StateInfo::default();
        s1.name = "a".into();
        let mut s2 = StateInfo::default();
        s2.name = "b".into();
        // run multiple times to ensure no panic
        for _ in 0..20 {
            let candidates = vec![(s1.clone(), 1), (s2.clone(), 1)];
            let result = StateManager::pick_weighted_state(candidates);
            assert!(result.is_some());
            let name = result.unwrap().name.to_string();
            assert!(name == "a" || name == "b");
        }
    }

    // ================================================================
    // random_index / random_u64 / random_float 测试
    // ================================================================

    #[test]
    fn random_index_within_range() {
        for _ in 0..100 {
            let idx = StateManager::random_index(10);
            assert!(idx < 10);
        }
    }

    #[test]
    fn random_u64_within_range() {
        for _ in 0..100 {
            let val = StateManager::random_u64(1000);
            assert!(val < 1000);
        }
    }

    #[test]
    fn random_float_in_unit_range() {
        for _ in 0..100 {
            let val = StateManager::random_float();
            assert!(val >= 0.0 && val < 1.0);
        }
    }

    // ================================================================
    // StateChangeEvent 结构体测试
    // ================================================================

    #[test]
    fn state_change_event_serializes() {
        let mut s = StateInfo::default();
        s.name = "idle".into();
        let event = StateChangeEvent {
            state: Arc::new(s),
            play_once: true,
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("idle"));
        assert!(json.contains("play_once"));
    }

    // (blocks_*_start_during_*_end tests merged into change_state_blocks_transition_start_during_active_or_ending above)

    // ================================================================
    // change_state_internal 成功切换后 timer_enabled 更新
    // ================================================================

    #[test]
    fn change_state_updates_timer_on_success() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);
        let flag = Arc::new(AtomicBool::new(false));
        sm.timer_enabled = Some(flag.clone());

        // persistent -> timer enabled
        let mut idle = StateInfo::default();
        idle.name = "idle".into();
        idle.persistent = true;
        sm.change_state(idle, &rm).unwrap();
        assert!(flag.load(Ordering::Relaxed));

        // temp -> timer disabled
        let mut click = StateInfo::default();
        click.name = "click".into();
        click.persistent = false;
        sm.change_state_ex(click, true, &rm).unwrap();
        assert!(!flag.load(Ordering::Relaxed));
    }

    // ================================================================
    // change_state_internal: music/silence/drag 外层 if 通过分支
    // ================================================================

    #[test]
    fn change_state_allows_non_matching_start_during_special_states() {
        // Non-matching transitions should pass through the music/silence/drag guards
        let cases: &[(&str, &str)] = &[
            (STATE_MUSIC, "click"),
            (STATE_SILENCE, "click"),
            (STATE_DRAGGING, "click"),
        ];
        for &(persistent_name, target_name) in cases {
            let mut sm = StateManager::new();
            let rm = ResourceManager::new_with_search_paths(vec![]);

            let mut active = StateInfo::default();
            active.name = persistent_name.into();
            active.persistent = true;
            sm.set_persistent_state(active, true, &rm).unwrap();

            let mut target = StateInfo::default();
            target.name = target_name.into();
            target.persistent = false;
            let result = sm.change_state(target, &rm);
            assert!(result.unwrap(), "should allow {} during {}", target_name, persistent_name);
        }
    }

    // ================================================================
    // set_persistent_state / set_current_state: 同状态 + force=true
    // ================================================================

    #[test]
    fn set_persistent_state_same_state_force_succeeds() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);

        let mut s = StateInfo::default();
        s.name = "idle".into();
        s.persistent = true;
        sm.set_persistent_state(s.clone(), true, &rm).unwrap();

        // same state, force=true → should NOT skip, should succeed
        let result = sm.set_persistent_state(s, true, &rm);
        assert!(result.unwrap());
        assert_eq!(sm.get_persistent_state().unwrap().name.as_ref(), "idle");
    }

    #[test]
    fn set_current_state_same_state_force_succeeds() {
        let mut sm = StateManager::new();
        let rm = ResourceManager::new_with_search_paths(vec![]);

        let mut s = StateInfo::default();
        s.name = "click".into();
        s.persistent = false;
        sm.set_current_state(s.clone(), true, &rm).unwrap();

        // same state, force=true → should NOT skip
        let result = sm.set_current_state(s, true, &rm);
        assert!(result.unwrap());
        assert_eq!(sm.get_current_state().unwrap().name.as_ref(), "click");
    }
}



