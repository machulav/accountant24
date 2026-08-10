// Date bounds for the Transactions view's Date filter chip. Pure calendar
// arithmetic over an injected "today", so tests pin time without fake
// timers. Bounds and journal dates are ISO strings, which order
// lexicographically, so range checks are plain string compares.

export type DateRangePreset = "last-7-days" | "last-30-days" | "this-month" | "last-month" | "this-year" | "last-year";

/** In use-case order: the rolling recency windows banking apps lead with
 *  ("what did I spend lately"), the budget-cycle months, the year views for
 *  reviews and taxes. Doubles as the preset grid's render order. */
export const PRESET_LABELS: Record<DateRangePreset, string> = {
  "last-7-days": "Last 7 days",
  "last-30-days": "Last 30 days",
  "this-month": "This month",
  "last-month": "Last month",
  "this-year": "This year",
  "last-year": "Last year",
};

/** Inclusive ISO date bounds; a null end is open. */
export interface DateRange {
  from: string | null;
  to: string | null;
}

/** ISO date for a calendar position. Date.UTC normalizes overflow (month 12
 *  = next January, day 0 = the previous month's last day), which is exactly
 *  the month-edge arithmetic the presets need; UTC keeps the ISO slice from
 *  drifting a day across timezones. */
const iso = (year: number, monthIndex: number, day: number): string =>
  new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);

/** The inclusive bounds a preset means on the given day. */
export function presetRange(preset: DateRangePreset, today: Date): DateRange {
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  switch (preset) {
    // Rolling windows include today: "last 7 days" reads as "this past
    // week, today included".
    case "last-7-days":
      return { from: iso(y, m, d - 6), to: iso(y, m, d) };
    case "last-30-days":
      return { from: iso(y, m, d - 29), to: iso(y, m, d) };
    case "this-month":
      return { from: iso(y, m, 1), to: iso(y, m + 1, 0) };
    case "last-month":
      return { from: iso(y, m - 1, 1), to: iso(y, m, 0) };
    case "this-year":
      return { from: iso(y, 0, 1), to: iso(y, 11, 31) };
    case "last-year":
      return { from: iso(y - 1, 0, 1), to: iso(y - 1, 11, 31) };
  }
}

/** Whether an ISO date falls inside the range (bounds inclusive). */
export function inRange(date: string, range: DateRange): boolean {
  return (range.from === null || date >= range.from) && (range.to === null || date <= range.to);
}

/** Whether the text is a real calendar date in ISO form: the YYYY-MM-DD
 *  shape alone admits 2026-13-45, and Date.UTC's overflow normalization
 *  turns 2026-02-31 into March 3rd — so the round trip through Date must
 *  land back on the same string. */
export function isIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}
