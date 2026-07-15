import { describe, expect, it } from "vitest";
import { formatAmount, formatAmountCompact } from "../format-amount";

describe("formatAmount()", () => {
  it("should return '1,234.56 EUR' when amount=1234.56, currency=EUR", () => {
    expect(formatAmount(1234.56, "EUR")).toBe("1,234.56 EUR");
  });

  it("should return '-50.00 USD' when amount=-50, currency=USD", () => {
    expect(formatAmount(-50, "USD")).toBe("-50.00 USD");
  });

  it("should return '0.00 EUR' when amount=0, currency=EUR", () => {
    expect(formatAmount(0, "EUR")).toBe("0.00 EUR");
  });

  it("should round to two fraction digits", () => {
    expect(formatAmount(1234.567, "EUR")).toBe("1,234.57 EUR");
  });

  it("should omit the suffix when currency is empty", () => {
    expect(formatAmount(5, "")).toBe("5.00");
  });

  it("should keep symbol commodities as a plain suffix", () => {
    expect(formatAmount(100, "$")).toBe("100.00 $");
  });
});

describe("formatAmountCompact()", () => {
  it("should return '0' when amount=0", () => {
    expect(formatAmountCompact(0)).toBe("0");
  });

  it("should round sub-thousand values to whole numbers", () => {
    expect(formatAmountCompact(999.4)).toBe("999");
  });

  it("should return '1k' when amount=1000", () => {
    expect(formatAmountCompact(1000)).toBe("1k");
  });

  it("should return '1.2k' when amount=1234", () => {
    expect(formatAmountCompact(1234)).toBe("1.2k");
  });

  it("should return '45k' when amount=45000", () => {
    expect(formatAmountCompact(45000)).toBe("45k");
  });

  it("should return '-1.2k' when amount=-1234", () => {
    expect(formatAmountCompact(-1234)).toBe("-1.2k");
  });

  it("should return '1.5M' when amount=1500000", () => {
    expect(formatAmountCompact(1_500_000)).toBe("1.5M");
  });

  it("should return '1M' when amount=1000000", () => {
    expect(formatAmountCompact(1_000_000)).toBe("1M");
  });
});
