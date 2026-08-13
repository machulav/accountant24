"use client";

// The Investments view's data feed — same contract as the Net Worth page:
// null while the first load is in flight, a load failure or a journal
// without holdings both land on the empty payload (no fabricated zeros),
// and the report refetches when the agent finishes a turn.

import { useCallback, useEffect, useState } from "react";
import { useAgentIdleRefresh } from "@/hooks/use-agent-idle-refresh";
import { ledgerApi } from "@/rpc/api";
import type { Investments } from "@/rpc/types";

/** The empty payload when hledger fails or the journal has no holdings. */
const EMPTY: Investments = { rows: [], totalMarketValue: [], totalCostBasis: [], baseCommodity: null };

/** null = first load in flight; empty rows = loaded but no holdings (no
 *  journal yet or hledger failed — both render the empty state pointing at
 *  the agent). `active` = the host is visible; while false, the idle-edge
 *  refresh defers to the next show (see useAgentIdleRefresh). */
export function useInvestments(active = true): Investments | null {
  const [data, setData] = useState<Investments | null>(null);

  const refresh = useCallback(() => {
    let cancelled = false;
    ledgerApi
      .investments()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        // hledger failed or there's no journal yet — the empty page.
        if (!cancelled) setData(EMPTY);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refresh(), [refresh]);
  // Refetch when a turn finishes (it may have posted a buy, a sell, or a
  // price) — while the host is visible; hidden, the refetch waits for the
  // next show. Existing rows stay up while the refresh is in flight, so the
  // table never flickers back to the skeleton.
  useAgentIdleRefresh(refresh, active);

  return data;
}
