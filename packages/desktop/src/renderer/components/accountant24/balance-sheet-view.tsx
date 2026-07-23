"use client";

// Full-page Balance Sheet view: `hledger bs` rendered as data — an Assets
// and a Liabilities section (liabilities already sign-flipped positive by
// hledger), each with hledger's own total, and the hledger-computed Net as
// the classic bottom line. A pinned header carries the page title and a
// search box filtering every section by account path. Each section is a
// shadcn-style data table (TanStack Table): complete account paths in one
// color, every native holding in a muted Holding column, the market value
// (hledger's `-X` valuation in the base currency) in the Value column;
// every column sorts, A-Z on the account path by default, independently per
// section. All figures are hledger-computed; only the presentation happens
// here. Data refreshes when the agent finishes a turn.

import { useAuiState } from "@assistant-ui/react";
import {
  type Column,
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, SearchIcon } from "lucide-react";
import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/shadcn/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/shadcn/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/shadcn/input-group";
import { Skeleton } from "@/components/shadcn/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/shadcn/table";
import { formatAmounts, formatValue } from "@/lib/amountFormat";
import { ledgerApi } from "@/rpc/api";
import type { AccountBalance, BalanceSheet, BalanceSheetSection } from "@/rpc/types";

/** null = first load in flight; no section rows = loaded but empty (no
 *  journal yet or hledger failed — both render the empty state pointing at
 *  the agent). */
