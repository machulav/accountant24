// @vitest-environment jsdom

// Spec for the Investments view's table config: its storage key and
// defaults over the shared core — only Cost, P&L, and Allocation toggle,
// hidden by default; Commodity, Quantity, Price, and Value are the page's
// spine. Widths reuse the Net Worth page's holdings model (already
// specified in net-worth-columns.test.ts).

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { INVESTMENTS_TABLE_KEY, loadInvestmentsTableConfig, saveInvestmentsTableConfig } from "../investments-columns";
import { INVESTMENT_COLUMN_MIN_SIZES } from "../net-worth-columns";

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
