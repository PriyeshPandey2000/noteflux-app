use cocoa::base::{id, nil};
use cocoa::foundation::NSString;
use objc::runtime::Class;
use objc::{msg_send, sel, sel_impl};
use serde::Serialize;
use std::ffi::CStr;

#[derive(Serialize)]
pub struct FrontmostAppInfo {
    bundle_id: Option<String>,
    name: Option<String>,
}

/// Fetch the frontmost app's bundle identifier and display name via
/// NSWorkspace. No Accessibility/Screen Recording permission required —
/// this is a plain Cocoa API.
#[tauri::command]
pub fn get_frontmost_app() -> Result<FrontmostAppInfo, String> {
    unsafe {
        let workspace_class = match Class::get("NSWorkspace") {
            Some(class) => class,
            None => return Err("NSWorkspace class not found".to_string()),
        };

        let workspace: id = msg_send![workspace_class, sharedWorkspace];
        let frontmost_app: id = msg_send![workspace, frontmostApplication];
        if frontmost_app == nil {
            return Err("No frontmost application".to_string());
        }

        let bundle_id_ns: id = msg_send![frontmost_app, bundleIdentifier];
        let name_ns: id = msg_send![frontmost_app, localizedName];

        Ok(FrontmostAppInfo {
            bundle_id: ns_string_to_string(bundle_id_ns),
            name: ns_string_to_string(name_ns),
        })
    }
}

unsafe fn ns_string_to_string(ns_str: id) -> Option<String> {
    if ns_str == nil {
        return None;
    }
    let utf8_ptr = ns_str.UTF8String();
    if utf8_ptr.is_null() {
        return None;
    }
    Some(CStr::from_ptr(utf8_ptr).to_string_lossy().into_owned())
}
