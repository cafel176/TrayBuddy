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
        use super::os_version::{get_windows_version, WindowsVersion};

        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // Windows 10 1803+ 自带 curl，优先尝试
        // Windows 7/8 没有 curl，直接使用 PowerShell
        let win_ver = get_windows_version();
        let try_curl = win_ver.is_at_least(&WindowsVersion {
            major: 10,
            minor: 0,
            build: 17134, // Windows 10 1803
        });

        if try_curl {
            let curl_result = Command::new("curl")
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
        let ps_command = if use_tls {
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
        };

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
