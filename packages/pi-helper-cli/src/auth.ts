// Headless helper for the desktop GUI: auth, models, and sessions.
//
// Stock pi has no headless auth command (only the interactive `/login`), the RPC
// protocol has no `login` command (credentials must live in auth.json before the
// agent starts), and RPC can't list/delete sessions. The GUI therefore drives all
// of this by spawning the compiled `accountant24-helper <subcommand>` binary (see
// auth-main.ts), which wraps the framework's AuthStorage + ModelRegistry +
// SessionManager and speaks newline-delimited JSON on stdin/stdout.
//
// Crucially, this helper reads/writes auth.json and models.json in
// ACCOUNTANT24_HOME. The desktop app sets PI_CODING_AGENT_DIR = ACCOUNTANT24_HOME
// in the sidecar env, so pi's getAuthPath()/getModelsPath() resolve to the same
// files — what login writes is what the agent reads.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { completeSimple } from "@earendil-works/pi-ai";
import { AuthStorage, ModelRegistry, SessionManager } from "@earendil-works/pi-coding-agent";
import { ACCOUNTANT24_HOME } from "./config";

/** Callback bag accepted by AuthStorage.login — derived to avoid a direct pi-ai import. */
type LoginCallbacks = Parameters<AuthStorage["login"]>[1];

const OLLAMA_BASE_URL = "http://localhost:11434";

/** Emit one JSON record as a line on stdout. */
function emit(record: unknown): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function paths() {
  return {
    authPath: join(ACCOUNTANT24_HOME, "auth.json"),
    modelsPath: join(ACCOUNTANT24_HOME, "models.json"),
  };
}

function createRegistry() {
  const { authPath, modelsPath } = paths();
  const authStorage = AuthStorage.create(authPath);
  const modelRegistry = ModelRegistry.create(authStorage, modelsPath);
  return { authStorage, modelRegistry };
}

/** Sorted, de-duplicated list of providers across all known (built-in + custom) models. */
function uniqueProviders(modelRegistry: ModelRegistry): string[] {
  const seen = new Set<string>();
  for (const model of modelRegistry.getAll()) seen.add(model.provider);
  return [...seen].sort();
}

/** The pi sessions directory for this workspace. */
function sessionsDir(): string {
  return join(ACCOUNTANT24_HOME, "sessions");
}

/** List sessions for the workspace (RPC has no list command; this wraps SessionManager.list). */
async function cmdSessionsList(): Promise<number> {
  const infos = await SessionManager.list(ACCOUNTANT24_HOME, sessionsDir());
  const sessions = infos.map((s) => ({
    path: s.path,
    id: s.id,
    name: s.name ?? "",
    firstMessage: s.firstMessage ?? "",
    messageCount: s.messageCount,
    modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
  }));
  emit({ type: "sessions", sessions });
  return 0;
}

/** Delete a session file. Refuses paths outside the sessions directory. */
function cmdSessionsDelete(argv: string[]): number {
  const i = argv.findIndex((a) => a === "--path");
  const path = i >= 0 ? argv[i + 1] : undefined;
  if (!path) {
    emit({ type: "error", message: "session path is required (--path)" });
    return 1;
  }
  const dir = resolve(sessionsDir());
  if (!resolve(path).startsWith(dir)) {
    emit({ type: "error", message: "refusing to delete a path outside the sessions directory" });
    return 1;
  }
  rmSync(path, { force: true });
  emit({ type: "done", path });
  return 0;
}

/** Parse `--provider <id>` (or `-p <id>`) out of an argv list. */
function getProvider(argv: string[]): string | undefined {
  const i = argv.findIndex((a) => a === "--provider" || a === "-p");
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Parse `--model <id>` out of an argv list. */
function getModel(argv: string[]): string | undefined {
  const i = argv.indexOf("--model");
  return i >= 0 ? argv[i + 1] : undefined;
}

const TITLE_SYSTEM_PROMPT =
  "You write a short, descriptive title for a chat based on the user's first message. " +
  "Rules: 3-6 words; Title Case; no surrounding quotes; no trailing punctuation; no emojis. " +
  "Reply with ONLY the title.";

/** Trim model output down to a clean one-line title. */
function sanitizeTitle(raw: string): string {
  let t = (raw.split("\n").find((l) => l.trim()) ?? "").trim();
  t = t.replace(/^["'`*]+|["'`*]+$/g, "").trim(); // surrounding quotes / markdown
  t = t.replace(/[.!?,;:]+$/g, "").trim(); // trailing punctuation
  if (t.length > 60) t = `${t.slice(0, 60).trimEnd()}…`;
  return t;
}

/**
 * Generate a concise chat title from the first message via a one-shot LLM call.
 * Stateless (does not touch any session). The app falls back to a trimmed first
 * message if this errors (e.g. a local model that can't follow the instruction).
 */
async function cmdGenerateTitle(argv: string[]): Promise<number> {
  const i = argv.indexOf("--text");
  const text = (i >= 0 ? argv[i + 1] : "")?.trim();
  if (!text) {
    emit({ type: "error", message: "text is required (--text)" });
    return 1;
  }
  const { modelRegistry } = createRegistry();
  const models = modelRegistry.getAvailable();
  if (models.length === 0) {
    emit({ type: "error", message: "no authenticated models available" });
    return 1;
  }
  const provider = getProvider(argv);
  const modelId = getModel(argv);
  const model = models.find((m) => m.provider === provider && m.id === modelId) ?? models[0];

  const auth = await modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    emit({ type: "error", message: "could not resolve model credentials" });
    return 1;
  }

  const context = {
    systemPrompt: TITLE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: [{ type: "text", text: text.slice(0, 2000) }] }],
  } as Parameters<typeof completeSimple>[1];

  const response = await completeSimple(model, context, {
    apiKey: auth.apiKey,
    headers: auth.headers,
    env: auth.env,
  });
  if (response.stopReason === "error" || response.stopReason === "aborted") {
    emit({ type: "error", message: response.errorMessage || "title generation failed" });
    return 1;
  }
  const raw = (response.content as { type: string; text?: string }[])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join(" ");
  emit({ type: "title", title: sanitizeTitle(raw) });
  return 0;
}

