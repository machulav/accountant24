import type { CurrencyAmount } from "@/rpc/types";

/** The amount in `currency`, or 0 when the list has no entry for it. */
export function amountFor(amounts: CurrencyAmount[], currency: string): number {
  return amounts.find((a) => a.currency === currency)?.amount ?? 0;
}
