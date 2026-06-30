"use client";

import { useAuiState, useScrollLock } from "@assistant-ui/react";
import { ChevronDownIcon } from "lucide-react";
import { createContext, type FC, type PropsWithChildren, useCallback, useContext, useRef, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const ANIMATION_DURATION = 200;

// True only for steps actually rendered inside the timeline box, so a
// standalone tool call (rendered outside the chain) doesn't draw an orphan rail.
const InChainContext = createContext(false);

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
  const ref = useRef<HTMLDivElement>(null);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const lockScroll = useScrollLock(ref, ANIMATION_DURATION);

  // "Still thinking" = the run is active AND nothing has streamed past this chain
  // yet (no answer text after it). This stays true through every reasoning/tool
  // step and flips once — when the answer begins or the run ends — so the box
  // doesn't flicker open/closed between steps.
  const active = useAuiState((s) => {
    if (s.message.status?.type !== "running") return false;
    return s.message.parts.length - 1 <= endIndex;
  });

  const open = userOpen ?? active;
  const onOpenChange = useCallback(
    (next: boolean) => {
      lockScroll();
      setUserOpen(next);
    },
    [lockScroll],
  );

  const label = active ? "Working" : `Worked through ${count} ${count === 1 ? "step" : "steps"}`;

  return (
    <Collapsible
      ref={ref}
      open={open}
      onOpenChange={onOpenChange}
      data-slot="aui_chain-of-thought"
      className="mb-3"
      style={{ "--animation-duration": `${ANIMATION_DURATION}ms` } as React.CSSProperties}
    >
      <CollapsibleTrigger
        data-slot="aui_cot-trigger"
        className="group/cot text-muted-foreground hover:text-foreground flex w-full items-center gap-2 py-1.5 text-sm transition-colors"
      >
        <span className="relative inline-block leading-none font-medium">
          {label}
          {active && (
            <span aria-hidden className="shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none">
              {label}
            </span>
          )}
        </span>
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-(--animation-duration) ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
            "group-data-[state=closed]/cot:-rotate-90 group-data-[state=open]/cot:rotate-0",
          )}
        />
      </CollapsibleTrigger>

      <CollapsibleContent
        data-slot="aui_cot-content"
        className={cn(
          "overflow-hidden outline-none",
          "ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none",
          "data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down",
          "data-[state=closed]:pointer-events-none data-[state=closed]:fill-mode-forwards",
          "data-[state=open]:duration-(--animation-duration) data-[state=closed]:duration-(--animation-duration)",
        )}
      >
        {/* The vertical rail: a left border the step dots sit on. */}
        <InChainContext.Provider value={true}>
          <ol className="border-border/70 my-1 ml-5 mr-3 flex flex-col border-l pb-1">{children}</ol>
        </InChainContext.Provider>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** One timeline step. `reasoning` → hollow dot + muted text; `tool` → filled dot
 *  + the tool card. The dot sits on the parent's rail. */
export const ChainOfThoughtStep: FC<PropsWithChildren<{ variant: "reasoning" | "tool"; active?: boolean }>> = ({
  variant,
  active = false,
  children,
}) => {
  // Rendered outside a chain (standalone tool call): no rail/dot, just the content.
  if (!useContext(InChainContext)) return <>{children}</>;
  return (
    <li className="relative min-w-0 pl-4">
      <span
        aria-hidden
        className={cn(
          "border-background absolute top-1.5 -left-[5px] size-2.5 rounded-full border-2 ring-0",
          variant === "tool" ? "bg-muted-foreground/70" : "bg-background border-border/80 ring-1",
          active && "bg-foreground animate-pulse",
        )}
      />
      <div className={cn("min-w-0 pb-3", variant === "reasoning" && "text-muted-foreground text-sm")}>{children}</div>
    </li>
  );
};
