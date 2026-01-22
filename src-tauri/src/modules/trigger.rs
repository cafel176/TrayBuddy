//! 触发器管理模块
//! 处理各种事件触发和状态切换

use super::constants::{EVENT_LOGIN, EVENT_MUSIC_START, EVENT_MUSIC_END};
use super::resource::{ResourceManager, StateInfo};
use super::state::StateManager;

// ========================================================================= //

/// 触发器管理器
/// 处理事件触发并执行对应的状态切换
/// 
/// 主要职责：
/// - 从 ResourceManager 获取 Trigger 配置
/// - 解析 can_trigger_states 状态名列表
/// - 将状态信息传递给 StateManager 进行随机选择和切换
pub struct TriggerManager;

impl TriggerManager {
    /// 处理事件触发
    /// 1. 通过事件名从 ResourceManager 获取对应的 Trigger
    /// 2. 获取 Trigger 的 can_trigger_states 状态数组
    /// 3. 从 ResourceManager 获取状态信息
    /// 4. 调用 StateManager 进行随机选择和切换
    /// 
    /// 返回：是否成功触发了状态切换
    pub fn trigger_event(
        event_name: &str,
        resource_manager: &ResourceManager,
        state_manager: &mut StateManager,
    ) -> Result<bool, String> {
        println!("[TriggerManager] 处理事件: '{}'", event_name);

        // 1. 获取对应的 Trigger
        let trigger = match resource_manager.get_trigger_by_event(event_name) {
            Some(t) => t,
            None => {
                println!("[TriggerManager] 未找到事件 '{}' 的触发器", event_name);
                return Ok(false);
            }
        };

        // 2. 获取可触发的状态名列表
        let state_names = &trigger.can_trigger_states;
        if state_names.is_empty() {
            println!("[TriggerManager] 触发器 '{}' 没有配置可触发状态", event_name);
            return Ok(false);
        }

        // 3. 从 ResourceManager 获取状态信息
        let states: Vec<StateInfo> = state_names.iter()
            .filter_map(|name| {
                let state = resource_manager.get_state_by_name(name);
                if state.is_none() {
                    println!("[TriggerManager] 未找到状态 '{}'", name);
                }
                state.cloned()
            })
            .collect();

        if states.is_empty() {
            println!("[TriggerManager] 没有找到任何有效状态");
            return Ok(false);
        }

        // 4. 调用 StateManager 进行随机选择和切换
        state_manager.trigger_random_state(&states)
    }

    /// 触发登录事件
    pub fn trigger_login(
        resource_manager: &ResourceManager,
        state_manager: &mut StateManager,
    ) -> Result<bool, String> {
        Self::trigger_event(EVENT_LOGIN, resource_manager, state_manager)
    }

    /// 触发音乐开始事件
    pub fn trigger_music_start(
        resource_manager: &ResourceManager,
        state_manager: &mut StateManager,
    ) -> Result<bool, String> {
        Self::trigger_event(EVENT_MUSIC_START, resource_manager, state_manager)
    }

    /// 触发音乐结束事件
    pub fn trigger_music_end(
        resource_manager: &ResourceManager,
        state_manager: &mut StateManager,
    ) -> Result<bool, String> {
        Self::trigger_event(EVENT_MUSIC_END, resource_manager, state_manager)
    }
}
