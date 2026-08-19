// Persisted table configuration for the Investments view: its storage key
// and column set over the shared load/save core (table-config.ts), plus the
// static column widths — the same model as the Transactions register: fixed
// defaults, resizing moves only the dragged column, and extra columns grow
// the table past the page floor.

import { loadStoredTableConfig, saveStoredTableConfig, type TableConfig } from "./table-config";

export const INVESTMENTS_TABLE_KEY = "accountant24.investments-table";

/** Only Cost, P&L, and Allocation toggle, hidden by default: the table
 *  leads with what you hold, its quantity, and what it is worth now.
 *  Commodity, Quantity, Price, and Value are the page's spine and never
 *  leave, so they have no entry here. */
export const DEFAULT_COLUMN_VISIBILITY: Record<string, boolean> = {
  cost: false,
  pnl: false,
  allocation: false,
};

/** The holdings columns: Commodity, Quantity, Price, and Value visible by
 *  default at the same span as the Net Worth account tables (350+140+170+170
 *  = 830); Cost, P&L, and Allocation are opt-in like the assertion pair. */
export const INVESTMENT_COLUMN_SIZES: Record<string, number> = {
  commodity: 350,
  quantity: 140,
  price: 170,
  value: 170,
  cost: 170,
  pnl: 170,
  allocation: 120,
};

export const INVESTMENT_COLUMN_MIN_SIZES: Record<string, number> = {
  commodity: 140,
  quantity: 110,
  price: 130,
  value: 140,
  cost: 130,
  pnl: 130,
  allocation: 88,
};

export type InvestmentsTableConfig = TableConfig;

export function loadInvestmentsTableConfig(): InvestmentsTableConfig {
  return loadStoredTableConfig(
    INVESTMENTS_TABLE_KEY,
    DEFAULT_COLUMN_VISIBILITY,
    Object.keys(INVESTMENT_COLUMN_SIZES),
    INVESTMENT_COLUMN_MIN_SIZES,
  );
}

export function saveInvestmentsTableConfig(config: InvestmentsTableConfig): void {
  saveStoredTableConfig(INVESTMENTS_TABLE_KEY, config);
}

/** The holdings grid's width — its default-visible span matches the Net
 *  Worth account tables' (830 ≈ 832), and toggling its optional columns
 *  grows the page past the floor the same way the assertion pair does. */
export function investmentsTableWidth(config: InvestmentsTableConfig): number {
  return Object.entries(INVESTMENT_COLUMN_SIZES).reduce(
    (total, [id, size]) =>
      config.visibility[id] === false
        ? total
        : total + Math.max(config.sizing[id] ?? size, INVESTMENT_COLUMN_MIN_SIZES[id] ?? 0),
    0,
  );
}
