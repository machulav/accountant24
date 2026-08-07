"use client";

// Faceted filter chip: the toolbar trigger looks like the classic
// data-table filter chip (⊕ title, picked values as badges), while the
// popover is the app's stock Combobox in multi-select mode — the same
// popup, search field, and check-marked rows as the model selector, so
// every popover in the app reads as one family. Match counts render muted
// next to each option.

import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { CirclePlusIcon } from "lucide-react";
import { type FC, useState } from "react";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { Checkbox } from "@/components/shadcn/checkbox";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxList,
} from "@/components/shadcn/combobox";
import { Separator } from "@/components/shadcn/separator";
import { cn } from "@/lib/utils";
import { POPOVER_ROW, POPOVER_WIDTH } from "./popover";
import { SearchField } from "./search-field";

export interface FilterChipOption {
  label: string;
  value: string;
}

/** How many picked values show as badges before collapsing to a count. */
const MAX_BADGES = 2;

export const FilterChip: FC<{
  title: string;
  /** Plural noun for the popup's search field: "Search {subject}". */
  subject: string;
  options: FilterChipOption[];
  /** Picked values; empty = the filter is off. */
  values: string[];
  onValuesChange: (values: string[]) => void;
  /** Per-value match counts, shown muted next to each option. */
  counts?: Map<string, number>;
}> = ({ title, subject, options, values, onValuesChange, counts }) => {
  const [open, setOpen] = useState(false);
  // The popup's search text, owned here so the field's clear X is a plain
  // state reset; every open starts with a fresh, empty search.
  const [query, setQuery] = useState("");
  const selected = options.filter((option) => values.includes(option.value));

  return (
    <Combobox
      multiple
      items={options}
      value={selected}
      onValueChange={(next: FilterChipOption[]) => onValuesChange(next.map((option) => option.value))}
      isItemEqualToValue={(a: FilterChipOption, b: FilterChipOption) => a.value === b.value}
      itemToStringLabel={(option: FilterChipOption) => option.label}
      inputValue={query}
      onInputValueChange={setQuery}
      open={open}
      onOpenChange={(next: boolean) => {
        setOpen(next);
        if (next) setQuery("");
      }}
    >
      <ComboboxPrimitive.Trigger aria-label={title} render={<Button variant="outline" size="sm" />}>
        <CirclePlusIcon className="size-4" />
        {title}
        {selected.length > 0 && (
          <>
            <Separator orientation="vertical" className="mx-0.5 h-4" />
            {selected.length > MAX_BADGES ? (
              <Badge variant="secondary" className="px-1.5 font-normal">
                {selected.length} selected
              </Badge>
            ) : (
              selected.map((option) => (
                <Badge key={option.value} variant="secondary" className="max-w-40 px-1.5 font-normal">
                  <span className="truncate" title={option.label}>
                    {option.label}
                  </span>
                </Badge>
              ))
            )}
          </>
        )}
      </ComboboxPrimitive.Trigger>
      <ComboboxContent className={POPOVER_WIDTH}>
        <SearchField combobox subject={subject} value={query} onValueChange={setQuery} />
        <ComboboxList className="scroll-fade">
          <ComboboxEmpty>Nothing found</ComboboxEmpty>
          <ComboboxCollection>
            {(option: FilterChipOption) => (
              // Not the stock ComboboxItem: its rows are built around a
              // right-side checkmark indicator, while ours lead with a stock
              // Checkbox (multi-select is visible before the first click).
              // So the row is the Base UI primitive on the shared popover
              // row recipe — no indicator (nor its pr-8 slot), and no
              // highlight rule repainting all descendant text, which would
              // recolor the checkbox. The checkbox is pointer-inert so the
              // row itself toggles selection.
              <ComboboxPrimitive.Item
                key={option.value}
                value={option}
                className={cn(
                  POPOVER_ROW,
                  "relative flex w-full cursor-default items-center gap-2.5 text-sm font-medium select-none",
                )}
              >
                <Checkbox checked={values.includes(option.value)} tabIndex={-1} className="pointer-events-none" />
                <span className="truncate" title={option.label}>
                  {option.label}
                </span>
                {counts?.get(option.value) !== undefined && (
                  <span className="ms-auto text-xs font-normal text-muted-foreground tabular-nums">
                    {counts.get(option.value)}
                  </span>
                )}
              </ComboboxPrimitive.Item>
            )}
          </ComboboxCollection>
        </ComboboxList>
        {selected.length > 0 && (
          <div className="border-t p-1.5">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => onValuesChange([])}>
              Clear filters
            </Button>
          </div>
        )}
      </ComboboxContent>
    </Combobox>
  );
};
