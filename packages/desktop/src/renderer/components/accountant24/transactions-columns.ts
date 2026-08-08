// Persisted table configuration for the Transactions view — the same
// best-effort localStorage idiom as the sidebar width: load validates the
// stored value field by field and falls back to the defaults, save never
// throws. Covers everything the grid lets the user shape: column
// visibility, drag order, and resized widths.

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
 *  so has no visibility entry. Derived, so a new column is declared once.
 *  Column order itself is fixed by the column definitions; it is neither
 *  user-changeable nor persisted. */
const KNOWN_COLUMNS = ["expand", ...Object.keys(DEFAULT_COLUMN_VISIBILITY)];

export interface TransactionsTableConfig {
  visibility: Record<string, boolean>;
  sizing: Record<string, number>;
}

const defaults = (): TransactionsTableConfig => ({
  visibility: { ...DEFAULT_COLUMN_VISIBILITY },
  sizing: {},
});

/** The persisted config over the defaults; unknown columns, non-bool
 *  visibility, and non-positive widths are dropped, so a stale or garbled
 *  entry (an older build also stored a column order, now ignored) can never
 *  hide or break the table. */
export function loadTableConfig(): TransactionsTableConfig {
  let stored: unknown;
  try {
    stored = JSON.parse(window.localStorage.getItem(TRANSACTIONS_TABLE_KEY) ?? "");
  } catch {
    return defaults();
  }
  const config = defaults();
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return config;
  const s = stored as { visibility?: unknown; sizing?: unknown };
  if (typeof s.visibility === "object" && s.visibility !== null) {
    for (const [id, visible] of Object.entries(s.visibility)) {
      if (id in DEFAULT_COLUMN_VISIBILITY && typeof visible === "boolean") config.visibility[id] = visible;
    }
  }
  if (typeof s.sizing === "object" && s.sizing !== null) {
    for (const [id, width] of Object.entries(s.sizing)) {
      if (KNOWN_COLUMNS.includes(id) && typeof width === "number" && Number.isFinite(width) && width > 0) {
        config.sizing[id] = width;
      }
    }
  }
  return config;
}

export function saveTableConfig(config: TransactionsTableConfig): void {
  try {
    window.localStorage.setItem(TRANSACTIONS_TABLE_KEY, JSON.stringify(config));
  } catch {
    // Persistence is best-effort; the session keeps its in-memory state.
  }
}
