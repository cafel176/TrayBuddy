//! Windows 版本检测工具
//!
//! 提供 Windows 版本检测功能，用于兼容性判断：
//! - Windows 7 (6.1)
//! - Windows 8 (6.2)
//! - Windows 8.1 (6.3)
//! - Windows 10 (10.0)
//! - Windows 11 (10.0, Build >= 22000)

/// Windows 版本信息
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowsVersion {
    /// 主版本号
    pub major: u32,
    /// 次版本号
    pub minor: u32,
    /// 构建号
    pub build: u32,
}

impl WindowsVersion {
    /// Windows 7
    pub const WIN7: WindowsVersion = WindowsVersion {
        major: 6,
        minor: 1,
        build: 0,
    };
    /// Windows 8
    pub const WIN8: WindowsVersion = WindowsVersion {
        major: 6,
        minor: 2,
        build: 0,
    };
    /// Windows 8.1
    pub const WIN8_1: WindowsVersion = WindowsVersion {
        major: 6,
        minor: 3,
        build: 0,
    };
    /// Windows 10
    pub const WIN10: WindowsVersion = WindowsVersion {
        major: 10,
        minor: 0,
        build: 0,
    };
    /// Windows 10 1809 (Build 17763) - GSMTC API 可用的最低版本
    pub const WIN10_1809: WindowsVersion = WindowsVersion {
        major: 10,
        minor: 0,
        build: 17763,
    };
    /// Windows 11 (Build 22000)
    pub const WIN11: WindowsVersion = WindowsVersion {
        major: 10,
        minor: 0,
        build: 22000,
    };

    /// 检查当前版本是否大于等于指定版本
    pub fn is_at_least(&self, other: &WindowsVersion) -> bool {
        if self.major != other.major {
            return self.major > other.major;
        }
        if self.minor != other.minor {
            return self.minor > other.minor;
        }
        self.build >= other.build
    }

    /// 检查是否为 Windows 7
    pub fn is_win7(&self) -> bool {
        self.major == 6 && self.minor == 1
    }

    /// 检查是否为 Windows 8
    pub fn is_win8(&self) -> bool {
        self.major == 6 && self.minor == 2
    }

    /// 检查是否为 Windows 8.1
    pub fn is_win8_1(&self) -> bool {
        self.major == 6 && self.minor == 3
    }

    /// 检查是否为 Windows 10 或更高
    pub fn is_win10_or_later(&self) -> bool {
        self.major >= 10
    }

    /// 检查是否为 Windows 11
    pub fn is_win11(&self) -> bool {
        self.major == 10 && self.minor == 0 && self.build >= 22000
    }
}

/// 缓存的 Windows 版本
static CACHED_VERSION: std::sync::OnceLock<WindowsVersion> = std::sync::OnceLock::new();

/// 获取当前 Windows 版本
///
/// 结果会被缓存，多次调用只会检测一次
#[cfg(windows)]
pub fn get_windows_version() -> WindowsVersion {
    *CACHED_VERSION.get_or_init(|| {
        detect_windows_version().unwrap_or(WindowsVersion::WIN10)
    })
}

/// 获取当前操作系统版本（非 Windows 平台返回默认值）
///
/// TODO(cross-platform): macOS — 使用 NSProcessInfo.operatingSystemVersion 获取版本号；
///                        Linux — 读取 /etc/os-release 或 uname。
///                        返回值类型可能需要泛化为统一的 OsVersion 枚举。
#[cfg(not(windows))]
pub fn get_windows_version() -> WindowsVersion {
    WindowsVersion::WIN10
}




