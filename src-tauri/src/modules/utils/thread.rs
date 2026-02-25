//! 线程命名/描述工具（用于调试与监控）

/// 给“当前线程”设置可读的描述。
///
/// - Windows: 使用 `SetThreadDescription`，能被 Process Explorer / 调试器等工具识别。
/// - 其他平台：无操作。
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

    #[cfg(not(target_os = "windows"))]
    {
        let _ = _desc;
    }
}
