// Temporary diagnostics: append a line to /tmp/a24-desktop.log so the chat
// data-flow can be traced from a file (no DevTools needed). Remove once the
// chat issue is resolved.

use std::fs::OpenOptions;
use std::io::Write;

const LOG_PATH: &str = "/tmp/a24-desktop.log";

pub fn log(msg: &str) {
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(LOG_PATH) {
        let _ = writeln!(f, "{msg}");
    }
}

/// Frontend-callable: route webview logs into the same file.
#[tauri::command]
pub fn debug_log(msg: String) {
    log(&format!("[fe] {msg}"));
}
