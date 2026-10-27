import i18n, { getLocaleCode } from '@/plugins/i18n';

/**
 * Coarse "Xs/Xm/Xh/Xd ago" label (matches the convention already used by
 * MidnightTransactionsCard/MempoolExplorer/etc.), shared by the proof-server
 * page, its dashboard widget and the wallet list instead of another ad hoc copy.
 */
export function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return '';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  // Other languages get the platform's own short form ("hace 3 min", "ahora");
  // English keeps the compact "3m ago" the rest of the app uses.
  if (i18n.locale !== 'us') {
    const rtf = new Intl.RelativeTimeFormat(getLocaleCode(i18n.locale), { numeric: 'auto', style: 'short' });
    if (diffSec < 5) return rtf.format(0, 'second');
    if (diffSec < 60) return rtf.format(-diffSec, 'second');
    if (diffSec < 3600) return rtf.format(-Math.floor(diffSec / 60), 'minute');
    if (diffSec < 86400) return rtf.format(-Math.floor(diffSec / 3600), 'hour');
    return rtf.format(-Math.floor(diffSec / 86400), 'day');
  }
  if (diffSec < 5) return 'now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}
