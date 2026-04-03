import { existsSync } from "node:fs";
import { join } from "node:path";

// ── Commands ────────────────────────────────────────────────────────

export async function gitInit(cwd: string): Promise<boolean> {
  if (existsSync(join(cwd, ".git"))) return false;
  await spawn(["git", "init"], { cwd });
  return true;
}

export async function hasChanges(cwd: string): Promise<boolean> {
  const { stdout } = await spawn(["git", "status", "--porcelain"], { cwd });
  return stdout.trim().length > 0;
}

export async function hasRemotes(cwd: string): Promise<boolean> {
  const { stdout } = await spawn(["git", "remote"], { cwd });
  return stdout.trim().length > 0;
}

export async function commitAll(cwd: string, message: string): Promise<void> {
  await spawn(["git", "add", "-A"], { cwd });
  await spawn(["git", "commit", "-m", message], { cwd });
}

export async function diffStat(cwd: string): Promise<string[]> {
  // Stage everything first so new/deleted files appear in the diff
  await spawn(["git", "add", "-A"], { cwd });
  const { stdout } = await spawn(["git", "diff", "--cached", "--name-only"], { cwd });
  return stdout
    .trim()
    .split("\n")
    .filter((f) => f.length > 0);
}

export async function push(cwd: string): Promise<void> {
  await spawn(["git", "push", "origin", "HEAD"], { cwd });
}

// ── Internals ───────────────────────────────────────────────────────

async function spawn(
  cmd: string[],
  opts: { cwd: string },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const proc = Bun.spawn(cmd, {
      cwd: opts.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return { exitCode: 127, stdout: "", stderr: `Command not found: ${cmd[0]}` };
    }
    throw err;
  }
}
