// The model picker an ACP client renders, expressed as an ACP session config
// option with category "model" (the stable replacement for the removed
// session/set_model). Buzz reads exactly this out of the session/new response to
// decide whether to show its Model control; Zed uses it for /model.
//
// The `provider/modelId` id scheme and the enabled-list semantics are shared
// with the app's own picker: renderer/lib/enabledModels.ts is pure,
// dependency-free logic, and a second copy of its empty-selection and
// no-match fallbacks would be a drift hazard rather than a decoupling win.

import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { filterEnabledModels, modelId, parseModelId } from "../renderer/lib/enabledModels";

/** The slice of pi's Model this module needs. */
export interface PiModel {
  provider: string;
  id: string;
  name?: string;
}

/** ACP config id for the model selector. */
export const MODEL_CONFIG_ID = "model";

const toEntry = (m: PiModel) => ({ provider: m.provider, modelId: m.id, name: m.name });

/** Models the user has enabled, in registry order. An empty or unmatched
 *  selection means "all", so a client never gets an empty picker. */
export function selectableModels(available: readonly PiModel[], enabledIds: readonly string[] | undefined): PiModel[] {
  const enabled = filterEnabledModels(available.map(toEntry), enabledIds);
  const allowed = new Set(enabled.map(modelId));
  return available.filter((m) => allowed.has(modelId(toEntry(m))));
}

/** Build the `model` select option, or undefined when no model is available
 *  (an unauthenticated workspace) so we advertise no picker at all. */
export function modelConfigOption(
  available: readonly PiModel[],
  enabledIds: readonly string[] | undefined,
  current: PiModel | undefined,
): SessionConfigOption | undefined {
  const models = selectableModels(available, enabledIds);
  if (models.length === 0) return undefined;
  const currentValue = current ? modelId(toEntry(current)) : modelId(toEntry(models[0]));
  return {
    id: MODEL_CONFIG_ID,
    name: "Model",
    category: "model",
    type: "select",
    currentValue,
    options: models.map((m) => ({ value: modelId(toEntry(m)), name: m.name ?? m.id })),
  };
}

/** Resolve a `provider/modelId` id against the available models. */
export function findModel<T extends PiModel>(available: readonly T[], id: string): T | undefined {
  const parsed = parseModelId(id);
  if (!parsed) return undefined;
  return available.find((m) => m.provider === parsed.provider && m.id === parsed.modelId);
}
