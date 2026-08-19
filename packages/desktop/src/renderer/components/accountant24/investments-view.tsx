"use client";

// Full-page Investments view: every priced holding, one row per commodity,
// with a portfolio summary on top — total invested (cost basis), market
// value, and unrealized P&L with its return. The table is the holdings grid
// (investments-table.tsx); this page brings its own persisted column config
// and its own summary. Laid out like the other report pages: a large title
// below the window chrome, the search box and Columns menu beside it,
// pinned; the body is exactly as wide as the grid's columns (never below
// the default page cap). All figures are hledger-computed; only the
// presentation happens here. Data refreshes when the agent finishes a turn.

import type { Updater } from "@tanstack/react-table";
import { PlusIcon, TrendingUpIcon } from "lucide-react";
import { type FC, type ReactNode, useState } from "react";
import { PageEmpty } from "@/components/accountant24/page-empty";
import { useTableConfig } from "@/components/accountant24/table-config";
import { Skeleton } from "@/components/shadcn/skeleton";
import { formatAmount, formatAmounts } from "@/lib/amountFormat";
import { summarizePnl } from "@/lib/investments-summary";
import { ColumnsMenu } from "./columns-menu";
import {
  type InvestmentsTableConfig,
  investmentsTableWidth,
  loadInvestmentsTableConfig,
  saveInvestmentsTableConfig,
} from "./investments-columns";
import { DASH, InvestmentsGrid, withAllocation } from "./investments-table";
import { SearchField } from "./search-field";
import { useInvestments } from "./use-investments";

/** The columns the Columns menu can toggle; Commodity, Quantity, Price, and
 *  Value are the page's spine and never leave. */
type OptionalColumnId = "cost" | "pnl" | "allocation";

const OPTIONAL_COLUMNS: { id: OptionalColumnId; label: string }[] = [
  { id: "cost", label: "Cost" },
  { id: "pnl", label: "P&L" },
  { id: "allocation", label: "Allocation" },
];

/** One portfolio summary stat: label over the figure, on the app's muted
 *  panel (the same surface as the Net Worth bands). */
const StatCard: FC<{ label: string; sub?: string; children: ReactNode }> = ({ label, sub, children }) => (
  <div className="flex flex-col gap-1 rounded-xl bg-muted/50 px-5 py-4">
    <div className="text-sm font-medium text-muted-foreground">{label}</div>
    <div className="text-xl font-semibold tabular-nums">{children}</div>
    {sub !== undefined && <div className="text-sm font-medium text-muted-foreground tabular-nums">{sub}</div>}
  </div>
);

/** A signed figure: gains read "+4.40 EUR" so the direction never hides in
 *  the digits; zero stays unsigned. */
const signed = (amount: { quantity: number; commodity: string; precision: number }) =>
  `${amount.quantity > 0 ? "+" : ""}${formatAmount(amount, "value", navigator.language)}`;

const formatPercent = (p: number) =>
  new Intl.NumberFormat(navigator.language, { style: "percent", maximumFractionDigits: 1 }).format(p);

/** The loading state mirrors the loaded page: the three summary cards up as
 *  skeletons, the grid's own per-column skeletons under the real headers,
 *  following the page's visibility state (known before any data arrives). */
const InvestmentsSkeleton: FC<{
  config: InvestmentsTableConfig;
  onSizingChange: (updater: Updater<Record<string, number>>) => void;
}> = ({ config, onSizingChange }) => (
  <div role="status" aria-label="Loading holdings">
    <div className="grid grid-cols-3 gap-4">
      <Skeleton className="h-20 rounded-xl" />
      <Skeleton className="h-20 rounded-xl" />
      <Skeleton className="h-20 rounded-xl" />
    </div>
    <div className="mt-8" />
    <InvestmentsGrid rows={[]} search="" config={config} onSizingChange={onSizingChange} loading />
  </div>
);

