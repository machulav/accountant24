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
import { mergeValuedBalanceSheet, parseBalanceSheetJson } from "./ledger-json";

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

/** The app's base currency: every balance is valued in it. Explicit here
 *  (rather than implied by the journal's P directives) so hledger converts
 *  through reverse and chained prices too; a future setting could replace it. */
const BASE_COMMODITY = "EUR";

/** Flags shared by every valued report: value in the base currency, using
 *  declared P prices plus prices inferred from transaction costs — the
 *  manual-recommended pairing (`-X COMM --infer-market-prices`). */
const VALUATION = ["-X", BASE_COMMODITY, "--infer-market-prices"];

/** The classic balance sheet, straight from `hledger bs`: Assets and
 *  Liabilities sections (liabilities already sign-flipped positive by
 *  hledger), each with hledger's own total, plus the hledger-computed net.
 *  Run twice — native holdings and the market valuation — and paired; the
 *  valued run collapses multi-commodity holdings to one base-currency figure
 *  wherever hledger finds any price path (direct, reverse, chained, or
 *  cost-inferred). Empty when there's no journal yet or hledger fails. */
async function ledgerBalanceSheet(): Promise<BalanceSheet> {
  const base = ["bs", "-O", "json", "-f", mainJournalPath()];
  const [native, valued] = await Promise.all([hledgerRaw(base), hledgerRaw([...base, ...VALUATION])]);
  const raw = parseBalanceSheetJson(native);
  if (raw === null) return { sections: [], net: { amounts: [], value: [] } };
  return mergeValuedBalanceSheet(raw, parseBalanceSheetJson(valued));
}

/** Register the ledger IPC handlers. */
export function registerLedgerIpc(): void {
  ipcMain.handle("ledger_mentions", () => ledgerMentions());
  ipcMain.handle("ledger_balance_sheet", () => ledgerBalanceSheet());
}
