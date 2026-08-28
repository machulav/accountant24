// Parser for `hledger bs -O json` output (the Net Worth view). The
// compound report carries exact quantities and clean commodity symbols (no
// display-string ambiguity), so the renderer can format numbers for humans
// while every figure stays hledger-computed.
//
// Shape: `{ cbrSubreports: [[name, periodicReport, increasesTotal], ...],
// cbrTotals: netRow, ... }`; a periodic report has `prRows` (one per
// account: `prrName`, `prrAmounts: [columnAmounts]`) and `prTotals` (the
// section total, same row shape). Each amount has `acommodity`,
// `aquantity: { floatingPoint, decimalPlaces, ... }`, and
// `astyle: { asprecision, ... }`. Unlike hledger's text output, the JSON
// keeps cost lots separate — one commodity can appear several times per
// row — so amounts are aggregated per commodity here, exactly what
// hledger's own display does.

import type {
  AccountBalance,
  LedgerAmount,
  LedgerPosting,
  LedgerTransaction,
  LedgerTransactionStatus,
  NetWorth,
  NetWorthSection,
} from "../shared/types";

/** A parsed balance row before the market-value report is merged in. */
export type RawBalanceRow = Omit<AccountBalance, "value">;

/** Display-zero threshold: sums of cost lots can leave float dust. */
const isZero = (quantity: number): boolean => Math.abs(quantity) < 1e-9;

function parseAmount(a: unknown): LedgerAmount | null {
  const amount = a as {
    acommodity?: unknown;
    aquantity?: { floatingPoint?: unknown; decimalPlaces?: unknown };
    astyle?: { asprecision?: unknown };
  };
  const quantity = amount?.aquantity?.floatingPoint;
  const commodity = amount?.acommodity;
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || typeof commodity !== "string") return null;
  // The commodity's display precision when the journal declares one; the
  // amount's own decimal places otherwise.
  const style = amount?.astyle?.asprecision;
  const places = amount?.aquantity?.decimalPlaces;
  const precision =
    typeof style === "number" && style >= 0 ? style : typeof places === "number" && places >= 0 ? places : 2;
  return { quantity, commodity, precision };
}

/** Merge cost lots of the same commodity into one amount (hledger's text
 *  output does the same), then drop zero legs unless the whole balance is
 *  zero — a zeroed account keeps a single zero amount. */
function aggregateAmounts(amounts: LedgerAmount[]): LedgerAmount[] {
  // The overwhelmingly common case (every plain posting, most balance rows):
  // nothing to merge, so skip the map-and-rebuild and only normalize a
  // rounding-dust quantity to a clean zero.
  const single = amounts.length === 1 ? amounts[0] : undefined;
  if (amounts.length === 0) return amounts;
  if (single) return isZero(single.quantity) ? [{ ...single, quantity: 0 }] : amounts;
  const byCommodity = new Map<string, LedgerAmount>();
  for (const a of amounts) {
    const prev = byCommodity.get(a.commodity);
    if (prev) {
      prev.quantity += a.quantity;
      prev.precision = Math.max(prev.precision, a.precision);
    } else {
      byCommodity.set(a.commodity, { ...a });
    }
  }
  const all = [...byCommodity.values()].map((a) => (isZero(a.quantity) ? { ...a, quantity: 0 } : a));
  const nonZero = all.filter((a) => a.quantity !== 0);
  return nonZero.length > 0 ? nonZero : all.slice(0, 1);
}

/** A parsed `bs` report before the market-value run is merged in. */
export interface RawBalanceSheet {
  sections: { name: string; rows: RawBalanceRow[]; total: LedgerAmount[] }[];
  net: LedgerAmount[];
}

/** The amounts of a compound-report row (`prrAmounts` holds one amount list
 *  per report column; ours are single-period), aggregated per commodity. */
function parseRowAmounts(row: unknown): LedgerAmount[] {
  const columns = (row as { prrAmounts?: unknown })?.prrAmounts;
  const first = Array.isArray(columns) ? columns[0] : undefined;
  if (!Array.isArray(first)) return [];
  return aggregateAmounts(first.map(parseAmount).filter((a): a is LedgerAmount => a !== null));
}

/** Parse `hledger bs -O json` output into sections and the net row,
 *  preserving hledger's order and sign convention. Anything unparseable
 *  (including empty output) yields null — the caller's empty-state path. */
