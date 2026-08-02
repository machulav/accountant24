import { JournalParseError } from "./errors";
import type { Block, Posting, PriceDirective, Tag, Transaction } from "./types";

// A number (no thousands separators) followed by a commodity: either quoted or
// a run of letters/currency signs. Anything else is outside the app-written
// subset and must fail typed — a best-effort parse that guesses would be the
// one way this library could corrupt a journal.
const AMOUNT_RE = /^(-?\d+(?:\.\d+)?)\s+("[^"]*"|[\p{L}\p{Sc}]+)$/u;

// hledger's tag rule, verified against `hledger print -O json`: anywhere in a
// comment, a word immediately followed by ":" starts a tag; its value runs to
// the next comma or the end of the line (swallowing any inner colons).
const TAG_SCAN_RE = /(?:^|[\s,])([^\s:,;]+):([^,]*)/g;

/**
 * Parse a transaction block into objects, strictly. Every verbatim field
 * (description, comments, amount texts) is preserved so a canonical re-render
 * can never change what hledger sees — only layout. Anything outside the
 * supported subset throws a JournalParseError pointing at the offending line;
 * callers must then leave the block's text untouched.
 */
export function parseTransactionBlock(block: Block): Transaction {
  if (block.kind !== "transaction") {
    throw new JournalParseError(`expected a transaction block, got "${block.kind}"`, block.startLine);
  }
  if (!block.date) {
    throw new JournalParseError("the transaction date is not a valid calendar date", block.startLine);
  }

  const lines = blockLines(block);
  const { status, code, description, headerComment } = parseHeader(lines[0], block.startLine);

  const commentLines: string[] = [];
  const tags: Tag[] = headerComment ? deriveTags(headerComment) : [];
  const postings: Posting[] = [];

  for (let idx = 1; idx < lines.length; idx++) {
    const lineNo = block.startLine + idx;
    const text = lines[idx].trim();
    if (text.startsWith(";")) {
      // hledger attaches comment lines below a posting to that posting; re-rendering
      // them at transaction level would silently move their tags. Refuse instead.
      if (postings.length > 0) {
        throw new JournalParseError("comment lines between or after postings are not supported", lineNo);
      }
      commentLines.push(text);
      tags.push(...deriveTags(text));
      continue;
    }
    postings.push(parsePosting(text, lineNo));
  }

  const pipe = description.indexOf("|");
  const payee = (pipe >= 0 ? description.slice(0, pipe) : description).trim();
  const note = pipe >= 0 ? description.slice(pipe + 1).trim() : undefined;

  return { date: block.date, status, code, description, payee, note, headerComment, commentLines, tags, postings };
}

/** Parse a P directive block. The written amount is preserved verbatim. */
export function parsePriceBlock(block: Block): PriceDirective {
  if (block.kind !== "price") {
    throw new JournalParseError(`expected a price block, got "${block.kind}"`, block.startLine);
  }
  if (!block.date) {
    throw new JournalParseError("the price date is not a valid calendar date", block.startLine);
  }
  const lines = blockLines(block);
  if (lines.length > 1) {
    throw new JournalParseError("unexpected indented lines under a P directive", block.startLine + 1);
  }
  const match = lines[0]
    .trimEnd()
    .match(/^P\s+\S+\s+("[^"]*"|[\p{L}\p{Sc}]+)\s+(-?\d+(?:\.\d+)?)\s+("[^"]*"|[\p{L}\p{Sc}]+)$/u);
  if (!match) {
    throw new JournalParseError(`unsupported P directive format: "${lines[0].trim()}"`, block.startLine);
  }
  return {
    date: block.date,
    commodity: unquote(match[1], block.startLine),
    amount: Number(match[2]),
    amountText: match[2],
    currency: unquote(match[3], block.startLine),
  };
}

// ── Internals ───────────────────────────────────────────────────────

/** The block's physical lines without terminators. Blocks never contain blank
 *  lines (the segmenter splits on them), so the only empty artifact is the one
 *  after a trailing newline. */
