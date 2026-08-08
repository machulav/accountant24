"use client";

// Full-page Transactions view: the `hledger print` register on the ReUI
// data grid (TanStack v9), used stock. The grid owns the table mechanics:
// the two-state sort headers, resizable columns (widths persisted with the
// column visibility in localStorage), the virtualized row list, loading
// skeletons, and empty states. The page owns the rest: the toolbar (title +
// register count, search and the shared Columns menu, and the filter chips
// — Date, Payee, Account, Amount, Commodity, Status, Tags, with Reset — on
// their own row), the search haystack (every leg of every transaction), the
// collapsed-row rule (lead with the legs money left from, the expander
// unfolds the rest in place), and the chat's mention pills.
// Data refreshes when the agent finishes a turn while the page is visible.

import type { Column, ColumnDef, ExpandedState, SortingState, Updater } from "@tanstack/react-table";
import { functionalUpdate } from "@tanstack/react-table";
import { CalendarIcon, CircleCheckIcon, CoinsIcon, DollarSignIcon, XIcon } from "lucide-react";
import { type ComponentProps, type FC, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ColumnsMenu } from "@/components/accountant24/columns-menu";
import {
  FilterChip,
  FilterChipClear,
  FilterChipLabel,
  type FilterChipOption,
  FilterChipValue,
  filterChipTriggerClass,
} from "@/components/accountant24/filter-chip";
import { MentionPill } from "@/components/accountant24/mentions";
import { useAppTable } from "@/components/accountant24/use-app-table";
import { DataGrid, DataGridContainer, type DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { DataGridTable, DataGridTableRowExpand } from "@/components/reui/data-grid/data-grid-table";
import {
  DataGridTableVirtual,
  type DataGridTableVirtualizerOptions,
} from "@/components/reui/data-grid/data-grid-table-virtual";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { Input } from "@/components/shadcn/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { Skeleton } from "@/components/shadcn/skeleton";
import { formatAmounts } from "@/lib/amountFormat";
import { type DateRange, type DateRangePreset, inRange, isIsoDate, PRESET_LABELS, presetRange } from "@/lib/dateRange";
import { splitPostings } from "@/lib/postings";
import { cn } from "@/lib/utils";
import type { LedgerPosting, LedgerTransaction, LedgerTransactionStatus } from "@/rpc/types";
import { POPOVER_WIDTH } from "./popover";
import { SearchField } from "./search-field";
import { loadTableConfig, saveTableConfig, type TransactionsTableConfig } from "./transactions-columns";
import { useTransactions } from "./use-transactions";

/** The tag pill's text, also what search and the Tags sort key see. */
const tagText = (tag: { name: string; value: string }): string => (tag.value ? `${tag.name}: ${tag.value}` : tag.name);

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** App-styled sort header: the vendored default hovers a small rounded-lg
 *  secondary box; ours is the ghost-button recipe (muted pill) every other
 *  hoverable control uses. Merged over the vendored classes via cn. */
const HEADER_CLASS = "rounded-4xl hover:bg-muted data-[state=open]:bg-muted";

/** One posting line inside a cell: a fixed-height line box so the Account
 *  pills and the Amount figures line up row by row across the two columns. */
const LINE = "flex h-6 items-center";

const postingAmount = (posting: LedgerPosting): string => formatAmounts(posting.amounts, "native", navigator.language);

/** A faceted-filter value list: an array of picked strings, empty = off. */
const picked = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : []);

/** A chip's option list: the distinct values, A-Z, case-insensitively. */
const toOptions = (values: Iterable<string>): FilterChipOption[] =>
  [...new Set(values)]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((value) => ({ label: value, value }));

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
 *  inclusive range. Each chip shows only while its column does (hiding a
 *  column also clears its filter, so nothing filters invisibly).
 *  Every cell is align-top with an h-6 first line, so expanding a row adds
 *  legs below the first line without re-centering it. */
