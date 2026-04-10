import { readFileSync, writeFileSync } from "node:fs";
import { assembleOutput, assembleWithoutTransactions, emitTransaction } from "./emit";
import {
  extractLeadingLines,
  findTransactionHeaders,
  parseContent,
  parsePostingLine,
  parseTransactions,
  sortTransactionsByDate,
} from "./parse";
import { computeTargetDigitsColumn } from "./transform";

export function formatJournalContent(content: string): string {
  if (content.length === 0) return content;

  const { lines, hadTrailingNewline } = parseContent(content);
  const headerIndices = findTransactionHeaders(lines);
  const leading = extractLeadingLines(lines, headerIndices[0] ?? lines.length);

  if (headerIndices.length === 0) {
    return assembleWithoutTransactions(leading, hadTrailingNewline, content);
  }

  const { transactions, trailingContent } = parseTransactions(lines, headerIndices);
  sortTransactionsByDate(transactions);

  const parsedBodies = transactions.map((tx) => tx.body.map(parsePostingLine));
  const targetDigitsColumn = computeTargetDigitsColumn(parsedBodies);
  const emittedTransactions = transactions.map((tx, i) => emitTransaction(tx, parsedBodies[i], targetDigitsColumn));

  return assembleOutput(leading, emittedTransactions, trailingContent, hadTrailingNewline);
}

// Returns null for a missing file so callers like `ledgerFormat` tolerate
// a file disappearing between enumeration and formatting.
export function formatJournalFile(absPath: string): string | null {
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
  const formatted = formatJournalContent(content);
  if (formatted !== content) {
    writeFileSync(absPath, formatted);
  }
  return formatted;
}
