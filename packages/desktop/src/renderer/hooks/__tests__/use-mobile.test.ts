// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useIsMobile } from "../use-mobile";

// A controllable matchMedia whose "change" listeners we can fire on demand.
let changeListeners: Array<() => void>;

beforeEach(() => {
  changeListeners = [];
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_: string, cb: () => void) => {
      changeListeners.push(cb);
    },
    removeEventListener: (_: string, cb: () => void) => {
      changeListeners = changeListeners.filter((l) => l !== cb);
    },
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => cleanup());

const setWidth = (w: number) => Object.defineProperty(window, "innerWidth", { value: w, configurable: true });

describe("useIsMobile()", () => {
  it("should report true when the viewport is narrower than the breakpoint", () => {
    setWidth(500);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("should report false when the viewport is at or above the breakpoint", () => {
    setWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("should update when a media-query change fires after a resize", () => {
    setWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    setWidth(400);
    act(() => {
      for (const cb of changeListeners) cb();
    });
    expect(result.current).toBe(true);
  });

  it("should remove its media-query listener on unmount", () => {
    setWidth(1024);
    const { unmount } = renderHook(() => useIsMobile());
    expect(changeListeners.length).toBe(1);
    unmount();
    expect(changeListeners.length).toBe(0);
  });
});
