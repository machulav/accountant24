import { test, expect, afterAll, beforeEach, mock } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BASE = mkdtempSync(join(tmpdir(), "beanclaw-add-tx-"));
const LEDGER = join(BASE, "ledger");

mock.module("../../config.js", () => ({
  BEANCLAW_HOME: BASE,
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
  postings: [
    { account: "Expenses:Food:Groceries", amount: 45, currency: "USD" },
    { account: "Assets:Checking" },
  ],
};

test("formats basic transaction correctly", async () => {
  writeFileSync(join(LEDGER, "main.beancount"), "");
  const result = await run(basicParams);
  const text = result.content[0].text;
  expect(text).toContain('2026-03-15 * "Whole Foods" "Groceries"');
  expect(text).toContain("Expenses:Food:Groceries    45.00 USD");
  expect(text).toContain("Assets:Checking");
});

test("routes to ledger/YYYY/MM.beancount", async () => {
  writeFileSync(join(LEDGER, "main.beancount"), "");
  await run(basicParams);
  const filePath = join(LEDGER, "2026", "03.beancount");
  expect(existsSync(filePath)).toBe(true);
  const content = readFileSync(filePath, "utf-8");
  expect(content).toContain("Whole Foods");
});

test("creates parent directories", async () => {
  writeFileSync(join(LEDGER, "main.beancount"), "");
  await run({ ...basicParams, date: "2027-12-01" });
  expect(existsSync(join(LEDGER, "2027", "12.beancount"))).toBe(true);
});

test("appends to existing monthly file", async () => {
  writeFileSync(join(LEDGER, "main.beancount"), "");
  mkdirSync(join(LEDGER, "2026"), { recursive: true });
  writeFileSync(join(LEDGER, "2026", "03.beancount"), '2026-03-01 * "Old" "Existing"\n  Expenses:X    10.00 USD\n  Assets:Y\n');
  await run(basicParams);
  const content = readFileSync(join(LEDGER, "2026", "03.beancount"), "utf-8");
  expect(content).toContain("Old");
  expect(content).toContain("Whole Foods");
});

test("adds include directive for new monthly files", async () => {
  writeFileSync(join(LEDGER, "main.beancount"), 'option "operating_currency" "USD"\n');
  await run(basicParams);
  const main = readFileSync(join(LEDGER, "main.beancount"), "utf-8");
  expect(main).toContain('include "2026/03.beancount"');
});

test("does not duplicate existing include", async () => {
  writeFileSync(join(LEDGER, "main.beancount"), 'include "2026/03.beancount"\n');
  // File already exists, so include should not be re-added
  mkdirSync(join(LEDGER, "2026"), { recursive: true });
  writeFileSync(join(LEDGER, "2026", "03.beancount"), "");
  await run(basicParams);
  const main = readFileSync(join(LEDGER, "main.beancount"), "utf-8");
  const matches = main.match(/include "2026\/03.beancount"/g);
  expect(matches).toHaveLength(1);
});

test("calls bean-check after writing", async () => {
  writeFileSync(join(LEDGER, "main.beancount"), "");
  let beanCheckCalled = false;
  mockRun = (cmd) => {
    if (cmd[0] === "bean-check") beanCheckCalled = true;
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  await run(basicParams);
  expect(beanCheckCalled).toBe(true);
});

test("throws on validation failure", async () => {
  writeFileSync(join(LEDGER, "main.beancount"), "");
  mockRun = (cmd) => {
    if (cmd[0] === "bean-check") return { exitCode: 1, stdout: "", stderr: "line 5: Bad transaction" };
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  await expect(run(basicParams)).rejects.toThrow("Validation failed");
});

test("handles tags and metadata", async () => {
  writeFileSync(join(LEDGER, "main.beancount"), "");
  const result = await run({
    ...basicParams,
    tags: ["groceries", "weekly"],
    metadata: { source: "manual" },
  });
  const text = result.content[0].text;
  expect(text).toContain("#groceries #weekly");
  expect(text).toContain('source: "manual"');
});

test("requires currency when amount present", async () => {
  await expect(run({
    ...basicParams,
    postings: [
      { account: "Expenses:Food", amount: 45 },
      { account: "Assets:Checking" },
    ],
  })).rejects.toThrow("has amount but no currency");
});

test("rejects invalid date", async () => {
  await expect(run({ ...basicParams, date: "March 15" })).rejects.toThrow("Invalid date format");
});

test("rejects insufficient postings", async () => {
  await expect(run({
    ...basicParams,
    postings: [{ account: "Expenses:Food", amount: 45, currency: "USD" }],
  })).rejects.toThrow("At least 2 postings");
});

test("rejects multiple postings without amount", async () => {
  await expect(run({
    ...basicParams,
    postings: [
      { account: "Expenses:Food" },
      { account: "Assets:Checking" },
      { account: "Assets:Savings" },
    ],
  })).rejects.toThrow("At most one posting may omit the amount");
});

test("git commit is non-fatal on failure", async () => {
  writeFileSync(join(LEDGER, "main.beancount"), "");
  mockRun = (cmd) => {
    if (cmd[0] === "git") return { exitCode: 128, stdout: "", stderr: "not a git repo" };
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const result = await run(basicParams);
  expect(result.content[0].text).toContain("Added transaction");
});
