import { describe, expect, test } from "bun:test";
import {
  categorizeBody,
  computeTargetDigitsColumn,
  isTagCommentLine,
  partitionPostings,
  splitTagCommentLine,
  tagSortKey,
} from "../transform";
import type { ParsedBodyLine, PostingGroup } from "../types";

// ── Test helpers for constructing ParsedBodyLine values ─────────────

const posting = (
  indent: string,
  account: string,
  amount: string,
  digitsPrefixLength: number,
  isNegative: boolean,
): ParsedBodyLine => ({ kind: "posting", indent, account, amount, digitsPrefixLength, isNegative });

const balancing = (raw: string): ParsedBodyLine => ({ kind: "balancing", raw });
const metadata = (raw: string): ParsedBodyLine => ({ kind: "metadata", raw });
const other = (raw: string): ParsedBodyLine => ({ kind: "other", raw });

const postingGroup = (parsed: ParsedBodyLine, trailing: string[] = []): PostingGroup => ({ parsed, trailing });

// ── isTagCommentLine() ─────────────────────────────────────────────

describe("isTagCommentLine()", () => {
  test("should accept a single-tag line", () => {
    expect(isTagCommentLine("    ; tag1:")).toBe(true);
  });

  test("should accept a comma-separated tag list", () => {
    expect(isTagCommentLine("    ; tag1:, tag2:")).toBe(true);
  });

  test("should accept a key:value metadata line", () => {
    expect(isTagCommentLine("    ; source: manual")).toBe(true);
  });

  test("should accept a mixed list where every part has a colon", () => {
    expect(isTagCommentLine("    ; tag1:, key: value")).toBe(true);
  });

  test("should reject a free-form comment (no colon)", () => {
    expect(isTagCommentLine("    ; just a note")).toBe(false);
  });

  test("should reject a comma-separated list where one part lacks a colon", () => {
    expect(isTagCommentLine("    ; tag1:, no colon")).toBe(false);
  });

  test("should reject a line that does not start with ';'", () => {
    expect(isTagCommentLine("    not a comment")).toBe(false);
  });

  test("should reject an empty-content comment", () => {
    expect(isTagCommentLine("    ;")).toBe(false);
  });

  test("should work without any indent", () => {
    expect(isTagCommentLine("; tag1:")).toBe(true);
  });
});

// ── splitTagCommentLine() ──────────────────────────────────────────

describe("splitTagCommentLine()", () => {
  test("should split a comma-separated tag list into individual lines", () => {
    expect(splitTagCommentLine("    ; tag1:, tag2:, tag3:")).toEqual(["    ; tag1:", "    ; tag2:", "    ; tag3:"]);
  });

  test("should preserve the original indent on each emitted line", () => {
    expect(splitTagCommentLine("      ; a:, b:")).toEqual(["      ; a:", "      ; b:"]);
  });

  test("should preserve the 'value' part for key:value items", () => {
    expect(splitTagCommentLine("    ; source: manual, weekly:")).toEqual(["    ; source: manual", "    ; weekly:"]);
  });

  test("should return the line unchanged when it is not a tag list", () => {
    expect(splitTagCommentLine("    ; just a note")).toEqual(["    ; just a note"]);
  });

  test("should return the line unchanged when one comma-separated part lacks ':'", () => {
    expect(splitTagCommentLine("    ; tag1:, no colon")).toEqual(["    ; tag1:, no colon"]);
  });

  test("should return a single-element array for a single-tag input (idempotent)", () => {
    expect(splitTagCommentLine("    ; tag1:")).toEqual(["    ; tag1:"]);
  });

  test("should return the raw line when it is not a comment at all", () => {
    expect(splitTagCommentLine("    posting line")).toEqual(["    posting line"]);
  });
});

// ── tagSortKey() ───────────────────────────────────────────────────

describe("tagSortKey()", () => {
  test("should return content after '; '", () => {
    expect(tagSortKey("    ; weekly:")).toBe("weekly:");
  });

  test("should handle an unindented comment", () => {
    expect(tagSortKey("; tag:")).toBe("tag:");
  });

  test("should return the raw line when no ';' matches", () => {
    expect(tagSortKey("    posting")).toBe("    posting");
  });

  test("should enable alphabetical sort of mixed tags", () => {
    const tags = ["    ; weekly:", "    ; groceries:", "    ; source: manual"];
    tags.sort((a, b) => tagSortKey(a).localeCompare(tagSortKey(b)));
    expect(tags).toEqual(["    ; groceries:", "    ; source: manual", "    ; weekly:"]);
  });
});

