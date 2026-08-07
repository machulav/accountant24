"use client";

// The agent may change the ledger during its turn, so the data hooks behind
// the report views refresh when the viewed thread stops running.

import { useAuiState } from "@assistant-ui/react";
import { type EffectCallback, useEffect, useRef } from "react";

/** Call `refresh` on the thread's running → idle edge. `refresh` may return
 *  a cleanup (e.g. a cancellation flag), which runs as the effect teardown. */
export function useAgentIdleRefresh(refresh: EffectCallback): void {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const wasRunning = useRef(isRunning);
  useEffect(() => {
    const justFinished = wasRunning.current && !isRunning;
    wasRunning.current = isRunning;
    if (justFinished) return refresh();
  }, [isRunning, refresh]);
}