/// 检测 Windows 版本
#[cfg(windows)]
fn detect_windows_version() -> Option<WindowsVersion> {
    use std::mem::MaybeUninit;

    // 使用 RtlGetVersion 获取真实版本（绕过兼容性 shim）
    #[repr(C)]
    #[allow(non_snake_case)]
    struct OSVERSIONINFOEXW {
        dwOSVersionInfoSize: u32,
        dwMajorVersion: u32,
        dwMinorVersion: u32,
        dwBuildNumber: u32,
        dwPlatformId: u32,
        szCSDVersion: [u16; 128],
        wServicePackMajor: u16,
        wServicePackMinor: u16,
        wSuiteMask: u16,
        wProductType: u8,
        wReserved: u8,
    }

    type RtlGetVersionFn = unsafe extern "system" fn(*mut OSVERSIONINFOEXW) -> i32;

    // SAFETY: 
    // - `GetModuleHandleW` 返回的 ntdll 句柄在进程生命周期内有效。
    // - `GetProcAddress` 获取的符号指针对应 RtlGetVersion，签名与 RtlGetVersionFn 匹配。
    // - `info` 通过 `MaybeUninit::zeroed()` 分配，且在调用前设置 size 字段，
    //   FFI 会完整写入结构体，随后可安全 `assume_init()`。
    unsafe {
        let ntdll = windows::Win32::System::LibraryLoader::GetModuleHandleW(

            windows::core::w!("ntdll.dll"),
        )
        .ok()?;

        let proc_addr = windows::Win32::System::LibraryLoader::GetProcAddress(
            ntdll,
            windows::core::s!("RtlGetVersion"),
        )?;

        let rtl_get_version: RtlGetVersionFn = std::mem::transmute(proc_addr);

        let mut info = MaybeUninit::<OSVERSIONINFOEXW>::zeroed();
        let info_ptr = info.as_mut_ptr();
        (*info_ptr).dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOEXW>() as u32;

        let status = rtl_get_version(info_ptr);
        if status == 0 {
            // STATUS_SUCCESS
            let info = info.assume_init();
            Some(WindowsVersion {
                major: info.dwMajorVersion,
                minor: info.dwMinorVersion,
                build: info.dwBuildNumber,
            })
        } else {
            None
        }
    }
}

/// 检查 GSMTC API 是否可用（需要 Windows 10 1809+）
pub fn is_gsmtc_available() -> bool {
    #[cfg(windows)]
    {
        get_windows_version().is_at_least(&WindowsVersion::WIN10_1809)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// 检查是否为 Windows 7/8（需要特殊的锁屏检测逻辑）
pub fn is_legacy_windows() -> bool {
    #[cfg(windows)]
    {
        let ver = get_windows_version();
        ver.is_win7() || ver.is_win8() || ver.is_win8_1()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_comparison() {
        let win7 = WindowsVersion::WIN7;
        let win10 = WindowsVersion::WIN10;
        let win10_1809 = WindowsVersion::WIN10_1809;
        let win11 = WindowsVersion::WIN11;

        assert!(win10.is_at_least(&win7));
        assert!(win10_1809.is_at_least(&win10));
        assert!(win11.is_at_least(&win10_1809));
        assert!(!win7.is_at_least(&win10));
    }

    #[test]
    fn test_version_identification() {
        assert!(WindowsVersion::WIN7.is_win7());
        assert!(WindowsVersion::WIN8.is_win8());
        assert!(WindowsVersion::WIN8_1.is_win8_1());
        assert!(WindowsVersion::WIN10.is_win10_or_later());
        assert!(WindowsVersion::WIN11.is_win11());
    }

    #[test]
    fn helper_checks_cover_versions() {
        let win7 = WindowsVersion::WIN7;
        let win8 = WindowsVersion::WIN8;
        let win8_1 = WindowsVersion::WIN8_1;
        let win10 = WindowsVersion::WIN10;
        let win11 = WindowsVersion::WIN11;

        assert!(win7.is_win7());
        assert!(!win7.is_win10_or_later());
        assert!(win8.is_win8());
        assert!(!win8.is_win8_1());
        assert!(win8_1.is_win8_1());
        assert!(win10.is_win10_or_later());
        assert!(win11.is_win11());
        assert!(win11.is_at_least(&win10));
        assert!(!win10.is_at_least(&win11));
    }

    #[test]
    fn runtime_helpers_match_version_checks() {
        let current = get_windows_version();
        assert!(current.major >= 6);

        let expected_gsmtc = current.is_at_least(&WindowsVersion::WIN10_1809);
        assert_eq!(is_gsmtc_available(), expected_gsmtc);

        let expected_legacy = current.is_win7() || current.is_win8() || current.is_win8_1();
        assert_eq!(is_legacy_windows(), expected_legacy);
    }
}

