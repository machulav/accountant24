// Spec for the window size & placement policy: first launch = 80% of the
// work area capped at 1600×1000 and centered on the active display; later
// launches restore the saved state when it is still reachable on a
// connected display; the maximized choice survives a display-layout change.
// The state file I/O is best-effort and debounced.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultBounds,
  isVisibleOnSomeDisplay,
  loadWindowState,
  parseWindowState,
  type Rect,
  restoreWindowState,
  type TrackableWindow,
  trackWindowState,
} from "../window-state";

describe("defaultBounds()", () => {
  it("should size to 80% of a laptop work area and center in it", () => {
    // 1512×950 at y=25 (menu bar): 80% → 1210×760, centered.
    expect(defaultBounds({ x: 0, y: 25, width: 1512, height: 950 })).toEqual({
      x: 151,
      y: 120,
      width: 1210,
      height: 760,
    });
  });

  it("should cap at 1600×1000 on a large display and stay centered", () => {
    expect(defaultBounds({ x: 0, y: 25, width: 2560, height: 1415 })).toEqual({
      x: 480,
      y: 233,
      width: 1600,
      height: 1000,
    });
  });

  it("should never go below the window minimums on a tiny display", () => {
    const bounds = defaultBounds({ x: 0, y: 0, width: 500, height: 400 });
    expect(bounds.width).toBe(560);
    expect(bounds.height).toBe(480);
  });

  it("should center within a secondary display's own offset work area", () => {
    expect(defaultBounds({ x: 1512, y: 0, width: 1000, height: 800 })).toEqual({
      x: 1612,
      y: 80,
      width: 800,
      height: 640,
    });
  });
});

describe("parseWindowState()", () => {
  it("should accept a complete state and default maximized to false", () => {
    expect(parseWindowState({ x: 10, y: 20, width: 800, height: 600 })).toEqual({
      x: 10,
      y: 20,
      width: 800,
      height: 600,
      maximized: false,
    });
  });

  it("should keep maximized only when it is literally true", () => {
    expect(parseWindowState({ x: 0, y: 0, width: 800, height: 600, maximized: true })?.maximized).toBe(true);
    expect(parseWindowState({ x: 0, y: 0, width: 800, height: 600, maximized: "yes" })?.maximized).toBe(false);
  });

  it.each([
    ["null", null],
    ["a string", "state"],
    ["a number", 42],
    ["a missing key", { x: 0, y: 0, width: 800 }],
    ["a string coordinate", { x: "0", y: 0, width: 800, height: 600 }],
    ["a non-finite coordinate", { x: Number.NaN, y: 0, width: 800, height: 600 }],
    ["a sub-minimum width", { x: 0, y: 0, width: 559, height: 600 }],
    ["a sub-minimum height", { x: 0, y: 0, width: 800, height: 479 }],
  ])("should reject %s", (_label, raw) => {
    expect(parseWindowState(raw)).toBeNull();
  });
});

describe("isVisibleOnSomeDisplay()", () => {
  const display: Rect = { x: 0, y: 0, width: 1600, height: 1000 };

  it("should accept a rect fully inside the display", () => {
    expect(isVisibleOnSomeDisplay({ x: 100, y: 100, width: 800, height: 600 }, [display])).toBe(true);
  });

  it("should accept a rect with exactly the 160px grabbable overlap", () => {
    expect(isVisibleOnSomeDisplay({ x: 1440, y: 840, width: 800, height: 600 }, [display])).toBe(true);
  });

  it("should reject a rect one pixel short of the grabbable overlap", () => {
    expect(isVisibleOnSomeDisplay({ x: 1441, y: 840, width: 800, height: 600 }, [display])).toBe(false);
  });

  it("should reject a rect entirely off every display", () => {
    expect(isVisibleOnSomeDisplay({ x: 1700, y: 0, width: 800, height: 600 }, [display])).toBe(false);
  });

  it("should accept a rect visible only on a secondary display", () => {
    const second: Rect = { x: 1600, y: 0, width: 1200, height: 900 };
    expect(isVisibleOnSomeDisplay({ x: 1700, y: 100, width: 800, height: 600 }, [display, second])).toBe(true);
  });

  it("should reject everything when no display is connected", () => {
    expect(isVisibleOnSomeDisplay({ x: 0, y: 0, width: 800, height: 600 }, [])).toBe(false);
  });
});

