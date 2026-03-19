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

const { resolveSafePath } = await import("../utils.js");

type RunResult = { exitCode: number; stdout: string; stderr: string };
let mockRun: ((cmd: string[]) => RunResult) | null = null;

mock.module("../utils.js", () => ({
  resolveSafePath,
  runCommand: async (cmd: string[]) => {
    if (mockRun) return mockRun(cmd);
    return { exitCode: 0, stdout: "", stderr: "" };
  },
}));

const { addTransactionTool } = await import("../add-transaction.js");

afterAll(() => rmSync(BASE, { recursive: true, force: true }));

beforeEach(() => {
  mockRun = null;
  // Clean and recreate ledger dir
  rmSync(LEDGER, { recursive: true, force: true });
  mkdirSync(LEDGER, { recursive: true });
});

const run = (params: any) => addTransactionTool.execute("test", params) as Promise<any>;

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
  mockRun = (cmd) => {
    if (cmd[0] === "hledger" && cmd[1] === "check") hledgerCheckCalled = true;
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  await run(basicParams);
  expect(hledgerCheckCalled).toBe(true);
});

test("throws on validation failure", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  mockRun = (cmd) => {
    if (cmd[0] === "hledger" && cmd[1] === "check") return { exitCode: 1, stdout: "", stderr: "account not declared" };
    return { exitCode: 0, stdout: "", stderr: "" };
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

test("git commit is non-fatal on failure", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  mockRun = (cmd) => {
    if (cmd[0] === "git") return { exitCode: 128, stdout: "", stderr: "not a git repo" };
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const result = await run(basicParams);
  expect(result.content[0].text).toContain("Added transaction");
});

test("uses 4-space indent for postings", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run(basicParams);
  const text = result.content[0].text;
  expect(text).toContain("    Expenses:Food:Groceries");
  expect(text).toContain("    Assets:Checking");
});
