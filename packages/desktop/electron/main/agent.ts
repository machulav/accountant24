// The pi agent child process. Mirrors the old src-tauri/src/agent.rs: spawn
// `pi --mode rpc -e <extension>` and bridge its JSONL stdio.
//
//   stdout line  -> "agent-event"     (one RPC event/response per line)
//   "agent_send" -> one JSON command written to stdin (+ "\n")
//
// Option B: instead of a compiled pi binary, we run pi's cli.js with Electron's
// own Node (ELECTRON_RUN_AS_NODE), resolved from node_modules.

import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { type BrowserWindow, ipcMain } from "electron";
import { agentEnv, extensionPath, piCliPath, workspaceDir } from "./env";

let child: ChildProcess | null = null;

function spawnAgent(getWin: () => BrowserWindow | null): void {
  const workspace = workspaceDir();
  // current_dir requires the dir to exist at spawn time (the extension scaffolds
  // its contents later, on session_start).
  mkdirSync(workspace, { recursive: true });
  const sessionsDir = path.join(workspace, "sessions");

  const proc = spawn(
    process.execPath,
    [
      piCliPath(),
      "--mode",
      "rpc",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--session-dir",
      sessionsDir,
      "-e",
      extensionPath(),
    ],
    {
      cwd: workspace,
      env: { ...agentEnv(), ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child = proc;

  const emit = (channel: string, payload: unknown) => {
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  // stdout is newline-delimited JSON; forward each complete line.
  let buf = "";
  proc.stdout?.setEncoding("utf8");
  proc.stdout?.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line.length > 0) emit("agent-event", line);
    }
  });
  proc.stderr?.setEncoding("utf8"); // drained so the pipe never blocks
  proc.stderr?.resume();
  proc.on("exit", (code) => {
    if (child === proc) child = null;
    emit("agent-terminated", code);
  });
  proc.on("error", (err) => emit("agent-error", err.message));
}

/** Kill the agent child (app exit / explicit stop). */
export function killAgent(): void {
  if (child) {
    child.kill();
    child = null;
  }
}

/** Register agent IPC. Idempotent spawn guards against StrictMode double-mount. */
export function registerAgentIpc(getWin: () => BrowserWindow | null): void {
  ipcMain.handle("agent_start", () => {
    if (!child) spawnAgent(getWin);
  });
  ipcMain.handle("agent_send", (_e, command: unknown) => {
    if (!child?.stdin) throw new Error("agent not running");
    child.stdin.write(`${JSON.stringify(command)}\n`);
  });
  ipcMain.handle("agent_stop", () => killAgent());
  // Respawn the child so it re-reads auth.json + models.json — used after the app
  // adds/removes a provider, since the agent caches both in memory at startup.
  ipcMain.handle("agent_restart", () => {
    killAgent();
    spawnAgent(getWin);
  });
}
