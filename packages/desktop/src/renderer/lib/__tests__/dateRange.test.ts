import { describe, expect, it } from "vitest";
import { inRange, isIsoDate, presetRange } from "../dateRange";

// presetRange turns a preset + a fixed "today" into inclusive ISO bounds;
// inRange is a plain lexicographic check against them; isIsoDate gates what
// the Date chip commits as a bound. Expected bounds are hardcoded calendar
// facts, never derived from the functions.

describe("presetRange()", () => {
  // Mid-February 2026: a month whose end (28) differs from its length-31
  // neighbors, so a wrong month-end computation cannot pass.
  const feb = new Date(2026, 1, 15);

  it("should roll last 7 days across a month edge, today included, on 2026-03-04", () => {
    expect(presetRange("last-7-days", new Date(2026, 2, 4))).toEqual({ from: "2026-02-26", to: "2026-03-04" });
  });

  it("should roll last 30 days across a year edge on 2026-01-15", () => {
    expect(presetRange("last-30-days", new Date(2026, 0, 15))).toEqual({ from: "2025-12-17", to: "2026-01-15" });
  });

  it("should return 2026-02-01..2026-02-28 for this month on 2026-02-15", () => {
    expect(presetRange("this-month", feb)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("should return 2026-01-01..2026-01-31 for last month on 2026-02-15", () => {
    expect(presetRange("last-month", feb)).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });

  it("should return the whole calendar year for this year on 2026-02-15", () => {
    expect(presetRange("this-year", feb)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("should return the previous calendar year for last year on 2026-02-15", () => {
    expect(presetRange("last-year", feb)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("should roll last month over the year boundary on 2026-01-10", () => {
    expect(presetRange("last-month", new Date(2026, 0, 10))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("should end this month on the 29th in a leap-year February (2028-02-10)", () => {
    expect(presetRange("this-month", new Date(2028, 1, 10))).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("should end last month on the 31st when the previous month is longer (2026-06-10)", () => {
    expect(presetRange("last-month", new Date(2026, 5, 10))).toEqual({ from: "2026-05-01", to: "2026-05-31" });
  });
});

describe("inRange()", () => {
  const range = { from: "2026-02-01", to: "2026-02-28" };

  it("should include both bounds", () => {
    expect(inRange("2026-02-01", range)).toBe(true);
    expect(inRange("2026-02-28", range)).toBe(true);
  });

  it("should exclude dates just outside either bound", () => {
    expect(inRange("2026-01-31", range)).toBe(false);
    expect(inRange("2026-03-01", range)).toBe(false);
  });

  it("should treat a null from as open-ended into the past", () => {
    expect(inRange("1990-01-01", { from: null, to: "2026-02-28" })).toBe(true);
    expect(inRange("2026-03-01", { from: null, to: "2026-02-28" })).toBe(false);
  });

  it("should treat a null to as open-ended into the future", () => {
    expect(inRange("2999-12-31", { from: "2026-02-01", to: null })).toBe(true);
    expect(inRange("2026-01-31", { from: "2026-02-01", to: null })).toBe(false);
  });
});

describe("isIsoDate()", () => {
  it("should accept a real calendar date", () => {
    expect(isIsoDate("2026-01-05")).toBe(true);
    expect(isIsoDate("2026-12-31")).toBe(true);
  });

  it("should reject an impossible month or day that matches the shape", () => {
    expect(isIsoDate("2026-13-45")).toBe(false);
    expect(isIsoDate("2026-00-10")).toBe(false);
    expect(isIsoDate("2026-01-32")).toBe(false);
    expect(isIsoDate("2026-01-00")).toBe(false);
  });

  it("should reject a day the month does not have (overflow must not normalize)", () => {
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("2026-04-31")).toBe(false);
  });

  it("should apply the leap-year rule to February 29", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
  });

  it("should reject partial or non-ISO shapes", () => {
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate("2026-1-05")).toBe(false);
    expect(isIsoDate("05.01.2026")).toBe(false);
    expect(isIsoDate("2026-01-05x")).toBe(false);
  });
});
