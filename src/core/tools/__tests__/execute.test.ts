import { test, expect, afterAll, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BASE = mkdtempSync(join(tmpdir(), "beanclaw-execute-"));
mock.module("../../config.js", () => ({ BEANCLAW_HOME: BASE }));

const { resolveSafePath, runCommand } = await import("../utils.js");
mock.module("../utils.js", () => ({ resolveSafePath, runCommand }));

const { executeTool } = await import("../execute.js");

afterAll(() => rmSync(BASE, { recursive: true, force: true }));

const run = (params: any) => executeTool.execute("test", params) as Promise<any>;

test("returns output on success", async () => {
  const result = await run({ command: "echo hello" });
  expect(result.content[0].text).toContain("Exit code: 0");
  expect(result.content[0].text).toContain("hello");
});

test("throws on non-zero exit code", async () => {
  const err = await run({ command: "false" }).catch((e: Error) => e);
  expect(err).toBeInstanceOf(Error);
  expect(err.message).toContain("Exit code: 1");
});

test("includes stderr in error", async () => {
  const err = await run({ command: "echo fail >&2; exit 2" }).catch((e: Error) => e);
  expect(err).toBeInstanceOf(Error);
  expect(err.message).toContain("fail");
  expect(err.message).toContain("Exit code: 2");
});
