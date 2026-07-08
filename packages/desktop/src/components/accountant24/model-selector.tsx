"use client";

// Model picker: the stock shadcn Combobox with model-list logic on top.
// Everything visual is stock (Button trigger, Combobox popup/list/items);
// this file only supplies the ModelOption shape, filtering, and layout of a
// model row (name + provider description).

import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/shadcn/button";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/shadcn/combobox";
import { cn } from "@/lib/utils";

export type ModelOption = {
  id: string;
  name: string;
  description?: string;
};

const matchesQuery = (model: ModelOption, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [model.id, model.name].some((term) => term.toLowerCase().includes(q));
};

export type ModelSelectorProps = {
  models: readonly ModelOption[];
  /** Selected model id. Undefined shows the placeholder. */
  value?: string;
  onValueChange: (id: string) => void;
  /** Render a search input above the model list. */
  searchable?: boolean;
  variant?: "outline" | "ghost";
  size?: "default" | "sm" | "xs";
  className?: string;
  contentClassName?: string;
  placeholder?: string;
};

export function ModelSelector({
  models,
  value,
  onValueChange,
  searchable,
  variant = "outline",
  size = "default",
  className,
  contentClassName,
  placeholder = "Select model",
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const selected = models.find((m) => m.id === value) ?? null;

  return (
    <Combobox
      items={models}
      value={selected}
      onValueChange={(model: ModelOption | null) => {
        if (model) onValueChange(model.id);
      }}
      isItemEqualToValue={(a: ModelOption, b: ModelOption) => a.id === b.id}
      itemToStringLabel={(model: ModelOption) => model.name}
      filter={matchesQuery}
      open={open}
      onOpenChange={setOpen}
    >
      <ComboboxPrimitive.Trigger
        data-slot="model-selector-trigger"
        render={<Button variant={variant} size={size} className={cn("justify-between font-medium", className)} />}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>{selected?.name ?? placeholder}</span>
        <ChevronDownIcon className="size-4 opacity-50" />
      </ComboboxPrimitive.Trigger>
      <ComboboxContent data-slot="model-selector-content" className={cn("w-72", contentClassName)}>
        {searchable && (
          // No focus ring: the search field is the popup's only focusable
          // control and is focused on open, so the stock ring is pure noise.
          <ComboboxInput
            placeholder="Search models..."
            showTrigger={false}
            className="has-[[data-slot=input-group-control]:focus-visible]:border-input/30 has-[[data-slot=input-group-control]:focus-visible]:ring-0"
          />
        )}
        <ComboboxList className="scroll-fade">
          <ComboboxEmpty>No models found.</ComboboxEmpty>
          <ComboboxCollection>
            {(model: ModelOption) => (
              <ComboboxItem key={model.id} value={model} data-slot="model-selector-item" className="py-2">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{model.name}</span>
                  {model.description && (
                    <span className="text-muted-foreground truncate text-xs font-normal">{model.description}</span>
                  )}
                </span>
              </ComboboxItem>
            )}
          </ComboboxCollection>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
