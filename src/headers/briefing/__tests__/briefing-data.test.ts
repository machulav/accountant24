import { describe, expect, test } from "bun:test";
import { parseAmount, parseBalRows, parseBalTotal, parseCSVLine, parseRegisterCsv } from "../briefing-data.js";

describe("parseCSVLine", () => {
  test("simple fields", () => {
    expect(parseCSVLine('"account","balance"')).toEqual(["account", "balance"]);
  });

  test("unquoted fields", () => {
    expect(parseCSVLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  test("escaped quotes", () => {
    expect(parseCSVLine('"hello ""world""","test"')).toEqual(['hello "world"', "test"]);
  });

  test("comma in quoted field", () => {
    expect(parseCSVLine('"a,b","c"')).toEqual(["a,b", "c"]);
  });

  test("empty fields", () => {
    expect(parseCSVLine('"",""')).toEqual(["", ""]);
  });
});

describe("parseAmount", () => {
  test("number-first: positive with currency", () => {
    expect(parseAmount("100.00 USD")).toEqual({ amount: 100, currency: "USD" });
  });

  test("number-first: negative with currency", () => {
    expect(parseAmount("-50.00 USD")).toEqual({ amount: -50, currency: "USD" });
  });

  test("number-first: with thousand separators", () => {
    expect(parseAmount("1,234.56 USD")).toEqual({ amount: 1234.56, currency: "USD" });
  });

  test("commodity-first: EUR positive", () => {
    expect(parseAmount("EUR 323.47")).toEqual({ amount: 323.47, currency: "EUR" });
  });

  test("commodity-first: EUR negative", () => {
    expect(parseAmount("EUR -55.84")).toEqual({ amount: -55.84, currency: "EUR" });
  });

  test("commodity-first: symbol", () => {
    expect(parseAmount("$ 100.00")).toEqual({ amount: 100, currency: "$" });
  });

  test("commodity-first: with thousand separators", () => {
    expect(parseAmount("EUR 1,234.56")).toEqual({ amount: 1234.56, currency: "EUR" });
  });

  test("zero", () => {
    expect(parseAmount("0")).toEqual({ amount: 0, currency: "" });
  });

  test("empty string", () => {
    expect(parseAmount("")).toEqual({ amount: 0, currency: "" });
  });

  test("number only", () => {
    expect(parseAmount("42.50")).toEqual({ amount: 42.5, currency: "" });
  });
});

describe("parseBalTotal", () => {
  test("extracts total from balance CSV (lowercase)", () => {
    const csv = `"account","balance"
"Expenses:Food","100.00 USD"
"total","150.00 USD"`;
    expect(parseBalTotal(csv)).toEqual({ amount: 150, currency: "USD" });
  });

  test("extracts Total: from hledger CSV (capitalized with colon)", () => {
    const csv = `"account","balance"
"Expenses:Groceries","EUR 323.47"
"Total:","EUR 1639.14"`;
    expect(parseBalTotal(csv)).toEqual({ amount: 1639.14, currency: "EUR" });
  });

  test("returns null for empty CSV", () => {
    expect(parseBalTotal("")).toBeNull();
  });

  test("returns null when no total row", () => {
    const csv = `"account","balance"
"Expenses:Food","100.00 USD"`;
    expect(parseBalTotal(csv)).toBeNull();
  });

  test("handles negative total with commodity-first", () => {
    const csv = `"account","balance"
"Assets:Checking","EUR -133.77"
"Total:","EUR -413.77"`;
    expect(parseBalTotal(csv)).toEqual({ amount: -413.77, currency: "EUR" });
  });
});

describe("parseBalRows", () => {
  test("extracts account rows, skips header and total", () => {
    const csv = `"account","balance"
"Expenses:Food","100.00 USD"
"Expenses:Transport","50.00 USD"
"total","150.00 USD"`;
    expect(parseBalRows(csv)).toEqual([
      { name: "Expenses:Food", amount: 100, currency: "USD" },
      { name: "Expenses:Transport", amount: 50, currency: "USD" },
    ]);
  });

  test("skips Total: with colon", () => {
    const csv = `"account","balance"
"Expenses:Groceries","EUR 323.47"
"Total:","EUR 1639.14"`;
    expect(parseBalRows(csv)).toEqual([{ name: "Expenses:Groceries", amount: 323.47, currency: "EUR" }]);
  });

  test("returns empty for header-only CSV", () => {
    const csv = `"account","balance"`;
    expect(parseBalRows(csv)).toEqual([]);
  });
});

describe("parseRegisterCsv", () => {
  test("parses register rows with number-first amounts", () => {
    const csv = `"txnidx","date","code","description","account","amount","total"
"1","2026-03-01","","Whole Foods | Groceries","Expenses:Food:Groceries","45.00 USD","45.00 USD"
"1","2026-03-01","","Whole Foods | Groceries","Assets:Checking","-45.00 USD","0"`;
    const rows = parseRegisterCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].amount).toBe(45);
    expect(rows[0].currency).toBe("USD");
    expect(rows[1].amount).toBe(-45);
  });

  test("parses register rows with commodity-first amounts", () => {
    const csv = `"txnidx","date","code","description","account","amount","total"
"32","2026-03-19","","FRIDA |","Expenses:Food:Dining","EUR 50.00","EUR 50.00"
"32","2026-03-19","","FRIDA |","Assets:Checking","EUR -50.00","0"`;
    const rows = parseRegisterCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      txnidx: "32",
      date: "2026-03-19",
      description: "FRIDA |",
      account: "Expenses:Food:Dining",
      amount: 50,
      currency: "EUR",
    });
    expect(rows[1].amount).toBe(-50);
  });

  test("skips header row", () => {
    const csv = `"txnidx","date","code","description","account","amount","total"`;
    expect(parseRegisterCsv(csv)).toEqual([]);
  });

  test("returns empty for empty input", () => {
    expect(parseRegisterCsv("")).toEqual([]);
  });
});
