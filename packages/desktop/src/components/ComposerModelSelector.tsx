import { useModels } from "../runtime/modelsContext";
import { ModelSelector } from "./assistant-ui/model-selector";

/** The model picker shown in the composer action row. Driven by the agent's
 *  authed models (set_model over RPC); hidden until models load. */
export function ComposerModelSelector() {
  const { value, models, onSelect } = useModels();
  if (models.length === 0) return null;
  return (
    <ModelSelector
      models={models}
      value={value}
      onValueChange={onSelect}
      searchable
      variant="ghost"
      size="sm"
    />
  );
}
