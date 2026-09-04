// Electron main entry. Owns the window + the pi agent child + the in-process
// auth/sessions, all exposed to the renderer over IPC. Replaces src-tauri.

import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, nativeImage } from "electron";
import { registerMarketplaceIpc } from "./agent/marketplace";
import { registerPluginsIpc } from "./agent/plugins";
import { installDefaultPlugins } from "./agent/plugins-defaults";
import { startPluginsWatcher } from "./agent/plugins-watch";
import { killAllAgents, registerAgentIpc } from "./agent/router";
import { registerSessionsIpc } from "./agent/sessions";
import { initAnalytics, registerAnalyticsIpc, trackLaunch, trackQuit } from "./analytics";
import { applyWorkspaceFlag } from "./cli";
import { workspaceDir } from "./env";
import { registerFilesIpc } from "./files";
import { registerLedgerIpc } from "./ledger";
import { registerAuthIpc } from "./llm-providers/auth";
import { registerOauthIpc } from "./llm-providers/oauth";
import { registerOllamaIpc } from "./llm-providers/ollama";
import { runPendingMigrations } from "./migrations";
import { registerSettingsIpc } from "./settings";
import { initAutoUpdater } from "./updater";
import { createWindow } from "./window";
import { ensureWorkspace, registerWorkspaceIpc } from "./workspace";

// Dev only: expose a local CDP endpoint so tooling (visual-measurement and
// driver scripts) can attach to the RUNNING dev app instead of launching a
// second instance. Must be set before the app is ready; packaged builds never
// get it.
if (!app.isPackaged && !app.commandLine.hasSwitch("remote-debugging-port")) {
  app.commandLine.appendSwitch("remote-debugging-port", "9223");
}

/** Refuse to start: a native error box (safe before `ready`, modal) and a
 *  non-zero exit. Used when continuing could open or create the wrong
 *  workspace. app.exit() tears the process down asynchronously, so the
 *  startup path below also checks `startupFailed` and stops. */
let startupFailed = false;
function failStartup(message: string): void {
  startupFailed = true;
  console.error(`[workspace] ${message}`);
  dialog.showErrorBox("Accountant24 can't start", message);
  app.exit(1);
}

// Pin the workspace for this launch before anything reads it: `--workspace`
// beats ACCOUNTANT24_WORKSPACE beats ~/.accountant24 (see cli.ts). A malformed
// flag is fatal rather than a silent fallback to another folder.
try {
  const source = applyWorkspaceFlag(process.argv);
  console.log(`[workspace] using ${workspaceDir()} (${source})`);
} catch (err) {
  failStartup(err instanceof Error ? err.message : String(err));
}

let mainWindow: BrowserWindow | null = null;
const getWin = (): BrowserWindow | null => mainWindow;

// Anonymous usage analytics; the SDK emits nothing until trackLaunch() runs.
initAnalytics();

app.whenReady().then(async () => {
  if (startupFailed) return;

  // Bring an existing workspace up to date first (e.g. move a pre-0.3
  // ~/Accountant24 into place). A failed migration is fatal: scaffolding a
  // fresh workspace next to un-migrated data would hide the user's ledger.
  try {
    await runPendingMigrations();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failStartup(`Updating the workspace failed:\n\n${msg}\n\nWorkspace: ${workspaceDir()}`);
    return;
  }

  // Seed the workspace (dirs, starter journals, git repo) before anything can
  // read or write it — the ledger views and settings must not race a fresh
  // install, and the workspace is the agent's cwd. A failure here (an
  // unwritable home) must not cost the user their window: log it and open
  // anyway, with the empty states and errors that follow from it.
  try {
    await ensureWorkspace();
  } catch (err) {
    console.error("[workspace] setup failed:", err);
  }

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
  registerAuthIpc();
  registerOauthIpc(getWin);
  registerOllamaIpc();
  registerSessionsIpc();
  registerPluginsIpc(getWin);
  registerMarketplaceIpc();
  registerSettingsIpc();
  registerFilesIpc();
  registerLedgerIpc();
  registerAnalyticsIpc();
  registerWorkspaceIpc();

  // Pick up plugins written into the workspace behind the app's back (by the
  // agent, or by hand) without a restart.
  startPluginsWatcher(getWin);

  // The plugins a new workspace starts with are downloaded from their own
  // repositories, like any other. Not awaited: startup never waits on the
  // network, and a launch that can't reach it just tries again next time.
  void installDefaultPlugins(getWin);

  // Count this launch (and a one-time install), respecting the opt-out.
  trackLaunch();

  // Auto-update (packaged stable builds only; no-op in dev and rc). Surfaces a
  // "Update available" banner in the sidebar once a build is staged.
  initAutoUpdater(getWin);

  mainWindow = createWindow();
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("window-all-closed", () => {
  killAllAgents();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  trackQuit();
  killAllAgents();
});
