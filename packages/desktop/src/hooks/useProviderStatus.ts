// Whether any model is available to chat with (auth.json / models.json), kept
// fresh the same way the composer model picker is: re-checked on the
// models-changed event that agentApi.restart() fires after every provider
// add/remove. Reads go through authApi.status() (in-process), so a newly added
// provider is reflected even before the agent restart completes. Models — not
// providers — are the gate: a configured provider with zero models still can't
// chat, and an Ollama-only setup registers models without an auth.json entry.

import { useEffect, useState } from "react";
import { agentApi, authApi } from "../rpc/api";

/** `null` while the first check is in flight. */
export function useHasModels(): boolean | null {
  const [hasModels, setHasModels] = useState<boolean | null>(null);

  useEffect(() => {
    let disposed = false;
    const check = () => {
      authApi
        .status()
        .then((s) => {
          if (!disposed) setHasModels(s.availableModels > 0);
        })
        .catch(() => undefined);
    };
    check();
    const unsubscribe = agentApi.onModelsChanged(check);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  return hasModels;
}
