// Ledger data served straight from the main process: the @-mention picker's
// entity lists, the Net Worth view's balance report, and the Transactions
// view's journal register.
//
// Runs the same `hledger` queries the pi-extension uses, but directly so the
// renderer gets its data without round-tripping through the agent's RPC stream.
// Reads the same workspace journal the agent does and resolves the vendored
// hledger binary explicitly — `execFile` looks the command up on the parent's
// PATH, which (unlike the spawned agent's env) does not include the bundled
// bin dir.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { ipcMain } from "electron";
import type { LedgerMentions, LedgerTransaction, NetWorth } from "../shared/types";
import { agentEnv, binDir, mainJournalPath, workspaceDir } from "./env";
import {
  mergeValuedBalanceSheet,
  parseAssertions,
  parseBalanceSheetJson,
  parseLatestPriceTarget,
  parseTransactionsJson,
} from "./ledger-json";

function hledgerBin(): string {
  const exe = path.join(binDir(), process.platform === "win32" ? "hledger.exe" : "hledger");
  return existsSync(exe) ? exe : "hledger";
}

/** Run one `hledger` subcommand and return its raw stdout, or null on any
 *  failure (missing binary, no journal yet, parse error). */
function hledgerResult(args: string[], maxBuffer = 16 * 1024 * 1024): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(hledgerBin(), args, { cwd: workspaceDir(), env: agentEnv(), maxBuffer }, (err, stdout) =>
      resolve(err ? null : stdout),
    );
  });
}

/** Run one `hledger` subcommand and return its raw stdout, untouched (the
 *  balance report's JSON must not be line-shaped). Any failure yields "". */
async function hledgerRaw(args: string[]): Promise<string> {
  return (await hledgerResult(args)) ?? "";
}

/** Run one `hledger` subcommand and return its sorted, non-empty output lines. */
async function hledger(args: string[]): Promise<string[]> {
  const stdout = await hledgerRaw(args);
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

async function ledgerMentions(): Promise<LedgerMentions> {
  const journal = mainJournalPath();
  const [accounts, payees, tags] = await Promise.all([
    hledger(["accounts", "-f", journal]),
    hledger(["payees", "-f", journal]),
    hledger(["tags", "-f", journal]),
  ]);
  return { accounts, payees, tags };
}

/** The report's base commodity — the target of the journal's latest
 *  declared market price. The agent records prices toward the user's main
 *  currency, so the journal itself answers which commodity is the base and
 *  nothing is hardcoded. When the journal declares no prices, the latest
 *  cost-inferred price (`--infer-market-prices`, e.g. `2 WRLD @ 210.00 EUR`)
 *  answers instead. The probes stay sequential so a later-dated cost can
 *  never out-rank a declared price. Seam for the future default-currency
 *  setting: once it exists, resolve it here first and fall back to the
 *  derivation. Null when the journal yields no prices at all. */
async function resolveBaseCommodity(): Promise<string | null> {
  const declared = parseLatestPriceTarget(await hledgerRaw(["prices", "-f", mainJournalPath()]));
  if (declared !== null) return declared;
  return parseLatestPriceTarget(await hledgerRaw(["prices", "-f", mainJournalPath(), "--infer-market-prices"]));
}

/** The classic balance sheet, straight from `hledger bs`: Assets and
 *  Liabilities sections (liabilities already sign-flipped positive by
 *  hledger), each with hledger's own total, plus the hledger-computed net.
 *  Run twice — native holdings and the market valuation — and paired. With a
 *  base commodity the valued run is `-X <base> --infer-market-prices`, which
 *  collapses multi-commodity holdings to one base-commodity figure wherever
 *  hledger finds any price path (direct, reverse, chained, or cost-
 *  inferred); with no prices at all there is nothing to aim at, and `-V`
 *  lets hledger value what it can. The payload carries the base commodity
 *  (the `-X` target; null on the `-V` path) so the renderer can lead a
 *  multi-commodity figure with the base-commodity leg. Each row also carries
 *  the date and amount of the account's latest balance assertion (from
 *  `print -O json`) — when the balance was last reconciled and what it was
 *  confirmed to be. Empty when there's no journal yet or hledger fails. */
async function ledgerNetWorth(): Promise<NetWorth> {
  const base = ["bs", "-O", "json", "-f", mainJournalPath()];
  const [native, printed, target] = await Promise.all([
    hledgerRaw(base),
    hledgerRaw(["print", "-O", "json", "-f", mainJournalPath()]),
    resolveBaseCommodity(),
  ]);
  const valued = await hledgerRaw(target ? [...base, "-X", target, "--infer-market-prices"] : [...base, "-V"]);
  const raw = parseBalanceSheetJson(native);
  if (raw === null) return { sections: [], net: { amounts: [], value: [] }, baseCommodity: null };
  const sheet = mergeValuedBalanceSheet(raw, parseBalanceSheetJson(valued));
  const asserted = parseAssertions(printed);
  return {
    ...sheet,
    baseCommodity: target,
    sections: sheet.sections.map((section) => ({
      ...section,
      rows: section.rows.map((row) => {
        const a = asserted[row.name];
        if (!a) return row;
        // Date always; the amount only when the assertion's Amount parsed —
        // assertedAmount never appears without assertedOn.
        return a.amount ? { ...row, assertedOn: a.date, assertedAmount: a.amount } : { ...row, assertedOn: a.date };
      }),
    })),
  };
}

/** The register JSON runs ~2.6 KB per plain transaction, so the default
 *  16 MB stdout cap dies around 6k transactions; 256 MB covers ~100k. */
const REGISTER_MAX_BUFFER = 256 * 1024 * 1024;

/** The journal register, straight from `hledger print`: every transaction
 *  with its postings, in journal order. `-I` keeps the report alive when a
 *  balance assertion fails — a broken ledger is exactly when the user needs
 *  to see its transactions. Empty when there's no journal yet; unlike the
 *  other queries, a failure against an EXISTING journal rejects (the empty
 *  register and an unreadable one must not look alike on this page). */
async function ledgerTransactions(): Promise<LedgerTransaction[]> {
  const journal = mainJournalPath();
  const stdout = await hledgerResult(["print", "-O", "json", "-I", "-f", journal], REGISTER_MAX_BUFFER);
  if (stdout === null) {
    if (existsSync(journal)) throw new Error("the register query failed against an existing journal");
    return [];
  }
  return parseTransactionsJson(stdout);
}

/** Register the ledger IPC handlers. */
export function registerLedgerIpc(): void {
  ipcMain.handle("ledger_mentions", () => ledgerMentions());
  ipcMain.handle("ledger_net_worth", () => ledgerNetWorth());
  ipcMain.handle("ledger_transactions", () => ledgerTransactions());
}
