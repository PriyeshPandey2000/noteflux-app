// Platform-specific modules
#[cfg(target_os = "macos")]
mod accessibility;

#[cfg(target_os = "macos")]
mod microphone;

// Keyboard handling module (Fn key support)
mod keyboard;

// Re-export platform-specific functions
#[cfg(target_os = "macos")]
use accessibility::{get_selection_with_context, is_macos_accessibility_enabled, open_apple_accessibility};

#[cfg(target_os = "macos")]
use microphone::{is_macos_microphone_enabled, request_macos_microphone_permission};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, menu::{Menu, MenuItem}, tray::{TrayIconBuilder, TrayIconEvent}};
use tauri_plugin_aptabase::EventTracker;
use tauri_plugin_clipboard_manager;

#[cfg(target_os = "macos")]
use cocoa::appkit::NSColor;
#[cfg(target_os = "macos")]
use cocoa::base::nil;
#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};

pub mod recorder;
use recorder::commands::{
    cancel_recording, close_recording_session, enumerate_recording_devices,
    get_current_recording_id, hide_recording_overlay, init_recording_session, 
    set_overlay_processing, show_recording_overlay, start_recording, stop_recording, AppData,
};

// Persistent Qwen3-ASR sidecar daemon — model loads once, stays alive.
// stdout is owned by a background reader thread; lines arrive via `reader`.
// Dropping QwenASRDaemon kills the child and drops the receiver, which
// causes the reader thread to exit on its next send attempt.
#[cfg(target_os = "macos")]
struct QwenASRDaemon {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
    reader: std::sync::mpsc::Receiver<String>,
    model_id: String,
}

#[cfg(target_os = "macos")]
struct QwenASRState(std::sync::Arc<std::sync::Mutex<Option<QwenASRDaemon>>>);

