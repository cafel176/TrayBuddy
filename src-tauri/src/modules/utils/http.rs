//! HTTP 请求工具函数
//!
//! 使用 reqwest 纯 Rust HTTP 库实现跨平台 HTTP 请求。

use std::time::Duration;

/// 执行 HTTP GET 请求并返回响应体
///
/// 使用 reqwest 阻塞客户端发送请求，跨平台通用。
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
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let body = client
        .get(url)
        .send()
        .map_err(|e| format!("HTTP request failed: {}", e))?
        .text()
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    if body.is_empty() {
        return Err("Empty response".into());
    }

    if let Some(check) = content_check {
        if !body.contains(check) {
            return Err(format!("Content check failed: expected '{}' not found", check));
        }
    }

    Ok(body)
}

/// 异步执行 HTTP GET 请求
///
/// 使用 reqwest 异步客户端发送请求。
pub async fn http_get_async(
    url: String,
    timeout_secs: u64,
    content_check: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let body = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    if body.is_empty() {
        return Err("Empty response".into());
    }

    if let Some(check) = content_check {
        if !body.contains(&check) {
            return Err(format!("Content check failed: expected '{}' not found", check));
        }
    }

    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore]
    fn http_get_returns_error_for_invalid_url() {
        let result = http_get("http://invalid.invalid", 1, None);
        assert!(result.is_err());
    }
}
