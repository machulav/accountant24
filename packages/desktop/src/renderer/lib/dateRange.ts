// Date bounds for the Transactions view's Date filter chip. Pure calendar
// arithmetic over an injected "today", so tests pin time without fake
// timers. Bounds and journal dates are ISO strings, which order
// lexicographically, so range checks are plain string compares.

export type DateRangePreset = "this-month" | "last-month" | "this-year" | "last-year";

export const PRESET_LABELS: Record<DateRangePreset, string> = {
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
  switch (preset) {
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
