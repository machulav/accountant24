import { describe, expect, it } from "vitest";
import { formatDuration } from "../duration";

describe("formatDuration()", () => {
  it("should return '<1s' when ms is 0", () => {
    expect(formatDuration(0)).toBe("<1s");
  });

  it("should return '<1s' when ms is 999", () => {
    expect(formatDuration(999)).toBe("<1s");
  });

  it("should return '1s' when ms is 1000", () => {
    expect(formatDuration(1000)).toBe("1s");
  });

  it("should return '6s' when ms is 6250 (whole seconds, floored)", () => {
    expect(formatDuration(6250)).toBe("6s");
  });

  it("should return '9s' when ms is 9999", () => {
    expect(formatDuration(9999)).toBe("9s");
  });

  it("should return '10s' when ms is 10000", () => {
    expect(formatDuration(10_000)).toBe("10s");
  });

  it("should return '45s' when ms is 45900 (floored)", () => {
    expect(formatDuration(45_900)).toBe("45s");
  });

  it("should return '1m 0s' when ms is 60000", () => {
    expect(formatDuration(60_000)).toBe("1m 0s");
  });

  it("should return '6m 23s' when ms is 383000", () => {
    expect(formatDuration(383_000)).toBe("6m 23s");
  });

  it("should return '61m 1s' when ms is 3661000 (no hours unit)", () => {
    expect(formatDuration(3_661_000)).toBe("61m 1s");
  });
});
