// RPC agent sidecar: spawn stock `pi --mode rpc` with our customization loaded as
// an external extension (`-e accountant24-extension.js`), and bridge its JSONL stdio.
//
// stdout lines  -> Tauri event "agent-event"  (each line is one RPC event/response)
// "agent_send"  -> one JSON command written to stdin (+ "\n")
//
// The extension-UI sub-protocol (confirm/select/input + their responses) rides
// the same channel: requests arrive as "agent-event" lines, and the frontend
// answers by calling agent_send with an {type:"extension_ui_response", ...}.

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use crate::env::sidecar_env;
use crate::AppState;

/// Spawn the agent sidecar if it isn't already running. Idempotent.
#[tauri::command]
pub async fn agent_start(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // Hold the lock across the whole check-spawn-store so two concurrent calls
    // (e.g. React StrictMode double-mount) can't both spawn a sidecar. spawn()
    // is synchronous, so the guard is never held across an .await.
    let mut guard = state.rpc.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        crate::debug::log("[rs] agent_start: already running");
        return Ok(());
    }

    crate::debug::log("[rs] agent_start: spawning sidecar");
    let ext_path = crate::env::extension_path(&app)
        .ok_or_else(|| "could not resolve extension path".to_string())?
        .to_string_lossy()
        .to_string();
    let sidecar = app.shell().sidecar("pi").map_err(|e| {
        crate::debug::log(&format!("[rs] sidecar() error: {e}"));
        e.to_string()
    })?;
    let (mut rx, child) = sidecar
        .args([
            "--mode",
            "rpc",
            "--no-extensions",
            "--no-skills",
            "--no-prompt-templates",
            "-e",
            ext_path.as_str(),
        ])
        .envs(sidecar_env(&app))
        .spawn()
        .map_err(|e| {
            crate::debug::log(&format!("[rs] spawn() error: {e}"));
            e.to_string()
        })?;
    crate::debug::log("[rs] agent_start: sidecar spawned");

    *guard = Some(child);
    drop(guard);

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let raw = String::from_utf8_lossy(&bytes);
                    let line = raw.trim_end_matches(['\r', '\n']);
                    if !line.is_empty() {
                        crate::debug::log(&format!(
                            "[rs] stdout: {}",
                            line.chars().take(120).collect::<String>()
                        ));
                        let _ = handle.emit("agent-event", line.to_string());
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let raw = String::from_utf8_lossy(&bytes);
                    let line = raw.trim_end_matches(['\r', '\n']);
                    if !line.is_empty() {
                        crate::debug::log(&format!(
                            "[rs] stderr: {}",
                            line.chars().take(160).collect::<String>()
                        ));
                    }
                }
                CommandEvent::Terminated(payload) => {
                    crate::debug::log(&format!("[rs] terminated code={:?}", payload.code));
                    let _ = handle.emit("agent-terminated", payload.code);
                    break;
                }
                CommandEvent::Error(err) => {
                    crate::debug::log(&format!("[rs] error: {err}"));
                    let _ = handle.emit("agent-error", err);
                }
                _ => {}
            }
        }
        if let Some(state) = handle.try_state::<AppState>() {
            if let Ok(mut guard) = state.rpc.lock() {
                *guard = None;
            }
        }
    });

    Ok(())
}

/// Write one JSON command line to the agent's stdin.
#[tauri::command]
pub fn agent_send(payload: String, state: State<'_, AppState>) -> Result<(), String> {
    crate::debug::log(&format!(
        "[rs] agent_send: {}",
        payload.chars().take(120).collect::<String>()
    ));
    let mut guard = state.rpc.lock().map_err(|e| e.to_string())?;
    let Some(child) = guard.as_mut() else {
        crate::debug::log("[rs] agent_send: NO CHILD — agent not running");
        return Err("agent not running".to_string());
    };
    let mut line = payload;
    line.push('\n');
    let result = child.write(line.as_bytes()).map_err(|e| e.to_string());
    crate::debug::log(&format!("[rs] agent_send write result: {result:?}"));
    result
}

/// Terminate the agent sidecar.
#[tauri::command]
pub fn agent_stop(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(child) = state.rpc.lock().map_err(|e| e.to_string())?.take() {
        let _ = child.kill();
    }
    Ok(())
}
