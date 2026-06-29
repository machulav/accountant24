// Which authed models the user can pick from in chat — the app's analogue of pi's
// /scoped-models. The user's pick is stored in app settings as a list of
// `provider/modelId` ids; the model picker filters its full list through this.

/** The stable id for a model in the enabled list: `provider/modelId`. */
export function modelId(model: { provider: string; modelId: string }): string {
  return `${model.provider}/${model.modelId}`;
}

/** Split a `provider/modelId` id back into its parts. The provider is everything
 *  up to the first slash (model ids may themselves contain slashes). Returns
 *  undefined for a malformed id (no slash, or an empty side). */
export function parseModelId(id: string): { provider: string; modelId: string } | undefined {
  const slash = id.indexOf("/");
  if (slash <= 0 || slash >= id.length - 1) return undefined;
  return { provider: id.slice(0, slash), modelId: id.slice(slash + 1) };
}

/**
 * Keep only the models whose id is in `enabledIds`. An empty/undefined selection
 * means "all enabled" — never hide everything (that would leave the picker with no
 * model to pick). Order follows the input `models`, not `enabledIds`.
 */
export function filterEnabledModels<T extends { provider: string; modelId: string }>(
  models: readonly T[],
  enabledIds: readonly string[] | undefined,
): T[] {
  if (!enabledIds || enabledIds.length === 0) return [...models];
  const allowed = new Set(enabledIds);
  const filtered = models.filter((m) => allowed.has(modelId(m)));
  // If the saved selection matches nothing currently available (e.g. the model
  // was removed or the provider logged out), fall back to showing all rather
  // than presenting an empty picker.
  return filtered.length > 0 ? filtered : [...models];
}

/**
 * Add some models to the enabled allow-list — used when a new provider is added
 * so its models are enabled instead of being hidden by an existing selection.
 *
 * - An empty/undefined `current` means "all enabled", so it's returned unchanged
 *   (the new models are already enabled).
 * - Otherwise `toEnable` is unioned into the allow-list. The result is ordered by
 *   `allAvailableIds` and drops stale ids no longer available.
 * - If every available model ends up enabled, it collapses to `[]` (the canonical
 *   "all enabled", so future new models are enabled by default too).
 */
export function addEnabledModels(
  current: readonly string[] | undefined,
  toEnable: readonly string[],
  allAvailableIds: readonly string[],
): string[] | undefined {
  if (!current || current.length === 0) return current === undefined ? undefined : [];
  const next = new Set(current);
  for (const id of toEnable) next.add(id);
  if (allAvailableIds.every((id) => next.has(id))) return [];
  return allAvailableIds.filter((id) => next.has(id));
}
