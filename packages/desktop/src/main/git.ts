// Git on the workspace repo. The workspace is versioned so every ledger change
// is recoverable; the app creates the repo on first launch (workspace.ts) and
// the agent's commit_and_push tool commits into it from then on.
//
// Best-effort by design: git may be missing (no Xcode Command Line Tools) and an
// unversioned workspace is still a working one — failures are logged, not thrown.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** Run one git subcommand. Resolves true when it succeeded. */
function git(args: string[], cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd }, (err) => {
      if (err) console.warn(`[git] ${args.join(" ")} failed: ${err.message}`);
      resolve(!err);
    });
  });
}

/** `git init` unless the directory is already a repo. True when a repo was created. */
export async function initRepo(cwd: string): Promise<boolean> {
  if (existsSync(path.join(cwd, ".git"))) return false;
  return git(["init"], cwd);
}

/** Stage everything and commit it. */
export async function commitAll(cwd: string, message: string): Promise<void> {
  if (!(await git(["add", "-A"], cwd))) return;
  await git(["commit", "-m", message], cwd);
}
