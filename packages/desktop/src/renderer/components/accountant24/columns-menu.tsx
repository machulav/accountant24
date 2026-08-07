"use client";

// The header's Columns menu, shared by the data pages (Net Worth, the
// Transactions register): an outline trigger opening a checkbox list of the
// page's toggleable columns. Checking a box never closes the menu, so a
// multi-column choice happens in one visit.

import { Columns3Icon } from "lucide-react";
import type { FC } from "react";
import { Button } from "@/components/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";

export const ColumnsMenu: FC<{
  /** Toggleable columns in display order; anything not listed never leaves. */
  columns: { id: string; label: string }[];
  /** Visibility by column id; a missing id counts as hidden. */
  visibility: Record<string, boolean>;
  onToggle: (id: string, shown: boolean) => void;
}> = ({ columns, visibility, onToggle }) => (
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
