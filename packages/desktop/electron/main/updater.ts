// Fully silent auto-update: check on launch + every few hours, download in the
// background, install on next quit (Squirrel.Mac). No UI, no IPC. Stable
// channel only — rc builds and dev runs never self-update. The feed config
// (GitHub owner/repo) comes from the app-update.yml electron-builder embeds in
// the packaged app; the repo is public, so no token is needed at runtime.

import { app } from "electron";
import electronUpdater from "electron-updater"; // CJS package: default-import, then destructure
import { trackUpdateDownloaded, trackUpdateError } from "./analytics";

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
      trackUpdateError(kind);
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    downloading = false;
    console.log(`[updater] ${info.version} downloaded; installs on next quit`);
    trackUpdateDownloaded(info.version);
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      console.error(`[updater] check failed: ${err.message}`);
    });
  };
  setTimeout(check, STARTUP_DELAY_MS);
  setInterval(check, CHECK_INTERVAL_MS);
}
