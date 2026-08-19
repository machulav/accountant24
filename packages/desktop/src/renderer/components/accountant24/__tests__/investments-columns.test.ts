// @vitest-environment jsdom

// Spec for the Investments view's table config: its storage key and
// defaults over the shared core — only Cost, P&L, and Allocation toggle,
// hidden by default; Commodity, Quantity, Price, and Value are the page's
// spine. Also the static width model: fixed defaults whose default-visible
// set spans the same width as the Net Worth account tables, optional
// columns growing the table past the floor, and minimums that keep every
// header pill readable.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import {
  INVESTMENT_COLUMN_MIN_SIZES,
  INVESTMENT_COLUMN_SIZES,
  INVESTMENTS_TABLE_KEY,
  investmentsTableWidth,
  loadInvestmentsTableConfig,
  saveInvestmentsTableConfig,
} from "../investments-columns";

beforeAll(() => installJsdomPolyfills());
beforeEach(() => {
  window.localStorage.clear();
});

describe("loadInvestmentsTableConfig()", () => {
  it("should hide the optional Cost, P&L, and Allocation columns by default with no custom widths", () => {
    expect(loadInvestmentsTableConfig()).toEqual({
      visibility: { cost: false, pnl: false, allocation: false },
      sizing: {},
    });
  });

  it("should round-trip the config under the investments-table key", () => {
    const config = { visibility: { cost: true, pnl: false }, sizing: { commodity: 320 } };
    saveInvestmentsTableConfig(config);
    expect(JSON.parse(window.localStorage.getItem(INVESTMENTS_TABLE_KEY) ?? "")).toEqual(config);
    // Reload merges the hidden-by-default columns back in.
    expect(loadInvestmentsTableConfig()).toEqual({
      visibility: { ...config.visibility, allocation: false },
      sizing: config.sizing,
    });
  });

  it("should clamp stored sub-minimum widths up to each column's minimum", () => {
    // Raw drag values below the minimums (the grid clamps only at render)
    // must not survive a reload into the width model.
    saveInvestmentsTableConfig({ visibility: { cost: false }, sizing: { commodity: 60, value: 30 } });
    expect(loadInvestmentsTableConfig().sizing).toEqual({
      commodity: INVESTMENT_COLUMN_MIN_SIZES.commodity,
      value: INVESTMENT_COLUMN_MIN_SIZES.value,
    });
  });

  it("should drop unknown columns and non-boolean visibility from a stale entry", () => {
    window.localStorage.setItem(
      INVESTMENTS_TABLE_KEY,
      JSON.stringify({ visibility: { bogus: true, cost: "yes", pnl: true }, sizing: { nope: 42 } }),
    );
    expect(loadInvestmentsTableConfig()).toEqual({
      visibility: { cost: false, pnl: true, allocation: false },
      sizing: {},
    });
  });
});

describe("column sizes", () => {
  it("should keep every default at or above its column's minimum", () => {
    for (const [id, min] of Object.entries(INVESTMENT_COLUMN_MIN_SIZES)) {
      expect(INVESTMENT_COLUMN_SIZES[id]).toBeGreaterThanOrEqual(min);
    }
  });
});

describe("investmentsTableWidth()", () => {
  it("should span the same default-visible set as the account tables", () => {
    // commodity 350 + quantity 140 + price 170 + value 170 = 830 ≈ 832.
    expect(investmentsTableWidth(loadInvestmentsTableConfig())).toBe(830);
  });

  it("should grow when the optional Cost, P&L, and Allocation columns come on", () => {
    expect(investmentsTableWidth({ visibility: { cost: true, pnl: true, allocation: true }, sizing: {} })).toBe(
      830 + 170 + 170 + 120,
    );
  });

  it("should prefer resized widths and clamp to minimums like the account tables", () => {
    // commodity 60 clamps to its 140 minimum; the rest keep their defaults.
    expect(
      investmentsTableWidth({
        visibility: { cost: false, pnl: false, allocation: false },
        sizing: { commodity: 60 },
      }),
    ).toBe(INVESTMENT_COLUMN_MIN_SIZES.commodity + 140 + 170 + 170);
  });
});
