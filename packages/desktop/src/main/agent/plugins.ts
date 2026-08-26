// Plugins — manage the plugin store (<workspace>/plugins) over IPC.
//
// The store is the whole picture: the plugins a new workspace starts with are
// installed into it on first launch (plugins-defaults), from their own
// repositories, so they are ordinary plugins here and can be uninstalled like
// any other.
//
// Install is two steps so the user approves what they get: inspect fetches the
// repo tarball from the GitHub API over plain HTTPS (no git or npm on the
// user's machine), unpacks it to a temp dir and reports what the plugin
// contains; add copies that already-inspected copy into the store. Staging the
// unpacked plugin between the two steps is what makes the confirmation
// meaningful — a second download could serve different content than the one
// that was shown.
//
// Nothing from the repo executes while a plugin is installed (unlike git hooks
// or npm lifecycle scripts); a plugin's skills and scripts only run when the
// agent uses them, which the install confirmation covers. The agent host is
// respawned by the renderer after any mutation so its skill set matches.

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { app, type BrowserWindow, ipcMain } from "electron";
import * as tar from "tar";
import type { AgentHostSkill } from "../../shared/agentHost";
import type { PluginAddRequest, PluginInfo, PluginPreview, PluginRegistry, PluginSkillInfo } from "../../shared/types";
import {
  type PluginInstallFailReason,
  trackPluginInstallFailed,
  trackPluginInstallSucceeded,
  trackPluginUninstalled,
} from "../analytics";
import { pluginsDir } from "../env";
import { readPluginRegistry, writePluginRegistry } from "../settings";
import { checkMinAppVersion } from "./plugin-manifest";
import {
  hostSkills,
  isOfficialSource,
  MANIFEST_NAME,
  parseGitHubSource,
  readPluginDir,
  readPlugins,
  resolveSkills,
  type StoredPlugin,
} from "./plugins-store";

// ---- shared reads -----------------------------------------------------------

/** Every plugin in the workspace store, ours first. The ones a new workspace
 *  starts with are installed there on first launch (see plugins-defaults), so
 *  there is only ever one place plugins are read from.
 *
 *  The order is the skill-conflict rule: two plugins can't ship the same
 *  unnamespaced skill name, and resolveSkills gives it to whoever comes first.
 *  A plugin installed before ours arrived (the seed does no collision check)
 *  would otherwise take a skill off an official plugin. */
function allPlugins(): StoredPlugin[] {
  return officialFirst(readPlugins(pluginsDir()));
}

/** Plugins installed from the Accountant24 account, then the rest. Stable, so
 *  each group keeps the store's own (alphabetical) order. Exported for tests. */
export function officialFirst(plugins: StoredPlugin[], registry = readPluginRegistry()): StoredPlugin[] {
  // A miss here would let a community plugin take a skill name off one of
  // ours, which is exactly what this ordering exists to prevent, so the
  // case-folding rule lives in one place (isOfficialSource) for everyone.
  const official = (plugin: StoredPlugin) => isOfficialSource(registry[plugin.name]?.source);
  return [...plugins].sort((a, b) => Number(official(b)) - Number(official(a)));
}

/** The skills the agent host should load. Called when forking the host. */
export function agentSkills(): AgentHostSkill[] {
  return hostSkills(allPlugins());
}

// ---- list -------------------------------------------------------------------

const authorName = (plugin: StoredPlugin): string | undefined => plugin.author?.name;

function toPluginInfo(plugin: StoredPlugin, skills: PluginSkillInfo[]): PluginInfo {
  const author = authorName(plugin);
  return {
    name: plugin.name,
    description: plugin.description,
    skills,
    ...(plugin.version ? { version: plugin.version } : {}),
    ...(author ? { author } : {}),
    ...(plugin.repository ? { repository: plugin.repository } : {}),
    ...(plugin.error ? { error: plugin.error } : {}),
  };
}

