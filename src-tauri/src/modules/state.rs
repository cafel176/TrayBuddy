//! 状态管理模块
//! 负责管理角色状态的切换和事件通知

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use super::resource::StateInfo;

// ========================================================================= //

/// 发送给前端的状态切换事件
#[derive(Debug, Serialize, Clone)]
pub struct StateChangeEvent {
    pub state: StateInfo,
    pub play_once: bool,  // true: 播放一次后回到持久状态, false: 循环播放
}

// ========================================================================= //

/// 状态管理器
/// 
/// 状态现在从 Mod 的 manifest.json 中加载，不再硬编码。
/// StateManager 负责管理当前状态和持久状态的切换逻辑。
pub struct StateManager {
    /// 当前状态 (可能是临时状态)
    current_state: Option<StateInfo>,
    /// 下一个状态 (当前状态播放完毕后切换)
    next_state: Option<StateInfo>,
    /// 持久状态 (默认循环播放的状态)
    persistent_state: Option<StateInfo>,
    /// Tauri AppHandle，用于发送事件到前端
    app_handle: Option<AppHandle>,
    /// 状态锁定标志 (临时状态播放中时锁定，禁止切换)
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
    // 基础状态管理
    // ========================================================================= //

    /// 检查状态是否被锁定
    pub fn is_locked(&self) -> bool {
        self.locked
    }

    /// 智能切换状态：根据状态类型自动选择合适的切换方式
    /// - 持久状态：调用 set_persistent_state
    /// - 临时状态：调用 set_current_state
    pub fn change_state(&mut self, state: StateInfo) -> Result<bool, String> {
        self.change_state_ex(state, false)
    }

    /// 智能切换状态（扩展版本）
    /// - force: 是否忽略优先级和锁定检查强制切换
    pub fn change_state_ex(&mut self, state: StateInfo, force: bool) -> Result<bool, String> {
        let result = if state.persistent {
            self.set_persistent_state(state.clone(), force)
        } else {
            self.set_current_state(state.clone(), force)
        };
        
        // 状态切换成功时，更新定时触发开关
        if let Ok(true) = result {
            self.set_timer_enabled(state.persistent);
        }
        
        result
    }

    // ========================================================================= //
    // 持久状态管理
    // ========================================================================= //

    /// 获取持久状态
    pub fn get_persistent_state(&self) -> Option<&StateInfo> {
        self.persistent_state.as_ref()
    }

    /// 设置持久状态
    /// 如果当前被锁定（临时状态播放中），只更新持久状态，不切换当前状态
    /// 如果未锁定，同时更新持久状态和当前状态
    /// 持久-持久，如 Idle-Music，直接切换并显示动画
    /// 临时-持久，如 Music_Start-Music，仅更换数据，待播放完毕解锁后自然更换
    /// - force: 是否忽略优先级和锁定检查强制切换
    pub fn set_persistent_state(&mut self, state: StateInfo, force: bool) -> Result<bool, String> {
        if !state.persistent {
            return Err(format!("State '{}' is not a persistent state", state.name));
        }

        // 如果当前持久状态与传入状态相同，不切换
        if self.current_state.as_ref().map(|s| &s.name) == Some(&state.name) {
            return Ok(false);
        }

        if !force {
            // 检查优先级
            let persistent_priority = self.persistent_state.as_ref().map(|s| s.priority).unwrap_or(0);     
            if state.priority < persistent_priority {
                println!("[StateManager] 状态优先级不够，禁止变更状态 '{}'", state.name);
                return Ok(false);
            }
        }

        // 更新持久状态
        self.persistent_state = Some(state.clone());

        // 如果被锁定（临时状态播放中），不切换当前状态，等临时状态播放完毕后自动切换
        if self.locked && !force {
            println!("[StateManager] 状态锁定中，仅更新持久状态为 '{}'，当前状态保持不变", state.name);
            return Ok(false);
        }

        // 强制切换时解除锁定
        if force {
            self.locked = false;
        }

        // 未锁定，同时更新当前状态并发送事件
        self.current_state = Some(state.clone());
        self.emit_state_change(&state, false);

        Ok(true)
    }

    // ========================================================================= //
    // 当前状态管理
    // ========================================================================= //

    /// 获取当前状态
    pub fn get_current_state(&self) -> Option<&StateInfo> {
        self.current_state.as_ref()
    }

    /// 切换到指定状态
    /// 如果新状态优先级高于当前状态，则切换
    /// 如果新状态是临时状态，播放完毕后自动回到持久状态
    /// 持久-临时，如 Idle-Morning，直接切换并显示动画
    /// 临时-临时，当不锁定时，上一个状态其实已经结束，因此直接切换
    /// - force: 是否忽略优先级和锁定检查强制切换
    pub fn set_current_state(&mut self, state: StateInfo, force: bool) -> Result<bool, String> {
        if state.persistent {
            return Err(format!("State '{}' is a persistent state", state.name));
        }

        if !force {
            // 如果状态被锁定，禁止切换
            if self.locked {
                println!("[StateManager] 状态锁定中，禁止变更状态 '{}'", state.name);
                return Ok(false);
            }

            // 检查优先级
            let current_priority = self.current_state.as_ref().map(|s| s.priority).unwrap_or(0);     
            if state.priority < current_priority {
                println!("[StateManager] 状态优先级不够，禁止变更状态 '{}'", state.name);
                return Ok(false);
            }
        } 

        // 切换到新状态
        self.current_state = Some(state.clone());
        self.emit_state_change(&state, true);

        self.locked = true;

        Ok(true)
    }

