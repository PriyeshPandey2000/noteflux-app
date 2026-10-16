use core_foundation::runloop::CFRunLoop;
use core_graphics::event::{
    CGEvent, CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions,
    CGEventTapPlacement, CGEventType, EventField,
};
use crossbeam_channel::{unbounded, Receiver, Sender};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

// ============================================================================
// TYPES & STATE
// ============================================================================

/// Events sent from callback to processing thread
#[derive(Debug, Clone)]
enum ShortcutEvent {
    FnAloneTriggered,
    FnPressed, // Fn key pressed down
    FnReleased, // Fn key released up
    FnComboTriggered { accelerator: String },
    TapDisabled,
    FnKeyPressedForRecording, // Sent when Fn is pressed during recording mode
    FnKeyReleasedForRecording, // Sent when Fn is released during recording mode
}

/// State tracking for Fn alone detection (shared between callback and manager)
#[derive(Debug)]
struct FnState {
    is_pressed: bool,
    was_pressed_last_frame: bool,
    press_time: Option<Instant>,
    other_keys_pressed: bool,
}

impl Default for FnState {
    fn default() -> Self {
        Self {
            is_pressed: false,
            was_pressed_last_frame: false,
            press_time: None,
            other_keys_pressed: false,
        }
    }
}

/// Shared state accessed by callback (must be thread-safe)
struct SharedState {
    registered_shortcuts: HashMap<String, String>, // accelerator -> command_id
    fn_state: FnState,
    recording_mode: bool, // When true, emit all Fn keypresses for UI recording
}

// ============================================================================
// MAIN MANAGER
// ============================================================================

pub struct MacOSFnShortcutManager {
    state: Arc<Mutex<SharedState>>,
    _monitoring_thread: thread::JoinHandle<()>,
    _processing_thread: thread::JoinHandle<()>,
}

impl MacOSFnShortcutManager {
    pub fn new(app: AppHandle) -> Result<Self, String> {
        println!("[FnShortcut] Initializing macOS Fn shortcut manager");

        let (event_sender, event_receiver) = unbounded::<ShortcutEvent>();
        println!("[FnShortcut] Created event channel");

        let state = Arc::new(Mutex::new(SharedState {
            registered_shortcuts: HashMap::new(),
            fn_state: FnState::default(),
            recording_mode: false,
        }));
        println!("[FnShortcut] Created shared state");

        // Spawn processing thread (handles AppHandle.emit_all)
        let app_clone = app.clone();
        let state_clone = state.clone();
        let processing_thread = thread::spawn(move || {
            println!("[FnShortcut] Processing thread started");
            process_events(app_clone, state_clone, event_receiver);
        });

        // Spawn monitoring thread (runs CFRunLoop with CGEventTap)
        let state_clone = state.clone();
        let monitoring_thread = thread::spawn(move || {
            println!("[FnShortcut] Monitoring thread started");
            if let Err(e) = start_event_tap(state_clone, event_sender) {
                eprintln!("[FnShortcut] ERROR: Failed to start event tap: {}", e);
            }
        });

        println!("[FnShortcut] Manager initialized successfully");

        Ok(Self {
            state,
            _monitoring_thread: monitoring_thread,
            _processing_thread: processing_thread,
        })
    }

    pub fn register(&self, shortcut: &str, command_id: &str) -> Result<(), String> {
        if !shortcut.contains("Fn") {
            return Err("Shortcut must contain Fn modifier".to_string());
        }

        let mut state = self.state.lock().map_err(|_| "Failed to lock state")?;

        println!(
            "[FnShortcut] Registering: {} -> {}",
            shortcut, command_id
        );

        state
            .registered_shortcuts
            .insert(shortcut.to_string(), command_id.to_string());

        println!(
            "[FnShortcut] Total registered shortcuts: {}",
            state.registered_shortcuts.len()
        );

        Ok(())
    }

    pub fn unregister(&self, shortcut: &str) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "Failed to lock state")?;

        println!("[FnShortcut] Unregistering: {}", shortcut);

        state.registered_shortcuts.remove(shortcut);

        println!(
            "[FnShortcut] Total registered shortcuts: {}",
            state.registered_shortcuts.len()
        );

        Ok(())
    }

    pub fn enable_recording_mode(&self) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "Failed to lock state")?;
        state.recording_mode = true;
        println!("[FnShortcut] Recording mode ENABLED");
        Ok(())
    }

    pub fn disable_recording_mode(&self) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "Failed to lock state")?;
        state.recording_mode = false;
        println!("[FnShortcut] Recording mode DISABLED");
        Ok(())
    }
}

// ============================================================================
// PROCESSING THREAD (Heavy lifting, off callback thread)
// ============================================================================

