import { resolve, normalize } from "node:path";

export function resolveSafePath(userPath: string, baseDir: string): string {
  const resolved = normalize(resolve(baseDir, userPath));
  if (!resolved.startsWith(baseDir)) {
    throw new Error(`Path escapes base directory: ${userPath}`);
  }
  return resolved;
}

export async function runCommand(
  cmd: string[],
  opts?: { cwd?: string; signal?: AbortSignal },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const proc = Bun.spawn(cmd, {
      cwd: opts?.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (opts?.signal) {
      opts.signal.addEventListener("abort", () => proc.kill(), { once: true });
    }

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return { exitCode: 127, stdout: "", stderr: `Command not found: ${cmd[0]}` };
    }
    throw err;
  }
}
