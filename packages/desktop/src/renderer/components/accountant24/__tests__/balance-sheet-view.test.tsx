// @vitest-environment jsdom

// Spec for the Balance Sheet view: skeleton while the first load is in
// flight, a pinned title and search box, one data table per `hledger bs`
// section (Assets, Liabilities — the latter already sign-flipped positive by
// hledger) with the section's own total, the hledger-computed Net as the
// closing line, sorting on every column (A-Z on the account path by default,
// independent per section), search filtering every section by path, the
// empty state (no journal yet or hledger failed), and the refetch on the
// agent's running → idle edge. jsdom pins navigator.language to en-US, so
// formatted expectations are deterministic.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// IPC boundary: the view reads the bs report over the Electron bridge.
vi.mock("@/rpc/api", () => ({
  ledgerApi: { balanceSheet: vi.fn() },
}));

import { AssistantRuntimeProvider, type ExternalStoreAdapter, useExternalStoreRuntime } from "@assistant-ui/react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { ledgerApi } from "@/rpc/api";
import type { BalanceSheet, LedgerAmount } from "@/rpc/types";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { BalanceSheetView } from "../balance-sheet-view";

beforeAll(() => installJsdomPolyfills());
afterEach(() => cleanup());
beforeEach(() => {
  vi.mocked(ledgerApi.balanceSheet).mockReset();
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

// A two-section sheet the way hledger bs hands it over: assets with a
// converted multi-commodity account, a share account, and a plain EUR one;
// liabilities already positive; hledger's own section totals and net.
const DATA: BalanceSheet = {
  sections: [
    {
      name: "Assets",
      rows: [
        { name: "assets:cash", amounts: [A("UAH", 1408.26), A("USD", 100)], value: [A("EUR", 115.573, 3)] },
        { name: "assets:darka:etf:sxr8", amounts: [A("SXR8", 22.45)], value: [A("EUR", 1920.148, 3)] },
        { name: "assets:bank", amounts: [A("EUR", 50)], value: [A("EUR", 50)] },
      ],
      total: {
        amounts: [A("UAH", 1408.26), A("USD", 100), A("SXR8", 22.45), A("EUR", 50)],
        value: [A("EUR", 2085.72)],
      },
    },
    {
      name: "Liabilities",
      rows: [{ name: "liabilities:creditcard", amounts: [A("EUR", 346.75)], value: [A("EUR", 346.75)] }],
      total: { amounts: [A("EUR", 346.75)], value: [A("EUR", 346.75)] },
    },
  ],
  net: { amounts: [], value: [A("EUR", 1738.97)] },
};

const EMPTY: BalanceSheet = { sections: [], net: { amounts: [], value: [] } };

const renderView = (isRunning = false) =>
  render(
    <Chrome isRunning={isRunning}>
      <BalanceSheetView />
    </Chrome>,
  );

/** The rendered account order of one section's table: each body row's
 *  account-cell title. */
const accountOrder = (tableName: string) =>
  within(screen.getByRole("table", { name: tableName }))
    .getAllByRole("row")
    .slice(1) // the column-header row
    .map((row) => row.querySelector("td")?.getAttribute("title"));

describe("<BalanceSheetView />", () => {
  it("should show a loading status and no tables while the first load is in flight", () => {
    vi.mocked(ledgerApi.balanceSheet).mockReturnValue(new Promise(() => {}));
    renderView();
    expect(screen.getByRole("status", { name: "Loading accounts" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("should render the pinned Balance Sheet title without a figure", async () => {
    vi.mocked(ledgerApi.balanceSheet).mockResolvedValue(DATA);
    renderView();
    expect(await screen.findByRole("heading", { level: 1, name: "Balance Sheet" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("should render one section per bs subreport, with hledger's own totals", async () => {
    vi.mocked(ledgerApi.balanceSheet).mockResolvedValue(DATA);
    renderView();
    expect(await screen.findByRole("heading", { level: 2, name: "Assets" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Liabilities" })).toBeInTheDocument();
    expect(screen.getByText("2,085.72 EUR")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Assets" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Liabilities" })).toBeInTheDocument();
  });

  it("should show liabilities with hledger's positive sign", async () => {
    vi.mocked(ledgerApi.balanceSheet).mockResolvedValue(DATA);
    renderView();
    expect(await screen.findByTitle("liabilities:creditcard")).toBeInTheDocument();
    // The account row (holding + value) and the section total all read
    // €346.75 — never a minus.
    expect(screen.getAllByText("346.75 EUR")).toHaveLength(3);
    expect(screen.queryByText("-346.75 EUR")).not.toBeInTheDocument();
  });

  it("should render the classic Net line last, with hledger's own figure", async () => {
    vi.mocked(ledgerApi.balanceSheet).mockResolvedValue(DATA);
    renderView();
    const net = await screen.findByText("Net");
    expect(screen.getByText("1,738.97 EUR")).toBeInTheDocument();
    // Net comes after both section tables in document order.
    const tables = screen.getAllByRole("table");
    const lastTable = tables[tables.length - 1] as HTMLElement;
    expect(lastTable.compareDocumentPosition(net) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("should not render a section hledger sent empty", async () => {
    vi.mocked(ledgerApi.balanceSheet).mockResolvedValue({
      ...DATA,
      sections: [
        DATA.sections[0] as BalanceSheet["sections"][number],
        { name: "Liabilities", rows: [], total: { amounts: [], value: [] } },
      ],
    });
    renderView();
    await screen.findByRole("heading", { level: 2, name: "Assets" });
    expect(screen.queryByRole("heading", { level: 2, name: "Liabilities" })).not.toBeInTheDocument();
  });

  it("should list complete account paths sorted A-Z by default", async () => {
    vi.mocked(ledgerApi.balanceSheet).mockResolvedValue(DATA);
    renderView();
    expect(await screen.findByTitle("assets:cash")).toHaveTextContent("assets:cash");
    // The fixture arrives in hledger's order (cash, darka, bank); the table
    // re-sorts it alphabetically.
    expect(accountOrder("Assets")).toEqual(["assets:bank", "assets:cash", "assets:darka:etf:sxr8"]);
  });

  it("should show the locale-formatted market value as the primary figure on every row", async () => {
    vi.mocked(ledgerApi.balanceSheet).mockResolvedValue(DATA);
    renderView();
    expect(await screen.findByText("115.57 EUR")).toBeInTheDocument();
    expect(screen.getByText("1,920.15 EUR")).toBeInTheDocument();
  });

  it("should show a multi-commodity holding comma-joined on one line", async () => {
    vi.mocked(ledgerApi.balanceSheet).mockResolvedValue(DATA);
    renderView();
    expect(await screen.findByText("1,408.26 UAH, 100.00 USD")).toBeInTheDocument();
    expect(screen.getByText("22.45 SXR8")).toBeInTheDocument();
  });

  it("should show a multi-commodity net comma-joined on one line", async () => {
    vi.mocked(ledgerApi.balanceSheet).mockResolvedValue({
      ...DATA,
      net: { amounts: [], value: [A("EUR", 7796.25), A("UAH", 1000)] },
    });
    renderView();
    expect(await screen.findByText("7,796.25 EUR, 1,000.00 UAH")).toBeInTheDocument();
  });

  describe("sorting", () => {
    const assetsButton = (name: string) =>
      within(screen.getByRole("table", { name: "Assets" })).getByRole("button", { name });

    it("should sort Z-A when the Account header is clicked", async () => {
      vi.mocked(ledgerApi.balanceSheet).mockResolvedValue(DATA);
      renderView();
      await screen.findByTitle("assets:cash");
      await userEvent.click(assetsButton("Account"));
      expect(accountOrder("Assets")).toEqual(["assets:darka:etf:sxr8", "assets:cash", "assets:bank"]);
    });

    it("should sort by market value, biggest first, when the Value header is clicked", async () => {
      vi.mocked(ledgerApi.balanceSheet).mockResolvedValue(DATA);
      renderView();
      await screen.findByTitle("assets:cash");
      // €1,920.15 (darka) > €115.57 (cash) > €50.00 (bank).
      await userEvent.click(assetsButton("Value"));
      expect(accountOrder("Assets")).toEqual(["assets:darka:etf:sxr8", "assets:cash", "assets:bank"]);
      // A second click flips to smallest first.
      await userEvent.click(assetsButton("Value"));
      expect(accountOrder("Assets")).toEqual(["assets:bank", "assets:cash", "assets:darka:etf:sxr8"]);
    });

    it("should sort by the native quantity, biggest first, when the Holding header is clicked", async () => {
      vi.mocked(ledgerApi.balanceSheet).mockResolvedValue(DATA);
      renderView();
      await screen.findByTitle("assets:cash");
      // Primary native quantities: cash=1,408.26, bank=50, darka=22.45 — a
      // plain number sort so the column reads monotonic.
      await userEvent.click(assetsButton("Holding"));
      expect(accountOrder("Assets")).toEqual(["assets:cash", "assets:bank", "assets:darka:etf:sxr8"]);
      // A second click flips to smallest first.
      await userEvent.click(assetsButton("Holding"));
      expect(accountOrder("Assets")).toEqual(["assets:darka:etf:sxr8", "assets:bank", "assets:cash"]);
    });

    it("should keep each section's sorting independent", async () => {
      vi.mocked(ledgerApi.balanceSheet).mockResolvedValue({
        ...DATA,
        sections: [
          DATA.sections[0] as BalanceSheet["sections"][number],
          {
            name: "Liabilities",
            rows: [
              { name: "liabilities:card", amounts: [A("EUR", 100)], value: [A("EUR", 100)] },
              { name: "liabilities:loan", amounts: [A("EUR", 900)], value: [A("EUR", 900)] },
            ],
            total: { amounts: [A("EUR", 1000)], value: [A("EUR", 1000)] },
          },
        ],
      });
      renderView();
      await screen.findByTitle("assets:cash");
      const liabilitiesValue = within(screen.getByRole("table", { name: "Liabilities" })).getByRole("button", {
        name: "Value",
      });
      await userEvent.click(liabilitiesValue);
      // Liabilities re-sorted by value, biggest first...
      expect(accountOrder("Liabilities")).toEqual(["liabilities:loan", "liabilities:card"]);
      // ...while Assets keeps its default A-Z order.
      expect(accountOrder("Assets")).toEqual(["assets:bank", "assets:cash", "assets:darka:etf:sxr8"]);
    });

    it("should keep rows without amounts sortable and put bigger same-commodity holdings first", async () => {
      // A parsed report can emit a row with no amounts at all; it must not
      // break sorting.
      vi.mocked(ledgerApi.balanceSheet).mockResolvedValue({
        sections: [
          {
            name: "Assets",
            rows: [
              { name: "assets:wallet:small", amounts: [A("EUR", 50)], value: [A("EUR", 50)] },
              { name: "assets:closed", amounts: [], value: [] },
              { name: "assets:wallet:big", amounts: [A("EUR", 120)], value: [A("EUR", 120)] },
            ],
            total: { amounts: [A("EUR", 170)], value: [A("EUR", 170)] },
          },
        ],
        net: { amounts: [], value: [A("EUR", 170)] },
      });
      renderView();
      await screen.findByTitle("assets:closed");
      // The amount-less row counts as zero and sinks below real holdings.
      await userEvent.click(assetsButton("Holding"));
      expect(accountOrder("Assets")).toEqual(["assets:wallet:big", "assets:wallet:small", "assets:closed"]);
      // The same for market value.
      await userEvent.click(assetsButton("Value"));
      expect(accountOrder("Assets")).toEqual(["assets:wallet:big", "assets:wallet:small", "assets:closed"]);
    });
  });

  describe("search", () => {
    it("should filter every section by account path, case-insensitively", async () => {
      vi.mocked(ledgerApi.balanceSheet).mockResolvedValue(DATA);
      renderView();
      await screen.findByTitle("assets:cash");
      await userEvent.type(screen.getByRole("searchbox", { name: "Search accounts" }), "CASH");
      expect(accountOrder("Assets")).toEqual(["assets:cash"]);
      // The liabilities table has no matching account.
      expect(
        within(screen.getByRole("table", { name: "Liabilities" })).getByText("No matching accounts"),
      ).toBeInTheDocument();
    });

    it("should show empty messages when nothing matches, and restore rows when cleared", async () => {
      vi.mocked(ledgerApi.balanceSheet).mockResolvedValue(DATA);
      renderView();
      await screen.findByTitle("assets:cash");
      const box = screen.getByRole("searchbox", { name: "Search accounts" });
      await userEvent.type(box, "zzz");
      expect(screen.getAllByText("No matching accounts")).toHaveLength(2);
      await userEvent.clear(box);
      expect(accountOrder("Assets")).toHaveLength(3);
    });
  });

  it("should show the empty state when the report has no accounts", async () => {
    vi.mocked(ledgerApi.balanceSheet).mockResolvedValue(EMPTY);
    renderView();
    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
    expect(screen.getByText(/Ask the agent to record your first transaction/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // No rows — nothing to search either.
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("should fall back to the empty state when the report query rejects", async () => {
    vi.mocked(ledgerApi.balanceSheet).mockRejectedValue(new Error("bridge down"));
    renderView();
    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
  });

  it("should refetch the report when the agent goes from running to idle", async () => {
    vi.mocked(ledgerApi.balanceSheet).mockResolvedValue(DATA);
    const { rerender } = renderView(false);
    await screen.findByText("115.57 EUR");
    expect(ledgerApi.balanceSheet).toHaveBeenCalledTimes(1);

    rerender(
      <Chrome isRunning={true}>
        <BalanceSheetView />
      </Chrome>,
    );
    // Flush the runtime's async store propagation before asserting no refetch
    // happened on the idle → running edge.
    await act(async () => {});
    expect(ledgerApi.balanceSheet).toHaveBeenCalledTimes(1);

    rerender(
      <Chrome isRunning={false}>
        <BalanceSheetView />
      </Chrome>,
    );
    await waitFor(() => expect(ledgerApi.balanceSheet).toHaveBeenCalledTimes(2));
  });

  it("should keep the current rows visible while a refetch is in flight", async () => {
    vi.mocked(ledgerApi.balanceSheet)
      .mockResolvedValueOnce(DATA)
      .mockReturnValue(new Promise(() => {}));
    const { rerender } = renderView(false);
    await screen.findByText("115.57 EUR");

    rerender(
      <Chrome isRunning={true}>
        <BalanceSheetView />
      </Chrome>,
    );
    await act(async () => {});
    rerender(
      <Chrome isRunning={false}>
        <BalanceSheetView />
      </Chrome>,
    );
    // Once the refetch is genuinely in flight (its promise never resolves),
    // the previous rows must still be up, with no skeleton.
    await waitFor(() => expect(ledgerApi.balanceSheet).toHaveBeenCalledTimes(2));
    expect(screen.getByText("115.57 EUR")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
