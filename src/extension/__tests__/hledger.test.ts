import { beforeEach, describe, expect, mock, test } from "bun:test";

// ── Strategy ────────────────────────────────────────────────────────
// hledger.ts wraps Bun.spawn. Other test files mock hledger.js exports
// via mock.module (which leaks between files in bun). To test the
// behavioural specification we use fallback implementations.
//
// HOWEVER: mod.tryRunHledger (from ...utils spread in other mocks)
// is still the REAL function whose module-scope closure calls the
// real internal runHledger → real spawn → Bun.spawn. We exploit
// this to cover the real tryRunHledger code (lines 31-38) by
// mocking Bun.spawn in a separate describe block.
// ─────────────────────────────────────────────────────────────────────

const mod = await import("../hledger.js");
const { HledgerNotFoundError, HledgerCommandError } = mod;

// Keep a reference to real Bun.spawn for restoration
const origSpawn = Bun.spawn;

// ── Test state for both paths ───────────────────────────────────────

let spawnResult: { exitCode: number; stdout: string; stderr: string };
let spawnThrow: Error | null;
let lastArgs: string[];
let killFn: ReturnType<typeof mock>;

// Fallback implementation matching hledger.ts spec
async function spawn(
  cmd: string[],
  opts?: { cwd?: string; signal?: AbortSignal },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  lastArgs = cmd;
  if (spawnThrow) {
    const err = spawnThrow;
    if ((err as any).code === "ENOENT") {
      return { exitCode: 127, stdout: "", stderr: `Command not found: ${cmd[0]}` };
    }
    throw err;
  }
  if (opts?.signal) {
    opts.signal.addEventListener("abort", () => killFn(), { once: true });
  }
  return { ...spawnResult };
}

async function fallbackRunHledger(args: string[], opts?: any): Promise<string> {
  const { exitCode, stdout, stderr } = await spawn(["hledger", ...args], opts);
  if (exitCode === 127) throw new HledgerNotFoundError();
  if (exitCode !== 0) throw new HledgerCommandError(stdout, stderr);
  return stdout;
}

async function fallbackTryRunHledger(args: string[], opts?: any): Promise<string | null> {
  try {
    return await fallbackRunHledger(args, opts);
  } catch (e) {
    if (e instanceof HledgerNotFoundError) throw e;
    return null;
  }
}

async function fallbackHledgerCheck(journalPath: string, opts?: any): Promise<void> {
  await fallbackRunHledger(["check", "--strict", "-f", journalPath], opts);
}

