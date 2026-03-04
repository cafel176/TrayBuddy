//! 渲染调优配置加载器
//!
//! 从 `config/render_tuning.json` 读取前端渲染性能参数，
//! 启动时加载一次并缓存，前端通过 Tauri command 获取。
//!
//! 设计参考：`media_observer.rs` / `process_observer.rs` 的配置加载模式。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::RwLock;

// ========================================================================= //
// 配置结构
// ========================================================================= //

const RENDER_TUNING_CONFIG_FILENAME: &str = "render_tuning.json";

/// render_tuning.json 的反序列化结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderTuningConfig {
    /// 全局 FPS 上限（默认 30）
    #[serde(default = "default_fps_limit_max")]
    pub fps_limit_max: u32,

    /// 是否启用 idle 降频（默认 false）
    #[serde(default)]
    pub idle_throttle_enabled: bool,

    /// idle 降频后的帧率（默认 20）
    #[serde(default = "default_idle_throttle_fps")]
    pub idle_throttle_fps: u32,

    /// 进入 idle 降频的延迟（毫秒，默认 3000）
    #[serde(default = "default_idle_throttle_delay_ms")]
    pub idle_throttle_delay_ms: u32,
}

fn default_fps_limit_max() -> u32 {
    30
}
fn default_idle_throttle_fps() -> u32 {
    20
}
fn default_idle_throttle_delay_ms() -> u32 {
    3000
}

impl Default for RenderTuningConfig {
    fn default() -> Self {
        Self {
            fps_limit_max: default_fps_limit_max(),
            idle_throttle_enabled: false,
            idle_throttle_fps: default_idle_throttle_fps(),
            idle_throttle_delay_ms: default_idle_throttle_delay_ms(),
        }
    }
}

// ========================================================================= //
// 全局缓存
// ========================================================================= //

lazy_static::lazy_static! {
    static ref RENDER_TUNING: RwLock<RenderTuningConfig> = RwLock::new(RenderTuningConfig::default());
}

/// 获取当前缓存的渲染调优配置（供 Tauri command 调用）
pub fn get_render_tuning_config() -> RenderTuningConfig {
    RENDER_TUNING.read().unwrap().clone()
}

// ========================================================================= //
// 配置文件加载
// ========================================================================= //

/// 从文件解析渲染调优配置
fn load_from_file(path: &Path) -> Option<RenderTuningConfig> {
    if !path.exists() {
        return None;
    }

    let content = std::fs::read_to_string(path).ok()?;
    let cfg: RenderTuningConfig = serde_json::from_str(&content).ok()?;
    Some(cfg)
}

/// 获取配置文件的候选路径列表（按优先级排列）
///
/// 搜索策略：从 exe 所在目录开始，向上回退最多 6 层（兼容开发模式的
/// `target/debug/` 嵌套），每层检查 `config/render_tuning.json`。
/// 最后追加工作目录下的 `config/` 路径作为兜底。
fn get_config_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(exe_path) = std::env::current_exe() {
        let mut current_dir = exe_path.parent();
        // 兼容开发模式：向上回退若干层
        for _ in 0..=6 {
            if let Some(dir) = current_dir {
                candidates.push(dir.join("config").join(RENDER_TUNING_CONFIG_FILENAME));
                current_dir = dir.parent();
            } else {
                break;
            }
        }
    }

    // 兜底：工作目录 / config
    candidates.push(PathBuf::from("config").join(RENDER_TUNING_CONFIG_FILENAME));

    candidates
}

/// 启动时加载渲染调优配置。
///
/// - 首选：`exe_dir/config/render_tuning.json`
/// - 兼容开发模式：向上回退若干层父目录查找 `config/`
/// - 兜底：工作目录 `config/`
/// - 未找到则使用内置默认值
pub fn init_render_tuning_from_config() {
    for path in get_config_candidates() {
        if let Some(config) = load_from_file(&path) {
            if let Ok(mut guard) = RENDER_TUNING.write() {
                *guard = config;
            }
            #[cfg(debug_assertions)]
            println!(
                "[RenderTuning] 已加载 render_tuning.json: {:?}",
                path
            );
            return;
        }
    }

    #[cfg(debug_assertions)]
    println!(
        "[RenderTuning] 未找到/解析 render_tuning.json，使用内置默认值"
    );
}

// ========================================================================= //
// Tests
// ========================================================================= //

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_has_expected_values() {
        let cfg = RenderTuningConfig::default();
        assert_eq!(cfg.fps_limit_max, 30);
        assert!(!cfg.idle_throttle_enabled);
        assert_eq!(cfg.idle_throttle_fps, 20);
        assert_eq!(cfg.idle_throttle_delay_ms, 3000);
    }

    #[test]
    fn deserialize_partial_json() {
        let json = r#"{ "fps_limit_max": 60 }"#;
        let cfg: RenderTuningConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.fps_limit_max, 60);
        // 其余字段使用默认值
        assert!(!cfg.idle_throttle_enabled);
        assert_eq!(cfg.idle_throttle_fps, 20);
        assert_eq!(cfg.idle_throttle_delay_ms, 3000);
    }

    #[test]
    fn deserialize_full_json() {
        let json = r#"{
            "fps_limit_max": 45,
            "idle_throttle_enabled": true,
            "idle_throttle_fps": 10,
            "idle_throttle_delay_ms": 5000
        }"#;
        let cfg: RenderTuningConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.fps_limit_max, 45);
        assert!(cfg.idle_throttle_enabled);
        assert_eq!(cfg.idle_throttle_fps, 10);
        assert_eq!(cfg.idle_throttle_delay_ms, 5000);
    }

    #[test]
    fn init_does_not_panic() {
        init_render_tuning_from_config();
        let cfg = get_render_tuning_config();
        assert!(cfg.fps_limit_max > 0);
    }

    #[test]
    fn get_config_candidates_not_empty() {
        let candidates = get_config_candidates();
        assert!(!candidates.is_empty());
        for c in &candidates {
            assert!(
                c.to_string_lossy().contains(RENDER_TUNING_CONFIG_FILENAME),
                "Candidate {:?} should contain config filename",
                c
            );
        }
    }
}
