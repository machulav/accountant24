import { describe, expect, test } from "vitest";
import {
  BALANCE_ASSERTION_PAYEE,
  formatBalanceAssertion,
  formatPrice,
  formatPriceAmount,
  formatTransaction,
  quoteCommodity,
  renderPrice,
  renderTransaction,
} from "../format";
import type { Transaction } from "../types";

const basicParams = {
  date: "2026-03-15",
  payee: "Whole Foods",
  description: "Groceries",
  postings: [
    { account: "Assets:Checking", amount: -45, currency: "USD" },
    { account: "Expenses:Food:Groceries", amount: 45, currency: "USD" },
  ],
};

function findLine(text: string, search: string): string {
  const line = text.split("\n").find((l) => l.includes(search));
  if (!line) throw new Error(`Line containing "${search}" not found in:\n${text}`);
  return line;
}

describe("formatTransaction()", () => {
  test("should format the full transaction byte-exactly", () => {
    expect(formatTransaction(basicParams)).toBe(
      [
        "2026-03-15 * Whole Foods | Groceries",
        `    Assets:Checking${" ".repeat(49)}-45.00 USD`,
        `    Expenses:Food:Groceries${" ".repeat(42)}45.00 USD`,
      ].join("\n"),
    );
  });

  test("should format header without pipe when description is omitted", () => {
    const { description: _, ...noDesc } = basicParams;
    const text = formatTransaction(noDesc);
    expect(text.split("\n")[0]).toBe("2026-03-15 * Whole Foods");
    expect(text).not.toContain("|");
  });

  test("should align first digit of positive amount at column 70 and sign at 69", () => {
    const text = formatTransaction(basicParams);
    const negativeLine = findLine(text, "-45.00");
    const positiveLine = findLine(text, " 45.00");
    expect(negativeLine[69]).toBe("4");
    expect(negativeLine[68]).toBe("-");
    expect(positiveLine[69]).toBe("4");
  });

  test("should order negative amounts before positive", () => {
    const text = formatTransaction({
      ...basicParams,
      postings: [
        { account: "Expenses:Food", amount: 30, currency: "USD" },
        { account: "Assets:Savings", amount: -30, currency: "USD" },
      ],
    });
    const postingLines = text.split("\n").slice(1);
    expect(postingLines[0]).toContain("Assets:Savings");
    expect(postingLines[1]).toContain("Expenses:Food");
  });

  test("should preserve input order within same sign group", () => {
    const text = formatTransaction({
      ...basicParams,
      postings: [
        { account: "Expenses:Food", amount: 20, currency: "USD" },
        { account: "Expenses:Transport", amount: 10, currency: "USD" },
        { account: "Assets:Checking", amount: -30, currency: "USD" },
      ],
    });
    const postingLines = text.split("\n").slice(1);
    expect(postingLines[0]).toContain("Assets:Checking");
    expect(postingLines[1]).toContain("Expenses:Food");
    expect(postingLines[2]).toContain("Expenses:Transport");
  });

  test("should group zero amount with positives, not negatives", () => {
    const text = formatTransaction({
      ...basicParams,
      postings: [
        { account: "Expenses:Food", amount: 0, currency: "USD" },
        { account: "Assets:Checking", amount: -10, currency: "USD" },
        { account: "Assets:Savings", amount: 10, currency: "USD" },
      ],
    });
    const postingLines = text.split("\n").slice(1);
    expect(postingLines[0]).toContain("Assets:Checking");
    expect(postingLines[1]).toContain("Expenses:Food");
    expect(postingLines[2]).toContain("Assets:Savings");
  });

  test("should render zero amount as 0.00 without sign", () => {
    const text = formatTransaction({
      ...basicParams,
      postings: [
        { account: "Expenses:Food", amount: 0, currency: "USD" },
        { account: "Assets:Checking", amount: -0, currency: "USD" },
      ],
    });
    expect(findLine(text, "Expenses:Food")).toMatch(/Expenses:Food\s+0\.00 USD$/);
    expect(text).not.toContain("-0.00");
  });

  test("should use minimum 2-space gap when account name is very long", () => {
    const longAccount = "Expenses:Food:Groceries:Organic:Vegetables:Imported:Premium:Extra";
    const text = formatTransaction({
      ...basicParams,
      postings: [
        { account: longAccount, amount: 45, currency: "USD" },
        { account: "Assets:Checking", amount: -45, currency: "USD" },
      ],
    });
    expect(findLine(text, longAccount)).toBe(`    ${longAccount}  45.00 USD`);
  });

  test("should align amounts consistently regardless of magnitude", () => {
    const text = formatTransaction({
      ...basicParams,
      postings: [
        { account: "Expenses:Small", amount: 0.01, currency: "USD" },
        { account: "Expenses:Large", amount: 99999.99, currency: "USD" },
        { account: "Assets:Checking", amount: -100000, currency: "USD" },
      ],
    });
    expect(findLine(text, "Expenses:Small")[69]).toBe("0");
    expect(findLine(text, "Expenses:Large")[69]).toBe("9");
  });

  test("should place each tag on its own line before postings", () => {
    const text = formatTransaction({ ...basicParams, tags: [{ name: "groceries" }] });
    const lines = text.split("\n");
    expect(lines[1]).toBe("    ; groceries:");
    expect(lines[2]).toContain("Assets:Checking");
  });

  test("should sort tags case-insensitively by name", () => {
    const text = formatTransaction({
      ...basicParams,
      tags: [{ name: "Zebra" }, { name: "alpha" }, { name: "Middle" }],
    });
    const tagLines = text.split("\n").filter((l) => l.trimStart().startsWith(";"));
    expect(tagLines).toEqual(["    ; alpha:", "    ; Middle:", "    ; Zebra:"]);
  });

  test("should render tags with values as key-value comments", () => {
    const text = formatTransaction({
      ...basicParams,
      tags: [
        { name: "source", value: "manual" },
        { name: "ref", value: "123" },
      ],
    });
    expect(text).toContain("    ; ref: 123");
    expect(text).toContain("    ; source: manual");
  });

  test("should allow duplicate tag names with different values", () => {
    const text = formatTransaction({
      ...basicParams,
      tags: [
        { name: "related_file", value: "files/receipt1.pdf" },
        { name: "related_file", value: "files/receipt2.pdf" },
      ],
    });
    const relatedLines = text.split("\n").filter((l) => l.includes("; related_file:"));
    expect(relatedLines).toEqual(["    ; related_file: files/receipt1.pdf", "    ; related_file: files/receipt2.pdf"]);
  });

  test("should apply a custom indent and alignment column", () => {
    const text = formatTransaction(basicParams, { indent: "  ", alignColumn: 30 });
    expect(findLine(text, "Assets:Checking")).toBe(`  Assets:Checking${" ".repeat(12)}-45.00 USD`);
    expect(findLine(text, "Assets:Checking")[30]).toBe("4");
  });
});

