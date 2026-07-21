// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SidebarProvider } from "@/components/shadcn/sidebar";
import {
  clampSidebarWidth,
  loadSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SidebarResizeHandle,
} from "../sidebar-resize";

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  if (!window.localStorage) {
    // This jsdom build ships without Web Storage; back it with a Map.
    const backing = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: (k: string) => backing.get(k) ?? null,
        setItem: (k: string, v: string) => void backing.set(k, String(v)),
        removeItem: (k: string) => void backing.delete(k),
        clear: () => backing.clear(),
        key: (i: number) => [...backing.keys()][i] ?? null,
        get length() {
          return backing.size;
        },
      } satisfies Storage,
    });
  }
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("clampSidebarWidth()", () => {
  it("should return 200 when width is below the minimum (e.g. 50)", () => {
    expect(clampSidebarWidth(50)).toBe(200);
  });

  it("should return 480 when width is above the maximum (e.g. 9000)", () => {
    expect(clampSidebarWidth(9000)).toBe(480);
  });

  it("should return the width unchanged when inside the limits", () => {
    expect(clampSidebarWidth(300)).toBe(300);
  });

  it("should keep the exact boundary values", () => {
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH)).toBe(200);
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH)).toBe(480);
  });

  it("should round fractional widths to whole pixels", () => {
    expect(clampSidebarWidth(300.6)).toBe(301);
  });
});

describe("loadSidebarWidth()", () => {
  it("should return the 256px stock default when nothing is stored", () => {
    expect(loadSidebarWidth()).toBe(256);
  });

  it("should return the stored width when it is within limits", () => {
    window.localStorage.setItem("accountant24.sidebar-width", "333");
    expect(loadSidebarWidth()).toBe(333);
  });

  it("should clamp an out-of-range stored width", () => {
    window.localStorage.setItem("accountant24.sidebar-width", "9999");
    expect(loadSidebarWidth()).toBe(480);
  });

  it("should fall back to the default when the stored value is garbage", () => {
    window.localStorage.setItem("accountant24.sidebar-width", "not-a-number");
    expect(loadSidebarWidth()).toBe(256);
  });
});

const renderHandle = (defaultOpen = true) => {
  const utils = render(
    <SidebarProvider defaultOpen={defaultOpen} style={{ "--sidebar-width": "256px" } as React.CSSProperties}>
      <SidebarResizeHandle />
    </SidebarProvider>,
  );
  const wrapper = document.querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]');
  return { ...utils, wrapper: wrapper! };
};

const getHandle = () => screen.getByRole("separator", { name: "Resize sidebar" });

const widthVar = (wrapper: HTMLElement) => wrapper.style.getPropertyValue("--sidebar-width");

