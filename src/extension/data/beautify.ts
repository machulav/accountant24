import { readFileSync, writeFileSync } from "node:fs";

/**
 * Monthly-journal beautifier.
 *
 * What this touches:
 *   1. Order of transactions in the file: stable sort by date ascending.
 *   2. Whitespace between account and amount on posting lines that have
 *      an amount — aligned to a common column derived from the widest
 *      account in the whole file.
 *   3. Comment characters: any ';' that starts a comment is rewritten to
 *      '#'. Applies to leading top-level comments, metadata comment lines
 *      inside a transaction, and inline trailing comments on postings.
 *   4. Within-transaction line order:
 *        (a) Transaction header (unchanged, first line).
 *        (b) Tag lines: each on its own line, sorted alphabetically.
 *            Comma-separated tag lists like "# tag1:, tag2:" are split.
 *        (c) Header-area non-tag comments (rare), original relative order.
 *        (d) Postings with a negative amount.
 *        (e) Postings with a positive / unsigned amount.
 *        (f) Balancing postings (accounts with no amount) — last.
 *      Within each sign group, stable order. Non-tag comments attached
 *      to a specific posting move with that posting.
 *
 * Everything else — amount digits, currency symbols, account names,
 * headers, and original posting indent — is preserved.
 */

const MIN_GAP = 4;
const DATE_HEADER_REGEX = /^(\d{4})[-/.](\d{2})[-/.](\d{2})\b/;

interface Transaction {
  date: string;
  header: string;
  body: string[];
  // Non-indented content (e.g. top-level comments) that appeared between
  // the previous transaction's body and this transaction's header.
  // Stored here so it's not absorbed into the previous transaction's body.
  // Emitted immediately before this transaction's header. When transactions
  // are sorted, this content moves with its transaction.
  preContent: string[];
}

type ParsedBodyLine =
  | { kind: "metadata"; raw: string }
  | { kind: "balancing"; raw: string }
  | {
      kind: "posting";
      indent: string;
      account: string;
      amount: string;
      digitsPrefixLength: number;
      isNegative: boolean;
    }
  | { kind: "other"; raw: string };

interface PostingGroup {
  parsed: ParsedBodyLine; // posting | balancing | other
  trailing: string[]; // raw lines attached to this posting (non-tag comments / other)
}