export function parseBalanceSheetJson(json: string): RawBalanceSheet | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const report = data as { cbrSubreports?: unknown; cbrTotals?: unknown };
  if (!Array.isArray(report?.cbrSubreports)) return null;
  const sections: RawBalanceSheet["sections"] = [];
  for (const entry of report.cbrSubreports) {
    if (!Array.isArray(entry)) continue;
    const [name, subreport] = entry as [unknown, { prRows?: unknown; prTotals?: unknown } | undefined];
    if (typeof name !== "string" || !name) continue;
    const rows: RawBalanceRow[] = [];
    for (const row of Array.isArray(subreport?.prRows) ? subreport.prRows : []) {
      const accountName = (row as { prrName?: unknown })?.prrName;
      if (typeof accountName !== "string" || !accountName) continue;
      rows.push({ name: accountName, amounts: parseRowAmounts(row) });
    }
    sections.push({ name, rows, total: parseRowAmounts(subreport?.prTotals) });
  }
  return { sections, net: parseRowAmounts(report.cbrTotals) };
}

/** The target commodity of the journal's latest declared market price — the
 *  last line of `hledger prices` output. This is the journal's de-facto base
 *  commodity: the agent records prices toward the user's main currency, and
 *  it is the same "latest P directive" rule hledger's own `-V` valuation applies
 *  per commodity, read once for the whole report. The amount's display style
 *  is journal-defined ("0.01 EUR", "EUR0.01", "€0.01"), so the symbol is
 *  whatever remains once the number is stripped away. Null when the journal
 *  declares no prices or the line is unparseable. */
export function parseLatestPriceTarget(text: string): string | null {
  const line = text.trim().split("\n").at(-1)?.trim();
  if (!line?.startsWith("P ")) return null;
  // P <date> <commodity> <amount> — the commodity may be double-quoted.
  const afterP = line.slice(2).trimStart();
  const afterDate = afterP.replace(/^\d{4}-\d{2}-\d{2}\s+/, "");
  if (afterDate === afterP) return null;
  const afterCommodity = afterDate.startsWith('"')
    ? afterDate.replace(/^"[^"]*"\s+/, "")
    : afterDate.replace(/^\S+\s+/, "");
  if (afterCommodity === afterDate) return null;
  const quoted = afterCommodity.match(/"([^"]+)"/);
  if (quoted?.[1]) return quoted[1];
  const symbol = afterCommodity.replace(/[\s\d.,+-]/g, "");
  return symbol.length > 0 ? symbol : null;
}

/** An account's most recent balance assertion: when, and what balance was
 *  asserted. The amount is null when the assertion's own Amount didn't parse
 *  (both fields always come from the same winning posting). */
export interface Assertion {
  date: string;
  amount: LedgerAmount | null;
}

/** Parse `hledger print -O json` output into each account's most recent
 *  balance assertion — its date (the posting's own date when it has one, the
 *  transaction's otherwise) and its asserted amount. Accounts without
 *  assertions are absent; anything unparseable yields {}. */
export function parseAssertions(json: string): Record<string, Assertion> {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return {};
  }
  if (!Array.isArray(data)) return {};
  const latest: Record<string, Assertion> = {};
  for (const txn of data) {
    const t = txn as { tdate?: unknown; tpostings?: unknown };
    if (!Array.isArray(t?.tpostings)) continue;
    for (const posting of t.tpostings) {
      const p = posting as { paccount?: unknown; pdate?: unknown; pbalanceassertion?: unknown };
      if (!p?.pbalanceassertion || typeof p.paccount !== "string" || !p.paccount) continue;
      const date = typeof p.pdate === "string" && p.pdate ? p.pdate : t.tdate;
      if (typeof date !== "string" || !date) continue;
      const prev = latest[p.paccount];
      if (!prev || date > prev.date) {
        latest[p.paccount] = {
          date,
          // The asserted amount, when the assertion's Amount parses; an
          // assertion pins one commodity, so baamount is a single Amount.
          amount: parseAmount((p.pbalanceassertion as { baamount?: unknown }).baamount),
        };
      }
    }
  }
  return latest;
}

/** The description's payee and note halves: hledger keeps "Payee | note" as
 *  one string and splits it only in dedicated subcommands, so the split on
 *  the first pipe happens here. No pipe = the whole string is the payee. */
function splitDescription(description: string): { payee: string; note: string } {
  const pipe = description.indexOf("|");
  if (pipe === -1) return { payee: description.trim(), note: "" };
  return { payee: description.slice(0, pipe).trim(), note: description.slice(pipe + 1).trim() };
}

/** Transaction-level tags (`ttags`: [name, value] pairs, journal order). */
function parseTags(tags: unknown): { name: string; value: string }[] {
  if (!Array.isArray(tags)) return [];
  const parsed: { name: string; value: string }[] = [];
  for (const tag of tags) {
    if (!Array.isArray(tag) || typeof tag[0] !== "string" || !tag[0]) continue;
    parsed.push({ name: tag[0], value: typeof tag[1] === "string" ? tag[1] : "" });
  }
  return parsed;
}

