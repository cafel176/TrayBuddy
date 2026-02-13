//! 进程启动监测模块（Windows）
//!
//! 目标：当用户启动一个新进程时，检查进程名是否包含“监测表”中的任意关键字，
//! 若命中则对外发送事件（上层可据此触发 `work` 事件）。
//!
//! 设计参考：`media_observer.rs`
//! - 支持从 `config/process_observer_keywords.json` 加载关键字
//! - 仅在 Windows 平台实现；其他平台为 no-op

#![allow(unused)]

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use tokio::sync::mpsc;



// ========================================================================= //
// 配置：关键字表
// ========================================================================= //

const PROCESS_OBSERVER_KEYWORDS_CONFIG_FILENAME: &str = "process_observer_keywords.json";

#[derive(Debug, Deserialize)]
struct ProcessObserverKeywordsConfig {
    #[serde(default)]
    process_keywords: Vec<String>,
}

lazy_static::lazy_static! {
    /// 进程关键字表（全部存为小写、去除首尾空白）
    static ref PROCESS_KEYWORDS: RwLock<Vec<Box<str>>> = RwLock::new(Vec::new());
}

fn load_process_keywords_from_file(path: &Path) -> Option<Vec<Box<str>>> {
    if !path.exists() {
        return None;
    }

    let content = std::fs::read_to_string(path).ok()?;
    let cfg: ProcessObserverKeywordsConfig = serde_json::from_str(&content).ok()?;

    let keywords: Vec<Box<str>> = cfg
        .process_keywords
        .into_iter()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .map(|s| s.into_boxed_str())
        .collect();

    Some(keywords)
}

fn get_keywords_config_candidates() -> Vec<PathBuf> {
    // 优先：exe 同目录 / config
    let mut candidates = Vec::new();

    if let Ok(exe_path) = std::env::current_exe() {
        let mut current_dir = exe_path.parent();
        // 兼容开发模式：向上回退若干层
        for _ in 0..=6 {
            if let Some(dir) = current_dir {
                candidates.push(dir.join("config").join(PROCESS_OBSERVER_KEYWORDS_CONFIG_FILENAME));
                current_dir = dir.parent();
            } else {
                break;
            }
        }
    }

    // 兜底：工作目录 / config
    candidates.push(PathBuf::from("config").join(PROCESS_OBSERVER_KEYWORDS_CONFIG_FILENAME));

    candidates
}

/// 启动时加载进程监测关键字配置。
///
/// - 首选：`exe_dir/config/process_observer_keywords.json`
/// - 兼容开发模式：向上回退若干层父目录查找 `config/`
/// - 兜底：工作目录 `config/`
pub fn init_process_keywords_from_config() {
    for path in get_keywords_config_candidates() {
        if let Some(keywords) = load_process_keywords_from_file(&path) {
            if let Ok(mut guard) = PROCESS_KEYWORDS.write() {
                *guard = keywords;
            }
            #[cfg(debug_assertions)]
            println!("[ProcessObserver] 已加载 process_keywords: {:?}", path);
            return;
        }
    }

    #[cfg(debug_assertions)]
    println!(
        "[ProcessObserver] 未找到/解析 process_observer_keywords.json，默认 process_keywords 为空（不触发 work）"
    );
}

fn should_trigger_for_process_name(process_name: &str) -> Option<Box<str>> {
    let name_lower = process_name.to_lowercase();
    let name_no_space = name_lower.replace(' ', "");

    // 也尝试去掉 .exe 后缀
    let stem_lower = name_lower
        .strip_suffix(".exe")
        .unwrap_or(name_lower.as_str());

    let keywords_guard = PROCESS_KEYWORDS
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    for kw in keywords_guard.iter() {
        let k = kw.as_ref();
        if k.is_empty() {
            continue;
        }
        if name_lower.contains(k)
            || name_no_space.contains(k)
            || stem_lower.contains(k)
        {
            return Some(k.to_string().into_boxed_str());
        }
    }

    None
}

// ========================================================================= //
// 事件类型
// ========================================================================= //

#[derive(Debug, Clone, Serialize)]
pub struct ProcessStartEvent {
    pub pid: u32,
    pub process_name: Box<str>,
    pub matched_keyword: Box<str>,
}

// ========================================================================= //
// 调试信息（仿照 media_observer）
// ========================================================================= //

/// 时间格式：短格式（小时:分钟:秒）
const TIME_FORMAT_SHORT: &str = "%H:%M:%S";

