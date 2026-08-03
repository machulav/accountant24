import { describe, expect, it } from "vitest";
import { isLongText, LONG_TEXT_CHARS, LONG_TEXT_LINES, previewLine } from "../longText";

const chars = (n: number) => "x".repeat(n);
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");

describe("isLongText()", () => {
  it("should return false for an ordinary chat message", () => {
    expect(isLongText("how much did I spend on groceries last month?")).toBe(false);
  });

  it("should return false for an empty string", () => {
    expect(isLongText("")).toBe(false);
  });

  it("should return false at exactly the character limit", () => {
    expect(isLongText(chars(LONG_TEXT_CHARS))).toBe(false);
  });

  it("should return true one character past the limit", () => {
    expect(isLongText(chars(LONG_TEXT_CHARS + 1))).toBe(true);
  });

  it("should return false at exactly the line limit", () => {
    expect(isLongText(lines(LONG_TEXT_LINES))).toBe(false);
  });

  it("should return true one line past the limit", () => {
    expect(isLongText(lines(LONG_TEXT_LINES + 1))).toBe(true);
  });

  // Long by shape rather than volume: many short lines still fill the view.
  it("should return true for many short lines well under the character limit", () => {
    const text = lines(LONG_TEXT_LINES + 5);
    expect(text.length).toBeLessThan(LONG_TEXT_CHARS);
    expect(isLongText(text)).toBe(true);
  });

  // The case that prompted this: an ACP client wrapping each turn in its own
  // context block. Nothing here knows that, it is just long.
  it("should return true for a turn wrapped in a client's context scaffold", () => {
    const wrapped = `[Context]\nScope: dm\nChannel: DM (#abc)\n\n${chars(900)}\n\nContent: hi`;
    expect(isLongText(wrapped)).toBe(true);
  });
});

describe("previewLine()", () => {
  it("should return a single-line message unchanged", () => {
    expect(previewLine("add 20 EUR for coffee")).toBe("add 20 EUR for coffee");
  });

  it("should keep only the first line of a multi-line message", () => {
    expect(previewLine("first line\nsecond line\nthird line")).toBe("first line");
  });

  it("should skip leading blank lines", () => {
    expect(previewLine("\n\n   \nreal content\nmore")).toBe("real content");
  });

  it("should trim surrounding whitespace", () => {
    expect(previewLine("   padded   \nnext")).toBe("padded");
  });

  it("should return an empty string for blank input so callers can fall back", () => {
    expect(previewLine("   \n\n  ")).toBe("");
    expect(previewLine("")).toBe("");
  });

  it("should cap an overlong first line with an ellipsis", () => {
    const result = previewLine(chars(500), 20);
    expect(result).toBe(`${chars(20)}…`);
  });

  it("should not cap a line at exactly the maximum", () => {
    expect(previewLine(chars(20), 20)).toBe(chars(20));
  });

  it("should not leave trailing whitespace before the ellipsis", () => {
    // The cut at 12 lands inside the run of spaces: "aaaa bbbb   ".
    expect(previewLine("aaaa bbbb   cccc dddd", 12)).toBe("aaaa bbbb…");
  });
});