// "No holdings yet", not "no journal": the empty state points at the agent
// either way — the ledger may not exist, or hold nothing priced.
const InvestmentsEmpty: FC<{ onNewChat?: () => void }> = ({ onNewChat }) => (
  <PageEmpty
    icon={TrendingUpIcon}
    title="No investments yet"
    description='Ask the agent to record your holdings — for example "I bought 10 SXR8 at 200 EUR" — and they will show up here'
    // Asking happens in a chat — the button carries the sidebar's New Chat
    // action (same label and icon), teaching where that action lives.
    action={onNewChat && { label: "New Chat", icon: PlusIcon, onClick: onNewChat }}
  />
);

/** The Investments page, shown in place of the chat thread. `active` = the
 *  page is the visible view; the layout keeps it mounted while hidden, and
 *  a hidden page defers its idle-edge refetches to the next show.
 *  `onNewChat` backs the empty state's New Chat button. */
export const InvestmentsView: FC<{ active?: boolean; onNewChat?: () => void }> = ({ active = true, onNewChat }) => {
  const sheet = useInvestments(active);
  const [search, setSearch] = useState("");
  // This page's own config (visibility + sizing), saved debounced and
  // restored on the next visit — independent from the Net Worth page's.
  const { config, applyConfig } = useTableConfig(loadInvestmentsTableConfig, saveInvestmentsTableConfig);
  const onSizingChange = (updater: Updater<Record<string, number>>) => applyConfig("sizing", updater);
  const rows = sheet === null ? [] : withAllocation(sheet);
  const pnl = sheet === null ? null : summarizePnl(sheet.rows, sheet.baseCommodity);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-4xl shrink-0 items-center justify-between gap-8 px-8 pt-16 pb-4">
        <h1 className="whitespace-nowrap text-3xl font-semibold">Investments</h1>
        {(sheet === null || sheet.rows.length > 0) && (
          // min-w-0 (not shrink-0): when the window narrows, the search
          // field gives way so the Columns button never clips.
          <div className="flex min-w-0 items-center gap-2">
            <SearchField subject="holdings" value={search} onValueChange={setSearch} className="w-64 min-w-0" />
            {/* Only the optional columns toggle: Cost, P&L, and Allocation. */}
            <ColumnsMenu<OptionalColumnId>
              columns={OPTIONAL_COLUMNS}
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
        {sheet !== null && sheet.rows.length === 0 ? (
          <InvestmentsEmpty onNewChat={onNewChat} />
        ) : (
          // The body is exactly as wide as the grid's columns (never below
          // the 52rem page floor — the same span as the toolbar's content
          // box, title edge to Columns edge); past the window width the
          // page scrolls horizontally, like the other report pages.
          <div className="mx-auto pb-12" style={{ width: `max(52rem, ${investmentsTableWidth(config)}px)` }}>
            {sheet === null ? (
              <InvestmentsSkeleton config={config} onSizingChange={onSizingChange} />
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <StatCard label="Total Invested">
                    {sheet.totalCostBasis.length > 0
                      ? formatAmounts(sheet.totalCostBasis, "value", navigator.language)
                      : DASH}
                  </StatCard>
                  <StatCard label="Market Value">
                    {sheet.totalMarketValue.length > 0
                      ? formatAmounts(sheet.totalMarketValue, "value", navigator.language)
                      : DASH}
                  </StatCard>
                  <StatCard
                    label="Unrealized P&L"
                    sub={pnl && pnl.percent !== null ? signedPct(pnl.percent) : undefined}
                  >
                    {pnl ? signed(pnl.amount) : DASH}
                  </StatCard>
                </div>
                <div className="mt-8">
                  <InvestmentsGrid rows={rows} search={search} config={config} onSizingChange={onSizingChange} />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/** A signed percentage for the P&L card: "+1.2%" reads as a gain, "-0.4%"
 *  as a loss; zero stays unsigned. */
function signedPct(p: number): string {
  return `${p > 0 ? "+" : ""}${formatPercent(p)}`;
}
