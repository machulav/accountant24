import { DATE_HEADER_REGEX, type ParsedBodyLine, type ParsedContent, type Transaction } from "./types";

export function parseContent(content: string): ParsedContent {
  const hadTrailingNewline = content.endsWith("\n");
  const normalized = content.replace(/\r\n/g, "\n");
  const split = normalized.split("\n");
  // split("\n") on a string ending in "\n" produces a trailing "" — drop it
  const lines = hadTrailingNewline && split.length > 0 && split[split.length - 1] === "" ? split.slice(0, -1) : split;
  return { lines, hadTrailingNewline };
}

export function findTransactionHeaders(lines: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (DATE_HEADER_REGEX.test(lines[i])) out.push(i);
  }
  return out;
}

export function extractLeadingLines(lines: string[], until: number): string[] {
  const out = lines.slice(0, until);
  while (out.length > 0 && out[out.length - 1].trim() === "") {
    out.pop();
  }
  return out;
}

export function parseTransactions(
  lines: string[],
  headerIndices: number[],
): { transactions: Transaction[]; trailingContent: string[] } {
  const transactions: Transaction[] = [];
  let pendingPreContent: string[] = [];

  for (let k = 0; k < headerIndices.length; k++) {
    const start = headerIndices[k];
    const nextStart = k < headerIndices.length - 1 ? headerIndices[k + 1] : lines.length;
    const header = lines[start];

    const body: string[] = [];
    let i = start + 1;
    while (i < nextStart && isIndentedLine(lines[i])) {
      body.push(lines[i]);
      i++;
    }

    // Non-indented, non-blank content before the next header becomes the
    // preContent of the NEXT transaction (so it stays between transactions
    // instead of being absorbed into the preceding transaction's body).
    const looseAfterBody: string[] = [];
    while (i < nextStart) {
      if (lines[i].trim() !== "") looseAfterBody.push(lines[i]);
      i++;
    }

    transactions.push({
      date: extractDateFromHeader(header),
      header,
      body,
      preContent: pendingPreContent,
    });
    pendingPreContent = looseAfterBody;
  }

  return { transactions, trailingContent: pendingPreContent };
}

export function parsePostingLine(rawLine: string): ParsedBodyLine {
  const indentMatch = rawLine.match(/^([\t ]*)/);
  const indent = indentMatch ? indentMatch[1] : "";
  if (indent.length === 0) return { kind: "other", raw: rawLine };
  const rest = rawLine.slice(indent.length);
  if (rest[0] === ";" || rest[0] === "#") return { kind: "metadata", raw: rawLine };
  // hledger account/amount separator: 2+ spaces or 1+ tabs
  const m = rest.match(/^(.+?)(?: {2,}|\t+)(.+)$/);
  if (!m) return { kind: "balancing", raw: rawLine };
  const amount = m[2].replace(/\s+$/, "");
  const digitsPrefixLength = getDigitsPrefixLength(amount);
  // Negative iff the amount has a '-' somewhere before the first digit.
  // Covers "-45", "$-45", "EUR -45". "+45" and unsigned are positive.
  const isNegative = amount.slice(0, digitsPrefixLength).includes("-");
  return { kind: "posting", indent, account: m[1], amount, digitsPrefixLength, isNegative };
}

export function sortTransactionsByDate(transactions: Transaction[]): void {
  transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ── Private helpers ─────────────────────────────────────────────────

function isIndentedLine(line: string): boolean {
  return line.startsWith(" ") || line.startsWith("\t");
}

function extractDateFromHeader(header: string): string {
  const m = header.match(DATE_HEADER_REGEX);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : header.slice(0, 10);
}

function getDigitsPrefixLength(amount: string): number {
  // Number of characters before the first digit in the amount token.
  // "-111.00 EUR" → 1, "111.00 EUR" → 0, "EUR -111.00" → 5,
  // "$100" → 1, "$-100" → 2, no-digit amount → full length.
  const idx = amount.search(/\d/);
  return idx === -1 ? amount.length : idx;
}
