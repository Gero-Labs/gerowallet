import { describe, expect, it, vi } from 'vitest';

vi.mock('@/plugins/i18n', () => ({
  default: {
    locale: 'us',
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}${JSON.stringify(values)}` : key,
  },
  getLocaleCode: () => 'en-US',
}));

import {
  coverageLabel,
  holdingLabel,
  isIsin,
  navPerTokenLabel,
  shareLabel,
  shortDate,
  sleeveLabel,
  usdCompact,
} from './reservesFormat';

describe('reserves formatting', () => {
  it('prints NAV per token to four places, so a fraction of a cent stays visible', () => {
    expect(navPerTokenLabel(1.00876985)).toBe('$1.0088');
    expect(navPerTokenLabel(1)).toBe('$1.0000');
  });

  it('prints headline dollars compactly', () => {
    expect(usdCompact(5_460_040.52)).toBe('$5.46M');
    expect(usdCompact(310_310.28)).toBe('$310.3K');
  });

  it('prints a share to one decimal and a sliver as "under 0.1%" rather than 0', () => {
    expect(shareLabel(0.9293)).toBe('realfi.reserves.share{"value":"92.9"}');
    expect(shareLabel(0.00009)).toBe('realfi.reserves.shareTiny');
    expect(shareLabel(0)).toBe('realfi.reserves.share{"value":"0"}');
  });

  it('cuts a backing ratio to two decimals instead of rounding a shortfall up to 100%', () => {
    expect(coverageLabel(0.9996)).toBe('realfi.reserves.share{"value":"99.96"}');
    expect(coverageLabel(0.99999)).toBe('realfi.reserves.share{"value":"99.99"}');
    expect(coverageLabel(1.0031)).toBe('realfi.reserves.share{"value":"100.31"}');
    expect(coverageLabel(1)).toBe('realfi.reserves.share{"value":"100.00"}');
    expect(coverageLabel(0)).toBe('realfi.reserves.share{"value":"0.00"}');
  });

  it('names known sleeves through i18n and shows an unknown one as words, not a key', () => {
    expect(sleeveLabel('crypto')).toBe('realfi.reserves.sleeve.crypto');
    expect(sleeveLabel('infrastructure_debt')).toBe('Infrastructure debt');
  });

  it('recognises an ISIN, and nothing else, as one', () => {
    expect(isIsin('XS0000000009')).toBe(true);
    expect(isIsin('TREASURY-A')).toBe(false);
    expect(isIsin('PRIVATE_CREDIT')).toBe(false);
  });

  it('calls a loan a loan and cash dollars, and leaves tickers as they are', () => {
    expect(holdingLabel('PRIVATE_CREDIT', 'private_credit')).toBe('realfi.reserves.symbol.loan');
    expect(holdingLabel('USD', 'fiat_cash')).toBe('realfi.reserves.symbol.usd');
    expect(holdingLabel('ETH', 'crypto')).toBe('ETH');
  });

  it('dates in UTC and drops a date it cannot read', () => {
    expect(shortDate('2026-01-02')).toBe('Jan 2');
    expect(shortDate('02/01/2026')).toBe('');
    expect(shortDate(null)).toBe('');
  });
});
