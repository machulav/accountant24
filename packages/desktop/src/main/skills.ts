// Skills — manage the Agent Skills store (~/Accountant24/skills) over IPC.
//
// Add = fetch the repo tarball from the GitHub API over plain HTTPS (no git
// or npm on the user's machine) → extract into a temp dir → locate + validate
// skill folders with pi's own loader → copy the selected ones into the store.
// Nothing from the repo executes when a skill is added (unlike git hooks or npm
// lifecycle scripts); a skill's scripts only run when the agent uses them,
// which the Settings page's trust notice covers. The agent child is respawned
// by the renderer after any mutation so its `--skill` flags reflect the store.

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { type BrowserWindow, ipcMain } from "electron";
import * as tar from "tar";
import type { SkillAddRequest, SkillInfo } from "../shared/types";
import {
  type SkillAddFailReason,
  trackSkillAdded,
  trackSkillAddFailed,
  trackSkillDisabled,
  trackSkillEnabled,
  trackSkillRemoved,
} from "./analytics";
import { nativeSkillsDir, skillsDir } from "./env";
import {
  listSkillFolders,
  parseGitHubSource,
  readRegistry,
  sanitizeSkillFolderName,
  writeRegistry,
} from "./skills-store";

// ---- list -------------------------------------------------------------------

/** Native (built-in) skills, read from the app bundle. Always enabled — the
 *  agent loads the whole native dir unconditionally (see agent.ts). */
function listNativeSkills(): SkillInfo[] {
  const { skills } = loadSkillsFromDir({ dir: nativeSkillsDir(), source: "native" });
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    enabled: true,
    native: true,
  }));
}

const nativeSkillNames = (): Set<string> => new Set(listNativeSkills().map((s) => s.name));

function skillsList() {
  const root = skillsDir();
  const registry = readRegistry(root);

  const thirdParty: SkillInfo[] = listSkillFolders(root).map((folder) => {
    const { skills } = loadSkillsFromDir({ dir: join(root, folder), source: "user" });
    const entry = registry[folder];
    const info: SkillInfo = {
      name: folder,
      description: skills[0]?.description ?? "",
      enabled: entry?.enabled === true,
      ...(entry?.source ? { source: entry.source } : {}),
    };
    // pi's loader drops a skill whose SKILL.md has no usable description —
    // surface the folder anyway so the user can see and remove it.
    if (skills.length === 0) info.error = "Invalid skill: SKILL.md is missing a description.";
    return info;
  });

  return { type: "skills", skills: [...listNativeSkills(), ...thirdParty] };
}

// ---- add --------------------------------------------------------------------

/** One add at a time: the registry is a read-modify-write file, and the UI
 *  busy-guards per row anyway. */
let adding = false;

