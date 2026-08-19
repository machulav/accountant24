// Workspace migrations: one-off, versioned changes to the layout or contents
// of an existing workspace, run at launch before the workspace scaffold
// (workspace.ts) and before anything reads the folder.
//
// Adding a migration (conventions: AGENTS.md, "Workspace" → "Migrations"):
//   1. Create `NNNN-short-name.ts` next to this file with the next 4-digit
//      number and export a `Migration` whose `id` is the file name.
//   2. Append it to MIGRATIONS in ./index.ts (order = run order).
//   3. Cover it with a test over a temp directory (see __tests__).
// Rules: a migration must be idempotent (a crash between `run` and the
// record write re-runs it), must only touch the workspace it is given, and is
// never edited once shipped — add a new one instead.
//
// Applied ids are recorded in <workspace>/.migrations.json, so each runs at
// most once per workspace; the file travels with the workspace (git, backups).
// This module is Electron-free on purpose: tests run it over real temp dirs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const MIGRATIONS_STATE_FILE = ".migrations.json";

export interface MigrationContext {
  /** The resolved workspace dir. May not exist yet (fresh install). */
  workspaceDir: string;
  /** The user's home dir — injected so migrations (and tests) never reach for
   *  the real one. */
  homeDir: string;
}

export interface Migration {
  /** Stable id, `NNNN-short-name`; this is what gets recorded. */
  id: string;
  run(ctx: MigrationContext): void | Promise<void>;
}

export interface MigrationState {
  applied: string[];
}

function stateFile(workspaceDir: string): string {
  return path.join(workspaceDir, MIGRATIONS_STATE_FILE);
}

/** The recorded state. A missing, unreadable, or malformed file reads as
 *  "nothing applied": every migration is idempotent, so re-running is safe
 *  and self-heals the file. Never creates anything. */
export function readMigrationState(workspaceDir: string): MigrationState {
  const file = stateFile(workspaceDir);
  if (!existsSync(file)) return { applied: [] };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    const applied = raw && typeof raw === "object" ? (raw as { applied?: unknown }).applied : undefined;
    if (!Array.isArray(applied)) return { applied: [] };
    return { applied: applied.filter((id): id is string => typeof id === "string") };
  } catch {
    return { applied: [] };
  }
}

/** Persist the state, creating the workspace dir if a migration has not. */
export function writeMigrationState(workspaceDir: string, state: MigrationState): void {
  mkdirSync(workspaceDir, { recursive: true });
  writeFileSync(stateFile(workspaceDir), `${JSON.stringify(state, null, 2)}\n`);
}

/** Run every migration not yet recorded for this workspace, in order, and
 *  record each one right after it succeeds. Resolves with the ids applied in
 *  this run. The state is re-read before each migration and before each
 *  record, because a migration may itself move a folder into place that
 *  already carries a state file. A failing migration stops the run unrecorded
 *  and the error propagates, so the caller can refuse to start rather than
 *  open a half-migrated workspace. */
export async function runMigrations(migrations: readonly Migration[], ctx: MigrationContext): Promise<string[]> {
  const ids = new Set<string>();
  for (const m of migrations) {
    if (ids.has(m.id)) throw new Error(`duplicate migration id: ${m.id}`);
    ids.add(m.id);
  }

  const appliedNow: string[] = [];
  for (const migration of migrations) {
    if (readMigrationState(ctx.workspaceDir).applied.includes(migration.id)) continue;
    try {
      await migration.run(ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`migration ${migration.id} failed: ${msg}`, { cause: err });
    }
    const current = readMigrationState(ctx.workspaceDir).applied;
    if (!current.includes(migration.id)) {
      writeMigrationState(ctx.workspaceDir, { applied: [...current, migration.id] });
    }
    appliedNow.push(migration.id);
  }
  return appliedNow;
}
