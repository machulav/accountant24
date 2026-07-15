// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useKeyboardShortcuts } from "../useKeyboardShortcuts";

afterEach(() => cleanup());

/** Dispatch a keydown; returns the event so callers can check preventDefault. */
function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, cancelable: true, ...init });
  window.dispatchEvent(e);
  return e;
}

describe("useKeyboardShortcuts()", () => {
  it("should fire the mapped handler on a matching mod+key combo", () => {
    const newChat = vi.fn();
    renderHook(() => useKeyboardShortcuts({ newChat }));
    press("n", { metaKey: true });
    expect(newChat).toHaveBeenCalledTimes(1);
  });

  it("should preventDefault on a matched shortcut", () => {
    renderHook(() => useKeyboardShortcuts({ newChat: () => {} }));
    const e = press("n", { metaKey: true });
    expect(e.defaultPrevented).toBe(true);
  });

  it("should ignore the key when the required modifier is absent", () => {
    const newChat = vi.fn();
    renderHook(() => useKeyboardShortcuts({ newChat }));
    press("n"); // no mod key
    expect(newChat).not.toHaveBeenCalled();
  });

  it("should not fire a handler that wasn't registered", () => {
    const openSettings = vi.fn();
    renderHook(() => useKeyboardShortcuts({ openSettings }));
    press("n", { metaKey: true }); // newChat combo, but only openSettings is bound
    expect(openSettings).not.toHaveBeenCalled();
  });

  it("should route each combo to its own handler", () => {
    const newChat = vi.fn();
    const openSettings = vi.fn();
    renderHook(() => useKeyboardShortcuts({ newChat, openSettings }));
    press(",", { metaKey: true });
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(newChat).not.toHaveBeenCalled();
  });

  it("should stop listening after unmount", () => {
    const newChat = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts({ newChat }));
    unmount();
    press("n", { metaKey: true });
    expect(newChat).not.toHaveBeenCalled();
  });
});
