// Parser for `hledger bs -O json` output (the Balance Sheet view). The
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

import type { AccountBalance, BalanceSheet, BalanceSheetSection, LedgerAmount } from "../shared/types";

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

/** Parse `hledger print -O json` output into each account's most recent
 *  balance-assertion date — the posting's own date when it has one, the
 *  transaction's otherwise. Accounts without assertions are absent; anything
 *  unparseable yields {}. */
export function parseAssertionDates(json: string): Record<string, string> {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return {};
  }
  if (!Array.isArray(data)) return {};
  const latest: Record<string, string> = {};
  for (const txn of data) {
    const t = txn as { tdate?: unknown; tpostings?: unknown };
    if (!Array.isArray(t?.tpostings)) continue;
    for (const posting of t.tpostings) {
      const p = posting as { paccount?: unknown; pdate?: unknown; pbalanceassertion?: unknown };
      if (!p?.pbalanceassertion || typeof p.paccount !== "string" || !p.paccount) continue;
      const date = typeof p.pdate === "string" && p.pdate ? p.pdate : t.tdate;
      if (typeof date !== "string" || !date) continue;
      const prev = latest[p.paccount];
      if (!prev || date > prev) latest[p.paccount] = date;
    }
  }
  return latest;
}

/** Merge the raw and market-value (`-X`) runs of the same `bs` report. Both
 *  runs cover the identical sections and account lists, so everything pairs
 *  by position; if the valued run is missing or disagrees (partial hledger
 *  failure), the raw amounts stand in for the value. */
export function mergeValuedBalanceSheet(raw: RawBalanceSheet, valued: RawBalanceSheet | null): BalanceSheet {
  const orRaw = (amounts: LedgerAmount[], candidate: LedgerAmount[] | undefined): LedgerAmount[] =>
    candidate ?? amounts;
  const sections: BalanceSheetSection[] = raw.sections.map((section, s) => {
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
