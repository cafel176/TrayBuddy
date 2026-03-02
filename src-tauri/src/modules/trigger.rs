//! 触发器管理模块
//!
//! 处理各种事件触发和状态切换，包括：
//! - 登录事件 (login)
//! - 音乐播放事件 (music_start, music_end)
//! - 点击事件 (click)

#![allow(unused)]

use super::constants::{EVENT_LOGIN, EVENT_MUSIC_END, EVENT_MUSIC_START};
use super::resource::{ResourceManager, StateInfo};
use super::state::{StateLimitsContext, StateManager};
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

// ========================================================================= //
// 常量定义
// ========================================================================= //

/// 最大缓存的历史触发状态数量
/// 当 allow_repeat=false 时，会排除最近 N 个已触发的状态
/// 实际排除数量为 min(MAX_HISTORY_SIZE, 候选状态数 - 1)
const MAX_HISTORY_SIZE: usize = 3;

// ========================================================================= //
// 触发状态历史缓存
// ========================================================================= //

/// 用于存储每个触发器组最近触发的状态名列表
/// Key: (event_name, persistent_state) -> 最近触发的状态名队列（最新的在队尾）
static TRIGGERED_STATE_HISTORY: Mutex<Option<HashMap<(String, String), VecDeque<String>>>> =
    Mutex::new(None);

/// 获取最近触发的状态名列表
/// 
/// # 返回
/// 返回最近触发的状态名列表，最新的在最后
fn get_triggered_state_history(event_name: &str, persistent_state: &str) -> Vec<String> {
    let guard = match TRIGGERED_STATE_HISTORY.lock() {
        Ok(g) => g,
        Err(_) => return Vec::new(),
    };
    guard
        .as_ref()
        .and_then(|map| map.get(&(event_name.to_string(), persistent_state.to_string())))
        .map(|deque| deque.iter().cloned().collect())
        .unwrap_or_default()
}

/// 添加新触发的状态到历史记录
/// 
/// 会自动维护队列长度不超过 MAX_HISTORY_SIZE
fn add_triggered_state_to_history(event_name: &str, persistent_state: &str, state_name: &str) {
    if let Ok(mut guard) = TRIGGERED_STATE_HISTORY.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        let key = (event_name.to_string(), persistent_state.to_string());
        let history = map.entry(key).or_insert_with(VecDeque::new);
        
        // 添加新状态到队尾
        history.push_back(state_name.to_string());
        
        // 如果超过最大长度，移除最旧的记录
        while history.len() > MAX_HISTORY_SIZE {
            history.pop_front();
        }
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
    /// - `limits_ctx`: 预取的状态限制上下文（在获取 rm/sm 锁之前构造，避免死锁）
    ///
    /// # 锁序安全
    /// 调用者必须在获取 `resource_manager` / `state_manager` 锁**之前**通过
    /// `StateLimitsContext::prefetch()` 预取 storage 数据，以保证锁序：
    /// `storage → resource_manager → state_manager`。
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
        limits_ctx: &StateLimitsContext,
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
        // 同时记录该组是否允许重复触发
        let mut weight_map: HashMap<String, u64> = HashMap::new();
        let mut allow_repeat = true;

        for group in trigger.can_trigger_states.iter().filter(|group| {
            // persistent_state 为空表示任意持久状态都可触发
            group.persistent_state.as_ref().is_empty()
                || group.persistent_state.as_ref() == current_persistent_name
        }) {
            // 记录 allow_repeat 设置（如果有多个匹配的组，使用最严格的设置）
            if !group.allow_repeat {
                allow_repeat = false;
            }

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

        // 从 ResourceManager 获取状态信息，并使用预取的 limits 上下文过滤不可用状态
        let mut candidates: Vec<(StateInfo, u64)> = weight_map
            .into_iter()
            .filter_map(|(name, w)| {
                resource_manager
                    .get_state_by_name(&name)
                    .cloned()
                    .and_then(|st| {
                        if st.is_enable() && limits_ctx.is_allowed(&st) {
                            Some((st, w))
                        } else {
                            None
                        }

                    })
            })
            .collect();

        let candidates_count = candidates.len();

        #[cfg(debug_assertions)]
        println!(
            "[TriggerManager] allow_repeat={}, candidates.len()={}",
            allow_repeat, candidates_count
        );

        // 如果不允许重复且候选状态数量大于 1，从候选列表中排除历史触发的状态
        if !allow_repeat && candidates_count > 1 {
            let history = get_triggered_state_history(event_name, current_persistent_name);
            
            // 计算实际要排除的历史记录数量：min(MAX_HISTORY_SIZE, 候选数 - 1)
            // 确保至少保留 1 个可选状态
            let exclude_count = MAX_HISTORY_SIZE.min(candidates_count - 1);
            
            #[cfg(debug_assertions)]
            println!(
                "[TriggerManager] 不允许重复触发，历史记录: {:?}, 排除数量: {}",
                history, exclude_count
            );
            
            // 从历史记录中取最近的 exclude_count 个状态进行排除
            // 历史记录中最新的在最后，所以从后往前取
            let states_to_exclude: Vec<&str> = history
                .iter()
                .rev()
                .take(exclude_count)
                .map(|s| s.as_str())
                .collect();
            
            if !states_to_exclude.is_empty() {
                let original_len = candidates.len();
                candidates.retain(|(st, _)| !states_to_exclude.contains(&st.name.as_ref()));
                
                #[cfg(debug_assertions)]
                println!(
                    "[TriggerManager] 排除状态 {:?} 后，候选数量从 {} 变为 {}",
                    states_to_exclude, original_len, candidates.len()
                );
            }
        }

        // 从剩余候选中随机选择一个状态
        let Some(selected) = StateManager::pick_weighted_state(candidates) else {
            #[cfg(debug_assertions)]
            println!("[TriggerManager] 没有找到任何有效状态");
            return Ok(false);
        };

        #[cfg(debug_assertions)]
        println!(
            "[TriggerManager] 最终选中状态: '{}'",
            selected.name.as_ref()
        );

        // 记录本次触发的状态到历史
        add_triggered_state_to_history(event_name, current_persistent_name, selected.name.as_ref());

        // 直接切换到选中的状态（避免再做一次无权重随机）
        // force=true 时忽略优先级与锁定检查
        state_manager.change_state_ex(selected, force, resource_manager)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn triggered_state_history_keeps_recent_items() {
        if let Ok(mut guard) = TRIGGERED_STATE_HISTORY.lock() {
            *guard = None;
        }

        let event = "click";
        let persistent = "idle";

        add_triggered_state_to_history(event, persistent, "a");
        add_triggered_state_to_history(event, persistent, "b");
        add_triggered_state_to_history(event, persistent, "c");
        add_triggered_state_to_history(event, persistent, "d");

        let history = get_triggered_state_history(event, persistent);
        assert_eq!(history, vec!["b", "c", "d"]);
    }
}

