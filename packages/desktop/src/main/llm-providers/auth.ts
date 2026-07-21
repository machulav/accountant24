// Provider auth + models queries — the one-shot reads/writes behind the
// Settings providers screen, onboarding gating, and the composer model picker.

import type { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { ipcMain } from "electron";
import { trackProviderConnected } from "../analytics";
import { createRegistry } from "./registry";

function uniqueProviders(modelRegistry: ModelRegistry): string[] {
  const seen = new Set<string>();
  for (const model of modelRegistry.getAll()) seen.add(model.provider);
  return [...seen].sort();
}

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
  trackProviderConnected(provider, "api_key");
  return { type: "done", provider };
}

function authLogout(provider: string) {
  if (!provider) return { type: "error", message: "missing provider" };
  const { authStorage } = createRegistry();
  authStorage.logout(provider);
  return { type: "done", provider };
}

/** Register the one-shot auth/models IPC handlers. */
export function registerAuthIpc(): void {
  ipcMain.handle("auth_status", () => authStatus());
  ipcMain.handle("auth_providers", () => authProviders());
  ipcMain.handle("auth_models", () => authModels());
  ipcMain.handle("auth_set_key", (_e, { provider, key }: { provider: string; key: string }) =>
    authSetKey(provider, key),
  );
  ipcMain.handle("auth_logout", (_e, { provider }: { provider: string }) => authLogout(provider));
}
