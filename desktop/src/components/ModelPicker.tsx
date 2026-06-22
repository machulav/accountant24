// Header dropdown to switch the active model. Populated from the agent's
// get_available_models; selecting one issues set_model over RPC.

import type { ModelInfo } from "../rpc/types";

export function ModelPicker({
  model,
  models,
  onSelect,
}: {
  model: ModelInfo | null;
  models: ModelInfo[];
  onSelect: (provider: string, id: string) => void;
}) {
  if (models.length === 0) {
    return <span className="model-name muted">{model?.name ?? "…"}</span>;
  }

  const key = model ? `${model.provider}/${model.id}` : "";
  const known = models.some((m) => `${m.provider}/${m.id}` === key);

  return (
    <select
      className="model-picker"
      value={known ? key : ""}
      onChange={(e) => {
        const raw = e.currentTarget.value;
        const slash = raw.indexOf("/");
        if (slash < 0) return;
        onSelect(raw.slice(0, slash), raw.slice(slash + 1));
      }}
    >
      {!known && <option value="">{model?.name ?? "Select model"}</option>}
      {models.map((m) => (
        <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
          {m.name}
        </option>
      ))}
    </select>
  );
}
