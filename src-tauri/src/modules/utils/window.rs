//! 窗口控制与 DWM API 包装工具
//!
//! 兼容性说明：
//! - Windows Vista+: DWM API 可用（但 Windows 7 禁用 Aero 时可能不工作）
//! - 当 DWM 不可用时，回退到 GetWindowRect
//! - macOS/Linux: 占位实现，待跨平台适配

#[cfg(windows)]
use windows::Win32::Foundation::{HWND, RECT};
#[cfg(windows)]
use windows::Win32::Graphics::Dwm::*;

/// 获取窗口的"视觉边界"（剔除阴影等不可见区域）
///
/// 相比于 GetWindowRect，此方法能更准确地获取用户可见的窗口边缘
/// 
/// 兼容性说明：
/// - DWM 可用时使用 DwmGetWindowAttribute 获取精确边界
/// - DWM 不可用时（如 Windows 7 基本主题）回退到 GetWindowRect
#[cfg(windows)]
pub fn get_visual_window_rect(hwnd: HWND) -> RECT {
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

    let mut rect = RECT::default();
    
    // 尝试使用 DWM API（更精确）
    // SAFETY: `rect` 是有效的可写缓冲区，大小与传入的 cb 匹配。
    let dwm_result = unsafe {

        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut _ as *mut _,
            std::mem::size_of::<RECT>() as u32,
        )
    };

    // DWM API 失败时回退到 GetWindowRect
    // 这可能发生在 Windows 7 禁用 Aero 主题时
    if dwm_result.is_err() {
        // SAFETY: `hwnd` 为调用方提供的窗口句柄；`rect` 为有效可写缓冲区。
        unsafe {
            let _ = GetWindowRect(hwnd, &mut rect);
        }
    }


    rect
}

/// 检查 DWM 是否启用
/// 
/// 在 Windows Vista/7 上，用户可以禁用 Aero（DWM 组合）
/// Windows 8+ 始终启用 DWM
#[cfg(windows)]
pub fn is_dwm_composition_enabled() -> bool {
    use super::os_version::{get_windows_version, WindowsVersion};

    // Windows 8+ 始终启用 DWM
    if get_windows_version().is_at_least(&WindowsVersion::WIN8) {
        return true;
    }

    // Windows 7/Vista 需要检查
    // SAFETY: DwmIsCompositionEnabled 不要求额外指针参数，仅依赖系统状态。
    unsafe {
        if let Ok(enabled) = DwmIsCompositionEnabled() {
            return enabled.as_bool();
        }
    }

    false
}

/// 获取屏幕工作区域
#[cfg(windows)]
pub fn get_work_area() -> RECT {
    use windows::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPI_GETWORKAREA, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
    };
    let mut rect = RECT::default();
    // SAFETY: 传入的 rect 指针有效且可写，SPI_GETWORKAREA 会写入完整 RECT。
    unsafe {
        let _ = SystemParametersInfoW(

            SPI_GETWORKAREA,
            0,
            Some(&mut rect as *mut _ as *mut _),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        );
    }
    rect
}

// ========================================================================= //
// 非 Windows 平台占位
// ========================================================================= //

/// 非 Windows 平台的窗口视觉边界获取。
///
/// TODO(cross-platform): macOS — 使用 CGWindowListCopyWindowInfo 获取窗口边界；
///                        Linux — 使用 X11 XGetWindowAttributes 或 Wayland 协议。
///                        返回值类型需要从 RECT 泛化为跨平台的矩形结构体。
#[cfg(not(windows))]
pub fn get_visual_window_rect_non_windows(_window_id: u64) -> (i32, i32, i32, i32) {
    (0, 0, 0, 0) // (left, top, right, bottom)
}

/// 非 Windows 平台的窗口管理器合成检测。
///
/// TODO(cross-platform): macOS — 始终返回 true（Quartz Compositor 始终启用）；
///                        Linux — 检测是否运行在 Wayland 或 X11 合成器下。
#[cfg(not(windows))]
pub fn is_compositor_enabled_non_windows() -> bool {
    true
}

/// 非 Windows 平台获取屏幕工作区域（排除 Dock/面板的可用区域）。
///
/// TODO(cross-platform): macOS — 使用 NSScreen.visibleFrame；
///                        Linux — 使用 _NET_WORKAREA X11 属性。
#[cfg(not(windows))]
pub fn get_work_area_non_windows() -> (i32, i32, i32, i32) {
    (0, 0, 1920, 1080) // (left, top, right, bottom) — 降级默认值
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(windows)]
    fn get_work_area_returns_nonzero_rect() {
        let rect = get_work_area();
        assert!(rect.right > rect.left);
        assert!(rect.bottom > rect.top);
    }
}

