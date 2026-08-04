import { describe, expect, test } from "vitest";
import { tidyJournal } from "../tidy";

// Sloppy 2-space-indent inputs and their canonical renderings.
const RENT = "2026-03-20 * Rent\n  Expenses:Rent  900.00 USD\n  Assets:Bank\n";
const SHOP = "2026-03-05 * Shop\n  Expenses:Food  45.00 USD\n  Assets:Cash\n";
const CANON_RENT = `2026-03-20 * Rent\n    Expenses:Rent${" ".repeat(52)}900.00 USD\n    Assets:Bank\n`;
const CANON_SHOP = `2026-03-05 * Shop\n    Expenses:Food${" ".repeat(52)}45.00 USD\n    Assets:Cash\n`;

describe("tidyJournal()", () => {
  test("should sort entries by date and re-render them canonically", () => {
    const result = tidyJournal(`${RENT}\n${SHOP}`);
    expect(result.text).toBe(`${CANON_SHOP}\n${CANON_RENT}`);
    expect(result.skippedBlocks).toEqual([]);
  });

  test("should keep same-date entries in their original relative order", () => {
    const first = "2026-03-05 * First\n  Expenses:A  1.00 USD\n  Assets:Cash\n";
    const second = "2026-03-05 * Second\n  Expenses:B  2.00 USD\n  Assets:Cash\n";
    const result = tidyJournal(`${first}\n${second}`);
    const firstIdx = result.text.indexOf("First");
    const secondIdx = result.text.indexOf("Second");
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  test("should move a glued comment together with its entry", () => {
    const result = tidyJournal(`${RENT}\n; food note\n${SHOP}`);
    expect(result.text).toBe(`; food note\n${CANON_SHOP}\n${CANON_RENT}`);
  });

  test("should not sort entries across a directive barrier", () => {
    const result = tidyJournal(`${RENT}\ninclude other.journal\n\n${SHOP}`);
    expect(result.text).toBe(`${CANON_RENT}\ninclude other.journal\n\n${CANON_SHOP}`);
  });

  test("should keep an unparseable entry verbatim as a barrier and report it", () => {
    const weird = "2026-03-10 * Weird\n    Assets:X    1 BTC @ 55000 EUR\n";
    const result = tidyJournal(`${RENT}\n${weird}\n${SHOP}`);
    expect(result.text).toBe(`${CANON_RENT}\n${weird}\n${CANON_SHOP}`);
    expect(result.skippedBlocks).toEqual([{ startLine: 5, reason: "cost notation (@) is not supported" }]);
  });

  test("should keep a glued comment verbatim together with its unparseable entry", () => {
    const weird = "2026-03-10 * Weird\n    Assets:X    1 BTC @ 55000 EUR\n";
    const result = tidyJournal(`${RENT}\n; note for weird\n${weird}\n${SHOP}`);
    expect(result.text).toBe(`${CANON_RENT}\n; note for weird\n${weird}\n${CANON_SHOP}`);
    expect(result.skippedBlocks).toEqual([{ startLine: 6, reason: "cost notation (@) is not supported" }]);
  });

  test("should normalize multiple blank lines between entries to one", () => {
    const result = tidyJournal(`${SHOP}\n\n\n${RENT}`);
    expect(result.text).toBe(`${CANON_SHOP}\n${CANON_RENT}`);
  });

  test("should preserve the prologue byte-for-byte, including adjacent directives", () => {
    const prologue = "; Accountant24\n\ninclude commodities.journal\ninclude accounts.journal\n";
    const result = tidyJournal(`${prologue}\n${SHOP}`);
    expect(result.text).toBe(`${prologue}\n${CANON_SHOP}`);
  });

  test("should keep a trailing standalone comment at the end of the file", () => {
    const result = tidyJournal(`${RENT}\n${SHOP}\n\n; end of month\n`);
    expect(result.text).toBe(`${CANON_SHOP}\n${CANON_RENT}\n; end of month\n`);
  });

  test("should sort P directives among transactions by date", () => {
    const result = tidyJournal(`${RENT}\nP 2026-03-10 USD 0.87 EUR\n`);
    expect(result.text).toBe(`P 2026-03-10 USD 0.87 EUR\n\n${CANON_RENT}`);
  });

  test("should be idempotent", () => {
    const once = tidyJournal(`${RENT}\n; food note\n${SHOP}\n\n\ninclude other.journal\n`);
    const twice = tidyJournal(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.skippedBlocks).toEqual([]);
  });

  test("should return empty output for an empty file", () => {
    expect(tidyJournal("")).toEqual({ text: "", skippedBlocks: [] });
  });

  test("should render sorted entries with CRLF when the file uses CRLF", () => {
    const crlf = `${RENT}\n${SHOP}`.replace(/\n/g, "\r\n");
    const result = tidyJournal(crlf);
    expect(result.text).toBe(`${CANON_SHOP}\n${CANON_RENT}`.replace(/\n/g, "\r\n"));
  });

  test("should add a trailing newline when the file lacks one", () => {
    const result = tidyJournal(SHOP.trimEnd());
    expect(result.text).toBe(CANON_SHOP);
  });

  test("should move a glued comment together with its P directive", () => {
    const result = tidyJournal(`${RENT}\n; fx note\nP 2026-03-10 USD 0.87 EUR\n`);
    expect(result.text).toBe(`; fx note\nP 2026-03-10 USD 0.87 EUR\n\n${CANON_RENT}`);
  });

  test("should drop leading blank lines", () => {
    expect(tidyJournal(`\n\n${SHOP}`).text).toBe(CANON_SHOP);
  });

  test("should produce empty output for a blanks-only file", () => {
    expect(tidyJournal("\n\n\n")).toEqual({ text: "", skippedBlocks: [] });
  });

  test("should keep same-date entries in order even when interleaved with other dates", () => {
    const a1 = "2026-03-05 * First\n  Expenses:A  1.00 USD\n  Assets:Cash\n";
    const a2 = "2026-03-05 * Second\n  Expenses:B  2.00 USD\n  Assets:Cash\n";
    const b = "2026-03-10 * Middle\n  Expenses:C  3.00 USD\n  Assets:Cash\n";
    const result = tidyJournal(`${RENT}\n${a1}\n${b}\n${a2}`);
    const order = ["First", "Second", "Middle", "Rent"].map((payee) => result.text.indexOf(payee));
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(order.every((idx) => idx >= 0)).toBe(true);
  });

  test("should stay idempotent when skipped blocks and glued comments are present", () => {
    const weird = "2026-03-10 * Weird\n    Assets:X    1 BTC @ 55000 EUR\n";
    const once = tidyJournal(`${RENT}\n; note\n${weird}\n${SHOP}`);
    const twice = tidyJournal(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.skippedBlocks.map((s) => s.reason)).toEqual(["cost notation (@) is not supported"]);
  });

  test("should normalize a BOM-prefixed journal, dropping the BOM", () => {
    // hledger accepts the BOM; the canonical form simply does not carry one.
    const result = tidyJournal(`\uFEFF${SHOP}`);
    expect(result.text).toBe(CANON_SHOP);
    expect(result.skippedBlocks).toEqual([]);
  });
});
