import type { FC } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/shadcn/card";
import { formatAmount } from "@/lib/format-amount";
import type { DashboardData } from "@/rpc/types";

/** Ranked horizontal bars of this month's top spending accounts. Plain divs
 *  rather than a chart: amounts are printed on each row, so no axis or tooltip
 *  is needed at this card width. Single hue by design (one measure; identity
 *  lives in the row labels). */
export const CategoryBars: FC<{ categories: DashboardData["topCategories"]; currency: string }> = ({
  categories,
  currency,
}) => {
  const rows = categories.filter((c) => c.currency === currency && c.amount > 0);
  const max = Math.max(...rows.map((r) => r.amount), 1);

  return (
    <Card className="gap-3 rounded-lg px-4 py-3 shadow-none">
      <CardHeader className="p-0">
        <CardTitle className="text-muted-foreground text-xs font-normal">Top spending this month</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-center gap-2.5 p-0">
        {rows.length === 0 && (
          <div className="text-muted-foreground py-6 text-center text-xs">No spending this month</div>
        )}
        {rows.map((row) => (
          <div key={row.name} className="flex items-center gap-2">
            <span className="text-muted-foreground w-24 shrink-0 truncate text-xs" title={row.name}>
              {displayAccountName(row.name)}
            </span>
            <div className="flex-1">
              <div
                className="h-3 rounded-r-[4px] bg-(--chart-2)"
                style={{ width: `${Math.max((row.amount / max) * 100, 2)}%` }}
              />
            </div>
            <span className="text-foreground shrink-0 text-xs tabular-nums">
              {formatAmount(row.amount, row.currency)}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

/** "personal-care" -> "Personal care" for row labels. */
function displayAccountName(name: string): string {
  const words = name.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
