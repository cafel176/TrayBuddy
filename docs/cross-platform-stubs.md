# 跨平台占位函数清单

本文档列出了项目中所有为 macOS / Linux 预留的占位函数（stub），
便于后续逐个填充实际实现以完成跨平台适配。

> 标记说明：
> - **待实现** — 当前为空操作或返回默认值，需要填充真正的平台逻辑
> - **基本可用** — 已有简单实现，但可能需要进一步优化
> - **已完成** — 不需要额外工作

---

## 一、后端 Rust（src-tauri/）

### 1. 系统状态观察器 — `src/modules/system_observer.rs`

| 占位函数 | 状态 | 说明 |
|---------|------|------|
| `SystemObserver` 非 Windows 结构体 + impl | 待实现 | 非 Windows 平台独立的 struct + `new()`/`start()`/`stop()` 实现 |
| `SystemObserver::event_loop_non_windows()` | 待实现 | 当前为轮询降级策略，已调用 `is_fullscreen_busy_non_windows()`。macOS: NSWorkspace 通知监听前台应用切换；Linux: X11/Wayland/D-Bus 监听窗口焦点变化 |
| `SystemObserver::is_fullscreen_busy_non_windows()` | 待实现 | macOS: NSApplication.currentSystemPresentationOptions 检测全屏；Linux: _NET_WM_STATE_FULLSCREEN 属性检测 |
| `SystemObserver::get_foreground_process_name_non_windows()` | 待实现 | macOS: NSWorkspace.frontmostApplication.localizedName 或 NSRunningApplication.bundleIdentifier；Linux: X11 _NET_ACTIVE_WINDOW + /proc/[pid]/comm 或 Wayland 协议获取焦点窗口进程 |

### 2. 进程启动监测 — `src/modules/process_observer.rs`

| 占位函数 | 状态 | 说明 |
|---------|------|------|
| `ProcessObserver::process_event_loop_non_windows()` | 待实现 | macOS: NSWorkspace.didLaunchApplicationNotification；Linux: /proc 轮询或 netlink connector |
| `ProcessObserver::snapshot_pids_non_windows()` | 待实现 | 通过统一入口 `snapshot_pids()` 按平台分发。macOS: sysctl(KERN_PROC) 或 libproc；Linux: 遍历 /proc/[pid]/ |
| `ProcessObserver::enumerate_processes_non_windows()` | 待实现 | 通过统一入口 `enumerate_processes()` 按平台分发。macOS: proc_listallpids + proc_pidpath；Linux: /proc/[pid]/comm 或 /proc/[pid]/exe |
| `ProcessObserver::snapshot_pids()` | 已完成 | 统一入口函数，内部 `#[cfg]` 分发到 Windows / 非 Windows 实现 |
| `ProcessObserver::enumerate_processes()` | 已完成 | 统一入口函数，内部 `#[cfg]` 分发到 `enumerate_processes_windows()` / `enumerate_processes_non_windows()` |

### 3. 媒体播放监听 — `src/modules/media_observer.rs`

| 占位函数 | 状态 | 说明 |
|---------|------|------|
| `MediaObserver::start()` 中的平台分发 | 已完成 | `#[cfg(windows)]` / `#[cfg(not(windows))]` 分别调用不同签名的 `media_event_loop` |
| `MediaObserver::media_event_loop()` [非 Windows 分支] | 待实现 | macOS: MediaRemote.framework (MRMediaRemoteGetNowPlayingInfo)；Linux: D-Bus MPRIS2 协议 |
| `MediaObserver::get_combined_media_state_non_windows()` | 待实现 | macOS: MRMediaRemoteGetNowPlayingApplicationIsPlaying；Linux: MPRIS2 PlaybackStatus |
| `MediaObserver::get_combined_media_state_with_source_non_windows()` | 待实现 | 同上，额外返回应用名和曲目信息 |
| `MediaObserver::get_process_name_non_windows()` | 待实现 | macOS: proc_pidpath；Linux: /proc/[pid]/comm |

