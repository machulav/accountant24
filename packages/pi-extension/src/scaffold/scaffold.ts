import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ACCOUNTANT24_HOME } from "../config";
import { commitAll, gitInit } from "../git";
// @ts-expect-error
import gitignore from "./template/.gitignore" with { type: "text" };
// @ts-expect-error
import accountsJournal from "./template/ledger/accounts.journal" with { type: "text" };
// @ts-expect-error
import commoditiesJournal from "./template/ledger/commodities.journal" with { type: "text" };
// @ts-expect-error
import mainJournal from "./template/ledger/main.journal" with { type: "text" };
// Text imports so esbuild inlines template files into the bundle (the text
// loaders in scripts/bundle-extension.ts). TS lib doesn't ship types for text
// import attributes, and for .json files TS treats the import as JSON regardless
// of the `type: "text"` attribute, so we cast these at the manifest site.
// @ts-expect-error
import memoryMd from "./template/memory.md" with { type: "text" };

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
