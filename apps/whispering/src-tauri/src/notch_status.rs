// Notch status pill: a small, non-focusing overlay anchored to the notch that
// shows one-line status messages (setup progress, notices). Reusable: call
// show_notch_status with any text, then hide_notch_status when done.

pub const NOTCH_STATUS_WIDTH: f64 = 340.0;
pub const NOTCH_STATUS_HEIGHT: f64 = 56.0;

pub fn create_notch_status_at_startup(app: &tauri::App) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let webview_url = if cfg!(dev) {
        let exe_dir = std::env::current_exe()
            .map_err(|e| format!("Failed to get executable path: {}", e))?
            .parent()
            .ok_or("Failed to get executable directory")?
            .to_path_buf();
        let dev_path = exe_dir
            .parent()
            .unwrap_or(&exe_dir)
            .parent()
            .unwrap_or(&exe_dir)
            .parent()
            .unwrap_or(&exe_dir)
            .join("src-tauri/notch-status.html");
        WebviewUrl::External(
            format!("file://{}", dev_path.display())
                .parse()
                .map_err(|e| format!("Failed to parse URL: {}", e))?,
        )
    } else {
        use tauri::Manager;
        let app_dir = app
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource directory: {}", e))?;
        let status_path = app_dir.join("notch-status.html");
        if !status_path.exists() {
            return Err(format!(
                "Notch status file not found at: {}",
                status_path.display()
            ));
        }
        WebviewUrl::External(
            format!("file://{}", status_path.display())
                .parse()
                .map_err(|e| format!("Failed to parse URL: {}", e))?,
        )
    };

    let window = WebviewWindowBuilder::new(app, "notch-status", webview_url)
        .title("Status")
        .inner_size(NOTCH_STATUS_WIDTH, NOTCH_STATUS_HEIGHT)
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .shadow(false)
        .focused(false)
        .visible(false)
        .transparent(true)
        .content_protected(false)
        .theme(None)
        .build()
        .map_err(|e| format!("Failed to create notch status window: {}", e))?;

    window
        .set_always_on_top(true)
        .map_err(|e| format!("Failed to set always on top: {}", e))?;
    window
        .set_ignore_cursor_events(true)
        .map_err(|e| format!("Failed to ignore cursor events: {}", e))?;

    #[cfg(target_os = "macos")]
    {
        crate::make_window_truly_transparent(&window, 0.0);
        crate::ask_overlay::configure_ask_panel(&window);
    }

    Ok(())
}

#[tauri::command]
pub async fn show_notch_status(
    app_handle: tauri::AppHandle,
    text: String,
    detail: Option<String>,
) -> Result<(), String> {
    use tauri::Manager;
    let window = app_handle
        .get_webview_window("notch-status")
        .ok_or_else(|| "Notch status window not found".to_string())?;

    let text_json = serde_json::to_string(&text).map_err(|e| e.to_string())?;
    let detail_json = serde_json::to_string(&detail).map_err(|e| e.to_string())?;
    window
        .eval(&format!(
            "window.showNotchStatus && window.showNotchStatus({text_json}, {detail_json})"
        ))
        .map_err(|e| format!("Failed to update notch status: {}", e))?;
    window
        .show()
        .map_err(|e| format!("Failed to show notch status: {}", e))?;

    #[cfg(target_os = "macos")]
    {
        let pinned = window.clone();
        window
            .run_on_main_thread(move || {
                crate::ask_overlay::pin_to_notch_top(
                    &pinned,
                    NOTCH_STATUS_WIDTH,
                    NOTCH_STATUS_HEIGHT,
                    false,
                );
            })
            .map_err(|e| format!("Failed to position notch status: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn hide_notch_status(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("notch-status") {
        window
            .hide()
            .map_err(|e| format!("Failed to hide notch status: {}", e))?;
    }
    Ok(())
}
