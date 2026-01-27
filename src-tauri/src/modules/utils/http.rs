//! HTTP 请求工具函数

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
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // 优先使用 curl（Windows 10+ 自带，UTF-8 输出正常）
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

        // curl 失败时使用 PowerShell，并设置 UTF-8 编码
        let use_tls = url.starts_with("https");
        let ps_command = if use_tls {
            format!(
                "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; \
                 [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; \
                 (Invoke-WebRequest -Uri '{}' -UseBasicParsing -TimeoutSec {}).Content",
                url, timeout_secs
            )
        } else {
            format!(
                "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; \
                 (Invoke-WebRequest -Uri '{}' -UseBasicParsing -TimeoutSec {}).Content",
                url, timeout_secs
            )
        };

        let output = Command::new("powershell")
            .args(["-Command", &ps_command])
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
