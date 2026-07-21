import { afterEach, describe, expect, test, vi } from "vitest";
import { spawnText } from "../../spawn";

vi.mock("../../spawn");

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-payees-"));
vi.mock("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  LEDGER_DIR: join(BASE, "ledger"),
  MEMORY_PATH: join(BASE, "memory.md"),
  setBaseDir: () => {},
}));

function makeMockProc(exitCode: number, stdout = "", stderr = "") {
  return { exitCode, stdout, stderr };
}

const { listPayees } = await import("../payees.js");

afterEach(() => {});

describe("listPayees()", () => {
  test("should return sorted payee names from hledger output", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0, "Whole Foods\nAmazon\nStarbucks\n"));
    const result = await listPayees();
    expect(result).toEqual(["Amazon", "Starbucks", "Whole Foods"]);
  });

  test("should sort case-insensitively", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0, "amazon\nBest Buy\nApple\n"));
    const result = await listPayees();
    expect(result).toEqual(["amazon", "Apple", "Best Buy"]);
  });

  test("should trim whitespace and filter empty lines", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0, "  Whole Foods  \n\n  Amazon  \n"));
    const result = await listPayees();
    expect(result).toEqual(["Amazon", "Whole Foods"]);
  });

  test("should return empty array when hledger returns empty output", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0, ""));
    const result = await listPayees();
    expect(result).toEqual([]);
  });

  test("should return empty array when hledger fails", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(1, "", "error"));
    const result = await listPayees();
    expect(result).toEqual([]);
  });

  test("should call hledger with 'payees' subcommand", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0, ""));
    await listPayees();
    const args = vi.mocked(spawnText).mock.calls[0][0];
    expect(args[0]).toBe("hledger");
    expect(args[1]).toBe("payees");
  });
});
