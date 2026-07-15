import type { FC } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/shadcn/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/shadcn/chart";
import { formatAmount, formatAmountCompact } from "@/lib/format-amount";
import { formatMonthLong, formatMonthShort } from "@/lib/format-month";
import type { IncomeExpensePoint } from "@/rpc/types";
import { amountFor } from "./amounts";

// Per-mode pairing, validated with the dataviz palette checker: chart-4 drops
// below 3:1 contrast on the dark card and chart-1 on the light one, so the
// expenses series swaps its token by mode while income keeps chart-2 (the step
// that passes on both surfaces).
const config = {
  income: { label: "Income", color: "var(--chart-2)" },
  expenses: { label: "Expenses", theme: { light: "var(--chart-4)", dark: "var(--chart-1)" } },
} satisfies ChartConfig;

export const IncomeExpenseChart: FC<{ series: IncomeExpensePoint[]; currency: string }> = ({ series, currency }) => {
  const points = series.map((p) => ({
    month: p.month,
    income: amountFor(p.income, currency),
    expenses: amountFor(p.expenses, currency),
  }));

  return (
    <Card className="gap-3 rounded-lg px-4 py-3 shadow-none">
      <CardHeader className="p-0">
        <CardTitle className="text-muted-foreground text-xs font-normal">Income and expenses</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ChartContainer config={config} className="aspect-[16/10] w-full">
          <BarChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              interval={0}
              tickFormatter={formatMonthShort}
            />
            <YAxis width={44} tickLine={false} axisLine={false} tickFormatter={formatAmountCompact} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(label) => formatMonthLong(String(label))}
                  formatter={(value, name) => (
                    <div className="flex w-full items-center gap-2 leading-none">
                      <div
                        className="size-2.5 shrink-0 rounded-[2px]"
                        style={{ background: `var(--color-${String(name)})` }}
                      />
                      <span className="text-muted-foreground flex-1">
                        {config[name as keyof typeof config]?.label ?? String(name)}
                      </span>
                      <span className="text-foreground font-medium tabular-nums">
                        {formatAmount(Number(value), currency)}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Bar dataKey="income" fill="var(--color-income)" radius={[4, 4, 0, 0]} maxBarSize={20} />
            <Bar dataKey="expenses" fill="var(--color-expenses)" radius={[4, 4, 0, 0]} maxBarSize={20} />
          </BarChart>
        </ChartContainer>
        {/* Static legend: recharts 3 orders its own legend payload differently
            from the Bar declaration order, so it can't be trusted to read
            left-to-right like the bars. Chip classes mirror the config above
            (income chart-2; expenses chart-4 light / chart-1 dark). */}
        <div className="flex items-center justify-center gap-4 pt-3 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="size-2 shrink-0 rounded-[2px] bg-(--chart-2)" />
            <span className="text-muted-foreground">Income</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-2 shrink-0 rounded-[2px] bg-(--chart-4) dark:bg-(--chart-1)" />
            <span className="text-muted-foreground">Expenses</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
