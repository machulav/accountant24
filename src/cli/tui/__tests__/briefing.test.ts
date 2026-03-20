import { describe, expect, test } from "bun:test";
import { Briefing } from "../briefing.js";
import type { BriefingData } from "../briefing-data.js";
import { createTheme } from "../theme.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes are control chars by definition
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function strip(str: string): string {
  return str.replace(ANSI_RE, "");
}

function stripLines(lines: string[]): string[] {
  return lines.map(strip);
}

const theme = createTheme();

function fullData(): BriefingData {
  return {
    netWorth: { amount: 12450, currency: "USD", change: 860 },
    spendThisMonth: { amount: 2340, currency: "USD" },
    incomeThisMonth: { amount: 5200, currency: "USD" },
    recentTransactions: [
      { date: "2026-03-19", description: "Whole Foods", amount: -45, currency: "USD", account: "Food:Groceries" },
      { date: "2026-03-18", description: "Shell Gas", amount: -52.3, currency: "USD", account: "Transport:Gas" },
      { date: "2026-03-17", description: "Netflix", amount: -15.99, currency: "USD", account: "Entertainment" },
      { date: "2026-03-16", description: "Employer Inc", amount: 2600, currency: "USD", account: "Salary" },
      { date: "2026-03-15", description: "Electric Co", amount: -89.5, currency: "USD", account: "Utilities" },
    ],
    topCategories: [
      { name: "Food", amount: 890, currency: "USD" },
      { name: "Housing", amount: 650, currency: "USD" },
      { name: "Transport", amount: 340, currency: "USD" },
      { name: "Utilities", amount: 260, currency: "USD" },
      { name: "Entertainment", amount: 200, currency: "USD" },
    ],
    error: null,
  };
}

describe("Briefing component", () => {
  test("returns empty when no data set", () => {
    const b = new Briefing(theme);
    expect(b.render(80)).toEqual([]);
  });

  test("renders empty state when no transactions", () => {
    const b = new Briefing(theme);
    b.setData({
      netWorth: null,
      spendThisMonth: null,
      incomeThisMonth: null,
      recentTransactions: [],
      topCategories: [],
      error: null,
    });
    const lines = stripLines(b.render(80));
    expect(lines.some((l) => l.includes("Accountant24"))).toBe(true);
    expect(lines.some((l) => l.includes("No transactions yet"))).toBe(true);
  });

  test("renders error state", () => {
    const b = new Briefing(theme);
    b.setData({
      netWorth: null,
      spendThisMonth: null,
      incomeThisMonth: null,
      recentTransactions: [],
      topCategories: [],
      error: "hledger is not installed",
    });
    const lines = stripLines(b.render(80));
    expect(lines.some((l) => l.includes("hledger is not installed"))).toBe(true);
  });

  test("renders header with Accountant24 and date", () => {
    const b = new Briefing(theme);
    b.setData(fullData());
    const lines = stripLines(b.render(80));
    expect(lines[1]).toContain("Accountant24");
    expect(lines[1]).toContain("──");
  });

  test("renders KPI amounts at wide width", () => {
    const b = new Briefing(theme);
    b.setData(fullData());
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("$12,450.00");
    expect(text).toContain("$2,340.00");
    expect(text).toContain("$5,200.00");
  });

  test("renders KPI labels", () => {
    const b = new Briefing(theme);
    b.setData(fullData());
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("Net Worth");
    expect(text).toContain("Spent");
    expect(text).toContain("Income");
  });

  test("renders positive change indicator", () => {
    const b = new Briefing(theme);
    b.setData(fullData());
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("▲");
    expect(text).toContain("$860.00");
  });

  test("renders negative change indicator", () => {
    const b = new Briefing(theme);
    const data = fullData();
    data.netWorth = { amount: 12450, currency: "USD", change: -500 };
    b.setData(data);
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("▼");
    expect(text).toContain("$500.00");
  });

  test("renders category section with amounts and percentages", () => {
    const b = new Briefing(theme);
    b.setData(fullData());
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("Top Categories");
    expect(text).toContain("Food");
    expect(text).toContain("$890.00");
    expect(text).toContain("%");
  });

  test("renders recent transactions", () => {
    const b = new Briefing(theme);
    b.setData(fullData());
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("Last Transactions");
    expect(text).toContain("Whole Foods");
    expect(text).toContain("Employer Inc");
  });

  test("renders at narrow width with stacked KPIs", () => {
    const b = new Briefing(theme);
    b.setData(fullData());
    const lines = stripLines(b.render(50));
    const text = lines.join("\n");
    expect(text).toContain("Net Worth");
    expect(text).toContain("$12,450.00");
    expect(text).toContain("Food");
    expect(text).toContain("$890.00");
  });

  test("renders at very narrow width with limited transactions", () => {
    const b = new Briefing(theme);
    b.setData(fullData());
    const lines = stripLines(b.render(45));
    // Should show max 3 transactions at narrow width
    const txnLines = lines.filter(
      (l) =>
        l.includes("Whole Foods") ||
        l.includes("Shell Gas") ||
        l.includes("Netflix") ||
        l.includes("Employer Inc") ||
        l.includes("Electric Co"),
    );
    expect(txnLines.length).toBeLessThanOrEqual(3);
  });

  test("omits change indicator when change is zero", () => {
    const b = new Briefing(theme);
    const data = fullData();
    data.netWorth = { amount: 12450, currency: "USD", change: 0 };
    b.setData(data);
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).not.toContain("▲");
    expect(text).not.toContain("▼");
  });

  test("handles missing sections gracefully", () => {
    const b = new Briefing(theme);
    b.setData({
      netWorth: { amount: 5000, currency: "USD", change: 100 },
      spendThisMonth: null,
      incomeThisMonth: null,
      recentTransactions: [],
      topCategories: [],
      error: null,
    });
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("$5,000.00");
    expect(text).not.toContain("Top Categories");
    expect(text).not.toContain("Last Transactions");
  });
});
