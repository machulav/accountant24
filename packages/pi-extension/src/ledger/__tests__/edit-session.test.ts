import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { JournalEditSession } from "../edit-session";

// Real files at the fs boundary: the session's whole job is disk state, so mocking
// the filesystem would test nothing. Each test gets a throwaway directory.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "accountant24-session-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seed(name: string, content: string): string {
  const abs = join(dir, name);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

function read(abs: string): string {
  return readFileSync(abs, "utf-8");
}

describe("JournalEditSession", () => {
  describe("read()", () => {
    test("returns the on-disk content on first touch", () => {
      const abs = seed("a.journal", "hello");
      const session = new JournalEditSession();
      expect(session.read(abs)).toBe("hello");
    });

    test("returns staged content, not disk, once written", () => {
      const abs = seed("a.journal", "hello");
      const session = new JournalEditSession();
      session.read(abs);
      session.write(abs, "world");
      expect(session.read(abs)).toBe("world");
    });

    test("does not re-read disk after the first touch (staging is authoritative)", () => {
      const abs = seed("a.journal", "hello");
      const session = new JournalEditSession();
      session.read(abs);
      writeFileSync(abs, "changed-underneath");
      expect(session.read(abs)).toBe("hello"); // snapshot from first touch, not the new disk state
    });
  });

  describe("write() and flush()", () => {
    test("write alone does not reach disk", () => {
      const abs = seed("a.journal", "hello");
      const session = new JournalEditSession();
      session.read(abs);
      session.write(abs, "world");
      expect(read(abs)).toBe("hello"); // still the original until flush
    });

    test("flush persists staged changes to disk", () => {
      const abs = seed("a.journal", "hello");
      const session = new JournalEditSession();
      session.read(abs);
      session.write(abs, "world");
      session.flush();
      expect(read(abs)).toBe("world");
    });

    test("flush writes only files whose staged content changed", () => {
      const a = seed("a.journal", "aaa");
      const b = seed("b.journal", "bbb");
      const session = new JournalEditSession();
      session.read(a);
      session.read(b);
      session.write(a, "AAA"); // b read but untouched

      const written = session.flush();

      expect(written).toEqual([a]);
      expect(read(b)).toBe("bbb");
    });

    test("flush does not write a file rewritten to its original content", () => {
      const abs = seed("a.journal", "hello");
      const session = new JournalEditSession();
      session.read(abs);
      session.write(abs, "hello"); // same as snapshot
      expect(session.flush()).toEqual([]);
    });
  });

  describe("restore()", () => {
    test("reverts a flushed change back to the snapshot content", () => {
      const abs = seed("a.journal", "hello");
      const session = new JournalEditSession();
      session.read(abs);
      session.write(abs, "world");
      session.flush();
      session.restore();
      expect(read(abs)).toBe("hello");
    });

    test("reverts every file the flush wrote", () => {
      const a = seed("a.journal", "aaa");
      const b = seed("b.journal", "bbb");
      const session = new JournalEditSession();
      session.read(a);
      session.read(b);
      session.write(a, "AAA");
      session.write(b, "BBB");
      session.flush();
      session.restore();
      expect(read(a)).toBe("aaa");
      expect(read(b)).toBe("bbb");
    });

    test("does not touch a file that flush skipped", () => {
      const a = seed("a.journal", "aaa");
      const b = seed("b.journal", "bbb");
      const session = new JournalEditSession();
      session.read(a);
      session.read(b);
      session.write(a, "AAA");
      session.flush();
      // A third party edits the untouched file after flush; restore must leave it alone.
      writeFileSync(b, "external");
      session.restore();
      expect(read(b)).toBe("external");
    });
  });

  describe("diff()", () => {
    test("is empty when nothing changed", () => {
      const abs = seed("a.journal", "hello");
      const session = new JournalEditSession();
      session.read(abs);
      expect(session.diff()).toEqual([]);
    });

    test("reports one entry per changed file, keyed by absolute path", () => {
      const a = seed("a.journal", "aaa\n");
      const b = seed("b.journal", "bbb\n");
      const session = new JournalEditSession();
      session.read(a);
      session.read(b);
      session.write(a, "AAA\n");

      const diffs = session.diff();

      expect(diffs).toHaveLength(1);
      expect(diffs[0].fullFilePath).toBe(a);
      expect(diffs[0].diff).toContain("AAA");
    });

    test("reflects staged content even before flush", () => {
      const abs = seed("a.journal", "old\n");
      const session = new JournalEditSession();
      session.read(abs);
      session.write(abs, "new\n");
      expect(session.diff()[0].diff).toContain("new");
    });
  });
});
