// Watches the workspace plugins folder so a plugin written behind the app's
// back — by the agent (create-plugin skill) or by the user dropping a folder
// in — goes live without an app restart: the open plugin lists refresh right
// away, and the agent host is recycled once idle so the next message runs
// with the current skill set. The marketplace paths fire the same pipeline
// themselves; the install lock keeps this watcher quiet while they copy files.

import { type FSWatcher, watch as fsWatch, mkdirSync } from "node:fs";
import { app, type BrowserWindow } from "electron";
import { pluginsDir } from "../env";
import { withInstallLock } from "./plugins";
import { recycleAgentsWhenIdle } from "./router";

// A change arrives as a burst (a folder copy is one event per file); act only
// once it has settled, so a half-copied plugin is never announced.
const DEBOUNCE_MS = 1000;

/** Injectable I/O, so tests drive the logic without a real recursive watch
 *  (unavailable on the Linux CI runners; the shipped app is macOS-only). */
interface PluginsWatcherDeps {
  watch?: typeof fsWatch;
  debounceMs?: number;
}

let watcher: FSWatcher | null = null;
let timer: NodeJS.Timeout | undefined;

export function startPluginsWatcher(getWin: () => BrowserWindow | null, deps: PluginsWatcherDeps = {}): void {
  const { watch = fsWatch, debounceMs = DEBOUNCE_MS } = deps;
  const fire = () => {
    // The try-lock skips this while an install is copying files — that path
    // notifies for itself. The event goes out even when the recycle has to
    // wait for a run to end, so open lists show the plugin immediately.
    void withInstallLock(async () => {
      const win = getWin();
      if (win && !win.isDestroyed()) win.webContents.send("plugins-event", { type: "changed" });
      recycleAgentsWhenIdle();
    });
  };
  const dir = pluginsDir();
  try {
    // The folder is otherwise created on the first install; having it from
    // launch also gives hand-dropped plugins a place to land.
    mkdirSync(dir, { recursive: true });
    watcher = watch(dir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(fire, debounceMs);
      timer.unref?.();
    });
  } catch (error) {
    // Hot reload is a convenience — never let it break startup.
    console.warn(`[plugins] watcher failed to start: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  watcher.on("error", (error: Error) => {
    console.warn(`[plugins] watcher stopped: ${error.message}`);
  });
  app.on("will-quit", () => stopPluginsWatcher());
}

/** Close the watcher and drop any pending fire (quit, and a test seam). */
export function stopPluginsWatcher(): void {
  clearTimeout(timer);
  timer = undefined;
  watcher?.close();
  watcher = null;
}
