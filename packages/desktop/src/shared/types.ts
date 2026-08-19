// IPC payload types shared by the main and renderer processes — the single
// definition of shapes that cross the window.api bridge.
//
// Types only: no runtime code, no DOM or Node types. This file is checked by
// BOTH tsconfig projects (browser and node), and both sides use `import type`,
// so nothing from here exists at runtime and nothing crosses the build boundary.

// ---- Ledger mentions (@-mention picker data) ------------------------------

/** Entity names available to the chat composer's @-mention popover, sourced
 *  from `hledger` against the workspace journal. */
export interface LedgerMentions {
  accounts: string[];
  payees: string[];
  tags: string[];
}

// ---- Ledger balances (Accounts view) --------------------------------------

/** One commodity of a balance, as hledger computed it (exact numbers from the
 *  JSON report; the renderer decides presentation). */
export interface LedgerAmount {
  quantity: number;
  /** Commodity symbol ("EUR", "BTC", "SXR8"), unquoted. */
  commodity: string;
  /** Decimal places hledger carries for this amount (display precision). */
  precision: number;
}

/** One account row of a balance report, in hledger's own order. */
export interface AccountBalance {
  /** Full account path ("assets:bank:checking"), verbatim. */
  name: string;
  /** The balance in its original commodities, one entry per commodity. */
  amounts: LedgerAmount[];
  /** The same balance at market value (`-X` valuation) — a single
   *  base-commodity figure when hledger finds a price path, otherwise equal
   *  to `amounts`. This is the primary number the report views show. */
  value: LedgerAmount[];
  /** ISO date of the account's most recent balance assertion in the journal
   *  (the posting's own date when it has one) — when the balance was last
   *  reconciled. Absent when the account has no assertions. */
  assertedOn?: string;
  /** The amount of that most recent balance assertion, verbatim from the
   *  journal. An assertion pins a single commodity's balance, so this is one
   *  amount, not a list. Absent when the account has no assertions or the
   *  assertion's amount did not parse; present only alongside `assertedOn`. */
  assertedAmount?: LedgerAmount;
}

/** A figure of the report that isn't an account row: a section total or the
 *  net line — native amounts paired with their market value like a row. */
export interface NetWorthTotal {
  amounts: LedgerAmount[];
  value: LedgerAmount[];
}

/** One `hledger bs` subreport: Assets or Liabilities, rows in hledger's
 *  order with hledger's own sign convention (liabilities positive) and the
 *  section's hledger-computed total. */
export interface NetWorthSection {
  /** hledger's section name ("Assets", "Liabilities"), verbatim. */
  name: string;
  rows: AccountBalance[];
  total: NetWorthTotal;
}

/** The Net Worth view payload: `hledger bs` as data — sections plus the
 *  hledger-computed net (assets minus liabilities). */
export interface NetWorth {
  sections: NetWorthSection[];
  net: NetWorthTotal;
  /** The valuation's base commodity: the `-X` target resolved from the
   *  journal's declared or cost-inferred prices. Null when valuation fell
   *  back to `-V`. Lets the renderer lead a multi-commodity figure with the
   *  base-commodity leg. */
  baseCommodity: string | null;
}

// ---- Ledger transactions (Transactions view) -------------------------------

/** A transaction's status mark, hledger's wording verbatim
 *  (`*` = Cleared, `!` = Pending, no mark = Unmarked). */
export type LedgerTransactionStatus = "Cleared" | "Pending" | "Unmarked";

/** One leg of a transaction: the account touched and what was posted to it
 *  (elided amounts filled in by hledger, cost lots merged per commodity). */
export interface LedgerPosting {
  /** Full account path ("expenses:food"), verbatim. */
  account: string;
  amounts: LedgerAmount[];
}

/** One journal transaction, as `hledger print` reports it. */
export interface LedgerTransaction {
  /** hledger's 1-based journal sequence — a stable row key within one
   *  report, never persisted across fetches. */
  index: number;
  /** ISO transaction date, verbatim. */
  date: string;
  /** The description's payee part (before the first "|"); the whole
   *  description when it has no pipe. */
  payee: string;
  /** The description's note part (after the first "|"); "" when none. */
  note: string;
  status: LedgerTransactionStatus;
  /** Transaction-level tags in journal order; value "" for a bare tag. */
  tags: { name: string; value: string }[];
  postings: LedgerPosting[];
}

// ---- App settings (app-owned config in <workspace>/app-settings.json) -----

/** The app's own settings schema (app-owned keys, distinct from pi's config,
 *  which we don't write). */
export interface AppSettings {
  /** Model new chats start with, as a `provider/modelId` id. Applied via the set_model RPC. */
  defaultModel?: string;
  /** `provider/modelId` ids the user can pick from in chat. Empty/absent = all enabled. */
  enabledModels?: string[];
  /** Anonymous usage analytics opt-out. Absent = on (the default). */
  analyticsEnabled?: boolean;
  /** One-time analytics milestones already consumed (e.g. "app_installed",
   *  "user_first_message_sent"), so each is emitted at most once per install.
   *  Written and read by the main process only; the renderer never touches it. */
  onceEvents?: string[];
}

// ---- Skills (Settings → Skills) --------------------------------------------

/** A skill the agent can use: native (embedded in the app bundle) or
 *  third-party (a folder in <workspace>/skills). */
export interface SkillInfo {
  /** Skill identity: the store folder name for third-party skills, the
   *  frontmatter name for native ones. */
  name: string;
  description: string;
  enabled: boolean;
  /** Built into the app bundle: always enabled, cannot be removed/disabled. */
  native?: boolean;
  /** GitHub `owner/repo` it was added from; absent = dropped in manually. */
  source?: string;
  /** Present when the folder's SKILL.md fails validation. */
  error?: string;
}

export interface SkillAddRequest {
  /** `owner/repo` or a github.com URL (optionally /tree/<ref>/<subpath>). */
  source: string;
  ref?: string;
  subpath?: string;
  /** Frontmatter names to add; absent = every skill found. */
  skills?: string[];
}
