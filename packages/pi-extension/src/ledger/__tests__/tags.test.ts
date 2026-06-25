import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-tags-"));
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

const { listTags } = await import("../tags.js");

afterEach(() => {
  Bun.spawn = origSpawn;
});

describe("listTags()", () => {
  test("should return sorted tag names from hledger output", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0, "weekly\ngroceries\nsource\n"));
    const result = await listTags();
    expect(result).toEqual(["groceries", "source", "weekly"]);
  });

  test("should sort case-insensitively", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0, "Zebra\nalpha\nBeta\n"));
    const result = await listTags();
    expect(result).toEqual(["alpha", "Beta", "Zebra"]);
  });

  test("should trim whitespace and filter empty lines", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0, "  groceries  \n\n  weekly  \n"));
    const result = await listTags();
    expect(result).toEqual(["groceries", "weekly"]);
  });

  test("should return empty array when hledger returns empty output", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0, ""));
    const result = await listTags();
    expect(result).toEqual([]);
  });

  test("should return empty array when hledger fails", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(1, "", "error"));
    const result = await listTags();
    expect(result).toEqual([]);
  });

  test("should call hledger with 'tags' subcommand", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0, ""));
    await listTags();
    const args = (Bun.spawn as any).mock.calls[0][0];
    expect(args[0]).toBe("hledger");
    expect(args[1]).toBe("tags");
  });
});
