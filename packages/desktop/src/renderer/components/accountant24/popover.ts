/**
 * Shared recipes for the app's list popovers (composer mentions and skills,
 * the filter chips, the date filter), so they look and behave as one family:
 * same fixed width, same popup chrome, same row highlighting, same content
 * cutting. Content never resizes a popover; rows that don't fit truncate,
 * with the full text in a title tooltip.
 */

/** Fixed popup width; content never resizes it. min-w-96 is load-bearing:
 *  the stock combobox popup's min-width tracks its anchor (the trigger plus
 *  a margin), so without the override a filter chip grown wide by two value
 *  pills stretches its popup past w-96 — and back, once a third pick
 *  collapses the pills to an "N selected" badge. */
export const POPOVER_WIDTH = "w-96 min-w-96";

/**
 * Popup chrome for the composer's assistant-ui popovers, which can't render
 * the stock Combobox/Popover containers: the recipe is copied from the stock
 * dropdown-menu/combobox popup (rounded-3xl, ring instead of border,
 * fade/zoom in) plus the composer anchoring (absolute, above the composer).
 * When the stock popup recipe changes, resync.
 */
export const COMPOSER_POPOVER_CHROME =
  "bg-popover text-popover-foreground ring-foreground/5 dark:ring-foreground/10 animate-in fade-in-0 zoom-in-95 absolute start-0 bottom-full z-50 mb-2 overflow-hidden rounded-3xl shadow-lg ring-1 duration-100";

/**
 * Interactive row core: shape, padding, and the highlight in both engines
 * (Base UI sets `data-highlighted`; the assistant-ui popovers also rely on
 * plain hover/focus). Call sites add their own layout and typography.
 */
export const POPOVER_ROW =
  "hover:bg-accent hover:text-accent-foreground focus:bg-accent data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground rounded-2xl px-3 py-2 outline-none";
