// Extracts text from whatever image is currently on the clipboard, using the
// ocr-cli sidecar (Vision framework, fully on-device, no network, no Apple
// Intelligence eligibility gate — VNRecognizeTextRequest has shipped since
// macOS 10.15). Reads the image straight from NSPasteboard rather than going
// through tauri-plugin-clipboard-manager's read_image(), which only exposes
// decoded RGBA — Vision needs the original encoded bytes (PNG/TIFF/JPEG), and
// re-encoding from RGBA would lose quality that matters for OCR accuracy.
use cocoa::base::{id, nil};
use cocoa::foundation::NSString;
use objc::{class, msg_send, sel, sel_impl};
use std::io::Write;
use std::process::{Command, Stdio};

fn read_clipboard_image_bytes() -> Result<Vec<u8>, String> {
    unsafe {
        let pasteboard: id = msg_send![class!(NSPasteboard), generalPasteboard];
        for uti in ["public.png", "public.tiff", "public.jpeg"] {
            let type_id = NSString::alloc(nil).init_str(uti);
            let data: id = msg_send![pasteboard, dataForType: type_id];
            if data == nil {
                continue;
            }
            let length: usize = msg_send![data, length];
            if length == 0 {
                continue;
            }
            let bytes_ptr: *const u8 = msg_send![data, bytes];
            if bytes_ptr.is_null() {
                continue;
            }
            let slice = std::slice::from_raw_parts(bytes_ptr, length);
            return Ok(slice.to_vec());
        }
    }
    Err("No image found on clipboard".to_string())
}

#[tauri::command]
pub async fn extract_text_from_clipboard(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;

    let image_bytes = read_clipboard_image_bytes()?;

    let exe_dir = std::env::current_exe()
        .map_err(|e| format!("Cannot find exe path: {}", e))?
        .parent()
        .ok_or("Exe has no parent dir")?
        .to_path_buf();
    let sidecar_bin = exe_dir.join("ocr-cli");

    // Spawning + writing stdin + waiting are all blocking std::process calls —
    // run them on a blocking thread (same pattern as qwen3_asr_model_status in
    // lib.rs) so a slow Vision call or a hung sidecar can't tie up a tokio
    // runtime worker that other async commands need.
    let text = tokio::task::spawn_blocking(move || run_ocr_cli(&sidecar_bin, &image_bytes))
        .await
        .map_err(|e| format!("Task error: {}", e))??;

    app_handle
        .clipboard()
        .write_text(text.clone())
        .map_err(|e| format!("Failed to copy extracted text: {}", e))?;

    Ok(text)
}

// Runs on a blocking thread — see caller. A hard 30s timeout kills the child
// if it hangs, same bound used for the ASR daemon's own call timeouts
// elsewhere in lib.rs. The wait happens on a second thread so output keeps
// draining while we watch the clock: polling try_wait() without reading the
// pipes risks a classic deadlock if recognized text fills the OS pipe buffer
// before the process exits.
fn run_ocr_cli(sidecar_bin: &std::path::Path, image_bytes: &[u8]) -> Result<String, String> {
    let mut child = Command::new(sidecar_bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn ocr-cli: {}", e))?;

    child
        .stdin
        .take()
        .ok_or("Failed to open ocr-cli stdin")?
        .write_all(image_bytes)
        .map_err(|e| format!("Failed to write image to ocr-cli: {}", e))?;

    let pid = child.id();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });

    let output = match rx.recv_timeout(std::time::Duration::from_secs(30)) {
        Ok(result) => result.map_err(|e| format!("Failed to read ocr-cli output: {}", e))?,
        Err(_) => {
            let _ = Command::new("kill").arg("-9").arg(pid.to_string()).status();
            return Err("ocr-cli timed out after 30s".to_string());
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ocr-cli failed: {}", stderr.trim()));
    }

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        return Err("No text found in image".to_string());
    }

    Ok(text)
}