// ── categorizeBody() ───────────────────────────────────────────────

describe("categorizeBody()", () => {
  test("should collect tag lines as tagLines", () => {
    const body: ParsedBodyLine[] = [metadata("    ; tag1:"), metadata("    ; tag2:")];
    const result = categorizeBody(body);
    expect(result.tagLines).toEqual(["    ; tag1:", "    ; tag2:"]);
    expect(result.headerNonTag).toEqual([]);
    expect(result.postingGroups).toEqual([]);
  });

  test("should put non-tag metadata before any posting in headerNonTag", () => {
    const body: ParsedBodyLine[] = [metadata("    ; just a note")];
    const result = categorizeBody(body);
    expect(result.headerNonTag).toEqual(["    ; just a note"]);
    expect(result.tagLines).toEqual([]);
  });

  test("should attach non-tag metadata after a posting to that posting's trailing", () => {
    const p = posting("    ", "Expenses:Food", "45.00 USD", 0, false);
    const body: ParsedBodyLine[] = [p, metadata("    ; note for food")];
    const result = categorizeBody(body);
    expect(result.postingGroups).toHaveLength(1);
    expect(result.postingGroups[0].parsed).toBe(p);
    expect(result.postingGroups[0].trailing).toEqual(["    ; note for food"]);
  });

  test("should build a posting group for each posting and balancing line", () => {
    const p1 = posting("    ", "Expenses:Food", "45.00 USD", 0, false);
    const b1 = balancing("    Assets:Checking");
    const body: ParsedBodyLine[] = [p1, b1];
    const result = categorizeBody(body);
    expect(result.postingGroups.map((g) => g.parsed)).toEqual([p1, b1]);
  });

  test("should attach 'other' kind lines to the current posting (or headerNonTag before first posting)", () => {
    const p = posting("    ", "Expenses:Food", "45.00 USD", 0, false);
    const body: ParsedBodyLine[] = [other("stray line"), p, other("another stray")];
    const result = categorizeBody(body);
    expect(result.headerNonTag).toEqual(["stray line"]);
    expect(result.postingGroups[0].trailing).toEqual(["another stray"]);
  });

  test("should pull tag metadata from anywhere in the body into tagLines", () => {
    const p = posting("    ", "Expenses:Food", "45.00 USD", 0, false);
    const body: ParsedBodyLine[] = [p, metadata("    ; mid-tx: tag")];
    const result = categorizeBody(body);
    expect(result.tagLines).toEqual(["    ; mid-tx: tag"]);
    // The tag is NOT attached to the posting's trailing
    expect(result.postingGroups[0].trailing).toEqual([]);
  });
});

// ── partitionPostings() ────────────────────────────────────────────

describe("partitionPostings()", () => {
  test("should put postings with isNegative=true into negatives", () => {
    const g = postingGroup(posting("    ", "Assets:Checking", "-45.00 USD", 1, true));
    const result = partitionPostings([g]);
    expect(result.negatives).toEqual([g]);
    expect(result.positives).toEqual([]);
    expect(result.balancings).toEqual([]);
  });

  test("should put postings with isNegative=false into positives", () => {
    const g = postingGroup(posting("    ", "Expenses:Food", "45.00 USD", 0, false));
    const result = partitionPostings([g]);
    expect(result.positives).toEqual([g]);
    expect(result.negatives).toEqual([]);
  });

  test("should put balancing postings into balancings", () => {
    const g = postingGroup(balancing("    Assets:Checking"));
    const result = partitionPostings([g]);
    expect(result.balancings).toEqual([g]);
    expect(result.positives).toEqual([]);
    expect(result.negatives).toEqual([]);
  });

  test("should put 'other' kind groups into balancings as a fallthrough", () => {
    const g = postingGroup(other("weird"));
    const result = partitionPostings([g]);
    expect(result.balancings).toEqual([g]);
  });

  test("should preserve stable order within each bucket", () => {
    const n1 = postingGroup(posting("    ", "A", "-1 USD", 1, true));
    const n2 = postingGroup(posting("    ", "B", "-2 USD", 1, true));
    const p1 = postingGroup(posting("    ", "C", "3 USD", 0, false));
    const p2 = postingGroup(posting("    ", "D", "4 USD", 0, false));
    const result = partitionPostings([n1, p1, n2, p2]);
    expect(result.negatives).toEqual([n1, n2]);
    expect(result.positives).toEqual([p1, p2]);
  });
});

