//! 窗口控制与 DWM API 包装工具

#[cfg(windows)]
use windows::Win32::Foundation::{HWND, RECT};
#[cfg(windows)]
use windows::Win32::Graphics::Dwm::*;

/// 获取窗口的“视觉边界”（剔除阴影等不可见区域）
///
/// 相比于 GetWindowRect，此方法能更准确地获取用户可见的窗口边缘
#[cfg(windows)]
pub fn get_visual_window_rect(hwnd: HWND) -> RECT {
    let mut rect = RECT::default();
    let _ = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut _ as *mut _,
            std::mem::size_of::<RECT>() as u32,
        )
    };
    rect
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
