"use client";

import { DownloadIcon, Maximize2Icon } from "lucide-react";
import { type ComponentPropsWithoutRef, useCallback, useRef, useState } from "react";

import { AppDialogHeader } from "@/components/accountant24/app-dialog-header";
import { TooltipIconButton } from "@/components/accountant24/tooltip-icon-button";
import { Dialog, DialogContent } from "@/components/shadcn/dialog";
import { tableToCsv } from "@/lib/table-csv";
import { cn } from "@/lib/utils";

// Shared by the inline and the expanded (dialog) table so both render the
// memoized th/td/tr children identically. w-max lets columns take their natural
// width (numbers/dates never wrap); min-w-full keeps narrow tables full-width.
const tableClassName = "aui-md-table w-max min-w-full border-separate border-spacing-0 text-sm tabular-nums";

/**
 * Markdown table renderer. Renders the table compact inline; an expand button
 * opens the same table in a wide dialog so every column is visible without
 * horizontal scrolling.
 */
export function MarkdownTable({ className, children, ...props }: ComponentPropsWithoutRef<"table">) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);

  const downloadCsv = useCallback(() => {
    const table = scrollRef.current?.querySelector("table");
    if (!table) return;
    // Leading BOM so Excel opens the UTF-8 file with the right encoding.
    const blob = new Blob([`﻿${tableToCsv(table)}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "table.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="aui-md-table-wrapper group/md-table relative my-3 w-full">
      <div ref={scrollRef} className="scroll-fade-x w-full overflow-x-auto">
        <table className={cn(tableClassName, className)} {...props}>
          {children}
        </table>
      </div>

      {/* Actions hug the table's top-right corner and fade in on hover (or
          keyboard focus), so the table stays clean at rest. Styled as a
          floating surface with the same tokens as popovers/menus so it reads
          as part of the app; sits on the non-scrolling wrapper so it stays put
          as the table scrolls. */}
      <div className="bg-popover text-popover-foreground ring-foreground/5 dark:ring-foreground/10 absolute end-2 top-2 z-10 flex items-center gap-0.5 rounded-full p-1 opacity-0 shadow-lg ring-1 transition-opacity group-hover/md-table:opacity-100 focus-within:opacity-100">
        <TooltipIconButton
          tooltip="Expand table"
          onClick={() => setExpanded(true)}
          className="text-muted-foreground hover:text-foreground"
        >
          <Maximize2Icon />
        </TooltipIconButton>
        <TooltipIconButton
          tooltip="Download CSV"
          onClick={downloadCsv}
          className="text-muted-foreground hover:text-foreground"
        >
          <DownloadIcon />
        </TooltipIconButton>
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        {/* The dialog sizes to the table's natural width and height, so a
            short table gets a compact dialog. w-max/max-h-[85vh] cap it at
            92vw / 85vh (then the body scrolls) for large tables. */}
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[85vh] w-max max-w-[92vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[92vw]"
        >
          {/* Shared header bar (title + close + divider), then the scrolling
              body. The bar keeps the close off the table and separates it from
              the content as the table scrolls — needed for wide/tall tables. */}
          <AppDialogHeader title="Expanded table view" />
          <div className="min-h-0 overflow-auto p-6">
            <table className={cn(tableClassName, className)} {...props}>
              {children}
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
