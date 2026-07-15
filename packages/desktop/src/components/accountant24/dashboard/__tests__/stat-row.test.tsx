// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DashboardData } from "../../../../rpc/types";
import { StatRow } from "../stat-row";

afterEach(() => {
  cleanup();
});

function makeData(overrides?: Partial<DashboardData>): DashboardData {
  return {
    netWorth: [{ amount: 5000, currency: "EUR", change: 800 }],
    incomeThisMonth: [{ amount: 3000, currency: "EUR" }],
    spendThisMonth: [{ amount: 1200, currency: "EUR" }],
    topCategories: [],
    netWorthSeries: [],
    incomeExpenseSeries: [],
    dominantCurrency: "EUR",
    otherCurrencies: [],
    hasTransactions: true,
    error: null,
    ...overrides,
  };
}

describe("StatRow", () => {
  it("should show net worth, income and spend in the dominant currency", () => {
    render(<StatRow data={makeData()} />);
    expect(screen.getByText("5,000.00 EUR")).toBeTruthy();
    expect(screen.getByText("3,000.00 EUR")).toBeTruthy();
    expect(screen.getByText("1,200.00 EUR")).toBeTruthy();
  });

  it("should not show a month-over-month change line", () => {
    render(<StatRow data={makeData()} />);
    expect(screen.queryByText(/this month,|\+800/)).toBeNull();
  });

  it("should not show an other-currencies hint", () => {
    render(
      <StatRow
        data={makeData({
          netWorth: [
            { amount: 5000, currency: "EUR", change: 800 },
            { amount: 20000, currency: "UAH", change: 0 },
          ],
          otherCurrencies: ["UAH"],
        })}
      />,
    );
    expect(screen.queryByText(/more currenc/)).toBeNull();
  });

  it("should ignore other-currency net worth entries", () => {
    render(
      <StatRow
        data={makeData({
          netWorth: [
            { amount: 20000, currency: "UAH", change: 0 },
            { amount: 5000, currency: "EUR", change: 800 },
          ],
        })}
      />,
    );
    expect(screen.getByText("5,000.00 EUR")).toBeTruthy();
    expect(screen.queryByText(/UAH/)).toBeNull();
  });

  it("should show zero income and spend when the month has no activity", () => {
    render(<StatRow data={makeData({ incomeThisMonth: [], spendThisMonth: [] })} />);
    expect(screen.getAllByText("0.00 EUR")).toHaveLength(2);
  });
});
