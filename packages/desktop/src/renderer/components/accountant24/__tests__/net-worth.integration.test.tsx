// @vitest-environment jsdom

// Integration: the Net Worth flow across real ChatLayout + real
// NetWorthView + the real rpc/api layer, over the fake `window.api`
// bridge. Asserts both the UI and the exact IPC traffic. The pi runtime and
// heavy chat children are stubbed (they have their own suites); the IPC
// boundary is the fake bridge.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// rpc/api.ts captures `window.api` at module load — install the fake bridge
// before any import pulls it in (async vi.hoisted runs before the imports).
const bridge = await vi.hoisted(async () => (await import("@/test/fakeApi")).installFakeApi());

// The pi runtime surface ChatLayout drives; only what this flow touches.
vi.mock("@assistant-ui/react", () => ({
  AssistantRuntimeProvider: ({ children }: { children: React.ReactNode }) => children,
  CompositeAttachmentAdapter: class {},
  useAuiState: (sel: (s: unknown) => unknown) => sel({ thread: { isRunning: false } }),
}));
const switchToNewThread = vi.hoisted(() => vi.fn());
vi.mock("@assistant-ui/react-pi", () => ({
  usePiRuntime: () => ({ threads: { switchToNewThread } }),
}));
vi.mock("@/runtime/electronPiClient", () => ({
  createElectronPiClient: () => ({ getThread: vi.fn() }),
}));
vi.mock("@/runtime/fileAttachmentAdapter", () => ({
  ArchivingImageAttachmentAdapter: class {},
  WorkspaceFileAttachmentAdapter: class {},
}));
vi.mock("@/runtime/agentBridge", () => ({
  agentBridge: { addEventListener: () => () => {} },
}));

// Heavy chat children with their own suites; the Net Worth view and the
// sidebar badge stay REAL.
vi.mock("../thread", () => ({ Thread: () => <div data-testid="thread" /> }));
vi.mock("../thread-list", () => ({
  ThreadList: () => <div data-testid="thread-list" />,
  ThreadListNew: () => <div data-testid="thread-list-new" />,
}));
vi.mock("../settings/settings", () => ({ Settings: () => null }));

import type { NetWorth } from "@/rpc/types";
import { ChatLayout } from "../chat-layout";

const DATA: NetWorth = {
  sections: [
    {
      name: "Assets",
      rows: [
        {
          name: "assets:cash",
          amounts: [{ quantity: 100, commodity: "USD", precision: 2 }],
          value: [{ quantity: 86, commodity: "EUR", precision: 2 }],
          assertedOn: "2026-07-01",
          assertedAmount: { quantity: 95, commodity: "USD", precision: 2 },
        },
        {
          name: "assets:checking",
          amounts: [{ quantity: 2950, commodity: "EUR", precision: 2 }],
          value: [{ quantity: 2950, commodity: "EUR", precision: 2 }],
        },
      ],
      total: {
        amounts: [{ quantity: 3036, commodity: "EUR", precision: 2 }],
        value: [{ quantity: 3036, commodity: "EUR", precision: 2 }],
      },
    },
    {
      name: "Liabilities",
      rows: [
        {
          name: "liabilities:card",
          amounts: [{ quantity: 300, commodity: "EUR", precision: 2 }],
          value: [{ quantity: 300, commodity: "EUR", precision: 2 }],
        },
      ],
      total: {
        amounts: [{ quantity: 300, commodity: "EUR", precision: 2 }],
        value: [{ quantity: 300, commodity: "EUR", precision: 2 }],
      },
    },
  ],
  net: {
    amounts: [{ quantity: 2736, commodity: "EUR", precision: 2 }],
    value: [{ quantity: 2736, commodity: "EUR", precision: 2 }],
  },
  baseCommodity: "EUR",
};

beforeAll(() => {
  installJsdomPolyfills();
  // The sidebar seeds its width from localStorage, which this jsdom env omits.
  if (!window.localStorage) {
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, String(v)),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() {
          return store.size;
        },
      },
    });
  }
});

beforeEach(() => {
  bridge.reset();
  switchToNewThread.mockClear();
  bridge.setHandler("update_pending", () => null);
  bridge.setHandler("ledger_net_worth", () => DATA);
  // The Columns choice persists here; every spec starts from the default.
  window.localStorage.clear();
});

afterEach(() => cleanup());

const openSheet = () => fireEvent.click(screen.getByRole("button", { name: "Net Worth" }));

