"use client";

// The header's Columns menu, shared by the data pages (Net Worth, the
// Transactions register): an outline trigger opening a checkbox list of the
// page's toggleable columns. Checking a box never closes the menu, so a
// multi-column choice happens in one visit.

import { Columns3Icon } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";

/** Generic in the column id so a page with a narrow id union (Net Worth's
 *  two optional columns) keeps it end to end, instead of casting the id back
 *  in its handler. */
export const ColumnsMenu = <Id extends string>({
  columns,
  visibility,
  onToggle,
}: {
  /** Toggleable columns in display order; anything not listed never leaves. */
  columns: { id: Id; label: string }[];
  /** Visibility by column id; a missing id counts as hidden. */
  visibility: Partial<Record<Id, boolean>>;
  onToggle: (id: Id, shown: boolean) => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <Button variant="outline" className="shrink-0">
          <Columns3Icon />
          Columns
        </Button>
      }
    />
    {/* min-w-44: at the stock popup width the longest label wraps to two
        lines. */}
    <DropdownMenuContent align="end" className="min-w-44">
      {columns.map((column) => (
        <DropdownMenuCheckboxItem
          key={column.id}
          closeOnClick={false}
          checked={visibility[column.id] ?? false}
          onCheckedChange={(checked) => onToggle(column.id, checked)}
        >
          {column.label}
        </DropdownMenuCheckboxItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);
