// App settings IPC — the Settings UI's read/write surface.
//
// The file format and migration live in app-settings.ts (Electron-free, shared
// with the ACP entrypoint); this module only binds them to the workspace paths
// and to ipcMain.

import { ipcMain } from "electron";
import type { AppSettings } from "../shared/types";
import { readAppSettings, type SettingsPaths, writeAppSettings } from "./app-settings";
import { appSettingsPath, legacySettingsPath, workspaceDir } from "./env";

const paths = (): SettingsPaths => ({
  appSettingsPath: appSettingsPath(),
  legacySettingsPath: legacySettingsPath(),
  workspaceDir: workspaceDir(),
});

const readSettings = (): AppSettings => readAppSettings(paths());
const writeSettings = (patch: Partial<AppSettings>): AppSettings => writeAppSettings(paths(), patch);

/** Register settings IPC handlers.
 *  @param opts.onAnalyticsToggled called when `analyticsEnabled` actually flips,
 *    with the new value — lets the caller record the opt-in/opt-out. */
export function registerSettingsIpc(opts?: { onAnalyticsToggled?: (enabled: boolean) => void }): void {
  ipcMain.handle("settings_get", () => readSettings());
  ipcMain.handle("settings_set", (_e, patch: Partial<AppSettings>) => {
    const before = readSettings().analyticsEnabled ?? true;
    const merged = writeSettings(patch);
    const after = merged.analyticsEnabled ?? true;
    if (after !== before) opts?.onAnalyticsToggled?.(after);
    return merged;
  });
}

/** Whether anonymous usage analytics are enabled (default on, opt-out). */
export function isAnalyticsEnabled(): boolean {
  return readSettings().analyticsEnabled ?? true;
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
