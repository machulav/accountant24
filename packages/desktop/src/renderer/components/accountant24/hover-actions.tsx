"use client";

import type { ComponentPropsWithoutRef } from "react";

import { TooltipIconButton } from "@/components/accountant24/tooltip-icon-button";
import { cn } from "@/lib/utils";

/**
 * Floating action pill for hoverable content surfaces (markdown tables, code
 * blocks). Hugs the host's top-right corner and fades in on hover or keyboard
 * focus, so the content stays clean at rest. Styled as a floating surface with
 * the same tokens as popovers/menus so it reads as part of the app.
 *
 * The host wrapper must be `relative` and carry the `group/hover-actions`
 * class; put the pill on a non-scrolling wrapper so it stays put while the
 * content scrolls.
 */
export function HoverActions({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        // has-[:focus-visible] (not focus-within): reveal for keyboard focus
        // only — a mouse click also focuses the button, which would pin the
        // pill visible after the pointer leaves.
        "bg-popover text-popover-foreground ring-foreground/5 dark:ring-foreground/10 absolute end-2 top-2 z-10 flex items-center gap-0.5 rounded-full p-1 opacity-0 shadow-lg ring-1 transition-opacity group-hover/hover-actions:opacity-100 has-[:focus-visible]:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

/** An icon button inside HoverActions: muted at rest, full-strength on hover. */
export function HoverActionButton({ className, ...props }: ComponentPropsWithoutRef<typeof TooltipIconButton>) {
  return <TooltipIconButton className={cn("text-muted-foreground hover:text-foreground", className)} {...props} />;
}
