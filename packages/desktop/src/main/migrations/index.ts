// The ordered list of workspace migrations (see runner.ts for the rules) and
// the launch-time entry point. Append new migrations at the end.

import { homedir } from "node:os";
import { workspaceDir } from "../env";
import { relocateLegacyHome } from "./0001-relocate-legacy-home";
import { type Migration, runMigrations } from "./runner";

export const MIGRATIONS: readonly Migration[] = [relocateLegacyHome];

/** Run the migrations the active workspace has not seen yet. */
export function runPendingMigrations(): Promise<string[]> {
  return runMigrations(MIGRATIONS, { workspaceDir: workspaceDir(), homeDir: homedir() });
}
