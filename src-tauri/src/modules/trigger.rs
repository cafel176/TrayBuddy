//! 触发器管理模块
//!
//! 处理各种事件触发和状态切换，包括：
//! - 登录事件 (login)
//! - 音乐播放事件 (music_start, music_end)
//! - 点击事件 (click)

#![allow(unused)]

use super::constants::{EVENT_LOGIN, EVENT_MUSIC_END, EVENT_MUSIC_START};
use super::resource::{ResourceManager, StateInfo};
use super::state::StateManager;
use std::collections::HashMap;
use std::sync::Mutex;

// ========================================================================= //
// 上次触发状态缓存
// ========================================================================= //

/// 用于存储每个触发器组上次触发的状态名
/// Key: (event_name, persistent_state) -> 上次触发的状态名
static LAST_TRIGGERED_STATE: Mutex<Option<HashMap<(String, String), String>>> = Mutex::new(None);

/// 获取上次触发的状态名
fn get_last_triggered_state(event_name: &str, persistent_state: &str) -> Option<String> {
    let guard = LAST_TRIGGERED_STATE.lock().ok()?;
    guard
        .as_ref()
        .and_then(|map| map.get(&(event_name.to_string(), persistent_state.to_string())))
        .cloned()
}

/// 设置上次触发的状态名
fn set_last_triggered_state(event_name: &str, persistent_state: &str, state_name: &str) {
    if let Ok(mut guard) = LAST_TRIGGERED_STATE.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        map.insert(
            (event_name.to_string(), persistent_state.to_string()),
            state_name.to_string(),
        );
    }
}

// ========================================================================= //
// 触发器管理器
// ========================================================================= //

/// 触发器管理器
///
/// 负责处理事件触发并执行对应的状态切换：
/// 1. 从 ResourceManager 获取事件对应的 Trigger 配置
/// 2. 根据当前持久状态筛选匹配的 `can_trigger_states` 状态组
/// 3. 将状态信息传递给 StateManager 进行随机选择和切换
pub struct TriggerManager;

impl TriggerManager {
    /// 处理事件触发
    ///
    /// # 参数
    /// - `event_name`: 事件名称（如 "login", "music_start"）
    /// - `force`: true 时使用强制模式切换（忽略优先级与锁定检查）
    /// - `resource_manager`: 资源管理器引用
    /// - `state_manager`: 状态管理器可变引用
    ///
    /// # 返回
    /// - `Ok(true)`: 成功触发状态切换
    /// - `Ok(false)`: 未触发（无对应触发器或无可用状态）
    /// - `Err`: 切换过程中发生错误
    pub fn trigger_event(
        event_name: &str,
        force: bool,
        resource_manager: &ResourceManager,
        state_manager: &mut StateManager,
    ) -> Result<bool, String> {
        #[cfg(debug_assertions)]
        println!("[TriggerManager] 处理事件: '{}'", event_name);

        // 获取对应的 Trigger
        let trigger = match resource_manager.get_trigger_by_event(event_name) {
            Some(t) => t,
            None => {
                #[cfg(debug_assertions)]
                println!("[TriggerManager] 未找到事件 '{}' 的触发器", event_name);
                return Ok(false);
            }
        };

        // 获取当前持久状态名称
        let current_persistent_name = state_manager
            .get_persistent_state()
            .map(|s| s.name.as_ref())
            .unwrap_or("");

        #[cfg(debug_assertions)]
        println!(
            "[TriggerManager] 当前持久状态: '{}'",
            current_persistent_name
        );

        // 根据当前持久状态筛选可触发的状态名列表，并按权重聚合
        // 同时记录该组是否允许重复触发以及组内状态数量
        let mut weight_map: HashMap<String, u64> = HashMap::new();
        let mut allow_repeat = true;
        let mut total_states_in_matching_groups = 0usize;

        for group in trigger.can_trigger_states.iter().filter(|group| {
            // persistent_state 为空表示任意持久状态都可触发
            group.persistent_state.as_ref().is_empty()
                || group.persistent_state.as_ref() == current_persistent_name
        }) {
            // 记录 allow_repeat 设置（如果有多个匹配的组，使用最严格的设置）
            if !group.allow_repeat {
                allow_repeat = false;
            }
            total_states_in_matching_groups += group.states.len();

            for s in &group.states {
                if s.weight == 0 || s.state.as_ref().is_empty() {
                    continue;
                }
                *weight_map.entry(s.state.to_string()).or_insert(0) += s.weight as u64;
            }
        }

        if weight_map.is_empty() {
            #[cfg(debug_assertions)]
            println!(
                "[TriggerManager] 触发器 '{}' 在当前持久状态 '{}' 下没有可触发状态",
                event_name, current_persistent_name
            );
            return Ok(false);
        }

        // 从 ResourceManager 获取状态信息，并过滤不可用状态
        let mut candidates: Vec<(StateInfo, u64)> = weight_map
            .into_iter()
            .filter_map(|(name, w)| {
                resource_manager
                    .get_state_by_name(&name)
                    .cloned()
                    .and_then(|st| if st.is_enable() { Some((st, w)) } else { None })
            })
            .collect();

        // 获取上次触发的状态名（用于避免重复）
        let last_state = if !allow_repeat && candidates.len() > 1 {
            get_last_triggered_state(event_name, current_persistent_name)
        } else {
            None
        };

        // 随机选择状态，如果不允许重复且选中的状态与上次相同，则重新选择
        let selected = if let Some(ref last) = last_state {
            // 不允许重复且有上次状态记录，需要循环选择直到选到不同的状态
            let mut attempts = 0;
            let max_attempts = 100; // 防止无限循环
            loop {
                let Some(picked) = StateManager::pick_weighted_state(candidates.clone()) else {
                    #[cfg(debug_assertions)]
                    println!("[TriggerManager] 没有找到任何有效状态");
                    return Ok(false);
                };
                
                // 如果选中的状态与上次不同，或者已经尝试了太多次，就使用这个状态
                if picked.name.as_ref() != last || attempts >= max_attempts {
                    #[cfg(debug_assertions)]
                    if attempts > 0 {
                        println!(
                            "[TriggerManager] allow_repeat=false, 重新选择了 {} 次后选中: '{}'",
                            attempts, picked.name.as_ref()
                        );
                    }
                    break picked;
                }
                
                attempts += 1;
                #[cfg(debug_assertions)]
                println!(
                    "[TriggerManager] allow_repeat=false, 选中与上次相同的状态 '{}', 重新选择 (尝试 {})",
                    last, attempts
                );
            }
        } else {
            // 允许重复或没有上次状态记录，直接选择
            let Some(picked) = StateManager::pick_weighted_state(candidates) else {
                #[cfg(debug_assertions)]
                println!("[TriggerManager] 没有找到任何有效状态");
                return Ok(false);
            };
            picked
        };

        // 记录本次触发的状态名
        set_last_triggered_state(event_name, current_persistent_name, selected.name.as_ref());

        // 直接切换到选中的状态（避免再做一次无权重随机）
        // force=true 时忽略优先级与锁定检查
        state_manager.change_state_ex(selected, force, resource_manager)


    }
}
