import { useAui } from "@assistant-ui/react";
import { type PiModelInfo, usePiRuntimeExtras } from "@assistant-ui/react-pi";
import { useEffect, useMemo, useState } from "react";
import { filterEnabledModels } from "@/lib/enabledModels";
import { agentApi, settingsApi } from "@/rpc/api";
import type { ModelRef } from "@/rpc/types";
import { usePiClient } from "@/runtime/modelsContext";
import { newChatModel } from "@/runtime/newChatModel";
import { type ModelOption, ModelSelector } from "./model-selector";

const refId = (m: ModelRef) => `${m.provider}/${m.modelId}`;
const piId = (m: PiModelInfo) => `${m.provider}/${m.modelId}`;

/** Registers the picked model with assistant-ui's ModelContext system so runs
 *  are routed to it. Composer-only concern — Settings' picker must not do this. */
function useRegisterModelContext(modelId: string | undefined) {
  const api = useAui();
  useEffect(() => {
    if (modelId === undefined) return;
    const config = { config: { modelName: modelId } };
    return api.modelContext().register({ getModelContext: () => config });
  }, [api, modelId]);
}

/** The model picker shown in the composer action row. Lists the agent's authed
 *  models (client.getAvailableModels), narrowed to the set chosen in Settings →
 *  "Models in the composer".
 *
 *  Existing chat: reflects/sets the active session model via the runtime.
 *  New chat: react-pi has no session yet (setModel is a no-op), so the pick is
 *  seeded from the default and routed through `newChatModel` for createThread. */
export function ComposerModelSelector() {
  const client = usePiClient();
  const extras = usePiRuntimeExtras();
  const [models, setModels] = useState<PiModelInfo[]>([]);
  const [scoped, setScoped] = useState<string[] | undefined>(undefined);
  const [defaultModel, setDefaultModel] = useState<string | undefined>(undefined);
  const [newPick, setNewPick] = useState<ModelRef | undefined>(newChatModel.get());

  useEffect(() => {
    if (!client) return;
    let on = true;
    const fetchModels = () =>
      client
        .getAvailableModels()
        .then((m) => {
          if (on) setModels(m);
        })
        .catch(() => undefined);
    void fetchModels();
    // Re-fetch after a provider is added (the agent restarts with new models).
    const off = agentApi.onModelsChanged(fetchModels);
    return () => {
      on = false;
      off();
    };
  }, [client]);

  useEffect(() => {
    const load = () =>
      settingsApi
        .get()
        .then((s) => {
          setScoped(s.enabledModels);
          setDefaultModel(s.defaultModel);
        })
        .catch(() => undefined);
    void load();
    // Re-read when Settings change, so the picker updates live.
    return settingsApi.onChange(load);
  }, []);

  // createThread clears the pending pick once a chat is created — mirror that so
  // the next new chat seeds from the default again.
  useEffect(() => newChatModel.subscribe(() => setNewPick(newChatModel.get())), []);

  const byId = useMemo(() => new Map<string, PiModelInfo>(models.map((m) => [piId(m), m])), [models]);

  const config = extras.metadata?.config;
  const activeId = config?.provider && config?.modelId ? `${config.provider}/${config.modelId}` : undefined;
  // Active session model wins; otherwise (new chat) the pending pick, else the default.
  const value = activeId ?? (newPick ? refId(newPick) : defaultModel);

  const options: ModelOption[] = useMemo(() => {
    const list = filterEnabledModels(models, scoped);
    // Always keep the selected model (active or default) selectable, even if it
    // sits outside the scoped list.
    if (value && !list.some((m) => piId(m) === value)) {
      const selected = byId.get(value);
      if (selected) list.push(selected);
    }
    return list.map((m) => ({ id: piId(m), name: m.name ?? m.modelId, description: m.provider }));
  }, [models, scoped, value, byId]);

  useRegisterModelContext(value);

  if (models.length === 0) return null;
  return (
    <ModelSelector
      models={options}
      {...(value !== undefined ? { value } : {})}
      onValueChange={(v) => {
        const m = byId.get(v);
        if (!m) return;
        const ref: ModelRef = { provider: m.provider, modelId: m.modelId };
        // Existing chat → apply to the session; new chat → stash for createThread.
        if (activeId) void extras.setModel(ref);
        else newChatModel.set(ref);
      }}
      searchable
      variant="ghost"
      // xs = h-6, same height as the attach/send buttons — a taller pill
      // stretches the action row and pushes the buttons off the bottom line.
      size="xs"
    />
  );
}