fn process_events(
    app: AppHandle,
    state: Arc<Mutex<SharedState>>,
    receiver: Receiver<ShortcutEvent>,
) {
    while let Ok(event) = receiver.recv() {
        println!("[FnShortcut] Processing event: {:?}", event);

        match event {
            ShortcutEvent::FnAloneTriggered => {
                // Get the command_id for "Fn" shortcut
                let command_id = {
                    let state = state.lock().unwrap();
                    state.registered_shortcuts.get("Fn").cloned()
                };

                if let Some(cmd_id) = command_id {
                    println!("[FnShortcut] Emitting Fn alone trigger: {}", cmd_id);
                    let _ = app.emit("fn-shortcut-triggered", &cmd_id);
                } else {
                    println!("[FnShortcut] WARN: Fn alone triggered but no 'Fn' shortcut registered");
                }
            }
            ShortcutEvent::FnPressed => {
                // Emit press event for push-to-talk support
                let command_id = {
                    let state = state.lock().unwrap();
                    state.registered_shortcuts.get("Fn").cloned()
                };

                if let Some(cmd_id) = command_id {
                    println!("[FnShortcut] Emitting Fn PRESSED: {}", cmd_id);
                    let _ = app.emit("fn-shortcut-pressed", &cmd_id);
                } else {
                    println!("[FnShortcut] WARN: Fn pressed but no 'Fn' shortcut registered");
                }
            }
            ShortcutEvent::FnReleased => {
                // Emit release event for push-to-talk support
                let command_id = {
                    let state = state.lock().unwrap();
                    state.registered_shortcuts.get("Fn").cloned()
                };

                if let Some(cmd_id) = command_id {
                    println!("[FnShortcut] Emitting Fn RELEASED: {}", cmd_id);
                    let _ = app.emit("fn-shortcut-released", &cmd_id);
                } else {
                    println!("[FnShortcut] WARN: Fn released but no 'Fn' shortcut registered");
                }
            }
            ShortcutEvent::FnComboTriggered { accelerator } => {
                let command_id = {
                    let state = state.lock().unwrap();
                    state.registered_shortcuts.get(&accelerator).cloned()
                };

                if let Some(cmd_id) = command_id {
                    println!(
                        "[FnShortcut] Emitting Fn combo trigger: {} -> {}",
                        accelerator, cmd_id
                    );
                    let _ = app.emit("fn-shortcut-triggered", &cmd_id);
                } else {
                    println!(
                        "[FnShortcut] WARN: Combo triggered but no '{}' shortcut registered",
                        accelerator
                    );
                }
            }
            ShortcutEvent::TapDisabled => {
                eprintln!("[FnShortcut] ERROR: Event tap disabled, need to restart");
                // TODO: Implement restart logic
            }
            ShortcutEvent::FnKeyPressedForRecording => {
                println!("[FnShortcut] Emitting Fn key press for UI recording");
                let _ = app.emit("fn-key-pressed-for-recording", ());
            }
            ShortcutEvent::FnKeyReleasedForRecording => {
                println!("[FnShortcut] Emitting Fn key release for UI recording");
                let _ = app.emit("fn-key-released-for-recording", ());
            }
        }
    }
}

// ============================================================================
// MONITORING THREAD (CFRunLoop with CGEventTap)
// ============================================================================

fn start_event_tap(
    state: Arc<Mutex<SharedState>>,
    event_sender: Sender<ShortcutEvent>,
) -> Result<(), String> {
    println!("[FnShortcut] Creating event tap...");

    // Events we want to monitor
    let events_of_interest = vec![CGEventType::FlagsChanged, CGEventType::KeyDown];

    println!("[FnShortcut] Monitoring events: {:?}", events_of_interest);

    // Clone for closure
    let state_clone = state.clone();
    let sender_clone = event_sender.clone();

    // Create the event tap with a Rust closure
    let tap = CGEventTap::new(
        CGEventTapLocation::HID,
        CGEventTapPlacement::HeadInsertEventTap,
        CGEventTapOptions::Default,
        events_of_interest,
        move |_proxy, event_type, event| -> Option<CGEvent> {
            handle_event_tap(event_type, event, &state_clone, &sender_clone)
        },
    )
    .map_err(|_| {
        "Failed to create CGEventTap (check Accessibility permissions in System Settings)"
            .to_string()
    })?;

    println!("[FnShortcut] Event tap created successfully");

    tap.enable();

    println!("[FnShortcut] Event tap enabled");

    // Create a CFRunLoopSource from the event tap and add it to the current run loop
    use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};

    let loop_source = tap
        .mach_port
        .create_runloop_source(0)
        .map_err(|_| "Failed to create run loop source".to_string())?;

    println!("[FnShortcut] Created run loop source");

    let current_loop = CFRunLoop::get_current();
    current_loop.add_source(&loop_source, unsafe { kCFRunLoopCommonModes });

    println!("[FnShortcut] Added source to run loop, entering run loop...");

    // This blocks the thread indefinitely (required for event tap)
    CFRunLoop::run_current();

    println!("[FnShortcut] RunLoop exited (unexpected)");

    Ok(())
}

