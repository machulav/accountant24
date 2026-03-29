import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalCase } from "./types";

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
  const memoryPath = join(home, "memory.md");

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
    writeFileSync(memoryPath, `${setup.memory.trim()}\n`);
  }

  return {
    home,
    ledgerDir,
    memoryPath,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

// ── Workspace state inspection ───────────────────────────────────────

export interface WorkspaceState {
  ledgerContent: string;
  memoryContent: string;
}

function collectJournalFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJournalFiles(fullPath));
    } else if (entry.name.endsWith(".journal")) {
      files.push(fullPath);
    }
  }
  return files;
}

export function inspectWorkspace(workspace: EvalWorkspace): WorkspaceState {
  const journalFiles = collectJournalFiles(workspace.ledgerDir);
  const ledgerContent = journalFiles.map((f) => readFileSync(f, "utf-8")).join("\n");

  let memoryContent = "";
  try {
    memoryContent = readFileSync(workspace.memoryPath, "utf-8").trim();
  } catch {
    memoryContent = "";
  }

  return { ledgerContent, memoryContent };
}
