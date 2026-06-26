// src/services/agent/swapIntent.spec.ts
import { describe, it, expect } from 'vitest';
import { parseSwapIntent } from './swapIntent';

describe('parseSwapIntent', () => {
  it('parses an explicit-amount swap', () => {
    expect(parseSwapIntent('swap 100 ada for gero')).toEqual({
      type: 'swap', sellSymbol: 'ADA', buySymbol: 'GERO', mode: 'amount', amount: '100',
    });
  });

  it('parses a percentage sell', () => {
    expect(parseSwapIntent('sell 30% of my snek for ada')).toEqual({
      type: 'swap', sellSymbol: 'SNEK', buySymbol: 'ADA', mode: 'percent', percent: 30,
    });
  });

  it('returns null for non-swap text', () => {
    expect(parseSwapIntent('what is my p&l')).toBeNull();
    expect(parseSwapIntent('chart snek')).toBeNull();
  });
});
