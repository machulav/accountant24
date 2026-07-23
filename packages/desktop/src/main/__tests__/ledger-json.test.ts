import { describe, expect, it } from "vitest";
import {
  mergeValuedBalanceSheet,
  parseAssertionDates,
  parseBalanceSheetJson,
  type RawBalanceSheet,
} from "../ledger-json";

// parseBalanceSheetJson turns `hledger bs -O json` output into sections and
// the net row the Balance Sheet view renders. Fixtures follow the documented
// compound-report shape: `{ cbrSubreports: [[name, periodicReport, bool]],
// cbrTotals: netRow }`, periodicReport = { prRows, prTotals }, row =
// { prrName, prrAmounts: [columnAmounts] }; expected values are hardcoded,
// never derived from the parser itself.

const amt = (commodity: string, floatingPoint: number, decimalPlaces: number | undefined = 2) => ({
  acommodity: commodity,
  aquantity: { decimalMantissa: 0, decimalPlaces, floatingPoint },
  astyle: { asprecision: decimalPlaces },
});
const prow = (name: string, amounts: unknown[]) => ({ prrName: name, prrAmounts: [amounts] });
const preport = (rows: unknown[], totals: unknown[]) => ({ prRows: rows, prTotals: { prrAmounts: [totals] } });
const compound = (subreports: [string, unknown][], net: unknown[]) =>
  JSON.stringify({ cbrSubreports: subreports.map(([name, r]) => [name, r, true]), cbrTotals: { prrAmounts: [net] } });

