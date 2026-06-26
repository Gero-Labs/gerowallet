// src/services/agent/intentRouter.spec.ts
import { describe, it, expect } from 'vitest';
import { parseIntent } from './intentRouter';

describe('parseIntent', () => {
  it('detects a chart-token intent and extracts the symbol (uppercased)', () => {
    expect(parseIntent('chart snek')).toEqual({ type: 'chart-token', symbol: 'SNEK' });
    expect(parseIntent('show me the price of GERO please')).toEqual({ type: 'chart-token', symbol: 'GERO' });
  });

  it('falls back to a plain chat intent', () => {
    expect(parseIntent('gm how are you')).toEqual({ type: 'chat' });
    expect(parseIntent('')).toEqual({ type: 'chat' });
  });
});
