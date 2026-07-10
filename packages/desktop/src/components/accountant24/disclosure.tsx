"use client";

import { useScrollLock } from "@assistant-ui/react";
import { ChevronDownIcon } from "lucide-react";
import { useCallback, useRef } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/shadcn/collapsible";
import { cn } from "@/lib/utils";

export const DISCLOSURE_DURATION = 200;

export type DisclosureProps = Omit<React.ComponentProps<typeof Collapsible>, "open" | "onOpenChange"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Controlled collapsible for chat disclosures (tool calls, chain of thought).
 * Wraps the stock shadcn Collapsible with the shared toggle behavior: locks the
 * thread viewport scroll for the duration of the toggle animation and exposes
 * `--animation-duration` so trigger/content animations stay in sync.
 */
export function Disclosure({ open, onOpenChange, style, children, ...props }: DisclosureProps) {
  const ref = useRef<HTMLDivElement>(null);
  const lockScroll = useScrollLock(ref, DISCLOSURE_DURATION);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      lockScroll();
      onOpenChange(next);
    },
    [lockScroll, onOpenChange],
  );

  return (
    <Collapsible
      ref={ref}
      open={open}
      onOpenChange={handleOpenChange}
      style={{ ...style, ["--animation-duration" as string]: `${DISCLOSURE_DURATION}ms` }}
      {...props}
    >
      {children}
    </Collapsible>
  );
}

export function DisclosureTrigger({ className, ...props }: React.ComponentProps<typeof CollapsibleTrigger>) {
  return (
    <CollapsibleTrigger
      className={cn(
        "group/disclosure text-muted-foreground hover:text-foreground flex items-center gap-2 py-1.5 text-sm transition-[color,scale] active:scale-[0.98]",
        className,
      )}
      {...props}
    />
  );
}

/** Chevron for a DisclosureTrigger: points down when open, rotates to the side
 *  when closed. Keyed to Base UI's `data-panel-open` on the trigger. */
export function DisclosureChevron({ className, ...props }: React.ComponentProps<typeof ChevronDownIcon>) {
  return (
    <ChevronDownIcon
      className={cn(
        "size-4 shrink-0 -rotate-90",
        "transition-transform duration-(--animation-duration) ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
        "group-data-panel-open/disclosure:rotate-0",
        className,
      )}
      {...props}
    />
  );
}

export function DisclosureContent({ className, ...props }: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      className={cn(
        "overflow-hidden outline-none",
        // Base UI's Panel measures itself into --collapsible-panel-height;
        // alias it to the Radix var the tw-animate-css collapsible keyframes
        // read, so open/close animates height instead of snapping.
        "[--radix-collapsible-content-height:var(--collapsible-panel-height)]",
        "group/disclosure-content ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none",
        "data-open:animate-collapsible-down data-closed:animate-collapsible-up data-closed:fill-mode-forwards",
        "data-open:duration-(--animation-duration) data-closed:duration-(--animation-duration)",
        className,
      )}
      {...props}
    />
  );
}

/** Trigger label that shows an animated shimmer overlay while `active`. */
export function ShimmerLabel({
  active = false,
  className,
  children,
  ...props
}: React.ComponentProps<"span"> & { active?: boolean }) {
  return (
    <span className={cn("relative inline-block leading-none", className)} {...props}>
      <span>{children}</span>
      {active && (
        <span aria-hidden className="shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none">
          {children}
        </span>
      )}
    </span>
  );
}
