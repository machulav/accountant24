// Persisted table configuration for the Transactions view: its storage key
// and column set over the shared load/save core (table-config.ts).

import { loadStoredTableConfig, saveStoredTableConfig, type TableConfig } from "./table-config";

export const TRANSACTIONS_TABLE_KEY = "accountant24.transactions-table";

/** The data columns with the default visibility: date, payee, and the
 *  account/amount pair on; comment, tags, and status opt-in. The expander
 *  column is chrome (never hidden), so it has no entry here. */
export const DEFAULT_COLUMN_VISIBILITY: Record<string, boolean> = {
  date: true,
  payee: true,
  note: false,
  account: true,
  amount: true,
  tags: false,
  status: false,
};

/** Every leaf column id the sizing validation accepts: the hideable ones
 *  plus the expander gutter, which is chrome (resizable, never hidden) and
 *  so has no visibility entry. Derived, so a new column is declared once. */
const KNOWN_COLUMNS = ["expand", ...Object.keys(DEFAULT_COLUMN_VISIBILITY)];

/** Every column's minimum (the register's column defs read these): header
 *  fit for the text columns, content fit where the data is the wider
 *  constraint (a typical formatted amount for Amount, a readable account
 *  pill for Account, the full ISO date for Date). */
export const COLUMN_MIN_SIZES: Record<string, number> = {
  date: 104,
  payee: 90,
  account: 220,
  amount: 140,
  status: 94,
  note: 108,
  tags: 80,
};

export type TransactionsTableConfig = TableConfig;

export function loadTableConfig(): TransactionsTableConfig {
  return loadStoredTableConfig(TRANSACTIONS_TABLE_KEY, DEFAULT_COLUMN_VISIBILITY, KNOWN_COLUMNS, COLUMN_MIN_SIZES);
}

export function saveTableConfig(config: TransactionsTableConfig): void {
  saveStoredTableConfig(TRANSACTIONS_TABLE_KEY, config);
}
