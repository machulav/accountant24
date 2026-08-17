// First-run workspace setup: the app seeds ~/Accountant24 with its directories,
// the starter journal + memory files, and a git repo at launch — before any chat
// exists, so the ledger views, settings, and skills all work on a fresh install.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { workspaceDir } from "./env";
import { commitAll, initRepo } from "./git";
// `?raw` text imports so vite inlines the template files into the main bundle.
import gitignore from "./template/.gitignore?raw";
import accountsJournal from "./template/ledger/accounts.journal?raw";
import commoditiesJournal from "./template/ledger/commodities.journal?raw";
import mainJournal from "./template/ledger/main.journal?raw";
import memoryMd from "./template/memory.md?raw";

/** Workspace scaffold manifest. Relative paths → file contents. */
const TEMPLATE_FILES: Record<string, string> = {
  "memory.md": memoryMd,
  ".gitignore": gitignore,
  "ledger/accounts.journal": accountsJournal,
  "ledger/commodities.journal": commoditiesJournal,
  "ledger/main.journal": mainJournal,
};

function writeIfNotExists(filePath: string, content: string): void {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, content);
  }
}

/** Create whatever the workspace is missing. Safe to call on every launch. */
export async function ensureWorkspace(): Promise<void> {
  const home = workspaceDir();

  for (const dir of ["ledger", "files", "sessions"]) {
    mkdirSync(join(home, dir), { recursive: true });
  }

  for (const [relPath, content] of Object.entries(TEMPLATE_FILES)) {
    const outputPath = join(home, relPath);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeIfNotExists(outputPath, content);
  }

  const freshRepo = await initRepo(home);
  if (freshRepo) {
    await commitAll(home, "Initial Accountant24 setup");
  }
}
