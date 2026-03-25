import { afterAll, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-validate-"));

mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  MEMORY_PATH: join(BASE, "memory.md"),
  LEDGER_DIR: join(BASE, "ledger"),
}));

const utils = await import("../hledger.js");
const { HledgerNotFoundError, HledgerCommandError } = utils;

let mockHledgerCheck: (() => void) | null = null;
mock.module("../hledger.js", () => ({
  ...utils,
  hledgerCheck: async () => {
    if (mockHledgerCheck) return mockHledgerCheck();
  },
}));

const { validateTool } = await import("../validate.js");

afterAll(() => rmSync(BASE, { recursive: true, force: true }));

const run = (params: any) =>
  validateTool.execute("test", params, undefined, undefined, undefined as any) as Promise<any>;

test("reports hledger not found", async () => {
  mockHledgerCheck = () => {
    throw new HledgerNotFoundError();
  };
  const result = await run({});
  expect(result.content[0].text).toContain("hledger not found");
});

test("returns success on valid ledger", async () => {
  mockHledgerCheck = () => {};
  const result = await run({});
  expect(result.content[0].text).toBe("Ledger is valid.");
});

test("throws on ledger validation error", async () => {
  mockHledgerCheck = () => {
    throw new HledgerCommandError("", "hledger: Error: account not declared");
  };
  await expect(run({})).rejects.toThrow("account not declared");
});
