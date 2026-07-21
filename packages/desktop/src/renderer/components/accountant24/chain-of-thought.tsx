"use client";

import { useAuiState } from "@assistant-ui/react";
import { usePiThreadState } from "@assistant-ui/react-pi";
import { createContext, type FC, type PropsWithChildren, useContext, useState } from "react";
import {
  Disclosure,
  DisclosureChevron,
  DisclosureContent,
  DisclosureTrigger,
  ShimmerLabel,
} from "@/components/accountant24/disclosure";
import { formatDuration } from "@/lib/duration";
import { cn } from "@/lib/utils";

// True only for steps actually rendered inside the timeline box, so a
// standalone tool call (rendered outside the chain) doesn't draw an orphan rail.
const InChainContext = createContext(false);

/**
 * Timestamp of the user message that started the turn containing `messageId`:
 * the closest preceding `user` message in the thread. Null when there is none
 * or its timestamp is missing.
 */
export const precedingUserTimestampMs = (
  messageId: string,
  messages: readonly { id: string; role: string; createdAt?: Date }[],
): number | null => {
  const idx = messages.findIndex((m) => m.id === messageId);
  for (let i = idx - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user") {
      return m.createdAt?.getTime() || null;
    }
  }
  return null;
};

/** Parse a part's react-pi `parentId` ("pi-step:<raw transcript index>") back
 *  to the index of the pi message (turn) that produced the part. Parts are
 *  `unknown` because not every aui part type declares `parentId`. */
const piStepIndex = (part: unknown): number | null => {
  const parentId = (part as { parentId?: unknown } | undefined)?.parentId;
  const match = typeof parentId === "string" ? parentId.match(/^pi-step:(\d+)$/) : null;
  return match ? Number(match[1]) : null;
};

const piTimestampMs = (piMessages: readonly { timestamp?: number }[], index: number | null): number | null =>
  (index !== null && piMessages[index]?.timestamp) || null;

/**
 * Wall-clock duration of ONE thinking cycle: the chain-of-thought group
 * spanning `parts[startIndex..endIndex]` of an assistant message. A message
 * interleaving reasoning/tools with answer text renders several such groups,
 * and each must report only its own time (A-32) — not the whole turn's.
 *
 * Anchors come from the raw pi transcript: react-pi stamps each part with
 * `parentId` ("pi-step:<transcript index>"), and every pi message carries a
 * `timestamp` set at its turn's STREAM START (replayed on session reload, so
 * this works for historical threads too):
 * - start — the first cycle starts at the preceding user message (the wait the
 *   user perceives), later cycles at their own first turn's timestamp.
 * - end — the turn timestamp of the part right after the group (the answer
 *   text that ended the cycle); when the group ends the message, the last of
 *   its trailing toolResult messages in the raw transcript.
 *
 * pi has no per-part timing, so a boundary falling mid-turn (e.g. preamble
 * text in the same turn as its thinking) resolves to that turn's start — a
 * bounded approximation, matching the label's pre-existing accuracy.
 * Returns null when anchors are missing or inconsistent.
 */
export const cycleDurationMs = ({
  parts,
  startIndex,
  endIndex,
  piMessages,
  turnStartMs,
}: {
  parts: readonly unknown[];
  startIndex: number;
  endIndex: number;
  piMessages: readonly { role: string; timestamp?: number }[];
  turnStartMs: number | null;
}): number | null => {
  const firstTurnStart = piTimestampMs(piMessages, piStepIndex(parts[startIndex]));
  const start = startIndex === 0 ? (turnStartMs ?? firstTurnStart) : firstTurnStart;

  let end: number | null = null;
  const nextPart = parts[endIndex + 1];
  if (nextPart) {
    end = piTimestampMs(piMessages, piStepIndex(nextPart));
  } else {
    // The group ends the message (stopped/aborted after reasoning or tools):
    // the cycle ran until its last tools finished, i.e. the last of the
    // toolResult messages directly following the group's final turn.
    const lastTurn = piStepIndex(parts[endIndex]);
    if (lastTurn !== null) {
      for (let i = lastTurn + 1; piMessages[i]?.role === "toolResult"; i++) {
        end = piMessages[i]?.timestamp || end;
      }
    }
  }

  return start !== null && end !== null && end >= start ? end - start : null;
};

/**
 * Split a reasoning part's markdown into timeline sections: pi joins a turn's
 * summary sections into ONE thinking part (`**Title**` blocks separated by
 * blank lines), which as a single step would put a rail dot next to the first
 * title only. A new section starts at each blank line followed by a
 * standalone bold-title line; text without such titles stays one section.
 * Blank text yields none (Codex can send encrypted CoT with no summary).
 */
