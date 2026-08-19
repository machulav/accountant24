// Where a plugin came from, as one link.
//
// A plugin can say where it lives (`repository` in its manifest) and the app
// can know where it actually came from (`source` in the registry, set at
// install). The second is an observation and the first is a claim, so the
// observation wins when both are there.

/** A repository, as a row shows it. */
export interface PluginRepo {
  /** `owner/repo`, which is what a reader recognizes. */
  label: string;
  /** Its page on GitHub. */
  url: string;
}

const OWNER_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GITHUB_URL = /^https:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;

/** The repository behind a plugin, or undefined when there is none to link to.
 *  Only GitHub is linked: it is the one host the app installs from, and a link
 *  a reader can't check is worse than no link. */
export function pluginRepo(plugin: { source?: string; repository?: string }): PluginRepo | undefined {
  for (const candidate of [plugin.source, plugin.repository]) {
    if (!candidate) continue;
    const trimmed = candidate.trim();
    if (OWNER_REPO.test(trimmed)) return { label: trimmed, url: `https://github.com/${trimmed}` };
    const match = GITHUB_URL.exec(trimmed);
    if (match) return { label: match[1], url: `https://github.com/${match[1]}` };
  }
  return undefined;
}

/** The account whose plugins the app marks Official, mirroring the
 *  marketplace index's own rule. A signal about who published a plugin, never
 *  a claim about what it does. */
const OFFICIAL_OWNER = "accountant24";

/** Whether Accountant24 published this plugin. Read from where it was
 *  installed from, so a plugin only counts once it is actually that repo's. */
export function isOfficial(plugin: { source?: string }): boolean {
  return plugin.source?.toLowerCase().startsWith(`${OFFICIAL_OWNER}/`) === true;
}
