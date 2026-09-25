// The model list and the stored default model, kept fresh for the setup step.
// Connecting a provider (providers-settings) restarts the agent and writes the
// preselected default; both fire renderer events (models-changed and
// settings-changed), so the step follows along without any callback from the
// provider list and without a write of its own.

import { useCallback, useEffect, useState } from "react";
import { defaultModelPatch } from "@/lib/defaultModelPick";
import { agentApi, authApi, settingsApi } from "@/rpc/api";
import type { AppSettings, ModelInfo } from "@/rpc/types";

export function useModelChoice(): {
  models: ModelInfo[];
  /** `provider/modelId` of the stored default, or undefined. */
  defaultModel: string | undefined;
  setDefault: (id: string) => void;
  saveError: string | null;
} {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [settings, setSettings] = useState<AppSettings>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const load = () => {
      authApi
        .models()
        .then((m) => {
          if (!disposed) setModels(m.models);
        })
        .catch(() => undefined);
    };
    load();
    const unsubscribe = agentApi.onModelsChanged(load);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const load = () => {
      settingsApi
        .get()
        .then((s) => {
          if (!disposed) setSettings(s);
        })
        .catch(() => undefined);
    };
    load();
    const unsubscribe = settingsApi.onChange(load);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const setDefault = useCallback(
    (id: string) => {
      const patch = defaultModelPatch(id, settings.enabledModels, models);
      setSettings((prev) => ({ ...prev, ...patch }));
      setSaveError(null);
      settingsApi
        .set(patch)
        .catch((e) => setSaveError(`Couldn’t save settings: ${e instanceof Error ? e.message : String(e)}`));
    },
    [models, settings.enabledModels],
  );

  return { models, defaultModel: settings.defaultModel, setDefault, saveError };
}
