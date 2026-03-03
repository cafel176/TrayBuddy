//! 线程命名/描述工具
//!
//! 为后台线程设置可读的描述文本，方便在 Process Explorer、调试器等
//! 工具中快速识别各线程用途。
//!
//! 平台支持：
//! - Windows: 使用 `SetThreadDescription` API（Win10 1607+）
//! - macOS/Linux: 暂为空操作（`pthread_setname_np` 有 15 字节限制）

/// 给"当前线程"设置可读的描述。
///
/// - Windows: 使用 `SetThreadDescription`，能被 Process Explorer / 调试器等工具识别。
/// - macOS/Linux: 使用 pthread_setname_np。
///
/// TODO(cross-platform): macOS/Linux 的 pthread_setname_np 有 16 字节长度限制，
///                        可能需要截断或缩写描述文本。
#[inline]
pub fn set_current_thread_description(_desc: &str) {
    #[cfg(target_os = "windows")]
    {
        use windows::core::PCWSTR;
        use windows::Win32::System::Threading::{GetCurrentThread, SetThreadDescription};

        // SetThreadDescription 需要 UTF-16 且以 \0 结尾
        let mut w: Vec<u16> = _desc.encode_utf16().collect();
        w.push(0);

        unsafe {
            let _ = SetThreadDescription(GetCurrentThread(), PCWSTR::from_raw(w.as_ptr()));
        }
    }

    /// macOS/Linux: 使用 pthread_setname_np 设置线程名（最多 15 字节 + NUL）。
    #[cfg(not(target_os = "windows"))]
    {
        // pthread_setname_np 在 Rust 中可通过 std::thread::current().name() 设置，
        // 但需要在 thread::Builder::name() 时指定。这里暂为空操作。
        let _ = _desc;
    }
}