#[cfg(target_os = "macos")]
fn make_window_truly_transparent(window: &tauri::WebviewWindow) {
    unsafe {
        // Get the raw NSWindow handle
        let ns_window = window.ns_window().unwrap() as *mut objc::runtime::Object;
        
        // 1) Make window non-opaque and set clear background
        let _: () = msg_send![ns_window, setOpaque: 0u8]; // NO
        let clear_color = NSColor::clearColor(nil);
        let _: () = msg_send![ns_window, setBackgroundColor: clear_color];

        // 2) Set contentView layer to have corner radius and maskToBounds = YES
        let content_view: *mut objc::runtime::Object = msg_send![ns_window, contentView];
        let _: () = msg_send![content_view, setWantsLayer: 1u8]; // YES

        // Get layer and set corner radius & masksToBounds
        let layer: *mut objc::runtime::Object = msg_send![content_view, layer];
        let radius: f64 = 18.0; // Match your pill radius
        let _: () = msg_send![layer, setCornerRadius: radius];
        let _: () = msg_send![layer, setMasksToBounds: 1u8];

        // 3) Walk subviews to find WKWebView and disable its background drawing
        let subviews: *mut objc::runtime::Object = msg_send![content_view, subviews];
        let count: usize = msg_send![subviews, count];
        for i in 0..count {
            let sub: *mut objc::runtime::Object = msg_send![subviews, objectAtIndex: i];
            if sub.is_null() { continue; }

            // Check class name (Objective-C)
            let cls_name: *const i8 = msg_send![sub, className];
            if !cls_name.is_null() {
                let cname = std::ffi::CStr::from_ptr(cls_name).to_string_lossy();
                if cname.contains("WKWebView") {
                    // webview.setValue(false, forKey: "drawsBackground");
                    let key = std::ffi::CString::new("drawsBackground").unwrap();
                    let val: u8 = 0; // NO
                    let _: () = msg_send![sub, setValue: val forKey: key.as_ptr()];
                    // Also ensure the webview is non-opaque
                    let _: () = msg_send![sub, setOpaque: 0u8];
                    let _: () = msg_send![sub, setWantsLayer: 1u8];
                    break;
                }
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn configure_overlay_for_fullscreen(window: &tauri::WebviewWindow) {
    unsafe {
        // Get the raw NSWindow handle
        let ns_window = window.ns_window().unwrap() as *mut objc::runtime::Object;
        
        // Set an extremely high window level to appear above everything including fullscreen apps
        // These are the macOS window level constants:
        // kCGNormalWindowLevel = 0
        // kCGFloatingWindowLevel = 3
        // kCGModalPanelWindowLevel = 8
        // kCGMainMenuWindowLevel = 24
        // kCGStatusWindowLevel = 25
        // kCGScreenSaverWindowLevel = 1000
        // We'll use a level higher than screen saver to ensure visibility over fullscreen apps
        let maximum_level: i32 = 2147483647; // CGWindowLevelForKey(kCGMaximumWindowLevelKey)
        let _: () = msg_send![ns_window, setLevel: maximum_level];
        
        // Set collection behavior for fullscreen compatibility
        // This is crucial for appearing in fullscreen spaces
        let current_behavior: u64 = msg_send![ns_window, collectionBehavior];
        
        // NSWindowCollectionBehaviorCanJoinAllSpaces (1 << 0) = 1
        // NSWindowCollectionBehaviorFullScreenAuxiliary (1 << 8) = 256
        // NSWindowCollectionBehaviorIgnoresCycle (1 << 6) = 64
        // NSWindowCollectionBehaviorParticipatesInCycle (1 << 5) = 32
        let can_join_all_spaces: u64 = 1;
        let fullscreen_auxiliary: u64 = 256;
        let ignores_cycle: u64 = 64;
        let new_behavior = can_join_all_spaces | fullscreen_auxiliary | ignores_cycle;
        
        let _: () = msg_send![ns_window, setCollectionBehavior: new_behavior];
        
        // Additional window properties for better overlay behavior
        let _: () = msg_send![ns_window, setHidesOnDeactivate: 0u8]; // NO - don't hide when deactivated
        let _: () = msg_send![ns_window, setCanHide: 0u8]; // NO - prevent hiding
        let _: () = msg_send![ns_window, setExcludedFromWindowsMenu: 1u8]; // YES - exclude from windows menu
        
        // Note: orderFrontRegardless is NOT called here during initialization
        // It will be called when show_recording_overlay() is invoked to make window visible
    }
}

/// Create the system tray with menu items
fn create_system_tray(app: &tauri::App) -> Result<(), String> {
    // Create menu items
    let show_hide_item = MenuItem::with_id(app, "show_hide", "Show/Hide NoteFlux", true, None::<&str>)
        .map_err(|e| format!("Failed to create show/hide menu item: {}", e))?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
        .map_err(|e| format!("Failed to create quit menu item: {}", e))?;
    
    // Create menu
    let menu = Menu::with_items(app, &[&show_hide_item, &quit_item])
        .map_err(|e| format!("Failed to create menu: {}", e))?;
    
    // Create tray icon (using existing icon from bundle)
    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false) // Don't show menu on left click
        .build(app)
        .map_err(|e| format!("Failed to create tray icon: {}", e))?;
        
    Ok(())
}

/// Create the recording overlay at app startup (hidden) to prevent focus stealing later
fn create_recording_overlay_at_startup(app: &tauri::App) -> Result<(), String> {
    
    let webview_url = if cfg!(dev) {
        // For development, try to find the file relative to the executable
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
            .join("src-tauri/recording-overlay.html");
        WebviewUrl::External(
            format!("file://{}", dev_path.display())
                .parse()
                .map_err(|e| format!("Failed to parse URL: {}", e))?
        )
    } else {
        // For production, find the bundled resource file
        let app_dir = app.path().resource_dir()
            .map_err(|e| format!("Failed to get resource directory: {}", e))?;
        let overlay_path = app_dir.join("recording-overlay.html");
        
        if overlay_path.exists() {
            WebviewUrl::External(
                format!("file://{}", overlay_path.display())
                    .parse()
                    .map_err(|e| format!("Failed to parse URL: {}", e))?
            )
        } else {
            return Err(format!("Recording overlay file not found at: {}", overlay_path.display()));
        }
    };

    // Calculate horizontal center and vertical bottom position based on screen size (accounting for scale factor)
    let monitor = app.primary_monitor().ok().flatten();
    let screen_width = monitor.as_ref().map(|m| m.size().width as f64 / m.scale_factor()).unwrap_or(1440.0);
    let screen_height = monitor.as_ref().map(|m| m.size().height as f64 / m.scale_factor()).unwrap_or(900.0);

    let x = (screen_width - 45.0) / 2.0;   // Horizontally centered
    let y = screen_height - 150.0;          // 150px from bottom

    let overlay_window = WebviewWindowBuilder::new(
        app,
        "recording-overlay",
        webview_url,
    )
    .title("Recording")
    .inner_size(45.0, 45.0)    // Square size for circular orb
    .position(x, y)    // Centered horizontally, near bottom vertically
    .decorations(false)        // No window decorations
    .resizable(false)          // Not resizable
    .skip_taskbar(true)        // Don't show in taskbar
    .visible_on_all_workspaces(true)
    .shadow(false)             // No shadow
    .focused(false)            // Don't steal focus
    .visible(false)            // Start hidden!
    .transparent(true)         // Enable transparency with private API
    .content_protected(false)  // Allow screenshots
    .theme(None)               // No theme to avoid default background
    .build()
    .map_err(|e| format!("Failed to create overlay window: {}", e))?;

    // Temporarily disable click-through for debugging
    // overlay_window
    //     .set_ignore_cursor_events(true)
    //     .map_err(|e| format!("Failed to set ignore cursor events: {}", e))?;
    
    overlay_window
        .set_always_on_top(true)
        .map_err(|e| format!("Failed to set always on top: {}", e))?;

    // Apply comprehensive transparency fix for macOS
    #[cfg(target_os = "macos")]
    {
        make_window_truly_transparent(&overlay_window);
        configure_overlay_for_fullscreen(&overlay_window);
    }

    Ok(())
}

// Removed native overlay imports

// ============================================================================
// FN SHORTCUT MANAGER COMMANDS
// ============================================================================

use std::sync::Mutex as StdMutex;

#[cfg(target_os = "macos")]
type FnShortcutManager = StdMutex<Option<keyboard::macos::MacOSFnShortcutManager>>;

#[cfg(target_os = "windows")]
type FnShortcutManager = StdMutex<keyboard::windows::WindowsFnShortcutManager>;

#[cfg(target_os = "linux")]
type FnShortcutManager = StdMutex<keyboard::linux::LinuxFnShortcutManager>;

#[tauri::command]
fn register_fn_shortcut(
    manager: tauri::State<FnShortcutManager>,
    accelerator: String,
    command_id: String,
) -> Result<(), String> {
    println!(
        "[FnShortcut] Command: register_fn_shortcut({}, {})",
        accelerator, command_id
    );

    let mgr_guard = manager.lock().map_err(|_| "Failed to lock manager")?;
    match mgr_guard.as_ref() {
        Some(mgr) => mgr.register(&accelerator, &command_id),
        None => Err("Fn shortcut manager not initialized (check Accessibility permissions)".to_string()),
    }
}

#[tauri::command]
fn unregister_fn_shortcut(
    manager: tauri::State<FnShortcutManager>,
    accelerator: String,
) -> Result<(), String> {
    println!("[FnShortcut] Command: unregister_fn_shortcut({})", accelerator);

    let mgr_guard = manager.lock().map_err(|_| "Failed to lock manager")?;
    match mgr_guard.as_ref() {
        Some(mgr) => mgr.unregister(&accelerator),
        None => Err("Fn shortcut manager not initialized (check Accessibility permissions)".to_string()),
    }
}

#[tauri::command]
fn enable_fn_recording_mode(manager: tauri::State<FnShortcutManager>) -> Result<(), String> {
    println!("[FnShortcut] Command: enable_fn_recording_mode");

    let mgr_guard = manager.lock().map_err(|_| "Failed to lock manager")?;
    match mgr_guard.as_ref() {
        Some(mgr) => mgr.enable_recording_mode(),
        None => Err("Fn shortcut manager not initialized (check Accessibility permissions)".to_string()),
    }
}

#[tauri::command]
fn disable_fn_recording_mode(manager: tauri::State<FnShortcutManager>) -> Result<(), String> {
    println!("[FnShortcut] Command: disable_fn_recording_mode");

    let mgr_guard = manager.lock().map_err(|_| "Failed to lock manager")?;
    match mgr_guard.as_ref() {
        Some(mgr) => mgr.disable_recording_mode(),
        None => Err("Fn shortcut manager not initialized (check Accessibility permissions)".to_string()),
    }
}

#[tauri::command]
fn reinitialize_fn_manager(app: tauri::AppHandle) -> Result<(), String> {
    println!("[FnShortcut] Command: reinitialize_fn_manager");

    #[cfg(target_os = "macos")]
    {
        println!("[FnShortcut] Attempting to create new manager...");
        match keyboard::macos::MacOSFnShortcutManager::new(app.clone()) {
            Ok(new_manager) => {
                println!("[FnShortcut] ✓ New manager created successfully");

                // Get the existing manager state and replace the inner Option
                println!("[FnShortcut] Getting existing manager state...");
                let manager_state: tauri::State<FnShortcutManager> = app.state();

                println!("[FnShortcut] Locking manager state...");
                let mut mgr_guard = manager_state.lock().map_err(|e| {
                    eprintln!("[FnShortcut] ERROR: Failed to lock manager: {:?}", e);
                    "Failed to lock manager".to_string()
                })?;

                println!("[FnShortcut] Replacing None with Some(new_manager)...");
                *mgr_guard = Some(new_manager);

                println!("[FnShortcut] ✓ Manager replaced successfully - Fn shortcuts should now work!");
                Ok(())
            }
            Err(e) => {
                eprintln!("[FnShortcut] ERROR: Failed to create new manager: {}", e);
                Err(format!("Failed to reinitialize Fn manager: {}", e))
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    Ok(())
}

// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[tokio::main]
pub async fn run() {
    // Load .env file if it exists
    dotenvy::dotenv().ok();
    
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_aptabase::Builder::new(
            &std::env::var("APTABASE_KEY").unwrap_or_default()
        ).build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppData::new());

    #[cfg(target_os = "macos")]
    { builder = builder.manage(QwenASRState(std::sync::Arc::new(std::sync::Mutex::new(None)))); }

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Only show and focus the main window if it's not already visible
            // This prevents focus stealing during recording sessions
            if let Some(main_window) = app.get_webview_window("main") {
                if let Ok(is_visible) = main_window.is_visible() {
                    if !is_visible {
                        let _ = main_window.show();
                        let _ = main_window.set_focus();
                    }
                }
            }
        }));
    }

    // Platform-specific command handlers
    #[cfg(target_os = "macos")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        write_text,
        paste,
        open_apple_accessibility,
        is_macos_accessibility_enabled,
        get_selection_with_context,
        is_macos_microphone_enabled,
        request_macos_microphone_permission,
        // Audio recorder commands
        get_current_recording_id,
        enumerate_recording_devices,
        init_recording_session,
        close_recording_session,
        start_recording,
        stop_recording,
        cancel_recording,
        // UI commands
        show_recording_overlay,
        hide_recording_overlay,
        set_overlay_processing,
        // Fn shortcut commands
        register_fn_shortcut,
        unregister_fn_shortcut,
        enable_fn_recording_mode,
        disable_fn_recording_mode,
        reinitialize_fn_manager,
        // Qwen3-ASR local transcription
        transcribe_qwen3_asr,
        preload_qwen3_asr,
        shutdown_qwen3_asr,
        qwen3_asr_model_status,
        download_qwen3_asr_model,
        delete_qwen3_asr_model,
    ]);

    #[cfg(not(target_os = "macos"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        write_text,
        paste,
        // Audio recorder commands
        get_current_recording_id,
        enumerate_recording_devices,
        init_recording_session,
        close_recording_session,
        start_recording,
        stop_recording,
        cancel_recording,
        // UI commands
        show_recording_overlay,
        hide_recording_overlay,
        set_overlay_processing,
        // Fn shortcut commands
        register_fn_shortcut,
        unregister_fn_shortcut,
        enable_fn_recording_mode,
        disable_fn_recording_mode,
        reinitialize_fn_manager,
    ]);

    let mut app = builder
        .setup(|app| {
            println!("[FnShortcut] Initializing Fn shortcut manager...");

            // Initialize Fn shortcut manager based on platform
            #[cfg(target_os = "macos")]
            {
                match keyboard::macos::MacOSFnShortcutManager::new(app.handle().clone()) {
                    Ok(manager) => {
                        println!("[FnShortcut] macOS manager initialized successfully");
                        app.manage(StdMutex::new(Some(manager)));
                    }
                    Err(e) => {
                        eprintln!("[FnShortcut] ERROR: Failed to initialize macOS manager: {}", e);
                        eprintln!("[FnShortcut] Please check Accessibility permissions in System Settings");
                        // Store None so the state exists, will be initialized later
                        app.manage(StdMutex::new(None::<keyboard::macos::MacOSFnShortcutManager>));
                    }
                }
            }

            #[cfg(target_os = "windows")]
            {
                // Windows stub - will return error when trying to use
                println!("[FnShortcut] Windows platform detected (Fn shortcuts not supported)");
                let manager = keyboard::windows::WindowsFnShortcutManager;
                app.manage(StdMutex::new(manager));
            }

            #[cfg(target_os = "linux")]
            {
                // Linux stub - will return error when trying to use
                println!("[FnShortcut] Linux platform detected (Fn shortcuts not supported)");
                let manager = keyboard::linux::LinuxFnShortcutManager;
                app.manage(StdMutex::new(manager));
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Set activation policy to Accessory to hide from dock and run as menu bar app on macOS
    // Note: LSUIElement is set in Info.plist which should handle this
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    // CRITICAL: Create recording overlay at startup (hidden) so we don't create it during recording
    // This prevents focus stealing when recording starts
    let _ = create_recording_overlay_at_startup(&app);
    
    // Create system tray
    let _ = create_system_tray(&app);

    // Show main window on startup
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.show();
        let _ = main_window.set_focus();
    }

    
    app.run(|handler, event| match event {
        tauri::RunEvent::Exit { .. } => {
            let _ = handler.track_event("app_exited", None);
            handler.flush_events_blocking();
        }
        // Handle dock icon clicks on macOS (and similar for other platforms)
        tauri::RunEvent::Reopen { .. } => {
            if let Some(main_window) = handler.get_webview_window("main") {
                let _ = main_window.show();
                let _ = main_window.set_focus();
            }
        }
        tauri::RunEvent::Ready { .. } => {
            let _ = handler.track_event("app_started", None);
        }
        // Handle tray icon events  
        tauri::RunEvent::TrayIconEvent(tray_event) => {
            match tray_event {
                TrayIconEvent::Click { button, button_state, .. } => {
                    // Left click to toggle window visibility
                    if button == tauri::tray::MouseButton::Left && button_state == tauri::tray::MouseButtonState::Up {
                        if let Some(main_window) = handler.get_webview_window("main") {
                            match main_window.is_visible() {
                                Ok(true) => {
                                    let _ = main_window.hide();
                                }
                                Ok(false) => {
                                    let _ = main_window.show();
                                    let _ = main_window.set_focus();
                                }
                                Err(_) => {}
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        // Handle window events
        tauri::RunEvent::WindowEvent { label, event, .. } => {
            match event {
                tauri::WindowEvent::CloseRequested { .. } if label == "main" => {
                    // When user clicks X button, exit the entire app (including tray icon)
                    handler.exit(0);
                }
                _ => {}
            }
        }
        // Handle menu events separately in Tauri 2.0
        tauri::RunEvent::MenuEvent(menu_event) => {
            match menu_event.id().as_ref() {
                "show_hide" => {
                    if let Some(main_window) = handler.get_webview_window("main") {
                        match main_window.is_visible() {
                            Ok(true) => {
                                let _ = main_window.hide();
                            }
                            Ok(false) => {
                                let _ = main_window.show();
                                let _ = main_window.set_focus();
                            }
                            Err(_) => {}
                        }
                    }
                }
                "quit" => {
                    handler.exit(0);
                }
                _ => {}
            }
        }
        _ => {}
    });
}

use enigo::{Direction, Enigo, Key, Keyboard, Settings};

/// Types text character-by-character at the cursor position using Enigo.
///
/// This simulates keyboard input by typing each character sequentially, which works
/// across all applications but is slower than pasting. Best used as a fallback when
/// paste operations fail or for applications that don't support paste.
///
/// **Note**: This method may have issues with non-ASCII characters in some applications
/// and can appear slow for large text blocks.
#[tauri::command]
fn write_text(text: String, app_handle: tauri::AppHandle, keep_window_visible: Option<bool>, refocus_window: Option<bool>) -> Result<(), String> {
    // Hide our main window if it's visible to avoid interfering with focus
    // Unless keep_window_visible is true (used during onboarding when pasting into the app itself)
    let should_hide = !keep_window_visible.unwrap_or(false);
    let should_refocus = refocus_window.unwrap_or(false);

    if should_hide {
        if let Some(main_window) = app_handle.get_webview_window("main") {
            if let Ok(is_visible) = main_window.is_visible() {
                if is_visible {
                    let _ = main_window.hide();
                }
            }
        }
    }
    
    // Try to create Enigo instance with retry for permission issues
    let mut enigo = None;
    let mut last_error = String::new();
    
    for attempt in 1..=2 {
        match Enigo::new(&Settings::default()) {
            Ok(e) => {
                enigo = Some(e);
                break;
            },
            Err(e) => {
                last_error = format!("Failed to create Enigo instance: {}", e);
                
                if last_error.contains("permission") && attempt == 1 {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                }
            }
        }
    }
    
    let mut enigo = enigo.ok_or(last_error)?;
    
    // Removed delay for maximum speed

    // Use clipboard + paste approach instead of character simulation
    // This works better with terminal applications and avoids duplication issues

    // First, copy text to clipboard using Tauri's clipboard manager (handles UTF-8 properly)
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app_handle.clipboard().write_text(text.clone())
        .map_err(|e| format!("Failed to write to clipboard: {}", e))?;
    
    // When pasting into the app itself (onboarding), refocus the window
    if should_refocus {
        if let Some(main_window) = app_handle.get_webview_window("main") {
            let _ = main_window.set_focus();
            // Give focus time to settle
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
    }

    // Then simulate paste (Cmd+V on macOS, Ctrl+V elsewhere)
    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;

    enigo.key(modifier, Direction::Press).map_err(|e| format!("Failed to press modifier key: {}", e))?;
    enigo.key(Key::Unicode('v'), Direction::Click).map_err(|e| format!("Failed to click 'v' key: {}", e))?;
    enigo.key(modifier, Direction::Release).map_err(|e| format!("Failed to release modifier key: {}", e))?;
    
    Ok(())
}

/// Simulates a paste operation (Cmd+V on macOS, Ctrl+V elsewhere).
///
/// **Important**: This assumes text is already in the system clipboard. Call your
/// clipboard service to copy text before using this function.
///
/// **Known Issue**: Uses `Key::Unicode('v')` which assumes QWERTY keyboard layout.
/// This may fail on alternative layouts like Dvorak or Colemak.
#[tauri::command]
fn paste() -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| {
        format!("Failed to create Enigo instance for paste: {}", e)
    })?;

    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;

    enigo
        .key(modifier, Direction::Press)
        .map_err(|e| format!("Failed to press modifier key: {}", e))?;
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| format!("Failed to click 'v' key: {}", e))?;
    enigo
        .key(modifier, Direction::Release)
        .map_err(|e| format!("Failed to release modifier key: {}", e))?;

    Ok(())
}

// Resolves sidecar binary + metallib paths from the app handle.
#[cfg(target_os = "macos")]
fn qwen_daemon_paths(
    app_handle: &tauri::AppHandle,
) -> Result<(std::path::PathBuf, String), String> {
    use tauri::Manager;

    let metallib_path = app_handle
        .path()
        .resource_dir()
        .map(|d| d.join("default.metallib"))
        .ok()
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let exe_dir = std::env::current_exe()
        .map_err(|e| format!("Cannot find exe path: {}", e))?
        .parent()
        .ok_or("Exe has no parent dir")?
        .to_path_buf();

    Ok((exe_dir.join("qwen3-asr-cli"), metallib_path))
}

// Spawns the daemon if not running and blocks until the model is loaded (READY).
// Caller must hold no lock; this locks internally via the guard it receives.
#[cfg(target_os = "macos")]
fn qwen_ensure_daemon(
    guard: &mut Option<QwenASRDaemon>,
    sidecar_bin: &std::path::Path,
    metallib_path: &str,
    model_id: &str,
) -> Result<(), String> {
    use std::io::BufRead;

    // Kill existing daemon if it was loaded with a different model.
    if let Some(existing) = guard.as_ref() {
        if existing.model_id == model_id {
            return Ok(());
        }
        if let Some(mut old) = guard.take() {
            old.child.kill().ok();
            old.child.wait().ok();
        }
    }

    let mut cmd = std::process::Command::new(sidecar_bin);
    cmd.stdin(std::process::Stdio::piped())
       .stdout(std::process::Stdio::piped())
       .stderr(std::process::Stdio::inherit())
       .arg("--model")
       .arg(model_id);

    if !metallib_path.is_empty() {
        cmd.env("MLX_METAL_PATH", metallib_path);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn qwen3-asr-cli: {}", e))?;

    let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let mut stdout = std::io::BufReader::new(
        child.stdout.take().ok_or("Failed to get stdout")?
    );

    // Spawn a reader thread that owns stdout and forwards lines via channel.
    // This lets us use recv_timeout() everywhere instead of blocking read_line().
    let (line_tx, line_rx) = std::sync::mpsc::channel::<String>();
    std::thread::spawn(move || {
        use std::io::BufRead;
        let mut buf = String::new();
        loop {
            buf.clear();
            match stdout.read_line(&mut buf) {
                Ok(0) | Err(_) => break, // EOF or error — receiver gets Disconnected
                Ok(_) => {
                    if line_tx.send(buf.trim().to_string()).is_err() {
                        break; // receiver dropped (daemon cleared) — exit thread
                    }
                }
            }
        }
    });

    let mut daemon = QwenASRDaemon { child, stdin, reader: line_rx, model_id: model_id.to_string() };

    // Wait for "READY" with a 60s timeout — generous enough for slow first loads
    // (Metal kernel compilation) but prevents hanging forever on a stuck sidecar.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            daemon.child.kill().ok();
            return Err("Daemon startup timed out (60s) — sidecar may have hung during model load".to_string());
        }
        match daemon.reader.recv_timeout(remaining) {
            Ok(line) if line == "READY" => break,
            Ok(line) if line.is_empty() => continue,
            Ok(line) => {
                daemon.child.kill().ok();
                return Err(format!("Sidecar startup error: {}", line));
            }
            Err(_) => {
                daemon.child.kill().ok();
                return Err("Daemon startup timed out (60s)".to_string());
            }
        }
    }

    *guard = Some(daemon);
    Ok(())
}

// Guards against concurrent model downloads.
#[cfg(target_os = "macos")]
static QWEN_DOWNLOAD_IN_PROGRESS: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

// Returns "downloaded" or "not_downloaded" based on local model cache.
#[cfg(target_os = "macos")]
#[tauri::command]
async fn qwen3_asr_model_status(
    model_id: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let (sidecar_bin, _) = qwen_daemon_paths(&app_handle)?;

    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new(&sidecar_bin)
            .arg("--model").arg(&model_id)
            .arg("--status")
            .output()
            .map_err(|e| format!("Failed to run status check: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim() == "DOWNLOADED" {
        Ok("downloaded".to_string())
    } else {
        Ok("not_downloaded".to_string())
    }
}

// Downloads the model, emitting "qwen3-asr-download-progress" events (0-100).
#[cfg(target_os = "macos")]
#[tauri::command]
async fn download_qwen3_asr_model(
    model_id: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    use std::io::{BufRead, Read};
    use std::sync::atomic::Ordering;
    use tauri::Emitter;

    if QWEN_DOWNLOAD_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return Err("Download already in progress".to_string());
    }

    let (sidecar_bin, _) = qwen_daemon_paths(&app_handle).map_err(|e| {
        QWEN_DOWNLOAD_IN_PROGRESS.store(false, Ordering::SeqCst);
        e
    })?;

    let result = tokio::task::spawn_blocking(move || {
        let mut child = std::process::Command::new(&sidecar_bin)
            .arg("--model").arg(&model_id)
            .arg("--download")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start download: {}", e))?;

        let stdout = std::io::BufReader::new(
            child.stdout.take().ok_or("Failed to get stdout")?
        );

        let mut done = false;
        for line in stdout.lines() {
            let line = line.map_err(|e| format!("Read error: {}", e))?;
            let line = line.trim();
            if let Some(pct_str) = line.strip_prefix("PROGRESS:") {
                if let Ok(pct) = pct_str.parse::<u32>() {
                    let _ = app_handle.emit("qwen3-asr-download-progress", pct);
                }
            } else if line == "DONE" {
                done = true;
            }
        }

        let mut stderr_text = String::new();
        if let Some(mut stderr) = child.stderr.take() {
            let _ = stderr.read_to_string(&mut stderr_text);
        }

        let status = child.wait().map_err(|e| format!("Wait failed: {}", e))?;

        if done && status.success() {
            Ok(())
        } else {
            Err(format!(
                "Model download failed: {}",
                if stderr_text.trim().is_empty() { "unknown error" } else { stderr_text.trim() }
            ))
        }
    })
    .await
    .map_err(|e| format!("Task error: {}", e))
    .and_then(|r| r);

    QWEN_DOWNLOAD_IN_PROGRESS.store(false, Ordering::SeqCst);
    result
}

// Deletes the cached model weights. Kills the daemon first so the ~1GB of
// loaded weights are freed and the files aren't held open.
#[cfg(target_os = "macos")]
#[tauri::command]
async fn delete_qwen3_asr_model(
    model_id: String,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, QwenASRState>,
) -> Result<(), String> {
    use std::sync::atomic::Ordering;

    if QWEN_DOWNLOAD_IN_PROGRESS.load(Ordering::SeqCst) {
        return Err("Cannot delete while a download is in progress".to_string());
    }

    let (sidecar_bin, _) = qwen_daemon_paths(&app_handle)?;
    let daemon_arc = state.0.clone();

    tokio::task::spawn_blocking(move || {
        let mut guard = daemon_arc.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        // Only kill daemon if it's running the model being deleted.
        if guard.as_ref().map(|d| d.model_id == model_id).unwrap_or(false) {
            if let Some(mut daemon) = guard.take() {
                let _ = daemon.child.kill();
                let _ = daemon.child.wait();
            }
        }

        let output = std::process::Command::new(&sidecar_bin)
            .arg("--model").arg(&model_id)
            .arg("--delete")
            .output()
            .map_err(|e| format!("Failed to run delete: {}", e))?;

        if String::from_utf8_lossy(&output.stdout).trim() == "DELETED" {
            Ok(())
        } else {
            Err(format!(
                "Model delete failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ))
        }
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

// Kills the running daemon, freeing model weights from RAM.
// Called when the user switches away from Qwen3ASR to another service.
#[cfg(target_os = "macos")]
#[tauri::command]
async fn shutdown_qwen3_asr(
    state: tauri::State<'_, QwenASRState>,
) -> Result<(), String> {
    let daemon_arc = state.0.clone();
    tokio::task::spawn_blocking(move || {
        let mut guard = daemon_arc.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        if let Some(mut daemon) = guard.take() {
            daemon.child.kill().ok();
            daemon.child.wait().ok();
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

// Warms up the daemon in the background so the first transcription is instant.
#[cfg(target_os = "macos")]
#[tauri::command]
async fn preload_qwen3_asr(
    model_id: String,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, QwenASRState>,
) -> Result<(), String> {
    let (sidecar_bin, metallib_path) = qwen_daemon_paths(&app_handle)?;
    let daemon_arc = state.0.clone();

    tokio::task::spawn_blocking(move || {
        let mut guard = daemon_arc.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        qwen_ensure_daemon(&mut guard, &sidecar_bin, &metallib_path, &model_id)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn transcribe_qwen3_asr(
    audio_path: String,
    language: Option<String>,
    model_id: String,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, QwenASRState>,
) -> Result<String, String> {
    use std::io::Write;

    let (sidecar_bin, metallib_path) = qwen_daemon_paths(&app_handle)?;

    let daemon_arc = state.0.clone();
    tokio::task::spawn_blocking(move || {
        let mut guard = daemon_arc.lock().map_err(|e| format!("Lock poisoned: {}", e))?;

        qwen_ensure_daemon(&mut guard, &sidecar_bin, &metallib_path, &model_id)?;

        let daemon = guard.as_mut().unwrap();

        // Send "<audio_path>\t<language>" — empty lang = auto-detect.
        let lang = language.unwrap_or_default();
        if let Err(e) = writeln!(daemon.stdin, "{}\t{}", audio_path, lang) {
            *guard = None;
            return Err(format!("Failed to write to sidecar: {}", e));
        }

        // 30s is generous for any real recording; hangs or crashes surface quickly.
        let response = match daemon.reader.recv_timeout(std::time::Duration::from_secs(30)) {
            Ok(line) => line,
            Err(_) => {
                // Timeout or disconnected (daemon died) — clear so next call respawns.
                *guard = None;
                return Err("Transcription timed out or sidecar exited".to_string());
            }
        };

        if let Some(text) = response.strip_prefix("OK:") {
            Ok(text.to_string())
        } else if let Some(err) = response.strip_prefix("ERR:") {
            Err(format!("Transcription error: {}", err))
        } else {
            // Protocol corruption — restart daemon on next call.
            let msg = format!("Unexpected sidecar response: {}", response);
            *guard = None;
            Err(msg)
        }
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}
