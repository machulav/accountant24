// @vitest-environment jsdom

// Integration: the Investments flow across real ChatLayout + real
// InvestmentsView + the real rpc/api layer, over the fake `window.api`
// bridge. Asserts both the UI and the exact IPC traffic. The pi runtime and
// heavy chat children are stubbed (they have their own suites); the IPC
// boundary is the fake bridge.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

// Heavy chat children with their own suites; the Investments view stays
// REAL.
vi.mock("../thread", () => ({ Thread: () => <div data-testid="thread" /> }));
vi.mock("../thread-list", () => ({
  ThreadList: () => <div data-testid="thread-list" />,
  ThreadListNew: () => <div data-testid="thread-list-new" />,
}));
vi.mock("../settings/settings", () => ({ Settings: () => null }));
// The other report pages stay out of this flow.
vi.mock("../transactions-view", () => ({ TransactionsView: () => <div data-testid="transactions-view" /> }));
vi.mock("../net-worth-view", () => ({ NetWorthView: () => <div data-testid="net-worth-view" /> }));
vi.mock("../net-worth-badge", () => ({ NetWorthBadge: () => null }));

import type { Investments } from "@/rpc/types";
import { ChatLayout } from "../chat-layout";

const DATA: Investments = {
  baseCommodity: "EUR",
  rows: [
    {
      commodity: "XEON",
      quantity: { quantity: 13, commodity: "XEON", precision: 0 },
      price: { quantity: 149.6366, commodity: "EUR", precision: 4 },
      marketValue: { quantity: 1945.28, commodity: "EUR", precision: 2 },
      costBasis: { quantity: 1941.53, commodity: "EUR", precision: 2 },
      unrealizedPnl: { quantity: 3.75, commodity: "EUR", precision: 2 },
    },
  ],
  totalMarketValue: [{ quantity: 1945.28, commodity: "EUR", precision: 2 }],
  totalCostBasis: [{ quantity: 1941.53, commodity: "EUR", precision: 2 }],
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
  bridge.setHandler("ledger_investments", () => DATA);
  // The Columns choice persists here; every spec starts from the default.
  window.localStorage.clear();
});

afterEach(() => cleanup());

const openPage = () => fireEvent.click(screen.getByRole("button", { name: "Investments" }));

describe("Investments view flow", () => {
  it("should fetch the report over IPC and render the summary and holdings when Investments is opened", async () => {
    render(<ChatLayout />);
    expect(bridge.callsFor("ledger_investments")).toHaveLength(0);

    openPage();

    expect(await screen.findByText("XEON")).toBeInTheDocument();
    expect(screen.getByText("13 XEON")).toBeInTheDocument();
    expect(screen.getByText("Total Invested")).toBeInTheDocument();
    expect(screen.getByText("1,941.53 EUR")).toBeInTheDocument();
    // Twice: the Market Value card and the holding's own Value column.
    expect(screen.getAllByText("1,945.28 EUR")).toHaveLength(2);
    expect(screen.getByText("+3.75 EUR")).toBeInTheDocument();
    expect(bridge.callsFor("ledger_investments")).toHaveLength(1);
  });

  it("should mark the sidebar entry active and keep the chat mounted but hidden while open", async () => {
    render(<ChatLayout />);
    openPage();
    await screen.findByText("XEON");

    expect(screen.getByRole("button", { name: "Investments" })).toHaveAttribute("data-active");
    const thread = screen.getByTestId("thread");
    expect(thread).toBeInTheDocument();
    expect((thread.parentElement as HTMLElement).className).toContain("hidden");
  });

  it("should ignore a second click on the active entry: the page stays, with no extra IPC", async () => {
    render(<ChatLayout />);
    openPage();
    await screen.findByText("XEON");

    openPage();

    expect(screen.getByText("XEON")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Investments" })).toHaveAttribute("data-active");
    expect(bridge.callsFor("ledger_investments")).toHaveLength(1);
  });

  it("should keep the report across a round trip to the chat, with no extra fetch", async () => {
    render(<ChatLayout />);
    openPage();
    await screen.findByText("XEON");
    // Returning to the chat goes through new chat (Cmd/Ctrl+N), not the entry.
    fireEvent.keyDown(document.body, { key: "n", metaKey: true });
    // Hidden, not unmounted: the rows are still in the tree.
    expect(screen.getByText("XEON")).toBeInTheDocument();

    openPage();
    await screen.findByText("XEON");
    // The page's one open — the report survives the round trip (a turn that
    // finishes while the page is hidden defers its refresh to the next show).
    expect(bridge.callsFor("ledger_investments")).toHaveLength(1);
  });

  it("should show the empty state when the report has no holdings", async () => {
    bridge.setHandler("ledger_investments", () => ({
      baseCommodity: null,
      rows: [],
      totalMarketValue: [],
      totalCostBasis: [],
    }));
    render(<ChatLayout />);
    openPage();

    expect(await screen.findByText("No investments yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("should open a new chat from the empty state's New Chat button", async () => {
    bridge.setHandler("ledger_investments", () => ({
      baseCommodity: null,
      rows: [],
      totalMarketValue: [],
      totalCostBasis: [],
    }));
    render(<ChatLayout />);
    openPage();

    fireEvent.click(await screen.findByRole("button", { name: "New Chat" }));

    // Back on the chat view, in a fresh thread — the sidebar's New Chat
    // action, triggered from the report page.
    const thread = screen.getByTestId("thread");
    expect((thread.parentElement as HTMLElement).className).not.toContain("hidden");
    expect(screen.getByRole("button", { name: "Investments" })).not.toHaveAttribute("data-active");
    expect(switchToNewThread).toHaveBeenCalledTimes(1);
  });
});