### 4. 窗口系统命令 — `src/commands/window_system_commands.rs`

| 占位函数 | 状态 | 说明 |
|---------|------|------|
| `is_left_mouse_down()` [非 Windows 分支] | 待实现 | macOS: CGEvent API 或 NSEvent.pressedMouseButtons；Linux: X11 XQueryPointer 或 libinput |
| `set_drag_end_tracking()` [非 Windows 分支] | 待实现 | macOS/Linux: 根据平台实现拖拽追踪 |
| `get_cursor_position()` [非 Windows 分支] | 待实现 | macOS: NSEvent.mouseLocation；Linux: X11 XQueryPointer 或 Wayland 指针协议 |
| `is_cursor_in_interact_area()` [非 Windows 分支] | 待实现 | 已复用 `get_cursor_position()` 及共享的 Canvas/气泡区域判断逻辑，当 `get_cursor_position` 实现后自动可用 |
| `open_path_non_windows()` | 基本可用 | macOS: `open -R`；Linux: `xdg-open` 父目录（无法直接选中文件） |

### 5. 通用命令 — `src/commands/mod.rs`

| 占位函数 | 状态 | 说明 |
|---------|------|------|
| `open_dir_non_windows()` | 基本可用 | macOS: `open`；Linux: `xdg-open` |
| `get_tray_position_non_windows()` | 待实现 | 已在 `get_tray_position()` 中通过 `#[cfg]` 分发调用。macOS: NSScreen.visibleFrame 推算 Dock 位置；Linux: _NET_WORKAREA X11 属性推算面板位置 |

### 6. 核心辅助逻辑 — `src/lib_helpers.rs`

| 占位函数 | 状态 | 说明 |
|---------|------|------|
| `start_global_input_hook()` [非 Windows 分支] | 待实现 | macOS: CGEventTap（需辅助功能权限）；Linux: XRecord 或 /dev/input |
| `is_user_logged_in_desktop()` [非 Windows 分支] | 待实现 | macOS: CGSessionCopyCurrentDictionary 检测锁屏；Linux: D-Bus org.freedesktop.login1 |
| `check_ai_tool_hotkey()` [macOS] | 待实现 | macOS: 依赖 `start_global_input_hook` 实现后获取按键事件，通过 CGEventTap / NSEvent addGlobalMonitorForEvents 接收全局键盘事件 |
| `check_ai_tool_hotkey()` [Linux] | 待实现 | Linux: 依赖 `start_global_input_hook` 实现后获取按键事件，通过 X11 XGrabKey / libinput / evdev 接收全局键盘事件 |
| `start_session_observer()` [非 Windows 分支] | 待实现 | macOS: NSDistributedNotificationCenter (screenIsLocked/Unlocked)；Linux: D-Bus Lock/Unlock 信号 |
| `start_background_services_non_windows()` | 基本可用 | 当各观察器的跨平台实现完成后可与 Windows 版统一 |
| `trigger_login_events_non_windows()` | 基本可用 | 同上 |

### 7. Mod 解密/子进程 — `src/modules/mod_archive.rs`

| 位置 | 状态 | 说明 |
|---------|------|------|
| `extract_sbuddy_crypto()` — 可执行文件命名 | 已完成 | 已通过 `cfg!(windows)` 区分 `.exe` 后缀 |
| `sbuddy_command()` — 隐藏控制台窗口 | 已完成 | 已通过 `#[cfg(windows)]` 设置 CREATE_NO_WINDOW |
| Unix 权限设置 | 已完成 | 已通过 `#[cfg(unix)]` 设置 chmod 0o755 |

### 8. 屏幕截图 — `src/modules/screenshot.rs`

