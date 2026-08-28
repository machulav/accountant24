"use client";

// The journal's transaction count, which picks the New Chat page's prompt ideas.

import { useCallback, useEffect, useState } from "react";
import { useAgentIdleRefresh } from "@/hooks/use-agent-idle-refresh";
import { ledgerApi } from "@/rpc/api";

/** null = not known yet (the ideas wait rather than show the wrong set). A
 *  failed fetch counts as 0: the count only picks the ideas, and a fresh
 *  ledger's set beats none. Refetched when a turn finishes (it may have
 *  posted transactions), so the next New Chat sees the ledger's real size. */
export function useTransactionCount(): number | null {
  const [count, setCount] = useState<number | null>(null);

  const refresh = useCallback(() => {
    let cancelled = false;
    ledgerApi
      .transactionCount()
      .then((n) => {
        if (!cancelled) setCount(n);
      })
      .catch(() => {
        if (!cancelled) setCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refresh(), [refresh]);
  useAgentIdleRefresh(refresh);

  return count;
}
