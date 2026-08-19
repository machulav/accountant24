// @vitest-environment jsdom

// Spec for the holdings grid (investments-table.tsx): the one-row-per-
// commodity table the Investments page renders. The page's summary cards
// and empty/loading states are covered by the Investments page tests; this
// suite covers the boundary shapes the page doesn't reach on its happy path
// — holdings the journal can't price or cost, and the optional columns on.

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { InvestmentHolding, NetWorthInvestments } from "@/rpc/types";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { InvestmentsGrid, withAllocation } from "../investments-table";

beforeAll(() => installJsdomPolyfills());
afterEach(() => cleanup());

const NOOP = () => {};

/** A holding the journal can neither price nor cost: quantity only. */
const VALUELESS: InvestmentHolding = {
  commodity: "VLT",
  quantity: { quantity: 3, commodity: "VLT", precision: 0 },
  price: null,
  marketValue: null,
  costBasis: null,
  unrealizedPnl: null,
};

const COMPLETE: InvestmentHolding = {
  commodity: "XEON",
  quantity: { quantity: 13, commodity: "XEON", precision: 0 },
  price: { quantity: 149.6366, commodity: "EUR", precision: 4 },
  marketValue: { quantity: 1945.28, commodity: "EUR", precision: 2 },
  costBasis: { quantity: 1941.53, commodity: "EUR", precision: 2 },
  unrealizedPnl: { quantity: 3.75, commodity: "EUR", precision: 2 },
};

const emptyInvestments = (rows: InvestmentHolding[], totals?: Partial<NetWorthInvestments>): NetWorthInvestments => ({
  rows,
  totalMarketValue: [],
  totalCostBasis: [],
  ...totals,
});

const renderGrid = (investments: NetWorthInvestments) =>
  render(
    <InvestmentsGrid
      rows={withAllocation(investments)}
      search=""
      config={{ visibility: { cost: true, pnl: true, allocation: true }, sizing: {} }}
      onSizingChange={NOOP}
    />,
  );

describe("InvestmentsGrid", () => {
  it("should dash every figure cell for holdings with no price or cost", () => {
    renderGrid(emptyInvestments([VALUELESS]));
    // Price, Value, Cost, P&L, and Allocation — five em dashes, never a
    // fabricated zero.
    expect(screen.getAllByText("—")).toHaveLength(5);
    // The commodity and its native quantity still read.
    expect(screen.getByText("VLT")).toBeInTheDocument();
    expect(screen.getByText("3 VLT")).toBeInTheDocument();
  });

  it("should render the optional Cost, P&L, and Allocation cells when the columns are on", () => {
    renderGrid(
      emptyInvestments([COMPLETE], {
        totalMarketValue: [{ quantity: 1945.28, commodity: "EUR", precision: 2 }],
        totalCostBasis: [{ quantity: 1941.53, commodity: "EUR", precision: 2 }],
      }),
    );
    expect(screen.getByText("1,941.53 EUR")).toBeInTheDocument();
    expect(screen.getByText("3.75 EUR")).toBeInTheDocument();
    // 1,945.28 / 1,945.28 — the single holding owns the whole table.
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("should sort through every column header, exercising each column's accessor", async () => {
    // The grid's default sort is on Value; clicking the other headers makes
    // TanStack read each column's own accessor — the sort data path every
    // holding column relies on.
    renderGrid(
      emptyInvestments([COMPLETE, VALUELESS], {
        totalMarketValue: [{ quantity: 1945.28, commodity: "EUR", precision: 2 }],
      }),
    );
    for (const name of ["Commodity", "Quantity", "Price", "Cost", "P&L", "Allocation"]) {
      await userEvent.click(screen.getByRole("button", { name }));
    }
    // The sort cycle left a column active and the rows rendered.
    expect(screen.getByText("XEON")).toBeInTheDocument();
    expect(screen.getByText("VLT")).toBeInTheDocument();
  });

  it("should keep the optional cells dashed when the holding has a value but no cost", () => {
    renderGrid(
      emptyInvestments(
        [
          {
            ...COMPLETE,
            costBasis: null,
            unrealizedPnl: null,
          },
        ],
        {
          totalMarketValue: [{ quantity: 1945.28, commodity: "EUR", precision: 2 }],
        },
      ),
    );
    // Value reads; Cost and P&L dash; the allocation still computes.
    expect(screen.getByText("1,945.28 EUR")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
