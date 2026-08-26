// The plugins a new install starts with.
//
// They are ordinary marketplace plugins, installed from their own repository
// the first time the app can reach the network, through the same download the
// user's own installs use. The app ships no copy of them.
//
// One rule keeps this out of the user's way: a repository recorded as
// installed is never installed again. So an uninstall is final, and nothing
// the user has is ever replaced. Until an attempt succeeds it is retried on
// the next launch, silently: a first run without a connection is a normal
// state, not an error to report.

import type { BrowserWindow } from "electron";
import { trackPluginInstallFailed, trackPluginInstallSucceeded } from "../analytics";
import { readDefaultPluginsInstalled, readPluginRegistry, writeDefaultPluginsInstalled } from "../settings";
import { commitToStore, fetchPluginFromRepo, storedPlugins, withInstallLock } from "./plugins";
import { isOfficialSource } from "./plugins-store";
import { killAllAgents } from "./router";

/** What a fresh workspace is given, as `owner/repo`. */
export const DEFAULT_PLUGINS = ["accountant24/skills"];

/** Whether the attempt is over ("done", never try again) or should be repeated
 *  on the next launch ("retry"). */
type Outcome = "installed" | "done" | "retry";

/** Install the default plugins this workspace hasn't been given yet. Never
 *  throws: startup does not depend on it, and neither does anything else. */
export async function installDefaultPlugins(getWin: () => BrowserWindow | null): Promise<void> {
  try {
    await installEach(getWin);
  } catch (error) {
    // Copying into the store and recording the result are plain file writes,
    // and they can fail for reasons that have nothing to do with plugins: a
    // read-only home, a full disk, a `plugins` path that is not a directory.
    // None of that is worth taking the launch down for — and the caller fires
    // this without awaiting it, so a rejection here would go unhandled. The
    // next launch tries again.
    console.warn(`[plugins] defaults: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function installEach(getWin: () => BrowserWindow | null): Promise<void> {
  const done = new Set(readDefaultPluginsInstalled());
  let installed = false;

  for (const repo of DEFAULT_PLUGINS) {
    if (done.has(repo)) continue;
    const outcome = await install(repo);
    if (outcome === "retry") continue;
    done.add(repo);
    writeDefaultPluginsInstalled([...done]);
    if (outcome === "installed") installed = true;
  }

  if (!installed) return;
  // The host caches its skills at fork time, so drop it: the next message
  // picks the new skills up. The renderer reloads its lists on the event.
  killAllAgents();
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send("plugins-event", { type: "changed" });
}

async function install(repo: string): Promise<Outcome> {
  // Already installed by hand, from the marketplace: nothing to do, and
  // nothing to fetch to find that out.
  if (Object.values(readPluginRegistry()).some((entry) => entry.source === repo)) return "done";

  const outcome = await withInstallLock(async (): Promise<Outcome> => {
    const fetched = await fetchPluginFromRepo(repo);
    if (!fetched.ok) {
      // Offline, rate-limited, or a repository that moved. Nothing is shown:
      // the plugin is listed in the marketplace meanwhile, and the next launch
      // tries again. Counted, though — a first launch that never reaches the
      // network leaves the workspace with no skills at all, and that is
      // otherwise invisible.
      console.warn(`[plugins] ${repo}: ${fetched.message}`);
      trackPluginInstallFailed("default", fetched.reason);
      return "retry";
    }
    try {
      if (
        blockedBy(
          fetched.plugin.name,
          fetched.plugin.skills.map((skill) => skill.rawName),
        )
      ) {
        trackPluginInstallFailed("default", "collision");
        return "done";
      }
      commitToStore(fetched);
      trackPluginInstallSucceeded("default", isOfficialSource(repo), fetched.plugin.skills.length);
      return "installed";
    } finally {
      fetched.cleanup();
    }
  });

  // The lock is held by an install the user started; theirs goes first.
  return outcome ?? "retry";
}

/** Whether something the user already has stands where this plugin would go:
 *  a folder of that name, or a plugin claiming one of its skill names (pi
 *  identifies a skill by its own name, so only one can hold it). Theirs wins,
 *  and this default install stands down for good rather than fighting it; the
 *  marketplace still offers the plugin if they want it. */
function blockedBy(name: string, rawSkillNames: string[]): boolean {
  const wanted = new Set(rawSkillNames);
  return storedPlugins().some(
    (plugin) => plugin.name === name || plugin.skills.some((skill) => wanted.has(skill.rawName)),
  );
}
