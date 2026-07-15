// Spawn a CLI and capture its output. Used by the ledger, file-extraction, and
// git tools. The extension runs under Node (the desktop app spawns pi via
// Electron-as-Node); tests mock this `spawnText` seam directly. ENOENT is
// propagated so callers can map "command not found" to their own message.

import { spawn } from "node:child_process";

export type SpawnResult = { exitCode: number; stdout: string; stderr: string };

export function spawnText(
  cmd: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal },
): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve, reject) => {
    const proc = spawn(cmd[0], cmd.slice(1), { cwd: opts?.cwd, env: opts?.env });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => {
      stdout += d;
    });
    proc.stderr?.on("data", (d) => {
      stderr += d;
    });
    if (opts?.signal) opts.signal.addEventListener("abort", () => proc.kill(), { once: true });
    proc.on("error", reject); // ENOENT etc. (err.code preserved for callers)
    proc.on("close", (code) => resolve({ exitCode: code ?? 0, stdout, stderr }));
  });
}
