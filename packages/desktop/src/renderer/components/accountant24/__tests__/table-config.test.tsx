// @vitest-environment jsdom

// Spec for the shared table-config core: stored configs are validated
// field by field over the page's defaults (garbage can never hide or break
// a table), saves never throw, and the hook persists changes debounced —
// including a flush on unmount, so a page that unmounts on view switch
// (Net Worth) never loses a change made within the debounce window.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { loadStoredTableConfig, saveStoredTableConfig, type TableConfig, useTableConfig } from "../table-config";

const KEY = "accountant24.test-table";
const DEFAULT_VISIBILITY = { alpha: true, beta: false };
const SIZABLE = ["chrome", "alpha", "beta"];

const load = () => loadStoredTableConfig(KEY, DEFAULT_VISIBILITY, SIZABLE);

beforeAll(() => installJsdomPolyfills());
beforeEach(() => {
  window.localStorage.clear();
});

describe("loadStoredTableConfig()", () => {
  it("should return the defaults when nothing is stored", () => {
    expect(load()).toEqual({ visibility: { alpha: true, beta: false }, sizing: {} });
  });

  it("should return the defaults when the stored value is not JSON, null, or an array", () => {
    for (const stored of ["not json", "null", "[1,2]"]) {
      window.localStorage.setItem(KEY, stored);
      expect(load()).toEqual({ visibility: { alpha: true, beta: false }, sizing: {} });
    }
  });

  it("should apply stored visibility only for known columns with boolean values", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ visibility: { alpha: false, beta: "yes", stale: true } }));
    expect(load().visibility).toEqual({ alpha: false, beta: false });
  });

  it("should apply stored widths only for sizable columns with positive finite values", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ sizing: { chrome: 44, alpha: 120.5, beta: -10, stale: 200, alsoBad: "wide" } }),
    );
    expect(load().sizing).toEqual({ chrome: 44, alpha: 120.5 });
  });

  it("should clamp stored widths below a column's minimum up to it", () => {
    // A resize drag past the minimum persists the raw sub-minimum value
    // (the grid clamps only at render); loading must not let it back in.
    window.localStorage.setItem(KEY, JSON.stringify({ sizing: { alpha: 30, beta: 500 } }));
    const clamped = loadStoredTableConfig(KEY, DEFAULT_VISIBILITY, SIZABLE, { alpha: 120, beta: 90 });
    expect(clamped.sizing).toEqual({ alpha: 120, beta: 500 });
  });

  it("should round-trip a config through save and load", () => {
    const config: TableConfig = { visibility: { alpha: false, beta: true }, sizing: { alpha: 240 } };
    saveStoredTableConfig(KEY, config);
    expect(load()).toEqual(config);
  });
});

describe("useTableConfig()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should never write back the just-loaded config", () => {
    const save = vi.fn();
    renderHook(() => useTableConfig(load, save));
    act(() => vi.runAllTimers());
    expect(save).not.toHaveBeenCalled();
  });

  it("should save a change once, debounced, with the latest value", () => {
    const save = vi.fn();
    const { result } = renderHook(() => useTableConfig(load, save));
    act(() => result.current.applyConfig("sizing", { alpha: 200 }));
    act(() => result.current.applyConfig("sizing", { alpha: 220 }));
    expect(save).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ visibility: { alpha: true, beta: false }, sizing: { alpha: 220 } });
  });

  it("should flush a pending change when the component unmounts before the debounce fires", () => {
    const save = vi.fn();
    const { result, unmount } = renderHook(() => useTableConfig(load, save));
    act(() => result.current.applyConfig("visibility", (prev) => ({ ...prev, beta: true })));
    unmount();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ visibility: { alpha: true, beta: true }, sizing: {} });
  });

  it("should not write on unmount when everything was already saved", () => {
    const save = vi.fn();
    const { result, unmount } = renderHook(() => useTableConfig(load, save));
    act(() => result.current.applyConfig("sizing", { alpha: 200 }));
    act(() => vi.advanceTimersByTime(300));
    expect(save).toHaveBeenCalledTimes(1);
    unmount();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
