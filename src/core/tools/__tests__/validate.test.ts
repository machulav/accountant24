import { test, expect, afterAll, beforeEach, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BASE = mkdtempSync(join(tmpdir(), "beanclaw-validate-"));
mock.module("../../config.js", () => ({ BEANCLAW_HOME: BASE, MEMORY_PATH: join(BASE, "memory.json"), LEDGER_DIR: join(BASE, "ledger") }));

const { resolveSafePath, runCommand } = await import("../utils.js");

let mockRun: { exitCode: number; stdout: string; stderr: string } | null = null;
mock.module("../utils.js", () => ({
  resolveSafePath,
  runCommand: async (cmd: string[], opts?: any) => mockRun ?? runCommand(cmd, opts),
}));

const { validateTool } = await import("../validate.js");

afterAll(() => rmSync(BASE, { recursive: true, force: true }));
beforeEach(() => { mockRun = null; });

const run = (params: any) => validateTool.execute("test", params) as Promise<any>;

test("throws on command not found", async () => {
  mockRun = { exitCode: 127, stdout: "", stderr: "" };
  await expect(run({})).rejects.toThrow("hledger not found");
});

test("returns success on valid ledger", async () => {
  mockRun = { exitCode: 0, stdout: "", stderr: "" };
  const result = await run({});
  expect(result.content[0].text).toBe("Ledger is valid.");
});

test("throws on validation error", async () => {
  mockRun = { exitCode: 1, stdout: "", stderr: "hledger: Error: account not declared" };
  await expect(run({})).rejects.toThrow("account not declared");
});

test("throws on path escape", async () => {
  await expect(run({ file: "../../etc/passwd" })).rejects.toThrow(
    "Path escapes base directory",
  );
});
