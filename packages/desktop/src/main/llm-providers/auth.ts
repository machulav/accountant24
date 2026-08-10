// Provider auth + models queries — the one-shot reads/writes behind the
// Settings providers screen, onboarding gating, and the composer model picker.

import type { AuthInteraction, Credential } from "@earendil-works/pi-ai";
import { CredentialSynchronizationError, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ipcMain } from "electron";
import { trackProviderConnected } from "../analytics";
import { createProviderRuntime } from "./registry";

function uniqueProviders(runtime: ModelRuntime): string[] {
  const seen = new Set<string>();
  for (const model of runtime.getModels()) seen.add(model.provider);
  return [...seen].sort();
}

function displayName(runtime: ModelRuntime, provider: string): string {
  return runtime.getProvider(provider)?.name ?? provider;
}

/** OAuth-capable providers, in pi's provider order. */
function oauthProviders(runtime: ModelRuntime): { id: string; name: string }[] {
  const rows: { id: string; name: string }[] = [];
  for (const provider of runtime.getProviders()) {
    if (provider.auth.oauth) rows.push({ id: provider.id, name: provider.auth.oauth.name });
  }
  return rows;
}

/** A human label for how a configured provider is authenticated. The stored
 *  credential type (oauth vs api_key) is authoritative; otherwise fall back to
 *  where the key was resolved from (env / models.json / session). */
function connectionLabel(credential: Credential["type"] | undefined, source: string | undefined): string | undefined {
  switch (credential) {
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

async function authStatus() {
  const runtime = await createProviderRuntime();
  const oauthIds = new Set(oauthProviders(runtime).map((p) => p.id));
  // One listing instead of a stored-credential read per provider; we only ever
  // need each credential's type, never its secret.
  const stored = new Map((await runtime.listCredentials()).map((c) => [c.providerId, c.type]));
  const providers = uniqueProviders(runtime).map((provider) => {
    const status = runtime.getProviderAuthStatus(provider);
    const rawName = displayName(runtime, provider);
    // Ollama models we register carry no provider display name, so pi falls back
    // to the bare id "ollama"; show it properly capitalized.
    const name = provider === "ollama" && rawName.toLowerCase() === "ollama" ? "Ollama" : rawName;
    return {
      provider,
      displayName: name,
      configured: status.configured,
      source: status.source,
      oauth: oauthIds.has(provider),
      // Only credentials stored in auth.json can be logged out; env vars and
      // models.json-defined providers are managed outside the app.
      removable: status.source === "stored",
      ...(status.configured ? { connection: connectionLabel(stored.get(provider), status.source) } : {}),
    };
  });
  return {
    type: "status",
    providers,
    availableModels: runtime.getAvailableSnapshot().length,
    anyConfigured: providers.some((p) => p.configured),
  };
}

async function authProviders() {
  const runtime = await createProviderRuntime();
  const oauth = oauthProviders(runtime);
  const oauthIds = new Set(oauth.map((p) => p.id));
  const all = uniqueProviders(runtime).map((provider) => ({
    provider,
    displayName: displayName(runtime, provider),
    oauth: oauthIds.has(provider),
    configured: runtime.getProviderAuthStatus(provider).configured,
  }));
  return { type: "providers", oauth, all };
}

async function authModels() {
  const runtime = await createProviderRuntime();
  const models = runtime.getAvailableSnapshot().map((m) => ({
    provider: m.provider,
    id: m.id,
    name: m.name,
    reasoning: m.reasoning,
    input: m.input,
    contextWindow: m.contextWindow,
  }));
  return { type: "models", models };
}

/** Answers pi's api-key login with a key the user already pasted. Standard
 *  providers ask for exactly one secret; a provider that wants more (an account
 *  id, a second field) has no answer here, so the login fails instead of
 *  storing a half-configured credential. */
function pastedKeyInteraction(key: string): AuthInteraction {
  let answered = false;
  return {
    prompt: async (prompt) => {
      if (prompt.type === "secret" && !answered) {
        answered = true;
        return key;
      }
      throw new Error("This provider needs more than an API key to connect.");
    },
    notify: () => {},
  };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function authSetKey(provider: string, key: string) {
  if (!provider) return { type: "error", message: "missing provider" };
  const trimmed = key.trim();
  if (!trimmed) return { type: "error", message: "empty API key" };
  const runtime = await createProviderRuntime();
  try {
    await runtime.login(provider, "api_key", pastedKeyInteraction(trimmed));
  } catch (e) {
    return { type: "error", message: errorMessage(e) };
  }
  trackProviderConnected(provider, "api_key");
  return { type: "done", provider };
}

async function authLogout(provider: string) {
  if (!provider) return { type: "error", message: "missing provider" };
  const runtime = await createProviderRuntime();
  try {
    await runtime.logout(provider);
  } catch (e) {
    // The credential is deleted even when the runtime cannot resynchronize its
    // own snapshot afterwards — and we discard that runtime immediately.
    if (!(e instanceof CredentialSynchronizationError)) {
      return { type: "error", message: errorMessage(e) };
    }
  }
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
