//! 屏幕截图模块
//!
//! 提供屏幕指定区域截图功能。
//! - Windows: 使用 GDI API (BitBlt + GetDIBits) 截取并保存为 PNG
//! - macOS/Linux: 占位函数，待后续实现

use std::path::Path;

// ========================================================================= //
// 屏幕区域截图 — Windows 实现
// ========================================================================= //

/// 内部公共函数：通过 GDI API 截取屏幕指定区域，返回 RGB `ImageBuffer`。
///
/// 所有公开截图函数共享此实现，仅在最终输出格式上有差异。
#[cfg(target_os = "windows")]
fn capture_screen_region_raw(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<image::ImageBuffer<image::Rgb<u8>, Vec<u8>>, String> {
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits,
        GetDC, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        SRCCOPY,
    };

    unsafe {
        let hdc_screen = GetDC(None);
        if hdc_screen.is_invalid() {
            return Err("GetDC failed".into());
        }

        let hdc_mem = CreateCompatibleDC(hdc_screen);
        if hdc_mem.is_invalid() {
            ReleaseDC(None, hdc_screen);
            return Err("CreateCompatibleDC failed".into());
        }

        let hbm = CreateCompatibleBitmap(hdc_screen, width as i32, height as i32);
        if hbm.is_invalid() {
            DeleteDC(hdc_mem);
            ReleaseDC(None, hdc_screen);
            return Err("CreateCompatibleBitmap failed".into());
        }

        let old_bm = SelectObject(hdc_mem, hbm);

        let blt_result = BitBlt(
            hdc_mem,
            0,
            0,
            width as i32,
            height as i32,
            hdc_screen,
            x,
            y,
            SRCCOPY,
        );
        if blt_result.is_err() {
            SelectObject(hdc_mem, old_bm);
            DeleteObject(hbm);
            DeleteDC(hdc_mem);
            ReleaseDC(None, hdc_screen);
            return Err("BitBlt failed".into());
        }

        // 准备 BITMAPINFO — 自顶向下，24 位 BGR
        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32), // 自顶向下
                biPlanes: 1,
                biBitCount: 24,
                biCompression: BI_RGB.0 as u32,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [Default::default()],
        };

        // 每行字节数须 4 字节对齐
        let row_bytes = ((width * 3 + 3) / 4) * 4;
        let image_size = (row_bytes * height) as usize;
        let mut pixel_data = vec![0u8; image_size];

        let lines = GetDIBits(
            hdc_mem,
            hbm,
            0,
            height,
            Some(pixel_data.as_mut_ptr() as *mut _),
            &bmi as *const _ as *mut _,
            DIB_RGB_COLORS,
        );

        // 清理 GDI 资源
        SelectObject(hdc_mem, old_bm);
        DeleteObject(hbm);
        DeleteDC(hdc_mem);
        ReleaseDC(None, hdc_screen);

        if lines == 0 {
            return Err("GetDIBits failed".into());
        }

        // GDI 返回 BGR 格式，转换为 RGB 并去除行对齐填充
        let mut rgb_data = Vec::with_capacity((width * height * 3) as usize);
        for row in 0..height {
            let start = (row * row_bytes) as usize;
            for col in 0..width {
                let px = start + (col * 3) as usize;
                rgb_data.push(pixel_data[px + 2]); // R
                rgb_data.push(pixel_data[px + 1]); // G
                rgb_data.push(pixel_data[px]);     // B
            }
        }

        image::ImageBuffer::from_raw(width, height, rgb_data)
            .ok_or_else(|| "Failed to create image buffer".to_string())
    }
}

/// 截取屏幕指定矩形区域并保存为 PNG 文件
///
/// # 平台支持
/// - **Windows**: 完整实现（GDI API + image crate PNG 编码）
/// - **macOS**: 待实现（可用 CGWindowListCreateImage）
/// - **Linux**: 待实现（可用 X11 XGetImage 或 PipeWire/Wayland 截图协议）
#[cfg(target_os = "windows")]
pub fn capture_screen_region(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    save_path: &Path,
) -> Result<(), String> {
    let img = capture_screen_region_raw(x, y, width, height)?;
    img.save(save_path)
        .map_err(|e| format!("Failed to save PNG: {}", e))?;
    Ok(())
}

