import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-validate-"));

mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  MEMORY_PATH: join(BASE, "memory.md"),
  LEDGER_DIR: join(BASE, "ledger"),
  setBaseDir: () => {},
}));

// Mock at Bun.spawn level so real hledger.ts functions execute for coverage
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

const { validateTool } = await import("../validate.js");

afterAll(() => {
  Bun.spawn = origSpawn;
  rmSync(BASE, { recursive: true, force: true });
});

beforeEach(() => {
  mockProc = makeMockProc(0);
  // @ts-expect-error - mocking Bun.spawn
  Bun.spawn = mock(() => mockProc);
});

afterEach(() => {
  Bun.spawn = origSpawn;
});

const run = (params: any) =>
  validateTool.execute("test", params, undefined, undefined, undefined as any) as Promise<any>;

test("reports hledger not found", async () => {
  mockProc = makeMockProc(127);
  const result = await run({});
  expect(result.content[0].text).toContain("hledger not found");
});

test("returns success on valid ledger", async () => {
  mockProc = makeMockProc(0);
  const result = await run({});
  expect(result.content[0].text).toBe("Ledger is valid.");
});

test("throws on ledger validation error", async () => {
  mockProc = makeMockProc(1, "", "hledger: Error: account not declared");
  await expect(run({})).rejects.toThrow("account not declared");
});

test("re-throws unexpected errors", async () => {
  Bun.spawn = mock(() => {
    throw new TypeError("unexpected");
  });
  await expect(run({})).rejects.toThrow("unexpected");
});
