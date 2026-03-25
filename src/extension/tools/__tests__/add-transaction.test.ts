import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-add-tx-"));
const LEDGER = join(BASE, "ledger");

mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  LEDGER_DIR: LEDGER,
  MEMORY_PATH: join(BASE, "memory.json"),
}));

const utils = await import("../hledger.js");
const { HledgerNotFoundError, HledgerCommandError } = utils;

let mockHledgerCheck: (() => void) | null = null;

mock.module("../hledger.js", () => ({
  ...utils,
  hledgerCheck: async () => {
    if (mockHledgerCheck) return mockHledgerCheck();
  },
}));

const { addTransactionTool } = await import("../add-transaction.js");

afterAll(() => rmSync(BASE, { recursive: true, force: true }));

beforeEach(() => {
  mockHledgerCheck = null;
  // Clean and recreate ledger dir
  rmSync(LEDGER, { recursive: true, force: true });
  mkdirSync(LEDGER, { recursive: true });
});

const run = (params: any) =>
  addTransactionTool.execute("test", params, undefined, undefined, undefined as any) as Promise<any>;

const basicParams = {
  date: "2026-03-15",
  payee: "Whole Foods",
  narration: "Groceries",
  postings: [{ account: "Expenses:Food:Groceries", amount: 45, currency: "USD" }, { account: "Assets:Checking" }],
};

test("formats basic transaction correctly", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run(basicParams);
  const text = result.content[0].text;
  expect(text).toContain("2026-03-15 * Whole Foods | Groceries");
  expect(text).toContain("Expenses:Food:Groceries    45.00 USD");
  expect(text).toContain("Assets:Checking");
});

test("routes to ledger/YYYY/MM.journal", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  await run(basicParams);
  const filePath = join(LEDGER, "2026", "03.journal");
  expect(existsSync(filePath)).toBe(true);
  const content = readFileSync(filePath, "utf-8");
  expect(content).toContain("Whole Foods");
});

test("creates parent directories", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  await run({ ...basicParams, date: "2027-12-01" });
  expect(existsSync(join(LEDGER, "2027", "12.journal"))).toBe(true);
});

test("appends to existing monthly file", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  mkdirSync(join(LEDGER, "2026"), { recursive: true });
  writeFileSync(
    join(LEDGER, "2026", "03.journal"),
    "2026-03-01 * Old | Existing\n    Expenses:X    10.00 USD\n    Assets:Y\n",
  );
  await run(basicParams);
  const content = readFileSync(join(LEDGER, "2026", "03.journal"), "utf-8");
  expect(content).toContain("Old");
  expect(content).toContain("Whole Foods");
});

test("adds include directive for new monthly files", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "; Accountant24 Personal Finances\n");
  await run(basicParams);
  const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
  expect(main).toContain("include 2026/03.journal");
});

test("does not duplicate existing include", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "include 2026/03.journal\n");
  // File already exists, so include should not be re-added
  mkdirSync(join(LEDGER, "2026"), { recursive: true });
  writeFileSync(join(LEDGER, "2026", "03.journal"), "");
  await run(basicParams);
  const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
  const matches = main.match(/include 2026\/03\.journal/g);
  expect(matches).toHaveLength(1);
});

test("calls hledger check after writing", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  let hledgerCheckCalled = false;
  mockHledgerCheck = () => {
    hledgerCheckCalled = true;
  };
  await run(basicParams);
  expect(hledgerCheckCalled).toBe(true);
});

test("throws on validation failure", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  mockHledgerCheck = () => {
    throw new HledgerCommandError("", "account not declared");
  };
  await expect(run(basicParams)).rejects.toThrow("Validation failed");
});

test("handles tags", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run({
    ...basicParams,
    tags: ["groceries", "weekly"],
  });
  const text = result.content[0].text;
  expect(text).toContain("; groceries:, weekly:");
});

test("handles metadata", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run({
    ...basicParams,
    metadata: { source: "manual" },
  });
  const text = result.content[0].text;
  expect(text).toContain("; source: manual");
});

test("handles tags and metadata together", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run({
    ...basicParams,
    tags: ["groceries", "weekly"],
    metadata: { source: "manual" },
  });
  const text = result.content[0].text;
  expect(text).toContain("; groceries:, weekly:");
  expect(text).toContain("; source: manual");
});

test("requires currency when amount present", async () => {
  await expect(
    run({
      ...basicParams,
      postings: [{ account: "Expenses:Food", amount: 45 }, { account: "Assets:Checking" }],
    }),
  ).rejects.toThrow("has amount but no currency");
});

test("rejects invalid date", async () => {
  await expect(run({ ...basicParams, date: "March 15" })).rejects.toThrow("Invalid date format");
});

test("rejects insufficient postings", async () => {
  await expect(
    run({
      ...basicParams,
      postings: [{ account: "Expenses:Food", amount: 45, currency: "USD" }],
    }),
  ).rejects.toThrow("At least 2 postings");
});

test("rejects multiple postings without amount", async () => {
  await expect(
    run({
      ...basicParams,
      postings: [{ account: "Expenses:Food" }, { account: "Assets:Checking" }, { account: "Assets:Savings" }],
    }),
  ).rejects.toThrow("At most one posting may omit the amount");
});

test("hledger not found is non-fatal", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  mockHledgerCheck = () => {
    throw new HledgerNotFoundError();
  };
  const result = await run(basicParams);
  expect(result.content[0].text).toContain("Added transaction");
  expect(result.content[0].text).toContain("hledger not found");
});

test("uses 4-space indent for postings", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run(basicParams);
  const text = result.content[0].text;
  expect(text).toContain("    Expenses:Food:Groceries");
  expect(text).toContain("    Assets:Checking");
});

test("should auto-declare missing commodity in main.journal", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "account Assets:Checking\n");
  await run(basicParams);
  const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
  expect(main).toContain("commodity USD");
});

test("should not duplicate existing commodity declaration", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "commodity USD\naccount Assets:Checking\n");
  await run(basicParams);
  const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
  const matches = main.match(/commodity USD/g);
  expect(matches).toHaveLength(1);
});

test("should auto-declare multiple missing commodities", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  await run({
    ...basicParams,
    postings: [
      { account: "Expenses:Food:Groceries", amount: 45, currency: "USD" },
      { account: "Expenses:Travel", amount: 100, currency: "EUR" },
      { account: "Assets:Checking" },
    ],
  });
  const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
  expect(main).toContain("commodity USD");
  expect(main).toContain("commodity EUR");
});

test("should declare commodity without format number", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  await run(basicParams);
  const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
  expect(main).toContain("commodity USD");
  expect(main).not.toContain("commodity 1000");
});

test("should not redeclare commodity that exists with a format", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "commodity 1,000.00 USD\n");
  await run(basicParams);
  const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
  const matches = main.match(/commodity.*USD/g);
  expect(matches).toHaveLength(1);
});

test("should skip commodity declaration for postings without currency", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  await run({
    ...basicParams,
    postings: [{ account: "Expenses:Food:Groceries", amount: 45, currency: "USD" }, { account: "Assets:Checking" }],
  });
  const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
  expect(main).toContain("commodity USD");
  const commodityLines = main.split("\n").filter((l: string) => l.startsWith("commodity"));
  expect(commodityLines).toHaveLength(1);
});