async function skillsAdd(getWin: () => BrowserWindow | null, req: SkillAddRequest) {
  // Analytics carry the structural failure reason only, never the message
  // (it names repos and paths).
  const fail = (reason: SkillAddFailReason, message: string) => {
    trackSkillAddFailed(reason);
    return { type: "error", message };
  };

  const parsed = parseGitHubSource(req.source);
  if (!parsed) return fail("invalid_source", "Enter a GitHub repository like owner/repo or a github.com URL.");
  // The re-entrancy guard is a UI artifact, not a funnel failure — untracked.
  if (adding) return { type: "error", message: "Another skill is already being added." };
  adding = true;

  const progress = (message: string) => {
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send("skills-event", { type: "progress", message });
  };

  const repo = parsed.repo;
  const ref = req.ref ?? parsed.ref;
  const subpath = req.subpath ?? parsed.subpath;

  const tmp = mkdtempSync(join(tmpdir(), "a24-skill-add-"));
  try {
    // 1. Download the tarball (the API URL redirects to codeload; Node's fetch
    //    follows it). Public repos only — no auth token is sent.
    progress(`Downloading ${repo}…`);
    const url = `https://api.github.com/repos/${repo}/tarball${ref ? `/${encodeURIComponent(ref)}` : ""}`;
    const res = await fetch(url, { headers: { "User-Agent": "accountant24" } });
    if (!res.ok || !res.body) {
      const message =
        res.status === 404
          ? `Repository or ref not found: ${repo}${ref ? `@${ref}` : ""}`
          : res.status === 403
            ? "GitHub rate limit reached — try again in a few minutes."
            : `GitHub returned ${res.status} for ${repo}.`;
      return fail(res.status === 404 ? "not_found" : "fetch_failed", message);
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

    // 3. Locate skill folders with pi's own loader (validates frontmatter).
    const scanRoot = subpath ? resolve(tmp, subpath) : tmp;
    if (!scanRoot.startsWith(resolve(tmp) + sep) && scanRoot !== resolve(tmp)) {
      return fail("invalid_source", "Invalid repository subpath.");
    }
    if (!existsSync(scanRoot)) {
      return fail("not_found", `Path not found in ${repo}: ${subpath}`);
    }
    const found = loadSkillsFromDir({ dir: scanRoot, source: "add" }).skills;
    const wanted = req.skills ? found.filter((s) => req.skills?.includes(s.name)) : found;
    if (wanted.length === 0) {
      return fail("no_skills", `No skills (folders with a SKILL.md) found in ${repo}.`);
    }

    // 4. Copy each skill folder into the store; record provenance.
    const root = skillsDir();
    mkdirSync(root, { recursive: true });
    const registry = readRegistry(root);
    const natives = nativeSkillNames();
    const added: string[] = [];
    const skipped: { name: string; message: string }[] = [];

    for (const skill of wanted) {
      const folder = sanitizeSkillFolderName(skill.name);
      if (!folder) {
        skipped.push({ name: skill.name, message: "Skill name is not usable as a folder name." });
        continue;
      }
      if (natives.has(folder)) {
        // A same-named third-party skill would shadow/duplicate the built-in.
        skipped.push({ name: folder, message: "A skill with this name is built into the app." });
        continue;
      }
      const dest = join(root, folder);
      const existing = registry[folder];
      if (existsSync(dest) && existing?.source !== repo) {
        // Same name from another source (or a manual drop) — never clobber it.
        skipped.push({
          name: folder,
          message: existing ? `Already added from ${existing.source}.` : "Already present in the skills folder.",
        });
        continue;
      }
      progress(`Adding ${folder}…`);
      rmSync(dest, { recursive: true, force: true });
      // dereference: store real files, never symlinks pointing out of the store.
      cpSync(skill.baseDir, dest, { recursive: true, dereference: true });
      registry[folder] = {
        // Adding through the app is the approval: added skills start
        // enabled (re-adding also re-approves a switched-off one).
        enabled: true,
        source: repo,
        subpath: relative(tmp, skill.baseDir).split(sep).join("/"),
        ...(ref ? { ref } : {}),
        ...(commit ? { commit } : {}),
        addedAt: new Date().toISOString(),
      };
      added.push(folder);
    }

    writeRegistry(root, registry);
    if (added.length === 0) {
      return fail("other", skipped.map((s) => `${s.name}: ${s.message}`).join(" "));
    }
    trackSkillAdded(added.length, skipped.length);
    return { type: "done", added, skipped };
  } catch (error) {
    return fail("fetch_failed", error instanceof Error ? error.message : String(error));
  } finally {
    adding = false;
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- remove / toggle ---------------------------------------------------------

function skillsRemove(name: string) {
  if (!name || name !== basename(name) || name.startsWith(".")) {
    return { type: "error", message: "invalid skill name" };
  }
  if (nativeSkillNames().has(name)) {
    return { type: "error", message: "built-in skills can't be removed" };
  }
  const root = skillsDir();
  const target = resolve(root, name);
  // Strictly inside the store (same containment rule as sessionsDelete).
  if (!target.startsWith(resolve(root) + sep)) {
    return { type: "error", message: "refusing to delete a path outside the skills directory" };
  }
  rmSync(target, { recursive: true, force: true });

  // The registry entry (provenance + approval) goes with the folder.
  const registry = readRegistry(root);
  if (registry[name]) {
    delete registry[name];
    writeRegistry(root, registry);
  }

  trackSkillRemoved();
  return { type: "done", name };
}

function skillsSetEnabled(name: string, enabled: boolean) {
  if (nativeSkillNames().has(name)) {
    return { type: "error", message: "built-in skills can't be disabled" };
  }
  const root = skillsDir();
  const registry = readRegistry(root);
  // A manual drop gets its first (provenance-less) entry on approval.
  registry[name] = { ...registry[name], enabled };
  writeRegistry(root, registry);
  if (enabled) trackSkillEnabled();
  else trackSkillDisabled();
  return { type: "done", name, enabled };
}

// ---- registration -------------------------------------------------------------

/** Register skills IPC handlers. */
export function registerSkillsIpc(getWin: () => BrowserWindow | null): void {
  ipcMain.handle("skills_list", () => skillsList());
  ipcMain.handle("skills_add", (_e, req: SkillAddRequest) => skillsAdd(getWin, req));
  ipcMain.handle("skills_remove", (_e, { name }: { name: string }) => skillsRemove(name));
  ipcMain.handle("skills_set_enabled", (_e, { name, enabled }: { name: string; enabled: boolean }) =>
    skillsSetEnabled(name, enabled),
  );
}