function blockLines(block: Block): string[] {
  const lines = block.raw.split("\n").map((line) => line.replace(/\r$/, ""));
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Tags of one comment (verbatim text starting with ";"), per hledger's rule. */
function deriveTags(comment: string): Tag[] {
  const body = comment.replace(/^;\s*/, "");
  const tags: Tag[] = [];
  for (const match of body.matchAll(TAG_SCAN_RE)) {
    const value = match[2].trim();
    tags.push(value === "" ? { name: match[1] } : { name: match[1], value });
  }
  return tags;
}

function parseHeader(
  header: string,
  lineNo: number,
): { status?: "*" | "!"; code?: string; description: string; headerComment?: string } {
  const clean = header.replace(/^\uFEFF/, "");
  const date = clean.match(/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/);
  let rest = clean.trimEnd().slice(date ? date[0].length : 0);
  if (rest.startsWith("=")) {
    throw new JournalParseError("secondary dates (DATE=DATE2) are not supported", lineNo);
  }
  rest = rest.trimStart();

  let status: "*" | "!" | undefined;
  if (/^[*!](\s|$)/.test(rest)) {
    status = rest[0] as "*" | "!";
    rest = rest.slice(1).trimStart();
  }

  let code: string | undefined;
  const codeMatch = rest.match(/^\(([^)]*)\)\s*/);
  if (codeMatch) {
    code = codeMatch[1];
    rest = rest.slice(codeMatch[0].length);
  }

  let headerComment: string | undefined;
  const commentIdx = rest.indexOf(";");
  if (commentIdx >= 0) {
    headerComment = rest.slice(commentIdx).trimEnd();
    rest = rest.slice(0, commentIdx);
  }

  return { status, code, description: rest.trim(), headerComment };
}

function parsePosting(text: string, lineNo: number): Posting {
  if (/^[*!]\s/.test(text)) {
    throw new JournalParseError("posting status markers are not supported", lineNo);
  }
  if (text.startsWith("[")) {
    throw new JournalParseError("balanced virtual postings ([...]) are not supported", lineNo);
  }

  // hledger separates a posting's account from its amount with 2+ spaces or a tab.
  const sep = text.match(/ {2,}|\t+/);
  let accountText = sep ? text.slice(0, sep.index) : text;
  const rest = sep ? text.slice((sep.index as number) + sep[0].length).trim() : undefined;

  if (accountText.includes(";")) {
    throw new JournalParseError("a posting comment must be separated from the account by 2+ spaces", lineNo);
  }

  let virtual = false;
  if (accountText.startsWith("(")) {
    if (!accountText.endsWith(")")) {
      throw new JournalParseError(`unbalanced parentheses in account "${accountText}"`, lineNo);
    }
    virtual = true;
    accountText = accountText.slice(1, -1);
  }
  if (accountText === "") {
    throw new JournalParseError("a posting is missing its account", lineNo);
  }

  const posting: Posting = { account: accountText };
  if (virtual) posting.virtual = true;
  if (rest === undefined || rest === "") return posting;

  if (rest.startsWith(";")) {
    posting.comment = rest;
    return posting;
  }
  if (rest.startsWith("=")) {
    throw new JournalParseError("balance assignments (account = amount) are not supported", lineNo);
  }

  let amountPart = rest;
  const commentIdx = amountPart.indexOf(";");
  if (commentIdx >= 0) {
    posting.comment = amountPart.slice(commentIdx);
    amountPart = amountPart.slice(0, commentIdx).trimEnd();
  }
  if (amountPart.includes("@")) {
    throw new JournalParseError("cost notation (@) is not supported", lineNo);
  }

  const eq = amountPart.indexOf("=");
  let assertionPart: string | undefined;
  if (eq >= 0) {
    if (amountPart[eq + 1] === "=" || amountPart[eq + 1] === "*") {
      throw new JournalParseError("only simple balance assertions (=) are supported", lineNo);
    }
    assertionPart = amountPart.slice(eq + 1).trim();
    amountPart = amountPart.slice(0, eq).trimEnd();
  }

  const amount = parseAmount(amountPart, lineNo);
  posting.amount = amount.value;
  posting.amountText = amount.text;
  posting.currency = amount.currency;
  if (assertionPart !== undefined) {
    const assertion = parseAmount(assertionPart, lineNo);
    posting.assertion = { amount: assertion.value, amountText: assertion.text, currency: assertion.currency };
  }
  return posting;
}

function parseAmount(text: string, lineNo: number): { value: number; text: string; currency: string } {
  const match = text.match(AMOUNT_RE);
  if (!match) {
    throw new JournalParseError(`unsupported amount format: "${text}"`, lineNo);
  }
  return { value: Number(match[1]), text: match[1], currency: unquote(match[2], lineNo) };
}

function unquote(commodity: string, lineNo: number): string {
  if (!commodity.startsWith('"')) return commodity;
  const inner = commodity.slice(1, -1);
  if (inner === "") {
    throw new JournalParseError("an empty quoted commodity is not supported", lineNo);
  }
  return inner;
}
