// What happens right after a provider is connected, wherever the connect
// happened (Settings → Providers, or the onboarding wizard): restart the agent
// so it picks the provider up, make sure the new models are usable, and hand
// the provider to the caller. Sharing it keeps both places writing the same
// settings patch in the same order.

import { useCallback, useEffect, useRef } from "react";
import { type OAuthLogin, useOAuthLogin } from "@/hooks/use-oauth-login";
import { pickDefaultModel } from "@/lib/defaultModelPick";
import { addEnabledModels } from "@/lib/enabledModels";
import { agentApi, authApi, settingsApi } from "@/rpc/api";
import type { AppSettings } from "@/rpc/types";

/** Make sure a newly added provider's models show in the composer — adding a
 *  provider shouldn't leave its models hidden behind an existing scoped list —
 *  and start new chats on one of them when no default has been chosen yet. */
async function adoptProviderModels(provider: string): Promise<void> {
  try {
    const [models, settings] = await Promise.all([authApi.models(), settingsApi.get()]);
    const toEnable = models.models.filter((m) => m.provider === provider).map((m) => `${m.provider}/${m.id}`);
    const allIds = models.models.map((m) => `${m.provider}/${m.id}`);
    const next = addEnabledModels(settings.enabledModels, toEnable, allIds);
    const patch: Partial<AppSettings> = {};
    if (next !== undefined && JSON.stringify(next) !== JSON.stringify(settings.enabledModels ?? [])) {
      patch.enabledModels = next;
    }
    if (!settings.defaultModel) {
      // The pick comes from the provider just added, whose models are enabled
      // above, so the default is always one the user can actually chat with.
      const picked = pickDefaultModel(models.models, models.providerDefaults, provider);
      if (picked) patch.defaultModel = picked;
    }
    // One write, so the composer sees a single settings-changed event.
    if (Object.keys(patch).length > 0) await settingsApi.set(patch);
  } catch {
    // Best-effort: failing to widen the composer list shouldn't block the add.
  }
}

export interface ProviderConnect {
  /** The sign-in flow, already wired to finish() when it completes. */
  oauth: OAuthLogin;
  /** Run the post-connect steps for a provider added by any other route
   *  (an API key, Ollama). */
  finish: (provider: string) => Promise<void>;
}

/** `onConnected` runs last, once the provider is usable. */
export function useProviderConnect(onConnected: (provider: string) => void | Promise<void>): ProviderConnect {
  const onConnectedRef = useRef(onConnected);
  useEffect(() => {
    onConnectedRef.current = onConnected;
  });

  const finish = useCallback(async (provider: string) => {
    // The agent caches auth/models at startup, so restart it to pick up the new
    // provider; this also notifies the composer to re-fetch its model list.
    await agentApi.restart();
    await adoptProviderModels(provider);
    await onConnectedRef.current(provider);
  }, []);

  const oauth = useOAuthLogin((provider) => void finish(provider));

  return { oauth, finish };
}
