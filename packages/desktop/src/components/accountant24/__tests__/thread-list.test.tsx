// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// IPC boundary: the thread list reads session mtimes over the Electron bridge.
vi.mock("@/rpc/api", () => ({
  sessionsApi: { list: vi.fn().mockResolvedValue({ sessions: [] }) },
}));

import { AssistantRuntimeProvider, type ExternalStoreAdapter, useExternalStoreRuntime } from "@assistant-ui/react";
import { SidebarProvider } from "@/components/shadcn/sidebar";
import { ThreadList } from "../thread-list";

beforeAll(() => {
  // jsdom lacks the layout/observer APIs the menu machinery touches.
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
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
});

/** Minimal real assistant-ui runtime with one saved chat ("test chat"). */
function Chrome({ children }: { children: ReactNode }) {
  const store: ExternalStoreAdapter = {
    messages: [],
    onNew: async () => {},
    adapters: {
      threadList: {
        threadId: "t1",
        threads: [{ id: "t1", status: "regular", title: "test chat" }],
        onSwitchToThread: () => {},
        onSwitchToNewThread: () => {},
        onDelete: async () => {},
      },
    },
  };
  const runtime = useExternalStoreRuntime(store);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SidebarProvider>{children}</SidebarProvider>
    </AssistantRuntimeProvider>
  );
}

const renderList = () =>
  render(
    <Chrome>
      <ThreadList />
    </Chrome>,
  );

/** Fire a full mouse press (Base UI reacts to the complete sequence). */
const press = (target: Element, init: Record<string, unknown> = {}) => {
  const opts = { button: 0, detail: 1, pointerId: 1, pointerType: "mouse", isPrimary: true, ...init };
  fireEvent.pointerDown(target, opts);
  fireEvent.mouseDown(target, opts);
  fireEvent.pointerUp(target, opts);
  fireEvent.mouseUp(target, opts);
  fireEvent.click(target, opts);
};

/** Open the row's ••• menu the way a mouse user does. The menu state flips
 *  asynchronously, so wait for the item to appear. */
const openMoreMenu = async () => {
  const trigger = await screen.findByRole("button", { name: "More options" });
  press(trigger);
  await screen.findByText("Delete");
  return trigger;
};

describe("ThreadList ••• menu", () => {
  it("should not return focus to the ••• trigger when the menu is closed by clicking elsewhere", async () => {
    renderList();
    const trigger = await openMoreMenu();

    // Click far away from the row — the menu must close…
    press(document.body);
    await waitFor(() => expect(screen.queryByText("Delete")).toBeNull());

    // …and focus must NOT come back to the trigger: restored focus reads as
    // :focus-visible, which pinned the hover-only ••• icon on screen.
    expect(document.activeElement).not.toBe(trigger);
  });

  it("should return focus to the ••• trigger when the menu is dismissed with Escape (keyboard a11y)", async () => {
    renderList();
    const trigger = await openMoreMenu();

    fireEvent.keyDown(screen.getByText("Delete"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Delete")).toBeNull());

    // Keyboard dismissal is the one case where focus SHOULD come back to the
    // trigger (WAI-APG menu pattern) — the icon staying visible is correct
    // there, since a keyboard user must see where their focus is.
    expect(document.activeElement).toBe(trigger);
  });
});

describe("ThreadList row hover highlight", () => {
  it("should keep the row highlight while the pointer is over the ••• action", async () => {
    renderList();
    const trigger = await screen.findByRole("button", { name: "More options" });
    const row = trigger.closest("li");
    const rowButton = screen.getByText("test chat").closest("button");

    // Structural precondition of the bug: the ••• overlays the row as a
    // SIBLING of the row button, so the button's own :hover drops while the
    // pointer is on the action…
    expect(row).not.toBeNull();
    expect(rowButton).not.toBeNull();
    expect(rowButton!.contains(trigger)).toBe(false);

    // …therefore the highlight must be bound to row-level hover. jsdom has no
    // CSS engine, so pin the CSS contract: the row button styles its accent
    // background off the row group's hover, not only its own.
    expect(rowButton!.className).toContain("group-hover/menu-item:bg-sidebar-accent");
  });

  it("should hide the ••• action until hover at every window width (drawer mode included)", async () => {
    renderList();
    const trigger = await screen.findByRole("button", { name: "More options" });

    // Stock showOnHover only hides at md+ (`md:opacity-0`), leaving the action
    // permanently visible in the narrow drawer. The desktop app always has a
    // mouse, so the unprefixed opacity-0 must be present too.
    expect(trigger.className).toMatch(/(?:^|\s)opacity-0(?:\s|$)/);
  });
});
