// Serialize a rendered HTML <table> to CSV for the markdown table's "Download
// CSV" action. Kept separate from the React component so the escaping rules are
// unit-testable in isolation.

/**
 * Quote a field per RFC 4180: wrap it in double quotes when it contains a
 * comma, double quote, CR, or LF, doubling any inner double quotes.
 */
function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Serialize a rendered `<table>` to CSV (RFC 4180). Reads each cell's
 * `textContent` (so mention-chip labels come through and icon SVGs, which have
 * none, are ignored) and trims it. Fields are comma-separated, rows CRLF-separated.
 */
export function tableToCsv(table: HTMLTableElement): string {
  return Array.from(table.querySelectorAll("tr"))
    .map((row) =>
      Array.from(row.querySelectorAll("th,td"))
        .map((cell) => escapeCsvField(cell.textContent?.trim() ?? ""))
        .join(","),
    )
    .join("\r\n");
}
