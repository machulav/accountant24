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

test("updates user.facts", async () => {
  const result = await run({ section: "user", data: { facts: ["prefers USD"] } });
  expect(result.content[0].text).toBe("Updated memory section 'user'.");
  expect(readMemory().user.facts).toEqual(["prefers USD"]);
});

test("merges new payee while preserving existing ones", async () => {
  writeFileSync(MEMORY, JSON.stringify({ user: {}, payees: { "Whole Foods": { account: "Expenses:Food" } }, rules: [] }));
  await run({ section: "payees", data: { "Trader Joes": { account: "Expenses:Food" } } });
  const mem = readMemory();
  expect(mem.payees["Whole Foods"]).toEqual({ account: "Expenses:Food" });
  expect(mem.payees["Trader Joes"]).toEqual({ account: "Expenses:Food" });
});

test("overwrites existing payee entry", async () => {
  writeFileSync(MEMORY, JSON.stringify({ user: {}, payees: { "Whole Foods": { account: "Expenses:Food" } }, rules: [] }));
  await run({ section: "payees", data: { "Whole Foods": { account: "Expenses:Groceries" } } });
  expect(readMemory().payees["Whole Foods"]).toEqual({ account: "Expenses:Groceries" });
});

test("replaces rules array entirely", async () => {
  writeFileSync(MEMORY, JSON.stringify({ user: {}, payees: {}, rules: [{ old: true }] }));
  await run({ section: "rules", data: [{ new: true }] });
  expect(readMemory().rules).toEqual([{ new: true }]);
});

test("creates memory.json if missing", async () => {
  await run({ section: "user", data: { facts: ["test"] } });
  const mem = readMemory();
  expect(mem.user.facts).toEqual(["test"]);
  expect(mem.payees).toEqual({});
  expect(mem.rules).toEqual([]);
});

test("preserves other sections when updating one", async () => {
  writeFileSync(MEMORY, JSON.stringify({ user: { facts: ["keep me"] }, payees: { x: 1 }, rules: [1] }));
  await run({ section: "payees", data: { y: 2 } });
  const mem = readMemory();
  expect(mem.user.facts).toEqual(["keep me"]);
  expect(mem.rules).toEqual([1]);
  expect(mem.payees).toEqual({ x: 1, y: 2 });
});
