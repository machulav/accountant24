import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LEDGER_DIR, MEMORY_PATH } from "./config.js";
import { runHledger } from "./tools/hledger.js";
import { MemorySchema } from "./tools/update-memory.js";

export async function loadFacts(): Promise<string[]> {
  try {
    if (!existsSync(MEMORY_PATH)) return [];
    const raw = JSON.parse(readFileSync(MEMORY_PATH, "utf-8"));
    const parsed = MemorySchema.safeParse(raw);
    return parsed.success ? parsed.data.facts : [];
  } catch {
    return [];
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
