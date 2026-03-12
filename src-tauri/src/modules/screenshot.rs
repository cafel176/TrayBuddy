//! 屏幕截图模块
//!
//! 提供屏幕指定区域截图功能。
//! - Windows: 使用 GDI API (BitBlt + GetDIBits) 截取并保存为 PNG
//! - macOS/Linux: 占位函数，待后续实现

use std::path::Path;
use std::sync::Mutex;

// ========================================================================= //
// 屏幕区域截图 — Windows 实现
// ========================================================================= //

/// GDI 截图全局互斥锁，确保多线程不会并发调用 GDI API 导致堆损坏
#[cfg(target_os = "windows")]
static GDI_CAPTURE_LOCK: Mutex<()> = Mutex::new(());

/// 内部公共函数：通过 GDI API 截取屏幕指定区域，返回 RGB `ImageBuffer`。
///
/// 所有公开截图函数共享此实现，仅在最终输出格式上有差异。
/// 通过 `GDI_CAPTURE_LOCK` 保证同一时刻只有一个线程执行 GDI 操作。
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

    // 零尺寸保护：避免 GDI API 传入无效参数导致未定义行为
    if width == 0 || height == 0 {
        return Err("Cannot capture zero-size region".into());
    }

    // 每行字节数须 4 字节对齐（提前计算，用于 biSizeImage 和缓冲区分配）
    let row_bytes = ((width as usize) * 3 + 3) / 4 * 4;
    let image_size = row_bytes * (height as usize);

    // 获取 GDI 互斥锁，防止多线程并发调用 GDI API 导致堆损坏
    let _gdi_guard = GDI_CAPTURE_LOCK.lock().unwrap_or_else(|e| e.into_inner());

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
        // 注意：必须声明为 mut，因为 GetDIBits 会写入 biSizeImage 等字段
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32), // 自顶向下
                biPlanes: 1,
                biBitCount: 24,
                biCompression: BI_RGB.0 as u32,
                biSizeImage: image_size as u32, // 显式指定，避免 GDI 自行计算
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [Default::default()],
        };

        let mut pixel_data = vec![0u8; image_size];

        let lines = GetDIBits(
            hdc_mem,
            hbm,
            0,
            height,
            Some(pixel_data.as_mut_ptr() as *mut _),
            &mut bmi,
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
        let mut rgb_data = Vec::with_capacity((width as usize) * (height as usize) * 3);
        for row in 0..height as usize {
            let start = row * row_bytes;
            for col in 0..width as usize {
                let px = start + col * 3;
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

    // ===================================================================== //
    // capture_screen_region — 基本 smoke 测试
    // ===================================================================== //

    /// Smoke test: capture_screen_region with various inputs must not panic.
    /// Actual results are platform-dependent (Windows GDI vs stub), so only
    /// panics and crashes are treated as failures.
    #[test]
    fn capture_screen_region_smoke() {
        let dir = std::env::temp_dir();

        // zero size
        let p0 = dir.join("test_screenshot_zero.png");
        let _ = capture_screen_region(0, 0, 0, 0, &p0);
        let _ = std::fs::remove_file(&p0);

        // normal 1×1
        let p1 = dir.join("test_screenshot_1x1.png");
        let _ = capture_screen_region(0, 0, 1, 1, &p1);
        let _ = std::fs::remove_file(&p1);

        // invalid save path
        let _ = capture_screen_region(0, 0, 10, 10, Path::new("/nonexistent_dir_12345/screenshot.png"));

        // large out-of-bounds coordinates
        let p2 = dir.join("test_screenshot_large_coords.png");
        let _ = capture_screen_region(99999, 99999, 10, 10, &p2);
        let _ = std::fs::remove_file(&p2);
    }

    /// Smoke test: capture_screen_region_as_png_bytes with various inputs must not panic.
    #[test]
    fn capture_png_bytes_smoke() {
        let _ = capture_screen_region_as_png_bytes(0, 0, 0, 0);
        let _ = capture_screen_region_as_png_bytes(0, 0, 1, 1);
    }

    // ===================================================================== //
    // capture_screen_region — 零尺寸
    // ===================================================================== //

    #[test]
    fn capture_screen_region_zero_width() {
        let dir = std::env::temp_dir();
        let path = dir.join("test_zero_width.png");
        let result = capture_screen_region(0, 0, 0, 100, &path);
        // 零宽度应返回错误
        assert!(result.is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn capture_screen_region_zero_height() {
        let dir = std::env::temp_dir();
        let path = dir.join("test_zero_height.png");
        let result = capture_screen_region(0, 0, 100, 0, &path);
        // 零高度应返回错误
        assert!(result.is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn capture_screen_region_both_zero() {
        let dir = std::env::temp_dir();
        let path = dir.join("test_both_zero.png");
        let result = capture_screen_region(0, 0, 0, 0, &path);
        assert!(result.is_err());
        let _ = std::fs::remove_file(&path);
    }

    // ===================================================================== //
    // capture_screen_region — 负坐标
    // ===================================================================== //

    #[test]
    fn capture_screen_region_negative_coords() {
        let dir = std::env::temp_dir();
        let path = dir.join("test_neg_coords.png");
        // 负坐标不应 panic（可能在多显示器环境中有效）
        let _ = capture_screen_region(-100, -100, 10, 10, &path);
        let _ = std::fs::remove_file(&path);
    }

    // ===================================================================== //
    // capture_screen_region — 实际截图验证（仅 Windows）
    // ===================================================================== //

    #[test]
    #[cfg(target_os = "windows")]
    fn capture_screen_region_produces_valid_png_on_windows() {
        let dir = std::env::temp_dir();
        let path = dir.join("test_valid_png.png");
        let result = capture_screen_region(0, 0, 2, 2, &path);

        if result.is_ok() {
            // 验证文件存在且非空
            let metadata = std::fs::metadata(&path);
            assert!(metadata.is_ok());
            assert!(metadata.unwrap().len() > 0);
        }
        let _ = std::fs::remove_file(&path);
    }

    // ===================================================================== //
    // capture_screen_region_as_png_bytes — 零尺寸
    // ===================================================================== //

    #[test]
    fn capture_png_bytes_zero_width() {
        let result = capture_screen_region_as_png_bytes(0, 0, 0, 100);
        assert!(result.is_err());
    }

    #[test]
    fn capture_png_bytes_zero_height() {
        let result = capture_screen_region_as_png_bytes(0, 0, 100, 0);
        assert!(result.is_err());
    }

    #[test]
    fn capture_png_bytes_both_zero() {
        let result = capture_screen_region_as_png_bytes(0, 0, 0, 0);
        assert!(result.is_err());
    }

    // ===================================================================== //
    // capture_screen_region_as_png_bytes — 负坐标
    // ===================================================================== //

    #[test]
    fn capture_png_bytes_negative_coords() {
        let _ = capture_screen_region_as_png_bytes(-50, -50, 10, 10);
    }

    // ===================================================================== //
    // capture_screen_region_as_png_bytes — 大尺寸
    // ===================================================================== //

    #[test]
    fn capture_png_bytes_large_coords() {
        // 超出屏幕范围但不应 panic
        let _ = capture_screen_region_as_png_bytes(99999, 99999, 10, 10);
    }

    // ===================================================================== //
    // capture_screen_region_as_png_bytes — 有效截图（仅 Windows）
    // ===================================================================== //

    #[test]
    #[cfg(target_os = "windows")]
    fn capture_png_bytes_returns_valid_png_on_windows() {
        let result = capture_screen_region_as_png_bytes(0, 0, 2, 2);
        if let Ok(bytes) = result {
            // PNG 文件以 0x89 0x50 0x4E 0x47 开头
            assert!(bytes.len() >= 8);
            assert_eq!(&bytes[0..4], &[0x89, 0x50, 0x4E, 0x47]);
        }
    }

    // ===================================================================== //
    // capture_screen_region — 无效路径
    // ===================================================================== //

    #[test]
    fn capture_screen_region_invalid_dir() {
        let result = capture_screen_region(
            0,
            0,
            10,
            10,
            Path::new("/this/path/does/not/exist/screenshot.png"),
        );
        // 非零尺寸 + 无效路径：在 Windows 上会截图成功但保存失败
        // 在非 Windows 上截图本身就会失败（平台占位）
        assert!(result.is_err());
    }

    #[test]
    fn capture_screen_region_empty_path() {
        let result = capture_screen_region(0, 0, 10, 10, Path::new(""));
        assert!(result.is_err());
    }

    // ===================================================================== //
    // capture_screen_region — 非 Windows 平台占位验证
    // ===================================================================== //

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn capture_screen_region_returns_error_on_non_windows() {
        let dir = std::env::temp_dir();
        let path = dir.join("test_non_windows.png");
        let result = capture_screen_region(0, 0, 10, 10, &path);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("not yet implemented") || err.contains("not supported"));
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn capture_png_bytes_returns_error_on_non_windows() {
        let result = capture_screen_region_as_png_bytes(0, 0, 10, 10);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("not yet implemented") || err.contains("not supported"));
    }

    // ===================================================================== //
    // GDI_CAPTURE_LOCK — 互斥锁可用性（仅 Windows）
    // ===================================================================== //

    #[test]
    #[cfg(target_os = "windows")]
    fn gdi_capture_lock_is_lockable() {
        let guard = GDI_CAPTURE_LOCK.lock();
        assert!(guard.is_ok());
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn gdi_capture_lock_does_not_deadlock_on_relock() {
        // 先获取锁再释放，然后再次获取
        {
            let _g = GDI_CAPTURE_LOCK.lock().unwrap();
        }
        {
            let _g = GDI_CAPTURE_LOCK.lock().unwrap();
        }
    }

    // ===================================================================== //
    // capture_screen_region — 小尺寸（1x1）
    // ===================================================================== //

    #[test]
    fn capture_screen_region_1x1() {
        let dir = std::env::temp_dir();
        let path = dir.join("test_1x1_capture.png");
        let _ = capture_screen_region(0, 0, 1, 1, &path);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn capture_png_bytes_1x1() {
        let _ = capture_screen_region_as_png_bytes(0, 0, 1, 1);
    }

    // ===================================================================== //
    // capture_screen_region — 各种尺寸
    // ===================================================================== //

    #[test]
    fn capture_screen_region_small_sizes() {
        let dir = std::env::temp_dir();
        for (w, h) in &[(2, 2), (3, 1), (1, 3), (4, 4), (10, 10)] {
            let path = dir.join(format!("test_{}x{}.png", w, h));
            let _ = capture_screen_region(0, 0, *w, *h, &path);
            let _ = std::fs::remove_file(&path);
        }
    }

    #[test]
    fn capture_png_bytes_various_sizes() {
        for (w, h) in &[(2, 2), (3, 1), (1, 3), (4, 4), (10, 10)] {
            let _ = capture_screen_region_as_png_bytes(0, 0, *w, *h);
        }
    }

    // ===================================================================== //
    // 行对齐验证（仅 Windows）
    // ===================================================================== //

    #[test]
    #[cfg(target_os = "windows")]
    fn capture_screen_region_alignment_widths() {
        // 测试非 4 字节对齐的宽度（BGR 3 bytes/pixel 时需要行填充）
        let dir = std::env::temp_dir();
        for w in &[1u32, 2, 3, 5, 7, 11, 13, 15] {
            let path = dir.join(format!("test_align_{}.png", w));
            let _ = capture_screen_region(0, 0, *w, 2, &path);
            let _ = std::fs::remove_file(&path);
        }
    }
}
