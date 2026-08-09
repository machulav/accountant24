// @vitest-environment jsdom

// Spec for the Transactions view on the stock ReUI data grid with the
// data-table toolbar: title + register count, search and the Columns menu,
// and the filter chips (Date, Payee, Account, Amount, Commodity, Status,
// Tags) with Reset on their own row. The grid owns the table mechanics
// (two-state sort headers, resizing, the virtualized list, empty states);
// the page owns the search haystack (every leg searchable), the
// collapsed-row rule (lead with the legs money left from, unfold the rest
// on the grid's expander), the chat's mention pills, and the persisted
// column config. Chip filters run against the whole transaction (folded
// legs included); hiding a column takes its chip away and clears its
// filter. Data refetches on the agent's running → idle edge while the page
// is visible. jsdom pins navigator.language to en-US, so formatted
// expectations are deterministic.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// IPC boundary: the view reads the print register over the Electron bridge.
vi.mock("@/rpc/api", () => ({
  ledgerApi: { transactions: vi.fn() },
}));

import { AssistantRuntimeProvider, type ExternalStoreAdapter, useExternalStoreRuntime } from "@assistant-ui/react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { ledgerApi } from "@/rpc/api";
import type { LedgerAmount, LedgerTransaction } from "@/rpc/types";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { TRANSACTIONS_TABLE_KEY } from "../transactions-columns";
import { TransactionsView } from "../transactions-view";

