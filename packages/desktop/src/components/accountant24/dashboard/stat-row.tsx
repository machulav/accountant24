import type { FC } from "react";
import { Card } from "@/components/shadcn/card";
import { formatAmount } from "@/lib/format-amount";
import type { DashboardData } from "@/rpc/types";
import { amountFor } from "./amounts";

/** Net worth, income and spend for the current month, in the dominant currency. */
export const StatRow: FC<{ data: DashboardData }> = ({ data }) => {
  const currency = data.dominantCurrency;

  return (
    <div className="grid grid-cols-3 gap-3">
      <StatTile label="Net worth" value={formatAmount(amountFor(data.netWorth, currency), currency)} />
      <StatTile label="Income this month" value={formatAmount(amountFor(data.incomeThisMonth, currency), currency)} />
      <StatTile label="Spent this month" value={formatAmount(amountFor(data.spendThisMonth, currency), currency)} />
    </div>
  );
};

const StatTile: FC<{ label: string; value: string }> = ({ label, value }) => (
  <Card className="gap-1 rounded-lg px-4 py-3 shadow-none">
    <div className="text-muted-foreground truncate text-xs">{label}</div>
    <div className="truncate text-lg leading-tight font-semibold tabular-nums">{value}</div>
  </Card>
);
