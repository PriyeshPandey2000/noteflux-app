// Ask overlay: a non-activating NSPanel anchored to the notch that shows a
// spoken question and its answer. Shown by the recording pipeline after an
// "ask" recording is transcribed.

pub const ASK_OVERLAY_WIDTH: f64 = 680.0;
pub const ASK_OVERLAY_HEIGHT: f64 = 360.0;

#[cfg(target_os = "macos")]
extern "C" {
    fn object_setClass(
        obj: *mut objc::runtime::Object,
        cls: *const objc::runtime::Class,
    ) -> *const objc::runtime::Class;
}

#[cfg(target_os = "macos")]
extern "C" fn can_become_key(
    _this: &objc::runtime::Object,
    _cmd: objc::runtime::Sel,
) -> objc::runtime::BOOL {
    objc::runtime::YES
}

#[cfg(target_os = "macos")]
extern "C" fn keep_requested_frame(
    _this: &objc::runtime::Object,
    _cmd: objc::runtime::Sel,
    frame: cocoa::foundation::NSRect,
    _screen: *mut objc::runtime::Object,
) -> cocoa::foundation::NSRect {
    frame
}

#[cfg(target_os = "macos")]
fn ask_panel_class() -> &'static objc::runtime::Class {
    static CLASS: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
    let ptr = *CLASS.get_or_init(|| {
        use objc::{class, sel, sel_impl};
        let mut decl = objc::declare::ClassDecl::new("NoteFluxAskPanel", class!(NSPanel))
            .expect("class name already registered");
        unsafe {
            decl.add_method(
                sel!(canBecomeKeyWindow),
                can_become_key
                    as extern "C" fn(&objc::runtime::Object, objc::runtime::Sel) -> objc::runtime::BOOL,
            );
            decl.add_method(
                sel!(constrainFrameRect:toScreen:),
                keep_requested_frame
                    as extern "C" fn(
                        &objc::runtime::Object,
                        objc::runtime::Sel,
                        cocoa::foundation::NSRect,
                        *mut objc::runtime::Object,
                    ) -> cocoa::foundation::NSRect,
            );
        }
        decl.register() as *const objc::runtime::Class as usize
    });
    unsafe { &*(ptr as *const objc::runtime::Class) }
}

#[cfg(target_os = "macos")]
pub fn configure_ask_panel(window: &tauri::WebviewWindow) {
    use objc::{msg_send, sel, sel_impl};

    const NON_ACTIVATING_PANEL: u64 = 1 << 7;
    const CAN_JOIN_ALL_SPACES: u64 = 1 << 0;
    const FULL_SCREEN_AUXILIARY: u64 = 1 << 8;
    const STATUS_WINDOW_LEVEL: i64 = 25;

    unsafe {
        let ns_window = window.ns_window().unwrap() as *mut objc::runtime::Object;
        object_setClass(ns_window, ask_panel_class());
        let _: () = msg_send![ns_window, setStyleMask: NON_ACTIVATING_PANEL];
        let _: () = msg_send![ns_window, setLevel: STATUS_WINDOW_LEVEL];
        let _: () = msg_send![
            ns_window,
            setCollectionBehavior: CAN_JOIN_ALL_SPACES | FULL_SCREEN_AUXILIARY
        ];
        let _: () = msg_send![ns_window, setHidesOnDeactivate: 0u8];
    }
}

#[cfg(target_os = "macos")]
fn pin_to_notch_top(window: &tauri::WebviewWindow, width: f64, height: f64) {
    use cocoa::foundation::{NSPoint, NSRect, NSSize};
    use objc::{class, msg_send, sel, sel_impl};

    unsafe {
        let ns_window = window.ns_window().unwrap() as *mut objc::runtime::Object;

        // The notched display is the one whose top-left auxiliary area is non-empty.
        let screens: *mut objc::runtime::Object = msg_send![class!(NSScreen), screens];
        let count: usize = msg_send![screens, count];
        let mut target: *mut objc::runtime::Object = msg_send![class!(NSScreen), mainScreen];
        for index in 0..count {
            let candidate: *mut objc::runtime::Object = msg_send![screens, objectAtIndex: index];
            let left: NSRect = msg_send![candidate, auxiliaryTopLeftArea];
            if left.size.width > 0.0 {
                target = candidate;
                break;
            }
        }

        let frame: NSRect = msg_send![target, frame];
        let left: NSRect = msg_send![target, auxiliaryTopLeftArea];
        let right: NSRect = msg_send![target, auxiliaryTopRightArea];
        let center_x = if left.size.width > 0.0 && right.size.width > 0.0 {
            (left.origin.x + left.size.width + right.origin.x) / 2.0
        } else {
            frame.origin.x + frame.size.width / 2.0
        };

        let x = center_x - width / 2.0;
        let y = frame.origin.y + frame.size.height - height;
        let rect = NSRect::new(NSPoint::new(x, y), NSSize::new(width, height));
        let _: () = msg_send![ns_window, setFrame: rect display: 1u8];
    }
}

#[tauri::command]
pub async fn show_ask_overlay(
    app_handle: tauri::AppHandle,
    question: String,
) -> Result<(), String> {
    use tauri::Manager;
    let window = app_handle
        .get_webview_window("ask-overlay")
        .ok_or_else(|| "Ask overlay window not found".to_string())?;

    let question_json = serde_json::to_string(&question).map_err(|e| e.to_string())?;
    window
        .eval(&format!(
            "window.resetAskOverlay && window.resetAskOverlay({question_json})"
        ))
        .map_err(|e| format!("Failed to reset ask overlay: {}", e))?;
    window
        .show()
        .map_err(|e| format!("Failed to show ask overlay: {}", e))?;

    #[cfg(target_os = "macos")]
    {
        let pinned = window.clone();
        window
            .run_on_main_thread(move || {
                pin_to_notch_top(&pinned, ASK_OVERLAY_WIDTH, ASK_OVERLAY_HEIGHT)
            })
            .map_err(|e| format!("Failed to position ask overlay: {}", e))?;
    }

    window
        .set_focus()
        .map_err(|e| format!("Failed to focus ask overlay: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn set_ask_overlay_result(
    app_handle: tauri::AppHandle,
    answer: Option<String>,
    error: Option<String>,
) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("ask-overlay") {
        let answer_json = serde_json::to_string(&answer).map_err(|e| e.to_string())?;
        let error_json = serde_json::to_string(&error).map_err(|e| e.to_string())?;
        window
            .eval(&format!(
                "window.showAskResult && window.showAskResult({answer_json}, {error_json})"
            ))
            .map_err(|e| format!("Failed to update ask overlay: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn hide_ask_overlay(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("ask-overlay") {
        window
            .hide()
            .map_err(|e| format!("Failed to hide ask overlay: {}", e))?;
    }
    Ok(())
}
