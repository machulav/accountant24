import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-add-tx-"));
const LEDGER = join(BASE, "ledger");

mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  LEDGER_DIR: LEDGER,
  MEMORY_PATH: join(BASE, "memory.md"),
  FILES_DIR: join(BASE, "files"),
  setBaseDir: () => {},
}));

// Mock at Bun.spawn level so real hledger.ts functions execute for coverage.
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

const { addTransactionsTool } = await import("../add-transactions.js");

afterAll(() => {
  Bun.spawn = origSpawn;
  rmSync(BASE, { recursive: true, force: true });
});

beforeEach(() => {
  setMock(0);
  // @ts-expect-error - mocking Bun.spawn
  Bun.spawn = mock(() => makeMockProc(mockExitCode, mockStdout, mockStderr));
  // Clean and recreate ledger dir
  rmSync(LEDGER, { recursive: true, force: true });
  mkdirSync(LEDGER, { recursive: true });
});

afterEach(() => {
  Bun.spawn = origSpawn;
});

const run = (params: any) =>
  addTransactionsTool.execute("test", params, undefined, undefined, undefined as any) as Promise<any>;

const basicTx = {
  date: "2026-03-15",
  payee: "Whole Foods",
  description: "Groceries",
  postings: [
    { account: "Assets:Checking", amount: -45, currency: "USD" },
    { account: "Expenses:Food:Groceries", amount: 45, currency: "USD" },
  ],
};

// ── single transaction (backward compatibility) ─────────────────────

test("formats basic transaction correctly", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run({ transactions: [basicTx] });
  const text = result.content[0].text;
  expect(text).toContain("2026-03-15 * Whole Foods | Groceries");
  expect(text).toMatch(/Expenses:Food:Groceries\s+45\.00 USD/);
  expect(text).toMatch(/Assets:Checking\s+-45\.00 USD/);
});

test("returns diffs in details", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run({ transactions: [basicTx] });
  expect(result.details.diffs).toHaveLength(1);
  expect(result.details.diffs[0].diff).toContain("+");
  expect(result.details.diffs[0].diff).toContain("Whole Foods");
});

test("routes to ledger/YYYY/MM.journal", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  await run({ transactions: [basicTx] });
  const filePath = join(LEDGER, "2026", "03.journal");
  expect(existsSync(filePath)).toBe(true);
  const content = readFileSync(filePath, "utf-8");
  expect(content).toContain("Whole Foods");
});

test("creates parent directories", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  await run({ transactions: [{ ...basicTx, date: "2027-12-01" }] });
  expect(existsSync(join(LEDGER, "2027", "12.journal"))).toBe(true);
});

test("appends to existing monthly file", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  mkdirSync(join(LEDGER, "2026"), { recursive: true });
  writeFileSync(
    join(LEDGER, "2026", "03.journal"),
    "2026-03-01 * Old | Existing\n    Expenses:X    10.00 USD\n    Assets:Y\n",
  );
  await run({ transactions: [basicTx] });
  const content = readFileSync(join(LEDGER, "2026", "03.journal"), "utf-8");
  expect(content).toContain("Old");
  expect(content).toContain("Whole Foods");
});

test("adds include directive for new monthly files", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "; Accountant24 Personal Finances\n");
  await run({ transactions: [basicTx] });
  const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
  expect(main).toContain("include 2026/03.journal");
});

test("does not duplicate existing include", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "include 2026/03.journal\n");
  mkdirSync(join(LEDGER, "2026"), { recursive: true });
  writeFileSync(join(LEDGER, "2026", "03.journal"), "");
  await run({ transactions: [basicTx] });
  const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
  const matches = main.match(/include 2026\/03\.journal/g);
  expect(matches).toHaveLength(1);
});

test("calls hledger check after writing", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  await run({ transactions: [basicTx] });
  expect(Bun.spawn).toHaveBeenCalled();
});

test("throws on validation failure", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  setMock(1, "", "account not declared");
  await expect(run({ transactions: [basicTx] })).rejects.toThrow("account not declared");
});

test("handles tags", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run({
    transactions: [{ ...basicTx, tags: [{ name: "groceries" }, { name: "weekly" }] }],
  });
  const text = result.content[0].text;
  expect(text).toContain("; groceries:");
  expect(text).toContain("; weekly:");
});

test("handles tags with values", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run({
    transactions: [{ ...basicTx, tags: [{ name: "source", value: "manual" }] }],
  });
  const text = result.content[0].text;
  expect(text).toContain("; source: manual");
});

