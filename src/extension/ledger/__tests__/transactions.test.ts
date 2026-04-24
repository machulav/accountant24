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

const { addTransactions } = await import("../transactions.js");

/** Helper: add a single transaction and return a flat result for backward-compatible test assertions. */
async function addTransaction(params: any, signal?: AbortSignal) {
  const r = await addTransactions([params], signal);
  const tx = r.transactions[0];
  return {
    transactionText: tx.transactionText,
    fullFilePath: tx.fullFilePath,
    ledgerIsValid: r.ledgerIsValid,
    diff: r.diffs[0].diff,
  };
}

beforeEach(() => {
  rmSync(LEDGER, { recursive: true, force: true });
  mkdirSync(LEDGER, { recursive: true });
  // @ts-expect-error - mocking Bun.spawn
  Bun.spawn = mock(() => makeMockProc(0));
});

afterEach(() => {
  Bun.spawn = origSpawn;
});

function findLine(text: string, search: string): string {
  const line = text.split("\n").find((l: string) => l.includes(search));
  if (!line) throw new Error(`Line containing "${search}" not found in:\n${text}`);
  return line;
}

const basicParams = {
  date: "2026-03-15",
  payee: "Whole Foods",
  description: "Groceries",
  postings: [
    { account: "Assets:Checking", amount: -45, currency: "USD" },
    { account: "Expenses:Food:Groceries", amount: 45, currency: "USD" },
  ],
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

  test("should reject posting without amount", async () => {
    await expect(
      addTransaction({
        ...basicParams,
        postings: [{ account: "Expenses:Food", amount: 45, currency: "USD" }, { account: "Assets:Checking" }] as any,
      }),
    ).rejects.toThrow("missing amount");
  });

  test("should reject posting without currency", async () => {
    await expect(
      addTransaction({
        ...basicParams,
        postings: [
          { account: "Expenses:Food", amount: 45, currency: "USD" },
          { account: "Assets:Checking", amount: -45 },
        ] as any,
      }),
    ).rejects.toThrow("missing currency");
  });

  test("should accept 2 postings with explicit amounts", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction(basicParams);
    expect(result.ledgerIsValid).toBe(true);
  });
});

// ── Transaction formatting ──────────────────────────────────────────

