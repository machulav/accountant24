import { normalizeDate } from "./dates";
import type { Block, BlockKind } from "./types";

// A transaction header starts with a date; the separator must be consistent
// (backreference) and the token must end before whitespace, "=", or EOL.
const DATE_START_RE = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?=[\s=]|$)/;
const DATE_TOKEN_RE = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/;

type LineClass = "blank" | "indented" | "comment" | "comment-block" | "date" | "price" | "directive";

/**
 * Split journal text into an ordered list of blocks. Purely structural: a block
 * is a column-0 line plus its indented continuation lines; nothing inside a
 * block is interpreted beyond the leading date token. The invariant
 * `segment(text).map(b => b.raw).join("") === text` holds for any input —
 * segmentation never loses a byte.
 */
export function segment(text: string): Block[] {
  const lines = text.match(/[^\n]*\n|[^\n]+/g) ?? [];
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const start = i;
    const cls = classify(lines[i]);
    let kind: BlockKind;
    let date: string | undefined;

    if (cls === "blank") {
      while (i < lines.length && classify(lines[i]) === "blank") i++;
      kind = "blank";
    } else if (cls === "comment") {
      i++;
      while (i < lines.length && ["comment", "indented"].includes(classify(lines[i]))) i++;
      kind = "comment";
    } else if (cls === "indented") {
      // Indented lines with no preceding column-0 opener (e.g. at file start or
      // after a blank line) are invalid hledger; preserve them verbatim.
      while (i < lines.length && classify(lines[i]) === "indented") i++;
      kind = "other";
    } else if (cls === "comment-block") {
      i++;
      while (i < lines.length && !/^end comment(\s|$)/.test(content(lines[i]))) i++;
      if (i < lines.length) i++;
      kind = "other";
    } else {
      i++;
      while (i < lines.length && classify(lines[i]) === "indented") i++;
      if (cls === "date") {
        kind = "transaction";
        const match = content(lines[start]).match(DATE_START_RE);
        date = match ? normalizeDate(match[1], match[3], match[4]) : undefined;
      } else if (cls === "price") {
        kind = "price";
        date = priceDate(content(lines[start]));
      } else {
        kind = "directive";
      }
    }

    blocks.push({ kind, raw: lines.slice(start, i).join(""), startLine: start + 1, endLine: i, date });
  }

  return blocks;
}

/** The line for classification: no terminator, and no UTF-8 BOM — hledger
 *  accepts a BOM-prefixed journal, so a BOM must not hide a transaction.
 *  The BOM stays in `raw`; only classification looks through it. */
function content(line: string): string {
  return line.replace(/^\uFEFF/, "").replace(/\r?\n$/, "");
}

function classify(line: string): LineClass {
  const c = content(line);
  if (/^\s*$/.test(c)) return "blank";
  if (/^[ \t]/.test(c)) return "indented";
  if (/^[;#*]/.test(c)) return "comment";
  if (/^comment(\s|$)/.test(c)) return "comment-block";
  if (DATE_START_RE.test(c)) return "date";
  if (/^P\s/.test(c)) return "price";
  return "directive";
}

function priceDate(line: string): string | undefined {
  const token = line.split(/\s+/)[1];
  const match = token?.match(DATE_TOKEN_RE);
  return match ? normalizeDate(match[1], match[3], match[4]) : undefined;
}
