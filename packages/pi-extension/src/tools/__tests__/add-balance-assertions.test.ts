import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { spawnText } from "../../spawn";

vi.mock("../../spawn");

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-add-ba-"));
const LEDGER = join(BASE, "ledger");

vi.mock("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  LEDGER_DIR: LEDGER,
  MEMORY_PATH: join(BASE, "memory.md"),
  setBaseDir: () => {},
}));

// Mock at spawnText level so real hledger.ts functions execute for coverage.

function makeMockProc(exitCode: number, stdout = "", stderr = "") {
  return { exitCode, stdout, stderr };
}

const { addBalanceAssertionsTool } = await import("../add-balance-assertions.js");

afterAll(() => {
  rmSync(BASE, { recursive: true, force: true });
});

beforeEach(() => {
  vi.mocked(spawnText).mockImplementation(async () => makeMockProc(0));
  rmSync(LEDGER, { recursive: true, force: true });
  mkdirSync(LEDGER, { recursive: true });
});

const run = (params: any) =>
  addBalanceAssertionsTool.execute("test", params, undefined, undefined, undefined as any) as Promise<any>;

const checkpoint = {
  date: "2026-03-15",
  account: "Assets:Bank:Cash",
  balance: { amount: 200, currency: "EUR" },
};

test("saves a standalone checkpoint and reports the entry text", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run({ assertions: [checkpoint] });
  const text = result.content[0].text;
  expect(text).toContain("Balance assertion saved to");
  expect(text).toContain("2026-03-15 * Balance Assertion");
  expect(text).toMatch(/Assets:Bank:Cash\s+0\.00 EUR = 200\.00 EUR/);
});

test("routes the entry to ledger/YYYY/MM.journal and returns diffs in details", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run({ assertions: [checkpoint] });
  const filePath = join(LEDGER, "2026", "03.journal");
  expect(existsSync(filePath)).toBe(true);
  expect(readFileSync(filePath, "utf-8")).toContain("Balance Assertion");
  expect(result.details.diffs).toHaveLength(1);
  expect(result.details.diffs[0].diff).toContain("= 200.00 EUR");
});

test("reports a numbered list when several assertions are saved at once", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run({
    assertions: [
      checkpoint,
      { date: "2026-03-15", account: "Assets:Bank:Checking", balance: { amount: 500, currency: "EUR" } },
    ],
  });
  const text = result.content[0].text;
  expect(text).toContain("2 balance assertions saved");
  expect(text).toContain("1. ");
  expect(text).toContain("2. ");
  expect(text).toMatch(/Assets:Bank:Checking\s+0\.00 EUR = 500\.00 EUR/);
});
