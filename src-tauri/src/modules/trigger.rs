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
    /// - `resource_manager`: 资源管理器引用
    /// - `state_manager`: 状态管理器可变引用
    ///
    /// # 返回
    /// - `Ok(true)`: 成功触发状态切换
    /// - `Ok(false)`: 未触发（无对应触发器或无可用状态）
    /// - `Err`: 切换过程中发生错误
    pub fn trigger_event(
        event_name: &str,
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

        // 根据当前持久状态筛选可触发的状态名列表
        let state_names: Vec<&str> = trigger
            .can_trigger_states
            .iter()
            .filter(|group| {
                // persistent_state 为空表示任意持久状态都可触发
                group.persistent_state.as_ref().is_empty()
                    || group.persistent_state.as_ref() == current_persistent_name
            })
            .flat_map(|group| group.states.iter().map(|s| s.as_ref()))
            .collect();

        if state_names.is_empty() {
            #[cfg(debug_assertions)]
            println!(
                "[TriggerManager] 触发器 '{}' 在当前持久状态 '{}' 下没有可触发状态",
                event_name, current_persistent_name
            );
            return Ok(false);
        }

        // 从 ResourceManager 获取状态信息
        let states: Vec<StateInfo> = state_names
            .iter()
            .filter_map(|name| match resource_manager.get_state_by_name(name) {
                Some(state) => Some(state.clone()),
                None => {
                    #[cfg(debug_assertions)]
                    println!("[TriggerManager] 未找到状态 '{}'", name);
                    None
                }
            })
            .collect();

        if states.is_empty() {
            #[cfg(debug_assertions)]
            println!("[TriggerManager] 没有找到任何有效状态");
            return Ok(false);
        }

        // 调用 StateManager 进行随机选择和切换
        // 传入 resource_manager 引用避免死锁（因为外层已持有锁）
        state_manager.trigger_random_state(&states, resource_manager)
    }

    // ========================================================================= //
    // 便捷触发方法
    // ========================================================================= //

    /// 触发音乐开始事件
    #[inline]
    pub fn trigger_music_start(
        resource_manager: &ResourceManager,
        state_manager: &mut StateManager,
    ) -> Result<bool, String> {
        Self::trigger_event(EVENT_MUSIC_START, resource_manager, state_manager)
    }

    /// 触发音乐结束事件
    #[inline]
    pub fn trigger_music_end(
        resource_manager: &ResourceManager,
        state_manager: &mut StateManager,
    ) -> Result<bool, String> {
        Self::trigger_event(EVENT_MUSIC_END, resource_manager, state_manager)
    }
}
