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
// Beautification is pure TS (no subprocess); the only spawn call is hledger check.
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

const { addTransactionTool } = await import("../add-transaction.js");

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

test("returns diff in details", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run(basicParams);
  expect(result.details.diff).toBeDefined();
  expect(result.details.diff).toContain("+");
  expect(result.details.diff).toContain("Whole Foods");
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
  mkdirSync(join(LEDGER, "2026"), { recursive: true });
  writeFileSync(join(LEDGER, "2026", "03.journal"), "");
  await run(basicParams);
  const main = readFileSync(join(LEDGER, "main.journal"), "utf-8");
  const matches = main.match(/include 2026\/03\.journal/g);
  expect(matches).toHaveLength(1);
});

test("calls hledger check after writing", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  await run(basicParams);
  // Bun.spawn is mocked — hledgerCheck calls runHledger which calls spawn → Bun.spawn
  expect(Bun.spawn).toHaveBeenCalled();
});

test("throws on validation failure", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  setMock(1, "", "account not declared");
  await expect(run(basicParams)).rejects.toThrow("account not declared");
});

test("handles tags", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run({
    ...basicParams,
    tags: ["groceries", "weekly"],
  });
  const text = result.content[0].text;
  expect(text).toContain("# groceries:, weekly:");
});

test("handles metadata", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run({
    ...basicParams,
    metadata: { source: "manual" },
  });
  const text = result.content[0].text;
  expect(text).toContain("# source: manual");
});

