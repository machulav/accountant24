import { test, expect, afterAll, beforeEach, mock } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BASE = mkdtempSync(join(tmpdir(), "beanclaw-update-memory-"));
const MEMORY = join(BASE, "memory.json");

mock.module("../../config.js", () => ({ BEANCLAW_HOME: BASE, MEMORY_PATH: MEMORY, LEDGER_DIR: join(BASE, "ledger") }));

const { updateMemoryTool } = await import("../update-memory.js");

afterAll(() => rmSync(BASE, { recursive: true, force: true }));
beforeEach(() => {
  try { rmSync(MEMORY); } catch {}
});

const run = (params: any) => updateMemoryTool.execute("test", params) as Promise<any>;
const readMemory = () => JSON.parse(readFileSync(MEMORY, "utf-8"));

// --- facts section ---

test("updates facts", async () => {
  const result = await run({ section: "facts", data: ["prefers USD"] });
  expect(result.content[0].text).toBe("Updated memory section 'facts'.");
  expect(readMemory().facts).toEqual(["prefers USD"]);
});

test("appends facts without replacing existing ones", async () => {
  writeFileSync(MEMORY, JSON.stringify({ facts: ["old fact"], payees: {} }));
  await run({ section: "facts", data: ["new fact"] });
  expect(readMemory().facts).toEqual(["old fact", "new fact"]);
});

test("deduplicates facts", async () => {
  writeFileSync(MEMORY, JSON.stringify({ facts: ["existing"], payees: {} }));
  await run({ section: "facts", data: ["existing", "new"] });
  expect(readMemory().facts).toEqual(["existing", "new"]);
});

test("rejects non-string items in facts", async () => {
  await expect(run({ section: "facts", data: [123] })).rejects.toThrow("Invalid data");
});

test("rejects non-array facts", async () => {
  await expect(run({ section: "facts", data: { facts: [] } })).rejects.toThrow("Invalid data");
});

// --- payees section ---

test("merges new payee while preserving existing ones", async () => {
  writeFileSync(MEMORY, JSON.stringify({ facts: [], payees: { "Whole Foods": { account: "Expenses:Food" } } }));
  await run({ section: "payees", data: { "Trader Joes": { account: "Expenses:Food" } } });
  const mem = readMemory();
  expect(mem.payees["Whole Foods"]).toEqual({ account: "Expenses:Food" });
  expect(mem.payees["Trader Joes"]).toEqual({ account: "Expenses:Food" });
});

test("overwrites existing payee entry", async () => {
  writeFileSync(MEMORY, JSON.stringify({ facts: [], payees: { "Whole Foods": { account: "Expenses:Food" } } }));
  await run({ section: "payees", data: { "Whole Foods": { account: "Expenses:Groceries" } } });
  expect(readMemory().payees["Whole Foods"]).toEqual({ account: "Expenses:Groceries" });
});

test("accepts payee with all optional fields", async () => {
  await run({ section: "payees", data: {
    "Whole Foods": { account: "Expenses:Food", patterns: ["WFM", "WHOLE FOODS"], notes: "Grocery store" },
  } });
  expect(readMemory().payees["Whole Foods"]).toEqual({
    account: "Expenses:Food", patterns: ["WFM", "WHOLE FOODS"], notes: "Grocery store",
  });
});

test("rejects payee with unknown fields", async () => {
  await expect(run({ section: "payees", data: {
    "X": { account: "A", badField: "nope" },
  } })).rejects.toThrow("Invalid data");
});

test("rejects payee without required account field", async () => {
  await expect(run({ section: "payees", data: {
    "X": { patterns: ["x"] },
  } })).rejects.toThrow("Invalid data");
});

// --- general ---

test("creates memory.json if missing", async () => {
  await run({ section: "facts", data: ["test"] });
  const mem = readMemory();
  expect(mem.facts).toEqual(["test"]);
  expect(mem.payees).toEqual({});
});

test("preserves other sections when updating one", async () => {
  writeFileSync(MEMORY, JSON.stringify({ facts: ["keep me"], payees: { x: { account: "A" } } }));
  await run({ section: "payees", data: { y: { account: "B" } } });
  const mem = readMemory();
  expect(mem.facts).toEqual(["keep me"]);
  expect(mem.payees.x).toEqual({ account: "A" });
  expect(mem.payees.y).toEqual({ account: "B" });
});

test("handles data passed as JSON string", async () => {
  await run({ section: "facts", data: '["fact from string"]' });
  expect(readMemory().facts).toEqual(["fact from string"]);
});

test("handles payees data passed as JSON string", async () => {
  await run({ section: "payees", data: '{"WF": {"account": "Expenses:Food"}}' });
  expect(readMemory().payees.WF).toEqual({ account: "Expenses:Food" });
});

test("throws on non-parseable string data", async () => {
  await expect(run({ section: "facts", data: "not valid json" })).rejects.toThrow("Invalid data");
});
