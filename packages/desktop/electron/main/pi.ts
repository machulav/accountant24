// Auth, models, and sessions — run IN-PROCESS via the pi SDK (no helper binary).
//
// This is the Node port of packages/pi-helper-cli/src/auth.ts: stock pi has no
// headless auth command, its RPC mode can't list/delete sessions, and credentials
// must live in auth.json before the agent starts. We wrap AuthStorage +
// ModelRegistry + SessionManager directly in the Electron main process and expose
// them over IPC. They read/write auth.json + models.json in the workspace — the
// same files the agent child reads (PI_CODING_AGENT_DIR points there).

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AuthStorage, ModelRegistry, SessionManager } from "@earendil-works/pi-coding-agent";
import { type BrowserWindow, ipcMain, shell } from "electron";
import { workspaceDir } from "./env";

type LoginCallbacks = Parameters<AuthStorage["login"]>[1];

const OLLAMA_BASE_URL = "http://localhost:11434";

function paths() {
  const home = workspaceDir();
  return { home, authPath: join(home, "auth.json"), modelsPath: join(home, "models.json") };
}

function createRegistry() {
  const { authPath, modelsPath } = paths();
  const authStorage = AuthStorage.create(authPath);
  const modelRegistry = ModelRegistry.create(authStorage, modelsPath);
  return { authStorage, modelRegistry };
}

function uniqueProviders(modelRegistry: ModelRegistry): string[] {
  const seen = new Set<string>();
  for (const model of modelRegistry.getAll()) seen.add(model.provider);
  return [...seen].sort();
}

function sessionsDir(): string {
  return join(workspaceDir(), "sessions");
}

// ---- one-shot queries (return the record the renderer expects) -------------

/** A human label for how a configured provider is authenticated. The stored
 *  credential type (oauth vs api_key) is authoritative; otherwise fall back to
 *  where the key was resolved from (env / models.json / session). */
function connectionLabel(authStorage: AuthStorage, provider: string, source: string | undefined): string | undefined {
  switch (authStorage.get(provider)?.type) {
    case "oauth":
      return "Subscription";
    case "api_key":
      return "API Key";
  }
  switch (source) {
    case "environment":
      return "Environment variable";
    case "models_json_key":
    case "models_json_command":
      return "Custom (models.json)";
    case "runtime":
      return "Session key";
    default:
      return undefined;
  }
}

function authStatus() {
  const { authStorage, modelRegistry } = createRegistry();
  const oauthIds = new Set(authStorage.getOAuthProviders().map((p) => p.id));
  const providers = uniqueProviders(modelRegistry).map((provider) => {
    const status = modelRegistry.getProviderAuthStatus(provider);
    const rawName = modelRegistry.getProviderDisplayName(provider);
    // Ollama models we register carry no provider display name, so pi falls back
    // to the bare id "ollama"; show it properly capitalized.
    const displayName = provider === "ollama" && rawName.toLowerCase() === "ollama" ? "Ollama" : rawName;
    return {
      provider,
      displayName,
      configured: status.configured,
      source: status.source,
      oauth: oauthIds.has(provider),
      // Only credentials stored in auth.json can be logged out; env vars and
      // models.json-defined providers are managed outside the app.
      removable: status.source === "stored",
      ...(status.configured ? { connection: connectionLabel(authStorage, provider, status.source) } : {}),
    };
  });
  return {
    type: "status",
    providers,
    availableModels: modelRegistry.getAvailable().length,
    anyConfigured: providers.some((p) => p.configured),
  };
}

function authProviders() {
  const { authStorage, modelRegistry } = createRegistry();
  const oauth = authStorage.getOAuthProviders().map((p) => ({
    id: p.id,
    name: p.name,
    usesCallbackServer: Boolean(p.usesCallbackServer),
  }));
  const oauthIds = new Set(oauth.map((p) => p.id));
  const all = uniqueProviders(modelRegistry).map((provider) => ({
    provider,
    displayName: modelRegistry.getProviderDisplayName(provider),
    oauth: oauthIds.has(provider),
    configured: modelRegistry.getProviderAuthStatus(provider).configured,
  }));
  return { type: "providers", oauth, all };
}

