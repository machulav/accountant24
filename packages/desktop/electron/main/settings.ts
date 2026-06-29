// App settings — the app's OWN config, the single source of truth the Settings
// UI reads/writes. Stored as ~/Accountant24/app-settings.json.
//
// It must NOT share pi's settings.json: pi reads/writes its own settings.json in
// the same workspace (PI_CODING_AGENT_DIR), so sharing the file mixed pi's keys
// (e.g. defaultProvider) into ours and risked clobbering. We keep a separate file
// and only ever persist our own keys.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ipcMain } from "electron";
import { workspaceDir } from "./env";

/** The app settings schema (app-owned keys, distinct from pi's). */
export interface AppSettings {
  /** Model new chats start with, as a `provider/modelId` id. Applied via the set_model RPC. */
  defaultModel?: string;
  /** `provider/modelId` ids the user can pick from in chat. Empty/absent = all enabled. */
  enabledModels?: string[];
}

function appSettingsPath(): string {
  return join(workspaceDir(), "app-settings.json");
}

/** pi's settings file, which earlier versions of the app shared. */
function legacyPath(): string {
  return join(workspaceDir(), "settings.json");
}

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
  return out;
}

/** One-time move of app keys out of the shared settings.json into app-settings.json,
 *  leaving pi's own keys behind in settings.json. Best-effort. */
function migrateFromLegacy(): AppSettings {
  const legacy = parseFile(legacyPath());
  if (!legacy) return {};
  const app = pickAppKeys(legacy);
  try {
    mkdirSync(workspaceDir(), { recursive: true });
    writeFileSync(appSettingsPath(), `${JSON.stringify(app, null, 2)}\n`);
    // Strip our keys from pi's file so it's no longer a mix of both.
    const cleaned = { ...legacy };
    delete cleaned.defaultModel;
    delete cleaned.enabledModels;
    if (Object.keys(cleaned).length > 0) writeFileSync(legacyPath(), `${JSON.stringify(cleaned, null, 2)}\n`);
  } catch {
    // Best-effort; the in-memory `app` is still correct for this session.
  }
  return app;
}

function readSettings(): AppSettings {
  const own = parseFile(appSettingsPath());
  if (own) return pickAppKeys(own);
  return migrateFromLegacy();
}

/** Merge-patch the settings file and return the merged result. */
function writeSettings(patch: Partial<AppSettings>): AppSettings {
  const merged: AppSettings = { ...readSettings(), ...patch };
  // The workspace normally exists (the agent scaffolds it), but a save can race
  // a fresh install — create it so the write can't fail with ENOENT.
  mkdirSync(workspaceDir(), { recursive: true });
  writeFileSync(appSettingsPath(), `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

/** Register settings IPC handlers. */
export function registerSettingsIpc(): void {
  ipcMain.handle("settings_get", () => readSettings());
  ipcMain.handle("settings_set", (_e, patch: Partial<AppSettings>) => writeSettings(patch));
}
