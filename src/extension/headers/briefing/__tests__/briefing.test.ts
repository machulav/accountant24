import { describe, expect, test } from "bun:test";
import type { BriefingData } from "../../../data";
import { Briefing } from "../briefing";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes are control chars by definition
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function strip(str: string): string {
  return str.replace(ANSI_RE, "");
}

function stripLines(lines: string[]): string[] {
  return lines.map(strip);
}

function fullData(): BriefingData {
  return {
    netWorth: [{ amount: 12450, currency: "USD", change: 860 }],
    spendThisMonth: [{ amount: 2340, currency: "USD" }],
    incomeThisMonth: [{ amount: 5200, currency: "USD" }],
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
    const b = new Briefing();
    expect(b.render(80)).toEqual([]);
  });

  test("renders error state", () => {
    const b = new Briefing();
    b.setData({
      netWorth: [],
      spendThisMonth: [],
      incomeThisMonth: [],
      topCategories: [],
      error: "hledger is not installed",
    });
    const lines = stripLines(b.render(80));
    expect(lines.some((l) => l.includes("hledger is not installed"))).toBe(true);
  });

  test("renders header with Accountant24 and date", () => {
    const b = new Briefing();
    b.setData(fullData());
    const lines = stripLines(b.render(80));
    expect(lines[1]).toContain("Accountant24");
    expect(lines[1]).toContain("──");
  });

  test("renders KPI amounts at wide width", () => {
    const b = new Briefing();
    b.setData(fullData());
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("12,450.00");
    expect(text).toContain("USD");
    expect(text).toContain("2,340.00");
    expect(text).toContain("5,200.00");
  });

  test("renders KPI labels", () => {
    const b = new Briefing();
    b.setData(fullData());
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("Net Worth");
    expect(text).toContain("Spent");
    expect(text).toContain("Income");
  });

  test("renders positive change indicator", () => {
    const b = new Briefing();
    b.setData(fullData());
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("▲");
    expect(text).toContain("860.00 this month");
  });

  test("renders negative change indicator", () => {
    const b = new Briefing();
    const data = fullData();
    data.netWorth = [{ amount: 12450, currency: "USD", change: -500 }];
    b.setData(data);
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("▼");
    expect(text).toContain("500.00 this month");
  });

  test("omits change indicator when change is zero", () => {
    const b = new Briefing();
    const data = fullData();
    data.netWorth = [{ amount: 12450, currency: "USD", change: 0 }];
    b.setData(data);
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).not.toContain("▲");
    expect(text).not.toContain("▼");
  });

  test("renders category section with amounts and percentages", () => {
    const b = new Briefing();
    b.setData(fullData());
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("Top Categories");
    expect(text).toContain("Food");
    expect(text).toContain("$890.00");
    expect(text).toContain("%");
  });

  test("renders only categories without spend/income", () => {
    const b = new Briefing();
    b.setData({
      netWorth: [],
      spendThisMonth: [],
      incomeThisMonth: [],
      topCategories: [{ name: "Food", amount: 100, currency: "USD" }],
      error: null,
    });
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("Top Categories");
    expect(text).not.toContain("This Month");
  });

  test("formats amount with no currency", () => {
    const b = new Briefing();
    const data = fullData();
    data.netWorth = [{ amount: 5000, currency: "", change: 0 }];
    b.setData(data);
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("5,000.00");
  });

  test("formats currency as code after amount in net worth", () => {
    const b = new Briefing();
    const data = fullData();
    data.netWorth = [{ amount: 5000, currency: "BRL", change: 0 }];
    data.spendThisMonth = [{ amount: 100, currency: "BRL" }];
    data.incomeThisMonth = [];
    data.topCategories = [{ name: "Food", amount: 100, currency: "BRL" }];
    b.setData(data);
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("5,000.00  BRL");
  });

  test("renders at narrow width with stacked KPIs", () => {
    const b = new Briefing();
    b.setData(fullData());
    const lines = stripLines(b.render(50));
    const text = lines.join("\n");
    expect(text).toContain("Net Worth");
    expect(text).toContain("12,450.00");
    expect(text).toContain("Food");
    expect(text).toContain("$890.00");
  });

  test("handles missing sections gracefully", () => {
    const b = new Briefing();
    b.setData({
      netWorth: [{ amount: 5000, currency: "USD", change: 100 }],
      spendThisMonth: [],
      incomeThisMonth: [],
      topCategories: [],
      error: null,
    });
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("5,000.00");
    expect(text).toContain("USD");
    expect(text).not.toContain("Top Categories");
  });

  test("renders multi-currency spent stacked with label on first line", () => {
    const b = new Briefing();
    const data = fullData();
    data.spendThisMonth = [
      { amount: 1917.61, currency: "EUR" },
      { amount: 5, currency: "USD" },
    ];
    b.setData(data);
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("Spent");
    expect(text).toContain("1,917.61");
    expect(text).toContain("EUR");
    expect(text).toContain("5.00");
    // "Spent" label appears only once
    const spentCount = lines.filter((l) => l.includes("Spent")).length;
    expect(spentCount).toBe(1);
  });

  test("renders multi-currency income stacked with label on first line", () => {
    const b = new Briefing();
    const data = fullData();
    data.incomeThisMonth = [
      { amount: 3000, currency: "EUR" },
      { amount: 500, currency: "USD" },
    ];
    b.setData(data);
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("Income");
    expect(text).toContain("3,000.00");
    expect(text).toContain("500.00");
    const incomeCount = lines.filter((l) => l.includes("Income")).length;
    expect(incomeCount).toBe(1);
  });

  test("renders zero spent and income with currency code", () => {
    const b = new Briefing();
    b.setData({
      netWorth: [{ amount: 5000, currency: "EUR", change: 0 }],
      spendThisMonth: [{ amount: 0, currency: "EUR" }],
      incomeThisMonth: [{ amount: 0, currency: "EUR" }],
      topCategories: [],
      error: null,
    });
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("Spent");
    expect(text).toContain("Income");
    expect(text).toContain("0.00");
    expect(text).toContain("EUR");
  });

  test("renders gap between spent and income", () => {
    const b = new Briefing();
    const data = fullData();
    data.topCategories = [];
    b.setData(data);
    const lines = stripLines(b.render(80));
    const spentIdx = lines.findIndex((l) => l.includes("Spent"));
    const incomeIdx = lines.findIndex((l) => l.includes("Income"));
    expect(spentIdx).toBeGreaterThan(-1);
    expect(incomeIdx).toBeGreaterThan(-1);
    // There should be a gap line between Spent and Income
    expect(incomeIdx - spentIdx).toBe(2);
    expect(lines[spentIdx + 1].trim()).toBe("");
  });

  test("no empty line between spent and income when only income present", () => {
    const b = new Briefing();
    const data = fullData();
    data.spendThisMonth = [];
    b.setData(data);
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("Income");
    expect(text).not.toContain("Spent");
  });

  test("renders spent currency code instead of symbol", () => {
    const b = new Briefing();
    const data = fullData();
    data.spendThisMonth = [{ amount: 100, currency: "EUR" }];
    data.incomeThisMonth = [{ amount: 50, currency: "EUR" }];
    b.setData(data);
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    // Should show "100.00  EUR" not "€100.00"
    expect(text).toContain("100.00");
    expect(text).toContain("EUR");
    expect(text).not.toMatch(/€\s*100/);
  });

  test("renders multiple currencies stacked", () => {
    const b = new Briefing();
    const data = fullData();
    data.netWorth = [
      { amount: 12450, currency: "USD", change: 500 },
      { amount: 906.5, currency: "EUR", change: 0 },
      { amount: 2, currency: "BTC", change: 1 },
    ];
    b.setData(data);
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    // First line has label
    expect(text).toContain("Net Worth");
    // All currencies present
    expect(text).toContain("USD");
    expect(text).toContain("EUR");
    expect(text).toContain("BTC");
    // Amounts present
    expect(text).toContain("12,450.00");
    expect(text).toContain("906.50");
    expect(text).toContain("2.00");
    // "Net Worth" label appears only once
    const nwCount = lines.filter((l) => l.includes("Net Worth")).length;
    expect(nwCount).toBe(1);
  });
});
