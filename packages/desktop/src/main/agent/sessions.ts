// Session files — list for the thread sidebar, delete on user request. Runs
// in-process via the pi SDK (RPC mode can't list/delete sessions). Lives in
// agent/ because sessions are the agent's own state and deleting one must
// abort its live run first.

import { rmSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ipcMain } from "electron";
import { sessionsDir, workspaceDir } from "../env";
import { killSessionAgent } from "./router";
import { resolveSessionPath } from "./session-paths";

async function sessionsList() {
  const infos = await SessionManager.list(workspaceDir(), sessionsDir());
  const sessions = infos.map((s) => ({
    path: s.path,
    id: s.id,
    name: s.name ?? "",
    firstMessage: s.firstMessage ?? "",
    messageCount: s.messageCount,
    modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
  }));
  return { type: "sessions", sessions };
}

async function sessionsDelete(path: string) {
  if (!path) return { type: "error", message: "session path is required" };
  const target = resolveSessionPath(path);
  if (!target) {
    return { type: "error", message: "refusing to delete a path outside the sessions directory" };
  }
  // A live session would keep running (and eventually re-persist the file) —
  // deleting a running session intentionally aborts it, and the awaited dispose
  // ack guarantees the host can't write the file back after the rm.
  await killSessionAgent(target);
  rmSync(target, { force: true });
  return { type: "done", path };
}

/** Register the sessions IPC handlers. */
export function registerSessionsIpc(): void {
  ipcMain.handle("sessions_list", () => sessionsList());
  ipcMain.handle("sessions_delete", (_e, { path }: { path: string }) => sessionsDelete(path));
}
