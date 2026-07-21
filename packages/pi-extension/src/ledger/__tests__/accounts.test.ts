import { afterEach, describe, expect, test, vi } from "vitest";
import { spawnText } from "../../spawn";

vi.mock("../../spawn");

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-accounts-"));
vi.mock("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  LEDGER_DIR: join(BASE, "ledger"),
  MEMORY_PATH: join(BASE, "memory.md"),
  setBaseDir: () => {},
}));

function makeMockProc(exitCode: number, stdout = "", stderr = "") {
  return { exitCode, stdout, stderr };
}

const { listAccounts } = await import("../accounts.js");

afterEach(() => {});

describe("listAccounts()", () => {
  test("should return sorted account names from hledger output", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0, "Expenses:Food\nAssets:Checking\nIncome:Salary\n"));
    const result = await listAccounts();
    expect(result).toEqual(["Assets:Checking", "Expenses:Food", "Income:Salary"]);
  });

  test("should sort case-insensitively", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0, "expenses:food\nAssets:Checking\nBanking:Savings\n"));
    const result = await listAccounts();
    expect(result).toEqual(["Assets:Checking", "Banking:Savings", "expenses:food"]);
  });

  test("should trim whitespace from each line", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0, "  Assets:Checking  \n  Expenses:Food  \n"));
    const result = await listAccounts();
    expect(result).toEqual(["Assets:Checking", "Expenses:Food"]);
  });

  test("should filter out empty lines", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0, "Assets:Checking\n\n\nExpenses:Food\n\n"));
    const result = await listAccounts();
    expect(result).toEqual(["Assets:Checking", "Expenses:Food"]);
  });

  test("should return empty array when hledger returns empty output", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0, ""));
    const result = await listAccounts();
    expect(result).toEqual([]);
  });

  test("should return empty array when hledger fails", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(1, "", "some error"));
    const result = await listAccounts();
    expect(result).toEqual([]);
  });

  test("should return empty array when hledger is not found", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(127));
    const result = await listAccounts();
    expect(result).toEqual([]);
  });

  test("should call hledger with 'accounts' subcommand", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0, ""));
    await listAccounts();
    const args = vi.mocked(spawnText).mock.calls[0][0];
    expect(args[0]).toBe("hledger");
    expect(args[1]).toBe("accounts");
  });

  test("should return a single account when only one exists", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0, "Assets:Checking\n"));
    const result = await listAccounts();
    expect(result).toEqual(["Assets:Checking"]);
  });
});
