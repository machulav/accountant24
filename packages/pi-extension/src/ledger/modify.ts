import { isAbsolute, relative, resolve } from "node:path";
import { ACCOUNTANT24_HOME, LEDGER_DIR } from "../config";
import { JournalEditSession } from "./edit-session";
import { HledgerCommandError, hledgerCheck, runHledger } from "./hledger";
import { resolveSafePath } from "./paths";

// ── Types ───────────────────────────────────────────────────────────

/** The transaction/posting fields that are safe to change by surgical text replacement. */
export type ModifyField = "account" | "payee";

export interface ModifyParams {
  field: ModifyField;
  /** The replacement value: a new account (field "account") or a new payee (field "payee"). */
  new_value: string;
  /** Required for field "account": selects which posting to change, by its current account. */
  from_account?: string;
  /** Required for field "payee": the exact current payee to rename, so a fuzzy query never
   * silently rewrites a different, unrelated payee. */
  from_payee?: string;
}

export interface ModifyResult {
  field: ModifyField;
  query: string[];
  transactions: number;
  postings: number;
  diffs: Array<{ fullFilePath: string; diff: string }>;
  warnings: string[];
  ledgerIsValid: boolean;
  validationError?: string;
  dryRun: boolean;
}

// hledger separates a posting's account from its amount with 2+ spaces or a tab.
const ACCOUNT_AMOUNT_SEP = / {2,}|\t+/;

// A transaction header: date (optional secondary date), optional status, optional
// (code), then the description ("payee | note"). Captures [prefix, description].
const HEADER_RE = /^(\d{4}[-/.]\d{2}[-/.]\d{2}(?:=\d{4}[-/.]\d{2}[-/.]\d{2})?\s+(?:[*!]\s+)?(?:\([^)]*\)\s+)?)(.*)$/;

// ── Public ──────────────────────────────────────────────────────────

/**
 * Run an hledger query and change one field on every matching transaction.
 * Supported fields (safe surgical text replacements):
 *   - account: move postings in `from_account` to `new_value` (a new account).
 *   - payee:   replace each transaction's payee with `new_value`.
 *
 * `query` is an array of hledger query terms. Each element is passed verbatim as one
 * argv token to `hledger` (via spawn, never a shell), so a term containing spaces such
 * as `desc:whole foods` is a single element and needs no quoting.
 *
 * Edits are surgical (only the named field's text changes; the rest of the transaction
 * is preserved). The whole ledger is validated afterward and the batch is rolled back on
 * any error. `dryRun` previews without writing.
 */
export function modifyTransactions(
  query: string[],
  params: ModifyParams,
  dryRun = false,
  signal?: AbortSignal,
): Promise<ModifyResult> {
  // Serialization is handled at the tool layer: the modify_transactions tool is registered
  // executionMode "sequential", so pi never runs it concurrently with another ledger-writing
  // tool. That keeps concurrent read/edit/write/validate cycles from interleaving on shared
  // journal files.
  return runModify(query, params, dryRun, signal);
}

async function runModify(
  query: string[],
  params: ModifyParams,
  dryRun = false,
  signal?: AbortSignal,
): Promise<ModifyResult> {
  validate(query, params);
  const mainPath = resolveSafePath("main.journal", LEDGER_DIR);
  const session = new JournalEditSession();

  const matches = await discover(query, params, mainPath, signal);

  // Edit each file from its last matched transaction upward. Every edit here is
  // line-count-preserving, so this ordering is not strictly required today; it guards
  // against a future edit type that inserts or removes lines, where editing top-down
  // would invalidate the `startLine` of every later match in the same file.
  const ordered = [...matches].sort((a, b) => b.startLine - a.startLine);

  const warnings: string[] = [];
  let transactions = 0;
  let postings = 0;

  for (const match of ordered) {
    const content = session.read(match.file);
    const { newContent, count, warn } =
      params.field === "account"
        ? applyAccountEdit(content, match, params.from_account as string, params.new_value)
        : applyPayeeEdit(content, match, params.from_payee as string, params.new_value);

    warnings.push(...warn);
    if (count > 0) {
      session.write(match.file, newContent);
      transactions += 1;
      if (params.field === "account") postings += count;
    }
  }

  session.flush();

  // Validate the whole ledger.
  let ledgerIsValid = true;
  let validationError: string | undefined;
  try {
    await hledgerCheck(mainPath, { cwd: ACCOUNTANT24_HOME, signal });
  } catch (e) {
    if (e instanceof HledgerCommandError) {
      ledgerIsValid = false;
      validationError = e.stderr;
    } else {
      session.restore();
      throw e;
    }
  }

  const base: Omit<ModifyResult, "ledgerIsValid" | "validationError" | "dryRun"> = {
    field: params.field,
    query,
    transactions,
    postings,
    diffs: session.diff(),
    warnings,
  };

  if (dryRun) {
    session.restore(); // preview only: leave the disk byte-for-byte unchanged
    return { ...base, ledgerIsValid, validationError, dryRun: true };
  }

  if (!ledgerIsValid) {
    session.restore();
    throw new Error(
      `Modification reverted — the ledger would have errors (is the new account declared in accounts.journal?):\n\n${validationError}`,
    );
  }

  return { ...base, ledgerIsValid: true, dryRun: false };
}

