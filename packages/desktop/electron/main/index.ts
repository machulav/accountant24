// Electron main entry. Owns the window + the pi agent child + the in-process
// auth/sessions, all exposed to the renderer over IPC. Replaces src-tauri.

import { app, BrowserWindow } from "electron";
import { killAgent, registerAgentIpc } from "./agent";
import { registerFilesIpc } from "./files";
import { registerPiIpc } from "./pi";
import { createWindow } from "./window";

let mainWindow: BrowserWindow | null = null;
const getWin = (): BrowserWindow | null => mainWindow;

app.whenReady().then(() => {
  // App-global IPC handlers (registered once); sends go to the current window.
  registerAgentIpc(getWin);
  registerPiIpc(getWin);
  registerFilesIpc();

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

app.on("before-quit", () => killAgent());