const columns: ColumnDef<DataGridFeatures, LedgerTransaction>[] = [
  {
    id: "expand",
    enableHiding: false,
    enableSorting: false,
    enableResizing: false,
    size: 36,
    header: () => null,
    cell: ({ row }) => <DataGridTableRowExpand row={row} />,
    meta: { cellClassName: "align-top" },
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
    // Unlike the other minimums (header-fit), dates are fixed-width data:
    // the minimum keeps the full ISO date readable.
    minSize: 104,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Date" className={HEADER_CLASS} />,
    // The journal's own ISO date, verbatim — unambiguous, and what you see
    // is literally what the column sorts by.
    cell: ({ row }) => <div className={LINE}>{row.original.date}</div>,
    meta: { headerTitle: "Date", cellClassName: "align-top tabular-nums", skeleton: <Skeleton className="h-4 w-20" /> },
  },
  {
    id: "payee",
    accessorFn: (row) => row.payee,
    sortFn: "text",
    filterFn: (row, _columnId, value) => {
      const payees = picked(value);
      return payees.length === 0 || payees.includes(row.original.payee);
    },
    size: 200,
    minSize: 90,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Payee" className={HEADER_CLASS} />,
    cell: ({ row }) =>
      row.original.payee ? (
        <div className={LINE}>
          <MentionPill truncate type="payee" label={row.original.payee} />
        </div>
      ) : null,
    meta: { headerTitle: "Payee", cellClassName: "align-top", skeleton: <Skeleton className="h-6 w-28 rounded-3xl" /> },
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
    size: 250,
    minSize: 104,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Account" className={HEADER_CLASS} />,
    // The leading legs only (splitPostings) — one pill per line; expanding
    // the row appends the folded legs to the same stack, so the unfolded
    // lines read as part of the row (the virtual table measures the growth).
    // Deep paths truncate inside the pill (full path in the tooltip).
    cell: ({ row }) => {
      const { shown, hidden } = splitPostings(row.original.postings);
      const legs = row.getIsExpanded() ? [...shown, ...hidden] : shown;
      return (
        <div className="flex flex-col items-start gap-1.5">
          {legs.map((posting, i) => (
            // max-w-full: items-start sizes each line to its content, so
            // without the cap the pill never meets the cell edge and gets
            // hard-clipped by the cell instead of ellipsizing itself.
            <div key={i} className={cn(LINE, "max-w-full")}>
              <MentionPill truncate type="account" label={posting.account} />
            </div>
          ))}
        </div>
      );
    },
    // The widest default: account paths are the page's longest text, and the
    // table sizes itself from the column widths (see getTotalSize below).
    meta: {
      headerTitle: "Account",
      cellClassName: "align-top",
      skeleton: <Skeleton className="h-6 w-52 rounded-3xl" />,
    },
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
    size: 150,
    minSize: 100,
    header: ({ column }) => (
      <DataGridColumnHeader column={column} title="Amount" className={cn(HEADER_CLASS, "justify-end")} />
    ),
    cell: ({ row }) => {
      const { shown, hidden } = splitPostings(row.original.postings);
      return (
        <div className="flex flex-col gap-1.5">
          {shown.map((posting, i) => (
            <div key={i} className={cn(LINE, "justify-end tabular-nums")}>
              {postingAmount(posting)}
            </div>
          ))}
          {row.getIsExpanded() &&
            hidden.map((posting, i) => (
              <div key={`folded-${i}`} className={cn(LINE, "justify-end tabular-nums text-muted-foreground")}>
                {postingAmount(posting)}
              </div>
            ))}
        </div>
      );
    },
    meta: {
      headerTitle: "Amount",
      headerClassName: "justify-end",
      cellClassName: "align-top text-right",
      skeleton: <Skeleton className="ms-auto h-4 w-24" />,
    },
  },
  // Filter-only column: it never renders (the Amount figures already carry
  // their commodity) but holds the Commodity chip's filter and facet
  // counts. Its visibility is forced off in the table state.
  {
    id: "commodity",
    accessorFn: (row) => rowCommodities(row).join(", "),
    // Any leg's commodity matches, so a EUR->USD exchange shows up under
    // both commodities.
    filterFn: (row, _columnId, value) => {
      const currencies = picked(value);
      return currencies.length === 0 || rowCommodities(row.original).some((c) => currencies.includes(c));
    },
    getUniqueValues: (row) => rowCommodities(row),
  },
  {
    id: "status",
    accessorFn: (row) => row.status,
    sortFn: "text",
    filterFn: (row, _columnId, value) => {
      const statuses = picked(value);
      return statuses.length === 0 || statuses.includes(row.original.status);
    },
    size: 100,
    minSize: 94,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Status" className={HEADER_CLASS} />,
    cell: ({ row }) => <div className={LINE}>{row.original.status}</div>,
    meta: {
      headerTitle: "Status",
      cellClassName: "align-top text-muted-foreground",
      skeleton: <Skeleton className="h-4 w-16" />,
    },
  },
  {
    id: "note",
    accessorFn: (row) => row.note,
    sortFn: "text",
    size: 300,
    minSize: 108,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Comment" className={HEADER_CLASS} />,
    // Collapsed: one line, ellipsized (full text in the tooltip). Expanded:
    // the whole comment, wrapping at the h-6 line rhythm.
    cell: ({ row }) =>
      row.getIsExpanded() ? (
        <div className="min-h-6 leading-6 whitespace-normal break-words">{row.original.note}</div>
      ) : (
        <div className={LINE}>
          <span className="truncate" title={row.original.note || undefined}>
            {row.original.note}
          </span>
        </div>
      ),
    meta: {
      headerTitle: "Comment",
      cellClassName: "align-top text-muted-foreground",
      skeleton: <Skeleton className="h-4 w-32" />,
    },
  },
  {
    id: "tags",
    accessorFn: (row) => row.tags.map(tagText).join(" "),
    sortFn: "text",
    // The chip filters by tag NAME (values vary per transaction — the name
    // is the dimension worth filtering on).
    filterFn: (row, _columnId, value) => {
      const tags = picked(value);
      return tags.length === 0 || row.original.tags.some((tag) => tags.includes(tag.name));
    },
    // Facet counts per tag name, one per row (the accessor is sort text).
    getUniqueValues: (row) => [...new Set(row.tags.map((tag) => tag.name))],
    size: 300,
    minSize: 80,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Tags" className={HEADER_CLASS} />,
    // Collapsed: every tag on one line, sharing the width (each pill
    // ellipsizes on its own). Expanded: one tag per line, on the same
    // rhythm as the unfolded account legs.
    cell: ({ row }) =>
      row.getIsExpanded() ? (
        <div className="flex flex-col items-start gap-1.5">
          {row.original.tags.map((tag, i) => (
            <div key={i} className={cn(LINE, "max-w-full")}>
              <MentionPill truncate type="tag" label={tagText(tag)} />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-6 items-center gap-1 overflow-hidden">
          {row.original.tags.map((tag, i) => (
            <MentionPill truncate key={i} type="tag" label={tagText(tag)} />
          ))}
        </div>
      ),
    meta: { headerTitle: "Tags", cellClassName: "align-top", skeleton: <Skeleton className="h-6 w-24 rounded-3xl" /> },
  },
];

/** Measured row heights for the virtual scroller: multi-leg and expanded
 *  rows are taller than the estimate, and exact offsets need real sizes.
 *  Supplying measureElement is what makes the vendored table observe rows at
 *  all; the body mirrors the virtualizer's own default, preferring the box
 *  the ResizeObserver already computed over a fresh layout read.
 *  The cast: the vendored options type keeps TanStack's internals
 *  (scrollToFn, element observers) required even though the component
 *  supplies them itself — only our customizations live here. */
const VIRTUALIZER_OPTIONS = {
  measureElement: (el: HTMLTableRowElement, entry: ResizeObserverEntry | undefined) =>
    entry?.borderBoxSize?.[0]?.blockSize ?? el.getBoundingClientRect().height,
} as unknown as DataGridTableVirtualizerOptions<LedgerTransaction>;

/** Stable empty register, so a fetch in flight doesn't hand the table a
 *  fresh array (and a fresh row model) on every render. */
const NO_ROWS: LedgerTransaction[] = [];

/** Registers up to this many rows render directly; the virtualizer's
 *  spacer-and-measure machinery only pays off past it. */
const VIRTUALIZE_AFTER = 100;

/** How long after the last column change (a resize drag emits one per
 *  pointer move) the table config is written to localStorage. */
const SAVE_CONFIG_DELAY_MS = 250;

/** A faceted chip wired to its column: reads the picked values and the facet
 *  counts off the column, and writes the filter back. Holds the
 *  empty-means-off convention (an empty array left in place would keep
 *  `columnFilters` non-empty, so Reset would never go away), so no call site
 *  has to remember it. FilterChip itself stays table-agnostic. */
const ColumnChip: FC<
  { column: Column<DataGridFeatures, LedgerTransaction, unknown> | undefined } & Pick<
    ComponentProps<typeof FilterChip>,
    "title" | "subject" | "mentionType" | "icon" | "options"
  >
> = ({ column, ...rest }) => (
  <FilterChip
    {...rest}
    values={picked(column?.getFilterValue())}
    onValuesChange={(values) => column?.setFilterValue(values.length ? values : undefined)}
    counts={column?.getFacetedUniqueValues()}
  />
);

/** A range chip: same trigger, popup, and clear footer as the faceted
 *  FilterChip, but its popup body is a pair of bounds rather than an option
 *  list. Holds the chrome so the Amount and Date chips carry only their own
 *  inputs and their own spelling of the active range. */
const RangeFilterChip: FC<{
  icon: FC<{ className?: string }>;
  title: string;
  /** The active range spelled out for the trigger badge; null = filter off. */
  summary: string | null;
  onOpen?: () => void;
  onClear: () => void;
  children: ReactNode;
}> = ({ icon, title, summary, onOpen, onClear, children }) => (
  <Popover onOpenChange={(open) => open && onOpen?.()}>
    <PopoverTrigger render={<Button variant="outline" size="sm" className={filterChipTriggerClass(!!summary)} />}>
      <FilterChipLabel icon={icon} title={title} active={!!summary}>
        <FilterChipValue className="tabular-nums">{summary}</FilterChipValue>
      </FilterChipLabel>
    </PopoverTrigger>
    <PopoverContent align="start" className={cn(POPOVER_WIDTH, "gap-0 p-0")}>
      <div className="flex flex-col gap-1.5 p-3">{children}</div>
      {summary && <FilterChipClear onClear={onClear} />}
    </PopoverContent>
  </Popover>
);

/** The Amount filter chip: inclusive Min/Max bounds over the shown legs'
 *  absolute amounts, writing a plain column filter like every other chip. */
const AmountFilterChip: FC<{
  column: Column<DataGridFeatures, LedgerTransaction, unknown> | undefined;
}> = ({ column }) => {
  if (!column) return null;
  const value = (column.getFilterValue() as AmountRange | undefined) ?? { min: null, max: null };
  const set = (range: AmountRange) =>
    column.setFilterValue(range.min === null && range.max === null ? undefined : range);
  const parse = (raw: string): number | null => {
    if (raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const summary =
    value.min !== null && value.max !== null
      ? `${value.min} - ${value.max}`
      : value.min !== null
        ? `≥ ${value.min}`
        : value.max !== null
          ? `≤ ${value.max}`
          : null;
  return (
    <RangeFilterChip icon={CoinsIcon} title="Amount" summary={summary} onClear={() => column.setFilterValue(undefined)}>
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
    </RangeFilterChip>
  );
};

/** The Date filter chip — the one filter ReUI has no component for. The
 *  period presets and inclusive From/To bounds, writing a plain column
 *  filter like every other chip. */
const DateFilterChip: FC<{
  column: Column<DataGridFeatures, LedgerTransaction, unknown> | undefined;
  now: Date;
}> = ({ column, now }) => {
  // Free-typed bound texts; committed to the filter only once they are a
  // real ISO calendar date (or empty), so half-typed input and impossible
  // dates like 2026-13-45 never filter. Plain text fields, not type="date":
  // the native control renders the OS locale's format, which can never
  // match the Date column's ISO dates.
  const [draft, setDraft] = useState({ from: "", to: "" });
  if (!column) return null;
  const value = (column.getFilterValue() as DateRange | undefined) ?? { from: null, to: null };
  const active = value.from !== null || value.to !== null;
  const set = (range: DateRange) => column.setFilterValue(range.from === null && range.to === null ? undefined : range);
  const setBound = (bound: "from" | "to", text: string) => {
    setDraft((prev) => ({ ...prev, [bound]: text }));
    if (text === "" || isIsoDate(text)) set({ ...value, [bound]: text || null });
  };
  return (
    <RangeFilterChip
      icon={CalendarIcon}
      title="Date"
      summary={active ? `${value.from ?? "start"} - ${value.to ?? "now"}` : null}
      onOpen={() => setDraft({ from: value.from ?? "", to: value.to ?? "" })}
      onClear={() => {
        column.setFilterValue(undefined);
        setDraft({ from: "", to: "" });
      }}
    >
      <div className="grid grid-cols-2 gap-1.5">
        {(Object.keys(PRESET_LABELS) as DateRangePreset[]).map((preset) => (
          <Button
            key={preset}
            variant="outline"
            size="sm"
            onClick={() => {
              const range = presetRange(preset, now);
              set(range);
              setDraft({ from: range.from ?? "", to: range.to ?? "" });
            }}
          >
            {PRESET_LABELS[preset]}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          aria-label="From date"
          placeholder="YYYY-MM-DD"
          className="h-8 tabular-nums"
          value={draft.from}
          onChange={(e) => setBound("from", e.target.value)}
        />
        <Input
          aria-label="To date"
          placeholder="YYYY-MM-DD"
          className="h-8 tabular-nums"
          value={draft.to}
          onChange={(e) => setBound("to", e.target.value)}
        />
      </div>
    </RangeFilterChip>
  );
};

/** The Transactions page, shown in place of the chat thread: pinned title
 *  over the data-table toolbar (search, filter chips, Reset, View) and the
 *  stock data grid. `now` anchors the Date chip's presets (injectable so
 *  tests pin the calendar). `active` = the page is the visible view; the
 *  layout keeps it mounted while hidden, and a hidden page defers its
 *  idle-edge refetches to the next show. */
export const TransactionsView: FC<{ now?: Date; active?: boolean }> = ({ now, active = true }) => {
  const { transactions: data, failed } = useTransactions(active);
  const [search, setSearch] = useState("");
  // Newest first by default (the payee tiebreak lives in the date column's
  // comparator); the column headers drive every other order.
  const [sorting, setSorting] = useState<SortingState>([{ id: "date", desc: true }]);
  const [config, setConfig] = useState<TransactionsTableConfig>(loadTableConfig);
  const [expanded, setExpanded] = useState<ExpandedState>({});

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

  /** Update one config field; persistence follows debounced (below). */
  const applyConfig = <K extends keyof TransactionsTableConfig>(key: K, updater: Updater<TransactionsTableConfig[K]>) =>
    setConfig((prev) => ({ ...prev, [key]: functionalUpdate(updater, prev[key]) }));

  // Persist the config debounced: an onChange column resize updates state on
  // every pointer move, and a synchronous localStorage write per move would
  // put disk I/O on the drag frame path. One write lands shortly after the
  // last change; the just-loaded initial config never writes back.
  const savedConfig = useRef(config);
  useEffect(() => {
    if (savedConfig.current === config) return;
    const timer = setTimeout(() => {
      savedConfig.current = config;
      saveTableConfig(config);
    }, SAVE_CONFIG_DELAY_MS);
    return () => clearTimeout(timer);
  }, [config]);

  const rows = data ?? NO_ROWS;

  // commodity is filter-only: never rendered, whatever storage says. Memoized
  // because the grid keys its own memos (header groups, visible cells, the
  // provider's context value) on this object's identity — a fresh one per
  // render would re-render every row on every pointer move of a resize drag.
  const columnVisibility = useMemo(() => ({ ...config.visibility, commodity: false }), [config.visibility]);

  // The needle, lowercased once per keystroke rather than per row.
  const needle = useMemo(() => search.toLowerCase(), [search]);

  const table = useAppTable({
    data: rows,
    columns,
    getRowId: (t) => String(t.index),
    state: {
      sorting,
      columnVisibility,
      columnSizing: config.sizing,
      globalFilter: search,
      expanded,
    },
    // Two-state sort headers (asc <-> desc), matching Net Worth. The
    // vendored header's third click clears the sort (journal order — near
    // enough to the date default to read as a dead click); map that clear
    // to ascending so a header always just flips direction.
    onSortingChange: (updater) => {
      setSorting((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        const cleared = prev[0];
        if (next.length === 0 && cleared) return [{ id: cleared.id, desc: false }];
        return next;
      });
    },
    onColumnVisibilityChange: (updater) => applyConfig("visibility", updater),
    onColumnSizingChange: (updater) => applyConfig("sizing", updater),
    onExpandedChange: setExpanded,
    getRowCanExpand: (row) => splitPostings(row.original.postings).hidden.length > 0,
    // The search matches the whole transaction at once (see searchTexts), so
    // it needs exactly one column to hang off: the filtered row model calls
    // the global filter once per globally-filterable column per row, and our
    // filter would give the same answer every time. (Zero columns would turn
    // global filtering off entirely.)
    getColumnCanGlobalFilter: (column) => column.id === "date",
    globalFilterFn: (row) => (searchTexts.get(row.original.index) ?? "").includes(needle),
  });

  // Distinct payees only — payee-less transfers add no option.
  const payeeOptions = useMemo(() => toOptions(rows.flatMap((t) => (t.payee ? [t.payee] : []))), [rows]);
  const accountOptions = useMemo(() => toOptions(rows.flatMap((t) => t.postings.map((p) => p.account))), [rows]);
  const commodityOptions = useMemo(() => toOptions(rows.flatMap(rowCommodities)), [rows]);
  // Tag NAMES only — values stay in the table pills, not in the filter.
  const tagOptions = useMemo(() => toOptions(rows.flatMap((t) => t.tags.map((tag) => tag.name))), [rows]);

  // Only statuses the journal actually uses — no dead options, in hledger's
  // own order rather than A-Z.
  const statusOptions = useMemo(() => {
    const present = new Set(rows.map((t) => t.status));
    const all: LedgerTransactionStatus[] = ["Cleared", "Pending", "Unmarked"];
    return all.filter((status) => present.has(status)).map((status) => ({ label: status, value: status }));
  }, [rows]);

  const filtersActive = search !== "" || table.state.columnFilters.length > 0;
  const resetFilters = () => {
    setSearch("");
    table.resetColumnFilters();
  };

  const recordCount = table.getFilteredRowModel().rows.length;
  const totalCount = rows.length;

  // The page body is the scroll element (the scrollbar sits at the window
  // edge like on every page); the virtualizer windows rows against it.
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizerOptions = useMemo(
    () => ({
      ...VIRTUALIZER_OPTIONS,
      getScrollElement: () => scrollRef.current,
      enabled: recordCount > VIRTUALIZE_AFTER,
    }),
    [recordCount],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto w-full max-w-4xl shrink-0 px-8 pt-16 pb-4">
        <div className="flex items-center justify-between gap-8">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="whitespace-nowrap text-3xl font-semibold">Transactions</h1>
            {/* The register count, switching to "X of Y" filter feedback; by
                the title (the Linear/GitHub pattern) so chip-row wrapping
                can never orphan it onto its own line. */}
            {data === null ? (
              <Skeleton className="h-5 w-10 rounded-3xl" />
            ) : (
              <Badge variant="secondary" className="bg-muted px-1.5 font-normal text-muted-foreground tabular-nums">
                {filtersActive
                  ? `${recordCount.toLocaleString(navigator.language)} of ${totalCount.toLocaleString(navigator.language)}`
                  : totalCount.toLocaleString(navigator.language)}
              </Badge>
            )}
          </div>
          {/* min-w-0 (not shrink-0): when the window narrows, the search
              field gives way so the Columns button never clips. */}
          <div className="flex min-w-0 items-center gap-2">
            <SearchField subject="transactions" value={search} onValueChange={setSearch} className="w-64 min-w-0" />
            <ColumnsMenu
              columns={TOGGLEABLE_COLUMNS}
              visibility={config.visibility}
              onToggle={(id, shown) => {
                table.getColumn(id)?.toggleVisibility(shown);
                // A hidden column takes its filter chip with it; clearing
                // the filter keeps rows from being filtered invisibly.
                if (!shown) {
                  table.getColumn(id)?.setFilterValue(undefined);
                  // The Commodity chip rides with the Amount column.
                  if (id === "amount") table.getColumn("commodity")?.setFilterValue(undefined);
                }
              }}
            />
          </div>
        </div>
        {/* The filter chips on their own row, following the column order:
            Date, Payee, Account, Amount, Commodity, Status, Tags. Each chip
            shows only while its column does. */}
        <div className="flex flex-wrap items-center gap-2 pt-4">
          {config.visibility.date && <DateFilterChip column={table.getColumn("date")} now={now ?? new Date()} />}
          {config.visibility.payee && (
            <ColumnChip
              column={table.getColumn("payee")}
              title="Payee"
              subject="payees"
              mentionType="payee"
              options={payeeOptions}
            />
          )}
          {config.visibility.account && (
            <ColumnChip
              column={table.getColumn("account")}
              title="Account"
              subject="accounts"
              mentionType="account"
              options={accountOptions}
            />
          )}
          {config.visibility.amount && (
            <>
              <AmountFilterChip column={table.getColumn("amount")} />
              <ColumnChip
                column={table.getColumn("commodity")}
                title="Commodity"
                subject="commodities"
                icon={DollarSignIcon}
                options={commodityOptions}
              />
            </>
          )}
          {config.visibility.status && (
            <ColumnChip
              column={table.getColumn("status")}
              title="Status"
              subject="statuses"
              icon={CircleCheckIcon}
              options={statusOptions}
            />
          )}
          {config.visibility.tags && (
            <ColumnChip
              column={table.getColumn("tags")}
              title="Tags"
              subject="tags"
              mentionType="tag"
              options={tagOptions}
            />
          )}
          {filtersActive && (
            <Button variant="outline" size="sm" className="border-dashed" onClick={resetFilters}>
              <XIcon />
              Reset
            </Button>
          )}
        </div>
      </div>
      {/* No top scroll-fade here: the sticky column header sits at the very
          top of the scroller and would be eaten by the mask; its own
          backdrop covers the rows sliding beneath instead. */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {/* The table area is exactly as wide as its columns (never below
            the header's content width, so the default view stays aligned);
            past the window width the PAGE scrolls horizontally (both
            scrollbars live at the window edge), so a scrollbar appears only
            once the window truly has no room left. No side padding: while
            scrolling, gutters would read as torn white bands at the ends.
            Width comes from the column sizes, not the DOM, so the grid's
            fill machinery cannot feed back into it. */}
        <div className="mx-auto" style={{ width: `max(52rem, ${table.getTotalSize()}px)` }}>
          <DataGrid
            table={table}
            recordCount={recordCount}
            isLoading={data === null}
            emptyMessage={
              failed
                ? "The journal could not be read. Ask the agent to check it."
                : data !== null && data.length === 0
                  ? "No transactions yet. Ask the agent to record your first transaction and it will show up here."
                  : "No matching transactions"
            }
            // No columnsVisibility flag: it would only arm the header
            // dropdown's own hide submenu (and even then each header must
            // opt in), which toggles columns behind ColumnsMenu's back —
            // bypassing its filter-clearing, so a hidden column could keep
            // filtering invisibly. The toolbar's Columns menu is the one
            // visibility control.
            tableLayout={{
              dense: true,
              columnsResizable: true,
              columnsResizeMode: "onChange",
              headerSticky: true,
              width: "fixed",
            }}
          >
            {/* One virtualized list for the whole register — no pagination.
                The page body scrolls it; rows are measured, so multi-leg
                and expanded rows keep exact offsets. A table wider than the
                page still scrolls horizontally inside the grid. */}
            {/* overflow-visible + the scroll-area-viewport marker present
                the page body as this grid's external scroll area: the table
                viewport then adds no overflow of its own, so the sticky
                column header sticks against the page scroll. */}
            <DataGridContainer className="overflow-visible">
              <div data-slot="scroll-area-viewport">
                {data === null ? (
                  // The virtual list has no skeleton mode; the plain renderer
                  // shows the shaped per-column skeletons and swaps out with
                  // the first real rows.
                  <DataGridTable />
                ) : (
                  <DataGridTableVirtual estimateSize={37} virtualizerOptions={virtualizerOptions} />
                )}
              </div>
            </DataGridContainer>
          </DataGrid>
        </div>
      </div>
    </div>
  );
};
