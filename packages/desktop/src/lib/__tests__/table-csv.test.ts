// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { tableToCsv } from "../table-csv";

type Cell = string | { tag?: "th" | "td"; html: string };

/** Build a real <table> from rows of cell contents. A plain string becomes a
 *  <td> with that exact text; `{ html }` sets innerHTML (to exercise nested
 *  elements and cells that carry no text). */
function buildTable(rows: Cell[][]): HTMLTableElement {
  const table = document.createElement("table");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const cell of row) {
      const el = document.createElement(typeof cell === "string" ? "td" : (cell.tag ?? "td"));
      if (typeof cell === "string") el.textContent = cell;
      else el.innerHTML = cell.html;
      tr.appendChild(el);
    }
    table.appendChild(tr);
  }
  return table;
}

describe("tableToCsv()", () => {
  it("should join cells with commas and rows with CRLF for a plain 2x2 table", () => {
    const table = buildTable([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(tableToCsv(table)).toBe("a,b\r\nc,d");
  });

  it("should include header (th) cells the same as body cells", () => {
    const table = buildTable([
      [
        { tag: "th", html: "Name" },
        { tag: "th", html: "Amount" },
      ],
      ["Rent", "2100"],
    ]);
    expect(tableToCsv(table)).toBe("Name,Amount\r\nRent,2100");
  });

  it("should quote a field that contains a comma", () => {
    const table = buildTable([["EUR 2,100.00", "Monthly"]]);
    expect(tableToCsv(table)).toBe('"EUR 2,100.00",Monthly');
  });

  it("should quote a field and double the inner quotes when it contains a double quote", () => {
    const table = buildTable([['say "hi"', "x"]]);
    expect(tableToCsv(table)).toBe('"say ""hi""",x');
  });

  it("should quote a field that contains a line feed", () => {
    const table = buildTable([["line1\nline2"]]);
    expect(tableToCsv(table)).toBe('"line1\nline2"');
  });

  it("should quote a field that contains a carriage return", () => {
    const table = buildTable([["a\rb"]]);
    expect(tableToCsv(table)).toBe('"a\rb"');
  });

  it("should leave a plain field unquoted", () => {
    const table = buildTable([["2026-04-28"]]);
    expect(tableToCsv(table)).toBe("2026-04-28");
  });

  it("should emit an empty field for an empty cell, keeping the separators", () => {
    const table = buildTable([["a", "", "c"]]);
    expect(tableToCsv(table)).toBe("a,,c");
  });

  it("should trim leading and trailing whitespace from a cell", () => {
    const table = buildTable([["  spaced  "]]);
    expect(tableToCsv(table)).toBe("spaced");
  });

  it("should read the combined text of nested elements (mention-chip label + trailing text)", () => {
    const table = buildTable([[{ html: '<span class="chip">Wolfgang und Sabine Jaeger</span> — rent' }]]);
    expect(tableToCsv(table)).toBe("Wolfgang und Sabine Jaeger — rent");
  });

  it("should ignore elements with no text such as icon SVGs", () => {
    const table = buildTable([[{ html: "<svg></svg>ARD" }]]);
    expect(tableToCsv(table)).toBe("ARD");
  });

  it("should serialize a single-cell table to just that field", () => {
    expect(tableToCsv(buildTable([["only"]]))).toBe("only");
  });

  it("should return an empty string for a table with no rows", () => {
    expect(tableToCsv(document.createElement("table"))).toBe("");
  });
});
