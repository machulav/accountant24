import { describe, expect, test } from "bun:test";
import { assembleOutput, assembleWithoutTransactions, emitTransaction } from "../emit";
import type { ParsedBodyLine, Transaction } from "../types";

// ── Test helpers ─────────────────────────────────────────────────

const tx = (overrides: Partial<Transaction> = {}): Transaction => ({
  date: "2026-03-15",
  header: "2026-03-15 * Payee",
  body: [],
  preContent: [],
  ...overrides,
});

const posting = (
  indent: string,
  account: string,
  amount: string,
  digitsPrefixLength: number,
  isNegative: boolean,
): ParsedBodyLine => ({ kind: "posting", indent, account, amount, digitsPrefixLength, isNegative });

const balancing = (raw: string): ParsedBodyLine => ({ kind: "balancing", raw });
const metadata = (raw: string): ParsedBodyLine => ({ kind: "metadata", raw });

// ── emitTransaction() ────────────────────────────────────────────

describe("emitTransaction()", () => {
  test("should emit just the header for a transaction with an empty body", () => {
    expect(emitTransaction(tx(), [], 0)).toBe("2026-03-15 * Payee");
  });

  test("should emit a single posting with the alignment column padding", () => {
    // target 21 = 4 (indent) + 13 (Expenses:Food) + 0 (prefix) + 4 (MIN_GAP)
    const body: ParsedBodyLine[] = [posting("    ", "Expenses:Food", "45.00 USD", 0, false)];
    const expected = ["2026-03-15 * Payee", "    Expenses:Food    45.00 USD"].join("\n");
    expect(emitTransaction(tx(), body, 21)).toBe(expected);
  });

  test("should emit a single posting with padding derived from MIN_AMOUNT_COLUMN=70", () => {
    // target 70: padding = 70 - 4 - 13 - 0 = 53 spaces
    const body: ParsedBodyLine[] = [posting("    ", "Expenses:Food", "45.00 USD", 0, false)];
    const result = emitTransaction(tx(), body, 70);
    const postingLine = result.split("\n").find((l) => l.includes("Expenses:Food"))!;
    // First digit "4" of the amount lands at column 70 (0-indexed)
    expect(postingLine.indexOf("4")).toBe(70);
    expect(postingLine).toBe(`    Expenses:Food${" ".repeat(53)}45.00 USD`);
  });

  test("should put negative postings before positive postings (sign grouping)", () => {
    const body: ParsedBodyLine[] = [
      posting("    ", "Expenses:Food", "45.00 USD", 0, false),
      posting("    ", "Assets:Checking", "-45.00 USD", 1, true),
    ];
    const result = emitTransaction(tx(), body, 24);
    const checkingIdx = result.indexOf("Assets:Checking");
    const foodIdx = result.indexOf("Expenses:Food");
    expect(checkingIdx).toBeLessThan(foodIdx);
  });

  test("should put balancing postings last, after both sign groups", () => {
    const body: ParsedBodyLine[] = [
      balancing("    Assets:Savings"),
      posting("    ", "Expenses:Food", "45.00 USD", 0, false),
      posting("    ", "Assets:Checking", "-45.00 USD", 1, true),
    ];
    const result = emitTransaction(tx(), body, 24);
    const lines = result.split("\n");
    const savingsIdx = lines.findIndex((l) => l.includes("Assets:Savings"));
    const foodIdx = lines.findIndex((l) => l.includes("Expenses:Food"));
    const checkingIdx = lines.findIndex((l) => l.includes("Assets:Checking"));
    expect(checkingIdx).toBeLessThan(foodIdx);
    expect(foodIdx).toBeLessThan(savingsIdx);
  });

  test("should emit sorted tag-block after the header", () => {
    const body: ParsedBodyLine[] = [
      metadata("    ; weekly:"),
      metadata("    ; groceries:"),
      metadata("    ; source: manual"),
      posting("    ", "Expenses:Food", "45.00 USD", 0, false),
    ];
    const result = emitTransaction(tx(), body, 21);
    const lines = result.split("\n");
    expect(lines[0]).toBe("2026-03-15 * Payee");
    expect(lines[1]).toBe("    ; groceries:");
    expect(lines[2]).toBe("    ; source: manual");
    expect(lines[3]).toBe("    ; weekly:");
  });

  test("should split a comma-separated tag line into sorted individual lines", () => {
    const body: ParsedBodyLine[] = [
      metadata("    ; weekly:, groceries:"),
      posting("    ", "Expenses:Food", "45.00 USD", 0, false),
    ];
    const result = emitTransaction(tx(), body, 21);
    const lines = result.split("\n");
    expect(lines[1]).toBe("    ; groceries:");
    expect(lines[2]).toBe("    ; weekly:");
  });

  test("should emit preContent before the header with a blank-line separator", () => {
    const body: ParsedBodyLine[] = [posting("    ", "Expenses:Food", "45.00 USD", 0, false)];
    const result = emitTransaction(tx({ preContent: ["; section divider"] }), body, 21);
    const lines = result.split("\n");
    expect(lines[0]).toBe("; section divider");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("2026-03-15 * Payee");
  });

  test("should keep non-tag trailing comments attached to their posting under sign grouping", () => {
    // Expenses:Food (positive) has a trailing note. Assets:Checking is negative
    // and should sort BEFORE Expenses:Food. The note should travel with Food.
    const body: ParsedBodyLine[] = [
      posting("    ", "Expenses:Food", "45.00 USD", 0, false),
      metadata("    ; note about food"),
      posting("    ", "Assets:Checking", "-45.00 USD", 1, true),
    ];
    const result = emitTransaction(tx(), body, 24);
    const lines = result.split("\n");
    const foodIdx = lines.findIndex((l) => l.includes("Expenses:Food"));
    const noteIdx = lines.findIndex((l) => l.includes("; note about food"));
    expect(noteIdx).toBe(foodIdx + 1);
  });
});

