import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LEDGER_DIR, MEMORY_PATH } from "./config.js";
import { MemorySchema } from "./tools/update-memory.js";
import { runCommand } from "./tools/utils.js";

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
    const { exitCode, stdout } = await runCommand(["hledger", subcommand, "-f", journal]);
    if (exitCode !== 0) return [];
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
