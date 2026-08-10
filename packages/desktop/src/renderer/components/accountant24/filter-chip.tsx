"use client";

// Faceted filter chip: the toolbar trigger looks like the classic
// data-table filter chip (⊕ title, picked values as badges), while the
// popover is the app's stock Combobox in multi-select mode — the same
// popup, search field, and check-marked rows as the model selector, so
// every popover in the app reads as one family. Match counts render muted
// next to each option.

import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { CirclePlusIcon } from "lucide-react";
import { type FC, type ReactNode, useMemo, useState } from "react";
import { iconFor, MentionPill } from "@/components/accountant24/mentions";
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
import { cn } from "@/lib/utils";
import { POPOVER_ROW, POPOVER_WIDTH } from "./popover";
import { SearchField } from "./search-field";

/** The trigger's title/value divider: a full-height dashed rule in the
 *  chip's own border style, so it reads as part of the chip's frame. */
export const FilterChipSeparator: FC = () => (
  <span aria-hidden="true" className="mx-0.5 w-0 self-stretch border-l border-dashed border-border" />
);

/** The chip trigger's own look, shared by every chip (faceted or range) so
 *  the family restyles in one place. Rendered INTO the surrounding
 *  primitive's trigger (Combobox.Trigger, PopoverTrigger), which supplies
 *  the behavior. With a value shown, the trailing padding matches the value
 *  chip's vertical inset so the space reads even on all sides. */
export const filterChipTriggerClass = (active: boolean): string => cn("border-dashed", active && "pr-1.5");

/** A chip trigger's contents: icon, title, and — once the filter is on —
 *  the divider plus whatever spells out the picked value(s). */
export const FilterChipLabel: FC<{
  icon: FC<{ className?: string }>;
  title: string;
  active: boolean;
  children?: ReactNode;
}> = ({ icon: Icon, title, active, children }) => (
  <>
    <Icon className="size-4" />
    {title}
    {active && (
      <>
        <FilterChipSeparator />
        {children}
      </>
    )}
  </>
);

/** A chip's value badge: the plain-text spelling of a picked value or range
 *  ("3 selected", "≥ 100", "2026-03-01 - now"). */
export const FilterChipValue: FC<{ children: ReactNode; className?: string }> = ({ children, className }) => (
  <Badge variant="secondary" className={cn("bg-muted px-1.5 font-normal", className)}>
    {children}
  </Badge>
);

/** The popup's footer: clears the chip's filter without closing the popup. */
export const FilterChipClear: FC<{ onClear: () => void }> = ({ onClear }) => (
  <div className="border-t p-1.5">
    <Button variant="ghost" size="sm" className="w-full" onClick={onClear}>
      Clear filters
    </Button>
  </div>
);

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
  /** Render values as the chat's mention pills of this type ("account",
   *  "tag", "payee") — in the options and, smaller, on the trigger. Also
   *  picks the trigger icon (the same one the pills carry). Unset values
   *  render as plain text/badges. */
  mentionType?: string;
  /** Trigger icon for chips without a mention type; defaults to the mention
   *  type's pill icon, or the generic ⊕. */
  icon?: FC<{ className?: string }>;
  options: FilterChipOption[];
  /** Picked values; empty = the filter is off. */
  values: string[];
  onValuesChange: (values: string[]) => void;
  /** Per-value match counts, shown muted next to each option. */
  counts?: Map<string, number>;
}> = ({ title, subject, mentionType, icon, options, values, onValuesChange, counts }) => {
  const Icon = icon ?? (mentionType ? iconFor(mentionType) : CirclePlusIcon);
  const [open, setOpen] = useState(false);
  // The popup's search text, owned here so the field's clear X is a plain
  // state reset; every open starts with a fresh, empty search.
  const [query, setQuery] = useState("");
  // Picked options, looked up by value: the option lists run to thousands of
  // entries on a real journal, and this recomputes on every page render (a
  // keystroke, a resize drag), so it must not rescan the whole list.
  const byValue = useMemo(() => new Map(options.map((option) => [option.value, option])), [options]);
  const selected = useMemo(() => values.flatMap((value) => byValue.get(value) ?? []), [values, byValue]);

  return (
    <Combobox
      multiple
      items={options}
      value={selected}
      onValueChange={(next: FilterChipOption[]) => onValuesChange(next.map((option) => option.value))}
      isItemEqualToValue={(a: FilterChipOption, b: FilterChipOption) => a.value === b.value}
      itemToStringLabel={(option: FilterChipOption) => option.label}
      inputValue={query}
      // Base UI wipes the query on every pick ('input-clear'); in a
      // multi-select that kills picking several results of one search, so
      // programmatic clears are ignored — the search only changes by typing,
      // our clear X, or the fresh-open reset.
      onInputValueChange={(next: string, details: { reason?: string }) => {
        if (next === "" && details?.reason === "input-clear") return;
        setQuery(next);
      }}
      open={open}
      onOpenChange={(next: boolean) => {
        setOpen(next);
        if (next) setQuery("");
      }}
    >
      <ComboboxPrimitive.Trigger
        aria-label={title}
        render={<Button variant="outline" size="sm" className={filterChipTriggerClass(selected.length > 0)} />}
      >
        <FilterChipLabel icon={Icon} title={title} active={selected.length > 0}>
          {selected.length > MAX_BADGES ? (
            <FilterChipValue>{selected.length} selected</FilterChipValue>
          ) : (
            selected.map((option) =>
              mentionType ? (
                // text-xs shrinks the em-scaled pill a step below the
                // trigger label so it reads as the chip's value. The pill
                // truncates its own text, keeping its rounded edge.
                // flex wrapper: as a flex item the pill loses its inline
                // box, dodging the inline-block/overflow baseline quirk
                // that floats it off the row's center.
                // No native title: the pill brings its own clip-aware
                // tooltip in truncate mode.
                <span key={option.value} className="flex items-center text-xs">
                  <MentionPill truncate type={mentionType} label={option.label} className="max-w-40" />
                </span>
              ) : (
                <FilterChipValue key={option.value} className="max-w-40">
                  <span className="truncate" title={option.label}>
                    {option.label}
                  </span>
                </FilterChipValue>
              ),
            )
          )}
        </FilterChipLabel>
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
                {mentionType ? (
                  // flex wrapper: see the trigger note — keeps the pill on
                  // the row's center line. No native title: the pill brings
                  // its own clip-aware tooltip.
                  <span className="flex min-w-0 items-center">
                    <MentionPill truncate type={mentionType} label={option.label} />
                  </span>
                ) : (
                  <span className="truncate" title={option.label}>
                    {option.label}
                  </span>
                )}
                {counts?.get(option.value) !== undefined && (
                  <span className="ms-auto text-xs font-normal text-muted-foreground tabular-nums">
                    {counts.get(option.value)}
                  </span>
                )}
              </ComboboxPrimitive.Item>
            )}
          </ComboboxCollection>
        </ComboboxList>
        {selected.length > 0 && <FilterChipClear onClear={() => onValuesChange([])} />}
      </ComboboxContent>
    </Combobox>
  );
};
