import path from "node:path";
import { app, BrowserWindow, screen, shell } from "electron";
import { isInternalNavigation, isOpenableExternalUrl, rendererCsp } from "./urls";
import { loadWindowState, MIN_HEIGHT, MIN_WIDTH, restoreWindowState, trackWindowState } from "./window-state";

// Device-local UI state, so it lives in Electron's per-app userData dir,
// not in the (portable) Accountant24 workspace.
const windowStateFile = () => path.join(app.getPath("userData"), "window-state.json");

/** Create the single app window. macOS chrome mirrors the old Tauri config:
 *  inset traffic lights, no native title bar; the renderer paints the top strip.
 *  Size/placement policy lives in window-state.ts: first launch large and
 *  centered on the active display, afterwards wherever the user left it. */
export function createWindow(): BrowserWindow {
  // The display the user is working on (cursor), not necessarily the primary.
  const active = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const workAreas = screen.getAllDisplays().map((d) => d.workArea);
  const state = restoreWindowState(loadWindowState(windowStateFile()), workAreas, active);

  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      // ESM preload (electron-vite emits index.mjs under "type":"module"); ESM
      // preload requires sandbox:false (set below).
      preload: path.join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => {
    // Maximize only here: on a still-hidden window it can force an early show.
    if (state.maximized) win.maximize();
    win.show();
  });
  trackWindowState(win, windowStateFile());

  // Links (target=_blank / window.open) never open as app windows. Only
  // http/https/mailto reach the system browser; every other scheme (file:,
  // javascript:, custom app schemes, …) is refused, so a link in untrusted
  // agent/markdown output can't make the OS launch a local handler.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOpenableExternalUrl(url)) void shell.openExternal(url).catch(() => undefined);
    return { action: "deny" };
  });

  // The app frame must never navigate off its own origin (e.g. a link with
  // target=_self). Same-origin navigations/reloads pass; an off-origin http(s)
  // target is opened externally instead, anything else is simply blocked.
  win.webContents.on("will-navigate", (event, url) => {
    if (isInternalNavigation(url, win.webContents.getURL())) return;
    event.preventDefault();
    if (isOpenableExternalUrl(url)) void shell.openExternal(url).catch(() => undefined);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    // Packaged build serves static file:// content — lock the renderer down with
    // a Content-Security-Policy (dev skips this to keep Vite HMR working).
    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [rendererCsp()] },
      });
    });
    void win.loadFile(path.join(import.meta.dirname, "../renderer/index.html"));
  }

  return win;
}
