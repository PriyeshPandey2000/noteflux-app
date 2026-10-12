// Ask overlay: a non-activating NSPanel anchored to the notch that shows a
// spoken question and its answer. Shown by the recording pipeline after an
// "ask" recording is transcribed.

pub const ASK_OVERLAY_WIDTH: f64 = 560.0;
pub const ASK_OVERLAY_HEIGHT: f64 = 540.0;

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
        // Become key only if something inside actually needs it (e.g. a future
        // text field). A plain click or the explicit makeKeyWindow call in
        // show_ask_overlay still works; this just stops incidental clicks from
        // yanking key status away from whatever app is in front.
        let _: () = msg_send![ns_window, setBecomesKeyOnlyIfNeeded: 1u8];
    }
}

/// Extra width on each side of the notch for the card's neck (see `#neck` in ask-overlay.html).
#[cfg(target_os = "macos")]
const NECK_PADDING_PER_SIDE: f64 = 16.0;
/// Neck width on displays without a notch, so the overlay still has the same shape.
#[cfg(target_os = "macos")]
const NECK_WIDTH_WITHOUT_NOTCH: f64 = 232.0;

/// Positions the window at the top center of the notched display. Returns the
/// neck width (notch gap plus padding) and the menu bar height, so the page can
/// draw the neck and drop the card to the bar's bottom edge.
#[cfg(target_os = "macos")]
pub fn pin_to_notch_top(window: &tauri::WebviewWindow, width: f64, height: f64, flush_to_screen_top: bool) -> (f64, f64) {
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
        let visible: NSRect = msg_send![target, visibleFrame];
        let left: NSRect = msg_send![target, auxiliaryTopLeftArea];
        let right: NSRect = msg_send![target, auxiliaryTopRightArea];
        let has_notch = left.size.width > 0.0 && right.size.width > 0.0;
        let notch_left_edge = left.origin.x + left.size.width;
        let center_x = if has_notch {
            (notch_left_edge + right.origin.x) / 2.0
        } else {
            frame.origin.x + frame.size.width / 2.0
        };

        let x = center_x - width / 2.0;
        let y = if flush_to_screen_top {
            frame.origin.y + frame.size.height - height
        } else {
            visible.origin.y + visible.size.height - height
        };
        let rect = NSRect::new(NSPoint::new(x, y), NSSize::new(width, height));
        let _: () = msg_send![ns_window, setFrame: rect display: 1u8];

        let neck_width = if has_notch {
            let notch_gap = right.origin.x - notch_left_edge;
            notch_gap + 2.0 * NECK_PADDING_PER_SIDE
        } else {
            NECK_WIDTH_WITHOUT_NOTCH
        };
        let menu_bar_height = frame.origin.y + frame.size.height - (visible.origin.y + visible.size.height);
        (neck_width, menu_bar_height)
    }
}

/// Temporary debugging aid: appends a timestamped line to ~/Library/Logs/noteflux-ask-debug.log
/// so we can see when the Ask overlay shows, hides, and gains or loses focus. Not on the
/// Desktop: writing there triggers the macOS "access files in your Desktop folder" prompt.
// Debug builds only — release builds call this on every show/hide and every
// focus change of every window, with no size limit on the log file, so it
// must not write anything outside local development.
#[cfg(debug_assertions)]
pub fn debug_log(message: &str) {
    use std::io::Write;
    let Some(home) = std::env::var_os("HOME") else {
        return;
    };
    let path = std::path::PathBuf::from(home)
        .join("Library")
        .join("Logs")
        .join("noteflux-ask-debug.log");
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{seconds:.3}] {message}");
    }
}

#[cfg(not(debug_assertions))]
pub fn debug_log(_message: &str) {}

/// Global + local Escape monitors that close the Ask card reliably, without
/// making it key. A global monitor only sees events delivered to *other* apps;
/// a local one only sees events within our own app (e.g. the main window has
/// key while the card is still showing). Both are needed to cover every case.
/// Neither consumes the keystroke — Escape still reaches whatever else it
/// would have, we just also close the card. Installed in show_ask_overlay,
/// torn down in hide_ask_overlay, so the lifecycle has one source of truth.
///
/// Requires the Accessibility permission to actually receive events (same
/// requirement the Fn shortcut already has — see keyboard/macos.rs). Without
/// it, these monitors are silently inert, not an error.
#[cfg(target_os = "macos")]
static ESCAPE_MONITORS: std::sync::Mutex<Vec<usize>> = std::sync::Mutex::new(Vec::new());

