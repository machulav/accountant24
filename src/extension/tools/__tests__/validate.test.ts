import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-validate-"));
const MEMORY = join(BASE, "memory.json");

mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  MEMORY_PATH: MEMORY,
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
beforeEach(() => {
  mockHledgerCheck = null;
  try {
    rmSync(MEMORY);
  } catch {}
});

const run = (params: any) =>
  validateTool.execute("test", params, undefined, undefined, undefined as any) as Promise<any>;

// --- journal validation ---

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
  expect(result.content[0].text).toContain("Ledger is valid.");
});

test("throws on ledger validation error", async () => {
  mockHledgerCheck = () => {
    throw new HledgerCommandError("", "hledger: Error: account not declared");
  };
  await expect(run({})).rejects.toThrow("account not declared");
});

// --- memory validation ---

test("reports valid memory alongside valid ledger", async () => {
  mockHledgerCheck = () => {};
  writeFileSync(MEMORY, JSON.stringify({ facts: [] }));
  const result = await run({});
  expect(result.content[0].text).toContain("Ledger is valid.");
  expect(result.content[0].text).toContain("Memory is valid.");
});

test("missing memory.json is OK", async () => {
  mockHledgerCheck = () => {};
  // no memory file written
  const result = await run({});
  expect(result.content[0].text).toContain("Ledger is valid.");
  expect(result.content[0].text).not.toContain("Memory");
});

test("reports memory schema errors", async () => {
  mockHledgerCheck = () => {};
  writeFileSync(MEMORY, JSON.stringify({ facts: "not-an-array" }));
  await expect(run({})).rejects.toThrow("memory.json");
});

test("reports invalid JSON in memory", async () => {
  mockHledgerCheck = () => {};
  writeFileSync(MEMORY, "not json{{{");
  await expect(run({})).rejects.toThrow("memory.json: invalid JSON");
});

test("reports unknown fields in memory", async () => {
  mockHledgerCheck = () => {};
  writeFileSync(MEMORY, JSON.stringify({ facts: [], extraField: true }));
  await expect(run({})).rejects.toThrow("memory.json");
});

test("reports both ledger and memory errors together", async () => {
  mockHledgerCheck = () => {
    throw new HledgerCommandError("", "bad ledger");
  };
  writeFileSync(MEMORY, JSON.stringify({ facts: 123 }));
  try {
    await run({});
    expect(true).toBe(false); // should not reach
  } catch (e: any) {
    expect(e.message).toContain("Ledger errors");
    expect(e.message).toContain("memory.json");
  }
});

test("validates memory even when hledger not found", async () => {
  mockHledgerCheck = () => {
    throw new HledgerNotFoundError();
  };
  writeFileSync(MEMORY, JSON.stringify({ facts: 123 }));
  await expect(run({})).rejects.toThrow("memory.json");
});
