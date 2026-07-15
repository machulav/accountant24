// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardData } from "../../../../rpc/types";

// The hook is the faked boundary; the chart children are stubbed because
// Recharts needs a real layout engine (ResizeObserver) that jsdom lacks.
const useDashboardData = vi.fn<() => { data: DashboardData | null; loading: boolean }>();

vi.mock("@/hooks/use-dashboard-data", () => ({ useDashboardData: () => useDashboardData() }));
vi.mock("../stat-row", () => ({ StatRow: () => <div data-testid="stat-row" /> }));
vi.mock("../net-worth-chart", () => ({ NetWorthChart: () => <div data-testid="net-worth-chart" /> }));
vi.mock("../income-expense-chart", () => ({ IncomeExpenseChart: () => <div data-testid="income-expense-chart" /> }));
vi.mock("../category-bars", () => ({ CategoryBars: () => <div data-testid="category-bars" /> }));

import { FinanceOverview } from "../finance-overview";

function makeData(overrides?: Partial<DashboardData>): DashboardData {
  return {
    netWorth: [{ amount: 5000, currency: "EUR", change: 100 }],
    incomeThisMonth: [{ amount: 3000, currency: "EUR" }],
    spendThisMonth: [{ amount: 1200, currency: "EUR" }],
    topCategories: [{ name: "food", amount: 500, currency: "EUR" }],
    netWorthSeries: [],
    incomeExpenseSeries: [],
    dominantCurrency: "EUR",
    otherCurrencies: [],
    hasTransactions: true,
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  useDashboardData.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("FinanceOverview", () => {
  it("should render nothing while loading", () => {
    useDashboardData.mockReturnValue({ data: null, loading: true });
    const { container } = render(<FinanceOverview />);
    expect(container.firstChild).toBeNull();
  });

  it("should render nothing when the fetch failed", () => {
    useDashboardData.mockReturnValue({ data: null, loading: false });
    const { container } = render(<FinanceOverview />);
    expect(container.firstChild).toBeNull();
  });

  it("should render nothing when the data carries an error", () => {
    useDashboardData.mockReturnValue({ data: makeData({ error: "hledger is not installed" }), loading: false });
    const { container } = render(<FinanceOverview />);
    expect(container.firstChild).toBeNull();
  });

  it("should render nothing when the ledger has no transactions", () => {
    useDashboardData.mockReturnValue({ data: makeData({ hasTransactions: false }), loading: false });
    const { container } = render(<FinanceOverview />);
    expect(container.firstChild).toBeNull();
  });

  it("should render the stat row and all three charts when data is present", () => {
    useDashboardData.mockReturnValue({ data: makeData(), loading: false });
    render(<FinanceOverview />);
    expect(screen.getByTestId("stat-row")).toBeTruthy();
    expect(screen.getByTestId("net-worth-chart")).toBeTruthy();
    expect(screen.getByTestId("income-expense-chart")).toBeTruthy();
    expect(screen.getByTestId("category-bars")).toBeTruthy();
  });
});