function authModels() {
  const { modelRegistry } = createRegistry();
  const models = modelRegistry.getAvailable().map((m) => ({
    provider: m.provider,
    id: m.id,
    name: m.name,
    reasoning: m.reasoning,
    input: m.input,
    contextWindow: m.contextWindow,
  }));
  return { type: "models", models };
}

function authSetKey(provider: string, key: string) {
  if (!provider) return { type: "error", message: "missing provider" };
  const trimmed = key.trim();
  if (!trimmed) return { type: "error", message: "empty API key" };
  const { authStorage } = createRegistry();
  authStorage.set(provider, { type: "api_key", key: trimmed });
  return { type: "done", provider };
}

function authLogout(provider: string) {
  if (!provider) return { type: "error", message: "missing provider" };
  const { authStorage } = createRegistry();
  authStorage.logout(provider);
  return { type: "done", provider };
}

async function detectOllama() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const models = (data.models ?? []).map((m) => m.name).filter((n): n is string => Boolean(n));
    return { type: "ollama", running: true, models };
  } catch {
    return { type: "ollama", running: false, models: [] };
  }
}

/** Register the given Ollama model ids in models.json (creating the provider
 *  entry if needed), in a single read-modify-write. */
function writeOllamaModels(ids: string[]) {
  if (ids.length === 0) return { type: "error", message: "no models to add" };
  const { modelsPath } = paths();

  type OllamaModelEntry = { id: string; name: string };
  type ProviderEntry = { name?: string; baseUrl?: string; api?: string; apiKey?: string; models?: OllamaModelEntry[] };
  type ModelsJson = { providers?: Record<string, ProviderEntry> };

  let config: ModelsJson = {};
  if (existsSync(modelsPath)) {
    try {
      config = JSON.parse(readFileSync(modelsPath, "utf8")) as ModelsJson;
    } catch {
      return { type: "error", message: "models.json is not valid JSON; refusing to overwrite" };
    }
  }
  config.providers ??= {};
  const ollama: ProviderEntry = config.providers.ollama ?? {};
  ollama.name ??= "Ollama";
  ollama.baseUrl ??= `${OLLAMA_BASE_URL}/v1`;
  ollama.api ??= "openai-completions";
  ollama.apiKey ??= "ollama";
  ollama.models ??= [];
  for (const id of ids) {
    if (!ollama.models.some((m) => m.id === id)) ollama.models.push({ id, name: id });
  }
  config.providers.ollama = ollama;

  writeFileSync(modelsPath, `${JSON.stringify(config, null, 2)}\n`);
  return { type: "done", provider: "ollama", count: ids.length };
}

function addOllama(modelId: string) {
  if (!modelId) return { type: "error", message: "missing model" };
  return writeOllamaModels([modelId]);
}

/** Connect Ollama by registering every locally-installed model at once. */
async function addAllOllama() {
  const info = await detectOllama();
  if (!info.running) return { type: "error", message: "Ollama isn’t running." };
  if (info.models.length === 0) {
    return { type: "error", message: "Ollama is running but has no models. Pull one with `ollama pull`." };
  }
  return writeOllamaModels(info.models);
}

/** Remove the whole Ollama provider the app added to models.json. Only Ollama is
 *  removable this way — other models.json providers are hand-authored and left
 *  alone. */
function removeOllama() {
  const { modelsPath } = paths();
  if (!existsSync(modelsPath)) return { type: "done", provider: "ollama" };

  type ModelsJson = { providers?: Record<string, unknown> };
  let config: ModelsJson;
  try {
    config = JSON.parse(readFileSync(modelsPath, "utf8")) as ModelsJson;
  } catch {
    return { type: "error", message: "models.json is not valid JSON; refusing to overwrite" };
  }
  if (config.providers?.ollama) {
    delete config.providers.ollama;
    writeFileSync(modelsPath, `${JSON.stringify(config, null, 2)}\n`);
  }
  // Drop any stored Ollama credential too (normally none — it lives in models.json).
  createRegistry().authStorage.logout("ollama");
  return { type: "done", provider: "ollama" };
}

