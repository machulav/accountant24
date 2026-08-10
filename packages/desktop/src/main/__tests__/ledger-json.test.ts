import { describe, expect, it } from "vitest";
import {
  mergeValuedBalanceSheet,
  parseAssertions,
  parseBalanceSheetJson,
  parseLatestPriceTarget,
  parseTransactionsJson,
  type RawBalanceSheet,
} from "../ledger-json";

// parseBalanceSheetJson turns `hledger bs -O json` output into sections and
// the net row the Net Worth view renders. Fixtures follow the documented
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

// parseAssertions turns `hledger print -O json` output (an array of
// transactions with postings; a posting carrying `pbalanceassertion` asserts
// its account's balance on that date) into each account's latest assertion:
// its date and the asserted amount. Fixtures follow the documented shape.

describe("parseAssertions()", () => {
  const posting = (
    account: string,
    asserted: boolean,
    pdate: string | null = null,
    baamount: unknown = amt("EUR", 200),
  ) => ({
    paccount: account,
    pdate,
    pbalanceassertion: asserted ? { baamount, batotal: false } : null,
  });
  const txn = (date: string, postings: unknown[]) => ({ tdate: date, tpostings: postings });
  // What the default `baamount` fixture must parse to.
  const EUR200 = { commodity: "EUR", quantity: 200, precision: 2 };

  it("should return {} for an empty string, garbage, or a non-array", () => {
    expect(parseAssertions("")).toEqual({});
    expect(parseAssertions("hledger: error")).toEqual({});
    expect(parseAssertions('{"a": 1}')).toEqual({});
  });

  it("should return {} when no posting carries an assertion", () => {
    const json = JSON.stringify([txn("2026-06-01", [posting("assets:bank", false)])]);
    expect(parseAssertions(json)).toEqual({});
  });

  it("should record the transaction date of an asserting posting", () => {
    const json = JSON.stringify([txn("2026-06-15", [posting("assets:bank", true), posting("equity", false)])]);
    expect(parseAssertions(json)).toEqual({ "assets:bank": { date: "2026-06-15", amount: EUR200 } });
  });

  it("should parse the asserted amount off the asserting posting", () => {
    const json = JSON.stringify([txn("2026-06-15", [posting("assets:btc", true, null, amt("BTC", 0.16, 8))])]);
    expect(parseAssertions(json)).toEqual({
      "assets:btc": { date: "2026-06-15", amount: { commodity: "BTC", quantity: 0.16, precision: 8 } },
    });
  });

  it("should default the amount's precision to 2 when the journal declares none", () => {
    const bare = { acommodity: "EUR", aquantity: { floatingPoint: 77 } };
    const json = JSON.stringify([txn("2026-06-15", [posting("assets:bank", true, null, bare)])]);
    expect(parseAssertions(json)).toEqual({
      "assets:bank": { date: "2026-06-15", amount: { commodity: "EUR", quantity: 77, precision: 2 } },
    });
  });

  it("should record a null amount when the assertion's amount is missing or malformed, keeping the date", () => {
    const json = JSON.stringify([
      // An assertion object with no baamount at all.
      txn("2026-06-15", [{ paccount: "assets:bare", pdate: null, pbalanceassertion: { batotal: false } }]),
      txn("2026-06-16", [posting("assets:odd", true, null, { acommodity: 5 })]),
    ]);
    expect(parseAssertions(json)).toEqual({
      "assets:bare": { date: "2026-06-15", amount: null },
      "assets:odd": { date: "2026-06-16", amount: null },
    });
  });

  it("should prefer the posting's own date over the transaction's", () => {
    const json = JSON.stringify([txn("2026-07-10", [posting("assets:bank", true, "2026-07-12")])]);
    expect(parseAssertions(json)).toEqual({ "assets:bank": { date: "2026-07-12", amount: EUR200 } });
  });

  it("should keep the latest date per account regardless of journal order", () => {
    const json = JSON.stringify([
      txn("2026-07-01", [posting("assets:bank", true)]),
      txn("2026-06-15", [posting("assets:bank", true)]),
      txn("2026-05-01", [posting("assets:cash", true)]),
    ]);
    expect(parseAssertions(json)).toEqual({
      "assets:bank": { date: "2026-07-01", amount: EUR200 },
      "assets:cash": { date: "2026-05-01", amount: EUR200 },
    });
  });

  it("should carry the amount together with the latest date when assertions repeat", () => {
    // Journal order deliberately newest-first: the winning record must take
    // BOTH its date and its amount from the same (latest) posting.
    const json = JSON.stringify([
      txn("2026-07-01", [posting("assets:bank", true, null, amt("EUR", 250))]),
      txn("2026-06-01", [posting("assets:bank", true, null, amt("EUR", 100))]),
    ]);
    expect(parseAssertions(json)).toEqual({
      "assets:bank": { date: "2026-07-01", amount: { commodity: "EUR", quantity: 250, precision: 2 } },
    });
  });

  it("should skip malformed transactions and postings but keep the valid ones", () => {
    const json = JSON.stringify([
      "not a transaction",
      { tdate: "2026-06-01" },
      txn("2026-06-02", ["not a posting", { pbalanceassertion: {}, paccount: "" }, posting("assets:ok", true)]),
      { tpostings: [posting("assets:dateless", true)] },
    ]);
    expect(parseAssertions(json)).toEqual({ "assets:ok": { date: "2026-06-02", amount: EUR200 } });
  });
});

