import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { spawnText } from "../../spawn";

vi.mock("../../spawn");

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-query-"));
vi.mock("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  MEMORY_PATH: join(BASE, "memory.md"),
  LEDGER_DIR: join(BASE, "ledger"),
  setBaseDir: () => {},
}));

// Mock spawnText instead of hledger.js — this is the real I/O boundary.
// This lets the real hledger.ts functions execute (contributing to coverage).

function makeMockProc(exitCode: number, stdout = "", stderr = "") {
  return { exitCode, stdout, stderr };
}

let mockProc: ReturnType<typeof makeMockProc>;

const { queryTool } = await import("../query.js");

afterAll(() => rmSync(BASE, { recursive: true, force: true }));
beforeEach(() => {
  mockProc = makeMockProc(0, "");
  vi.mocked(spawnText).mockImplementation(async () => mockProc);
});
afterEach(() => {});

const run = (params: any) => queryTool.execute("test", params, undefined, undefined, undefined as any) as Promise<any>;

/** Extract the args array passed to the most recent spawnText call */
function spawnArgs(): string[] {
  const calls = vi.mocked(spawnText).mock.calls;
  return calls[calls.length - 1][0];
}

// ── execute() ─────────────────────────────────────────────────────

describe("execute()", () => {
  test("returns output in content and command in details", async () => {
    mockProc = makeMockProc(0, "100 USD  Expenses:Food");
    const result = await run({ report: "bal", account_pattern: "Expenses:Food" });
    expect(result.content[0].text).toContain("100 USD  Expenses:Food");
    expect(result.details.command).toContain("hledger");
    expect(result.details.output).toBe("100 USD  Expenses:Food");
  });

  test("returns (no results) when output is empty", async () => {
    mockProc = makeMockProc(0, "");
    const result = await run({ report: "bal" });
    expect(result.details.output).toBe("(no results)");
  });

  test("stores full hledger command in details", async () => {
    mockProc = makeMockProc(0, "");
    const result = await run({ report: "bal", account_pattern: "Expenses" });
    expect(result.details.command).toMatch(/^hledger bal -f .+ Expenses -e tomorrow$/);
  });

  test("throws on command not found", async () => {
    mockProc = makeMockProc(127);
    await expect(run({ report: "bal" })).rejects.toThrow("hledger not found");
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
});

// ── arg-building (spawnText args) ─────────────────────────────────

describe("arg-building", () => {
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

  test("defaults to -e tomorrow when no end_date provided", async () => {
    await run({ report: "bal" });
    const args = spawnArgs();
    expect(args).toContain("-e");
    expect(args).toContain("tomorrow");
  });

  test("uses explicit end_date instead of tomorrow", async () => {
    await run({ report: "bal", begin_date: "2026-01-01", end_date: "2026-04-01" });
    const args = spawnArgs();
    expect(args).toContain("-b");
    expect(args).toContain("2026-01-01");
    expect(args).toContain("-e");
    expect(args).toContain("2026-04-01");
    expect(args).not.toContain("tomorrow");
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

  test("builds args with --width based on terminal columns for reg", async () => {
    await run({ report: "reg" });
    const args = spawnArgs();
    const widthArg = args.find((a: string) => a.startsWith("--width="));
    expect(widthArg).toBeDefined();
    const width = Number(widthArg?.split("=")[1]);
    expect(width).toBe((process.stdout.columns || 80) - 6);
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
});

// ── large-output spillover ──────────────────────────────────────────

function linesOf(n: number): string {
  return `${Array.from({ length: n }, (_, i) => `line${i}`).join("\n")}\n`;
}

describe("large-output spillover", () => {
  test("returns output inline at exactly the 200-line limit", async () => {
    mockProc = makeMockProc(0, linesOf(200));
    const result = await run({ report: "reg" });
    expect(result.details.outputFile).toBeUndefined();
    expect(result.content[0].text).toContain("line199");
  });

  test("spills to a scratch file when over the 200-line limit", async () => {
    mockProc = makeMockProc(0, linesOf(201));
    const result = await run({ report: "reg" });
    expect(result.details.outputFile).toBeDefined();
    expect(existsSync(result.details.outputFile)).toBe(true);
    expect(readFileSync(result.details.outputFile, "utf-8")).toBe(linesOf(201));
  });

  test("tells the agent the line count and file path instead of the content", async () => {
    mockProc = makeMockProc(0, linesOf(500));
    const result = await run({ report: "reg" });
    expect(result.content[0].text).toContain("500 lines");
    expect(result.content[0].text).toContain(result.details.outputFile);
    expect(result.content[0].text).not.toContain("line0");
  });

  test("writes the scratch file outside the workspace (OS tmpdir, not files/)", async () => {
    mockProc = makeMockProc(0, linesOf(300));
    const result = await run({ report: "reg" });
    expect(result.details.outputFile).toContain(tmpdir());
    expect(result.details.outputFile).not.toContain(BASE);
  });

  test("names the scratch file with the requested output_format extension", async () => {
    mockProc = makeMockProc(0, linesOf(300));
    const result = await run({ report: "reg", output_format: "tsv" });
    expect(result.details.outputFile).toMatch(/\.tsv$/);
  });

  test("defaults the scratch file extension to txt with no output_format", async () => {
    mockProc = makeMockProc(0, linesOf(300));
    const result = await run({ report: "reg" });
    expect(result.details.outputFile).toMatch(/\.txt$/);
  });

  test("still returns the real hledger command in details when spilled", async () => {
    mockProc = makeMockProc(0, linesOf(300));
    const result = await run({ report: "bal", account_pattern: "Expenses" });
    expect(result.details.command).toContain("hledger bal");
    expect(result.details.command).toContain("Expenses");
  });
});
