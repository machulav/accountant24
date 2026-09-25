// Onboarding step 2: choose the AI to talk to. A brand-new user should not
// have to read a list of 39 providers, so the page opens on the two
// subscriptions a newcomer most likely already has, as sign-in buttons under
// the names people know them by, plus one link for everyone else. The link
// swaps the buttons for a searchable list in the same spot, so the page never
// grows: one choice control at a time. Local models are in the list like any
// other provider, not called out. Picking a provider shows the one thing it
// needs (sign in, paste a key, or start Ollama); once one is connected the
// step turns into the model choice and the way into the app.

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/shadcn/button";
import { Field, FieldLabel } from "@/components/shadcn/field";
import { Spinner } from "@/components/shadcn/spinner";
import { useProviderConnect } from "@/hooks/use-provider-connect";
import { authApi } from "@/rpc/api";
import type { AuthProviders } from "@/rpc/types";
import { type ModelOption, type ModelOptionGroup, ModelSelector } from "../model-selector";
import { ApiKeyConnect } from "./api-key-connect";
import { ConnectedPanel } from "./connected-panel";
import { OAuthConnect } from "./oauth-connect";
import { OllamaConnect } from "./ollama-connect";
import { useModelChoice } from "./use-model-choice";
import { useOllamaInfo } from "./use-ollama-info";

const OLLAMA = "ollama";

/** The subscriptions a newcomer most likely already has, under the product
 *  names people know with the company as the hint. */
const FEATURED: readonly ModelOption[] = [
  { id: "openai-codex", name: "ChatGPT", description: "OpenAI, uses your ChatGPT subscription" },
  { id: "anthropic", name: "Claude", description: "Anthropic, uses your Claude subscription" },
];

/** The featured products the catalog can sign in to. */
function featuredProviders(catalog: AuthProviders | null): ModelOption[] {
  const signIn = new Set((catalog?.oauth ?? []).map((p) => p.id));
  return FEATURED.filter((p) => signIn.has(p.id));
}

/** The list to choose from: the featured providers, then everything else pi
 *  knows, alphabetically. Ollama is always among the rest: it only appears in
 *  the catalog once it has models registered, and it is the one option that
 *  needs no catalog at all. */
function providerGroups(catalog: AuthProviders | null): ModelOptionGroup[] {
  const rows = catalog?.all ?? [];
  const featured = featuredProviders(catalog);
  const featuredIds = new Set(featured.map((p) => p.id));
  const rest = rows
    .filter((p) => !featuredIds.has(p.provider))
    .map((p) => ({ id: p.provider, name: p.provider === OLLAMA ? "Ollama" : p.displayName }));
  if (!rows.some((p) => p.provider === OLLAMA)) rest.push({ id: OLLAMA, name: "Ollama" });
  rest.sort((a, b) => a.name.localeCompare(b.name));
  return [
    { id: "featured", items: featured },
    { id: "all", items: rest },
  ].filter((group) => group.items.length > 0);
}

const LINK = "text-muted-foreground hover:text-foreground text-sm underline underline-offset-4";

export function ConnectStep({ onOpen }: { onOpen: () => void }) {
  const [catalog, setCatalog] = useState<AuthProviders | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  // The full list, once asked for. Until then the page shows the featured
  // sign-in buttons, when the catalog has any to show.
  const [showList, setShowList] = useState(false);
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

  const groups = useMemo(() => providerGroups(catalog), [catalog]);
  const options = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const featured = groups.find((group) => group.id === "featured")?.items ?? [];
  const oauthRow = catalog?.oauth.find((p) => p.id === providerId) ?? null;
  const providerName = options.find((p) => p.id === providerId)?.name ?? providerId ?? "";
  // Who issues the API key: the company behind a product name (Anthropic
  // for Claude), which is where the key is actually created.
  const keyIssuer = catalog?.all.find((p) => p.provider === providerId)?.displayName ?? providerName;
  const signingIn = providerId !== null && (oauth.active === providerId || oauth.errorProvider === providerId);

  const pick = (next: string) => {
    if (next === providerId) return;
    // A sign-in still running belongs to the provider being left behind.
    if (oauth.active) oauth.cancel();
    else if (oauth.error) oauth.dismissError();
    setProviderId(next);
    setUseKey(false);
  };

  const signIn = (id: string) => {
    setProviderId(id);
    setUseKey(false);
    void oauth.start(id);
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

  const quick = !showList && featured.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Which AI do you use?</h1>
        <p className="text-muted-foreground text-sm text-pretty">Sign in with the subscription you already have.</p>
      </header>

      {catalog === null ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner /> Loading providers
        </p>
      ) : quick ? (
        // Keyed so the swap to the list plays an entrance in the same spot.
        <div key="quick" className="animate-in fade-in motion-reduce:animate-none flex flex-col gap-3 duration-200">
          {signingIn && oauthRow ? (
            // The running sign-in takes the buttons' place; Cancel or Close
            // brings them back.
            <OAuthConnect
              providerId={providerId}
              providerName={providerName}
              oauthName={oauthRow.name}
              {...(oauthRow.loginLabel ? { loginLabel: oauthRow.loginLabel } : {})}
              oauth={oauth}
            />
          ) : (
            <>
              {featured.map((p) => {
                const row = catalog.oauth.find((o) => o.id === p.id);
                return (
                  <Button key={p.id} variant="outline" size="lg" onClick={() => signIn(p.id)}>
                    {row?.loginLabel ?? `Sign in with ${p.name}`}
                  </Button>
                );
              })}
              <p className="text-muted-foreground text-center text-sm text-pretty">
                Your plan runs the model. Accountant24 gets no access to your chats.
              </p>
              <button type="button" onClick={() => setShowList(true)} className={`${LINK} self-center`}>
                Use another provider
              </button>
            </>
          )}
        </div>
      ) : (
        <div key="list" className="animate-in fade-in motion-reduce:animate-none flex flex-col gap-8 duration-200">
          <Field>
            <FieldLabel htmlFor="onboarding-provider">Provider</FieldLabel>
            <ModelSelector
              groups={groups}
              {...(providerId !== null ? { value: providerId } : {})}
              onValueChange={pick}
              searchable
              subject="providers"
              placeholder="Select a provider"
              className="w-full"
            />
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
                  {oauthRow.apiKey && !oauth.active && !oauth.error && (
                    <button type="button" onClick={() => setUseKey(true)} className={LINK}>
                      Use an API key instead
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <ApiKeyConnect
                    providerId={providerId}
                    providerName={keyIssuer}
                    onConnected={() => finish(providerId)}
                  />
                  {oauthRow && (
                    <button type="button" onClick={() => setUseKey(false)} className={LINK}>
                      Sign in with a subscription instead
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
