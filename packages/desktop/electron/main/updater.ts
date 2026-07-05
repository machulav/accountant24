// Fully silent auto-update: check on launch + every few hours, download in the
// background, install on next quit (Squirrel.Mac). No UI, no IPC. Stable
// channel only — rc builds and dev runs never self-update. The feed config
// (GitHub owner/repo) comes from the app-update.yml electron-builder embeds in
// the packaged app; the repo is public, so no token is needed at runtime.

import { app } from "electron";
import electronUpdater from "electron-updater"; // CJS package: default-import, then destructure

const { autoUpdater } = electronUpdater;

const STARTUP_DELAY_MS = 30_000; // don't compete with launch work (agent spawn, window)
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Updates run only in packaged stable builds. rc versions (0.3.0-rc.1) must
 *  not self-update — a newer stable would otherwise be offered to them even
 *  with allowPrerelease=false. */
export function shouldAutoUpdate(isPackaged: boolean, version: string): boolean {
  return isPackaged && !version.includes("-");
}

export function initAutoUpdater(): void {
  if (!shouldAutoUpdate(app.isPackaged, app.getVersion())) return;

  autoUpdater.logger = null;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false; // default; explicit for the reader

  // An "error" handler is mandatory (unhandled EventEmitter errors throw);
  // network failures are routine — log and wait for the next cycle.
  autoUpdater.on("error", (err) => console.error(`[updater] ${err.message}`));
  autoUpdater.on("update-downloaded", (info) => {
    console.log(`[updater] ${info.version} downloaded; installs on next quit`);
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      console.error(`[updater] check failed: ${err.message}`);
    });
  };
  setTimeout(check, STARTUP_DELAY_MS);
  setInterval(check, CHECK_INTERVAL_MS);
}
