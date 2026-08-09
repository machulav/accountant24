"use client";

// Full-page Net Worth view: `hledger bs` rendered as data — an Assets
// and a Liabilities section (liabilities already sign-flipped positive by
// hledger), each with hledger's own total, and the hledger-computed Net as
// the classic bottom line. Each section is the same stock ReUI data grid
// (TanStack v9) as the Transactions register: the app-styled two-state
// sort headers, resizable columns (widths persisted with the column
// visibility in localStorage, shared across the sections so they stay
// aligned), per-column loading skeletons, and the filtered-out empty
// state. A pinned header carries the page title, a search box filtering
// every section by account path, and a Columns menu toggling the two
// assertion columns across every section at once. Complete account paths
// in one color, every native holding in the Holding column, the market
// value (hledger's `-X` valuation in the base currency) in the Value
// column; every column sorts, A-Z on the account path by default,
// independently per section. All figures are hledger-computed; only the
// presentation happens here. Data refreshes when the agent finishes a turn.

import type { Column, ColumnDef, SortingState, Updater } from "@tanstack/react-table";
import { InfoIcon, WalletIcon } from "lucide-react";
import { type FC, type ReactNode, useState } from "react";
import { AppColumnHeader } from "@/components/accountant24/app-column-header";
import { MentionPill } from "@/components/accountant24/mentions";
import { PageEmpty } from "@/components/accountant24/page-empty";
import { useTableConfig } from "@/components/accountant24/table-config";
import { twoStateSortingChange, useAppTable } from "@/components/accountant24/use-app-table";
import { DataGrid, DataGridContainer, type DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { Button } from "@/components/shadcn/button";
import { Skeleton } from "@/components/shadcn/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { formatAmount, formatAmounts, formatValue, splitValueLead } from "@/lib/amountFormat";
import type { AccountBalance, NetWorthSection, NetWorthTotal } from "@/rpc/types";
import { ColumnsMenu } from "./columns-menu";
import {
  COLUMN_MIN_SIZES,
  COLUMN_SIZES,
  loadTableConfig,
  type NetWorthTableConfig,
  saveTableConfig,
  tableWidth,
} from "./net-worth-columns";
import { SearchField } from "./search-field";
import { useNetWorth } from "./use-net-worth";

/** The two columns the Columns menu can toggle; the other three are the
 *  page's spine and never leave. */
type OptionalColumnId = "asserted" | "assertedAmount";

/** Assertion-column labels, defined once: the headers, the help keys, and
 *  the Columns menu all read these. */
const ASSERTED_ON_LABEL = "Asserted On";
const ASSERTED_AMOUNT_LABEL = "Asserted Amount";

/** The how-to line for anything valued at a recorded rate — shared by the
 *  Value column help and the bands' unpriced-legs tooltip so the copy stays
 *  identical in both. */
const RATE_HELP = (
  <p className="mt-1.5">
    To update a rate, tell the agent what one unit of the holding is worth now in your main currency, for example: "1
    USD is 0.92 EUR."
  </p>
);

/** What each money/meta column means, keyed by its label; shown behind the
 *  little info marker next to the header (the Account column needs none). */
const COLUMN_HELP: Record<string, ReactNode> = {
  Holding:
    "What the account actually holds: cash in its own currency, shares, or crypto. Exactly as recorded in the ledger, before any conversion.",
  [ASSERTED_ON_LABEL]: (
    <div>
      <p>
        When the ledger balance was last confirmed to match the real account balance. A dash means it was never
        confirmed.
      </p>
      <p className="mt-1.5">
        To confirm, tell the agent the actual account balance, for example: "My cash balance is 200 EUR."
      </p>
    </div>
  ),
  [ASSERTED_AMOUNT_LABEL]: (
    <div>
      <p>
        The ledger balance that was last confirmed to match the real account balance, in the account's own currency. A
        dash means it was never confirmed.
      </p>
      <p className="mt-1.5">
        To confirm, tell the agent the actual account balance, for example: "My cash balance is 200 EUR."
      </p>
    </div>
  ),
  Value: (
    <div>
      <p>
        What the holding is worth in your main currency, at the latest rate recorded in the ledger. A ~ means the value
        was converted and is an estimate.
      </p>
      {RATE_HELP}
    </div>
  ),
};

/** A visible little info marker; hovering it explains the spot it marks —
 *  the column help for its label by default, or the given children.
 *  `inline` renders it for use INSIDE a sort pill: a nested <button> would
 *  be invalid DOM, and a labeled widget would pollute the pill's
 *  accessible name, so the inline marker is a decorative hover-only span
 *  (data-slot="column-help"), hidden from the a11y tree. The standalone
 *  Button variant keeps full keyboard access where it is used (the bands). */
const InfoTip: FC<{ label: string; inline?: boolean; children?: ReactNode }> = ({
  label,
  inline = false,
  children,
}) => (
  // No local TooltipProvider: the app-level provider (App.tsx) owns the
  // dwell delay and the shared warm-up across neighboring tooltips.
  <Tooltip>
    <TooltipTrigger
      render={
        inline ? (
          <span
            aria-hidden
            data-slot="column-help"
            className="flex size-5 items-center justify-center text-muted-foreground/70 hover:text-foreground"
          />
        ) : (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`About ${label}`}
            className="size-5 text-muted-foreground/70 hover:text-foreground"
          />
        )
      }
    >
      <InfoIcon className="size-3.5" />
    </TooltipTrigger>
    <TooltipContent side="top" className="max-w-60">
      {children ?? COLUMN_HELP[label]}
    </TooltipContent>
  </Tooltip>
);

