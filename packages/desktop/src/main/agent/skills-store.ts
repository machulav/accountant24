// The on-disk skills store: ~/Accountant24/skills, one self-contained folder per
// skill (Agent Skills standard — a directory holding SKILL.md). This module owns
// the folder-level logic shared by the agent spawn (which passes each enabled
// skill via `--skill`) and the skills IPC module; it deliberately has no
// Electron imports so it stays unit-testable over plain temp dirs.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Names of the skill folders in the store (dirs containing SKILL.md), sorted.
 *  Hidden folders are ignored (`.skills.json` sits next to skill dirs, and a
 *  dot-folder should never be advertised to the agent). */
export function listSkillFolders(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && existsSync(join(root, e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort();
}

/** Absolute dirs of every enabled skill in the store, straight from the
 *  registry. The agent host loads skills with discovery disabled (pi's
 *  `noSkills`) plus these explicit paths — so the registry is the single
 *  source of truth for what the agent sees. A folder without an enabled
 *  registry entry (e.g. dropped in by hand) stays off until approved in
 *  Settings. */
export function enabledSkillPaths(root: string): string[] {
  const registry = readRegistry(root);
  return listSkillFolders(root)
    .filter((name) => registry[name]?.enabled === true)
    .map((name) => join(root, name));
}

// ── Store registry ────────────────────────────────────────────────────────────
// All per-skill metadata, keyed by folder name: the enabled/approved state plus
// add provenance. Lives inside the store (skills/.skills.json) so it
// travels with the data. A folder without an entry was dropped in by hand and
// hasn't been approved yet; an entry without a source is a manual drop the user
// switched on.

export interface SkillRegistryEntry {
  /** Approved to run: adding sets this; manual drops get it on first toggle. */
  enabled: boolean;
  /** GitHub `owner/repo` the skill was added from; absent = manual drop. */
  source?: string;
  /** Repo subpath the skill folder was found under (when not the repo root). */
  subpath?: string;
  /** Git ref (branch/tag/commit) requested when the skill was added. */
  ref?: string;
  /** Commit SHA the added tarball was cut from (from the tarball's wrapper
   *  dir name) — lets a future updater compare against the repo's tip. */
  commit?: string;
  /** ISO timestamp of the (latest) add; absent = manual drop. */
  addedAt?: string;
}

export type SkillsRegistry = Record<string, SkillRegistryEntry>;

const REGISTRY_NAME = ".skills.json";

export function readRegistry(root: string): SkillsRegistry {
  const path = join(root, REGISTRY_NAME);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as SkillsRegistry) : {};
  } catch {
    return {};
  }
}

/** Persist the registry, pruning entries whose folder no longer exists (e.g.
 *  deleted by hand) so state can't dangle. */
export function writeRegistry(root: string, registry: SkillsRegistry): void {
  const folders = new Set(listSkillFolders(root));
  const pruned = Object.fromEntries(Object.entries(registry).filter(([name]) => folders.has(name)));
  writeFileSync(join(root, REGISTRY_NAME), `${JSON.stringify(pruned, null, 2)}\n`);
}

// ── Naming ───────────────────────────────────────────────────────────────────

/** Fold a skill's frontmatter name into a safe store folder name per the Agent
 *  Skills spec charset (lowercase a-z, 0-9, hyphens; max 64). Also what makes
 *  path traversal via a hostile name impossible. Returns undefined when nothing
 *  usable remains. */
export function sanitizeSkillFolderName(name: string): string | undefined {
  const folded = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .replace(/-$/, "");
  return folded.length > 0 ? folded : undefined;
}

// ── GitHub source parsing ────────────────────────────────────────────────────

export interface GitHubSource {
  /** `owner/repo` */
  repo: string;
  ref?: string;
  subpath?: string;
}

const GH_NAME_RE = /^[A-Za-z0-9_.-]+$/;

/** Parse what a user pastes into "Add skill": `owner/repo`, a github.com
 *  repo URL (optionally `.git`), or a github.com tree URL with a ref and
 *  optional subpath. Returns undefined for anything else (other hosts,
 *  non-repo URLs). */
export function parseGitHubSource(input: string): GitHubSource | undefined {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return undefined;

  // Bare owner/repo shorthand.
  const parts = trimmed.split("/");
  if (parts.length === 2 && GH_NAME_RE.test(parts[0]) && GH_NAME_RE.test(parts[1])) {
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
  if (!GH_NAME_RE.test(owner) || !GH_NAME_RE.test(repoName)) return undefined;
  const repo = `${owner}/${repoName}`;

  if (segs.length === 2) return { repo };
  if (segs[2] !== "tree" || segs.length < 4) return undefined;
  const source: GitHubSource = { repo, ref: segs[3] };
  if (segs.length > 4) source.subpath = segs.slice(4).join("/");
  return source;
}