describe("formatBalanceAssertion()", () => {
  const checkpoint = {
    date: "2026-03-15",
    account: "Assets:Bank:Cash",
    balance: { amount: 200, currency: "EUR" },
  };

  test("should format the canonical payee and hledger's `= balance` syntax, keeping the column alignment", () => {
    const text = formatBalanceAssertion(checkpoint);
    expect(text).toBe(`2026-03-15 * Balance Assertion\n    Assets:Bank:Cash${" ".repeat(49)}0.00 EUR = 200.00 EUR`);
    expect(findLine(text, "Assets:Bank:Cash").indexOf("0.00 EUR")).toBe(69);
  });

  test("should format a negative confirmed balance", () => {
    const text = formatBalanceAssertion({ ...checkpoint, balance: { amount: -133.51, currency: "EUR" } });
    expect(findLine(text, "Assets:Bank:Cash")).toMatch(/0\.00 EUR = -133\.51 EUR$/);
  });

  test("should use the canonical payee constant by default and accept an override", () => {
    expect(BALANCE_ASSERTION_PAYEE).toBe("Balance Assertion");
    const text = formatBalanceAssertion({ ...checkpoint, payee: "Monthly Checkpoint" });
    expect(text.split("\n")[0]).toBe("2026-03-15 * Monthly Checkpoint");
  });
});

describe("formatPrice()", () => {
  test("should format the P directive verbatim", () => {
    expect(formatPrice({ date: "2026-03-15", commodity: "USD", price: { amount: 0.87, currency: "EUR" } })).toBe(
      "P 2026-03-15 USD 0.87 EUR",
    );
  });

  test("should double-quote a commodity containing digits, as hledger requires", () => {
    expect(formatPrice({ date: "2026-03-15", commodity: "SOL2", price: { amount: 0.87, currency: "EUR" } })).toBe(
      'P 2026-03-15 "SOL2" 0.87 EUR',
    );
  });

  test("should double-quote a target currency containing digits", () => {
    expect(formatPrice({ date: "2026-03-15", commodity: "USD", price: { amount: 0.87, currency: "SOL2" } })).toBe(
      'P 2026-03-15 USD 0.87 "SOL2"',
    );
  });

  test("should preserve the rate's full precision instead of rounding to 2 decimals", () => {
    expect(formatPrice({ date: "2026-03-15", commodity: "UAH", price: { amount: 0.0205, currency: "EUR" } })).toBe(
      "P 2026-03-15 UAH 0.0205 EUR",
    );
  });

  test("should render a tiny rate in plain decimal, never exponential notation", () => {
    expect(formatPrice({ date: "2026-03-15", commodity: "SAT", price: { amount: 0.0000005, currency: "EUR" } })).toBe(
      "P 2026-03-15 SAT 0.0000005 EUR",
    );
  });
});

