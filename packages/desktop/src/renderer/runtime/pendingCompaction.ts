// Markers for compactions that finished but are NOT yet in the transcript.
//
// Injecting the compactionSummary transcript message the moment a compaction
// ends breaks assistant-ui's turn anchor (the [user, assistant] tail pattern),
// which tears down the viewport's reserved space and makes the whole thread
// jump. So a successful compaction parks its marker here; the in-message
// divider shows the settled state in place, and the overflow-recovery
// interceptor injects the real transcript marker right before the NEXT user
// message — the moment assistant-ui re-anchors the new turn anyway, so nothing
// visibly moves.
//
// A thread snapshot reload drops the pending copy: pi persists the same
// compactionSummary in the session file, so the fetched transcript already
// carries it.

import { useSyncExternalStore } from "react";

export interface PendingCompactionMarker {
  summary: string;
  tokensBefore?: number;
  /** When the compaction finished — keeps injected markers chronological. */
  timestamp: number;
}

const pending = new Map<string, readonly PendingCompactionMarker[]>();
const listeners = new Set<() => void>();
const EMPTY: readonly PendingCompactionMarker[] = [];

const notify = () => {
  for (const fn of [...listeners]) fn();
};

export function addPendingCompactionMarker(sessionPath: string, marker: PendingCompactionMarker): void {
  pending.set(sessionPath, [...(pending.get(sessionPath) ?? []), marker]);
  notify();
}

export function getPendingCompactionMarkers(sessionPath: string): readonly PendingCompactionMarker[] {
  return pending.get(sessionPath) ?? EMPTY;
}

/** Remove and return the session's pending markers (injection consumed them,
 *  or a snapshot made them redundant). */
export function takePendingCompactionMarkers(sessionPath: string): readonly PendingCompactionMarker[] {
  const markers = pending.get(sessionPath);
  if (!markers || markers.length === 0) return EMPTY;
  pending.delete(sessionPath);
  notify();
  return markers;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Reactive view of one session's pending markers. */
export function usePendingCompactionMarkers(sessionPath: string): readonly PendingCompactionMarker[] {
  return useSyncExternalStore(subscribe, () => getPendingCompactionMarkers(sessionPath));
}

/** Test helper. */
export function resetPendingCompactionMarkers(): void {
  pending.clear();
  notify();
}