    // ========================================================================= //
    // 状态完成处理
    // ========================================================================= //

    /// 状态播放完毕后调用，解锁并切换到下一个状态或回到持久状态
    pub fn on_state_complete(&mut self) {
        // 解锁状态
        self.locked = false;
        
        // 优先切换到 next_state（如果有）
        if let Some(next) = self.next_state.take() {
            let _ = self.change_state(next);
            return;
        }
        
        // 否则回到持久状态
        if let Some(persistent) = &self.persistent_state {
            let _ = self.change_state(persistent.clone());
        }
    }
  
    // ========================================================================= //
    // 随机状态触发
    // ========================================================================= //

    /// 从状态列表中随机选择一个可用状态并切换
    /// 1. 筛选出所有通过 is_enable() 检查的状态
    /// 2. 随机选择一个
    /// 3. 执行切换
    pub fn trigger_random_state(&mut self, states: &[StateInfo]) -> Result<bool, String> {
        // 筛选出所有通过 is_enable() 检查的状态
        let enabled_states: Vec<&StateInfo> = states.iter()
            .filter(|s| {
                if s.is_enable() {
                    true
                } else {
                    println!("[StateManager] 状态 '{}' 未通过时间/日期检查", s.name);
                    false
                }
            })
            .collect();

        if enabled_states.is_empty() {
            println!("[StateManager] 没有可用的状态");
            return Ok(false);
        }

        // 随机选择一个状态
        let selected_state = if enabled_states.len() == 1 {
            enabled_states[0].clone()
        } else {
            let idx = Self::random_index(enabled_states.len());
            enabled_states[idx].clone()
        };

        println!("[StateManager] 随机选择状态: '{}'", selected_state.name);

        // 执行状态切换
        self.change_state(selected_state)
    }

    /// 简单的随机索引生成（基于时间戳）
    fn random_index(max: usize) -> usize {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .subsec_nanos() as usize;
        nanos % max
    }

    /// 生成 0.0 到 1.0 之间的随机数
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
        if let Some(timer_enabled) = &self.timer_enabled {
            if enabled {
                println!("[StateManager] 启用定时触发");
            } else {
                println!("[StateManager] 禁用定时触发");
            }
            timer_enabled.store(enabled, Ordering::SeqCst);
        }
    }

    /// 启动定时触发器线程
    pub fn start_timer_loop(&mut self, app_handle: tauri::AppHandle) {
        let timer_enabled = Arc::new(AtomicBool::new(false));
        self.timer_enabled = Some(timer_enabled.clone());

        std::thread::spawn(move || {
            println!("[StateManager] 定时触发器线程启动");
            
            let mut last_trigger_time = SystemTime::now();
            
            loop {
                // 每 1000ms 检查一次
                std::thread::sleep(Duration::from_millis(1000));

                // 检查是否启用
                if !timer_enabled.load(Ordering::SeqCst) {
                    last_trigger_time = SystemTime::now();
                    continue;
                }

                // 从 AppState 获取持久状态信息
                use tauri::Manager;
                let state: tauri::State<crate::AppState> = app_handle.state();
                
                let persistent_state = {
                    let sm = state.state_manager.lock().unwrap();
                    sm.get_persistent_state().cloned()
                };
                
                let persistent_state = match persistent_state {
                    Some(s) => s,
                    None => continue,
                };

                // 检查触发间隔
                let trigger_time = persistent_state.trigger_time;
                if trigger_time <= 0.0 {
                    continue;
                }

                let elapsed = last_trigger_time.elapsed().unwrap_or_default();
                if elapsed.as_secs_f32() < trigger_time {
                    continue;
                }

                // 重置计时器
                last_trigger_time = SystemTime::now();

                // 检查触发概率
                let trigger_rate = persistent_state.trigger_rate;
                if trigger_rate <= 0.0 {
                    continue;
                }

                let random_value = Self::random_float();
                if random_value > trigger_rate {
                    println!("[StateManager] 概率检查未通过 ({:.2} > {:.2})", random_value, trigger_rate);
                    continue;
                }

                // 获取可触发的状态列表
                let state_names = &persistent_state.can_trigger_states;
                if state_names.is_empty() {
                    continue;
                }

                println!("[StateManager] 触发随机状态，概率 {:.2} <= {:.2}", random_value, trigger_rate);

                // 执行触发
                let rm = state.resource_manager.lock().unwrap();
                let mut sm = state.state_manager.lock().unwrap();
                
                // 从 ResourceManager 获取状态信息
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
        if let Some(app_handle) = &self.app_handle {
            let event = StateChangeEvent {
                state: state.clone(),
                play_once,
            };
            
            if let Err(e) = app_handle.emit("state-change", event) {
                eprintln!("Failed to emit state-change event: {}", e);
            }
        }
    }
}

impl Default for StateManager {
    fn default() -> Self {
        Self::new()
    }
}
