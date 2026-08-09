// @vitest-environment jsdom

// Spec for the Net Worth table config: its storage key and defaults over
// the shared core, and the page-width math the view sizes its body with
// (the visible columns' widths summed, resizes and hidden columns
// respected — mirroring TanStack's getTotalSize()).

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { loadTableConfig, NET_WORTH_TABLE_KEY, saveTableConfig, tableWidth } from "../net-worth-columns";

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

describe("tableWidth()", () => {
  it("should sum only the spine columns while the assertion pair is hidden", () => {
    // account 400 + holding 180 + value 160.
    expect(tableWidth(loadTableConfig())).toBe(740);
  });

  it("should include the assertion pair when visible", () => {
    // 740 + asserted 130 + assertedAmount 170.
    expect(tableWidth({ visibility: { asserted: true, assertedAmount: true }, sizing: {} })).toBe(1040);
  });

  it("should prefer a resized width over the default", () => {
    expect(tableWidth({ visibility: { asserted: false, assertedAmount: false }, sizing: { account: 500 } })).toBe(840);
  });
});
