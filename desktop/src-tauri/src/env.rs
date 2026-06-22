// Environment overrides for the agent sidecar so it finds the bundled native
// tools (hledger, pdftotext, tesseract) regardless of the OS PATH the app was
// launched with. When the app is launched from Finder, PATH is minimal and does
// NOT include Homebrew — bundling + this injection is what makes it zero-setup.
//
// In `tauri dev` the resources aren't staged, so these dirs won't exist and we
// leave PATH untouched (the developer's PATH already has the tools).

use std::collections::HashMap;
use tauri::{AppHandle, Manager};

/// Env overrides to pass to the sidecar. Empty in dev (falls back to OS PATH).
pub fn sidecar_env(app: &AppHandle) -> HashMap<String, String> {
    let mut env = HashMap::new();

    let Ok(resource_dir) = app.path().resource_dir() else {
        return env;
    };

    let bin = resource_dir.join("bin");
    if bin.is_dir() {
        let bin_str = bin.to_string_lossy().to_string();
        let current = std::env::var("PATH").unwrap_or_default();
        let path = if current.is_empty() {
            bin_str
        } else {
            format!("{bin_str}:{current}")
        };
        env.insert("PATH".to_string(), path);
    }

    let tessdata = resource_dir.join("tessdata");
    if tessdata.is_dir() {
        // tesseract 4/5 resolves `<lang>.traineddata` directly under TESSDATA_PREFIX.
        env.insert(
            "TESSDATA_PREFIX".to_string(),
            tessdata.to_string_lossy().to_string(),
        );
    }

    env
}