/** A transaction's postings. hledger fills in elided amounts, so every
 *  posting arrives with one; `pamount` keeps cost lots separate like the
 *  balance report, so amounts are aggregated per commodity the same way. */
function parsePostings(postings: unknown): LedgerPosting[] {
  if (!Array.isArray(postings)) return [];
  const parsed: LedgerPosting[] = [];
  for (const posting of postings) {
    const p = posting as { paccount?: unknown; pamount?: unknown };
    if (typeof p?.paccount !== "string" || !p.paccount) continue;
    const amounts = Array.isArray(p.pamount)
      ? p.pamount.map(parseAmount).filter((a): a is LedgerAmount => a !== null)
      : [];
    parsed.push({ account: p.paccount, amounts: aggregateAmounts(amounts) });
  }
  return parsed;
}

/** An assertion-only entry: every posting zero and at least one carrying a
 *  balance assertion — the agent's standalone "Balance Assertion" rows. A
 *  reconciliation mark, not money movement, so the register hides it (for
 *  now; a future toggle may resurface these). A real transaction that also
 *  asserts a balance moves money, so it stays. */
function isAssertionEntry(rawPostings: unknown, postings: LedgerPosting[]): boolean {
  if (!Array.isArray(rawPostings)) return false;
  const asserts = rawPostings.some((p) => Boolean((p as { pbalanceassertion?: unknown })?.pbalanceassertion));
  return asserts && postings.every((p) => p.amounts.every((a) => a.quantity === 0));
}

/** Parse `hledger print -O json` output into the Transactions view's rows,
 *  preserving journal order. Statuses outside hledger's three words read as
 *  Unmarked; assertion-only entries are hidden; malformed entries are
 *  skipped; anything unparseable yields [] — the caller's empty-state path.
 *  (Price declarations never appear here: `print` reports transactions only.) */
export function parseTransactionsJson(json: string): LedgerTransaction[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const transactions: LedgerTransaction[] = [];
  for (const txn of data) {
    const t = txn as {
      tindex?: unknown;
      tdate?: unknown;
      tdescription?: unknown;
      tstatus?: unknown;
      ttags?: unknown;
      tpostings?: unknown;
    };
    if (typeof t?.tindex !== "number" || typeof t.tdate !== "string" || !t.tdate) continue;
    if (typeof t.tdescription !== "string") continue;
    const postings = parsePostings(t.tpostings);
    if (isAssertionEntry(t.tpostings, postings)) continue;
    const status: LedgerTransactionStatus = t.tstatus === "Cleared" || t.tstatus === "Pending" ? t.tstatus : "Unmarked";
    transactions.push({
      index: t.tindex,
      date: t.tdate,
      ...splitDescription(t.tdescription),
      status,
      tags: parseTags(t.ttags),
      postings,
    });
  }
  return transactions;
}

/** Merge the raw and market-value (`-X`) runs of the same `bs` report. Both
 *  runs cover the identical sections and account lists, so everything pairs
 *  by position; if the valued run is missing or disagrees (partial hledger
 *  failure), the raw amounts stand in for the value. The base commodity is
 *  the caller's to add — it comes from price resolution, not the merge. */
export function mergeValuedBalanceSheet(
  raw: RawBalanceSheet,
  valued: RawBalanceSheet | null,
): Omit<NetWorth, "baseCommodity"> {
  const orRaw = (amounts: LedgerAmount[], candidate: LedgerAmount[] | undefined): LedgerAmount[] =>
    candidate ?? amounts;
  const sections: NetWorthSection[] = raw.sections.map((section, s) => {
    const valuedSection = valued?.sections[s];
    const aligned = valuedSection?.name === section.name ? valuedSection : undefined;
    return {
      name: section.name,
      rows: section.rows.map((row, r) => {
        const valuedRow = aligned?.rows[r];
        return { ...row, value: valuedRow?.name === row.name ? valuedRow.amounts : row.amounts };
      }),
      total: { amounts: section.total, value: orRaw(section.total, aligned?.total) },
    };
  });
  return { sections, net: { amounts: raw.net, value: orRaw(raw.net, valued?.net) } };
}

/** The transaction count from `hledger stats` output. The report is a short
 *  `Label : value` table; the line is `Txns                : 3 (1.0 per day)`.
 *  Anchored to the line start so `Txns span` / `Txns last 30 days` never
 *  match. 0 when the line is missing (empty or unexpected output). */
export function parseTransactionCount(text: string): number {
  const match = /^Txns\s*:\s*(\d+)/m.exec(text);
  return match ? Number(match[1]) : 0;
}
