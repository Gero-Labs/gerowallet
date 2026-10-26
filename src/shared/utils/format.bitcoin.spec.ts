import { describe, expect, it } from 'vitest';
import { SATS_PER_BTC, formatBtc, formatBtcFromBtc, formatSats } from './format';

describe('formatBtc', () => {
  it('shows all eight decimals', () => {
    expect(formatBtc(123_456)).toBe('0.00123456');
    expect(formatBtc(SATS_PER_BTC)).toBe('1.00000000');
    expect(formatBtc(0)).toBe('0.00000000');
  });

  it('groups whole bitcoins in thousands', () => {
    expect(formatBtc(1_234 * SATS_PER_BTC + 5)).toBe('1,234.00000005');
  });

  it('takes a bigint balance', () => {
    expect(formatBtc(BigInt(250_000_000))).toBe('2.50000000');
  });

  it('keeps the sign of a negative amount', () => {
    expect(formatBtc(-50_000)).toBe('-0.00050000');
  });
});

describe('formatBtcFromBtc', () => {
  it('formats an amount given in BTC like one given in sats', () => {
    expect(formatBtcFromBtc(0.0012)).toBe('0.00120000');
    // 0.1 + 0.2 is 0.30000000000000004: rounding to whole sats keeps float noise out
    expect(formatBtcFromBtc(0.1 + 0.2)).toBe('0.30000000');
  });
});

describe('formatSats', () => {
  it('groups satoshis in thousands', () => {
    expect(formatSats(1_234_567)).toBe('1,234,567');
    expect(formatSats(BigInt(42))).toBe('42');
  });

  it('keeps the sign of a negative amount', () => {
    expect(formatSats(-1_500)).toBe('-1,500');
  });
});
