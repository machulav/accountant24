"use client";

// The `@` mentions popover: categories (accounts/payees/tags) with drill-in and
// back navigation; selecting an item inserts a directive chip into the composer.
// The `/` skills picker has its own sibling (composer-skills-popover.tsx) —
// the two popovers carry different business logic and evolve independently.

import {
  ComposerPrimitive,
  type Unstable_DirectiveFormatter,
  type Unstable_TriggerItem,
  unstable_defaultDirectiveFormatter,
  unstable_useTriggerPopoverScopeContext,
} from "@assistant-ui/react";
import { ChevronLeftIcon, ChevronRightIcon, SparklesIcon } from "lucide-react";
import { type ComponentPropsWithoutRef, type FC, memo, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { COMPOSER_POPOVER_CHROME, POPOVER_ROW, POPOVER_WIDTH } from "./popover";

// Styling note: shadcn's menu-row components (DropdownMenuItem, ComboboxItem)
// are bound to their Base UI/cmdk engines and can't render inside an
// assistant-ui popover, so the popup chrome and row core come from the shared
// popover recipes (./popover.ts). Only the leftovers are copied from stock:
//   lists      ← shadcn/combobox.tsx ComboboxList (padding, no-scrollbar)
//   empty rows ← shadcn Command empty-state convention (py-6 centered)

type IconComponent = FC<{ className?: string }>;

type ComposerMentionsPopoverProps = Omit<
  ComponentPropsWithoutRef<typeof ComposerPrimitive.Unstable_TriggerPopover>,
  "children" | "char"
> & {
  /** Insert-directive behavior: how a picked mention lands in the composer. */
  directive: {
    /** Formatter used to serialize the selected item into composer text. */
    formatter?: Unstable_DirectiveFormatter | undefined;
    /** Called after the directive text has been inserted into the composer. */
    onInserted?: ((item: Unstable_TriggerItem) => void) | undefined;
  };
  /**
   * Maps icon keys to components. Items look up via `item.metadata?.icon`
   * (string); categories look up via their `id`.
   */
  iconMap?: Record<string, IconComponent>;
  /** Fallback icon when no entry in `iconMap` matches. */
  fallbackIcon?: IconComponent;
  /** Label shown on the back button. @default "Back" */
  backLabel?: string;
  /** Label shown when no categories are available. @default "No items available" */
  emptyCategoriesLabel?: string;
  /** Label shown when no items match. @default "No matching items" */
  emptyItemsLabel?: string;
  /** Label shown while an async adapter is resolving items. @default "Loading…" */
  loadingLabel?: string;
};

function resolveIcon(
  iconKey: string | undefined,
  iconMap: Record<string, IconComponent> | undefined,
  fallback: IconComponent,
): IconComponent {
  if (iconKey && iconMap?.[iconKey]) return iconMap[iconKey]!;
  return fallback;
}

type CategoriesProps = {
  iconMap: Record<string, IconComponent> | undefined;
  fallbackIcon: IconComponent;
  emptyLabel: string;
};

const Categories: FC<CategoriesProps> = ({ iconMap, fallbackIcon, emptyLabel }) => (
  <ComposerPrimitive.Unstable_TriggerPopoverCategories>
    {(categories) => (
      <div
        data-slot="composer-mentions-popover-categories"
        // max-h matches the stock ComboboxList cap used by the model selector.
        className="scroll-fade no-scrollbar flex max-h-[15.75rem] flex-col overflow-y-auto p-1.5"
      >
        {categories.map((cat) => {
          const Icon = resolveIcon(cat.id, iconMap, fallbackIcon);
          return (
            <ComposerPrimitive.Unstable_TriggerPopoverCategoryItem
              key={cat.id}
              categoryId={cat.id}
              className={cn(POPOVER_ROW, "flex items-center justify-between gap-2 text-sm font-medium")}
            >
              <span className="flex items-center gap-2">
                <Icon className="text-muted-foreground size-4" />
                {cat.label}
              </span>
              <ChevronRightIcon className="text-muted-foreground size-4" />
            </ComposerPrimitive.Unstable_TriggerPopoverCategoryItem>
          );
        })}
        {categories.length === 0 && (
          <div className="text-muted-foreground w-full py-6 text-center text-sm">{emptyLabel}</div>
        )}
      </div>
    )}
  </ComposerPrimitive.Unstable_TriggerPopoverCategories>
);

type ItemsProps = {
  iconMap: Record<string, IconComponent> | undefined;
  fallbackIcon: IconComponent;
  backLabel: string;
  emptyLabel: string;
  loadingLabel: string;
};

const Items: FC<ItemsProps> = ({ iconMap, fallbackIcon, backLabel, emptyLabel, loadingLabel }) => {
  const { isLoading, highlightedIndex } = unstable_useTriggerPopoverScopeContext();
  const scrollRef = useRef<HTMLDivElement>(null);
  // Keyboard nav moves the highlight but doesn't scroll; keep the highlighted
  // item in view. `nearest` does the minimum scroll (and no horizontal jump).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `highlightedIndex` is the deliberate re-run trigger; the DOM is queried, not the value
  useEffect(() => {
    scrollRef.current
      ?.querySelector<HTMLElement>("[data-highlighted]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [highlightedIndex]);
  return (
    <ComposerPrimitive.Unstable_TriggerPopoverItems>
      {(items) => (
        <div data-slot="composer-mentions-popover-items" className="flex flex-col">
          {/* Back renders null in direct-search mode; hide the whole header
              (row + separator) with it so no stray hairline remains. */}
          <div className="hidden has-[button]:block">
            <div className="p-1.5 pb-0">
              <ComposerPrimitive.Unstable_TriggerPopoverBack
                className={cn(POPOVER_ROW, "text-muted-foreground flex w-full items-center gap-2 text-sm")}
              >
                <ChevronLeftIcon className="size-4" />
                {backLabel}
              </ComposerPrimitive.Unstable_TriggerPopoverBack>
            </div>
            <div className="bg-border mt-1 h-px" />
          </div>

          {/* max-h matches the stock ComboboxList cap used by the model selector.
              Long names truncate (full name in the title tooltip) instead of
              horizontal scrolling, so the highlight never clips. */}
          <div ref={scrollRef} className="scroll-fade no-scrollbar max-h-[15.75rem] overflow-y-auto p-1.5">
            <div className="flex flex-col">
              {items.map((item, index) => {
                const iconKey = typeof item.metadata?.icon === "string" ? item.metadata.icon : undefined;
                const Icon = resolveIcon(iconKey, iconMap, fallbackIcon);
                return (
                  <ComposerPrimitive.Unstable_TriggerPopoverItem
                    key={item.id}
                    item={item}
                    index={index}
                    className={cn(POPOVER_ROW, "flex w-full flex-col items-start gap-0.5 text-start")}
                  >
                    <span className="flex w-full min-w-0 items-center gap-2 text-sm font-medium">
                      <Icon className="text-muted-foreground size-4 shrink-0" />
                      <span className="truncate" title={item.label}>
                        {item.label}
                      </span>
                    </span>
                    {item.description && (
                      // ps-6 (not ms-6): the icon-width indent must live INSIDE
                      // the w-full box — margin + w-full overflows the row by
                      // the margin (same fix as the skills popover).
                      <span className="text-muted-foreground w-full min-w-0 truncate ps-6 text-xs leading-tight">
                        {item.description}
                      </span>
                    )}
                  </ComposerPrimitive.Unstable_TriggerPopoverItem>
                );
              })}
              {items.length === 0 && (
                <div className="text-muted-foreground w-full py-6 text-center text-sm">
                  {isLoading ? loadingLabel : emptyLabel}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </ComposerPrimitive.Unstable_TriggerPopoverItems>
  );
};

/** The mentions popover: category drill-in + directive insertion. Render inside
 *  the composer's `Unstable_TriggerPopoverRoot`. */
const ComposerMentionsPopoverImpl: FC<ComposerMentionsPopoverProps> = ({
  iconMap,
  fallbackIcon = SparklesIcon,
  backLabel = "Back",
  emptyCategoriesLabel = "No items available",
  emptyItemsLabel = "No matching items",
  loadingLabel = "Loading…",
  className,
  directive,
  ...props
}) => {
  return (
    <ComposerPrimitive.Unstable_TriggerPopover
      char="@"
      data-slot="composer-mentions-popover"
      className={cn("aui-composer-mentions-popover", COMPOSER_POPOVER_CHROME, POPOVER_WIDTH, className)}
      {...props}
    >
      <ComposerPrimitive.Unstable_TriggerPopover.Directive
        formatter={directive.formatter ?? unstable_defaultDirectiveFormatter}
        onInserted={directive.onInserted}
      />
      <Categories iconMap={iconMap} fallbackIcon={fallbackIcon} emptyLabel={emptyCategoriesLabel} />
      <Items
        iconMap={iconMap}
        fallbackIcon={fallbackIcon}
        backLabel={backLabel}
        emptyLabel={emptyItemsLabel}
        loadingLabel={loadingLabel}
      />
    </ComposerPrimitive.Unstable_TriggerPopover>
  );
};
ComposerMentionsPopoverImpl.displayName = "ComposerMentionsPopover";

export const ComposerMentionsPopover = memo(ComposerMentionsPopoverImpl) as FC<ComposerMentionsPopoverProps>;
