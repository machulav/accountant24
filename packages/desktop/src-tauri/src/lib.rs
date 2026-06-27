// Accountant24 desktop shell.
//
// Thin Rust glue around the bun-compiled `accountant24` binary, which is bundled
// as a Tauri sidecar. The shell:
//   - spawns `accountant24 --mode rpc` and bridges its JSONL stdio to/from the
//     webview as Tauri events / commands (see `agent`),
//   - drives `accountant24 auth <cmd>` for the login flow (see `auth`),
//   - injects PATH + TESSDATA_PREFIX so the bundled native tools resolve (`env`).
//
// All UI lives in the React frontend; all domain logic lives in the sidecar.

mod agent;
mod auth;
mod debug;
mod env;

use std::sync::Mutex;
use tauri_plugin_shell::process::CommandChild;

/// Long-lived child processes owned by the shell.
#[derive(Default)]
pub struct AppState {
    /// The `--mode rpc` agent sidecar (one per app session).
    pub rpc: Mutex<Option<CommandChild>>,
    /// The in-progress `auth login` sidecar, if any (OAuth is interactive).
    pub login: Mutex<Option<CommandChild>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            agent::agent_start,
            agent::agent_send,
            agent::agent_stop,
            auth::auth_status,
            auth::auth_providers,
            auth::auth_models,
            auth::auth_set_key,
            auth::auth_logout,
            auth::auth_detect_ollama,
            auth::auth_add_ollama,
            auth::auth_login,
            auth::auth_login_respond,
            auth::auth_login_cancel,
            auth::sessions_list,
            auth::sessions_delete,
            debug::debug_log,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Kill the Rust-spawned sidecars on exit — the shell plugin's auto-kill does
    // not cover children we spawned directly, so without this they'd be orphaned.
    app.run(|handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            kill_children(handle);
        }
    });
}

fn kill_children(handle: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(state) = handle.try_state::<AppState>() else {
        return;
    };
    for slot in [&state.rpc, &state.login] {
        if let Ok(mut guard) = slot.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}
