import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  fetchBriefingData,
  parseAmount,
  parseBalRows,
  parseBalTotal,
  parseCSVLine,
  parseRegisterCsv,
} from "../briefing";

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

// Helper: set sequential Bun.spawn responses for the 6 fetchBriefingData queries.
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

// ── fetchBriefingData ───────────────────────────────────────────────

// Helpers for controlling tryRunHledger responses per-query
const NW_NOW = `"account","balance"\n"Assets:Checking","5000.00 USD"\n"total","5000.00 USD"`;
const NW_PREV = `"account","balance"\n"Assets:Checking","4200.00 USD"\n"total","4200.00 USD"`;
const EXPENSES = `"account","balance"\n"Expenses","1200.00 USD"\n"total","1200.00 USD"`;
const INCOME = `"account","balance"\n"Income","-3000.00 USD"\n"total","-3000.00 USD"`;
const CATEGORIES = `"account","balance"\n"Expenses:Food","500.00 USD"\n"Expenses:Transport","300.00 USD"\n"Expenses:Rent","200.00 USD"\n"Expenses:Utilities","100.00 USD"\n"Expenses:Fun","80.00 USD"\n"Expenses:Other","20.00 USD"\n"total","1200.00 USD"`;
const REGISTER = `"txnidx","date","code","description","account","amount","total"\n"1","2026-03-01","","Grocery Store | weekly","Expenses:Food","45.00 USD","45.00 USD"\n"1","2026-03-01","","Grocery Store | weekly","Assets:Checking","-45.00 USD","0"\n"2","2026-03-05","","Employer Inc","Income:Salary","-3000.00 USD","-3000.00 USD"\n"2","2026-03-05","","Employer Inc","Assets:Checking","3000.00 USD","0"`;

function setAllQueries(
  nwNow: string | null,
  nwPrev: string | null,
  exp: string | null,
  inc: string | null,
  cats: string | null,
  reg: string | null,
) {
  setBunSpawnResponses([nwNow, nwPrev, exp, inc, cats, reg]);
}

