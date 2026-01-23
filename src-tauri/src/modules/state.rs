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
//! # 性能优化
//! - 使用 `Relaxed` 内存序减少原子操作开销
//! - 定时器线程使用更高效的状态检查
//! - 减少不必要的状态克隆

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use super::resource::{StateInfo, ResourceManager};

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
    /// 资源管理器引用
    resource_manager: Arc<Mutex<ResourceManager>>,
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
    pub fn new(resource_manager: Arc<Mutex<ResourceManager>>) -> Self {
        Self {
            resource_manager,
            current_state: None,
            next_state: None,
            persistent_state: None,
            app_handle: None,
            locked: false,
            timer_enabled: None,
        }
    }

    // ========================================================================= //
    // 基础状态管理
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
    #[inline]
    pub fn change_state(&mut self, state: StateInfo) -> Result<bool, String> {
        self.change_state_ex(state, false)
    }

    /// 智能切换状态（扩展版本）
    /// 
    /// # 参数
    /// - `state`: 目标状态
    /// - `force`: 是否忽略优先级和锁定检查强制切换
    pub fn change_state_ex(&mut self, state: StateInfo, force: bool) -> Result<bool, String> {
        let is_persistent = state.persistent;
        let result = if is_persistent {
            self.set_persistent_state(state, force)
        } else {
            self.set_current_state(state, force)
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
    pub fn set_persistent_state(&mut self, state: StateInfo, force: bool) -> Result<bool, String> {
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
                println!("[StateManager] 状态优先级不够，禁止变更状态 '{}'", state.name);
                return Ok(false);
            }
        }

        // 更新持久状态
        self.persistent_state = Some(state.clone());

        // 被锁定时只更新数据，不切换当前状态
        if self.locked && !force {
            println!("[StateManager] 状态锁定中，仅更新持久状态为 '{}'", state.name);
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

        Ok(true)
    }

    // ========================================================================= //
    // 当前状态管理
    // ========================================================================= //

    /// 获取当前状态的引用
    #[inline]
    pub fn get_current_state(&self) -> Option<&StateInfo> {
        self.current_state.as_ref()
    }

    /// 设置临时状态
    /// 
    /// 临时状态播放完毕后会自动回到持久状态。
    /// 
    /// # 参数
    /// - `state`: 目标临时状态
    /// - `force`: 是否强制切换（忽略优先级和锁定）
    pub fn set_current_state(&mut self, state: StateInfo, force: bool) -> Result<bool, String> {
        if state.persistent {
            return Err(format!("State '{}' is a persistent state, use set_persistent_state", state.name));
        }

        // 非强制模式下的检查
        if !force {
            if self.locked {
                println!("[StateManager] 状态锁定中，禁止变更状态 '{}'", state.name);
                return Ok(false);
            }

            let current_priority = self.current_state.as_ref().map_or(0, |s| s.priority);
            if state.priority < current_priority {
                println!("[StateManager] 状态优先级不够，禁止变更状态 '{}'", state.name);
                return Ok(false);
            }
        }

        // 切换到临时状态并锁定
        self.current_state = Some(state.clone());
        self.emit_state_change(&state, true);
        self.locked = true;

        // 预设下一个状态
        self.clear_next_state();
        self.prepare_next_state();

        Ok(true)
    }

    // ========================================================================= //
    // 下一状态管理
    // ========================================================================= //

    /// 根据当前状态的 next_state 字段预设下一个状态
    /// 
    /// 从 ResourceManager 获取状态信息并设置为下一个待切换状态
    fn prepare_next_state(&mut self) {
        // 检查当前状态是否定义了 next_state（避免不必要的 clone）
        let next_state_name = match &self.current_state {
            Some(s) if !s.next_state.is_empty() => s.next_state.as_str(),
            _ => return,
        };
        
        // 从 ResourceManager 获取状态信息
        let rm = self.resource_manager.lock().unwrap();
        if let Some(next_info) = rm.get_state_by_name(next_state_name) {
            println!("[StateManager] 预设 next_state: '{}'", next_info.name);
            self.next_state = Some(next_info.clone());
        } else {
            println!("[StateManager] 警告: 找不到 next_state '{}'", next_state_name);
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
    pub fn on_state_complete(&mut self) {
        self.locked = false;
        
        // 优先切换到 next_state（使用 take 避免额外 clone）
        if let Some(next) = self.next_state.take() {
            let _ = self.change_state(next);
            return;
        }
        
        // 否则回到持久状态（需要 clone 因为持久状态需保留）
        if let Some(persistent) = self.persistent_state.clone() {
            let _ = self.change_state(persistent);
        }
    }
  
    // ========================================================================= //
    // 随机状态触发
    // ========================================================================= //

    /// 从状态列表中随机选择一个可用状态并切换
    /// 
    /// 流程：
    /// 1. 筛选出所有通过 `is_enable()` 检查的状态
    /// 2. 随机选择一个
    /// 3. 执行切换
    /// 
    /// # 性能说明
    /// - 使用引用收集避免提前克隆
    /// - 仅在确定要切换时才克隆选中的状态
    pub fn trigger_random_state(&mut self, states: &[StateInfo]) -> Result<bool, String> {
        if states.is_empty() {
            return Ok(false);
        }

        // 筛选可用状态（使用引用避免克隆）
        let enabled_states: Vec<&StateInfo> = states.iter()
            .filter(|s| s.is_enable())
            .collect();

        if enabled_states.is_empty() {
            println!("[StateManager] 没有可用的状态");
            return Ok(false);
        }

        // 随机选择（只在需要切换时才克隆）
        let idx = if enabled_states.len() == 1 { 0 } else { Self::random_index(enabled_states.len()) };
        let selected = enabled_states[idx].clone();

        println!("[StateManager] 随机选择状态: '{}'", selected.name);
        self.change_state(selected)
    }

    /// 基于时间戳的简单随机索引生成
    #[inline]
    fn random_index(max: usize) -> usize {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .subsec_nanos() as usize % max
    }

    /// 生成 0.0 到 1.0 之间的随机数
    #[inline]
    fn random_float() -> f32 {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .subsec_nanos();
        (nanos % 10000) as f32 / 10000.0
    }

    // ========================================================================= //
    // 定时触发功能
    // ========================================================================= //

    /// 设置定时触发开关
    fn set_timer_enabled(&self, enabled: bool) {
        if let Some(ref timer) = self.timer_enabled {
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
            println!("[StateManager] 定时触发器线程启动");
            
            let mut last_trigger_time = SystemTime::now();
            
            loop {
                // 每 1000ms 检查一次
                std::thread::sleep(Duration::from_secs(1));

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

                println!("[StateManager] 触发随机状态，概率 {:.2} <= {:.2}", random_value, trigger_rate);

                // 执行触发（需要获取锁）
                let rm = app_state.resource_manager.lock().unwrap();
                let mut sm = app_state.state_manager.lock().unwrap();
                
                // 从 ResourceManager 获取状态信息并触发
                let states: Vec<StateInfo> = state_names.iter()
                    .filter_map(|name| rm.get_state_by_name(name).cloned())
                    .collect();
                
                let _ = sm.trigger_random_state(&states);
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
