// Dashboard data for the desktop app's main-page finance overview. Composes
// fetchBriefingData (current-month figures) with two multi-period hledger
// reports (historical series). `--monthly` expands the report period to whole
// months, so the multi-period queries end at the first of the current month
// (interval-aligned, no future-transaction leakage) and the current-month data
// points come from briefing's exact-range queries instead.

import { type BriefingData, fetchBriefingData, parseAmounts, parseCSVLine } from "./briefing";
import { type HledgerRunOpts, tryRunHledger } from "./hledger";

export interface CurrencyAmount {
  amount: number;
  currency: string;
}

export interface NetWorthPoint {
  month: string; // "2025-08"
  amounts: CurrencyAmount[];
}

export interface IncomeExpensePoint {
  month: string;
  income: CurrencyAmount[];
  expenses: CurrencyAmount[];
}

export interface DashboardData {
  netWorth: BriefingData["netWorth"];
  incomeThisMonth: BriefingData["incomeThisMonth"];
  spendThisMonth: BriefingData["spendThisMonth"];
  topCategories: BriefingData["topCategories"];
  netWorthSeries: NetWorthPoint[]; // NET_WORTH_MONTHS entries, oldest first, last = now
  incomeExpenseSeries: IncomeExpensePoint[]; // INCOME_EXPENSE_MONTHS entries, last = current month
  dominantCurrency: string; // "" when the ledger has no data
  otherCurrencies: string[];
  hasTransactions: boolean;
  error: string | null;
}

export const NET_WORTH_MONTHS = 12;
export const INCOME_EXPENSE_MONTHS = 6;

export interface MultiPeriodRow {
  account: string;
  cells: CurrencyAmount[][]; // one cell per month column
}

/** Parse a multi-period `bal --monthly -O csv` report: header holds the month
 *  labels ("account","2025-08",...), zero cells are literal "0", multi-commodity
 *  cells are ", "-separated, and the last row is "Total:". */
export function parseMultiPeriodBalCSV(csv: string): { months: string[]; rows: MultiPeriodRow[] } {
  const lines = csv.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return { months: [], rows: [] };
  const months = parseCSVLine(lines[0])
    .slice(1)
    .map((m) => m.trim());
  const rows: MultiPeriodRow[] = [];
  for (const line of lines.slice(1)) {
    const fields = parseCSVLine(line);
    const key = fields[0].toLowerCase().replace(/:$/, "");
    if (!fields[0] || key === "account" || key === "total") continue;
    rows.push({
      account: fields[0],
      cells: months.map((_, i) =>
        parseAmounts(fields[i + 1] ?? "0").filter((a) => a.currency !== "" || a.amount !== 0),
      ),
    });
  }
  return { months, rows };
}

/** Most-active currency: most non-zero income/expense cells across the series
 *  (magnitude alone would mis-rank low-value currencies); ties broken by larger
 *  absolute net worth. Returns "" when the ledger has no currencies at all. */
export function pickDominantCurrency(
  incomeExpenseSeries: IncomeExpensePoint[],
  netWorth: BriefingData["netWorth"],
): { dominant: string; others: string[] } {
  const activity = new Map<string, number>();
  for (const point of incomeExpenseSeries) {
    for (const cell of [...point.income, ...point.expenses]) {
      if (cell.amount !== 0 && cell.currency) {
        activity.set(cell.currency, (activity.get(cell.currency) ?? 0) + 1);
      }
    }
  }
  const netWorthAbs = new Map(netWorth.map((n) => [n.currency, Math.abs(n.amount)]));
  const candidates = new Set([...activity.keys(), ...netWorthAbs.keys()]);
  candidates.delete("");
  const ranked = [...candidates].sort((a, b) => {
    const byActivity = (activity.get(b) ?? 0) - (activity.get(a) ?? 0);
    if (byActivity !== 0) return byActivity;
    return (netWorthAbs.get(b) ?? 0) - (netWorthAbs.get(a) ?? 0);
  });
  return { dominant: ranked[0] ?? "", others: ranked.slice(1) };
}

