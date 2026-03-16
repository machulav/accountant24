import { test, expect, afterAll, mock } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BASE = mkdtempSync(join(tmpdir(), "beanclaw-read-file-"));
mock.module("../../config.js", () => ({ BEANCLAW_HOME: BASE, MEMORY_PATH: join(BASE, "memory.json"), LEDGER_DIR: join(BASE, "ledger") }));

const { resolveSafePath, runCommand } = await import("../utils.js");
mock.module("../utils.js", () => ({ resolveSafePath, runCommand }));

const { readFileTool } = await import("../read-file.js");

afterAll(() => rmSync(BASE, { recursive: true, force: true }));

const run = (params: any) => readFileTool.execute("test", params) as Promise<any>;

test("reads file content", async () => {
  writeFileSync(join(BASE, "hello.txt"), "hello world");
  const result = await run({ path: "hello.txt" });
  expect(result.content[0].text).toBe("hello world");
});

test("throws on missing file", async () => {
  await expect(run({ path: "nope.txt" })).rejects.toThrow("File not found: nope.txt");
});

test("throws on path escape", async () => {
  await expect(run({ path: "../../etc/passwd" })).rejects.toThrow("Path escapes base directory");
});

test("truncates files over 100KB", async () => {
  const big = "x".repeat(200 * 1024);
  writeFileSync(join(BASE, "big.txt"), big);
  const result = await run({ path: "big.txt" });
  expect(result.content[0].text).toContain("[Truncated");
  expect(result.content[0].text.length).toBeLessThan(big.length);
});
