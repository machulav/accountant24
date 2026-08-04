import { describe, expect, test } from "vitest";
import { JournalParseError } from "../errors";
import { formatTransaction, renderPrice, renderTransaction } from "../format";
import { parsePriceBlock, parseTransactionBlock } from "../parse";
import { segment } from "../segment";
import type { Block } from "../types";

function block(text: string, index = 0): Block {
  return segment(text)[index];
}

function parseError(fn: () => unknown): JournalParseError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(JournalParseError);
    return e as JournalParseError;
  }
  throw new Error("expected a JournalParseError to be thrown");
}

describe("parseTransactionBlock()", () => {
  test("should parse the canonical app-written transaction", () => {
    const text = formatTransaction({
      date: "2026-03-15",
      payee: "Whole Foods",
      description: "Groceries",
      postings: [
        { account: "Assets:Checking", amount: -45, currency: "USD" },
        { account: "Expenses:Food:Groceries", amount: 45, currency: "USD" },
      ],
      tags: [{ name: "source", value: "manual" }],
    });
    const tx = parseTransactionBlock(block(text));
    expect(tx).toMatchObject({
      date: "2026-03-15",
      status: "*",
      description: "Whole Foods | Groceries",
      payee: "Whole Foods",
      note: "Groceries",
      commentLines: ["; source: manual"],
      tags: [{ name: "source", value: "manual" }],
    });
    expect(tx.postings).toEqual([
      { account: "Assets:Checking", amount: -45, amountText: "-45.00", currency: "USD" },
      { account: "Expenses:Food:Groceries", amount: 45, amountText: "45.00", currency: "USD" },
    ]);
  });

  test("should parse an unmarked transaction without status or note", () => {
    const tx = parseTransactionBlock(
      block("2026-01-05 Corner Store\n    Expenses:Misc    1.00 USD\n    Assets:Cash\n"),
    );
    expect(tx.status).toBeUndefined();
    expect(tx.payee).toBe("Corner Store");
    expect(tx.note).toBeUndefined();
    expect(tx.postings[1]).toEqual({ account: "Assets:Cash" });
  });

  test("should parse a pending status and a transaction code", () => {
    const tx = parseTransactionBlock(block("2026-01-05 ! (42) Bank\n    A    1.00 USD\n    B\n"));
    expect(tx.status).toBe("!");
    expect(tx.code).toBe("42");
    expect(tx.payee).toBe("Bank");
  });

  test("should keep the header comment verbatim", () => {
    const tx = parseTransactionBlock(block("2026-01-05 * Shop  ; seen: bank\n    A    1.00 USD\n    B\n"));
    expect(tx.description).toBe("Shop");
    expect(tx.headerComment).toBe("; seen: bank");
  });

  test("should preserve amount text exactly as written", () => {
    const tx = parseTransactionBlock(block("2026-01-05 * Shop\n    A    45.5 EUR\n    B    -45.500 EUR\n"));
    expect(tx.postings[0]).toMatchObject({ amount: 45.5, amountText: "45.5" });
    expect(tx.postings[1]).toMatchObject({ amount: -45.5, amountText: "-45.500" });
  });

  test("should parse a balance assertion after the amount", () => {
    const tx = parseTransactionBlock(
      block("2026-01-05 * Balance Assertion\n    Assets:Bank    0.00 EUR = 200.00 EUR\n"),
    );
    expect(tx.postings[0]).toEqual({
      account: "Assets:Bank",
      amount: 0,
      amountText: "0.00",
      currency: "EUR",
      assertion: { amount: 200, amountText: "200.00", currency: "EUR" },
    });
  });

  test("should parse a trailing posting comment verbatim", () => {
    const tx = parseTransactionBlock(block("2026-01-05 * Shop\n    A    1.00 USD  ; note: x\n    B\n"));
    expect(tx.postings[0].comment).toBe("; note: x");
  });

  test("should parse a comment on an amountless posting", () => {
    const tx = parseTransactionBlock(block("2026-01-05 * Shop\n    A    1.00 USD\n    B  ; why\n"));
    expect(tx.postings[1]).toEqual({ account: "B", comment: "; why" });
  });

  test("should parse a parenthesized posting as virtual", () => {
    const tx = parseTransactionBlock(block("2026-01-05 * Shop\n    (Forecast)    1.00 USD\n"));
    expect(tx.postings[0]).toMatchObject({ account: "Forecast", virtual: true });
  });

  test("should keep single spaces inside account names", () => {
    const tx = parseTransactionBlock(
      block("2026-01-05 * Opening\n    Equity:Opening Balances    -1.00 EUR\n    Assets:Cash    1.00 EUR\n"),
    );
    expect(tx.postings[0].account).toBe("Equity:Opening Balances");
  });

  test("should unquote a quoted commodity", () => {
    const tx = parseTransactionBlock(block('2026-01-05 * Broker\n    Assets:Broker    2 "SOL2"\n    Assets:Cash\n'));
    expect(tx.postings[0]).toMatchObject({ amount: 2, currency: "SOL2" });
  });

  test("should collect plain comment lines without deriving tags", () => {
    const tx = parseTransactionBlock(
      block("2026-01-05 * Shop\n    ; just a note\n    ; ref: 123\n    A    1.00 USD\n"),
    );
    expect(tx.commentLines).toEqual(["; just a note", "; ref: 123"]);
    expect(tx.tags).toEqual([{ name: "ref", value: "123" }]);
  });

  test("should derive a value-less tag from a bare tag line", () => {
    const tx = parseTransactionBlock(block("2026-01-05 * Shop\n    ; groceries:\n    A    1.00 USD\n"));
    expect(tx.tags).toEqual([{ name: "groceries" }]);
  });

  test("should reject a non-transaction block", () => {
    const error = parseError(() => parseTransactionBlock(block("include a.journal\n")));
    expect(error.reason).toContain("expected a transaction block");
  });

  test("should reject an impossible calendar date", () => {
    const error = parseError(() => parseTransactionBlock(block("2026-02-31 * Shop\n    A    1.00 USD\n")));
    expect(error.reason).toContain("not a valid calendar date");
  });

  test("should reject secondary dates", () => {
    const error = parseError(() => parseTransactionBlock(block("2026-01-05=2026-01-07 * Shop\n    A    1.00 USD\n")));
    expect(error.reason).toContain("secondary dates");
  });

  test("should reject a posting status marker", () => {
    const error = parseError(() => parseTransactionBlock(block("2026-01-05 * Shop\n    * A    1.00 USD\n")));
    expect(error.reason).toContain("posting status markers");
  });

  test("should reject balanced virtual postings", () => {
    const error = parseError(() => parseTransactionBlock(block("2026-01-05 * Shop\n    [Budget]    1.00 USD\n")));
    expect(error.reason).toContain("balanced virtual");
  });

  test("should reject unbalanced parentheses in an account", () => {
    const error = parseError(() => parseTransactionBlock(block("2026-01-05 * Shop\n    (Forecast    1.00 USD\n")));
    expect(error.reason).toContain("unbalanced parentheses");
  });

  test("should reject a comment separated by a single space", () => {
    const error = parseError(() => parseTransactionBlock(block("2026-01-05 * Shop\n    Assets:Cash ; note\n")));
    expect(error.reason).toContain("2+ spaces");
  });

  test("should reject a balance assignment without an amount", () => {
    const error = parseError(() =>
      parseTransactionBlock(block("2026-01-05 * Shop\n    Assets:Cash    = 100.00 EUR\n")),
    );
    expect(error.reason).toContain("balance assignments");
  });

  test("should reject a double-equals assertion", () => {
    const error = parseError(() =>
      parseTransactionBlock(block("2026-01-05 * Shop\n    Assets:Cash    0.00 EUR == 100.00 EUR\n")),
    );
    expect(error.reason).toContain("only simple balance assertions");
  });

  test("should reject cost notation", () => {
    const error = parseError(() =>
      parseTransactionBlock(block("2026-01-05 * Shop\n    Assets:X    1 BTC @ 55000 EUR\n")),
    );
    expect(error.reason).toContain("cost notation");
  });

  test("should reject thousands separators in amounts", () => {
    const error = parseError(() => parseTransactionBlock(block("2026-01-05 * Shop\n    Assets:X    1,000.00 USD\n")));
    expect(error.reason).toContain("unsupported amount format");
  });

  test("should reject a currency-symbol-first amount", () => {
    const error = parseError(() => parseTransactionBlock(block("2026-01-05 * Shop\n    Assets:X    $100\n")));
    expect(error.reason).toContain("unsupported amount format");
  });

  test("should reject an amount without a commodity", () => {
    const error = parseError(() => parseTransactionBlock(block("2026-01-05 * Shop\n    Assets:X    45.00\n")));
    expect(error.reason).toContain("unsupported amount format");
  });

  test("should reject comment lines between postings", () => {
    const error = parseError(() =>
      parseTransactionBlock(block("2026-01-05 * Shop\n    A    1.00 USD\n    ; late comment\n    B\n")),
    );
    expect(error.reason).toContain("between or after postings");
  });

  test("should reject an empty quoted commodity", () => {
    const error = parseError(() => parseTransactionBlock(block('2026-01-05 * Shop\n    Assets:X    1 ""\n')));
    expect(error.reason).toContain("empty quoted commodity");
  });

  test("should point the error at the offending line within the file", () => {
    const text = "include a.journal\n\n2026-01-05 * Shop\n    A    1.00 USD\n    B    $5\n";
    const error = parseError(() => parseTransactionBlock(block(text, 2)));
    expect(error.line).toBe(5);
    expect(error.message).toBe('Line 5: unsupported amount format: "$5"');
  });
});

