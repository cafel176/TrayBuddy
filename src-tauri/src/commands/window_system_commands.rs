//! 窗口与系统命令

use crate::app_state::AppState;
use crate::set_drag_tracking_enabled;

use crate::modules::constants::{
    ANIMATION_AREA_HEIGHT, ANIMATION_AREA_WIDTH, BUBBLE_AREA_HEIGHT, BUBBLE_AREA_WIDTH,
    WINDOW_LABEL_ANIMATION, WINDOW_LABEL_LIVE2D, WINDOW_LABEL_PNGREMIX, WINDOW_LABEL_THREED,
};
use crate::modules::event_manager::{emit, events};
use tauri::{AppHandle, LogicalSize, Manager, State};


#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// ========================================================================= //
// 窗口和系统命令
// ========================================================================= //

/// 设置窗口鼠标穿透状态
///
/// 当 ignore 为 true 时，窗口不响应鼠标事件，鼠标可穿透到下层
/// 同时适配 animation 窗口和 live2d 窗口
#[tauri::command]
pub(crate) fn set_ignore_cursor_events(ignore: bool, app: AppHandle) -> Result<(), String> {
    for label in [
        WINDOW_LABEL_ANIMATION,
        WINDOW_LABEL_LIVE2D,
        WINDOW_LABEL_PNGREMIX,
        WINDOW_LABEL_THREED,
    ] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .set_ignore_cursor_events(ignore)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 检测当前左键是否按下（用于原生拖拽期间的 drag_end 判定）
#[tauri::command]
pub(crate) fn is_left_mouse_down() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
        // GetAsyncKeyState 返回 i16：若最高位为 1 则表示按键处于按下状态
        let down = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) < 0 };
        Ok(down)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("is_left_mouse_down not implemented for this platform".to_string())
    }
}

/// 拖拽结束检测：启用/关闭全局鼠标状态追踪
#[tauri::command]
pub(crate) fn set_drag_end_tracking(enabled: bool) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        Ok(set_drag_tracking_enabled(enabled))
    }


    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
        Ok(false)
    }
}

/// 获取当前鼠标位置（屏幕坐标）
#[tauri::command]
pub(crate) fn get_cursor_position() -> Result<(i32, i32), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

        let mut point = POINT { x: 0, y: 0 };
        unsafe {
            GetCursorPos(&mut point).map_err(|e| format!("GetCursorPos failed: {:?}", e))?;
        }
        Ok((point.x, point.y))
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("get_cursor_position not implemented for this platform".to_string())
    }
}

