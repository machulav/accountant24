// ── Error types ─────────────────────────────────────────────────────

export class HledgerNotFoundError extends Error {
  constructor() {
    super("hledger not found. Install: https://hledger.org/install");
    this.name = "HledgerNotFoundError";
  }
}

export class HledgerCommandError extends Error {
  stdout: string;
  stderr: string;
  constructor(stdout: string, stderr: string) {
    const output = [stdout, stderr].filter(Boolean).join("\n");
    super(output);
    this.name = "HledgerCommandError";
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

// ── Commands ────────────────────────────────────────────────────────

export async function runHledger(args: string[], opts?: { cwd?: string; signal?: AbortSignal }): Promise<string> {
  const { exitCode, stdout, stderr } = await spawn(["hledger", ...args], opts);
  if (exitCode === 127) throw new HledgerNotFoundError();
  if (exitCode !== 0) throw new HledgerCommandError(stdout, stderr);
  return stdout;
}

export async function tryRunHledger(
  args: string[],
  opts?: { cwd?: string; signal?: AbortSignal },
): Promise<string | null> {
  try {
    return await runHledger(args, opts);
  } catch (e) {
    if (e instanceof HledgerNotFoundError) throw e;
    return null;
  }
}

export async function hledgerCheck(journalPath: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<void> {
  await runHledger(["check", "--strict", "-f", journalPath], opts);
}

// ── Internals ───────────────────────────────────────────────────────

async function spawn(
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
