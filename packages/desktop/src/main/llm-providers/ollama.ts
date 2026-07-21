// Ollama — detect the local server, register/remove its models in models.json,
// and bake a usable context size into each model.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ipcMain } from "electron";
import { trackProviderConnected } from "../analytics";
import { createRegistry, paths } from "./registry";

const OLLAMA_BASE_URL = "http://localhost:11434";

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
  trackProviderConnected("ollama", "ollama");
  return { type: "done", provider: "ollama", count: ids.length };
}

// Ollama defaults every model to a 4096-token context (num_ctx), regardless of
// what the model supports — and its OpenAI-compatible endpoint (which pi uses)
// ignores a per-request num_ctx. With the accountant24 system prompt alone near
// 4k tokens, replies come back empty (the context is full). The fix: bake a
// larger num_ctx into each model in place via /api/create, which the OpenAI
// endpoint *does* honor. This only adds a tiny config layer — it does not
// re-download weights.
const OLLAMA_TARGET_NUM_CTX = 32768;

/** The model's trained max context, if discoverable (`<arch>.context_length`). */
async function ollamaModelMaxContext(model: string): Promise<number | undefined> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { model_info?: Record<string, unknown> };
    for (const [key, value] of Object.entries(data.model_info ?? {})) {
      if (key.endsWith(".context_length") && typeof value === "number") return value;
    }
  } catch {
    // best effort
  }
  return undefined;
}

/** Re-create each model in place with a larger num_ctx (capped at its trained
 *  max). Best-effort and idempotent; failures (e.g. cloud models) are ignored. */
async function bakeOllamaContext(ids: string[]): Promise<void> {
  await Promise.all(
    ids.map(async (model) => {
      const max = await ollamaModelMaxContext(model);
      const numCtx = Math.min(OLLAMA_TARGET_NUM_CTX, max ?? OLLAMA_TARGET_NUM_CTX);
      if (numCtx <= 4096) return; // nothing to gain over Ollama's default
      try {
        await fetch(`${OLLAMA_BASE_URL}/api/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, from: model, parameters: { num_ctx: numCtx } }),
          signal: AbortSignal.timeout(60000),
        });
      } catch {
        // best effort — a model that can't be re-created just keeps its default
      }
    }),
  );
}

async function addOllama(modelId: string) {
  if (!modelId) return { type: "error", message: "missing model" };
  const result = writeOllamaModels([modelId]);
  if (result.type === "done") await bakeOllamaContext([modelId]);
  return result;
}

/** Connect Ollama by registering every locally-installed model at once. */
async function addAllOllama() {
  const info = await detectOllama();
  if (!info.running) return { type: "error", message: "Ollama isn’t running." };
  if (info.models.length === 0) {
    return { type: "error", message: "Ollama is running but has no models. Pull one with `ollama pull`." };
  }
  const result = writeOllamaModels(info.models);
  if (result.type === "done") await bakeOllamaContext(info.models);
  return result;
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

/** Register the Ollama IPC handlers. */
export function registerOllamaIpc(): void {
  ipcMain.handle("auth_detect_ollama", () => detectOllama());
  ipcMain.handle("auth_add_ollama", (_e, { model }: { model: string }) => addOllama(model));
  ipcMain.handle("auth_add_all_ollama", () => addAllOllama());
  ipcMain.handle("auth_remove_ollama", () => removeOllama());
}