function pluginsList(): { plugins: PluginInfo[] } {
  const installed = allPlugins();
  const registry = pruneRegistry(installed);

  // Resolve skills across the whole set so a clash is reported on the plugin
  // that loses it, in the same first-wins order the agent host is given.
  const resolved = resolveSkills(installed);
  const skillsByPlugin = new Map<string, PluginSkillInfo[]>();
  for (const skill of resolved) {
    const info: PluginSkillInfo = {
      name: skill.name,
      description: skill.description,
      ...(skill.conflictWith ? { error: `Skill name already used by the ${skill.conflictWith} plugin.` } : {}),
    };
    skillsByPlugin.set(skill.pluginName, [...(skillsByPlugin.get(skill.pluginName) ?? []), info]);
  }
  // resolveSkills keeps the losers too (marked with the plugin that took the
  // name), so every plugin with skills has an entry here; one without skills,
  // like an invalid folder, has none.
  const skillsOf = (plugin: StoredPlugin): PluginSkillInfo[] => skillsByPlugin.get(plugin.name) ?? [];

  return {
    plugins: installed.map((plugin) => {
      const info = toPluginInfo(plugin, skillsOf(plugin));
      const source = registry[plugin.name]?.source;
      return source ? { ...info, source } : info;
    }),
  };
}

/** Provenance for plugins that are actually there. A folder deleted outside
 *  the app (or with it closed) leaves its entry behind, and a later plugin of
 *  the same name would inherit its repository, and with it the Official badge.
 *  Reading the list is where the two are compared, so the stale entry goes. */
function pruneRegistry(installed: StoredPlugin[]): PluginRegistry {
  const registry = readPluginRegistry();
  const names = new Set(installed.map((plugin) => plugin.name));
  const kept = Object.fromEntries(Object.entries(registry).filter(([name]) => names.has(name)));
  if (Object.keys(kept).length !== Object.keys(registry).length) writePluginRegistry(kept);
  return kept;
}

// ---- install ----------------------------------------------------------------

/** A plugin unpacked from a repo and shown to the user, waiting to be
 *  installed. One at a time: the dialog inspects then installs, and the store
 *  registry is a read-modify-write. */
interface StagedPlugin {
  tmp: string;
  dir: string;
  plugin: StoredPlugin;
  preview: PluginPreview;
  repo: string;
  commit?: string;
}

let staged: StagedPlugin | null = null;
let busy = false;

function clearStaged(): void {
  if (staged) rmSync(staged.tmp, { recursive: true, force: true });
  staged = null;
}

const fail = (reason: PluginInstallFailReason, message: string) => {
  // Analytics carry the structural failure reason only, never the message
  // (it names repos and paths).
  trackPluginInstallFailed("marketplace", reason);
  return { type: "error" as const, message };
};

const skillPreview = (plugin: StoredPlugin): PluginSkillInfo[] =>
  plugin.skills.map((skill) => ({ name: skill.name, description: skill.description }));

/** A repo read and validated, waiting in a temp dir. The caller owns that dir
 *  and drops it with `cleanup()` once it has copied what it needs. */
export interface FetchedPlugin {
  ok: true;
  tmp: string;
  dir: string;
  plugin: StoredPlugin;
  repo: string;
  commit?: string;
  cleanup: () => void;
}

export interface FetchFailure {
  ok: false;
  reason: PluginInstallFailReason;
  message: string;
}

/** Download a repo, unpack it, and read the plugin inside. The one path a
 *  plugin travels, whether the user asked for it or the app installs it by
 *  default. Reports failures rather than tracking them: what a failure means
 *  depends on who asked. */