| 占位函数 | 状态 | 说明 |
|---------|------|------|
| `capture_screen_region()` [Windows] | 已完成 | 使用 GDI API（GetDC → CreateCompatibleDC → BitBlt → GetDIBits）截取屏幕指定矩形区域，保存为 BMP 文件 |
| `capture_screen_region()` [macOS] | 待实现 | macOS: CoreGraphics `CGWindowListCreateImage` 截取指定区域，通过 `CGImageDestination` 保存为 PNG/BMP；或调用 `screencapture` 命令行工具 |
| `capture_screen_region()` [Linux] | 待实现 | X11: `XGetImage` 或 `XShmGetImage` 截取指定区域；Wayland: `xdg-desktop-portal` 的 `org.freedesktop.portal.Screenshot` 或 PipeWire 屏幕录制 API；通用降级: `import` (ImageMagick) 或 `scrot` 命令行 |

### 9. 工具模块 — `src/modules/utils/`

#### `os_version.rs`

| 占位函数 | 状态 | 说明 |
|---------|------|------|
| `get_windows_version()` [非 Windows 分支] | 待实现 | macOS: NSProcessInfo.operatingSystemVersion；Linux: /etc/os-release 或 uname。返回值类型需泛化为 OsVersion |
| `is_gsmtc_available()` [非 Windows 分支] | 已完成 | 非 Windows 返回 false（GSMTC 为 Windows 专有 API） |
| `is_legacy_windows()` [非 Windows 分支] | 已完成 | 非 Windows 返回 false |

#### `window.rs`

| 占位函数 | 状态 | 说明 |
|---------|------|------|
| `get_visual_window_rect_non_windows()` | 待实现 | 返回类型为 `(i32,i32,i32,i32)`（与 Windows 版 `RECT` 不同，无法统一入口）。macOS: CGWindowListCopyWindowInfo；Linux: X11 XGetWindowAttributes 或 Wayland |
| `is_compositor_enabled_non_windows()` | 待实现 | macOS: 始终 true；Linux: 检测 Wayland/X11 合成器 |
| `get_work_area_non_windows()` | 待实现 | macOS: NSScreen.visibleFrame；Linux: _NET_WORKAREA |

#### `http.rs`

| 占位函数 | 状态 | 说明 |
|---------|------|------|
| `http_get()` [非 Windows 分支] | 基本可用 | 已使用 curl（macOS/Linux 通常预装）；TODO: 考虑使用 reqwest 等纯 Rust HTTP 库统一 |

#### `thread.rs`

| 占位函数 | 状态 | 说明 |
|---------|------|------|
| `set_current_thread_description()` [非 Windows 分支] | 待实现 | macOS/Linux: pthread_setname_np（注意 15 字节限制） |

### 10. 环境信息 — `src/modules/environment.rs`

| 占位函数 | 状态 | 说明 |
|---------|------|------|
| `fallback_location_from_timezone()` [非 Windows 分支] | 基本可用 | 当前使用 $TZ 环境变量；macOS: NSTimeZone.localTimeZone；Linux: /etc/timezone |

### 11. 常量定义 — `src/modules/constants.rs`

| 位置 | 状态 | 说明 |
|---------|------|------|
| `SESSION_OBSERVER_POLL_INTERVAL_SECS` | 已完成 | 非 Windows 平台会话检测轮询间隔（2秒），被 `start_session_observer` 非 Windows 分支使用 |

### 12. 构建脚本 — `build.rs`

| 位置 | 状态 | 说明 |
|---------|------|------|
| `embed_manifest_for_tests()` | 已完成 | 已通过 `#[cfg(windows)]` 隔离 |
| `find_windows_sdk_tool()` | 已完成 | 已通过 `#[cfg(windows)]` 隔离 |
| `find_msvc_tool()` | 已完成 | 已通过 `#[cfg(windows)]` 隔离 |
| sbuddy-crypto 嵌入 | 已完成 | 已通过 `cfg!(windows)` 区分文件名 |

### 13. Mod 资源切换 — `src/commands/mod_resource_commands.rs`