/// 气泡边界（相对于窗口的坐标）
#[derive(Debug, Clone, serde::Deserialize)]
pub struct BubbleBounds {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

/// 检查鼠标是否在交互区域内
///
/// 交互区域包括：
/// - 角色 Canvas 区域（始终需要交互）
/// - 气泡实际区域（由前端传入实际边界）
///
/// @param bubble_bounds 气泡的实际边界（相对于窗口），为 None 时表示气泡未显示
/// @return true 表示鼠标在交互区域内，需要禁用穿透
#[tauri::command]
pub(crate) fn is_cursor_in_interact_area(
    bubble_bounds: Option<BubbleBounds>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let storage = state.storage.lock().unwrap();
    let scale = storage.data.settings.animation_scale as f64;
    drop(storage);

    // 获取窗口位置和尺寸（同时适配 animation、live2d 和 pngremix 窗口）
    let window = app
        .get_webview_window(WINDOW_LABEL_ANIMATION)
        .or_else(|| app.get_webview_window(WINDOW_LABEL_LIVE2D))
        .or_else(|| app.get_webview_window(WINDOW_LABEL_PNGREMIX))
        .or_else(|| app.get_webview_window(WINDOW_LABEL_THREED))
        .ok_or("No render window found")?;

    let position = window.outer_position().map_err(|e| e.to_string())?;
    let scale_factor = window.scale_factor().unwrap_or(1.0);

    // 窗口物理坐标转换为逻辑坐标
    let window_x = position.x as f64 / scale_factor;
    let window_y = position.y as f64 / scale_factor;

    // 计算动画区域的高度（随缩放变化）
    let animation_height = ANIMATION_AREA_HEIGHT * scale;
    let animation_width = ANIMATION_AREA_WIDTH * scale;

    // 窗口宽度取气泡和动画区域的最大值
    let window_width = BUBBLE_AREA_WIDTH.max(animation_width);

    // 角色 Canvas 区域边界（在气泡区域下方的动画区域内）
    // Canvas 使用 CSS: left: 50%, top: 45%, transform: translate(-50%, -50%), height: 80%
    let animation_area_top = window_y + BUBBLE_AREA_HEIGHT;
    let canvas_height = animation_height * 0.8;
    let canvas_width = canvas_height; // 假设宽高比 1:1
    let canvas_center_x = window_x + window_width / 2.0;
    let canvas_center_y = animation_area_top + animation_height * 0.45;
    let canvas_left = canvas_center_x - canvas_width / 2.0;
    let canvas_right = canvas_center_x + canvas_width / 2.0;
    let canvas_top = canvas_center_y - canvas_height / 2.0;
    let canvas_bottom = canvas_center_y + canvas_height / 2.0;

    // 获取鼠标位置
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

        let mut point = POINT { x: 0, y: 0 };
        unsafe {
            GetCursorPos(&mut point).map_err(|e| format!("GetCursorPos failed: {:?}", e))?;
        }

        // 鼠标逻辑坐标
        let cursor_x = point.x as f64 / scale_factor;
        let cursor_y = point.y as f64 / scale_factor;

        // 检查鼠标是否在角色 Canvas 区域内（始终需要交互）
        let in_canvas = cursor_x >= canvas_left
            && cursor_x <= canvas_right
            && cursor_y >= canvas_top
            && cursor_y <= canvas_bottom;

        // 检查鼠标是否在气泡实际区域内（前端传入实际边界）
        let in_bubble = if let Some(bounds) = bubble_bounds {
            // 将窗口相对坐标转换为屏幕坐标
            let bubble_left = window_x + bounds.left;
            let bubble_top = window_y + bounds.top;
            let bubble_right = window_x + bounds.right;
            let bubble_bottom = window_y + bounds.bottom;

            cursor_x >= bubble_left
                && cursor_x <= bubble_right
                && cursor_y >= bubble_top
                && cursor_y <= bubble_bottom
        } else {
            false
        };

        Ok(in_canvas || in_bubble)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

/// 设置音量（实时生效）
#[tauri::command]
pub(crate) fn set_volume(
    volume: f64,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let volume = volume.clamp(0.0, 1.0) as f32;

    // 更新设置并保存
    {
        let mut storage = state.storage.lock().unwrap();
        storage.data.settings.volume = volume;
        storage.save()?;
    }

    // 发送音量变更事件
    let _ = emit(&app, events::VOLUME_CHANGE, volume);
    Ok(())
}

/// 设置静音模式（实时生效）
#[tauri::command]
pub(crate) fn set_mute(
    mute: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // 更新设置并保存
    {
        let mut storage = state.storage.lock().unwrap();
        storage.data.settings.no_audio_mode = mute;
        storage.save()?;
    }

    // 发送静音模式变更事件
    let _ = emit(&app, events::MUTE_CHANGE, mute);
    Ok(())
}

fn compute_window_size_for_scale(scale: f64) -> (f64, f64) {
    let animation_width = ANIMATION_AREA_WIDTH * scale;
    let animation_height = ANIMATION_AREA_HEIGHT * scale;
    let new_width = BUBBLE_AREA_WIDTH.max(animation_width);
    let new_height = BUBBLE_AREA_HEIGHT + animation_height;
    (new_width, new_height)
}

/// 设置动画缩放比例并调整窗口大小
#[tauri::command]
pub(crate) fn set_animation_scale(
    scale: f64,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let scale = scale.clamp(0.1, 2.0);


    // 更新设置
    {
        let mut storage = state.storage.lock().unwrap();
        storage.data.settings.animation_scale = scale as f32;
        storage.save()?;
    }

    // 调整窗口大小 - 气泡区域固定尺寸，只有动画区域缩放
    let (new_width, new_height) = compute_window_size_for_scale(scale);


    for label in [
        WINDOW_LABEL_ANIMATION,
        WINDOW_LABEL_LIVE2D,
        WINDOW_LABEL_PNGREMIX,
        WINDOW_LABEL_THREED,
    ] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .set_size(LogicalSize::new(new_width, new_height))
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// 在文件管理器中打开指定路径
#[tauri::command]
pub(crate) fn open_path(path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        opener::reveal(&path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ========================================================================= //
// 窗口重建命令
// ========================================================================= //

/// 重新创建动画窗口
///
/// 用于在 Mod 加载或比例调整后刷新窗口资源
#[tauri::command]
pub(crate) async fn recreate_animation_window(app: AppHandle) -> Result<(), String> {
    // 1. 关闭现有窗口
    if let Some(window) = app.get_webview_window(WINDOW_LABEL_ANIMATION) {
        // 先移除关闭拦截事件，否则 close() 可能会因为 API 拦截而不生效
        // 注意：Tauri v2 中无法直接移除之前闭包注册的事件，但我们可以尝试销毁它
        let _ = window.destroy();

        // 给 Tauri 一点时间在主事件循环中彻底销毁窗口并释放 label
        // 如果立即创建，会报错 "already exists"
        tokio::time::sleep(std::time::Duration::from_millis(
            crate::modules::constants::WINDOW_RESIZE_DELAY_MS + 200, // 增加一点缓冲时间
        ))
        .await;
    }

    // 2. 创建新窗口
    crate::inner_create_animation_window(&app)
}

/// 重新创建 Live2D 窗口
///
/// 用于在 Mod 加载后刷新窗口资源
#[tauri::command]
pub(crate) async fn recreate_live2d_window(app: AppHandle) -> Result<(), String> {
    // 1. 关闭现有窗口
    if let Some(window) = app.get_webview_window(WINDOW_LABEL_LIVE2D) {
        let _ = window.destroy();

        // 给 Tauri 一点时间在主事件循环中彻底销毁窗口并释放 label
        tokio::time::sleep(std::time::Duration::from_millis(
            crate::modules::constants::WINDOW_RESIZE_DELAY_MS + 200,
        ))
        .await;
    }

    // 2. 创建新窗口
    crate::inner_create_live2d_window(&app)
}

/// 重新创建 3D 窗口
///
/// 用于在 Mod 加载后刷新窗口资源
#[tauri::command]
pub(crate) async fn recreate_threed_window(app: AppHandle) -> Result<(), String> {
    // 1. 关闭现有窗口
    if let Some(window) = app.get_webview_window(WINDOW_LABEL_THREED) {
        let _ = window.destroy();

        tokio::time::sleep(std::time::Duration::from_millis(
            crate::modules::constants::WINDOW_RESIZE_DELAY_MS + 200,
        ))
        .await;
    }

    // 2. 创建新窗口
    crate::inner_create_threed_window(&app)
}

/// 重新创建 PngRemix 窗口
///
/// 用于在 Mod 加载后刷新窗口资源
#[tauri::command]
pub(crate) async fn recreate_pngremix_window(app: AppHandle) -> Result<(), String> {
    // 1. 关闭现有窗口
    if let Some(window) = app.get_webview_window(WINDOW_LABEL_PNGREMIX) {
        let _ = window.destroy();

        // 给 Tauri 一点时间在主事件循环中彻底销毁窗口并释放 label
        tokio::time::sleep(std::time::Duration::from_millis(
            crate::modules::constants::WINDOW_RESIZE_DELAY_MS + 200,
        ))
        .await;
    }

    // 2. 创建新窗口
    crate::inner_create_pngremix_window(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compute_window_size_for_scale_uses_bubble_area_width() {
        let (width, height) = compute_window_size_for_scale(1.0);
        let expected_width = BUBBLE_AREA_WIDTH.max(ANIMATION_AREA_WIDTH);
        let expected_height = BUBBLE_AREA_HEIGHT + ANIMATION_AREA_HEIGHT;

        assert_eq!(width, expected_width);
        assert_eq!(height, expected_height);
    }

    #[test]
    fn compute_window_size_for_scale_scales_animation_area() {
        let (width, height) = compute_window_size_for_scale(0.5);
        let expected_animation_width = ANIMATION_AREA_WIDTH * 0.5;
        let expected_animation_height = ANIMATION_AREA_HEIGHT * 0.5;
        let expected_width = BUBBLE_AREA_WIDTH.max(expected_animation_width);
        let expected_height = BUBBLE_AREA_HEIGHT + expected_animation_height;

        assert_eq!(width, expected_width);
        assert_eq!(height, expected_height);
    }
}


