import {
  type CategorizedBody,
  MIN_AMOUNT_COLUMN,
  MIN_GAP,
  type ParsedBodyLine,
  type PartitionedPostings,
  type PostingGroup,
} from "./types";

export function categorizeBody(parsedBody: ParsedBodyLine[]): CategorizedBody {
  const tagLines: string[] = [];
  const headerNonTag: string[] = [];
  const postingGroups: PostingGroup[] = [];
  let current: PostingGroup | null = null;

  const attachNonTag = (raw: string) => {
    if (current === null) headerNonTag.push(raw);
    else current.trailing.push(raw);
  };

  for (const line of parsedBody) {
    if (line.kind === "posting" || line.kind === "balancing") {
      current = { parsed: line, trailing: [] };
      postingGroups.push(current);
    } else if (line.kind === "metadata" && isTagCommentLine(line.raw)) {
      tagLines.push(line.raw);
    } else {
      attachNonTag(line.raw);
    }
  }

  return { tagLines, headerNonTag, postingGroups };
}

export function partitionPostings(postingGroups: PostingGroup[]): PartitionedPostings {
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
  return { negatives, positives, balancings };
}

// Column where the first DIGIT of every amount should land. Aligning on
// the digit (not the amount-token start) lets negative signs stick out one
// column to the left, so "-111" and "111" still align on "1".
export function computeTargetDigitsColumn(parsedBodies: ParsedBodyLine[][]): number {
  let widestEnd = 0;
  let hasAny = false;
  for (const body of parsedBodies) {
    for (const line of body) {
      if (line.kind === "posting") {
        hasAny = true;
        const candidate = line.indent.length + line.account.length + line.digitsPrefixLength;
        if (candidate > widestEnd) widestEnd = candidate;
      }
    }
  }
  if (!hasAny) return 0;
  return Math.max(MIN_AMOUNT_COLUMN, widestEnd + MIN_GAP);
}

// ── Tag comment helpers ─────────────────────────────────────────────

// A tag-list comment line is a ";" line whose comma-separated parts all
// contain ':'. Examples: "; tag1:", "; tag1:, tag2:", "; key: value".
// Counter-examples: "; just a note", "; notes, one, two".
export function isTagCommentLine(rawLine: string): boolean {
  const match = rawLine.match(/^\s*;\s*(.*)$/);
  if (!match) return false;
  const parts = match[1].split(/,\s*/).filter((p) => p.length > 0);
  return parts.length > 0 && parts.every((p) => p.includes(":"));
}

// Split a tag-list comment line into individual tag lines.
// "    ; tag1:, tag2: value" → ["    ; tag1:", "    ; tag2: value"]
// Non-tag lines are returned as-is (single-element array).
export function splitTagCommentLine(rawLine: string): string[] {
  const match = rawLine.match(/^(\s*);\s*(.*)$/);
  if (!match) return [rawLine];
  const [, indent, content] = match;
  const parts = content.split(/,\s*/).filter((p) => p.length > 0);
  if (parts.length === 0 || !parts.every((p) => p.includes(":"))) return [rawLine];
  return parts.map((p) => `${indent}; ${p.trim()}`);
}

// Sort key for a tag line: the content after the ';' prefix.
export function tagSortKey(rawLine: string): string {
  const match = rawLine.match(/^\s*;\s*(.*)$/);
  return match ? match[1] : rawLine;
}
