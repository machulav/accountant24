import { HledgerNotFoundError, tryRunHledger } from "../../tools/hledger.js";

export interface BriefingData {
  netWorth: { amount: number; currency: string; change: number } | null;
  spendThisMonth: { amount: number; currency: string } | null;
  incomeThisMonth: { amount: number; currency: string } | null;
  recentTransactions: Array<{
    date: string;
    description: string;
    amount: number;
    currency: string;
    account: string;
  }>;
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
      const { amount, currency } = parseAmount(fields[1]);
      rows.push({ name: fields[0], amount, currency });
    }
  }
  return rows;
}

// hledger reg CSV columns: txnidx, date, code, description, account, amount, total
export function parseRegisterCsv(
  csv: string,
): Array<{ txnidx: string; date: string; description: string; account: string; amount: number; currency: string }> {
  const lines = csv.split("\n").filter((l) => l.trim());
  const rows: Array<{
    txnidx: string;
    date: string;
    description: string;
    account: string;
    amount: number;
    currency: string;
  }> = [];
  for (const line of lines) {
    const fields = parseCSVLine(line);
    if (fields[0] === "txnidx") continue;
    if (fields.length >= 6) {
      const { amount, currency } = parseAmount(fields[5]);
      rows.push({
        txnidx: fields[0],
        date: fields[1],
        description: fields[3],
        account: fields[4],
        amount,
        currency,
      });
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
    netWorth: null,
    spendThisMonth: null,
    incomeThisMonth: null,
    recentTransactions: [],
    topCategories: [],
    error: null,
  };
}

const TOP_CATEGORIES_LIMIT = 5;
const RECENT_TRANSACTIONS_LIMIT = 5;

export async function fetchBriefingData(journalPath: string): Promise<BriefingData> {
  const { beginDate, endDate } = getMonthBounds();
  const f = ["-f", journalPath];

  let netWorthNow: string | null;
  let netWorthPrev: string | null;
  let expenses: string | null;
  let income: string | null;
  let categories: string | null;
  let register: string | null;

  try {
    [netWorthNow, netWorthPrev, expenses, income, categories, register] = await Promise.all([
      tryRunHledger(["bal", ...f, "Assets", "Liabilities", "-O", "csv"]),
      tryRunHledger(["bal", ...f, "Assets", "Liabilities", "-e", beginDate, "-O", "csv"]),
      tryRunHledger(["bal", ...f, "Expenses", "-b", beginDate, "-e", endDate, "--depth", "1", "-O", "csv"]),
      tryRunHledger(["bal", ...f, "Income", "-b", beginDate, "-e", endDate, "--depth", "1", "-O", "csv"]),
      tryRunHledger(["bal", ...f, "Expenses", "-b", beginDate, "-e", endDate, "--depth", "2", "-O", "csv"]),
      tryRunHledger(["reg", ...f, "-b", beginDate, "-O", "csv"]),
    ]);
  } catch (e) {
    if (e instanceof HledgerNotFoundError) {
      return { ...emptyData(), error: "hledger is not installed. Install it from https://hledger.org/install" };
    }
    throw e;
  }

  const data = emptyData();

  // Net worth
  const nwCurrent = netWorthNow ? parseBalTotal(netWorthNow) : null;
  const nwPrev = netWorthPrev ? parseBalTotal(netWorthPrev) : null;
  if (nwCurrent) {
    data.netWorth = {
      amount: nwCurrent.amount,
      currency: nwCurrent.currency,
      change: nwPrev ? nwCurrent.amount - nwPrev.amount : 0,
    };
  }

  // Spend this month
  if (expenses) {
    const total = parseBalTotal(expenses);
    if (total) data.spendThisMonth = { amount: total.amount, currency: total.currency };
  }

  // Income this month (naturally negative in hledger, negate for display)
  if (income) {
    const total = parseBalTotal(income);
    if (total) data.incomeThisMonth = { amount: Math.abs(total.amount), currency: total.currency };
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

  // Recent transactions — group postings by txnidx, pick most recent
  if (register) {
    const allRows = parseRegisterCsv(register);
    const byTxn = new Map<string, (typeof allRows)[number][]>();
    for (const row of allRows) {
      let group = byTxn.get(row.txnidx);
      if (!group) {
        group = [];
        byTxn.set(row.txnidx, group);
      }
      group.push(row);
    }

    // Sort by date descending, take most recent
    const txnIds = [...byTxn.keys()].sort((a, b) => {
      const dateA = byTxn.get(a)?.[0]?.date ?? "";
      const dateB = byTxn.get(b)?.[0]?.date ?? "";
      return dateB.localeCompare(dateA);
    });
    data.recentTransactions = txnIds.slice(0, RECENT_TRANSACTIONS_LIMIT).map((id) => {
      const postings = byTxn.get(id) ?? [];
      const interesting =
        postings.find((r) => r.account.startsWith("Expenses:") || r.account.startsWith("Income:")) ?? postings[0];
      const desc = interesting.description.includes("|")
        ? interesting.description.split("|")[0].trim()
        : interesting.description;
      const account = interesting.account.replace(/^(Expenses|Income):/, "");
      // Expense postings are positive in hledger → show as negative (money out)
      // Income postings are negative in hledger → show as positive (money in)
      const isExpenseOrIncome =
        interesting.account.startsWith("Expenses:") || interesting.account.startsWith("Income:");
      const displayAmount = isExpenseOrIncome ? -interesting.amount : interesting.amount;
      return {
        date: interesting.date,
        description: desc,
        amount: displayAmount,
        currency: interesting.currency,
        account,
      };
    });
  }

  return data;
}