export const splitReasoningSections = (text: string): string[] =>
  text.split(/\n{2,}(?=\*\*[^\n]+\*\*(?:\n|$))/).filter((section) => section.trim().length > 0);

/** Trigger label: live shimmer while working, duration when known, step count fallback. */
export const chainLabel = (active: boolean, durationMs: number | null, count: number) =>
  active
    ? "Working"
    : durationMs !== null
      ? `Worked for ${formatDuration(durationMs)}`
      : `Worked through ${count} ${count === 1 ? "step" : "steps"}`;

/**
 * Boxed timeline that renders an assistant turn's interleaved reasoning + tool
 * calls as a single ordered, collapsible unit (instead of separate per-type
 * collapsibles). Children are the timeline steps, in message order.
 *
 * Open state follows the run: expanded while the agent is working, collapsed
 * once done — unless the user has toggled it (then their choice sticks).
 */
export function ChainOfThoughtRoot({
  count,
  startIndex,
  endIndex,
  children,
}: PropsWithChildren<{ count: number; startIndex: number; endIndex: number }>) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);

  // "Still thinking" = the run is active AND nothing has streamed past this chain
  // yet (no answer text after it). This stays true through every reasoning/tool
  // step and flips once — when the answer begins or the run ends — so the box
  // doesn't flicker open/closed between steps.
  const active = useAuiState((s) => {
    if (s.message.status?.type !== "running") return false;
    return s.message.parts.length - 1 <= endIndex;
  });

  // Raw pi transcript for per-turn timestamps; empty outside a pi runtime,
  // where the label degrades to the step-count fallback.
  const piMessages = usePiThreadState((st) => st.messages);
  const durationMs = useAuiState((s) =>
    cycleDurationMs({
      parts: s.message.parts,
      startIndex,
      endIndex,
      piMessages,
      turnStartMs: precedingUserTimestampMs(s.message.id, s.thread.messages),
    }),
  );
  const label = chainLabel(active, durationMs, count);

  return (
    <Disclosure
      data-slot="aui_chain-of-thought"
      open={userOpen ?? active}
      onOpenChange={setUserOpen}
      // my-3 mirrors the markdown paragraph rhythm (p is my-3), so the chain
      // sits with the same gap whether it precedes or follows answer text;
      // first:mt-0 keeps a chain at the top of a message flush, like p.
      className="my-3 first:mt-0"
    >
      <DisclosureTrigger data-slot="aui_cot-trigger" className="w-full">
        <ShimmerLabel active={active} className="font-medium">
          {label}
        </ShimmerLabel>
        <DisclosureChevron />
      </DisclosureTrigger>

      <DisclosureContent data-slot="aui_cot-content">
        {/* The vertical rail: a left border the step dots sit on. py-1.5 gives
            the rail equal short stubs before the first and after the last dot. */}
        <InChainContext.Provider value={true}>
          <ol className="border-border/70 my-1 ml-5 mr-3 flex flex-col border-l py-1.5">{children}</ol>
        </InChainContext.Provider>
      </DisclosureContent>
    </Disclosure>
  );
}

/** One timeline step: a filled dot on the parent's rail. `reasoning` steps get
 *  muted text; `tool` steps render the tool card as-is. */
export const ChainOfThoughtStep: FC<PropsWithChildren<{ variant: "reasoning" | "tool"; active?: boolean }>> = ({
  variant,
  active = false,
  children,
}) => {
  // Rendered outside a chain (standalone tool call): no rail/dot, just the content.
  if (!useContext(InChainContext)) return <>{children}</>;
  return (
    // pb-3 spaces steps 12px apart (the chat's spacing rhythm); last:pb-0 so
    // the rail ends flush with the final step instead of trailing past it.
    <li className="relative min-w-0 pb-3 pl-4 last:pb-0">
      <span
        aria-hidden
        className={cn(
          "border-background bg-muted-foreground/70 absolute -left-[5px] size-2.5 rounded-full border-2",
          // Center the dot on the step's first text line: tool triggers add
          // py-1.5 above the line, reasoning text starts at the top.
          variant === "tool" ? "top-[9px]" : "top-[5px]",
          active && "bg-foreground animate-pulse",
        )}
      />
      <div className={cn("min-w-0", variant === "reasoning" && "text-muted-foreground text-sm")}>{children}</div>
    </li>
  );
};
