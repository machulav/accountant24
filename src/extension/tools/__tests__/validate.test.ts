import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-validate-"));
const LEDGER = join(BASE, "ledger");

mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  MEMORY_PATH: join(BASE, "memory.md"),
  LEDGER_DIR: LEDGER,
  FILES_DIR: join(BASE, "files"),
  setBaseDir: () => {},
}));

// Mock at Bun.spawn level. Beautification is pure TS (no subprocess); the only
// spawn call is hledger check.
const origSpawn = Bun.spawn;

function makeMockProc(exitCode: number, stdout = "", stderr = "") {
  return {
    stdout: new Blob([stdout]).stream(),
    stderr: new Blob([stderr]).stream(),
    exited: Promise.resolve(exitCode),
    kill: mock(() => {}),
  };
}

let mockExitCode: number;
let mockStdout: string;
let mockStderr: string;

const setMock = (exit: number, stdout = "", stderr = "") => {
  mockExitCode = exit;
  mockStdout = stdout;
  mockStderr = stderr;
};

const { validateTool } = await import("../validate.js");

afterAll(() => {
  Bun.spawn = origSpawn;
  rmSync(BASE, { recursive: true, force: true });
});

beforeEach(() => {
  setMock(0);
  // @ts-expect-error - mocking Bun.spawn
  Bun.spawn = mock(() => makeMockProc(mockExitCode, mockStdout, mockStderr));
  // Clean and recreate ledger dir per test
  rmSync(LEDGER, { recursive: true, force: true });
  mkdirSync(LEDGER, { recursive: true });
});

afterEach(() => {
  Bun.spawn = origSpawn;
});

const run = (params: any) =>
  validateTool.execute("test", params, undefined, undefined, undefined as any) as Promise<any>;

test("throws when hledger not found", async () => {
  setMock(127);
  await expect(run({})).rejects.toThrow("hledger not found");
});

test("returns valid result on success", async () => {
  setMock(0);
  const result = await run({});
  expect(result.details.ledgerIsValid).toBe(true);
});

test("throws on validation failure", async () => {
  setMock(1, "", "hledger: Error: account not declared");
  await expect(run({})).rejects.toThrow("account not declared");
});

test("re-throws unexpected errors", async () => {
  Bun.spawn = mock(() => {
    throw new TypeError("unexpected");
  });
  await expect(run({})).rejects.toThrow("unexpected");
});

// ── beautification ─────────────────────────────────────────────────

