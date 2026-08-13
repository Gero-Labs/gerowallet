import { describe, it, expect } from 'vitest';
import filters from './filters';

// toCurrency(value, signs?, decimalPlaces?, symbolPrefix?, symbolSuffix?, human?, decimals?)
// `decimals` converts from the smallest unit; `decimalPlaces` is the display precision.
const fmt = (value: number, places: number, decimals = 6) =>
  filters.toCurrency(value, false, places, '', '', false, decimals);

describe('toCurrency — honors the requested decimalPlaces (#937)', () => {
  it('renders 3 decimals when 3 are asked for', () => {
    // The defect: anything that wasn't 6 or 4 silently collapsed to 2.
    expect(fmt(1_234_000, 3)).toBe('1.234');
  });

  it('renders 5 decimals when 5 are asked for', () => {
    expect(fmt(1_234_560, 5)).toBe('1.23456');
  });

  it('leaves the previously-correct 6 and 4 paths unchanged', () => {
    expect(fmt(1_234_567, 6)).toBe('1.234567');
    expect(fmt(1_234_567, 4)).toBe('1.2346');
  });

  it('still caps at 2 when 2 is asked for', () => {
    expect(fmt(1_234_000, 2)).toBe('1.23');
  });

  it('treats decimalPlaces 0 as the legacy "default 2", not literal zero', () => {
    // Deliberate carve-out: signing screens pass 0 for fractional ADA amounts,
    // and honoring it literally would render a real 0.19 ADA fee as "0".
    expect(fmt(190_000, 0)).toBe('0.19');
    expect(fmt(341_721, 0)).toBe('0.34');
  });

  it('keeps grouping, symbols and sign handling intact', () => {
    expect(filters.toCurrency(1_234_567_890, false, 3, '₳', '', false, 6)).toBe('₳1,234.568');
    expect(filters.toCurrency(-1_234_000, true, 3, '', '', false, 6)).toBe('- 1.234');
    expect(filters.toCurrency(1_234_000, true, 3, '', '', false, 6)).toBe('+ 1.234');
  });

  it('applies the human-readable suffix before formatting', () => {
    expect(filters.toCurrency(9_900_000_000, false, 3, '', '', true, 6)).toBe('9.9K');
  });

  it('falls back to 2 decimals for an out-of-range request rather than throwing', () => {
    // Intl.NumberFormat rejects >20 fraction digits; the helper normalizes first.
    expect(() => fmt(1_234_000, 99)).not.toThrow();
    expect(fmt(1_234_000, 99)).toBe('1.23');
  });
});
