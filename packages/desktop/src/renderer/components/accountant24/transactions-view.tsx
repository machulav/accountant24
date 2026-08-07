"use client";

// Full-page Transactions view: the `hledger print` register on the ReUI
// data grid (TanStack v9), used stock. The grid owns the table mechanics:
// column header menus (sort, hide) and resizable columns (persisted with
// visibility in localStorage), the
// faceted filter chips, loading skeletons, empty states, and pagination.
// The toolbar mirrors the classic data-table bar: search + filter chips
// (Account, Status, Tags, Date) with a Reset on the left, Sort + View on
// the right — the chips are ReUI's own DataGridColumnFilter; only the Date
// chip and the Sort menu are local (ReUI ships no date filter or sort
// dropdown), both assembled from stock shadcn parts. The page adds what the
// grid cannot know: the search haystack (every leg of every transaction),
// the collapsed-row rule (lead with the legs money left from, unfold the
// rest YNAB-style via the grid's expander), and the chat's mention pills.
// Data refreshes when the agent finishes a turn.

import type { Column, ColumnDef, ExpandedState, ReactTable, SortingState } from "@tanstack/react-table";
import { useTable } from "@tanstack/react-table";
import { ArrowUpDownIcon, CalendarIcon, SearchIcon, Settings2Icon, XIcon } from "lucide-react";
import { type FC, useMemo, useState } from "react";
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
import { DataGridColumnVisibility } from "@/components/reui/data-grid/data-grid-column-visibility";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable, DataGridTableRowExpand } from "@/components/reui/data-grid/data-grid-table";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { Input } from "@/components/shadcn/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/shadcn/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { Skeleton } from "@/components/shadcn/skeleton";
import { formatAmounts } from "@/lib/amountFormat";
import { type DateRange, type DateRangePreset, inRange, PRESET_LABELS, presetRange } from "@/lib/dateRange";
import { splitPostings } from "@/lib/postings";
import { cn } from "@/lib/utils";
import type { LedgerPosting, LedgerTransaction } from "@/rpc/types";
import { POPOVER_WIDTH } from "./popover";
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
                  <MentionPill type="account" label={posting.account} />
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
    sortDescFirst: true,
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
    size: 180,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Payee" />,
    cell: ({ row }) =>
      row.original.payee ? (
        <div className={LINE}>
          <MentionPill type="payee" label={row.original.payee} />
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
    size: 260,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Account" />,
    // The leading legs only (splitPostings) — one pill per line; the rest
    // live in the row's unfolded block.
    cell: ({ row }) => (
      <div className="flex flex-col items-start gap-0.5">
        {splitPostings(row.original.postings).shown.map((posting, i) => (
          <div key={i} className={LINE}>
            <MentionPill type="account" label={posting.account} />
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
    sortDescFirst: true,
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
          <MentionPill key={i} type="tag" label={tagText(tag)} />
        ))}
      </div>
    ),
    meta: { headerTitle: "Tags", skeleton: <Skeleton className="h-6 w-24 rounded-3xl" /> },
  },
];

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
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
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

const SORT_FIELDS: [id: string, label: string][] = [
  ["date", "Date"],
  ["payee", "Payee"],
  ["account", "Account"],
  ["amount", "Amount"],
  ["status", "Status"],
  ["note", "Comment"],
  ["tags", "Tags"],
];

/** The toolbar's Sort menu (ReUI has no sort dropdown): pick the field and
 *  the direction; picking a field starts in its natural first direction
 *  (money and dates newest/biggest first). */
const SortMenu: FC<{ table: ReactTable<DataGridFeatures, LedgerTransaction> }> = ({ table }) => {
  const current = table.state.sorting?.[0];
  const pickField = (id: string) => {
    const desc = current?.id === id ? current.desc : (table.getColumn(id)?.columnDef.sortDescFirst ?? false);
    table.setSorting([{ id, desc }]);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <ArrowUpDownIcon />
        Sort
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuRadioGroup value={current?.id} onValueChange={(id) => pickField(String(id))}>
          <DropdownMenuLabel className="font-medium">Sort by</DropdownMenuLabel>
          {SORT_FIELDS.map(([id, label]) => (
            <DropdownMenuRadioItem key={id} value={id} closeOnClick={false}>
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={current?.desc ? "desc" : "asc"}
          onValueChange={(dir) => current && table.setSorting([{ id: current.id, desc: dir === "desc" }])}
        >
          <DropdownMenuRadioItem value="asc" closeOnClick={false}>
            Asc
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="desc" closeOnClick={false}>
            Desc
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** The Transactions page, shown in place of the chat thread: pinned title
 *  over the data-table toolbar (search, filter chips, Reset, Sort, View)
 *  and the stock data grid at full width. `now` anchors the Date chip's
 *  presets (injectable so tests pin the calendar). */
export const TransactionsView: FC<{ now?: Date }> = ({ now }) => {
  const data = useTransactions();
  const [search, setSearch] = useState("");
  // Newest first by default (the payee tiebreak lives in the date column's
  // comparator); the Sort menu and header menus drive every other order.
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

  /** Persist one config field and update state in a single move. */
  const applyConfig = <K extends keyof TransactionsTableConfig>(key: K, updater: unknown) => {
    setConfig((prev) => {
      const value = typeof updater === "function" ? updater(prev[key]) : updater;
      const next = { ...prev, [key]: value };
      saveTableConfig(next);
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="w-full shrink-0 px-8 pt-16 pb-4">
        <h1 className="text-3xl font-semibold">Transactions</h1>
        {/* The classic data-table toolbar: search + filter chips + Reset on
            the left, Sort + View on the right. */}
        <div className="flex flex-wrap items-center gap-2 pt-4">
          <InputGroup className="w-64">
            <InputGroupInput
              type="search"
              placeholder="Search transactions"
              aria-label="Search transactions"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
          </InputGroup>
          <FilterChip
            title="Account"
            options={accountOptions}
            values={picked(table.getColumn("account")?.getFilterValue())}
            onValuesChange={(v) => table.getColumn("account")?.setFilterValue(v.length ? v : undefined)}
            counts={table.getColumn("account")?.getFacetedUniqueValues()}
          />
          <FilterChip
            title="Status"
            options={statusOptions}
            values={picked(table.getColumn("status")?.getFilterValue())}
            onValuesChange={(v) => table.getColumn("status")?.setFilterValue(v.length ? v : undefined)}
            counts={table.getColumn("status")?.getFacetedUniqueValues()}
          />
          <FilterChip
            title="Tags"
            options={tagOptions}
            values={picked(table.getColumn("tags")?.getFilterValue())}
            onValuesChange={(v) => table.getColumn("tags")?.setFilterValue(v.length ? v : undefined)}
            counts={table.getColumn("tags")?.getFacetedUniqueValues()}
          />
          <DateFilterChip column={table.getColumn("date")} now={now ?? new Date()} />
          {filtersActive && (
            <Button variant="outline" size="sm" onClick={resetFilters}>
              <XIcon />
              Reset
            </Button>
          )}
          <div className="flex-1" />
          <SortMenu table={table} />
          <DataGridColumnVisibility
            table={table}
            trigger={
              <Button variant="outline" size="sm">
                <Settings2Icon />
                View
              </Button>
            }
          />
        </div>
      </div>
      {/* scroll-fade-t-6: content dissolves over 24px as it slides under the
          pinned controls, same as the chat viewport's top fade. */}
      <div className="scroll-fade-t scroll-fade-t-6 min-h-0 flex-1 overflow-y-auto">
        <div className="w-full px-5 pb-12">
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
