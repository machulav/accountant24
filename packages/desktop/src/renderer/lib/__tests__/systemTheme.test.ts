// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { syncSystemTheme } from "../systemTheme";

// Spec: the `.dark` class on <html> mirrors the OS appearance — set on init
// when the OS is dark, absent when light, and updated live on OS changes.

type ChangeListener = (e: { matches: boolean }) => void;

function mockMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<ChangeListener>();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    addEventListener: (_: string, cb: ChangeListener) => listeners.add(cb),
    removeEventListener: (_: string, cb: ChangeListener) => listeners.delete(cb),
  }));
  return {
    setMatches(next: boolean) {
      matches = next;
      for (const cb of listeners) cb({ matches: next });
    },
  };
}

describe("syncSystemTheme()", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
    vi.restoreAllMocks();
  });

  it("should add the dark class when the OS theme is dark at startup", () => {
    mockMatchMedia(true);
    syncSystemTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("should not add the dark class when the OS theme is light at startup", () => {
    mockMatchMedia(false);
    syncSystemTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("should add the dark class when the OS switches from light to dark", () => {
    const media = mockMatchMedia(false);
    syncSystemTheme();
    media.setMatches(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("should remove the dark class when the OS switches from dark to light", () => {
    const media = mockMatchMedia(true);
    syncSystemTheme();
    media.setMatches(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
