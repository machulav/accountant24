// Environment overrides for the agent + auth sidecars.
//
// - ACCOUNTANT24_HOME / PI_CODING_AGENT_DIR point pi at the user's workspace
//   (~/Accountant24) so the ledger, auth.json, and models.json live together — what
//   the auth helper writes is what the agent reads.
// - PI_PACKAGE_DIR points stock pi at its staged sibling assets (package.json,
//   theme, export-html) since the sidecar's execPath isn't next to them.
// - PATH / TESSDATA_PREFIX expose the bundled native tools (hledger, pdftotext,
//   tesseract). Launched from Finder, PATH is minimal and excludes Homebrew —
//   bundling + this injection is what makes it zero-setup.
//
// In `tauri dev` the resources aren't bundled into the app, so we resolve them
// from the source tree (populated by `bun run build`); see agent_resource_dir.

use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Directory holding the staged agent resources (the extension JS, the `pi/` asset
/// dir, and bundled `bin/`/`tessdata/`). In a release bundle this is the app's
/// resource dir; in `tauri dev` resources aren't bundled, so we fall back to the
/// source-tree staging location (`desktop/src-tauri/`) populated by `bun run build`.
pub fn agent_resource_dir(app: &AppHandle) -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")))
    } else {
        app.path().resource_dir().ok()
    }
}

/// Absolute path to the bundled extension JS passed to `pi -e`.
pub fn extension_path(app: &AppHandle) -> Option<PathBuf> {
    agent_resource_dir(app).map(|d| d.join("accountant24-extension.js"))
}

/// Env overrides shared by the agent + auth sidecars.
pub fn sidecar_env(app: &AppHandle) -> HashMap<String, String> {
    let mut env = HashMap::new();

    // Workspace dir: ledger + auth.json + models.json all under ~/Accountant24.
    if let Ok(home) = app.path().home_dir() {
        let workspace = home.join("Accountant24").to_string_lossy().to_string();
        env.insert("ACCOUNTANT24_HOME".to_string(), workspace.clone());
        env.insert("PI_CODING_AGENT_DIR".to_string(), workspace);
    }

    let Some(resource_dir) = agent_resource_dir(app) else {
        return env;
    };

    // pi reads its package.json / theme / export-html from PI_PACKAGE_DIR.
    let pi_dir = resource_dir.join("pi-assets");
    if pi_dir.is_dir() {
        env.insert(
            "PI_PACKAGE_DIR".to_string(),
            pi_dir.to_string_lossy().to_string(),
        );
    }

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