describe("parsePriceBlock()", () => {
  test("should parse a plain P directive", () => {
    expect(parsePriceBlock(block("P 2026-03-15 USD 0.87 EUR\n"))).toEqual({
      date: "2026-03-15",
      commodity: "USD",
      amount: 0.87,
      amountText: "0.87",
      currency: "EUR",
    });
  });

  test("should unquote quoted commodities on both sides", () => {
    expect(parsePriceBlock(block('P 2026-03-15 "SOL2" 145.30 "USD2"\n'))).toMatchObject({
      commodity: "SOL2",
      currency: "USD2",
    });
  });

  test("should preserve the written amount text", () => {
    expect(parsePriceBlock(block("P 2026-03-15 SAT 0.0000005 EUR\n"))).toMatchObject({
      amount: 0.0000005,
      amountText: "0.0000005",
    });
  });

  test("should reject a non-price block", () => {
    const error = parseError(() => parsePriceBlock(block("2026-01-05 * Shop\n    A    1.00 USD\n")));
    expect(error.reason).toContain("expected a price block");
  });

  test("should reject an impossible price date", () => {
    const error = parseError(() => parsePriceBlock(block("P 2026-13-05 USD 0.87 EUR\n")));
    expect(error.reason).toContain("not a valid calendar date");
  });

  test("should reject indented lines under a P directive", () => {
    const error = parseError(() => parsePriceBlock(block("P 2026-03-15 USD 0.87 EUR\n    stray\n")));
    expect(error.reason).toContain("unexpected indented lines");
    expect(error.line).toBe(2);
  });

  test("should reject a P directive with missing parts", () => {
    const error = parseError(() => parsePriceBlock(block("P 2026-03-15 USD\n")));
    expect(error.reason).toContain("unsupported P directive format");
  });

  test("should reject a P directive with extra trailing tokens", () => {
    const error = parseError(() => parsePriceBlock(block("P 2026-03-15 USD 0.87 EUR extra\n")));
    expect(error.reason).toContain("unsupported P directive format");
  });
});

