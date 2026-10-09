/** Short, locale-aware calendar date for Help content ("Oct 2, 2026"); empty when the value is not a date. */
export function formatHelpDate(value: string | null | undefined, locale: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
}
