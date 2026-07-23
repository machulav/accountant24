"use client";

// The net worth report feed, shared by the page and the sidebar badge.

import { useAuiState } from "@assistant-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ledgerApi } from "@/rpc/api";
import type { NetWorth } from "@/rpc/types";

/** null = first load in flight; no section rows = loaded but empty (no
 *  journal yet or hledger failed — both render the empty state pointing at
 *  the agent). */
export function useNetWorth(): NetWorth | null {
  const [data, setData] = useState<NetWorth | null>(null);

  const refresh = useCallback(() => {
    let cancelled = false;
    ledgerApi
      .netWorth()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData({ sections: [], net: { amounts: [], value: [] } });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refresh(), [refresh]);

  // Refetch on the running → idle edge (the finished turn may have posted
  // transactions). Existing rows stay up while the refresh is in flight, so
  // the list never flickers back to the skeleton. Same pattern as mentions.tsx.
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const wasRunning = useRef(isRunning);
  useEffect(() => {
    const justFinished = wasRunning.current && !isRunning;
    wasRunning.current = isRunning;
    if (justFinished) return refresh();
  }, [isRunning, refresh]);

  return data;
}