// ── assembleOutput() ─────────────────────────────────────────────

describe("assembleOutput()", () => {
  test("should join transactions with a single blank line between them", () => {
    expect(assembleOutput([], ["tx1 line1\ntx1 line2", "tx2 line1"], [], false)).toBe(
      "tx1 line1\ntx1 line2\n\ntx2 line1",
    );
  });

  test("should prepend leading content with a blank-line separator before transactions", () => {
    expect(assembleOutput(["; top note"], ["2026-01-01 * A"], [], false)).toBe("; top note\n\n2026-01-01 * A");
  });

  test("should append trailing content with a blank-line separator after transactions", () => {
    expect(assembleOutput([], ["2026-01-01 * A"], ["; footer"], false)).toBe("2026-01-01 * A\n\n; footer");
  });

  test("should add a trailing newline when hadTrailingNewline is true", () => {
    expect(assembleOutput([], ["2026-01-01 * A"], [], true)).toBe("2026-01-01 * A\n");
  });

  test("should omit a trailing newline when hadTrailingNewline is false", () => {
    expect(assembleOutput([], ["2026-01-01 * A"], [], false)).toBe("2026-01-01 * A");
  });

  test("should handle leading + transactions + trailing + newline all together", () => {
    expect(assembleOutput(["; top"], ["2026-01-01 * A"], ["; bottom"], true)).toBe(
      "; top\n\n2026-01-01 * A\n\n; bottom\n",
    );
  });

  test("should handle multiple leading lines joined with \\n", () => {
    expect(assembleOutput(["; one", "; two"], ["2026-01-01 * A"], [], false)).toBe("; one\n; two\n\n2026-01-01 * A");
  });
});

// ── assembleWithoutTransactions() ────────────────────────────────

describe("assembleWithoutTransactions()", () => {
  test("should return the original content when leading is empty", () => {
    const original = "some content\n";
    expect(assembleWithoutTransactions([], true, original)).toBe(original);
  });

  test("should emit leading lines joined by \\n when there is leading content", () => {
    expect(assembleWithoutTransactions(["; one", "; two"], false, "ignored")).toBe("; one\n; two");
  });

  test("should append a trailing newline to the emitted leading content", () => {
    expect(assembleWithoutTransactions(["; one"], true, "ignored")).toBe("; one\n");
  });

  test("should not append a trailing newline when hadTrailingNewline is false", () => {
    expect(assembleWithoutTransactions(["; one"], false, "ignored")).toBe("; one");
  });
});
