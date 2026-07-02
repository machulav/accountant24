import { afterEach, describe, expect, test, vi } from "vitest";
import { spawnText } from "../../spawn";

vi.mock("../../spawn");

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-tags-"));
vi.mock("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  LEDGER_DIR: join(BASE, "ledger"),
  MEMORY_PATH: join(BASE, "memory.md"),
  FILES_DIR: join(BASE, "files"),
  setBaseDir: () => {},
}));

function makeMockProc(exitCode: number, stdout = "", stderr = "") {
  return { exitCode, stdout, stderr };
}

const { listTags } = await import("../tags.js");

afterEach(() => {});

describe("listTags()", () => {
  test("should return sorted tag names from hledger output", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0, "weekly\ngroceries\nsource\n"));
    const result = await listTags();
    expect(result).toEqual(["groceries", "source", "weekly"]);
  });

  test("should sort case-insensitively", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0, "Zebra\nalpha\nBeta\n"));
    const result = await listTags();
    expect(result).toEqual(["alpha", "Beta", "Zebra"]);
  });

  test("should trim whitespace and filter empty lines", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0, "  groceries  \n\n  weekly  \n"));
    const result = await listTags();
    expect(result).toEqual(["groceries", "weekly"]);
  });

  test("should return empty array when hledger returns empty output", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0, ""));
    const result = await listTags();
    expect(result).toEqual([]);
  });

  test("should return empty array when hledger fails", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(1, "", "error"));
    const result = await listTags();
    expect(result).toEqual([]);
  });

  test("should call hledger with 'tags' subcommand", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0, ""));
    await listTags();
    const args = vi.mocked(spawnText).mock.calls[0][0];
    expect(args[0]).toBe("hledger");
    expect(args[1]).toBe("tags");
  });
});
