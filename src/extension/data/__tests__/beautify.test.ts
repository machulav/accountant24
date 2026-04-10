import { describe, expect, test } from "bun:test";
import { beautifyJournalContent } from "../beautify";

describe("beautifyJournalContent()", () => {
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
        "    Expenses:Misc    5.00 USD",
        "    Assets:Checking",
        "",
        "2026-03-28 * Later",
        "    Expenses:Misc    10.00 USD",
        "    Assets:Checking",
      ].join("\n");
      expect(beautifyJournalContent(input)).toBe(expected);
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
      const result = beautifyJournalContent(input);
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
      const result = beautifyJournalContent(input);
      const aIdx = result.indexOf("* A");
      const bIdx = result.indexOf("* B");
      const cIdx = result.indexOf("* C");
      expect(aIdx).toBeLessThan(bIdx);
      expect(bIdx).toBeLessThan(cIdx);
    });
  });

  describe("per-file alignment", () => {
    test("should align amounts to a column derived from the longest account in the whole file", () => {
      const input = [
        "2026-03-01 * A",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
        "",
        "2026-03-02 * B",
        "    Expenses:Transport:PublicTransit    10.00 USD",
        "    Assets:Checking",
      ].join("\n");
      // Longest account with amount: "Expenses:Transport:PublicTransit" = 32 chars
      // targetColumn = 4 (indent) + 32 (account) + 4 (MIN_GAP) = 40
      // Expenses:Food padding = 40 - 4 - 13 = 23 spaces
      // Expenses:Transport:PublicTransit padding = 40 - 4 - 32 = 4 spaces
      const expected = [
        "2026-03-01 * A",
        `    Expenses:Food${" ".repeat(23)}45.00 USD`,
        "    Assets:Checking",
        "",
        "2026-03-02 * B",
        "    Expenses:Transport:PublicTransit    10.00 USD",
        "    Assets:Checking",
      ].join("\n");
      expect(beautifyJournalContent(input)).toBe(expected);
    });

    test("should use MIN_GAP=4 for the widest account in the file", () => {
      const input = ["2026-03-01 * A", "    Expenses:Transport:PublicTransit    10.00 USD", "    Assets:Checking"].join(
        "\n",
      );
      const result = beautifyJournalContent(input);
      // Widest account is "Expenses:Transport:PublicTransit" and should have exactly 4 spaces before amount
      expect(result).toContain("Expenses:Transport:PublicTransit    10.00 USD");
    });

    test("should not add padding to balancing postings (no amount)", () => {
      const input = ["2026-03-01 * A", "    Expenses:Transport:PublicTransit    10.00 USD", "    Assets:Checking"].join(
        "\n",
      );
      const result = beautifyJournalContent(input);
      // Balancing posting emitted verbatim: indent + account, no trailing padding
      expect(result).toContain("\n    Assets:Checking");
      expect(result).not.toContain("    Assets:Checking    ");
    });

    test("should align all postings within a transaction when they have different account widths", () => {
      const input = ["2026-03-01 * A", "    Expenses:Food    45.00 USD", "    Assets:Checking    -45.00 USD"].join(
        "\n",
      );
      // Alignment math (align on first DIGIT):
      //   Expenses:Food    → 4 + 13 + 0 = 17
      //   Assets:Checking  → 4 + 15 + 1 = 20  (prefix "-" has length 1)
      //   targetDigitsColumn = 20 + 4 = 24
      //   Expenses:Food padding    = 24 - 4 - 13 - 0 = 7
      //   Assets:Checking padding  = 24 - 4 - 15 - 1 = 4
      // Order: negative postings first (Assets:Checking -45.00), then positive (Expenses:Food 45.00).
      const expected = [
        "2026-03-01 * A",
        "    Assets:Checking    -45.00 USD",
        `    Expenses:Food${" ".repeat(7)}45.00 USD`,
      ].join("\n");
      expect(beautifyJournalContent(input)).toBe(expected);
    });

    test("should align negative and positive amounts on the first digit (sign sticks out left)", () => {
      // User's real case: "-111.00 EUR" and "111.00 EUR" should have their "1"s in the same column,
      // with the "-" one column to the left.
      const input = [
        "2026-01-17 * Knuspr",
        "    assets:volo:mono:eur    -111.00 EUR",
        "    expenses:food:groceries    111.00 EUR",
      ].join("\n");
      // Candidates:
      //   assets:volo:mono:eur     → 4 + 20 + 1 = 25  (prefix "-")
      //   expenses:food:groceries  → 4 + 23 + 0 = 27
      // targetDigitsColumn = 27 + 4 = 31
      // Padding:
      //   assets:volo:mono:eur     → 31 - 4 - 20 - 1 = 6
      //   expenses:food:groceries  → 31 - 4 - 23 - 0 = 4
      const expected = [
        "2026-01-17 * Knuspr",
        `    assets:volo:mono:eur${" ".repeat(6)}-111.00 EUR`,
        "    expenses:food:groceries    111.00 EUR",
      ].join("\n");
      const result = beautifyJournalContent(input);
      expect(result).toBe(expected);
      // Sanity: the "1" (first digit) of both amounts lands at the same column (31)
      const lines = result.split("\n");
      const negLine = lines.find((l) => l.includes("-111.00"))!;
      const posLine = lines.find((l) => l.includes("expenses:food:groceries"))!;
      const negFirstDigit = negLine.indexOf("1");
      const posFirstDigit = posLine.indexOf("111.00");
      expect(negFirstDigit).toBe(31);
      expect(posFirstDigit).toBe(31);
    });
  });

  describe("preservation — amounts", () => {
    test("should preserve negative amount verbatim: -45.00 USD", () => {
      const input = ["2026-03-15 * A", "    Expenses:Food    -45.00 USD", "    Assets:Checking"].join("\n");
      expect(beautifyJournalContent(input)).toContain("-45.00 USD");
    });

    test("should preserve currency-first amount verbatim: EUR -45.00", () => {
      const input = ["2026-03-15 * A", "    Expenses:Food    EUR -45.00", "    Assets:Checking"].join("\n");
      expect(beautifyJournalContent(input)).toContain("EUR -45.00");
    });

    test("should preserve dollar sign amount verbatim: $45.00", () => {
      const input = ["2026-03-15 * A", "    Expenses:Food    $45.00", "    Assets:Checking"].join("\n");
      expect(beautifyJournalContent(input)).toContain("$45.00");
    });

    test("should preserve thousand separators in amount verbatim: 1,000.00 USD", () => {
      const input = ["2026-03-15 * A", "    Expenses:Food    1,000.00 USD", "    Assets:Checking"].join("\n");
      expect(beautifyJournalContent(input)).toContain("1,000.00 USD");
    });

    test("should preserve balance assertion verbatim", () => {
      const input = ["2026-03-15 * A", "    Assets:Checking    100.00 USD = 500.00 USD", "    Assets:Savings"].join(
        "\n",
      );
      expect(beautifyJournalContent(input)).toContain("100.00 USD = 500.00 USD");
    });

    test("should rewrite inline trailing ';' comment on a posting to '#'", () => {
      const input = ["2026-03-15 * A", "    Expenses:Food    45.00 USD ; inline note", "    Assets:Checking"].join(
        "\n",
      );
      const result = beautifyJournalContent(input);
      expect(result).toContain("45.00 USD # inline note");
      expect(result).not.toContain("; inline note");
    });

    test("should preserve inline trailing '#' comment on a posting verbatim", () => {
      const input = ["2026-03-15 * A", "    Expenses:Food    45.00 USD # inline note", "    Assets:Checking"].join(
        "\n",
      );
      expect(beautifyJournalContent(input)).toContain("45.00 USD # inline note");
    });
  });

  describe("preservation — structure", () => {
    test("should preserve transaction header with status, code, and narration", () => {
      const input = [
        "2026-03-15 * (CODE-1) Whole Foods | Groceries trip",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
      ].join("\n");
      expect(beautifyJournalContent(input)).toContain("2026-03-15 * (CODE-1) Whole Foods | Groceries trip");
    });

    test("should preserve pending (!) status flag in header", () => {
      const input = ["2026-03-15 ! Payee | Pending", "    Expenses:Food    45.00 USD", "    Assets:Checking"].join(
        "\n",
      );
      expect(beautifyJournalContent(input)).toContain("2026-03-15 ! Payee | Pending");
    });

    test("should rewrite metadata comment lines (; tag:) inside a transaction to '#'", () => {
      const input = [
        "2026-03-15 * Payee",
        "    ; related_file: foo.pdf",
        "    ; tag: value",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const result = beautifyJournalContent(input);
      expect(result).toContain("    # related_file: foo.pdf");
      expect(result).toContain("    # tag: value");
      // Both original ';' metadata lines are gone
      expect(result).not.toContain("    ; related_file: foo.pdf");
      expect(result).not.toContain("    ; tag: value");
    });

    test("should preserve metadata comments using # verbatim", () => {
      const input = [
        "2026-03-15 * Payee",
        "    # hash comment",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
      ].join("\n");
      expect(beautifyJournalContent(input)).toContain("    # hash comment");
    });

    test("should rewrite top-level ';' comments at the start of the file to '#'", () => {
      const input = [
        "; top-level note",
        "; another top note",
        "",
        "2026-03-15 * Payee",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const result = beautifyJournalContent(input);
      expect(result).toContain("# top-level note");
      expect(result).toContain("# another top note");
      // Original ';' versions are gone
      expect(result).not.toContain("; top-level note");
      expect(result).not.toContain("; another top note");
      // Leading content comes before the first transaction
      expect(result.indexOf("# top-level note")).toBeLessThan(result.indexOf("2026-03-15"));
    });

    test("should preserve the original indent width of a posting line (2 spaces)", () => {
      const input = ["2026-03-15 * A", "  Expenses:Food    45.00 USD", "  Assets:Checking"].join("\n");
      // 2-space indent → indent.length=2 + account.length=13 = 15, +4 = targetCol 19
      // Padding = 19 - 2 - 13 = 4
      const expected = ["2026-03-15 * A", "  Expenses:Food    45.00 USD", "  Assets:Checking"].join("\n");
      expect(beautifyJournalContent(input)).toBe(expected);
    });

    test("should preserve the original indent width of a posting line (6 spaces)", () => {
      const input = ["2026-03-15 * A", "      Expenses:Food    45.00 USD", "      Assets:Checking"].join("\n");
      // 6-space indent → targetCol = 6 + 13 + 4 = 23, padding = 23 - 6 - 13 = 4
      const expected = ["2026-03-15 * A", "      Expenses:Food    45.00 USD", "      Assets:Checking"].join("\n");
      expect(beautifyJournalContent(input)).toBe(expected);
    });

    test("should normalize tab separator to spaces (the one thing we do touch)", () => {
      const input = `2026-03-15 * A\n    Expenses:Food\t45.00 USD\n    Assets:Checking`;
      const result = beautifyJournalContent(input);
      // Tab between account and amount gets replaced by spaces
      expect(result).toContain("    Expenses:Food    45.00 USD");
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
      const first = beautifyJournalContent(input);
      const second = beautifyJournalContent(first);
      expect(second).toBe(first);
    });

    test("should be a no-op on an already sorted and aligned file", () => {
      const input = [
        "2026-03-01 * A",
        "    Expenses:Transport:PublicTransit    10.00 USD",
        "    Assets:Checking",
        "",
        "2026-03-02 * B",
        "    Expenses:Transport:PublicTransit    20.00 USD",
        "    Assets:Checking",
      ].join("\n");
      expect(beautifyJournalContent(input)).toBe(input);
    });
  });

  describe("edge cases", () => {
    test("should return empty string for empty input", () => {
      expect(beautifyJournalContent("")).toBe("");
    });

    test("should rewrite ';' comments in a file with no transactions", () => {
      const input = "; just a comment\n";
      expect(beautifyJournalContent(input)).toBe("# just a comment\n");
    });

    test("should rewrite ';' comments in a file with only leading comments", () => {
      const input = "; one\n; two\n; three\n";
      expect(beautifyJournalContent(input)).toBe("# one\n# two\n# three\n");
    });

    test("should leave '#' comments unchanged in a file with no transactions", () => {
      const input = "# already hashed\n";
      expect(beautifyJournalContent(input)).toBe(input);
    });

    test("should preserve trailing newline when present in input", () => {
      const input = ["2026-03-15 * A", "    Expenses:Food    45.00 USD", "    Assets:Checking", ""].join("\n");
      const result = beautifyJournalContent(input);
      expect(result.endsWith("\n")).toBe(true);
    });

    test("should preserve trailing newline absence when input has none", () => {
      const input = ["2026-03-15 * A", "    Expenses:Food    45.00 USD", "    Assets:Checking"].join("\n");
      const result = beautifyJournalContent(input);
      expect(result.endsWith("\n")).toBe(false);
    });

    test("should normalize CRLF line endings to LF", () => {
      const input = "2026-03-15 * A\r\n    Expenses:Food    45.00 USD\r\n    Assets:Checking\r\n";
      const result = beautifyJournalContent(input);
      expect(result).not.toContain("\r");
      expect(result).toContain("\n");
    });

    test("should handle a single transaction file as a no-op for alignment", () => {
      const input = "2026-03-15 * A\n    Expenses:Food    45.00 USD\n    Assets:Checking\n";
      expect(beautifyJournalContent(input)).toBe(input);
    });

    test("should handle a transaction with no postings (just a header)", () => {
      const input =
        "2026-03-15 * Orphan header\n\n2026-03-16 * With postings\n    Expenses:Food    45.00 USD\n    Assets:Checking\n";
      // Should not crash; orphan header is preserved
      const result = beautifyJournalContent(input);
      expect(result).toContain("2026-03-15 * Orphan header");
      expect(result).toContain("2026-03-16 * With postings");
    });

    test("should handle a transaction with only balancing postings (no amounts anywhere)", () => {
      const input = "2026-03-15 * A\n    Assets:Checking\n    Assets:Savings\n";
      // No postings with amounts → no alignment computation, body preserved verbatim
      expect(beautifyJournalContent(input)).toBe(input);
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
        "    Expenses:Food    1.00 USD",
        "    Assets:Checking",
        "",
        "2026-03-02 * B",
        "    Expenses:Food    2.00 USD",
        "    Assets:Checking",
      ].join("\n");
      expect(beautifyJournalContent(input)).toBe(expected);
    });
  });

  describe("within-transaction ordering — tags", () => {
    test("should split a comma-separated tag line into individual tag lines", () => {
      const input = [
        "2026-03-15 * Payee",
        "    # groceries:, weekly:",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const result = beautifyJournalContent(input);
      expect(result).toContain("    # groceries:");
      expect(result).toContain("    # weekly:");
      expect(result).not.toContain("    # groceries:, weekly:");
    });

    test("should sort tag lines alphabetically", () => {
      const input = [
        "2026-03-15 * Payee",
        "    # weekly:",
        "    # source: manual",
        "    # groceries:",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const result = beautifyJournalContent(input);
      // Expected alphabetical order: groceries:, source: manual, weekly:
      const groceriesIdx = result.indexOf("# groceries:");
      const sourceIdx = result.indexOf("# source: manual");
      const weeklyIdx = result.indexOf("# weekly:");
      expect(groceriesIdx).toBeGreaterThanOrEqual(0);
      expect(sourceIdx).toBeGreaterThan(groceriesIdx);
      expect(weeklyIdx).toBeGreaterThan(sourceIdx);
    });

    test("should emit the sorted tag block immediately after the transaction header", () => {
      const input = [
        "2026-03-15 * Payee",
        "    # groceries:, weekly:",
        "    # source: manual",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const expected = [
        "2026-03-15 * Payee",
        "    # groceries:",
        "    # source: manual",
        "    # weekly:",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
      ].join("\n");
      expect(beautifyJournalContent(input)).toBe(expected);
    });

    test('should treat "# key: value" metadata lines as tags', () => {
      const input = [
        "2026-03-15 * Payee",
        "    # source: manual",
        "    # related_file: foo.pdf",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const result = beautifyJournalContent(input);
      // Both are "tags" (contain ':'), should be sorted alphabetically: related_file before source
      const relatedIdx = result.indexOf("# related_file:");
      const sourceIdx = result.indexOf("# source:");
      expect(relatedIdx).toBeGreaterThanOrEqual(0);
      expect(sourceIdx).toBeGreaterThan(relatedIdx);
    });

    test("should NOT split a comment line whose parts don't all contain ':'", () => {
      const input = [
        "2026-03-15 * Payee",
        "    # just a random note, with a comma",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const result = beautifyJournalContent(input);
      expect(result).toContain("    # just a random note, with a comma");
    });

    test("should leave non-tag comment lines in their original relative order at the header", () => {
      const input = [
        "2026-03-15 * Payee",
        "    # first note",
        "    # second note",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const result = beautifyJournalContent(input);
      const firstIdx = result.indexOf("# first note");
      const secondIdx = result.indexOf("# second note");
      expect(firstIdx).toBeGreaterThanOrEqual(0);
      expect(secondIdx).toBeGreaterThan(firstIdx);
    });

    test("should pull a tag line that appeared between postings up into the header tag block", () => {
      const input = [
        "2026-03-15 * Payee",
        "    Expenses:Food    45.00 USD",
        "    # tag: interleaved",
        "    Assets:Checking",
      ].join("\n");
      const result = beautifyJournalContent(input);
      const tagIdx = result.indexOf("# tag: interleaved");
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
      const result = beautifyJournalContent(input);
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
      const result = beautifyJournalContent(input);
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
      const result = beautifyJournalContent(input);
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
      const result = beautifyJournalContent(input);
      const checkingIdx = result.indexOf("Assets:Checking");
      const foodIdx = result.indexOf("Expenses:Food");
      expect(checkingIdx).toBeLessThan(foodIdx);
    });

    test('should classify "-$45.00" as negative', () => {
      const input = ["2026-03-15 * Payee", "    Expenses:Food    $45.00", "    Assets:Checking    -$45.00"].join("\n");
      const result = beautifyJournalContent(input);
      const checkingIdx = result.indexOf("Assets:Checking");
      const foodIdx = result.indexOf("Expenses:Food");
      expect(checkingIdx).toBeLessThan(foodIdx);
    });

    test('should classify "$-45.00" as negative', () => {
      const input = ["2026-03-15 * Payee", "    Expenses:Food    $45.00", "    Assets:Checking    $-45.00"].join("\n");
      const result = beautifyJournalContent(input);
      const checkingIdx = result.indexOf("Assets:Checking");
      const foodIdx = result.indexOf("Expenses:Food");
      expect(checkingIdx).toBeLessThan(foodIdx);
    });

    test('should classify "+45.00 USD" as positive', () => {
      const input = ["2026-03-15 * Payee", "    Expenses:Food    +45.00 USD", "    Assets:Checking    -45.00 USD"].join(
        "\n",
      );
      const result = beautifyJournalContent(input);
      const checkingIdx = result.indexOf("Assets:Checking");
      const foodIdx = result.indexOf("Expenses:Food");
      expect(checkingIdx).toBeLessThan(foodIdx);
    });

    test('should classify unsigned "45.00 USD" as positive', () => {
      const input = ["2026-03-15 * Payee", "    Expenses:Food    45.00 USD", "    Assets:Checking    -45.00 USD"].join(
        "\n",
      );
      const result = beautifyJournalContent(input);
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
      const result = beautifyJournalContent(input);
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
      const result = beautifyJournalContent(input);
      // The comment stays OUTSIDE the first transaction's body
      const firstTxIdx = result.indexOf("Scalable Capital");
      const commentIdx = result.indexOf("# Regular transactions");
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

    test("should rewrite ';' to '#' in inter-transaction comments", () => {
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
      const result = beautifyJournalContent(input);
      expect(result).toContain("# section divider");
      expect(result).not.toContain("; section divider");
    });

    test("should emit inter-transaction comments with blank lines around them", () => {
      const input = [
        "2026-01-01 * A",
        "    Expenses:Food    10.00 USD",
        "    Assets:Checking",
        "",
        "# section divider",
        "",
        "2026-01-02 * B",
        "    Expenses:Food    20.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const expected = [
        "2026-01-01 * A",
        "    Expenses:Food    10.00 USD",
        "    Assets:Checking",
        "",
        "# section divider",
        "",
        "2026-01-02 * B",
        "    Expenses:Food    20.00 USD",
        "    Assets:Checking",
      ].join("\n");
      expect(beautifyJournalContent(input)).toBe(expected);
    });

    test("should keep inter-transaction content with its following transaction when sorted", () => {
      // tx1 has a LATER date than tx2; beautifier will sort tx2 first.
      // The comment between them was "before tx2" in the file, so it travels with tx2.
      const input = [
        "2026-01-10 * Later",
        "    Expenses:Food    1.00 USD",
        "    Assets:Checking",
        "",
        "# section divider",
        "",
        "2026-01-01 * Earlier",
        "    Expenses:Food    2.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const result = beautifyJournalContent(input);
      // After sort: Earlier first, then Later
      const earlierIdx = result.indexOf("Earlier");
      const laterIdx = result.indexOf("Later");
      expect(earlierIdx).toBeLessThan(laterIdx);
      // The comment moved with its following transaction (Earlier) to the top
      const commentIdx = result.indexOf("# section divider");
      expect(commentIdx).toBeLessThan(earlierIdx);
    });

    test("should preserve trailing content after the last transaction", () => {
      const input = [
        "2026-01-01 * A",
        "    Expenses:Food    10.00 USD",
        "    Assets:Checking",
        "",
        "# trailing footer note",
      ].join("\n");
      const result = beautifyJournalContent(input);
      expect(result).toContain("# trailing footer note");
      // Trailing content is at the end
      const txIdx = result.indexOf("2026-01-01");
      const footerIdx = result.indexOf("# trailing footer note");
      expect(footerIdx).toBeGreaterThan(txIdx);
    });

    test("should be idempotent with inter-transaction comments", () => {
      const input = [
        "2026-01-01 * A",
        "    Expenses:Food    10.00 USD",
        "    Assets:Checking",
        "",
        "# section divider",
        "",
        "2026-01-02 * B",
        "    Expenses:Food    20.00 USD",
        "    Assets:Checking",
      ].join("\n");
      const first = beautifyJournalContent(input);
      const second = beautifyJournalContent(first);
      expect(second).toBe(first);
    });
  });

  describe("within-transaction ordering — idempotency", () => {
    test("should produce identical output when run twice on a mixed-sign transaction with tags", () => {
      const input = [
        "2026-03-15 * Payee",
        "    # weekly:, groceries:",
        "    # source: manual",
        "    Expenses:Food    45.00 USD",
        "    Assets:Checking    -45.00 USD",
      ].join("\n");
      const first = beautifyJournalContent(input);
      const second = beautifyJournalContent(first);
      expect(second).toBe(first);
    });

    test("should be a no-op on an already-ordered canonical transaction", () => {
      const input = [
        "2026-03-15 * Payee",
        "    # groceries:",
        "    # source: manual",
        "    # weekly:",
        "    Assets:Checking    -45.00 USD",
        "    Expenses:Food      45.00 USD",
      ].join("\n");
      // Candidates:
      //   Assets:Checking (15) + prefix "-" (1) = 20
      //   Expenses:Food (13)   + prefix ""  (0) = 17
      // targetDigitsColumn = 20 + 4 = 24
      //   Assets:Checking padding = 24 - 4 - 15 - 1 = 4
      //   Expenses:Food padding   = 24 - 4 - 13 - 0 = 7
      // Already canonical input: assertion is that output equals input
      const expected = [
        "2026-03-15 * Payee",
        "    # groceries:",
        "    # source: manual",
        "    # weekly:",
        "    Assets:Checking    -45.00 USD",
        `    Expenses:Food${" ".repeat(7)}45.00 USD`,
      ].join("\n");
      expect(beautifyJournalContent(input)).toBe(expected);
    });
  });
});