describe("parseBalanceSheetJson()", () => {
  it("should return null for an empty string", () => {
    expect(parseBalanceSheetJson("")).toBeNull();
  });

  it("should return null for non-JSON garbage", () => {
    expect(parseBalanceSheetJson("hledger: error: no journal file\n")).toBeNull();
  });

  it("should return null for JSON that is not the compound report shape", () => {
    expect(parseBalanceSheetJson('{"rows": []}')).toBeNull();
    expect(parseBalanceSheetJson("[1, 2]")).toBeNull();
  });

  it("should parse sections with their rows, totals, and the net", () => {
    const json = compound(
      [
        ["Assets", preport([prow("assets:bank:checking", [amt("EUR", 2950.5)])], [amt("EUR", 2950.5)])],
        ["Liabilities", preport([prow("liabilities:card", [amt("EUR", 300)])], [amt("EUR", 300)])],
      ],
      [amt("EUR", 2650.5)],
    );
    expect(parseBalanceSheetJson(json)).toEqual({
      sections: [
        {
          name: "Assets",
          rows: [{ name: "assets:bank:checking", amounts: [{ quantity: 2950.5, commodity: "EUR", precision: 2 }] }],
          total: [{ quantity: 2950.5, commodity: "EUR", precision: 2 }],
        },
        {
          name: "Liabilities",
          rows: [{ name: "liabilities:card", amounts: [{ quantity: 300, commodity: "EUR", precision: 2 }] }],
          total: [{ quantity: 300, commodity: "EUR", precision: 2 }],
        },
      ],
      net: [{ quantity: 2650.5, commodity: "EUR", precision: 2 }],
    });
  });

  it("should preserve hledger's row order, not sort", () => {
    const json = compound(
      [["Assets", preport([prow("assets:z", [amt("EUR", 1)]), prow("assets:a", [amt("EUR", 2)])], [amt("EUR", 3)])]],
      [amt("EUR", 3)],
    );
    expect(parseBalanceSheetJson(json)?.sections[0]?.rows.map((r) => r.name)).toEqual(["assets:z", "assets:a"]);
  });

  it("should keep every commodity of a multi-commodity balance", () => {
    const json = compound([["Assets", preport([prow("assets:cash", [amt("UAH", 1408.26), amt("USD", 100)])], [])]], []);
    expect(parseBalanceSheetJson(json)?.sections[0]?.rows[0]?.amounts).toEqual([
      { quantity: 1408.26, commodity: "UAH", precision: 2 },
      { quantity: 100, commodity: "USD", precision: 2 },
    ]);
  });

  it("should merge cost lots of the same commodity into one amount (like hledger's own display)", () => {
    const json = compound(
      [["Assets", preport([prow("assets:mono:eur", [amt("EUR", 4758.22), amt("EUR", -147.12)])], [])]],
      [],
    );
    expect(parseBalanceSheetJson(json)?.sections[0]?.rows[0]?.amounts).toEqual([
      { quantity: 4611.1, commodity: "EUR", precision: 2 },
    ]);
  });

  it("should keep a section with no rows (an empty side of the sheet)", () => {
    const json = compound([["Liabilities", preport([], [])]], []);
    expect(parseBalanceSheetJson(json)?.sections).toEqual([{ name: "Liabilities", rows: [], total: [] }]);
  });

  it("should give an empty total to a section without prTotals", () => {
    const json = JSON.stringify({
      cbrSubreports: [["Assets", { prRows: [prow("assets", [amt("EUR", 1)])] }, true]],
      cbrTotals: { prrAmounts: [[]] },
    });
    expect(parseBalanceSheetJson(json)?.sections[0]?.total).toEqual([]);
  });

  it("should skip malformed subreports and rows but keep the valid ones", () => {
    const json = JSON.stringify({
      cbrSubreports: [
        "not a subreport",
        [42, { prRows: [] }, true],
        [
          "Assets",
          { prRows: ["not a row", { prrAmounts: [[amt("EUR", 1)]] }, prow("assets:ok", [amt("EUR", 7)])] },
          true,
        ],
      ],
      cbrTotals: { prrAmounts: [[amt("EUR", 7)]] },
    });
    expect(parseBalanceSheetJson(json)).toEqual({
      sections: [
        {
          name: "Assets",
          rows: [{ name: "assets:ok", amounts: [{ quantity: 7, commodity: "EUR", precision: 2 }] }],
          total: [],
        },
      ],
      net: [{ quantity: 7, commodity: "EUR", precision: 2 }],
    });
  });

  it("should drop amounts without a finite quantity or a commodity", () => {
    const bad1 = { acommodity: "EUR", aquantity: { decimalPlaces: 2 } };
    const bad2 = { aquantity: { floatingPoint: 5, decimalPlaces: 2 } };
    const json = compound([["Assets", preport([prow("assets", [bad1, bad2, amt("EUR", 7)])], [])]], []);
    expect(parseBalanceSheetJson(json)?.sections[0]?.rows[0]?.amounts).toEqual([
      { quantity: 7, commodity: "EUR", precision: 2 },
    ]);
  });

  it("should default a missing or negative precision to 2", () => {
    const noStyle = {
      acommodity: "EUR",
      aquantity: { decimalMantissa: 0, decimalPlaces: undefined, floatingPoint: 1 },
    };
    const json = compound([["Assets", preport([prow("a", [noStyle]), prow("b", [amt("EUR", 1, -3)])], [])]], []);
    expect(parseBalanceSheetJson(json)?.sections[0]?.rows.map((r) => r.amounts[0]?.precision)).toEqual([2, 2]);
  });

  it("should keep a single zero amount when the whole balance is zero", () => {
    const json = compound([["Assets", preport([prow("closed", [amt("EUR", 300), amt("EUR", -300)])], [])]], []);
    expect(parseBalanceSheetJson(json)?.sections[0]?.rows[0]?.amounts).toEqual([
      { quantity: 0, commodity: "EUR", precision: 2 },
    ]);
  });

  it("should treat float dust from summed lots as zero and drop zero legs when other amounts remain", () => {
    const json = compound(
      [
        [
          "Assets",
          preport(
            [
              prow("dust", [amt("EUR", 0.1), amt("EUR", 0.2), amt("EUR", -0.3)]),
              prow("paypal", [amt("EUR", 0), amt("UAH", 521.72)]),
            ],
            [],
          ),
        ],
      ],
      [],
    );
    const rows = parseBalanceSheetJson(json)?.sections[0]?.rows;
    expect(rows?.[0]?.amounts).toEqual([{ quantity: 0, commodity: "EUR", precision: 2 }]);
    expect(rows?.[1]?.amounts).toEqual([{ quantity: 521.72, commodity: "UAH", precision: 2 }]);
  });

  it("should skip rows with empty names and treat missing prRows as an empty section", () => {
    const json = JSON.stringify({
      cbrSubreports: [
        ["", { prRows: [prow("assets:x", [amt("EUR", 1)])] }, true],
        ["Assets", { prRows: [prow("", [amt("EUR", 1)]), prow("assets:ok", [amt("EUR", 2)])] }, true],
        ["Liabilities", {}, false],
      ],
      cbrTotals: { prrAmounts: [[]] },
    });
    expect(parseBalanceSheetJson(json)?.sections).toEqual([
      {
        name: "Assets",
        rows: [{ name: "assets:ok", amounts: [{ quantity: 2, commodity: "EUR", precision: 2 }] }],
        total: [],
      },
      { name: "Liabilities", rows: [], total: [] },
    ]);
  });
});

