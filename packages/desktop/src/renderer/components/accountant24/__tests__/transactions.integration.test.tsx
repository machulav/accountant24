// @vitest-environment jsdom

// Integration: the Transactions flow across real ChatLayout + real
// TransactionsView + the real rpc/api layer, over the fake `window.api`
// bridge. Asserts both the UI and the exact IPC traffic. The pi runtime and
// heavy chat children are stubbed (they have their own suites); the IPC
// boundary is the fake bridge.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
vi.mock("@assistant-ui/react-pi", () => ({
  usePiRuntime: () => ({ threads: { switchToNewThread: vi.fn() } }),
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

// Heavy chat children with their own suites; the Transactions view and the
// sidebar stay REAL.
vi.mock("../thread", () => ({ Thread: () => <div data-testid="thread" /> }));
vi.mock("../thread-list", () => ({
  ThreadList: () => <div data-testid="thread-list" />,
  ThreadListNew: () => <div data-testid="thread-list-new" />,
}));
vi.mock("../settings/settings", () => ({ Settings: () => null }));

import type { LedgerTransaction } from "@/rpc/types";
import { ChatLayout } from "../chat-layout";

const DATA: LedgerTransaction[] = [
  {
    index: 1,
    date: "2026-02-05",
    payee: "Landlord",
    note: "February rent",
    status: "Cleared",
    tags: [],
    postings: [
      { account: "expenses:housing:rent", amounts: [{ quantity: 900, commodity: "EUR", precision: 2 }] },
      { account: "assets:bank:checking", amounts: [{ quantity: -900, commodity: "EUR", precision: 2 }] },
    ],
  },
  {
    index: 2,
    date: "2026-03-10",
    payee: "Grocery Store",
    note: "weekly shop",
    status: "Cleared",
    tags: [{ name: "category", value: "groceries" }],
    postings: [
      { account: "expenses:food", amounts: [{ quantity: 12.5, commodity: "EUR", precision: 2 }] },
      { account: "assets:cash", amounts: [{ quantity: -12.5, commodity: "EUR", precision: 2 }] },
    ],
  },
];

beforeAll(() => {
  installJsdomPolyfills();
});

beforeEach(() => {
  window.localStorage.clear();
  bridge.reset();
  bridge.setHandler("update_pending", () => null);
  // The sidebar's Net Worth badge fetches on layout mount, page open or not.
  bridge.setHandler("ledger_net_worth", () => ({ sections: [], net: { amounts: [], value: [] } }));
  bridge.setHandler("ledger_transactions", () => DATA);
});

afterEach(() => cleanup());

const openPage = () => fireEvent.click(screen.getByRole("button", { name: "Transactions" }));

describe("Transactions view flow", () => {
  it("should list Transactions above Net Worth in the sidebar and fetch nothing until opened", () => {
    render(<ChatLayout />);
    const transactions = screen.getByRole("button", { name: "Transactions" });
    const netWorth = screen.getByRole("button", { name: "Net Worth" });
    expect(transactions.compareDocumentPosition(netWorth) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bridge.callsFor("ledger_transactions")).toHaveLength(0);
  });

  it("should fetch the register over IPC and render collapsed rows that unfold on click", async () => {
    render(<ChatLayout />);
    openPage();

    expect(await screen.findByText("Grocery Store")).toBeInTheDocument();
    expect(screen.getByText("Landlord")).toBeInTheDocument();
    // Collapsed: the cash leg only; the expense leg unfolds on click.
    expect(screen.getByText("assets:cash")).toBeInTheDocument();
    expect(screen.getByText("-12.50 EUR")).toBeInTheDocument();
    expect(screen.getByText("2026-03-10")).toBeInTheDocument();
    expect(screen.queryByText("expenses:food")).toBeNull();
    fireEvent.click(
      within(screen.getByText("Grocery Store").closest("tr") as HTMLElement).getByRole("button", {
        name: "Expand row",
      }),
    );
    expect(screen.getByText("expenses:food")).toBeInTheDocument();
    expect(screen.getByText("12.50 EUR")).toBeInTheDocument();
    expect(bridge.callsFor("ledger_transactions")).toHaveLength(1);
  });

  it("should mark the sidebar entry active and keep the chat mounted but hidden while open", async () => {
    render(<ChatLayout />);
    openPage();
    await screen.findByText("Grocery Store");

    expect(screen.getByRole("button", { name: "Transactions" })).toHaveAttribute("data-active");
    const thread = screen.getByTestId("thread");
    expect(thread).toBeInTheDocument();
    expect((thread.parentElement as HTMLElement).className).toContain("hidden");
  });

  it("should ignore a second click on the active entry: the page stays, with no extra IPC", async () => {
    render(<ChatLayout />);
    openPage();
    await screen.findByText("Grocery Store");

    openPage();

    expect(screen.getByText("Grocery Store")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transactions" })).toHaveAttribute("data-active");
    expect(bridge.callsFor("ledger_transactions")).toHaveLength(1);
  });

  it("should keep the page alive across view switches: no refetch, state intact", async () => {
    render(<ChatLayout />);
    openPage();
    await screen.findByText("Grocery Store");
    // Returning to the chat goes through new chat (Cmd/Ctrl+N), not the entry.
    fireEvent.keyDown(document.body, { key: "n", metaKey: true });
    // Hidden, not unmounted: the rows are still in the tree.
    expect(screen.getByText("Grocery Store")).toBeInTheDocument();

    openPage();
    await screen.findByText("Grocery Store");
    // One fetch total — the register survives the round trip (a turn that
    // finishes while the page is hidden defers its refresh to the next show).
    expect(bridge.callsFor("ledger_transactions")).toHaveLength(1);
  });

  it("should show the empty state when the journal has no transactions", async () => {
    bridge.setHandler("ledger_transactions", () => []);
    render(<ChatLayout />);
    openPage();

    expect(await screen.findByText(/No transactions yet/)).toBeInTheDocument();
  });
});
