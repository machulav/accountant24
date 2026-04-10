import { describe, expect, test } from "bun:test";
import {
  extractLeadingLines,
  findTransactionHeaders,
  parseContent,
  parsePostingLine,
  parseTransactions,
  sortTransactionsByDate,
} from "../parse";
import type { Transaction } from "../types";

describe("parseContent()", () => {
  test("should return a single empty-string line for empty input (split('\\n') semantics)", () => {
    // Note: formatJournalContent short-circuits on empty input before calling parseContent.
    expect(parseContent("")).toEqual({ lines: [""], hadTrailingNewline: false });
  });

  test("should detect trailing newline and drop the trailing empty string", () => {
    expect(parseContent("a\nb\n")).toEqual({ lines: ["a", "b"], hadTrailingNewline: true });
  });

  test("should detect absence of trailing newline", () => {
    expect(parseContent("a\nb")).toEqual({ lines: ["a", "b"], hadTrailingNewline: false });
  });

  test("should normalize CRLF to LF", () => {
    expect(parseContent("a\r\nb\r\n")).toEqual({ lines: ["a", "b"], hadTrailingNewline: true });
  });

  test("should handle a single line without trailing newline", () => {
    expect(parseContent("only one")).toEqual({ lines: ["only one"], hadTrailingNewline: false });
  });

  test("should preserve internal blank lines", () => {
    expect(parseContent("a\n\nb\n")).toEqual({ lines: ["a", "", "b"], hadTrailingNewline: true });
  });
});

describe("findTransactionHeaders()", () => {
  test("should return empty array when there are no date headers", () => {
    expect(findTransactionHeaders(["; comment", "  Assets:Cash", ""])).toEqual([]);
  });

  test("should find all date-header line indices", () => {
    const lines = ["2026-01-01 * A", "    posting", "", "2026-02-15 * B", "    posting"];
    expect(findTransactionHeaders(lines)).toEqual([0, 3]);
  });

  test("should accept slash-separated dates", () => {
    expect(findTransactionHeaders(["2026/03/05 * A"])).toEqual([0]);
  });

  test("should accept dot-separated dates", () => {
    expect(findTransactionHeaders(["2026.03.05 * A"])).toEqual([0]);
  });

  test("should not match indented date-like lines", () => {
    expect(findTransactionHeaders(["    2026-01-01 * A"])).toEqual([]);
  });

  test("should not match dates inside the middle of a line", () => {
    expect(findTransactionHeaders(["foo 2026-01-01"])).toEqual([]);
  });
});

describe("extractLeadingLines()", () => {
  test("should return everything up to `until`", () => {
    const lines = ["; one", "; two", "2026-01-01 * A"];
    expect(extractLeadingLines(lines, 2)).toEqual(["; one", "; two"]);
  });

  test("should strip trailing blank lines", () => {
    const lines = ["; one", "", "", "2026-01-01 * A"];
    expect(extractLeadingLines(lines, 3)).toEqual(["; one"]);
  });

  test("should return empty array when until is 0", () => {
    expect(extractLeadingLines(["a", "b"], 0)).toEqual([]);
  });

  test("should return everything when until equals length", () => {
    expect(extractLeadingLines(["; one", "; two"], 2)).toEqual(["; one", "; two"]);
  });

  test("should return empty array for an all-blank leading region", () => {
    expect(extractLeadingLines(["", "", ""], 3)).toEqual([]);
  });
});

describe("parsePostingLine()", () => {
  test("should classify a non-indented line as 'other'", () => {
    expect(parsePostingLine("2026-01-01 * A")).toEqual({ kind: "other", raw: "2026-01-01 * A" });
  });

  test("should classify an indented ';' line as metadata", () => {
    expect(parsePostingLine("    ; tag: value")).toEqual({ kind: "metadata", raw: "    ; tag: value" });
  });

  test("should classify an indented '#' line as metadata", () => {
    expect(parsePostingLine("    # hash")).toEqual({ kind: "metadata", raw: "    # hash" });
  });

  test("should classify an indented account-only line as balancing", () => {
    expect(parsePostingLine("    Assets:Checking")).toEqual({ kind: "balancing", raw: "    Assets:Checking" });
  });

  test("should parse a posting line with amount and mark unsigned as positive", () => {
    const result = parsePostingLine("    Expenses:Food    45.00 USD");
    expect(result).toEqual({
      kind: "posting",
      indent: "    ",
      account: "Expenses:Food",
      amount: "45.00 USD",
      digitsPrefixLength: 0,
      isNegative: false,
    });
  });

  test("should mark a posting with a leading '-' as negative", () => {
    const result = parsePostingLine("    Assets:Checking    -45.00 USD");
    expect(result).toMatchObject({ kind: "posting", isNegative: true, digitsPrefixLength: 1 });
  });

  test("should mark 'EUR -45.00' as negative and compute prefix length 5", () => {
    const result = parsePostingLine("    Assets:Checking    EUR -45.00");
    expect(result).toMatchObject({ kind: "posting", amount: "EUR -45.00", digitsPrefixLength: 5, isNegative: true });
  });

  test("should mark 'EUR 45.00' as positive and compute prefix length 4", () => {
    const result = parsePostingLine("    Assets:Checking    EUR 45.00");
    expect(result).toMatchObject({ kind: "posting", digitsPrefixLength: 4, isNegative: false });
  });

  test("should mark '$-45.00' as negative and compute prefix length 2", () => {
    const result = parsePostingLine("    Assets:Checking    $-45.00");
    expect(result).toMatchObject({ kind: "posting", digitsPrefixLength: 2, isNegative: true });
  });

  test("should mark '+45.00 USD' as positive", () => {
    const result = parsePostingLine("    Expenses:Food    +45.00 USD");
    expect(result).toMatchObject({ kind: "posting", isNegative: false });
  });

  test("should set digitsPrefixLength = amount.length for a no-digit amount", () => {
    // Covers the `idx === -1` branch in getDigitsPrefixLength.
    const result = parsePostingLine("    Account    EUR");
    expect(result).toMatchObject({ kind: "posting", amount: "EUR", digitsPrefixLength: 3, isNegative: false });
  });

  test("should accept tab as account/amount separator", () => {
    const result = parsePostingLine("    Expenses:Food\t45.00 USD");
    expect(result).toMatchObject({ kind: "posting", account: "Expenses:Food", amount: "45.00 USD" });
  });

  test("should trim trailing whitespace from the amount", () => {
    const result = parsePostingLine("    Expenses:Food    45.00 USD   ");
    expect(result).toMatchObject({ kind: "posting", amount: "45.00 USD" });
  });

  test("should preserve inline trailing ';' comment as part of the amount", () => {
    const result = parsePostingLine("    Expenses:Food    45.00 USD ; note");
    expect(result).toMatchObject({ kind: "posting", amount: "45.00 USD ; note" });
  });

  test("should preserve the original indent (tabs or spaces) verbatim", () => {
    const result = parsePostingLine("\t\tExpenses:Food  45.00 USD");
    expect(result).toMatchObject({ kind: "posting", indent: "\t\t" });
  });
});

