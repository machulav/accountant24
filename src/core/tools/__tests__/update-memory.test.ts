import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "beanclaw-update-memory-"));
const MEMORY = join(BASE, "memory.json");

mock.module("../../config.js", () => ({ BEANCLAW_HOME: BASE, MEMORY_PATH: MEMORY, LEDGER_DIR: join(BASE, "ledger") }));

const { updateMemoryTool } = await import("../update-memory.js");

afterAll(() => rmSync(BASE, { recursive: true, force: true }));
beforeEach(() => {
  try {
    rmSync(MEMORY);
  } catch {}
});

const run = (params: any) => updateMemoryTool.execute("test", params) as Promise<any>;
const readMemory = () => JSON.parse(readFileSync(MEMORY, "utf-8"));

// --- facts ---

test("updates facts", async () => {
  const result = await run({ facts: ["prefers USD"] });
  expect(result.content[0].text).toBe("Updated memory.");
  expect(readMemory().facts).toEqual(["prefers USD"]);
});

test("appends facts without replacing existing ones", async () => {
  writeFileSync(MEMORY, JSON.stringify({ facts: ["old fact"] }));
  await run({ facts: ["new fact"] });
  expect(readMemory().facts).toEqual(["old fact", "new fact"]);
});

test("deduplicates facts", async () => {
  writeFileSync(MEMORY, JSON.stringify({ facts: ["existing"] }));
  await run({ facts: ["existing", "new"] });
  expect(readMemory().facts).toEqual(["existing", "new"]);
});

test("rejects non-string items in facts", async () => {
  await expect(run({ facts: [123] })).rejects.toThrow("Invalid facts");
});

test("rejects non-array facts", async () => {
  await expect(run({ facts: { facts: [] } })).rejects.toThrow("Invalid facts");
});

// --- general ---

test("creates memory.json if missing", async () => {
  await run({ facts: ["test"] });
  const mem = readMemory();
  expect(mem.facts).toEqual(["test"]);
  expect(mem).not.toHaveProperty("payees");
});

test("handles facts passed as JSON string", async () => {
  await run({ facts: '["fact from string"]' });
  expect(readMemory().facts).toEqual(["fact from string"]);
});

test("throws on non-parseable string data", async () => {
  await expect(run({ facts: "not valid json" })).rejects.toThrow("Invalid facts");
});

test("strips legacy payees key on read", async () => {
  writeFileSync(MEMORY, JSON.stringify({ facts: ["keep"], payees: { x: { account: "A" } } }));
  await run({ facts: ["new"] });
  const mem = readMemory();
  expect(mem.facts).toEqual(["keep", "new"]);
  expect(mem).not.toHaveProperty("payees");
});
