import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setBaseDir } from "../config.js";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-context-"));
const LEDGER = join(BASE, "ledger");

mkdirSync(LEDGER, { recursive: true });

// Mock at I/O boundary (Bun.spawn) instead of mocking hledger.js
// This avoids mock.module leaking into other test files
const origSpawn = Bun.spawn;

function makeMockProc(exitCode: number, stdout = "", stderr = "") {
  return {
    stdout: new Blob([stdout]).stream(),
    stderr: new Blob([stderr]).stream(),
    exited: Promise.resolve(exitCode),
    kill: mock(() => {}),
  };
}

let mockProc: ReturnType<typeof makeMockProc>;

const { loadMemory, loadAccounts, loadPayees, loadTags } = await import("../context.js");

afterAll(() => {
  Bun.spawn = origSpawn;
  rmSync(BASE, { recursive: true, force: true });
});

beforeEach(() => {
  setBaseDir(BASE);
  mockProc = makeMockProc(0, "");
  // @ts-expect-error - mocking Bun.spawn
  Bun.spawn = mock(() => mockProc);
});

afterEach(() => {
  Bun.spawn = origSpawn;
});

describe("loadMemory()", () => {
  test("should return file contents trimmed when memory file exists", async () => {
    writeFileSync(join(BASE, "memory.md"), "  fact one\nfact two  \n");
    const result = await loadMemory();
    expect(result).toBe("fact one\nfact two");
  });

  test("should return empty string when memory file does not exist", async () => {
    try {
      rmSync(join(BASE, "memory.md"));
    } catch {}
    const result = await loadMemory();
    expect(result).toBe("");
  });

  test("should trim whitespace from file contents", async () => {
    writeFileSync(join(BASE, "memory.md"), "   hello   ");
    const result = await loadMemory();
    expect(result).toBe("hello");
  });
});

describe("loadAccounts()", () => {
  test("should return account names from hledger output", async () => {
    mockProc = makeMockProc(0, "Assets:Checking\nExpenses:Food\nIncome:Salary\n");
    const result = await loadAccounts();
    expect(result).toEqual(["Assets:Checking", "Expenses:Food", "Income:Salary"]);
  });

  test("should return empty array when hledger fails", async () => {
    mockProc = makeMockProc(1, "", "error");
    const result = await loadAccounts();
    expect(result).toEqual([]);
  });

  test("should trim and filter empty lines", async () => {
    mockProc = makeMockProc(0, "  Assets:Checking  \n\n  Expenses:Food  \n  \n");
    const result = await loadAccounts();
    expect(result).toEqual(["Assets:Checking", "Expenses:Food"]);
  });
});

describe("loadPayees()", () => {
  test("should return payee names from hledger output", async () => {
    mockProc = makeMockProc(0, "Whole Foods\nStarbucks\nAmazon\n");
    const result = await loadPayees();
    expect(result).toEqual(["Whole Foods", "Starbucks", "Amazon"]);
  });

  test("should return empty array when hledger fails", async () => {
    mockProc = makeMockProc(1, "", "error");
    const result = await loadPayees();
    expect(result).toEqual([]);
  });

  test("should trim and filter empty lines", async () => {
    mockProc = makeMockProc(0, "  Whole Foods  \n\n  Starbucks  \n");
    const result = await loadPayees();
    expect(result).toEqual(["Whole Foods", "Starbucks"]);
  });
});

describe("loadTags()", () => {
  test("should return tag names from hledger output", async () => {
    mockProc = makeMockProc(0, "groceries\nweekly\nsource\n");
    const result = await loadTags();
    expect(result).toEqual(["groceries", "weekly", "source"]);
  });

  test("should return empty array when hledger fails", async () => {
    mockProc = makeMockProc(1, "", "error");
    const result = await loadTags();
    expect(result).toEqual([]);
  });

  test("should trim and filter empty lines", async () => {
    mockProc = makeMockProc(0, "  groceries  \n\n  weekly  \n");
    const result = await loadTags();
    expect(result).toEqual(["groceries", "weekly"]);
  });
});
