// The plugin marketplace: the index of published plugins, read over IPC by
// Settings → Plugins.
//
// The index is one static JSON file in the accountant24/marketplace repository,
// rebuilt there every 30 minutes from the public repositories tagged
// `accountant24-plugin`. Fetching it lives here because the renderer's CSP
// allows no outbound connections at all, and because the app version (for
// minAppVersion) is a main-process fact.
//
// Nothing here installs anything: an entry only carries what a listing needs,
// and installing goes through the existing inspect/add flow with the entry's
// repo as the source. Whether an entry is already installed is decided in the
// renderer, which already holds the plugins list.
//
// Validation is deliberately lenient in one direction: a malformed *entry* is
// dropped so one broken community plugin can't blank the list, while a
// malformed *index* is an error, because that means we're not reading what we
// think we are.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { app, ipcMain } from "electron";
import type { MarketplaceEntry, MarketplaceRequest, MarketplaceResult, PluginSkillInfo } from "../../shared/types";
import { type MarketplaceLoadFailKind, trackMarketplaceLoadFailed } from "../analytics";
import { checkMinAppVersion, pluginNameError } from "./plugin-manifest";
import { effectiveSkillName, parseGitHubSource } from "./plugins-store";

export const MARKETPLACE_URL = "https://raw.githubusercontent.com/accountant24/marketplace/main/marketplace.json";

/** How long a downloaded index is served without going back to the network.
 *  Matches the `max-age=300` raw.githubusercontent.com sends for it. */
export const MARKETPLACE_TTL_MS = 5 * 60 * 1000;

/** Give up on a slow network rather than leave the section spinning. */
export const MARKETPLACE_TIMEOUT_MS = 10_000;

/** The only index schema this app understands. */
const SCHEMA_VERSION = 1;

/** Skill folder names, as the indexer validates them. */
const SKILL_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

/** Where to read the index from. `A24_MARKETPLACE_URL` points a dev build or a
 *  test at a fixture (an http(s) or file URL); a packaged app always uses the
 *  real index, so nothing in a user's environment can redirect it. */