describe("formatPriceAmount()", () => {
  test("should keep plain decimals untouched", () => {
    expect(formatPriceAmount(0.0205)).toBe("0.0205");
    expect(formatPriceAmount(55000)).toBe("55000");
  });

  test("should expand exponential notation to plain decimal", () => {
    expect(formatPriceAmount(0.0000005)).toBe("0.0000005");
    expect(formatPriceAmount(1e-8)).toBe("0.00000001");
  });
});

describe("quoteCommodity()", () => {
  test("should leave letter-only and currency-sign commodities unquoted", () => {
    expect(quoteCommodity("EUR")).toBe("EUR");
    expect(quoteCommodity("€")).toBe("€");
  });

  test("should quote commodities containing digits, spaces, or punctuation", () => {
    expect(quoteCommodity("SOL2")).toBe('"SOL2"');
    expect(quoteCommodity("My Fund")).toBe('"My Fund"');
  });
});

describe("renderTransaction()", () => {
  test("should render a full parsed transaction preserving verbatim parts", () => {
    const tx: Transaction = {
      date: "2026-01-05",
      status: "*",
      description: "Shop | weekly",
      payee: "Shop",
      note: "weekly",
      headerComment: "; seen: bank",
      commentLines: ["; note: hello"],
      tags: [{ name: "note", value: "hello" }],
      postings: [
        { account: "Expenses:Food", amount: 45.5, amountText: "45.5", currency: "EUR" },
        { account: "Assets:Cash", comment: "; why" },
      ],
    };
    expect(renderTransaction(tx)).toBe(
      [
        "2026-01-05 * Shop | weekly  ; seen: bank",
        "    ; note: hello",
        `    Expenses:Food${" ".repeat(52)}45.5 EUR`,
        "    Assets:Cash  ; why",
      ].join("\n"),
    );
  });

  test("should render an unmarked transaction without a status marker", () => {
    const tx: Transaction = {
      date: "2026-02-01",
      description: "Corner Store",
      payee: "Corner Store",
      commentLines: [],
      tags: [],
      postings: [
        { account: "Expenses:Misc", amount: 1, amountText: "1.00", currency: "USD" },
        { account: "Assets:Cash", amount: -1, amountText: "-1.00", currency: "USD" },
      ],
    };
    expect(renderTransaction(tx).split("\n")[0]).toBe("2026-02-01 Corner Store");
  });

  test("should render status code, virtual parentheses, and balance assertions", () => {
    const tx: Transaction = {
      date: "2026-02-01",
      status: "!",
      code: "42",
      description: "Bank",
      payee: "Bank",
      commentLines: [],
      tags: [],
      postings: [
        { account: "Forecast", virtual: true, amount: -10, amountText: "-10.00", currency: "USD" },
        {
          account: "Assets:Bank",
          amount: 0,
          amountText: "0.00",
          currency: "EUR",
          assertion: { amount: 200, amountText: "200.00", currency: "EUR" },
        },
      ],
    };
    expect(renderTransaction(tx)).toBe(
      [
        "2026-02-01 ! (42) Bank",
        `    (Forecast)${" ".repeat(54)}-10.00 USD`,
        `    Assets:Bank${" ".repeat(54)}0.00 EUR = 200.00 EUR`,
      ].join("\n"),
    );
  });

  test("should quote a non-letter commodity when re-rendering", () => {
    const tx: Transaction = {
      date: "2026-02-01",
      description: "Broker",
      payee: "Broker",
      commentLines: [],
      tags: [],
      postings: [
        { account: "Assets:Broker", amount: 2, amountText: "2", currency: "SOL2" },
        { account: "Assets:Cash", amount: -100, amountText: "-100.00", currency: "USD" },
      ],
    };
    expect(findLine(renderTransaction(tx), "Assets:Broker")).toMatch(/2 "SOL2"$/);
  });
});

describe("renderPrice()", () => {
  test("should render a parsed P directive preserving the written amount", () => {
    expect(
      renderPrice({ date: "2026-03-15", commodity: "SOL2", amount: 0.87, amountText: "0.870", currency: "EUR" }),
    ).toBe('P 2026-03-15 "SOL2" 0.870 EUR');
  });
});
