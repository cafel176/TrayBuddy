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
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// 启动一个简易 HTTP 服务器，返回绑定的地址和监听器
    /// 每次只处理一个请求，响应固定的 body
    fn start_mock_server(response_body: &str) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("http://{}", addr);
        let body = response_body.to_string();

        let handle = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: text/plain\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });

        (url, handle)
    }

    /// 启动返回空响应体的 mock 服务器
    fn start_empty_body_server() -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("http://{}", addr);

        let handle = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                let response =
                    "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nContent-Type: text/plain\r\n\r\n";
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });

        (url, handle)
    }

    // ===================================================================== //
    // http_get — 成功场景
    // ===================================================================== //

    #[test]
    fn http_get_success_no_content_check() {
        let (url, handle) = start_mock_server("hello world");
        let result = http_get(&url, 5, None);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "hello world");
        let _ = handle.join();
    }

    #[test]
    fn http_get_success_with_content_check_pass() {
        let (url, handle) = start_mock_server("hello world");
        let result = http_get(&url, 5, Some("hello"));
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "hello world");
        let _ = handle.join();
    }

    #[test]
    fn http_get_success_with_content_check_fail() {
        let (url, handle) = start_mock_server("hello world");
        let result = http_get(&url, 5, Some("foobar"));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Content check failed"));
        assert!(err.contains("foobar"));
        let _ = handle.join();
    }

    // ===================================================================== //
    // http_get — 错误场景
    // ===================================================================== //

    #[test]
    fn http_get_returns_error_for_invalid_url() {
        let result = http_get("http://127.0.0.1:1", 1, None);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("HTTP request failed"));
    }

    #[test]
    fn http_get_returns_error_for_empty_response() {
        let (url, handle) = start_empty_body_server();
        let result = http_get(&url, 5, None);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Empty response");
        let _ = handle.join();
    }

    #[test]
    fn http_get_timeout_returns_error() {
        // 绑定端口但不 accept，让请求超时
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("http://{}", addr);

        let result = http_get(&url, 1, None);
        assert!(result.is_err());
        drop(listener);
    }

    // ===================================================================== //
    // http_get_async — 成功场景
    // ===================================================================== //

    #[tokio::test]
    async fn http_get_async_success_no_content_check() {
        let (url, handle) = start_mock_server("async hello");
        let result = http_get_async(url, 5, None).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "async hello");
        let _ = handle.join();
    }

    #[tokio::test]
    async fn http_get_async_success_with_content_check_pass() {
        let (url, handle) = start_mock_server("async hello");
        let result = http_get_async(url, 5, Some("async".to_string())).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "async hello");
        let _ = handle.join();
    }

    #[tokio::test]
    async fn http_get_async_success_with_content_check_fail() {
        let (url, handle) = start_mock_server("async hello");
        let result = http_get_async(url, 5, Some("missing".to_string())).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Content check failed"));
        assert!(err.contains("missing"));
        let _ = handle.join();
    }

    // ===================================================================== //
    // http_get_async — 错误场景
    // ===================================================================== //

    #[tokio::test]
    async fn http_get_async_returns_error_for_invalid_url() {
        let result = http_get_async("http://127.0.0.1:1".to_string(), 1, None).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("HTTP request failed"));
    }

    #[tokio::test]
    async fn http_get_async_returns_error_for_empty_response() {
        let (url, handle) = start_empty_body_server();
        let result = http_get_async(url, 5, None).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Empty response");
        let _ = handle.join();
    }

    #[tokio::test]
    async fn http_get_async_timeout_returns_error() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("http://{}", addr);

        let result = http_get_async(url, 1, None).await;
        assert!(result.is_err());
        drop(listener);
    }

    // ===================================================================== //
    // http_get — 多种 body 内容
    // ===================================================================== //

    #[test]
    fn http_get_returns_json_body() {
        let json_body = r#"{"key":"value","num":42}"#;
        let (url, handle) = start_mock_server(json_body);
        let result = http_get(&url, 5, Some("key"));
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), json_body);
        let _ = handle.join();
    }

    #[test]
    fn http_get_returns_unicode_body() {
        let unicode_body = "你好世界 🌍";
        let (url, handle) = start_mock_server(unicode_body);
        let result = http_get(&url, 5, Some("你好"));
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), unicode_body);
        let _ = handle.join();
    }

    #[test]
    fn http_get_content_check_with_empty_string() {
        let (url, handle) = start_mock_server("some body");
        // 空字符串总是包含在任何字符串中
        let result = http_get(&url, 5, Some(""));
        assert!(result.is_ok());
        let _ = handle.join();
    }
}