export function marketplaceUrl(): string {
  const override = process.env.A24_MARKETPLACE_URL;
  return !app.isPackaged && override ? override : MARKETPLACE_URL;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** The skills of one entry, namespaced the way the app names them everywhere
 *  else. Items that aren't usable listings are dropped. */
function parseSkills(raw: unknown, pluginName: string): PluginSkillInfo[] {
  if (!Array.isArray(raw)) return [];
  const skills: PluginSkillInfo[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const name = str(item.name);
    if (name === undefined || !SKILL_NAME_RE.test(name)) continue;
    skills.push({ name: effectiveSkillName(pluginName, name), description: str(item.description) ?? "" });
  }
  return skills;
}

/** The repository's own page. Taken from the index when it points at GitHub,
 *  and built from the name otherwise: the entry becomes a link in the UI, so a
 *  URL from the index never gets to point somewhere else. */
function repoUrl(raw: unknown, repo: string): string {
  const url = str(raw);
  return url?.startsWith("https://github.com/") ? url : `https://github.com/${repo}`;
}

/** One index entry, or undefined when it isn't a listable plugin.
 *
 *  The index keeps what an author claims (`manifest`) apart from what GitHub
 *  reports (`repo`), since listing is automatic and nobody reviews it. A row
 *  needs one plugin, so the two are flattened here — with the repository, the
 *  one thing that decides what gets installed, always taken from GitHub's
 *  side. */
function parseEntry(raw: unknown, appVersion: string): MarketplaceEntry | undefined {
  if (!isPlainObject(raw)) return undefined;
  const manifest = isPlainObject(raw.manifest) ? raw.manifest : undefined;
  const source = isPlainObject(raw.repo) ? raw.repo : undefined;
  if (!manifest || !source) return undefined;

  // The install source has to be exactly `owner/repo`: anything carrying a ref
  // or a subpath would install something other than what the index describes.
  const owner = isPlainObject(source.owner) ? str(source.owner.login) : undefined;
  const repoName = str(source.name);
  if (owner === undefined || repoName === undefined) return undefined;
  const repo = `${owner}/${repoName}`;
  const parsed = parseGitHubSource(repo);
  if (!parsed || parsed.repo !== repo || parsed.ref || parsed.subpath) return undefined;

  const name = str(manifest.name);
  if (name === undefined || pluginNameError(name)) return undefined;

  const entry: MarketplaceEntry = {
    repo,
    repoUrl: repoUrl(source.url, repo),
    name,
    // A plugin with no description of its own falls back to the repository's,
    // which is what a reader would otherwise have to open GitHub to see.
    description: str(manifest.description) ?? str(source.description) ?? "",
    official: raw.official === true,
    skills: parseSkills(raw.skills, name),
  };

  for (const key of ["version", "homepage"] as const) {
    const value = str(manifest[key]);
    if (value !== undefined) entry[key] = value;
  }
  const author = isPlainObject(manifest.author) ? str(manifest.author.name) : undefined;
  if (author !== undefined) entry.author = author;
  if (Array.isArray(manifest.keywords)) {
    const keywords = manifest.keywords.filter((keyword): keyword is string => typeof keyword === "string");
    if (keywords.length > 0) entry.keywords = keywords;
  }
  const minAppVersion = str(manifest.minAppVersion);
  if (minAppVersion !== undefined) {
    entry.minAppVersion = minAppVersion;
    if (!checkMinAppVersion(minAppVersion, appVersion)) entry.appTooOld = true;
  }
  return entry;
}

/** Every listable plugin in an index document, or undefined when the document
 *  isn't an index we understand. */
export function parseMarketplaceIndex(raw: unknown, appVersion: string): MarketplaceEntry[] | undefined {
  if (!isPlainObject(raw)) return undefined;
  if (raw.schemaVersion !== SCHEMA_VERSION) return undefined;
  if (!Array.isArray(raw.plugins)) return undefined;

  const entries: MarketplaceEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw.plugins) {
    const entry = parseEntry(item, appVersion);
    if (!entry) continue;
    const key = entry.repo.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return entries;
}

/** The last index we managed to read, kept in memory only: it costs one
 *  request to rebuild, and a stale list across restarts would be worse than no
 *  list. */
let cache: { plugins: MarketplaceEntry[]; fetchedAt: number } | null = null;
/** The request in flight, so a double-clicked Refresh (or two mounts) is one
 *  download. */
let inflight: Promise<MarketplaceResult> | null = null;

function fail(kind: MarketplaceLoadFailKind, message: string): MarketplaceResult {
  // Analytics carry the kind only: the messages name URLs.
  trackMarketplaceLoadFailed(kind);
  return { type: "error", message };
}

/** Read the index over HTTP, or off disk for a `file:` override (Node's fetch
 *  refuses that scheme, and a fixture file is the simplest way to drive the
 *  section in dev). */
async function readIndex(url: string): Promise<{ ok: true; raw: unknown } | { ok: false; result: MarketplaceResult }> {
  const text = url.startsWith("file:") ? readFileSync(fileURLToPath(url), "utf8") : await get(url);
  if (typeof text !== "string") return text;
  try {
    return { ok: true, raw: JSON.parse(text) };
  } catch {
    // The bytes arrived, they just aren't an index: a captive portal's login
    // page, a CDN error page, a truncated file. Telling the user to check a
    // connection that plainly works would send them after the wrong thing.
    return { ok: false, result: unreadable() };
  }
}

/** The response body, or the failure to report instead. */
async function get(url: string): Promise<string | { ok: false; result: MarketplaceResult }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "accountant24" },
    signal: AbortSignal.timeout(MARKETPLACE_TIMEOUT_MS),
  });
  if (!res.ok) {
    return { ok: false, result: fail("fetch_failed", `The plugin marketplace returned ${res.status}.`) };
  }
  return await res.text();
}

const unreadable = () => fail("invalid_index", "The plugin marketplace sent something this version can't read.");

async function download(): Promise<MarketplaceResult> {
  let raw: unknown;
  try {
    const read = await readIndex(marketplaceUrl());
    if (!read.ok) return read.result;
    raw = read.raw;
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return timedOut
      ? fail("timeout", "The plugin marketplace took too long to respond. Check your connection and try again.")
      : fail("fetch_failed", "Couldn't reach the plugin marketplace. Check your connection and try again.");
  }

  const plugins = parseMarketplaceIndex(raw, app.getVersion());
  if (!plugins) return unreadable();

  cache = { plugins, fetchedAt: Date.now() };
  return { type: "ok", plugins, fetchedAt: new Date(cache.fetchedAt).toISOString() };
}

/** The marketplace index: cached, deduped, and re-downloaded on demand. A
 *  failed download leaves the cache alone, so the section keeps showing the
 *  last good list next to the error. */
export async function fetchMarketplace(req: MarketplaceRequest = {}): Promise<MarketplaceResult> {
  if (!req.force && cache && Date.now() - cache.fetchedAt < MARKETPLACE_TTL_MS) {
    return { type: "ok", plugins: cache.plugins, fetchedAt: new Date(cache.fetchedAt).toISOString() };
  }
  if (inflight) return inflight;
  inflight = download().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Register the marketplace IPC handler. */
export function registerMarketplaceIpc(): void {
  ipcMain.handle("plugins_marketplace", (_e, req?: MarketplaceRequest) => fetchMarketplace(req ?? {}));
}

/** Test seam: forget the downloaded index so cases can't leak into each other. */
export function resetMarketplaceCache(): void {
  cache = null;
  inflight = null;
}
