// Typed wrappers over the Electron IPC bridge (electron/main handlers).
//
// Same command/event names + shapes as the previous Tauri layer, so agentBridge,
// electronPiClient, and Login are unchanged. Main returns parsed objects for
// one-shot calls; the agent event stream still arrives as raw JSONL lines that we
// parse here (one place).

import type {
  AgentEvent,
  AuthEvent,
  AuthModels,
  AuthProviders,
  AuthStatus,
  OllamaInfo,
  SessionSummary,
} from "./types";

const api = window.api;

/** Lightweight console diagnostics (the Tauri file-log command is gone). */
export function dlog(msg: string): void {
  console.debug("[a24]", msg);
}

export const agentApi = {
  start: () => api.invoke<void>("agent_start"),
  send: (command: object) => api.invoke<void>("agent_send", command),
  stop: () => api.invoke<void>("agent_stop"),
  onEvent: async (cb: (event: AgentEvent) => void): Promise<() => void> =>
    api.on("agent-event", (payload) => {
      try {
        cb(JSON.parse(payload as string) as AgentEvent);
      } catch {
        dlog(`PARSE FAIL: ${String(payload).slice(0, 140)}`);
      }
    }),
  onTerminated: async (cb: (code: number | null) => void): Promise<() => void> =>
    api.on("agent-terminated", (payload) => cb(payload as number | null)),
  onError: async (cb: (message: string) => void): Promise<() => void> =>
    api.on("agent-error", (payload) => cb(payload as string)),
};

export const sessionsApi = {
  list: () => api.invoke<{ type: string; sessions: SessionSummary[] }>("sessions_list"),
  delete: (path: string) => api.invoke<{ type: string; path?: string; message?: string }>("sessions_delete", { path }),
};

export const authApi = {
  status: () => api.invoke<AuthStatus>("auth_status"),
  providers: () => api.invoke<AuthProviders>("auth_providers"),
  models: () => api.invoke<AuthModels>("auth_models"),
  setKey: (provider: string, key: string) =>
    api.invoke<{ type: string; message?: string }>("auth_set_key", { provider, key }),
  logout: (provider: string) => api.invoke<{ type: string; message?: string }>("auth_logout", { provider }),
  detectOllama: () => api.invoke<OllamaInfo>("auth_detect_ollama"),
  addOllama: (model: string) => api.invoke<{ type: string; message?: string }>("auth_add_ollama", { model }),
  login: (provider: string) => api.invoke<void>("auth_login", { provider }),
  loginRespond: (id: string, value: string | null) => api.invoke<void>("auth_login_respond", { id, value }),
  loginCancel: () => api.invoke<void>("auth_login_cancel"),
  onEvent: async (cb: (event: AuthEvent) => void): Promise<() => void> =>
    api.on("auth-event", (payload) => cb(payload as AuthEvent)),
  onTerminated: async (cb: (code: number | null) => void): Promise<() => void> =>
    api.on("auth-terminated", (payload) => cb(payload as number | null)),
};
