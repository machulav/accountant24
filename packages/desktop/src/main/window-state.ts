// Window size & placement policy. First launch opens a large window sized
// to the display (80% of the work area, capped at 1600×1000), centered on
// the display the user is working on; afterwards the window reopens exactly
// where the user left it (size, position, maximized) — the standard desktop
// convention. Native macOS fullscreen is restored as a maximized window
// instead: taking over the whole screen stays a per-session user choice.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type Rect = { x: number; y: number; width: number; height: number };
export type WindowState = Rect & { maximized: boolean };

export const MIN_WIDTH = 560;
export const MIN_HEIGHT = 480;

// 80% of the work area reads as "the app fills my screen" while keeping the
// desktop visible around it; the cap keeps the window a comfortable reading
// width on large monitors instead of scaling up forever.
const WORK_AREA_FRACTION = 0.8;
const MAX_DEFAULT_WIDTH = 1600;
const MAX_DEFAULT_HEIGHT = 1000;

/** First-launch bounds: a large window centered in the given work area. */
export function defaultBounds(workArea: Rect): Rect {
  const width = Math.max(MIN_WIDTH, Math.min(MAX_DEFAULT_WIDTH, Math.round(workArea.width * WORK_AREA_FRACTION)));
  const height = Math.max(MIN_HEIGHT, Math.min(MAX_DEFAULT_HEIGHT, Math.round(workArea.height * WORK_AREA_FRACTION)));
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  };
}

/** Parse a saved state file's content, or null when the shape is wrong
 *  (missing keys, wrong types, non-finite numbers, sub-minimum size). */
export function parseWindowState(raw: unknown): WindowState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  if (!isNum(r.x) || !isNum(r.y) || !isNum(r.width) || !isNum(r.height)) return null;
  if (r.width < MIN_WIDTH || r.height < MIN_HEIGHT) return null;
  return { x: r.x, y: r.y, width: r.width, height: r.height, maximized: r.maximized === true };
}

// A window can be grabbed again if at least this much of it is visible.
const VISIBLE_PX = 160;

/** Whether a grabbable chunk of the rect is visible on some display —
 *  monitors come and go between launches, and a window restored onto a
 *  now-unplugged display would be unreachable. */
export function isVisibleOnSomeDisplay(rect: Rect, workAreas: Rect[]): boolean {
  return workAreas.some((wa) => {
    const overlapW = Math.min(rect.x + rect.width, wa.x + wa.width) - Math.max(rect.x, wa.x);
    const overlapH = Math.min(rect.y + rect.height, wa.y + wa.height) - Math.max(rect.y, wa.y);
    return overlapW >= VISIBLE_PX && overlapH >= VISIBLE_PX;
  });
}

/** The bounds to open with: the saved state when it is still reachable on a
 *  connected display, else the first-launch default on the active display.
 *  A maximized flag survives even when the position does not (the display
 *  layout changed, but the user's "I keep it maximized" choice did not). */
export function restoreWindowState(saved: unknown, workAreas: Rect[], activeWorkArea: Rect): WindowState {
  const state = parseWindowState(saved);
  if (state && isVisibleOnSomeDisplay(state, workAreas)) return state;
  return { ...defaultBounds(activeWorkArea), maximized: state?.maximized ?? false };
}

/** Read the state file's raw JSON (unvalidated — restoreWindowState parses). */
export function loadWindowState(file: string): unknown {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function saveWindowState(file: string, state: WindowState): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(state)}\n`);
  } catch {
    // Best-effort: a failed save only costs the next launch's placement.
  }
}

/** The window surface trackWindowState needs — structural, so tests can pass
 *  a plain fake and window.ts passes the real BrowserWindow. */
export type TrackableWindow = {
  on(event: "resize" | "move" | "close", listener: () => void): unknown;
  /** Bounds as if not maximized/fullscreen — the size to un-maximize back to. */
  getNormalBounds(): Rect;
  isMaximized(): boolean;
  isFullScreen(): boolean;
};

const SAVE_DEBOUNCE_MS = 500;

/** Keep the state file current: debounced on resize/move (a crash loses at
 *  most the last half-second), final write on close. */
export function trackWindowState(win: TrackableWindow, file: string): void {
  let timer: NodeJS.Timeout | undefined;
  const write = () =>
    saveWindowState(file, { ...win.getNormalBounds(), maximized: win.isMaximized() || win.isFullScreen() });
  const debounced = () => {
    clearTimeout(timer);
    timer = setTimeout(write, SAVE_DEBOUNCE_MS);
  };
  win.on("resize", debounced);
  win.on("move", debounced);
  win.on("close", () => {
    clearTimeout(timer);
    write();
  });
}