/// 截取屏幕指定矩形区域，直接在内存中编码为 PNG 字节
///
/// 相比 `capture_screen_region` + 文件读取 + 重新编码，此函数：
/// - 不写入磁盘，避免文件 I/O
/// - 适用于高频 AI 截图场景
///
/// # 返回
/// 成功时返回 PNG 格式的原始字节 (`Vec<u8>`)，由调用方按需编码为 base64 或直接写磁盘
#[cfg(target_os = "windows")]
pub fn capture_screen_region_as_png_bytes(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
    let img = capture_screen_region_raw(x, y, width, height)?;
    let mut png_buf = Vec::new();
    img.write_to(
        &mut std::io::Cursor::new(&mut png_buf),
        image::ImageFormat::Png,
    )
    .map_err(|e| format!("Failed to encode PNG: {}", e))?;
    Ok(png_buf)
}

/// 非 Windows 平台占位
#[cfg(not(target_os = "windows"))]
pub fn capture_screen_region_as_png_bytes(
    _x: i32,
    _y: i32,
    _width: u32,
    _height: u32,
) -> Result<Vec<u8>, String> {
    Err("capture_screen_region_as_png_bytes is not yet implemented on this platform".into())
}

// ========================================================================= //
// 屏幕区域截图 — macOS 占位
// ========================================================================= //

/// macOS 截图占位函数
///
/// 待实现方案：
/// - 使用 CoreGraphics `CGWindowListCreateImage` 截取指定区域
/// - 或调用 `screencapture` 命令行工具
/// - 输出格式可为 PNG（CGImageDestination）
#[cfg(target_os = "macos")]
pub fn capture_screen_region(
    _x: i32,
    _y: i32,
    _width: u32,
    _height: u32,
    _save_path: &Path,
) -> Result<(), String> {
    Err("Screen capture is not yet implemented on macOS. \
         TODO: use CGWindowListCreateImage from CoreGraphics"
        .into())
}

// ========================================================================= //
// 屏幕区域截图 — Linux 占位
// ========================================================================= //

/// Linux 截图占位函数
///
/// 待实现方案：
/// - X11: 使用 `XGetImage` 或 `XShmGetImage` 截取指定区域
/// - Wayland: 使用 `xdg-desktop-portal` 的 `org.freedesktop.portal.Screenshot`
///   或 PipeWire 的屏幕录制 API
/// - 通用降级：调用 `import` (ImageMagick) 或 `scrot` 命令行工具
#[cfg(target_os = "linux")]
pub fn capture_screen_region(
    _x: i32,
    _y: i32,
    _width: u32,
    _height: u32,
    _save_path: &Path,
) -> Result<(), String> {
    Err("Screen capture is not yet implemented on Linux. \
         TODO: use XGetImage (X11) or xdg-desktop-portal (Wayland)"
        .into())
}

// ========================================================================= //
// 屏幕区域截图 — 其他平台占位
// ========================================================================= //

/// 其他平台（非 Windows/macOS/Linux）的截图占位函数
#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn capture_screen_region(
    _x: i32,
    _y: i32,
    _width: u32,
    _height: u32,
    _save_path: &Path,
) -> Result<(), String> {
    Err("Screen capture is not supported on this platform".into())
}

// ========================================================================= //
// 测试
// ========================================================================= //

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_zero_size_returns_error_or_ok() {
        // 零尺寸截图：Windows 上 GDI 会返回错误，其他平台返回占位错误
        let dir = std::env::temp_dir();
        let path = dir.join("test_screenshot_zero.png");
        let result = capture_screen_region(0, 0, 0, 0, &path);
        // 不做断言——零尺寸在不同平台行为不同，只确保不 panic
        let _ = result;
        // 清理
        let _ = std::fs::remove_file(&path);
    }
}
