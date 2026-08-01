"use client";

// Full-page Net Worth view: `hledger bs` rendered as data — an Assets
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
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, InfoIcon, SearchIcon } from "lucide-react";
import { type FC, type ReactNode, useState } from "react";
import { Button } from "@/components/shadcn/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/shadcn/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/shadcn/input-group";
import { Skeleton } from "@/components/shadcn/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/shadcn/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/shadcn/tooltip";
import { formatAmounts, formatValue } from "@/lib/amountFormat";
import type { AccountBalance, NetWorthSection } from "@/rpc/types";
import { useNetWorth } from "./use-net-worth";

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

/** What each money/meta column means, keyed by its label; shown behind the
 *  little info marker next to the header (the Account column needs none). */
const COLUMN_HELP: Record<string, ReactNode> = {
  Holding:
    "What the account actually holds: cash in its own currency, shares, or crypto. Exactly as recorded in the ledger, before any conversion.",
  "Last Balance Assertion": (
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
  Value: (
    <div>
      <p>
        What the holding is worth in your main currency, at the latest rate recorded in the ledger. A ~ means the value
        was converted and is an estimate.
      </p>
      <p className="mt-1.5">
        To update a rate, tell the agent what one unit of the holding is worth now in your main currency, for example:
        "1 USD is 0.92 EUR."
      </p>
    </div>
  ),
};

/** A visible little info marker; hovering it explains the column. A separate
 *  target from the sort button, so the help is discoverable and sorting
 *  stays a plain click. */
const InfoTip: FC<{ label: string }> = ({ label }) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={`About ${label}`}
            className="size-5 text-muted-foreground/70 hover:text-foreground"
          />
        }
      >
        <InfoIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-60">
        {COLUMN_HELP[label]}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

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
      <div className="flex items-center justify-end">
        <InfoTip label="Last Balance Assertion" />
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
      <div className="flex items-center justify-end">
        <InfoTip label="Holding" />
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
      <div className="flex items-center justify-end">
        <InfoTip label="Value" />
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

/** The soft summary-band surface shared by the section headers and the Net
 *  line: label left, hledger's figure right, on the app's muted panel. px-5
 *  inside mx-3 keeps the text on the px-8 line of the page title. */
const BAND_CLASS = "mx-3 flex items-baseline justify-between gap-8 rounded-xl bg-muted/50 px-5 py-4";

/** One `bs` section: its hledger name and total over its accounts table. */
const SheetSection: FC<{ section: NetWorthSection; search: string }> = ({ section, search }) => (
  <section>
    <div className={`mt-8 mb-2 ${BAND_CLASS}`}>
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

/** The loading state mirrors the loaded page: everything that needs no data
 *  (the Assets band, the column labels, the Net band) is up immediately, and
 *  skeletons stand in only for the figures and rows hledger is still
 *  computing. Assets and Net always exist on a balance sheet; Liabilities
 *  may not, so no placeholder for it. */
const SheetSkeleton: FC = () => (
  <div role="status" aria-label="Loading accounts">
    <div className={`mt-8 mb-2 ${BAND_CLASS}`}>
      <h2 className="text-xl font-semibold">Assets</h2>
      <Skeleton className="h-5 w-36 self-center" />
    </div>
    <div className="px-5">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-full">
              <Button variant="ghost" size="sm" className="-ml-3" disabled>
                Account
                <ChevronsUpDownIcon className="text-muted-foreground/60" />
              </Button>
            </TableHead>
            {["Last Balance Assertion", "Holding", "Value"].map((label) => (
              <TableHead key={label}>
                <div className="flex items-center justify-end">
                  <InfoTip label={label} />
                  <Button variant="ghost" size="sm" className="-mr-3" disabled>
                    {label}
                    <ChevronsUpDownIcon className="text-muted-foreground/60" />
                  </Button>
                </div>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {SKELETON_ROWS.map((row) => (
            <TableRow key={row} className="hover:bg-transparent">
              <TableCell className="w-full py-2.5">
                <Skeleton className="h-4 w-56" />
              </TableCell>
              <TableCell className="py-2.5">
                <Skeleton className="ml-auto h-4 w-20" />
              </TableCell>
              <TableCell className="py-2.5">
                <Skeleton className="ml-auto h-4 w-24" />
              </TableCell>
              <TableCell className="py-2.5">
                <Skeleton className="ml-auto h-4 w-24" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    <div className={`mt-8 ${BAND_CLASS}`}>
      <div className="text-xl font-semibold">Net Worth</div>
      <Skeleton className="h-5 w-32 self-center" />
    </div>
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

/** The Net Worth page, shown in place of the chat thread. Laid out like
 *  a Claude-app content page: a centered column of capped width, a large
 *  title sitting well below the window chrome (clear of the drag region and
 *  the sidebar toggle), and the search box under it. Title and search are
 *  pinned; the sections and the Net line scroll. */
export const NetWorthView: FC = () => {
  const sheet = useNetWorth();
  const [search, setSearch] = useState("");
  // hledger emits a section even when it has no accounts; an empty side
  // renders nothing rather than a fabricated zero.
  const sections = sheet?.sections.filter((s) => s.rows.length > 0) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-4xl shrink-0 items-center justify-between gap-8 px-8 pt-16 pb-4">
        <h1 className="text-3xl font-semibold">Net Worth</h1>
        {(sheet === null || sections.length > 0) && (
          <InputGroup className="w-64">
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
              {/* The closing Net band, straight from hledger's own net. */}
              <div className={`mt-8 ${BAND_CLASS}`}>
                <div className="text-xl font-semibold">Net Worth</div>
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
