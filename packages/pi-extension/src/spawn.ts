// Runtime-agnostic "spawn a CLI and capture its output" used by the ledger,
// file-extraction, and git tools.
//
// The extension runs in two runtimes: the bun-compiled pi binary (and `bun test`),
// where `Bun` is defined, and the Electron desktop app, where pi runs under
// Electron's Node (`Bun` is undefined). Under bun we use `Bun.spawn` — which also
// keeps the tests' `Bun.spawn` mocks intercepting — and fall back to
// node:child_process otherwise. ENOENT is propagated either way so callers can
// map "command not found" to their own message.

export type SpawnResult = { exitCode: number; stdout: string; stderr: string };

export async function spawnText(cmd: string[], opts?: { cwd?: string; signal?: AbortSignal }): Promise<SpawnResult> {
  if (typeof Bun !== "undefined") {
    const proc = Bun.spawn(cmd, { cwd: opts?.cwd, stdout: "pipe", stderr: "pipe" });
    if (opts?.signal) opts.signal.addEventListener("abort", () => proc.kill(), { once: true });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  }

  const { spawn } = await import("node:child_process");
  return await new Promise<SpawnResult>((resolve, reject) => {
    const proc = spawn(cmd[0], cmd.slice(1), { cwd: opts?.cwd });
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
