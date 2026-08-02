import { describe, expect, test } from "vitest";
import { segment } from "../segment";
import type { Block } from "../types";

/** Every segmentation must reproduce the input byte-for-byte. */
function segmentRoundTrip(text: string): Block[] {
  const blocks = segment(text);
  expect(blocks.map((b) => b.raw).join("")).toBe(text);
  return blocks;
}

function kinds(blocks: Block[]): string[] {
  return blocks.map((b) => b.kind);
}

describe("segment()", () => {
  test("should return no blocks when text is empty", () => {
    expect(segmentRoundTrip("")).toEqual([]);
  });

  test("should segment a mixed journal into comment, directive, blank, and transaction blocks", () => {
    const text = [
      "; Accountant24",
      "",
      "include commodities.journal",
      "include accounts.journal",
      "",
      "2026-01-05 * Shop | weekly",
      "    Expenses:Food    45.00 EUR",
      "    Assets:Cash",
      "",
      "P 2026-01-06 USD 0.87 EUR",
      "",
    ].join("\n");
    const blocks = segmentRoundTrip(text);
    expect(kinds(blocks)).toEqual([
      "comment",
      "blank",
      "directive",
      "directive",
      "blank",
      "transaction",
      "blank",
      "price",
    ]);
    expect(blocks[5]).toMatchObject({ startLine: 6, endLine: 8, date: "2026-01-05" });
    expect(blocks[5].raw).toBe("2026-01-05 * Shop | weekly\n    Expenses:Food    45.00 EUR\n    Assets:Cash\n");
    expect(blocks[7]).toMatchObject({ startLine: 10, endLine: 10, date: "2026-01-06" });
  });

  test("should keep a single line without trailing newline as one block", () => {
    const blocks = segmentRoundTrip("include accounts.journal");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "directive", raw: "include accounts.journal", startLine: 1, endLine: 1 });
  });

  test("should keep a transaction that ends at EOF without a trailing newline intact", () => {
    const text = "2026-01-05 * Shop\n    Expenses:Food    45.00 EUR\n    Assets:Cash";
    const blocks = segmentRoundTrip(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("transaction");
    expect(blocks[0].endLine).toBe(3);
  });

  test("should preserve CRLF terminators in raw while classifying normally", () => {
    const text = "2026-01-05 * Shop\r\n    Expenses:Food    45.00 EUR\r\n    Assets:Cash\r\n\r\n";
    const blocks = segmentRoundTrip(text);
    expect(kinds(blocks)).toEqual(["transaction", "blank"]);
    expect(blocks[0].raw).toContain("\r\n");
    expect(blocks[0].date).toBe("2026-01-05");
  });

  test("should merge consecutive blank lines into one block", () => {
    const blocks = segmentRoundTrip("include a.journal\n\n\n\ninclude b.journal\n");
    expect(kinds(blocks)).toEqual(["directive", "blank", "directive"]);
    expect(blocks[1].raw).toBe("\n\n\n");
  });

  test("should merge consecutive column-0 comment lines into one block", () => {
    const blocks = segmentRoundTrip("; one\n; two\n# three\n* four\n");
    expect(kinds(blocks)).toEqual(["comment"]);
    expect(blocks[0].endLine).toBe(4);
  });

  test("should split comment runs at blank lines", () => {
    const blocks = segmentRoundTrip("; one\n\n; two\n");
    expect(kinds(blocks)).toEqual(["comment", "blank", "comment"]);
  });

  test("should attach indented sub-directives to their directive block", () => {
    const text = "commodity USD\n  format 1,000.00 USD\n\naccount Assets:Cash\n";
    const blocks = segmentRoundTrip(text);
    expect(kinds(blocks)).toEqual(["directive", "blank", "directive"]);
    expect(blocks[0].raw).toBe("commodity USD\n  format 1,000.00 USD\n");
  });

  test("should treat a comment/end comment region as one opaque block", () => {
    const text = "; head\n\ncomment\n2026-01-05 not a real transaction\nend comment\ninclude a.journal\n";
    const blocks = segmentRoundTrip(text);
    expect(kinds(blocks)).toEqual(["comment", "blank", "other", "directive"]);
    expect(blocks[2].raw).toBe("comment\n2026-01-05 not a real transaction\nend comment\n");
  });

  test("should extend an unterminated comment block to EOF", () => {
    const blocks = segmentRoundTrip("comment\nanything\ngoes\n");
    expect(kinds(blocks)).toEqual(["other"]);
    expect(blocks[0].endLine).toBe(3);
  });

  test("should collect orphan indented lines at file start into an opaque block", () => {
    const blocks = segmentRoundTrip("    Expenses:Food    45.00 EUR\n    Assets:Cash\ninclude a.journal\n");
    expect(kinds(blocks)).toEqual(["other", "directive"]);
    expect(blocks[0].endLine).toBe(2);
  });

  test("should collect indented lines after a blank line into an opaque block", () => {
    const blocks = segmentRoundTrip("2026-01-05 * Shop\n    Expenses:Food    45.00 EUR\n\n    Assets:Cash\n");
    expect(kinds(blocks)).toEqual(["transaction", "blank", "other"]);
  });

  test("should normalize slash and dot dates with single digits to ISO", () => {
    const blocks = segmentRoundTrip(
      "2026/3/5 * A\n    X    1.00 EUR\n    Y\n\n2026.03.05 * B\n    X    1.00 EUR\n    Y\n",
    );
    expect(blocks[0].date).toBe("2026-03-05");
    expect(blocks[2].date).toBe("2026-03-05");
  });

  test("should use the primary date when a secondary date is present", () => {
    const blocks = segmentRoundTrip("2026-01-05=2026-01-07 * Shop\n    X    1.00 EUR\n    Y\n");
    expect(blocks[0]).toMatchObject({ kind: "transaction", date: "2026-01-05" });
  });

  test("should leave date undefined when the month is impossible", () => {
    const blocks = segmentRoundTrip("2026-13-05 * Shop\n    X    1.00 EUR\n    Y\n");
    expect(blocks[0]).toMatchObject({ kind: "transaction", date: undefined });
  });

  test("should leave date undefined when the day does not exist in the month", () => {
    const blocks = segmentRoundTrip("2026-02-31 * Shop\n    X    1.00 EUR\n    Y\n");
    expect(blocks[0]).toMatchObject({ kind: "transaction", date: undefined });
  });

  test("should leave price date undefined when malformed", () => {
    const blocks = segmentRoundTrip("P 2026-13-05 USD 0.87 EUR\n");
    expect(blocks[0]).toMatchObject({ kind: "price", date: undefined });
  });

  test("should not mistake a mixed-separator date for a transaction", () => {
    const blocks = segmentRoundTrip("2026-03/15 something\n");
    expect(kinds(blocks)).toEqual(["directive"]);
  });

  test("should classify a digit-leading non-date line as a directive", () => {
    const blocks = segmentRoundTrip("2026 report\n");
    expect(kinds(blocks)).toEqual(["directive"]);
  });

  test("should treat a whitespace-only line as blank, ending the transaction", () => {
    const blocks = segmentRoundTrip("2026-01-05 * A\n    X    1.00 EUR\n   \n    Y\n");
    expect(kinds(blocks)).toEqual(["transaction", "blank", "other"]);
    expect(blocks[1].raw).toBe("   \n");
  });

  test("should attach tab-indented continuation lines to their transaction", () => {
    const blocks = segmentRoundTrip("2026-01-05 * A\n\tExpenses:X\t1.00 EUR\n\tAssets:Y\n");
    expect(kinds(blocks)).toEqual(["transaction"]);
    expect(blocks[0].endLine).toBe(3);
  });

  test("should merge an indented continuation into the preceding comment block", () => {
    const blocks = segmentRoundTrip("; head\n    continued\ninclude a.journal\n");
    expect(kinds(blocks)).toEqual(["comment", "directive"]);
    expect(blocks[0].endLine).toBe(2);
  });

  test("should recognize a transaction behind a UTF-8 BOM, keeping the BOM in raw", () => {
    // hledger accepts BOM-prefixed journals, so the segmenter must too.
    const blocks = segmentRoundTrip("\uFEFF2026-01-05 * Shop\n    Expenses:X    1.00 EUR\n    Assets:Y\n");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "transaction", date: "2026-01-05" });
    expect(blocks[0].raw.startsWith("\uFEFF")).toBe(true);
  });
});
