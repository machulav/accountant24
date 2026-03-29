import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-query-"));
mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  MEMORY_PATH: join(BASE, "memory.md"),
  LEDGER_DIR: join(BASE, "ledger"),
  setBaseDir: () => {},
}));

// Mock Bun.spawn instead of hledger.js — this is the real I/O boundary.
// This lets the real hledger.ts functions execute (contributing to coverage).
const origSpawn = Bun.spawn;

function makeMockProc(exitCode: number, stdout = "", stderr = "") {
  return {
    stdout: new Blob([stdout]).stream(),
    stderr: new Blob([stderr]).stream(),
    exited: Promise.resolve(exitCode),
    kill: mock(() => {}),
  };
}

let mockProc: ReturnType<typeof makeMockProc>;

const { queryTool } = await import("../query.js");

afterAll(() => rmSync(BASE, { recursive: true, force: true }));
beforeEach(() => {
  mockProc = makeMockProc(0, "");
  // @ts-expect-error - mocking Bun.spawn
  Bun.spawn = mock(() => mockProc);
});
afterEach(() => {
  Bun.spawn = origSpawn;
});

const run = (params: any) => queryTool.execute("test", params, undefined, undefined, undefined as any) as Promise<any>;

/** Extract the args array passed to the most recent Bun.spawn call */
function spawnArgs(): string[] {
  const calls = (Bun.spawn as any).mock.calls;
  return calls[calls.length - 1][0];
}

test("throws on command not found", async () => {
  mockProc = makeMockProc(127);
  await expect(run({ report: "bal" })).rejects.toThrow("hledger not found");
});

test("returns report output on success", async () => {
  mockProc = makeMockProc(0, "            100 USD  Expenses:Food");
  const result = await run({ report: "bal", account_pattern: "Expenses:Food" });
  expect(result.content[0].text).toContain("Expenses:Food");
});

test("returns no results on empty output", async () => {
  mockProc = makeMockProc(0, "");
  const result = await run({ report: "bal" });
  expect(result.content[0].text).toBe("(no results)");
});

test("throws on error", async () => {
  mockProc = makeMockProc(1, "", "hledger: could not parse");
  await expect(run({ report: "bal" })).rejects.toThrow("could not parse");
});

test("handles abort signal", async () => {
  mockProc = makeMockProc(0, "output");
  const controller = new AbortController();
  const promise = queryTool.execute("test", { report: "bal" }, controller.signal, undefined, undefined as any);
  controller.abort();
  const result = (await promise) as any;
  expect(result.content[0].text).toContain("output");
});

test("throws on path escape", async () => {
  await expect(run({ report: "bal", file: "../../etc/passwd" })).rejects.toThrow("Path escapes base directory");
});

// arg-building tests — verify args passed to Bun.spawn

test("builds basic bal command", async () => {
  await run({ report: "bal" });
  const args = spawnArgs();
  expect(args[0]).toBe("hledger");
  expect(args[1]).toBe("bal");
  expect(args).toContain("-f");
});

test("builds args with account pattern", async () => {
  await run({ report: "bal", account_pattern: "Expenses:Food" });
  expect(spawnArgs()).toContain("Expenses:Food");
});

test("builds args with description filter", async () => {
  await run({ report: "reg", description_pattern: "Amazon" });
  expect(spawnArgs()).toContain("desc:Amazon");
});

test("builds args with payee filter", async () => {
  await run({ report: "reg", payee_pattern: "Whole Foods" });
  expect(spawnArgs()).toContain("payee:Whole Foods");
});

test("builds args with amount filter", async () => {
  await run({ report: "reg", amount_filter: ">200" });
  expect(spawnArgs()).toContain("amt:>200");
});

test("builds args with tag filter", async () => {
  await run({ report: "reg", tag: "groceries" });
  expect(spawnArgs()).toContain("tag:groceries");
});

test("builds args with cleared status", async () => {
  await run({ report: "reg", status: "cleared" });
  expect(spawnArgs()).toContain("status:*");
});

test("builds args with pending status", async () => {
  await run({ report: "reg", status: "pending" });
  expect(spawnArgs()).toContain("status:!");
});

test("builds args with unmarked status", async () => {
  await run({ report: "reg", status: "unmarked" });
  expect(spawnArgs()).toContain("status:");
});

test("builds args with date range", async () => {
  await run({ report: "bal", begin_date: "2026-01-01", end_date: "2026-04-01" });
  const args = spawnArgs();
  expect(args).toContain("-b");
  expect(args).toContain("2026-01-01");
  expect(args).toContain("-e");
  expect(args).toContain("2026-04-01");
});

test("builds args with monthly period", async () => {
  await run({ report: "bal", period: "monthly" });
  expect(spawnArgs()).toContain("--monthly");
});

test("builds args with weekly period", async () => {
  await run({ report: "bal", period: "weekly" });
  expect(spawnArgs()).toContain("--weekly");
});

test("builds args with depth", async () => {
  await run({ report: "bal", depth: 2 });
  const args = spawnArgs();
  expect(args).toContain("--depth");
  expect(args).toContain("2");
});

test("builds args with invert", async () => {
  await run({ report: "bal", invert: true });
  expect(spawnArgs()).toContain("--invert");
});

test("does not add invert when false", async () => {
  await run({ report: "bal", invert: false });
  expect(spawnArgs()).not.toContain("--invert");
});

test("builds args with output format", async () => {
  await run({ report: "reg", output_format: "csv" });
  const args = spawnArgs();
  expect(args).toContain("-O");
  expect(args).toContain("csv");
});

test("builds args for aregister", async () => {
  await run({ report: "aregister", account_pattern: "Assets:Checking" });
  const args = spawnArgs();
  expect(args).toContain("aregister");
  expect(args).toContain("Assets:Checking");
});

test("builds args with all filters combined", async () => {
  await run({
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
  });
  const args = spawnArgs();
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
