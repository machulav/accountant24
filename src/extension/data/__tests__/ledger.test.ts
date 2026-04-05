import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-ledger-"));
mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  MEMORY_PATH: join(BASE, "memory.md"),
  LEDGER_DIR: join(BASE, "ledger"),
  FILES_DIR: join(BASE, "files"),
  setBaseDir: () => {},
}));

// Mock at I/O boundary (Bun.spawn) so the real hledger.ts functions execute.
const origSpawn = Bun.spawn;

function makeMockProc(exitCode: number, stdout = "", stderr = "") {
  return {
    stdout: new Blob([stdout]).stream(),
    stderr: new Blob([stderr]).stream(),
    exited: Promise.resolve(exitCode),
    kill: mock(() => {}),
  };
}

const { queryLedger } = await import("../ledger.js");

afterEach(() => {
  rmSync(BASE, { recursive: true, force: true });
  Bun.spawn = origSpawn;
});

describe("queryLedger()", () => {
  describe("return shape", () => {
    beforeEach(() => {
      // @ts-expect-error - mocking Bun.spawn
      Bun.spawn = mock(() => makeMockProc(0, "100 USD  Expenses:Food"));
    });

    test("should return an object with command and output fields", async () => {
      const result = await queryLedger({ report: "bal" });
      expect(result).toHaveProperty("command");
      expect(result).toHaveProperty("output");
    });

    test("should return command starting with hledger followed by the report", async () => {
      const result = await queryLedger({ report: "bal" });
      expect(result.command).toMatch(/^hledger bal /);
    });

    test("should return output containing hledger stdout", async () => {
      const result = await queryLedger({ report: "bal" });
      expect(result.output).toBe("100 USD  Expenses:Food");
    });
  });

  describe("(no results) fallback", () => {
    test("should return output=(no results) when hledger returns empty string", async () => {
      // @ts-expect-error - mocking Bun.spawn
      Bun.spawn = mock(() => makeMockProc(0, ""));
      const result = await queryLedger({ report: "bal" });
      expect(result.output).toBe("(no results)");
    });

    test("should return actual output when hledger returns non-empty content", async () => {
      // @ts-expect-error - mocking Bun.spawn
      Bun.spawn = mock(() => makeMockProc(0, "500 USD  Expenses"));
      const result = await queryLedger({ report: "bal" });
      expect(result.output).not.toBe("(no results)");
      expect(result.output).toContain("Expenses");
    });
  });

  describe("command string", () => {
    beforeEach(() => {
      // @ts-expect-error - mocking Bun.spawn
      Bun.spawn = mock(() => makeMockProc(0, ""));
    });

    test("should include -f and the resolved journal path in command", async () => {
      const result = await queryLedger({ report: "bal" });
      expect(result.command).toContain("-f");
      expect(result.command).toContain("main.journal");
    });

    test("should include account pattern in command", async () => {
      const result = await queryLedger({ report: "bal", account_pattern: "Expenses:Food" });
      expect(result.command).toContain("Expenses:Food");
    });

    test("should include desc: filter in command", async () => {
      const result = await queryLedger({ report: "reg", description_pattern: "Amazon" });
      expect(result.command).toContain("desc:Amazon");
    });

    test("should include date range flags in command", async () => {
      const result = await queryLedger({ report: "bal", begin_date: "2026-01-01", end_date: "2026-04-01" });
      expect(result.command).toContain("-b 2026-01-01");
      expect(result.command).toContain("-e 2026-04-01");
    });

    test("should include --monthly in command when period=monthly", async () => {
      const result = await queryLedger({ report: "bal", period: "monthly" });
      expect(result.command).toContain("--monthly");
    });

    test("should include --invert in command when invert=true", async () => {
      const result = await queryLedger({ report: "bal", invert: true });
      expect(result.command).toContain("--invert");
    });
  });

  describe("error handling", () => {
    test("should throw when hledger is not found", async () => {
      // @ts-expect-error - mocking Bun.spawn
      Bun.spawn = mock(() => makeMockProc(127));
      await expect(queryLedger({ report: "bal" })).rejects.toThrow("hledger not found");
    });

    test("should throw when hledger exits with non-zero code", async () => {
      // @ts-expect-error - mocking Bun.spawn
      Bun.spawn = mock(() => makeMockProc(1, "", "parse error"));
      await expect(queryLedger({ report: "bal" })).rejects.toThrow("parse error");
    });

    test("should throw when file path escapes base directory", async () => {
      await expect(queryLedger({ report: "bal", file: "../../etc/passwd" })).rejects.toThrow(
        "Path escapes base directory",
      );
    });
  });
});