#[cfg(target_os = "macos")]
fn remove_escape_monitors() {
    use objc::{class, msg_send, sel, sel_impl};
    let mut monitors = ESCAPE_MONITORS.lock().unwrap_or_else(|e| e.into_inner());
    for monitor in monitors.drain(..) {
        unsafe {
            let _: () = msg_send![class!(NSEvent), removeMonitor: monitor as *mut objc::runtime::Object];
        }
    }
}

#[cfg(target_os = "macos")]
fn dismiss_from_escape(app_handle: &tauri::AppHandle) {
    use tauri::Manager;
    remove_escape_monitors();
    if let Some(window) = app_handle.get_webview_window("ask-overlay") {
        // Reuse the page's own close path (animation + hide_ask_overlay invoke)
        // instead of hiding directly, so Escape and the X button behave the same.
        let _ = window.eval(
            "window.closeAskOverlayFromNative && window.closeAskOverlayFromNative()",
        );
    }
}

#[cfg(target_os = "macos")]
fn install_escape_monitors(app_handle: tauri::AppHandle) {
    use block::ConcreteBlock;
    use objc::{class, msg_send, sel, sel_impl};

    const KEY_DOWN_MASK: u64 = 1 << 10;
    const ESCAPE_KEY_CODE: u16 = 53;

    let mut monitors = ESCAPE_MONITORS.lock().unwrap_or_else(|e| e.into_inner());
    if !monitors.is_empty() {
        return;
    }

    let app_for_global = app_handle.clone();
    let global_handler = ConcreteBlock::new(move |event: *mut objc::runtime::Object| {
        let key_code: u16 = unsafe { msg_send![event, keyCode] };
        if key_code == ESCAPE_KEY_CODE {
            dismiss_from_escape(&app_for_global);
        }
    })
    .copy();

    let local_handler = ConcreteBlock::new(
        move |event: *mut objc::runtime::Object| -> *mut objc::runtime::Object {
            let key_code: u16 = unsafe { msg_send![event, keyCode] };
            if key_code == ESCAPE_KEY_CODE {
                dismiss_from_escape(&app_handle);
            }
            event
        },
    )
    .copy();

    unsafe {
        let global: *mut objc::runtime::Object = msg_send![
            class!(NSEvent),
            addGlobalMonitorForEventsMatchingMask: KEY_DOWN_MASK
            handler: &*global_handler
        ];
        let local: *mut objc::runtime::Object = msg_send![
            class!(NSEvent),
            addLocalMonitorForEventsMatchingMask: KEY_DOWN_MASK
            handler: &*local_handler
        ];
        monitors.push(global as usize);
        monitors.push(local as usize);
    }
}

