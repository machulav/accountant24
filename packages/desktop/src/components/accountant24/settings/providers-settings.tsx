// Providers — connect a model provider via subscription (OAuth) or API key, see
// what's connected, disconnect, or add a local Ollama model. The app's analogue
// of pi's /login and /logout. The connect flows themselves live in the dialogs
// in provider-dialogs.tsx.

import { useCallback, useEffect, useRef, useState } from "react";
import { useOAuthLogin } from "@/components/auth/useOAuthLogin";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { ItemActions, ItemContent, ItemTitle } from "@/components/shadcn/item";
import { Spinner } from "@/components/shadcn/spinner";
import { addEnabledModels, parseModelId } from "@/lib/enabledModels";
import { agentApi, authApi, settingsApi } from "@/rpc/api";
import type { AuthProviderRow, AuthStatus } from "@/rpc/types";
import { ErrorBanner, Section, SettingsRow, SettingsRows } from "./parts";
import { ApiKeyDialog, OAuthSignInDialog } from "./provider-dialogs";

function ProvidersList({ status, reload }: { status: AuthStatus | null; reload: () => Promise<void> }) {
  const [apiKeyProvider, setApiKeyProvider] = useState<AuthProviderRow | null>(null);
  // Only offer Ollama when it's actually installed and running locally with at
  // least one model — otherwise the row advertises a provider you don't have.
  const [ollamaAvailable, setOllamaAvailable] = useState(false);
  // The provider an OAuth sign-in is in flight for, so we can enable its models
  // once it completes (the hook's done callback carries no provider).
  const signingProvider = useRef<string | null>(null);

  // When a provider is added, make sure its models show in the composer — adding
  // a provider shouldn't leave its models hidden behind an existing scoped list.
  const enableProviderModels = useCallback(async (provider: string) => {
    try {
      const [models, settings] = await Promise.all([authApi.models(), settingsApi.get()]);
      const toEnable = models.models.filter((m) => m.provider === provider).map((m) => `${m.provider}/${m.id}`);
      const allIds = models.models.map((m) => `${m.provider}/${m.id}`);
      const next = addEnabledModels(settings.enabledModels, toEnable, allIds);
      if (next !== undefined && JSON.stringify(next) !== JSON.stringify(settings.enabledModels ?? [])) {
        await settingsApi.set({ enabledModels: next });
      }
    } catch {
      // Best-effort: failing to widen the composer list shouldn't block the add.
    }
  }, []);

  const afterAdd = useCallback(
    async (provider: string) => {
      // The agent caches auth/models at startup, so restart it to pick up the new
      // provider; this also notifies the composer to re-fetch its model list.
      await agentApi.restart();
      await enableProviderModels(provider);
      await reload();
    },
    [enableProviderModels, reload],
  );

  const oauth = useOAuthLogin(() => {
    const provider = signingProvider.current;
    signingProvider.current = null;
    void (provider ? afterAdd(provider) : reload());
  });

  useEffect(() => {
    authApi
      .detectOllama()
      .then((info) => setOllamaAvailable(info.running && info.models.length > 0))
      .catch(() => undefined);
  }, []);

  const disconnect = useCallback(
    async (provider: string) => {
      // Ollama lives in models.json (the app put it there), so it's removed via
      // its own path; auth.json-backed providers are logged out.
      if (provider === "ollama") await authApi.removeOllama();
      else await authApi.logout(provider);
      // A default model from the removed provider is now dangling — clear it.
      const settings = await settingsApi.get();
      if (parseModelId(settings.defaultModel ?? "")?.provider === provider)
        await settingsApi.set({ defaultModel: undefined });
      // Restart the agent so it drops the removed provider's models (it caches
      // them at startup); this also tells the composer to re-fetch its list.
      await agentApi.restart();
      await reload();
    },
    [reload],
  );

  if (!status) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner /> Loading providers…
      </div>
    );
  }

  // Sort each group alphabetically by display name.
  const byName = (a: AuthProviderRow, b: AuthProviderRow) => a.displayName.localeCompare(b.displayName);
  const connected = status.providers.filter((p) => p.configured).sort(byName);
  const available = status.providers.filter((p) => !p.configured).sort(byName);

  // The sign-in dialog stays open for the provider whose flow is running — or,
  // after a failure, the one whose flow produced the error, so the error is
  // read (and dismissed) in context.
  const oauthProviderId = oauth.active ?? (oauth.error ? oauth.errorProvider : null);
  const oauthProvider = status.providers.find((p) => p.provider === oauthProviderId) ?? null;

  const renderRow = (p: AuthProviderRow) => (
    <ProviderRow
      key={p.provider}
      provider={p}
      onSignIn={() => {
        setApiKeyProvider(null);
        signingProvider.current = p.provider;
        void oauth.start(p.provider);
      }}
      onApiKey={() => {
        oauth.cancel();
        setApiKeyProvider(p);
      }}
      onDisconnect={() => disconnect(p.provider)}
    />
  );

  // Ollama only appears in the provider list once a model is registered, so when
  // it isn't connected yet we offer it as its own row — sorted in alphabetically
  // with the rest rather than pinned to the bottom.
  const ollamaConnected = status.providers.some((p) => p.provider === "ollama" && p.configured);
  const availableItems = [
    ...available.map((p) => ({ name: p.displayName, node: renderRow(p) })),
    ...(ollamaAvailable && !ollamaConnected
      ? [{ name: "Ollama", node: <OllamaRow key="ollama" onConnected={() => afterAdd("ollama")} /> }]
      : []),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      {connected.length > 0 && (
        <Section title="Connected" description="Models from these providers can be used in chats.">
          <SettingsRows>{connected.map(renderRow)}</SettingsRows>
        </Section>
      )}
      <Section title="Available" description="Connect a provider to use its models.">
        <SettingsRows>{availableItems.map((it) => it.node)}</SettingsRows>
      </Section>

      <OAuthSignInDialog provider={oauthProvider} oauth={oauth} />
      <ApiKeyDialog
        provider={apiKeyProvider}
        onClose={() => setApiKeyProvider(null)}
        onSaved={async () => {
          const provider = apiKeyProvider;
          setApiKeyProvider(null);
          if (provider) await afterAdd(provider.provider);
        }}
      />
    </>
  );
}

