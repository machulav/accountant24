"use client";

import { useAuiState } from "@assistant-ui/react";
import { usePiThreadState } from "@assistant-ui/react-pi";
import type { FC } from "react";
import { Marker, MarkerContent, MarkerIcon } from "@/components/shadcn/marker";
import { Spinner } from "@/components/shadcn/spinner";
import { cn } from "@/lib/utils";
import { usePendingCompactionMarkers } from "@/runtime/pendingCompaction";

// Compaction renders as ONE separator divider in the message stream, in both
// of its states: spinner + shimmering "Compacting conversation" while pi
// compacts, settling into a plain "Conversation compacted" labeled line that
// stays in the history (pi persists the record, so reloads show it too).
//
// SPACING CONTRACT (see the CHAT SPACING block in index.css): this is a
// stream-level element. The thread's MessageGroup gap-chat-gap owns ALL
// spacing between stream elements — the divider must not add vertical margins
// of its own, in either state, so the active → settled swap happens in place
// without moving a pixel.

export const COMPACTION_LABEL = "Compacting conversation";
export const COMPACTED_LABEL = "Conversation compacted";

/** True while pi is compacting the conversation (overflow recovery, or the
 *  threshold pass before/after a turn). */
export const useCompactionActive = (): boolean => usePiThreadState((s) => s.compaction.active);

/** The compaction divider in either lifecycle state. */
export const CompactionDivider: FC<{ active?: boolean; className?: string }> = ({ active = false, className }) => (
  <Marker
    variant="separator"
    data-slot={active ? "aui_compaction-indicator" : "aui_compaction-summary"}
    {...(active ? { role: "status" } : {})}
    className={className}
  >
    {active && (
      <MarkerIcon>
        <Spinner />
      </MarkerIcon>
    )}
    {/* shimmer-color-foreground: the default highlight is a 20%-alpha
        lightening of the label's own muted color, too faint to read here. */}
    <MarkerContent className={cn(active && "shimmer shimmer-color-foreground motion-reduce:shimmer-none")}>
      {active ? COMPACTION_LABEL : COMPACTED_LABEL}
    </MarkerContent>
  </Marker>
);

/** The live divider, mounted INSIDE the last message's content flow (not as a
 *  stream sibling): assistant-ui's turnAnchor stretches the last message to
 *  viewport height while a run is pinned, so a stream-level row would land far
 *  below the text. In-flow, `mt-chat-gap` gives it the same stream-gap
 *  distance from the text as the transcript marker gets from the MessageGroup
 *  gap.
 *
 *  It covers BOTH lifecycle states: the active sweep while pi compacts, then
 *  the settled label in place while the transcript marker is still parked
 *  (see runtime/pendingCompaction.ts — injecting it immediately would break
 *  the turn anchor and make the thread jump). Once the next user prompt
 *  delivers the real marker, `isLast` moves on and this component yields to
 *  CompactionSummary. */
export const CompactionIndicator: FC = () => {
  const compacting = useCompactionActive();
  const threadId = usePiThreadState((s) => s.threadId);
  const parked = usePendingCompactionMarkers(threadId).length > 0;
  const isLast = useAuiState((s) => s.message.isLast);
  if (!isLast || (!compacting && !parked)) return null;
  return <CompactionDivider active={compacting} className="mt-chat-gap" />;
};

/** The settled divider, rendered from the transcript's compactionSummary
 *  message (inside a message root, which already pads with px-2). */
export const CompactionSummary: FC = () => <CompactionDivider />;
