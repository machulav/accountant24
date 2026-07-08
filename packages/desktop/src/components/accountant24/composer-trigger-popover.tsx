"use client";

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

// Styling note: shadcn's menu-row components (DropdownMenuItem, ComboboxItem)
// are bound to their Base UI/cmdk engines and can't render inside an
// assistant-ui popover, so — like shadcn itself does across its own menu
// components — the popup/row/label RECIPES below are copied verbatim from the
// stock files. When the stock recipes change, resync these:
//   container  ← shadcn/dropdown-menu.tsx DropdownMenuContent
//   rows       ← shadcn/dropdown-menu.tsx DropdownMenuItem
//   lists      ← shadcn/combobox.tsx ComboboxList (padding, no-scrollbar)
//   empty rows ← shadcn Command empty-state convention (py-6 centered)

type IconComponent = FC<{ className?: string }>;

type DirectiveBehaviorProps = {
  /** Formatter used to serialize the selected item into composer text. */
  formatter?: Unstable_DirectiveFormatter | undefined;
  /** Called after the directive text has been inserted into the composer. */
  onInserted?: ((item: Unstable_TriggerItem) => void) | undefined;
};

type ActionBehaviorProps = {
  /** Formatter used to serialize the audit-trail chip (when `removeOnExecute` is false). */
  formatter?: Unstable_DirectiveFormatter | undefined;
  /** Invoked with the selected item at the moment of selection. */
  onExecute: (item: Unstable_TriggerItem) => void;
  /** If `true`, strip the trigger text from the composer after executing. @default false */
  removeOnExecute?: boolean | undefined;
};

type ComposerTriggerPopoverBaseProps = Omit<
  ComponentPropsWithoutRef<typeof ComposerPrimitive.Unstable_TriggerPopover>,
  "children"
> & {
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

type ComposerTriggerPopoverProps = ComposerTriggerPopoverBaseProps &
  (
    | {
        /** Insert-directive behavior. */
        directive: DirectiveBehaviorProps;
        action?: never;
      }
    | {
        /** Action behavior. */
        action: ActionBehaviorProps;
        directive?: never;
      }
  );

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
        data-slot="composer-trigger-popover-categories"
        // max-h matches the stock ComboboxList cap used by the model selector.
        className="scroll-fade no-scrollbar flex max-h-[15.75rem] flex-col overflow-y-auto p-1.5"
      >
        {categories.map((cat) => {
          const Icon = resolveIcon(cat.id, iconMap, fallbackIcon);
          return (
            <ComposerPrimitive.Unstable_TriggerPopoverCategoryItem
              key={cat.id}
              categoryId={cat.id}
              className="hover:bg-accent hover:text-accent-foreground focus:bg-accent data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground flex items-center justify-between gap-2 rounded-2xl px-3 py-2 text-sm font-medium outline-none"
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
        <div data-slot="composer-trigger-popover-items" className="flex flex-col">
          {/* Back renders null in direct-search mode; hide the whole header
              (row + separator) with it so no stray hairline remains. */}
          <div className="hidden has-[button]:block">
            <div className="p-1.5 pb-0">
              <ComposerPrimitive.Unstable_TriggerPopoverBack className="text-muted-foreground hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm outline-none">
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
                    className="hover:bg-accent hover:text-accent-foreground focus:bg-accent data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground flex w-full flex-col items-start gap-0.5 rounded-2xl px-3 py-2 text-start outline-none"
                  >
                    <span className="flex w-full min-w-0 items-center gap-2 text-sm font-medium">
                      <Icon className="text-muted-foreground size-4 shrink-0" />
                      <span className="truncate" title={item.label}>
                        {item.label}
                      </span>
                    </span>
                    {item.description && (
                      <span className="text-muted-foreground ms-6 w-full min-w-0 truncate text-xs leading-tight">
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

/**
 * Pre-built popover UI for a trigger-driven picker (mentions, slash commands, etc).
 * Pass exactly one of `directive` (inserts a chip) or `action` (fires a handler).
 */
const ComposerTriggerPopoverImpl: FC<ComposerTriggerPopoverProps> = ({
  iconMap,
  fallbackIcon = SparklesIcon,
  backLabel = "Back",
  emptyCategoriesLabel = "No items available",
  emptyItemsLabel = "No matching items",
  loadingLabel = "Loading…",
  className,
  directive,
  action,
  ...props
}) => {
  const warnedRef = useRef(false);
  if (process.env.NODE_ENV !== "production" && !warnedRef.current && Boolean(directive) === Boolean(action)) {
    warnedRef.current = true;
    console.warn("[assistant-ui] ComposerTriggerPopover requires exactly one of `directive` or `action` props.");
  }

  return (
    <ComposerPrimitive.Unstable_TriggerPopover
      data-slot="composer-trigger-popover"
      className={cn(
        // Chrome copied from the stock dropdown-menu/combobox popup so all popups
        // in the app share one look: rounded-3xl, ring instead of border, fade/zoom in.
        "aui-composer-trigger-popover bg-popover text-popover-foreground ring-foreground/5 dark:ring-foreground/10 animate-in fade-in-0 zoom-in-95 absolute start-0 bottom-full z-50 mb-2 w-96 overflow-hidden rounded-3xl shadow-lg ring-1 duration-100",
        className,
      )}
      {...props}
    >
      {directive ? (
        <ComposerPrimitive.Unstable_TriggerPopover.Directive
          formatter={directive.formatter ?? unstable_defaultDirectiveFormatter}
          onInserted={directive.onInserted}
        />
      ) : action ? (
        <ComposerPrimitive.Unstable_TriggerPopover.Action
          formatter={action.formatter ?? unstable_defaultDirectiveFormatter}
          onExecute={action.onExecute}
          removeOnExecute={action.removeOnExecute}
        />
      ) : null}
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
ComposerTriggerPopoverImpl.displayName = "ComposerTriggerPopover";

export const ComposerTriggerPopover = memo(ComposerTriggerPopoverImpl) as FC<ComposerTriggerPopoverProps>;
