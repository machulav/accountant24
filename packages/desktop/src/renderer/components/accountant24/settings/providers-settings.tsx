// Providers — connect a model provider via subscription (OAuth) or API key, see
// what's connected, disconnect, or add a local Ollama model. The app's analogue
// of pi's /login and /logout. The connect flows themselves live in the dialogs
// in provider-dialogs.tsx.

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { ItemActions, ItemContent, ItemTitle } from "@/components/shadcn/item";
import { Spinner } from "@/components/shadcn/spinner";
import { useProviderConnect } from "@/hooks/use-provider-connect";
import { defaultModelPatch, pickDefaultModel } from "@/lib/defaultModelPick";
import { parseModelId } from "@/lib/enabledModels";
import { agentApi, authApi, settingsApi } from "@/rpc/api";
import type { AuthProviderRow, AuthStatus } from "@/rpc/types";
import { ErrorBanner, Section, SettingsRow, SettingsRows } from "./parts";
import { ApiKeyDialog, OAuthSignInDialog } from "./provider-dialogs";

function ProvidersList({ status, reload }: { status: AuthStatus | null; reload: () => Promise<void> }) {
  const [apiKeyProvider, setApiKeyProvider] = useState<AuthProviderRow | null>(null);
  // Only offer Ollama when it's actually installed and running locally with at
  // least one model — otherwise the row advertises a provider you don't have.
  const [ollamaAvailable, setOllamaAvailable] = useState(false);

  // Adding a provider is the same everywhere: restart the agent, adopt the new
  // models, then re-read this list.
  const { oauth, finish } = useProviderConnect(reload);

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
      // The default model came from the provider just removed, so it is now
      // dangling: hand the spot to a model that still works, or clear it when
      // nothing is left. The model list is re-read after the removal, so it
      // already excludes what went away.
      const settings = await settingsApi.get();
      if (parseModelId(settings.defaultModel ?? "")?.provider === provider) {
        const models = await authApi.models();
        const replacement = pickDefaultModel(models.models, models.providerDefaults);
        await settingsApi.set(
          replacement
            ? defaultModelPatch(replacement, settings.enabledModels, models.models)
            : { defaultModel: undefined },
        );
      }
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
      ? [{ name: "Ollama", node: <OllamaRow key="ollama" onConnected={() => finish("ollama")} /> }]
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
          if (provider) await finish(provider.provider);
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

  // No wrapper: the sections are direct children of wherever the pane is
  // mounted, so a Section rendered after this one (the onboarding setup step)
  // is their sibling and the last-child divider rule reads across them.
  return <ProvidersList status={status} reload={reload} />;
}