/**
 * Read a single LF-terminated line from stdin. Used for set-key (so the key
 * never appears in argv). We must NOT wait for EOF: when spawned as a Tauri
 * sidecar the parent holds the stdin pipe open, so EOF never arrives — reading
 * the first line and returning avoids a deadlock.
 */
function readFirstStdinLine(): Promise<string> {
  return new Promise((resolve) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      buffer += chunk;
      const nl = buffer.indexOf("\n");
      if (nl === -1) return;
      process.stdin.off("data", onData);
      let line = buffer.slice(0, nl);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      resolve(line);
    };
    process.stdin.on("data", onData);
  });
}

/** Attach a JSONL line reader to stdin (LF-delimited, tolerant of trailing CR). */
function onStdinLine(handler: (line: string) => void): void {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard line-splitting loop
    while ((nl = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.trim().length > 0) handler(line);
    }
  });
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

/** Auth status for every known provider, plus a count of usable models. */
function cmdStatus(): number {
  const { authStorage, modelRegistry } = createRegistry();
  const oauthIds = new Set(authStorage.getOAuthProviders().map((p) => p.id));
  const providers = uniqueProviders(modelRegistry).map((provider) => {
    const status = modelRegistry.getProviderAuthStatus(provider);
    return {
      provider,
      displayName: modelRegistry.getProviderDisplayName(provider),
      configured: status.configured,
      source: status.source,
      oauth: oauthIds.has(provider),
    };
  });
  emit({
    type: "status",
    providers,
    availableModels: modelRegistry.getAvailable().length,
    anyConfigured: providers.some((p) => p.configured),
  });
  return 0;
}

/** The OAuth providers (for "Sign in" buttons) and the full provider list. */
function cmdProviders(): number {
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
  emit({ type: "providers", oauth, all });
  return 0;
}

/** Models that currently have auth configured (for the model picker). */
function cmdModels(): number {
  const { modelRegistry } = createRegistry();
  const models = modelRegistry.getAvailable().map((m) => ({
    provider: m.provider,
    id: m.id,
    name: m.name,
    reasoning: m.reasoning,
    input: m.input,
    contextWindow: m.contextWindow,
  }));
  emit({ type: "models", models });
  return 0;
}

/** Persist a pasted API key for a provider. Key is read from stdin, not argv. */
async function cmdSetKey(argv: string[]): Promise<number> {
  const provider = getProvider(argv);
  if (!provider) {
    emit({ type: "error", message: "missing --provider" });
    return 1;
  }
  const key = (await readFirstStdinLine()).trim();
  if (!key) {
    emit({ type: "error", message: "empty API key" });
    return 1;
  }
  const { authStorage } = createRegistry();
  authStorage.set(provider, { type: "api_key", key });
  emit({ type: "done", provider });
  return 0;
}

/** Remove stored credentials for a provider. */
function cmdLogout(argv: string[]): number {
  const provider = getProvider(argv);
  if (!provider) {
    emit({ type: "error", message: "missing --provider" });
    return 1;
  }
  const { authStorage } = createRegistry();
  authStorage.logout(provider);
  emit({ type: "done", provider });
  return 0;
}

/**
 * Interactive OAuth login. Streams request records on stdout and reads response
 * records on stdin, since the flow may need to prompt, offer a choice, or accept
 * a manually-pasted code. The frontend (via the Rust shell) opens browser URLs
 * and answers the prompts.
 *
 * stdout: { type: "auth", url, instructions? } | { type: "device_code", ... }
 *       | { type: "prompt"|"select"|"manual_code", id, ... } | { type: "progress", message }
 *       | { type: "done" } | { type: "error", message }
 * stdin:  { type: "response", id, value } | { type: "abort" }
 */
