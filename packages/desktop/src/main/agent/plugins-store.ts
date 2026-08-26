// The on-disk plugin store: <workspace>/plugins, one self-contained folder
// per installed plugin in the Agent Plugins format (agent-plugins.org) — a
// plugin.json manifest plus skills under skills/<name>/SKILL.md. Built-in
// plugins have the identical layout inside the app bundle, so one reader
// serves both.
//
// Where each plugin came from lives in app-settings.json (see settings.ts), not
// in the store, so this module stays a pure reader over plain directories with
// no Electron imports.

import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import type { AgentHostSkill } from "../../shared/agentHost";
import { type PluginAuthor, parsePluginManifest } from "./plugin-manifest";

export const MANIFEST_NAME = "plugin.json";
export const SKILLS_DIR = "skills";

/** One skill inside a plugin. */
export interface StoredPluginSkill {
  /** The name pi loads the skill under: its frontmatter name, or the folder
   *  name when the frontmatter omits one. Plugin-local, so two plugins can
   *  each ship a `monthly-review`. */
  rawName: string;
  /** `<plugin>:<skill>` — the identity the model and the UI both use. */
  name: string;
  description: string;
  /** Absolute path of the skill folder (the one holding SKILL.md). */
  dir: string;
}

/** A plugin folder read off disk. `error` marks a folder that is present but
 *  unusable — it still lists (and stays removable) so the problem is visible
 *  instead of the plugin silently vanishing. */
export interface StoredPlugin {
  /** Manifest name, which is also the folder name. */
  name: string;
  dir: string;
  description: string;
  version?: string;
  author?: PluginAuthor;
  /** The manifest's `repository`, if it declared one. */
  repository?: string;
  minAppVersion?: string;
  skills: StoredPluginSkill[];
  error?: string;
}

/** The one place `<plugin>:<skill>` is spelled out. Every skill the agent sees
 *  is namespaced, built-ins included, so a name always says where it came
 *  from and two plugins can ship the same skill name. */
export function effectiveSkillName(pluginName: string, rawSkillName: string): string {
  return `${pluginName}:${rawSkillName}`;
}

/** Names of the plugin folders in a store (dirs holding a plugin.json), sorted.
 *  Hidden folders are ignored. A store that is missing — or is somehow not a
 *  directory at all — reads as empty rather than throwing, so one odd path in
 *  the workspace can't take the whole app down. */
export function listPluginFolders(root: string): string[] {
  if (!existsSync(root)) return [];
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && existsSync(join(root, e.name, MANIFEST_NAME)))
    .map((e) => e.name)
    .sort();
}

/** Read a plugin from an arbitrary directory (an installed folder, or one just
 *  unpacked from a repo). The plugin's name comes from its manifest. */
export function readPluginDir(dir: string): StoredPlugin {
  const fallbackName = basename(dir);
  const fail = (error: string): StoredPlugin => ({ name: fallbackName, dir, description: "", skills: [], error });

  let text: string;
  try {
    text = readFileSync(join(dir, MANIFEST_NAME), "utf8");
  } catch {
    return fail(`Could not read ${MANIFEST_NAME}.`);
  }

  const parsed = parsePluginManifest(text);
  if (!parsed.ok) return fail(parsed.error);
  const manifest = parsed.manifest;

  const skillsRoot = join(dir, SKILLS_DIR);
  // pi's loader is the authority on a skill's name and description: it applies
  // the same frontmatter rules the agent will, so what we list is what the
  // agent loads.
  const loaded = existsSync(skillsRoot) ? loadSkillsFromDir({ dir: skillsRoot, source: "plugin" }).skills : [];
  const skills: StoredPluginSkill[] = loaded.map((skill) => ({
    rawName: skill.name,
    name: effectiveSkillName(manifest.name, skill.name),
    description: skill.description,
    dir: skill.baseDir,
  }));

  const plugin: StoredPlugin = {
    name: manifest.name,
    dir,
    description: manifest.description ?? "",
    skills,
    ...(manifest.version ? { version: manifest.version } : {}),
    ...(manifest.author ? { author: manifest.author } : {}),
    ...(manifest.repository ? { repository: manifest.repository } : {}),
    ...(manifest.minAppVersion ? { minAppVersion: manifest.minAppVersion } : {}),
  };
  // Skills are the only capability a plugin can contribute today, so one with
  // none would load and do nothing.
  if (skills.length === 0) plugin.error = "Plugin has no skills.";
  return plugin;
}

/** Read one plugin folder out of a store. The manifest name must match the
 *  folder name: the folder is the plugin's identity everywhere else (registry
 *  key, remove target, skill namespace), so letting the two drift would give
 *  one plugin two names. */
