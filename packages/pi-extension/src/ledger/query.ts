import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES } from "@earendil-works/pi-coding-agent";
import { ACCOUNTANT24_WORKSPACE } from "../config";
import { runHledger } from "./hledger";
import { resolveSafePath } from "./paths";

const PERIOD_FLAGS: Record<string, string> = {
  daily: "--daily",
  weekly: "--weekly",
  monthly: "--monthly",
  quarterly: "--quarterly",
  yearly: "--yearly",
};

// TUI box border (2) + padding (2) + content indent (2)
const TUI_CHROME_WIDTH = 6;

// A large result (a `reg`/`print` dump meant for a downstream script, not for
// the model to read turn by turn) burns context tokens for no benefit. Past
// this size, spill the full output to a scratch file and return only a head
// preview plus the path. Gate on total length, not line count: line count
// misleads for `-O json` (one pretty-printed array) and for wide `reg` output,
// and counting lines means scanning the whole string. The threshold is pi's
// own tool-output cap (50 KB, what its bash/read/grep tools enforce), so the
// model lives with one limit everywhere; report output is ASCII-dominated,
// so chars ≈ bytes.
export const MAX_INLINE_CHARS = DEFAULT_MAX_BYTES;
// How much of a spilled result to still show inline, so the model (and the
// user, who sees this text in the tool-result card) can read the shape of the
// output and often answer without a second call. Trimmed back to a line break.
export const PREVIEW_CHARS = 2_000;

const OUTPUT_EXTENSIONS: Record<string, string> = { csv: "csv", tsv: "tsv", json: "json" };

// Scratch files go in the OS temp dir, never the workspace: `~/.accountant24`
// is a git repo, and a dump left there would get swept into a commit. The
// agent's bash/file tools inherit this process's environment, so they can read
// an os.tmpdir() path.
const SCRATCH_PREFIX = "accountant24-query-scratch-";
const SCRATCH_TTL_MS = 6 * 60 * 60 * 1000;

export interface QueryLedgerResult {
  command: string;
  output: string;
  outputFile?: string;
}

/** First `budget` chars of `s`, trimmed back to the last line break so the
 *  preview never ends mid-row. O(budget), not O(s). */
function headWithinBudget(s: string, budget: number): string {
  if (s.length <= budget) return s;
  const slice = s.slice(0, budget);
  const nl = slice.lastIndexOf("\n");
  return nl > 0 ? slice.slice(0, nl) : slice;
}

function approxKb(chars: number): string {
  return chars < 1024 ? `${chars} chars` : `${Math.round(chars / 1024)} KB`;
}

/** Best effort: remove scratch dirs left by crashed earlier runs. A graceful
 *  shutdown leaves at most one dir behind, reclaimed here on the next launch.
 *  Exported for testing. */
export function sweepStaleScratch(base: string = tmpdir(), ttlMs: number = SCRATCH_TTL_MS): void {
  let names: string[];
  try {
    names = readdirSync(base);
  } catch {
    return; // temp dir unreadable - nothing to sweep
  }
  for (const name of names) {
    if (!name.startsWith(SCRATCH_PREFIX)) continue;
    const p = join(base, name);
    try {
      const st = statSync(p, { throwIfNoEntry: false });
      if (st && Date.now() - st.mtimeMs > ttlMs) rmSync(p, { recursive: true, force: true });
    } catch {
      // One undeletable entry (permissions, a race with another sweep) must
      // not stop the sweep or fail the query that triggered it.
    }
  }
}

// One scratch dir for the life of this host process (not one per query),
// created lazily so a session that never spills touches nothing. A failure
// here propagates to queryLedger's catch (inline fallback) and leaves this
// unset so the next call retries.
let scratchDir: string | undefined;
// Serial per process, appended to each scratch file name: one host process
// serves every chat, so two queries can spill in the same millisecond, and a
// timestamp alone would silently overwrite one result with the other.
let scratchSeq = 0;
function ensureScratchDir(): string {
  if (scratchDir !== undefined && !existsSync(scratchDir)) {
    // Another instance's sweep (or a tmp cleaner) removed the dir mid-run.
    // Recreate rather than letting every spill fail until restart.
    scratchDir = undefined;
  }
  if (scratchDir === undefined) {
    sweepStaleScratch();
    scratchDir = mkdtempSync(join(tmpdir(), SCRATCH_PREFIX));
  } else {
    // Keep a live dir looking live: the sweep judges staleness by mtime, and
    // a long-running process can outlive the TTL between spills.
    const now = new Date();
    try {
      utimesSync(scratchDir, now, now);
    } catch {
      // Best effort - worst case the dir looks stale and is swept, which the
      // existsSync check above then recovers from.
    }
  }
  return scratchDir;
}

export async function queryLedger(params: any, signal?: AbortSignal): Promise<QueryLedgerResult> {
  const file = params.file ?? "ledger/main.journal";
  const resolved = resolveSafePath(file, ACCOUNTANT24_WORKSPACE);
  const args = buildQueryArgs(params, resolved);
  const raw = await runHledger(args, { signal });
  const command = ["hledger", ...args].join(" ");

  if (raw.length <= MAX_INLINE_CHARS) {
    return { command, output: raw || "(no results)" };
  }

  const preview = headWithinBudget(raw, PREVIEW_CHARS);
  const ext = OUTPUT_EXTENSIONS[params.output_format] ?? "txt";
  try {
    const outputFile = join(ensureScratchDir(), `query-${Date.now()}-${scratchSeq++}.${ext}`);
    await writeFile(outputFile, raw, { signal });
    return {
      command,
      output:
        `${preview}\n\n[Preview only. Full output (${approxKb(raw.length)}) written to ${outputFile} - ` +
        `read it from there with bash or a script rather than re-running this query.]`,
      outputFile,
    };
  } catch (err) {
    // hledger succeeded; the spill is an optimization. Fall back to the
    // preview inline rather than failing the whole query or flooding context.
    return {
      command,
      output:
        `${preview}\n\n[Preview only - showing ${approxKb(preview.length)} of ${approxKb(raw.length)}. ` +
        `Scratch file unavailable (${(err as Error).message}); narrow the query (filters or a date range) to see the rest.]`,
    };
  }
}

function buildQueryArgs(params: any, resolved: string): string[] {
  const args = [params.report, "-f", resolved];

  if (params.account_pattern) args.push(params.account_pattern);
  if (params.description_pattern) args.push(`desc:${params.description_pattern}`);
  if (params.payee_pattern) args.push(`payee:${params.payee_pattern}`);
  if (params.amount_filter) args.push(`amt:${params.amount_filter}`);
  if (params.tag) args.push(`tag:${params.tag}`);
  if (params.status === "cleared") args.push("status:*");
  else if (params.status === "pending") args.push("status:!");
  else if (params.status === "unmarked") args.push("status:");

  if (params.begin_date) args.push("-b", params.begin_date);
  if (params.end_date) args.push("-e", params.end_date);
  else args.push("-e", "tomorrow");

  if (params.period && PERIOD_FLAGS[params.period]) {
    args.push(PERIOD_FLAGS[params.period]);
  }

  if (params.depth != null) args.push("--depth", String(params.depth));
  if (params.invert) args.push("--invert");
  if (params.output_format) args.push("-O", params.output_format);

  if (params.report === "reg" || params.report === "aregister") {
    const width = (process.stdout.columns || 80) - TUI_CHROME_WIDTH;
    args.push(`--width=${width}`);
  }

  return args;
}
