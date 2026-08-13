// The Investments view's portfolio summary, derived in the view model:
// the unrealized P&L is the sum of the rows' own P&L over the cost of
// exactly those rows — never `totalMarketValue − totalCostBasis`, which
// would credit holdings without a cost with their whole market value.

import type { InvestmentHolding, LedgerAmount } from "@/rpc/types";

/** The portfolio's unrealized P&L: the summed amount in the base commodity
 *  plus the return relative to the cost of the same rows. Null when no row
 *  has both a market value and a cost basis (nothing honest to sum). */
export interface PnlSummary {
  amount: LedgerAmount;
  /** pnl ÷ cost; null when the cost sums to zero (a closed position). */
  percent: number | null;
}

export function summarizePnl(rows: InvestmentHolding[], base: string | null): PnlSummary | null {
  let pnl = 0;
  let cost = 0;
  let precision = 2;
  let count = 0;
  for (const row of rows) {
    // P&L exists only alongside a cost basis (see ledger-json's
    // parseInvestments), so the cost side never needs its own guard.
    if (row.unrealizedPnl === null || row.costBasis === null) continue;
    pnl += row.unrealizedPnl.quantity;
    cost += row.costBasis.quantity;
    precision = Math.max(precision, row.unrealizedPnl.precision);
    count++;
  }
  if (count === 0 || base === null) return null;
  return { amount: { quantity: pnl, commodity: base, precision }, percent: cost > 0 ? pnl / cost : null };
}
