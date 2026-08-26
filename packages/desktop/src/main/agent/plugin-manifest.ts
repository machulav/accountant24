// The plugin.json manifest — the Agent Plugins standard (agent-plugins.org),
// which packages Agent Skills (and, later, MCP servers) into one portable
// folder. Parsing is deliberately strict: the schema is closed (an unknown
// top-level key is an error, not a silent no-op) so a typo surfaces at install
// time instead of quietly dropping a capability.
//
// No Electron imports — the app version is passed in, never read from `app`,
// so every rule here stays unit-testable.

/** Author block; every field optional per the spec. */
export interface PluginAuthor {
  name?: string;
  email?: string;
  url?: string;
}

/** A validated plugin.json. Mirrors the spec's metadata fields, plus the one
 *  value we read out of our own `extensions` namespace. */
export interface PluginManifest {
  name: string;
  version?: string;
  description?: string;
  author?: PluginAuthor;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  /** `extensions["ai.accountant24"].minAppVersion` — the oldest app version
   *  that can run this plugin. */
  minAppVersion?: string;
}

export type ParsedManifest = { ok: true; manifest: PluginManifest } | { ok: false; error: string };

/** Our reverse-domain namespace inside the spec's `extensions` block. Other
 *  clients ignore it, and we ignore theirs. */
export const A24_NAMESPACE = "ai.accountant24";

const MAX_NAME_LENGTH = 64;

// Top-level keys the spec defines. Anything else fails the parse (closed schema).
const KNOWN_KEYS = new Set([
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
]);

/** Plugin names are lowercase alphanumerics and hyphens, with hyphens only in
 *  the middle. This is a deliberate subset of the spec's charset: periods are
 *  rejected so a plugin name is always a safe folder name and reads cleanly on
 *  the left of a `<plugin>:<skill>` id. Returns the reason it is invalid, or
 *  undefined when the name is fine. */
export function pluginNameError(name: string): string | undefined {
  if (name.length === 0) return "plugin.json: name is empty.";
  if (name.length > MAX_NAME_LENGTH) return `plugin.json: name exceeds ${MAX_NAME_LENGTH} characters.`;
  if (!/^[a-z0-9-]+$/.test(name)) {
    return "plugin.json: name may only contain lowercase letters, numbers, and hyphens.";
  }
  if (name.startsWith("-") || name.endsWith("-")) return "plugin.json: name may not start or end with a hyphen.";
  if (name.includes("--")) return "plugin.json: name may not contain consecutive hyphens.";
  return undefined;
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)/;

/** major/minor/patch of a version string, ignoring any prerelease suffix
 *  (release candidates are `0.3.0-rc.1`). Undefined when unparseable. */
function parseVersion(version: string): [number, number, number] | undefined {
  const match = VERSION_RE.exec(version.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Whether an app version satisfies a plugin's `minAppVersion`. An app version
 *  we can't parse never blocks an install — the plugin's own requirement is
 *  validated at parse time, so the only unparseable side here is a build whose
 *  version string we don't control. */
export function checkMinAppVersion(min: string, appVersion: string): boolean {
  const required = parseVersion(min);
  const actual = parseVersion(appVersion);
  if (!required || !actual) return true;
  for (let i = 0; i < 3; i++) {
    if (actual[i] > required[i]) return true;
    if (actual[i] < required[i]) return false;
  }
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read `extensions["ai.accountant24"].minAppVersion`. Other namespaces are
 *  ignored wholesale, per the spec — a client must not validate a namespace it
 *  does not implement. */
function readMinAppVersion(extensions: unknown): { ok: true; value?: string } | { ok: false; error: string } {
  if (extensions === undefined) return { ok: true };
  if (!isPlainObject(extensions)) return { ok: false, error: "plugin.json: extensions must be an object." };
  const ours = extensions[A24_NAMESPACE];
  if (ours === undefined) return { ok: true };
  if (!isPlainObject(ours))
    return { ok: false, error: `plugin.json: extensions["${A24_NAMESPACE}"] must be an object.` };
  const min = ours.minAppVersion;
  if (min === undefined) return { ok: true };
  if (typeof min !== "string" || !VERSION_RE.test(min.trim())) {
    return { ok: false, error: "plugin.json: minAppVersion must be a version like 1.2.3." };
  }
  return { ok: true, value: min.trim() };
}

function optionalString(raw: Record<string, unknown>, key: string): { ok: true; value?: string } | { ok: false } {
  const value = raw[key];
  if (value === undefined) return { ok: true };
  if (typeof value !== "string") return { ok: false };
  return { ok: true, value };
}

/** Parse and validate the contents of a plugin.json. */
export function parsePluginManifest(text: string): ParsedManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "plugin.json is not valid JSON." };
  }
  if (!isPlainObject(raw)) return { ok: false, error: "plugin.json must contain a JSON object." };

  const unknown = Object.keys(raw).filter((key) => !KNOWN_KEYS.has(key));
  if (unknown.length > 0) return { ok: false, error: `plugin.json: unknown field ${unknown.sort().join(", ")}.` };

  if (typeof raw.name !== "string") return { ok: false, error: "plugin.json: name is required." };
  const nameError = pluginNameError(raw.name);
  if (nameError) return { ok: false, error: nameError };

  // The format requires $schema (any version); the marketplace refuses to
  // list a manifest without it, so requiring it here keeps a plugin that
  // installs by hand publishable as it is.
  if (typeof raw.$schema !== "string") return { ok: false, error: "plugin.json: $schema is required." };

  const manifest: PluginManifest = { name: raw.name };

  for (const key of ["version", "description", "homepage", "repository", "license"] as const) {
    const parsed = optionalString(raw, key);
    if (!parsed.ok) return { ok: false, error: `plugin.json: ${key} must be a string.` };
    if (parsed.value !== undefined) manifest[key] = parsed.value;
  }

  if (raw.author !== undefined) {
    if (!isPlainObject(raw.author)) return { ok: false, error: "plugin.json: author must be an object." };
    const author: PluginAuthor = {};
    for (const key of ["name", "email", "url"] as const) {
      const parsed = optionalString(raw.author, key);
      if (!parsed.ok) return { ok: false, error: `plugin.json: author.${key} must be a string.` };
      if (parsed.value !== undefined) author[key] = parsed.value;
    }
    manifest.author = author;
  }

  if (raw.keywords !== undefined) {
    if (!Array.isArray(raw.keywords) || raw.keywords.some((k) => typeof k !== "string")) {
      return { ok: false, error: "plugin.json: keywords must be an array of strings." };
    }
    manifest.keywords = raw.keywords as string[];
  }

  const min = readMinAppVersion(raw.extensions);
  if (!min.ok) return { ok: false, error: min.error };
  if (min.value !== undefined) manifest.minAppVersion = min.value;

  return { ok: true, manifest };
}
