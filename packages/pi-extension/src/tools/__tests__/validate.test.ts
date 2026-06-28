import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { spawnText } from "../../spawn";

vi.mock("../../spawn");

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-validate-"));
const LEDGER = join(BASE, "ledger");

vi.mock("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  MEMORY_PATH: join(BASE, "memory.md"),
  LEDGER_DIR: LEDGER,
  FILES_DIR: join(BASE, "files"),
  setBaseDir: () => {},
}));

// Mock at spawnText level — the only spawn call is hledger check.

function makeMockProc(exitCode: number, stdout = "", stderr = "") {
  return { exitCode, stdout, stderr };
}

let mockExitCode: number;
let mockStdout: string;
let mockStderr: string;

const setMock = (exit: number, stdout = "", stderr = "") => {
  mockExitCode = exit;
  mockStdout = stdout;
  mockStderr = stderr;
};

const { validateTool } = await import("../validate.js");

afterAll(() => {
  rmSync(BASE, { recursive: true, force: true });
});

beforeEach(() => {
  setMock(0);
  vi.mocked(spawnText).mockImplementation(async () => makeMockProc(mockExitCode, mockStdout, mockStderr));
  // Clean and recreate ledger dir per test
  rmSync(LEDGER, { recursive: true, force: true });
  mkdirSync(LEDGER, { recursive: true });
});

afterEach(() => {});

const run = (params: any) =>
  validateTool.execute("test", params, undefined, undefined, undefined as any) as Promise<any>;

test("throws when hledger not found", async () => {
  setMock(127);
  await expect(run({})).rejects.toThrow("hledger not found");
});

test("returns valid result on success", async () => {
  setMock(0);
  const result = await run({});
  expect(result.details.ledgerIsValid).toBe(true);
});

test("throws on validation failure", async () => {
  setMock(1, "", "hledger: Error: account not declared");
  await expect(run({})).rejects.toThrow("account not declared");
});

test("re-throws unexpected errors", async () => {
  vi.mocked(spawnText).mockRejectedValue(new TypeError("unexpected"));
  await expect(run({})).rejects.toThrow("unexpected");
});
