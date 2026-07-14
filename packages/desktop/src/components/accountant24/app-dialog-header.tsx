"use client";

import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/shadcn/button";
import { DialogClose, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";
import { cn } from "@/lib/utils";

/**
 * Shared header for the app's dialogs: just the title and a close button in a
 * compact bar with a full-width divider. Any description belongs in the body
 * (below the divider), not here. Render inside a `p-0` DialogContent (with
 * `showCloseButton={false}`) followed by a padded body.
 */
export function AppDialogHeader({ title, className }: { title: ReactNode; className?: string }) {
  return (
    <DialogHeader className={cn("flex-row items-center justify-between gap-4 border-b px-6 py-3.5", className)}>
      <DialogTitle>{title}</DialogTitle>
      <DialogClose render={<Button variant="ghost" size="icon-sm" className="bg-secondary shrink-0" />}>
        <XIcon />
        <span className="aui-sr-only sr-only">Close</span>
      </DialogClose>
    </DialogHeader>
  );
}