// ── Header edge cases ───────────────────────────────────────────────

describe("parseTransactionBlock() header edge cases", () => {
  test("should split payee and note at the FIRST pipe, as hledger does", () => {
    // Verified against hledger: `hledger payees` on "Alpha | Beta | Gamma" reports "Alpha".
    const tx = parseTransactionBlock(block("2026-01-05 * Alpha | Beta | Gamma\n    A    1.00 EUR\n    B\n"));
    expect(tx.payee).toBe("Alpha");
    expect(tx.note).toBe("Beta | Gamma");
  });

  test("should derive payee and note from a pipe without surrounding spaces, preserving the description", () => {
    const tx = parseTransactionBlock(block("2026-01-05 * Alpha|Beta\n    A    1.00 EUR\n    B\n"));
    expect(tx.description).toBe("Alpha|Beta");
    expect(tx.payee).toBe("Alpha");
    expect(tx.note).toBe("Beta");
  });

  test("should parse a header that is only a date", () => {
    const tx = parseTransactionBlock(block("2026-01-05\n    A    1.00 EUR\n    B\n"));
    expect(tx.status).toBeUndefined();
    expect(tx.description).toBe("");
    expect(tx.payee).toBe("");
  });

  test("should parse a header with a status but no description", () => {
    const tx = parseTransactionBlock(block("2026-01-05 *\n    A    1.00 EUR\n    B\n"));
    expect(tx.status).toBe("*");
    expect(tx.description).toBe("");
  });

  test("should parse a code without a status", () => {
    const tx = parseTransactionBlock(block("2026-01-05 (42) Shop\n    A    1.00 EUR\n    B\n"));
    expect(tx.status).toBeUndefined();
    expect(tx.code).toBe("42");
    expect(tx.payee).toBe("Shop");
  });

  test("should not derive a note from a pipe inside the header comment", () => {
    const tx = parseTransactionBlock(block("2026-01-05 * Shop  ; see | this\n    A    1.00 EUR\n    B\n"));
    expect(tx.note).toBeUndefined();
    expect(tx.headerComment).toBe("; see | this");
  });

  test("should parse a transaction whose header sits behind a UTF-8 BOM", () => {
    const tx = parseTransactionBlock(block("\uFEFF2026-01-05 * Shop\n    A    1.00 EUR\n    B\n"));
    expect(tx.date).toBe("2026-01-05");
    expect(tx.payee).toBe("Shop");
  });
});

// ── Posting edge cases ──────────────────────────────────────────────

