import { describe, it, expect } from 'vitest';
import { formatTokenQuantity } from './format';

describe('formatTokenQuantity', () => {
  // The CIP-113 preprod holdings a tester reported as "2" and "2.57".
  it('keeps the token\'s own decimals under 1,000', () => {
    expect(formatTokenQuantity(2.00457, 6)).toBe('2.00457');
    expect(formatTokenQuantity(2.573973, 6)).toBe('2.573973');
    expect(formatTokenQuantity(999.123456, 6)).toBe('999.123456');
  });

  it('never shows more than six decimals', () => {
    expect(formatTokenQuantity(1.123456789, 8)).toBe('1.123457');
  });

  it('drops trailing zeros and shows whole numbers bare', () => {
    expect(formatTokenQuantity(2.5, 6)).toBe('2.5');
    expect(formatTokenQuantity(12, 0)).toBe('12');
  });

  it('uses two decimals from 1,000 up', () => {
    expect(formatTokenQuantity(21000021, 6)).toBe('21,000,021');
    expect(formatTokenQuantity(1234.56789, 6)).toBe('1,234.57');
  });

  it('keeps the small-amount floor', () => {
    expect(formatTokenQuantity(0.0005, 6)).toBe('<0.001');
    expect(formatTokenQuantity(0.123456, 6)).toBe('0.123456');
  });

  it('reads zero and non-numbers as 0', () => {
    expect(formatTokenQuantity(0, 6)).toBe('0');
    expect(formatTokenQuantity(Number.NaN, 6)).toBe('0');
  });
});
