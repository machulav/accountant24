import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-transactions-"));
const LEDGER = join(BASE, "ledger");

mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  LEDGER_DIR: LEDGER,
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

const { addTransaction } = await import("../transactions.js");

beforeEach(() => {
  rmSync(LEDGER, { recursive: true, force: true });
  mkdirSync(LEDGER, { recursive: true });
  // @ts-expect-error - mocking Bun.spawn
  Bun.spawn = mock(() => makeMockProc(0));
});

afterEach(() => {
  Bun.spawn = origSpawn;
});

const basicParams = {
  date: "2026-03-15",
  payee: "Whole Foods",
  narration: "Groceries",
  postings: [{ account: "Expenses:Food:Groceries", amount: 45, currency: "USD" }, { account: "Assets:Checking" }],
};

// ── Input validation ────────────────────────────────────────────────

describe("addTransaction() input validation", () => {
  test("should reject date not in YYYY-MM-DD format", async () => {
    await expect(addTransaction({ ...basicParams, date: "March 15" })).rejects.toThrow("Invalid date format");
  });

  test("should reject date with single-digit month", async () => {
    await expect(addTransaction({ ...basicParams, date: "2026-3-15" })).rejects.toThrow("Invalid date format");
  });

  test("should reject fewer than 2 postings", async () => {
    await expect(
      addTransaction({
        ...basicParams,
        postings: [{ account: "Expenses:Food", amount: 45, currency: "USD" }],
      }),
    ).rejects.toThrow("At least 2 postings are required");
  });

  test("should reject multiple postings without amount", async () => {
    await expect(
      addTransaction({
        ...basicParams,
        postings: [{ account: "Expenses:Food" }, { account: "Assets:Checking" }, { account: "Assets:Savings" }],
      }),
    ).rejects.toThrow("At most one posting may omit the amount");
  });

  test("should reject posting with amount but no currency", async () => {
    await expect(
      addTransaction({
        ...basicParams,
        postings: [{ account: "Expenses:Food", amount: 45 }, { account: "Assets:Checking" }],
      }),
    ).rejects.toThrow("has amount but no currency");
  });

  test("should accept exactly 2 postings where one omits amount", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction(basicParams);
    expect(result.ledgerIsValid).toBe(true);
  });
});

// ── Transaction formatting ──────────────────────────────────────────

describe("addTransaction() formatting", () => {
  test("should format header as DATE * PAYEE | NARRATION", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction(basicParams);
    expect(result.transactionText).toStartWith("2026-03-15 * Whole Foods | Groceries");
  });

  test("should format amount with 2 decimal places and currency", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction(basicParams);
    expect(result.transactionText).toContain("    Expenses:Food:Groceries    45.00 USD");
  });

  test("should format posting without amount as account only", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction(basicParams);
    expect(result.transactionText).toContain("    Assets:Checking");
    // The balancing posting should NOT have an amount
    const lines = result.transactionText.split("\n");
    const checkingLine = lines.find((l: string) => l.includes("Assets:Checking"));
    expect(checkingLine).toBe("    Assets:Checking");
  });

  test("should include tags with colon suffix", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction({ ...basicParams, tags: ["groceries", "weekly"] });
    expect(result.transactionText).toContain("    ; groceries:, weekly:");
  });

  test("should include metadata as key-value comments", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction({ ...basicParams, metadata: { source: "manual", ref: "123" } });
    expect(result.transactionText).toContain("    ; source: manual");
    expect(result.transactionText).toContain("    ; ref: 123");
  });

  test("should use 4-space indent for all posting lines", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction(basicParams);
    const lines = result.transactionText.split("\n").slice(1); // skip header
    for (const line of lines) {
      expect(line).toStartWith("    ");
    }
  });
});

// ── File routing ────────────────────────────────────────────────────