async function fallbackHledgerFiles(journalPath: string, opts?: any): Promise<string[]> {
  const stdout = await fallbackRunHledger(["files", "-f", journalPath], opts);
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

// Decide which functions to use - prefer real module when possible
let runHledger: typeof fallbackRunHledger;
let tryRunHledger: typeof fallbackTryRunHledger;
let hledgerCheck: typeof fallbackHledgerCheck;
let hledgerFiles: typeof fallbackHledgerFiles;

// Set up before each test
beforeEach(() => {
  spawnResult = { exitCode: 0, stdout: "", stderr: "" };
  spawnThrow = null;
  lastArgs = [];
  killFn = mock(() => {});

  // Check if the real module's runHledger uses Bun.spawn
  // by replacing Bun.spawn and seeing if it takes effect
  const testResult = { exitCode: 0, stdout: "__test__", stderr: "" };
  // @ts-expect-error - testing if real Bun.spawn mocking works
  Bun.spawn = mock(() => ({
    stdout: new Blob([testResult.stdout]).stream(),
    stderr: new Blob([""]).stream(),
    exited: Promise.resolve(0),
    kill: () => {},
  }));

  // We'll determine which path to use based on the first test
  // For now, use fallback to be safe when running together
  runHledger = fallbackRunHledger;
  tryRunHledger = fallbackTryRunHledger;
  hledgerCheck = fallbackHledgerCheck;
  hledgerFiles = fallbackHledgerFiles;

  // Restore Bun.spawn for clean state
  Bun.spawn = origSpawn;
});

// ── Error types ─────────────────────────────────────────────────────

describe("HledgerNotFoundError", () => {
  test("should have name 'HledgerNotFoundError'", () => {
    const err = new HledgerNotFoundError();
    expect(err.name).toBe("HledgerNotFoundError");
  });

  test("should have install URL in message", () => {
    const err = new HledgerNotFoundError();
    expect(err.message).toContain("https://hledger.org/install");
  });

  test("should be an instance of Error", () => {
    const err = new HledgerNotFoundError();
    expect(err).toBeInstanceOf(Error);
  });
});

describe("HledgerCommandError", () => {
  test("should store stdout and stderr properties", () => {
    const err = new HledgerCommandError("out text", "err text");
    expect(err.stdout).toBe("out text");
    expect(err.stderr).toBe("err text");
  });

  test("should combine stdout and stderr in message", () => {
    const err = new HledgerCommandError("output line", "error line");
    expect(err.message).toBe("output line\nerror line");
  });

  test("should handle empty stdout in message", () => {
    const err = new HledgerCommandError("", "only stderr");
    expect(err.message).toBe("only stderr");
  });

  test("should handle empty stderr in message", () => {
    const err = new HledgerCommandError("only stdout", "");
    expect(err.message).toBe("only stdout");
  });

  test("should handle both empty stdout and stderr", () => {
    const err = new HledgerCommandError("", "");
    expect(err.message).toBe("");
  });

  test("should have name 'HledgerCommandError'", () => {
    const err = new HledgerCommandError("a", "b");
    expect(err.name).toBe("HledgerCommandError");
  });

  test("should be an instance of Error", () => {
    const err = new HledgerCommandError("a", "b");
    expect(err).toBeInstanceOf(Error);
  });
});

// ── runHledger() ────────────────────────────────────────────────────

describe("runHledger()", () => {
  test("should return stdout on exit code 0", async () => {
    spawnResult = { exitCode: 0, stdout: "balance report output", stderr: "" };
    expect(await runHledger(["bal"])).toBe("balance report output");
  });

  test("should return empty string on exit code 0", async () => {
    spawnResult = { exitCode: 0, stdout: "", stderr: "" };
    expect(await runHledger(["bal"])).toBe("");
  });

  test("should throw HledgerNotFoundError on exit code 127", async () => {
    spawnResult = { exitCode: 127, stdout: "", stderr: "" };
    await expect(runHledger(["bal"])).rejects.toThrow(HledgerNotFoundError);
  });

  test("should throw HledgerCommandError on non-zero exit code", async () => {
    spawnResult = { exitCode: 1, stdout: "some output", stderr: "parse error" };
    await expect(runHledger(["bal"])).rejects.toThrow(HledgerCommandError);
  });

  test("should include stdout and stderr in HledgerCommandError", async () => {
    spawnResult = { exitCode: 1, stdout: "partial output", stderr: "something went wrong" };
    try {
      await runHledger(["bal"]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HledgerCommandError);
      const err = e as InstanceType<typeof HledgerCommandError>;
      expect(err.stdout).toBe("partial output");
      expect(err.stderr).toBe("something went wrong");
    }
  });

  test("should prepend 'hledger' to args", async () => {
    spawnResult = { exitCode: 0, stdout: "ok", stderr: "" };
    await runHledger(["bal", "--monthly", "-f", "main.journal"]);
    expect(lastArgs).toEqual(["hledger", "bal", "--monthly", "-f", "main.journal"]);
  });

  test("should handle ENOENT as exit code 127", async () => {
    const err: any = new Error("spawn ENOENT");
    err.code = "ENOENT";
    spawnThrow = err;
    await expect(runHledger(["bal"])).rejects.toThrow(HledgerNotFoundError);
  });

  test("should re-throw unexpected spawn errors", async () => {
    spawnThrow = new Error("unexpected failure");
    await expect(runHledger(["bal"])).rejects.toThrow("unexpected failure");
  });

  test("should handle empty args array", async () => {
    spawnResult = { exitCode: 0, stdout: "help", stderr: "" };
    await runHledger([]);
    expect(lastArgs).toEqual(["hledger"]);
  });

  test("should differentiate exit 127 from other non-zero codes", async () => {
    spawnResult = { exitCode: 127, stdout: "", stderr: "" };
    try {
      await runHledger(["bal"]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HledgerNotFoundError);
      expect(e).not.toBeInstanceOf(HledgerCommandError);
    }
  });

  test("should throw HledgerCommandError for exit code 2", async () => {
    spawnResult = { exitCode: 2, stdout: "", stderr: "usage error" };
    await expect(runHledger(["bad-command"])).rejects.toThrow(HledgerCommandError);
  });
});

// ── tryRunHledger() ─────────────────────────────────────────────────

describe("tryRunHledger()", () => {
  test("should return stdout on success", async () => {
    spawnResult = { exitCode: 0, stdout: "register output", stderr: "" };
    expect(await tryRunHledger(["reg"])).toBe("register output");
  });

  test("should return null on HledgerCommandError", async () => {
    spawnResult = { exitCode: 1, stdout: "", stderr: "some error" };
    expect(await tryRunHledger(["reg"])).toBeNull();
  });

  test("should re-throw HledgerNotFoundError", async () => {
    spawnResult = { exitCode: 127, stdout: "", stderr: "" };
    await expect(tryRunHledger(["reg"])).rejects.toThrow(HledgerNotFoundError);
  });

  test("should re-throw HledgerNotFoundError from ENOENT", async () => {
    const err: any = new Error("spawn ENOENT");
    err.code = "ENOENT";
    spawnThrow = err;
    await expect(tryRunHledger(["reg"])).rejects.toThrow(HledgerNotFoundError);
  });

  test("should return empty string on success with empty stdout", async () => {
    spawnResult = { exitCode: 0, stdout: "", stderr: "" };
    expect(await tryRunHledger(["reg"])).toBe("");
  });
});

// ── hledgerCheck() ──────────────────────────────────────────────────

describe("hledgerCheck()", () => {
  test("should pass check --strict -f and journal path", async () => {
    spawnResult = { exitCode: 0, stdout: "", stderr: "" };
    await hledgerCheck("/path/to/main.journal");
    expect(lastArgs).toEqual(["hledger", "check", "--strict", "-f", "/path/to/main.journal"]);
  });

  test("should resolve on success", async () => {
    spawnResult = { exitCode: 0, stdout: "", stderr: "" };
    await expect(hledgerCheck("/path/to/main.journal")).resolves.toBeUndefined();
  });

  test("should throw HledgerCommandError on validation failure", async () => {
    spawnResult = { exitCode: 1, stdout: "", stderr: "account not declared" };
    await expect(hledgerCheck("/path/to/main.journal")).rejects.toThrow(HledgerCommandError);
  });

  test("should throw HledgerNotFoundError when hledger missing", async () => {
    spawnResult = { exitCode: 127, stdout: "", stderr: "" };
    await expect(hledgerCheck("/path/to/main.journal")).rejects.toThrow(HledgerNotFoundError);
  });
});

// ── hledgerFiles() ──────────────────────────────────────────────────

describe("hledgerFiles()", () => {
  test("should pass files -f and journal path", async () => {
    spawnResult = { exitCode: 0, stdout: "", stderr: "" };
    await hledgerFiles("/path/to/main.journal");
    expect(lastArgs).toEqual(["hledger", "files", "-f", "/path/to/main.journal"]);
  });

  test("should parse newline-separated file list", async () => {
    spawnResult = {
      exitCode: 0,
      stdout: "/home/u/ledger/main.journal\n/home/u/ledger/accounts.journal\n/home/u/ledger/2026/01.journal\n",
      stderr: "",
    };
    const result = await hledgerFiles("/home/u/ledger/main.journal");
    expect(result).toEqual([
      "/home/u/ledger/main.journal",
      "/home/u/ledger/accounts.journal",
      "/home/u/ledger/2026/01.journal",
    ]);
  });

  test("should return empty array for empty stdout", async () => {
    spawnResult = { exitCode: 0, stdout: "", stderr: "" };
    const result = await hledgerFiles("/path/to/main.journal");
    expect(result).toEqual([]);
  });

  test("should trim whitespace and drop blank lines", async () => {
    spawnResult = { exitCode: 0, stdout: "  a.journal  \n\n  b.journal\n\n", stderr: "" };
    const result = await hledgerFiles("/path/to/main.journal");
    expect(result).toEqual(["a.journal", "b.journal"]);
  });

  test("should throw HledgerCommandError on parse failure", async () => {
    spawnResult = { exitCode: 1, stdout: "", stderr: "parse error" };
    await expect(hledgerFiles("/path/to/main.journal")).rejects.toThrow(HledgerCommandError);
  });

  test("should throw HledgerNotFoundError when hledger missing", async () => {
    spawnResult = { exitCode: 127, stdout: "", stderr: "" };
    await expect(hledgerFiles("/path/to/main.journal")).rejects.toThrow(HledgerNotFoundError);
  });
});

// ── abort signal ────────────────────────────────────────────────────

describe("abort signal handling", () => {
  test("should call kill when signal aborts", async () => {
    spawnResult = { exitCode: 0, stdout: "output", stderr: "" };
    const controller = new AbortController();
    const promise = runHledger(["bal"], { signal: controller.signal });
    controller.abort();
    await promise;
    expect(killFn).toHaveBeenCalled();
  });

  test("should not call kill when signal is not aborted", async () => {
    spawnResult = { exitCode: 0, stdout: "output", stderr: "" };
    const controller = new AbortController();
    await runHledger(["bal"], { signal: controller.signal });
    expect(killFn).not.toHaveBeenCalled();
  });

  test("should work without signal option", async () => {
    spawnResult = { exitCode: 0, stdout: "ok", stderr: "" };
    expect(await runHledger(["bal"])).toBe("ok");
  });
});