export function beautifyJournalContent(content: string): string {
  if (content.length === 0) return content;

  const hadTrailingNewline = content.endsWith("\n");
  const normalized = content.replace(/\r\n/g, "\n");
  const splitLines = normalized.split("\n");
  // split("\n") on a string ending in "\n" produces a trailing "" — drop it
  const lines =
    hadTrailingNewline && splitLines.length > 0 && splitLines[splitLines.length - 1] === ""
      ? splitLines.slice(0, -1)
      : splitLines;

  const headerIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (DATE_HEADER_REGEX.test(lines[i])) headerIndices.push(i);
  }

  // Leading: everything before the first header (or the whole file if no headers),
  // with ';' comment chars rewritten to '#' and trailing blank lines stripped
  const leadingEnd = headerIndices.length > 0 ? headerIndices[0] : lines.length;
  const leading = lines.slice(0, leadingEnd).map(rewriteSemicolonCommentLine);
  while (leading.length > 0 && leading[leading.length - 1].trim() === "") {
    leading.pop();
  }

  // No transactions → emit leading (rewritten) only
  if (headerIndices.length === 0) {
    if (leading.length === 0) return content;
    let output = leading.join("\n");
    if (hadTrailingNewline) output += "\n";
    return output;
  }

  // Parse transactions.
  //
  // Non-indented, non-blank content that appears between a transaction's
  // body and the next transaction's header (e.g. a top-level comment
  // like "; Regular transactions") is NOT absorbed into the preceding
  // transaction's body. Instead it becomes the `preContent` of the
  // *following* transaction, so it stays as a top-level block between
  // transactions and moves with the following transaction under sort.
  //
  // Content that follows the LAST transaction (no next transaction to
  // attach to) is captured in `trailingContent`.
  const transactions: Transaction[] = [];
  let pendingPreContent: string[] = [];
  for (let k = 0; k < headerIndices.length; k++) {
    const start = headerIndices[k];
    const nextStart = k < headerIndices.length - 1 ? headerIndices[k + 1] : lines.length;
    const header = lines[start];

    const body: string[] = [];
    let i = start + 1;
    while (i < nextStart && (lines[i].startsWith(" ") || lines[i].startsWith("\t"))) {
      body.push(lines[i]);
      i++;
    }
    const looseAfterBody: string[] = [];
    while (i < nextStart) {
      if (lines[i].trim() !== "") {
        looseAfterBody.push(rewriteSemicolonCommentLine(lines[i]));
      }
      i++;
    }

    const m = header.match(DATE_HEADER_REGEX);
    const date = m ? `${m[1]}-${m[2]}-${m[3]}` : header.slice(0, 10);

    transactions.push({ date, header, body, preContent: pendingPreContent });
    pendingPreContent = looseAfterBody;
  }

  // After the last transaction: any trailing non-indented content with
  // nowhere to go becomes file-level trailing content.
  const trailingContent = pendingPreContent;

  // Stable sort by date ascending
  transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Classify body lines (after sort so parsedBodies indices align with sorted order)
  const parsedBodies: ParsedBodyLine[][] = transactions.map((tx) => tx.body.map(parsePostingLine));

  // Target digits column = max(indent + account + digitsPrefix) + MIN_GAP.
  // Aligning on the first DIGIT (not the first character of the amount token)
  // makes "-111.00 EUR" and "111.00 EUR" line up on the "1", with the negative
  // sign sticking out one column to the left.
  let targetDigitsColumn = 0;
  let hasAnyPostingWithAmount = false;
  for (const body of parsedBodies) {
    for (const line of body) {
      if (line.kind === "posting") {
        hasAnyPostingWithAmount = true;
        const candidate = line.indent.length + line.account.length + line.digitsPrefixLength;
        if (candidate > targetDigitsColumn) targetDigitsColumn = candidate;
      }
    }
  }
  if (hasAnyPostingWithAmount) targetDigitsColumn += MIN_GAP;

  // Emit: per-transaction reorder into canonical shape
  const emittedTransactions: string[] = [];
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const body = parsedBodies[i];
    const out: string[] = [];
    // preContent (top-level content that travels with this transaction)
    // is emitted before the header, separated by a blank line.
    if (tx.preContent.length > 0) {
      out.push(...tx.preContent);
      out.push("");
    }
    out.push(tx.header);

    // Walk body once, categorize into: tag lines (from anywhere),
    // header-area non-tag comments, and posting groups (with attached
    // trailing comments for each posting)
    const tagLines: string[] = [];
    const headerNonTag: string[] = [];
    const postingGroups: PostingGroup[] = [];
    let current: PostingGroup | null = null;

    const attachNonTag = (raw: string) => {
      if (current === null) headerNonTag.push(raw);
      else current.trailing.push(raw);
    };

    for (const line of body) {
      if (line.kind === "posting" || line.kind === "balancing") {
        current = { parsed: line, trailing: [] };
        postingGroups.push(current);
      } else if (line.kind === "metadata" && isTagCommentLine(line.raw)) {
        tagLines.push(line.raw);
      } else {
        attachNonTag(line.raw);
      }
    }

    // Header block: split + sort tag lines, then any header-area non-tag comments (original order)
    const splitSortedTags = tagLines
      .flatMap(splitTagCommentLine)
      .sort((a, b) => tagSortKey(a).localeCompare(tagSortKey(b)));
    out.push(...splitSortedTags);
    out.push(...headerNonTag);

    // Partition postings into three groups, stable within each
    const negatives: PostingGroup[] = [];
    const positives: PostingGroup[] = [];
    const balancings: PostingGroup[] = [];
    for (const g of postingGroups) {
      if (g.parsed.kind === "posting") {
        if (g.parsed.isNegative) negatives.push(g);
        else positives.push(g);
      } else {
        balancings.push(g);
      }
    }

    // Emit each posting (aligned) with its attached trailing comments
    for (const groups of [negatives, positives, balancings]) {
      for (const g of groups) {
        if (g.parsed.kind === "posting") {
          const padding =
            targetDigitsColumn - g.parsed.indent.length - g.parsed.account.length - g.parsed.digitsPrefixLength;
          out.push(`${g.parsed.indent}${g.parsed.account}${" ".repeat(padding)}${g.parsed.amount}`);
        } else {
          out.push(g.parsed.raw);
        }
        out.push(...g.trailing);
      }
    }

    emittedTransactions.push(out.join("\n"));
  }

  // Assemble: leading + sorted txs separated by a single blank line + trailing content
  let output = "";
  if (leading.length > 0) {
    output += leading.join("\n");
    output += "\n\n";
  }
  output += emittedTransactions.join("\n\n");
  if (trailingContent.length > 0) {
    output += "\n\n";
    output += trailingContent.join("\n");
  }
  if (hadTrailingNewline) output += "\n";

  return output;
}

