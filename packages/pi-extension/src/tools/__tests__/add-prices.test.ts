import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { spawnText } from "../../spawn";

vi.mock("../../spawn");

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-add-prices-"));
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

const { addPricesTool } = await import("../add-prices.js");

afterAll(() => {
  rmSync(BASE, { recursive: true, force: true });
});

beforeEach(() => {
  vi.mocked(spawnText).mockImplementation(async () => makeMockProc(0));
  rmSync(LEDGER, { recursive: true, force: true });
  mkdirSync(LEDGER, { recursive: true });
});

const run = (params: any) =>
  addPricesTool.execute("test", params, undefined, undefined, undefined as any) as Promise<any>;

const rate = {
  date: "2026-03-15",
  commodity: "USD",
  price: { amount: 0.87, currency: "EUR" },
};

test("saves a P directive and reports its text", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run({ prices: [rate] });
  const text = result.content[0].text;
  expect(text).toContain("Price saved to");
  expect(text).toContain("P 2026-03-15 USD 0.87 EUR");
});

test("routes the directive to ledger/YYYY/MM.journal and returns diffs in details", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run({ prices: [rate] });
  const filePath = join(LEDGER, "2026", "03.journal");
  expect(existsSync(filePath)).toBe(true);
  expect(readFileSync(filePath, "utf-8")).toContain("P 2026-03-15 USD 0.87 EUR");
  expect(result.details.diffs).toHaveLength(1);
  expect(result.details.diffs[0].diff).toContain("P 2026-03-15 USD 0.87 EUR");
});

test("reports a numbered list when several prices are saved at once", async () => {
  writeFileSync(join(LEDGER, "main.journal"), "");
  const result = await run({
    prices: [rate, { date: "2026-03-15", commodity: "BTC", price: { amount: 55000, currency: "EUR" } }],
  });
  const text = result.content[0].text;
  expect(text).toContain("2 prices saved");
  expect(text).toContain("1. ");
  expect(text).toContain("2. ");
  expect(text).toContain("P 2026-03-15 BTC 55000 EUR");
});
