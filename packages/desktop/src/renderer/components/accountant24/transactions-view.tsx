"use client";

// Full-page Transactions view: the `hledger print` register on the ReUI
// data grid (TanStack v9), used stock. The grid owns the table mechanics:
// column header menus (sort, hide) and resizable columns (persisted with
// visibility in localStorage), the
// faceted filter chips, loading skeletons, empty states, and pagination.
// The toolbar mirrors the classic data-table bar: search + filter chips
// (Date, Payee, Account, Amount, Status, Tags) with a Reset on the left,
// View on the right; sorting lives in the column headers alone. The page
// adds what the grid cannot know: the search haystack (every leg of every
// transaction),
// the collapsed-row rule (lead with the legs money left from, unfold the
// rest YNAB-style via the grid's expander), and the chat's mention pills.
// Data refreshes when the agent finishes a turn.

import type { Column, ColumnDef, ExpandedState, SortingState } from "@tanstack/react-table";
import { useTable } from "@tanstack/react-table";
import { CalendarIcon, CircleCheckIcon, CoinsIcon, DollarSignIcon, XIcon } from "lucide-react";
import { type FC, useMemo, useState } from "react";
import { ColumnsMenu } from "@/components/accountant24/columns-menu";
import { FilterChip } from "@/components/accountant24/filter-chip";
import { MentionPill } from "@/components/accountant24/mentions";
import {
  DataGrid,
  DataGridContainer,
  type DataGridFeatures,
  dataGridFeatures,
  useDataGrid,
} from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable, DataGridTableRowExpand } from "@/components/reui/data-grid/data-grid-table";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { Input } from "@/components/shadcn/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { Skeleton } from "@/components/shadcn/skeleton";
import { formatAmounts } from "@/lib/amountFormat";
import { type DateRange, type DateRangePreset, inRange, PRESET_LABELS, presetRange } from "@/lib/dateRange";
import { splitPostings } from "@/lib/postings";
import { cn } from "@/lib/utils";
import type { LedgerPosting, LedgerTransaction } from "@/rpc/types";
import { POPOVER_WIDTH } from "./popover";
import { SearchField } from "./search-field";
import { loadTableConfig, saveTableConfig, type TransactionsTableConfig } from "./transactions-columns";
import { useTransactions } from "./use-transactions";

/** The tag pill's text, also what search and the Tags sort key see. */
const tagText = (tag: { name: string; value: string }): string => (tag.value ? `${tag.name}: ${tag.value}` : tag.name);

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One posting line inside a cell: a fixed-height line box so the Account
 *  pills and the Amount figures line up row by row across the two columns. */
const LINE = "flex h-6 items-center";

const postingAmount = (posting: LedgerPosting): string => formatAmounts(posting.amounts, "native", navigator.language);

/** The unfolded legs of a row: the categorization side (and a transfer's
 *  receiving side), rendered by the grid's expandedContent slot. Each leg
 *  lays out under the live columns — account under Account, amount under
 *  Amount — by mirroring the grid's own `--col-<id>-size` width variables
 *  (they track resizes without re-renders) and the dense cell padding, so
 *  the unfolded lines read as extra rows of the table. */
