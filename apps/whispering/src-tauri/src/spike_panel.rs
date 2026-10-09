// Throwaway spike for the Ask-card redesign: does a nonactivating NSPanel
// with `becomesKeyOnlyIfNeeded` let a button and selectable text work
// without stealing focus from the frontmost app? See
// docs/specs/ for the design this is testing. Delete this file (and its
// wiring in lib.rs) once the question is answered.
#![cfg(target_os = "macos")]

use cocoa::foundation::{NSPoint, NSRect, NSSize};
use objc::{class, msg_send, sel, sel_impl};

pub const SPIKE_PANEL_WIDTH: f64 = 420.0;
pub const SPIKE_PANEL_HEIGHT: f64 = 220.0;

const NON_ACTIVATING_PANEL: u64 = 1 << 7;
const CAN_JOIN_ALL_SPACES: u64 = 1 << 0;
const FLOATING_WINDOW_LEVEL: i64 = 3;

extern "C" {
    fn object_setClass(
        obj: *mut objc::runtime::Object,
        cls: *const objc::runtime::Class,
    ) -> *const objc::runtime::Class;
}

extern "C" fn can_become_key(
    _this: &objc::runtime::Object,
    _cmd: objc::runtime::Sel,
) -> objc::runtime::BOOL {
    objc::runtime::YES
}

fn spike_panel_class() -> &'static objc::runtime::Class {
    static CLASS: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
    let ptr = *CLASS.get_or_init(|| {
        let mut decl = objc::declare::ClassDecl::new("NoteFluxSpikePanel", class!(NSPanel))
            .expect("class name already registered");
        unsafe {
            decl.add_method(
                sel!(canBecomeKeyWindow),
                can_become_key
                    as extern "C" fn(&objc::runtime::Object, objc::runtime::Sel) -> objc::runtime::BOOL,
            );
        }
        decl.register() as *const objc::runtime::Class as usize
    });
    unsafe { &*(ptr as *const objc::runtime::Class) }
}

fn configure_spike_panel(window: &tauri::WebviewWindow) {
    unsafe {
        let ns_window = window.ns_window().unwrap() as *mut objc::runtime::Object;
        object_setClass(ns_window, spike_panel_class());
        let _: () = msg_send![ns_window, setStyleMask: NON_ACTIVATING_PANEL];
        let _: () = msg_send![ns_window, setLevel: FLOATING_WINDOW_LEVEL];
        let _: () = msg_send![ns_window, setCollectionBehavior: CAN_JOIN_ALL_SPACES];
        let _: () = msg_send![ns_window, setHidesOnDeactivate: 0u8];
        // The whole point of this spike: let the panel take key status only
        // when something inside it (the button) actually needs it, instead
        // of always, or never.
        let _: () = msg_send![ns_window, setBecomesKeyOnlyIfNeeded: 1u8];
    }
}

fn centered_frame(window: &tauri::WebviewWindow) -> NSRect {
    unsafe {
        let screen: *mut objc::runtime::Object = msg_send![class!(NSScreen), mainScreen];
        let frame: NSRect = msg_send![screen, frame];
        let x = frame.origin.x + (frame.size.width - SPIKE_PANEL_WIDTH) / 2.0;
        let y = frame.origin.y + (frame.size.height - SPIKE_PANEL_HEIGHT) / 2.0;
        let _ = window;
        NSRect::new(
            NSPoint::new(x, y),
            NSSize::new(SPIKE_PANEL_WIDTH, SPIKE_PANEL_HEIGHT),
        )
    }
}

/// Creates the spike panel hidden at startup, same reasoning as the other
/// overlays: build it once so showing it later is instant.
pub fn create_spike_panel_at_startup(app: &tauri::App) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    // Served from the SvelteKit static folder (apps/whispering/static/spike-panel.html),
    // through the same origin as the main window — dev server in dev, Tauri's asset
    // protocol in release. Loading it via a raw file:// path, like the other overlay
    // windows do, gives the page a "null" Origin, which breaks invoke() entirely: see
    // tauri's ipc/protocol.rs, "Origin header is not a valid URL".
    let webview_url = WebviewUrl::App("spike-panel.html".into());

    let window = WebviewWindowBuilder::new(app, "spike-panel", webview_url)
        .title("Spike Panel")
        .inner_size(SPIKE_PANEL_WIDTH, SPIKE_PANEL_HEIGHT)
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .shadow(false)
        .transparent(true)
        .content_protected(false)
        .theme(None)
        .visible(false)
        .build()
        .map_err(|e| format!("Failed to create spike panel window: {}", e))?;

    crate::make_window_truly_transparent(&window, 0.0);
    configure_spike_panel(&window);

    Ok(())
}

/// Positions and orders the panel front. Never `show()` / `set_focus()` /
/// `makeKeyWindow()` — that's the behavior this spike is testing we don't need.
pub fn show_spike_panel_sync(app_handle: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(window) = app_handle.get_webview_window("spike-panel") else {
        return;
    };
    let pinned = window.clone();
    let _ = window.run_on_main_thread(move || {
        let ns_window = pinned.ns_window().unwrap() as *mut objc::runtime::Object;
        let frame = centered_frame(&pinned);
        unsafe {
            let _: () = msg_send![ns_window, setFrame: frame display: 1u8];
            let _: () = msg_send![ns_window, orderFrontRegardless];
        }
    });
}

pub fn hide_spike_panel_sync(app_handle: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("spike-panel") {
        let _ = window.hide();
    }
}

#[tauri::command]
pub async fn show_spike_panel(app_handle: tauri::AppHandle) -> Result<(), String> {
    show_spike_panel_sync(&app_handle);
    Ok(())
}

#[tauri::command]
pub async fn hide_spike_panel(app_handle: tauri::AppHandle) -> Result<(), String> {
    hide_spike_panel_sync(&app_handle);
    Ok(())
}

#[tauri::command]
pub async fn spike_copy(app_handle: tauri::AppHandle) -> Result<(), String> {
    crate::ask_overlay::debug_log("spike_copy called");
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let result = app_handle
        .clipboard()
        .write_text("copied from the spike panel".to_string())
        .map_err(|e| format!("Failed to write to clipboard: {}", e));
    crate::ask_overlay::debug_log(&format!("spike_copy result: {:?}", result));
    result
}
