"use client";

// The journal register feed for the Transactions page.

import { useCallback, useEffect, useState } from "react";
import { useAgentIdleRefresh } from "@/hooks/use-agent-idle-refresh";
import { ledgerApi } from "@/rpc/api";
import type { LedgerTransaction } from "@/rpc/types";

/** null = first load in flight; [] = loaded but empty (no journal yet or
 *  hledger failed — both render the empty state pointing at the agent). */
export function useTransactions(): LedgerTransaction[] | null {
  const [data, setData] = useState<LedgerTransaction[] | null>(null);

  const refresh = useCallback(() => {
    let cancelled = false;
    ledgerApi
      .transactions()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refresh(), [refresh]);
  // Refetch when a turn finishes (it may have posted transactions). Existing
  // rows stay up while the refresh is in flight, so the list never flickers
  // back to the skeleton.
  useAgentIdleRefresh(refresh);

  return data;
}