const HiddenLegs: FC<{ transaction: LedgerTransaction }> = ({ transaction }) => {
  const { table } = useDataGrid<LedgerTransaction>();
  const legs = splitPostings(transaction.postings).hidden;
  return (
    <div className="flex flex-col">
      {legs.map((posting, i) => (
        // py-1.5 matches the dense body cells' vertical rhythm, so every
        // unfolded leg reads as a row of the same table.
        <div key={i} className="flex py-1.5">
          {table.getVisibleLeafColumns().map((column) => (
            <div
              key={column.id}
              className="shrink-0 px-2"
              style={{ width: `calc(var(--col-${column.id}-size) * 1px)` }}
            >
              {column.id === "account" ? (
                <div className={LINE}>
                  <MentionPill truncate type="account" label={posting.account} />
                </div>
              ) : column.id === "amount" ? (
                <div className={cn(LINE, "justify-end tabular-nums text-muted-foreground")}>
                  {postingAmount(posting)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

/** A faceted-filter value list: an array of picked strings, empty = off. */
const picked = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : []);

/** Inclusive amount bounds; either side open. Matches absolute amounts. */
type AmountRange = { min: number | null; max: number | null };

/** The distinct commodities a transaction touches, in leg order —
 *  hledger's own term: currencies, stock tickers, and crypto alike. */
const rowCommodities = (t: LedgerTransaction): string[] => [
  ...new Set(t.postings.flatMap((p) => p.amounts.map((a) => a.commodity))),
];

/** The Columns menu's entries: every hideable column, in display order. */
const TOGGLEABLE_COLUMNS: { id: string; label: string }[] = [
  { id: "date", label: "Date" },
  { id: "payee", label: "Payee" },
  { id: "account", label: "Account" },
  { id: "amount", label: "Amount" },
  { id: "commodity", label: "Commodity" },
  { id: "status", label: "Status" },
  { id: "note", label: "Comment" },
  { id: "tags", label: "Tags" },
];

/** The register columns. The leading expander is chrome (not hideable, not
 *  sortable) and carries the row's unfolded content. Sort keys:
 *  - Date: with a payee tiebreak, so one descending day reads payee A-Z
 *    (the comparator is written inverted — TanStack flips it wholesale);
 *  - Payee / Comment: text; Account: the first shown leg's path;
 *  - Amount: the first shown leg's quantity; Tags: joined pill text.
 *  Filters run against the underlying transaction, not the cell: Account
 *  matches EVERY leg (folded ones included), Tags any tag, Date the
 *  inclusive range — so a chip works even while its column is hidden. */
const columns: ColumnDef<DataGridFeatures, LedgerTransaction>[] = [
  {
    id: "expand",
    enableHiding: false,
    enableSorting: false,
    enableResizing: false,
    size: 36,
    header: () => null,
    cell: ({ row }) => <DataGridTableRowExpand row={row} />,
    meta: {
      expandedContent: (transaction: LedgerTransaction) => <HiddenLegs transaction={transaction} />,
    },
  },
  {
    id: "date",
    accessorFn: (row) => row.date,
    sortFn: (a, b) => {
      const byDate = compareText(a.original.date, b.original.date);
      return byDate !== 0 ? byDate : -compareText(a.original.payee.toLowerCase(), b.original.payee.toLowerCase());
    },
    filterFn: (row, _columnId, value) => {
      const range = value as DateRange | undefined;
      return !range || inRange(row.original.date, range);
    },
    size: 120,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Date" />,
    // The journal's own ISO date, verbatim — unambiguous, and what you see
    // is literally what the column sorts by.
    cell: ({ row }) => row.original.date,
    meta: { headerTitle: "Date", cellClassName: "tabular-nums", skeleton: <Skeleton className="h-4 w-20" /> },
  },
  {
    id: "payee",
    accessorFn: (row) => row.payee,
    sortFn: "text",
    filterFn: (row, _columnId, value) => {
      const payees = picked(value);
      return payees.length === 0 || payees.includes(row.original.payee);
    },
    size: 250,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Payee" />,
    cell: ({ row }) =>
      row.original.payee ? (
        <div className={LINE}>
          <MentionPill truncate type="payee" label={row.original.payee} />
        </div>
      ) : null,
    meta: { headerTitle: "Payee", skeleton: <Skeleton className="h-6 w-28 rounded-3xl" /> },
  },
  {
    id: "account",
    accessorFn: (row) => splitPostings(row.postings).shown[0]?.account ?? "",
    sortFn: "text",
    filterFn: (row, _columnId, value) => {
      const accounts = picked(value);
      return accounts.length === 0 || row.original.postings.some((p) => accounts.includes(p.account));
    },
    // Facet counts for the filter chip count EVERY leg, matching the
    // filter's any-leg semantics (the accessor covers only the shown leg).
    getUniqueValues: (row) => row.postings.map((p) => p.account),
    // The base width; as the page's one `autoSize` column it absorbs the
    // leftover page width, landing a notch wider than Payee by default.
    size: 200,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Account" />,
    // The leading legs only (splitPostings) — one pill per line; the rest
    // live in the row's unfolded block. Deep paths truncate inside the pill
    // (full path in the tooltip), so the column stays compact by default.
    cell: ({ row }) => (
      <div className="flex flex-col items-start gap-0.5">
        {splitPostings(row.original.postings).shown.map((posting, i) => (
          <div key={i} className={LINE}>
            <MentionPill truncate type="account" label={posting.account} />
          </div>
        ))}
      </div>
    ),
    // Absorbs a wide window's free width, so amounts stay next to accounts.
    meta: { headerTitle: "Account", autoSize: true, skeleton: <Skeleton className="h-6 w-52 rounded-3xl" /> },
  },
  {
    id: "amount",
    accessorFn: (row) => splitPostings(row.postings).shown[0]?.amounts[0]?.quantity ?? 0,
    sortFn: "basic",
    // Inclusive bounds against the shown legs' ABSOLUTE amounts: "50 to 300"
    // finds a 200.00 EUR expense and a 200.00 EUR income alike — the filter
    // asks "how big", the sign stays a display concern.
    filterFn: (row, _columnId, value) => {
      const range = value as AmountRange | undefined;
      if (!range) return true;
      return splitPostings(row.original.postings).shown.some((posting) =>
        posting.amounts.some((a) => {
          const q = Math.abs(a.quantity);
          return (range.min === null || q >= range.min) && (range.max === null || q <= range.max);
        }),
      );
    },
    size: 140,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Amount" className="justify-end" />,
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        {splitPostings(row.original.postings).shown.map((posting, i) => (
          <div key={i} className={cn(LINE, "justify-end tabular-nums")}>
            {postingAmount(posting)}
          </div>
        ))}
      </div>
    ),
    meta: {
      headerTitle: "Amount",
      headerClassName: "justify-end",
      cellClassName: "text-right",
      skeleton: <Skeleton className="ms-auto h-4 w-24" />,
    },
  },
  {
    id: "commodity",
    accessorFn: (row) => rowCommodities(row).join(", "),
    sortFn: "text",
    // Any leg's commodity matches, so a EUR->USD exchange shows up under
    // both commodities.
    filterFn: (row, _columnId, value) => {
      const currencies = picked(value);
      return currencies.length === 0 || rowCommodities(row.original).some((c) => currencies.includes(c));
    },
    getUniqueValues: (row) => rowCommodities(row),
    size: 110,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Commodity" />,
    cell: ({ row }) => rowCommodities(row.original).join(", "),
    meta: {
      headerTitle: "Commodity",
      cellClassName: "text-muted-foreground",
      skeleton: <Skeleton className="h-4 w-12" />,
    },
  },
  {
    id: "status",
    accessorFn: (row) => row.status,
    sortFn: "text",
    filterFn: (row, _columnId, value) => {
      const statuses = picked(value);
      return statuses.length === 0 || statuses.includes(row.original.status);
    },
    size: 110,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Status" />,
    cell: ({ row }) => row.original.status,
    meta: {
      headerTitle: "Status",
      cellClassName: "text-muted-foreground",
      skeleton: <Skeleton className="h-4 w-16" />,
    },
  },
  {
    id: "note",
    accessorFn: (row) => row.note,
    sortFn: "text",
    size: 200,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Comment" />,
    cell: ({ row }) => row.original.note,
    meta: {
      headerTitle: "Comment",
      cellClassName: "text-muted-foreground",
      skeleton: <Skeleton className="h-4 w-32" />,
    },
  },
  {
    id: "tags",
    accessorFn: (row) => row.tags.map(tagText).join(" "),
    sortFn: "text",
    filterFn: (row, _columnId, value) => {
      const tags = picked(value);
      return tags.length === 0 || row.original.tags.some((tag) => tags.includes(tagText(tag)));
    },
    // Facet counts per tag pill (the accessor is the joined sort text).
    getUniqueValues: (row) => row.tags.map(tagText),
    size: 180,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Tags" />,
    cell: ({ row }) => (
      <div className="flex flex-wrap items-center gap-1">
        {row.original.tags.map((tag, i) => (
          <MentionPill truncate key={i} type="tag" label={tagText(tag)} />
        ))}
      </div>
    ),
    meta: { headerTitle: "Tags", skeleton: <Skeleton className="h-6 w-24 rounded-3xl" /> },
  },
];

/** The grid grows `meta.autoSize` columns to fill the page, so their width
 *  is derived, not owned: persisting it would freeze one page width's result
 *  and overflow every narrower page. Storage drops these ids; the live table
 *  state keeps them so the fill still applies. */
const AUTO_SIZED = new Set(columns.flatMap((c) => (c.meta?.autoSize && c.id ? [c.id] : [])));

/** The Amount filter chip: a stock popover with inclusive Min/Max bounds
 *  over the shown legs' absolute amounts, writing a plain column filter like
 *  every other chip. */
const AmountFilterChip: FC<{
  column: Column<DataGridFeatures, LedgerTransaction, unknown> | undefined;
}> = ({ column }) => {
  if (!column) return null;
  const value = (column.getFilterValue() as AmountRange | undefined) ?? { min: null, max: null };
  const active = value.min !== null || value.max !== null;
  const set = (range: AmountRange) =>
    column.setFilterValue(range.min === null && range.max === null ? undefined : range);
  const parse = (raw: string): number | null => {
    if (raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            // With the range badge shown, the trailing padding matches the
            // badge's vertical inset so the space reads even on all sides.
            className={cn("border-dashed", active && "pr-1.5")}
          />
        }
      >
        <CoinsIcon />
        Amount
        {active && (
          <Badge variant="secondary" className="px-1.5 font-normal tabular-nums">
            {value.min !== null && value.max !== null
              ? `${value.min} - ${value.max}`
              : value.min !== null
                ? `≥ ${value.min}`
                : `≤ ${value.max}`}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className={cn(POPOVER_WIDTH, "p-3")}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              aria-label="Minimum amount"
              placeholder="Min"
              className="h-8"
              value={value.min ?? ""}
              onChange={(e) => set({ ...value, min: parse(e.target.value) })}
            />
            <Input
              type="number"
              aria-label="Maximum amount"
              placeholder="Max"
              className="h-8"
              value={value.max ?? ""}
              onChange={(e) => set({ ...value, max: parse(e.target.value) })}
            />
          </div>
          {active && (
            <Button variant="ghost" size="sm" onClick={() => column.setFilterValue(undefined)}>
              Clear
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

/** The Date filter chip — the one filter ReUI has no component for. A stock
 *  popover with the period presets and inclusive From/To bounds, writing a
 *  plain column filter like every other chip. */
const DateFilterChip: FC<{
  column: Column<DataGridFeatures, LedgerTransaction, unknown> | undefined;
  now: Date;
}> = ({ column, now }) => {
  if (!column) return null;
  const value = (column.getFilterValue() as DateRange | undefined) ?? { from: null, to: null };
  const active = value.from !== null || value.to !== null;
  const set = (range: DateRange) => column.setFilterValue(range.from === null && range.to === null ? undefined : range);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            // With the range badge shown, the trailing padding matches the
            // badge's vertical inset so the space reads even on all sides.
            className={cn("border-dashed", active && "pr-1.5")}
          />
        }
      >
        <CalendarIcon />
        Date
        {active && (
          <Badge variant="secondary" className="px-1.5 font-normal tabular-nums">
            {`${value.from ?? "start"} - ${value.to ?? "now"}`}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className={cn(POPOVER_WIDTH, "p-3")}>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(PRESET_LABELS) as DateRangePreset[]).map((preset) => (
              <Button key={preset} variant="outline" size="sm" onClick={() => set(presetRange(preset, now))}>
                {PRESET_LABELS[preset]}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              aria-label="From date"
              className="h-8"
              value={value.from ?? ""}
              onChange={(e) => set({ ...value, from: e.target.value || null })}
            />
            <Input
              type="date"
              aria-label="To date"
              className="h-8"
              value={value.to ?? ""}
              onChange={(e) => set({ ...value, to: e.target.value || null })}
            />
          </div>
          {active && (
            <Button variant="ghost" size="sm" onClick={() => column.setFilterValue(undefined)}>
              Clear
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

/** The Transactions page, shown in place of the chat thread: pinned title
 *  over the data-table toolbar (search, filter chips, Reset, View) and the
 *  stock data grid. `now` anchors the Date chip's presets (injectable so
 *  tests pin the calendar). */
export const TransactionsView: FC<{ now?: Date }> = ({ now }) => {
  const data = useTransactions();
  const [search, setSearch] = useState("");
  // Newest first by default (the payee tiebreak lives in the date column's
  // comparator); the column headers drive every other order.
  const [sorting, setSorting] = useState<SortingState>([{ id: "date", desc: true }]);
  const [config, setConfig] = useState<TransactionsTableConfig>(loadTableConfig);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 100 });

  // One lowercased haystack per transaction (payee, comment, every leg's
  // account, tag pills), computed once per fetch — keystrokes only
  // substring-match. Folded legs stay searchable.
  const searchTexts = useMemo(() => {
    const texts = new Map<number, string>();
    for (const t of data ?? []) {
      texts.set(
        t.index,
        [t.payee, t.note, ...t.postings.map((p) => p.account), ...t.tags.map(tagText)].join("\n").toLowerCase(),
      );
    }
    return texts;
  }, [data]);

  /** Persist one config field and update state in a single move. The stored
   *  copy drops the auto-sized columns' widths (see AUTO_SIZED). */
  const applyConfig = <K extends keyof TransactionsTableConfig>(key: K, updater: unknown) => {
    setConfig((prev) => {
      const value = typeof updater === "function" ? updater(prev[key]) : updater;
      const next = { ...prev, [key]: value };
      saveTableConfig({
        ...next,
        sizing: Object.fromEntries(Object.entries(next.sizing).filter(([id]) => !AUTO_SIZED.has(id))),
      });
      return next;
    });
  };

  const rows = useMemo(() => data ?? [], [data]);

  const table = useTable({
    features: dataGridFeatures,
    data: rows,
    columns,
    getRowId: (t) => String(t.index),
    state: {
      sorting,
      columnVisibility: config.visibility,
      columnSizing: config.sizing,
      globalFilter: search,
      expanded,
      pagination,
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: (updater) => applyConfig("visibility", updater),
    onColumnSizingChange: (updater) => applyConfig("sizing", updater),
    onExpandedChange: setExpanded,
    onPaginationChange: setPagination,
    getRowCanExpand: (row) => splitPostings(row.original.postings).hidden.length > 0,
    globalFilterFn: (row, _columnId, value) =>
      (searchTexts.get(row.original.index) ?? "").includes(String(value).toLowerCase()),
  });

  // Distinct payees only — payee-less transfers add no option.
  const payeeOptions = useMemo(() => {
    const names = new Set<string>();
    for (const t of data ?? []) if (t.payee) names.add(t.payee);
    return [...names]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((name) => ({ label: name, value: name }));
  }, [data]);

  const accountOptions = useMemo(() => {
    const names = new Set<string>();
    for (const t of data ?? []) for (const p of t.postings) names.add(p.account);
    return [...names]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((name) => ({ label: name, value: name }));
  }, [data]);

  // Only statuses the journal actually uses — no dead options.
  const statusOptions = useMemo(() => {
    const present = new Set((data ?? []).map((t) => t.status));
    return ["Cleared", "Pending", "Unmarked"]
      .filter((v) => present.has(v as LedgerTransaction["status"]))
      .map((v) => ({ label: v, value: v }));
  }, [data]);

  const commodityOptions = useMemo(() => {
    const names = new Set<string>();
    for (const t of data ?? []) for (const c of rowCommodities(t)) names.add(c);
    return [...names]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((name) => ({ label: name, value: name }));
  }, [data]);

  const tagOptions = useMemo(() => {
    const names = new Set<string>();
    for (const t of data ?? []) for (const tag of t.tags) names.add(tagText(tag));
    return [...names]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((name) => ({ label: name, value: name }));
  }, [data]);

  const filtersActive = search !== "" || table.state.columnFilters.length > 0;
  const resetFilters = () => {
    setSearch("");
    table.resetColumnFilters();
  };

  const recordCount = table.getFilteredRowModel().rows.length;

  // Same recipe as the Net Worth page: a centered page cap, widened one step
  // for each optional column toggled on (Status, Comment, Tags) so nothing
  // gets clipped where the window has the room. Narrow windows still fall
  // back to the grid's own horizontal scroll.
  const extraColumns = ["commodity", "status", "note", "tags"].filter((id) => config.visibility[id]).length;
  const pageWidth = ["max-w-4xl", "max-w-5xl", "max-w-6xl", "max-w-7xl"][extraColumns] ?? "max-w-7xl";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`mx-auto w-full ${pageWidth} shrink-0 px-8 pt-16 pb-4`}>
        <div className="flex items-center justify-between gap-8">
          <h1 className="whitespace-nowrap text-3xl font-semibold">Transactions</h1>
          {/* min-w-0 (not shrink-0): when the window narrows, the search
              field gives way so the Columns button never clips. */}
          <div className="flex min-w-0 items-center gap-2">
            <SearchField subject="transactions" value={search} onValueChange={setSearch} className="w-64 min-w-0" />
            <ColumnsMenu
              columns={TOGGLEABLE_COLUMNS}
              visibility={config.visibility}
              onToggle={(id, shown) => table.getColumn(id)?.toggleVisibility(shown)}
            />
          </div>
        </div>
        {/* The filter chips on their own row, following the column order:
            Date, Payee, Account, Amount, Commodity, Status, Tags. */}
        <div className="flex flex-wrap items-center gap-2 pt-4">
          <DateFilterChip column={table.getColumn("date")} now={now ?? new Date()} />
          <FilterChip
            title="Payee"
            subject="payees"
            mentionType="payee"
            options={payeeOptions}
            values={picked(table.getColumn("payee")?.getFilterValue())}
            onValuesChange={(v) => table.getColumn("payee")?.setFilterValue(v.length ? v : undefined)}
            counts={table.getColumn("payee")?.getFacetedUniqueValues()}
          />
          <FilterChip
            title="Account"
            subject="accounts"
            mentionType="account"
            options={accountOptions}
            values={picked(table.getColumn("account")?.getFilterValue())}
            onValuesChange={(v) => table.getColumn("account")?.setFilterValue(v.length ? v : undefined)}
            counts={table.getColumn("account")?.getFacetedUniqueValues()}
          />
          <AmountFilterChip column={table.getColumn("amount")} />
          <FilterChip
            title="Commodity"
            subject="commodities"
            icon={DollarSignIcon}
            options={commodityOptions}
            values={picked(table.getColumn("commodity")?.getFilterValue())}
            onValuesChange={(v) => table.getColumn("commodity")?.setFilterValue(v.length ? v : undefined)}
            counts={table.getColumn("commodity")?.getFacetedUniqueValues()}
          />
          <FilterChip
            title="Status"
            subject="statuses"
            icon={CircleCheckIcon}
            options={statusOptions}
            values={picked(table.getColumn("status")?.getFilterValue())}
            onValuesChange={(v) => table.getColumn("status")?.setFilterValue(v.length ? v : undefined)}
            counts={table.getColumn("status")?.getFacetedUniqueValues()}
          />
          <FilterChip
            title="Tags"
            subject="tags"
            mentionType="tag"
            options={tagOptions}
            values={picked(table.getColumn("tags")?.getFilterValue())}
            onValuesChange={(v) => table.getColumn("tags")?.setFilterValue(v.length ? v : undefined)}
            counts={table.getColumn("tags")?.getFacetedUniqueValues()}
          />
          {filtersActive && (
            <Button variant="outline" size="sm" onClick={resetFilters}>
              <XIcon />
              Reset
            </Button>
          )}
        </div>
      </div>
      {/* scroll-fade-t-6: content dissolves over 24px as it slides under the
          pinned controls, same as the chat viewport's top fade. */}
      <div className="scroll-fade-t scroll-fade-t-6 min-h-0 flex-1 overflow-y-auto">
        <div className={`mx-auto w-full ${pageWidth} px-8 pb-12`}>
          <DataGrid
            table={table}
            recordCount={recordCount}
            isLoading={data === null}
            emptyMessage={
              data !== null && data.length === 0
                ? "No transactions yet. Ask the agent to record your first transaction and it will show up here."
                : "No matching transactions"
            }
            tableLayout={{
              dense: true,
              columnsResizable: true,
              columnsResizeMode: "onChange",
              columnsVisibility: true,
              width: "fixed",
            }}
          >
            <DataGridContainer>
              {/* A table wider than the page (many columns, wide accounts)
                  scrolls horizontally inside the grid instead of clipping. */}
              <DataGridScrollArea orientation="horizontal">
                <DataGridTable />
              </DataGridScrollArea>
            </DataGridContainer>
            {recordCount > pagination.pageSize && (
              <div className="pt-4">
                <DataGridPagination sizes={[50, 100, 200]} />
              </div>
            )}
          </DataGrid>
        </div>
      </div>
    </div>
  );
};