test("handles tags and metadata together", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run({
    ...basicParams,
    tags: ["groceries", "weekly"],
    metadata: { source: "manual" },
  });
  const text = result.content[0].text;
  expect(text).toContain("# groceries:, weekly:");
  expect(text).toContain("# source: manual");
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

test("hledger not found throws error", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  setMock(127);
  await expect(run(basicParams)).rejects.toThrow("hledger not found");
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

test("should re-throw unexpected validation errors", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  Bun.spawn = mock(() => {
    throw new TypeError("unexpected");
  });
  await expect(run(basicParams)).rejects.toThrow("unexpected");
});

// ── beautification ─────────────────────────────────────────────────

describe("beautification", () => {
  test("should sort transactions by date in the monthly file after hledger check succeeds", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    mkdirSync(join(LEDGER, "2026"), { recursive: true });
    // Pre-seed with a later-dated transaction; adding an earlier-dated one should push it above
    writeFileSync(
      join(LEDGER, "2026", "03.journal"),
      "2026-03-28 * Later | After\n    Expenses:Misc    10.00 USD\n    Assets:Checking\n",
    );
    await run(basicParams);
    const content = readFileSync(join(LEDGER, "2026", "03.journal"), "utf-8");
    const earlierIdx = content.indexOf("2026-03-15");
    const laterIdx = content.indexOf("2026-03-28");
    expect(earlierIdx).toBeGreaterThanOrEqual(0);
    expect(laterIdx).toBeGreaterThanOrEqual(0);
    expect(earlierIdx).toBeLessThan(laterIdx);
  });

  test("should align all posting amounts in the file to a common column derived from the widest account", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    mkdirSync(join(LEDGER, "2026"), { recursive: true });
    // Pre-seed with a shorter-account transaction
    writeFileSync(
      join(LEDGER, "2026", "03.journal"),
      "2026-03-01 * Old | Existing\n    Expenses:Misc    10.00 USD\n    Assets:Checking\n",
    );
    // basicParams adds "Expenses:Food:Groceries" (23 chars) — longer than "Expenses:Misc" (13) and "Assets:Checking" (15)
    await run(basicParams);
    const content = readFileSync(join(LEDGER, "2026", "03.journal"), "utf-8");
    // Longest account in the file is "Expenses:Food:Groceries" = 23 chars
    // targetColumn = 4 (indent) + 23 (account) + 4 (MIN_GAP) = 31
    // "Expenses:Misc" (13) padding = 31 - 4 - 13 = 14 spaces
    // "Expenses:Food:Groceries" (23) padding = 31 - 4 - 23 = 4 spaces
    expect(content).toContain(`    Expenses:Misc${" ".repeat(14)}10.00 USD`);
    expect(content).toContain("    Expenses:Food:Groceries    45.00 USD");
  });

  test("should not modify the monthly file when hledger check fails", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    mkdirSync(join(LEDGER, "2026"), { recursive: true });
    const preSeeded = "2026-03-20 * Existing\n    Expenses:Misc  10.00 USD\n    Assets:Checking\n";
    writeFileSync(join(LEDGER, "2026", "03.journal"), preSeeded);
    setMock(1, "", "account not declared");
    await expect(run(basicParams)).rejects.toThrow("account not declared");
    // The newly-appended content is in the file (addTransaction writes before validation),
    // but beautification did NOT run — so the pre-existing transaction's original spacing is preserved.
    const content = readFileSync(join(LEDGER, "2026", "03.journal"), "utf-8");
    expect(content).toContain("    Expenses:Misc  10.00 USD");
  });

  test("should return a diff reflecting the beautified file content", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    mkdirSync(join(LEDGER, "2026"), { recursive: true });
    // Pre-seed: an OUT-OF-ORDER transaction dated AFTER basicParams
    writeFileSync(
      join(LEDGER, "2026", "03.journal"),
      "2026-03-28 * Later\n    Expenses:Misc    10.00 USD\n    Assets:Checking\n",
    );
    const result = await run(basicParams);
    const diff = result.details.diff;
    // Diff should contain additions for the new transaction (Whole Foods)
    expect(diff).toContain("Whole Foods");
    // The final file should have the new (earlier) transaction sorted to the top
    const finalContent = readFileSync(join(LEDGER, "2026", "03.journal"), "utf-8");
    expect(finalContent.indexOf("Whole Foods")).toBeLessThan(finalContent.indexOf("Later"));
  });

  test("should not modify main.journal during beautification", async () => {
    const originalMain = "; Accountant24 Personal Finances\naccount Assets:Checking\n";
    writeFileSync(join(LEDGER, "main.journal"), originalMain);
    await run(basicParams);
    const mainAfter = readFileSync(join(LEDGER, "main.journal"), "utf-8");
    // main.journal still has its original opening content (commodity may be prepended, include may be appended)
    expect(mainAfter).toContain("; Accountant24 Personal Finances");
    expect(mainAfter).toContain("account Assets:Checking");
  });

  test("should be idempotent: beautifying a second time should produce identical content", async () => {
    writeFileSync(join(LEDGER, "main.journal"), "");
    await run(basicParams);
    const afterFirst = readFileSync(join(LEDGER, "2026", "03.journal"), "utf-8");
    // Run the same add again — it'll add a duplicate transaction; we only check that the format is stable
    await run({ ...basicParams, payee: "Different Store" });
    const afterSecond = readFileSync(join(LEDGER, "2026", "03.journal"), "utf-8");
    // Verify the first transaction's line is byte-identical in the second state
    const firstLine = afterFirst.split("\n").find((l) => l.includes("45.00 USD"));
    expect(firstLine).toBeDefined();
    expect(afterSecond).toContain(firstLine!);
  });
});

// ── rendering wiring ──────────────────────────────────────────────

const mockTheme = { fg: (_c: string, t: string) => t, bold: (t: string) => t } as any;

describe("renderResult wiring", () => {
  test("should show diff and file path when expanded", () => {
    const result = {
      content: [{ type: "text" as const, text: "saved" }],
      details: { transactionText: "tx", fullFilePath: "/path/file.journal", ledgerIsValid: true, diff: "+1 new tx" },
    };
    // biome-ignore lint/style/noNonNullAssertion: renderResult is defined
    const component = addTransactionTool.renderResult!(
      result,
      { expanded: true, isPartial: false },
      mockTheme,
      {} as any,
    );
    const output = component.render(120).join("\n");
    expect(output).toContain("Diff");
    expect(output).toContain("File");
    expect(output).toContain("/path/file.journal");
  });
});
