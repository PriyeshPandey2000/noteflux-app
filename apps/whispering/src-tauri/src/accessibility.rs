use accessibility_sys::{kAXTrustedCheckOptionPrompt, AXIsProcessTrustedWithOptions, AXUIElementCopyAttributeValue, AXUIElementCreateSystemWide};
use core_foundation::base::TCFType;
use core_foundation::string::CFString;
use core_foundation_sys::base::{CFRelease, CFTypeRef, TCFTypeRef};
use core_foundation_sys::dictionary::{
    CFDictionaryAddValue, CFDictionaryCreateMutable, __CFDictionary,
};
use core_foundation_sys::number::{kCFBooleanFalse, kCFBooleanTrue};
use core_foundation_sys::string::CFStringRef;
use std::ffi::c_void;
use std::process::Command;
use std::ptr;

// CFRange: location and length in CFString character units (UTF-16 code units on macOS)
#[repr(C)]
struct CFRange {
    location: i64,
    length: i64,
}

// kAXValueCFRangeType = 4, from AXValue.h
const AX_VALUE_CF_RANGE_TYPE: u32 = 4;

extern "C" {
    fn AXValueGetValue(value: *const c_void, the_type: u32, value_ptr: *mut c_void) -> bool;
}

#[derive(serde::Serialize)]
pub struct SelectionContext {
    pub selected_text: String,
    pub context_before: String,
    pub context_after: String,
}

#[tauri::command]
pub fn is_macos_accessibility_enabled(ask_if_not_allowed: bool) -> Result<bool, &'static str> {
    let options = create_options_dictionary(ask_if_not_allowed)?;
    let is_allowed = unsafe { AXIsProcessTrustedWithOptions(options) };
    release_options_dictionary(options);
    Ok(is_allowed)
}

fn create_options_dictionary(
    ask_if_not_allowed: bool,
) -> Result<*mut __CFDictionary, &'static str> {
    unsafe {
        let options = CFDictionaryCreateMutable(ptr::null_mut(), 0, ptr::null(), ptr::null());
        if options.is_null() {
            return Err("Failed to create options dictionary");
        }
        let key = kAXTrustedCheckOptionPrompt;
        let value = if ask_if_not_allowed {
            kCFBooleanTrue
        } else {
            kCFBooleanFalse
        };
        CFDictionaryAddValue(options, key.as_void_ptr(), value.as_void_ptr());
        Ok(options)
    }
}

fn release_options_dictionary(options: *mut __CFDictionary) {
    unsafe {
        CFRelease(options as *const _);
    }
}


/// Returns the selected text plus up to `context_chars` characters of surrounding
/// text from the focused element. Falls back to empty context strings if the
/// full-text or range attributes are unavailable (e.g. password fields, PDFs).
#[tauri::command]
pub fn get_selection_with_context(context_chars: usize) -> Result<Option<SelectionContext>, String> {
    unsafe {
        // 1. Get the focused UI element
        let system_wide = AXUIElementCreateSystemWide();
        let focused_attr = CFString::new("AXFocusedUIElement");
        let mut focused: CFTypeRef = ptr::null();
        let err = AXUIElementCopyAttributeValue(
            system_wide,
            focused_attr.as_concrete_TypeRef() as CFStringRef,
            &mut focused,
        );
        CFRelease(system_wide as _);
        if err != 0 || focused.is_null() {
            return Ok(None);
        }

        let focused_elem = focused as accessibility_sys::AXUIElementRef;

        // 2. Read AXSelectedText
        let selected_attr = CFString::new("AXSelectedText");
        let mut selected_ref: CFTypeRef = ptr::null();
        let err = AXUIElementCopyAttributeValue(
            focused_elem,
            selected_attr.as_concrete_TypeRef() as CFStringRef,
            &mut selected_ref,
        );
        if err != 0 || selected_ref.is_null() {
            CFRelease(focused as _);
            return Ok(None);
        }
        let selected_cf = CFString::wrap_under_create_rule(selected_ref as CFStringRef);
        let selected_text = selected_cf.to_string();
        if selected_text.is_empty() {
            CFRelease(focused as _);
            return Ok(None);
        }

        // 3. Read AXSelectedTextRange → CFRange
        let range_attr = CFString::new("AXSelectedTextRange");
        let mut range_ref: CFTypeRef = ptr::null();
        let range_err = AXUIElementCopyAttributeValue(
            focused_elem,
            range_attr.as_concrete_TypeRef() as CFStringRef,
            &mut range_ref,
        );

        // 4. Read AXValue (full text of element)
        let value_attr = CFString::new("AXValue");
        let mut value_ref: CFTypeRef = ptr::null();
        let value_err = AXUIElementCopyAttributeValue(
            focused_elem,
            value_attr.as_concrete_TypeRef() as CFStringRef,
            &mut value_ref,
        );
        CFRelease(focused as _);

        // If either attribute failed, return selection with empty context
        if range_err != 0 || range_ref.is_null() || value_err != 0 || value_ref.is_null() {
            if !range_ref.is_null() { CFRelease(range_ref as _); }
            if !value_ref.is_null() { CFRelease(value_ref as _); }
            return Ok(Some(SelectionContext {
                selected_text,
                context_before: String::new(),
                context_after: String::new(),
            }));
        }

        // Extract CFRange from the AXValueRef
        let mut range = CFRange { location: 0, length: 0 };
        let got_range = AXValueGetValue(
            range_ref as *const c_void,
            AX_VALUE_CF_RANGE_TYPE,
            &mut range as *mut CFRange as *mut c_void,
        );
        CFRelease(range_ref as _);

        if !got_range {
            CFRelease(value_ref as _);
            return Ok(Some(SelectionContext {
                selected_text,
                context_before: String::new(),
                context_after: String::new(),
            }));
        }

        // Get full text
        let full_cf = CFString::wrap_under_create_rule(value_ref as CFStringRef);
        let full_text = full_cf.to_string();

        // Slice context using char indices (Unicode-safe, handles CJK/emoji)
        let chars: Vec<char> = full_text.chars().collect();
        let total = chars.len();
        let loc = (range.location as usize).min(total);
        let end = (loc + range.length as usize).min(total);

        let before_start = loc.saturating_sub(context_chars);
        let after_end = (end + context_chars).min(total);

        let context_before: String = chars[before_start..loc].iter().collect();
        let context_after: String = chars[end..after_end].iter().collect();

        Ok(Some(SelectionContext {
            selected_text,
            context_before,
            context_after,
        }))
    }
}

#[tauri::command]
pub async fn open_apple_accessibility() -> Result<(), String> {
    Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .status()
        .map_err(|e| format!("Failed to execute command: {}", e))
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err(format!("Command failed with status: {}", status))
            }
        })
}
