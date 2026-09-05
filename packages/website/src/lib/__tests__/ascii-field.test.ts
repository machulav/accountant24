import { describe, expect, it } from "vitest";
import { backingSize, CELL, cellsFor, RAMP, renderAsciiFrame } from "../ascii-field";

describe("CELL", () => {
  it("should describe an 11px IBM Plex Mono cell: 6.6px wide on a 14px line", () => {
    expect(CELL).toEqual({ font: 11, width: 6.6, height: 14 });
  });
});

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

describe("backingSize()", () => {
  it("should scale the bitmap by the device pixel ratio", () => {
    expect(backingSize(400, 300, 1.5)).toEqual({ width: 600, height: 450, scale: 1.5 });
  });

  it("should draw at most two device pixels per CSS pixel", () => {
    expect(backingSize(400, 300, 3)).toEqual({ width: 800, height: 600, scale: 2 });
  });

  it("should never draw below one device pixel per CSS pixel", () => {
    expect(backingSize(400, 300, 0.5)).toEqual({ width: 400, height: 300, scale: 1 });
  });

  it("should round the bitmap to whole pixels", () => {
    expect(backingSize(333, 100.4, 1.5)).toEqual({ width: 500, height: 151, scale: 1.5 });
  });

  it("should return an empty bitmap for an empty box", () => {
    expect(backingSize(0, 0, 2)).toEqual({ width: 0, height: 0, scale: 2 });
  });
});

describe("renderAsciiFrame()", () => {
  it("should render one string per row, each as long as the column count", () => {
    const lines = renderAsciiFrame(40, 5, 0);
    expect(lines).toHaveLength(5);
    expect(lines.every((line) => line.length === 40)).toBe(true);
  });

  it("should use only characters from the ramp", () => {
    const chars = new Set(renderAsciiFrame(300, 60, 2.5).join(""));
    for (const char of chars) expect(RAMP).toContain(char);
  });

  it("should bias toward faint cells while still drawing dense ones", () => {
    const frame = renderAsciiFrame(300, 60, 0).join("");
    const faint = [...frame].filter((c) => " .:".includes(c)).length;
    const dense = [...frame].filter((c) => "$€£₴¥".includes(c)).length;
    expect(dense).toBeGreaterThan(0);
    expect(faint).toBeGreaterThan(dense * 2);
  });

  it("should render the same frame for the same time", () => {
    expect(renderAsciiFrame(80, 10, 1.25)).toEqual(renderAsciiFrame(80, 10, 1.25));
  });

  it("should render a different frame when time moves on", () => {
    expect(renderAsciiFrame(80, 10, 0)).not.toEqual(renderAsciiFrame(80, 10, 1));
  });

  it("should render no rows when there are none", () => {
    expect(renderAsciiFrame(80, 0, 0)).toEqual([]);
  });

  it("should render empty rows when there are no columns", () => {
    expect(renderAsciiFrame(0, 3, 0)).toEqual(["", "", ""]);
  });
});
