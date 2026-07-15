// "YYYY-MM" month labels from the dashboard series, formatted for chart axes
// and tooltips.

/** "2025-08" -> "Aug" (axis ticks). */
export function formatMonthShort(month: string): string {
  const d = parseMonth(month);
  return d ? d.toLocaleString("en-US", { month: "short" }) : month;
}

/** "2025-08" -> "Aug 2025" (tooltip headers). */
export function formatMonthLong(month: string): string {
  const d = parseMonth(month);
  return d ? d.toLocaleString("en-US", { month: "short", year: "numeric" }) : month;
}

function parseMonth(month: string): Date | null {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1);
}
