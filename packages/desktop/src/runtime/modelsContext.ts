import { createContext, useContext } from "react";
import type { ModelOption } from "../components/assistant-ui/model-selector";

export interface ModelsContextValue {
  /** Active model id as `${provider}/${id}`. */
  value: string | undefined;
  models: ModelOption[];
  onSelect: (value: string) => void;
}

export const ModelsContext = createContext<ModelsContextValue>({
  value: undefined,
  models: [],
  onSelect: () => undefined,
});

export const useModels = () => useContext(ModelsContext);
