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

    let mut child = Command::new(&sidecar_bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn ocr-cli: {}", e))?;

    child
        .stdin
        .take()
        .ok_or("Failed to open ocr-cli stdin")?
        .write_all(&image_bytes)
        .map_err(|e| format!("Failed to write image to ocr-cli: {}", e))?;

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to read ocr-cli output: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ocr-cli failed: {}", stderr.trim()));
    }

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        return Err("No text found in image".to_string());
    }

    app_handle
        .clipboard()
        .write_text(text.clone())
        .map_err(|e| format!("Failed to copy extracted text: {}", e))?;

    Ok(text)
}
