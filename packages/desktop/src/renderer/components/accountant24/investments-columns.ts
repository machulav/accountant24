// Persisted table configuration for the Investments view: its storage key
// and column set over the shared load/save core (table-config.ts), reusing
// the holdings column widths from the Net Worth page (net-worth-columns.ts)
// so the two tables stay aligned on the same spans.

import { INVESTMENT_COLUMN_MIN_SIZES, INVESTMENT_COLUMN_SIZES } from "./net-worth-columns";
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
