import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEDGER_DIR, MEMORY_PATH } from "./config.js";
import { runHledger } from "./hledger.js";

export async function loadMemory(): Promise<string> {
  try {
    return readFileSync(MEMORY_PATH, "utf-8").trim();
  } catch {
    return "";
  }
}

export async function loadAccounts(): Promise<string[]> {
  return loadHledgerList("accounts");
}

export async function loadPayees(): Promise<string[]> {
  return loadHledgerList("payees");
}

async function loadHledgerList(subcommand: string): Promise<string[]> {
  try {
    const journal = join(LEDGER_DIR, "main.journal");
    const stdout = await runHledger([subcommand, "-f", journal]);
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
