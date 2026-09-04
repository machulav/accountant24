// Follow-up to 0001. A ~/.accountant24 could already exist before 0.3:
// v0.1.x (Apr–Jun 2026) used it as pi's config dir (agent/, auth.json,
// sessions/). 0001 took that leftover for an already-migrated workspace, left
// ~/Accountant24 where it was, and the launch scaffolded a fresh workspace into
// the leftovers — onboarding screen, real books out of sight. This moves
// ~/Accountant24 into place anyway when the folder in the way holds nothing
// the user made: that folder is renamed to ~/.accountant24.bak first, never
// deleted. A folder that has been used since (a chat, a ledger edit) is left
// alone with a warning; the FAQ covers sorting that out by hand.

import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import type { Migration } from "./runner";

/** sha256 of src/main/template/ledger/* as shipped in v0.3.0, the only
 *  version that scaffolds a workspace before this migration exists. Frozen on
 *  purpose: a shipped migration must not follow later template edits. To
 *  recompute: `git show v0.3.0:packages/desktop/src/main/template/ledger/<file> | shasum -a 256`. */
const SCAFFOLD_LEDGER_SHA256: Readonly<Record<string, string>> = {
  "main.journal": "56040c93a86a88a57c54c9dba9bc083e6d97aadfcfb516ab870e9fca22637941",
  "accounts.journal": "59ee1bb8579117febaa432fa9b7b7e8e2540f2d2d06fb2fc93840dee8b05297e",
  "commodities.journal": "eaff9c2fa05ed6de0f983fc5433ab4f65dbdb27a0f606b1de8e4937826e9c12b",
};

/** How much of a session file to read for its header line. pi's own header
 *  scan is bounded the same way; a header that long is not one of ours. */
const HEADER_SCAN_BYTES = 64 * 1024;

const BACKUP_SUFFIX = ".bak";

function isDirectory(p: string): boolean {
  return existsSync(p) && statSync(p).isDirectory();
}

/** True when there is no regular file anywhere under `dir` (a missing dir
 *  counts; empty subfolders are fine). */
function hasNoFiles(dir: string): boolean {
  if (!existsSync(dir)) return true;
  if (!statSync(dir).isDirectory()) return false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) return false;
    if (!hasNoFiles(path.join(dir, entry.name))) return false;
  }
  return true;
}

/** True when `ledger/` is missing or holds exactly what the 0.3.0 scaffold
 *  wrote: a subset of the three template files, each byte-identical. */
function isScaffoldLedger(ledgerDir: string): boolean {
  if (!existsSync(ledgerDir)) return true;
  if (!statSync(ledgerDir).isDirectory()) return false;
  for (const entry of readdirSync(ledgerDir, { withFileTypes: true })) {
    const expected = SCAFFOLD_LEDGER_SHA256[entry.name];
    if (expected === undefined || !entry.isFile()) return false;
    const actual = createHash("sha256")
      .update(readFileSync(path.join(ledgerDir, entry.name)))
      .digest("hex");
    if (actual !== expected) return false;
  }
  return true;
}

/** The `cwd` of a pi session file's header line, or undefined when the first
 *  line is not a JSON object with one (or is longer than the bounded scan). */
function sessionHeaderCwd(file: string): string | undefined {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(HEADER_SCAN_BYTES);
    const n = readSync(fd, buf, 0, HEADER_SCAN_BYTES, 0);
    const text = buf.subarray(0, n).toString("utf8");
    const newline = text.indexOf("\n");
    if (newline === -1) return undefined;
    const header = JSON.parse(text.slice(0, newline)) as unknown;
    if (!header || typeof header !== "object") return undefined;
    const cwd = (header as { cwd?: unknown }).cwd;
    return typeof cwd === "string" ? cwd : undefined;
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

/** Every `*.jsonl` under `dir`, recursively. */
function sessionFiles(dir: string): string[] {
  if (!isDirectory(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sessionFiles(p));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(p);
  }
  return files;
}

/** True when no chat was ever recorded in this workspace. pi lists a session
 *  for a workspace only when its header cwd is that folder, and writes the
 *  file only once an assistant reply exists; a session recorded under another
 *  cwd (v0.1.x pi leftovers) is invisible to the app and ignored here too.
 *  A `.jsonl` without a readable header is taken as a chat: when in doubt,
 *  leave the folder alone. */
function hasNoChats(sessionsDir: string, workspaceDir: string): boolean {
  return sessionFiles(sessionsDir).every((file) => {
    const cwd = sessionHeaderCwd(file);
    return cwd !== undefined && path.resolve(cwd) !== workspaceDir;
  });
}

/** True when the folder holds nothing the user made: no chats of its own, an
 *  untouched (or absent) template ledger, an empty memory, no documents.
 *  Anything else in it (.git, .gitignore, .migrations.json, app-settings.json,
 *  plugins/, auth.json, models.json, settings.json, pi's agent/) carries no
 *  ledger data; the legacy workspace brings its own. */
function isUnused(workspaceDir: string): boolean {
  const memory = path.join(workspaceDir, "memory.md");
  return (
    hasNoChats(path.join(workspaceDir, "sessions"), workspaceDir) &&
    isScaffoldLedger(path.join(workspaceDir, "ledger")) &&
    (!existsSync(memory) || (statSync(memory).isFile() && statSync(memory).size === 0)) &&
    hasNoFiles(path.join(workspaceDir, "files"))
  );
}

export const relocateLegacyHomeOverUnused: Migration = {
  id: "0002-relocate-legacy-home-over-unused",
  run({ workspaceDir, homeDir }) {
    // Only the default location is ours to move (same rule as 0001).
    if (workspaceDir !== path.join(homeDir, ".accountant24")) return;
    // Stricter than 0001 about what counts as the legacy workspace: 0001 only
    // moved a folder, this one displaces one.
    const legacy = path.join(homeDir, "Accountant24");
    if (!isDirectory(legacy) || !existsSync(path.join(legacy, "ledger", "main.journal"))) return;

    if (existsSync(workspaceDir)) {
      if (!statSync(workspaceDir).isDirectory()) {
        throw new Error(`${workspaceDir} exists but is not a folder`);
      }
      if (!isUnused(workspaceDir)) {
        console.warn(
          `[workspace] ${workspaceDir} is in use, so the previous workspace at ${legacy} was left where it is`,
        );
        return;
      }
      const backup = workspaceDir + BACKUP_SUFFIX;
      if (existsSync(backup)) {
        throw new Error(`${backup} already exists. Move it somewhere else, then open the app again.`);
      }
      renameSync(workspaceDir, backup);
    }
    // Reached with no workspace folder either when this run just moved it
    // aside or when an earlier run crashed between the two renames.
    renameSync(legacy, workspaceDir);
  },
};
