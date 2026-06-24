import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-update-memory-"));
const MEMORY = join(BASE, "memory.md");

mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  MEMORY_PATH: MEMORY,
  LEDGER_DIR: join(BASE, "ledger"),
}));

const { updateMemoryTool } = await import("../update-memory.js");

afterAll(() => rmSync(BASE, { recursive: true, force: true }));
beforeEach(() => {
  try {
    rmSync(MEMORY);
  } catch {}
});

const run = (params: any) =>
  updateMemoryTool.execute("test", params, undefined, undefined, undefined as any) as Promise<any>;
const readMemory = () => readFileSync(MEMORY, "utf-8");

test("writes content to memory.md", async () => {
  const result = await run({ content: "- prefers USD" });
  expect(result.content[0].text).toBe("Memory updated.");
  expect(readMemory()).toBe("- prefers USD\n");
});

test("overwrites existing content", async () => {
  writeFileSync(MEMORY, "- old fact\n");
  await run({ content: "- old fact\n- new fact" });
  expect(readMemory()).toBe("- old fact\n- new fact\n");
});

test("trims trailing whitespace and adds single newline", async () => {
  await run({ content: "- fact one  \n\n" });
  expect(readMemory()).toBe("- fact one\n");
});

test("creates memory.md if missing", async () => {
  await run({ content: "## Defaults\n- currency: EUR" });
  expect(readMemory()).toBe("## Defaults\n- currency: EUR\n");
});

test("handles multi-section markdown", async () => {
  const content = "## Accounts\n- Default: Assets:Checking\n\n## People\n- Landlord: John";
  await run({ content });
  expect(readMemory()).toBe(`${content}\n`);
});
