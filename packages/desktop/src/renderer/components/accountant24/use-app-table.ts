"use client";

// The app's TanStack table constructor: the data pages (Net Worth, the
// Transactions register) build their tables through here so the two
// vendored-grid facts every page must know are stated once.

import {
  functionalUpdate,
  type OnChangeFn,
  type SortingState,
  type TableOptions,
  useTable,
} from "@tanstack/react-table";
import type { Dispatch, SetStateAction } from "react";
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

/** Two-state sort headers (asc <-> desc) over the vendored header's fixed
 *  asc -> desc -> clear click cycle, shared by the data pages:
 *  - The clearing third click (journal/report order — near enough to the
 *    default sort to read as a dead click) maps to ascending, so a header
 *    always just flips direction.
 *  - The vendored cycle also ignores `sortDescFirst`; columns listed in
 *    `descFirst` get their first click (the column newly becoming the sort
 *    key) rewritten to descending — money columns put the biggest figures
 *    first. */
export function twoStateSortingChange(
  setSorting: Dispatch<SetStateAction<SortingState>>,
  descFirst: ReadonlySet<string> = new Set(),
): OnChangeFn<SortingState> {
  return (updater) =>
    setSorting((prev) => {
      const next = functionalUpdate(updater, prev);
      const cleared = prev[0];
      if (next.length === 0 && cleared) return [{ id: cleared.id, desc: false }];
      const first = next[0];
      if (first && first.id !== cleared?.id && !first.desc && descFirst.has(first.id)) {
        return [{ id: first.id, desc: true }];
      }
      return next;
    });
}