describe("fetchBriefingData()", () => {
  beforeEach(() => {
    // Default: all queries return error (exitCode 1) → tryRunHledger returns null
    setBunSpawnResponses([null, null, null, null, null, null]);
  });

  test("should return error when HledgerNotFoundError is thrown", async () => {
    // exitCode 127 → HledgerNotFoundError
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(127));
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.error).toContain("hledger is not installed");
    expect(data.netWorth).toBeNull();
    expect(data.spendThisMonth).toBeNull();
    expect(data.incomeThisMonth).toBeNull();
    expect(data.recentTransactions).toEqual([]);
    expect(data.topCategories).toEqual([]);
  });

  test("should return empty data when spawn throws unexpected error", async () => {
    // tryRunHledger catches all non-HledgerNotFoundError errors, returns null
    Bun.spawn = mock(() => {
      throw new Error("network timeout");
    });
    // The error is swallowed by tryRunHledger, data fields are null
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.netWorth).toBeNull();
  });

  test("should return all-null data when all queries return null", async () => {
    setAllQueries(null, null, null, null, null, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.error).toBeNull();
    expect(data.netWorth).toBeNull();
    expect(data.spendThisMonth).toBeNull();
    expect(data.incomeThisMonth).toBeNull();
    expect(data.recentTransactions).toEqual([]);
    expect(data.topCategories).toEqual([]);
  });

  test("should compute net worth with change from previous month", async () => {
    setAllQueries(NW_NOW, NW_PREV, null, null, null, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.netWorth).toEqual({ amount: 5000, currency: "USD", change: 800 });
  });

  test("should set net worth change to 0 when no previous data", async () => {
    setAllQueries(NW_NOW, null, null, null, null, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.netWorth).toEqual({ amount: 5000, currency: "USD", change: 0 });
  });

  test("should return null net worth when current query returns null", async () => {
    setAllQueries(null, NW_PREV, null, null, null, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.netWorth).toBeNull();
  });

  test("should return spendThisMonth from expenses total", async () => {
    setAllQueries(null, null, EXPENSES, null, null, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.spendThisMonth).toEqual({ amount: 1200, currency: "USD" });
  });

  test("should return null spendThisMonth when expenses null", async () => {
    setAllQueries(null, null, null, null, null, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.spendThisMonth).toBeNull();
  });

  test("should return incomeThisMonth as absolute value", async () => {
    setAllQueries(null, null, null, INCOME, null, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.incomeThisMonth).toEqual({ amount: 3000, currency: "USD" });
  });

  test("should return null incomeThisMonth when income null", async () => {
    setAllQueries(null, null, null, null, null, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.incomeThisMonth).toBeNull();
  });

  test("should return topCategories sorted descending, limited to 5", async () => {
    setAllQueries(null, null, null, null, CATEGORIES, null);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.topCategories).toHaveLength(5);
    expect(data.topCategories[0]).toEqual({ name: "Food", amount: 500, currency: "USD" });
    expect(data.topCategories[1].name).toBe("Transport");
    expect(data.topCategories[4].name).toBe("Fun");
    // 6th category "Other" should be excluded
  });

  test("should strip Expenses: prefix from category names", async () => {
    setAllQueries(null, null, null, null, CATEGORIES, null);
    const data = await fetchBriefingData("/fake/main.journal");
    for (const cat of data.topCategories) {
      expect(cat.name).not.toContain("Expenses:");
    }
  });

  test("should group transactions by txnidx and sort by date descending", async () => {
    setAllQueries(null, null, null, null, null, REGISTER);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.recentTransactions).toHaveLength(2);
    // txn 2 (2026-03-05) should come before txn 1 (2026-03-01)
    expect(data.recentTransactions[0].date).toBe("2026-03-05");
    expect(data.recentTransactions[1].date).toBe("2026-03-01");
  });

  test("should prefer Expenses/Income posting as interesting", async () => {
    setAllQueries(null, null, null, null, null, REGISTER);
    const data = await fetchBriefingData("/fake/main.journal");
    // txn 1 has Expenses:Food and Assets:Checking, should pick Expenses:Food
    expect(data.recentTransactions[1].account).toBe("Food");
  });

  test("should fall back to first posting when no Expenses/Income posting", async () => {
    const reg = `"txnidx","date","code","description","account","amount","total"\n"1","2026-03-01","","Transfer","Assets:Checking","-100.00 USD","-100.00 USD"\n"1","2026-03-01","","Transfer","Assets:Savings","100.00 USD","100.00 USD"`;
    setAllQueries(null, null, null, null, null, reg);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.recentTransactions[0].account).toBe("Assets:Checking");
  });

  test("should strip payee from description before |", async () => {
    setAllQueries(null, null, null, null, null, REGISTER);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.recentTransactions[1].description).toBe("Grocery Store");
  });

  test("should negate expense/income amounts for display", async () => {
    setAllQueries(null, null, null, null, null, REGISTER);
    const data = await fetchBriefingData("/fake/main.journal");
    // Expense posting: 45 USD in hledger → -45 for display
    expect(data.recentTransactions[1].amount).toBe(-45);
    // Income posting: -3000 USD in hledger → 3000 for display
    expect(data.recentTransactions[0].amount).toBe(3000);
  });

  test("should not negate non-expense/income amounts", async () => {
    const reg = `"txnidx","date","code","description","account","amount","total"\n"1","2026-03-01","","Transfer","Assets:Checking","-100.00 USD","-100.00 USD"`;
    setAllQueries(null, null, null, null, null, reg);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.recentTransactions[0].amount).toBe(-100);
  });

  test("should limit recent transactions to 5", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => {
      const date = `2026-03-${String(i + 1).padStart(2, "0")}`;
      return `"${i + 1}","${date}","","Payee ${i}","Expenses:Food","10.00 USD","10.00 USD"`;
    }).join("\n");
    const reg = `"txnidx","date","code","description","account","amount","total"\n${rows}`;
    setAllQueries(null, null, null, null, null, reg);
    const data = await fetchBriefingData("/fake/main.journal");
    expect(data.recentTransactions).toHaveLength(5);
  });
});
