"use client";

import { useAuiState } from "@assistant-ui/react";
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
 * Wall-clock duration of the turn that produced `message`: from the preceding
 * user message's timestamp to the message's own. react-pi projects pi's
 * per-message `timestamp` into `createdAt` (an assistant group gets the
 * timestamp of its LAST pi message ≈ turn end) and replays original
 * timestamps on session reload, so this works for historical threads too.
 * Returns null when timestamps are missing or inconsistent.
 */
export const turnDurationMs = (
  message: { id: string; createdAt?: Date },
  messages: readonly { id: string; role: string; createdAt?: Date }[],
): number | null => {
  const end = message.createdAt?.getTime();
  if (!end) return null;
  const idx = messages.findIndex((m) => m.id === message.id);
  for (let i = idx - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user") {
      const start = m.createdAt?.getTime();
      return start && end >= start ? end - start : null;
    }
  }
  return null;
};

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
  endIndex,
  children,
}: PropsWithChildren<{ count: number; endIndex: number }>) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);

  // "Still thinking" = the run is active AND nothing has streamed past this chain
  // yet (no answer text after it). This stays true through every reasoning/tool
  // step and flips once — when the answer begins or the run ends — so the box
  // doesn't flicker open/closed between steps.
  const active = useAuiState((s) => {
    if (s.message.status?.type !== "running") return false;
    return s.message.parts.length - 1 <= endIndex;
  });

  const durationMs = useAuiState((s) => turnDurationMs(s.message, s.thread.messages));
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
