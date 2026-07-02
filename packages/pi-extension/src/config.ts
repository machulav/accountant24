import { homedir } from "node:os";
import { join } from "node:path";

// Resolved at module-eval time. The desktop app sets ACCOUNTANT24_HOME in the
// sidecar env before spawning pi, so the bundled extension picks up the right
// workspace dir; standalone/dev falls back to ~/Accountant24.
const envHome = process.env.ACCOUNTANT24_HOME;
export let ACCOUNTANT24_HOME = envHome && envHome.length > 0 ? envHome : join(homedir(), "Accountant24");
export let MEMORY_PATH = join(ACCOUNTANT24_HOME, "memory.md");
export let LEDGER_DIR = join(ACCOUNTANT24_HOME, "ledger");
export let FILES_DIR = join(ACCOUNTANT24_HOME, "files");

export function setBaseDir(dir: string): void {
  ACCOUNTANT24_HOME = dir;
  MEMORY_PATH = join(dir, "memory.md");
  LEDGER_DIR = join(dir, "ledger");
  FILES_DIR = join(dir, "files");
}
