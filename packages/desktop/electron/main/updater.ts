// Auto-update: check on launch + every few hours, download in the background,
// install on next quit (Squirrel.Mac). Once a build is downloaded and staged we
// surface a "Relaunch to update" banner in the sidebar (via IPC) so the user can
// apply it immediately instead of waiting for the next quit. Stable channel
// only — rc builds and dev runs never self-update. The feed config (GitHub
// owner/repo) comes from the app-update.yml electron-builder embeds in the
// packaged app; the repo is public, so no token is needed at runtime.

import { app, type BrowserWindow, ipcMain } from "electron";
import electronUpdater from "electron-updater"; // CJS package: default-import, then destructure
import { trackUpdateDownloaded, trackUpdateFailed, trackUpdateInstallClicked } from "./analytics";

const { autoUpdater } = electronUpdater;

const STARTUP_DELAY_MS = 30_000; // don't compete with launch work (agent spawn, window)
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

// Version of a downloaded-and-staged update, or null if none is pending. The
// renderer reads this on mount (the "update-downloaded" push may have fired
// before it subscribed) to decide whether to show the relaunch banner.
let downloadedVersion: string | null = null;

/** Updates run only in packaged stable builds. rc versions (0.3.0-rc.1) must
 *  not self-update — a newer stable would otherwise be offered to them even
 *  with allowPrerelease=false. */
export function shouldAutoUpdate(isPackaged: boolean, version: string): boolean {
  return isPackaged && !version.includes("-");
}

export function initAutoUpdater(getWin: () => BrowserWindow | null): void {
  // Renderer-facing IPC is registered unconditionally so the banner's mount-time
  // state query and "Relaunch" button always resolve — in dev they simply report
  // "no update pending" and no-op.
  ipcMain.handle("update_pending", () => downloadedVersion);
  ipcMain.handle("update_install", () => {
    if (!downloadedVersion) return;
    if (app.isPackaged) {
      // Log the real user action, then quit, swap in the staged update, and
      // relaunch now. autoInstallOnAppQuit already applies it on a normal quit;
      // this just does it on demand. (Dev preview below is a testing artifact,
      // so it's not tracked.)
      trackUpdateInstallClicked(downloadedVersion);
      autoUpdater.quitAndInstall();
    } else {
      // Dev preview: no real update to install (Squirrel would throw), so just
      // relaunch to mimic the button's real behavior.
      app.relaunch();
      app.quit();
    }
  });

  // Dev-only preview: `A24_FAKE_UPDATE=9.9.9 npm run dev` stages a fake update so
  // the "Relaunch to update" banner shows without cutting a release. Seed the
  // state (so a mount-time query catches it) and push the event once the window
  // exists (so the live path is exercised too). Clicking Relaunch no-ops in dev.
  if (!app.isPackaged && process.env.A24_FAKE_UPDATE) {
    downloadedVersion = process.env.A24_FAKE_UPDATE;
    setTimeout(() => getWin()?.webContents.send("update-downloaded", downloadedVersion), 2_000);
  }

  if (!shouldAutoUpdate(app.isPackaged, app.getVersion())) return;

  autoUpdater.logger = null;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false; // default; explicit for the reader

  // Errors are classified by phase: once update-available fires we're
  // downloading — a failure there points at a broken release, while check
  // failures are mostly offline noise. Both deduped to one event per kind per
  // session so a laptop without network doesn't emit one per 4h cycle.
  let downloading = false;
  const errorTracked = { check: false, download: false };

  autoUpdater.on("update-available", () => {
    downloading = true;
  });

  // An "error" handler is mandatory (unhandled EventEmitter errors throw);
  // network failures are routine — log and wait for the next cycle.
  autoUpdater.on("error", (err) => {
    console.error(`[updater] ${err.message}`);
    const kind = downloading ? "download" : "check";
    downloading = false;
    if (!errorTracked[kind]) {
      errorTracked[kind] = true;
      trackUpdateFailed(kind);
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    downloading = false;
    downloadedVersion = info.version;
    console.log(`[updater] ${info.version} downloaded; installs on next quit`);
    trackUpdateDownloaded(info.version);
    // Offer an immediate relaunch via the sidebar banner.
    getWin()?.webContents.send("update-downloaded", info.version);
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      console.error(`[updater] check failed: ${err.message}`);
    });
  };
  setTimeout(check, STARTUP_DELAY_MS);
  setInterval(check, CHECK_INTERVAL_MS);
}