describe("<SidebarResizeHandle />", () => {
  it("should widen the sidebar by the drag distance", () => {
    const { wrapper } = renderHandle();
    const handle = getHandle();
    fireEvent.pointerDown(handle, { clientX: 256, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 356, pointerId: 1 });
    expect(widthVar(wrapper)).toBe("356px");
  });

  it("should not shrink below the 200px minimum when dragging far left", () => {
    const { wrapper } = renderHandle();
    const handle = getHandle();
    fireEvent.pointerDown(handle, { clientX: 256, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: -500, pointerId: 1 });
    expect(widthVar(wrapper)).toBe("200px");
  });

  it("should not grow beyond the 480px maximum when dragging far right", () => {
    const { wrapper } = renderHandle();
    const handle = getHandle();
    fireEvent.pointerDown(handle, { clientX: 256, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 2000, pointerId: 1 });
    expect(widthVar(wrapper)).toBe("480px");
  });

  it("should persist the final width when the drag ends", () => {
    renderHandle();
    const handle = getHandle();
    fireEvent.pointerDown(handle, { clientX: 256, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 300, pointerId: 1 });
    expect(window.localStorage.getItem("accountant24.sidebar-width")).toBe("300");
  });

  it("should suspend width transitions only while dragging", () => {
    const { wrapper } = renderHandle();
    const handle = getHandle();
    fireEvent.pointerDown(handle, { clientX: 256, pointerId: 1 });
    expect(wrapper.getAttribute("data-sidebar-resizing")).toBe("true");
    fireEvent.pointerUp(handle, { clientX: 256, pointerId: 1 });
    expect(wrapper.getAttribute("data-sidebar-resizing")).toBeNull();
  });

  it("should widen by 16px on ArrowRight and narrow by 16px on ArrowLeft", () => {
    const { wrapper } = renderHandle();
    const handle = getHandle();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(widthVar(wrapper)).toBe("272px");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(widthVar(wrapper)).toBe("240px");
  });

  it("should respect the limits for keyboard resizing too", () => {
    const { wrapper } = renderHandle();
    const handle = getHandle();
    for (let i = 0; i < 30; i++) fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(widthVar(wrapper)).toBe("200px");
  });

  it("should reset to the 256px default on double-click", () => {
    const { wrapper } = renderHandle();
    const handle = getHandle();
    fireEvent.pointerDown(handle, { clientX: 256, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 400, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 400, pointerId: 1 });
    fireEvent.doubleClick(getHandle());
    expect(widthVar(wrapper)).toBe(`${SIDEBAR_DEFAULT_WIDTH}px`);
    expect(window.localStorage.getItem("accountant24.sidebar-width")).toBe("256");
  });

  it("should ignore a pointer move when no drag is in progress", () => {
    const { wrapper } = renderHandle();
    const handle = getHandle();
    // A stray move with no preceding pointerDown must not resize anything.
    fireEvent.pointerMove(handle, { clientX: 400, pointerId: 1 });
    expect(widthVar(wrapper)).toBe("256px");
  });

  it("should ignore a pointer up when no drag is in progress", () => {
    renderHandle();
    const handle = getHandle();
    fireEvent.pointerUp(handle, { clientX: 400, pointerId: 1 });
    expect(window.localStorage.getItem("accountant24.sidebar-width")).toBeNull();
  });

  it("should ignore keys other than the arrows", () => {
    const { wrapper } = renderHandle();
    const handle = getHandle();
    fireEvent.keyDown(handle, { key: "Enter" });
    fireEvent.keyDown(handle, { key: "a" });
    expect(widthVar(wrapper)).toBe("256px");
    expect(window.localStorage.getItem("accountant24.sidebar-width")).toBeNull();
  });

  it("should start from the default width when the wrapper has no width variable", () => {
    const { wrapper } = renderHandle();
    // No --sidebar-width set: getWidth() must fall back to the 256px default, so a
    // +50px drag lands at 306, not NaN.
    wrapper.style.removeProperty("--sidebar-width");
    const handle = getHandle();
    fireEvent.pointerDown(handle, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 50, pointerId: 1 });
    expect(widthVar(wrapper)).toBe("306px");
  });

  it("should do nothing on pointer down when the wrapper cannot be found", () => {
    const { wrapper } = renderHandle();
    // Detach the wrapper marker so getWrapper() returns null on the next event.
    wrapper.removeAttribute("data-slot");
    const handle = getHandle();
    fireEvent.pointerDown(handle, { clientX: 256, pointerId: 1 });
    // No drag begins: the resizing flag is never set.
    expect(wrapper.getAttribute("data-sidebar-resizing")).toBeNull();
  });

  it("should abort the move when the wrapper disappears mid-drag", () => {
    const { wrapper } = renderHandle();
    const handle = getHandle();
    fireEvent.pointerDown(handle, { clientX: 256, pointerId: 1 });
    wrapper.removeAttribute("data-slot");
    fireEvent.pointerMove(handle, { clientX: 400, pointerId: 1 });
    // The width would have grown to 400 had the wrapper still been reachable.
    expect(widthVar(wrapper)).toBe("256px");
  });

  it("should skip persistence when the wrapper disappears before pointer up", () => {
    const { wrapper } = renderHandle();
    const handle = getHandle();
    fireEvent.pointerDown(handle, { clientX: 256, pointerId: 1 });
    wrapper.removeAttribute("data-slot");
    fireEvent.pointerUp(handle, { clientX: 300, pointerId: 1 });
    expect(window.localStorage.getItem("accountant24.sidebar-width")).toBeNull();
  });

  it("should ignore an arrow key when the wrapper cannot be found", () => {
    const { wrapper } = renderHandle();
    wrapper.removeAttribute("data-slot");
    const handle = getHandle();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(widthVar(wrapper)).toBe("256px");
    expect(window.localStorage.getItem("accountant24.sidebar-width")).toBeNull();
  });

  it("should do nothing on double-click when the wrapper cannot be found", () => {
    const { wrapper } = renderHandle();
    wrapper.removeAttribute("data-slot");
    const handle = getHandle();
    fireEvent.doubleClick(handle);
    expect(widthVar(wrapper)).toBe("256px");
    expect(window.localStorage.getItem("accountant24.sidebar-width")).toBeNull();
  });

  it("should not render a handle when the sidebar is collapsed", () => {
    renderHandle(false);
    expect(screen.queryByRole("separator", { name: "Resize sidebar" })).toBeNull();
  });
});