async function sessionsList() {
  const infos = await SessionManager.list(workspaceDir(), sessionsDir());
  const sessions = infos.map((s) => ({
    path: s.path,
    id: s.id,
    name: s.name ?? "",
    firstMessage: s.firstMessage ?? "",
    messageCount: s.messageCount,
    modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
  }));
  return { type: "sessions", sessions };
}

function sessionsDelete(path: string) {
  if (!path) return { type: "error", message: "session path is required" };
  const dir = resolve(sessionsDir());
  if (!resolve(path).startsWith(dir)) {
    return { type: "error", message: "refusing to delete a path outside the sessions directory" };
  }
  rmSync(path, { force: true });
  return { type: "done", path };
}

// ---- interactive OAuth login (streamed over "auth-event") ------------------

let loginAbort: AbortController | null = null;
let loginPending = new Map<string, (value: string) => void>();
let loginCounter = 0;

function authLogin(getWin: () => BrowserWindow | null, provider: string): void {
  loginAbort?.abort();
  loginAbort = new AbortController();
  loginPending = new Map();
  loginCounter = 0;

  const send = (record: Record<string, unknown>) => {
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send("auth-event", record);
  };
  const ask = (request: Record<string, unknown>): Promise<string> => {
    const id = `q${++loginCounter}`;
    return new Promise<string>((res) => {
      loginPending.set(id, res);
      send({ ...request, id });
    });
  };

  const callbacks: LoginCallbacks = {
    onAuth: (info) => {
      send({ type: "auth", url: info.url, instructions: info.instructions });
      void shell.openExternal(info.url).catch(() => undefined);
    },
    onDeviceCode: (info) => send({ type: "device_code", ...info }),
    onProgress: (message) => send({ type: "progress", message }),
    onPrompt: (prompt) =>
      ask({ type: "prompt", message: prompt.message, placeholder: prompt.placeholder, allowEmpty: prompt.allowEmpty }),
    onManualCodeInput: () => ask({ type: "manual_code" }),
    onSelect: async (prompt) => {
      const value = await ask({ type: "select", message: prompt.message, options: prompt.options });
      return value === "" ? undefined : value;
    },
    signal: loginAbort.signal,
  };

  const { authStorage } = createRegistry();
  authStorage
    .login(provider, callbacks)
    .then(() => send({ type: "done", provider }))
    .catch((error) => send({ type: "error", message: error instanceof Error ? error.message : String(error) }))
    .finally(() => {
      loginAbort = null;
      loginPending = new Map();
    });
}

function authLoginRespond(id: string, value: string | null): void {
  const res = loginPending.get(id);
  if (res) {
    loginPending.delete(id);
    res(value ?? "");
  }
}

function authLoginCancel(): void {
  loginAbort?.abort();
}

/** Register auth/sessions IPC handlers. */
export function registerPiIpc(getWin: () => BrowserWindow | null): void {
  ipcMain.handle("auth_status", () => authStatus());
  ipcMain.handle("auth_providers", () => authProviders());
  ipcMain.handle("auth_models", () => authModels());
  ipcMain.handle("auth_set_key", (_e, { provider, key }: { provider: string; key: string }) =>
    authSetKey(provider, key),
  );
  ipcMain.handle("auth_logout", (_e, { provider }: { provider: string }) => authLogout(provider));
  ipcMain.handle("auth_detect_ollama", () => detectOllama());
  ipcMain.handle("auth_add_ollama", (_e, { model }: { model: string }) => addOllama(model));
  ipcMain.handle("auth_add_all_ollama", () => addAllOllama());
  ipcMain.handle("auth_remove_ollama", () => removeOllama());
  ipcMain.handle("auth_login", (_e, { provider }: { provider: string }) => authLogin(getWin, provider));
  ipcMain.handle("auth_login_respond", (_e, { id, value }: { id: string; value: string | null }) =>
    authLoginRespond(id, value),
  );
  ipcMain.handle("auth_login_cancel", () => authLoginCancel());
  ipcMain.handle("sessions_list", () => sessionsList());
  ipcMain.handle("sessions_delete", (_e, { path }: { path: string }) => sessionsDelete(path));
}
