// Persisted table configuration for the Net Worth view: its storage key
// and column set over the shared load/save core (table-config.ts), plus
// the static column widths — the same model as the Transactions register:
// fixed defaults, resizing moves only the dragged column, and extra
// columns grow the table past the page floor.

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

/** Every column's default width, in display order. The default-visible set
 *  fills the 52rem page floor exactly (492 + 170 + 170 — the toolbar's
 *  content span, title edge to Columns edge); toggling the assertion pair
 *  grows the table past the floor and the page scrolls, the same way the
 *  Transactions register grows when its optional columns come on. */
export const COLUMN_SIZES: Record<string, number> = {
  account: 492,
  asserted: 170,
  assertedAmount: 200,
  holding: 170,
  value: 170,
};

/** Every column's minimum: whichever is larger of
 *  - its header pill (measured rendered widths: Account 93, Asserted On
 *    146, Asserted Amount 178, Holding 115, Value 100) plus the cell's 8px
 *    padding per side, so at the minimum the pill sits with the same
 *    breathing room to both column separators, and
 *  - its content: a typical formatted amount ("~1,187.50 EUR") for the
 *    money columns, a readable account pill for Account — cranking a
 *    column to the stop must never make its data unreadable. */
export const COLUMN_MIN_SIZES: Record<string, number> = {
  account: 220,
  asserted: 162,
  assertedAmount: 194,
  holding: 140,
  value: 140,
};

export type NetWorthTableConfig = TableConfig;

export function loadTableConfig(): NetWorthTableConfig {
  return loadStoredTableConfig(
    NET_WORTH_TABLE_KEY,
    DEFAULT_COLUMN_VISIBILITY,
    Object.keys(COLUMN_SIZES),
    COLUMN_MIN_SIZES,
  );
}

export function saveTableConfig(config: NetWorthTableConfig): void {
  saveStoredTableConfig(NET_WORTH_TABLE_KEY, config);
}

/** The width the section tables render at (the visible columns, resized or
 *  default) — what the page sizes the shared width wrapper (section bands,
 *  the Net band) with. Mirrors TanStack's getTotalSize() INCLUDING its
 *  minimum clamp: a live drag past a column's minimum stores the raw
 *  sub-minimum value while the grid renders the clamp, and summing the raw
 *  values would make the wrapper narrower than the table — whose container
 *  then clips the last column. */
export function tableWidth(config: NetWorthTableConfig): number {
  return Object.entries(COLUMN_SIZES).reduce(
    (total, [id, size]) =>
      config.visibility[id] === false ? total : total + Math.max(config.sizing[id] ?? size, COLUMN_MIN_SIZES[id] ?? 0),
    0,
  );
}