function useBalanceSheet(): BalanceSheet | null {
  const [data, setData] = useState<BalanceSheet | null>(null);

  const refresh = useCallback(() => {
    let cancelled = false;
    ledgerApi
      .balanceSheet()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData({ sections: [], net: { amounts: [], value: [] } });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refresh(), [refresh]);

  // Refetch on the running → idle edge (the finished turn may have posted
  // transactions). Existing rows stay up while the refresh is in flight, so
  // the list never flickers back to the skeleton. Same pattern as mentions.tsx.
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const wasRunning = useRef(isRunning);
  useEffect(() => {
    const justFinished = wasRunning.current && !isRunning;
    wasRunning.current = isRunning;
    if (justFinished) return refresh();
  }, [isRunning, refresh]);

  return data;
}

/** Clickable column header driving the table's sorting; the icon mirrors
 *  the current direction, neutral chevrons while the column is unsorted. */
const SortHeader: FC<{ column: Column<AccountBalance>; label: string; className?: string }> = ({
  column,
  label,
  className,
}) => {
  const sorted = column.getIsSorted();
  const Icon = sorted === "asc" ? ArrowUpIcon : sorted === "desc" ? ArrowDownIcon : ChevronsUpDownIcon;
  return (
    <Button variant="ghost" size="sm" className={className} onClick={() => column.toggleSorting()}>
      {label}
      <Icon className={sorted ? undefined : "text-muted-foreground/60"} />
    </Button>
  );
};

/** The accounts data table columns. Sorting semantics:
 *  - Account: A-Z on the full path (the table's default sort);
 *  - Holding: by the primary native quantity — a plain number sort, so the
 *    column reads monotonic (commodity grouping was tried and read as
 *    disorder);
 *  - Last Balance Assertion: by date, most recent first on the first
 *    click; never-asserted rows sink to the end;
 *  - Value: by market value.
 *  Money columns put the biggest figures first on the first click. */
const columns: ColumnDef<AccountBalance>[] = [
  {
    id: "account",
    accessorFn: (row) => row.name,
    header: ({ column }) => <SortHeader column={column} label="Account" className="-ml-3" />,
    cell: ({ row }) => row.original.name,
  },
  {
    id: "asserted",
    accessorFn: (row) => row.assertedOn ?? "",
    sortDescFirst: true,
    header: ({ column }) => (
      <div className="text-right">
        <SortHeader column={column} label="Last Balance Assertion" className="-mr-3" />
      </div>
    ),
    // The journal's own ISO date, verbatim — unambiguous, and what you see
    // is literally what the column sorts by. An em dash marks accounts whose
    // balance was never asserted.
    cell: ({ row }) => row.original.assertedOn ?? "\u2014",
  },
  {
    id: "holding",
    accessorFn: (row) => row.amounts[0]?.quantity ?? 0,
    sortDescFirst: true,
    header: ({ column }) => (
      <div className="text-right">
        <SortHeader column={column} label="Holding" className="-mr-3" />
      </div>
    ),
    cell: ({ row }) => formatAmounts(row.original.amounts, "native", navigator.language),
  },
  {
    id: "value",
    accessorFn: (row) => row.value[0]?.quantity ?? 0,
    sortDescFirst: true,
    header: ({ column }) => (
      <div className="text-right">
        <SortHeader column={column} label="Value" className="-mr-3" />
      </div>
    ),
    cell: ({ row }) => formatValue(row.original, navigator.language),
  },
];

// py-2.5 keeps the pre-table row density; the stock p-3 cells read too airy
// for this dense money list.
const CELL_CLASS: Record<string, string> = {
  account: "w-full py-2.5",
  holding: "py-2.5 text-right tabular-nums",
  asserted: "py-2.5 text-right tabular-nums",
  value: "py-2.5 text-right tabular-nums",
};

const AccountsTable: FC<{ rows: AccountBalance[]; search: string; label: string }> = ({ rows, search, label }) => {
  // A-Z on the account path until the user picks another column; a click
  // always leaves some direction active (no unsorted third state).
  const [sorting, setSorting] = useState<SortingState>([{ id: "account", desc: false }]);
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    enableSortingRemoval: false,
    // The account path is the only searchable field; substring match,
    // case-insensitive.
    globalFilterFn: (row, _columnId, value) => row.original.name.toLowerCase().includes(String(value).toLowerCase()),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <Table aria-label={label}>
      {/* The header row is labels, not data — no hover highlight. */}
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id} className="hover:bg-transparent">
            {headerGroup.headers.map((header) => (
              <TableHead key={header.id} className={header.column.id === "account" ? "w-full" : undefined}>
                {flexRender(header.column.columnDef.header, header.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
              No matching accounts
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  className={CELL_CLASS[cell.column.id]}
                  title={cell.column.id === "account" ? row.original.name : undefined}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
};

/** One `bs` section: its hledger name and total over its accounts table. */
const SheetSection: FC<{ section: BalanceSheetSection; search: string }> = ({ section, search }) => (
  <section>
    <div className="flex items-baseline justify-between gap-8 px-8 pt-8 pb-2">
      <h2 className="text-xl font-semibold">{section.name}</h2>
      <div className="shrink-0 text-right text-lg font-semibold tabular-nums">
        {formatValue(section.total, navigator.language)}
      </div>
    </div>
    {/* px-5: with the cells' own px-3, the table text lines up with the px-8
        headings. */}
    <div className="px-5">
      <AccountsTable rows={section.rows} search={search} label={section.name} />
    </div>
  </section>
);

const SKELETON_ROWS = ["s1", "s2", "s3", "s4", "s5", "s6"];

const SheetSkeleton: FC = () => (
  <div role="status" aria-label="Loading accounts" className="flex flex-col gap-5 px-8 pt-8">
    {SKELETON_ROWS.map((row) => (
      <div key={row} className="flex items-center justify-between gap-8">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-4 w-24" />
      </div>
    ))}
  </div>
);

const SheetEmpty: FC = () => (
  <Empty>
    <EmptyHeader>
      <EmptyTitle>No accounts yet</EmptyTitle>
      <EmptyDescription>
        Ask the agent to record your first transaction and your accounts will show up here
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

/** The Balance Sheet page, shown in place of the chat thread. Laid out like
 *  a Claude-app content page: a centered column of capped width, a large
 *  title sitting well below the window chrome (clear of the drag region and
 *  the sidebar toggle), and the search box under it. Title and search are
 *  pinned; the sections and the Net line scroll. */
export const BalanceSheetView: FC = () => {
  const sheet = useBalanceSheet();
  const [search, setSearch] = useState("");
  // hledger emits a section even when it has no accounts; an empty side
  // renders nothing rather than a fabricated zero.
  const sections = sheet?.sections.filter((s) => s.rows.length > 0) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto w-full max-w-4xl shrink-0 px-8 pt-16 pb-4">
        <h1 className="text-3xl font-semibold">Balance Sheet</h1>
        {sections.length > 0 && (
          <InputGroup className="mt-6">
            <InputGroupInput
              type="search"
              placeholder="Search accounts"
              aria-label="Search accounts"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
          </InputGroup>
        )}
      </div>
      {/* scroll-fade-t-6: content dissolves over 24px as it slides under the
          pinned search field, same as the chat viewport's top fade. */}
      <div className="scroll-fade-t scroll-fade-t-6 min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl pb-12">
          {sheet === null ? (
            <SheetSkeleton />
          ) : sections.length === 0 ? (
            <SheetEmpty />
          ) : (
            <>
              {sections.map((section) => (
                <SheetSection key={section.name} section={section} search={search} />
              ))}
              {/* The closing Net band, straight from hledger's own net — a
                  soft muted panel like the app's other surfaces (search
                  field, composer) instead of a bare rule. px-5 inside mx-3
                  keeps the text on the px-8 line of the headings above. */}
              <div className="mx-3 mt-10 flex items-baseline justify-between gap-8 rounded-xl bg-muted/50 px-5 py-4">
                <div className="text-xl font-semibold">Net</div>
                <div className="shrink-0 text-right text-lg font-semibold tabular-nums">
                  {formatValue(sheet.net, navigator.language)}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
