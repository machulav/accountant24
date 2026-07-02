import { afterEach, describe, expect, test, vi } from "vitest";
import { spawnText } from "../../spawn";

vi.mock("../../spawn");

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-validate-"));
vi.mock("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  LEDGER_DIR: join(BASE, "ledger"),
  MEMORY_PATH: join(BASE, "memory.md"),
  FILES_DIR: join(BASE, "files"),
  setBaseDir: () => {},
}));

function makeMockProc(exitCode: number, stdout = "", stderr = "") {
  return { exitCode, stdout, stderr };
}

const { validateLedger } = await import("../validate.js");

afterEach(() => {});

describe("validateLedger()", () => {
  test("should return { ledgerIsValid: true } when hledger check succeeds", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0));
    const result = await validateLedger();
    expect(result).toEqual({ ledgerIsValid: true });
  });

  test("should throw Error with stderr when hledger check fails", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(1, "", "account Assets:Missing not declared"));
    await expect(validateLedger()).rejects.toThrow("account Assets:Missing not declared");
  });

  test("should throw plain Error (not HledgerCommandError) on check failure", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(1, "", "some validation error"));
    try {
      await validateLedger();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).name).not.toBe("HledgerCommandError");
    }
  });

  test("should throw HledgerNotFoundError when hledger is missing", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(127));
    await expect(validateLedger()).rejects.toThrow("hledger not found");
  });

  test("should re-throw unexpected errors", async () => {
    vi.mocked(spawnText).mockRejectedValue(new TypeError("unexpected spawn failure"));
    await expect(validateLedger()).rejects.toThrow("unexpected spawn failure");
  });

  test("should call hledger with check --strict", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0));
    await validateLedger();
    const args = vi.mocked(spawnText).mock.calls[0][0];
    expect(args).toContain("check");
    expect(args).toContain("--strict");
  });

  test("should pass the main.journal path to hledger", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0));
    await validateLedger();
    const args = vi.mocked(spawnText).mock.calls[0][0];
    expect(args).toContain("-f");
    const fIdx = args.indexOf("-f");
    expect(args[fIdx + 1]).toContain("main.journal");
  });
});
