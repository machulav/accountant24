import { tryRunHledger } from "../hledger";

export interface BriefingData {
  netWorth: Array<{ amount: number; currency: string; change: number }>;
  spendThisMonth: Array<{ amount: number; currency: string }>;
  incomeThisMonth: Array<{ amount: number; currency: string }>;
  topCategories: Array<{
    name: string;
    amount: number;
    currency: string;
  }>;
  error: string | null;
}

export function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

export function parseAmount(str: string): { amount: number; currency: string } {
  const trimmed = str.trim();
  if (!trimmed || trimmed === "0") return { amount: 0, currency: "" };

  // Number-first: "100.00 USD" or "-1,234.56 EUR"
  const numFirst = trimmed.match(/^(-?[\d,]+\.?\d*)\s+(.+)$/);
  if (numFirst) {
    const num = Number.parseFloat(numFirst[1].replace(/,/g, ""));
    return { amount: Number.isNaN(num) ? 0 : num, currency: numFirst[2].trim() };
  }

  // Commodity-first: "EUR 100.00" or "EUR -1,234.56" or "$ 50"
  const comFirst = trimmed.match(/^([^\d-]+?)\s*(-?[\d,]+\.?\d*)$/);
  if (comFirst) {
    const num = Number.parseFloat(comFirst[2].replace(/,/g, ""));
    return { amount: Number.isNaN(num) ? 0 : num, currency: comFirst[1].trim() };
  }

  // Just a number
  const num = Number.parseFloat(trimmed.replace(/,/g, ""));
  return { amount: Number.isNaN(num) ? 0 : num, currency: "" };
}

/** Parse a balance field that may contain comma-separated amounts: "EUR 1917.61, 5.00 USD" */
export function parseAmounts(str: string): Array<{ amount: number; currency: string }> {
  const trimmed = str.trim();
  if (!trimmed || trimmed === "0") return [{ amount: 0, currency: "" }];

  // hledger separates multiple commodities with ", " (comma-space).
  // Thousand separators use comma WITHOUT space: "1,234.56"
  // So splitting on ", " is safe.
  return trimmed.split(", ").map(parseAmount);
}

export function parseBalTotal(csv: string): { amount: number; currency: string } | null {
  const lines = csv.split("\n").filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    const fields = parseCSVLine(lines[i]);
    const key = fields[0].toLowerCase().replace(/:$/, "");
    if (key === "total" && fields[1]) {
      return parseAmount(fields[1]);
    }
  }
  return null;
}

export function parseBalRows(csv: string): Array<{ name: string; amount: number; currency: string }> {
  const lines = csv.split("\n").filter((l) => l.trim());
  const rows: Array<{ name: string; amount: number; currency: string }> = [];
  for (const line of lines) {
    const fields = parseCSVLine(line);
    const key = fields[0].toLowerCase().replace(/:$/, "");
    if (key === "account" || key === "total") continue;
    if (fields[0] && fields[1]) {
      for (const parsed of parseAmounts(fields[1])) {
        rows.push({ name: fields[0], amount: parsed.amount, currency: parsed.currency });
      }
    }
  }
  return rows;
}

function getMonthBounds(): { beginDate: string; endDate: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const beginDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const nextYear = month === 11 ? year + 1 : year;
  const nextMonth = month === 11 ? 1 : month + 2;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return { beginDate, endDate };
}

function emptyData(): BriefingData {
  return {
    netWorth: [],
    spendThisMonth: [],
    incomeThisMonth: [],
    topCategories: [],
    error: null,
  };
}

const TOP_CATEGORIES_LIMIT = 5;

export async function fetchBriefingData(journalPath: string): Promise<BriefingData> {
  const { beginDate, endDate } = getMonthBounds();
  const f = ["-f", journalPath];

  let netWorthNow: string | null;
  let netWorthPrev: string | null;
  let expenses: string | null;
  let income: string | null;
  let categories: string | null;

  try {
    [netWorthNow, netWorthPrev, expenses, income, categories] = await Promise.all([
      tryRunHledger(["bal", ...f, "Assets", "Liabilities", "--flat", "-O", "csv"]),
      tryRunHledger(["bal", ...f, "Assets", "Liabilities", "--flat", "-e", beginDate, "-O", "csv"]),
      tryRunHledger(["bal", ...f, "Expenses", "-b", beginDate, "-e", endDate, "--depth", "1", "-O", "csv"]),
      tryRunHledger(["bal", ...f, "Income", "-b", beginDate, "-e", endDate, "--depth", "1", "-O", "csv"]),
      tryRunHledger(["bal", ...f, "Expenses", "-b", beginDate, "-e", endDate, "--depth", "2", "-O", "csv"]),
    ]);
  } catch {
    // tryRunHledger only re-throws HledgerNotFoundError; all other errors return null
    return { ...emptyData(), error: "hledger is not installed. Install it from https://hledger.org/install" };
  }

  const data = emptyData();

  // Net worth — aggregate by currency, compute change from previous month
  if (netWorthNow) {
    const aggregate = (csv: string) => {
      const map = new Map<string, number>();
      for (const row of parseBalRows(csv)) {
        map.set(row.currency, (map.get(row.currency) ?? 0) + row.amount);
      }
      return map;
    };
    const current = aggregate(netWorthNow);
    const prev = netWorthPrev ? aggregate(netWorthPrev) : new Map<string, number>();

    data.netWorth = [...current.entries()]
      .filter(([, amount]) => amount !== 0)
      .map(([currency, amount]) => ({
        amount,
        currency,
        change: amount - (prev.get(currency) ?? 0),
      }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  }

  // Primary currency for zero fallback
  const primaryCurrency = data.netWorth.length > 0 ? data.netWorth[0].currency : "";

  // Spend this month — aggregate by currency
  if (expenses) {
    const byCurrency = new Map<string, number>();
    for (const row of parseBalRows(expenses)) {
      byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + row.amount);
    }
    const entries = [...byCurrency.entries()]
      .filter(([, amount]) => amount !== 0)
      .map(([currency, amount]) => ({ amount, currency }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    data.spendThisMonth = entries.length > 0 ? entries : [{ amount: 0, currency: primaryCurrency }];
  }

  // Income this month — aggregate by currency (naturally negative in hledger, negate for display)
  if (income) {
    const byCurrency = new Map<string, number>();
    for (const row of parseBalRows(income)) {
      byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + row.amount);
    }
    const entries = [...byCurrency.entries()]
      .filter(([, amount]) => amount !== 0)
      .map(([currency, amount]) => ({ amount: Math.abs(amount), currency }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    data.incomeThisMonth = entries.length > 0 ? entries : [{ amount: 0, currency: primaryCurrency }];
  }

  // Top categories
  if (categories) {
    const rows = parseBalRows(categories);
    data.topCategories = rows
      .map((r) => ({
        name: r.name.replace(/^Expenses:/, ""),
        amount: r.amount,
        currency: r.currency,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, TOP_CATEGORIES_LIMIT);
  }

  return data;
}