| 位置 | 状态 | 说明 |
|---------|------|------|
| `trigger_login_events` 分支调用 | 已完成 | 已通过 `#[cfg]` 分别调用 Windows/非 Windows 版本 |

### 14. 条件导入 — 多文件

以下文件通过 `#[cfg(windows)]` 条件导入 Windows 专用模块（已完成，不需要额外工作）：

| 文件 | 导入内容 |
|------|---------|
| `src/lib.rs` | `std::os::windows::process::CommandExt` |
| `src/commands/mod.rs` | `std::os::windows::process::CommandExt` |
| `src/commands/window_system_commands.rs` | `std::os::windows::process::CommandExt` |

---

## 二、前端 TypeScript/Svelte（src/）

### 1. 资源 URL 构建 — `src/lib/utils/modAssetUrl.ts`

| 位置 | 状态 | 说明 |
|---------|------|------|
| `detectArchiveUrlPrefix()` | 已完成 | 通过 `convertFileSrc` 运行时探测平台 URL 格式 |
| `normalizePath()` — 反斜杠转正斜杠 | 已完成 | `replace(/\\/g, "/")` 对所有平台通用 |

### 2. 调试器组件 — `src/lib/components/ResourceManagerDebugger.svelte`

| 位置 | 状态 | 说明 |
|---------|------|------|
| `openAssetFile()` — 路径规范化 | 已完成 | 已修改为统一使用正斜杠，后端根据平台处理 |
| 路径显示 `split(/[\\/]/)` | 已完成 | 已兼容两种分隔符 |

### 3. 路径规范化工具函数

以下文件中的 `normalizeFsPath()` / `replace(/\\/g, "/")` 已是跨平台安全的写法：

- `src/lib/animation/PngRemixPlayer.ts` — `normalizeFsPath()`
- `src/lib/animation/Live2DPlayer.ts` — `normalizeFsPath()` 及多处路径拼接

---

## 三、构建与打包配置

### `tauri.conf.json`

| 位置 | 状态 | 说明 |
|---------|------|------|
| `targets: "nsis"` | 待实现 | macOS: 改为 dmg 或 app；Linux: 改为 deb/AppImage |
| 图标 `.ico` | 待实现 | macOS: 需要 .icns；Linux: 需要 .png |
| NSIS 安装配置 | 待实现 | macOS/Linux: 不适用，需对应平台的安装方式 |

### `Cargo.toml`

| 位置 | 状态 | 说明 |
|---------|------|------|
| `[target.'cfg(windows)'.dependencies]` — `windows` crate | 已完成 | 仅在 Windows 上编译 |
| `tokio` 在 Windows 依赖段 | 待确认 | 非 Windows 平台如需 tokio（用于 async 观察器），需移到通用依赖中 |

---

## 四、优先级建议

### P0 — 基础运行（应用能在 macOS/Linux 上启动和显示）
1. `tauri.conf.json` 打包目标和图标适配
2. `Cargo.toml` 中 `tokio` 依赖提到通用段
3. `get_cursor_position` / `is_left_mouse_down` — 鼠标交互核心

### P1 — 核心功能（动画显示、音频播放正常工作）
4. `start_session_observer` / `trigger_login_events` — 应用启动流程
5. `start_global_input_hook` — 全局键盘交互
6. `get_work_area_non_windows` / `get_tray_position_non_windows` — 窗口定位

### P2 — 增值功能（媒体联动、进程监测等高级功能）
7. `media_event_loop` — 媒体播放状态监听
8. `process_event_loop_non_windows` / `enumerate_processes_non_windows` — 进程监测
9. `event_loop_non_windows` / `is_fullscreen_busy_non_windows` — 全屏/免打扰

### P3 — 体验优化
10. `set_current_thread_description` — 线程命名（调试用）
11. `fallback_location_from_timezone` — 本地时区回退优化
12. `http_get` — 统一为纯 Rust HTTP 库