describe("Net Worth view flow", () => {
  it("should show the compact net worth in the sidebar as soon as the layout loads", async () => {
    render(<ChatLayout />);
    // The badge's own fetch, before the page was ever opened.
    expect(await screen.findByText("2.7K EUR")).toBeInTheDocument();
    expect(bridge.callsFor("ledger_net_worth")).toHaveLength(1);
  });

  it("should fetch the report over IPC and render both sections when Net Worth is opened", async () => {
    render(<ChatLayout />);
    // One badge fetch on mount; the page adds its own on open.
    expect(bridge.callsFor("ledger_net_worth")).toHaveLength(1);

    openSheet();

    expect(await screen.findByText("assets:cash")).toBeInTheDocument();
    expect(screen.getByText("assets:checking")).toBeInTheDocument();
    expect(screen.getByText("~86.00 EUR")).toBeInTheDocument();
    expect(screen.getByText("liabilities:card")).toBeInTheDocument();
    // The assertion columns stay hidden until toggled on.
    expect(screen.queryByText("2026-07-01")).toBeNull();
    expect(bridge.callsFor("ledger_net_worth")).toHaveLength(2);
  });

  it("should reveal the assertion columns via the Columns menu and keep them when the page is reopened", async () => {
    render(<ChatLayout />);
    openSheet();
    await screen.findByText("assets:cash");

    await userEvent.click(screen.getByRole("button", { name: "Columns" }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Asserted On" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Asserted Amount" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByText("2026-07-01")).toBeInTheDocument();
    expect(screen.getByText("95.00 USD")).toBeInTheDocument();

    // Leave and reopen: the page stays mounted behind the chat, so the
    // columns are simply still there — no refetch, no menu interaction.
    fireEvent.keyDown(document.body, { key: "n", metaKey: true });
    // Hidden, not unmounted: the rows are still in the tree.
    expect(screen.getByText("assets:cash")).toBeInTheDocument();
    openSheet();
    expect(screen.getByText("2026-07-01")).toBeInTheDocument();
    expect(screen.getByText("95.00 USD")).toBeInTheDocument();
    expect(bridge.callsFor("ledger_net_worth")).toHaveLength(2);
  });

  it("should mark the sidebar entry active and keep the chat mounted but hidden while open", async () => {
    render(<ChatLayout />);
    openSheet();
    await screen.findByText("assets:cash");

    expect(screen.getByRole("button", { name: "Net Worth" })).toHaveAttribute("data-active");
    const thread = screen.getByTestId("thread");
    expect(thread).toBeInTheDocument();
    expect((thread.parentElement as HTMLElement).className).toContain("hidden");
  });

  it("should ignore a second click on the active entry: the page stays, with no extra IPC", async () => {
    render(<ChatLayout />);
    openSheet();
    await screen.findByText("assets:cash");

    openSheet();

    expect(screen.getByText("assets:cash")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Net Worth" })).toHaveAttribute("data-active");
    expect(bridge.callsFor("ledger_net_worth")).toHaveLength(2);
  });

  it("should keep the report across a round trip to the chat, with no extra fetch", async () => {
    render(<ChatLayout />);
    openSheet();
    await screen.findByText("assets:cash");
    // Returning to the chat goes through new chat (Cmd/Ctrl+N), not the entry.
    fireEvent.keyDown(document.body, { key: "n", metaKey: true });
    // Hidden, not unmounted: the rows are still in the tree.
    expect(screen.getByText("assets:cash")).toBeInTheDocument();

    openSheet();
    await screen.findByText("assets:cash");
    // The badge's fetch plus the page's one open — the report survives the
    // round trip (a turn that finishes while the page is hidden defers its
    // refresh to the next show).
    expect(bridge.callsFor("ledger_net_worth")).toHaveLength(2);
  });

  it("should show the empty state when the report has no balances", async () => {
    bridge.setHandler("ledger_net_worth", () => ({
      sections: [],
      net: { amounts: [], value: [] },
      baseCommodity: null,
    }));
    render(<ChatLayout />);
    openSheet();

    expect(await screen.findByText("No transactions yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("should open a new chat from the empty state's New Chat button", async () => {
    bridge.setHandler("ledger_net_worth", () => ({
      sections: [],
      net: { amounts: [], value: [] },
      baseCommodity: null,
    }));
    render(<ChatLayout />);
    openSheet();

    fireEvent.click(await screen.findByRole("button", { name: "New Chat" }));

    // Back on the chat view, in a fresh thread — the sidebar's New Chat
    // action, triggered from the report page.
    const thread = screen.getByTestId("thread");
    expect((thread.parentElement as HTMLElement).className).not.toContain("hidden");
    expect(screen.getByRole("button", { name: "Net Worth" })).not.toHaveAttribute("data-active");
    expect(switchToNewThread).toHaveBeenCalledTimes(1);
  });
});
