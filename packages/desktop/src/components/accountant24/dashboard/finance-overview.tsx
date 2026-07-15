import type { FC } from "react";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { CategoryBars } from "./category-bars";
import { IncomeExpenseChart } from "./income-expense-chart";
import { NetWorthChart } from "./net-worth-chart";
import { StatRow } from "./stat-row";

/** The main-page finance overview. Renders nothing while loading (no skeleton:
 *  an empty ledger would show a skeleton that collapses on every app open),
 *  on error, or when the ledger has no transactions yet; content fades in when
 *  data arrives, and the hook's cache makes remounts instant. */
export const FinanceOverview: FC = () => {
  const { data, loading } = useDashboardData();

  if (loading || !data || data.error !== null || !data.hasTransactions) return null;

  return (
    <div className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both mb-8 flex flex-col gap-3 duration-200">
      <StatRow data={data} />
      <NetWorthChart series={data.netWorthSeries} currency={data.dominantCurrency} />
      <div className="grid gap-3 sm:grid-cols-2">
        <IncomeExpenseChart series={data.incomeExpenseSeries} currency={data.dominantCurrency} />
        <CategoryBars categories={data.topCategories} currency={data.dominantCurrency} />
      </div>
    </div>
  );
};
