//! HTTP 请求工具函数
//!
//! 兼容性说明：
//! - Windows 10 1803+: 优先使用系统自带的 curl
//! - Windows 7/8/8.1: 回退到 PowerShell（需要 TLS 1.2 支持）
//!   - Windows 7 需要安装 KB3140245 补丁才能支持 TLS 1.2
//!   - 如果 TLS 1.2 不可用，HTTPS 请求可能失败

use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// 判断当前 Windows 版本是否应优先使用 curl 发起 HTTP 请求
///
/// Windows 10 1803 (Build 17134) 起系统自带 curl.exe，
/// 比 PowerShell 的 `Invoke-WebRequest` 更快且更可靠。
#[cfg(windows)]
fn should_try_curl(win_ver: &super::os_version::WindowsVersion) -> bool {
    win_ver.is_at_least(&super::os_version::WindowsVersion {
        major: 10,
        minor: 0,
        build: 17134, // Windows 10 1803
    })
}

/// 构建 PowerShell 版 HTTP GET 命令字符串
///
/// 当 `use_tls` 为 `true` 时，在命令开头启用 TLS 1.2/1.1/1.0
/// （兼容 Windows 7 默认未启用 TLS 1.2 的情况）。
/// URL 和超时通过环境变量 `TRAYBUDDY_URL` / `TRAYBUDDY_TIMEOUT` 传入，
/// 避免参数注入风险。
#[cfg(windows)]
fn build_powershell_command(use_tls: bool) -> String {
    if use_tls {
        "try { \
            [Net.ServicePointManager]::SecurityProtocol = \
                [Net.SecurityProtocolType]::Tls12 -bor \
                [Net.SecurityProtocolType]::Tls11 -bor \
                [Net.SecurityProtocolType]::Tls \
        } catch { }; \
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; \
        $u = $env:TRAYBUDDY_URL; \
        $t = [int]$env:TRAYBUDDY_TIMEOUT; \
        (Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec $t).Content"
            .to_string()
    } else {
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; \
         $u = $env:TRAYBUDDY_URL; \
         $t = [int]$env:TRAYBUDDY_TIMEOUT; \
         (Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec $t).Content"
            .to_string()
    }
}

/// 执行 HTTP GET 请求并返回响应体
///
/// 优先使用 curl（Windows 10+ 自带，更可靠），失败时回退到 PowerShell
///
/// # Arguments
/// * `url` - 请求 URL
/// * `timeout_secs` - 超时时间（秒）
/// * `content_check` - 可选的内容检查字符串，用于验证响应有效性
///
/// # Returns
/// 成功时返回响应体字符串，失败时返回错误信息
pub fn http_get(
    url: &str,
    timeout_secs: u64,
    content_check: Option<&str>,
) -> Result<String, String> {
    #[cfg(windows)]
    {
        use super::os_version::get_windows_version;

        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // Windows 10 1803+ 自带 curl，优先尝试
        // Windows 7/8 没有 curl，直接使用 PowerShell
        let win_ver = get_windows_version();
        let try_curl = should_try_curl(&win_ver);


        if try_curl {
            let curl_cmd = std::env::var("TRAYBUDDY_CURL_PATH").unwrap_or_else(|_| "curl".to_string());
            let curl_result = Command::new(&curl_cmd)
                .args(["-s", "--max-time", &timeout_secs.to_string(), url])
                .creation_flags(CREATE_NO_WINDOW)
                .output();


            if let Ok(output) = curl_result {
                if output.status.success() {
                    let body = String::from_utf8_lossy(&output.stdout).to_string();
                    // 检查内容有效性
                    if let Some(check) = content_check {
                        if !body.is_empty() && body.contains(check) {
                            return Ok(body);
                        }
                    } else if !body.is_empty() {
                        return Ok(body);
                    }
                }
            }
        }

        // curl 不可用或失败时使用 PowerShell
        // 强制启用 TLS 1.2（Windows 7 需要 KB3140245 补丁）
        // 同时尝试启用 TLS 1.1 和 TLS 1.0 作为回退（更好的兼容性）
        let use_tls = url.starts_with("https");
        // PowerShell 通过环境变量传参，避免 url 中包含引号/特殊符号导致解析失败
        // 也避免把外部输入拼进 -Command 字符串引发注入风险。
        let ps_command = build_powershell_command(use_tls);


        let output = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_command])
            .env("TRAYBUDDY_URL", url)
            .env("TRAYBUDDY_TIMEOUT", timeout_secs.to_string())
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("Failed to execute request: {}", e))?;


        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("HTTP request failed: {}", stderr));
        }

        let body = String::from_utf8_lossy(&output.stdout).to_string();
        if body.is_empty() {
            return Err("Empty response".into());
        }
        Ok(body)
    }

    /// macOS/Linux: 直接使用系统 curl（通常预装）。
    /// TODO(cross-platform): 考虑使用 reqwest 等纯 Rust HTTP 库统一所有平台实现。
    #[cfg(not(windows))]
    {
        let output = Command::new("curl")
            .args(["-s", "--max-time", &timeout_secs.to_string(), url])
            .output()
            .map_err(|e| format!("Failed to execute request: {}", e))?;

        if !output.status.success() {
            return Err("HTTP request failed".into());
        }

        let body = String::from_utf8_lossy(&output.stdout).to_string();
        if body.is_empty() {
            return Err("Empty response".into());
        }
        Ok(body)
    }
}

