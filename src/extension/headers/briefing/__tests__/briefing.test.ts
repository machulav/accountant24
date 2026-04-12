import { afterEach, describe, expect, mock, test } from "bun:test";
import type { BriefingData } from "../../../data";
import { Briefing, createBriefingFactory } from "../briefing";

// For createBriefingFactory tests: mock Bun.spawn so fetchBriefingData resolves fast
const origSpawn = Bun.spawn;
afterEach(() => {
  Bun.spawn = origSpawn;
});

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
    spendThisMonth: { amount: 2340, currency: "USD" },
    incomeThisMonth: { amount: 5200, currency: "USD" },
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

  test("renders empty state when no transactions", () => {
    const b = new Briefing();
    b.setData({
      netWorth: [],
      spendThisMonth: null,
      incomeThisMonth: null,
      topCategories: [],
      error: null,
    });
    const lines = stripLines(b.render(80));
    expect(lines.some((l) => l.includes("Accountant24"))).toBe(true);
    expect(lines.some((l) => l.includes("No transactions yet"))).toBe(true);
  });

  test("renders error state", () => {
    const b = new Briefing();
    b.setData({
      netWorth: [],
      spendThisMonth: null,
      incomeThisMonth: null,
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
    expect(text).toContain("$2,340.00");
    expect(text).toContain("$5,200.00");
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
      spendThisMonth: null,
      incomeThisMonth: null,
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
    data.spendThisMonth = { amount: 100, currency: "BRL" };
    data.incomeThisMonth = null;
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
      spendThisMonth: null,
      incomeThisMonth: null,
      topCategories: [],
      error: null,
    });
    const lines = stripLines(b.render(80));
    const text = lines.join("\n");
    expect(text).toContain("5,000.00");
    expect(text).toContain("USD");
    expect(text).not.toContain("Top Categories");
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

describe("createBriefingFactory()", () => {
  test("should return a factory function", () => {
    const factory = createBriefingFactory();
    expect(typeof factory).toBe("function");
  });

  test("should return a Briefing when called", () => {
    // Mock Bun.spawn so fetchBriefingData resolves quickly
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => ({
      stdout: new Blob([""]).stream(),
      stderr: new Blob([""]).stream(),
      exited: Promise.resolve(1),
      kill: () => {},
    }));
    const factory = createBriefingFactory();
    const tui = { requestRender: mock(() => {}) };
    const briefing = factory(tui, {});
    expect(typeof briefing.render).toBe("function");
    expect(typeof briefing.setData).toBe("function");
  });

  test("should call requestRender after data loads", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => ({
      stdout: new Blob([""]).stream(),
      stderr: new Blob([""]).stream(),
      exited: Promise.resolve(0),
      kill: () => {},
    }));
    const factory = createBriefingFactory();
    const tui = { requestRender: mock(() => {}) };
    factory(tui, {});
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(tui.requestRender).toHaveBeenCalledWith(true);
  });
});