describe("parseTransactionBlock() posting edge cases", () => {
  test("should allow @ inside a posting comment", () => {
    const tx = parseTransactionBlock(block("2026-01-05 * Shop\n    A    1.00 USD  ; was @ 1.1\n    B\n"));
    expect(tx.postings[0]).toMatchObject({ amount: 1, comment: "; was @ 1.1" });
  });

  test("should allow = inside a posting comment", () => {
    const tx = parseTransactionBlock(block("2026-01-05 * Shop\n    A    1.00 USD  ; verified = true\n    B\n"));
    expect(tx.postings[0]).toMatchObject({ amount: 1, comment: "; verified = true" });
  });

  test("should reject a plus-signed amount", () => {
    const error = parseError(() => parseTransactionBlock(block("2026-01-05 * Shop\n    A    +45.00 EUR\n")));
    expect(error.reason).toContain("unsupported amount format");
  });

  test("should reject an amount without a leading digit", () => {
    const error = parseError(() => parseTransactionBlock(block("2026-01-05 * Shop\n    A    .50 EUR\n")));
    expect(error.reason).toContain("unsupported amount format");
  });
});

// ── Tag derivation (verified against hledger's own `ttags`) ─────────

describe("parseTransactionBlock() tag derivation", () => {
  function tagsOf(commentLine: string) {
    return parseTransactionBlock(block(`2026-01-05 * Shop\n    ${commentLine}\n    A    1.00 EUR\n`)).tags;
  }

  test("should split comma-separated tags on one line", () => {
    expect(tagsOf("; a: 1, b: 2")).toEqual([
      { name: "a", value: "1" },
      { name: "b", value: "2" },
    ]);
  });

  test("should derive a tag when there is no space after the colon", () => {
    expect(tagsOf("; ref:123")).toEqual([{ name: "ref", value: "123" }]);
  });

  test("should derive a tag from a word:value in the middle of comment text", () => {
    expect(tagsOf("; paid via card: visa")).toEqual([{ name: "card", value: "visa" }]);
  });

  test("should treat a URL as a tag, exactly as hledger does", () => {
    expect(tagsOf("; https://example.com")).toEqual([{ name: "https", value: "//example.com" }]);
  });

  test("should extend a tag value to the end of line, swallowing inner colons", () => {
    expect(tagsOf("; x: a b: c")).toEqual([{ name: "x", value: "a b: c" }]);
  });

  test("should treat an empty value before a comma as a value-less tag", () => {
    expect(tagsOf("; empty:, second: v")).toEqual([{ name: "empty" }, { name: "second", value: "v" }]);
  });

  test("should derive tags from the header comment too", () => {
    const tx = parseTransactionBlock(block("2026-01-05 * Shop  ; seen: bank\n    A    1.00 EUR\n    B\n"));
    expect(tx.tags).toEqual([{ name: "seen", value: "bank" }]);
  });
});

// ── parse → render fixpoint ─────────────────────────────────────────

// Rendering a parsed entry and parsing it back must yield the same objects:
// this is the property that makes canonical re-rendering (tidy) safe.
describe("parse → render fixpoint", () => {
  const FIXTURES: Array<[string, string]> = [
    [
      "canonical app transaction",
      formatTransaction({
        date: "2026-03-15",
        payee: "Whole Foods",
        description: "Groceries",
        postings: [
          { account: "Assets:Checking", amount: -45, currency: "USD" },
          { account: "Expenses:Food:Groceries", amount: 45, currency: "USD" },
        ],
        tags: [{ name: "source", value: "manual" }],
      }),
    ],
    [
      "kitchen sink",
      "2026-01-05 ! (42) Alpha | Beta  ; seen: bank\n  ; a: 1, b: 2\n  (Forecast)  -10.5 USD\n  Assets:Bank  0.00 EUR = 200.00 EUR  ; ok\n  Equity:Opening Balances\n",
    ],
    ["quoted commodity price", 'P 2026-03-15 "SOL2" 0.870 EUR\n'],
    ["unmarked date-only header", "2026-01-05\n    A    1 EUR\n    B\n"],
    ["BOM transaction", "\uFEFF2026-01-05 * Shop\n    A    1.00 EUR\n    B\n"],
  ];

  for (const [name, text] of FIXTURES) {
    test(`should reach a fixpoint for the ${name}`, () => {
      const original = block(text);
      if (original.kind === "price") {
        const parsed = parsePriceBlock(original);
        expect(parsePriceBlock(block(`${renderPrice(parsed)}\n`))).toEqual(parsed);
      } else {
        const parsed = parseTransactionBlock(original);
        expect(parseTransactionBlock(block(`${renderTransaction(parsed)}\n`))).toEqual(parsed);
      }
    });
  }
});