// ============================================================================
// EVENT TAP HANDLER (Minimal work, instant decisions)
// ============================================================================

fn handle_event_tap(
    event_type: CGEventType,
    event: &CGEvent,
    state: &Arc<Mutex<SharedState>>,
    sender: &Sender<ShortcutEvent>,
) -> Option<CGEvent> {
    match event_type {
        CGEventType::TapDisabledByTimeout => {
            eprintln!("[FnShortcut] CALLBACK: Tap disabled by timeout!");
            let _ = sender.send(ShortcutEvent::TapDisabled);
            Some(event.clone())
        }

        CGEventType::FlagsChanged => handle_flags_changed(event, state, sender),

        CGEventType::KeyDown => handle_key_down(event, state, sender),

        _ => Some(event.clone()),
    }
}

fn handle_flags_changed(
    event: &CGEvent,
    state: &Arc<Mutex<SharedState>>,
    sender: &Sender<ShortcutEvent>,
) -> Option<CGEvent> {
    let flags = event.get_flags();
    let fn_now = flags.contains(CGEventFlags::CGEventFlagSecondaryFn);

    // Lock state for minimal time
    let mut state_guard = state.lock().unwrap();

    // Check other modifiers FIRST
    let other_mods = flags.contains(CGEventFlags::CGEventFlagCommand)
        || flags.contains(CGEventFlags::CGEventFlagControl)
        || flags.contains(CGEventFlags::CGEventFlagAlternate)
        || flags.contains(CGEventFlags::CGEventFlagShift);

    if other_mods {
        // Other modifiers held, invalidate Fn alone
        if state_guard.fn_state.is_pressed {
            println!("[FnShortcut] CALLBACK: Other modifiers detected, invalidating Fn alone");
        }
        state_guard.fn_state.is_pressed = false;
        state_guard.fn_state.was_pressed_last_frame = fn_now;
        drop(state_guard);
        return Some(event.clone());
    }

    // Detect Fn DOWN (transition false -> true)
    if fn_now && !state_guard.fn_state.was_pressed_last_frame {
        println!("[FnShortcut] CALLBACK: Fn DOWN detected");
        state_guard.fn_state.is_pressed = true;
        state_guard.fn_state.press_time = Some(Instant::now());
        state_guard.fn_state.other_keys_pressed = false;
        state_guard.fn_state.was_pressed_last_frame = true;

        // Check if Fn is registered (for push-to-talk support)
        let is_registered = state_guard.registered_shortcuts.contains_key("Fn");
        let is_recording = state_guard.recording_mode;
        drop(state_guard);

        if is_recording {
            println!("[FnShortcut] CALLBACK: Recording mode - sending Fn press to UI");
            let _ = sender.send(ShortcutEvent::FnKeyPressedForRecording);
        }

        // Emit press event for push-to-talk
        if is_registered {
            println!("[FnShortcut] CALLBACK: Sending FnPressed event");
            let _ = sender.send(ShortcutEvent::FnPressed);
        }

        // PASS THROUGH - system needs to see Fn for hardware keys
        return Some(event.clone());
    }

    // Detect Fn UP (transition true -> false)
    if !fn_now && state_guard.fn_state.was_pressed_last_frame {
        println!("[FnShortcut] CALLBACK: Fn UP detected");
        state_guard.fn_state.is_pressed = false;
        state_guard.fn_state.was_pressed_last_frame = false;

        // Check if this should trigger "Fn alone" (quick tap)
        let should_trigger_tap = if let Some(start) = state_guard.fn_state.press_time {
            let duration_ms = start.elapsed().as_millis();
            let is_quick = duration_ms < 300;
            let no_interference = !state_guard.fn_state.other_keys_pressed;
            let is_registered = state_guard.registered_shortcuts.contains_key("Fn");

            println!(
                "[FnShortcut] CALLBACK: Fn tap check - duration: {}ms, quick: {}, no_interference: {}, registered: {}",
                duration_ms, is_quick, no_interference, is_registered
            );

            is_quick && no_interference && is_registered
        } else {
            false
        };

        // Always emit release event for push-to-talk support
        let is_registered = state_guard.registered_shortcuts.contains_key("Fn");
        let is_recording = state_guard.recording_mode;
        drop(state_guard); // Release lock before sending

        if is_recording {
            println!("[FnShortcut] CALLBACK: Recording mode - sending Fn release to UI");
            let _ = sender.send(ShortcutEvent::FnKeyReleasedForRecording);
        }

        if is_registered {
            println!("[FnShortcut] CALLBACK: Sending FnReleased event");
            let _ = sender.send(ShortcutEvent::FnReleased);
        }

        if should_trigger_tap {
            println!("[FnShortcut] CALLBACK: Fn tap triggered! Swallowing event.");
            // Send tap event to processing thread
            let _ = sender.send(ShortcutEvent::FnAloneTriggered);

            // CRITICAL: SWALLOW the UP event to prevent emoji picker
            return None;
        } else {
            println!("[FnShortcut] CALLBACK: Fn released, passing through");
        }
    } else {
        state_guard.fn_state.was_pressed_last_frame = fn_now;
        drop(state_guard);
    }

    // Pass through
    Some(event.clone())
}

