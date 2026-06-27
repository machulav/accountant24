import path from "node:path";
import { BrowserWindow, shell } from "electron";

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

  // External links open in the system browser, never as new app windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(import.meta.dirname, "../renderer/index.html"));
  }

  return win;
}
