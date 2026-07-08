// Electron main entry. Owns the window + the pi agent child + the in-process
// auth/sessions, all exposed to the renderer over IPC. Replaces src-tauri.

import { join } from "node:path";
import { app, BrowserWindow, ipcMain, nativeImage } from "electron";
import { killAgent, registerAgentIpc } from "./agent";
import { initAnalytics, registerAnalyticsIpc, trackAnalyticsToggle, trackLaunch, trackQuit } from "./analytics";
import { registerFilesIpc } from "./files";
import { registerLedgerIpc } from "./ledger";
import { registerPiIpc } from "./pi";
import { registerSettingsIpc } from "./settings";
import { initAutoUpdater } from "./updater";
import { createWindow } from "./window";

// Dev only: expose a local CDP endpoint so tooling (visual-measurement and
// driver scripts) can attach to the RUNNING dev app instead of launching a
// second instance. Must be set before the app is ready; packaged builds never
// get it.
if (!app.isPackaged && !app.commandLine.hasSwitch("remote-debugging-port")) {
  app.commandLine.appendSwitch("remote-debugging-port", "9223");
}

let mainWindow: BrowserWindow | null = null;
const getWin = (): BrowserWindow | null => mainWindow;

// Anonymous usage analytics; the SDK emits nothing until trackLaunch() runs.
initAnalytics();

app.whenReady().then(() => {
  // Dev only: packaged builds get the icon from build/icon.icns, but
  // `electron-vite dev` runs the stock Electron binary with its default icon.
  // The red "dev" badge marks the dev instance so it can't be confused with
  // an installed build running side by side.
  if (!app.isPackaged && process.platform === "darwin") {
    const icon = nativeImage.createFromPath(join(app.getAppPath(), "build/icon.png"));
    if (!icon.isEmpty()) app.dock?.setIcon(icon);
    app.dock?.setBadge("dev");
  }

  // App-global IPC handlers (registered once); sends go to the current window.
  // Version comes from the packaged app metadata (CI injects the release
  // version via extraMetadata), so it can't be read at renderer build time.
  ipcMain.handle("app_version", () => app.getVersion());
  registerAgentIpc(getWin);
  registerPiIpc(getWin);
  registerSettingsIpc({ onAnalyticsToggled: trackAnalyticsToggle });
  registerFilesIpc();
  registerLedgerIpc();
  registerAnalyticsIpc();

  // Count this launch (and a one-time install), respecting the opt-out.
  trackLaunch();

  // Silent auto-update (packaged stable builds only; no-op in dev and rc).
  initAutoUpdater();

  mainWindow = createWindow();
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("window-all-closed", () => {
  killAgent();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  trackQuit();
  killAgent();
});
