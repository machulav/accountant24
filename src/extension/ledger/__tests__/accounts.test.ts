import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-accounts-"));
mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  LEDGER_DIR: join(BASE, "ledger"),
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

const { listAccounts } = await import("../accounts.js");

afterEach(() => {
  Bun.spawn = origSpawn;
});

describe("listAccounts()", () => {
  test("should return sorted account names from hledger output", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0, "Expenses:Food\nAssets:Checking\nIncome:Salary\n"));
    const result = await listAccounts();
    expect(result).toEqual(["Assets:Checking", "Expenses:Food", "Income:Salary"]);
  });

  test("should sort case-insensitively", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0, "expenses:food\nAssets:Checking\nBanking:Savings\n"));
    const result = await listAccounts();
    expect(result).toEqual(["Assets:Checking", "Banking:Savings", "expenses:food"]);
  });

  test("should trim whitespace from each line", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0, "  Assets:Checking  \n  Expenses:Food  \n"));
    const result = await listAccounts();
    expect(result).toEqual(["Assets:Checking", "Expenses:Food"]);
  });

  test("should filter out empty lines", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0, "Assets:Checking\n\n\nExpenses:Food\n\n"));
    const result = await listAccounts();
    expect(result).toEqual(["Assets:Checking", "Expenses:Food"]);
  });

  test("should return empty array when hledger returns empty output", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0, ""));
    const result = await listAccounts();
    expect(result).toEqual([]);
  });

  test("should return empty array when hledger fails", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(1, "", "some error"));
    const result = await listAccounts();
    expect(result).toEqual([]);
  });

  test("should return empty array when hledger is not found", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(127));
    const result = await listAccounts();
    expect(result).toEqual([]);
  });

  test("should call hledger with 'accounts' subcommand", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0, ""));
    await listAccounts();
    const args = (Bun.spawn as any).mock.calls[0][0];
    expect(args[0]).toBe("hledger");
    expect(args[1]).toBe("accounts");
  });

  test("should return a single account when only one exists", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0, "Assets:Checking\n"));
    const result = await listAccounts();
    expect(result).toEqual(["Assets:Checking"]);
  });
});
