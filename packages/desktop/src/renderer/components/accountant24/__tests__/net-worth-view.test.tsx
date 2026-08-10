// @vitest-environment jsdom

// Spec for the Net Worth view: skeleton while the first load is in
// flight, a pinned title and search box, one stock data grid per `hledger
// bs` section (Assets, Liabilities — the latter already sign-flipped
// positive by hledger, each a labeled region) with the section's own
// total, the hledger-computed Net as the closing line, sorting on every
// column (A-Z on the account path by default, independent per section),
// search filtering every section by path, the two assertion columns hidden
// by default behind the header's Columns menu (the choice persisted in
// localStorage with the shared table-config shape), the empty state (no
// journal yet or hledger failed), and the refetch on the agent's running →
// idle edge. jsdom pins navigator.language to en-US, so formatted
// expectations are deterministic.

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
          // The balance has drifted since the assertion — the realistic case.
          assertedAmount: A("UAH", 1400),
        },
        { name: "assets:darka:etf:sxr8", amounts: [A("SXR8", 22.45)], value: [A("EUR", 1920.148, 3)] },
        {
          name: "assets:bank",
          amounts: [A("EUR", 50)],
          value: [A("EUR", 50)],
          assertedOn: "2026-07-12",
          assertedAmount: A("EUR", 45),
        },
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
  baseCommodity: "EUR",
};

const EMPTY: NetWorth = { sections: [], net: { amounts: [], value: [] }, baseCommodity: null };

const renderView = (isRunning = false) =>
  render(
    <Chrome isRunning={isRunning}>
      <NetWorthView />
    </Chrome>,
  );

/** One section's rendered scope: the labeled region around its band and
 *  grid (the vendored grid's own <table> carries no accessible name). */
const section = (name: string) => within(screen.getByRole("region", { name }));

/** The rendered account order of one section's grid: each body row's
 *  account pill text (the full path). */
const accountOrder = (sectionName: string) =>
  section(sectionName)
    .getAllByRole("row")
    .slice(1) // the column-header row
    .map((row) => row.querySelector("[data-directive-type=account]")?.textContent);

/** Turn both assertion columns on through the header's Columns menu, then
 *  close it so the tables are clickable again. */
