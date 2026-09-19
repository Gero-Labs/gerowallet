// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { badgeTextFor } from './dappRequestBadge';

describe('badgeTextFor', () => {
  it('is empty at zero, below zero and for non-numbers', () => {
    expect(badgeTextFor(0)).toBe('');
    expect(badgeTextFor(-1)).toBe('');
    expect(badgeTextFor(Number.NaN)).toBe('');
  });

  it('shows small counts verbatim', () => {
    expect(badgeTextFor(1)).toBe('1');
    expect(badgeTextFor(9)).toBe('9');
  });

  it('caps at 9+', () => {
    expect(badgeTextFor(10)).toBe('9+');
    expect(badgeTextFor(120)).toBe('9+');
  });
});