describe("addTransaction() formatting", () => {
  test("should format header as DATE * PAYEE | DESCRIPTION", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction(basicParams);
    expect(result.transactionText).toStartWith("2026-03-15 * Whole Foods | Groceries");
  });

  test("should format amount with 2 decimal places and currency", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction(basicParams);
    expect(result.transactionText).toMatch(/Expenses:Food:Groceries\s+45\.00 USD/);
  });

  test("should align first digit of positive amount at column 70", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction(basicParams);
    const line = findLine(result.transactionText, "Expenses:Food:Groceries");
    expect(line[69]).toBe("4"); // first digit of 45.00 at 0-indexed 69
  });

  test("should align first digit of negative amount at column 70 with sign at 69", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction(basicParams);
    const negativeLine = findLine(result.transactionText, "-45.00");
    const positiveLine = findLine(result.transactionText, " 45.00");
    expect(negativeLine[69]).toBe("4");
    expect(positiveLine[69]).toBe("4");
    expect(negativeLine[68]).toBe("-");
  });

  test("should order negative amounts before positive", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction({
      ...basicParams,
      postings: [
        { account: "Expenses:Food", amount: 30, currency: "USD" },
        { account: "Assets:Savings", amount: -30, currency: "USD" },
      ],
    });
    const lines = result.transactionText.split("\n");
    const postingLines = lines.filter((l: string) => l.startsWith("    ") && !l.trimStart().startsWith(";"));
    expect(postingLines[0]).toContain("Assets:Savings"); // negative
    expect(postingLines[1]).toContain("Expenses:Food"); // positive
  });

  test("should preserve input order within same sign group", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction({
      ...basicParams,
      postings: [
        { account: "Expenses:Food", amount: 20, currency: "USD" },
        { account: "Expenses:Transport", amount: 10, currency: "USD" },
        { account: "Assets:Checking", amount: -30, currency: "USD" },
      ],
    });
    const lines = result.transactionText.split("\n");
    const postingLines = lines.filter((l: string) => l.startsWith("    ") && !l.trimStart().startsWith(";"));
    expect(postingLines[0]).toContain("Assets:Checking"); // negative first
    expect(postingLines[1]).toContain("Expenses:Food"); // positive, original order preserved
    expect(postingLines[2]).toContain("Expenses:Transport"); // positive, original order preserved
  });

  test("should group zero amount with positives, not negatives", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction({
      ...basicParams,
      postings: [
        { account: "Expenses:Food", amount: 0, currency: "USD" },
        { account: "Assets:Checking", amount: -10, currency: "USD" },
        { account: "Assets:Savings", amount: 10, currency: "USD" },
      ],
    });
    const lines = result.transactionText.split("\n");
    const postingLines = lines.filter((l: string) => l.startsWith("    ") && !l.trimStart().startsWith(";"));
    expect(postingLines[0]).toContain("Assets:Checking"); // negative first
    expect(postingLines[1]).toContain("Expenses:Food"); // zero groups with positives
    expect(postingLines[2]).toContain("Assets:Savings"); // positive
  });

  test("should render zero amount as 0.00 without sign", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction({
      ...basicParams,
      postings: [
        { account: "Expenses:Food", amount: 0, currency: "USD" },
        { account: "Assets:Checking", amount: 0, currency: "USD" },
      ],
    });
    const line = findLine(result.transactionText, "Expenses:Food");
    expect(line).toMatch(/Expenses:Food\s+0\.00 USD/);
    expect(line).not.toContain("-0.00");
  });

  test("should use minimum 2-space gap when account name is very long", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const longAccount = "Expenses:Food:Groceries:Organic:Vegetables:Imported:Premium:Extra";
    expect(longAccount).toHaveLength(65);
    const result = await addTransaction({
      ...basicParams,
      postings: [
        { account: longAccount, amount: 45, currency: "USD" },
        { account: "Assets:Checking", amount: -45, currency: "USD" },
      ],
    });
    const line = findLine(result.transactionText, longAccount);
    const amountIdx = line.indexOf("45.00");
    const prefixLen = 4 + longAccount.length;
    expect(amountIdx - prefixLen).toBe(2);
  });

  test("should align amounts consistently regardless of magnitude", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction({
      ...basicParams,
      postings: [
        { account: "Expenses:Small", amount: 0.01, currency: "USD" },
        { account: "Expenses:Large", amount: 99999.99, currency: "USD" },
        { account: "Assets:Checking", amount: -100000, currency: "USD" },
      ],
    });
    const smallLine = findLine(result.transactionText, "Expenses:Small");
    const largeLine = findLine(result.transactionText, "Expenses:Large");
    expect(smallLine[69]).toBe("0"); // 0.01
    expect(largeLine[69]).toBe("9"); // 99999.99
  });

  test("should place tags before postings", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction({
      ...basicParams,
      tags: [{ name: "groceries" }],
    });
    const lines = result.transactionText.split("\n");
    const tagIdx = lines.findIndex((l: string) => l.includes("; groceries:"));
    const postingIdx = lines.findIndex((l: string) => l.includes("Expenses:Food"));
    expect(tagIdx).toBeGreaterThan(0);
    expect(tagIdx).toBeLessThan(postingIdx);
  });

  test("should render single tag on its own line", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction({
      ...basicParams,
      tags: [{ name: "groceries" }],
    });
    const lines = result.transactionText.split("\n");
    const tagLines = lines.filter((l: string) => l.trimStart().startsWith(";"));
    expect(tagLines).toHaveLength(1);
    expect(tagLines[0]).toBe("    ; groceries:");
  });

  test("should render each tag on its own line", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction({
      ...basicParams,
      tags: [{ name: "groceries" }, { name: "weekly" }],
    });
    const lines = result.transactionText.split("\n");
    expect(lines.filter((l: string) => l.includes("; groceries:"))).toHaveLength(1);
    expect(lines.filter((l: string) => l.includes("; weekly:"))).toHaveLength(1);
  });

  test("should sort tags alphabetically by name", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction({
      ...basicParams,
      tags: [{ name: "zebra" }, { name: "alpha" }, { name: "middle" }],
    });
    const lines = result.transactionText.split("\n");
    const tagLines = lines.filter((l: string) => l.trimStart().startsWith(";"));
    expect(tagLines[0]).toContain("alpha:");
    expect(tagLines[1]).toContain("middle:");
    expect(tagLines[2]).toContain("zebra:");
  });

  test("should sort tags case-insensitively", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction({
      ...basicParams,
      tags: [{ name: "Zebra" }, { name: "alpha" }, { name: "Middle" }],
    });
    const lines = result.transactionText.split("\n");
    const tagLines = lines.filter((l: string) => l.trimStart().startsWith(";"));
    expect(tagLines[0]).toContain("alpha:");
    expect(tagLines[1]).toContain("Middle:");
    expect(tagLines[2]).toContain("Zebra:");
  });

  test("should render tags with values as key-value comments", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction({
      ...basicParams,
      tags: [
        { name: "source", value: "manual" },
        { name: "ref", value: "123" },
      ],
    });
    expect(result.transactionText).toContain("    ; ref: 123");
    expect(result.transactionText).toContain("    ; source: manual");
  });

  test("should allow duplicate tag names with different values", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransaction({
      ...basicParams,
      tags: [
        { name: "related_file", value: "files/receipt1.pdf" },
        { name: "related_file", value: "files/receipt2.pdf" },
      ],
    });
    const lines = result.transactionText.split("\n");
    const relatedLines = lines.filter((l: string) => l.includes("; related_file:"));
    expect(relatedLines).toHaveLength(2);
    expect(relatedLines[0]).toContain("files/receipt1.pdf");
    expect(relatedLines[1]).toContain("files/receipt2.pdf");
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

  test("should auto-declare missing commodity in commodities.journal", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "account Assets:Checking\n");
    await addTransaction(basicParams);
    const commodities = readFileSync(join(LEDGER, "commodities.journal"), "utf-8");
    expect(commodities).toContain("commodity USD");
  });

  test("should not duplicate existing commodity declaration", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    writeFileSync(join(LEDGER, "commodities.journal"), "commodity USD\n");
    await addTransaction(basicParams);
    const commodities = readFileSync(join(LEDGER, "commodities.journal"), "utf-8");
    const matches = commodities.match(/commodity USD/g);
    expect(matches).toHaveLength(1);
  });

  test("should not redeclare commodity that exists with a format", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    writeFileSync(join(LEDGER, "commodities.journal"), "commodity 1,000.00 USD\n");
    await addTransaction(basicParams);
    const commodities = readFileSync(join(LEDGER, "commodities.journal"), "utf-8");
    const matches = commodities.match(/commodity.*USD/g);
    expect(matches).toHaveLength(1);
  });

  test("should declare multiple missing commodities", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    await addTransaction({
      ...basicParams,
      postings: [
        { account: "Expenses:Food", amount: 45, currency: "USD" },
        { account: "Expenses:Travel", amount: 100, currency: "EUR" },
        { account: "Assets:Checking", amount: -145, currency: "USD" },
      ],
    });
    const commodities = readFileSync(join(LEDGER, "commodities.journal"), "utf-8");
    expect(commodities).toContain("commodity USD");
    expect(commodities).toContain("commodity EUR");
  });

  test("should add include commodities.journal to main.journal if missing", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "; Accountant24\n");
    await addTransaction(basicParams);
    const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
    expect(main).toContain("include commodities.journal");
  });

  test("should not duplicate include commodities.journal when already present", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "include commodities.journal\n; Accountant24\n");
    await addTransaction(basicParams);
    const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
    const matches = main.match(/include commodities\.journal/g);
    expect(matches).toHaveLength(1);
  });

  test("should create commodities.journal when it does not exist", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    expect(existsSync(join(LEDGER, "commodities.journal"))).toBe(false);
    await addTransaction(basicParams);
    expect(existsSync(join(LEDGER, "commodities.journal"))).toBe(true);
    const commodities = readFileSync(join(LEDGER, "commodities.journal"), "utf-8");
    expect(commodities).toContain("commodity USD");
  });

  test("should append new commodity to existing commodities.journal", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    writeFileSync(join(LEDGER, "commodities.journal"), "commodity USD\n");
    await addTransaction({
      ...basicParams,
      postings: [
        { account: "Expenses:Travel", amount: 100, currency: "EUR" },
        { account: "Assets:Checking", amount: -100, currency: "EUR" },
      ],
    });
    const commodities = readFileSync(join(LEDGER, "commodities.journal"), "utf-8");
    expect(commodities).toContain("commodity USD");
    expect(commodities).toContain("commodity EUR");
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

// ── Batch: addTransactions() ───────────────────────────────────────

const tx2 = {
  date: "2026-03-20",
  payee: "Starbucks",
  description: "Coffee",
  postings: [
    { account: "Assets:Checking", amount: -5, currency: "USD" },
    { account: "Expenses:Food:Coffee", amount: 5, currency: "USD" },
  ],
};

const tx3 = {
  date: "2026-04-01",
  payee: "Landlord",
  description: "Rent",
  postings: [
    { account: "Assets:Checking", amount: -1000, currency: "EUR" },
    { account: "Expenses:Housing:Rent", amount: 1000, currency: "EUR" },
  ],
};

describe("addTransactions() batch operations", () => {
  test("should group transactions by monthly file", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransactions([basicParams, tx2]);
    const content = readFileSync(join(LEDGER, "2026", "03.journal"), "utf-8");
    expect(content).toContain("Whole Foods");
    expect(content).toContain("Starbucks");
    expect(result.diffs).toHaveLength(1);
  });

  test("should write to multiple files", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransactions([basicParams, tx3]);
    expect(existsSync(join(LEDGER, "2026", "03.journal"))).toBe(true);
    expect(existsSync(join(LEDGER, "2026", "04.journal"))).toBe(true);
    expect(result.diffs).toHaveLength(2);
  });

  test("should validate all inputs before writing any files", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    await expect(addTransactions([basicParams, { ...tx2, date: "bad" }])).rejects.toThrow(
      "Transaction 2: Invalid date format",
    );
    expect(existsSync(join(LEDGER, "2026", "03.journal"))).toBe(false);
  });

  test("should not prefix error with index for single-item batch", async () => {
    await expect(addTransactions([{ ...basicParams, date: "bad" }])).rejects.toThrow("Invalid date format: bad");
  });

  test("should run hledger check once for the entire batch", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    await addTransactions([basicParams, tx2, tx3]);
    expect(Bun.spawn).toHaveBeenCalledTimes(1);
  });

  test("should collect all commodities across batch", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    await addTransactions([basicParams, tx3]);
    const commodities = readFileSync(join(LEDGER, "commodities.journal"), "utf-8");
    expect(commodities).toContain("commodity USD");
    expect(commodities).toContain("commodity EUR");
  });

  test("should update main.journal includes for all new files in one pass", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    await addTransactions([basicParams, tx3]);
    const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
    expect(main).toContain("include 2026/03.journal");
    expect(main).toContain("include 2026/04.journal");
  });

  test("should preserve transaction order in result", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransactions([tx3, basicParams, tx2]);
    expect(result.transactions[0].transactionText).toContain("Landlord");
    expect(result.transactions[1].transactionText).toContain("Whole Foods");
    expect(result.transactions[2].transactionText).toContain("Starbucks");
  });

  test("should separate transactions in same file with blank line", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    await addTransactions([basicParams, tx2]);
    const content = readFileSync(join(LEDGER, "2026", "03.journal"), "utf-8");
    expect(content).toContain("Groceries\n");
    expect(content).toContain("\n\n2026-03-20");
  });

  test("should append batch to existing monthly file", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    mkdirSync(join(LEDGER, "2026"), { recursive: true });
    writeFileSync(
      join(LEDGER, "2026", "03.journal"),
      "2026-03-01 * Old | Existing\n    Expenses:X  10.00 USD\n    Assets:Y  -10.00 USD\n",
    );
    await addTransactions([basicParams, tx2]);
    const content = readFileSync(join(LEDGER, "2026", "03.journal"), "utf-8");
    expect(content).toContain("Old");
    expect(content).toContain("Whole Foods");
    expect(content).toContain("Starbucks");
  });

  test("should include all file paths in hledger error for multi-file batch", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(1, "", "unbalanced transaction"));
    await expect(addTransactions([basicParams, tx3])).rejects.toThrow(/2026.*03\.journal.*2026.*04\.journal/);
  });

  test("should return correct fullFilePath in each diff entry", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransactions([basicParams, tx3]);
    expect(result.diffs[0].fullFilePath).toBe(join(LEDGER, "2026", "03.journal"));
    expect(result.diffs[1].fullFilePath).toBe(join(LEDGER, "2026", "04.journal"));
  });

  test("should include all batch transactions in diff for same file", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await addTransactions([basicParams, tx2]);
    const diff = result.diffs[0].diff;
    expect(diff).toContain("Whole Foods");
    expect(diff).toContain("Starbucks");
  });
});