describe("beautification", () => {
  test("should sort and align each monthly file after hledger check succeeds", async () => {
    mkdirSync(join(LEDGER, "2025"), { recursive: true });
    mkdirSync(join(LEDGER, "2026"), { recursive: true });
    // Out-of-order, misaligned in 2025/12.journal
    writeFileSync(
      join(LEDGER, "2025", "12.journal"),
      [
        "2025-12-28 * Later",
        "    Expenses:Misc  10.00 USD",
        "    Assets:Checking",
        "",
        "2025-12-01 * Earlier",
        "    Expenses:Misc  5.00 USD",
        "    Assets:Checking",
      ].join("\n") + "\n",
    );
    // Simple file in 2026/01.journal
    writeFileSync(
      join(LEDGER, "2026", "01.journal"),
      "2026-01-01 * Tx\n    Expenses:Food  5.00 USD\n    Assets:Checking\n",
    );

    await run({});

    const dec = readFileSync(join(LEDGER, "2025", "12.journal"), "utf-8");
    // Sorted: Earlier before Later
    expect(dec.indexOf("Earlier")).toBeLessThan(dec.indexOf("Later"));
    // Aligned: longest account is "Assets:Checking" (15). But it's balancing (no amount).
    // The only posting with amount is "Expenses:Misc" (13) → target = 4+13+4 = 21 → 4 spaces gap
    expect(dec).toContain("    Expenses:Misc    5.00 USD");
    expect(dec).toContain("    Expenses:Misc    10.00 USD");

    const jan = readFileSync(join(LEDGER, "2026", "01.journal"), "utf-8");
    // "Expenses:Food" (13) → target = 4+13+4 = 21 → 4 spaces gap
    expect(jan).toContain("    Expenses:Food    5.00 USD");
  });

  test("should not modify main.journal or accounts.journal", async () => {
    const mainContent = "; main\ninclude 2026/01.journal\n";
    const accountsContent = "account Assets:Checking\n";
    writeFileSync(join(LEDGER, "main.journal"), mainContent);
    writeFileSync(join(LEDGER, "accounts.journal"), accountsContent);
    mkdirSync(join(LEDGER, "2026"), { recursive: true });
    writeFileSync(
      join(LEDGER, "2026", "01.journal"),
      "2026-01-01 * Tx\n    Expenses:Misc    1.00 USD\n    Assets:Checking\n",
    );

    await run({});

    expect(readFileSync(join(LEDGER, "main.journal"), "utf-8")).toBe(mainContent);
    expect(readFileSync(join(LEDGER, "accounts.journal"), "utf-8")).toBe(accountsContent);
  });

  test("should skip files in non-year-named directories", async () => {
    mkdirSync(join(LEDGER, "archive"), { recursive: true });
    mkdirSync(join(LEDGER, "2026"), { recursive: true });
    const archiveContent =
      "2020-02-01 * Later\n    Expenses:Misc    1.00 USD\n    Assets:Checking\n\n2020-01-01 * Earlier\n    Expenses:Misc    2.00 USD\n    Assets:Checking\n";
    writeFileSync(join(LEDGER, "archive", "01.journal"), archiveContent);
    writeFileSync(
      join(LEDGER, "2026", "01.journal"),
      "2026-01-01 * New\n    Expenses:Misc    1.00 USD\n    Assets:Checking\n",
    );

    await run({});

    // archive/01.journal was not touched (still has transactions in original order)
    expect(readFileSync(join(LEDGER, "archive", "01.journal"), "utf-8")).toBe(archiveContent);
  });

  test("should skip files whose name is not two-digit month .journal", async () => {
    mkdirSync(join(LEDGER, "2026"), { recursive: true });
    const badContent =
      "2026-02-01 * Later\n    Expenses:Misc    1.00 USD\n    Assets:Checking\n\n2026-01-01 * Earlier\n    Expenses:Misc    2.00 USD\n    Assets:Checking\n";
    writeFileSync(join(LEDGER, "2026", "january.journal"), badContent);
    writeFileSync(
      join(LEDGER, "2026", "01.journal"),
      "2026-01-02 * Tx\n    Expenses:Misc    1.00 USD\n    Assets:Checking\n",
    );

    await run({});

    // january.journal was not touched (still has transactions in original order)
    expect(readFileSync(join(LEDGER, "2026", "january.journal"), "utf-8")).toBe(badContent);
  });

  test("should not beautify any file when hledger check fails", async () => {
    mkdirSync(join(LEDGER, "2026"), { recursive: true });
    const contentBefore =
      "2026-01-28 * Later\n    Expenses:Misc  1.00 USD\n    Assets:Checking\n\n2026-01-01 * Earlier\n    Expenses:Misc  2.00 USD\n    Assets:Checking\n";
    writeFileSync(join(LEDGER, "2026", "01.journal"), contentBefore);
    setMock(1, "", "hledger: Error: account not declared");

    await expect(run({})).rejects.toThrow("account not declared");

    // File was not rewritten (still misaligned and out of order)
    expect(readFileSync(join(LEDGER, "2026", "01.journal"), "utf-8")).toBe(contentBefore);
  });

  test("should succeed when there are no monthly files", async () => {
    // Only non-monthly files in ledger dir
    writeFileSync(join(LEDGER, "main.journal"), "; empty\n");

    const result = await run({});

    expect(result.details.ledgerIsValid).toBe(true);
  });

  test("should be idempotent: running validate twice produces identical content", async () => {
    mkdirSync(join(LEDGER, "2026"), { recursive: true });
    writeFileSync(
      join(LEDGER, "2026", "03.journal"),
      [
        "2026-03-28 * Later",
        "    Expenses:Misc  3.00 USD",
        "    Assets:Checking",
        "",
        "2026-03-01 * Earlier",
        "    Expenses:Misc  1.00 USD",
        "    Assets:Checking",
      ].join("\n") + "\n",
    );

    await run({});
    const afterFirst = readFileSync(join(LEDGER, "2026", "03.journal"), "utf-8");
    await run({});
    const afterSecond = readFileSync(join(LEDGER, "2026", "03.journal"), "utf-8");
    expect(afterSecond).toBe(afterFirst);
  });
});
