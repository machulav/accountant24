"use client";

// The app's one search field, used by every search spot: the page toolbars
// (Transactions, Net Worth) and the popover lists (filter chips, model
// selector). One recipe everywhere: magnifier on the left, "Search {subject}"
// placeholder, and a clear X on the right while there is text.
//
// The field is controlled in both modes. In combobox mode the input binds to
// the surrounding Base UI Combobox for list filtering, and the host must
// control the root's `inputValue` with the same state it passes here — that
// keeps the clear X a plain "set text to empty" with no reach into combobox
// internals (Base UI's own Clear part also wipes the selection in
// single/multiple modes, which is not what a search X means).

import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { SearchIcon, XIcon } from "lucide-react";
import type { FC, MouseEvent } from "react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/shadcn/input-group";
import { cn } from "@/lib/utils";

export const SearchField: FC<{
  /** What is being searched, always a plural noun ("transactions",
   *  "accounts"); renders as the "Search {subject}" placeholder and
   *  accessible name. */
  subject: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Bind the input to the surrounding Base UI Combobox (whose root must
   *  control `inputValue` with this same state) instead of a plain input. */
  combobox?: boolean;
  className?: string;
}> = ({ subject, value, onValueChange, combobox = false, className }) => {
  const label = `Search ${subject}`;
  const clear = (event: MouseEvent<HTMLButtonElement>) => {
    onValueChange("");
    // Hand focus back to the input so the next search types straight away.
    event.currentTarget.closest("[data-slot=input-group]")?.querySelector("input")?.focus();
  };
  return (
    <InputGroup
      className={cn(
        // No focus ring inside a popup: the search field is the popup's only
        // focusable control and is focused on open, so the ring is pure noise.
        combobox &&
          "w-auto has-[[data-slot=input-group-control]:focus-visible]:border-input/30 has-[[data-slot=input-group-control]:focus-visible]:ring-0",
        className,
      )}
    >
      {combobox ? (
        <ComboboxPrimitive.Input render={<InputGroupInput />} placeholder={label} aria-label={label} />
      ) : (
        <InputGroupInput
          type="search"
          placeholder={label}
          aria-label={label}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          // The field brings its own clear X; Chromium's built-in one would
          // double it.
          className="[&::-webkit-search-cancel-button]:hidden"
        />
      )}
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      {value !== "" && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={clear}>
            <XIcon />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
};
