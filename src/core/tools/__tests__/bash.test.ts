import { afterAll, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "beanclaw-execute-"));
mock.module("../../config.js", () => ({
  BEANCLAW_HOME: BASE,
  MEMORY_PATH: join(BASE, "memory.json"),
  LEDGER_DIR: join(BASE, "ledger"),
}));

const { resolveSafePath, runCommand } = await import("../utils.js");
mock.module("../utils.js", () => ({ resolveSafePath, runCommand }));

const { bashTool } = await import("../bash.js");

afterAll(() => rmSync(BASE, { recursive: true, force: true }));

const run = (params: any) => bashTool.execute("test", params) as Promise<any>;

test("returns output on success", async () => {
  const result = await run({ command: "echo hello" });
  expect(result.content[0].text).toContain("Exit code: 0");
  expect(result.content[0].text).toContain("hello");
});

test("returns output with non-zero exit code", async () => {
  const result = await run({ command: "false" });
  expect(result.content[0].text).toContain("Exit code: 1");
});

test("includes stderr in output on failure", async () => {
  const result = await run({ command: "echo fail >&2; exit 2" });
  expect(result.content[0].text).toContain("fail");
  expect(result.content[0].text).toContain("Exit code: 2");
});