// Shared by show_ask_overlay and show_ask_overlay_toast: pins the panel to
// the notch and orders it front without taking key status or activating the
// app. See show_ask_overlay's old comment history — Tauri's show() on macOS
// activates the app via make_key_and_order_front, which used to hand focus
// back to the main window and trigger a Focused(false) race. This path
// avoids that entirely.
fn position_and_order_front(
    window: &tauri::WebviewWindow,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        window
            .show()
            .map_err(|e| format!("Failed to show ask overlay: {}", e))?;
        window
            .set_focus()
            .map_err(|e| format!("Failed to focus ask overlay: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        let pinned = window.clone();
        let app_for_escape = app_handle.clone();
        window
            .run_on_main_thread(move || {
                let (neck_width, menu_bar_height) =
                    pin_to_notch_top(&pinned, ASK_OVERLAY_WIDTH, ASK_OVERLAY_HEIGHT, true);
                let _ = pinned.eval(&format!(
                    "document.documentElement.style.setProperty('--neck-width', '{neck_width}px');\
                     document.documentElement.style.setProperty('--drop', '{menu_bar_height}px')"
                ));
                // Order front without taking key status. Escape is handled by the
                // monitors below, not by the webview being key — see their comment.
                use objc::{msg_send, sel, sel_impl};
                let ns_window = pinned.ns_window().unwrap() as *mut objc::runtime::Object;
                unsafe {
                    let _: () = msg_send![ns_window, orderFrontRegardless];
                }
                install_escape_monitors(app_for_escape);
            })
            .map_err(|e| format!("Failed to position ask overlay: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn show_ask_overlay(
    app_handle: tauri::AppHandle,
    question: String,
) -> Result<bool, String> {
    use tauri::Manager;
    debug_log("show_ask_overlay called");
    let window = app_handle
        .get_webview_window("ask-overlay")
        .ok_or_else(|| "Ask overlay window not found".to_string())?;
    // Reported back to the caller as "is this a follow-up in the same
    // thread". Checked before anything below changes visibility.
    let was_already_visible = window.is_visible().unwrap_or(false);
    let main_focused = app_handle
        .get_webview_window("main")
        .and_then(|main| main.is_focused().ok());
    debug_log(&format!("main window focused before show: {main_focused:?}"));

    let question_json = serde_json::to_string(&question).map_err(|e| e.to_string())?;
    window
        .eval(&format!(
            "window.resetAskOverlay && window.resetAskOverlay({question_json})"
        ))
        .map_err(|e| format!("Failed to reset ask overlay: {}", e))?;

    position_and_order_front(&window, &app_handle)?;

    debug_log("overlay shown (no app activation on macOS)");
    Ok(was_already_visible)
}

/// Shows a brief, self-dismissing confirmation in the same notch panel used
/// for Ask — reuses it rather than a toast because toasts live in the main
/// window and are invisible whenever that window isn't the one on screen,
/// which is the common case for something triggered by a global shortcut
/// while another app is frontmost. The panel is cross-app visible exactly
/// like Ask's voice answers already are, with no OS notification permission
/// needed. Auto-hides itself (see showOcrToast in ask-overlay.html).
#[tauri::command]
pub async fn show_ask_overlay_toast(
    app_handle: tauri::AppHandle,
    message: String,
    is_error: bool,
) -> Result<(), String> {
    use tauri::Manager;
    let window = app_handle
        .get_webview_window("ask-overlay")
        .ok_or_else(|| "Ask overlay window not found".to_string())?;

    let message_json = serde_json::to_string(&message).map_err(|e| e.to_string())?;
    window
        .eval(&format!(
            "window.showOcrToast && window.showOcrToast({message_json}, {is_error})"
        ))
        .map_err(|e| format!("Failed to show ask overlay toast: {}", e))?;

    position_and_order_front(&window, &app_handle)?;

    Ok(())
}

#[tauri::command]
pub async fn copy_ask_answer(app_handle: tauri::AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app_handle
        .clipboard()
        .write_text(text)
        .map_err(|e| format!("Failed to copy answer: {}", e))
}

/// Opens a link from a rendered answer in the system browser, rather than
/// navigating this small overlay window away from the app or opening a new
/// Tauri webview window.
#[tauri::command]
pub async fn open_ask_link(app_handle: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    // Answers come from a model that can run browser search, so a link in one
    // can carry a URL an attacker controls. DOMPurify blocks javascript:, but
    // still allows file:/mailto:/other schemes — restrict to http(s) here too.
    let lower = url.trim().to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err("Only http(s) links can be opened".to_string());
    }
    app_handle
        .opener()
        .open_url(url, None::<String>)
        .map_err(|e| format!("Failed to open link: {}", e))
}

#[tauri::command]
pub async fn set_ask_overlay_thumbnail(
    app_handle: tauri::AppHandle,
    thumbnail: String,
) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("ask-overlay") {
        let thumbnail_json = serde_json::to_string(&thumbnail).map_err(|e| e.to_string())?;
        window
            .eval(&format!(
                "window.setAskThumbnail && window.setAskThumbnail({thumbnail_json})"
            ))
            .map_err(|e| format!("Failed to set ask overlay thumbnail: {}", e))?;
    }
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
    debug_log("hide_ask_overlay called");
    #[cfg(target_os = "macos")]
    remove_escape_monitors();
    if let Some(window) = app_handle.get_webview_window("ask-overlay") {
        window
            .hide()
            .map_err(|e| format!("Failed to hide ask overlay: {}", e))?;
    }
    Ok(())
}
