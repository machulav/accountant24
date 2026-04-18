import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-validate-"));
mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  LEDGER_DIR: join(BASE, "ledger"),
  MAIN_LEDGER_FILE: join(BASE, "ledger", "main.txt"),
  MEMORY_PATH: join(BASE, "memory.md"),
  FILES_DIR: join(BASE, "files"),
  setBaseDir: () => {},
}));

const origSpawn = Bun.spawn;

function makeMockProc(exitCode: number, stdout = "", stderr = "") {
  return {
    stdout: new Blob([stdout]).stream(),
    stderr: new Blob([stderr]).stream(),
    exited: Promise.resolve(exitCode),
    kill: mock(() => {}),
  };
}

const { validateLedger } = await import("../validate.js");

afterEach(() => {
  Bun.spawn = origSpawn;
});

describe("validateLedger()", () => {
  test("should return { ledgerIsValid: true } when hledger check succeeds", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0));
    const result = await validateLedger();
    expect(result).toEqual({ ledgerIsValid: true });
  });

  test("should throw Error with stderr when hledger check fails", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(1, "", "account Assets:Missing not declared"));
    await expect(validateLedger()).rejects.toThrow("account Assets:Missing not declared");
  });

  test("should throw plain Error (not HledgerCommandError) on check failure", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(1, "", "some validation error"));
    try {
      await validateLedger();
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).name).not.toBe("HledgerCommandError");
    }
  });

  test("should throw HledgerNotFoundError when hledger is missing", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(127));
    await expect(validateLedger()).rejects.toThrow("hledger not found");
  });

  test("should re-throw unexpected errors", async () => {
    Bun.spawn = mock(() => {
      throw new TypeError("unexpected spawn failure");
    });
    await expect(validateLedger()).rejects.toThrow("unexpected spawn failure");
  });

  test("should call hledger with check --strict", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0));
    await validateLedger();
    const args = (Bun.spawn as any).mock.calls[0][0];
    expect(args).toContain("check");
    expect(args).toContain("--strict");
  });

  test("should pass the main.txt path to hledger", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0));
    await validateLedger();
    const args = (Bun.spawn as any).mock.calls[0][0];
    expect(args).toContain("-f");
    const fIdx = args.indexOf("-f");
    expect(args[fIdx + 1]).toContain("main.txt");
  });
});
