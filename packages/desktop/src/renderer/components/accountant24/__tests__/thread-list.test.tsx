// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// IPC boundary: the thread list reads session mtimes over the Electron bridge.
vi.mock("@/rpc/api", () => ({
  sessionsApi: { list: vi.fn().mockResolvedValue({ sessions: [] }) },
}));

import { AssistantRuntimeProvider, type ExternalStoreAdapter, useExternalStoreRuntime } from "@assistant-ui/react";
import { SidebarProvider } from "@/components/shadcn/sidebar";
import { sessionsApi } from "@/rpc/api";
import type { SessionSummary } from "@/rpc/types";
import { ThreadList } from "../thread-list";

const listMock = vi.mocked(sessionsApi.list);

beforeEach(() => {
  listMock.mockReset();
  listMock.mockResolvedValue({ type: "sessions", sessions: [] });
});

type ThreadFixture = { id: string; title: string };

/** Build a Chrome around a caller-supplied set of threads + thread-list state. */
function makeChrome(opts: {
  threads: ThreadFixture[];
  threadId?: string;
  isLoading?: boolean;
  onDelete?: (threadId: string) => void | Promise<void>;
}) {
  return function CustomChrome({ children }: { children: ReactNode }) {
    const store: ExternalStoreAdapter = {
      messages: [],
      onNew: async () => {},
      adapters: {
        threadList: {
          threadId: opts.threadId ?? opts.threads[0]?.id,
          isLoading: opts.isLoading,
          threads: opts.threads.map((t) => ({ id: t.id, status: "regular", title: t.title })),
          onSwitchToThread: () => {},
          onSwitchToNewThread: () => {},
          onDelete: opts.onDelete ?? (async () => {}),
        },
      },
    };
    const runtime = useExternalStoreRuntime(store);
    return (
      <AssistantRuntimeProvider runtime={runtime}>
        <SidebarProvider>{children}</SidebarProvider>
      </AssistantRuntimeProvider>
    );
  };
}

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

const DAY = 86_400_000;

describe("ThreadList date grouping", () => {
  // Fixture times are pinned relative to the current clock: a time from `now`
  // is always in Today, `now - 1 day` in Yesterday, `now - 3 days` in Earlier —
  // regardless of when the test runs (the component reads midnight-today from
  // the same clock).
  const seedTimes = (entries: { path: string; modified: string }[]) =>
    listMock.mockResolvedValue({ type: "sessions", sessions: entries as unknown as SessionSummary[] });

  const groupFor = (label: string) => screen.getByText(label).closest('[data-slot="sidebar-group"]') as HTMLElement;

  it("should label a session modified today as Today", async () => {
    seedTimes([{ path: "t-today", modified: new Date().toISOString() }]);
    const Chrome = makeChrome({ threads: [{ id: "t-today", title: "today chat" }] });
    render(
      <Chrome>
        <ThreadList />
      </Chrome>,
    );
    await screen.findByText("Today");
    expect(within(groupFor("Today")).getByText("today chat")).toBeInTheDocument();
  });

  it("should sort sessions into Today, Yesterday, and Earlier groups by modified time", async () => {
    const now = Date.now();
    seedTimes([
      { path: "t-old", modified: new Date(now - 3 * DAY).toISOString() },
      { path: "t-new", modified: new Date(now).toISOString() },
      { path: "t-mid", modified: new Date(now - DAY).toISOString() },
    ]);
    const Chrome = makeChrome({
      threads: [
        { id: "t-old", title: "old chat" },
        { id: "t-new", title: "new chat" },
        { id: "t-mid", title: "mid chat" },
      ],
    });
    render(
      <Chrome>
        <ThreadList />
      </Chrome>,
    );

    await screen.findByText("Earlier");

    // Each session lands in the group its modified time dictates…
    expect(within(groupFor("Today")).getByText("new chat")).toBeInTheDocument();
    expect(within(groupFor("Yesterday")).getByText("mid chat")).toBeInTheDocument();
    expect(within(groupFor("Earlier")).getByText("old chat")).toBeInTheDocument();

    // …and the groups are ordered newest-first regardless of thread order.
    const labels = screen.getAllByText(/^(Today|Yesterday|Earlier)$/).map((el) => el.textContent);
    expect(labels).toEqual(["Today", "Yesterday", "Earlier"]);
  });

  it("should render a single ungrouped list when no session times are known", async () => {
    // sessionsApi.list resolves empty (default) → times map stays empty.
    const Chrome = makeChrome({ threads: [{ id: "t1", title: "test chat" }] });
    render(
      <Chrome>
        <ThreadList />
      </Chrome>,
    );

    await screen.findByText("test chat");
    // No date headers when times are unknown.
    expect(screen.queryByText("Today")).toBeNull();
    expect(screen.queryByText("Yesterday")).toBeNull();
    expect(screen.queryByText("Earlier")).toBeNull();
  });
});

describe("ThreadList empty state", () => {
  it("should render no thread rows and no ••• actions when there are no threads", async () => {
    const Chrome = makeChrome({ threads: [] });
    render(
      <Chrome>
        <ThreadList />
      </Chrome>,
    );

    await waitFor(() => expect(listMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "More options" })).toBeNull();
    expect(screen.queryByText("test chat")).toBeNull();
  });
});

describe("ThreadList loading state", () => {
  it("should show the loading skeleton and no thread rows while threads are loading", async () => {
    const Chrome = makeChrome({ threads: [{ id: "t1", title: "test chat" }], isLoading: true });
    render(
      <Chrome>
        <ThreadList />
      </Chrome>,
    );

    expect(screen.getByRole("status", { name: "Loading threads" })).toBeInTheDocument();
    expect(screen.queryByText("test chat")).toBeNull();
  });
});

describe("ThreadList delete", () => {
  it("should delete the row's thread when Delete is chosen from the ••• menu", async () => {
    const onDelete = vi.fn();
    const Chrome = makeChrome({ threads: [{ id: "t1", title: "test chat" }], onDelete });
    render(
      <Chrome>
        <ThreadList />
      </Chrome>,
    );

    const trigger = await screen.findByRole("button", { name: "More options" });
    press(trigger);
    const del = await screen.findByText("Delete");
    press(del);

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("t1"));
  });
});

describe("ThreadList active session", () => {
  it("should mark only the active thread's row as active", async () => {
    listMock.mockResolvedValue({ type: "sessions", sessions: [] });
    const Chrome = makeChrome({
      threads: [
        { id: "t1", title: "first chat" },
        { id: "t2", title: "second chat" },
      ],
      threadId: "t2",
    });
    render(
      <Chrome>
        <ThreadList />
      </Chrome>,
    );

    await screen.findByText("second chat");
    const rowOf = (title: string) =>
      screen.getByText(title).closest('[data-slot="aui_thread-list-item"]') as HTMLElement;

    expect(rowOf("second chat")).toHaveAttribute("data-active");
    expect(rowOf("first chat")).not.toHaveAttribute("data-active");
  });
});
