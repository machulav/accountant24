import { test, expect, afterAll, beforeEach, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BASE = mkdtempSync(join(tmpdir(), "beanclaw-query-"));
mock.module("../../config.js", () => ({ BEANCLAW_HOME: BASE }));

const { resolveSafePath, runCommand } = await import("../utils.js");

let mockRun: { exitCode: number; stdout: string; stderr: string } | null = null;
mock.module("../utils.js", () => ({
  resolveSafePath,
  runCommand: async (cmd: string[], opts?: any) => mockRun ?? runCommand(cmd, opts),
}));

const { queryTool } = await import("../query.js");

afterAll(() => rmSync(BASE, { recursive: true, force: true }));
beforeEach(() => { mockRun = null; });

const run = (params: any) => queryTool.execute("test", params) as Promise<any>;

test("throws on command not found", async () => {
  mockRun = { exitCode: 127, stdout: "", stderr: "" };
  await expect(run({ query: "SELECT 1" })).rejects.toThrow("bean-query not found");
});

test("returns query output on success", async () => {
  mockRun = { exitCode: 0, stdout: "account  balance\nExpenses:Food  100 USD", stderr: "" };
  const result = await run({ query: "SELECT account, balance" });
  expect(result.content[0].text).toContain("Expenses:Food");
});

test("returns no results on empty output", async () => {
  mockRun = { exitCode: 0, stdout: "", stderr: "" };
  const result = await run({ query: "SELECT 1 WHERE FALSE" });
  expect(result.content[0].text).toBe("(no results)");
});

test("throws on query error", async () => {
  mockRun = { exitCode: 1, stdout: "", stderr: "Syntax error" };
  await expect(run({ query: "INVALID" })).rejects.toThrow("Syntax error");
});

test("throws on path escape", async () => {
  await expect(
    run({ query: "SELECT 1", file: "../../etc/passwd" }),
  ).rejects.toThrow("Path escapes base directory");
});