/** The money/meta columns put the biggest figures first on the first click
 *  (the vendored header ignores `sortDescFirst`, so the sorting handler
 *  applies the policy). */
const DESC_FIRST: ReadonlySet<string> = new Set(["asserted", "assertedAmount", "holding", "value"]);

/** A money/meta column header: the info marker rides inside the sort pill
 *  (the vendored header's icon slot), so marker and label right-align over
 *  the figures as one unit and the marker can never detach from its label,
 *  however narrow the column is resized. */
const InfoColumnHeader: FC<{
  column: Column<DataGridFeatures, AccountBalance, unknown>;
  title: string;
}> = ({ column, title }) => (
  <div className="flex items-center justify-end">
    <AppColumnHeader column={column} title={title} icon={<InfoTip inline label={title} />} />
  </div>
);

/** The accounts data grid columns. Sorting semantics:
 *  - Account: A-Z on the full path (the table's default sort);
 *  - Holding: by the primary native quantity — a plain number sort, so the
 *    column reads monotonic (commodity grouping was tried and read as
 *    disorder);
 *  - Asserted On: by date, most recent first on the first click;
 *    never-asserted rows sink to the end;
 *  - Asserted Amount: by quantity, like Holding; never-asserted rows
 *    count as zero;
 *  - Value: by market value.
 *  The two assertion columns hide by default (the tables stay narrow) and
 *  toggle on via the header's Columns menu; the other three are the page's
 *  spine and cannot be hidden. */
