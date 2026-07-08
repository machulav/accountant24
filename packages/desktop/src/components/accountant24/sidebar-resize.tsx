"use client";

// Drag-to-resize for the shadcn sidebar. The stock sidebar derives every width
// from the `--sidebar-width` variable on [data-slot="sidebar-wrapper"], so the
// handle just overrides that variable live and persists the result — no stock
// file is modified.

import { type FC, type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { useSidebar } from "@/components/shadcn/sidebar";
import { cn } from "@/lib/utils";

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 480;
/** Matches the stock shadcn SIDEBAR_WIDTH (16rem). */
export const SIDEBAR_DEFAULT_WIDTH = 256;
const KEYBOARD_STEP = 16;
const STORAGE_KEY = "accountant24.sidebar-width";

export const clampSidebarWidth = (width: number): number =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));

/** Initial width for SidebarProvider: the persisted value, clamped; stock default otherwise. */
export function loadSidebarWidth(): number {
  const stored = Number(window.localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(stored) && stored > 0 ? clampSidebarWidth(stored) : SIDEBAR_DEFAULT_WIDTH;
}

function saveSidebarWidth(width: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // Persistence is best-effort; resizing still works for the session.
  }
}

const getWrapper = (el: HTMLElement): HTMLElement | null => el.closest<HTMLElement>('[data-slot="sidebar-wrapper"]');

const getWidth = (wrapper: HTMLElement): number =>
  Number.parseInt(wrapper.style.getPropertyValue("--sidebar-width"), 10) || SIDEBAR_DEFAULT_WIDTH;

const setWidth = (wrapper: HTMLElement, width: number): number => {
  const next = clampSidebarWidth(width);
  wrapper.style.setProperty("--sidebar-width", `${next}px`);
  return next;
};

/** Invisible grab strip on the sidebar's edge. Drag to resize; arrow keys work
 *  too (it's a focusable separator); double-click resets to the default. */
export const SidebarResizeHandle: FC = () => {
  const { state, isMobile } = useSidebar();
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  // Mirrors the CSS variable for aria-valuenow (a focusable separator is a
  // widget and must report its value).
  const [width, setWidthState] = useState(loadSidebarWidth);

  // The mobile drawer and the collapsed rail have fixed widths.
  if (isMobile || state === "collapsed") return null;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const wrapper = getWrapper(e.currentTarget);
    if (!wrapper) return;
    drag.current = { startX: e.clientX, startWidth: getWidth(wrapper) };
    // Suspend the sidebar's width transition so the drag tracks 1:1.
    wrapper.setAttribute("data-sidebar-resizing", "true");
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const wrapper = getWrapper(e.currentTarget);
    if (!wrapper) return;
    setWidthState(setWidth(wrapper, drag.current.startWidth + (e.clientX - drag.current.startX)));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    const wrapper = getWrapper(e.currentTarget);
    if (!wrapper) return;
    wrapper.removeAttribute("data-sidebar-resizing");
    saveSidebarWidth(getWidth(wrapper));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === "ArrowRight" ? KEYBOARD_STEP : e.key === "ArrowLeft" ? -KEYBOARD_STEP : 0;
    if (!delta) return;
    e.preventDefault();
    const wrapper = getWrapper(e.currentTarget);
    if (!wrapper) return;
    const next = setWidth(wrapper, getWidth(wrapper) + delta);
    setWidthState(next);
    saveSidebarWidth(next);
  };

  const onDoubleClick = (e: PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    const wrapper = getWrapper(e.currentTarget as HTMLElement);
    if (!wrapper) return;
    const next = setWidth(wrapper, SIDEBAR_DEFAULT_WIDTH);
    setWidthState(next);
    saveSidebarWidth(next);
  };

  return (
    <div
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      tabIndex={0}
      data-slot="sidebar-resize-handle"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
      className={cn(
        // Invisible: only the col-resize cursor signals the affordance. The
        // focus ring appears for keyboard focus only (a11y), never on hover.
        "app-no-drag absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize outline-none select-none",
        "focus-visible:bg-sidebar-ring/50",
      )}
    />
  );
};
