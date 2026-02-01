//! 窗口控制与 DWM API 包装工具
//!
//! 兼容性说明：
//! - Windows Vista+: DWM API 可用（但 Windows 7 禁用 Aero 时可能不工作）
//! - 当 DWM 不可用时，回退到 GetWindowRect

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