const columns: ColumnDef<DataGridFeatures, AccountBalance>[] = [
  {
    id: "account",
    accessorFn: (row) => row.name,
    enableHiding: false,
    sortFn: "text",
    size: COLUMN_SIZES.account,
    minSize: COLUMN_MIN_SIZES.account,
    header: ({ column }) => <AppColumnHeader column={column} title="Account" />,
    // The chat's account pill, like the register: the full path, truncating
    // inside the pill on a fixed column (complete path in the tooltip).
    cell: ({ row }) => (
      <div className="flex h-6 items-center">
        <MentionPill truncate type="account" label={row.original.name} />
      </div>
    ),
    meta: { headerTitle: "Account", skeleton: <Skeleton className="h-6 w-52 rounded-3xl" /> },
  },
  {
    id: "asserted",
    accessorFn: (row) => row.assertedOn ?? "",
    sortFn: "text",
    size: COLUMN_SIZES.asserted,
    minSize: COLUMN_MIN_SIZES.asserted,
    header: ({ column }) => <InfoColumnHeader column={column} title={ASSERTED_ON_LABEL} />,
    // The journal's own ISO date, verbatim — unambiguous, and what you see
    // is literally what the column sorts by. An em dash marks accounts whose
    // balance was never asserted.
    cell: ({ row }) => row.original.assertedOn ?? "—",
    meta: {
      headerTitle: ASSERTED_ON_LABEL,
      cellClassName: "text-right tabular-nums",
      skeleton: <Skeleton className="ms-auto h-4 w-20" />,
    },
  },
  {
    id: "assertedAmount",
    accessorFn: (row) => row.assertedAmount?.quantity ?? 0,
    sortFn: "basic",
    size: COLUMN_SIZES.assertedAmount,
    minSize: COLUMN_MIN_SIZES.assertedAmount,
    header: ({ column }) => <InfoColumnHeader column={column} title={ASSERTED_AMOUNT_LABEL} />,
    // The asserted native amount, formatted like Holding; an em dash marks
    // accounts never asserted (or an assertion whose amount the journal
    // export didn't carry), the same placeholder as the date column.
    cell: ({ row }) =>
      row.original.assertedAmount ? formatAmount(row.original.assertedAmount, "native", navigator.language) : "—",
    meta: {
      headerTitle: ASSERTED_AMOUNT_LABEL,
      cellClassName: "text-right tabular-nums",
      skeleton: <Skeleton className="ms-auto h-4 w-24" />,
    },
  },
  {
    id: "holding",
    accessorFn: (row) => row.amounts[0]?.quantity ?? 0,
    sortFn: "basic",
    enableHiding: false,
    size: COLUMN_SIZES.holding,
    minSize: COLUMN_MIN_SIZES.holding,
    header: ({ column }) => <InfoColumnHeader column={column} title="Holding" />,
    cell: ({ row }) => formatAmounts(row.original.amounts, "native", navigator.language),
    meta: {
      headerTitle: "Holding",
      cellClassName: "text-right tabular-nums",
      skeleton: <Skeleton className="ms-auto h-4 w-24" />,
    },
  },
  {
    id: "value",
    accessorFn: (row) => row.value[0]?.quantity ?? 0,
    sortFn: "basic",
    enableHiding: false,
    size: COLUMN_SIZES.value,
    minSize: COLUMN_MIN_SIZES.value,
    header: ({ column }) => <InfoColumnHeader column={column} title="Value" />,
    cell: ({ row }) => formatValue(row.original, navigator.language),
    meta: {
      headerTitle: "Value",
      cellClassName: "text-right tabular-nums",
      skeleton: <Skeleton className="ms-auto h-4 w-24" />,
    },
  },
];

/** Stable empty row list for the loading grid. */
const NO_ROWS: AccountBalance[] = [];

/** One section's accounts on the stock data grid. Sorting is local (each
 *  section sorts independently); visibility and sizing come in from the
 *  page config, and resizes bubble back up so every section stays aligned
 *  on the same column widths. */
const AccountsGrid: FC<{
  rows: AccountBalance[];
  search: string;
  config: NetWorthTableConfig;
  onSizingChange: (updater: Updater<Record<string, number>>) => void;
  loading?: boolean;
}> = ({ rows, search, config, onSizingChange, loading = false }) => {
  // A-Z on the account path until the user picks another column; a click
  // always leaves some direction active (no unsorted third state).
  const [sorting, setSorting] = useState<SortingState>([{ id: "account", desc: false }]);
  const table = useAppTable({
    data: rows,
    columns,
    getRowId: (row) => row.name,
    state: {
      sorting,
      globalFilter: search,
      columnVisibility: config.visibility,
      columnSizing: config.sizing,
    },
    onSortingChange: twoStateSortingChange(setSorting, DESC_FIRST),
    onColumnSizingChange: onSizingChange,
    // The account path is the only searchable field (and the only column
    // the global filter needs to visit); substring match, case-insensitive.
    getColumnCanGlobalFilter: (column) => column.id === "account",
    globalFilterFn: (row, _columnId, value) => row.original.name.toLowerCase().includes(String(value).toLowerCase()),
  });
  return (
    <DataGrid
      table={table}
      recordCount={table.getFilteredRowModel().rows.length}
      isLoading={loading}
      emptyMessage="No matching accounts"
      tableLayout={{
        dense: true,
        columnsResizable: true,
        columnsResizeMode: "onChange",
        width: "fixed",
      }}
    >
      <DataGridContainer>
        <DataGridTable />
      </DataGridContainer>
    </DataGrid>
  );
};

