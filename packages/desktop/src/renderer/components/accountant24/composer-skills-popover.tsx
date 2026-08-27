"use client";

// The `/` skills popover — a dedicated, skills-shaped sibling of the mentions
// popover (composer-mentions-popover.tsx), split off so skill business logic
// can evolve independently of mentions. Skills are one flat keyboard-navigable
// list; selecting one replaces the typed `/…` trigger with a `:skill[name]` directive
// chip (mention-style — no raw `/skill:` text in the composer). The outgoing
// message is rewritten to pi's `/skill:name` wire form at send time
// (hoistSkillDirective in electronPiClient). Rows always carry the skill glyph
// and a description subtitle.
//
// Styling note: as in composer-mentions-popover.tsx, the popup chrome and row
// core come from the shared popover recipes (./popover.ts); the list and empty
// state are copied from the stock shadcn files (combobox list, command empty
// state). When the stock recipes change, resync.

import {
  ComposerPrimitive,
  unstable_defaultDirectiveFormatter,
  unstable_useTriggerPopoverScopeContext,
  useAuiState,
} from "@assistant-ui/react";
import { ZapIcon } from "lucide-react";
import { type ComponentPropsWithoutRef, type FC, useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { COMPOSER_POPOVER_CHROME, POPOVER_ROW, POPOVER_WIDTH } from "./popover";

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

/** A skill's full name, `plugin:skill`, with the plugin part played down.
 *  Every skill from one plugin starts with the same prefix, so the eye that is
 *  scanning for a skill has to skip it on every row; muting it puts the part
 *  that differs in the foreground. The prefix stays, because two plugins can
 *  ship a skill with the same name, and it is what the chip and the model see.
 *  Split on the first colon only: a plugin name never holds one, a skill name
 *  might. Exported for tests. */
export const SkillName: FC<{ name: string }> = ({ name }) => {
  const colon = name.indexOf(":");
  if (colon < 0) {
    return (
      <span className="truncate" title={name}>
        {name}
      </span>
    );
  }
  return (
    <span className="truncate" title={name}>
      <span className="text-muted-foreground font-normal">{name.slice(0, colon + 1)}</span>
      {name.slice(colon + 1)}
    </span>
  );
};

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
            {items.map((item, index) => (
              <ComposerPrimitive.Unstable_TriggerPopoverItem
                key={item.id}
                item={item}
                index={index}
                className={cn(POPOVER_ROW, "flex w-full flex-col items-start gap-0.5 text-start")}
              >
                <span className="flex w-full min-w-0 items-center gap-2 text-sm font-medium">
                  <ZapIcon className="text-muted-foreground size-4 shrink-0" />
                  <SkillName name={item.label} />
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
    className={cn("aui-composer-skills-popover", COMPOSER_POPOVER_CHROME, POPOVER_WIDTH, className)}
  >
    {/* Replaces the typed trigger with a `:skill[name]` chip in one runtime
        write (the default formatter serializes exactly that for our items),
        which also deactivates the trigger and closes the popover. */}
    <ComposerPrimitive.Unstable_TriggerPopover.Directive formatter={unstable_defaultDirectiveFormatter} />
    <SkillRows emptyLabel={emptyLabel} />
  </ComposerPrimitive.Unstable_TriggerPopover>
);