// ── computeTargetDigitsColumn() ────────────────────────────────────

describe("computeTargetDigitsColumn()", () => {
  test("should return 0 when there are no postings with amounts", () => {
    const body: ParsedBodyLine[][] = [[balancing("    Assets:Checking"), balancing("    Assets:Savings")]];
    expect(computeTargetDigitsColumn(body)).toBe(0);
  });

  test("should clamp up to MIN_AMOUNT_COLUMN (70) for a short single posting", () => {
    // indent 4 + account "Expenses:Food" (13) + prefix 0 = 17, + MIN_GAP(4) = 21
    // 21 < 70, so the target is clamped to 70.
    const body: ParsedBodyLine[][] = [[posting("    ", "Expenses:Food", "45.00 USD", 0, false)]];
    expect(computeTargetDigitsColumn(body)).toBe(70);
  });

  test("should clamp up to MIN_AMOUNT_COLUMN when the widest-candidate posting is still short", () => {
    // posting 1: 4 + 15 (Assets:Checking) + 1 (neg prefix) = 20  ← max
    // posting 2: 4 + 13 (Expenses:Food)   + 0             = 17
    // target = max(70, 20 + 4) = 70
    const body: ParsedBodyLine[][] = [
      [
        posting("    ", "Assets:Checking", "-45.00 USD", 1, true),
        posting("    ", "Expenses:Food", "45.00 USD", 0, false),
      ],
    ];
    expect(computeTargetDigitsColumn(body)).toBe(70);
  });

  test("should clamp across all transactions when the widest file-wide candidate is still short", () => {
    // tx 1 posting: 4 + 13 + 0 = 17
    // tx 2 posting: 4 + 32 + 0 = 36 ← max
    // target = max(70, 36 + 4) = 70
    const body: ParsedBodyLine[][] = [
      [posting("    ", "Expenses:Food", "45.00 USD", 0, false)],
      [posting("    ", "Expenses:Transport:PublicTransit", "10.00 USD", 0, false)],
    ];
    expect(computeTargetDigitsColumn(body)).toBe(70);
  });

  test("should return widestEnd + MIN_GAP when that exceeds MIN_AMOUNT_COLUMN", () => {
    // A 70-char account pushes past the 70 floor.
    // 4 + 70 + 0 = 74, + MIN_GAP = 78.
    const longAccount = "expenses:really:very:long:nested:account:name:that:is:seventy:chars:ok"; // 70 chars
    const body: ParsedBodyLine[][] = [[posting("    ", longAccount, "1.00 USD", 0, false)]];
    expect(longAccount.length).toBe(70);
    expect(computeTargetDigitsColumn(body)).toBe(78);
  });

  test("should return exactly MIN_AMOUNT_COLUMN (70) when widestEnd + MIN_GAP is exactly 70", () => {
    // 4 + 62 + 0 = 66, + MIN_GAP(4) = 70 → exactly the floor.
    const account62 = "a".repeat(62);
    const body: ParsedBodyLine[][] = [[posting("    ", account62, "1.00 USD", 0, false)]];
    expect(computeTargetDigitsColumn(body)).toBe(70);
  });

  test("should ignore non-posting lines", () => {
    const body: ParsedBodyLine[][] = [
      [
        metadata("    ; tag:"),
        balancing("    Assets:Checking"),
        posting("    ", "Expenses:Food", "45.00 USD", 0, false),
      ],
    ];
    // Widest posting is Expenses:Food (13) → 4+13+0+4 = 21, clamped to 70.
    expect(computeTargetDigitsColumn(body)).toBe(70);
  });

  test("should preserve per-posting indent in the calculation", () => {
    // 6-space indent + 13 account + 0 prefix = 19, + MIN_GAP(4) = 23 < 70, clamped to 70.
    const body: ParsedBodyLine[][] = [[posting("      ", "Expenses:Food", "45.00 USD", 0, false)]];
    expect(computeTargetDigitsColumn(body)).toBe(70);
  });
});
