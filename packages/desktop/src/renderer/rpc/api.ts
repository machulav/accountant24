// Typed wrappers over the Electron IPC bridge (src/main handlers).
//
// Same command/event names + shapes as the previous Tauri layer, so agentBridge
// and electronPiClient are unchanged. Main returns parsed objects for
// one-shot calls; the agent event stream still arrives as raw JSONL lines that we
// parse here (one place).

import type {
  AppSettings,
  AuthEvent,
  AuthModels,
  AuthProviders,
  AuthStatus,
  LedgerMentions,
  LedgerTransaction,
  MarketplaceRequest,
  MarketplaceResult,
  NetWorth,
  OllamaInfo,
  PluginAddRequest,
  PluginAddResult,
  PluginInspectResult,
  PluginsEvent,
  PluginsList,
  SessionAgentEvent,
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

/** Payload for an unexpected agent exit (crash), carrying a stderr tail for
 *  diagnostics. Deliberate stops (restart / app quit) are not reported. */
export type AgentExit = { sessionPath: string; code: number | null; signal: string | null; stderr: string };

export const agentApi = {
  /** Mint a fresh session file path for a new chat (no process is spawned —
   *  the first send to it does that). */
  createSession: () => api.invoke<string>("agent_create_session"),
  /** Send one RPC command to the given session's child, spawning it on demand. */
  send: (sessionPath: string, command: object) => api.invoke<void>("agent_send", { sessionPath, command }),
  /** Kill all children so the next send respawns them with fresh auth.json +
   *  models.json, then notify the UI. */
  async restart(): Promise<void> {
    await api.invoke<void>("agent_restart");
    window.dispatchEvent(new Event(MODELS_CHANGED));
  },
  /** Subscribe to model-set changes; returns an unsubscribe function. */
  onModelsChanged(cb: () => void): () => void {
    window.addEventListener(MODELS_CHANGED, cb);
    return () => window.removeEventListener(MODELS_CHANGED, cb);
  },
  onEvent: async (cb: (event: SessionAgentEvent) => void): Promise<() => void> =>
    api.on("agent-event", (payload) => {
      const { sessionPath, line } = payload as { sessionPath: string; line: string };
      let event: SessionAgentEvent;
      try {
        // Mutate the freshly parsed object (nothing else references it) —
        // this runs per streaming token, so skip the spread copy.
        event = JSON.parse(line) as SessionAgentEvent;
        event.sessionPath = sessionPath;
      } catch {
        dlog(`PARSE FAIL: ${String(line).slice(0, 140)}`);
        return;
      }
      cb(event);
    }),
  onTerminated: async (cb: (info: AgentExit) => void): Promise<() => void> =>
    api.on("agent-terminated", (payload) => cb(payload as AgentExit)),
  onError: async (cb: (info: { sessionPath: string; message: string }) => void): Promise<() => void> =>
    api.on("agent-error", (payload) => cb(payload as { sessionPath: string; message: string })),
};

export const appApi = {
  /** The running app's version (packaged metadata; dev shows the repo version). */
  version: () => api.invoke<string>("app_version"),
};

export const workspaceApi = {
  /** Absolute path of the active workspace folder. */
  dir: () => api.invoke<string>("workspace_dir"),
  /** Open the workspace folder in the system file manager (Finder). */
  open: () => api.invoke<void>("workspace_open"),
};

export const updateApi = {
  /** The version staged and ready to install, or null if none is pending. Read
   *  on mount since the download may have completed before we subscribed. */
  pending: () => api.invoke<string | null>("update_pending"),
  /** Quit, apply the staged update, and relaunch immediately. */
  install: () => api.invoke<void>("update_install"),
  /** Subscribe to update-downloaded pushes (payload = new version); returns an
   *  unsubscribe function. */
  onDownloaded: (cb: (version: string) => void): (() => void) =>
    api.on("update-downloaded", (payload) => cb(payload as string)),
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
  /** Read the app's own settings (<workspace>/app-settings.json). */
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
  /** Fetch the `hledger bs` report (sections + net) for the Net Worth view. */
  netWorth: () => api.invoke<NetWorth>("ledger_net_worth"),
  /** Fetch the `hledger print` register (journal order) for the Transactions view. */
  transactions: () => api.invoke<LedgerTransaction[]>("ledger_transactions"),
  /** Fetch the journal's transaction count (from `hledger stats`) for the prompt ideas. */
  transactionCount: () => api.invoke<number>("ledger_transaction_count"),
};

export const pluginsApi = {
  /** Built-in + installed plugins, each with the skills it provides. */
  list: () => api.invoke<PluginsList>("plugins_list"),
  /** Fetch a plugin from a public GitHub repo URL and report what it contains,
   *  without installing it. Progress lines stream via onEvent. */
  inspect: (req: PluginAddRequest) => api.invoke<PluginInspectResult>("plugins_inspect", req),
  /** Install the plugin the last inspect staged; callers restart the agent
   *  afterwards. */
  add: () => api.invoke<PluginAddResult>("plugins_add"),
  /** Delete an installed plugin folder. */
  remove: (name: string) => api.invoke<{ type: string; message?: string }>("plugins_remove", { name }),
  /** Subscribe to install-progress pushes; returns an unsubscribe function. */
  onEvent: async (cb: (event: PluginsEvent) => void): Promise<() => void> =>
    api.on("plugins-event", (payload) => cb(payload as PluginsEvent)),
  /** The published plugins, from the marketplace index. Main caches it for a
   *  few minutes; `force` is the Refresh button. */
  marketplace: (req: MarketplaceRequest = {}) => api.invoke<MarketplaceResult>("plugins_marketplace", req),
};

export const analyticsApi = {
  /** Fire-and-forget a UI analytics event; main enforces the opt-out. Pass only
   *  event names + string/number props — never user content (message text, etc.). */
  track(event: string, props?: Record<string, string | number | boolean>): void {
    api.invoke<void>("analytics_track", { event, props }).catch(() => undefined);
  },
  /** Like track, but main persists a marker so the event is emitted at most
   *  once per install (first-message / first-transaction milestones). */
  trackOnce(event: string, props?: Record<string, string | number | boolean>): void {
    api.invoke<void>("analytics_track", { event, props, once: true }).catch(() => undefined);
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
