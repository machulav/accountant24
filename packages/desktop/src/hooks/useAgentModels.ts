// Model state for the composer's model selector. Separate from the chat runtime:
// once the sidecar is up, ask for the current + available models, listen for the
// `response` events, and switch models via set_model. Auto-switches off an
// unauthed default model to the first available one.

import { useCallback, useEffect, useRef, useState } from "react";
import { agentApi } from "../rpc/api";
import { agentBridge } from "../runtime/agentBridge";
import type { ModelInfo } from "../rpc/types";

const key = (m: { provider: string; id: string }) => `${m.provider}/${m.id}`;

export interface AgentModels {
  /** Currently active model, as `${provider}/${id}`, or undefined. */
  value: string | undefined;
  /** Models with auth configured. */
  models: ModelInfo[];
  /** Switch the active model (value is `${provider}/${id}`). */
  selectModel: (value: string) => void;
}

export function useAgentModels(): AgentModels {
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const modelsRef = useRef<ModelInfo[]>([]);
  const modelRef = useRef<ModelInfo | null>(null);

  const selectModel = useCallback((value: string) => {
    const m = modelsRef.current.find((x) => key(x) === value);
    if (!m) return;
    // Reflect the selection immediately (the trigger is controlled by `value`);
    // the set_model response just confirms it.
    modelRef.current = m;
    setModel(m);
    void agentBridge.send({ type: "set_model", provider: m.provider, modelId: m.id });
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    // If the active model isn't authed, switch to the first available one.
    const autoSwitch = () => {
      const list = modelsRef.current;
      const active = modelRef.current;
      if (list.length === 0) return;
      if (active && list.some((m) => key(m) === key(active))) return;
      void agentBridge.send({ type: "set_model", provider: list[0].provider, modelId: list[0].id });
    };

    (async () => {
      await agentBridge.ensureStarted();
      const un = await agentApi.onEvent((e) => {
        if (e.type !== "response" || !e.success) return;
        if (e.command === "get_state") {
          const m = (e.data as { model?: ModelInfo } | undefined)?.model ?? null;
          modelRef.current = m;
          setModel(m);
          autoSwitch();
        } else if (e.command === "get_available_models") {
          const list = (e.data as { models?: ModelInfo[] } | undefined)?.models ?? [];
          modelsRef.current = list;
          setModels(list);
          autoSwitch();
        } else if (e.command === "set_model") {
          // set_model returns the model object directly as `data`.
          const m = (e.data as ModelInfo | undefined) ?? null;
          if (m?.provider && m?.id) {
            modelRef.current = m;
            setModel(m);
          }
        }
      });
      if (cancelled) {
        un();
        return;
      }
      unlisten = un;
      await agentApi.send({ type: "get_state" });
      await agentApi.send({ type: "get_available_models" });
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return { value: model ? key(model) : undefined, models, selectModel };
}
