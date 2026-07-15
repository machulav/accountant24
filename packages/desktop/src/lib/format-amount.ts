// Amount formatting for the finance overview. Commodities are arbitrary
// journal strings ("EUR", "UAH", "$", quoted tickers), so Intl's currency
// style is unusable; format the number and append the commodity as-is.

const numberFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "1,234.56 EUR"; no suffix when the commodity is empty. */
export function formatAmount(amount: number, currency: string): string {
  const num = numberFormat.format(amount);
  return currency ? `${num} ${currency}` : num;
}

/** Short form for chart axis ticks: "45k", "1.5M", "-1.2k", "999". */
export function formatAmountCompact(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${sign}${trimTrailingZero((abs / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${sign}${trimTrailingZero((abs / 1_000).toFixed(1))}k`;
  return `${sign}${Math.round(abs)}`;
}

function trimTrailingZero(s: string): string {
  return s.replace(/\.0$/, "");
}
