import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock `../../../hledger` before importing `ledgerFormat` so the real
// hledger CLI is never invoked. The mock lets tests control the file list
// and whether the call throws.
let mockFiles: string[] = [];
let mockThrows: Error | null = null;
const hledgerFilesCalls: Array<{ mainPath: string; opts?: unknown }> = [];

mock.module("../../../hledger.js", () => ({
  hledgerFiles: async (mainPath: string, opts?: unknown) => {
    hledgerFilesCalls.push({ mainPath, opts });
    if (mockThrows) throw mockThrows;
    return mockFiles;
  },
}));

const { ledgerFormat } = await import("../index");

const BASE = mkdtempSync(join(tmpdir(), "ledger-format-"));

afterAll(() => {
  rmSync(BASE, { recursive: true, force: true });
});

beforeEach(() => {
  mockFiles = [];
  mockThrows = null;
  hledgerFilesCalls.length = 0;
});

describe("ledgerFormat()", () => {
  test("should call hledgerFiles with the main path", async () => {
    await ledgerFormat("/tmp/main.journal");
    expect(hledgerFilesCalls).toHaveLength(1);
    expect(hledgerFilesCalls[0].mainPath).toBe("/tmp/main.journal");
  });

  test("should forward opts (cwd, signal) to hledgerFiles", async () => {
    const signal = new AbortController().signal;
    await ledgerFormat("/tmp/main.journal", { cwd: "/tmp", signal });
    expect(hledgerFilesCalls[0].opts).toEqual({ cwd: "/tmp", signal });
  });

  test("should format every file returned by hledgerFiles", async () => {
    const path1 = join(BASE, "a.journal");
    const path2 = join(BASE, "b.journal");
    writeFileSync(
      path1,
      [
        "2026-01-10 * Later",
        "    Expenses:Food    1.00 USD",
        "    Assets:Checking",
        "",
        "2026-01-01 * Earlier",
        "    Expenses:Food    2.00 USD",
        "    Assets:Checking",
      ].join("\n"),
    );
    writeFileSync(path2, "2026-03-01 * Single\n    Expenses:Food    3.00 USD\n    Assets:Checking\n");
    mockFiles = [path1, path2];

    await ledgerFormat("/tmp/main.journal");

    // path1 was sorted (Earlier before Later)
    const after1 = readFileSync(path1, "utf-8");
    expect(after1.indexOf("Earlier")).toBeLessThan(after1.indexOf("Later"));
    // path2 stays valid (single transaction, no reordering)
    const after2 = readFileSync(path2, "utf-8");
    expect(after2).toContain("Single");
  });

  test("should be a silent no-op when hledgerFiles throws", async () => {
    const path = join(BASE, "broken.journal");
    const original =
      "2026-01-10 * Later\n    Expenses:Food  1.00 USD\n    Assets:Checking\n\n2026-01-01 * Earlier\n    Expenses:Food  2.00 USD\n    Assets:Checking\n";
    writeFileSync(path, original);
    mockThrows = new Error("hledger parse error");

    await expect(ledgerFormat("/tmp/main.journal")).resolves.toBeUndefined();

    // File is untouched (still out of order)
    expect(readFileSync(path, "utf-8")).toBe(original);
  });

  test("should handle an empty file list", async () => {
    mockFiles = [];
    await expect(ledgerFormat("/tmp/main.journal")).resolves.toBeUndefined();
  });

  test("should tolerate a listed file that no longer exists", async () => {
    const missing = join(BASE, "gone.journal");
    const present = join(BASE, "present.journal");
    writeFileSync(present, "2026-01-01 * X\n    Expenses:Food    1.00 USD\n    Assets:Checking\n");
    // missing is intentionally not created
    mockFiles = [missing, present];

    // Should not throw; the present file should still be processed.
    await expect(ledgerFormat("/tmp/main.journal")).resolves.toBeUndefined();
    expect(readFileSync(present, "utf-8")).toContain("Expenses:Food");
  });
});
