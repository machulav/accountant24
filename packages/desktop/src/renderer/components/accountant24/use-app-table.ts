"use client";

// The app's TanStack table constructor: the data pages (Net Worth, the
// Transactions register) build their tables through here so the two
// vendored-grid facts every page must know are stated once.

import { type TableOptions, useTable } from "@tanstack/react-table";
import { type DataGridFeatures, dataGridFeatures } from "@/components/reui/data-grid/data-grid";

/** A table on the shared grid feature bundle. Two presets, both about the
 *  bundle rather than any one page:
 *  - `features`: v9 tables must declare their features up front, and the
 *    grid's components expect exactly this set.
 *  - `manualPagination`: the bundle registers the pagination feature, whose
 *    default 10-row page would otherwise cap the row model — every page here
 *    is one unpaginated list.
 *  Anything a page decides for itself (sorting policy, filters, state) stays
 *  in its own options and overrides these. */
export function useAppTable<TData extends object>(
  options: Omit<TableOptions<DataGridFeatures, TData>, "features">,
): ReturnType<typeof useTable<DataGridFeatures, TData>> {
  return useTable({ features: dataGridFeatures, manualPagination: true, ...options });
}