export async function fetchPluginFromRepo(
  repo: string,
  progress: (message: string) => void = () => {},
): Promise<FetchedPlugin | FetchFailure> {
  const bad = (reason: PluginInstallFailReason, message: string): FetchFailure => ({ ok: false, reason, message });
  const tmp = mkdtempSync(resolve(tmpdir(), "a24-plugin-"));
  let keep = false;
  try {
    // 1. Download the tarball (the API URL redirects to codeload; Node's fetch
    //    follows it). Public repos only — no auth token is sent.
    progress(`Downloading ${repo}…`);
    const res = await fetch(`https://api.github.com/repos/${repo}/tarball`, {
      headers: { "User-Agent": "accountant24" },
    });
    if (!res.ok || !res.body) {
      const message =
        res.status === 404
          ? `Repository not found: ${repo}`
          : res.status === 403
            ? "GitHub rate limit reached — try again in a few minutes."
            : `GitHub returned ${res.status} for ${repo}.`;
      return bad(res.status === 404 ? "not_found" : "fetch_failed", message);
    }

    // 2. Extract into the temp dir. GitHub tarballs wrap everything in a single
    //    `owner-repo-sha/` dir — strip it, but read the commit SHA off it first
    //    (a future updater compares it against the repo's tip). node-tar
    //    refuses absolute paths and `..` entries by default.
    progress("Extracting…");
    let commit: string | undefined;
    await pipeline(
      Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
      tar.x({
        cwd: tmp,
        strip: 1,
        onReadEntry: (entry) => {
          commit ??= /^[^/]+-([0-9a-f]{7,40})(?:\/|$)/.exec(entry.path)?.[1];
        },
      }),
    );

    // 3. Read the plugin. plugin.json at the repository root is required:
    //    without a manifest there is no plugin identity to install under.
    const dir = resolve(tmp);
    if (!existsSync(resolve(dir, MANIFEST_NAME))) {
      return bad("no_plugin", `No plugin found in ${repo}: a plugin needs a ${MANIFEST_NAME} file.`);
    }

    const plugin = readPluginDir(dir);
    if (plugin.error) return bad("invalid_plugin", plugin.error);
    if (plugin.minAppVersion && !checkMinAppVersion(plugin.minAppVersion, app.getVersion())) {
      return bad(
        "app_too_old",
        `${plugin.name} needs Accountant24 v${plugin.minAppVersion} or newer. Update the app and try again.`,
      );
    }

    keep = true;
    return {
      ok: true,
      tmp,
      dir,
      plugin,
      repo,
      ...(commit ? { commit } : {}),
      cleanup: () => rmSync(tmp, { recursive: true, force: true }),
    };
  } catch (error) {
    return bad("fetch_failed", error instanceof Error ? error.message : String(error));
  } finally {
    if (!keep) rmSync(tmp, { recursive: true, force: true });
  }
}

/** Fetch a repo and hold it as the pending install the dialog is confirming. */
async function stagePlugin(getWin: () => BrowserWindow | null, req: PluginAddRequest) {
  // A marketplace entry is always `owner/repo`; anything else (a ref, a
  // subdirectory, another host) is not something the app can be asked to
  // install.
  const parsed = parseGitHubSource(req.source);
  if (!parsed || parsed.repo !== req.source.trim() || parsed.ref || parsed.subpath) {
    return fail("invalid_source", `Not a GitHub repository: ${req.source}`);
  }

  const progress = (message: string) => {
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send("plugins-event", { type: "progress", message });
  };

  clearStaged();
  const fetched = await fetchPluginFromRepo(parsed.repo, progress);
  if (!fetched.ok) return fail(fetched.reason, fetched.message);

  const { plugin, repo, commit } = fetched;
  const preview: PluginPreview = {
    name: plugin.name,
    description: plugin.description,
    repo,
    repoUrl: `https://github.com/${repo}`,
    skills: skillPreview(plugin),
    ...(plugin.version ? { version: plugin.version } : {}),
    ...(authorName(plugin) ? { author: authorName(plugin) as string } : {}),
  };
  staged = { tmp: fetched.tmp, dir: fetched.dir, plugin, preview, repo, ...(commit ? { commit } : {}) };
  return { type: "plugin" as const, plugin: preview };
}

async function pluginsInspect(getWin: () => BrowserWindow | null, req: PluginAddRequest) {
  if (busy) return { type: "error", message: "Another plugin is already being installed." };
  busy = true;
  try {
    return await stagePlugin(getWin, req);
  } finally {
    busy = false;
  }
}

/** Install the staged plugin. Runs after the user confirms what inspect
 *  reported, so it never fetches again. */
