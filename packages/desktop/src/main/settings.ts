// App settings — the app's OWN config, the single source of truth the Settings
// UI reads/writes. Stored as <workspace>/app-settings.json.
//
// It must NOT share pi's settings.json: pi reads/writes its own settings.json in
// the same workspace (PI_CODING_AGENT_DIR), so sharing the file would mix pi's
// keys (e.g. defaultProvider) into ours and risk clobbering. We keep a separate
// file and only ever persist our own keys.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ipcMain } from "electron";
import type { AppSettings, PluginRegistry, PluginRegistryEntry } from "../shared/types";
import { appSettingsPath, workspaceDir } from "./env";

function parseFile(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Keep only the keys this app owns — ignores anything pi (or a hand-edit) added. */
function pickAppKeys(raw: Record<string, unknown>): AppSettings {
  const out: AppSettings = {};
  const dm = raw.defaultModel;
  if (typeof dm === "string" && dm.includes("/")) {
    out.defaultModel = dm;
  } else if (dm && typeof dm === "object" && "provider" in dm && "modelId" in dm) {
    // Legacy object form ({ provider, modelId }) — fold it into the id string.
    out.defaultModel = `${String((dm as { provider: unknown }).provider)}/${String((dm as { modelId: unknown }).modelId)}`;
  }
  if (Array.isArray(raw.enabledModels)) {
    out.enabledModels = (raw.enabledModels as unknown[]).filter((x): x is string => typeof x === "string");
  }
  if (typeof raw.analyticsEnabled === "boolean") out.analyticsEnabled = raw.analyticsEnabled;
  if (Array.isArray(raw.onceEvents)) {
    out.onceEvents = (raw.onceEvents as unknown[]).filter((x): x is string => typeof x === "string");
  }
  const plugins = pickPluginRegistry(raw.plugins);
  if (plugins) out.plugins = plugins;
  if (Array.isArray(raw.defaultPluginsInstalled)) {
    out.defaultPluginsInstalled = (raw.defaultPluginsInstalled as unknown[]).filter(
      (x): x is string => typeof x === "string",
    );
  }
  return out;
}

/** Keep only well-formed plugin entries: the record is provenance, so an entry
 *  that is not an object is dropped and the rest are kept. */
function pickPluginRegistry(raw: unknown): PluginRegistry | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: PluginRegistry = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const kept: PluginRegistryEntry = {};
    for (const key of ["source", "commit", "addedAt"] as const) {
      if (typeof entry[key] === "string") kept[key] = entry[key] as string;
    }
    out[name] = kept;
  }
  return out;
}

function readSettings(): AppSettings {
  const own = parseFile(appSettingsPath());
  return own ? pickAppKeys(own) : {};
}

/** Merge-patch the settings file and return the merged result. */
function writeSettings(patch: Partial<AppSettings>): AppSettings {
  const merged: AppSettings = { ...readSettings(), ...patch };
  // The workspace normally exists (seeded at launch by workspace.ts) — create it
  // anyway so a save into a deleted workspace can't fail with ENOENT.
  mkdirSync(workspaceDir(), { recursive: true });
  writeFileSync(appSettingsPath(), `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

/** Register settings IPC handlers. */
export function registerSettingsIpc(): void {
  ipcMain.handle("settings_get", () => readSettings());
  ipcMain.handle("settings_set", (_e, patch: Partial<AppSettings>) => writeSettings(patch));
}

/** Whether anonymous usage analytics are enabled (default on, opt-out). */
export function isAnalyticsEnabled(): boolean {
  return readSettings().analyticsEnabled ?? true;
}

/** Which installed plugins are approved, keyed by plugin name. */
export function readPluginRegistry(): PluginRegistry {
  return readSettings().plugins ?? {};
}

/** Replace the plugin registry wholesale — plugin operations always compute the
 *  full map, and a merge would resurrect entries a removal just dropped. */
export function writePluginRegistry(plugins: PluginRegistry): void {
  writeSettings({ plugins });
}

/** The default plugins this install has already been given, as repository
 *  slugs. A slug here is never installed again, which is what makes an
 *  uninstall stick. */
export function readDefaultPluginsInstalled(): string[] {
  return readSettings().defaultPluginsInstalled ?? [];
}

/** Replace the list wholesale, for the same reason as the registry. */
export function writeDefaultPluginsInstalled(repos: string[]): void {
  writeSettings({ defaultPluginsInstalled: repos });
}

/** Returns true exactly once per key and persists the consumed key, so one-time
 *  analytics milestones (install, first message, first transaction, …) can't
 *  repeat. */
export function consumeOnce(key: string): boolean {
  const done = readSettings().onceEvents ?? [];
  if (done.includes(key)) return false;
  writeSettings({ onceEvents: [...done, key] });
  return true;
}
