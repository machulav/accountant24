import { describe, expect, test } from "bun:test";
import { buildLogoLine } from "../shared";

describe("buildLogoLine()", () => {
  test("should contain the Accountant24 title", () => {
    expect(buildLogoLine(80)).toContain("Accountant24");
  });

  test("should start with ── prefix before title", () => {
    expect(buildLogoLine(80)).toMatch(/^── Accountant24 /);
  });

  test("should fill remaining width with ─ characters", () => {
    const line = buildLogoLine(40);
    // "── Accountant24 " = 2 + 1 + 12 + 1 = 16 chars prefix
    const expectedFill = 40 - 16;
    expect(line).toBe(`── Accountant24 ${"─".repeat(expectedFill)}`);
  });

  test("should return exact width output", () => {
    for (const w of [20, 60, 80, 120]) {
      expect(buildLogoLine(w).length).toBe(w);
    }
  });

  test("should produce no fill when width equals prefix length", () => {
    // prefix is exactly 16 chars
    expect(buildLogoLine(16)).toBe("── Accountant24 ");
  });

  test("should produce no fill when width is less than prefix length", () => {
    const line = buildLogoLine(10);
    expect(line).toBe("── Accountant24 ");
  });

  test("should handle zero width", () => {
    const line = buildLogoLine(0);
    expect(line).toBe("── Accountant24 ");
  });
});