// ── Validation ──────────────────────────────────────────────────────

function validate(query: string[], params: ModifyParams): void {
  if (!Array.isArray(query) || query.length === 0) {
    throw new Error("query must be a non-empty array of hledger query terms.");
  }
  for (const term of query) {
    if (!term || term.trim() === "") {
      throw new Error("query terms must not be empty.");
    }
    // Query terms never start with '-'; reject to prevent hledger option injection.
    if (term.startsWith("-")) {
      throw new Error(`Invalid query term "${term}": query terms must not start with '-'.`);
    }
  }
  if (params.field !== "account" && params.field !== "payee") {
    throw new Error(`Unsupported field: ${params.field}. Expected "account" or "payee".`);
  }
  if (!params.new_value || params.new_value.trim() === "") {
    throw new Error("new_value must not be empty.");
  }
  if (params.new_value !== params.new_value.trim()) {
    throw new Error("new_value must not have leading or trailing whitespace.");
  }
  if (params.field === "account") {
    if (!params.from_account || params.from_account.trim() === "") {
      throw new Error('from_account is required when field is "account".');
    }
    // hledger separates a posting's account from its amount with 2+ spaces or a tab, so an
    // account name containing either would be silently truncated when the line is re-parsed.
    if (/ {2,}|\t/.test(params.new_value)) {
      throw new Error("new_value (account) must not contain a tab or two or more consecutive spaces.");
    }
  }
  if (params.field === "payee") {
    if (!params.from_payee || params.from_payee.trim() === "") {
      throw new Error('from_payee is required when field is "payee".');
    }
    // '|' separates payee from note and ';' begins a comment; either in a payee value would
    // shift the header's parse boundaries and change more than the payee.
    if (/[|;]/.test(params.new_value)) {
      throw new Error("new_value (payee) must not contain '|' or ';'.");
    }
  }
}

// ── Discovery ───────────────────────────────────────────────────────

interface Match {
  file: string; // absolute path to the journal file the transaction lives in
  startLine: number; // 1-based line of the transaction's first (header) line
}

async function discover(
  query: string[],
  params: ModifyParams,
  mainPath: string,
  signal?: AbortSignal,
): Promise<Match[]> {
  // Each query element is one argv token — spaces inside a term are preserved by spawn.
  const stdout = await runHledger(["print", "-f", mainPath, ...query, "-O", "json"], {
    cwd: ACCOUNTANT24_HOME,
    signal,
  });

  let txns: unknown;
  try {
    txns = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(txns)) return [];

  const matches: Match[] = [];
  for (const tx of txns) {
    // An "account" edit only touches transactions that actually hold a posting in
    // `from_account`; a "payee" edit applies to every query match.
    if (params.field === "account") {
      const postings = Array.isArray(tx?.tpostings) ? tx.tpostings : [];
      const hit = postings.some((p: { paccount?: string }) => p?.paccount === params.from_account);
      if (!hit) continue;
    }

    const loc = parseSourcePos(tx?.tsourcepos);
    if (!loc) continue;
    const absFile = resolveSourceFile(loc.sourceName);
    if (!absFile) continue;

    matches.push({ file: absFile, startLine: loc.sourceLine });
  }
  return matches;
}

function parseSourcePos(tsourcepos: unknown): { sourceName: string; sourceLine: number } | null {
  if (!Array.isArray(tsourcepos) || tsourcepos.length === 0) return null;
  const start = tsourcepos[0];
  if (!start || typeof start.sourceName !== "string" || typeof start.sourceLine !== "number") return null;
  return { sourceName: start.sourceName, sourceLine: start.sourceLine };
}

/** Resolve an hledger source path to an absolute path, confirming it lives inside the ledger dir. */
function resolveSourceFile(sourceName: string): string | null {
  const abs = isAbsolute(sourceName) ? sourceName : resolve(ACCOUNTANT24_HOME, sourceName);
  try {
    resolveSafePath(relative(LEDGER_DIR, abs), LEDGER_DIR);
  } catch {
    return null;
  }
  return abs;
}

// ── Editing ─────────────────────────────────────────────────────────

interface ApplyResult {
  newContent: string;
  count: number; // postings changed (account edit) or 1/0 (payee edit)
  warn: string[];
}

/** Rewrite every posting in `sourceAccount` within one matched transaction to `newAccount`. */
function applyAccountEdit(content: string, match: Match, sourceAccount: string, newAccount: string): ApplyResult {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const warn: string[] = [];
  let count = 0;

  // The header is at 0-based index startLine-1; the posting block follows it.
  for (let idx = match.startLine; idx < lines.length; idx++) {
    const line = lines[idx];
    if (line.trim() === "") break; // blank line ends the transaction
    if (!/^\s/.test(line)) break; // non-indented line ends the transaction
    if (line.replace(/^\s+/, "").startsWith(";")) continue; // comment line

    const rewritten = rewritePostingLine(line, sourceAccount, newAccount);
    if (rewritten) {
      lines[idx] = rewritten;
      count += 1;
    }
  }

  if (count === 0) {
    warn.push(
      `Skipped a matched transaction at ${match.file}:${match.startLine} — no "${sourceAccount}" posting found to move.`,
    );
  }

  return { newContent: lines.join(eol), count, warn };
}