test("handles mixed tags and duplicate names", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run({
    transactions: [
      {
        ...basicTx,
        tags: [
          { name: "weekly" },
          { name: "related_file", value: "a.pdf" },
          { name: "groceries" },
          { name: "related_file", value: "b.pdf" },
        ],
      },
    ],
  });
  const text = result.content[0].text;
  expect(text).toContain("; groceries:");
  expect(text).toContain("; related_file: a.pdf");
  expect(text).toContain("; related_file: b.pdf");
  expect(text).toContain("; weekly:");
});

test("rejects posting without amount", async () => {
  await expect(
    run({
      transactions: [
        {
          ...basicTx,
          postings: [{ account: "Expenses:Food", amount: 45, currency: "USD" }, { account: "Assets:Checking" }],
        },
      ],
    }),
  ).rejects.toThrow("missing amount");
});

test("rejects posting without currency", async () => {
  await expect(
    run({
      transactions: [
        {
          ...basicTx,
          postings: [
            { account: "Expenses:Food", amount: 45, currency: "USD" },
            { account: "Assets:Checking", amount: -45 },
          ],
        },
      ],
    }),
  ).rejects.toThrow("missing currency");
});

test("rejects invalid date", async () => {
  await expect(run({ transactions: [{ ...basicTx, date: "March 15" }] })).rejects.toThrow("Invalid date format");
});

test("rejects insufficient postings", async () => {
  await expect(
    run({
      transactions: [{ ...basicTx, postings: [{ account: "Expenses:Food", amount: 45, currency: "USD" }] }],
    }),
  ).rejects.toThrow("At least 2 postings");
});

test("hledger not found throws error", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  setMock(127);
  await expect(run({ transactions: [basicTx] })).rejects.toThrow("hledger not found");
});

test("uses 4-space indent for postings", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run({ transactions: [basicTx] });
  const text = result.content[0].text;
  expect(text).toContain("    Expenses:Food:Groceries");
  expect(text).toContain("    Assets:Checking");
});

test("should auto-declare missing commodity in commodities.journal", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "account Assets:Checking\n");
  await run({ transactions: [basicTx] });
  const commodities = readFileSync(join(LEDGER, "commodities.journal"), "utf-8");
  expect(commodities).toContain("commodity USD");
});

test("should not duplicate existing commodity declaration", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  writeFileSync(join(LEDGER, "commodities.journal"), "commodity USD\n");
  await run({ transactions: [basicTx] });
  const commodities = readFileSync(join(LEDGER, "commodities.journal"), "utf-8");
  const matches = commodities.match(/commodity USD/g);
  expect(matches).toHaveLength(1);
});

test("should auto-declare multiple missing commodities", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  await run({
    transactions: [
      {
        ...basicTx,
        postings: [
          { account: "Expenses:Food:Groceries", amount: 45, currency: "USD" },
          { account: "Expenses:Travel", amount: 100, currency: "EUR" },
          { account: "Assets:Checking", amount: -145, currency: "USD" },
        ],
      },
    ],
  });
  const commodities = readFileSync(join(LEDGER, "commodities.journal"), "utf-8");
  expect(commodities).toContain("commodity USD");
  expect(commodities).toContain("commodity EUR");
});

test("should declare commodity without format number", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  await run({ transactions: [basicTx] });
  const commodities = readFileSync(join(LEDGER, "commodities.journal"), "utf-8");
  expect(commodities).toContain("commodity USD");
  expect(commodities).not.toContain("commodity 1000");
});

test("should not redeclare commodity that exists with a format", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  writeFileSync(join(LEDGER, "commodities.journal"), "commodity 1,000.00 USD\n");
  await run({ transactions: [basicTx] });
  const commodities = readFileSync(join(LEDGER, "commodities.journal"), "utf-8");
  const matches = commodities.match(/commodity.*USD/g);
  expect(matches).toHaveLength(1);
});

test("should re-throw unexpected validation errors", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  Bun.spawn = mock(() => {
    throw new TypeError("unexpected");
  });
  await expect(run({ transactions: [basicTx] })).rejects.toThrow("unexpected");
});

// ── single transaction response format ──────────────────────────────

test("should say 'Transaction saved' for single transaction", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run({ transactions: [basicTx] });
  expect(result.content[0].text).toStartWith("Transaction saved to");
});

// ── batch transactions ──────────────────────────────────────────────

