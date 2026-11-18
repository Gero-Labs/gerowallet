/**
 * Display helpers for the reserves section: dates, figures and RealFi's keys as words.
 *
 * Pure functions over the report, so the component stays markup and the rules below
 * can be tested without mounting it.
 */

import i18n, { getLocaleCode } from '@/plugins/i18n';
import { formatCompact, formatPercentOfFraction } from '@/shared/utils/format';

const t = (key: string, values?: Record<string, unknown>) => i18n.t(key, values) as string;

/** "9 Nov" in the reader's language; RealFi's dates are UTC calendar days. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(getLocaleCode(i18n.locale), {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
}

/** A headline dollar figure: "$5.46M". */
export function usdCompact(value: number): string {
  return `$${formatCompact(value)}`;
}

/**
 * NAV per USDrf to four places: "$1.0088". Two places would print $1.01 and hide the
 * very difference from a dollar that the figure exists to show.
 */
export function navPerTokenLabel(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

/** A fraction of one as "12.8%" (or "12,8 %"), the sign from each language's copy. */
export function shareLabel(fraction: number): string {
  if (fraction > 0 && fraction < 0.001) return t('realfi.reserves.shareTiny');
  const value = formatPercentOfFraction(Math.round(fraction * 1000) / 1000, getLocaleCode(i18n.locale));
  return t('realfi.reserves.share', { value });
}

/** RealFi's sleeves; a key we have no words for is shown as its own words, not hidden. */
const SLEEVES = [
  'emerging_markets_private_credit',
  'cash_and_cash_equivalents',
  'us_corporate_bonds',
  'crypto',
];
const ASSET_CLASSES = [
  'private_credit',
  'tokenized_treasury',
  'stablecoin',
  'fiat_cash',
  'bond_etf',
  'crypto',
];

function humanize(key: string): string {
  const words = key.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

export function sleeveLabel(key: string): string {
  return SLEEVES.includes(key) ? t(`realfi.reserves.sleeve.${key}`) : humanize(key);
}

export function assetClassLabel(key: string): string {
  return ASSET_CLASSES.includes(key) ? t(`realfi.reserves.assetClass.${key}`) : humanize(key);
}

/** An ISIN (two letters, nine characters, a check digit): RealFi's id for a bond ETF. */
export function isIsin(symbol: string): boolean {
  return /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(symbol);
}

/** What a holding is called: a loan has no ticker and cash is just dollars. */
export function holdingLabel(symbol: string, assetClass: string): string {
  if (symbol === 'PRIVATE_CREDIT') return t('realfi.reserves.symbol.loan');
  if (symbol === 'USD' && assetClass === 'fiat_cash') return t('realfi.reserves.symbol.usd');
  return symbol;
}
