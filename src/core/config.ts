import { homedir } from "node:os";
import { join } from "node:path";

export let ACCOUNTANT24_HOME = join(homedir(), "accountant24");
export let MEMORY_PATH = join(ACCOUNTANT24_HOME, "memory.json");
export let LEDGER_DIR = join(ACCOUNTANT24_HOME, "ledger");

export function setBaseDir(dir: string): void {
  ACCOUNTANT24_HOME = dir;
  MEMORY_PATH = join(dir, "memory.json");
  LEDGER_DIR = join(dir, "ledger");
}
