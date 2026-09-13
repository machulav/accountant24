// Onboarding step 2: connect one AI model. A brand-new user should not have to
// read a list of 39 providers, so this asks one question at a time: pick a
// provider, then do the one thing that provider needs (sign in, paste a key,
// or start Ollama). Once it is connected the step turns into the model choice
// and the way into the app.

import { useEffect, useMemo, useState } from "react";
import { Field, FieldLabel } from "@/components/shadcn/field";
import { Spinner } from "@/components/shadcn/spinner";
import { useProviderConnect } from "@/hooks/use-provider-connect";
import { authApi } from "@/rpc/api";
import type { AuthProviders } from "@/rpc/types";
import { type ModelOption, ModelSelector } from "../model-selector";
import { ApiKeyConnect } from "./api-key-connect";
import { ConnectedPanel } from "./connected-panel";
import { OAuthConnect } from "./oauth-connect";
import { OllamaConnect } from "./ollama-connect";
import { useModelChoice } from "./use-model-choice";
import { useOllamaInfo } from "./use-ollama-info";

const OLLAMA = "ollama";

/** The provider list to choose from: everything pi knows, plus Ollama, which
 *  only appears in the catalog once it has models registered. */
function providerOptions(catalog: AuthProviders | null): ModelOption[] {
  const rows = (catalog?.all ?? []).map((p) => ({ id: p.provider, name: p.displayName }));
  if (!rows.some((p) => p.id === OLLAMA)) rows.push({ id: OLLAMA, name: "Ollama" });
  return rows
    .map((p) => (p.id === OLLAMA ? { ...p, name: "Ollama", description: "Runs on this Mac" } : p))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function ConnectStep({ onOpen }: { onOpen: () => void }) {
  const [catalog, setCatalog] = useState<AuthProviders | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  // A provider with a subscription starts on sign-in; the key field is one
  // click away for people who have a key instead.
  const [useKey, setUseKey] = useState(false);
  const [connected, setConnected] = useState<string | null>(null);

  const ollama = useOllamaInfo();
  const { oauth, finish } = useProviderConnect((provider) => setConnected(provider));
  const { models, defaultModel, setDefault, saveError } = useModelChoice();

  useEffect(() => {
    authApi
      .providers()
      .then(setCatalog)
      // A catalog that cannot be read leaves an empty list rather than a
      // spinner with no way out: Ollama is always offered, and it is the one
      // option that needs no catalog at all.
      .catch(() => setCatalog({ type: "providers", oauth: [], all: [] }));
  }, []);

  const options = useMemo(() => providerOptions(catalog), [catalog]);
  const oauthRow = catalog?.oauth.find((p) => p.id === providerId) ?? null;
  const providerName = options.find((p) => p.id === providerId)?.name ?? providerId ?? "";

  const pick = (next: string) => {
    if (next === providerId) return;
    // A sign-in still running belongs to the provider being left behind.
    if (oauth.active) oauth.cancel();
    else if (oauth.error) oauth.dismissError();
    setProviderId(next);
    setUseKey(false);
  };

  if (connected) {
    const connectedName = options.find((p) => p.id === connected)?.name ?? connected;
    return (
      <ConnectedPanel
        providerName={connectedName}
        models={models}
        defaultModel={defaultModel}
        onSelectDefault={setDefault}
        saveError={saveError}
        onOpen={onOpen}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Connect an AI model</h1>
        <p className="text-muted-foreground text-sm text-pretty">
          Accountant24 works with the AI provider you choose. Your ledger stays on this Mac either way, only your
          messages go to the model.
        </p>
      </header>

      <Field>
        <FieldLabel htmlFor="onboarding-provider">Provider</FieldLabel>
        {catalog === null ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Spinner /> Loading providers
          </p>
        ) : (
          <ModelSelector
            models={options}
            {...(providerId !== null ? { value: providerId } : {})}
            onValueChange={pick}
            searchable
            subject="providers"
            placeholder="Select a provider"
            className="w-full"
          />
        )}
      </Field>

      {providerId && (
        // Keyed by provider so a half-typed key or a dismissed error never
        // carries over to the next pick.
        <div key={providerId} className="animate-in fade-in motion-reduce:animate-none duration-200">
          {providerId === OLLAMA ? (
            <OllamaConnect info={ollama.info} onRecheck={ollama.recheck} onConnected={() => finish(OLLAMA)} />
          ) : oauthRow && !useKey ? (
            <div className="flex flex-col gap-3">
              <OAuthConnect
                providerId={providerId}
                providerName={providerName}
                oauthName={oauthRow.name}
                {...(oauthRow.loginLabel ? { loginLabel: oauthRow.loginLabel } : {})}
                oauth={oauth}
              />
              {!oauth.active && !oauth.error && (
                <button
                  type="button"
                  onClick={() => setUseKey(true)}
                  className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
                >
                  Use an API key instead
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <ApiKeyConnect
                providerId={providerId}
                providerName={providerName}
                onConnected={() => finish(providerId)}
              />
              {oauthRow && (
                <button
                  type="button"
                  onClick={() => setUseKey(false)}
                  className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
                >
                  Sign in with a subscription instead
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
