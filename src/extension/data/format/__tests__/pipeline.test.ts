import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatJournalContent, formatJournalFile } from "../pipeline";

const FILE_BASE = mkdtempSync(join(tmpdir(), "format-file-"));

afterAll(() => {
  rmSync(FILE_BASE, { recursive: true, force: true });
});

// Builds a formatted posting line with first-digit at column 70 (MIN_AMOUNT_COLUMN).
// Shorthand for tests: `p("    ", "Expenses:Food", "45.00 USD")`.
// prefixLen is the number of chars before the first digit in `amount`
// (e.g., 1 for "-45.00 USD", 0 for "45.00 USD").
const p = (indent: string, account: string, amount: string, prefixLen = 0): string => {
  const padding = 70 - indent.length - account.length - prefixLen;
  return `${indent}${account}${" ".repeat(padding)}${amount}`;
};

describe("formatJournalContent()", () => {
  describe("sorting", () => {
    test("should sort transactions by date ascending", () => {
      const input = [
        "2026-03-28 * Later",
        "    Expenses:Misc    10.00 USD",
        "    Assets:Checking",
        "",
        "2026-03-01 * Earlier",
        "    Expenses:Misc    5.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const expected = [
        "2026-03-01 * Earlier",
        p("    ", "Expenses:Misc", "5.00 USD"),
        "    Assets:Checking",
        "",
        "2026-03-28 * Later",
        p("    ", "Expenses:Misc", "10.00 USD"),
        "    Assets:Checking",
      ].join("\n");
      expect(formatJournalContent(input)).toBe(expected);
    });

    test("should preserve original order for transactions with the same date (stable sort)", () => {
      const input = [
        "2026-03-15 * First",
        "    Expenses:Misc    1.00 USD",
        "    Assets:Checking",
        "",
        "2026-03-15 * Second",
        "    Expenses:Misc    2.00 USD",
        "    Assets:Checking",
        "",
        "2026-03-15 * Third",
        "    Expenses:Misc    3.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const result = formatJournalContent(input);
      const firstIdx = result.indexOf("* First");
      const secondIdx = result.indexOf("* Second");
      const thirdIdx = result.indexOf("* Third");
      expect(firstIdx).toBeGreaterThanOrEqual(0);
      expect(secondIdx).toBeGreaterThan(firstIdx);
      expect(thirdIdx).toBeGreaterThan(secondIdx);
    });

    test("should sort across three transactions with mixed dates", () => {
      const input = [
        "2026-03-20 * B",
        "    Expenses:Misc    2.00 USD",
        "    Assets:Checking",
        "",
        "2026-03-10 * A",
        "    Expenses:Misc    1.00 USD",
        "    Assets:Checking",
        "",
        "2026-03-30 * C",
        "    Expenses:Misc    3.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const result = formatJournalContent(input);
      const aIdx = result.indexOf("* A");
      const bIdx = result.indexOf("* B");
      const cIdx = result.indexOf("* C");
      expect(aIdx).toBeLessThan(bIdx);
      expect(bIdx).toBeLessThan(cIdx);
    });
  });

  describe("per-file alignment", () => {
    test("should align amounts to a column derived from MIN_AMOUNT_COLUMN when all accounts are short", () => {
      const input = [
        "2026-03-01 * A",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
        "",
        "2026-03-02 * B",
        "    Expenses:Transport:PublicTransit    10.00 USD",
        "    Assets:Checking",
      ].join("\n");
      // Widest account: "Expenses:Transport:PublicTransit" = 32 chars
      // widestEnd = 4 + 32 + 0 = 36, + MIN_GAP(4) = 40 < 70 → clamped to 70.
      // Expenses:Food padding                    = 70 - 4 - 13 = 53
      // Expenses:Transport:PublicTransit padding = 70 - 4 - 32 = 34
      const expected = [
        "2026-03-01 * A",
        p("    ", "Expenses:Food", "45.00 USD"),
        "    Assets:Checking",
        "",
        "2026-03-02 * B",
        p("    ", "Expenses:Transport:PublicTransit", "10.00 USD"),
        "    Assets:Checking",
      ].join("\n");
      expect(formatJournalContent(input)).toBe(expected);
    });

    test("should push amounts out to MIN_AMOUNT_COLUMN=70 even for the widest account in a short file", () => {
      const input = ["2026-03-01 * A", "    Expenses:Transport:PublicTransit    10.00 USD", "    Assets:Checking"].join(
        "\n",
      );
      const result = formatJournalContent(input);
      // Widest posting's first digit lands at column 70 (0-indexed).
      const line = result.split("\n").find((l) => l.includes("10.00 USD"))!;
      expect(line.indexOf("1")).toBe(70);
    });

    test("should not add padding to balancing postings (no amount)", () => {
      const input = ["2026-03-01 * A", "    Expenses:Transport:PublicTransit    10.00 USD", "    Assets:Checking"].join(
        "\n",
      );
      const result = formatJournalContent(input);
      // Balancing posting emitted verbatim: indent + account, no trailing padding
      expect(result).toContain("\n    Assets:Checking");
      expect(result).not.toContain("    Assets:Checking    ");
    });

    test("should align all postings within a transaction when they have different account widths", () => {
      const input = ["2026-03-01 * A", "    Expenses:Food    45.00 USD", "    Assets:Checking    -45.00 USD"].join(
        "\n",
      );
      // Widest candidate:
      //   Expenses:Food    → 4 + 13 + 0 = 17
      //   Assets:Checking  → 4 + 15 + 1 = 20  (prefix "-" has length 1)
      // widestEnd + MIN_GAP = 24 < 70 → clamped to 70.
      // Padding:
      //   Expenses:Food    → 70 - 4 - 13 - 0 = 53
      //   Assets:Checking  → 70 - 4 - 15 - 1 = 50
      // Order: negative postings first, then positive.
      const expected = [
        "2026-03-01 * A",
        p("    ", "Assets:Checking", "-45.00 USD", 1),
        p("    ", "Expenses:Food", "45.00 USD"),
      ].join("\n");
      expect(formatJournalContent(input)).toBe(expected);
    });

    test("should align negative and positive amounts on the first digit (sign sticks out left)", () => {
      // User's real case: "-111.00 EUR" and "111.00 EUR" should have their "1"s in the same column,
      // with the "-" one column to the left.
      const input = [
        "2026-01-17 * Knuspr",
        "    assets:volo:mono:eur    -111.00 EUR",
        "    expenses:food:groceries    111.00 EUR",
      ].join("\n");
      // Widest candidate: expenses:food:groceries → 4 + 23 + 0 = 27, clamped to 70.
      // Padding:
      //   assets:volo:mono:eur     → 70 - 4 - 20 - 1 = 45
      //   expenses:food:groceries  → 70 - 4 - 23 - 0 = 43
      const expected = [
        "2026-01-17 * Knuspr",
        p("    ", "assets:volo:mono:eur", "-111.00 EUR", 1),
        p("    ", "expenses:food:groceries", "111.00 EUR"),
      ].join("\n");
      const result = formatJournalContent(input);
      expect(result).toBe(expected);
      // Sanity: both first digits land at column 70
      const lines = result.split("\n");
      const negLine = lines.find((l) => l.includes("-111.00"))!;
      const posLine = lines.find((l) => l.includes("expenses:food:groceries"))!;
      const negFirstDigit = negLine.indexOf("1");
      const posFirstDigit = posLine.indexOf("111.00");
      expect(negFirstDigit).toBe(70);
      expect(posFirstDigit).toBe(70);
    });
  });

  describe("preservation — amounts", () => {
    test("should preserve negative amount verbatim: -45.00 USD", () => {
      const input = ["2026-03-15 * A", "    Expenses:Food    -45.00 USD", "    Assets:Checking"].join("\n");
      expect(formatJournalContent(input)).toContain("-45.00 USD");
    });

    test("should preserve currency-first amount verbatim: EUR -45.00", () => {
      const input = ["2026-03-15 * A", "    Expenses:Food    EUR -45.00", "    Assets:Checking"].join("\n");
      expect(formatJournalContent(input)).toContain("EUR -45.00");
    });

    test("should preserve dollar sign amount verbatim: $45.00", () => {
      const input = ["2026-03-15 * A", "    Expenses:Food    $45.00", "    Assets:Checking"].join("\n");
      expect(formatJournalContent(input)).toContain("$45.00");
    });

    test("should preserve thousand separators in amount verbatim: 1,000.00 USD", () => {
      const input = ["2026-03-15 * A", "    Expenses:Food    1,000.00 USD", "    Assets:Checking"].join("\n");
      expect(formatJournalContent(input)).toContain("1,000.00 USD");
    });

    test("should preserve balance assertion verbatim", () => {
      const input = ["2026-03-15 * A", "    Assets:Checking    100.00 USD = 500.00 USD", "    Assets:Savings"].join(
        "\n",
      );
      expect(formatJournalContent(input)).toContain("100.00 USD = 500.00 USD");
    });

    test("should preserve inline trailing ';' comment on a posting verbatim", () => {
      const input = ["2026-03-15 * A", "    Expenses:Food    45.00 USD ; inline note", "    Assets:Checking"].join(
        "\n",
      );
      expect(formatJournalContent(input)).toContain("45.00 USD ; inline note");
    });
  });

  describe("preservation — structure", () => {
    test("should preserve transaction header with status, code, and narration", () => {
      const input = [
        "2026-03-15 * (CODE-1) Whole Foods | Groceries trip",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
      ].join("\n");
      expect(formatJournalContent(input)).toContain("2026-03-15 * (CODE-1) Whole Foods | Groceries trip");
    });

    test("should preserve pending (!) status flag in header", () => {
      const input = ["2026-03-15 ! Payee | Pending", "    Expenses:Food    45.00 USD", "    Assets:Checking"].join(
        "\n",
      );
      expect(formatJournalContent(input)).toContain("2026-03-15 ! Payee | Pending");
    });

    test("should preserve ';' metadata comment lines inside a transaction verbatim", () => {
      const input = [
        "2026-03-15 * Payee",
        "    ; related_file: foo.pdf",
        "    ; tag: value",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const result = formatJournalContent(input);
      expect(result).toContain("    ; related_file: foo.pdf");
      expect(result).toContain("    ; tag: value");
    });

    test("should not produce any indented '#' comment lines", () => {
      // Regression for the user's reported error: indented '#' is invalid
      // hledger syntax and causes "multi-commodity transaction is unbalanced".
      const input = [
        "2026-01-02 * Berliner Verkehrsbetriebe (BVG) | Abo Sollstellung",
        "    ; mck_transportation_refund:",
        "    ; related_file: files/2026/04/foo.pdf",
        "    assets:volo:n26                    -63.00 EUR",
        "    expenses:transport:public-transit    63.00 EUR",
      ].join("\n");
      const result = formatJournalContent(input);
      // No line in the output starts with indented '#'
      expect(result.split("\n").some((l) => /^\s+#/.test(l))).toBe(false);
      // Metadata comments are preserved as ';'
      expect(result).toContain("    ; mck_transportation_refund:");
      expect(result).toContain("    ; related_file: files/2026/04/foo.pdf");
    });

    test("should preserve top-level ';' comments at the start of the file", () => {
      const input = [
        "; top-level note",
        "; another top note",
        "",
        "2026-03-15 * Payee",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const result = formatJournalContent(input);
      expect(result).toContain("; top-level note");
      expect(result).toContain("; another top note");
      expect(result.indexOf("; top-level note")).toBeLessThan(result.indexOf("2026-03-15"));
    });

    test("should preserve the original indent width of a posting line (2 spaces)", () => {
      const input = ["2026-03-15 * A", "  Expenses:Food    45.00 USD", "  Assets:Checking"].join("\n");
      // 2-space indent + Expenses:Food (13) + 0 prefix = 15, clamped to 70.
      // Padding = 70 - 2 - 13 = 55
      const expected = ["2026-03-15 * A", p("  ", "Expenses:Food", "45.00 USD"), "  Assets:Checking"].join("\n");
      expect(formatJournalContent(input)).toBe(expected);
    });

    test("should preserve the original indent width of a posting line (6 spaces)", () => {
      const input = ["2026-03-15 * A", "      Expenses:Food    45.00 USD", "      Assets:Checking"].join("\n");
      // 6-space indent + 13 + 0 = 19, clamped to 70. Padding = 70 - 6 - 13 = 51.
      const expected = ["2026-03-15 * A", p("      ", "Expenses:Food", "45.00 USD"), "      Assets:Checking"].join(
        "\n",
      );
      expect(formatJournalContent(input)).toBe(expected);
    });

    test("should normalize tab separator to spaces (the one thing we do touch)", () => {
      const input = `2026-03-15 * A\n    Expenses:Food\t45.00 USD\n    Assets:Checking`;
      const result = formatJournalContent(input);
      // Tab between account and amount gets replaced by alignment padding
      expect(result).toContain(p("    ", "Expenses:Food", "45.00 USD"));
      expect(result).not.toContain("\t");
    });
  });

  describe("idempotency", () => {
    test("should produce identical output when run twice", () => {
      const input = [
        "2026-03-28 * Later",
        "    Expenses:Transport:PublicTransit    63.00 EUR",
        "    Assets:Checking",
        "",
        "2026-03-01 * Earlier",
        "    Expenses:Food    -55.08 EUR",
        "    Assets:Checking",
      ].join("\n");
      const first = formatJournalContent(input);
      const second = formatJournalContent(first);
      expect(second).toBe(first);
    });

    test("should be a no-op on an already sorted and aligned file", () => {
      // Input is pre-aligned to column 70, so formatting is a no-op.
      const input = [
        "2026-03-01 * A",
        p("    ", "Expenses:Transport:PublicTransit", "10.00 USD"),
        "    Assets:Checking",
        "",
        "2026-03-02 * B",
        p("    ", "Expenses:Transport:PublicTransit", "20.00 USD"),
        "    Assets:Checking",
      ].join("\n");
      expect(formatJournalContent(input)).toBe(input);
    });
  });

  describe("edge cases", () => {
    test("should return empty string for empty input", () => {
      expect(formatJournalContent("")).toBe("");
    });

    test("should preserve ';' comments in a file with no transactions", () => {
      const input = "; just a comment\n";
      expect(formatJournalContent(input)).toBe(input);
    });

    test("should preserve ';' comments in a file with only leading comments", () => {
      const input = "; one\n; two\n; three\n";
      expect(formatJournalContent(input)).toBe(input);
    });

    test("should preserve '#' comments in a file with no transactions", () => {
      const input = "# top-level hash comment\n";
      expect(formatJournalContent(input)).toBe(input);
    });

    test("should preserve trailing newline when present in input", () => {
      const input = ["2026-03-15 * A", "    Expenses:Food    45.00 USD", "    Assets:Checking", ""].join("\n");
      const result = formatJournalContent(input);
      expect(result.endsWith("\n")).toBe(true);
    });

    test("should preserve trailing newline absence when input has none", () => {
      const input = ["2026-03-15 * A", "    Expenses:Food    45.00 USD", "    Assets:Checking"].join("\n");
      const result = formatJournalContent(input);
      expect(result.endsWith("\n")).toBe(false);
    });

    test("should normalize CRLF line endings to LF", () => {
      const input = "2026-03-15 * A\r\n    Expenses:Food    45.00 USD\r\n    Assets:Checking\r\n";
      const result = formatJournalContent(input);
      expect(result).not.toContain("\r");
      expect(result).toContain("\n");
    });

    test("should handle a single transaction file as a no-op when already aligned to MIN_AMOUNT_COLUMN", () => {
      const input = `2026-03-15 * A\n${p("    ", "Expenses:Food", "45.00 USD")}\n    Assets:Checking\n`;
      expect(formatJournalContent(input)).toBe(input);
    });

    test("should handle a transaction with no postings (just a header)", () => {
      const input =
        "2026-03-15 * Orphan header\n\n2026-03-16 * With postings\n    Expenses:Food    45.00 USD\n    Assets:Checking\n";
      // Should not crash; orphan header is preserved
      const result = formatJournalContent(input);
      expect(result).toContain("2026-03-15 * Orphan header");
      expect(result).toContain("2026-03-16 * With postings");
    });

    test("should handle a transaction with only balancing postings (no amounts anywhere)", () => {
      const input = "2026-03-15 * A\n    Assets:Checking\n    Assets:Savings\n";
      // No postings with amounts → no alignment computation, body preserved verbatim
      expect(formatJournalContent(input)).toBe(input);
    });

    test("should collapse multiple blank lines between transactions to exactly one", () => {
      const input = [
        "2026-03-01 * A",
        "    Expenses:Food    1.00 USD",
        "    Assets:Checking",
        "",
        "",
        "",
        "2026-03-02 * B",
        "    Expenses:Food    2.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const expected = [
        "2026-03-01 * A",
        p("    ", "Expenses:Food", "1.00 USD"),
        "    Assets:Checking",
        "",
        "2026-03-02 * B",
        p("    ", "Expenses:Food", "2.00 USD"),
        "    Assets:Checking",
      ].join("\n");
      expect(formatJournalContent(input)).toBe(expected);
    });
  });

  describe("within-transaction ordering — tags", () => {
    test("should split a comma-separated tag line into individual tag lines", () => {
      const input = [
        "2026-03-15 * Payee",
        "    ; groceries:, weekly:",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const result = formatJournalContent(input);
      expect(result).toContain("    ; groceries:");
      expect(result).toContain("    ; weekly:");
      expect(result).not.toContain("    ; groceries:, weekly:");
    });

    test("should sort tag lines alphabetically", () => {
      const input = [
        "2026-03-15 * Payee",
        "    ; weekly:",
        "    ; source: manual",
        "    ; groceries:",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const result = formatJournalContent(input);
      // Expected alphabetical order: groceries:, source: manual, weekly:
      const groceriesIdx = result.indexOf("; groceries:");
      const sourceIdx = result.indexOf("; source: manual");
      const weeklyIdx = result.indexOf("; weekly:");
      expect(groceriesIdx).toBeGreaterThanOrEqual(0);
      expect(sourceIdx).toBeGreaterThan(groceriesIdx);
      expect(weeklyIdx).toBeGreaterThan(sourceIdx);
    });

    test("should emit the sorted tag block immediately after the transaction header", () => {
      const input = [
        "2026-03-15 * Payee",
        "    ; groceries:, weekly:",
        "    ; source: manual",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const expected = [
        "2026-03-15 * Payee",
        "    ; groceries:",
        "    ; source: manual",
        "    ; weekly:",
        p("    ", "Expenses:Food", "45.00 USD"),
        "    Assets:Checking",
      ].join("\n");
      expect(formatJournalContent(input)).toBe(expected);
    });

    test('should treat "; key: value" metadata lines as tags', () => {
      const input = [
        "2026-03-15 * Payee",
        "    ; source: manual",
        "    ; related_file: foo.pdf",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const result = formatJournalContent(input);
      // Both are "tags" (contain ':'), should be sorted alphabetically: related_file before source
      const relatedIdx = result.indexOf("; related_file:");
      const sourceIdx = result.indexOf("; source:");
      expect(relatedIdx).toBeGreaterThanOrEqual(0);
      expect(sourceIdx).toBeGreaterThan(relatedIdx);
    });

    test("should NOT split a comment line whose parts don't all contain ':'", () => {
      const input = [
        "2026-03-15 * Payee",
        "    ; just a random note, with a comma",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const result = formatJournalContent(input);
      expect(result).toContain("    ; just a random note, with a comma");
    });

    test("should leave non-tag comment lines in their original relative order at the header", () => {
      const input = [
        "2026-03-15 * Payee",
        "    ; first note",
        "    ; second note",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const result = formatJournalContent(input);
      const firstIdx = result.indexOf("; first note");
      const secondIdx = result.indexOf("; second note");
      expect(firstIdx).toBeGreaterThanOrEqual(0);
      expect(secondIdx).toBeGreaterThan(firstIdx);
    });

    test("should pull a tag line that appeared between postings up into the header tag block", () => {
      const input = [
        "2026-03-15 * Payee",
        "    Expenses:Food    45.00 USD",
        "    ; tag: interleaved",
        "    Assets:Checking",
      ].join("\n");
      const result = formatJournalContent(input);
      const tagIdx = result.indexOf("; tag: interleaved");
      const foodIdx = result.indexOf("Expenses:Food");
      expect(tagIdx).toBeGreaterThanOrEqual(0);
      expect(tagIdx).toBeLessThan(foodIdx);
    });
  });

  describe("within-transaction ordering — sign grouping", () => {
    test("should put postings with a negative amount before postings with a positive amount", () => {
      const input = ["2026-03-15 * Payee", "    Expenses:Food    45.00 USD", "    Assets:Checking    -45.00 USD"].join(
        "\n",
      );
      const result = formatJournalContent(input);
      const checkingIdx = result.indexOf("Assets:Checking");
      const foodIdx = result.indexOf("Expenses:Food");
      expect(checkingIdx).toBeLessThan(foodIdx);
    });

    test("should put balancing postings last, after both negative and positive", () => {
      const input = [
        "2026-03-15 * Payee",
        "    Assets:Checking",
        "    Expenses:Food    45.00 USD",
        "    Liabilities:CreditCard    -45.00 USD",
      ].join("\n");
      const result = formatJournalContent(input);
      const creditIdx = result.indexOf("Liabilities:CreditCard");
      const foodIdx = result.indexOf("Expenses:Food");
      const checkingIdx = result.indexOf("Assets:Checking");
      expect(creditIdx).toBeLessThan(foodIdx);
      expect(foodIdx).toBeLessThan(checkingIdx);
    });

    test("should preserve original order for postings in the same sign group (stable)", () => {
      const input = [
        "2026-03-15 * Payee",
        "    Expenses:A    1.00 USD",
        "    Expenses:B    2.00 USD",
        "    Expenses:C    3.00 USD",
        "    Assets:Checking    -6.00 USD",
      ].join("\n");
      const result = formatJournalContent(input);
      const aIdx = result.indexOf("Expenses:A");
      const bIdx = result.indexOf("Expenses:B");
      const cIdx = result.indexOf("Expenses:C");
      expect(aIdx).toBeLessThan(bIdx);
      expect(bIdx).toBeLessThan(cIdx);
    });

    test('should classify "EUR -45.00" as negative', () => {
      const input = ["2026-03-15 * Payee", "    Expenses:Food    45.00 EUR", "    Assets:Checking    EUR -45.00"].join(
        "\n",
      );
      const result = formatJournalContent(input);
      const checkingIdx = result.indexOf("Assets:Checking");
      const foodIdx = result.indexOf("Expenses:Food");
      expect(checkingIdx).toBeLessThan(foodIdx);
    });

    test('should classify "-$45.00" as negative', () => {
      const input = ["2026-03-15 * Payee", "    Expenses:Food    $45.00", "    Assets:Checking    -$45.00"].join("\n");
      const result = formatJournalContent(input);
      const checkingIdx = result.indexOf("Assets:Checking");
      const foodIdx = result.indexOf("Expenses:Food");
      expect(checkingIdx).toBeLessThan(foodIdx);
    });

    test('should classify "$-45.00" as negative', () => {
      const input = ["2026-03-15 * Payee", "    Expenses:Food    $45.00", "    Assets:Checking    $-45.00"].join("\n");
      const result = formatJournalContent(input);
      const checkingIdx = result.indexOf("Assets:Checking");
      const foodIdx = result.indexOf("Expenses:Food");
      expect(checkingIdx).toBeLessThan(foodIdx);
    });

    test('should classify "+45.00 USD" as positive', () => {
      const input = ["2026-03-15 * Payee", "    Expenses:Food    +45.00 USD", "    Assets:Checking    -45.00 USD"].join(
        "\n",
      );
      const result = formatJournalContent(input);
      const checkingIdx = result.indexOf("Assets:Checking");
      const foodIdx = result.indexOf("Expenses:Food");
      expect(checkingIdx).toBeLessThan(foodIdx);
    });

    test('should classify unsigned "45.00 USD" as positive', () => {
      const input = ["2026-03-15 * Payee", "    Expenses:Food    45.00 USD", "    Assets:Checking    -45.00 USD"].join(
        "\n",
      );
      const result = formatJournalContent(input);
      const checkingIdx = result.indexOf("Assets:Checking");
      const foodIdx = result.indexOf("Expenses:Food");
      expect(checkingIdx).toBeLessThan(foodIdx);
    });
  });

  describe("within-transaction ordering — attachment", () => {
    test("should keep a non-tag comment attached to its preceding posting when the posting is moved by sign grouping", () => {
      const input = [
        "2026-03-15 * Payee",
        "    Expenses:Food    45.00 USD",
        "    # note about the food line",
        "    Assets:Checking    -45.00 USD",
      ].join("\n");
      const result = formatJournalContent(input);
      const lines = result.split("\n");
      const foodIdx = lines.findIndex((l) => l.includes("Expenses:Food"));
      const noteIdx = lines.findIndex((l) => l.includes("# note about the food line"));
      expect(foodIdx).toBeGreaterThanOrEqual(0);
      // The note should still be immediately after the Expenses:Food posting line
      expect(noteIdx).toBe(foodIdx + 1);
      // Sign grouping moved Expenses:Food AFTER the negative Assets:Checking;
      // the note came with it
      const checkingIdx = lines.findIndex((l) => l.includes("Assets:Checking"));
      expect(checkingIdx).toBeLessThan(foodIdx);
    });
  });

  describe("inter-transaction top-level content", () => {
    test("should preserve a top-level comment between transactions (not absorb it into the previous tx)", () => {
      const input = [
        "2026-01-01 * Scalable Capital | Received interest",
        "    assets:volo:scalable-capital:cash          365.27 EUR",
        "    income:volo:scalable-capital:interest      -365.27 EUR",
        "",
        "; Regular transactions",
        "",
        "2026-01-02 * Berliner Verkehrsbetriebe (BVG)",
        "    assets:volo:n26                    -63.00 EUR",
        "    expenses:transport:public-transit    63.00 EUR",
      ].join("\n");
      const result = formatJournalContent(input);
      // The comment stays OUTSIDE the first transaction's body
      const firstTxIdx = result.indexOf("Scalable Capital");
      const commentIdx = result.indexOf("; Regular transactions");
      const secondTxIdx = result.indexOf("Berliner Verkehrsbetriebe");
      expect(firstTxIdx).toBeGreaterThanOrEqual(0);
      expect(commentIdx).toBeGreaterThan(firstTxIdx);
      expect(commentIdx).toBeLessThan(secondTxIdx);
      // And it's NOT part of the first transaction body — the cash/interest
      // lines of the first tx come BEFORE the comment, not mixed with it
      const interestIdx = result.indexOf("income:volo:scalable-capital:interest");
      const cashIdx = result.indexOf("assets:volo:scalable-capital:cash");
      expect(interestIdx).toBeLessThan(commentIdx);
      expect(cashIdx).toBeLessThan(commentIdx);
    });

    test("should preserve ';' inter-transaction comments verbatim", () => {
      const input = [
        "2026-01-01 * A",
        "    Expenses:Food    10.00 USD",
        "    Assets:Checking",
        "",
        "; section divider",
        "",
        "2026-01-02 * B",
        "    Expenses:Food    20.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const result = formatJournalContent(input);
      expect(result).toContain("; section divider");
    });

    test("should emit inter-transaction comments with blank lines around them", () => {
      const input = [
        "2026-01-01 * A",
        "    Expenses:Food    10.00 USD",
        "    Assets:Checking",
        "",
        "; section divider",
        "",
        "2026-01-02 * B",
        "    Expenses:Food    20.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const expected = [
        "2026-01-01 * A",
        p("    ", "Expenses:Food", "10.00 USD"),
        "    Assets:Checking",
        "",
        "; section divider",
        "",
        "2026-01-02 * B",
        p("    ", "Expenses:Food", "20.00 USD"),
        "    Assets:Checking",
      ].join("\n");
      expect(formatJournalContent(input)).toBe(expected);
    });

    test("should keep inter-transaction content with its following transaction when sorted", () => {
      // tx1 has a LATER date than tx2; beautifier will sort tx2 first.
      // The comment between them was "before tx2" in the file, so it travels with tx2.
      const input = [
        "2026-01-10 * Later",
        "    Expenses:Food    1.00 USD",
        "    Assets:Checking",
        "",
        "; section divider",
        "",
        "2026-01-01 * Earlier",
        "    Expenses:Food    2.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const result = formatJournalContent(input);
      const earlierIdx = result.indexOf("Earlier");
      const laterIdx = result.indexOf("Later");
      expect(earlierIdx).toBeLessThan(laterIdx);
      const commentIdx = result.indexOf("; section divider");
      expect(commentIdx).toBeLessThan(earlierIdx);
    });

    test("should preserve trailing content after the last transaction", () => {
      const input = [
        "2026-01-01 * A",
        "    Expenses:Food    10.00 USD",
        "    Assets:Checking",
        "",
        "; trailing footer note",
      ].join("\n");
      const result = formatJournalContent(input);
      expect(result).toContain("; trailing footer note");
      const txIdx = result.indexOf("2026-01-01");
      const footerIdx = result.indexOf("; trailing footer note");
      expect(footerIdx).toBeGreaterThan(txIdx);
    });

    test("should be idempotent with inter-transaction comments", () => {
      const input = [
        "2026-01-01 * A",
        "    Expenses:Food    10.00 USD",
        "    Assets:Checking",
        "",
        "; section divider",
        "",
        "2026-01-02 * B",
        "    Expenses:Food    20.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const first = formatJournalContent(input);
      const second = formatJournalContent(first);
      expect(second).toBe(first);
    });
  });

  describe("within-transaction ordering — idempotency", () => {
    test("should produce identical output when run twice on a mixed-sign transaction with tags", () => {
      const input = [
        "2026-03-15 * Payee",
        "    ; weekly:, groceries:",
        "    ; source: manual",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking    -45.00 USD",
      ].join("\n");
      const first = formatJournalContent(input);
      const second = formatJournalContent(first);
      expect(second).toBe(first);
    });

    test("should be a no-op on an already-ordered canonical transaction", () => {
      // Candidates:
      //   Assets:Checking (15) + prefix "-" (1) = 20
      //   Expenses:Food (13)   + prefix ""  (0) = 17
      // widestEnd + MIN_GAP = 24 < 70 → clamped to 70.
      //   Assets:Checking padding = 70 - 4 - 15 - 1 = 50
      //   Expenses:Food padding   = 70 - 4 - 13 - 0 = 53
      const canonical = [
        "2026-03-15 * Payee",
        "    ; groceries:",
        "    ; source: manual",
        "    ; weekly:",
        p("    ", "Assets:Checking", "-45.00 USD", 1),
        p("    ", "Expenses:Food", "45.00 USD"),
      ].join("\n");
      expect(formatJournalContent(canonical)).toBe(canonical);
    });
  });
});

describe("formatJournalFile()", () => {
  test("should return null when the file does not exist", () => {
    const absent = join(FILE_BASE, "does-not-exist.journal");
    expect(existsSync(absent)).toBe(false);
    expect(formatJournalFile(absent)).toBeNull();
  });

  test("should rethrow non-ENOENT errors (e.g. EISDIR when path is a directory)", () => {
    // FILE_BASE is a directory, so readFileSync(FILE_BASE) throws an error
    // whose code is not ENOENT (commonly EISDIR). formatJournalFile should
    // rethrow.
    expect(() => formatJournalFile(FILE_BASE)).toThrow();
  });

  test("should return the final content and write it when formatting changes the file", () => {
    const path = join(FILE_BASE, "needs-formatting.journal");
    // Out-of-order dates — the formatter will sort them.
    writeFileSync(
      path,
      [
        "2026-03-28 * Later",
        "    Expenses:Food    10.00 USD",
        "    Assets:Checking",
        "",
        "2026-03-01 * Earlier",
        "    Expenses:Food    5.00 USD",
        "    Assets:Checking",
      ].join("\n"),
    );
    const result = formatJournalFile(path);
    if (result === null) throw new Error("file was just written, should not be null");
    // Earlier comes first after sort
    const onDisk = readFileSync(path, "utf-8");
    expect(onDisk).toBe(result);
    expect(onDisk.indexOf("Earlier")).toBeLessThan(onDisk.indexOf("Later"));
  });

  test("should return the content and NOT touch the file when it is already formatted", () => {
    const path = join(FILE_BASE, "already-formatted.journal");
    const input = [
      "2026-03-01 * Earlier",
      p("    ", "Expenses:Food", "5.00 USD"),
      "    Assets:Checking",
      "",
      "2026-03-28 * Later",
      p("    ", "Expenses:Food", "10.00 USD"),
      "    Assets:Checking",
      "",
    ].join("\n");
    writeFileSync(path, input);
    const mtimeBefore = statSync(path).mtimeMs;

    // Busy-wait briefly so a write would produce a different mtime
    const until = Date.now() + 15;
    while (Date.now() < until) {
      /* spin */
    }

    const result = formatJournalFile(path);
    const mtimeAfter = statSync(path).mtimeMs;
    expect(result).toBe(input);
    expect(mtimeAfter).toBe(mtimeBefore);
  });
});
