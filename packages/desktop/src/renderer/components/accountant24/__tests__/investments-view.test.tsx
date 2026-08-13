// @vitest-environment jsdom

// Spec for the Investments view: skeleton while the first load is in
// flight, a pinned title and search box, the three portfolio summary cards
// (Total Invested, Market Value, Unrealized P&L — the latter signed, with
// its return), one stock data grid with a row per holding (Commodity,
// Quantity, Price, Value), the optional Cost, P&L, and Allocation columns
// hidden behind the header's Columns menu (the choice persisted in
// localStorage with the shared table-config shape), the empty state (no
// holdings yet or hledger failed), and the refetch on the agent's running →
// idle edge. jsdom pins navigator.language to en-US, so formatted
// expectations are deterministic.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// IPC boundary: the view reads the report over the Electron bridge.
vi.mock("@/rpc/api", () => ({
  ledgerApi: { investments: vi.fn() },
}));

import { AssistantRuntimeProvider, type ExternalStoreAdapter, useExternalStoreRuntime } from "@assistant-ui/react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { ledgerApi } from "@/rpc/api";
import type { Investments, LedgerAmount } from "@/rpc/types";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { InvestmentsView } from "../investments-view";

beforeAll(() => installJsdomPolyfills());
afterEach(() => cleanup());
beforeEach(() => {
  vi.mocked(ledgerApi.investments).mockReset();
  // The Columns choice persists here; every spec starts from the default.
  window.localStorage.clear();
});

/** Real assistant-ui chrome so the view's `useAuiState` reads an honest
 *  `thread.isRunning`; the prop drives the running → idle refetch edge. */