/** Connecting Ollama registers every locally-installed model at once. */
function OllamaRow({ onConnected }: { onConnected: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.addAllOllama();
      if (result.type === "error") throw new Error(result.message ?? "Failed to connect Ollama");
      await onConnected();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div>
      <SettingsRow>
        <ItemContent>
          <ItemTitle>
            Ollama
            <Badge variant="secondary">Local</Badge>
          </ItemTitle>
        </ItemContent>
        <ItemActions>
          <Button size="sm" variant="outline" className="w-28" onClick={connect} disabled={busy}>
            {busy ? "Connecting…" : "Connect"}
          </Button>
        </ItemActions>
      </SettingsRow>
      {error && <ErrorBanner message={error} />}
    </div>
  );
}

function ProviderRow({
  provider: p,
  onSignIn,
  onApiKey,
  onDisconnect,
}: {
  provider: AuthProviderRow;
  onSignIn: () => void;
  onApiKey: () => void;
  onDisconnect: () => void;
}) {
  return (
    <SettingsRow>
      <ItemContent>
        {/* The name truncates (as pre-Item) — letting it wrap pushes the badge
            away from the name into the row's dead space on narrow widths. */}
        <ItemTitle className="max-w-full">
          <span className="truncate">{p.displayName}</span>
          {p.configured && p.connection && <Badge variant="secondary">{p.connection}</Badge>}
        </ItemTitle>
      </ItemContent>
      <ItemActions>
        {p.configured ? (
          // auth.json-backed providers can be logged out; Ollama can be removed
          // (the app added it to models.json). Other models.json / env-var
          // providers are hand-authored, so there's no remove action.
          (p.removable || p.provider === "ollama") && (
            <Button size="sm" variant="outline" className="w-28" onClick={onDisconnect}>
              Disconnect
            </Button>
          )
        ) : (
          <>
            {p.oauth && (
              <Button size="sm" variant="outline" className="w-28" onClick={onSignIn}>
                Sign In
              </Button>
            )}
            <Button size="sm" variant="outline" className="w-28" onClick={onApiKey}>
              API Key
            </Button>
          </>
        )}
      </ItemActions>
    </SettingsRow>
  );
}

export function ProvidersSettings() {
  const [status, setStatus] = useState<AuthStatus | null>(null);

  const reload = useCallback(async () => {
    setStatus(await authApi.status());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div>
      <ProvidersList status={status} reload={reload} />
    </div>
  );
}
