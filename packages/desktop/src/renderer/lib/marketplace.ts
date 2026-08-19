// Marketplace list logic: which listed plugins are still on offer, what order
// the rows come in, and what the search box matches.
//
// What the user already has is derived from the plugins list the page holds
// rather than asked of main, so a row leaves the marketplace the moment that
// list reloads after an install, with no second round-trip.

import type { MarketplaceEntry, PluginInfo } from "@/rpc/types";

/** Whether the user already has a listed plugin.
 *  Matching by name as well as by source is deliberate: a
 *  plugin folder is keyed by its name, so a same-named plugin from elsewhere
 *  would collide on install, and a rename upstream shouldn't offer a second
 *  copy of what's already there. */
export function isInstalled(entry: MarketplaceEntry, plugins: PluginInfo[]): boolean {
  return plugins.some((plugin) => plugin.name === entry.name || plugin.source === entry.repo);
}

/** Official plugins first, then by name. Ordering is stable and has nothing to
 *  do with popularity: the index carries no such signal. */
export function sortMarketplace(entries: MarketplaceEntry[]): MarketplaceEntry[] {
  return [...entries].sort((a, b) => {
    if (a.official !== b.official) return a.official ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/** Everything a search matches: what the row shows, plus the keywords and skill
 *  names a user is likely to think in ("subscriptions", "monthly-review"). */
function haystack(entry: MarketplaceEntry): string {
  return [
    entry.name,
    entry.description,
    entry.author ?? "",
    entry.repo,
    ...(entry.keywords ?? []),
    ...entry.skills.map((skill) => `${skill.name} ${skill.description}`),
  ]
    .join(" ")
    .toLowerCase();
}

/** The entries matching a search box, in the order they came in. An empty
 *  query matches everything. */
export function filterMarketplace(entries: MarketplaceEntry[], query: string): MarketplaceEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return entries;
  return entries.filter((entry) => haystack(entry).includes(needle));
}
