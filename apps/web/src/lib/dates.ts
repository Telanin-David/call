/** "2026-11-04" or an ISO time → "4 Nov". Dates from the api are UTC days. */
export function dayMonth(iso: string): string {
  return new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: iso.length === 10 ? 'UTC' : undefined });
}

/** "2026-11-04" → "4 Nov 2026". */
export function dayMonthYear(iso: string): string {
  return new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: iso.length === 10 ? 'UTC' : undefined });
}

/** The day before a date, for "you keep Starter until 3 Nov". */
export function dayBefore(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
