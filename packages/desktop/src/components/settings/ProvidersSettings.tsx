// Providers — connect a model provider via subscription (OAuth) or API key, see
// what's connected, disconnect, or add a local Ollama model. The app's analogue
// of pi's /login and /logout.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { addEnabledModels, parseModelId } from "../../lib/enabledModels";
import { agentApi, authApi, settingsApi } from "../../rpc/api";
import type { AuthProviderRow, AuthStatus } from "../../rpc/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOAuthLogin } from "../auth/useOAuthLogin";
import { ErrorBanner, Section } from "./parts";

type ActionState = { kind: "apikey"; provider: string } | null;

function ProvidersList({ status, reload }: { status: AuthStatus | null; reload: () => Promise<void> }) {
  const [action, setAction] = useState<ActionState>(null);
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

  const close = useCallback(() => setAction(null), []);

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
        <Loader2Icon className="size-4 animate-spin" /> Loading providers…
      </div>
    );
  }

  // Sort each group alphabetically by display name.
  const byName = (a: AuthProviderRow, b: AuthProviderRow) => a.displayName.localeCompare(b.displayName);
  const connected = status.providers.filter((p) => p.configured).sort(byName);
  const available = status.providers.filter((p) => !p.configured).sort(byName);

  const renderRow = (p: AuthProviderRow) => (
    <ProviderRow
      key={p.provider}
      provider={p}
      oauth={oauth}
      apikeyOpen={action?.kind === "apikey" && action.provider === p.provider}
      onSignIn={() => {
        close();
        signingProvider.current = p.provider;
        void oauth.start(p.provider);
      }}
      onToggleApiKey={() => {
        oauth.cancel();
        setAction((prev) =>
          prev?.kind === "apikey" && prev.provider === p.provider ? null : { kind: "apikey", provider: p.provider },
        );
      }}
      onDisconnect={() => disconnect(p.provider)}
      onCancelApiKey={close}
      onSavedApiKey={async () => {
        close();
        await afterAdd(p.provider);
      }}
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
        <Section title="Connected" description="Models from these providers are available in chats.">
          <div className="flex flex-col gap-1">{connected.map(renderRow)}</div>
        </Section>
      )}
      <Section title="Available" description="Connect a provider to use its models.">
        <div className="flex flex-col gap-1">{availableItems.map((it) => it.node)}</div>
      </Section>
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
      <div className="hover:bg-muted/50 flex items-center justify-between gap-3 rounded-md px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">Ollama</span>
          <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">Local</span>
        </div>
        <Button size="sm" variant="outline" className="w-28" onClick={connect} disabled={busy}>
          {busy ? "Connecting…" : "Connect"}
        </Button>
      </div>
      {error && <ErrorBanner message={error} />}
    </div>
  );
}

function ProviderRow({
  provider: p,
  oauth,
  apikeyOpen,
  onSignIn,
  onToggleApiKey,
  onDisconnect,
  onCancelApiKey,
  onSavedApiKey,
}: {
  provider: AuthProviderRow;
  oauth: ReturnType<typeof useOAuthLogin>;
  apikeyOpen: boolean;
  onSignIn: () => void;
  onToggleApiKey: () => void;
  onDisconnect: () => void;
  onCancelApiKey: () => void;
  onSavedApiKey: () => void | Promise<void>;
}) {
  const oauthActive = oauth.active === p.provider;
  return (
    <div>
      <div className="hover:bg-muted/50 flex items-center justify-between gap-3 rounded-md px-2 py-1.5">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{p.displayName}</div>
          {p.configured && p.connection && (
            <div className="text-muted-foreground truncate text-xs">{p.connection}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
              <Button size="sm" variant="outline" className="w-28" onClick={onToggleApiKey}>
                API Key
              </Button>
            </>
          )}
        </div>
      </div>

      {oauthActive && <OAuthInline oauth={oauth} />}
      {apikeyOpen && <ApiKeyInline provider={p.provider} onCancel={onCancelApiKey} onSaved={onSavedApiKey} />}
    </div>
  );
}

function OAuthInline({ oauth }: { oauth: ReturnType<typeof useOAuthLogin> }) {
  const [answer, setAnswer] = useState("");
  const submit = (value: string | null) => {
    oauth.respond(value);
    setAnswer("");
  };

  return (
    <div className="mt-3 flex flex-col gap-3 border-t pt-3">
      <div className="bg-muted/50 max-h-44 overflow-auto rounded-md p-3 text-xs">
        {oauth.log.length === 0 ? (
          <p className="text-muted-foreground">Starting sign-in…</p>
        ) : (
          oauth.log.map((line, i) => <p key={i}>{line}</p>)
        )}
      </div>

      {oauth.request?.kind === "select" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{oauth.request.message}</p>
          <div className="flex flex-wrap gap-2">
            {oauth.request.options?.map((opt) => (
              <Button key={opt.id} size="sm" variant="outline" onClick={() => submit(opt.id)}>
                {opt.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {(oauth.request?.kind === "prompt" || oauth.request?.kind === "manual_code") && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{oauth.request.message}</p>
          <div className="flex gap-2">
            <Input
              value={answer}
              placeholder={oauth.request.placeholder}
              onChange={(e) => setAnswer(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && submit(answer)}
            />
            <Button size="sm" variant="outline" onClick={() => submit(answer)}>
              Submit
            </Button>
          </div>
        </div>
      )}

      {oauth.error && <ErrorBanner message={oauth.error} />}
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={oauth.cancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ApiKeyInline({
  provider,
  onCancel,
  onSaved,
}: {
  provider: string;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.setKey(provider, key.trim());
      if (result.type === "error") throw new Error(result.message ?? "Failed to save key");
      await onSaved();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-2 border-t pt-3">
      <div className="flex gap-2">
        <Input
          type="password"
          value={key}
          placeholder="Paste API key (sk-…)"
          autoFocus
          onChange={(e) => setKey(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <Button size="sm" variant="outline" onClick={submit} disabled={busy || !key.trim()}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
      {error && <ErrorBanner message={error} />}
    </div>
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
