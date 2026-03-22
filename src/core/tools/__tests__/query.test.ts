import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-query-"));
mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  MEMORY_PATH: join(BASE, "memory.json"),
  LEDGER_DIR: join(BASE, "ledger"),
}));

const { resolveSafePath, runCommand } = await import("../utils.js");

let mockRun: { exitCode: number; stdout: string; stderr: string } | null = null;
mock.module("../utils.js", () => ({
  resolveSafePath,
  runCommand: async (cmd: string[], opts?: any) => mockRun ?? runCommand(cmd, opts),
}));

const { queryTool, buildArgs } = await import("../query.js");

afterAll(() => rmSync(BASE, { recursive: true, force: true }));
beforeEach(() => {
  mockRun = null;
});

const run = (params: any) => queryTool.execute("test", params, undefined, undefined, undefined as any) as Promise<any>;

test("throws on command not found", async () => {
  mockRun = { exitCode: 127, stdout: "", stderr: "" };
  await expect(run({ report: "bal" })).rejects.toThrow("hledger not found");
});

test("returns report output on success", async () => {
  mockRun = { exitCode: 0, stdout: "            100 USD  Expenses:Food", stderr: "" };
  const result = await run({ report: "bal", account_pattern: "Expenses:Food" });
  expect(result.content[0].text).toContain("Expenses:Food");
});

test("returns no results on empty output", async () => {
  mockRun = { exitCode: 0, stdout: "", stderr: "" };
  const result = await run({ report: "bal" });
  expect(result.content[0].text).toBe("(no results)");
});

test("throws on error", async () => {
  mockRun = { exitCode: 1, stdout: "", stderr: "hledger: could not parse" };
  await expect(run({ report: "bal" })).rejects.toThrow("could not parse");
});

test("throws on path escape", async () => {
  await expect(run({ report: "bal", file: "../../etc/passwd" })).rejects.toThrow("Path escapes base directory");
});

// buildArgs tests

test("builds basic bal command", () => {
  const args = buildArgs({ report: "bal" }, "/tmp/main.journal");
  expect(args).toEqual(["hledger", "bal", "-f", "/tmp/main.journal"]);
});

test("builds args with account pattern", () => {
  const args = buildArgs({ report: "bal", account_pattern: "Expenses:Food" }, "/tmp/main.journal");
  expect(args).toContain("Expenses:Food");
});

test("builds args with description filter", () => {
  const args = buildArgs({ report: "reg", description_pattern: "Amazon" }, "/tmp/main.journal");
  expect(args).toContain("desc:Amazon");
});

test("builds args with payee filter", () => {
  const args = buildArgs({ report: "reg", payee_pattern: "Whole Foods" }, "/tmp/main.journal");
  expect(args).toContain("payee:Whole Foods");
});

test("builds args with amount filter", () => {
  const args = buildArgs({ report: "reg", amount_filter: ">200" }, "/tmp/main.journal");
  expect(args).toContain("amt:>200");
});

test("builds args with tag filter", () => {
  const args = buildArgs({ report: "reg", tag: "groceries" }, "/tmp/main.journal");
  expect(args).toContain("tag:groceries");
});

test("builds args with cleared status", () => {
  const args = buildArgs({ report: "reg", status: "cleared" }, "/tmp/main.journal");
  expect(args).toContain("status:*");
});

test("builds args with pending status", () => {
  const args = buildArgs({ report: "reg", status: "pending" }, "/tmp/main.journal");
  expect(args).toContain("status:!");
});

test("builds args with unmarked status", () => {
  const args = buildArgs({ report: "reg", status: "unmarked" }, "/tmp/main.journal");
  expect(args).toContain("status:");
});

test("builds args with date range", () => {
  const args = buildArgs({ report: "bal", begin_date: "2026-01-01", end_date: "2026-04-01" }, "/tmp/main.journal");
  expect(args).toContain("-b");
  expect(args).toContain("2026-01-01");
  expect(args).toContain("-e");
  expect(args).toContain("2026-04-01");
});

test("builds args with monthly period", () => {
  const args = buildArgs({ report: "bal", period: "monthly" }, "/tmp/main.journal");
  expect(args).toContain("--monthly");
});

test("builds args with weekly period", () => {
  const args = buildArgs({ report: "bal", period: "weekly" }, "/tmp/main.journal");
  expect(args).toContain("--weekly");
});

test("builds args with depth", () => {
  const args = buildArgs({ report: "bal", depth: 2 }, "/tmp/main.journal");
  expect(args).toContain("--depth");
  expect(args).toContain("2");
});

test("builds args with invert", () => {
  const args = buildArgs({ report: "bal", invert: true }, "/tmp/main.journal");
  expect(args).toContain("--invert");
});

test("does not add invert when false", () => {
  const args = buildArgs({ report: "bal", invert: false }, "/tmp/main.journal");
  expect(args).not.toContain("--invert");
});

test("builds args with output format", () => {
  const args = buildArgs({ report: "reg", output_format: "csv" }, "/tmp/main.journal");
  expect(args).toContain("-O");
  expect(args).toContain("csv");
});

test("builds args for aregister", () => {
  const args = buildArgs({ report: "aregister", account_pattern: "Assets:Checking" }, "/tmp/main.journal");
  expect(args[1]).toBe("aregister");
  expect(args).toContain("Assets:Checking");
});

test("builds args with all filters combined", () => {
  const args = buildArgs(
    {
      report: "reg",
      account_pattern: "Expenses",
      payee_pattern: "Whole Foods",
      amount_filter: ">50",
      begin_date: "2026-01-01",
      end_date: "2026-04-01",
      period: "monthly",
      depth: 2,
      invert: true,
      output_format: "csv",
    },
    "/tmp/main.journal",
  );
  expect(args).toContain("Expenses");
  expect(args).toContain("payee:Whole Foods");
  expect(args).toContain("amt:>50");
  expect(args).toContain("-b");
  expect(args).toContain("-e");
  expect(args).toContain("--monthly");
  expect(args).toContain("--depth");
  expect(args).toContain("--invert");
  expect(args).toContain("-O");
  expect(args).toContain("csv");
});