async function cmdLogin(argv: string[]): Promise<number> {
  const provider = getProvider(argv);
  if (!provider) {
    emit({ type: "error", message: "missing --provider" });
    return 1;
  }

  const { authStorage } = createRegistry();
  const abort = new AbortController();
  const pending = new Map<string, (value: string) => void>();
  let counter = 0;

  onStdinLine((line) => {
    let msg: { type?: string; id?: string; value?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.type === "abort") {
      abort.abort();
      return;
    }
    if (msg.type === "response" && msg.id && pending.has(msg.id)) {
      const resolve = pending.get(msg.id);
      pending.delete(msg.id);
      resolve?.(msg.value ?? "");
    }
  });

  const ask = (request: Record<string, unknown>): Promise<string> => {
    const id = `q${++counter}`;
    return new Promise<string>((resolve) => {
      pending.set(id, resolve);
      emit({ ...request, id });
    });
  };

  const callbacks: LoginCallbacks = {
    onAuth: (info) => emit({ type: "auth", url: info.url, instructions: info.instructions }),
    onDeviceCode: (info) => emit({ type: "device_code", ...info }),
    onProgress: (message) => emit({ type: "progress", message }),
    onPrompt: (prompt) =>
      ask({ type: "prompt", message: prompt.message, placeholder: prompt.placeholder, allowEmpty: prompt.allowEmpty }),
    onManualCodeInput: () => ask({ type: "manual_code" }),
    onSelect: async (prompt) => {
      const value = await ask({ type: "select", message: prompt.message, options: prompt.options });
      return value === "" ? undefined : value;
    },
    signal: abort.signal,
  };

  try {
    await authStorage.login(provider, callbacks);
    emit({ type: "done", provider });
    return 0;
  } catch (error) {
    emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
    return 1;
  }
}

/** Probe a local Ollama instance and report the models it serves. */
async function cmdDetectOllama(): Promise<number> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const models = (data.models ?? []).map((m) => m.name).filter((n): n is string => Boolean(n));
    emit({ type: "ollama", running: true, models });
  } catch {
    emit({ type: "ollama", running: false, models: [] });
  }
  return 0;
}

/**
 * Register an Ollama model in models.json so it becomes available without any
 * API key. Merges into any existing models.json rather than overwriting it.
 */
function cmdAddOllama(argv: string[]): number {
  const modelId = getModel(argv);
  if (!modelId) {
    emit({ type: "error", message: "missing --model" });
    return 1;
  }
  const { modelsPath } = paths();

  type OllamaModelEntry = { id: string; name: string };
  type ProviderEntry = { baseUrl?: string; api?: string; apiKey?: string; models?: OllamaModelEntry[] };
  type ModelsJson = { providers?: Record<string, ProviderEntry> };

  let config: ModelsJson = {};
  if (existsSync(modelsPath)) {
    try {
      config = JSON.parse(readFileSync(modelsPath, "utf8")) as ModelsJson;
    } catch {
      emit({ type: "error", message: "models.json is not valid JSON; refusing to overwrite" });
      return 1;
    }
  }

  config.providers ??= {};
  // Bootstrap a fresh entry but preserve any user-customized fields.
  const ollama: ProviderEntry = config.providers.ollama ?? {};
  ollama.baseUrl ??= `${OLLAMA_BASE_URL}/v1`;
  ollama.api ??= "openai-completions";
  ollama.apiKey ??= "ollama";
  ollama.models ??= [];
  if (!ollama.models.some((m) => m.id === modelId)) {
    ollama.models.push({ id: modelId, name: modelId });
  }
  config.providers.ollama = ollama;

  writeFileSync(modelsPath, `${JSON.stringify(config, null, 2)}\n`);
  emit({ type: "done", provider: "ollama", model: modelId });
  return 0;
}

/**
 * Entry point for `accountant24 auth <subcommand> [...]`.
 * Returns a process exit code.
 */
export async function runAuthCli(argv: string[]): Promise<number> {
  const [subcommand, ...rest] = argv;
  try {
    switch (subcommand) {
      case "status":
        return cmdStatus();
      case "providers":
        return cmdProviders();
      case "models":
        return cmdModels();
      case "set-key":
        return await cmdSetKey(rest);
      case "logout":
        return cmdLogout(rest);
      case "login":
        return await cmdLogin(rest);
      case "detect-ollama":
        return await cmdDetectOllama();
      case "add-ollama":
        return cmdAddOllama(rest);
      case "sessions-list":
        return await cmdSessionsList();
      case "sessions-delete":
        return cmdSessionsDelete(rest);
      case "generate-title":
        return await cmdGenerateTitle(rest);
      default:
        emit({ type: "error", message: `unknown auth subcommand: ${subcommand ?? "(none)"}` });
        return 1;
    }
  } catch (error) {
    emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
    return 1;
  }
}