// parseTransactionsJson turns `hledger print -O json` output (an array of
// transactions, each with postings) into the Transactions view's rows:
// journal order preserved, "Payee | note" descriptions split on the first
// pipe, tags as name/value pairs, posting cost lots merged per commodity.

describe("parseTransactionsJson()", () => {
  const tposting = (account: string, amounts: unknown[], asserted = false) => ({
    paccount: account,
    pamount: amounts,
    pbalanceassertion: asserted ? { baamount: {}, batotal: false } : null,
  });
  const tx = (over: Record<string, unknown> = {}) => ({
    tindex: 1,
    tdate: "2026-01-05",
    tdescription: "Grocery Store | weekly shop",
    tstatus: "Cleared",
    ttags: [],
    tpostings: [],
    ...over,
  });

  it("should return [] for an empty string, garbage, or a non-array", () => {
    expect(parseTransactionsJson("")).toEqual([]);
    expect(parseTransactionsJson("hledger: error: no journal file\n")).toEqual([]);
    expect(parseTransactionsJson('{"a": 1}')).toEqual([]);
  });

  it("should parse a full transaction with split description, tags, and postings", () => {
    const json = JSON.stringify([
      tx({
        ttags: [["category", "groceries"]],
        tpostings: [tposting("expenses:food", [amt("EUR", 12.5)]), tposting("assets:cash", [amt("EUR", -12.5)])],
      }),
    ]);
    expect(parseTransactionsJson(json)).toEqual([
      {
        index: 1,
        date: "2026-01-05",
        payee: "Grocery Store",
        note: "weekly shop",
        status: "Cleared",
        tags: [{ name: "category", value: "groceries" }],
        postings: [
          { account: "expenses:food", amounts: [{ quantity: 12.5, commodity: "EUR", precision: 2 }] },
          { account: "assets:cash", amounts: [{ quantity: -12.5, commodity: "EUR", precision: 2 }] },
        ],
      },
    ]);
  });

  it("should keep the whole description as the payee when it has no pipe", () => {
    const json = JSON.stringify([tx({ tdescription: "Landlord" })]);
    expect(parseTransactionsJson(json)[0]).toMatchObject({ payee: "Landlord", note: "" });
  });

  it("should split the description only on the first pipe", () => {
    const json = JSON.stringify([tx({ tdescription: "Cafe | lunch | with team" })]);
    expect(parseTransactionsJson(json)[0]).toMatchObject({ payee: "Cafe", note: "lunch | with team" });
  });

  it("should give no postings to a transaction whose tpostings is not an array", () => {
    const json = JSON.stringify([tx({ tpostings: "not postings" })]);
    expect(parseTransactionsJson(json)[0]?.postings).toEqual([]);
  });

  it("should give a bare tag an empty value and skip malformed tags", () => {
    const json = JSON.stringify([
      tx({ ttags: [["reviewed"], ["", "x"], "not a tag", ["count", 42], ["kind", "food"]] }),
    ]);
    expect(parseTransactionsJson(json)[0]?.tags).toEqual([
      { name: "reviewed", value: "" },
      { name: "count", value: "" },
      { name: "kind", value: "food" },
    ]);
  });

  it("should pass Pending through and read unknown or missing statuses as Unmarked", () => {
    const json = JSON.stringify([
      tx({ tstatus: "Pending" }),
      tx({ tstatus: "Unmarked" }),
      tx({ tstatus: "Wired" }),
      tx({ tstatus: undefined }),
    ]);
    expect(parseTransactionsJson(json).map((t) => t.status)).toEqual(["Pending", "Unmarked", "Unmarked", "Unmarked"]);
  });

  it("should merge cost lots of a posting into one amount per commodity", () => {
    const json = JSON.stringify([tx({ tpostings: [tposting("assets:broker", [amt("USD", 100), amt("USD", 150)])] })]);
    expect(parseTransactionsJson(json)[0]?.postings[0]?.amounts).toEqual([
      { quantity: 250, commodity: "USD", precision: 2 },
    ]);
  });

  it("should keep every commodity of a multi-commodity posting", () => {
    const json = JSON.stringify([tx({ tpostings: [tposting("assets:cash", [amt("UAH", 1408.26), amt("USD", 100)])] })]);
    expect(parseTransactionsJson(json)[0]?.postings[0]?.amounts).toEqual([
      { quantity: 1408.26, commodity: "UAH", precision: 2 },
      { quantity: 100, commodity: "USD", precision: 2 },
    ]);
  });

  it("should keep a single zero amount for a zero posting without an assertion", () => {
    const json = JSON.stringify([tx({ tpostings: [tposting("assets:bank", [amt("EUR", 0)])] })]);
    expect(parseTransactionsJson(json)[0]?.postings[0]?.amounts).toEqual([
      { quantity: 0, commodity: "EUR", precision: 2 },
    ]);
  });

  it("should hide an assertion-only entry (every posting zero, at least one asserting)", () => {
    // The agent's standalone Balance Assertion rows: a reconciliation mark,
    // not money movement.
    const json = JSON.stringify([
      tx({ tdescription: "Balance Assertion", tpostings: [tposting("assets:bank", [amt("EUR", 0)], true)] }),
      tx({ tindex: 2 }),
    ]);
    expect(parseTransactionsJson(json).map((t) => t.index)).toEqual([2]);
  });

  it("should keep a transaction that moves money even when a posting asserts a balance", () => {
    const json = JSON.stringify([
      tx({
        tpostings: [tposting("expenses:food", [amt("EUR", 12.5)]), tposting("assets:cash", [amt("EUR", -12.5)], true)],
      }),
    ]);
    expect(parseTransactionsJson(json)).toHaveLength(1);
  });

  it("should skip postings without an account and give no amounts to a missing pamount", () => {
    const json = JSON.stringify([
      tx({ tpostings: ["not a posting", { paccount: "" }, { paccount: "equity:opening" }, tposting("assets:ok", [])] }),
    ]);
    expect(parseTransactionsJson(json)[0]?.postings).toEqual([
      { account: "equity:opening", amounts: [] },
      { account: "assets:ok", amounts: [] },
    ]);
  });

  it("should skip transactions missing the index, date, or description but keep the valid ones", () => {
    const json = JSON.stringify([
      "not a transaction",
      tx({ tindex: undefined }),
      tx({ tdate: "" }),
      tx({ tdescription: undefined }),
      tx({ tdescription: "" }),
    ]);
    expect(parseTransactionsJson(json)).toEqual([
      { index: 1, date: "2026-01-05", payee: "", note: "", status: "Cleared", tags: [], postings: [] },
    ]);
  });

  it("should preserve journal order and carry each transaction's index", () => {
    const json = JSON.stringify([
      tx({ tindex: 1, tdate: "2026-03-01" }),
      tx({ tindex: 2, tdate: "2026-01-15" }),
      tx({ tindex: 3, tdate: "2026-02-20" }),
    ]);
    expect(parseTransactionsJson(json).map((t) => [t.index, t.date])).toEqual([
      [1, "2026-03-01"],
      [2, "2026-01-15"],
      [3, "2026-02-20"],
    ]);
  });
});

