import { type PiModelInfo, usePiRuntimeExtras } from "@assistant-ui/react-pi";
import { useEffect, useMemo, useState } from "react";
import { usePiClient } from "../runtime/modelsContext";
import { type ModelOption, ModelSelector } from "./assistant-ui/model-selector";

/** The model picker shown in the composer action row. Lists the agent's authed
 *  models (client.getAvailableModels); selection goes through the runtime
 *  (usePiRuntimeExtras). Each model keeps its default thinking level. Hidden
 *  until models load. */
export function ComposerModelSelector() {
  const client = usePiClient();
  const extras = usePiRuntimeExtras();
  const [models, setModels] = useState<PiModelInfo[]>([]);

  useEffect(() => {
    if (!client) return;
    let on = true;
    client
      .getAvailableModels()
      .then((m) => {
        if (on) setModels(m);
      })
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, [client]);

  const options: ModelOption[] = useMemo(
    () =>
      models.map((m) => ({
        id: `${m.provider}/${m.modelId}`,
        name: m.name ?? m.modelId,
        description: m.provider,
      })),
    [models],
  );

  const byId = useMemo(
    () => new Map<string, PiModelInfo>(models.map((m) => [`${m.provider}/${m.modelId}`, m])),
    [models],
  );

  const config = extras.metadata?.config;
  const value = config?.provider && config?.modelId ? `${config.provider}/${config.modelId}` : undefined;

  if (models.length === 0) return null;
  return (
    <ModelSelector
      models={options}
      value={value}
      onValueChange={(v) => {
        const m = byId.get(v);
        if (m) void extras.setModel({ provider: m.provider, modelId: m.modelId });
      }}
      searchable
      variant="ghost"
      size="sm"
    />
  );
}
