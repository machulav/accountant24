// Give the app an explicit default model as soon as any model is available.
// Without one, the composer's model picker sits empty while chats quietly run
// on pi's own fallback, and someone who never opens Settings would never see it
// filled in. Connecting a provider picks a default from that provider (see
// providers-settings), so this only fills the gap for setups that predate the
// automatic pick.

import { useEffect } from "react";
import { defaultModelPatch, pickDefaultModel } from "@/lib/defaultModelPick";
import { authApi, settingsApi } from "../rpc/api";

/** Choose and persist a default model when none is set. Runs once at app start. */
export function useEnsureDefaultModel(): void {
  useEffect(() => {
    void (async () => {
      try {
        const [models, settings] = await Promise.all([authApi.models(), settingsApi.get()]);
        // Never override the user's own pick.
        if (settings.defaultModel) return;
        const picked = pickDefaultModel(models.models, models.providerDefaults);
        if (picked) await settingsApi.set(defaultModelPatch(picked, settings.enabledModels, models.models));
      } catch {
        // Best-effort: without a stored default pi still falls back on its own,
        // so a failure here must not break start-up.
      }
    })();
  }, []);
}