/**
 * If the posting's account equals `sourceAccount`, return the line with the account
 * swapped to `newAccount`, keeping the amount at its original column. Null otherwise.
 */
function rewritePostingLine(line: string, sourceAccount: string, newAccount: string): string | null {
  const indent = line.match(/^\s+/)?.[0] ?? "";
  // Optional posting status marker (cleared '*' / pending '!') precedes the account.
  const status = line.slice(indent.length).match(/^[*!]\s+/)?.[0] ?? "";
  const body = line.slice(indent.length + status.length);

  const sepMatch = body.match(ACCOUNT_AMOUNT_SEP);
  let account = (sepMatch ? body.slice(0, sepMatch.index) : body).replace(/\s+$/, "");

  // Virtual '(acct)' / balanced-virtual '[acct]' postings — hledger reports the bare
  // account name, so unwrap for comparison and re-wrap with the same brackets on rewrite.
  let open = "";
  let close = "";
  if (account.startsWith("(") && account.endsWith(")")) {
    [open, close, account] = ["(", ")", account.slice(1, -1)];
  } else if (account.startsWith("[") && account.endsWith("]")) {
    [open, close, account] = ["[", "]", account.slice(1, -1)];
  }
  if (account !== sourceAccount) return null;

  const prefix = `${indent}${status}${open}${newAccount}${close}`;

  // Amountless balancing posting (no separator, or nothing after it): just swap the account.
  const rest = sepMatch ? body.slice((sepMatch.index ?? 0) + sepMatch[0].length) : "";
  if (rest.trim() === "") return prefix;

  // Preserve the amount's original column (character offset) so sibling alignment is kept.
  const originalRestCol = indent.length + status.length + (sepMatch?.index ?? 0) + (sepMatch?.[0].length ?? 0);
  const pad = Math.max(2, originalRestCol - prefix.length);
  return `${prefix}${" ".repeat(pad)}${rest}`;
}

/**
 * Rewrite the payee on the matched transaction's header line, preserving the rest.
 * Only rewrites when the header's current payee exactly equals `fromPayee`; a fuzzy
 * hledger query can match transactions with different payees, and this guard keeps the
 * edit from silently renaming an unrelated one.
 */
function applyPayeeEdit(content: string, match: Match, fromPayee: string, newPayee: string): ApplyResult {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const warn: string[] = [];
  const headerIdx = match.startLine - 1;
  const line = lines[headerIdx] ?? "";

  const parsed = parseHeaderPayee(line);
  if (parsed === null) {
    warn.push(`Could not parse transaction header at ${match.file}:${match.startLine}; left unchanged.`);
    return { newContent: content, count: 0, warn };
  }
  if (parsed.oldPayee !== fromPayee) {
    // A query match whose payee differs from `fromPayee` — leave it untouched.
    return { newContent: content, count: 0, warn };
  }
  if (parsed.oldPayee === newPayee) {
    return { newContent: content, count: 0, warn }; // already named that; no-op
  }

  lines[headerIdx] = renderHeaderPayee(parsed, newPayee);
  return { newContent: lines.join(eol), count: 1, warn };
}

interface ParsedHeader {
  prefix: string; // date, status, and code up to the start of the payee
  oldPayee: string; // the current payee (trailing spaces trimmed)
  gap: string; // spaces between the payee and the '|'/';' separator
  trailing: string; // "| note" / "; comment" / "" (empty when there is no separator)
}

/** Parse a transaction header into its payee and surrounding parts, or null if not a header. */
function parseHeaderPayee(line: string): ParsedHeader | null {
  const m = line.match(HEADER_RE);
  if (!m) return null;

  const prefix = m[1];
  const rest = m[2];

  // The payee runs up to the first '|' (description) or ';' (comment).
  let splitIdx = rest.length;
  for (const ch of ["|", ";"]) {
    const i = rest.indexOf(ch);
    if (i >= 0 && i < splitIdx) splitIdx = i;
  }

  const left = rest.slice(0, splitIdx);
  const oldPayee = left.replace(/\s+$/, "");
  const gap = left.slice(oldPayee.length); // spaces between payee and the separator
  const trailing = rest.slice(splitIdx); // "| note" / "; comment" / ""
  return { prefix, oldPayee, gap, trailing };
}

/** Render a parsed header with its payee swapped for `newPayee`. */
function renderHeaderPayee({ prefix, gap, trailing }: ParsedHeader, newPayee: string): string {
  if (trailing === "") return `${prefix}${newPayee}`;
  // Keep at least one space before '|'/';' so hledger still reads it as a separator, even
  // when the original payee ran right up against it (gap === "").
  const safeGap = gap === "" ? " " : gap;
  return `${prefix}${newPayee}${safeGap}${trailing}`;
}