export async function fetchDashboardData(journalPath: string, opts?: HledgerRunOpts): Promise<DashboardData> {
  const f = ["-f", journalPath];
  const now = new Date();
  const netWorthLabels = monthLabels(now, NET_WORTH_MONTHS);
  const incomeExpenseLabels = monthLabels(now, INCOME_EXPENSE_MONTHS);
  const currentMonthStart = `${netWorthLabels[netWorthLabels.length - 1]}-01`;

  let briefing: BriefingData;
  let netWorthCsv: string | null;
  let incomeExpenseCsv: string | null;
  try {
    [briefing, netWorthCsv, incomeExpenseCsv] = await Promise.all([
      fetchBriefingData(journalPath, opts),
      tryRunHledger(
        // biome-ignore format: the command reads better on one line
        ["bal", ...f, "Assets", "Liabilities", "--flat", "--monthly", "--historical", "-b", `${netWorthLabels[0]}-01`, "-e", currentMonthStart, "-O", "csv"],
        opts,
      ),
      tryRunHledger(
        // biome-ignore format: the command reads better on one line
        ["bal", ...f, "Income", "Expenses", "--monthly", "--depth", "1", "-b", `${incomeExpenseLabels[0]}-01`, "-e", currentMonthStart, "-O", "csv"],
        opts,
      ),
    ]);
  } catch {
    // tryRunHledger only re-throws HledgerNotFoundError
    return { ...emptyDashboard(), error: "hledger is not installed. Install it from https://hledger.org/install" };
  }
  if (briefing.error) return { ...emptyDashboard(), error: briefing.error };

  const netWorthParsed = parseMultiPeriodBalCSV(netWorthCsv ?? "");
  const netWorthByMonth = sumByMonth(netWorthParsed);
  const netWorthSeries: NetWorthPoint[] = netWorthLabels.map((month, i) =>
    i === netWorthLabels.length - 1
      ? { month, amounts: briefing.netWorth.map(({ amount, currency }) => ({ amount, currency })) }
      : { month, amounts: toCurrencyAmounts(netWorthByMonth.get(month)) },
  );

  const incomeExpenseParsed = parseMultiPeriodBalCSV(incomeExpenseCsv ?? "");
  const incomeByMonth = sumByMonth(incomeExpenseParsed, (account) => /^income/i.test(account));
  const expensesByMonth = sumByMonth(incomeExpenseParsed, (account) => /^expenses/i.test(account));
  const incomeExpenseSeries: IncomeExpensePoint[] = incomeExpenseLabels.map((month, i) =>
    i === incomeExpenseLabels.length - 1
      ? { month, income: [...briefing.incomeThisMonth], expenses: [...briefing.spendThisMonth] }
      : {
          month,
          // income balances are negative in hledger; negate (not abs) so a
          // refund-heavy month shows honestly
          income: toCurrencyAmounts(incomeByMonth.get(month), { negate: true }),
          expenses: toCurrencyAmounts(expensesByMonth.get(month)),
        },
  );

  const { dominant, others } = pickDominantCurrency(incomeExpenseSeries, briefing.netWorth);
  const hasSeriesData =
    netWorthSeries.some((p) => p.amounts.some((a) => a.amount !== 0)) ||
    incomeExpenseSeries.some((p) => [...p.income, ...p.expenses].some((a) => a.amount !== 0));

  return {
    netWorth: briefing.netWorth,
    incomeThisMonth: briefing.incomeThisMonth,
    spendThisMonth: briefing.spendThisMonth,
    topCategories: briefing.topCategories,
    netWorthSeries,
    incomeExpenseSeries,
    dominantCurrency: dominant,
    otherCurrencies: others,
    hasTransactions: briefing.netWorth.length > 0 || briefing.topCategories.length > 0 || hasSeriesData,
    error: null,
  };
}

// ── Internals ───────────────────────────────────────────────────────

/** Last `count` month labels ("YYYY-MM"), oldest first, ending at now's month. */
function monthLabels(now: Date, count: number): string[] {
  const labels: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return labels;
}

/** Per month label: currency → sum across matching account rows. */
function sumByMonth(
  parsed: { months: string[]; rows: MultiPeriodRow[] },
  accountFilter?: (account: string) => boolean,
): Map<string, Map<string, number>> {
  const byMonth = new Map<string, Map<string, number>>();
  parsed.months.forEach((month, i) => {
    const byCurrency = new Map<string, number>();
    for (const row of parsed.rows) {
      if (accountFilter && !accountFilter(row.account)) continue;
      for (const cell of row.cells[i]) {
        if (!cell.currency && cell.amount === 0) continue;
        byCurrency.set(cell.currency, (byCurrency.get(cell.currency) ?? 0) + cell.amount);
      }
    }
    byMonth.set(month, byCurrency);
  });
  return byMonth;
}

function toCurrencyAmounts(byCurrency: Map<string, number> | undefined, opts?: { negate?: boolean }): CurrencyAmount[] {
  if (!byCurrency) return [];
  return [...byCurrency.entries()]
    .filter(([, amount]) => amount !== 0)
    .map(([currency, amount]) => ({ amount: opts?.negate ? -amount : amount, currency }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

function emptyDashboard(): DashboardData {
  return {
    netWorth: [],
    incomeThisMonth: [],
    spendThisMonth: [],
    topCategories: [],
    netWorthSeries: [],
    incomeExpenseSeries: [],
    dominantCurrency: "",
    otherCurrencies: [],
    hasTransactions: false,
    error: null,
  };
}
