import { MAIN_LEDGER_FILE } from "../config";
import { runHledger } from "./hledger";

export async function listAccounts(): Promise<string[]> {
  try {
    const journal = MAIN_LEDGER_FILE;
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
