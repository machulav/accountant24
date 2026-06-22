// Authentication: drives `accountant24 auth <cmd>`.
//
// Read-only / one-shot commands (status, providers, models, set-key, logout,
// detect-ollama, add-ollama) spawn the helper, collect its single JSON line, and
// return it as a string for the frontend to parse.
//
// `auth_login` is interactive (OAuth needs browser + prompts), so it streams:
//   sidecar stdout -> Tauri event "auth-event"
//   frontend       -> auth_login_respond / auth_login_cancel  (writes to stdin)
// Auth URLs are opened in the system browser automatically.

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use crate::AppState;

/// Spawn the auth helper, optionally feed one stdin line, return collected stdout.
async fn run_oneshot(
    app: &AppHandle,
    args: Vec<String>,
    stdin_line: Option<String>,
) -> Result<String, String> {
    let sidecar = app.shell().sidecar("accountant24").map_err(|e| e.to_string())?;
    let (mut rx, mut child) = sidecar.args(args).spawn().map_err(|e| e.to_string())?;

    if let Some(line) = stdin_line {
        let mut l = line;
        l.push('\n');
        child.write(l.as_bytes()).map_err(|e| e.to_string())?;
    }

    let mut out = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => out.push_str(&String::from_utf8_lossy(&bytes)),
            CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }
    Ok(out.trim().to_string())
}

#[tauri::command]
pub async fn auth_status(app: AppHandle) -> Result<String, String> {
    run_oneshot(&app, vec!["auth".into(), "status".into()], None).await
}

#[tauri::command]
pub async fn auth_providers(app: AppHandle) -> Result<String, String> {
    run_oneshot(&app, vec!["auth".into(), "providers".into()], None).await
}

#[tauri::command]
pub async fn auth_models(app: AppHandle) -> Result<String, String> {
    run_oneshot(&app, vec!["auth".into(), "models".into()], None).await
}

#[tauri::command]
pub async fn auth_set_key(app: AppHandle, provider: String, key: String) -> Result<String, String> {
    run_oneshot(
        &app,
        vec!["auth".into(), "set-key".into(), "--provider".into(), provider],
        Some(key),
    )
    .await
}

#[tauri::command]
pub async fn auth_logout(app: AppHandle, provider: String) -> Result<String, String> {
    run_oneshot(
        &app,
        vec!["auth".into(), "logout".into(), "--provider".into(), provider],
        None,
    )
    .await
}

#[tauri::command]
pub async fn auth_detect_ollama(app: AppHandle) -> Result<String, String> {
    run_oneshot(&app, vec!["auth".into(), "detect-ollama".into()], None).await
}

#[tauri::command]
pub async fn auth_add_ollama(app: AppHandle, model: String) -> Result<String, String> {
    run_oneshot(
        &app,
        vec!["auth".into(), "add-ollama".into(), "--model".into(), model],
        None,
    )
    .await
}

/// Start an interactive OAuth login. Streams `auth-event`s; opens auth URLs.
#[tauri::command]
pub async fn auth_login(
    app: AppHandle,
    provider: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Cancel any previous in-flight login.
    if let Some(child) = state.login.lock().map_err(|e| e.to_string())?.take() {
        let _ = child.kill();
    }

    let sidecar = app.shell().sidecar("accountant24").map_err(|e| e.to_string())?;
    let (mut rx, child) = sidecar
        .args(["auth", "login", "--provider", provider.as_str()])
        .spawn()
        .map_err(|e| e.to_string())?;

    *state.login.lock().map_err(|e| e.to_string())? = Some(child);

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let raw = String::from_utf8_lossy(&bytes);
                    let line = raw.trim_end_matches(['\r', '\n']);
                    if line.is_empty() {
                        continue;
                    }
                    // Auto-open the authorization URL in the system browser.
                    if let Ok(value) = serde_json::from_str::<Value>(line) {
                        if value.get("type").and_then(Value::as_str) == Some("auth") {
                            if let Some(url) = value.get("url").and_then(Value::as_str) {
                                let _ = handle.opener().open_url(url.to_string(), None::<&str>);
                            }
                        }
                    }
                    let _ = handle.emit("auth-event", line.to_string());
                }
                CommandEvent::Terminated(payload) => {
                    let _ = handle.emit("auth-terminated", payload.code);
                    break;
                }
                _ => {}
            }
        }
        if let Some(state) = handle.try_state::<AppState>() {
            if let Ok(mut guard) = state.login.lock() {
                *guard = None;
            }
        }
    });

    Ok(())
}

/// Answer a prompt/select/manual_code request from the login flow.
#[tauri::command]
pub fn auth_login_respond(
    id: String,
    value: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut guard = state.login.lock().map_err(|e| e.to_string())?;
    let child = guard.as_mut().ok_or("no login in progress")?;
    let message = serde_json::json!({ "type": "response", "id": id, "value": value });
    let mut line = message.to_string();
    line.push('\n');
    child.write(line.as_bytes()).map_err(|e| e.to_string())
}

/// Abort an in-progress login.
#[tauri::command]
pub fn auth_login_cancel(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(child) = state.login.lock().map_err(|e| e.to_string())?.take() {
        let _ = child.kill();
    }
    Ok(())
}
