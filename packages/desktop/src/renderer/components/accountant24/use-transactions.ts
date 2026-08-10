"use client";

// The journal register feed for the Transactions page.

import { useCallback, useEffect, useState } from "react";
import { useAgentIdleRefresh } from "@/hooks/use-agent-idle-refresh";
import { ledgerApi } from "@/rpc/api";
import type { LedgerTransaction } from "@/rpc/types";

export interface TransactionsFeed {
  /** null = first load in flight; [] = loaded but empty (no journal yet). */
  transactions: LedgerTransaction[] | null;
  /** The last fetch failed: the journal exists but could not be read (the
   *  main process rejects the register query then, so an unreadable journal
   *  never renders as "no transactions yet"). */
  failed: boolean;
}

/** `active` = the page is the visible view; while false, the idle-edge
 *  refresh defers to the next show (see useAgentIdleRefresh). */
export function useTransactions(active = true): TransactionsFeed {
  const [feed, setFeed] = useState<TransactionsFeed>({ transactions: null, failed: false });

  const refresh = useCallback(() => {
    let cancelled = false;
    ledgerApi
      .transactions()
      .then((transactions) => {
        if (!cancelled) setFeed({ transactions, failed: false });
      })
      .catch(() => {
        if (!cancelled) setFeed({ transactions: [], failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refresh(), [refresh]);
  // Refetch when a turn finishes (it may have posted transactions) — while
  // the page is visible; hidden, the refetch waits for the next show.
  // Existing rows stay up while the refresh is in flight, so the list never
  // flickers back to the skeleton.
  useAgentIdleRefresh(refresh, active);

  return feed;
}