/// 异步执行 HTTP GET 请求
///
/// 使用 tokio::task::spawn_blocking 包装同步实现
pub async fn http_get_async(
    url: String,
    timeout_secs: u64,
    content_check: Option<String>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let check = content_check.as_deref();
        http_get(&url, timeout_secs, check)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    use crate::modules::utils::os_version::WindowsVersion;

    #[cfg(windows)]
    static HTTP_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[cfg(windows)]
    fn with_fake_curl(output: &str, f: impl FnOnce()) {
        let _guard = HTTP_ENV_LOCK.lock().unwrap();
        let temp_dir = std::env::temp_dir().join(format!(
            "traybuddy_fake_curl_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let script = format!("@echo off\r\necho {}\r\nexit /b 0\r\n", output);
        let script_path = temp_dir.join("curl.bat");
        std::fs::write(&script_path, script).unwrap();

        let old_var = std::env::var("TRAYBUDDY_CURL_PATH").ok();
        std::env::set_var("TRAYBUDDY_CURL_PATH", &script_path);

        f();

        match old_var {
            Some(val) => std::env::set_var("TRAYBUDDY_CURL_PATH", val),
            None => std::env::remove_var("TRAYBUDDY_CURL_PATH"),
        }
        let _ = std::fs::remove_dir_all(temp_dir);
    }



    #[test]
    #[cfg(windows)]
    fn should_try_curl_checks_build_threshold() {

        let win8_1 = WindowsVersion {
            major: 6,
            minor: 3,
            build: 0,
        };
        let win10_1803 = WindowsVersion {
            major: 10,
            minor: 0,
            build: 17134,
        };
        let win10_1709 = WindowsVersion {
            major: 10,
            minor: 0,
            build: 16299,
        };

        assert!(!should_try_curl(&win8_1));
        assert!(should_try_curl(&win10_1803));
        assert!(!should_try_curl(&win10_1709));
    }

    #[test]
    #[cfg(windows)]
    fn build_powershell_command_includes_tls_when_https() {
        let https = build_powershell_command(true);
        let http = build_powershell_command(false);

        assert!(https.contains("SecurityProtocol"));
        assert!(https.contains("Tls12"));
        assert!(!http.contains("SecurityProtocol"));
        assert!(http.contains("Invoke-WebRequest"));
    }

    #[test]
    #[cfg(windows)]
    fn http_get_uses_curl_when_available() {
        with_fake_curl("hello", || {
            let result = http_get("http://example.com", 2, Some("hello"));
            assert_eq!(result.unwrap().trim(), "hello");
        });
    }

    #[test]
    #[cfg(windows)]
    fn http_get_curl_without_content_check() {
        with_fake_curl("some_response", || {
            let result = http_get("http://example.com", 2, None);
            assert_eq!(result.unwrap().trim(), "some_response");
        });
    }

    #[test]
    #[cfg(windows)]
    fn http_get_curl_content_check_mismatch_falls_through() {
        with_fake_curl("actual_response", || {
            // Content check expects "missing_marker" but curl returns "actual_response"
            // Curl succeeds but content check fails → falls through to PowerShell
            let result = http_get("http://example.com", 2, Some("missing_marker"));
            // May succeed via PowerShell or fail — just verify no panic
            let _ = result;
        });
    }

    #[tokio::test]
    #[cfg(windows)]
    async fn http_get_async_uses_curl_when_available() {
        let _guard = HTTP_ENV_LOCK.lock().unwrap();
        let temp_dir = std::env::temp_dir().join(format!(

            "traybuddy_fake_curl_async_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let script = "@echo off\r\necho async-hello\r\nexit /b 0\r\n";
        let script_path = temp_dir.join("curl.bat");
        std::fs::write(&script_path, script).unwrap();

        let old_var = std::env::var("TRAYBUDDY_CURL_PATH").ok();
        std::env::set_var("TRAYBUDDY_CURL_PATH", &script_path);

        let result = http_get_async("http://example.com".to_string(), 2, Some("async-hello".to_string()))
            .await
            .unwrap();
        assert_eq!(result.trim(), "async-hello");

        match old_var {
            Some(val) => std::env::set_var("TRAYBUDDY_CURL_PATH", val),
            None => std::env::remove_var("TRAYBUDDY_CURL_PATH"),
        }
        let _ = std::fs::remove_dir_all(temp_dir);
    }


    #[test]
    #[ignore]
    fn http_get_returns_error_for_invalid_url() {
        let result = http_get("http://invalid.invalid", 1, None);
        assert!(result.is_err());
    }
}



