// Locale-aware presentation of hledger amounts for the Balance Sheet view.
//
// hledger computes the numbers; this module only decides how they read.
// Every amount reads the same way — "1,234.56 EUR", "986.54 UAH",
// "0.02895303 BTC", "2.74 SXR8" — the number in the locale's digits and
// separators with the commodity code as a suffix, which is also hledger's
// own display convention. (Routing fiat through Intl's currency styles used
// to mix symbol-first fiat, code-first crypto, and suffixed tickers on one
// page.)

import type { LedgerAmount } from "@/rpc/types";

/** How many fraction digits an amount gets.
 *  - "value" (market value): a money estimate — 2 digits, except whole-unit
 *    commodities (share counts) stay whole and sub-1 quantities (crypto that
 *    price data left unconverted) keep their own precision.
 *  - "native" (original holding): the amount's own precision, capped at 8,
 *    with at least 2 shown for fractional commodities. */
function fractionDigits(a: LedgerAmount, mode: "value" | "native"): { min: number; max: number } {
  if (a.precision === 0) return { min: 0, max: 0 };
  if (mode === "value") {
    if (Math.abs(a.quantity) < 1 && a.precision > 2) return { min: 2, max: Math.min(a.precision, 8) };
    return { min: 2, max: 2 };
  }
  return { min: Math.min(a.precision, 2), max: Math.min(Math.max(a.precision, 2), 8) };
}

/** Format one amount for display. `locale` defaults to the runtime locale. */
export function formatAmount(a: LedgerAmount, mode: "value" | "native", locale?: string): string {
  const { min, max } = fractionDigits(a, mode);
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(a.quantity);
  return a.commodity ? `${number} ${a.commodity}` : number;
}

/** Format a multi-commodity amount on one line, comma-separated — hledger's
 *  own one-line convention ("7,796.25 EUR, 1,000.00 UAH"). */
export function formatAmounts(amounts: LedgerAmount[], mode: "value" | "native", locale?: string): string {
  return amounts.map((a) => formatAmount(a, mode, locale)).join(", ");
}
