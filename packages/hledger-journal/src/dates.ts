/** Zero-pad a parsed date to ISO and reject impossible calendar dates. */
export function normalizeDate(year: string, month: string, day: string): string | undefined {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return undefined;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** True when `iso` (strictly YYYY-MM-DD) names a real calendar day. */
export function isValidCalendarDate(iso: string): boolean {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  return normalizeDate(match[1], match[2], match[3]) !== undefined;
}
