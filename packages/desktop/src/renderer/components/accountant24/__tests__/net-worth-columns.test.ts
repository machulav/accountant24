// @vitest-environment jsdom

// Spec for the Net Worth table config: its storage key and defaults over
// the shared core, and the static width model — the same as the
// Transactions register: fixed defaults whose default-visible set fills
// the 52rem page floor exactly, optional columns growing the table past
// the floor, and minimums that keep every header pill sitting with equal
// breathing room to both column separators.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import {
  COLUMN_MIN_SIZES,
  COLUMN_SIZES,
  loadTableConfig,
  NET_WORTH_TABLE_KEY,
  saveTableConfig,
  tableWidth,
} from "../net-worth-columns";

beforeAll(() => installJsdomPolyfills());
beforeEach(() => {
  window.localStorage.clear();
});

describe("loadTableConfig()", () => {
  it("should hide both assertion columns by default with no custom widths", () => {
    expect(loadTableConfig()).toEqual({ visibility: { asserted: false, assertedAmount: false }, sizing: {} });
  });

  it("should round-trip the config under the net-worth key", () => {
    const config = { visibility: { asserted: true, assertedAmount: false }, sizing: { account: 320 } };
    saveTableConfig(config);
    expect(JSON.parse(window.localStorage.getItem(NET_WORTH_TABLE_KEY) ?? "")).toEqual(config);
    expect(loadTableConfig()).toEqual(config);
  });
});

describe("column sizes", () => {
  it("should keep every default at or above its column's minimum", () => {
    for (const [id, min] of Object.entries(COLUMN_MIN_SIZES)) {
      expect(COLUMN_SIZES[id]).toBeGreaterThanOrEqual(min);
    }
  });
});

describe("tableWidth()", () => {
  it("should fill exactly the 52rem page floor while the assertion pair is hidden", () => {
    // account 492 + holding 170 + value 170.
    expect(tableWidth(loadTableConfig())).toBe(832);
  });

  it("should grow past the floor when the assertion pair is on", () => {
    // 832 + asserted 170 + assertedAmount 200 — the page scrolls, like the
    // Transactions register with its optional columns on.
    expect(tableWidth({ visibility: { asserted: true, assertedAmount: true }, sizing: {} })).toBe(1202);
  });

  it("should prefer a resized width over the default", () => {
    expect(tableWidth({ visibility: { asserted: false, assertedAmount: false }, sizing: { account: 300 } })).toBe(640);
  });
});
