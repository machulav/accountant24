import { describe, expect, test } from "vitest";
import { JournalDoc } from "../doc";

const TX_MARCH_1 = "2026-03-01 * Old | Existing\n    Expenses:X    10.00 USD\n    Assets:Y\n";
const TX_MARCH_20 = "2026-03-20 * Late | Rent\n    Expenses:Rent    900.00 USD\n    Assets:Y\n";
const NEW_ENTRY =
  "2026-03-15 * Whole Foods | Groceries\n    Assets:Checking    -45.00 USD\n    Expenses:Food    45.00 USD";

describe("JournalDoc", () => {
  describe("open() + serialize()", () => {
    test("should round-trip a mixed journal byte-for-byte", () => {
      const text = `; header\n\ninclude accounts.journal\n\n${TX_MARCH_1}\n${TX_MARCH_20}`;
      expect(JournalDoc.open(text).serialize()).toBe(text);
    });

    test("should round-trip CRLF content byte-for-byte", () => {
      const text = "2026-03-01 * Old\r\n    Expenses:X    10.00 USD\r\n    Assets:Y\r\n";
      expect(JournalDoc.open(text).serialize()).toBe(text);
    });

    test("should round-trip a file without a trailing newline byte-for-byte", () => {
      const text = "include accounts.journal\n\n2026-03-01 * Old\n    Expenses:X    10.00 USD\n    Assets:Y";
      expect(JournalDoc.open(text).serialize()).toBe(text);
    });

    test("should round-trip an empty file", () => {
      expect(JournalDoc.open("").serialize()).toBe("");
    });
  });

  describe("entries()", () => {
    test("should list dated transaction and price blocks in file order with their indices", () => {
      const doc = JournalDoc.open(`; header\n\n${TX_MARCH_1}\nP 2026-03-10 USD 0.87 EUR\n\n${TX_MARCH_20}`);
      expect(doc.entries()).toMatchObject([
        { index: 2, date: "2026-03-01" },
        { index: 4, date: "2026-03-10" },
        { index: 6, date: "2026-03-20" },
      ]);
    });

    test("should exclude blocks whose date is unparseable", () => {
      const doc = JournalDoc.open(
        "2026-13-05 * Broken\n    A    1.00 USD\n\n2026-03-01 * Ok\n    A    1.00 USD\n    B\n",
      );
      expect(doc.entries()).toMatchObject([{ date: "2026-03-01" }]);
    });
  });

  describe("insertEntry()", () => {
    test("should write just the entry into an empty doc", () => {
      const doc = JournalDoc.open("");
      doc.insertEntry(NEW_ENTRY, "2026-03-15");
      expect(doc.serialize()).toBe(`${NEW_ENTRY}\n`);
    });

    test("should append after all entries with exactly one blank line, matching the historical append bytes", () => {
      const doc = JournalDoc.open(TX_MARCH_1);
      doc.insertEntry(NEW_ENTRY, "2026-03-15");
      // Historical behavior (writeMonthlyFiles): `${oldContent}\n${entry}\n`.
      expect(doc.serialize()).toBe(`${TX_MARCH_1}\n${NEW_ENTRY}\n`);
    });

    test("should terminate a file lacking a trailing newline before appending", () => {
      const doc = JournalDoc.open(TX_MARCH_1.trimEnd());
      doc.insertEntry(NEW_ENTRY, "2026-03-15");
      // Historical behavior: `${oldContent}\n\n${entry}\n`.
      expect(doc.serialize()).toBe(`${TX_MARCH_1.trimEnd()}\n\n${NEW_ENTRY}\n`);
    });

    test("should insert between entries in date order with one blank line on each side", () => {
      const doc = JournalDoc.open(`${TX_MARCH_1}\n${TX_MARCH_20}`);
      doc.insertEntry(NEW_ENTRY, "2026-03-15");
      expect(doc.serialize()).toBe(`${TX_MARCH_1}\n${NEW_ENTRY}\n\n${TX_MARCH_20}`);
    });

    test("should insert before all entries when the date is earliest", () => {
      const doc = JournalDoc.open(TX_MARCH_20);
      doc.insertEntry(NEW_ENTRY, "2026-03-15");
      expect(doc.serialize()).toBe(`${NEW_ENTRY}\n\n${TX_MARCH_20}`);
    });

    test("should insert a same-date entry after the existing entries of that date", () => {
      const first = "2026-03-15 * First\n    A    1.00 USD\n    B\n";
      const doc = JournalDoc.open(`${first}\n${TX_MARCH_20}`);
      doc.insertEntry(NEW_ENTRY, "2026-03-15");
      expect(doc.serialize()).toBe(`${first}\n${NEW_ENTRY}\n\n${TX_MARCH_20}`);
    });

    test("should insert after the last on-or-before entry even when the file is unsorted", () => {
      const doc = JournalDoc.open(`${TX_MARCH_20}\n${TX_MARCH_1}`);
      doc.insertEntry(NEW_ENTRY, "2026-03-15");
      expect(doc.serialize()).toBe(`${TX_MARCH_20}\n${TX_MARCH_1}\n${NEW_ENTRY}\n`);
    });

    test("should insert a P directive among transactions by date", () => {
      const doc = JournalDoc.open(`${TX_MARCH_1}\n${TX_MARCH_20}`);
      doc.insertEntry("P 2026-03-10 USD 0.87 EUR", "2026-03-10");
      expect(doc.serialize()).toBe(`${TX_MARCH_1}\nP 2026-03-10 USD 0.87 EUR\n\n${TX_MARCH_20}`);
    });

    test("should not separate a comment glued to the following transaction", () => {
      const doc = JournalDoc.open(`${TX_MARCH_1}; about rent\n${TX_MARCH_20}`);
      doc.insertEntry(NEW_ENTRY, "2026-03-15");
      expect(doc.serialize()).toBe(`${TX_MARCH_1}\n${NEW_ENTRY}\n\n; about rent\n${TX_MARCH_20}`);
    });

    test("should keep a blank-separated comment with its following transaction", () => {
      const doc = JournalDoc.open(`${TX_MARCH_1}\n; about rent\n${TX_MARCH_20}`);
      doc.insertEntry(NEW_ENTRY, "2026-03-15");
      expect(doc.serialize()).toBe(`${TX_MARCH_1}\n${NEW_ENTRY}\n\n; about rent\n${TX_MARCH_20}`);
    });

    test("should insert after a trailing comment that has no following transaction", () => {
      const doc = JournalDoc.open(`${TX_MARCH_1}; trailing note\n`);
      doc.insertEntry(NEW_ENTRY, "2026-03-15");
      expect(doc.serialize()).toBe(`${TX_MARCH_1}; trailing note\n\n${NEW_ENTRY}\n`);
    });

    test("should insert above a comment glued to the first transaction when the date is earliest", () => {
      const doc = JournalDoc.open(`; about rent\n${TX_MARCH_20}`);
      doc.insertEntry(NEW_ENTRY, "2026-03-15");
      expect(doc.serialize()).toBe(`${NEW_ENTRY}\n\n; about rent\n${TX_MARCH_20}`);
    });

    test("should append at EOF when the file has no dated entries", () => {
      const doc = JournalDoc.open("; monthly file header\n");
      doc.insertEntry(NEW_ENTRY, "2026-03-15");
      expect(doc.serialize()).toBe(`; monthly file header\n\n${NEW_ENTRY}\n`);
    });

    test("should render the new entry with CRLF in a CRLF file and keep old bytes untouched", () => {
      const crlf = "2026-03-01 * Old\r\n    Expenses:X    10.00 USD\r\n    Assets:Y\r\n";
      const doc = JournalDoc.open(crlf);
      doc.insertEntry("2026-03-15 * New\n    A    1.00 USD\n    B", "2026-03-15");
      expect(doc.serialize()).toBe(`${crlf}\r\n2026-03-15 * New\r\n    A    1.00 USD\r\n    B\r\n`);
    });

    test("should anchor on the last dated entry, ignoring unparseable-date blocks", () => {
      const broken = "2026-13-05 * Broken\n    A    1.00 USD\n";
      const doc = JournalDoc.open(`${TX_MARCH_1}\n${broken}`);
      doc.insertEntry(NEW_ENTRY, "2026-03-15");
      expect(doc.serialize()).toBe(`${TX_MARCH_1}\n${NEW_ENTRY}\n\n${broken}`);
    });

    test("should reject a date not in YYYY-MM-DD format", () => {
      expect(() => JournalDoc.open("").insertEntry(NEW_ENTRY, "2026-3-15")).toThrow("Invalid date format");
    });

    test("should reject entry text that is not a transaction or P directive", () => {
      expect(() => JournalDoc.open("").insertEntry("include a.journal", "2026-03-15")).toThrow(
        "must be a single transaction or P directive",
      );
    });

    test("should reject entry text spanning multiple blocks", () => {
      const two = "2026-03-15 * A\n    X    1.00 USD\n    Y\n\n2026-03-16 * B\n    X    1.00 USD\n    Y\n";
      expect(() => JournalDoc.open("").insertEntry(two, "2026-03-15")).toThrow("exactly one block");
    });

    test("should reject a date that is not a real calendar day", () => {
      expect(() => JournalDoc.open("").insertEntry(NEW_ENTRY, "2026-02-31")).toThrow(
        "That calendar day does not exist",
      );
    });

    test("should reject entry text whose own date differs from the given date", () => {
      expect(() => JournalDoc.open("").insertEntry(NEW_ENTRY, "2026-03-16")).toThrow("does not match");
    });

    test("should accept a non-canonical text date that names the same day", () => {
      const doc = JournalDoc.open("");
      doc.insertEntry("2026/3/15 * New\n    A    1.00 EUR\n    B", "2026-03-15");
      expect(doc.serialize()).toBe("2026/3/15 * New\n    A    1.00 EUR\n    B\n");
    });

    test("should keep a missing final newline when inserting before the last block", () => {
      const doc = JournalDoc.open(TX_MARCH_20.trimEnd());
      doc.insertEntry(NEW_ENTRY, "2026-03-15");
      expect(doc.serialize()).toBe(`${NEW_ENTRY}\n\n${TX_MARCH_20.trimEnd()}`);
    });

    test("should normalize CRLF entry text into an LF document", () => {
      const doc = JournalDoc.open(TX_MARCH_1);
      doc.insertEntry("2026-03-15 * New\r\n    A    1.00 USD\r\n    B", "2026-03-15");
      expect(doc.serialize()).toBe(`${TX_MARCH_1}\n2026-03-15 * New\n    A    1.00 USD\n    B\n`);
    });
  });

  describe("replaceBlock()", () => {
    test("should replace one block and keep every other byte", () => {
      const text = `; header\n\n${TX_MARCH_1}\n${TX_MARCH_20}`;
      const doc = JournalDoc.open(text);
      doc.replaceBlock(2, "2026-03-01 * Renamed\n    Expenses:X    10.00 USD\n    Assets:Y");
      expect(doc.serialize()).toBe(
        `; header\n\n2026-03-01 * Renamed\n    Expenses:X    10.00 USD\n    Assets:Y\n\n${TX_MARCH_20}`,
      );
    });

    test("should reject an out-of-range index", () => {
      expect(() => JournalDoc.open(TX_MARCH_1).replaceBlock(5, "; x")).toThrow("out of range");
    });
  });

  describe("appendBlock()", () => {
    test("should append with a blank-line separator", () => {
      const doc = JournalDoc.open(TX_MARCH_1);
      doc.appendBlock("include 2026/04.journal");
      expect(doc.serialize()).toBe(`${TX_MARCH_1}\ninclude 2026/04.journal\n`);
    });

    test("should append to an empty document without a separator", () => {
      const doc = JournalDoc.open("");
      doc.appendBlock("include 2026/04.journal");
      expect(doc.serialize()).toBe("include 2026/04.journal\n");
    });
  });

  describe("blocks", () => {
    test("should renumber line spans after an insertion", () => {
      const doc = JournalDoc.open(`${TX_MARCH_1}\n${TX_MARCH_20}`);
      doc.insertEntry(NEW_ENTRY, "2026-03-15");
      const spans = doc.blocks.map((b) => [b.startLine, b.endLine]);
      expect(spans).toEqual([
        [1, 3], // March 1 transaction
        [4, 4], // blank
        [5, 7], // inserted entry
        [8, 8], // blank
        [9, 11], // March 20 transaction
      ]);
    });
  });
});
