// Archives every user-attached file into the workspace (files/YYYY/MM, timestamped
// + deduplicated, relative to ACCOUNTANT24_HOME) and returns its workspace-relative
// path. The renderer sends the file bytes (base64) rather than a source path, so
// this works for picked, dropped, and pasted files alike. The agent then receives
// a ready workspace path — pi-supported types (images) also ride along as native
// content; others (PDF, CSV, …) are referenced by this path.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { ipcMain } from "electron";
import { workspaceDir } from "./env";

function deduplicatePath(dir: string, name: string): string {
  const target = join(dir, name);
  if (!existsSync(target)) return target;

  const ext = extname(name);
  const base = ext.length > 0 ? name.slice(0, -ext.length) : name;
  for (let counter = 2; counter <= 1000; counter++) {
    const candidate = join(dir, `${base}-${counter}${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`Too many files with the same name: ${name}`);
}

/** Write base64 file bytes into the workspace; returns the stored copy's path
 *  relative to the workspace root. The stored name is timestamp + the source
 *  extension (taken from the original name). */
function archiveToWorkspace(name: string, dataBase64: string): string {
  const home = workspaceDir();
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const dir = join(home, "files", year, month);
  mkdirSync(dir, { recursive: true });

  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${year}${month}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const stored = deduplicatePath(dir, `${stamp}${extname(name)}`);
  writeFileSync(stored, Buffer.from(dataBase64, "base64"));

  return relative(home, stored);
}

export function registerFilesIpc(): void {
  ipcMain.handle("files_archive_to_workspace", (_e, payload: { name: string; dataBase64: string }) =>
    archiveToWorkspace(payload.name, payload.dataBase64),
  );
}