describe("parseTransactions()", () => {
  test("should build a transaction from a header followed by indented body", () => {
    const lines = ["2026-01-01 * A", "    Expenses:Food    10.00 USD", "    Assets:Checking"];
    const result = parseTransactions(lines, [0]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toEqual({
      date: "2026-01-01",
      header: "2026-01-01 * A",
      body: ["    Expenses:Food    10.00 USD", "    Assets:Checking"],
      preContent: [],
    });
    expect(result.trailingContent).toEqual([]);
  });

  test("should attach non-indented content between txs to the NEXT tx as preContent", () => {
    const lines = [
      "2026-01-01 * A",
      "    Expenses:Food    10.00 USD",
      "    Assets:Checking",
      "",
      "; section divider",
      "",
      "2026-01-02 * B",
      "    Expenses:Food    20.00 USD",
      "    Assets:Checking",
    ];
    const result = parseTransactions(lines, [0, 6]);
    expect(result.transactions[0].preContent).toEqual([]);
    expect(result.transactions[1].preContent).toEqual(["; section divider"]);
  });

  test("should place loose content after the last tx into trailingContent", () => {
    const lines = ["2026-01-01 * A", "    Expenses:Food    10.00 USD", "    Assets:Checking", "", "; trailing note"];
    const result = parseTransactions(lines, [0]);
    expect(result.trailingContent).toEqual(["; trailing note"]);
  });

  test("should handle a header with no body", () => {
    const lines = ["2026-01-01 * Orphan", "", "2026-01-02 * With body", "    Expenses:Food    1.00 USD"];
    const result = parseTransactions(lines, [0, 2]);
    expect(result.transactions[0].body).toEqual([]);
    expect(result.transactions[1].body).toEqual(["    Expenses:Food    1.00 USD"]);
  });

  test("should derive the date from the header regex", () => {
    const lines = ["2026-03-15 * Payee", "    Expenses:Food    1.00 USD"];
    const result = parseTransactions(lines, [0]);
    expect(result.transactions[0].date).toBe("2026-03-15");
  });

  test("should normalize non-standard date separators to '-' in the sort key", () => {
    const lines = ["2026/03/15 * Payee", "    Expenses:Food    1.00 USD"];
    const result = parseTransactions(lines, [0]);
    expect(result.transactions[0].date).toBe("2026-03-15");
  });
});

describe("sortTransactionsByDate()", () => {
  const makeTx = (date: string, header: string): Transaction => ({ date, header, body: [], preContent: [] });

  test("should sort transactions ascending by date", () => {
    const txs = [makeTx("2026-03-28", "Later"), makeTx("2026-01-05", "Earliest"), makeTx("2026-02-10", "Middle")];
    sortTransactionsByDate(txs);
    expect(txs.map((t) => t.date)).toEqual(["2026-01-05", "2026-02-10", "2026-03-28"]);
  });

  test("should be stable for same-date transactions", () => {
    const txs = [makeTx("2026-03-15", "First"), makeTx("2026-03-15", "Second"), makeTx("2026-03-15", "Third")];
    sortTransactionsByDate(txs);
    expect(txs.map((t) => t.header)).toEqual(["First", "Second", "Third"]);
  });

  test("should sort in place (mutate the array)", () => {
    const txs = [makeTx("2026-02-01", "B"), makeTx("2026-01-01", "A")];
    const returned = sortTransactionsByDate(txs);
    expect(returned).toBeUndefined();
    expect(txs[0].header).toBe("A");
  });
});
