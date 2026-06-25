import { LEDGER_DIR } from "../config";
import { runHledger } from "./hledger";
import { resolveSafePath } from "./paths";

export async function listAccounts(): Promise<string[]> {
  try {
    const journal = resolveSafePath("main.journal", LEDGER_DIR);
    const stdout = await runHledger(["accounts", "-f", journal]);
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  } catch {
    return [];
  }
}