export function readPlugin(root: string, folder: string): StoredPlugin {
  const plugin = readPluginDir(join(root, folder));
  if (!plugin.error && plugin.name !== folder) {
    return {
      ...plugin,
      name: folder,
      error: `plugin.json: name "${plugin.name}" must match the folder name "${folder}".`,
    };
  }
  return plugin;
}

/** Every plugin in a store, folder order. */
export function readPlugins(root: string): StoredPlugin[] {
  return listPluginFolders(root).map((folder) => readPlugin(root, folder));
}

/** A skill after cross-plugin resolution. */
export interface ResolvedSkill extends StoredPluginSkill {
  pluginName: string;
  /** Set when an earlier plugin already claims this raw name. */
  conflictWith?: string;
}

/** Flatten plugins into the skills the agent will actually load, first plugin
 *  wins on a clash.
 *
 *  The clash is pi's, not ours: pi dedupes skills by their raw (frontmatter)
 *  name while loading, which happens before the rename hook that applies our
 *  `<plugin>:<skill>` names. Passing both copies would drop one silently, so
 *  we resolve it here and mark the loser — the UI shows why it is inactive.
 *  Pass built-in plugins first so a third-party plugin can never shadow one
 *  (officialFirst in plugins.ts is what guarantees that order). */
export function resolveSkills(plugins: StoredPlugin[]): ResolvedSkill[] {
  const claimedBy = new Map<string, string>();
  const resolved: ResolvedSkill[] = [];
  for (const plugin of plugins) {
    for (const skill of plugin.skills) {
      const owner = claimedBy.get(skill.rawName);
      resolved.push({ ...skill, pluginName: plugin.name, ...(owner ? { conflictWith: owner } : {}) });
      if (!owner) claimedBy.set(skill.rawName, plugin.name);
    }
  }
  return resolved;
}

/** The skill folders to hand the agent host, each with the namespaced name it
 *  must be surfaced under. */
export function hostSkills(plugins: StoredPlugin[]): AgentHostSkill[] {
  return resolveSkills(plugins)
    .filter((skill) => !skill.conflictWith)
    .map((skill) => ({ path: skill.dir, name: skill.name }));
}

// ── GitHub source parsing ────────────────────────────────────────────────────

export interface GitHubSource {
  /** `owner/repo` */
  repo: string;
  ref?: string;
  subpath?: string;
}

const GH_NAME_RE = /^[A-Za-z0-9_.-]+$/;

/** The account the app's own plugins are published from. A plugin installed
 *  from it is ours, whatever it calls itself in its manifest. */
export const OFFICIAL_OWNER = "accountant24";

/** Whether a recorded install source is one of ours. Case-folded, like the
 *  renderer's own isOfficial: GitHub owners are case-insensitive, and a source
 *  is recorded with whatever casing the marketplace index reported. */
export function isOfficialSource(source: string | undefined): boolean {
  return source?.toLowerCase().startsWith(`${OFFICIAL_OWNER}/`) === true;
}

/** A GitHub owner or repository name. Dots are allowed inside one (`next.js`),
 *  but a name that is only dots is a path segment, not a name: GitHub never
 *  issues one, and `..` in the API path would silently address something else. */
const isGitHubName = (name: string): boolean => GH_NAME_RE.test(name) && name !== "." && name !== "..";

/** Parse what a user pastes into "Add plugin": `owner/repo`, a github.com
 *  repo URL (optionally `.git`), or a github.com tree URL with a ref and
 *  optional subpath. Returns undefined for anything else (other hosts,
 *  non-repo URLs). */
export function parseGitHubSource(input: string): GitHubSource | undefined {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return undefined;

  // Bare owner/repo shorthand.
  const parts = trimmed.split("/");
  if (parts.length === 2 && isGitHubName(parts[0]) && isGitHubName(parts[1])) {
    return { repo: trimmed };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return undefined;

  const segs = url.pathname.split("/").filter((s) => s.length > 0);
  if (segs.length < 2) return undefined;
  const owner = segs[0];
  const repoName = segs[1].replace(/\.git$/, "");
  if (!isGitHubName(owner) || !isGitHubName(repoName)) return undefined;
  const repo = `${owner}/${repoName}`;

  if (segs.length === 2) return { repo };
  if (segs[2] !== "tree" || segs.length < 4) return undefined;
  const source: GitHubSource = { repo, ref: segs[3] };
  if (segs.length > 4) source.subpath = segs.slice(4).join("/");
  return source;
}
