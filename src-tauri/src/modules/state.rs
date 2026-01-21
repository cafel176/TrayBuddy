use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use super::constants::{
    ANIMATION_IDLE, ANIMATION_MORNING, ANIMATION_NOON, ANIMATION_EVENING, ANIMATION_NIGHT, ANIMATION_MUSIC,
    STATE_IDLE, STATE_MUSIC, STATE_MORNING, STATE_NOON, STATE_EVENING, STATE_NIGHT
};

// ========================================================================= //

/// 状态信息结构
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StateInfo {
    pub name: String,           // 状态名称
    pub persistent: bool,       // 是否是持久状态
    pub action: String,      // 动画名称 (对应 action name)
    pub audio: String,          // 语音名称
    pub text: String,           // 文本内容
    pub priority: u32,          // 优先级 (数值越大优先级越高)
}

impl StateInfo {
    pub fn new(
        name: &str,
        persistent: bool,
        action: &str,
        audio: &str,
        text: &str,
        priority: u32,
    ) -> Self {
        Self {
            name: name.to_string(),
            persistent,
            action: action.to_string(),
            audio: audio.to_string(),
            text: text.to_string(),
            priority,
        }
    }
}

// ========================================================================= //

/// 发送给前端的状态切换事件
#[derive(Debug, Serialize, Clone)]
pub struct StateChangeEvent {
    pub state: StateInfo,
    pub play_once: bool,  // true: 播放一次后回到持久状态, false: 循环播放
}

// ========================================================================= //

/// 状态管理器
pub struct StateManager {
    /// 预定义的状态数组
    states: Vec<StateInfo>,
    /// 当前状态 (可能是临时状态)
    current_state: Option<StateInfo>,
    /// 持久状态 (默认循环播放的状态)
    persistent_state: Option<StateInfo>,
    /// Tauri AppHandle，用于发送事件到前端
    app_handle: Option<AppHandle>,
    /// 状态锁定标志 (临时状态播放中时锁定，禁止切换)
    locked: bool,
}

impl StateManager {
    /// 创建新的状态管理器，初始化预定义状态
    pub fn new() -> Self {
        let states = vec![
            // 持久状态
            StateInfo::new(STATE_IDLE, true, ANIMATION_IDLE, "", "", 0),
            // 持久状态 - 音乐播放中 (优先级比 idle 高)
            StateInfo::new(STATE_MUSIC, true, ANIMATION_MUSIC, "", "", 0),
            // 临时状态 - 时间问候
            StateInfo::new(STATE_MORNING, false, ANIMATION_MORNING, "morning", "morning", 1),
            StateInfo::new(STATE_NOON, false, ANIMATION_NOON, "noon", "noon", 1),
            StateInfo::new(STATE_EVENING, false, ANIMATION_EVENING, "evening", "evening", 1),
            StateInfo::new(STATE_NIGHT, false, ANIMATION_NIGHT, "night", "night", 1),
        ];

        Self {
            states,
            current_state: None,
            persistent_state: None,
            app_handle: None,
            locked: false,
        }
    }

    /// 检查状态是否被锁定
    pub fn is_locked(&self) -> bool {
        self.locked
    }

    /// 设置 AppHandle，用于发送事件到前端
    pub fn set_app_handle(&mut self, app_handle: AppHandle) {
        self.app_handle = Some(app_handle);
    }

    /// 根据名称获取预定义状态
    pub fn get_state_by_name(&self, name: &str) -> Option<&StateInfo> {
        self.states.iter().find(|s| s.name == name)
    }

    /// 获取当前状态
    pub fn get_current_state(&self) -> Option<&StateInfo> {
        self.current_state.as_ref()
    }

    /// 获取持久状态
    pub fn get_persistent_state(&self) -> Option<&StateInfo> {
        self.persistent_state.as_ref()
    }

    /// 获取所有预定义状态
    pub fn get_all_states(&self) -> &Vec<StateInfo> {
        &self.states
    }

    /// 设置持久状态
    /// 如果当前被锁定（临时状态播放中），只更新持久状态，不切换当前状态
    /// 如果未锁定，同时更新持久状态和当前状态
    pub fn set_persistent_state(&mut self, name: &str) -> Result<(), String> {
        let state = self.get_state_by_name(name)
            .ok_or_else(|| format!("State '{}' not found", name))?
            .clone();

        if !state.persistent {
            return Err(format!("State '{}' is not a persistent state", name));
        }

        // 更新持久状态
        self.persistent_state = Some(state.clone());

        // 如果被锁定（临时状态播放中），不切换当前状态，等临时状态播放完毕后自动切换
        if self.locked {
            println!("[StateManager] 状态锁定中，仅更新持久状态为 '{}'，当前状态保持不变", name);
            return Ok(());
        }

        // 未锁定，同时更新当前状态并发送事件
        self.current_state = Some(state.clone());
        self.emit_state_change(&state, false);

        Ok(())
    }

    /// 切换状态
    /// 如果新状态优先级高于当前状态，则切换
    /// 如果新状态是临时状态，播放完毕后自动回到持久状态
    pub fn switch_state(&mut self, name: &str) -> Result<bool, String> {
        // 如果状态被锁定，禁止切换
        if self.locked {
            return Ok(false);
        }

        let new_state = self.get_state_by_name(name)
            .ok_or_else(|| format!("State '{}' not found", name))?
            .clone();

        // 检查优先级
        let current_priority = self.current_state.as_ref().map(|s| s.priority).unwrap_or(0);
        
        if new_state.priority < current_priority {
            // 新状态优先级不够高，不切换
            return Ok(false);
        }

        // 切换到新状态
        self.current_state = Some(new_state.clone());

        if new_state.persistent {
            // 如果是持久状态，更新持久状态并循环播放
            self.persistent_state = Some(new_state.clone());
            self.emit_state_change(&new_state, false);
        } else {
            // 如果是临时状态，锁定状态并播放一次
            self.locked = true;
            self.emit_state_change(&new_state, true);
        }

        Ok(true)
    }

    /// 状态播放完毕后调用，解锁并回到持久状态
    pub fn on_state_complete(&mut self) {
        // 解锁状态
        self.locked = false;
        
        // 回到持久状态
        if let Some(persistent) = &self.persistent_state {
            let persistent = persistent.clone();
            self.current_state = Some(persistent.clone());
            self.emit_state_change(&persistent, false);
        }
    }

    /// 强制切换状态（忽略优先级检查和锁定）
    pub fn force_switch_state(&mut self, name: &str) -> Result<(), String> {
        // 强制切换会解除锁定
        self.locked = false;

        let new_state = self.get_state_by_name(name)
            .ok_or_else(|| format!("State '{}' not found", name))?
            .clone();

        self.current_state = Some(new_state.clone());

        if new_state.persistent {
            self.persistent_state = Some(new_state.clone());
            self.emit_state_change(&new_state, false);
        } else {
            // 临时状态需要锁定
            self.locked = true;
            self.emit_state_change(&new_state, true);
        }

        Ok(())
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
