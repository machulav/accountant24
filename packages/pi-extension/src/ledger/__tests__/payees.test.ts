import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-payees-"));
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

const { listPayees } = await import("../payees.js");

afterEach(() => {
  Bun.spawn = origSpawn;
});

describe("listPayees()", () => {
  test("should return sorted payee names from hledger output", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0, "Whole Foods\nAmazon\nStarbucks\n"));
    const result = await listPayees();
    expect(result).toEqual(["Amazon", "Starbucks", "Whole Foods"]);
  });

  test("should sort case-insensitively", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0, "amazon\nBest Buy\nApple\n"));
    const result = await listPayees();
    expect(result).toEqual(["amazon", "Apple", "Best Buy"]);
  });

  test("should trim whitespace and filter empty lines", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0, "  Whole Foods  \n\n  Amazon  \n"));
    const result = await listPayees();
    expect(result).toEqual(["Amazon", "Whole Foods"]);
  });

  test("should return empty array when hledger returns empty output", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0, ""));
    const result = await listPayees();
    expect(result).toEqual([]);
  });

  test("should return empty array when hledger fails", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(1, "", "error"));
    const result = await listPayees();
    expect(result).toEqual([]);
  });

  test("should call hledger with 'payees' subcommand", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0, ""));
    await listPayees();
    const args = (Bun.spawn as any).mock.calls[0][0];
    expect(args[0]).toBe("hledger");
    expect(args[1]).toBe("payees");
  });
});