describe("batch transactions", () => {
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

  test("should save multiple transactions to the same monthly file", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await run({ transactions: [basicTx, tx2] });
    const content = readFileSync(join(LEDGER, "2026", "03.journal"), "utf-8");
    expect(content).toContain("Whole Foods");
    expect(content).toContain("Starbucks");
    expect(result.details.transactions).toHaveLength(2);
    expect(result.details.diffs).toHaveLength(1);
  });

  test("should save transactions to different monthly files", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await run({ transactions: [basicTx, tx3] });
    expect(existsSync(join(LEDGER, "2026", "03.journal"))).toBe(true);
    expect(existsSync(join(LEDGER, "2026", "04.journal"))).toBe(true);
    const marchContent = readFileSync(join(LEDGER, "2026", "03.journal"), "utf-8");
    const aprilContent = readFileSync(join(LEDGER, "2026", "04.journal"), "utf-8");
    expect(marchContent).toContain("Whole Foods");
    expect(aprilContent).toContain("Landlord");
    expect(result.details.diffs).toHaveLength(2);
  });

  test("should add include directives for all new monthly files", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    await run({ transactions: [basicTx, tx3] });
    const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
    expect(main).toContain("include 2026/03.journal");
    expect(main).toContain("include 2026/04.journal");
  });

  test("should validate all inputs before writing any files", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    await expect(
      run({
        transactions: [basicTx, { ...tx2, date: "bad-date" }],
      }),
    ).rejects.toThrow("Transaction 2: Invalid date format");
    // First transaction's file should NOT have been created
    expect(existsSync(join(LEDGER, "2026", "03.journal"))).toBe(false);
  });

  test("should run hledger check only once for the entire batch", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    await run({ transactions: [basicTx, tx2, tx3] });
    expect(Bun.spawn).toHaveBeenCalledTimes(1);
  });

  test("should collect commodities from all transactions", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    await run({ transactions: [basicTx, tx3] });
    const commodities = readFileSync(join(LEDGER, "commodities.journal"), "utf-8");
    expect(commodities).toContain("commodity USD");
    expect(commodities).toContain("commodity EUR");
  });

  test("should preserve input order in result", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await run({ transactions: [tx3, basicTx, tx2] });
    expect(result.details.transactions[0].transactionText).toContain("Landlord");
    expect(result.details.transactions[1].transactionText).toContain("Whole Foods");
    expect(result.details.transactions[2].transactionText).toContain("Starbucks");
  });

  test("should format response with count for multiple transactions", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    const result = await run({ transactions: [basicTx, tx2] });
    expect(result.content[0].text).toContain("2 transactions saved:");
    expect(result.content[0].text).toContain("1.");
    expect(result.content[0].text).toContain("2.");
  });
});

// ── rendering wiring ──────────────────────────────────────────────

const mockTheme = { fg: (_c: string, t: string) => t, bold: (t: string) => t } as any;

describe("renderResult wiring", () => {
  test("should return empty when details is missing", () => {
    const result = { content: [{ type: "text" as const, text: "saved" }], details: undefined } as any;
    // biome-ignore lint/style/noNonNullAssertion: renderResult is defined
    const component = addTransactionsTool.renderResult!(
      result,
      { expanded: true, isPartial: false },
      mockTheme,
      {} as any,
    );
    expect(component.render(120)).toEqual([]);
  });

  test("should show diffs per file when expanded", () => {
    const result = {
      content: [{ type: "text" as const, text: "saved" }],
      details: {
        transactions: [{ transactionText: "tx", fullFilePath: "/path/file.journal" }],
        ledgerIsValid: true,
        diffs: [{ fullFilePath: "/path/file.journal", diff: "+1 new tx" }],
      },
    };
    // biome-ignore lint/style/noNonNullAssertion: renderResult is defined
    const component = addTransactionsTool.renderResult!(
      result,
      { expanded: true, isPartial: false },
      mockTheme,
      {} as any,
    );
    const output = component.render(120).join("\n");
    expect(output).toContain("/path/file.journal");
  });

  test("should show multiple diffs for batch across files", () => {
    const result = {
      content: [{ type: "text" as const, text: "saved" }],
      details: {
        transactions: [
          { transactionText: "tx1", fullFilePath: "/path/03.journal" },
          { transactionText: "tx2", fullFilePath: "/path/04.journal" },
        ],
        ledgerIsValid: true,
        diffs: [
          { fullFilePath: "/path/03.journal", diff: "+march tx" },
          { fullFilePath: "/path/04.journal", diff: "+april tx" },
        ],
      },
    };
    // biome-ignore lint/style/noNonNullAssertion: renderResult is defined
    const component = addTransactionsTool.renderResult!(
      result,
      { expanded: true, isPartial: false },
      mockTheme,
      {} as any,
    );
    const output = component.render(120).join("\n");
    expect(output).toContain("/path/03.journal");
    expect(output).toContain("/path/04.journal");
  });
});
