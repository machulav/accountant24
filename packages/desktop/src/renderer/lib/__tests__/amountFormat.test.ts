import { describe, expect, it } from "vitest";
import type { LedgerAmount } from "@/rpc/types";
import { formatAmount, formatAmounts } from "../amountFormat";

// Spec for the Balance Sheet view's number presentation. Every commodity
// reads the same way: locale-formatted number, commodity code as a suffix
// (hledger's own display convention). Locales are pinned per assertion so
// the expectations are deterministic. hledger owns the numbers; this module
// owns only how they read.

const a = (commodity: string, quantity: number, precision = 2): LedgerAmount => ({ commodity, quantity, precision });

describe("formatAmount()", () => {
  it("should format every commodity the same way: number then code", () => {
    expect(formatAmount(a("EUR", 123, 2), "value", "en-US")).toBe("123.00 EUR");
    expect(formatAmount(a("UAH", 10, 2), "value", "en-US")).toBe("10.00 UAH");
    expect(formatAmount(a("BTC", 1, 8), "native", "en-US")).toBe("1.00 BTC");
    expect(formatAmount(a("SXR8", 22.45, 2), "native", "en-US")).toBe("22.45 SXR8");
  });

  describe("value mode (market value, money presentation)", () => {
    it("should group digits and show 2 fraction digits", () => {
      expect(formatAmount(a("EUR", 6145.5, 3), "value", "en-US")).toBe("6,145.50 EUR");
    });

    it("should round a value carried at higher precision to 2 digits", () => {
      expect(formatAmount(a("EUR", 35185.862, 3), "value", "en-US")).toBe("35,185.86 EUR");
    });

    it("should format negative money with a leading minus", () => {
      expect(formatAmount(a("EUR", -2000, 2), "value", "en-US")).toBe("-2,000.00 EUR");
    });

    it("should keep a whole-unit commodity whole", () => {
      expect(formatAmount(a("GOOG", 24, 0), "value", "en-US")).toBe("24 GOOG");
    });

    it("should keep the own precision of a sub-1 quantity (unconverted crypto)", () => {
      expect(formatAmount(a("BTC", 0.165, 3), "value", "en-US")).toBe("0.165 BTC");
    });

    it("should follow the locale for digit separators", () => {
      // uk-UA: space-grouped digits, comma decimals (the exact space
      // character varies by ICU version, so match loosely around it).
      expect(formatAmount(a("EUR", 6145.5, 3), "value", "uk-UA")).toMatch(/^6.145,50 EUR$/);
    });
  });

  describe("native mode (original holding, own precision)", () => {
    it("should keep full crypto precision", () => {
      expect(formatAmount(a("BTC", 1.23456789, 8), "native", "en-US")).toBe("1.23456789 BTC");
    });

    it("should trim trailing zeros beyond 2 digits", () => {
      expect(formatAmount(a("ZEC", 0.37854, 8), "native", "en-US")).toBe("0.37854 ZEC");
    });

    it("should cap precision at 8 digits", () => {
      expect(formatAmount(a("BTC", 0.123456789012, 12), "native", "en-US")).toBe("0.12345679 BTC");
    });

    it("should format fiat natively with 2-digit precision and grouping", () => {
      expect(formatAmount(a("UAH", 1408.26, 2), "native", "en-US")).toBe("1,408.26 UAH");
    });

    it("should keep a whole share count whole", () => {
      expect(formatAmount(a("GOOG", 24, 0), "native", "en-US")).toBe("24 GOOG");
    });

    it("should still group digits in large ticker quantities", () => {
      expect(formatAmount(a("P500", 2500, 2), "native", "en-US")).toBe("2,500.00 P500");
    });
  });

  it("should render a bare number when the commodity is empty", () => {
    expect(formatAmount(a("", 5, 0), "native", "en-US")).toBe("5");
  });
});

describe("formatAmounts()", () => {
  it("should join a multi-commodity amount with commas on one line (hledger's convention)", () => {
    expect(formatAmounts([a("EUR", 7796.25), a("UAH", 1000)], "value", "en-US")).toBe("7,796.25 EUR, 1,000.00 UAH");
  });

  it("should render a single amount without separators", () => {
    expect(formatAmounts([a("EUR", 50)], "value", "en-US")).toBe("50.00 EUR");
  });

  it("should render an empty list as an empty string", () => {
    expect(formatAmounts([], "value", "en-US")).toBe("");
  });
});