/** The soft summary-band surface shared by the section headers and the Net
 *  line: label left, hledger's figure right, on the app's muted panel. The
 *  label centers on the figure block, so it stays mid-band when the figure
 *  grows a second (muted) line. No side margins: the band's edges sit on
 *  the page's content edges, flush with the grid — one left line under the
 *  pinned title, one right line under the Columns button. */
const BAND_CLASS = "flex items-center justify-between gap-8 rounded-xl bg-muted/50 px-5 py-4";

/** A summary band's figure. When the valuation could not fold every leg
 *  into the base currency, the base leg leads at the band's weight and the
 *  leftover legs sit smaller and muted on their own line under it, marked
 *  with the same info icon as the column help. A figure with no split
 *  renders exactly as before. */
const BandValue: FC<{ figure: NetWorthTotal; baseCommodity: string | null }> = ({ figure, baseCommodity }) => {
  const { lead, tail } = splitValueLead(figure, navigator.language, baseCommodity);
  if (!tail) return <div className="shrink-0 text-right text-lg font-semibold tabular-nums">{lead}</div>;
  return (
    <div className="min-w-0 text-right tabular-nums">
      <div className="text-lg font-semibold">{lead}</div>
      {/* gap-1.5 + the icon button's own padding lands the icon-to-text
          distance on the column headers' rhythm. */}
      <div className="flex items-center justify-end gap-1.5">
        <InfoTip label="other currencies">
          {/* One wrapper like every COLUMN_HELP entry: the tooltip content
              lays its direct children out in a row. */}
          <div>
            <p>No rate recorded yet to value these in your main currency.</p>
            {RATE_HELP}
          </div>
        </InfoTip>
        <span className="text-sm font-medium text-muted-foreground">{tail}</span>
      </div>
    </div>
  );
};

/** One `bs` section: its hledger name and total over its accounts grid,
 *  wrapped in a labeled region so each section's table stays addressable. */
const SheetSection: FC<{
  section: NetWorthSection;
  baseCommodity: string | null;
  search: string;
  config: NetWorthTableConfig;
  onSizingChange: (updater: Updater<Record<string, number>>) => void;
}> = ({ section, baseCommodity, search, config, onSizingChange }) => (
  <section aria-label={section.name}>
    <div className={`mt-8 mb-2 ${BAND_CLASS}`}>
      <h2 className="text-lg font-semibold">{section.name}</h2>
      <BandValue figure={section.total} baseCommodity={baseCommodity} />
    </div>
    <AccountsGrid rows={section.rows} search={search} config={config} onSizingChange={onSizingChange} />
  </section>
);

/** The loading state mirrors the loaded page: everything that needs no data
 *  (the Assets band, the column labels, the Net band) is up immediately, and
 *  skeletons stand in only for the figures and rows hledger is still
 *  computing — the grid's own per-column skeletons, under the real headers,
 *  following the page's visibility state (known before any data arrives) so
 *  the header doesn't jump when rows land. Assets and Net always exist on a
 *  balance sheet; Liabilities may not, so no placeholder for it. */
const SheetSkeleton: FC<{
  config: NetWorthTableConfig;
  onSizingChange: (updater: Updater<Record<string, number>>) => void;
}> = ({ config, onSizingChange }) => (
  <div role="status" aria-label="Loading accounts">
    <div className={`mt-8 mb-2 ${BAND_CLASS}`}>
      <h2 className="text-lg font-semibold">Assets</h2>
      <Skeleton className="h-5 w-36 self-center" />
    </div>
    <AccountsGrid rows={NO_ROWS} search="" config={config} onSizingChange={onSizingChange} loading />
    <div className={`mt-8 ${BAND_CLASS}`}>
      <div className="text-lg font-semibold">Net Worth</div>
      <Skeleton className="h-5 w-32" />
    </div>
  </div>
);

