import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tidyJournal } from "@accountant24/hledger-journal";
import { generateDiffString } from "@earendil-works/pi-coding-agent";
import { ACCOUNTANT24_HOME, LEDGER_DIR } from "../config";
import { runHledger } from "./hledger";

export interface TidySummary {
  files: number;
  changed: number;
  diffs: Array<{ fullFilePath: string; diff: string }>;
  skipped: Array<{ fullFilePath: string; startLine: number; reason: string }>;
}

export interface TidyPlan extends TidySummary {
  /** New content per file that needs rewriting, keyed by absolute path. */
  writes: Map<string, string>;
  /** Original content of those files, for byte-exact rollback. */
  snapshots: Map<string, string>;
}

/** hledger JSON keys that only encode positions or file order; they change
 *  legitimately when entries move, so the semantic comparison ignores them. */
const POSITION_KEYS = new Set(["tsourcepos", "tindex", "ptransaction_", "baposition"]);

/** Compute the tidied (date-sorted, canonically formatted) content of every
 *  monthly journal file, without touching the disk. Blocks the strict parser
 *  does not fully understand are kept verbatim and reported in `skipped`. */
export function planTidy(): TidyPlan {
  const writes = new Map<string, string>();
  const snapshots = new Map<string, string>();
  const diffs: TidySummary["diffs"] = [];
  const skipped: TidySummary["skipped"] = [];
  const targets = discoverMonthlyFiles();

  for (const fullFilePath of targets) {
    const oldContent = readFileSync(fullFilePath, "utf-8");
    const result = tidyJournal(oldContent);
    for (const block of result.skippedBlocks) {
      skipped.push({ fullFilePath, startLine: block.startLine, reason: block.reason });
    }
    if (result.text === oldContent) continue;
    snapshots.set(fullFilePath, oldContent);
    writes.set(fullFilePath, result.text);
    diffs.push({ fullFilePath, diff: generateDiffString(oldContent, result.text).diff });
  }

  return { files: targets.length, changed: writes.size, diffs, skipped, writes, snapshots };
}

export function applyTidy(plan: TidyPlan): void {
  for (const [fullFilePath, content] of plan.writes) {
    writeFileSync(fullFilePath, content);
  }
}

export function restoreTidy(plan: TidyPlan): void {
  for (const [fullFilePath, content] of plan.snapshots) {
    writeFileSync(fullFilePath, content);
  }
}

/** The ledger's transactions as hledger sees them, minus position metadata.
 *  Two equal snapshots prove an edit was layout-only. */
export async function printSemantics(mainPath: string, signal?: AbortSignal): Promise<string> {
  const stdout = await runHledger(["print", "-f", mainPath, "-O", "json"], { cwd: ACCOUNTANT24_HOME, signal });
  return JSON.stringify(JSON.parse(stdout), (key, value) => (POSITION_KEYS.has(key) ? undefined : value));
}

/** All ledger/YYYY/MM.journal files, in chronological path order. */
function discoverMonthlyFiles(): string[] {
  if (!existsSync(LEDGER_DIR)) return [];
  const result: string[] = [];
  const years = readdirSync(LEDGER_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const year of years) {
    const monthly = readdirSync(join(LEDGER_DIR, year))
      .filter((name) => /^\d{2}\.journal$/.test(name))
      .sort();
    for (const name of monthly) {
      result.push(join(LEDGER_DIR, year, name));
    }
  }
  return result;
}