function Chrome({ children, isRunning = false }: { children: ReactNode; isRunning?: boolean }) {
  const store: ExternalStoreAdapter = {
    messages: [],
    isRunning,
    onNew: async () => {},
    convertMessage: (m: unknown) => m,
  } as unknown as ExternalStoreAdapter;
  const runtime = useExternalStoreRuntime(store);
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

const A = (commodity: string, quantity: number, precision = 2): LedgerAmount => ({ commodity, quantity, precision });

/** A two-holding portfolio the way the main process hands it over: both
 *  priced toward EUR, with cost basis and P&L. */
const DATA: Investments = {
  baseCommodity: "EUR",
  rows: [
    {
      commodity: "XEON",
      quantity: { quantity: 13, commodity: "XEON", precision: 0 },
      price: A("EUR", 149.6366, 4),
      marketValue: A("EUR", 1945.28),
      costBasis: A("EUR", 1941.53),
      unrealizedPnl: A("EUR", 3.75),
    },
    {
      commodity: "XMEU",
      quantity: { quantity: 2, commodity: "XMEU", precision: 0 },
      price: A("EUR", 118.54),
      marketValue: A("EUR", 237.08),
      costBasis: A("EUR", 236.42),
      unrealizedPnl: A("EUR", 0.66),
    },
  ],
  totalMarketValue: [A("EUR", 2182.36)],
  totalCostBasis: [A("EUR", 2177.95)],
};

const EMPTY: Investments = { baseCommodity: null, rows: [], totalMarketValue: [], totalCostBasis: [] };

const renderView = (isRunning = false) =>
  render(
    <Chrome isRunning={isRunning}>
      <InvestmentsView />
    </Chrome>,
  );

describe("InvestmentsView", () => {
  it("should show the loading skeleton while the first report is in flight", () => {
    vi.mocked(ledgerApi.investments).mockReturnValue(new Promise(() => {}));
    renderView();
    // The title, search box, and the summary cards' placeholders are up
    // immediately; only the grid waits on the data.
    expect(screen.getByRole("heading", { name: "Investments" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search holdings" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading holdings" })).toBeInTheDocument();
  });

  it("should render the portfolio summary and one row per holding", async () => {
    vi.mocked(ledgerApi.investments).mockResolvedValue(DATA);
    renderView();

    // The summary cards: invested, market value, and the P&L with its return.
    expect(await screen.findByText("Total Invested")).toBeInTheDocument();
    expect(screen.getByText("2,177.95 EUR")).toBeInTheDocument();
    expect(screen.getByText("Market Value")).toBeInTheDocument();
    expect(screen.getByText("2,182.36 EUR")).toBeInTheDocument();
    expect(screen.getByText("Unrealized P&L")).toBeInTheDocument();
    // 3.75 + 0.66 = 4.41 on 1,941.53 + 236.42 = 2,177.95 → +0.2%.
    expect(screen.getByText("+4.41 EUR")).toBeInTheDocument();
    expect(screen.getByText("+0.2%")).toBeInTheDocument();

    // The holdings grid: commodity, quantity, price, and value.
    expect(screen.getByText("XEON")).toBeInTheDocument();
    expect(screen.getByText("13 XEON")).toBeInTheDocument();
    expect(screen.getByText("149.64 EUR")).toBeInTheDocument();
    expect(screen.getByText("1,945.28 EUR")).toBeInTheDocument();
    expect(screen.getByText("XMEU")).toBeInTheDocument();
    expect(screen.getByText("2 XMEU")).toBeInTheDocument();
  });

  it("should sign a negative P&L and its return", async () => {
    vi.mocked(ledgerApi.investments).mockResolvedValue({
      baseCommodity: "EUR",
      rows: [
        {
          commodity: "AAPL",
          quantity: { quantity: 5, commodity: "AAPL", precision: 0 },
          price: A("EUR", 190),
          marketValue: A("EUR", 950),
          costBasis: A("EUR", 1000),
          unrealizedPnl: A("EUR", -50),
        },
      ],
      totalMarketValue: [A("EUR", 950)],
      totalCostBasis: [A("EUR", 1000)],
    });
    renderView();
    await screen.findByText("AAPL");
    expect(screen.getByText("-50.00 EUR")).toBeInTheDocument();
    expect(screen.getByText("-5%")).toBeInTheDocument();
  });

  it("should hide the optional Cost, P&L, and Allocation columns behind the Columns menu", async () => {
    vi.mocked(ledgerApi.investments).mockResolvedValue(DATA);
    renderView();
    await screen.findByText("XEON");
    expect(screen.queryByText("1,941.53 EUR")).toBeNull();
    expect(screen.queryByText("3.75 EUR")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Columns" }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Cost" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "P&L" }));
    await userEvent.keyboard("{Escape}");

    expect(screen.getByText("1,941.53 EUR")).toBeInTheDocument();
    expect(screen.getByText("3.75 EUR")).toBeInTheDocument();
  });

  it("should persist the column choice and restore it on remount", async () => {
    vi.mocked(ledgerApi.investments).mockResolvedValue(DATA);
    const { unmount } = renderView();
    await screen.findByText("XEON");
    await userEvent.click(screen.getByRole("button", { name: "Columns" }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Allocation" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByText("89.1%")).toBeInTheDocument();

    unmount();
    renderView();
    await screen.findByText("XEON");
    expect(screen.getByText("89.1%")).toBeInTheDocument();
  });

  it("should filter the holdings by the search box", async () => {
    vi.mocked(ledgerApi.investments).mockResolvedValue(DATA);
    renderView();
    await screen.findByText("XEON");
    await userEvent.type(screen.getByRole("searchbox", { name: "Search holdings" }), "XMEU");
    expect(screen.getByText("XMEU")).toBeInTheDocument();
    expect(screen.queryByText("XEON")).not.toBeInTheDocument();
  });

  it("should show the empty state when the report has no holdings", async () => {
    vi.mocked(ledgerApi.investments).mockResolvedValue(EMPTY);
    renderView();
    expect(await screen.findByText("No investments yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    // Nothing to search on an empty page.
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("should show the empty state when the report fails", async () => {
    vi.mocked(ledgerApi.investments).mockRejectedValue(new Error("hledger failed"));
    renderView();
    expect(await screen.findByText("No investments yet")).toBeInTheDocument();
  });

  it("should open a new chat from the empty state's New Chat button", async () => {
    vi.mocked(ledgerApi.investments).mockResolvedValue(EMPTY);
    const onNewChat = vi.fn();
    render(
      <Chrome>
        <InvestmentsView onNewChat={onNewChat} />
      </Chrome>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "New Chat" }));
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("should dash the summary cards for a portfolio the journal can neither price nor cost", async () => {
    vi.mocked(ledgerApi.investments).mockResolvedValue({
      baseCommodity: null,
      rows: [
        {
          commodity: "VLT",
          quantity: { quantity: 3, commodity: "VLT", precision: 0 },
          price: null,
          marketValue: null,
          costBasis: null,
          unrealizedPnl: null,
        },
      ],
      totalMarketValue: [],
      totalCostBasis: [],
    });
    renderView();
    // The holding still lists its type and quantity.
    expect(await screen.findByText("VLT")).toBeInTheDocument();
    expect(screen.getByText("3 VLT")).toBeInTheDocument();
    // No invented zeros: every summary card and every priced column dashes.
    expect(screen.getByText("Total Invested")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  it("should refetch the report when the agent goes from running to idle", async () => {
    vi.mocked(ledgerApi.investments).mockResolvedValue(DATA);
    const { rerender } = renderView(false);
    await screen.findByText("XEON");
    expect(ledgerApi.investments).toHaveBeenCalledTimes(1);

    rerender(
      <Chrome isRunning={true}>
        <InvestmentsView />
      </Chrome>,
    );
    // Flush the runtime's async store propagation before asserting no refetch
    // happened on the idle → running edge.
    await act(async () => {});
    expect(ledgerApi.investments).toHaveBeenCalledTimes(1);

    rerender(
      <Chrome isRunning={false}>
        <InvestmentsView />
      </Chrome>,
    );
    await waitFor(() => expect(ledgerApi.investments).toHaveBeenCalledTimes(2));
  });

  it("should defer the idle-edge refetch while hidden and refresh once on the next show", async () => {
    vi.mocked(ledgerApi.investments).mockResolvedValue(DATA);
    const { rerender } = render(
      <Chrome isRunning={false}>
        <InvestmentsView active={false} />
      </Chrome>,
    );
    await screen.findByText("XEON");
    expect(ledgerApi.investments).toHaveBeenCalledTimes(1);

    // A whole turn passes behind the hidden page: no report query runs.
    rerender(
      <Chrome isRunning={true}>
        <InvestmentsView active={false} />
      </Chrome>,
    );
    await act(async () => {});
    rerender(
      <Chrome isRunning={false}>
        <InvestmentsView active={false} />
      </Chrome>,
    );
    await act(async () => {});
    expect(ledgerApi.investments).toHaveBeenCalledTimes(1);

    // The show pays the deferred refresh, once.
    rerender(
      <Chrome isRunning={false}>
        <InvestmentsView active={true} />
      </Chrome>,
    );
    await waitFor(() => expect(ledgerApi.investments).toHaveBeenCalledTimes(2));
  });

  it("should show the allocations when the Allocation column is on", async () => {
    vi.mocked(ledgerApi.investments).mockResolvedValue(DATA);
    renderView();
    await screen.findByText("XEON");
    await userEvent.click(screen.getByRole("button", { name: "Columns" }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Allocation" }));
    await userEvent.keyboard("{Escape}");
    // 1,945.28 / 2,182.36 and 237.08 / 2,182.36.
    const rows = screen.getByRole("table");
    expect(within(rows).getByText("89.1%")).toBeInTheDocument();
    expect(within(rows).getByText("10.9%")).toBeInTheDocument();
  });
});
