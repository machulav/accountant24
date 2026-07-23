// @vitest-environment jsdom

// Spec for the Net Worth view: skeleton while the first load is in
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
  ledgerApi: { netWorth: vi.fn() },
}));

import { AssistantRuntimeProvider, type ExternalStoreAdapter, useExternalStoreRuntime } from "@assistant-ui/react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { ledgerApi } from "@/rpc/api";
import type { LedgerAmount, NetWorth } from "@/rpc/types";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { NetWorthView } from "../net-worth-view";

beforeAll(() => installJsdomPolyfills());
afterEach(() => cleanup());
beforeEach(() => {
  vi.mocked(ledgerApi.netWorth).mockReset();
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
const DATA: NetWorth = {
  sections: [
    {
      name: "Assets",
      rows: [
        {
          name: "assets:cash",
          amounts: [A("UAH", 1408.26), A("USD", 100)],
          value: [A("EUR", 115.573, 3)],
          assertedOn: "2026-06-15",
        },
        { name: "assets:darka:etf:sxr8", amounts: [A("SXR8", 22.45)], value: [A("EUR", 1920.148, 3)] },
        { name: "assets:bank", amounts: [A("EUR", 50)], value: [A("EUR", 50)], assertedOn: "2026-07-12" },
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
  net: { amounts: [A("UAH", 1408.26), A("USD", 100), A("SXR8", 22.45), A("EUR", -296.75)], value: [A("EUR", 1738.97)] },
};

const EMPTY: NetWorth = { sections: [], net: { amounts: [], value: [] } };

const renderView = (isRunning = false) =>
  render(
    <Chrome isRunning={isRunning}>
      <NetWorthView />
    </Chrome>,
  );

/** The rendered account order of one section's table: each body row's
 *  account-cell title. */
const accountOrder = (tableName: string) =>
  within(screen.getByRole("table", { name: tableName }))
    .getAllByRole("row")
    .slice(1) // the column-header row
    .map((row) => row.querySelector("td")?.getAttribute("title"));

describe("<NetWorthView />", () => {
  it("should show the page chrome immediately and skeletons only for the loading data", () => {
    vi.mocked(ledgerApi.netWorth).mockReturnValue(new Promise(() => {}));
    renderView();
    expect(screen.getByRole("status", { name: "Loading accounts" })).toBeInTheDocument();
    // Everything that needs no data is up before the report arrives: the
    // search box, the Assets band, the column labels, and the Net band.
    expect(screen.getByRole("searchbox", { name: "Search accounts" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Assets" })).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
    // The Net Worth band (the page h1 reads Net Worth too, hence the selector).
    expect(screen.getByText("Net Worth", { selector: "div" })).toBeInTheDocument();
    // But no figures yet — those are what's loading.
    expect(screen.queryByText(/EUR/)).not.toBeInTheDocument();
  });

  it("should render the pinned Net Worth title without a figure", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
    renderView();
    expect(await screen.findByRole("heading", { level: 1, name: "Net Worth" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("should render one section per bs subreport, with hledger's own totals", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
    renderView();
    // Settle on loaded data first — the skeleton also carries an Assets band.
    await screen.findByTitle("assets:cash");
    expect(screen.getByRole("heading", { level: 2, name: "Assets" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Liabilities" })).toBeInTheDocument();
    // The assets total includes converted holdings: an estimate, so ~.
    expect(screen.getByText("~2,085.72 EUR")).toBeInTheDocument();
    // The liabilities total is exact EUR: no marker.
    expect(screen.getByText("346.75 EUR", { selector: "div" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Assets" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Liabilities" })).toBeInTheDocument();
  });

  it("should show liabilities with hledger's positive sign", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
    renderView();
    expect(await screen.findByTitle("liabilities:creditcard")).toBeInTheDocument();
    // The account row (holding + value) and the section total all read
    // €346.75 — never a minus.
    expect(screen.getAllByText("346.75 EUR")).toHaveLength(3);
    expect(screen.queryByText("-346.75 EUR")).not.toBeInTheDocument();
  });

  it("should render the classic Net line last, with hledger's own figure", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
    renderView();
    const net = await screen.findByText("Net Worth", { selector: "div" });
    expect(screen.getByText("~1,738.97 EUR")).toBeInTheDocument();
    // Net comes after both section tables in document order.
    const tables = screen.getAllByRole("table");
    const lastTable = tables[tables.length - 1] as HTMLElement;
    expect(lastTable.compareDocumentPosition(net) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("should not render a section hledger sent empty", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue({
      ...DATA,
      sections: [
        DATA.sections[0] as NetWorth["sections"][number],
        { name: "Liabilities", rows: [], total: { amounts: [], value: [] } },
      ],
    });
    renderView();
    await screen.findByRole("heading", { level: 2, name: "Assets" });
    expect(screen.queryByRole("heading", { level: 2, name: "Liabilities" })).not.toBeInTheDocument();
  });

  it("should list complete account paths sorted A-Z by default", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
    renderView();
    expect(await screen.findByTitle("assets:cash")).toHaveTextContent("assets:cash");
    // The fixture arrives in hledger's order (cash, darka, bank); the table
    // re-sorts it alphabetically.
    expect(accountOrder("Assets")).toEqual(["assets:bank", "assets:cash", "assets:darka:etf:sxr8"]);
  });

  it("should mark converted row values with ~ and leave exact ones unmarked", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
    renderView();
    // Converted (UAH+USD and SXR8 valued into EUR): estimates.
    expect(await screen.findByText("~115.57 EUR")).toBeInTheDocument();
    expect(screen.getByText("~1,920.15 EUR")).toBeInTheDocument();
    // The plain EUR account is exact: holding and value, no marker.
    expect(screen.getAllByText("50.00 EUR")).toHaveLength(2);
    expect(screen.queryByText("~50.00 EUR")).not.toBeInTheDocument();
  });

  it("should show each account's last balance assertion date, and an em dash when it was never asserted", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
    renderView();
    // Settle on loaded data first — the skeleton also carries the header.
    await screen.findByTitle("assets:cash");
    // One sortable header per section table.
    expect(screen.getAllByRole("button", { name: "Last Balance Assertion" })).toHaveLength(2);
    // The journal's own ISO dates, verbatim.
    expect(screen.getByText("2026-07-12")).toBeInTheDocument();
    expect(screen.getByText("2026-06-15")).toBeInTheDocument();
    // Never asserted: the SXR8 account and the liability.
    expect(screen.getAllByText("\u2014")).toHaveLength(2);
  });

  it("should show a multi-commodity holding comma-joined on one line", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
    renderView();
    expect(await screen.findByText("1,408.26 UAH, 100.00 USD")).toBeInTheDocument();
    expect(screen.getByText("22.45 SXR8")).toBeInTheDocument();
  });

  it("should show an unconverted multi-commodity net comma-joined, without ~", async () => {
    // No rates in the journal: the valued run returns the same figures.
    vi.mocked(ledgerApi.netWorth).mockResolvedValue({
      ...DATA,
      net: { amounts: [A("EUR", 7796.25), A("UAH", 1000)], value: [A("EUR", 7796.25), A("UAH", 1000)] },
    });
    renderView();
    expect(await screen.findByText("7,796.25 EUR, 1,000.00 UAH")).toBeInTheDocument();
    expect(screen.queryByText("~7,796.25 EUR, 1,000.00 UAH")).not.toBeInTheDocument();
  });

  it("should show no ~ anywhere when nothing was converted, totals included", async () => {
    // An all-exact journal: every value equals its native amounts.
    vi.mocked(ledgerApi.netWorth).mockResolvedValue({
      sections: [
        {
          name: "Assets",
          rows: [
            { name: "assets:bank:mono", amounts: [A("UAH", 1000)], value: [A("UAH", 1000)] },
            { name: "assets:bank:n26", amounts: [A("EUR", 7796.25)], value: [A("EUR", 7796.25)] },
          ],
          total: { amounts: [A("EUR", 7796.25), A("UAH", 1000)], value: [A("EUR", 7796.25), A("UAH", 1000)] },
        },
      ],
      net: { amounts: [A("EUR", 7796.25), A("UAH", 1000)], value: [A("EUR", 7796.25), A("UAH", 1000)] },
    });
    renderView();
    await screen.findByTitle("assets:bank:mono");
    expect(screen.queryByText(/~/)).not.toBeInTheDocument();
  });

  describe("sorting", () => {
    const assetsButton = (name: string) =>
      within(screen.getByRole("table", { name: "Assets" })).getByRole("button", { name });

    it("should sort Z-A when the Account header is clicked", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByTitle("assets:cash");
      await userEvent.click(assetsButton("Account"));
      expect(accountOrder("Assets")).toEqual(["assets:darka:etf:sxr8", "assets:cash", "assets:bank"]);
    });

    it("should sort by market value, biggest first, when the Value header is clicked", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
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
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
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

    it("should sort by assertion date, most recent first, with never-asserted rows last", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByTitle("assets:cash");
      await userEvent.click(assetsButton("Last Balance Assertion"));
      // bank (07-12) > cash (06-15) > darka (never asserted).
      expect(accountOrder("Assets")).toEqual(["assets:bank", "assets:cash", "assets:darka:etf:sxr8"]);
      // A second click flips: never-asserted first, then oldest.
      await userEvent.click(assetsButton("Last Balance Assertion"));
      expect(accountOrder("Assets")).toEqual(["assets:darka:etf:sxr8", "assets:cash", "assets:bank"]);
    });

    it("should keep each section's sorting independent", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue({
        ...DATA,
        sections: [
          DATA.sections[0] as NetWorth["sections"][number],
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
      vi.mocked(ledgerApi.netWorth).mockResolvedValue({
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

  describe("column explanations", () => {
    const hoverInfo = async (label: string) => {
      const marker = within(screen.getByRole("table", { name: "Assets" })).getByRole("button", {
        name: `About ${label}`,
      });
      await userEvent.hover(marker);
    };

    it("should explain the Holding column behind its info marker", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByTitle("assets:cash");
      await hoverInfo("Holding");
      expect(
        await screen.findByText(/What the account actually holds: cash in its own currency, shares, or crypto/),
      ).toBeInTheDocument();
    });

    it("should explain the Last Balance Assertion column, including the dash", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByTitle("assets:cash");
      await hoverInfo("Last Balance Assertion");
      expect(
        await screen.findByText(/When the ledger balance was last confirmed to match the real account balance/),
      ).toBeInTheDocument();
      expect(screen.getByText(/A dash means it was never confirmed/)).toBeInTheDocument();
      // The tooltip also teaches how to confirm one.
      expect(screen.getByText(/My cash balance is 200 EUR/)).toBeInTheDocument();
    });

    it("should explain the Value column, including the ~ marker", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByTitle("assets:cash");
      await hoverInfo("Value");
      expect(
        await screen.findByText(
          /What the holding is worth in your main currency, at the latest rate recorded in the ledger/,
        ),
      ).toBeInTheDocument();
      expect(screen.getByText(/~ means the value was converted and is an estimate/)).toBeInTheDocument();
      // The tooltip also teaches how to refresh a rate.
      expect(screen.getByText(/1 USD is 0.92 EUR/)).toBeInTheDocument();
    });

    it("should give the Account column no info marker", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByTitle("assets:cash");
      expect(screen.queryByRole("button", { name: "About Account" })).not.toBeInTheDocument();
    });
  });

  describe("search", () => {
    it("should filter every section by account path, case-insensitively", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
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
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
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
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(EMPTY);
    renderView();
    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
    expect(screen.getByText(/Ask the agent to record your first transaction/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // No rows — nothing to search either.
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("should fall back to the empty state when the report query rejects", async () => {
    vi.mocked(ledgerApi.netWorth).mockRejectedValue(new Error("bridge down"));
    renderView();
    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
  });

  it("should refetch the report when the agent goes from running to idle", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
    const { rerender } = renderView(false);
    await screen.findByText("~115.57 EUR");
    expect(ledgerApi.netWorth).toHaveBeenCalledTimes(1);

    rerender(
      <Chrome isRunning={true}>
        <NetWorthView />
      </Chrome>,
    );
    // Flush the runtime's async store propagation before asserting no refetch
    // happened on the idle → running edge.
    await act(async () => {});
    expect(ledgerApi.netWorth).toHaveBeenCalledTimes(1);

    rerender(
      <Chrome isRunning={false}>
        <NetWorthView />
      </Chrome>,
    );
    await waitFor(() => expect(ledgerApi.netWorth).toHaveBeenCalledTimes(2));
  });

  it("should keep the current rows visible while a refetch is in flight", async () => {
    vi.mocked(ledgerApi.netWorth)
      .mockResolvedValueOnce(DATA)
      .mockReturnValue(new Promise(() => {}));
    const { rerender } = renderView(false);
    await screen.findByText("~115.57 EUR");

    rerender(
      <Chrome isRunning={true}>
        <NetWorthView />
      </Chrome>,
    );
    await act(async () => {});
    rerender(
      <Chrome isRunning={false}>
        <NetWorthView />
      </Chrome>,
    );
    // Once the refetch is genuinely in flight (its promise never resolves),
    // the previous rows must still be up, with no skeleton.
    await waitFor(() => expect(ledgerApi.netWorth).toHaveBeenCalledTimes(2));
    expect(screen.getByText("~115.57 EUR")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
