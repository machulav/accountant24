import { describe, expect, test } from "bun:test";
import { generateDiff } from "../diff";

describe("generateDiff()", () => {
  test("should show added lines with + prefix", () => {
    const diff = generateDiff("", "new line\n");
    expect(diff).toContain("+");
    expect(diff).toContain("new line");
  });

  test("should show removed lines with - prefix", () => {
    const diff = generateDiff("old line\n", "");
    expect(diff).toContain("-");
    expect(diff).toContain("old line");
  });

  test("should show context lines with space prefix", () => {
    const diff = generateDiff("keep\nold\n", "keep\nnew\n");
    expect(diff).toContain("keep");
  });

  test("should include line numbers", () => {
    const diff = generateDiff("line1\n", "line1\nline2\n");
    expect(diff).toMatch(/\d+/);
  });

  test("should return empty string for identical content", () => {
    expect(generateDiff("same\n", "same\n")).toBe("");
  });

  test("should use ... for skipped context", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    const diff = generateDiff(lines, lines.replace("line 10", "changed 10"));
    expect(diff).toContain("...");
    expect(diff).toContain("changed 10");
  });
});
