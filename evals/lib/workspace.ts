import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalCase } from "./types.js";

const WORKSPACES_DIR = join(import.meta.dirname, "../.workspaces");

export interface EvalWorkspace {
  home: string;
  ledgerDir: string;
  memoryPath: string;
  cleanup: () => void;
}

export function createEvalWorkspace(evalCase: EvalCase): EvalWorkspace {
  mkdirSync(WORKSPACES_DIR, { recursive: true });
  const home = mkdtempSync(join(WORKSPACES_DIR, `${evalCase.id}-`));
  const ledgerDir = join(home, "ledger");
  const memoryPath = join(home, "memory.json");

  mkdirSync(ledgerDir, { recursive: true });

  // ── Write ledger journal ───────────────────────────────────────────
  const setup = evalCase.setup;
  const parts: string[] = [];

  if (setup?.ledger?.accounts?.length) {
    parts.push(setup.ledger.accounts.join("\n"));
  }

  if (setup?.ledger?.transactions?.length) {
    const txns = setup.ledger.transactions.map((lines) => {
      return lines
        .map((line, i) => {
          // First line is the date/description line, rest are postings
          if (i === 0) return line;
          return `    ${line}`;
        })
        .join("\n");
    });

    if (parts.length > 0) parts.push(""); // blank separator
    parts.push(txns.join("\n\n"));
  }

  writeFileSync(join(ledgerDir, "main.journal"), parts.length > 0 ? `${parts.join("\n")}\n` : "");

  // ── Write memory ───────────────────────────────────────────────────
  if (setup?.memory) {
    writeFileSync(memoryPath, `${JSON.stringify(setup.memory, null, 2)}\n`);
  }

  return {
    home,
    ledgerDir,
    memoryPath,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}