const showAssertionColumns = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Columns" }));
  await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Asserted On" }));
  await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Asserted Amount" }));
  await userEvent.keyboard("{Escape}");
};

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
    await screen.findByText("assets:cash");
    expect(screen.getByRole("heading", { level: 2, name: "Assets" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Liabilities" })).toBeInTheDocument();
    // The assets total includes converted holdings: an estimate, so ~.
    expect(screen.getByText("~2,085.72 EUR")).toBeInTheDocument();
    // The liabilities total is exact EUR: no marker.
    expect(screen.getByText("346.75 EUR", { selector: "div" })).toBeInTheDocument();
    expect(section("Assets").getByRole("table")).toBeInTheDocument();
    expect(section("Liabilities").getByRole("table")).toBeInTheDocument();
  });

  it("should show liabilities with hledger's positive sign", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
    renderView();
    expect(await screen.findByText("liabilities:creditcard")).toBeInTheDocument();
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

  it("should list complete account paths as account pills, sorted A-Z by default", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
    renderView();
    // The chat's account pill, same as the register.
    expect((await screen.findByText("assets:cash")).closest("[data-directive-type=account]")).toBeInTheDocument();
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

  it("should show each account's last asserted date, and an em dash when it was never asserted, when toggled on", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
    renderView();
    await screen.findByText("assets:cash");
    await showAssertionColumns();
    // One sortable header per section table.
    expect(screen.getAllByRole("button", { name: "Asserted On" })).toHaveLength(2);
    // The journal's own ISO dates, verbatim.
    expect(screen.getByText("2026-07-12")).toBeInTheDocument();
    expect(screen.getByText("2026-06-15")).toBeInTheDocument();
    // Never asserted (the SXR8 account and the liability): a dash in the
    // date and in the amount column \u2014 two rows times two columns.
    expect(screen.getAllByText("\u2014")).toHaveLength(4);
  });

  it("should show the last asserted amount in the account's own commodity when toggled on", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
    renderView();
    await screen.findByText("assets:cash");
    await showAssertionColumns();
    expect(screen.getAllByRole("button", { name: "Asserted Amount" })).toHaveLength(2);
    // Formatted like Holding: locale digits, commodity suffix, the amount's
    // own precision \u2014 and distinct from the current holding (the balance
    // moved since the assertion).
    expect(screen.getByText("1,400.00 UAH")).toBeInTheDocument();
    expect(screen.getByText("45.00 EUR")).toBeInTheDocument();
  });

  it("should show the date but a dash in the amount cell when the assertion carried no amount", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue({
      sections: [
        {
          name: "Assets",
          rows: [{ name: "assets:legacy", amounts: [A("EUR", 10)], value: [A("EUR", 10)], assertedOn: "2026-05-01" }],
          total: { amounts: [A("EUR", 10)], value: [A("EUR", 10)] },
        },
      ],
      net: { amounts: [A("EUR", 10)], value: [A("EUR", 10)] },
      baseCommodity: null,
    });
    renderView();
    await screen.findByText("assets:legacy");
    await showAssertionColumns();
    expect(screen.getByText("2026-05-01")).toBeInTheDocument();
    // Only the amount cell falls back to the dash.
    expect(screen.getAllByText("\u2014")).toHaveLength(1);
  });

  it("should show a multi-commodity holding comma-joined on one line", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
    renderView();
    expect(await screen.findByText("1,408.26 UAH, 100.00 USD")).toBeInTheDocument();
    expect(screen.getByText("22.45 SXR8")).toBeInTheDocument();
  });

  it("should show an unconverted multi-commodity net comma-joined, without ~", async () => {
    // No prices in the journal: the valued run returns the same figures.
    vi.mocked(ledgerApi.netWorth).mockResolvedValue({
      ...DATA,
      net: { amounts: [A("EUR", 7796.25), A("UAH", 1000)], value: [A("EUR", 7796.25), A("UAH", 1000)] },
      baseCommodity: null,
    });
    renderView();
    expect(await screen.findByText("7,796.25 EUR, 1,000.00 UAH")).toBeInTheDocument();
    expect(screen.queryByText("~7,796.25 EUR, 1,000.00 UAH")).not.toBeInTheDocument();
    // Unsplit bands carry no info marker.
    expect(screen.queryByRole("button", { name: "About other currencies" })).not.toBeInTheDocument();
  });

  it("should lead the Net band with the base leg and mute the unconvertible rest", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue({
      ...DATA,
      net: {
        amounts: [A("EUR", 2537.5), A("UAH", 2050), A("USD", -50), A("WRLD", 2, 0)],
        value: [A("EUR", 3033.5), A("UAH", 2050), A("USD", -50)],
      },
    });
    renderView();
    // The base leg and the leftover legs are separate elements, not one line.
    expect(await screen.findByText("~3,033.50 EUR")).toBeInTheDocument();
    expect(screen.getByText("2,050.00 UAH, -50.00 USD")).toBeInTheDocument();
    expect(screen.queryByText("~3,033.50 EUR, 2,050.00 UAH, -50.00 USD")).not.toBeInTheDocument();
  });

  it("should split a section band the same way as the Net band", async () => {
    const section = DATA.sections[0] as NetWorth["sections"][number];
    vi.mocked(ledgerApi.netWorth).mockResolvedValue({
      ...DATA,
      sections: [
        {
          ...section,
          total: {
            amounts: [A("UAH", 1408.26), A("USD", 100), A("EUR", 50)],
            value: [A("EUR", 165.57), A("USD", 100)],
          },
        },
      ],
    });
    renderView();
    expect(await screen.findByText("~165.57 EUR")).toBeInTheDocument();
    expect(screen.getByText("100.00 USD")).toBeInTheDocument();
  });

  it("should explain the muted legs behind their own info marker", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue({
      ...DATA,
      net: {
        amounts: [A("EUR", 2537.5), A("UAH", 2050)],
        value: [A("EUR", 3033.5), A("UAH", 2050)],
      },
    });
    renderView();
    await screen.findByText("2,050.00 UAH");
    await userEvent.hover(screen.getByRole("button", { name: "About other currencies" }));
    expect(await screen.findByText("No price recorded yet to value these in your main currency.")).toBeInTheDocument();
    // The same how-to line as the Value column help: the fix, not just the fact.
    expect(
      screen.getByText(/To update a price, tell the agent what one unit of the holding is worth/),
    ).toBeInTheDocument();
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
      baseCommodity: null,
    });
    renderView();
    await screen.findByText("assets:bank:mono");
    expect(screen.queryByText(/~/)).not.toBeInTheDocument();
  });

  it("should list every account row, never a 10-row page", async () => {
    // Regression: the shared v9 feature bundle registers pagination, whose
    // default page size silently capped sections at 10 rows.
    const many: NetWorth = {
      sections: [
        {
          name: "Assets",
          rows: Array.from({ length: 14 }, (_, i) => ({
            name: `assets:bucket:${String(i + 1).padStart(2, "0")}`,
            amounts: [A("EUR", i + 1)],
            value: [A("EUR", i + 1)],
          })),
          total: { amounts: [A("EUR", 105)], value: [A("EUR", 105)] },
        },
      ],
      net: { amounts: [A("EUR", 105)], value: [A("EUR", 105)] },
      baseCommodity: "EUR",
    };
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(many);
    renderView();
    await screen.findByText("assets:bucket:01");
    expect(screen.getByText("assets:bucket:14")).toBeInTheDocument();
  });

  describe("sorting", () => {
    const assetsButton = (name: string) => section("Assets").getByRole("button", { name });

    it("should sort Z-A when the Account header is clicked", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("assets:cash");
      await userEvent.click(assetsButton("Account"));
      expect(accountOrder("Assets")).toEqual(["assets:darka:etf:sxr8", "assets:cash", "assets:bank"]);
    });

    it("should sort by market value, biggest first, when the Value header is clicked", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("assets:cash");
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
      await screen.findByText("assets:cash");
      // Primary native quantities: cash=1,408.26, bank=50, darka=22.45 — a
      // plain number sort so the column reads monotonic.
      await userEvent.click(assetsButton("Holding"));
      expect(accountOrder("Assets")).toEqual(["assets:cash", "assets:bank", "assets:darka:etf:sxr8"]);
      // A second click flips to smallest first.
      await userEvent.click(assetsButton("Holding"));
      expect(accountOrder("Assets")).toEqual(["assets:darka:etf:sxr8", "assets:bank", "assets:cash"]);
    });

    it("should sort by asserted date, most recent first, with never-asserted rows last", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("assets:cash");
      await showAssertionColumns();
      await userEvent.click(assetsButton("Asserted On"));
      // bank (07-12) > cash (06-15) > darka (never asserted).
      expect(accountOrder("Assets")).toEqual(["assets:bank", "assets:cash", "assets:darka:etf:sxr8"]);
      // A second click flips: never-asserted first, then oldest.
      await userEvent.click(assetsButton("Asserted On"));
      expect(accountOrder("Assets")).toEqual(["assets:darka:etf:sxr8", "assets:cash", "assets:bank"]);
    });

    it("should sort by the asserted amount, biggest first, with never-asserted rows counting as zero", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("assets:cash");
      await showAssertionColumns();
      // Asserted quantities: cash=1,400, bank=45, darka=0 (never asserted) —
      // a plain number sort, like Holding.
      await userEvent.click(assetsButton("Asserted Amount"));
      expect(accountOrder("Assets")).toEqual(["assets:cash", "assets:bank", "assets:darka:etf:sxr8"]);
      // A second click flips to smallest first.
      await userEvent.click(assetsButton("Asserted Amount"));
      expect(accountOrder("Assets")).toEqual(["assets:darka:etf:sxr8", "assets:bank", "assets:cash"]);
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
      await screen.findByText("assets:cash");
      const liabilitiesValue = section("Liabilities").getByRole("button", { name: "Value" });
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
        baseCommodity: null,
      });
      renderView();
      await screen.findByText("assets:closed");
      // The amount-less row counts as zero and sinks below real holdings.
      await userEvent.click(assetsButton("Holding"));
      expect(accountOrder("Assets")).toEqual(["assets:wallet:big", "assets:wallet:small", "assets:closed"]);
      // The same for market value.
      await userEvent.click(assetsButton("Value"));
      expect(accountOrder("Assets")).toEqual(["assets:wallet:big", "assets:wallet:small", "assets:closed"]);
    });
  });

  describe("column explanations", () => {
    /** The inline marker inside a sort pill is a decorative hover-only span
     *  (a nested labeled widget would pollute the pill's accessible name),
     *  so it is addressed by its slot, scoped to its header pill. */
    const hoverInfo = async (label: string) => {
      const pill = section("Assets").getByRole("button", { name: label });
      await userEvent.hover(pill.querySelector("[data-slot=column-help]") as Element);
    };

    it("should explain the Holding column behind its info marker", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("assets:cash");
      await hoverInfo("Holding");
      expect(
        await screen.findByText(/What the account actually holds: cash in its own currency, shares, or crypto/),
      ).toBeInTheDocument();
    });

    it("should explain the Asserted On column, including the dash", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("assets:cash");
      await showAssertionColumns();
      await hoverInfo("Asserted On");
      expect(
        await screen.findByText(/When the ledger balance was last confirmed to match the real account balance/),
      ).toBeInTheDocument();
      expect(screen.getByText(/A dash means it was never confirmed/)).toBeInTheDocument();
      // The tooltip also teaches how to confirm one.
      expect(screen.getByText(/My cash balance is 200 EUR/)).toBeInTheDocument();
    });

    it("should explain the Asserted Amount column, including the dash", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("assets:cash");
      await showAssertionColumns();
      await hoverInfo("Asserted Amount");
      expect(
        await screen.findByText(/The ledger balance that was last confirmed to match the real account balance/),
      ).toBeInTheDocument();
      expect(screen.getByText(/A dash means it was never confirmed/)).toBeInTheDocument();
      // The same how-to line as the date column's tooltip.
      expect(screen.getByText(/My cash balance is 200 EUR/)).toBeInTheDocument();
    });

    it("should explain the Value column, including the ~ marker", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("assets:cash");
      await hoverInfo("Value");
      expect(
        await screen.findByText(
          /What the holding is worth in your main currency, at the latest price recorded in the ledger/,
        ),
      ).toBeInTheDocument();
      expect(screen.getByText(/~ means the value was converted and is an estimate/)).toBeInTheDocument();
      // The tooltip also teaches how to refresh a price.
      expect(screen.getByText(/1 USD is 0.92 EUR/)).toBeInTheDocument();
    });

    it("should give the Account column no info marker", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("assets:cash");
      const accountPill = section("Assets").getByRole("button", { name: "Account" });
      expect(accountPill.querySelector("[data-slot=column-help]")).toBeNull();
    });
  });

  describe("search", () => {
    it("should filter every section by account path, case-insensitively", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("assets:cash");
      await userEvent.type(screen.getByRole("searchbox", { name: "Search accounts" }), "CASH");
      expect(accountOrder("Assets")).toEqual(["assets:cash"]);
      // The liabilities table has no matching account.
      expect(section("Liabilities").getByText("No matching accounts")).toBeInTheDocument();
    });

    it("should show empty messages when nothing matches, and restore rows when cleared", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("assets:cash");
      const box = screen.getByRole("searchbox", { name: "Search accounts" });
      await userEvent.type(box, "zzz");
      expect(screen.getAllByText("No matching accounts")).toHaveLength(2);
      await userEvent.clear(box);
      expect(accountOrder("Assets")).toHaveLength(3);
    });
  });

  describe("column visibility", () => {
    it("should hide both assertion columns by default", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("assets:cash");
      expect(screen.queryByRole("button", { name: "Asserted On" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Asserted Amount" })).not.toBeInTheDocument();
      expect(screen.queryByText("2026-07-12")).not.toBeInTheDocument();
      expect(screen.queryByText("1,400.00 UAH")).not.toBeInTheDocument();
    });

    it("should list only the two assertion columns in the Columns menu, unchecked by default", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("assets:cash");
      await userEvent.click(screen.getByRole("button", { name: "Columns" }));
      const items = await screen.findAllByRole("menuitemcheckbox");
      // Account, Holding, and Value are the page's spine: never listed.
      expect(items.map((item) => item.textContent)).toEqual(["Asserted On", "Asserted Amount"]);
      for (const item of items) {
        expect(item).toHaveAttribute("aria-checked", "false");
      }
    });

    it("should show the assertion columns in both section tables when toggled on", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("assets:cash");
      await showAssertionColumns();
      for (const name of ["Assets", "Liabilities"]) {
        expect(section(name).getByRole("button", { name: "Asserted On" })).toBeInTheDocument();
        expect(section(name).getByRole("button", { name: "Asserted Amount" })).toBeInTheDocument();
      }
    });

    it("should persist the column choice and restore it on remount", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      const { unmount } = renderView();
      await screen.findByText("assets:cash");
      await showAssertionColumns();
      // The write is debounced (a resize drag never writes per pointer move).
      await waitFor(() =>
        expect(JSON.parse(window.localStorage.getItem("accountant24.net-worth-table") ?? "{}").visibility).toEqual({
          asserted: true,
          assertedAmount: true,
        }),
      );
      unmount();

      // A fresh mount reads the stored choice: no menu interaction needed.
      renderView();
      await screen.findByText("assets:cash");
      expect(screen.getAllByRole("button", { name: "Asserted On" })).toHaveLength(2);
      expect(screen.getByText("1,400.00 UAH")).toBeInTheDocument();
    });

    it("should reflect the persisted columns in the loading skeleton, hidden by default", async () => {
      window.localStorage.setItem(
        "accountant24.net-worth-table",
        JSON.stringify({ visibility: { asserted: true, assertedAmount: true } }),
      );
      vi.mocked(ledgerApi.netWorth).mockReturnValue(new Promise(() => {}));
      const { unmount } = renderView();
      const skeleton = screen.getByRole("status", { name: "Loading accounts" });
      expect(within(skeleton).getByText("Asserted On")).toBeInTheDocument();
      expect(within(skeleton).getByText("Asserted Amount")).toBeInTheDocument();
      unmount();

      // Without a stored choice the skeleton shows only the default columns.
      window.localStorage.clear();
      renderView();
      expect(screen.queryByText("Asserted On")).not.toBeInTheDocument();
      expect(screen.queryByText("Asserted Amount")).not.toBeInTheDocument();
    });

    it("should show only the toggled column when just one is enabled", async () => {
      window.localStorage.setItem(
        "accountant24.net-worth-table",
        JSON.stringify({ visibility: { asserted: true, assertedAmount: false } }),
      );
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("assets:cash");
      expect(screen.getAllByRole("button", { name: "Asserted On" })).toHaveLength(2);
      expect(screen.queryByRole("button", { name: "Asserted Amount" })).not.toBeInTheDocument();
      expect(screen.getByText("2026-07-12")).toBeInTheDocument();
      expect(screen.queryByText("1,400.00 UAH")).not.toBeInTheDocument();
    });

    it("should fall back to hidden columns when the stored value is garbage", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      for (const stored of ["not json", JSON.stringify({ visibility: { asserted: "yes" } }), JSON.stringify(null)]) {
        window.localStorage.setItem("accountant24.net-worth-table", stored);
        const { unmount } = renderView();
        await screen.findByText("assets:cash");
        expect(screen.queryByRole("button", { name: "Asserted On" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Asserted Amount" })).not.toBeInTheDocument();
        unmount();
      }
    });

    it("should span the empty-search row across only the visible columns", async () => {
      vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("assets:cash");
      await userEvent.type(screen.getByRole("searchbox", { name: "Search accounts" }), "zzz");
      // The three spine columns plus the grid's trailing resize-fill column.
      const emptyCell = () => screen.getAllByText("No matching accounts")[0]?.closest("td");
      expect(emptyCell()?.colSpan).toBe(4);
      // With the assertion pair on, the row widens to match.
      await showAssertionColumns();
      expect(emptyCell()?.colSpan).toBe(6);
    });
  });

  it("should show the empty state when the report has no balances", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(EMPTY);
    renderView();
    // "No transactions yet", not "no accounts": the default workspace
    // already declares accounts — transactions are what's missing.
    expect(await screen.findByText("No transactions yet")).toBeInTheDocument();
    expect(
      screen.getByText("Ask the agent to record your first transactions and your net worth will show up here"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // No rows — nothing to search either.
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("should fall back to the empty state when the report query rejects", async () => {
    vi.mocked(ledgerApi.netWorth).mockRejectedValue(new Error("bridge down"));
    renderView();
    expect(await screen.findByText("No transactions yet")).toBeInTheDocument();
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

  it("should defer the idle-edge refetch while hidden and refresh once on the next show", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
    const { rerender } = render(
      <Chrome isRunning={false}>
        <NetWorthView active={false} />
      </Chrome>,
    );
    await screen.findByText("~115.57 EUR");
    expect(ledgerApi.netWorth).toHaveBeenCalledTimes(1);

    // A whole turn passes behind the hidden page: no report query runs.
    rerender(
      <Chrome isRunning={true}>
        <NetWorthView active={false} />
      </Chrome>,
    );
    await act(async () => {});
    rerender(
      <Chrome isRunning={false}>
        <NetWorthView active={false} />
      </Chrome>,
    );
    await act(async () => {});
    expect(ledgerApi.netWorth).toHaveBeenCalledTimes(1);

    // The show pays the deferred refresh, once.
    rerender(
      <Chrome isRunning={false}>
        <NetWorthView active={true} />
      </Chrome>,
    );
    await waitFor(() => expect(ledgerApi.netWorth).toHaveBeenCalledTimes(2));
  });

  it("should not refetch on show when no turn finished while hidden", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(DATA);
    const { rerender } = render(
      <Chrome isRunning={false}>
        <NetWorthView active={false} />
      </Chrome>,
    );
    await screen.findByText("~115.57 EUR");

    rerender(
      <Chrome isRunning={false}>
        <NetWorthView active={true} />
      </Chrome>,
    );
    await act(async () => {});
    expect(ledgerApi.netWorth).toHaveBeenCalledTimes(1);
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
