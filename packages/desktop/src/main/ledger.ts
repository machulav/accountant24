// Ledger data served straight from the main process: the @-mention picker's
// entity lists and the Accounts view's balance report.
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
import type { BalanceSheet, LedgerMentions } from "../shared/types";
import { agentEnv, binDir, mainJournalPath, workspaceDir } from "./env";
import {
  mergeValuedBalanceSheet,
  parseAssertionDates,
  parseBalanceSheetJson,
  parseLatestPriceTarget,
} from "./ledger-json";

function hledgerBin(): string {
  const exe = path.join(binDir(), process.platform === "win32" ? "hledger.exe" : "hledger");
  return existsSync(exe) ? exe : "hledger";
}

/** Run one `hledger` subcommand and return its raw stdout, untouched (the
 *  balance report's JSON must not be line-shaped). Any failure (missing
 *  binary, no journal yet, parse error) yields "". */
function hledgerRaw(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(hledgerBin(), args, { cwd: workspaceDir(), env: agentEnv(), maxBuffer: 16 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? "" : stdout),
    );
  });
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
 *  declared market price. The agent records prices toward the user's
 *  currency, so the journal itself answers "which currency is home" and no
 *  currency is hardcoded. Seam for the future default-currency setting: once
 *  it exists, resolve it here first and fall back to the derivation. Null
 *  when the journal declares no prices. */
async function resolveBaseCommodity(): Promise<string | null> {
  return parseLatestPriceTarget(await hledgerRaw(["prices", "-f", mainJournalPath()]));
}

/** The classic balance sheet, straight from `hledger bs`: Assets and
 *  Liabilities sections (liabilities already sign-flipped positive by
 *  hledger), each with hledger's own total, plus the hledger-computed net.
 *  Run twice — native holdings and the market valuation — and paired. With a
 *  base commodity the valued run is `-X <base> --infer-market-prices`, which
 *  collapses multi-commodity holdings to one base-currency figure wherever
 *  hledger finds any price path (direct, reverse, chained, or cost-
 *  inferred); with no prices declared there is nothing to aim at, and `-V`
 *  lets hledger value what it can. Each row also carries the date of the
 *  account's latest balance assertion (from `print -O json`) — when the
 *  balance was last reconciled. Empty when there's no journal yet or hledger
 *  fails. */
async function ledgerBalanceSheet(): Promise<BalanceSheet> {
  const base = ["bs", "-O", "json", "-f", mainJournalPath()];
  const [native, printed, target] = await Promise.all([
    hledgerRaw(base),
    hledgerRaw(["print", "-O", "json", "-f", mainJournalPath()]),
    resolveBaseCommodity(),
  ]);
  const valued = await hledgerRaw(target ? [...base, "-X", target, "--infer-market-prices"] : [...base, "-V"]);
  const raw = parseBalanceSheetJson(native);
  if (raw === null) return { sections: [], net: { amounts: [], value: [] } };
  const sheet = mergeValuedBalanceSheet(raw, parseBalanceSheetJson(valued));
  const asserted = parseAssertionDates(printed);
  return {
    ...sheet,
    sections: sheet.sections.map((section) => ({
      ...section,
      rows: section.rows.map((row) => (asserted[row.name] ? { ...row, assertedOn: asserted[row.name] } : row)),
    })),
  };
}

/** Register the ledger IPC handlers. */
export function registerLedgerIpc(): void {
  ipcMain.handle("ledger_mentions", () => ledgerMentions());
  ipcMain.handle("ledger_balance_sheet", () => ledgerBalanceSheet());
}
