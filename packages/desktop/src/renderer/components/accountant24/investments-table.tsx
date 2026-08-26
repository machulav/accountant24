"use client";

// The priced-holdings table for the Investments view: one row per commodity
// on the stock ReUI data grid (TanStack v9), the app-styled two-state sort
// headers, resizable columns, per-column loading skeletons, and the
// filtered-out empty state. The column definitions, the help copy, and the
// grid live here; the page brings its own persisted config (visibility +
// sizing) and its own summary cards.
//
// All figures are hledger-computed (src/main/ledger-json.ts); only the
// presentation happens here.

import type { Column, ColumnDef, SortingState, Updater } from "@tanstack/react-table";
import { InfoIcon } from "lucide-react";
import { type FC, type ReactNode, useState } from "react";
import { AppColumnHeader } from "@/components/accountant24/app-column-header";
import { twoStateSortingChange, useAppTable } from "@/components/accountant24/use-app-table";
import { DataGrid, DataGridContainer, type DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { Button } from "@/components/shadcn/button";
import { Skeleton } from "@/components/shadcn/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { formatAmount } from "@/lib/amountFormat";
import type { InvestmentHolding, NetWorthInvestments } from "@/rpc/types";
import { INVESTMENT_COLUMN_MIN_SIZES, INVESTMENT_COLUMN_SIZES } from "./investments-columns";
import type { TableConfig } from "./table-config";

/** The how-to line for anything valued at a recorded price — shared by the
 *  Value column help and the bands' unpriced-legs tooltip so the copy stays
 *  identical in both. */
export const PRICE_HELP = (
  <p className="mt-1.5">
    To update a price, tell the agent what one unit of the holding is worth now in your main currency, for example: "1
    USD is 0.92 EUR."
  </p>
);

/** What each money/meta column means, keyed by its label; shown behind the
 *  little info marker next to the header (the Account/Commodity columns need
 *  none). */
export const COLUMN_HELP: Record<string, ReactNode> = {
  Holding:
    "What the account actually holds: cash in its own currency, shares, or crypto. Exactly as recorded in the ledger, before any conversion.",
  "Asserted On": (
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
  "Asserted Amount": (
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
        What the holding is worth in your main currency, at the latest price recorded in the ledger. A ~ means the value
        was converted and is an estimate.
      </p>
      {PRICE_HELP}
    </div>
  ),
  Quantity:
    "What you hold, in the commodity's own units: shares, coins, or tokens. Exactly as recorded in the ledger, before any conversion.",
  Price: (
    <div>
      <p>
        What one unit of the commodity is worth in your main currency, at the latest price recorded in the ledger. A
        dash means no price points to your main currency.
      </p>
      {PRICE_HELP}
    </div>
  ),
  Cost: (
    <div>
      <p>
        What you paid for the holding, in your main currency: every lot's purchase price summed. A dash means the cost
        can't be stated in your main currency (a purchase priced in another currency, or a holding that arrived without
        a price).
      </p>
    </div>
  ),
  "P&L": (
    <div>
      <p>
        What the holding gained or lost so far: its current value minus what you paid. A dash means the cost is unknown.
      </p>
    </div>
  ),
  Allocation: "This holding's share of the section's total market value.",
};

/** A visible little info marker; hovering it explains the spot it marks —
 *  the column help for its label by default, or the given children.
 *  `inline` renders it for use INSIDE a sort pill: a nested <button> would
 *  be invalid DOM, and a labeled widget would pollute the pill's
 *  accessible name, so the inline marker is a decorative hover-only span
 *  (data-slot="column-help"), hidden from the a11y tree. The standalone
 *  Button variant keeps full keyboard access where it is used (the bands). */
export const InfoTip: FC<{ label: string; inline?: boolean; children?: ReactNode }> = ({
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

/** The soft summary-band surface shared by the section headers, the Net
 *  line, and the Investments page's summary cards: label left, hledger's
 *  figure right, on the app's muted panel. No side margins: the band's
 *  edges sit on the page's content edges, flush with the grid. */
export const BAND_CLASS = "flex items-center justify-between gap-8 rounded-xl bg-muted/50 px-5 py-4";

// ---- Holdings grid --------------------------------------------------------

/** A holding row plus its computed share of the section total — the one
 *  derived figure on the page, so it lives in the view model rather than
 *  the payload. */
export type HoldingRow = InvestmentHolding & { allocation: number | null };

/** The money columns read biggest-first on the first click (like the
 *  account tables); the commodity column sorts A-Z. */
const HOLDING_DESC_FIRST: ReadonlySet<string> = new Set(["quantity", "price", "value", "cost", "pnl", "allocation"]);

/** A money/meta column header for the holdings grid — same marker-inside-
 *  pill recipe as the account tables. */
const HoldingColumnHeader: FC<{
  column: Column<DataGridFeatures, HoldingRow, unknown>;
  title: string;
}> = ({ column, title }) => (
  <div className="flex items-center justify-end">
    <AppColumnHeader column={column} title={title} icon={<InfoTip inline label={title} />} />
  </div>
);

/** One em-dash cell: a figure the journal can't provide yet. */
export const DASH = "—";

const holdingColumns: ColumnDef<DataGridFeatures, HoldingRow>[] = [
  {
    id: "commodity",
    accessorFn: (row) => row.commodity,
    sortFn: "text",
    enableHiding: false,
    size: INVESTMENT_COLUMN_SIZES.commodity,
    minSize: INVESTMENT_COLUMN_MIN_SIZES.commodity,
    header: ({ column }) => <AppColumnHeader column={column} title="Commodity" />,
    cell: ({ row }) => (
      <div className="flex h-6 items-center">
        <span className="truncate font-medium">{row.original.commodity}</span>
      </div>
    ),
    meta: { headerTitle: "Commodity", skeleton: <Skeleton className="h-4 w-24" /> },
  },
  {
    id: "quantity",
    accessorFn: (row) => row.quantity.quantity,
    sortFn: "basic",
    enableHiding: false,
    size: INVESTMENT_COLUMN_SIZES.quantity,
    minSize: INVESTMENT_COLUMN_MIN_SIZES.quantity,
    header: ({ column }) => <HoldingColumnHeader column={column} title="Quantity" />,
    cell: ({ row }) => formatAmount(row.original.quantity, "native", navigator.language),
    meta: {
      headerTitle: "Quantity",
      cellClassName: "text-right tabular-nums",
      skeleton: <Skeleton className="ms-auto h-4 w-20" />,
    },
  },
  {
    id: "price",
    accessorFn: (row) => row.price?.quantity ?? 0,
    sortFn: "basic",
    enableHiding: false,
    size: INVESTMENT_COLUMN_SIZES.price,
    minSize: INVESTMENT_COLUMN_MIN_SIZES.price,
    header: ({ column }) => <HoldingColumnHeader column={column} title="Price" />,
    cell: ({ row }) => (row.original.price ? formatAmount(row.original.price, "value", navigator.language) : DASH),
    meta: {
      headerTitle: "Price",
      cellClassName: "text-right tabular-nums",
      skeleton: <Skeleton className="ms-auto h-4 w-24" />,
    },
  },
  {
    id: "value",
    accessorFn: (row) => row.marketValue?.quantity ?? 0,
    sortFn: "basic",
    enableHiding: false,
    size: INVESTMENT_COLUMN_SIZES.value,
    minSize: INVESTMENT_COLUMN_MIN_SIZES.value,
    header: ({ column }) => <HoldingColumnHeader column={column} title="Value" />,
    cell: ({ row }) =>
      row.original.marketValue ? formatAmount(row.original.marketValue, "value", navigator.language) : DASH,
    meta: {
      headerTitle: "Value",
      cellClassName: "text-right tabular-nums",
      skeleton: <Skeleton className="ms-auto h-4 w-24" />,
    },
  },
  {
    id: "cost",
    accessorFn: (row) => row.costBasis?.quantity ?? 0,
    sortFn: "basic",
    size: INVESTMENT_COLUMN_SIZES.cost,
    minSize: INVESTMENT_COLUMN_MIN_SIZES.cost,
    header: ({ column }) => <HoldingColumnHeader column={column} title="Cost" />,
    cell: ({ row }) =>
      row.original.costBasis ? formatAmount(row.original.costBasis, "value", navigator.language) : DASH,
    meta: {
      headerTitle: "Cost",
      cellClassName: "text-right tabular-nums",
      skeleton: <Skeleton className="ms-auto h-4 w-24" />,
    },
  },
  {
    id: "pnl",
    accessorFn: (row) => row.unrealizedPnl?.quantity ?? 0,
    sortFn: "basic",
    size: INVESTMENT_COLUMN_SIZES.pnl,
    minSize: INVESTMENT_COLUMN_MIN_SIZES.pnl,
    header: ({ column }) => <HoldingColumnHeader column={column} title="P&L" />,
    cell: ({ row }) =>
      row.original.unrealizedPnl ? formatAmount(row.original.unrealizedPnl, "value", navigator.language) : DASH,
    meta: {
      headerTitle: "P&L",
      cellClassName: "text-right tabular-nums",
      skeleton: <Skeleton className="ms-auto h-4 w-24" />,
    },
  },
  {
    id: "allocation",
    accessorFn: (row) => row.allocation ?? -1,
    sortFn: "basic",
    size: INVESTMENT_COLUMN_SIZES.allocation,
    minSize: INVESTMENT_COLUMN_MIN_SIZES.allocation,
    header: ({ column }) => <HoldingColumnHeader column={column} title="Allocation" />,
    // -1 sorts below any real share; a null share (no value to compare)
    // renders as a dash.
    cell: ({ row }) =>
      row.original.allocation === null
        ? DASH
        : new Intl.NumberFormat(navigator.language, { style: "percent", maximumFractionDigits: 1 }).format(
            row.original.allocation,
          ),
    meta: {
      headerTitle: "Allocation",
      cellClassName: "text-right tabular-nums",
      skeleton: <Skeleton className="ms-auto h-4 w-16" />,
    },
  },
];

/** Each holding plus its share of the section's total market value — the
 *  one derived figure on the holdings pages, so it lives in the view model
 *  rather than the payload. Null when nothing to compare against. */
export function withAllocation(investments: Pick<NetWorthInvestments, "rows" | "totalMarketValue">): HoldingRow[] {
  const total = investments.totalMarketValue[0]?.quantity;
  return investments.rows.map((row) => ({
    ...row,
    allocation:
      row.marketValue !== null && total !== undefined && total !== 0 ? row.marketValue.quantity / total : null,
  }));
}

/** The holdings data grid: one row per commodity, sorted locally like the
 *  account tables, filtered by the page's shared search box (substring on
 *  the commodity symbol). */
export const InvestmentsGrid: FC<{
  rows: HoldingRow[];
  search: string;
  config: TableConfig;
  onSizingChange: (updater: Updater<Record<string, number>>) => void;
  loading?: boolean;
}> = ({ rows, search, config, onSizingChange, loading = false }) => {
  const [sorting, setSorting] = useState<SortingState>([{ id: "value", desc: true }]);
  const table = useAppTable({
    data: rows,
    columns: holdingColumns,
    getRowId: (row) => row.commodity,
    state: { sorting, globalFilter: search, columnVisibility: config.visibility, columnSizing: config.sizing },
    onSortingChange: twoStateSortingChange(setSorting, HOLDING_DESC_FIRST),
    onColumnSizingChange: onSizingChange,
    getColumnCanGlobalFilter: (column) => column.id === "commodity",
    globalFilterFn: (row, _columnId, value) =>
      row.original.commodity.toLowerCase().includes(String(value).toLowerCase()),
  });
  return (
    <DataGrid
      table={table}
      recordCount={table.getFilteredRowModel().rows.length}
      isLoading={loading}
      emptyMessage="No matching holdings"
      tableLayout={{ dense: true, columnsResizable: true, columnsResizeMode: "onChange", width: "fixed" }}
    >
      <DataGridContainer>
        <DataGridTable />
      </DataGridContainer>
    </DataGrid>
  );
};