function pluginsAdd() {
  if (busy) return { type: "error", message: "Another plugin is already being installed." };
  if (!staged) return { type: "error", message: "Nothing to install — inspect the repository first." };
  busy = true;
  try {
    const { plugin, repo } = staged;
    const installed = allPlugins();

    const existing = installed.find((p) => p.name === plugin.name);
    const entry = readPluginRegistry()[plugin.name];
    if (existing && entry?.source !== repo) {
      // Same name from another source (or a hand-dropped folder) — never clobber it.
      return fail(
        "collision",
        entry?.source
          ? `${plugin.name} is already installed from ${entry.source}.`
          : `A plugin folder named ${plugin.name} is already in your workspace.`,
      );
    }

    // pi identifies a skill by its own name before our plugin namespace is
    // applied, so two plugins can't ship the same unnamespaced skill name.
    const others = installed.filter((p) => p.name !== plugin.name);
    const taken = new Map(others.flatMap((p) => p.skills.map((s) => [s.rawName, p.name] as const)));
    for (const skill of plugin.skills) {
      const owner = taken.get(skill.rawName);
      if (owner) {
        return fail("collision", `The skill ${skill.rawName} is already provided by the ${owner} plugin.`);
      }
    }

    commitToStore(staged);
    trackPluginInstallSucceeded("marketplace", isOfficialSource(repo), plugin.skills.length);
    // Only a successful install consumes the staged copy; after a refusal the
    // dialog still shows the plugin, so keep it installable once the user has
    // dealt with whatever blocked it.
    clearStaged();
    return { type: "done" as const, name: plugin.name };
  } catch (error) {
    return fail("other", error instanceof Error ? error.message : String(error));
  } finally {
    busy = false;
  }
}

/** Copy a fetched plugin into the store and record where it came from. The
 *  copy replaces whatever sits under that name, so callers check first. */
export function commitToStore({ dir, plugin, repo, commit }: Omit<FetchedPlugin, "ok" | "tmp" | "cleanup">): void {
  const root = pluginsDir();
  mkdirSync(root, { recursive: true });
  const dest = resolve(root, plugin.name);
  rmSync(dest, { recursive: true, force: true });
  // dereference: store real files, never symlinks pointing out of the store.
  cpSync(dir, dest, { recursive: true, dereference: true });

  writePluginRegistry({
    ...readPluginRegistry(),
    [plugin.name]: {
      source: repo,
      ...(commit ? { commit } : {}),
      addedAt: new Date().toISOString(),
    },
  });
}

/** Run something that installs, unless an install is already running. Returns
 *  undefined when it was skipped, so the caller can try again later. */
export async function withInstallLock<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (busy) return undefined;
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}

/** The plugins in the store, for callers outside this module. */
export function storedPlugins(): StoredPlugin[] {
  return allPlugins();
}

// ---- uninstall ----------------------------------------------------------------

function pluginsRemove(name: string) {
  // The delete lands on a folder directly inside the store, or nowhere: the
  // check is on the resolved path, not on the shape of the name, so a name
  // carrying a separator or dot segments can't reach past the store.
  const root = resolve(pluginsDir());
  const target = resolve(root, name);
  if (!name || name.startsWith(".") || dirname(target) !== root) {
    return { type: "error", message: "invalid plugin name" };
  }
  rmSync(target, { recursive: true, force: true });

  // The registry entry (provenance + approval) goes with the folder. Read
  // whose plugin it was before dropping it: that is the only record of it.
  const registry = readPluginRegistry();
  const official = isOfficialSource(registry[name]?.source);
  if (registry[name]) {
    const { [name]: _removed, ...rest } = registry;
    writePluginRegistry(rest);
  }

  trackPluginUninstalled(official);
  return { type: "done", name };
}

// ---- registration -------------------------------------------------------------

/** Register plugins IPC handlers. */
export function registerPluginsIpc(getWin: () => BrowserWindow | null): void {
  // A staged copy is replaced by the next inspect, but a cancelled install
  // leaves the last one in tmp for the rest of the session.
  app.on("will-quit", () => clearStaged());
  ipcMain.handle("plugins_list", () => pluginsList());
  ipcMain.handle("plugins_inspect", (_e, req: PluginAddRequest) => pluginsInspect(getWin, req));
  ipcMain.handle("plugins_add", () => pluginsAdd());
  ipcMain.handle("plugins_remove", (_e, { name }: { name: string }) => pluginsRemove(name));
}

/** Test seam: drop any staged install so state can't leak between cases. */
export function resetStagedPlugin(): void {
  clearStaged();
  busy = false;
}