#[derive(Debug, Clone, Serialize)]
pub struct ProcessNewProcessInfo {
    pub pid: u32,
    pub process_name: Box<str>,
    pub matched_keyword: Option<Box<str>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessDebugInfo {
    /// 观察器是否运行中
    pub observer_running: bool,
    /// 运行时间（秒）
    pub uptime_secs: u64,
    /// 最后检查时间
    pub last_check_time: Box<str>,
    /// 轮询间隔（毫秒）
    pub poll_interval_ms: u64,
    /// 当前关键字表
    pub keywords: Vec<Box<str>>,
    /// 本轮检测到的新进程（仅保留少量用于排查）
    pub last_new_processes: Vec<ProcessNewProcessInfo>,
    /// 最近一次命中的进程启动事件
    pub last_matched: Option<ProcessStartEvent>,
    /// 已见过的 PID 数量
    pub seen_pid_count: usize,
    /// 当前快照中的 PID 数量
    pub current_pid_count: usize,
}

/// 缓存的调试信息
static CACHED_DEBUG_INFO: Mutex<Option<ProcessDebugInfo>> = Mutex::new(None);

/// 获取缓存的调试信息
pub fn get_cached_process_debug_info() -> Option<ProcessDebugInfo> {
    CACHED_DEBUG_INFO
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

fn update_cached_debug_info(info: ProcessDebugInfo) {
    if let Ok(mut guard) = CACHED_DEBUG_INFO.lock() {
        *guard = Some(info);
    }
}


// ========================================================================= //
// 观察器实现
// ========================================================================= //

pub struct ProcessObserver {
    event_tx: Option<mpsc::UnboundedSender<ProcessStartEvent>>,
    running: Arc<std::sync::atomic::AtomicBool>,
}

impl Default for ProcessObserver {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessObserver {
    pub fn new() -> Self {
        Self {
            event_tx: None,
            running: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    pub fn start(
        &mut self,
        app_handle: tauri::AppHandle,
    ) -> mpsc::UnboundedReceiver<ProcessStartEvent> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.event_tx = Some(tx.clone());
        self.running
            .store(true, std::sync::atomic::Ordering::SeqCst);

        let running = self.running.clone();
        let app_handle = app_handle.clone();

        std::thread::spawn(move || {
            #[cfg(target_os = "windows")]
            {
                Self::process_event_loop(app_handle, tx, running);
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = running;
                let _ = tx;
                eprintln!("[ProcessObserver] 进程监测仅支持 Windows 平台");
            }
        });

        rx
    }

    pub fn stop(&mut self) {
        self.running
            .store(false, std::sync::atomic::Ordering::SeqCst);
        self.event_tx = None;
    }

    // ---------------------------------------------------------------------

    #[cfg(target_os = "windows")]
    fn process_event_loop(
        app_handle: tauri::AppHandle,
        tx: mpsc::UnboundedSender<ProcessStartEvent>,
        running: Arc<std::sync::atomic::AtomicBool>,
    ) {
        use chrono::Local;
        use std::sync::atomic::Ordering;
        use std::time::{Duration, Instant};

        use crate::modules::event_manager::{emit_debug_update, DEBUG_EVENT_TYPE_PROCESS};

        let start_time = Instant::now();

        // 轮询间隔：尽量轻量，且可接受的响应速度
        let poll_interval = Duration::from_millis(900);
        let poll_interval_ms = poll_interval.as_millis() as u64;

        // 观察器启动时先做一次快照，把“已有进程”记为已见过，避免启动瞬间触发大量 work
        // 同时记录“已存在的进程名集合”，用于抑制同一应用启动时的多子进程重复触发。
        let initial = Self::enumerate_processes();
        let mut seen_pids: HashSet<u32> = HashSet::new();
        let mut prev_names: HashSet<String> = HashSet::new();
        for (pid, exe_name) in initial {
            seen_pids.insert(pid);
            prev_names.insert(exe_name.to_lowercase());
        }

        // 用于调试窗口展示
        let mut last_matched: Option<ProcessStartEvent> = None;
        let mut last_new_processes: Vec<ProcessNewProcessInfo> = Vec::new();


        // 初始快照也推送一次（让 debug 窗口有内容）
        {
            let keywords = PROCESS_KEYWORDS
                .read()
                .map(|g| g.clone())
                .unwrap_or_else(|poisoned| poisoned.into_inner().clone());

            let debug_info = ProcessDebugInfo {
                observer_running: running.load(Ordering::SeqCst),
                uptime_secs: 0,
                last_check_time: Local::now().format(TIME_FORMAT_SHORT).to_string().into(),
                poll_interval_ms,
                keywords,
                last_new_processes: Vec::new(),
                last_matched: None,
                seen_pid_count: seen_pids.len(),
                current_pid_count: seen_pids.len(),
            };


            let _ = emit_debug_update(&app_handle, DEBUG_EVENT_TYPE_PROCESS, &debug_info);
            update_cached_debug_info(debug_info);
        }

        while running.load(Ordering::SeqCst) {
            std::thread::sleep(poll_interval);
            if !running.load(Ordering::SeqCst) {
                break;
            }

            // 每轮重新枚举进程，构建当前 PID 集合与进程名集合
            let processes = Self::enumerate_processes();
            let mut current_pids: HashSet<u32> = HashSet::new();
            let mut current_names: HashSet<String> = HashSet::new();
            let mut new_processes: Vec<(u32, String, bool)> = Vec::new();

            for (pid, exe_name) in processes {
                current_pids.insert(pid);

                let name_key = exe_name.to_lowercase();
                current_names.insert(name_key.clone());

                if !seen_pids.contains(&pid) {
                    // 若该进程名在上一轮已存在，说明是同一应用启动过程/运行过程中新拉起的子进程，避免重复触发。
                    let name_was_present = prev_names.contains(&name_key);
                    new_processes.push((pid, exe_name, name_was_present));
                }
            }

            let current_pid_count = current_pids.len();

            // 更新上一轮状态
            seen_pids = current_pids;
            prev_names = current_names;


            // 本轮新增进程（用于 debug 展示，限制长度避免过大）
            last_new_processes.clear();

            // 逐个处理新增进程
            for (pid, exe_name, name_was_present) in new_processes {
                // 关键字为空时不做匹配，但仍记录到 debug（方便确认进程名/命中逻辑）
                let keywords_empty = PROCESS_KEYWORDS
                    .read()
                    .map(|g| g.is_empty())
                    .unwrap_or(true);

                let matched = if keywords_empty {
                    None
                } else {
                    should_trigger_for_process_name(&exe_name)
                };

                // 记录用于 debug
                last_new_processes.push(ProcessNewProcessInfo {
                    pid,
                    process_name: exe_name.clone().into_boxed_str(),
                    matched_keyword: matched.clone(),
                });
                if last_new_processes.len() > 12 {
                    last_new_processes.remove(0);
                }

                // 核心去重策略：同一应用名在本轮之前已经存在（例如 Chrome 启动时拉起多个子进程）
                // 则不再触发 work。
                if name_was_present {
                    continue;
                }

                if let Some(matched_keyword) = matched {
                    let event = ProcessStartEvent {
                        pid,
                        process_name: exe_name.into_boxed_str(),
                        matched_keyword,
                    };

                    last_matched = Some(event.clone());
                    let _ = tx.send(event);
                }
            }


            // 生成并推送 debug 信息（仿照 media_observer）
            let keywords = PROCESS_KEYWORDS
                .read()
                .map(|g| g.clone())
                .unwrap_or_else(|poisoned| poisoned.into_inner().clone());

            let uptime_secs = start_time.elapsed().as_secs();
            let debug_info = ProcessDebugInfo {
                observer_running: running.load(Ordering::SeqCst),
                uptime_secs,
                last_check_time: Local::now().format(TIME_FORMAT_SHORT).to_string().into(),
                poll_interval_ms,
                keywords,
                last_new_processes: last_new_processes.clone(),
                last_matched: last_matched.clone(),
                seen_pid_count: seen_pids.len(),

                current_pid_count,
            };

            let _ = emit_debug_update(&app_handle, DEBUG_EVENT_TYPE_PROCESS, &debug_info);
            update_cached_debug_info(debug_info);
        }
    }


    #[cfg(target_os = "windows")]
    fn snapshot_pids() -> HashSet<u32> {
        let mut set = HashSet::new();
        for (pid, _name) in Self::enumerate_processes() {
            set.insert(pid);
        }
        set
    }

    #[cfg(target_os = "windows")]
    fn snapshot_with_new(
        seen: &HashSet<u32>,
    ) -> (HashSet<u32>, Vec<(u32, String)>) {
        let mut current = HashSet::new();
        let mut new_processes = Vec::new();

        for (pid, name) in Self::enumerate_processes() {
            current.insert(pid);
            if !seen.contains(&pid) {
                new_processes.push((pid, name));
            }
        }

        (current, new_processes)
    }

    #[cfg(target_os = "windows")]
    fn enumerate_processes() -> Vec<(u32, String)> {
        use windows::Win32::Foundation::{CloseHandle, HANDLE};
        use windows::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };

        let mut out = Vec::new();

        unsafe {
            let snapshot: HANDLE = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
                Ok(h) => h,
                Err(_) => return out,
            };

            let mut entry = PROCESSENTRY32W::default();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

            let mut ok = Process32FirstW(snapshot, &mut entry).is_ok();
            while ok {
                let pid = entry.th32ProcessID;

                // szExeFile 是以 \0 结尾的 UTF-16 buffer
                let exe_name = {
                    let buf = &entry.szExeFile;
                    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
                    String::from_utf16_lossy(&buf[..len])
                };

                // 过滤空名称
                if !exe_name.is_empty() {
                    out.push((pid, exe_name));
                }

                ok = Process32NextW(snapshot, &mut entry).is_ok();
            }


            let _ = CloseHandle(snapshot);
        }

        out
    }
}
