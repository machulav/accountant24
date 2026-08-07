// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_COLUMN_VISIBILITY,
  loadTableConfig,
  saveTableConfig,
  TRANSACTIONS_TABLE_KEY,
} from "../transactions-columns";

// The Transactions table's shape (column visibility, drag order, resized
// widths) persists across app restarts via localStorage; loading must
// survive absent, garbled, or stale entries by falling back to the defaults
// (date, payee, account, amount on; comment, tags, status off; definition
// order; no custom widths).

beforeAll(() => {
  if (!window.localStorage) {
    // This jsdom build ships without Web Storage; back it with a Map.
    const backing = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: (k: string) => backing.get(k) ?? null,
        setItem: (k: string, v: string) => void backing.set(k, String(v)),
        removeItem: (k: string) => void backing.delete(k),
        clear: () => backing.clear(),
        key: (i: number) => [...backing.keys()][i] ?? null,
        get length() {
          return backing.size;
        },
      } satisfies Storage,
    });
  }
});

beforeEach(() => {
  window.localStorage.clear();
});

const DEFAULTS = {
  visibility: {
    date: true,
    payee: true,
    note: false,
    account: true,
    amount: true,
    tags: false,
    status: false,
  },
  sizing: {},
};

describe("loadTableConfig()", () => {
  it("should return the defaults when nothing is stored", () => {
    expect(loadTableConfig()).toEqual(DEFAULTS);
  });

  it("should return the defaults for a garbled or non-object entry", () => {
    window.localStorage.setItem(TRANSACTIONS_TABLE_KEY, "not json {");
    expect(loadTableConfig()).toEqual(DEFAULTS);
    window.localStorage.setItem(TRANSACTIONS_TABLE_KEY, JSON.stringify(["date"]));
    expect(loadTableConfig()).toEqual(DEFAULTS);
  });

  it("should overlay stored visibility booleans onto the defaults and drop junk", () => {
    window.localStorage.setItem(
      TRANSACTIONS_TABLE_KEY,
      JSON.stringify({ visibility: { tags: true, payee: false, holding: true, date: "yes" } }),
    );
    expect(loadTableConfig().visibility).toEqual({ ...DEFAULT_COLUMN_VISIBILITY, tags: true, payee: false });
  });

  it("should ignore an older build's stored column order", () => {
    window.localStorage.setItem(TRANSACTIONS_TABLE_KEY, JSON.stringify({ order: ["amount", "date", "expand"] }));
    expect(loadTableConfig()).toEqual(DEFAULTS);
  });

  it("should keep only known columns with positive finite widths in sizing", () => {
    window.localStorage.setItem(
      TRANSACTIONS_TABLE_KEY,
      JSON.stringify({ sizing: { date: 120, payee: -5, bogus: 100, amount: "wide", note: Number.NaN } }),
    );
    expect(loadTableConfig().sizing).toEqual({ date: 120 });
  });

  it("should return fresh objects, not the shared defaults", () => {
    const loaded = loadTableConfig();
    loaded.visibility.date = false;
    expect(DEFAULT_COLUMN_VISIBILITY.date).toBe(true);
  });
});

describe("saveTableConfig()", () => {
  it("should round-trip through load", () => {
    saveTableConfig({
      visibility: { ...DEFAULT_COLUMN_VISIBILITY, status: true },
      sizing: { account: 300 },
    });
    expect(loadTableConfig()).toEqual({
      visibility: { ...DEFAULT_COLUMN_VISIBILITY, status: true },
      sizing: { account: 300 },
    });
  });

  it("should swallow a throwing localStorage (persistence is best-effort)", () => {
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    try {
      expect(() => saveTableConfig(loadTableConfig())).not.toThrow();
    } finally {
      setItem.mockRestore();
    }
  });
});
