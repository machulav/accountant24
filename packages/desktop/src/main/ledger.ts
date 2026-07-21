// Ledger mention data for the chat composer's @-mention picker.
//
// Runs the same `hledger payees|accounts|tags` queries the pi-extension uses, but
// straight from the main process so the renderer can populate the @-mention
// popover without round-tripping through the agent's RPC stream. Reads the same
// workspace journal the agent does and resolves the vendored hledger binary
// explicitly — `execFile` looks the command up on the parent's PATH, which (unlike
// the spawned agent's env) does not include the bundled bin dir.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { ipcMain } from "electron";
import type { LedgerMentions } from "../shared/types";
import { agentEnv, binDir, mainJournalPath, workspaceDir } from "./env";

function hledgerBin(): string {
  const exe = path.join(binDir(), process.platform === "win32" ? "hledger.exe" : "hledger");
  return existsSync(exe) ? exe : "hledger";
}

/** Run one `hledger` subcommand and return its sorted, non-empty output lines.
 *  Any failure (missing binary, no journal yet, parse error) yields []. */
function hledger(args: string[]): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      hledgerBin(),
      args,
      { cwd: workspaceDir(), env: agentEnv(), maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        resolve(
          stdout
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
        );
      },
    );
  });
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

/** Register the ledger IPC handler (one call returns all three mention lists). */
export function registerLedgerIpc(): void {
  ipcMain.handle("ledger_mentions", () => ledgerMentions());
}
