// Spec for the Investments view's portfolio P&L summary: the summed
// unrealized P&L of the rows that have both a market value and a cost
// basis, with the return relative to the cost of exactly those rows.

import { describe, expect, it } from "vitest";
import type { InvestmentHolding } from "@/rpc/types";
import { summarizePnl } from "../investments-summary";

const holding = (pnl: number | null, cost: number | null): InvestmentHolding => ({
  commodity: "XEON",
  quantity: { quantity: 10, commodity: "XEON", precision: 0 },
  price: { quantity: 150, commodity: "EUR", precision: 2 },
  marketValue: cost !== null && pnl !== null ? { quantity: cost + pnl, commodity: "EUR", precision: 2 } : null,
  costBasis: cost === null ? null : { quantity: cost, commodity: "EUR", precision: 2 },
  unrealizedPnl: pnl === null ? null : { quantity: pnl, commodity: "EUR", precision: 2 },
});

describe("summarizePnl()", () => {
  it("should return null when no row has both a value and a cost basis", () => {
    expect(summarizePnl([holding(null, 100)], "EUR")).toBeNull();
    expect(summarizePnl([holding(50, null)], "EUR")).toBeNull();
    expect(summarizePnl([], "EUR")).toBeNull();
  });

  it("should return null when no base commodity resolves, even with priced rows", () => {
    expect(summarizePnl([holding(50, 100)], null)).toBeNull();
  });

  it("should sum the rows' P&L over the cost of the same rows and return the return", () => {
    // Two positions: +2 on 100 and +3 on 100 — 5 on 200 = 2.5%.
    const summary = summarizePnl([holding(2, 100), holding(3, 100)], "EUR");
    expect(summary).toEqual({
      amount: { quantity: 5, commodity: "EUR", precision: 2 },
      percent: 0.025,
    });
  });

  it("should net losses against gains across rows", () => {
    // -4 on 50 and +3 on 150 — net -1 on 200 = -0.5%.
    const summary = summarizePnl([holding(-4, 50), holding(3, 150)], "EUR");
    expect(summary).toEqual({
      amount: { quantity: -1, commodity: "EUR", precision: 2 },
      percent: -0.005,
    });
  });

  it("should carry the highest precision of the summed rows", () => {
    const a = { ...holding(2, 100), unrealizedPnl: { quantity: 2, commodity: "EUR", precision: 4 } };
    expect(summarizePnl([a, holding(3, 100)], "EUR")?.amount).toEqual({ quantity: 5, commodity: "EUR", precision: 4 });
  });

  it("should return a null percent when the cost sums to zero", () => {
    // A closed position: value equals cost (zero P&L) — nothing to divide by.
    const summary = summarizePnl([holding(0, 0)], "EUR");
    expect(summary?.amount).toEqual({ quantity: 0, commodity: "EUR", precision: 2 });
    expect(summary?.percent).toBeNull();
  });

  it("should skip rows whose cost cannot be stated in the base commodity", () => {
    // The second row has P&L but no cost basis (e.g. bought in USD) — only
    // the first row's numbers may enter the sum, so the total stays honest.
    const summary = summarizePnl([holding(2, 100), holding(3, null)], "EUR");
    expect(summary).toEqual({
      amount: { quantity: 2, commodity: "EUR", precision: 2 },
      percent: 0.02,
    });
  });
});
