"use client";

// The agent may change the ledger during its turn, so the data hooks behind
// the report views refresh when the viewed thread stops running.

import { useAuiState } from "@assistant-ui/react";
import { type EffectCallback, useEffect, useRef } from "react";

/** Call `refresh` on the thread's running → idle edge. `refresh` may return
 *  a cleanup (e.g. a cancellation flag), which runs as the effect teardown.
 *
 *  `active` gates the refresh for hosts that stay mounted while hidden (the
 *  Transactions page): a turn that finishes while inactive only latches a
 *  dirty mark, and the one refresh runs when the host becomes active again —
 *  not after every turn behind a hidden page. */
export function useAgentIdleRefresh(refresh: EffectCallback, active = true): void {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const wasRunning = useRef(isRunning);
  const dirty = useRef(false);
  useEffect(() => {
    const justFinished = wasRunning.current && !isRunning;
    wasRunning.current = isRunning;
    if (!justFinished) return;
    if (active) return refresh();
    dirty.current = true;
  }, [isRunning, refresh, active]);
  useEffect(() => {
    if (!active || !dirty.current) return;
    dirty.current = false;
    return refresh();
  }, [active, refresh]);
}