describe("restoreWindowState()", () => {
  const active: Rect = { x: 0, y: 25, width: 1512, height: 950 };
  const displays: Rect[] = [{ x: 0, y: 25, width: 1512, height: 950 }];

  it("should restore a saved state that is still visible, maximized included", () => {
    const saved = { x: 40, y: 50, width: 900, height: 700, maximized: true };
    expect(restoreWindowState(saved, displays, active)).toEqual({ ...saved, maximized: true });
  });

  it("should fall back to the centered default when the saved state is off every display", () => {
    const saved = { x: 5000, y: 5000, width: 900, height: 700 };
    expect(restoreWindowState(saved, displays, active)).toEqual({ ...defaultBounds(active), maximized: false });
  });

  it("should keep the maximized choice even when the position is no longer valid", () => {
    const saved = { x: 5000, y: 5000, width: 900, height: 700, maximized: true };
    expect(restoreWindowState(saved, displays, active).maximized).toBe(true);
  });

  it("should fall back to the centered default when nothing was saved", () => {
    expect(restoreWindowState(null, displays, active)).toEqual({ ...defaultBounds(active), maximized: false });
  });

  it("should fall back to the centered default when the saved state is malformed", () => {
    expect(restoreWindowState({ width: "big" }, displays, active)).toEqual({
      ...defaultBounds(active),
      maximized: false,
    });
  });
});

describe("state file I/O", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "a24-window-state-"));
    file = path.join(dir, "window-state.json");
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  const fakeWin = (over: Partial<TrackableWindow> = {}) => {
    const listeners = new Map<string, () => void>();
    const win: TrackableWindow = {
      on: (event, listener) => listeners.set(event, listener),
      getNormalBounds: () => ({ x: 10, y: 20, width: 900, height: 700 }),
      isMaximized: () => false,
      isFullScreen: () => false,
      ...over,
    };
    return { win, fire: (event: string) => listeners.get(event)?.() };
  };

  describe("loadWindowState()", () => {
    it("should return null when the file does not exist", () => {
      expect(loadWindowState(file)).toBeNull();
    });

    it("should return null on unparseable JSON", () => {
      writeFileSync(file, "{not json");
      expect(loadWindowState(file)).toBeNull();
    });

    it("should return the parsed JSON as-is", () => {
      writeFileSync(file, '{"x":1,"y":2,"width":800,"height":600}');
      expect(loadWindowState(file)).toEqual({ x: 1, y: 2, width: 800, height: 600 });
    });
  });

  describe("trackWindowState()", () => {
    it("should save the normal bounds half a second after a resize, not immediately", () => {
      vi.useFakeTimers();
      const { win, fire } = fakeWin();
      trackWindowState(win, file);
      fire("resize");
      expect(existsSync(file)).toBe(false);
      vi.advanceTimersByTime(500);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
        x: 10,
        y: 20,
        width: 900,
        height: 700,
        maximized: false,
      });
    });

    it("should collapse a burst of resize/move events into one delayed save", () => {
      vi.useFakeTimers();
      const { win, fire } = fakeWin();
      trackWindowState(win, file);
      fire("resize");
      vi.advanceTimersByTime(400);
      fire("move");
      vi.advanceTimersByTime(400);
      expect(existsSync(file)).toBe(false);
      vi.advanceTimersByTime(100);
      expect(existsSync(file)).toBe(true);
    });

    it("should save immediately on close and cancel the pending debounce", () => {
      vi.useFakeTimers();
      const { win, fire } = fakeWin();
      trackWindowState(win, file);
      fire("resize");
      fire("close");
      expect(existsSync(file)).toBe(true);
      // The debounce was cancelled; nothing rewrites later.
      writeFileSync(file, "sentinel");
      vi.advanceTimersByTime(500);
      expect(readFileSync(file, "utf8")).toBe("sentinel");
    });

    it("should record maximized (and the normal bounds to restore to) when the window is maximized", () => {
      const { win, fire } = fakeWin({ isMaximized: () => true });
      trackWindowState(win, file);
      fire("close");
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
        x: 10,
        y: 20,
        width: 900,
        height: 700,
        maximized: true,
      });
    });

    it("should record fullscreen as maximized, never as a restored fullscreen", () => {
      const { win, fire } = fakeWin({ isFullScreen: () => true });
      trackWindowState(win, file);
      fire("close");
      expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ maximized: true });
    });

    it("should create the parent directory when it is missing", () => {
      const nested = path.join(dir, "deep", "window-state.json");
      const { win, fire } = fakeWin();
      trackWindowState(win, nested);
      fire("close");
      expect(existsSync(nested)).toBe(true);
    });

    it("should swallow a failed save instead of crashing the app", () => {
      // The target path is an existing directory — writeFileSync must throw,
      // and trackWindowState must absorb it.
      const asDir = path.join(dir, "state-as-dir");
      mkdirSync(asDir);
      const { win, fire } = fakeWin();
      trackWindowState(win, asDir);
      expect(() => fire("close")).not.toThrow();
    });
  });
});
