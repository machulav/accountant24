import { homedir } from "node:os";
import { join } from "node:path";

// Resolved at module-eval time. The desktop app sets ACCOUNTANT24_WORKSPACE in the
// agent host's env before forking it, so the bundled extension picks up the
// right workspace dir; standalone/dev falls back to ~/.accountant24.
const envHome = process.env.ACCOUNTANT24_WORKSPACE;
export let ACCOUNTANT24_WORKSPACE = envHome && envHome.length > 0 ? envHome : join(homedir(), ".accountant24");
export let MEMORY_PATH = join(ACCOUNTANT24_WORKSPACE, "memory.md");
export let LEDGER_DIR = join(ACCOUNTANT24_WORKSPACE, "ledger");

export function setBaseDir(dir: string): void {
  ACCOUNTANT24_WORKSPACE = dir;
  MEMORY_PATH = join(dir, "memory.md");
  LEDGER_DIR = join(dir, "ledger");
}
