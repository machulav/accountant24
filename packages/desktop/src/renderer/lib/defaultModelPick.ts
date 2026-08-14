// Which model to preselect as the default — used when a provider is connected
// and when an existing user has models but no default yet.
//
// The opinion comes from pi (`providerDefaults`, its default model per
// provider, loaded by the main process). This module only applies it to the
// models actually available, so a provider pi has no opinion about (Ollama) or
// a table entry that has since been renamed still yields a usable pick.

import type { AppSettings, ProviderDefaults } from "@/rpc/types";
import { addEnabledModels } from "./enabledModels";

/** A model as the models IPC reports it. */
type Model = { provider: string; id: string };

/** The stable id for a model in settings: `provider/id`. */
function idOf(model: Model): string {
  return `${model.provider}/${model.id}`;
}

/**
 * The model pi names for a provider, found among that provider's models:
 * matched by id, or by prefix so a dated release still counts
 * (`claude-x-20260115` for a default naming `claude-x`). Undefined when pi has
 * no opinion or names something unavailable.
 */
function preferredOf(candidates: readonly Model[], wanted: string | undefined): Model | undefined {
  if (!wanted) return undefined;
  const exact = candidates.find((m) => m.id === wanted);
  if (exact) return exact;
  // Several dated releases of the same model: the newest sorts highest.
  const dated = candidates.filter((m) => m.id.startsWith(wanted));
  return dated.length > 0 ? dated.reduce((best, m) => (m.id > best.id ? m : best)) : undefined;
}

/**
 * Pick a default model, as a `provider/id` id.
 *
 * With a `provider`, the pick is restricted to that provider (used right after
 * connecting one) and falls back to its first model, which is pi's own
 * fallback. Without, providers are considered in the order they first appear in
 * `models`: one pi has an opinion about wins, otherwise the very first model is
 * used. Returns undefined when there is nothing to pick.
 */
export function pickDefaultModel(
  models: readonly Model[],
  providerDefaults: ProviderDefaults,
  provider?: string,
): string | undefined {
  if (provider !== undefined) {
    const candidates = models.filter((m) => m.provider === provider);
    if (candidates.length === 0) return undefined;
    return idOf(preferredOf(candidates, providerDefaults[provider]) ?? candidates[0]);
  }
  for (const candidate of models) {
    const preferred = preferredOf(
      models.filter((m) => m.provider === candidate.provider),
      providerDefaults[candidate.provider],
    );
    if (preferred) return idOf(preferred);
  }
  return models.length > 0 ? idOf(models[0]) : undefined;
}

/**
 * The settings patch that makes a model the default. Choosing a default also
 * enables it, since the default must always be available to new chats. An
 * empty/absent allow-list already means "all enabled", so it is left alone
 * rather than frozen into an explicit list that would hide models added later.
 */
export function defaultModelPatch(
  id: string,
  enabled: readonly string[] | undefined,
  models: readonly Model[],
): Partial<AppSettings> {
  if (enabled && enabled.length > 0 && !enabled.includes(id))
    return { defaultModel: id, enabledModels: addEnabledModels(enabled, [id], models.map(idOf)) };
  return { defaultModel: id };
}
