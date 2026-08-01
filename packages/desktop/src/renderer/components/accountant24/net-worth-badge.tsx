"use client";

// The sidebar's glanceable net worth: the trailing figure inside the Net
// Worth menu button, fed by the same report as the page and refreshed when
// the agent finishes a turn. Compact notation — the exact figure lives on
// the page. Rendered inline (ml-auto in the button's own flex row) so it
// always sits on the label's baseline; muted so the secondary figure never
// competes with the label. Nothing renders while the report is loading or
// empty.

import type { FC } from "react";
import { formatValueCompact } from "@/lib/amountFormat";
import { useNetWorth } from "./use-net-worth";

export const NetWorthBadge: FC = () => {
  const sheet = useNetWorth();
  if (sheet === null) return null;
  const text = formatValueCompact(sheet.net, navigator.language);
  if (!text) return null;
  // aria-hidden keeps the button's accessible name a stable "Net Worth"
  // instead of one that shifts with every ledger change.
  return (
    <span aria-hidden="true" className="ml-auto text-xs font-medium text-muted-foreground tabular-nums">
      {text}
    </span>
  );
};
