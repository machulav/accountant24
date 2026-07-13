"use client";

// The `/` skills popover — a dedicated, skills-shaped sibling of the mentions
// popover (composer-mentions-popover.tsx), split off so skill business logic
// can evolve independently of mentions. Skills are one flat keyboard-navigable
// list with inline Built-in/Custom section labels on the group boundaries;
// selecting one replaces the typed `/…` trigger with a `:skill[name]` directive
// chip (mention-style — no raw `/skill:` text in the composer). The outgoing
// message is rewritten to pi's `/skill:name` wire form at send time
// (hoistSkillDirective in electronPiClient). Rows always carry the skill glyph
// and a description subtitle.
//
// Styling note: as in composer-mentions-popover.tsx, the popup/row recipes are
// copied verbatim from the stock shadcn files (dropdown-menu content/item,
// combobox list, command empty state). When the stock recipes change, resync.

import {
  ComposerPrimitive,
  type Unstable_TriggerItem,
  unstable_defaultDirectiveFormatter,
  unstable_useTriggerPopoverScopeContext,
  useAuiState,
} from "@assistant-ui/react";
import { ZapIcon } from "lucide-react";
import { type ComponentPropsWithoutRef, type FC, Fragment, useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** The trigger adapter shape the popover primitive expects (derived from the
 *  primitive's props — the type itself lives in @assistant-ui/core). */
export type SkillsTriggerAdapter = NonNullable<
  ComponentPropsWithoutRef<typeof ComposerPrimitive.Unstable_TriggerPopover>["adapter"]
>;

type ComposerSkillsPopoverProps = {
  /** Provides the (already filtered/shaped) skill items via `search()`. */
  adapter: SkillsTriggerAdapter;
  /** Shown when no skill matches (or none are added yet). */
  emptyLabel: string;
  className?: string;
};

type SkillRowEntry = {
  item: Unstable_TriggerItem;
  /** Flat index into the items array — the keyboard-nav/highlight contract. */
  index: number;
  /** Section label rendered above this row, on group boundaries only. */
  header?: "Built-in" | "Custom";
};

/** Mark group boundaries in the (already natives-first) item list. Headers
 *  appear only when BOTH groups are present: a lone label over a homogeneous
 *  list is noise. Exported for tests. */
export function groupSkillRows(items: readonly Unstable_TriggerItem[]): SkillRowEntry[] {
  const isNative = (item: Unstable_TriggerItem) => item.metadata?.native === true;
  const mixed = items.some(isNative) && items.some((item) => !isNative(item));
  let prev: boolean | null = null;
  return items.map((item, index) => {
    const native = isNative(item);
    const header = mixed && native !== prev ? (native ? ("Built-in" as const) : ("Custom" as const)) : undefined;
    prev = native;
    return header ? { item, index, header } : { item, index };
  });
}

/** Flat skill rows (no categories, no back navigation — skills are one list). */
const SkillRows: FC<{ emptyLabel: string }> = ({ emptyLabel }) => {
  const { open, close, highlightedIndex } = unstable_useTriggerPopoverScopeContext();
  const scrollRef = useRef<HTMLDivElement>(null);

  // pi only expands a *leading* skill token, so the picker mirrors that: a `/`
  // typed mid-message stays literal text (URLs, "and/or", …) and never arms the
  // popover. Leading test = the composer text starts with the trigger slash.
  // Layout effect so the mid-text popover closes before it ever paints.
  const isLeadingTrigger = useAuiState((s) => s.composer.text.trimStart().startsWith("/"));
  useLayoutEffect(() => {
    if (open && !isLeadingTrigger) close();
  }, [open, isLeadingTrigger, close]);
  // Keyboard nav moves the highlight but doesn't scroll; keep the highlighted
  // row in view. `nearest` does the minimum scroll (and no horizontal jump).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `highlightedIndex` is the deliberate re-run trigger; the DOM is queried, not the value
  useEffect(() => {
    scrollRef.current
      ?.querySelector<HTMLElement>("[data-highlighted]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [highlightedIndex]);

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverItems>
      {(items) => (
        // max-h matches the stock ComboboxList cap used by the model selector.
        <div
          ref={scrollRef}
          data-slot="composer-skills-popover-items"
          className="scroll-fade no-scrollbar max-h-[15.75rem] overflow-y-auto p-1.5"
        >
          <div className="flex flex-col">
            {groupSkillRows(items).map(({ item, index, header }) => (
              <Fragment key={item.id}>
                {header && (
                  // Non-interactive section label; recipe adapted from the
                  // stock dropdown-menu label, sized for this dense list.
                  <div className={cn("text-muted-foreground px-3 pb-1 text-xs font-medium", index > 0 && "pt-2")}>
                    {header}
                  </div>
                )}
                <ComposerPrimitive.Unstable_TriggerPopoverItem
                  item={item}
                  index={index}
                  className="hover:bg-accent hover:text-accent-foreground focus:bg-accent data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground flex w-full flex-col items-start gap-0.5 rounded-2xl px-3 py-2 text-start outline-none"
                >
                  <span className="flex w-full min-w-0 items-center gap-2 text-sm font-medium">
                    <ZapIcon className="text-muted-foreground size-4 shrink-0" />
                    <span className="truncate" title={item.label}>
                      {item.label}
                    </span>
                  </span>
                  {item.description && (
                    // Skill descriptions are long by design (they steer the model);
                    // show up to three lines and let the clamp ellipsize the rest.
                    // ps-6 (not ms-6): the icon-width indent must live INSIDE the
                    // w-full box — margin + w-full overflows the row by the margin.
                    <span className="text-muted-foreground line-clamp-3 w-full min-w-0 ps-6 text-xs leading-tight">
                      {item.description}
                    </span>
                  )}
                </ComposerPrimitive.Unstable_TriggerPopoverItem>
              </Fragment>
            ))}
            {items.length === 0 && (
              <div className="text-muted-foreground w-full py-6 text-center text-sm">{emptyLabel}</div>
            )}
          </div>
        </div>
      )}
    </ComposerPrimitive.Unstable_TriggerPopoverItems>
  );
};

/** Render inside the composer's `Unstable_TriggerPopoverRoot`, as a sibling of
 *  the mentions popover. */
export const ComposerSkillsPopover: FC<ComposerSkillsPopoverProps> = ({ adapter, emptyLabel, className }) => (
  <ComposerPrimitive.Unstable_TriggerPopover
    char="/"
    adapter={adapter}
    data-slot="composer-skills-popover"
    className={cn(
      // Popup chrome copied from the stock dropdown-menu/combobox popup so all
      // popups in the app share one look (same recipe as the mentions popover).
      "aui-composer-skills-popover bg-popover text-popover-foreground ring-foreground/5 dark:ring-foreground/10 animate-in fade-in-0 zoom-in-95 absolute start-0 bottom-full z-50 mb-2 w-96 overflow-hidden rounded-3xl shadow-lg ring-1 duration-100",
      className,
    )}
  >
    {/* Replaces the typed trigger with a `:skill[name]` chip in one runtime
        write (the default formatter serializes exactly that for our items),
        which also deactivates the trigger and closes the popover. */}
    <ComposerPrimitive.Unstable_TriggerPopover.Directive formatter={unstable_defaultDirectiveFormatter} />
    <SkillRows emptyLabel={emptyLabel} />
  </ComposerPrimitive.Unstable_TriggerPopover>
);