describe("addTransaction() file routing", () => {
  test("should write to ledger/YYYY/MM.journal based on date", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    await addTransaction(basicParams);
    expect(existsSync(join(LEDGER, "2026", "03.journal"))).toBe(true);
    const content = readFileSync(join(LEDGER, "2026", "03.journal"), "utf-8");
    expect(content).toContain("Whole Foods");
  });

  test("should create parent directories if missing", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    await addTransaction({ ...basicParams, date: "2027-12-01" });
    expect(existsSync(join(LEDGER, "2027", "12.journal"))).toBe(true);
  });

  test("should append to existing monthly file with separator", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    mkdirSync(join(LEDGER, "2026"), { recursive: true });
    writeFileSync(
      join(LEDGER, "2026", "03.journal"),
      "2026-03-01 * Old | Existing\n    Expenses:X    10.00 USD\n    Assets:Y\n",
    );
    await addTransaction(basicParams);
    const content = readFileSync(join(LEDGER, "2026", "03.journal"), "utf-8");
    expect(content).toContain("Old");
    expect(content).toContain("Whole Foods");
  });

  test("should return the full file path in result", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction(basicParams);
    expect(result.fullFilePath).toBe(join(LEDGER, "2026", "03.journal"));
  });
});

// ── main.journal management ─────────────────────────────────────────

describe("addTransaction() main.journal management", () => {
  test("should add include directive for new monthly file", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "; Accountant24\n");
    await addTransaction(basicParams);
    const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
    expect(main).toContain("include 2026/03.journal");
  });

  test("should not duplicate existing include directive", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "include 2026/03.journal\n");
    mkdirSync(join(LEDGER, "2026"), { recursive: true });
    writeFileSync(join(LEDGER, "2026", "03.journal"), "");
    await addTransaction(basicParams);
    const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
    const matches = main.match(/include 2026\/03\.journal/g);
    expect(matches).toHaveLength(1);
  });

  test("should auto-declare missing commodity", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "account Assets:Checking\n");
    await addTransaction(basicParams);
    const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
    expect(main).toContain("commodity USD");
  });

  test("should not duplicate existing commodity declaration", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "commodity USD\n");
    await addTransaction(basicParams);
    const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
    const matches = main.match(/commodity USD/g);
    expect(matches).toHaveLength(1);
  });

  test("should not redeclare commodity that exists with a format", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "commodity 1,000.00 USD\n");
    await addTransaction(basicParams);
    const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
    const matches = main.match(/commodity.*USD/g);
    expect(matches).toHaveLength(1);
  });

  test("should declare multiple missing commodities", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    await addTransaction({
      ...basicParams,
      postings: [
        { account: "Expenses:Food", amount: 45, currency: "USD" },
        { account: "Expenses:Travel", amount: 100, currency: "EUR" },
        { account: "Assets:Checking" },
      ],
    });
    const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
    expect(main).toContain("commodity USD");
    expect(main).toContain("commodity EUR");
  });
});

// ── Diff generation ─────────────────────────────────────────────────

describe("addTransaction() diff", () => {
  test("should return diff showing added transaction lines", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction(basicParams);
    expect(result.diff).toContain("+");
    expect(result.diff).toContain("Whole Foods");
  });

  test("should not have removed lines when writing to empty file", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction(basicParams);
    // All diff lines should be additions (start with +) — no removals (start with -)
    const diffLines = result.diff.split("\n").filter((l: string) => l.trim());
    for (const line of diffLines) {
      expect(line).toMatch(/^\+/);
    }
  });
});

// ── Validation (hledger check) ──────────────────────────────────────

describe("addTransaction() hledger validation", () => {
  test("should throw with stderr when hledger check fails", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(1, "", "account not declared"));
    await expect(addTransaction(basicParams)).rejects.toThrow("account not declared");
  });

  test("should throw when hledger is not found", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(127));
    await expect(addTransaction(basicParams)).rejects.toThrow("hledger not found");
  });

  test("should re-throw unexpected errors from hledger", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    Bun.spawn = mock(() => {
      throw new TypeError("unexpected");
    });
    await expect(addTransaction(basicParams)).rejects.toThrow("unexpected");
  });

  test("should set ledgerIsValid=true on success", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction(basicParams);
    expect(result.ledgerIsValid).toBe(true);
  });
});