// "No transactions yet", not "no accounts": the default workspace already
// declares accounts on first start — what an empty report is missing is
// postings to give them balances.
const SheetEmpty: FC = () => (
  <PageEmpty
    icon={WalletIcon}
    title="No transactions yet"
    description="Ask the agent to record your first transactions and your net worth will show up here"
  />
);

/** The Net Worth page, shown in place of the chat thread. Laid out like
 *  a Claude-app content page: a large title sitting well below the window
 *  chrome (clear of the drag region and the sidebar toggle), the search box
 *  and Columns menu beside it, pinned; the sections and the Net line
 *  scroll. The body is exactly as wide as the tables' columns (never below
 *  the default page cap), so showing the assertion pair or resizing a
 *  column widens the page — past the window width the page scrolls
 *  horizontally, like the Transactions register. `active` = the page is the
 *  visible view; the layout keeps it mounted while hidden, and a hidden
 *  page defers its idle-edge refetches to the next show. */
export const NetWorthView: FC<{ active?: boolean }> = ({ active = true }) => {
  const sheet = useNetWorth(active);
  const [search, setSearch] = useState("");
  // One config (visibility + sizing) drives every section grid and the
  // loading skeleton, saved debounced and restored on the next visit.
  const { config, applyConfig } = useTableConfig(loadTableConfig, saveTableConfig);
  const onSizingChange = (updater: Updater<Record<string, number>>) => applyConfig("sizing", updater);
  // hledger emits a section even when it has no accounts; an empty side
  // renders nothing rather than a fabricated zero.
  const sections = sheet?.sections.filter((s) => s.rows.length > 0) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-4xl shrink-0 items-center justify-between gap-8 px-8 pt-16 pb-4">
        <h1 className="whitespace-nowrap text-3xl font-semibold">Net Worth</h1>
        {(sheet === null || sections.length > 0) && (
          // min-w-0 (not shrink-0): when the window narrows, the search
          // field gives way so the Columns button never clips.
          <div className="flex min-w-0 items-center gap-2">
            <SearchField subject="accounts" value={search} onValueChange={setSearch} className="w-64 min-w-0" />
            {/* Only the assertion pair toggles; Account, Holding, and Value
                are the page's spine and never leave. */}
            <ColumnsMenu<OptionalColumnId>
              columns={[
                { id: "asserted", label: ASSERTED_ON_LABEL },
                { id: "assertedAmount", label: ASSERTED_AMOUNT_LABEL },
              ]}
              visibility={config.visibility}
              onToggle={(id, shown) => applyConfig("visibility", (prev) => ({ ...prev, [id]: shown }))}
            />
          </div>
        )}
      </div>
      {/* scroll-fade-t-6: content dissolves over 24px as it slides under the
          pinned search field, same as the chat viewport's top fade. */}
      <div className="scroll-fade-t scroll-fade-t-6 min-h-0 flex-1 overflow-auto">
        {/* The empty view sits directly in the scroll container (not the
            width column) so it can center itself in the body's height. */}
        {sheet !== null && sections.length === 0 ? (
          <SheetEmpty />
        ) : (
          // The body is exactly as wide as the tables' columns (never below
          // the 52rem page floor — the same span as the toolbar's content
          // box, title edge to Columns edge); past the window width the
          // page scrolls horizontally, like Transactions.
          <div className="mx-auto pb-12" style={{ width: `max(52rem, ${tableWidth(config)}px)` }}>
            {sheet === null ? (
              <SheetSkeleton config={config} onSizingChange={onSizingChange} />
            ) : (
              <>
                {sections.map((section) => (
                  <SheetSection
                    key={section.name}
                    section={section}
                    baseCommodity={sheet.baseCommodity}
                    search={search}
                    config={config}
                    onSizingChange={onSizingChange}
                  />
                ))}
                {/* The closing Net band, straight from hledger's own net. */}
                <div className={`mt-8 ${BAND_CLASS}`}>
                  <div className="text-lg font-semibold">Net Worth</div>
                  <BandValue figure={sheet.net} baseCommodity={sheet.baseCommodity} />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
