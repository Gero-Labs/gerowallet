import type { HelpSource } from '@/api/help.api';

/**
 * The warning shown above the Updates list. Empty when every visible source is up to date.
 * One stale source is named with its check date; anything else is summarised.
 */
export function staleStatusFor(visible: HelpSource[], format: {
  name: (source: string) => string;
  date: (value?: string | null) => string;
  text: (key: 'staleOne' | 'unavailableOne' | 'staleSome', params?: Record<string, unknown>) => string;
  othersText: (count: number) => string;
}): string {
  const behind = visible.filter(item => item.status !== 'fresh');
  if (!behind.length) return '';
  if (behind.length > 1) return format.text('staleSome');
  const [only] = behind;
  const others = visible.length - 1;
  const tail = others > 0 ? ' ' + format.othersText(others) : '';
  if (only.status === 'unavailable') return format.text('unavailableOne', { source: format.name(only.source) }) + tail;
  const checked = only.mode === 'manual' ? only.lastReviewedAt ?? only.lastSuccessfulSyncAt : only.lastSuccessfulSyncAt ?? only.lastReviewedAt;
  // Without a date the specific sentence would be wrong, so fall back to the summary.
  if (!checked || !Number.isFinite(Date.parse(checked))) return format.text('staleSome');
  return format.text('staleOne', { source: format.name(only.source), date: format.date(checked) }) + tail;
}
