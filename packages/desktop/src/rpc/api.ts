// Typed wrappers over the Electron IPC bridge (electron/main handlers).
//
// Same command/event names + shapes as the previous Tauri layer, so agentBridge,
// electronPiClient, and Login are unchanged. Main returns parsed objects for
// one-shot calls; the agent event stream still arrives as raw JSONL lines that we
// parse here (one place).

import type {
  AgentEvent,
  AppSettings,
  AuthEvent,
  AuthModels,
  AuthProviders,
  AuthStatus,
  LedgerMentions,
  OllamaInfo,
  SessionSummary,
} from "./types";

const api = window.api;

/** Lightweight console diagnostics (the Tauri file-log command is gone). */
export function dlog(msg: string): void {
  console.debug("[a24]", msg);
}

/** Fired after the agent's model set changes (e.g. a provider was added and the
 *  agent was restarted), so the composer's picker re-fetches its model list. */
const MODELS_CHANGED = "a24:models-changed";

export const agentApi = {
  start: () => api.invoke<void>("agent_start"),
  send: (command: object) => api.invoke<void>("agent_send", command),
  stop: () => api.invoke<void>("agent_stop"),
  /** Respawn the agent so it re-reads auth.json + models.json, then notify the UI. */
  async restart(): Promise<void> {
    await api.invoke<void>("agent_restart");
    window.dispatchEvent(new Event(MODELS_CHANGED));
  },
  /** Subscribe to model-set changes; returns an unsubscribe function. */
  onModelsChanged(cb: () => void): () => void {
    window.addEventListener(MODELS_CHANGED, cb);
    return () => window.removeEventListener(MODELS_CHANGED, cb);
  },
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

export const filesApi = {
  /** Archive an attached file (base64 bytes) into the workspace; resolves with
   *  the stored copy's workspace-relative path. */
  archiveToWorkspace: (name: string, dataBase64: string) =>
    api.invoke<string>("files_archive_to_workspace", { name, dataBase64 }),
};

/** Fired after the app settings change, so live views (e.g. the composer's model
 *  picker) can re-read without an app restart. */
const SETTINGS_CHANGED = "a24:settings-changed";

export const settingsApi = {
  /** Read the app's own settings (~/Accountant24/settings.json). */
  get: () => api.invoke<AppSettings>("settings_get"),
  /** Merge-patch the app settings; resolves with the merged result. */
  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    const merged = await api.invoke<AppSettings>("settings_set", patch);
    window.dispatchEvent(new Event(SETTINGS_CHANGED));
    return merged;
  },
  /** Subscribe to settings changes; returns an unsubscribe function. */
  onChange(cb: () => void): () => void {
    window.addEventListener(SETTINGS_CHANGED, cb);
    return () => window.removeEventListener(SETTINGS_CHANGED, cb);
  },
};

export const ledgerApi = {
  /** Fetch accounts/payees/tags for the @-mention picker. */
  mentions: () => api.invoke<LedgerMentions>("ledger_mentions"),
};

export const analyticsApi = {
  /** Fire-and-forget a UI analytics event; main enforces the opt-out. Pass only
   *  event names + string/number props — never user content (message text, etc.). */
  track(event: string, props?: Record<string, string | number>): void {
    api.invoke<void>("analytics_track", { event, props }).catch(() => undefined);
  },
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
  addAllOllama: () => api.invoke<{ type: string; message?: string; count?: number }>("auth_add_all_ollama"),
  removeOllama: () => api.invoke<{ type: string; message?: string }>("auth_remove_ollama"),
  login: (provider: string) => api.invoke<void>("auth_login", { provider }),
  loginRespond: (id: string, value: string | null) => api.invoke<void>("auth_login_respond", { id, value }),
  loginCancel: () => api.invoke<void>("auth_login_cancel"),
  onEvent: async (cb: (event: AuthEvent) => void): Promise<() => void> =>
    api.on("auth-event", (payload) => cb(payload as AuthEvent)),
  onTerminated: async (cb: (code: number | null) => void): Promise<() => void> =>
    api.on("auth-terminated", (payload) => cb(payload as number | null)),
};