beforeAll(() => {
  installJsdomPolyfills();
  // Base UI menus/popovers track pointer capture on open.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(() => cleanup());
beforeEach(() => {
  vi.mocked(ledgerApi.transactions).mockReset();
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

const T = (over: Partial<LedgerTransaction> & { index: number }): LedgerTransaction => ({
  date: "2026-01-01",
  payee: "Payee",
  note: "",
  status: "Cleared",
  tags: [],
  postings: [{ account: "expenses:misc", amounts: [A("EUR", 1)] }],
  ...over,
});

// Six transactions the way the parser hands them over: journal order, a
// multi-currency exchange (leads with its source leg, the receiving leg
// folds), a payee|note pair, tags, a pending entry, and a same-date payee
// tie (Cafe Aroma before Bookshop in the journal, so the default payee
// tiebreak must reorder them).
const DATA: LedgerTransaction[] = [
  T({
    index: 1,
    date: "2026-01-20",
    payee: "Employer",
    note: "January salary",
    postings: [
      { account: "assets:bank:checking", amounts: [A("EUR", 3000)] },
      { account: "income:salary", amounts: [A("EUR", -3000)] },
    ],
  }),
  T({
    index: 2,
    date: "2026-02-05",
    payee: "Landlord",
    note: "February rent",
    tags: [{ name: "category", value: "housing" }],
    postings: [
      { account: "expenses:housing:rent", amounts: [A("EUR", 900)] },
      { account: "assets:bank:checking", amounts: [A("EUR", -900)] },
    ],
  }),
  T({
    index: 3,
    date: "2026-02-14",
    payee: "Currency Exchange",
    postings: [
      { account: "assets:cash:uah", amounts: [A("UAH", 2050)] },
      { account: "assets:cash:usd", amounts: [A("USD", -50)] },
    ],
  }),
  T({
    index: 4,
    date: "2026-03-10",
    payee: "Grocery Store",
    note: "weekly shop",
    tags: [{ name: "category", value: "groceries" }],
    postings: [
      { account: "expenses:food", amounts: [A("EUR", 12.5)] },
      { account: "assets:cash", amounts: [A("EUR", -12.5)] },
    ],
  }),
  T({
    index: 5,
    date: "2026-03-14",
    payee: "Cafe Aroma",
    postings: [
      { account: "expenses:food:coffee", amounts: [A("EUR", 4)] },
      { account: "assets:cash", amounts: [A("EUR", -4)] },
    ],
  }),
  T({
    index: 6,
    date: "2026-03-14",
    payee: "Bookshop",
    status: "Pending",
    postings: [
      { account: "expenses:leisure:books", amounts: [A("EUR", 18)] },
      { account: "liabilities:card", amounts: [A("EUR", -18)] },
    ],
  }),
];

/** Fixed calendar anchor for the Date chip's presets: 2026-03-20, so This
 *  month = March, Last month = February. */
const NOW = new Date(2026, 2, 20);

const renderView = (isRunning = false) =>
  render(
    <Chrome isRunning={isRunning}>
      <TransactionsView now={NOW} />
    </Chrome>,
  );

/** The rendered row order: each body row's payee pill text (rows without a
 *  payee pill — the header and unfolded-legs rows — are skipped). */
const rowOrder = () =>
  screen
    .getAllByRole("row")
    .map((row) => row.querySelector("[data-directive-type=payee]")?.textContent)
    .filter((payee): payee is string => typeof payee === "string");

/** The <tr> whose payee pill carries the given text. */
const rowOf = (payee: string) => screen.getByText(payee).closest("tr") as HTMLElement;

/** Queries scoped to the grid table (toolbar chips share accessible names
 *  with column headers). */
const grid = () => within(screen.getByRole("table"));

/** A toolbar filter chip (a multi-select combobox trigger). */
const chip = (name: string) => screen.getByRole("combobox", { name });

/** A column's plain click-to-sort header button (two states: a click flips
 *  between ascending and descending, never "unsorted"). */
const headerButton = (name: string) => grid().getByRole("button", { name });

/** Turn on one of the opt-in columns through the Columns menu, then close it. */
const showColumn = async (label: string) => {
  await userEvent.click(screen.getByRole("button", { name: "Columns" }));
  await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: label }));
  await userEvent.keyboard("{Escape}");
};

describe("<TransactionsView />", () => {
  it("should show the toolbar and column labels while the register loads", () => {
    vi.mocked(ledgerApi.transactions).mockReturnValue(new Promise(() => {}));
    renderView();
    // Everything that needs no data is up before the register arrives: the
    // title and the full toolbar (search, chips, Sort, View).
    expect(screen.getByRole("heading", { level: 1, name: "Transactions" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search transactions" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Payee" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Account" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Date" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Amount" }).length).toBeGreaterThan(0);
    // Commodity has no column of its own; its chip rides with Amount.
    expect(screen.getByRole("combobox", { name: "Commodity" })).toBeInTheDocument();
    // Chips follow their columns: the hidden-by-default pair has no chip.
    expect(screen.queryByRole("combobox", { name: "Status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Tags" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Columns" })).toBeInTheDocument();
    // But no figures yet — the grid shows shaped loading skeletons instead,
    // and the title's counter waits for the register.
    expect(screen.queryByText(/EUR/)).not.toBeInTheDocument();
    expect(screen.queryByText("6")).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-slot=skeleton]").length).toBeGreaterThan(0);
    // The count chip has its own skeleton next to the title.
    const heading = screen.getByRole("heading", { level: 1, name: "Transactions" });
    expect(heading.parentElement?.querySelector("[data-slot=skeleton]")).toBeInTheDocument();
  });

  it("should render only the default columns, sorted date-descending with payee A-Z ties", async () => {
    vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
    renderView();
    await screen.findByText("Bookshop");
    // Default-visible columns only (scoped to the table: the toolbar chips
    // carry the same names).
    expect(grid().getByRole("button", { name: "Date" })).toBeInTheDocument();
    expect(grid().getByRole("button", { name: "Payee" })).toBeInTheDocument();
    expect(grid().getByRole("button", { name: "Account" })).toBeInTheDocument();
    expect(grid().getByRole("button", { name: "Amount" })).toBeInTheDocument();
    expect(grid().queryByRole("button", { name: "Comment" })).not.toBeInTheDocument();
    expect(grid().queryByRole("button", { name: "Tags" })).not.toBeInTheDocument();
    expect(grid().queryByRole("button", { name: "Status" })).not.toBeInTheDocument();
    // The title carries the register count.
    expect(screen.getByText("6")).toBeInTheDocument();
    // 2026-03-14 is a date tie: Bookshop beats Cafe Aroma alphabetically
    // even though the journal has them the other way around.
    expect(rowOrder()).toEqual([
      "Bookshop",
      "Cafe Aroma",
      "Grocery Store",
      "Currency Exchange",
      "Landlord",
      "Employer",
    ]);
    // The journal's own ISO dates, verbatim.
    expect(screen.getAllByText("2026-03-14")).toHaveLength(2);
  });

  it("should render payees, accounts, and tags as the chat's mention pills", async () => {
    window.localStorage.setItem(TRANSACTIONS_TABLE_KEY, JSON.stringify({ visibility: { tags: true } }));
    vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
    renderView();
    await screen.findByText("Grocery Store");
    expect(screen.getByText("Grocery Store").closest("[data-directive-type=payee]")).toBeInTheDocument();
    expect(screen.getByText("assets:cash:usd").closest("[data-directive-type=account]")).toBeInTheDocument();
    expect(screen.getByText("category: groceries").closest("[data-directive-type=tag]")).toBeInTheDocument();
  });

  describe("collapsed and unfolded legs", () => {
    it("should lead with the legs money left from and hide the rest", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Grocery Store");
      // The groceries payment shows its cash leg only (Cafe Aroma shares
      // the account, hence two pills).
      expect(screen.getAllByText("assets:cash")).toHaveLength(2);
      expect(screen.getByText("-12.50 EUR")).toBeInTheDocument();
      expect(screen.queryByText("expenses:food")).not.toBeInTheDocument();
      expect(screen.queryByText("12.50 EUR")).not.toBeInTheDocument();
      // The salary shows the bank leg, not income:salary.
      expect(screen.getByText("3,000.00 EUR")).toBeInTheDocument();
      expect(screen.queryByText("income:salary")).not.toBeInTheDocument();
      // A transfer between real accounts leads with its source leg only;
      // the receiving leg folds like an expense leg.
      expect(screen.getByText("assets:cash:usd")).toBeInTheDocument();
      expect(screen.getByText("-50.00 USD")).toBeInTheDocument();
      expect(screen.queryByText("assets:cash:uah")).not.toBeInTheDocument();
      expect(screen.queryByText("2,050.00 UAH")).not.toBeInTheDocument();
    });

    it("should unfold the hidden legs on the expander click and fold them back", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Grocery Store");
      await userEvent.click(within(rowOf("Grocery Store")).getByRole("button", { name: "Expand row" }));
      expect(screen.getByText("expenses:food")).toBeInTheDocument();
      expect(screen.getByText("12.50 EUR")).toBeInTheDocument();
      // Only this row unfolded.
      expect(screen.queryByText("income:salary")).not.toBeInTheDocument();
      await userEvent.click(within(rowOf("Grocery Store")).getByRole("button", { name: "Collapse row" }));
      expect(screen.queryByText("expenses:food")).not.toBeInTheDocument();
    });

    it("should unfold the receiving leg of a transfer", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Currency Exchange");
      await userEvent.click(within(rowOf("Currency Exchange")).getByRole("button", { name: "Expand row" }));
      expect(screen.getByText("assets:cash:uah")).toBeInTheDocument();
      expect(screen.getByText("2,050.00 UAH")).toBeInTheDocument();
    });

    it("should give no expander to a transaction with nothing hidden", async () => {
      // A single-leg entry shows everything it has.
      vi.mocked(ledgerApi.transactions).mockResolvedValue([T({ index: 1, payee: "Solo" })]);
      renderView();
      await screen.findByText("Solo");
      expect(within(rowOf("Solo")).queryByRole("button", { name: "Expand row" })).toBeNull();
    });
  });

  describe("sorting via the header buttons", () => {
    it("should flip a header click between ascending and descending, never unsorted", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      const alphabetical = ["Bookshop", "Cafe Aroma", "Currency Exchange", "Employer", "Grocery Store", "Landlord"];
      await userEvent.click(headerButton("Payee"));
      expect(rowOrder()).toEqual(alphabetical);
      await userEvent.click(headerButton("Payee"));
      expect(rowOrder()).toEqual([...alphabetical].reverse());
      // The third click flips back to ascending — two states, no
      // "unsorted" stop (matching the Net Worth tables).
      await userEvent.click(headerButton("Payee"));
      expect(rowOrder()).toEqual(alphabetical);
    });

    it("should restore newest-first with payee ties when Date is sorted descending again", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      await userEvent.click(headerButton("Payee"));
      await userEvent.click(headerButton("Date"));
      await userEvent.click(headerButton("Date"));
      // The date sort always carries its payee tiebreak: the 03-14 tie
      // reads A-Z again, exactly like the default view.
      expect(rowOrder()).toEqual([
        "Bookshop",
        "Cafe Aroma",
        "Grocery Store",
        "Currency Exchange",
        "Landlord",
        "Employer",
      ]);
    });

    it("should sort by the shown account path, journal order breaking ties", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      await userEvent.click(headerButton("Account"));
      // assets:bank:checking (Employer 1, Landlord 2 in journal order),
      // assets:cash (Grocery 4, Cafe 5), assets:cash:usd (the exchange's
      // source leg), liabilities:card.
      expect(rowOrder()).toEqual([
        "Employer",
        "Landlord",
        "Grocery Store",
        "Cafe Aroma",
        "Currency Exchange",
        "Bookshop",
      ]);
    });

    it("should sort by the signed shown amount through the stock header cycle", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      // Ascending by the signed leading amount: the -900 rent is the
      // smallest, the 3000 salary inflow the biggest.
      await userEvent.click(headerButton("Amount"));
      expect(rowOrder()).toEqual([
        "Landlord",
        "Currency Exchange",
        "Bookshop",
        "Grocery Store",
        "Cafe Aroma",
        "Employer",
      ]);
      // The second click reverses to biggest first.
      await userEvent.click(headerButton("Amount"));
      expect(rowOrder()).toEqual([
        "Employer",
        "Cafe Aroma",
        "Grocery Store",
        "Bookshop",
        "Currency Exchange",
        "Landlord",
      ]);
    });

    it("should sort by comment text once the Comment column is shown", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      await showColumn("Comment");

      await userEvent.click(headerButton("Comment"));
      // A-Z on the comment ("February rent" < "January salary" < "weekly
      // shop"), the comment-less entries first (empty sorts before any text).
      expect(rowOrder().slice(-3)).toEqual(["Landlord", "Employer", "Grocery Store"]);

      await userEvent.click(headerButton("Comment"));
      expect(rowOrder().slice(0, 3)).toEqual(["Grocery Store", "Employer", "Landlord"]);
    });

    it("should sort by the tag pills' text once the Tags column is shown", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      await showColumn("Tags");

      // "category: groceries" before "category: housing"; the untagged rows
      // sort as empty text.
      await userEvent.click(headerButton("Tags"));
      expect(rowOrder().slice(-2)).toEqual(["Grocery Store", "Landlord"]);

      await userEvent.click(headerButton("Tags"));
      expect(rowOrder().slice(0, 2)).toEqual(["Landlord", "Grocery Store"]);
    });
  });

  describe("Columns menu", () => {
    it("should toggle Tags and Status on without reopening, and persist the choice", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      await userEvent.click(screen.getByRole("button", { name: "Columns" }));
      // The chrome-only expander and the filter-only commodity column are
      // not offered; the seven data columns are.
      expect(await screen.findAllByRole("menuitemcheckbox")).toHaveLength(7);
      // Two toggles in one visit: the menu must stay open between them.
      await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Tags" }));
      await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Status" }));
      expect(grid().getByRole("button", { name: "Tags" })).toBeInTheDocument();
      expect(grid().getByRole("button", { name: "Status" })).toBeInTheDocument();
      // Tag pills and status words render for the rows that carry them.
      expect(screen.getByText("category: groceries")).toBeInTheDocument();
      expect(screen.getByText("Pending")).toBeInTheDocument();
      // The choice is persisted for the next mount (debounced, so a resize
      // drag never writes to disk per pointer move).
      await waitFor(() =>
        expect(JSON.parse(window.localStorage.getItem(TRANSACTIONS_TABLE_KEY) ?? "{}").visibility).toEqual({
          date: true,
          payee: true,
          note: false,
          account: true,
          amount: true,
          tags: true,
          status: true,
        }),
      );
    });

    it("should restore the persisted column visibility on mount", async () => {
      window.localStorage.setItem(TRANSACTIONS_TABLE_KEY, JSON.stringify({ visibility: { note: true, payee: false } }));
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("weekly shop");
      expect(grid().getByRole("button", { name: "Comment" })).toBeInTheDocument();
      expect(grid().queryByRole("button", { name: "Payee" })).not.toBeInTheDocument();
    });
  });

  describe("search", () => {
    it("should match payee, comment, any leg's account (hidden included), and tag text, case-insensitively", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      const box = screen.getByRole("searchbox", { name: "Search transactions" });
      await userEvent.type(box, "AROMA");
      expect(rowOrder()).toEqual(["Cafe Aroma"]);
      await userEvent.clear(box);
      await userEvent.type(box, "january salary");
      expect(rowOrder()).toEqual(["Employer"]);
      await userEvent.clear(box);
      // A categorization leg, folded away — still searchable.
      await userEvent.type(box, "income:salary");
      expect(rowOrder()).toEqual(["Employer"]);
      await userEvent.clear(box);
      await userEvent.type(box, "liabilities:card");
      expect(rowOrder()).toEqual(["Bookshop"]);
      await userEvent.clear(box);
      await userEvent.type(box, "category: groceries");
      expect(rowOrder()).toEqual(["Grocery Store"]);
    });

    it("should show the stock no-match message and restore rows when cleared", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      const box = screen.getByRole("searchbox", { name: "Search transactions" });
      await userEvent.type(box, "zzz");
      expect(screen.getByText("No matching transactions")).toBeInTheDocument();
      await userEvent.clear(box);
      expect(rowOrder()).toHaveLength(6);
    });

    it("should restore all rows from the search field's clear X", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      const box = screen.getByRole("searchbox", { name: "Search transactions" });
      await userEvent.type(box, "aroma");
      expect(rowOrder()).toEqual(["Cafe Aroma"]);
      await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
      expect(box).toHaveValue("");
      expect(rowOrder()).toHaveLength(6);
    });

    it("should narrow a filter chip's options from its popup search, and clear from its X", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      await userEvent.click(chip("Account"));
      const box = await screen.findByRole("combobox", { name: "Search accounts" });
      await userEvent.type(box, "cash");
      expect(await screen.findByRole("option", { name: /^assets:cash(?!:)/ })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /^income:salary/ })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
      expect(box).toHaveValue("");
      expect(await screen.findByRole("option", { name: /^income:salary/ })).toBeInTheDocument();
    });

    it("should keep the popup search after a pick, so one search serves several picks", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      await userEvent.click(chip("Account"));
      const box = await screen.findByRole("combobox", { name: "Search accounts" });
      await userEvent.type(box, "cash");
      await userEvent.click(await screen.findByRole("option", { name: /^assets:cash(?!:)/ }));
      // The query survives the pick: the narrowed list is still up and a
      // second result of the same search is one click away.
      expect(box).toHaveValue("cash");
      await userEvent.click(await screen.findByRole("option", { name: /^assets:cash:uah/ }));
      expect(rowOrder()).toEqual(["Cafe Aroma", "Grocery Store", "Currency Exchange"]);
    });
  });

  describe("filter chips", () => {
    it("should narrow to transactions touching the picked account, folded legs included", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      await userEvent.click(chip("Account"));
      // Option rows carry their any-leg match counts in the name.
      await userEvent.click(await screen.findByRole("option", { name: /^assets:cash(?!:)/ }));
      // Both cash payments — the exact account only, not assets:cash:uah.
      expect(rowOrder()).toEqual(["Cafe Aroma", "Grocery Store"]);
      // A folded categorization leg counts too; the popup stays open for
      // multi-select.
      await userEvent.click(screen.getByRole("option", { name: /^income:salary/ }));
      expect(rowOrder()).toEqual(["Cafe Aroma", "Grocery Store", "Employer"]);
      // The Clear filters action inside the popover resets.
      await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
      expect(rowOrder()).toHaveLength(6);
    });

    it("should filter by status once its column is shown, and Reset clears", async () => {
      window.localStorage.setItem(TRANSACTIONS_TABLE_KEY, JSON.stringify({ visibility: { status: true } }));
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      await userEvent.click(chip("Status"));
      // Only statuses the journal uses are offered: no dead Unmarked option.
      await screen.findByRole("option", { name: /^Pending/ });
      expect(screen.queryByRole("option", { name: /^Unmarked/ })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("option", { name: /^Pending/ }));
      expect(rowOrder()).toEqual(["Bookshop"]);
      // The title's counter switches to filter feedback.
      expect(screen.getByText("1 of 6")).toBeInTheDocument();
      // The toolbar Reset appears once a filter is active and clears it.
      await userEvent.click(screen.getByRole("button", { name: "Reset" }));
      expect(rowOrder()).toHaveLength(6);
      expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
      expect(screen.getByText("6")).toBeInTheDocument();
    });

    it("should filter by tag name, values aside — one option per name", async () => {
      window.localStorage.setItem(TRANSACTIONS_TABLE_KEY, JSON.stringify({ visibility: { tags: true } }));
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      await userEvent.click(chip("Tags"));
      // Both category tags (housing, groceries values) fold into one name.
      expect(await screen.findAllByRole("option")).toHaveLength(1);
      await userEvent.click(screen.getByRole("option", { name: /^category/ }));
      expect(rowOrder()).toEqual(["Grocery Store", "Landlord"]);
    });

    it("should filter by picked payees, multi-select, skipping payee-less entries in the options", async () => {
      // A payee-less transfer: legal in the journal, pointless as an option.
      vi.mocked(ledgerApi.transactions).mockResolvedValue([
        ...DATA,
        T({
          index: 7,
          date: "2026-03-15",
          payee: "",
          postings: [
            { account: "assets:cash", amounts: [A("EUR", 50)] },
            { account: "assets:bank:checking", amounts: [A("EUR", -50)] },
          ],
        }),
      ]);
      renderView();
      await screen.findByText("Bookshop");
      await userEvent.click(chip("Payee"));
      expect(await screen.findByRole("option", { name: /^Cafe Aroma/ })).toBeInTheDocument();
      // 6 payees from the fixture; no option for the payee-less transfer.
      expect(screen.getAllByRole("option")).toHaveLength(6);
      await userEvent.click(screen.getByRole("option", { name: /^Cafe Aroma/ }));
      expect(rowOrder()).toEqual(["Cafe Aroma"]);
      await userEvent.click(screen.getByRole("option", { name: /^Employer/ }));
      expect(rowOrder()).toEqual(["Cafe Aroma", "Employer"]);
    });

    it("should drop a chip with its hidden column and clear that filter", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      await userEvent.click(chip("Payee"));
      await userEvent.click(await screen.findByRole("option", { name: /^Cafe Aroma/ }));
      expect(rowOrder()).toEqual(["Cafe Aroma"]);
      await userEvent.keyboard("{Escape}");
      // Hiding the Payee column takes the chip away and un-filters the rows
      // (nothing may keep filtering invisibly).
      await userEvent.click(screen.getByRole("button", { name: "Columns" }));
      await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Payee" }));
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("combobox", { name: "Payee" })).not.toBeInTheDocument();
      expect(screen.getAllByRole("row").length).toBeGreaterThan(6);
      expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
    });

    it("should take the Commodity chip away with the Amount column, clearing its filter", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      await userEvent.click(chip("Commodity"));
      await userEvent.click(await screen.findByRole("option", { name: /^USD/ }));
      expect(rowOrder()).toEqual(["Currency Exchange"]);
      await userEvent.keyboard("{Escape}");
      await userEvent.click(screen.getByRole("button", { name: "Columns" }));
      await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Amount" }));
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("combobox", { name: "Commodity" })).not.toBeInTheDocument();
      expect(screen.queryAllByRole("button", { name: "Amount" })).toHaveLength(0);
      // The commodity filter cleared with it — nothing filters invisibly.
      expect(rowOrder()).toHaveLength(6);
    });

    it("should filter by the Date chip's presets and inclusive custom bounds", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      await userEvent.click(screen.getAllByRole("button", { name: "Date" })[0] as HTMLElement);
      await userEvent.click(await screen.findByRole("button", { name: "This month" }));
      expect(rowOrder()).toEqual(["Bookshop", "Cafe Aroma", "Grocery Store"]);
      // Both bounds on the same day keep that day's row: inclusive ends.
      fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-03-10" } });
      fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-03-10" } });
      expect(rowOrder()).toEqual(["Grocery Store"]);
      await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
      expect(rowOrder()).toHaveLength(6);
    });

    it("should filter by commodity, matching any leg, options carrying counts", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      await userEvent.click(chip("Commodity"));
      // Distinct commodities with any-leg counts: EUR everywhere but the
      // exchange, whose two legs carry UAH and USD.
      expect(within(await screen.findByRole("option", { name: /^EUR/ })).getByText("5")).toBeInTheDocument();
      expect(within(screen.getByRole("option", { name: /^UAH/ })).getByText("1")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("option", { name: /^USD/ }));
      expect(rowOrder()).toEqual(["Currency Exchange"]);
      // The UAH leg of the same exchange: multi-select stays one row, not two.
      await userEvent.click(screen.getByRole("option", { name: /^UAH/ }));
      expect(rowOrder()).toEqual(["Currency Exchange"]);
    });

    it("should filter by the Amount chip's inclusive absolute bounds, badge reflecting the open side", async () => {
      // Shown-leg absolute amounts in the fixture: 3000 (Employer, an
      // inflow), 900 (Landlord), 50 (Currency Exchange), 18 (Bookshop),
      // 12.50 (Grocery Store), 4 (Cafe Aroma).
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      await userEvent.click(screen.getAllByRole("button", { name: "Amount" })[0] as HTMLElement);
      fireEvent.change(await screen.findByLabelText("Minimum amount"), { target: { value: "100" } });
      // Sign-blind: the 3000 income matches alongside the 900 expense.
      expect(rowOrder()).toEqual(["Landlord", "Employer"]);
      expect(screen.getByText("≥ 100")).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Maximum amount"), { target: { value: "1000" } });
      expect(rowOrder()).toEqual(["Landlord"]);
      expect(screen.getByText("100 - 1000")).toBeInTheDocument();
      // Emptying Min leaves an open lower bound.
      fireEvent.change(screen.getByLabelText("Minimum amount"), { target: { value: "" } });
      expect(screen.getByText("≤ 1000")).toBeInTheDocument();
      expect(rowOrder()).toEqual(["Bookshop", "Cafe Aroma", "Grocery Store", "Currency Exchange", "Landlord"]);
      await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
      expect(rowOrder()).toHaveLength(6);
    });

    it("should show an open-ended Date badge for a From-only bound, and turn off when it clears", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      await userEvent.click(screen.getAllByRole("button", { name: "Date" })[0] as HTMLElement);
      // Half-typed input never filters; the bound applies once it is a full
      // ISO date, matching the Date column's format.
      fireEvent.change(await screen.findByLabelText("From date"), { target: { value: "2026-0" } });
      expect(rowOrder()).toHaveLength(6);
      // Neither does an impossible date that matches the shape: committing
      // 2026-13-45 would silently empty the table.
      fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-13-45" } });
      expect(rowOrder()).toHaveLength(6);
      fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-03-01" } });
      // One bound filters on its own; the badge spells the open end out.
      expect(rowOrder()).toEqual(["Bookshop", "Cafe Aroma", "Grocery Store"]);
      expect(screen.getByText("2026-03-01 - now")).toBeInTheDocument();
      // Emptying the last bound turns the filter fully off: badge and Reset gone.
      fireEvent.change(screen.getByLabelText("From date"), { target: { value: "" } });
      expect(rowOrder()).toHaveLength(6);
      expect(screen.queryByText(/ - now$/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
    });

    it("should collapse the chip's value badges to a count when more than two are picked", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      await userEvent.click(chip("Account"));
      await userEvent.click(await screen.findByRole("option", { name: /^assets:cash(?!:)/ }));
      await userEvent.click(screen.getByRole("option", { name: /^income:salary/ }));
      // Two picks: each shows as its own badge on the chip.
      expect(within(chip("Account")).getByText("assets:cash")).toBeInTheDocument();
      expect(within(chip("Account")).getByText("income:salary")).toBeInTheDocument();
      // The third pick collapses them into one count badge.
      await userEvent.click(screen.getByRole("option", { name: /^liabilities:card/ }));
      expect(within(chip("Account")).getByText("3 selected")).toBeInTheDocument();
      expect(within(chip("Account")).queryByText("assets:cash")).not.toBeInTheDocument();
    });
  });

  describe("sparse register entries", () => {
    // A transfer written without a payee and with a bare (valueless) tag —
    // both legal journal shapes the register must render, not hide.
    const SPARSE: LedgerTransaction[] = [
      T({
        index: 1,
        date: "2026-01-05",
        payee: "",
        tags: [{ name: "trip", value: "" }],
        postings: [
          { account: "assets:cash", amounts: [A("EUR", 100)] },
          { account: "assets:bank:checking", amounts: [A("EUR", -100)] },
        ],
      }),
    ];

    it("should render a payee-less transaction with an empty Payee cell, no pill", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(SPARSE);
      renderView();
      await screen.findByText("2026-01-05");
      expect(document.querySelector("[data-directive-type=payee]")).not.toBeInTheDocument();
    });

    it("should render a bare tag as a pill with the tag name alone", async () => {
      window.localStorage.setItem(TRANSACTIONS_TABLE_KEY, JSON.stringify({ visibility: { tags: true } }));
      vi.mocked(ledgerApi.transactions).mockResolvedValue(SPARSE);
      renderView();
      await screen.findByText("2026-01-05");
      expect(screen.getByText("trip").closest("[data-directive-type=tag]")).toBeInTheDocument();
    });
  });

  describe("virtual scroll", () => {
    const MANY = Array.from({ length: 205 }, (_, i) =>
      T({ index: i + 1, payee: `Payee ${String(i + 1).padStart(3, "0")}` }),
    );

    it("should keep a short register fully rendered, with no pagination chrome", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
      renderView();
      await screen.findByText("Bookshop");
      expect(rowOrder()).toHaveLength(6);
      expect(screen.queryByText(/Rows per page/)).not.toBeInTheDocument();
    });

    it("should hand a long register to the virtualized scroll instead of pages", async () => {
      vi.mocked(ledgerApi.transactions).mockResolvedValue(MANY);
      renderView();
      // Loading settles (skeletons gone) without any empty state: the 205
      // rows are in the list, windowed by the virtualizer. jsdom reports a
      // zero-height viewport, so the rendered window itself can't be
      // asserted here — the e2e smoke covers real scrolling.
      await waitFor(() => expect(document.querySelectorAll("[data-slot=skeleton]").length).toBe(0));
      expect(screen.queryByText("No matching transactions")).not.toBeInTheDocument();
      expect(screen.queryByText(/Rows per page/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Go to next page" })).not.toBeInTheDocument();
    });
  });

  it("should show the dedicated empty view when the journal has no transactions", async () => {
    vi.mocked(ledgerApi.transactions).mockResolvedValue([]);
    renderView();
    expect(await screen.findByText("No transactions yet")).toBeInTheDocument();
    expect(
      screen.getByText("Ask the agent to record your first transactions and they will show up here"),
    ).toBeInTheDocument();
  });

  it("should hide the toolbar, the grid, and the count while the register is empty", async () => {
    // Nothing to search, filter, sort, or count: the table chrome steps
    // aside for the empty view, and the title carries no "0" (the empty
    // view's title already says so).
    vi.mocked(ledgerApi.transactions).mockResolvedValue([]);
    renderView();
    await screen.findByText("No transactions yet");
    expect(screen.queryByRole("searchbox", { name: "Search transactions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Columns" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Payee" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("should replace the empty view with the register once a refetch returns rows", async () => {
    // The first transaction usually lands mid-session (the agent records
    // it): the running -> idle refetch must swap the empty view for the
    // full page, chrome and all.
    vi.mocked(ledgerApi.transactions).mockResolvedValueOnce([]).mockResolvedValueOnce(DATA);
    const { rerender } = renderView(false);
    await screen.findByText("No transactions yet");

    rerender(
      <Chrome isRunning={true}>
        <TransactionsView now={NOW} />
      </Chrome>,
    );
    await act(async () => {});
    rerender(
      <Chrome isRunning={false}>
        <TransactionsView now={NOW} />
      </Chrome>,
    );

    await screen.findByText("Bookshop");
    expect(screen.queryByText("No transactions yet")).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search transactions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Columns" })).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("should show the unreadable-journal view, not the empty state, when the register query rejects", async () => {
    // The main process rejects when the journal exists but hledger fails
    // (e.g. a syntax error, or output past the stdout cap): an unreadable
    // journal must never read as "no transactions yet".
    vi.mocked(ledgerApi.transactions).mockRejectedValue(new Error("register query failed"));
    renderView();
    expect(await screen.findByText("The journal could not be read")).toBeInTheDocument();
    expect(screen.getByText("Ask the agent to check the journal")).toBeInTheDocument();
    expect(screen.queryByText(/No transactions yet/)).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("should refetch the register when the agent goes from running to idle", async () => {
    vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
    const { rerender } = renderView(false);
    await screen.findByText("Bookshop");
    expect(ledgerApi.transactions).toHaveBeenCalledTimes(1);

    rerender(
      <Chrome isRunning={true}>
        <TransactionsView now={NOW} />
      </Chrome>,
    );
    // Flush the runtime's async store propagation before asserting no refetch
    // happened on the idle → running edge.
    await act(async () => {});
    expect(ledgerApi.transactions).toHaveBeenCalledTimes(1);

    rerender(
      <Chrome isRunning={false}>
        <TransactionsView now={NOW} />
      </Chrome>,
    );
    await waitFor(() => expect(ledgerApi.transactions).toHaveBeenCalledTimes(2));
  });

  it("should defer the idle-edge refetch while hidden and refresh once on the next show", async () => {
    vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
    const { rerender } = render(
      <Chrome isRunning={false}>
        <TransactionsView now={NOW} active={false} />
      </Chrome>,
    );
    await screen.findByText("Bookshop");
    expect(ledgerApi.transactions).toHaveBeenCalledTimes(1);

    // A whole turn passes behind the hidden page: no register query runs.
    rerender(
      <Chrome isRunning={true}>
        <TransactionsView now={NOW} active={false} />
      </Chrome>,
    );
    await act(async () => {});
    rerender(
      <Chrome isRunning={false}>
        <TransactionsView now={NOW} active={false} />
      </Chrome>,
    );
    await act(async () => {});
    expect(ledgerApi.transactions).toHaveBeenCalledTimes(1);

    // The show pays the deferred refresh, once.
    rerender(
      <Chrome isRunning={false}>
        <TransactionsView now={NOW} active={true} />
      </Chrome>,
    );
    await waitFor(() => expect(ledgerApi.transactions).toHaveBeenCalledTimes(2));
  });

  it("should not refetch on show when no turn finished while hidden", async () => {
    vi.mocked(ledgerApi.transactions).mockResolvedValue(DATA);
    const { rerender } = render(
      <Chrome isRunning={false}>
        <TransactionsView now={NOW} active={false} />
      </Chrome>,
    );
    await screen.findByText("Bookshop");

    rerender(
      <Chrome isRunning={false}>
        <TransactionsView now={NOW} active={true} />
      </Chrome>,
    );
    await act(async () => {});
    expect(ledgerApi.transactions).toHaveBeenCalledTimes(1);
  });

  it("should keep the current rows visible while a refetch is in flight", async () => {
    vi.mocked(ledgerApi.transactions)
      .mockResolvedValueOnce(DATA)
      .mockReturnValue(new Promise(() => {}));
    const { rerender } = renderView(false);
    await screen.findByText("Bookshop");

    rerender(
      <Chrome isRunning={true}>
        <TransactionsView now={NOW} />
      </Chrome>,
    );
    await act(async () => {});
    rerender(
      <Chrome isRunning={false}>
        <TransactionsView now={NOW} />
      </Chrome>,
    );
    // Once the refetch is genuinely in flight (its promise never resolves),
    // the previous rows must still be up.
    await waitFor(() => expect(ledgerApi.transactions).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Bookshop")).toBeInTheDocument();
  });
});
