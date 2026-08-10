"use client";

// The net worth report feed, shared by the page and the sidebar badge.

import { useCallback, useEffect, useState } from "react";
import { useAgentIdleRefresh } from "@/hooks/use-agent-idle-refresh";
import { ledgerApi } from "@/rpc/api";
import type { NetWorth } from "@/rpc/types";

/** null = first load in flight; no section rows = loaded but empty (no
 *  journal yet or hledger failed — both render the empty state pointing at
 *  the agent). `active` = the host is visible; while false, the idle-edge
 *  refresh defers to the next show (see useAgentIdleRefresh). The
 *  always-visible sidebar badge omits it. */
export function useNetWorth(active = true): NetWorth | null {
  const [data, setData] = useState<NetWorth | null>(null);

  const refresh = useCallback(() => {
    let cancelled = false;
    ledgerApi
      .netWorth()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData({ sections: [], net: { amounts: [], value: [] }, baseCommodity: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refresh(), [refresh]);
  // Refetch when a turn finishes (it may have posted transactions) — while
  // the host is visible; hidden, the refetch waits for the next show.
  // Existing rows stay up while the refresh is in flight, so the list never
  // flickers back to the skeleton.
  useAgentIdleRefresh(refresh, active);

  return data;
}
