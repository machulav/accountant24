// Persisted table configuration for the Net Worth view: its storage key
// and column set over the shared load/save core (table-config.ts).

import { loadStoredTableConfig, saveStoredTableConfig, type TableConfig } from "./table-config";

export const NET_WORTH_TABLE_KEY = "accountant24.net-worth-table";

/** Only the assertion pair toggles, hidden by default: the tables stay
 *  narrow and lead with what you have now; the reconciliation trail is
 *  opt-in via the Columns menu. Account, Holding, and Value are the page's
 *  spine and never leave, so they have no entry here. */
export const DEFAULT_COLUMN_VISIBILITY: Record<string, boolean> = {
  asserted: false,
  assertedAmount: false,
};

/** Every column's default width, in display order — also the ids the
 *  sizing validation accepts and what the page-width math sums. */
export const COLUMN_SIZES: Record<string, number> = {
  account: 400,
  asserted: 130,
  assertedAmount: 170,
  holding: 180,
  value: 160,
};

export type NetWorthTableConfig = TableConfig;

export function loadTableConfig(): NetWorthTableConfig {
  return loadStoredTableConfig(NET_WORTH_TABLE_KEY, DEFAULT_COLUMN_VISIBILITY, Object.keys(COLUMN_SIZES));
}

export function saveTableConfig(config: NetWorthTableConfig): void {
  saveStoredTableConfig(NET_WORTH_TABLE_KEY, config);
}

/** The width the section tables render at: the visible columns' widths
 *  (resized or default) summed — computed from the config alone, so the
 *  page can size the shared width wrapper (section bands, the Net band)
 *  without reaching into a table instance. Mirrors TanStack's
 *  getTotalSize() for the same columns. */
export function tableWidth(config: NetWorthTableConfig): number {
  return Object.entries(COLUMN_SIZES).reduce(
    (total, [id, size]) => (config.visibility[id] === false ? total : total + (config.sizing[id] ?? size)),
    0,
  );
}
