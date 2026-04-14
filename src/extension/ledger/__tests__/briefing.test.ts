import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fetchBriefingData, parseAmount, parseAmounts, parseBalRows, parseBalTotal, parseCSVLine } from "../briefing";

// Mock at I/O boundary (Bun.spawn) so the real tryRunHledger/runHledger/spawn execute.
const origSpawn = Bun.spawn;

function makeMockProc(exitCode: number, stdout = "", stderr = "") {
  return {
    stdout: new Blob([stdout]).stream(),
    stderr: new Blob([stderr]).stream(),
    exited: Promise.resolve(exitCode),
    kill: mock(() => {}),
  };
}

// Helper: set sequential Bun.spawn responses for the 4 fetchBriefingData queries.
// null → simulate command error (exitCode 1, tryRunHledger returns null)
function setBunSpawnResponses(responses: (string | null)[]) {
  let callIndex = 0;
  // @ts-expect-error - mocking Bun.spawn
  Bun.spawn = mock(() => {
    const r = responses[callIndex++];
    if (r === null) return makeMockProc(1, "", "error");
    return makeMockProc(0, r ?? "");
  });
}

afterEach(() => {
  Bun.spawn = origSpawn;
});

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

describe("parseAmounts", () => {
  test("single amount", () => {
    expect(parseAmounts("100.00 USD")).toEqual([{ amount: 100, currency: "USD" }]);
  });

  test("comma-separated multi-currency", () => {
    expect(parseAmounts("EUR 1917.61, 5.00 USD")).toEqual([
      { amount: 1917.61, currency: "EUR" },
      { amount: 5, currency: "USD" },
    ]);
  });

  test("preserves thousand separators", () => {
    expect(parseAmounts("1,234.56 USD")).toEqual([{ amount: 1234.56, currency: "USD" }]);
  });

  test("multi-currency with thousand separators", () => {
    expect(parseAmounts("EUR 1,917.61, 1,005.00 USD")).toEqual([
      { amount: 1917.61, currency: "EUR" },
      { amount: 1005, currency: "USD" },
    ]);
  });

  test("zero", () => {
    expect(parseAmounts("0")).toEqual([{ amount: 0, currency: "" }]);
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

  test("splits multi-currency balance into separate rows", () => {
    const csv = `"account","balance"\n"expenses","EUR 1917.61, 5.00 USD"\n"Total:","EUR 1917.61, 5.00 USD"`;
    expect(parseBalRows(csv)).toEqual([
      { name: "expenses", amount: 1917.61, currency: "EUR" },
      { name: "expenses", amount: 5, currency: "USD" },
    ]);
  });
});

// ── fetchBriefingData ───────────────────────────────────────────────

// Helpers for controlling tryRunHledger responses per-query
const NW_SINGLE = `"account","balance"\n"Assets:Checking","5000.00 USD"\n"total","5000.00 USD"`;
const NW_PREV = `"account","balance"\n"Assets:Checking","4200.00 USD"\n"total","4200.00 USD"`;
const NW_MULTI = `"account","balance"\n"Assets:Checking","5000.00 USD"\n"Assets:EUR","300.00 EUR"\n"Liabilities:Card","-200.00 USD"\n"total","4800.00 USD"`;
const EXPENSES = `"account","balance"\n"Expenses","1200.00 USD"\n"total","1200.00 USD"`;
const INCOME = `"account","balance"\n"Income","-3000.00 USD"\n"total","-3000.00 USD"`;
const CATEGORIES = `"account","balance"\n"Expenses:Food","500.00 USD"\n"Expenses:Transport","300.00 USD"\n"Expenses:Rent","200.00 USD"\n"Expenses:Utilities","100.00 USD"\n"Expenses:Fun","80.00 USD"\n"Expenses:Other","20.00 USD"\n"total","1200.00 USD"`;

function setAllQueries(
  nwNow: string | null,
  nwPrev: string | null,
  exp: string | null,
  inc: string | null,
  cats: string | null,
) {
  setBunSpawnResponses([nwNow, nwPrev, exp, inc, cats]);
}

describe("fetchBriefingData()", () => {
  beforeEach(() => {
    // Default: all queries return error (exitCode 1) → tryRunHledger returns null
    setBunSpawnResponses([null, null, null, null, null]);
  });

  test("should return error when HledgerNotFoundError is thrown", async () => {
    // exitCode 127 → HledgerNotFoundError
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(127));
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.error).toContain("hledger is not installed");
    expect(data.netWorth).toEqual([]);
    expect(data.spendThisMonth).toEqual([]);
    expect(data.incomeThisMonth).toEqual([]);
    expect(data.topCategories).toEqual([]);
  });

  test("should return empty data when spawn throws unexpected error", async () => {
    // tryRunHledger catches all non-HledgerNotFoundError errors, returns null
    Bun.spawn = mock(() => {
      throw new Error("network timeout");
    });
    // The error is swallowed by tryRunHledger, data fields are empty
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.netWorth).toEqual([]);
  });

  test("should return empty data when all queries return null", async () => {
    setAllQueries(null, null, null, null, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.error).toBeNull();
    expect(data.netWorth).toEqual([]);
    expect(data.spendThisMonth).toEqual([]);
    expect(data.incomeThisMonth).toEqual([]);
    expect(data.topCategories).toEqual([]);
  });

  test("should compute net worth for single currency with change", async () => {
    setAllQueries(NW_SINGLE, NW_PREV, null, null, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.netWorth).toEqual([{ amount: 5000, currency: "USD", change: 800 }]);
  });

  test("should set change to full amount when no previous data", async () => {
    setAllQueries(NW_SINGLE, null, null, null, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.netWorth).toEqual([{ amount: 5000, currency: "USD", change: 5000 }]);
  });

  test("should aggregate net worth by currency", async () => {
    setAllQueries(NW_MULTI, null, null, null, null);
    const data = await fetchBriefingData("/fake/main.journal");
    // USD: 5000 - 200 = 4800, EUR: 300
    expect(data.netWorth).toEqual([
      { amount: 4800, currency: "USD", change: 4800 },
      { amount: 300, currency: "EUR", change: 300 },
    ]);
  });

  test("should sort net worth by absolute amount descending", async () => {
    const csv = `"account","balance"\n"Assets:A","100.00 USD"\n"Assets:B","5000.00 EUR"\n"Assets:C","2.00 BTC"\n"total","..."`;
    setAllQueries(csv, null, null, null, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.netWorth[0].currency).toBe("EUR");
    expect(data.netWorth[1].currency).toBe("USD");
    expect(data.netWorth[2].currency).toBe("BTC");
  });

  test("should return empty net worth when query returns null", async () => {
    setAllQueries(null, null, null, null, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.netWorth).toEqual([]);
  });

  test("should return spendThisMonth from expenses", async () => {
    setAllQueries(null, null, EXPENSES, null, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.spendThisMonth).toEqual([{ amount: 1200, currency: "USD" }]);
  });

  test("should return empty spendThisMonth when expenses null", async () => {
    setAllQueries(null, null, null, null, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.spendThisMonth).toEqual([]);
  });

  test("should return incomeThisMonth as absolute value", async () => {
    setAllQueries(null, null, null, INCOME, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.incomeThisMonth).toEqual([{ amount: 3000, currency: "USD" }]);
  });

  test("should return empty incomeThisMonth when income null", async () => {
    setAllQueries(null, null, null, null, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.incomeThisMonth).toEqual([]);
  });

  test("should aggregate multi-currency expenses", async () => {
    const exp = `"account","balance"\n"Expenses","EUR 1917.61, 5.00 USD"\n"Total:","EUR 1917.61, 5.00 USD"`;
    setAllQueries(null, null, exp, null, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.spendThisMonth).toEqual([
      { amount: 1917.61, currency: "EUR" },
      { amount: 5, currency: "USD" },
    ]);
  });

  test("should aggregate multi-currency income as absolute values", async () => {
    const inc = `"account","balance"\n"Income","EUR -3000.00, -500.00 USD"\n"Total:","EUR -3000.00, -500.00 USD"`;
    setAllQueries(null, null, null, inc, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.incomeThisMonth).toEqual([
      { amount: 3000, currency: "EUR" },
      { amount: 500, currency: "USD" },
    ]);
  });

  test("should show zero spent with primary currency when hledger returns zero total", async () => {
    const zeroExp = `"account","balance"\n"Total:","0"`;
    setAllQueries(NW_SINGLE, null, zeroExp, null, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.spendThisMonth).toEqual([{ amount: 0, currency: "USD" }]);
  });

  test("should show zero income with primary currency when hledger returns zero total", async () => {
    const zeroInc = `"account","balance"\n"Total:","0"`;
    setAllQueries(NW_SINGLE, null, null, zeroInc, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.incomeThisMonth).toEqual([{ amount: 0, currency: "USD" }]);
  });

  test("should return empty spent when no net worth and hledger returns zero", async () => {
    const zeroExp = `"account","balance"\n"Total:","0"`;
    setAllQueries(null, null, zeroExp, null, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.spendThisMonth).toEqual([]);
  });

  test("should return topCategories sorted descending, limited to 5", async () => {
    setAllQueries(null, null, null, null, CATEGORIES);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.topCategories).toHaveLength(5);
    expect(data.topCategories[0]).toEqual({ name: "Food", amount: 500, currency: "USD" });
    expect(data.topCategories[1].name).toBe("Transport");
    expect(data.topCategories[4].name).toBe("Fun");
    // 6th category "Other" should be excluded
  });

  test("should strip Expenses: prefix from category names", async () => {
    setAllQueries(null, null, null, null, CATEGORIES);
    const data = await fetchBriefingData("/fake/main.journal");
    for (const cat of data.topCategories) {
      expect(cat.name).not.toContain("Expenses:");
    }
  });
});
