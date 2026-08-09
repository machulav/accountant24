"use client";

// The app-styled data-grid sort header, shared by the data pages: the
// vendored default hovers a small rounded-lg secondary box; ours is the
// ghost-button recipe (muted pill) every other hoverable control uses.
// Merged over the vendored classes via cn.

import type { Column } from "@tanstack/react-table";
import type { ReactNode } from "react";
import type { DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { cn } from "@/lib/utils";

const HEADER_CLASS = "rounded-4xl hover:bg-muted data-[state=open]:bg-muted";

export function AppColumnHeader<TData extends object, TValue>({
  column,
  title,
  icon,
  className,
}: {
  column: Column<DataGridFeatures, TData, TValue>;
  title: string;
  /** Rendered inside the pill, before the title (the vendored icon slot). */
  icon?: ReactNode;
  className?: string;
}) {
  return <DataGridColumnHeader column={column} title={title} icon={icon} className={cn(HEADER_CLASS, className)} />;
}