function parsePostingLine(rawLine: string): ParsedBodyLine {
  const indentMatch = rawLine.match(/^([\t ]*)/);
  const indent = indentMatch ? indentMatch[1] : "";
  if (indent.length === 0) return { kind: "other", raw: rewriteSemicolonCommentLine(rawLine) };
  const rest = rawLine.slice(indent.length);
  if (rest[0] === ";" || rest[0] === "#") return { kind: "metadata", raw: rewriteSemicolonCommentLine(rawLine) };
  // Split on first run of 2+ spaces or 1+ tabs (hledger account/amount separator)
  const m = rest.match(/^(.+?)(?: {2,}|\t+)(.+)$/);
  if (!m) return { kind: "balancing", raw: rawLine };
  // Rewrite inline trailing comment marker "<space>;" → "<space>#". Anchored
  // to whitespace-preceded ';' so any non-comment ';' in the amount (unlikely
  // but possible) is left alone.
  const amount = m[2].replace(/\s+$/, "").replace(/(\s+);/, "$1#");
  const digitsPrefixLength = getDigitsPrefixLength(amount);
  // Negative iff the amount has a '-' somewhere before the first digit
  // (covers "-45", "$-45", "EUR -45"). "+45" and unsigned are positive.
  const isNegative = amount.slice(0, digitsPrefixLength).includes("-");
  return {
    kind: "posting",
    indent,
    account: m[1],
    amount,
    digitsPrefixLength,
    isNegative,
  };
}

function rewriteSemicolonCommentLine(line: string): string {
  // A line whose first non-whitespace character is ';' is a comment line —
  // rewrite just that leading ';' to '#'. Non-comment lines are unchanged.
  return line.replace(/^(\s*);/, "$1#");
}

// A tag-list comment line is a "# ..." (or ";") line whose comma-separated
// parts ALL contain ':'. Examples: "# tag1:", "# tag1:, tag2:",
// "# key: value", "# tag1:, key: value". Counter-examples: "# just a note",
// "# notes, one, two".
function isTagCommentLine(rawLine: string): boolean {
  const match = rawLine.match(/^(\s*)[#;]\s*(.*)$/);
  if (!match) return false;
  const content = match[2];
  const parts = content.split(/,\s*/).filter((p) => p.length > 0);
  return parts.length > 0 && parts.every((p) => p.includes(":"));
}

// Split a tag-list comment line into individual tag lines.
// "    # tag1:, tag2: value" → ["    # tag1:", "    # tag2: value"]
// Non-tag lines are returned as-is (single-element array).
function splitTagCommentLine(rawLine: string): string[] {
  const match = rawLine.match(/^(\s*)[#;]\s*(.*)$/);
  if (!match) return [rawLine];
  const [, indent, content] = match;
  const parts = content.split(/,\s*/).filter((p) => p.length > 0);
  if (parts.length === 0 || !parts.every((p) => p.includes(":"))) return [rawLine];
  return parts.map((p) => `${indent}# ${p.trim()}`);
}

// Sort key for a tag line: the content after the '#' prefix. By the time
// this runs, all comment lines have been rewritten to use '#'.
function tagSortKey(rawLine: string): string {
  const match = rawLine.match(/^\s*#\s*(.*)$/);
  return match ? match[1] : rawLine;
}

function getDigitsPrefixLength(amount: string): number {
  // Number of characters before the first digit in the amount token.
  // For "-111.00 EUR" → 1 (the "-"); for "111.00 EUR" → 0; for "EUR -111.00" → 5;
  // for "$100" → 1; for "$-100" → 2; for a no-digit amount → full length.
  const idx = amount.search(/\d/);
  return idx === -1 ? amount.length : idx;
}

// Read `absPath`, beautify, write back if changed, and return the final
// content. Returns null if the file does not exist (so callers like
// `validateLedger` can tolerate a file disappearing between enumeration
// and beautification).
export function beautifyJournalFile(absPath: string): string | null {
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
  const beautified = beautifyJournalContent(content);
  if (beautified !== content) {
    writeFileSync(absPath, beautified);
  }
  return beautified;
}