fn handle_key_down(
    event: &CGEvent,
    state: &Arc<Mutex<SharedState>>,
    sender: &Sender<ShortcutEvent>,
) -> Option<CGEvent> {
    let flags = event.get_flags();
    let has_fn = flags.contains(CGEventFlags::CGEventFlagSecondaryFn);

    // Mark that other keys were pressed
    {
        let mut state_guard = state.lock().unwrap();
        if state_guard.fn_state.is_pressed {
            println!("[FnShortcut] CALLBACK: Other key pressed while Fn held, marking interference");
            state_guard.fn_state.other_keys_pressed = true;
        }
    }

    // Only process if Fn is held
    if !has_fn {
        return Some(event.clone());
    }

    // Get keycode and build accelerator
    let keycode = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE);
    let accelerator = build_accelerator_string(flags, keycode);

    println!(
        "[FnShortcut] CALLBACK: Key down with Fn - accelerator: {}",
        accelerator
    );

    // Check if registered
    let is_registered = {
        let state_guard = state.lock().unwrap();
        state_guard.registered_shortcuts.contains_key(&accelerator)
    };

    if is_registered {
        println!(
            "[FnShortcut] CALLBACK: Registered combo triggered: {}",
            accelerator
        );
        // Send to processing thread
        let _ = sender.send(ShortcutEvent::FnComboTriggered {
            accelerator: accelerator.clone(),
        });

        // Consume the event
        return None;
    } else {
        println!(
            "[FnShortcut] CALLBACK: Combo not registered: {}, passing through",
            accelerator
        );
    }

    // Pass through
    Some(event.clone())
}

// ============================================================================
// HELPERS
// ============================================================================

fn build_accelerator_string(flags: CGEventFlags, keycode: i64) -> String {
    let mut parts = Vec::new();

    parts.push("Fn".to_string());

    if flags.contains(CGEventFlags::CGEventFlagControl) {
        parts.push("Control".to_string());
    }
    if flags.contains(CGEventFlags::CGEventFlagAlternate) {
        parts.push("Option".to_string());
    }
    if flags.contains(CGEventFlags::CGEventFlagShift) {
        parts.push("Shift".to_string());
    }
    if flags.contains(CGEventFlags::CGEventFlagCommand) {
        parts.push("Command".to_string());
    }

    parts.push(keycode_to_string(keycode));

    parts.join("+")
}

fn keycode_to_string(keycode: i64) -> String {
    match keycode {
        0 => "A",
        1 => "S",
        2 => "D",
        3 => "F",
        4 => "H",
        5 => "G",
        6 => "Z",
        7 => "X",
        8 => "C",
        9 => "V",
        11 => "B",
        12 => "Q",
        13 => "W",
        14 => "E",
        15 => "R",
        16 => "Y",
        17 => "T",
        18 => "1",
        19 => "2",
        20 => "3",
        21 => "4",
        22 => "6",
        23 => "5",
        24 => "=",
        25 => "9",
        26 => "7",
        27 => "-",
        28 => "8",
        29 => "0",
        30 => "]",
        31 => "O",
        32 => "U",
        33 => "[",
        34 => "I",
        35 => "P",
        36 => "Return",
        37 => "L",
        38 => "J",
        39 => "'",
        40 => "K",
        41 => ";",
        42 => "\\",
        43 => ",",
        44 => "/",
        45 => "N",
        46 => "M",
        47 => ".",
        48 => "Tab",
        49 => "Space",
        50 => "`",
        51 => "Delete",
        53 => "Escape",
        96 => "F5",
        97 => "F6",
        98 => "F7",
        99 => "F3",
        100 => "F8",
        101 => "F9",
        103 => "F11",
        109 => "F10",
        111 => "F12",
        118 => "F4",
        120 => "F2",
        122 => "F1",
        _ => "Unknown",
    }
    .to_string()
}
