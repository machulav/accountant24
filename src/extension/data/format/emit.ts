import { categorizeBody, partitionPostings, splitTagCommentLine, tagSortKey } from "./transform";
import type { ParsedBodyLine, Transaction } from "./types";

export function emitTransaction(tx: Transaction, parsedBody: ParsedBodyLine[], targetColumn: number): string {
  const out: string[] = [];

  // preContent travels with this transaction, emitted before the header
  // and separated by a blank line.
  if (tx.preContent.length > 0) {
    out.push(...tx.preContent);
    out.push("");
  }
  out.push(tx.header);

  const { tagLines, headerNonTag, postingGroups } = categorizeBody(parsedBody);
  out.push(...formatTagBlock(tagLines));
  out.push(...headerNonTag);

  const { negatives, positives, balancings } = partitionPostings(postingGroups);
  for (const groups of [negatives, positives, balancings]) {
    for (const g of groups) {
      if (g.parsed.kind === "posting") {
        out.push(formatPostingLine(g.parsed, targetColumn));
      } else {
        out.push(g.parsed.raw);
      }
      out.push(...g.trailing);
    }
  }

  return out.join("\n");
}

export function assembleOutput(
  leading: string[],
  emittedTransactions: string[],
  trailingContent: string[],
  hadTrailingNewline: boolean,
): string {
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

export function assembleWithoutTransactions(
  leading: string[],
  hadTrailingNewline: boolean,
  originalContent: string,
): string {
  if (leading.length === 0) return originalContent;
  let output = leading.join("\n");
  if (hadTrailingNewline) output += "\n";
  return output;
}

// ── Private helpers ─────────────────────────────────────────────────

function formatTagBlock(tagLines: string[]): string[] {
  return tagLines.flatMap(splitTagCommentLine).sort((a, b) => tagSortKey(a).localeCompare(tagSortKey(b)));
}

function formatPostingLine(posting: Extract<ParsedBodyLine, { kind: "posting" }>, targetColumn: number): string {
  const padding = targetColumn - posting.indent.length - posting.account.length - posting.digitsPrefixLength;
  return `${posting.indent}${posting.account}${" ".repeat(padding)}${posting.amount}`;
}
