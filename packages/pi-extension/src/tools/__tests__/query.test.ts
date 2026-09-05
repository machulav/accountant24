import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { spawnText } from "../../spawn";

vi.mock("../../spawn");

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-query-"));
vi.mock("../../config.js", () => ({
  ACCOUNTANT24_WORKSPACE: BASE,
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
const { MAX_INLINE_CHARS, PREVIEW_CHARS, sweepStaleScratch } = await import("../../ledger/query.js");

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

/** A string of exactly `chars` characters with a line break every 10. */
function blob(chars: number): string {
  return "012345678\n".repeat(Math.ceil(chars / 10)).slice(0, chars);
}

/** The preview portion of a spilled result (everything before the trailer). */
function previewOf(text: string): string {
  return text.split("\n\n[")[0];
}

describe("large-output spillover", () => {
  // One scratch dir for the whole process; remove it once, after the block.
  let spilledDir: string | undefined;
  afterAll(() => {
    if (spilledDir) rmSync(spilledDir, { recursive: true, force: true });
  });
  const spill = async (params: any, signal?: AbortSignal) => {
    const result = await (queryTool.execute("t", params, signal, undefined, undefined as any) as Promise<any>);
    if (result.details.outputFile) spilledDir = dirname(result.details.outputFile);
    return result;
  };

  test("returns output inline at exactly the size limit", async () => {
    mockProc = makeMockProc(0, blob(MAX_INLINE_CHARS));
    const result = await spill({ report: "reg" });
    expect(result.details.outputFile).toBeUndefined();
    expect(result.content[0].text).toBe(blob(MAX_INLINE_CHARS));
  });

  test("spills to a scratch file one character over the limit", async () => {
    const raw = blob(MAX_INLINE_CHARS + 1);
    mockProc = makeMockProc(0, raw);
    const result = await spill({ report: "reg" });
    expect(result.details.outputFile).toBeDefined();
    expect(existsSync(result.details.outputFile)).toBe(true);
    expect(readFileSync(result.details.outputFile, "utf-8")).toBe(raw);
  });

  test("returns a head preview plus the path, not the full output", async () => {
    const raw = blob(MAX_INLINE_CHARS * 4);
    mockProc = makeMockProc(0, raw);
    const result = await spill({ report: "reg" });
    const text = result.content[0].text as string;
    expect(text).toContain(result.details.outputFile);
    expect(text).toContain("Preview only");
    expect(text.length).toBeLessThan(raw.length);
    // the preview is a real prefix of the output, trimmed to a line break
    const preview = previewOf(text);
    expect(preview.length).toBeLessThanOrEqual(PREVIEW_CHARS);
    expect(raw.startsWith(preview)).toBe(true);
  });

  test("writes the scratch file in the OS tmpdir, not the workspace", async () => {
    mockProc = makeMockProc(0, blob(MAX_INLINE_CHARS * 2));
    const result = await spill({ report: "reg" });
    expect(result.details.outputFile).toContain(tmpdir());
    expect(result.details.outputFile).not.toContain(BASE);
  });

  test("names the scratch file with the output_format extension", async () => {
    mockProc = makeMockProc(0, blob(MAX_INLINE_CHARS * 2));
    expect((await spill({ report: "reg", output_format: "tsv" })).details.outputFile).toMatch(/\.tsv$/);
    expect((await spill({ report: "reg", output_format: "json" })).details.outputFile).toMatch(/\.json$/);
  });

  test("defaults the scratch file extension to txt with no output_format", async () => {
    mockProc = makeMockProc(0, blob(MAX_INLINE_CHARS * 2));
    expect((await spill({ report: "reg" })).details.outputFile).toMatch(/\.txt$/);
  });

  test("still returns the real hledger command in details when spilled", async () => {
    mockProc = makeMockProc(0, blob(MAX_INLINE_CHARS * 2));
    const result = await spill({ report: "bal", account_pattern: "Expenses" });
    expect(result.details.command).toContain("hledger bal");
    expect(result.details.command).toContain("Expenses");
  });

  test("gives two spills in the same millisecond distinct scratch files", async () => {
    // One host process serves every chat, so concurrent queries can spill in
    // the same tick; a timestamp-only name would overwrite the first result.
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_756_000_000_000);
    try {
      mockProc = makeMockProc(0, blob(MAX_INLINE_CHARS * 2));
      const first = await spill({ report: "reg" });
      const second = await spill({ report: "reg" });
      expect(first.details.outputFile).not.toBe(second.details.outputFile);
      expect(existsSync(first.details.outputFile)).toBe(true);
      expect(existsSync(second.details.outputFile)).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test("recreates the scratch dir when it was swept away mid-run", async () => {
    // Another instance's TTL sweep (or a tmp cleaner) can remove this
    // process's scratch dir while it is still running; the next spill must
    // get a fresh dir instead of failing until restart.
    mockProc = makeMockProc(0, blob(MAX_INLINE_CHARS * 2));
    const first = await spill({ report: "reg" });
    rmSync(dirname(first.details.outputFile), { recursive: true, force: true });
    const second = await spill({ report: "reg" });
    expect(second.details.outputFile).toBeDefined();
    expect(existsSync(second.details.outputFile)).toBe(true);
  });

  test("refreshes the scratch dir mtime on each spill so a live dir never looks stale", async () => {
    mockProc = makeMockProc(0, blob(MAX_INLINE_CHARS * 2));
    const first = await spill({ report: "reg" });
    const dir = dirname(first.details.outputFile);
    const past = new Date(Date.now() - 60_000);
    utimesSync(dir, past, past);
    await spill({ report: "reg" });
    expect(statSync(dir).mtimeMs).toBeGreaterThan(Date.now() - 5_000);
  });

  test("falls back to an inline preview when the scratch write fails", async () => {
    // hledger (mocked spawn) still succeeds; an already-aborted signal makes
    // writeFile reject, exercising the catch without failing the whole query.
    mockProc = makeMockProc(0, blob(MAX_INLINE_CHARS * 3));
    const result = await spill({ report: "reg" }, AbortSignal.abort());
    expect(result.details.outputFile).toBeUndefined();
    const text = result.content[0].text as string;
    expect(text).toContain("Scratch file unavailable");
    expect(text.length).toBeLessThan((MAX_INLINE_CHARS * 3) as number);
    expect(blob(MAX_INLINE_CHARS * 3).startsWith(previewOf(text))).toBe(true);
  });
});

describe("sweepStaleScratch", () => {
  test("removes scratch dirs older than the ttl, keeps fresh and unrelated ones", () => {
    const base = mkdtempSync(join(tmpdir(), "sweep-test-"));
    try {
      const stale = mkdtempSync(join(base, "accountant24-query-scratch-"));
      const fresh = mkdtempSync(join(base, "accountant24-query-scratch-"));
      const unrelated = mkdtempSync(join(base, "something-else-"));
      const past = new Date(Date.now() - 60_000);
      utimesSync(stale, past, past);

      sweepStaleScratch(base, 1_000); // ttl 1s: stale (60s old) goes, fresh stays

      expect(existsSync(stale)).toBe(false);
      expect(existsSync(fresh)).toBe(true);
      expect(existsSync(unrelated)).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("skips an entry that cannot be stat'd (vanished or broken symlink)", () => {
    const base = mkdtempSync(join(tmpdir(), "sweep-test-"));
    try {
      symlinkSync(join(base, "nonexistent-target"), join(base, "accountant24-query-scratch-broken"));
      expect(() => sweepStaleScratch(base, 0)).not.toThrow();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("does nothing when the base directory does not exist", () => {
    expect(() => sweepStaleScratch(join(tmpdir(), "sweep-no-such-dir-xyz"), 0)).not.toThrow();
  });
});
