import { beforeEach, describe, expect, test, vi } from "vitest";
import { spawnText } from "../../spawn";

vi.mock("../../spawn");

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import {
  fetchDashboardData,
  INCOME_EXPENSE_MONTHS,
  NET_WORTH_MONTHS,
  parseMultiPeriodBalCSV,
  pickDominantCurrency,
} from "../dashboard";

// Mock at I/O boundary (spawnText) so the real tryRunHledger/runHledger execute.

/** "YYYY-MM" label `offset` months before the current month. */
function label(offset: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type QueryResponses = {
  nwNow?: string | null;
  nwPrev?: string | null;
  expenses?: string | null;
  income?: string | null;
  categories?: string | null;
  nwSeries?: string | null;
  ieSeries?: string | null;
};

/** Dispatch mocked hledger output by inspecting the command line, so tests
 *  don't depend on internal call ordering. null/omitted → exitCode 1. */
function setQueries(responses: QueryResponses) {
  vi.mocked(spawnText).mockImplementation(async (cmd) => {
    const args = cmd.join(" ");
    const pick = (): string | null | undefined => {
      if (args.includes("--monthly")) {
        return args.includes("--historical") ? responses.nwSeries : responses.ieSeries;
      }
      if (args.includes("Assets")) return args.includes("tomorrow") ? responses.nwNow : responses.nwPrev;
      if (args.includes("--depth 2")) return responses.categories;
      if (args.includes("Expenses")) return responses.expenses;
      return responses.income;
    };
    const r = pick();
    if (r == null) return { exitCode: 1, stdout: "", stderr: "error" };
    return { exitCode: 0, stdout: r, stderr: "" };
  });
}

describe("parseMultiPeriodBalCSV()", () => {
  test("should extract month labels from the header", () => {
    const csv = `"account","2025-08","2025-09"\n"assets:checking","EUR 100.00","EUR 150.00"\n"Total:","EUR 100.00","EUR 150.00"`;
    const parsed = parseMultiPeriodBalCSV(csv);
    expect(parsed.months).toEqual(["2025-08", "2025-09"]);
  });

  test("should parse account rows with one cell per month", () => {
    const csv = `"account","2025-08","2025-09"\n"assets:checking","EUR 100.00","EUR 150.00"\n"Total:","EUR 100.00","EUR 150.00"`;
    const parsed = parseMultiPeriodBalCSV(csv);
    expect(parsed.rows).toEqual([
      {
        account: "assets:checking",
        cells: [[{ amount: 100, currency: "EUR" }], [{ amount: 150, currency: "EUR" }]],
      },
    ]);
  });

  test("should drop literal zero cells", () => {
    const csv = `"account","2025-08","2025-09"\n"assets:checking","0","EUR 150.00"`;
    const parsed = parseMultiPeriodBalCSV(csv);
    expect(parsed.rows[0].cells).toEqual([[], [{ amount: 150, currency: "EUR" }]]);
  });

  test("should split multi-currency cells", () => {
    const csv = `"account","2025-08"\n"assets:checking","EUR 1,917.61, 5.00 USD"`;
    const parsed = parseMultiPeriodBalCSV(csv);
    expect(parsed.rows[0].cells[0]).toEqual([
      { amount: 1917.61, currency: "EUR" },
      { amount: 5, currency: "USD" },
    ]);
  });

  test("should degrade quoted-ticker cells to empty without crashing", () => {
    const csv = `"account","2025-08"\n"assets:broker","""SXR8"" 2.37"`;
    const parsed = parseMultiPeriodBalCSV(csv);
    expect(parsed.rows[0].cells[0]).toEqual([]);
  });

  test("should skip the Total: row", () => {
    const csv = `"account","2025-08"\n"assets:checking","EUR 100.00"\n"Total:","EUR 100.00"`;
    expect(parseMultiPeriodBalCSV(csv).rows).toHaveLength(1);
  });

  test("should return empty result for empty CSV", () => {
    expect(parseMultiPeriodBalCSV("")).toEqual({ months: [], rows: [] });
  });

  test("should return no rows for header-only CSV", () => {
    expect(parseMultiPeriodBalCSV(`"account","balance"`)).toEqual({ months: ["balance"], rows: [] });
  });
});

describe("pickDominantCurrency()", () => {
  const point = (month: string, income: Array<[number, string]>, expenses: Array<[number, string]>) => ({
    month,
    income: income.map(([amount, currency]) => ({ amount, currency })),
    expenses: expenses.map(([amount, currency]) => ({ amount, currency })),
  });

  test("should pick the most active currency even when another has larger amounts", () => {
    const series = [
      point("2026-01", [[100, "EUR"]], [[50, "EUR"]]),
      point("2026-02", [], [[60, "EUR"]]),
      point("2026-03", [[999999, "USD"]], []),
    ];
    const netWorth = [{ amount: 500000, currency: "USD", change: 0 }];
    expect(pickDominantCurrency(series, netWorth)).toEqual({ dominant: "EUR", others: ["USD"] });
  });

  test("should break activity ties by larger absolute net worth", () => {
    const series = [point("2026-01", [[100, "EUR"]], [[100, "USD"]])];
    const netWorth = [
      { amount: -9000, currency: "USD", change: 0 },
      { amount: 1000, currency: "EUR", change: 0 },
    ];
    expect(pickDominantCurrency(series, netWorth)).toEqual({ dominant: "USD", others: ["EUR"] });
  });

  test("should rank net-worth-only currencies by absolute amount when there is no activity", () => {
    const netWorth = [
      { amount: 100, currency: "UAH", change: 0 },
      { amount: 90, currency: "BTC", change: 0 },
    ];
    expect(pickDominantCurrency([], netWorth)).toEqual({ dominant: "UAH", others: ["BTC"] });
  });

  test("should return empty when there are no currencies", () => {
    expect(pickDominantCurrency([], [])).toEqual({ dominant: "", others: [] });
  });
});

describe("fetchDashboardData()", () => {
  const NW_NOW = `"account","balance"\n"assets:checking","EUR 5000.00"\n"Total:","EUR 5000.00"`;
  const EXPENSES = `"account","balance"\n"expenses","EUR 1200.00"\n"Total:","EUR 1200.00"`;
  const INCOME = `"account","balance"\n"income","EUR -3000.00"\n"Total:","EUR -3000.00"`;

  beforeEach(() => {
    setQueries({});
  });

  test("should scaffold full-length series even when all queries fail", async () => {
    const data = await fetchDashboardData("/fake/main.journal");
    expect(data.netWorthSeries).toHaveLength(NET_WORTH_MONTHS);
    expect(data.incomeExpenseSeries).toHaveLength(INCOME_EXPENSE_MONTHS);
    expect(data.hasTransactions).toBe(false);
    expect(data.dominantCurrency).toBe("");
    expect(data.error).toBeNull();
  });

  test("should order series labels oldest to newest ending at the current month", async () => {
    const data = await fetchDashboardData("/fake/main.journal");
    expect(data.netWorthSeries[0].month).toBe(label(NET_WORTH_MONTHS - 1));
    expect(data.netWorthSeries[NET_WORTH_MONTHS - 1].month).toBe(label(0));
    expect(data.incomeExpenseSeries[0].month).toBe(label(INCOME_EXPENSE_MONTHS - 1));
    expect(data.incomeExpenseSeries[INCOME_EXPENSE_MONTHS - 1].month).toBe(label(0));
  });

  test("should place historical net worth by month label and zero-fill the rest", async () => {
    const nwSeries = `"account","${label(2)}"\n"assets:checking","EUR 100.00"\n"Total:","EUR 100.00"`;
    setQueries({ nwSeries });
    const data = await fetchDashboardData("/fake/main.journal");
    const filled = data.netWorthSeries.find((p) => p.month === label(2));
    expect(filled?.amounts).toEqual([{ amount: 100, currency: "EUR" }]);
    for (const p of data.netWorthSeries) {
      if (p.month !== label(2)) expect(p.amounts).toEqual([]);
    }
  });

  test("should sum asset and liability rows per month per currency", async () => {
    const nwSeries = `"account","${label(1)}"\n"assets:checking","EUR 100.00"\n"liabilities:card","EUR -30.00"\n"Total:","EUR 70.00"`;
    setQueries({ nwSeries });
    const data = await fetchDashboardData("/fake/main.journal");
    const point = data.netWorthSeries.find((p) => p.month === label(1));
    expect(point?.amounts).toEqual([{ amount: 70, currency: "EUR" }]);
  });

  test("should use the exact-range briefing value for the current net worth point", async () => {
    const nwSeries = `"account","${label(1)}"\n"assets:checking","EUR 100.00"\n"Total:","EUR 100.00"`;
    setQueries({ nwNow: NW_NOW, nwSeries });
    const data = await fetchDashboardData("/fake/main.journal");
    const current = data.netWorthSeries[NET_WORTH_MONTHS - 1];
    expect(current.month).toBe(label(0));
    expect(current.amounts).toEqual([{ amount: 5000, currency: "EUR" }]);
  });

  test("should negate income (not abs) and keep expenses as-is in past months", async () => {
    const ieSeries = `"account","${label(1)}"\n"income","EUR -3000.00"\n"expenses","EUR 2000.00"\n"Total:","EUR -1000.00"`;
    setQueries({ ieSeries });
    const data = await fetchDashboardData("/fake/main.journal");
    const point = data.incomeExpenseSeries.find((p) => p.month === label(1));
    expect(point?.income).toEqual([{ amount: 3000, currency: "EUR" }]);
    expect(point?.expenses).toEqual([{ amount: 2000, currency: "EUR" }]);
  });

  test("should show a refund-heavy past month as negative income", async () => {
    const ieSeries = `"account","${label(1)}"\n"income","EUR 250.00"\n"Total:","EUR 250.00"`;
    setQueries({ ieSeries });
    const data = await fetchDashboardData("/fake/main.journal");
    const point = data.incomeExpenseSeries.find((p) => p.month === label(1));
    expect(point?.income).toEqual([{ amount: -250, currency: "EUR" }]);
  });

  test("should use briefing values for the current income/expense point", async () => {
    setQueries({ nwNow: NW_NOW, expenses: EXPENSES, income: INCOME });
    const data = await fetchDashboardData("/fake/main.journal");
    const current = data.incomeExpenseSeries[INCOME_EXPENSE_MONTHS - 1];
    expect(current.income).toEqual([{ amount: 3000, currency: "EUR" }]);
    expect(current.expenses).toEqual([{ amount: 1200, currency: "EUR" }]);
  });

  test("should pass through briefing stat figures", async () => {
    setQueries({ nwNow: NW_NOW, expenses: EXPENSES, income: INCOME });
    const data = await fetchDashboardData("/fake/main.journal");
    expect(data.netWorth).toEqual([{ amount: 5000, currency: "EUR", change: 5000 }]);
    expect(data.spendThisMonth).toEqual([{ amount: 1200, currency: "EUR" }]);
    expect(data.incomeThisMonth).toEqual([{ amount: 3000, currency: "EUR" }]);
  });

  test("should compute dominant and other currencies from series activity", async () => {
    const ieSeries = `"account","${label(2)}","${label(1)}"\n"income","EUR -3000.00","EUR -3000.00, -10.00 USD"\n"expenses","EUR 2000.00","EUR 1500.00"\n"Total:","EUR -1000.00","EUR -1500.00, -10.00 USD"`;
    setQueries({ ieSeries });
    const data = await fetchDashboardData("/fake/main.journal");
    expect(data.dominantCurrency).toBe("EUR");
    expect(data.otherCurrencies).toEqual(["USD"]);
  });

  test("should set hasTransactions when only series data exists", async () => {
    const nwSeries = `"account","${label(3)}"\n"assets:checking","EUR 100.00"\n"Total:","EUR 100.00"`;
    setQueries({ nwSeries });
    const data = await fetchDashboardData("/fake/main.journal");
    expect(data.hasTransactions).toBe(true);
  });

  test("should report hasTransactions=false for header-and-total-only outputs", async () => {
    const emptyNw = `"account","${label(1)}"\n"Total:","0"`;
    const emptyIe = `"account","${label(1)}"\n"Total:","0"`;
    setQueries({ nwSeries: emptyNw, ieSeries: emptyIe });
    const data = await fetchDashboardData("/fake/main.journal");
    expect(data.hasTransactions).toBe(false);
  });

  test("should set error and empty series when hledger is not installed", async () => {
    vi.mocked(spawnText).mockResolvedValue({ exitCode: 127, stdout: "", stderr: "not found" });
    const data = await fetchDashboardData("/fake/main.journal");
    expect(data.error).toContain("hledger is not installed");
    expect(data.netWorthSeries).toEqual([]);
    expect(data.incomeExpenseSeries).toEqual([]);
    expect(data.hasTransactions).toBe(false);
  });

  test("should forward env and cwd opts to every spawnText call", async () => {
    setQueries({});
    const env = { PATH: "/vendored/bin" };
    await fetchDashboardData("/fake/main.journal", { env, cwd: "/workspace" });
    const calls = vi.mocked(spawnText).mock.calls;
    expect(calls).toHaveLength(7);
    for (const call of calls) {
      expect(call[1]).toMatchObject({ env, cwd: "/workspace" });
    }
  });
});

// ── Integration: future-dated transactions ─────────────────────────
// Uses real hledger to pin the whole `-e <monthStart>` + exact-range design:
// a future-dated transaction must not appear in any series point.

describe("fetchDashboardData() future transactions", () => {
  let tmp: string;
  let journalPath: string;

  beforeEach(() => {
    vi.mocked(spawnText).mockImplementation(async (cmd, opts) => {
      const r = spawnSync(cmd[0], cmd.slice(1), { cwd: opts?.cwd, encoding: "utf8" });
      if (r.error) throw r.error;
      return { exitCode: r.status ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    });

    tmp = mkdtempSync(join(tmpdir(), "dashboard-future-"));
    journalPath = join(tmp, "main.journal");

    const now = new Date();
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const today = fmt(now);
    const lastMonth = fmt(new Date(now.getFullYear(), now.getMonth() - 1, 15));
    const future = fmt(new Date(now.getFullYear(), now.getMonth() + 1, 15));

    writeFileSync(
      journalPath,
      [
        `${lastMonth} * Old Payee`,
        `    expenses:food    50.00 EUR`,
        `    assets:checking`,
        ``,
        `${today} * Current Payee`,
        `    expenses:food    100.00 EUR`,
        `    assets:checking`,
        ``,
        `${future} * Future Payee`,
        `    expenses:education    200.00 EUR`,
        `    assets:checking`,
      ].join("\n"),
    );
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("should exclude the future transaction from every net worth point", async () => {
    const data = await fetchDashboardData(journalPath);
    const current = data.netWorthSeries[NET_WORTH_MONTHS - 1];
    expect(current.amounts).toEqual([{ amount: -150, currency: "EUR" }]);
    const lastMonthPoint = data.netWorthSeries[NET_WORTH_MONTHS - 2];
    expect(lastMonthPoint.amounts).toEqual([{ amount: -50, currency: "EUR" }]);
  });

  test("should exclude the future transaction from every income/expense point", async () => {
    const data = await fetchDashboardData(journalPath);
    const current = data.incomeExpenseSeries[INCOME_EXPENSE_MONTHS - 1];
    expect(current.expenses).toEqual([{ amount: 100, currency: "EUR" }]);
    const lastMonthPoint = data.incomeExpenseSeries[INCOME_EXPENSE_MONTHS - 2];
    expect(lastMonthPoint.expenses).toEqual([{ amount: 50, currency: "EUR" }]);
    const total = data.incomeExpenseSeries.reduce((sum, p) => sum + p.expenses.reduce((s, e) => s + e.amount, 0), 0);
    expect(total).toBe(150);
  });

  test("should report EUR as dominant with no others", async () => {
    const data = await fetchDashboardData(journalPath);
    expect(data.dominantCurrency).toBe("EUR");
    expect(data.otherCurrencies).toEqual([]);
    expect(data.hasTransactions).toBe(true);
  });
});
