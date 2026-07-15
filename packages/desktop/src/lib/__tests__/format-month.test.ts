import { describe, expect, it } from "vitest";
import { formatMonthLong, formatMonthShort } from "../format-month";

describe("formatMonthShort()", () => {
  it("should return 'Aug' when month=2025-08", () => {
    expect(formatMonthShort("2025-08")).toBe("Aug");
  });

  it("should return 'Jan' when month=2026-01", () => {
    expect(formatMonthShort("2026-01")).toBe("Jan");
  });

  it("should return the input unchanged when it is not a YYYY-MM label", () => {
    expect(formatMonthShort("total")).toBe("total");
  });
});

describe("formatMonthLong()", () => {
  it("should return 'Aug 2025' when month=2025-08", () => {
    expect(formatMonthLong("2025-08")).toBe("Aug 2025");
  });

  it("should return the input unchanged when it is not a YYYY-MM label", () => {
    expect(formatMonthLong("")).toBe("");
  });
});