describe("mergeValuedBalanceSheet()", () => {
  const A = (commodity: string, quantity: number): { quantity: number; commodity: string; precision: number } => ({
    quantity,
    commodity,
    precision: 2,
  });
  const raw: RawBalanceSheet = {
    sections: [
      { name: "Assets", rows: [{ name: "assets:btc", amounts: [A("BTC", 0.16)] }], total: [A("BTC", 0.16)] },
      { name: "Liabilities", rows: [{ name: "liabilities:card", amounts: [A("EUR", 300)] }], total: [A("EUR", 300)] },
    ],
    net: [A("BTC", 0.16), A("EUR", -300)],
  };

  it("should attach each valued figure to its raw counterpart by position", () => {
    const valued: RawBalanceSheet = {
      sections: [
        { name: "Assets", rows: [{ name: "assets:btc", amounts: [A("EUR", 9990)] }], total: [A("EUR", 9990)] },
        { name: "Liabilities", rows: [{ name: "liabilities:card", amounts: [A("EUR", 300)] }], total: [A("EUR", 300)] },
      ],
      net: [A("EUR", 9690)],
    };
    expect(mergeValuedBalanceSheet(raw, valued)).toEqual({
      sections: [
        {
          name: "Assets",
          rows: [{ name: "assets:btc", amounts: [A("BTC", 0.16)], value: [A("EUR", 9990)] }],
          total: { amounts: [A("BTC", 0.16)], value: [A("EUR", 9990)] },
        },
        {
          name: "Liabilities",
          rows: [{ name: "liabilities:card", amounts: [A("EUR", 300)], value: [A("EUR", 300)] }],
          total: { amounts: [A("EUR", 300)], value: [A("EUR", 300)] },
        },
      ],
      net: { amounts: [A("BTC", 0.16), A("EUR", -300)], value: [A("EUR", 9690)] },
    });
  });

  it("should fall back to the raw amounts everywhere when the valued run is null", () => {
    const merged = mergeValuedBalanceSheet(raw, null);
    expect(merged.sections[0]?.rows[0]?.value).toEqual([A("BTC", 0.16)]);
    expect(merged.sections[0]?.total.value).toEqual([A("BTC", 0.16)]);
    expect(merged.net.value).toEqual([A("BTC", 0.16), A("EUR", -300)]);
  });

  it("should fall back for a row whose valued counterpart names a different account", () => {
    const valued: RawBalanceSheet = {
      sections: [
        { name: "Assets", rows: [{ name: "assets:other", amounts: [A("EUR", 1)] }], total: [A("EUR", 1)] },
        { name: "Liabilities", rows: [{ name: "liabilities:card", amounts: [A("EUR", 300)] }], total: [A("EUR", 300)] },
      ],
      net: [A("EUR", 1)],
    };
    expect(mergeValuedBalanceSheet(raw, valued).sections[0]?.rows[0]?.value).toEqual([A("BTC", 0.16)]);
  });

  it("should fall back for a whole section whose valued counterpart has a different name", () => {
    const valued: RawBalanceSheet = {
      sections: [{ name: "Equity", rows: [{ name: "assets:btc", amounts: [A("EUR", 1)] }], total: [A("EUR", 1)] }],
      net: [A("EUR", 1)],
    };
    const merged = mergeValuedBalanceSheet(raw, valued);
    expect(merged.sections[0]?.rows[0]?.value).toEqual([A("BTC", 0.16)]);
    expect(merged.sections[0]?.total.value).toEqual([A("BTC", 0.16)]);
  });
});

// parseAssertionDates turns `hledger print -O json` output (an array of
// transactions with postings; a posting carrying `pbalanceassertion` asserts
// its account's balance on that date) into each account's latest assertion
// date. Fixtures follow the documented shape.

describe("parseAssertionDates()", () => {
  const posting = (account: string, asserted: boolean, pdate: string | null = null) => ({
    paccount: account,
    pdate,
    pbalanceassertion: asserted ? { baamount: {}, batotal: false } : null,
  });
  const txn = (date: string, postings: unknown[]) => ({ tdate: date, tpostings: postings });

  it("should return {} for an empty string, garbage, or a non-array", () => {
    expect(parseAssertionDates("")).toEqual({});
    expect(parseAssertionDates("hledger: error")).toEqual({});
    expect(parseAssertionDates('{"a": 1}')).toEqual({});
  });

  it("should return {} when no posting carries an assertion", () => {
    const json = JSON.stringify([txn("2026-06-01", [posting("assets:bank", false)])]);
    expect(parseAssertionDates(json)).toEqual({});
  });

  it("should record the transaction date of an asserting posting", () => {
    const json = JSON.stringify([txn("2026-06-15", [posting("assets:bank", true), posting("equity", false)])]);
    expect(parseAssertionDates(json)).toEqual({ "assets:bank": "2026-06-15" });
  });

  it("should prefer the posting's own date over the transaction's", () => {
    const json = JSON.stringify([txn("2026-07-10", [posting("assets:bank", true, "2026-07-12")])]);
    expect(parseAssertionDates(json)).toEqual({ "assets:bank": "2026-07-12" });
  });

  it("should keep the latest date per account regardless of journal order", () => {
    const json = JSON.stringify([
      txn("2026-07-01", [posting("assets:bank", true)]),
      txn("2026-06-15", [posting("assets:bank", true)]),
      txn("2026-05-01", [posting("assets:cash", true)]),
    ]);
    expect(parseAssertionDates(json)).toEqual({ "assets:bank": "2026-07-01", "assets:cash": "2026-05-01" });
  });

  it("should skip malformed transactions and postings but keep the valid ones", () => {
    const json = JSON.stringify([
      "not a transaction",
      { tdate: "2026-06-01" },
      txn("2026-06-02", ["not a posting", { pbalanceassertion: {}, paccount: "" }, posting("assets:ok", true)]),
      { tpostings: [posting("assets:dateless", true)] },
    ]);
    expect(parseAssertionDates(json)).toEqual({ "assets:ok": "2026-06-02" });
  });
});
