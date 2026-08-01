import { beforeEach, describe, expect, test, vi } from "vitest";
import { spawnText } from "../../spawn";

vi.mock("../../spawn");

import { HledgerCommandError, HledgerNotFoundError, hledgerCheck, runHledger, tryRunHledger } from "../hledger";

// ── Test state ──────────────────────────────────────────────────────
// The real module runs against a mocked spawnText seam (the process boundary):
// tests drive exit codes / spawn errors through these two variables.

let spawnResult: { exitCode: number; stdout: string; stderr: string };
let spawnThrow: Error | null;

beforeEach(() => {
  spawnResult = { exitCode: 0, stdout: "", stderr: "" };
  spawnThrow = null;
  vi.mocked(spawnText).mockImplementation(async () => {
    if (spawnThrow) throw spawnThrow;
    return { ...spawnResult };
  });
});

function lastArgs(): string[] {
  const calls = vi.mocked(spawnText).mock.calls;
  return calls[calls.length - 1][0];
}

function enoent(): Error {
  const err: any = new Error("spawn hledger ENOENT");
  err.code = "ENOENT";
  return err;
}

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
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HledgerCommandError);
      const err = e as HledgerCommandError;
      expect(err.stdout).toBe("partial output");
      expect(err.stderr).toBe("something went wrong");
    }
  });

  test("should prepend 'hledger' to args", async () => {
    spawnResult = { exitCode: 0, stdout: "ok", stderr: "" };
    await runHledger(["bal", "--monthly", "-f", "main.journal"]);
    expect(lastArgs()).toEqual(["hledger", "bal", "--monthly", "-f", "main.journal"]);
  });

  test("should handle ENOENT as exit code 127", async () => {
    spawnThrow = enoent();
    await expect(runHledger(["bal"])).rejects.toThrow(HledgerNotFoundError);
  });

  test("should re-throw unexpected spawn errors", async () => {
    spawnThrow = new Error("unexpected failure");
    await expect(runHledger(["bal"])).rejects.toThrow("unexpected failure");
  });

  test("should handle empty args array", async () => {
    spawnResult = { exitCode: 0, stdout: "help", stderr: "" };
    await runHledger([]);
    expect(lastArgs()).toEqual(["hledger"]);
  });

  test("should differentiate exit 127 from other non-zero codes", async () => {
    spawnResult = { exitCode: 127, stdout: "", stderr: "" };
    try {
      await runHledger(["bal"]);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HledgerNotFoundError);
      expect(e).not.toBeInstanceOf(HledgerCommandError);
    }
  });

  test("should throw HledgerCommandError for exit code 2", async () => {
    spawnResult = { exitCode: 2, stdout: "", stderr: "usage error" };
    await expect(runHledger(["bad-command"])).rejects.toThrow(HledgerCommandError);
  });

  test("should forward cwd and signal to spawnText", async () => {
    spawnResult = { exitCode: 0, stdout: "ok", stderr: "" };
    const controller = new AbortController();
    await runHledger(["bal"], { cwd: "/work", signal: controller.signal });
    expect(spawnText).toHaveBeenCalledWith(["hledger", "bal"], { cwd: "/work", signal: controller.signal });
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
    spawnThrow = enoent();
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
    expect(lastArgs()).toEqual(["hledger", "check", "--strict", "-f", "/path/to/main.journal"]);
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
