import { describe, expect, it } from "vitest";
import { cellsFor, RAMP, renderAsciiFrame } from "../ascii-field";

describe("cellsFor()", () => {
  it("should return 219 columns and 65 rows for a 1440x900 box", () => {
    expect(cellsFor(1440, 900)).toEqual({ cols: 219, rows: 65 });
  });

  it("should round a partial cell up so the box is fully covered", () => {
    expect(cellsFor(7, 15)).toEqual({ cols: 2, rows: 2 });
  });

  it("should return no cells for an empty box", () => {
    expect(cellsFor(0, 0)).toEqual({ cols: 0, rows: 0 });
  });
});

describe("renderAsciiFrame()", () => {
  it("should render the given number of rows, each of the given width plus a newline", () => {
    const lines = renderAsciiFrame(40, 5, 0).split("\n");
    expect(lines).toHaveLength(6);
    expect(lines.slice(0, 5).every((line) => line.length === 40)).toBe(true);
    expect(lines[5]).toBe("");
  });

  it("should use only characters from the ramp", () => {
    const chars = new Set(renderAsciiFrame(300, 60, 2.5).replace(/\n/g, ""));
    for (const char of chars) expect(RAMP).toContain(char);
  });

  it("should bias toward faint cells while still drawing dense ones", () => {
    const frame = renderAsciiFrame(300, 60, 0).replace(/\n/g, "");
    const faint = [...frame].filter((c) => " .:".includes(c)).length;
    const dense = [...frame].filter((c) => "$€£₴¥".includes(c)).length;
    expect(dense).toBeGreaterThan(0);
    expect(faint).toBeGreaterThan(dense * 2);
  });

  it("should render the same frame for the same time", () => {
    expect(renderAsciiFrame(80, 10, 1.25)).toBe(renderAsciiFrame(80, 10, 1.25));
  });

  it("should render a different frame when time moves on", () => {
    expect(renderAsciiFrame(80, 10, 0)).not.toBe(renderAsciiFrame(80, 10, 1));
  });

  it("should render an empty string when there are no rows", () => {
    expect(renderAsciiFrame(80, 0, 0)).toBe("");
  });

  it("should render only newlines when there are no columns", () => {
    expect(renderAsciiFrame(0, 3, 0)).toBe("\n\n\n");
  });
});
