import path from "node:path";
import { BrowserWindow, shell } from "electron";
import { isInternalNavigation, isOpenableExternalUrl, rendererCsp } from "./urls";

/** Create the single app window. macOS chrome mirrors the old Tauri config:
 *  inset traffic lights, no native title bar; the renderer paints the top strip. */
export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 560,
    minHeight: 480,
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

  win.once("ready-to-show", () => win.show());

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
