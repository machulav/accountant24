// Preload bridge: exposes a minimal, allowlisted `window.api` to the renderer
// (request/response via invoke, server→client push via on). No Node, no broad
// ipcRenderer surface.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const INVOKE_CHANNELS = new Set([
  "agent_start",
  "agent_send",
  "agent_stop",
  "auth_status",
  "auth_providers",
  "auth_models",
  "auth_set_key",
  "auth_logout",
  "auth_detect_ollama",
  "auth_add_ollama",
  "auth_login",
  "auth_login_respond",
  "auth_login_cancel",
  "sessions_list",
  "sessions_delete",
  "files_archive_to_workspace",
  "ledger_mentions",
]);

const EVENT_CHANNELS = new Set(["agent-event", "agent-terminated", "agent-error", "auth-event", "auth-terminated"]);

contextBridge.exposeInMainWorld("api", {
  invoke(channel: string, payload?: unknown): Promise<unknown> {
    if (!INVOKE_CHANNELS.has(channel)) throw new Error(`blocked invoke channel: ${channel}`);
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel: string, cb: (payload: unknown) => void): () => void {
    if (!EVENT_CHANNELS.has(channel)) throw new Error(`blocked event channel: ${channel}`);
    const handler = (_e: IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.off(channel, handler);
    };
  },
});
