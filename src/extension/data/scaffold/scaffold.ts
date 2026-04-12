import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ACCOUNTANT24_HOME } from "../../config";
import { commitAll, gitInit } from "../../git";
// @ts-expect-error
import gitignore from "./template/.gitignore" with { type: "text" };
// @ts-expect-error
import accountsJournal from "./template/ledger/accounts.journal" with { type: "text" };
// @ts-expect-error
import mainJournal from "./template/ledger/main.journal" with { type: "text" };
// Text imports so `bun build --compile` inlines template files into the binary.
// TS lib doesn't ship types for text import attributes, and for .json files TS
// treats the import as JSON regardless of the `type: "text"` attribute — Bun
// still returns the raw text at runtime, so we cast these at the manifest site.
// @ts-expect-error
import memoryMd from "./template/memory.md" with { type: "text" };
import modelsJson from "./template/models.json" with { type: "text" };
import settingsJson from "./template/settings.json" with { type: "text" };

/** Workspace scaffold manifest. Relative paths → file contents. */
const TEMPLATE_FILES: Record<string, string> = {
  "memory.md": memoryMd,
  ".gitignore": gitignore,
  "models.json": modelsJson as unknown as string,
  "settings.json": settingsJson as unknown as string,
  "ledger/accounts.journal": accountsJournal,
  "ledger/main.journal": mainJournal,
};

function writeIfNotExists(filePath: string, content: string): void {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, content);
  }
}

export async function ensureScaffolded(): Promise<void> {
  const home = ACCOUNTANT24_HOME;

  for (const dir of ["ledger", "files", "sessions"]) {
    mkdirSync(join(home, dir), { recursive: true });
  }

  for (const [relPath, content] of Object.entries(TEMPLATE_FILES)) {
    const outputPath = join(home, relPath);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeIfNotExists(outputPath, content);
  }

  const freshRepo = await gitInit(home);
  if (freshRepo) {
    await commitAll(home, "Initial Accountant24 setup");
  }
}