// parseLatestPriceTarget reads the journal's de-facto base commodity off
// plain `hledger prices` output: the target commodity of the last (latest)
// declared price, whatever display style the journal gives the amount.

describe("parseLatestPriceTarget()", () => {
  it("should return null for empty output", () => {
    expect(parseLatestPriceTarget("")).toBeNull();
    expect(parseLatestPriceTarget("\n\n")).toBeNull();
  });

  it("should return null for a non-directive line", () => {
    expect(parseLatestPriceTarget("hledger: error: no journal")).toBeNull();
  });

  it("should read a right-side commodity code", () => {
    expect(parseLatestPriceTarget("P 2026-07-22 UAH 0.01958 EUR")).toBe("EUR");
  });

  it("should read a left-glued commodity code", () => {
    expect(parseLatestPriceTarget("P 2026-07-22 UAH EUR0.01958")).toBe("EUR");
  });

  it("should read a bare currency symbol", () => {
    expect(parseLatestPriceTarget("P 2026-07-22 UAH \u20ac0.02")).toBe("\u20ac");
  });

  it("should survive digit grouping in the amount", () => {
    expect(parseLatestPriceTarget("P 2026-07-15 BTC 55,849.08 USD")).toBe("USD");
  });

  it("should skip a double-quoted priced commodity", () => {
    expect(parseLatestPriceTarget('P 2026-07-17 "SXR8" 701.93 EUR')).toBe("EUR");
  });

  it("should unquote a double-quoted target", () => {
    expect(parseLatestPriceTarget('P 2026-07-17 EUR 51.07 "UAH"')).toBe("UAH");
  });

  it("should use the last line (hledger prints prices date-ascending)", () => {
    const text = ["P 2026-07-10 USD 0.87 EUR", "P 2026-07-22 EUR 41.85 UAH"].join("\n");
    expect(parseLatestPriceTarget(text)).toBe("UAH");
  });

  it("should return null when the line has no amount or no symbol", () => {
    expect(parseLatestPriceTarget("P 2026-07-22 UAH")).toBeNull();
    expect(parseLatestPriceTarget("P 2026-07-22 UAH 0.01958")).toBeNull();
    expect(parseLatestPriceTarget("P not-a-date UAH 1 EUR")).toBeNull();
  });
});
