import type { FC } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/shadcn/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/shadcn/chart";
import { formatAmount, formatAmountCompact } from "@/lib/format-amount";
import { formatMonthLong, formatMonthShort } from "@/lib/format-month";
import type { NetWorthPoint } from "@/rpc/types";
import { amountFor } from "./amounts";

// The design system's chart palette is monochrome (lightness steps of one
// hue), so series identity rides on titles, legends and tooltips rather than
// hue. chart-2 is the one step that clears 3:1 contrast on both the light and
// dark card surfaces (checked with the dataviz palette validator).
const config = {
  netWorth: { label: "Net worth", color: "var(--chart-2)" },
} satisfies ChartConfig;

export const NetWorthChart: FC<{ series: NetWorthPoint[]; currency: string }> = ({ series, currency }) => {
  const points = series.map((p) => ({ month: p.month, netWorth: amountFor(p.amounts, currency) }));

  return (
    <Card className="gap-3 rounded-lg px-4 py-3 shadow-none">
      <CardHeader className="p-0">
        <CardTitle className="text-muted-foreground text-xs font-normal">Net worth, last 12 months</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ChartContainer config={config} className="aspect-[3/1] w-full">
          <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              interval={2}
              tickFormatter={formatMonthShort}
            />
            <YAxis width={44} tickLine={false} axisLine={false} tickFormatter={formatAmountCompact} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  hideIndicator
                  labelFormatter={(label) => formatMonthLong(String(label))}
                  formatter={(value) => (
                    <div className="flex w-full items-center justify-between gap-3 leading-none">
                      <span className="text-muted-foreground">Net worth</span>
                      <span className="text-foreground font-medium tabular-nums">
                        {formatAmount(Number(value), currency)}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Area
              dataKey="netWorth"
              type="monotone"
              stroke="var(--color-netWorth)"
              strokeWidth={2}
              fill="var(--color-netWorth)"
              fillOpacity={0.08}
              dot={false}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
};
